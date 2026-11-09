"""Run only in a loopback-only network namespace with the official CLI and SDK."""
import base64
import ctypes
import hashlib
import json
import os
import socket
from pathlib import Path
import sys
import tempfile
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from unittest.mock import patch
import uuid

assert {name for _, name in socket.if_nameindex()} == {'lo'}, 'Network namespace must contain only lo'
sys.path.insert(0, os.environ.get('CK_TASK_SOURCE', str(Path(__file__).parents[1] / 'codex-service')))
import claude_context
import claude_engine
import service
from claude_service import ClaudeManager
from key_store import KeyStore
from claude_agent_sdk import ClaudeSDKClient


def wait(predicate, label, seconds=55):
    until = time.monotonic() + seconds
    while time.monotonic() < until:
        value = predicate()
        if value:
            return value
        time.sleep(.05)
    raise AssertionError('Timed out: ' + label)


def text_image(path):
    cairo = ctypes.CDLL('libcairo.so.2')
    def call(name, result, args, *values):
        fn = getattr(cairo, name)
        fn.restype, fn.argtypes = result, args
        return fn(*values)
    ptr, num, dbl, string = ctypes.c_void_p, ctypes.c_int, ctypes.c_double, ctypes.c_char_p
    surface = call('cairo_image_surface_create', ptr, [num, num, num], 0, 1000, 180)
    ctx = call('cairo_create', ptr, [ptr], surface)
    call('cairo_set_source_rgb', None, [ptr, dbl, dbl, dbl], ctx, 1, 1, 1)
    call('cairo_paint', None, [ptr], ctx)
    call('cairo_set_source_rgb', None, [ptr, dbl, dbl, dbl], ctx, 0, 0, 0)
    call('cairo_select_font_face', None, [ptr, string, num, num], ctx, b'sans', 0, 0)
    call('cairo_set_font_size', None, [ptr, dbl], ctx, 60)
    call('cairo_move_to', None, [ptr, dbl, dbl], ctx, 35, 110)
    call('cairo_show_text', None, [ptr, string], ctx, b'HELLO WORLD 12345')
    assert call('cairo_surface_write_to_png', num, [ptr, string], surface, str(path).encode()) == 0
    call('cairo_destroy', None, [ptr], ctx)
    call('cairo_surface_destroy', None, [ptr], surface)


def image_count(value):
    if isinstance(value, dict):
        return int(value.get('type') == 'image') + sum(image_count(v) for v in value.values())
    if isinstance(value, list):
        return sum(image_count(v) for v in value)
    return 0


