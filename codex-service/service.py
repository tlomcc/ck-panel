#!/usr/bin/env python3
"""Independent CK task service. No CK gateway imports or upstream forwarding."""
import base64
import hashlib
import hmac
import json
import os
import queue
import re
import shutil
import signal
import sqlite3
import subprocess
import threading
import time
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.error import HTTPError
from urllib.parse import urlsplit, parse_qs
from urllib.request import Request, urlopen
from any_retry import AnyRetry, CONTINUE_TASK, is_any, retryable

VERSION = '1.2.0'
STATE = Path(os.environ.get('CK_CODEX_STATE', '/var/lib/ck-codex'))
WORKSPACE = Path(os.environ.get('CK_CODEX_WORKSPACE', '/home/ckcodex/workspace'))
CLI = os.environ.get('CK_CODEX_BIN', '/usr/local/bin/codex')
ORIGINS = {'https://tlomcc.github.io', 'https://tlomcc.cc.cd:18443', 'https://tlomcc.us.ci:18443',
           'https://123.57.175.84:18443'}
ACTIVE = {'queued', 'starting', 'running', 'waiting'}


class Problem(Exception):
    def __init__(self, message, status=400):
        super().__init__(message)
        self.status = status


def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    temporary = path.with_suffix('.tmp')
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2), 'utf-8')
    temporary.chmod(0o600)
    os.replace(temporary, path)


class Store:
    def __init__(self, root):
        self.root = root
        root.mkdir(parents=True, exist_ok=True, mode=0o700)
        self.lock = threading.RLock()
        self.db = sqlite3.connect(root / 'tasks.sqlite3', check_same_thread=False)
        self.db.row_factory = sqlite3.Row
        self.db.executescript('''PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
        CREATE TABLE IF NOT EXISTS windows (
          id TEXT PRIMARY KEY, create_key TEXT UNIQUE, thread_id TEXT, title TEXT,
          profile TEXT, cwd TEXT, status TEXT, turn_id TEXT, seq INTEGER DEFAULT 0,
          created REAL, updated REAL, error TEXT DEFAULT '', usage TEXT DEFAULT '{}');
        CREATE TABLE IF NOT EXISTS items (
          window_id TEXT REFERENCES windows(id) ON DELETE CASCADE, id TEXT,
          kind TEXT, text TEXT, data TEXT, seq INTEGER, created REAL,
          PRIMARY KEY(window_id,id));
        CREATE TABLE IF NOT EXISTS tasks (
          request_id TEXT PRIMARY KEY, window_id TEXT REFERENCES windows(id) ON DELETE CASCADE,
          text TEXT, status TEXT, created REAL, turn_id TEXT DEFAULT '');
        ''')
        self.db.execute("UPDATE tasks SET status='interrupted' WHERE status IN ('queued','starting','running','waiting')")
        self.db.execute("UPDATE windows SET status='interrupted', error='服务重启，上一任务已中断；请检查结果后继续。' WHERE status IN ('queued','starting','running','waiting')")
        self.db.commit()

    def one(self, wid):
        with self.lock:
            r = self.db.execute('SELECT * FROM windows WHERE id=?', (wid,)).fetchone()
            if not r:
                raise Problem('窗口不存在或已删除', 404)
            return dict(r)

    def list(self):
        with self.lock:
            return [dict(r) for r in self.db.execute('SELECT * FROM windows ORDER BY updated DESC')]

    def update(self, wid, **fields):
        with self.lock:
            fields['updated'] = time.time()
            self.db.execute('UPDATE windows SET seq=seq+1,' + ','.join(k+'=?' for k in fields) + ' WHERE id=?', (*fields.values(), wid))
            self.db.commit()

    def item(self, wid, iid, kind, text='', data=None, append=False):
        with self.lock:
            if not self.db.execute('SELECT 1 FROM windows WHERE id=?', (wid,)).fetchone():
                return
            old = self.db.execute('SELECT text,created FROM items WHERE window_id=? AND id=?', (wid, iid)).fetchone()
            if append and old:
                text = old['text'] + text
            limit = 65536 if kind in ('commandExecution', 'tool') else 262144
            if kind not in ('userMessage', 'agentMessage', 'plan', 'reasoning', 'warning') and len(text) > limit:
                text = '[较早输出已省略；完整执行记录在该 Codex 窗口目录]\n' + text[-limit:]
            self.db.execute('UPDATE windows SET seq=seq+1, updated=? WHERE id=?', (time.time(), wid))
            seq = self.db.execute('SELECT seq FROM windows WHERE id=?', (wid,)).fetchone()[0]
            self.db.execute('INSERT OR REPLACE INTO items VALUES (?,?,?,?,?,?,?)',
                            (wid, iid, kind, text, json.dumps(data or {}, ensure_ascii=False), seq, old['created'] if old else time.time()))
            self.db.commit()

    def snapshot(self, wid, after=0):
        with self.lock:
            window = self.one(wid)
            rows = self.db.execute('SELECT * FROM items WHERE window_id=? AND seq>? ORDER BY created,id', (wid, after)).fetchall()
            items = [dict(r) for r in rows]
            for item in items:
                item['data'] = json.loads(item['data'])
            return {'window': window, 'items': items, 'cursor': window['seq']}


