"""Exercise the installed official CLI against a loopback-only mock provider.

Run in a network namespace containing only lo. No account or real provider is used.
"""
import hashlib
import json
import os
from pathlib import Path
import shlex
import sys
import tempfile
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import uuid

sys.path.insert(0, os.environ.get('CK_TASK_SOURCE', str(Path(__file__).parents[1] / 'codex-service')))
import service
from claude_service import ClaudeManager
from key_store import KeyStore


def wait(predicate, label, seconds=30):
    until = time.monotonic() + seconds
    while time.monotonic() < until:
        value = predicate()
        if value:
            return value
        time.sleep(.05)
    raise AssertionError('Timed out: ' + label)


class Provider(BaseHTTPRequestHandler):
    protocol_version = 'HTTP/1.1'
    calls = []
    beta_headers = []
    first_steer = threading.Event()
    cwd = None

    def log_message(self, *_): pass

    def do_GET(self):
        self.json({'data': [{'id': 'claude-opus-4-6'}, {'id': 'unrelated-model'}]})

    def json(self, value):
        raw = json.dumps(value).encode()
        self.send_response(200); self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(raw))); self.end_headers(); self.wfile.write(raw)

    def do_POST(self):
        value = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
        if 'count_tokens' in self.path:
            return self.json({'input_tokens': 100})
        self.calls.append(value)
        self.beta_headers.append(self.headers.get('anthropic-beta', ''))
        messages = value.get('messages') or []
        packed = json.dumps(messages, ensure_ascii=False)
        last = messages[-1].get('content', '') if messages else ''
        last_text = last if isinstance(last, str) else '\n'.join(b.get('text', '') for b in last if b.get('type') == 'text')
        tool_results = [b for b in last if isinstance(b, dict) and b.get('type') == 'tool_result'] if isinstance(last, list) else []
        blocks = [{'type': 'text', 'text': 'FIXTURE_OK'}]
        stop = 'end_turn'
        if 'TOOL_A' in last_text:
            code = "from pathlib import Path; p=Path('counter'); p.write_text(str(int(p.read_text())+1) if p.exists() else '1'); print('TOOL_RESULT_A')"
            blocks = [{'type': 'text', 'text': '正在执行本地验证。'}, {'type': 'tool_use', 'id': 'tool-' + uuid.uuid4().hex,
                      'name': 'Bash', 'input': {'command': 'python3 -c ' + shlex.quote(code), 'description': 'Local fixture'}}]
            stop = 'tool_use'
        elif 'ASK_FIXTURE' in last_text:
            blocks = [{'type': 'tool_use', 'id': 'question-' + uuid.uuid4().hex, 'name': 'AskUserQuestion',
                       'input': {'questions': [{'question': '执行范围？', 'header': '范围', 'multiSelect': False,
                        'options': [{'label': '仅当前', 'description': '只处理当前测试'}, {'label': '全部', 'description': '全部测试'}]}]}}]
            stop = 'tool_use'
        elif 'STOP_FIXTURE' in last_text:
            code = "from pathlib import Path; import time; Path('stop-started').write_text('1'); time.sleep(60); Path('must-not-exist').write_text('bad')"
            blocks = [{'type': 'tool_use', 'id': 'stop-' + uuid.uuid4().hex, 'name': 'Bash',
                       'input': {'command': 'python3 -c ' + shlex.quote(code), 'description': 'Cancellation fixture'}}]
            stop = 'tool_use'
        elif 'STEER_INITIAL' in last_text:
            self.first_steer.set(); time.sleep(1)
            blocks = [{'type': 'text', 'text': 'FIRST_RESPONSE'}]
        elif 'STEER_ADDITION' in last_text:
            assert 'FIRST_RESPONSE' in packed
            blocks = [{'type': 'text', 'text': 'STEER_PRESERVED'}]
        elif 'CONTINUE_B' in last_text:
            assert 'FINAL_A' in packed and 'TOOL_RESULT_A' in packed
            blocks = [{'type': 'text', 'text': 'CONTEXT_B_PRESERVED'}]
        elif 'REOPEN_C' in last_text:
            assert 'CONTEXT_B_PRESERVED' in packed
            blocks = [{'type': 'text', 'text': 'CONTEXT_C_PRESERVED'}]
        elif 'AFTER_STOP' in last_text:
            assert 'STOP_FIXTURE' in packed
            blocks = [{'type': 'text', 'text': 'STOP_CONTEXT_PRESERVED'}]
        elif tool_results:
            blocks = [{'type': 'text', 'text': 'QUESTION_ANSWER_PRESERVED' if '仅当前' in packed else 'FINAL_A'}]
        mid = 'msg_' + uuid.uuid4().hex
        if not value.get('stream'):
            return self.json({'id': mid, 'type': 'message', 'role': 'assistant', 'model': value['model'],
                              'content': blocks, 'stop_reason': stop, 'stop_sequence': None,
                              'usage': {'input_tokens': 100, 'output_tokens': 20}})
        events = [{'type': 'message_start', 'message': {'id': mid, 'type': 'message', 'role': 'assistant',
                   'model': value['model'], 'content': [], 'stop_reason': None, 'stop_sequence': None,
                   'usage': {'input_tokens': 100, 'output_tokens': 0}}}]
        for index, block in enumerate(blocks):
            start = dict(block)
            if block['type'] == 'text':
                start['text'] = ''; delta = {'type': 'text_delta', 'text': block['text']}
            else:
                start['input'] = {}; delta = {'type': 'input_json_delta', 'partial_json': json.dumps(block['input'])}
            events += [{'type': 'content_block_start', 'index': index, 'content_block': start},
                       {'type': 'content_block_delta', 'index': index, 'delta': delta},
                       {'type': 'content_block_stop', 'index': index}]
        events += [{'type': 'message_delta', 'delta': {'stop_reason': stop, 'stop_sequence': None}, 'usage': {'output_tokens': 20}},
                   {'type': 'message_stop'}]
        raw = ''.join('event: ' + e['type'] + '\ndata: ' + json.dumps(e, ensure_ascii=False) + '\n\n' for e in events).encode()
        self.send_response(200); self.send_header('Content-Type', 'text/event-stream')
        self.send_header('Content-Length', str(len(raw))); self.end_headers()
        try: self.wfile.write(raw)
        except (BrokenPipeError, ConnectionResetError): pass


