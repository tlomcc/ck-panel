"""Regression: racing must not turn a structured upstream error into silent EOF."""
import json
import os
from pathlib import Path
import sys
import tempfile
import threading
import time
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

SOURCE = Path(os.environ.get('CK_CODEX_TEST_SOURCE', str(Path(__file__).parents[1] / 'codex-service')))
sys.path.insert(0, str(SOURCE))
import service
import any_race


def event(kind, **fields):
    return b'data: ' + json.dumps({'type': kind, **fields}).encode() + b'\n\n'


def exercise():
    with tempfile.TemporaryDirectory(prefix='ck-any-parallel-error-') as directory:
        root = Path(directory)
        workspace = root / 'workspace'
        workspace.mkdir()
        original_workspace, original_failure = service.WORKSPACE, any_race.Batch.failure
        service.WORKSPACE = workspace
        requests, failures, errors = [], [], []
        lock, barrier = threading.Lock(), threading.Barrier(5)

        def observe_failure(batch, index, code, content_type, raw, label):
            kinds = [json.loads(line[5:]).get('type') for line in raw.splitlines() if line.startswith(b'data:')]
            with lock:
                failures.append(kinds)
            return original_failure(batch, index, code, content_type, raw, label)

        any_race.Batch.failure = observe_failure

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *_):
                pass

            def do_POST(self):
                try:
                    self.rfile.read(int(self.headers['Content-Length']))
                    with lock:
                        requests.append(1)
                        number = len(requests)
                    barrier.wait(8)
                    self.send_response(200)
                    self.send_header('Content-Type', 'text/event-stream')
                    self.end_headers()
                    payload = event('response.created', response={'id': 'fixture', 'status': 'in_progress', 'output': []})
                    if number <= 5:
                        error = {'code': 'rate_limit_exceeded', 'message': 'fixture rate limit exceeded'}
                        payload += event('error', **error)
                        payload += event('response.failed', response={'id': 'fixture', 'status': 'failed', 'error': error})
                    else:
                        item = {'id': 'message-fixture', 'type': 'message', 'role': 'assistant', 'status': 'completed',
                                'content': [{'type': 'output_text', 'text': 'fixture recovered', 'annotations': []}]}
                        payload += event('response.output_item.added', output_index=0, item=dict(item, content=[]))
                        payload += event('response.output_text.delta', item_id=item['id'], output_index=0,
                                         content_index=0, delta='fixture recovered')
                        payload += event('response.output_item.done', output_index=0, item=item)
                        payload += event('response.completed', response={'id': 'fixture', 'status': 'completed',
                            'output': [item], 'usage': {'input_tokens': 1, 'output_tokens': 1, 'total_tokens': 2}})
                    self.wfile.write(payload)
                    self.wfile.flush()
                except (BrokenPipeError, ConnectionResetError):
                    pass
                except Exception as exc:
                    errors.append(type(exc).__name__)

        server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        server.daemon_threads = True
        threading.Thread(target=server.serve_forever, daemon=True).start()
        profile = {'id': service.ANY_PROFILE_ID, 'name': 'fixture',
                   'base_url': 'http://127.0.0.1:' + str(server.server_port) + '/v1',
                   'api_key': 'fixture-only', 'model': 'gpt-5.4', 'effort': 'high'}
        service.write_json(root / 'config.json', {'profiles': [profile], 'default_profile': profile['id'],
            'any_parallel_enabled': True, 'any_parallel_count': 5,
            'any_retry_mode': 'limited', 'any_retry_limit': 1, 'any_auto_retry': True})
        manager = service.Manager(root)
        retries = 0
        try:
            window = manager.create({'request_id': 'parallel-fixture-create'})
            manager.submit(window['id'], {'request_id': 'parallel-fixture-submit', 'text': 'Reply with the fixture result.'})
            deadline = time.monotonic() + 35
            while time.monotonic() < deadline:
                state = manager.store.one(window['id'])['status']
                run = manager.automatic_retries.get(window['id'])
                if run:
                    retries = max(retries, run.count)
                    if run.pending:
                        run.due = 0
                if state in ('completed', 'failed', 'interrupted'):
                    break
                time.sleep(.05)
            snapshot = manager.store.snapshot(window['id'])
            return {'service_version': service.VERSION, 'status': state, 'fixture_errors': errors,
                    'parallel_count': 5, 'fixture_http_requests': len(requests), 'retries': retries,
                    'upstream_sent_event_types': ['response.created', 'error', 'response.failed'],
                    'selected_failure_prefix_types': failures,
                    'native_errors': [item['text'] for item in snapshot['items'] if item['kind'] == 'error'],
                    'recovered': any(item['kind'] == 'agentMessage' and item['text'] == 'fixture recovered'
                                     for item in snapshot['items']),
                    'same_thread': snapshot['window']['thread_id'] == window['thread_id'],
                    'no_real_provider_calls': True}
        finally:
            engines = list(manager.engines.values())
            manager.shutdown()
            for engine in engines:
                for stream in (engine.proc.stdin, engine.proc.stdout, engine.proc.stderr):
                    stream.close()
            manager.store.db.close()
            server.shutdown()
            server.server_close()
            service.WORKSPACE, any_race.Batch.failure = original_workspace, original_failure


class NativeParallelErrors(unittest.TestCase):
    def test_five_rate_limit_streams_preserve_failure_and_resume_once(self):
        result = exercise()
        self.assertEqual(result['fixture_errors'], [])
        self.assertEqual(result['status'], 'completed', result['native_errors'])
        self.assertEqual(result['retries'], 1)
        self.assertEqual(result['fixture_http_requests'], 10)
        self.assertTrue(result['recovered'])
        self.assertTrue(result['same_thread'])
        self.assertEqual(result['selected_failure_prefix_types'], [['response.created', 'error']] * 5)


if __name__ == '__main__':
    if len(sys.argv) == 3 and sys.argv[1] == '--proof':
        result = exercise()
        path = Path(sys.argv[2])
        assert not path.exists()
        path.write_text(json.dumps(result, ensure_ascii=False, indent=2))
        path.chmod(0o600)
        print(json.dumps(result, ensure_ascii=False))
    else:
        unittest.main()