class Provider(BaseHTTPRequestHandler):
    scenario = ''
    requests = []
    compact_calls = 0
    retry_calls = 0
    child_calls = 0
    image = None
    ocr = None
    compact_wait = threading.Event()

    def log_message(self, *_):
        pass

    def reply(self, status, value):
        raw = json.dumps(value).encode()
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(raw)))
        if status == 429:
            self.send_header('Retry-After', '1')
        self.end_headers()
        try:
            self.wfile.write(raw)
        except (BrokenPipeError, ConnectionResetError):
            pass

    def do_POST(self):
        value = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
        if 'count_tokens' in self.path:
            return self.reply(200, {'input_tokens': 1000})
        cls = type(self)
        cls.requests.append(value)
        content = next(m.get('content', '') for m in reversed(value['messages']) if m.get('role') == 'user')
        text = content if isinstance(content, str) else '\n'.join(b.get('text', '') for b in content)
        tool_results = [b for b in content if isinstance(b, dict) and b.get('type') == 'tool_result'] if isinstance(content, list) else []
        compact = 'CRITICAL: Respond with TEXT ONLY' in text
        if cls.scenario == 'LONG_RETRY':
            cls.retry_calls += 1
            return self.reply(429, {'type': 'error', 'error': {'type': 'rate_limit_error', 'message': 'fixture unavailable'}})
        if compact:
            cls.compact_calls += 1
            if cls.scenario == 'FAIL_COMPACT':
                return self.reply(400, {'type': 'error', 'error': {'type': 'invalid_request_error', 'message': 'fixture compact failure'}})
            if cls.scenario == 'TIMEOUT_COMPACT':
                cls.compact_wait.wait(8)
        stop = 'end_turn'
        blocks = [{'type': 'text', 'text': 'SEED_FINISHED'}]
        if compact:
            blocks = [{'type': 'text', 'text': 'Continue the authorized image task. The Read operation was deferred before execution. '
                'The source image remains on disk. Preserve all completed operations and the Any context policy. '
                'Read the requested image once the context gate permits it, then report the result. No earlier writes need replay.'}]
        elif cls.scenario == 'AGENTS' and 'CHILD_' in text and not tool_results:
            cls.child_calls += 1
            blocks = [{'type': 'text', 'text': 'CHILD_FINISHED'}]
        elif tool_results:
            result_text = json.dumps(tool_results, ensure_ascii=False)
            if cls.scenario == 'OCR':
                assert 'HELLO WORLD 12345' in result_text, 'Native Read must receive the real local OCR text'
                assert image_count(tool_results) == 0
            blocks = [{'type': 'text', 'text': cls.scenario + '_FINISHED'}]
        elif cls.scenario == 'AGENTS':
            blocks = [{'type': 'tool_use', 'id': 'agent_' + uuid.uuid4().hex, 'name': 'Agent',
                       'input': {'description': 'Independent fixture ' + label, 'subagent_type': 'general-purpose',
                                 'prompt': 'CHILD_' + label + ': return CHILD_FINISHED without running tools.'}}
                      for label in ('LEFT', 'RIGHT')]
            stop = 'tool_use'
        elif cls.scenario != 'SEED_LONG':
            blocks = [{'type': 'tool_use', 'id': 'read_' + uuid.uuid4().hex, 'name': 'Read',
                       'input': {'file_path': str(cls.ocr if cls.scenario == 'OCR' else cls.image)}}]
            if cls.scenario == 'MULTI_VISION':
                blocks.append({'type': 'tool_use', 'id': 'read_' + uuid.uuid4().hex, 'name': 'Read',
                               'input': {'file_path': str(cls.image)}})
            if cls.scenario == 'MIXED_VISION' and not cls.compact_calls:
                blocks.append({'type': 'tool_use', 'id': 'write_' + uuid.uuid4().hex, 'name': 'Bash',
                    'input': {'command': "python3 -c \"from pathlib import Path; p=Path('mixed-counter'); p.write_text(str(int(p.read_text())+1) if p.exists() else '1')\"",
                              'description': 'Record one local side effect'}})
            stop = 'tool_use'
        tokens = 210000 if cls.scenario == 'SEED_LONG' else (170000 if cls.scenario == 'LARGE_AFTER_COMPACT' and cls.compact_calls else 8000)
        usage = {'input_tokens': 100, 'cache_read_input_tokens': tokens, 'output_tokens': 0}
        mid = 'msg_' + uuid.uuid4().hex
        if not value.get('stream'):
            return self.reply(200, {'id': mid, 'type': 'message', 'role': 'assistant', 'model': value['model'],
                'content': blocks, 'stop_reason': stop, 'stop_sequence': None, 'usage': dict(usage, output_tokens=80)})
        events = [{'type': 'message_start', 'message': {'id': mid, 'type': 'message', 'role': 'assistant',
            'model': value['model'], 'content': [], 'stop_reason': None, 'stop_sequence': None, 'usage': usage}}]
        for index, block in enumerate(blocks):
            start = dict(block)
            if block['type'] == 'text':
                start['text'] = ''
                delta = {'type': 'text_delta', 'text': block['text']}
            else:
                start['input'] = {}
                delta = {'type': 'input_json_delta', 'partial_json': json.dumps(block['input'])}
            events.extend([{'type': 'content_block_start', 'index': index, 'content_block': start},
                           {'type': 'content_block_delta', 'index': index, 'delta': delta},
                           {'type': 'content_block_stop', 'index': index}])
        events.extend([{'type': 'message_delta', 'delta': {'stop_reason': stop, 'stop_sequence': None}, 'usage': {'output_tokens': 80}}, {'type': 'message_stop'}])
        raw = ''.join('event: ' + e['type'] + '\ndata: ' + json.dumps(e) + '\n\n' for e in events).encode()
        self.send_response(200)
        self.send_header('Content-Type', 'text/event-stream')
        self.send_header('Content-Length', str(len(raw)))
        try:
            self.end_headers()
            self.wfile.write(raw)
        except (BrokenPipeError, ConnectionResetError):
            pass