class Engine:
    def __init__(self, manager, wid, profile):
        self.manager, self.wid = manager, wid
        self.waiters, self.requests = {}, {}
        self.write_lock = threading.Lock()
        self.stopping = False
        self.last_used = time.monotonic()
        self.profile_fingerprint = json.dumps(profile, sort_keys=True)
        home = manager.window_home(wid)
        home.mkdir(parents=True, exist_ok=True, mode=0o700)
        rules = manager.root / 'AGENTS.md'
        if rules.exists():
            (home / 'AGENTS.md').write_text(rules.read_text('utf-8'), 'utf-8')
        skills = manager.root / 'skills'
        if skills.exists() and not (home / 'skills').exists():
            (home / 'skills').symlink_to(skills, target_is_directory=True)
        config = '\n'.join([
            'model_provider = "ck_tasks"',
            'model = ' + json.dumps(profile['model']),
            'model_reasoning_effort = ' + json.dumps(profile.get('effort', 'high')),
            'approval_policy = "never"', 'sandbox_mode = "danger-full-access"',
            'web_search = "disabled"',
            '[features]', 'multi_agent = false',
            '[model_providers.ck_tasks]', 'name = "CK Codex independent API"',
            'base_url = ' + json.dumps(profile['base_url']),
            'env_key = "CK_CODEX_API_KEY"', 'wire_api = "responses"',
            'requires_openai_auth = false',
            'request_max_retries = ' + ('0' if is_any(profile) else '2'),
            'stream_max_retries = ' + ('0' if is_any(profile) else '2'),
            'stream_idle_timeout_ms = 180000',
            '[projects.' + json.dumps(str(WORKSPACE)) + ']', 'trust_level = "trusted"', ''
        ])
        (home / 'config.toml').write_text(config, 'utf-8')
        (home / 'config.toml').chmod(0o600)
        env = {k: v for k, v in os.environ.items() if not re.search(r'(?i)(api.?key|token|secret|proxy|codex_home)', k)}
        env.update(CODEX_HOME=str(home), CK_CODEX_API_KEY=profile.get('api_key', ''),
                   HOME=str(Path.home()), LANG='C.UTF-8', TZ='Asia/Shanghai')
        # Git uses a separate, permission-protected credential helper.
        self.proc = subprocess.Popen([CLI, 'app-server'], stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                     stderr=subprocess.PIPE, text=True, encoding='utf-8', bufsize=1,
                                     cwd=str(WORKSPACE), env=env, start_new_session=True)
        threading.Thread(target=self.read, daemon=True).start()
        threading.Thread(target=self.stderr, daemon=True).start()
        try:
            self.rpc('initialize', {'clientInfo': {'name': 'ck_tasks', 'title': 'CK Codex', 'version': VERSION},
                                    'capabilities': {'experimentalApi': True}})
            self.send({'method': 'initialized'})
        except Exception:
            self.close()
            raise

    def send(self, obj):
        with self.write_lock:
            self.proc.stdin.write(json.dumps(obj, ensure_ascii=False) + '\n')
            self.proc.stdin.flush()

    def rpc(self, method, params=None, timeout=35):
        rid = uuid.uuid4().hex
        waiter = queue.Queue(maxsize=1)
        self.waiters[rid] = waiter
        self.last_used = time.monotonic()
        try:
            self.send({'id': rid, 'method': method, 'params': params or {}})
            result = waiter.get(timeout=timeout)
            if 'error' in result:
                raise Problem(self.manager.redact(str(result['error'].get('message', result['error']))), 502)
            return result.get('result', {})
        except queue.Empty:
            raise Problem('Codex 响应超时，请刷新核对；任务不会自动重复提交。', 504)
        finally:
            self.waiters.pop(rid, None)

    def read(self):
        try:
            for line in self.proc.stdout:
                try:
                    event = json.loads(line)
                    if 'method' not in event and 'id' in event:
                        waiter = self.waiters.get(event['id'])
                        if waiter:
                            waiter.put_nowait(event)
                    elif 'id' in event:
                        if self.stopping:
                            continue
                        rid = str(event['id'])
                        self.requests[rid] = event
                        self.manager.store.item(self.wid, 'request:'+rid, 'request', '', self.manager.clean(event))
                        self.manager.store.update(self.wid, status='waiting')
                    else:
                        self.manager.event(self, event)
                except Exception as exc:
                    self.manager.log_problem(self.wid, '读取 Codex 事件失败：'+str(exc))
        finally:
            for waiter in list(self.waiters.values()):
                try:
                    waiter.put_nowait({'error': {'message': 'Codex 进程已退出'}})
                except queue.Full:
                    pass
            if not self.stopping:
                self.manager.failed(self.wid, 'Codex 进程退出；请检查已完成操作后继续。')

    def stderr(self):
        for line in self.proc.stderr:
            if 'ERROR' in line or 'error loading' in line.lower():
                self.manager.log_problem(self.wid, self.manager.redact(line.strip())[:1600])

    def close(self):
        self.stopping = True
        if self.proc.poll() is None:
            try:
                os.killpg(self.proc.pid, signal.SIGTERM)
                self.proc.wait(timeout=4)
            except subprocess.TimeoutExpired:
                os.killpg(self.proc.pid, signal.SIGKILL)
                self.proc.wait(timeout=4)
            except ProcessLookupError:
                pass
        self.requests.clear()