with tempfile.TemporaryDirectory(prefix='cc-native-') as temp:
    folder = Path(temp); cwd = folder / 'cwd'; cwd.mkdir(); Provider.cwd = cwd
    service.WORKSPACE = cwd
    server = ThreadingHTTPServer(('127.0.0.1', 0), Provider)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    state = folder / 'state'; state.mkdir()
    profile = {'id': 'fixture', 'name': 'isolated', 'base_url': 'http://127.0.0.1:' + str(server.server_port),
               'api_key': 'only-a-fixture-key', 'model': 'unused-source-model', 'effort': 'high'}
    service.write_json(state / 'config.json', KeyStore(state).encode({'profiles': [profile],
        'default_profile': 'fixture', 'access_hash': hashlib.sha256(b'fixture').hexdigest()}))
    manager = ClaudeManager(state, test_loopback=True)
    def create(): return manager.create({'request_id': uuid.uuid4().hex})['id']
    def send(wid, text): return manager.submit(wid, {'request_id': uuid.uuid4().hex, 'text': text})
    def finished(wid):
        row = manager.store.one(wid)
        return row if row['status'] in ('completed', 'failed', 'interrupted') else None
    def complete(wid, marker):
        row = wait(lambda: finished(wid), marker)
        assert row['status'] == 'completed', row.get('error')
        items = manager.store.snapshot(wid)['items']
        assert any(i['kind'] == 'agentMessage' and marker in i['text'] and i['data'].get('phase') == 'final_answer' for i in items), items
    checks = []
    selected = set(os.environ.get('CK_NATIVE_CASES', 'lifecycle,steer,question,stop,models,context').split(','))
    try:
        if 'lifecycle' in selected:
            wid = create(); native = manager.store.one(wid)['thread_id']
            send(wid, 'TOOL_A'); complete(wid, 'FINAL_A')
            assert (cwd / 'counter').read_text() == '1'
            checks.append('native tool execution and complete text')
            send(wid, 'CONTINUE_B'); complete(wid, 'CONTEXT_B_PRESERVED')
            assert (cwd / 'counter').read_text() == '1'
            checks.append('new process resumes native context without replaying the command')
            manager.action(wid, 'close', {}); manager.action(wid, 'reopen', {})
            assert manager.store.one(wid)['thread_id'] == native
            send(wid, 'REOPEN_C'); complete(wid, 'CONTEXT_C_PRESERVED')
            checks.append('close and reopen retain the same native session')
            manager.action(wid, 'delete', {})
            assert not manager.window_home(wid).parent.exists()
        if 'steer' in selected:
            steer = create(); send(steer, 'STEER_INITIAL')
            assert Provider.first_steer.wait(20)
            manager.action(steer, 'steer', {'request_id': uuid.uuid4().hex, 'text': 'STEER_ADDITION'})
            complete(steer, 'STEER_PRESERVED')
            assert manager.store.db.execute('SELECT count(*) FROM tasks WHERE window_id=?', (steer,)).fetchone()[0] == 1
            checks.append('additional instructions continue within the same task')
        if 'question' in selected:
            question = create(); send(question, 'ASK_FIXTURE')
            row = wait(lambda: manager.store.one(question) if manager.store.one(question)['status'] in ('waiting','failed','completed') else None, 'question')
            assert row['status'] == 'waiting', row
            rid = next(iter(manager.engines[question].requests))
            manager.action(question, 'answer', {'request_id': rid, 'answers': {'q0': '仅当前'}})
            complete(question, 'QUESTION_ANSWER_PRESERVED')
            checks.append('native question and panel answer')
        if 'stop' in selected:
            stopped = create(); send(stopped, 'STOP_FIXTURE')
            wait(lambda: (cwd / 'stop-started').exists(), 'running tool')
            old = manager.engines[stopped]
            manager.action(stopped, 'stop', {})
            assert not old.executing and not (old.worker and old.worker.is_alive())
            assert not (cwd / 'must-not-exist').exists()
            send(stopped, 'AFTER_STOP'); complete(stopped, 'STOP_CONTEXT_PRESERVED')
            checks.append('stop cancels the native process and preserves resume context')
        if 'models' in selected:
            assert manager.models('fixture')['models'] == ['claude-opus-4-6']
            checks.append('Claude model filtering')
        if 'context' in selected:
            choice = manager.public_config()['profiles'][0]
            manager.save_profile({'profile': dict(choice, model='claude-opus-5-5[1m]'),
                                  'expected_revision': choice['revision']})
            context = create(); send(context, 'CONTEXT_FLAG'); complete(context, 'FIXTURE_OK')
            assert Provider.calls[-1]['model'] == 'claude-opus-5-5', Provider.calls[-1]['model']
            assert 'context-1m-' in Provider.beta_headers[-1], Provider.beta_headers[-1]
            checks.append('native [1m] option reaches the provider as the million-context header')
        print(json.dumps({'ok': True, 'checks': checks, 'mock_requests': len(Provider.calls),
                          'real_provider_requests': 0}, ensure_ascii=False))
    except Exception:
        print(json.dumps({'passed': checks, 'status': [{k: w.get(k) for k in ('id','status','error')} for w in manager.store.list()],
          'last_mock_tool_results': [b for request in Provider.calls[-2:] for m in request.get('messages', [])[-2:]
            for b in (m.get('content', []) if isinstance(m.get('content'), list) else []) if b.get('type') == 'tool_result']}, ensure_ascii=False), flush=True)
        raise
    finally:
        manager.shutdown(); server.shutdown()