with tempfile.TemporaryDirectory(prefix='cc-context-native-') as temp:
    root = Path(temp)
    cwd = root / 'cwd'
    cwd.mkdir()
    service.WORKSPACE = cwd
    Provider.image, Provider.ocr = cwd / 'diagram.png', cwd / 'text.png'
    Provider.image.write_bytes(base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j8ioAAAAASUVORK5CYII='))
    text_image(Provider.ocr)
    server = ThreadingHTTPServer(('127.0.0.1', 0), Provider)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    state = root / 'state'
    state.mkdir()
    profile = {'id': claude_context.ANY_PROFILE_ID, 'name': 'Any fixture',
               'base_url': 'http://127.0.0.1:' + str(server.server_port), 'api_key': 'fixture-only',
               'model': 'claude-opus-5-5[1m]', 'effort': 'high'}
    service.write_json(state / 'config.json', KeyStore(state).encode({'profiles': [profile],
        'default_profile': profile['id'], 'access_hash': hashlib.sha256(b'fixture').hexdigest()}))
    manager = ClaudeManager(state, test_loopback=True)
    checks = []
    query_kinds = []
    original_query = ClaudeSDKClient.query

    async def counted_query(client, prompt, *args, **kwargs):
        query_kinds.append('compact' if isinstance(prompt, str) and prompt.startswith('/compact') else 'task')
        return await original_query(client, prompt, *args, **kwargs)

    query_patch = patch.object(ClaudeSDKClient, 'query', counted_query)
    query_patch.start()
    last_compact_commands = 0

    def run_case(name, wid=None):
        global last_compact_commands
        Provider.scenario, Provider.compact_calls, Provider.retry_calls, Provider.child_calls = name, 0, 0, 0
        before = len(Provider.requests)
        query_before = len(query_kinds)
        wid = wid or manager.create({'request_id': uuid.uuid4().hex})['id']
        manager.submit(wid, {'request_id': uuid.uuid4().hex, 'text': 'Perform ' + name + ' using the local fixture only.'})
        def done():
            row = manager.store.one(wid)
            return row if row['status'] in ('completed', 'failed', 'interrupted') else None
        row = wait(done, name)
        calls = Provider.requests[before:]
        last_compact_commands = query_kinds[query_before:].count('compact')
        print(json.dumps({'case': name, 'status': row['status'], 'mock_requests': len(calls),
            'compact_commands': last_compact_commands, 'native_compact_requests': Provider.compact_calls,
            'image_blocks_sent': sum(image_count(r) for r in calls)}, ensure_ascii=False), flush=True)
        return wid, row, calls

    try:
        cases = set(os.environ.get('CK_CONTEXT_CASES', 'OCR,VISION,MULTI_VISION,MIXED_VISION,FAIL_COMPACT,LARGE_AFTER_COMPACT,LONG_RETRY,TIMEOUT_COMPACT,AGENTS').split(','))
        if 'OCR' in cases:
            wid, row, calls = run_case('OCR')
            assert row['status'] == 'completed', row['error']
            assert len(calls) == 2 and Provider.compact_calls == 0
            assert not any(image_count(r) for r in calls)
            checks.append('real Tesseract and native Read return text without sending image bytes')
        for name in ('VISION', 'MULTI_VISION'):
            if name not in cases:
                continue
            wid, row, calls = run_case(name)
            assert row['status'] == 'completed', row['error']
            assert Provider.compact_calls == 1 and len(calls) == 4
            assert [image_count(r) for r in calls] == [0, 0, 0, 2 if name == 'MULTI_VISION' else 1]
            checks.append(name + ': deferred images run only after one successful native compaction')
        if 'MIXED_VISION' in cases:
            wid, row, calls = run_case('MIXED_VISION')
            counter = cwd / 'mixed-counter'
            assert not counter.exists() or counter.read_text() == '1', 'A completed side effect must never replay'
            if row['status'] == 'completed':
                assert counter.read_text() == '1' and last_compact_commands == 1
                assert image_count(calls[-1]) == 1
            else:
                assert row['status'] == 'failed' and '并行工具' in row['error']
                assert not any(image_count(r) for r in calls)
            checks.append('mixed image and write batch preserves side effects without replay')
        for name in ('FAIL_COMPACT', 'LARGE_AFTER_COMPACT'):
            if name not in cases:
                continue
            wid, row, calls = run_case(name)
            assert row['status'] == 'failed', row
            assert last_compact_commands == 1 and 1 <= Provider.compact_calls <= 6 and not any(image_count(r) for r in calls)
            assert 'context-handoff-' in row['error']
            handoffs = list(manager.window_home(wid).glob('context-handoff-*.md'))
            assert len(handoffs) == 1 and handoffs[0].stat().st_mode & 0o777 == 0o600
            checks.append(name + ' fails closed with one compaction and a private handoff')
        if 'LONG_RETRY' in cases:
            wid, row, _ = run_case('SEED_LONG')
            assert row['status'] == 'completed'
            wid, row, calls = run_case('LONG_RETRY', wid)
            assert row['status'] == 'failed' and '止损' in row['error'], row
            assert 3 <= Provider.retry_calls <= 4, Provider.retry_calls
            assert manager.store.db.execute('SELECT count(*) FROM tasks WHERE window_id=?', (wid,)).fetchone()[0] == 2
            checks.append('cached input over 200K stops at retry 3 without creating or replaying a task')
        if 'TIMEOUT_COMPACT' in cases:
            with patch.object(claude_context, 'COMPACT_TIMEOUT', .4), patch.object(claude_engine.ClaudeEngine, 'FEEDBACK_INTERVAL', .05):
                wid, row, calls = run_case('TIMEOUT_COMPACT')
                assert row['status'] == 'failed' and '5 分钟' in row['error'], row
                assert not any(image_count(r) for r in calls)
                Provider.compact_wait.set()
                checks.append('compaction watchdog interrupts the native process and preserves a handoff')
        if 'AGENTS' in cases:
            wid, row, calls = run_case('AGENTS')
            assert row['status'] == 'completed', row['error']
            subagents = list((manager.window_home(wid) / 'native' / 'projects').glob('**/subagents/agent-*.jsonl'))
            assert len(subagents) == 2, len(subagents)
            assert Provider.child_calls >= 2, Provider.child_calls
            assert {r['model'] for r in calls} == {'claude-opus-5-5'}
            checks.append('two native subagents run with the current Any model')
        print(json.dumps({'ok': True, 'checks': checks, 'mock_requests': len(Provider.requests), 'real_provider_requests': 0}, ensure_ascii=False), flush=True)
    except Exception:
        print(json.dumps({'passed': checks, 'windows': [{k: w.get(k) for k in ('status', 'error')} for w in manager.store.list()],
            'gate_states': [json.loads(p.read_text()) for p in state.glob('windows/*/claude/native/ck-context/*.json')]}, ensure_ascii=False), flush=True)
        raise
    finally:
        query_patch.stop()
        Provider.compact_wait.set()
        manager.shutdown()
        server.shutdown()