class Manager:
    def __init__(self, root=STATE, engine_factory=Engine, start_worker=True):
        self.store = Store(root)
        self.root, self.engine_factory = root, engine_factory
        self.lock = threading.RLock()
        self.engines = {}
        self.any_retries = {}  # In memory: only a manual submit can arm a run.
        self.config_path = root / 'config.json'
        self.config = json.loads(self.config_path.read_text('utf-8'))
        self.quit = threading.Event()
        if start_worker:
            threading.Thread(target=self.pump, daemon=True).start()

    def window_home(self, wid):
        if not re.fullmatch(r'[a-f0-9]{32}', wid):
            raise Problem('窗口编号无效')
        return self.root / 'windows' / wid / 'codex'

    def redact(self, text):
        for p in self.config.get('profiles', []):
            key = p.get('api_key', '')
            if key:
                text = text.replace(key, '[密钥已隐藏]')
        text = re.sub(r'(?i)(Bearer\s+)[^\s"\x27,]+', r'\1[已隐藏]', text)
        return text

    def clean(self, value):
        if isinstance(value, str):
            return self.redact(value)
        if isinstance(value, list):
            return [self.clean(v) for v in value]
        if isinstance(value, dict):
            return {k: '[已隐藏]' if re.fullmatch(r'(?i)(api_key|apiKey|authorization|password|token|secret)', k) else self.clean(v) for k, v in value.items()}
        return value

    def profile(self, pid=None):
        pid = pid or self.config.get('default_profile')
        for p in self.config.get('profiles', []):
            if p['id'] == pid:
                return dict(p)
        raise Problem('请先在 Codex API 配置中添加并选择接口')

    def public_config(self):
        profiles = [{k: v for k, v in p.items() if k != 'api_key'} | {'has_key': bool(p.get('api_key'))} for p in self.config.get('profiles', [])]
        return {'profiles': profiles, 'default_profile': self.config.get('default_profile'),
                'version': VERSION, 'cli_version': self.config.get('cli_version'),
                'workspace': str(WORKSPACE), 'servers': self.config.get('servers', []),
                'backup': self.config.get('backup', {}), 'max_running': None, 'parallel_windows': True}

    def save_config(self, body):
        with self.lock:
            old = {p['id']: p for p in self.config.get('profiles', [])}
            profiles = body.get('profiles')
            if not isinstance(profiles, list) or len(profiles) > 20 or not profiles:
                raise Problem('请保留 1 到 20 个 API 配置')
            out, ids = [], set()
            for raw in profiles:
                pid = str(raw.get('id') or uuid.uuid4().hex)
                if not re.fullmatch(r'[a-zA-Z0-9_-]{1,80}', pid) or pid in ids:
                    raise Problem('API 配置编号无效或重复')
                ids.add(pid)
                base = str(raw.get('base_url', '')).strip().rstrip('/')
                url = urlsplit(base)
                if url.scheme != 'https' or not url.hostname or url.username or url.password or url.query or url.fragment:
                    raise Problem('API 地址需要使用 HTTPS，且不能包含密码或查询参数')
                model = str(raw.get('model', '')).strip()
                effort = raw.get('effort', 'high')
                if not model or len(model) > 160 or effort not in ('minimal','low','medium','high','xhigh'):
                    raise Problem('请填写有效模型和推理强度')
                key = str(raw.get('api_key', '')).strip() or old.get(pid, {}).get('api_key', '')
                if '\n' in key or len(key) > 8192:
                    raise Problem('API 密钥格式无效')
                out.append({'id': pid, 'name': str(raw.get('name') or 'API')[:80], 'base_url': base,
                            'model': model, 'effort': effort, 'api_key': key})
            for window in self.store.list():
                if window['profile'] not in ids:
                    raise Problem('仍有窗口使用待删除的 API，请先切换或删除这些窗口', 409)
            default = body.get('default_profile') or out[0]['id']
            if default not in ids:
                raise Problem('默认 API 不存在')
            # One small local rollback unit for API configuration edits.
            shutil.copy2(self.config_path, self.config_path.with_name('config.previous.json'))
            updated = dict(self.config, profiles=out, default_profile=default)
            write_json(self.config_path, updated)
            self.config = updated
            for wid, engine in list(self.engines.items()):
                if self.store.one(wid)['status'] not in ACTIVE:
                    engine.close()
                    self.engines.pop(wid, None)
            return self.public_config()

    def engine(self, wid, fresh_config=False):
        if fresh_config and wid in self.engines:
            window = self.store.one(wid)
            if self.engines[wid].profile_fingerprint != json.dumps(self.profile(window['profile']), sort_keys=True):
                self.engines.pop(wid).close()
        if wid not in self.engines:
            # Unload idle processes, preserving their persisted Codex sessions.
            for other, engine in list(self.engines.items()):
                if len(self.engines) < 4:
                    break
                if self.store.one(other)['status'] not in ACTIVE:
                    engine.close()
                    self.engines.pop(other, None)
            window = self.store.one(wid)
            engine = self.engine_factory(self, wid, self.profile(window['profile']))
            self.engines[wid] = engine
            if window['thread_id']:
                engine.rpc('thread/resume', {'threadId': window['thread_id'], 'cwd': window['cwd'],
                                            'approvalPolicy': 'never', 'sandbox': 'danger-full-access'})
        return self.engines[wid]

    def create(self, body):
        with self.lock:
            request_id = request_key(body)
            with self.store.lock:
                prior = self.store.db.execute('SELECT id FROM windows WHERE create_key=?', (request_id,)).fetchone()
            if prior:
                return self.store.one(prior['id'])
            if len(self.store.list()) >= 100:
                raise Problem('已达到 100 个窗口，请先删除不再需要的窗口')
            profile = self.profile(body.get('profile'))
            wid = uuid.uuid4().hex
            cwd = str(WORKSPACE)
            now = time.time()
            with self.store.lock:
                self.store.db.execute('INSERT INTO windows(id,create_key,title,profile,cwd,status,created,updated) VALUES(?,?,?,?,?,?,?,?)',
                                      (wid, request_id, str(body.get('title') or '新任务')[:100], profile['id'], cwd, 'opening', now, now))
                self.store.db.commit()
            try:
                engine = self.engine(wid)
                value = engine.rpc('thread/start', {'cwd': cwd, 'model': profile['model'],
                                                   'approvalPolicy': 'never', 'sandbox': 'danger-full-access'})
                tid = value['thread']['id']
                self.store.update(wid, thread_id=tid, status='idle')
                engine.rpc('thread/name/set', {'threadId': tid, 'name': self.store.one(wid)['title']})
            except Exception as exc:
                self.failed(wid, str(exc))
                raise
            return self.store.one(wid)

    def submit(self, wid, body):
        with self.lock, self.store.lock:
            key = request_key(body)
            old = self.store.db.execute('SELECT * FROM tasks WHERE request_id=?', (key,)).fetchone()
            if old:
                if old['window_id'] != wid:
                    raise Problem('请求编号已用于另一个窗口', 409)
                return {'accepted': True, 'task': dict(old), 'window': self.store.one(wid)}
            window = self.store.one(wid)
            if window['status'] == 'closed':
                raise Problem('请先重新打开窗口', 409)
            if window['status'] in ACTIVE:
                raise Problem('该窗口已有任务；可补充指令，或先停止当前任务', 409)
            if not window['thread_id']:
                raise Problem('窗口创建未完成，请删除后重新新建', 409)
            if not self.profile(window['profile']).get('api_key'):
                raise Problem('该 API 尚未设置密钥')
            text = str(body.get('text', '')).strip()
            if not text or len(text) > 60000:
                raise Problem('任务内容需为 1 到 60000 个字符')
            self.store.db.execute('INSERT INTO tasks VALUES(?,?,?,?,?,?)', (key, wid, text, 'queued', time.time(), ''))
            self.store.db.commit()
            self.store.item(wid, 'user:'+key, 'userMessage', self.redact(text))
            self.store.update(wid, status='queued', error='')
            if is_any(self.profile(window['profile'])):
                self.any_retries[wid] = AnyRetry(key)
            return {'accepted': True, 'request_id': key, 'window': self.store.one(wid)}

    def finish(self, wid, status, error=''):
        with self.store.lock:
            self.any_retries.pop(wid, None)
            self.store.db.execute("UPDATE tasks SET status=? WHERE window_id=? AND status IN ('queued','starting','running','waiting')", (status, wid))
            self.store.db.commit()
            self.store.update(wid, status=status, error=self.redact(error), turn_id='')

    def failed(self, wid, error):
        try:
            self.finish(wid, 'failed', error)
        except Exception:
            pass

    def log_problem(self, wid, text):
        with self.store.lock:
            if wid in self.any_retries and retryable(text):
                return  # The single counter owns transient ANY diagnostics.
        self.store.item(wid, 'diagnostic', 'warning', self.redact(text))

    def schedule_any_retry(self, wid, turn):
        with self.store.lock:
            run = self.any_retries.get(wid)
            if not run or turn.get('status') != 'failed' or not retryable(turn.get('error') or {}):
                return False
            if run.pending:
                return True  # Duplicate completion cannot reset the delay.
            task = self.store.db.execute('SELECT status FROM tasks WHERE request_id=?', (run.request_id,)).fetchone()
            if not task or task['status'] not in ('starting', 'running', 'waiting'):
                return False
            run.schedule()
            self.store.db.execute("UPDATE tasks SET status='queued',turn_id='' WHERE request_id=?", (run.request_id,))
            self.store.db.commit()
            self.store.update(wid, status='queued', turn_id='', error='')
            self.store.item(wid, 'any-retry:'+run.request_id, 'warning', run.text)
            return True

    def pump(self):
        while not self.quit.wait(.35):
            try:
                with self.lock:
                    # Each window owns an engine and an active turn. Other windows,
                    # including those awaiting user input, must not block this one.
                    with self.store.lock:
                        queued = self.store.db.execute("SELECT * FROM tasks WHERE status='queued' ORDER BY created").fetchall()
                        task = next((t for t in queued if t['window_id'] not in self.any_retries
                                     or self.any_retries[t['window_id']].ready()), None)
                        if not task:
                            continue
                        task = dict(task)
                        run = self.any_retries.get(task['window_id'])
                        if run:
                            run.starting()
                            if run.count:
                                task['text'] = CONTINUE_TASK
                                self.store.item(task['window_id'], 'any-retry:'+run.request_id, 'warning', run.text)
                        self.store.db.execute("UPDATE tasks SET status='starting' WHERE request_id=?", (task['request_id'],))
                        self.store.db.commit()
                    wid = task['window_id']
                    self.store.update(wid, status='starting')
                    try:
                        window = self.store.one(wid)
                        engine = self.engine(wid, fresh_config=True)
                        profile = self.profile(window['profile'])
                        response = engine.rpc('turn/start', {'threadId': window['thread_id'],
                                             'input': [{'type': 'text', 'text': task['text']}],
                                             'model': profile['model'], 'effort': profile.get('effort', 'high')})
                        turn_id = response['turn']['id']
                        with self.store.lock:
                            self.store.db.execute("UPDATE tasks SET turn_id=?,status=CASE WHEN status='starting' THEN 'running' ELSE status END WHERE request_id=?", (turn_id, task['request_id']))
                            self.store.db.commit()
                        if self.store.one(wid)['status'] == 'starting':
                            self.store.update(wid, status='running', turn_id=turn_id)
                    except Exception as exc:
                        # An ambiguous timeout must not start a second task while the old engine runs.
                        engine = self.engines.pop(wid, None)
                        if engine:
                            engine.close()
                        self.failed(wid, str(exc))
            except Exception:
                continue

    def event(self, engine, event):
        if getattr(engine, 'stopping', False):
            return  # Buffered notifications must not reopen a window being stopped.
        method, p = event.get('method', ''), self.clean(event.get('params', {}))
        wid = engine.wid
        if method == 'turn/started':
            self.store.update(wid, status='running', turn_id=p['turn']['id'])
        elif method == 'turn/completed':
            turn = p['turn']
            with self.store.lock:
                if turn.get('id') == getattr(engine, 'last_completed_turn_id', None):
                    return
                window = self.store.one(wid)
                if window['turn_id'] and window['turn_id'] != turn.get('id'):
                    return  # Ignore an old turn after the next attempt has started.
                engine.last_completed_turn_id = turn.get('id')
                if not self.schedule_any_retry(wid, turn):
                    self.finish(wid, {'completed':'completed','interrupted':'interrupted','failed':'failed'}.get(turn['status'], 'failed'),
                                str((turn.get('error') or {}).get('message', '')))
            for rid in list(engine.requests):
                self.store.item(wid, 'request:'+rid, 'resolved', '该请求已结束')
            engine.requests.clear()
        elif method in ('item/started','item/completed'):
            item = p['item']
            kind = item['type']
            if kind == 'userMessage':
                return  # The idempotent submit record owns user input in this view.
            if kind == 'reasoning':
                text = '\n'.join(item.get('summary') or [])
                item = {'type': kind, 'id': item['id'], 'status': 'completed' if method.endswith('completed') else 'running'}
            elif kind in ('agentMessage','plan'):
                text = item.get('text', '')
            elif kind == 'commandExecution':
                text = item.get('aggregatedOutput') or ''
            elif kind == 'fileChange':
                text = '\n\n'.join(c.get('path','')+'\n'+c.get('diff','') for c in item.get('changes',[]))
            else:
                text = json.dumps(item, ensure_ascii=False)
            if len(json.dumps(item)) > 300000:
                item = {'id':item['id'], 'type':kind, 'status':item.get('status'), 'command':item.get('command','')}
            self.store.item(wid, item['id'], kind, text, item)
        elif method in ('item/agentMessage/delta','item/plan/delta','item/commandExecution/outputDelta','item/reasoning/summaryTextDelta'):
            kind = {'item/agentMessage/delta':'agentMessage','item/plan/delta':'plan',
                    'item/commandExecution/outputDelta':'commandExecution','item/reasoning/summaryTextDelta':'reasoning'}[method]
            iid = p['itemId']
            with self.store.lock:
                old = self.store.db.execute('SELECT data FROM items WHERE window_id=? AND id=?',(wid,iid)).fetchone()
            data = json.loads(old['data']) if old else {}
            self.store.item(wid, iid, kind, p.get('delta',''), data, append=True)
        elif method == 'turn/plan/updated':
            self.store.item(wid, 'plan:'+p.get('turnId',''), 'plan', '\n'.join(x['status']+' · '+x['step'] for x in p.get('plan', [])), p)
        elif method == 'turn/diff/updated':
            self.store.item(wid, 'diff:'+p.get('turnId',''), 'diff', p.get('diff',''))
        elif method == 'thread/tokenUsage/updated':
            self.store.update(wid, usage=json.dumps(p.get('tokenUsage', {})))
        elif method in ('warning','error','configWarning'):
            self.log_problem(wid, p.get('message') or p.get('summary') or str(p.get('error', p)))
        elif method == 'serverRequest/resolved':
            rid = str(p.get('requestId'))
            engine.requests.pop(rid, None)
            self.store.item(wid, 'request:'+rid, 'resolved', '已处理')

    def action(self, wid, action, body):
        with self.lock:
            window = self.store.one(wid)
            if action in ('stop','close','delete'):
                with self.store.lock:
                    self.any_retries.pop(wid, None)
                engine = self.engines.get(wid)
                if engine:
                    engine.stopping = True
                if engine and window.get('turn_id'):
                    try:
                        engine.rpc('turn/interrupt', {'threadId':window['thread_id'], 'turnId':window['turn_id']}, timeout=8)
                    except Exception:
                        pass
                if engine:
                    for rid in list(engine.requests):
                        self.store.item(wid, 'request:'+rid, 'resolved', '任务已停止')
                    engine.close()
                    self.engines.pop(wid, None)
                with self.store.lock:
                    self.store.db.execute("UPDATE tasks SET status='interrupted' WHERE window_id=? AND status IN ('queued','starting','running','waiting')", (wid,))
                    self.store.db.commit()
                self.store.update(wid, status='closed' if action=='close' else 'interrupted', turn_id='', error='')
                if action == 'delete':
                    # Each CK window has its own CODEX_HOME. Native delete plus directory
                    # removal clears persisted rollouts, per-window state and temporary files.
                    if window['thread_id']:
                        deletion = self.engine_factory(self, wid, self.profile(window['profile']))
                        try:
                            deletion.rpc('thread/delete', {'threadId': window['thread_id']})
                        except Problem as exc:
                            if not any(x in str(exc).lower() for x in ('not found','no rollout','does not exist','no persisted')):
                                raise
                        finally:
                            deletion.close()
                    path = self.window_home(wid).parent.resolve()
                    if path.parent != (self.root / 'windows').resolve():
                        raise Problem('窗口目录校验失败')
                    if path.exists():
                        shutil.rmtree(path)
                    with self.store.lock:
                        self.store.db.execute('DELETE FROM windows WHERE id=?', (wid,))
                        self.store.db.commit()
                    return {'deleted': True, 'id': wid}
            elif action == 'reopen':
                if window['status'] in ACTIVE:
                    raise Problem('窗口正在执行', 409)
                self.engine(wid)
                self.store.update(wid, status='idle', error='')
            elif action == 'rename':
                title = str(body.get('title','')).strip()[:100]
                if not title:
                    raise Problem('窗口名称不能为空')
                self.engine(wid).rpc('thread/name/set', {'threadId':window['thread_id'], 'name':title})
                self.store.update(wid, title=title)
            elif action == 'profile':
                if window['status'] in ACTIVE:
                    raise Problem('停止当前任务后再切换 API', 409)
                profile = self.profile(body.get('profile'))
                engine = self.engines.pop(wid, None)
                if engine:
                    engine.close()
                self.store.update(wid, profile=profile['id'])
            elif action == 'steer':
                if window['status'] != 'running' or not window['turn_id']:
                    raise Problem('只有正在运行的任务可以追加指令', 409)
                text = str(body.get('text','')).strip()
                if not text or len(text)>60000:
                    raise Problem('请填写有效补充指令')
                key = request_key(body)
                with self.store.lock:
                    exists = self.store.db.execute('SELECT 1 FROM items WHERE window_id=? AND id=?',(wid,'steer:'+key)).fetchone()
                if not exists:
                    # Store first: a disconnected client must never automatically steer twice.
                    self.store.item(wid, 'steer:'+key, 'userMessage', text, {'status':'sending'})
                    self.engine(wid).rpc('turn/steer', {'threadId':window['thread_id'], 'expectedTurnId':window['turn_id'], 'input':[{'type':'text','text':text}]})
                    self.store.item(wid, 'steer:'+key, 'userMessage', text, {'status':'sent'})
            elif action == 'answer':
                engine = self.engines.get(wid)
                rid = str(body.get('request_id'))
                event = engine.requests.get(rid) if engine else None
                if not event:
                    raise Problem('该问题已结束或已处理，请刷新', 409)
                method = event['method']
                if method == 'item/tool/requestUserInput':
                    answers = body.get('answers') or {}
                    questions = event['params'].get('questions', [])
                    if any(not str(answers.get(q['id'],'')).strip() for q in questions):
                        raise Problem('请回答所有问题')
                    result = {'answers':{q['id']:{'answers':[str(answers[q['id']])[:10000]]} for q in questions}}
                elif method in ('item/commandExecution/requestApproval','item/fileChange/requestApproval'):
                    decision = body.get('decision')
                    if decision not in ('accept','decline','cancel'):
                        raise Problem('无效的确认操作')
                    result = {'decision':decision}
                else:
                    raise Problem('此类请求暂不支持在面板处理，请停止任务后调整指令')
                engine.send({'id':event['id'], 'result':result})
                engine.requests.pop(rid, None)
                self.store.item(wid,'request:'+rid,'resolved','已回复')
                self.store.update(wid,status='running')
            else:
                raise Problem('未知操作', 404)
            return self.store.one(wid)

    def models(self, pid):
        profile = self.profile(pid)
        if not profile.get('api_key'):
            raise Problem('请先保存 API 密钥')
        req = Request(profile['base_url']+'/models', headers={'Authorization':'Bearer '+profile['api_key'], 'Accept':'application/json'})
        try:
            with urlopen(req, timeout=25) as response:
                value = json.loads(response.read(2_000_000))
        except HTTPError as exc:
            raise Problem('模型列表请求失败，HTTP '+str(exc.code)+'；可直接填写供应商支持的模型名。', 502)
        except Exception:
            raise Problem('暂时无法获取模型列表；可直接填写供应商支持的模型名。', 502)
        return {'models': sorted({str(x['id']) for x in value.get('data',[]) if isinstance(x,dict) and x.get('id')})}

    def shutdown(self):
        self.quit.set()
        with self.lock:
            for engine in list(self.engines.values()):
                engine.close()
            self.engines.clear()


