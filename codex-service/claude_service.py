#!/usr/bin/env python3
"""Domestic Claude Code tasks with the existing task center's HTTP contract."""
import hashlib
import json
import os
from pathlib import Path
import re
import signal
import threading
import time
from http.server import ThreadingHTTPServer
from urllib.error import HTTPError
from urllib.parse import urlsplit
from urllib.request import HTTPRedirectHandler, ProxyHandler, Request, build_opener

from service import Manager, Handler, Problem, ACTIVE, ANY_PROFILE_ID, WORKSPACE, request_key
from claude_api_config import EFFORTS, PROXY, api_base, claude_model
from claude_engine import ClaudeEngine
from claude_provider_sync import atomic_json

VERSION = '1.0.0'


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, request, fp, code, msg, headers, newurl):
        raise HTTPError(request.full_url, code, 'Provider redirect refused', headers, fp)


class ClaudeManager(Manager):
    def __init__(self, root=None, engine_factory=ClaudeEngine, start_worker=True, *, test_loopback=False):
        self.test_loopback = test_loopback
        root = root or Path(os.environ.get('CK_CLAUDE_STATE', '/var/lib/ck-claude-tasks'))
        self.options_path = root / 'claude-options.json'
        self.options = json.loads(self.options_path.read_text()) if self.options_path.exists() else {}
        self.loaded_signature = None
        super().__init__(root, engine_factory, start_worker=False)
        self.refresh_config()
        for row in self.store.db.execute("SELECT window_id,id FROM items WHERE kind='request'").fetchall():
            self.store.item(row['window_id'], row['id'], 'resolved', '服务重启，问题已结束；请检查结果后继续')
        if start_worker:
            threading.Thread(target=self.pump, daemon=True).start()

    def refresh_config(self):
        with self.lock:
            stat = self.config_path.stat()
            signature = (stat.st_mtime_ns, stat.st_size)
            if signature == self.loaded_signature:
                return
            value = self.key_store.decode(json.loads(self.config_path.read_text()))
            choices = self.options.get('profiles', {})
            for profile in value['profiles']:
                option = choices.get(profile['id'], {})
                profile['model'] = claude_model(profile, option.get('model'))
                profile['effort'] = option.get('effort', 'high')
                profile['revision'] = hashlib.sha256(json.dumps(
                    [profile.get('revision'), option], sort_keys=True).encode()).hexdigest()
            ids = {p['id'] for p in value['profiles']}
            preferred = self.options.get('default_profile', ANY_PROFILE_ID)
            value['default_profile'] = preferred if preferred in ids else value['profiles'][0]['id']
            value.update(any_retry_mode='off', any_auto_retry=False, any_parallel_enabled=False)
            self.config, self.loaded_signature = value, signature

    def profile(self, pid=None):
        self.refresh_config()
        profile = super().profile(pid)
        api_base(profile['base_url'], test=self.test_loopback)
        return profile

    def window_home(self, wid):
        if not re.fullmatch('[a-f0-9]{32}', wid):
            raise Problem('窗口编号无效')
        return self.root / 'windows' / wid / 'claude'

    def public_config(self):
        self.refresh_config()
        profiles = [{k: v for k, v in p.items() if k != 'api_key'} |
                    {'has_key': bool(p.get('api_key'))} for p in self.config['profiles']]
        return {'profiles': profiles, 'default_profile': self.config['default_profile'],
                'version': VERSION, 'cli_version': '2.1.308', 'engine': 'claude',
                'workspace': str(WORKSPACE), 'parallel_windows': True, 'scheduling': True,
                'key_storage': 'encrypted', 'shared_providers': True, 'efforts': list(EFFORTS),
                'any_retry_switch': False, 'any_retry_controls': False,
                'source_revision': self.config.get('source_revision'),
                'synced_at': self.config.get('synced_at'), 'steer_mode': 'after_response',
                'servers': [{'name': '国内 VPS', 'address': '123.57.175.84',
                             'status': 'Claude Code 任务执行；API 经美国 VPS 代理'}]}

    def save_config(self, body):
        raise Problem('供应商地址和密钥统一在 Codex API 配置中管理', 409)

    def save_profile(self, body, delete=False):
        with self.lock:
            raw = body.get('profile', {})
            profile = self.profile(str(raw.get('id', '')))
            if delete or raw.get('api_key') or any(raw.get(k, profile[k]) != profile[k] for k in ('name', 'base_url')):
                raise Problem('供应商地址和密钥统一在 Codex API 配置中管理', 409)
            if body.get('expected_revision') != profile['revision']:
                raise Problem('此供应商已更新，请刷新后核对再保存', 409)
            requested_model = str(raw.get('model', '')).strip()
            if not requested_model:
                raise Problem('请选择 Claude 模型')
            model = claude_model(profile, requested_model)
            effort = raw.get('effort', 'high')
            if not model.startswith('claude-') or len(model) > 160 or effort not in EFFORTS:
                raise Problem('请选择 Claude 模型和支持的推理强度')
            choices = dict(self.options.get('profiles', {}))
            choices[profile['id']] = {'model': model, 'effort': effort}
            updated = dict(self.options, profiles=choices)
            if body.get('make_default'):
                updated['default_profile'] = profile['id']
            atomic_json(self.options_path, updated)
            self.options = updated
            self.loaded_signature = None
            return self.public_config()

    def set_any_retry(self, body):
        raise Problem('Claude Code 任务不使用 Codex 的自动重试设置', 409)

    def set_any_parallel(self, body):
        raise Problem('Claude Code 任务不使用 Codex 的多开请求设置', 409)

    def submit(self, wid, body):
        with self.lock:
            result = super().submit(wid, body)
            self.automatic_retries.pop(wid, None)
            return result

    def dispatch_due(self):
        super().dispatch_due()
        self.automatic_retries.clear()

    def redact(self, text):
        text = super().redact(text)
        for engine in list(self.engines.values()):
            key = getattr(engine, 'profile', {}).get('api_key')
            if key:
                text = text.replace(key, '[密钥已隐藏]')
        return text

    def models(self, pid, draft=None):
        profile = self.profile(pid)
        draft = draft or {}
        if draft.get('api_key') or draft.get('base_url', profile['base_url']).rstrip('/') != profile['base_url'].rstrip('/'):
            raise Problem('请先在共用供应商配置中保存地址或密钥', 409)
        signature = (pid, profile['base_url'], profile['api_key'])
        saved = self.model_cache.get(signature)
        if saved and not draft.get('refresh') and time.monotonic() - saved[0] < 300:
            return saved[1]
        base = api_base(profile['base_url'], test=self.test_loopback)
        request = Request(base + '/v1/models', headers={
            'Authorization': 'Bearer ' + profile['api_key'], 'x-api-key': profile['api_key'],
            'anthropic-version': '2023-06-01'})
        opener = build_opener(ProxyHandler({} if self.test_loopback else {'http': PROXY, 'https': PROXY}), NoRedirect())
        try:
            with opener.open(request, timeout=20) as response:
                value = json.load(response)
            names = sorted({claude_model(profile, p['id']) for p in value.get('data', [])
                            if isinstance(p, dict) and str(p.get('id', '')).startswith('claude-')})
            result = {'models': names, 'warning': '' if names else '此供应商未公布 Claude 模型，可按供应商说明手动填写'}
            self.model_cache[signature] = (time.monotonic(), result)
            return result
        except HTTPError as exc:
            raise Problem('供应商模型列表返回 HTTP ' + str(exc.code), 502) from None
        except Exception:
            raise Problem('暂时无法经美国代理读取模型列表，请稍后重试', 502) from None

    def action(self, wid, action, body):
        if action == 'steer':
            # Reserve the admission check and queue write together. Otherwise a
            # late steer could leave a misleading "sending" item after the
            # native response had already entered process cleanup.
            with self.lock:
                key = request_key(body)
                with self.store.lock:
                    prior = self.store.db.execute('SELECT data FROM items WHERE window_id=? AND id=?',
                        (wid, 'steer:' + key)).fetchone()
                if prior and json.loads(prior['data']).get('status') == 'sent':
                    return self.store.one(wid)
                engine = self.engines.get(wid)
                if not engine:
                    raise Problem('本轮已结束，请作为下一条任务发送', 409)
                with engine.lock:
                    if not engine.executing or not engine.accepting:
                        raise Problem('本轮已结束，请作为下一条任务发送', 409)
                    return super().action(wid, action, body)
        if action == 'delete':
            # A removed shared supplier must never make its old windows undeletable.
            with self.lock:
                try:
                    self.profile(self.store.one(wid)['profile'])
                except Problem:
                    self.store.update(wid, profile=self.config['default_profile'])
        return super().action(wid, action, body)


class ClaudeHandler(Handler):
    def auth(self):
        self.manager.refresh_config()
        super().auth()

    def handle_request(self):
        if self.command == 'GET' and urlsplit(self.path).path == '/health':
            return self.reply(200, {'ok': True, 'service': 'ck-claude-tasks', 'version': VERSION,
                                    'engine': 'claude', 'region': 'cn', 'api_only': True})
        return super().handle_request()

    do_GET = handle_request
    do_POST = handle_request


if __name__ == '__main__':
    os.umask(0o077)
    ClaudeHandler.manager = ClaudeManager()
    server = ThreadingHTTPServer(('127.0.0.1', int(os.environ.get('CK_CLAUDE_PORT', '19010'))), ClaudeHandler)
    server.daemon_threads = True
    def stop(*_):
        ClaudeHandler.manager.shutdown()
        threading.Thread(target=server.shutdown, daemon=True).start()
    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)
    server.serve_forever()