def request_key(body):
    key = str(body.get('request_id',''))
    if not re.fullmatch(r'[a-zA-Z0-9_-]{8,100}', key):
        raise Problem('缺少有效请求编号')
    return key


class Handler(BaseHTTPRequestHandler):
    protocol_version = 'HTTP/1.1'
    manager = None

    def log_message(self, *_):
        pass  # Never put URLs, prompts or credentials in the system journal.

    def reply(self, code, body):
        raw = json.dumps(body, ensure_ascii=False).encode()
        self.send_response(code)
        origin = self.headers.get('Origin','')
        if origin in ORIGINS:
            self.send_header('Access-Control-Allow-Origin', origin)
            self.send_header('Vary','Origin')
        self.send_header('Access-Control-Allow-Headers','Content-Type, Authorization, X-API-Key')
        self.send_header('Access-Control-Allow-Methods','GET, POST, OPTIONS')
        self.send_header('Cache-Control','no-store')
        self.send_header('X-Content-Type-Options','nosniff')
        self.send_header('Content-Type','application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def auth(self):
        origin = self.headers.get('Origin','')
        if origin and origin not in ORIGINS:
            raise Problem('访问来源不受支持',403)
        raw = self.headers.get('Authorization','')
        key = raw[7:] if raw.startswith('Bearer ') else self.headers.get('X-API-Key','')
        expected = self.manager.config.get('access_hash','')
        if not expected or not hmac.compare_digest(hashlib.sha256(key.encode()).hexdigest(),expected):
            raise Problem('请填写 Codex 专用访问密钥',401)

    def do_OPTIONS(self):
        if self.headers.get('Origin','') not in ORIGINS:
            self.reply(403, {'error':'访问来源不受支持'})
        else:
            self.reply(200,{})

    def handle_request(self):
        try:
            path = urlsplit(self.path)
            parts = path.path.strip('/').split('/')
            if self.command=='GET' and path.path=='/health':
                return self.reply(200, {'ok':True,'service':'ck-codex','version':VERSION})
            self.auth()
            body = {}
            if self.command=='POST':
                size = int(self.headers.get('Content-Length','0'))
                if not 0 < size <= 1_000_000:
                    raise Problem('请求大小无效',413)
                body = json.loads(self.rfile.read(size))
                if not isinstance(body,dict):
                    raise Problem('请求格式无效')
            if path.path=='/config':
                result = self.manager.save_config(body) if self.command=='POST' else self.manager.public_config()
            elif path.path=='/models' and self.command=='POST':
                result = self.manager.models(body.get('profile'))
            elif path.path=='/threads':
                result = self.manager.create(body) if self.command=='POST' else {'windows':self.manager.store.list()}
            elif len(parts)>=2 and parts[0]=='threads':
                wid = parts[1]
                if self.command=='GET' and len(parts)==2:
                    after = max(0,int(parse_qs(path.query).get('after',['0'])[0]))
                    result = self.manager.store.snapshot(wid,after)
                elif self.command=='POST' and len(parts)==3:
                    result = self.manager.submit(wid,body) if parts[2]=='send' else self.manager.action(wid,parts[2],body)
                else:
                    raise Problem('接口不存在',404)
            else:
                raise Problem('接口不存在',404)
            self.reply(200, self.manager.clean(result))
        except Problem as exc:
            self.reply(exc.status, {'error':str(exc)})
        except (ValueError, KeyError, TypeError):
            self.reply(400, {'error':'请求字段无效，请刷新后重试'})
        except (BrokenPipeError,ConnectionResetError):
            pass
        except Exception as exc:
            self.reply(500, {'error':self.manager.redact(str(exc))[:1000]})

    do_GET = handle_request
    do_POST = handle_request


if __name__ == '__main__':
    os.umask(0o077)
    Handler.manager = Manager()
    server = ThreadingHTTPServer(('127.0.0.1', int(os.environ.get('CK_CODEX_PORT','19007'))),Handler)
    server.daemon_threads = True
    def stop(*_):
        Handler.manager.shutdown()
        threading.Thread(target=server.shutdown, daemon=True).start()
    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)
    server.serve_forever()
