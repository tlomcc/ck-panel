"""Run the installed Codex CLI against loopback only, including a completed tool."""
import json
from pathlib import Path
import sys
import tempfile
import threading
import time
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

sys.path.insert(0, str(Path(__file__).parents[1] / 'codex-service'))
import service


class NativeStream(unittest.TestCase):
    def test_failed_stream_resumes_same_task_without_repeating_completed_tool(self):
        self.exercise(True)

    def test_disabled_retry_keeps_failure_and_completed_tool(self):
        self.exercise(False)

    def test_standalone_rate_limit_is_reported_and_retried(self):
        self.exercise(True, 'rate_limit_exceeded')

    def test_standalone_auth_error_is_reported_without_retry(self):
        self.exercise(True, 'invalid_api_key')

    def test_rate_limits_exceed_cap_and_preserve_completed_tool(self):
        self.exercise(True, 'rate_limit_exceeded', failures=3, expected_retries=3)

    def test_high_demand_after_tool_stops_at_configured_cap(self):
        self.exercise(True, 'overloaded_error', failures=3, expected_retries=1)

    def exercise(self, retry, upstream_error=None, failures=1, expected_retries=None):
        if expected_retries is None:
            expected_retries = 1 if retry and upstream_error != 'invalid_api_key' else 0
        should_complete = expected_retries >= failures
        with tempfile.TemporaryDirectory(prefix='ck-any-eof-native-') as directory:
            root = Path(directory)
            workspace = root / 'workspace'
            workspace.mkdir()
            marker = workspace / 'completed-operation.txt'
            previous_workspace = service.WORKSPACE
            service.WORKSPACE = workspace
            requests, errors = [], []
            lock = threading.Lock()

            class Handler(BaseHTTPRequestHandler):
                def log_message(self, *_):
                    pass

                def do_POST(self):
                    try:
                        body = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
                        with lock:
                            requests.append(body)
                            number = len(requests)
                        self.send_response(200)
                        self.send_header('Content-Type', 'text/event-stream')
                        self.end_headers()

                        def emit(value):
                            self.wfile.write(b'data: ' + json.dumps(value).encode() + b'\n\n')
                            self.wfile.flush()

                        emit({'type': 'response.created', 'response': {
                            'id': 'response-fixture-' + str(number), 'status': 'in_progress', 'output': []}})
                        if number == 1:
                            names = [tool.get('name') for tool in body.get('tools', [])]
                            assert 'exec_command' in names, 'Fixture requires the installed shell tool'
                            args = json.dumps({'cmd': 'printf once >> ' + str(marker), 'max_output_tokens': 100})
                            item = {'id': 'call-fixture', 'type': 'function_call', 'call_id': 'call-fixture',
                                    'name': 'exec_command', 'arguments': args}
                            emit({'type': 'response.output_item.added', 'output_index': 0,
                                  'item': dict(item, arguments='')})
                            emit({'type': 'response.function_call_arguments.delta', 'item_id': item['id'],
                                  'output_index': 0, 'delta': args})
                        else:
                            text = 'partial fixture answer' if number <= failures + 1 else 'fixture recovered'
                            item = {'id': 'msg-fixture-' + str(number), 'type': 'message', 'role': 'assistant',
                                    'status': 'completed', 'content': [
                                        {'type': 'output_text', 'text': text, 'annotations': []}]}
                            emit({'type': 'response.output_item.added', 'output_index': 0,
                                  'item': dict(item, content=[])})
                            emit({'type': 'response.output_text.delta', 'item_id': item['id'],
                                  'output_index': 0, 'content_index': 0, 'delta': text})
                            if number <= failures + 1:
                                if upstream_error:
                                    emit({'type': 'error', 'code': upstream_error,
                                          'message': 'fixture ' + upstream_error})
                                return  # Deliberately end without a completed response.
                        emit({'type': 'response.output_item.done', 'output_index': 0, 'item': item})
                        emit({'type': 'response.completed', 'response': {
                            'id': 'response-fixture-' + str(number), 'status': 'completed', 'output': [item],
                            'usage': {'input_tokens': 1, 'output_tokens': 1, 'total_tokens': 2}}})
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
                'any_parallel_enabled': False, 'any_retry_mode': 'limited' if retry else 'off',
                'any_retry_limit': 1, 'any_auto_retry': retry})
            manager = service.Manager(root)
            try:
                window = manager.create({'request_id': 'fixture-create', 'title': 'isolated EOF fixture'})
                manager.submit(window['id'], {'request_id': 'fixture-submit',
                    'text': 'Run the fixture operation once, then report completion.'})
                deadline = time.monotonic() + 35
                while time.monotonic() < deadline:
                    status = manager.store.one(window['id'])['status']
                    run = manager.automatic_retries.get(window['id'])
                    if run and run.pending:
                        run.due = 0
                    if status in ('completed', 'failed', 'interrupted'):
                        break
                    time.sleep(.05)
                self.assertEqual(errors, [])
                snapshot = manager.store.snapshot(window['id'])
                self.assertEqual(status, 'completed' if should_complete else 'failed',
                                 [(item['kind'], item['text'][:200]) for item in snapshot['items']
                                  if item['kind'] in ('warning', 'error')])
                self.assertEqual(marker.read_text(), 'once')
                self.assertEqual(len(requests), 2 + expected_retries)
                self.assertEqual(snapshot['window']['thread_id'], window['thread_id'])
                self.assertEqual(manager.store.db.execute('SELECT count(*) FROM tasks').fetchone()[0], 1)
                self.assertEqual(sum(item['kind'] == 'commandExecution' for item in snapshot['items']), 1)
                if not should_complete:
                    self.assertIn(upstream_error or 'ck_any_upstream_stream_incomplete', str(snapshot['items']))
                if expected_retries:
                    self.assertIn(service.CONTINUE_TASK, json.dumps(requests[-1], ensure_ascii=False))
                    self.assertTrue(any(item.get('type') == 'function_call_output'
                                        and item.get('call_id') == 'call-fixture'
                                        for item in requests[-1].get('input', [])))
                log = (root / 'any-transport.jsonl').read_text()
                records = [json.loads(line) for line in log.splitlines()]
                expected = 'upstream_failed' if upstream_error else 'ck_any_upstream_stream_incomplete'
                self.assertEqual(sum(record['result'] == expected for record in records),
                                 min(failures, expected_retries + 1))
                self.assertNotIn('fixture-only', log)
                self.assertNotIn('partial fixture answer', log)
            finally:
                engines = list(manager.engines.values())
                manager.shutdown()
                for engine in engines:
                    for stream in (engine.proc.stdin, engine.proc.stdout, engine.proc.stderr):
                        stream.close()
                manager.store.db.close()
                server.shutdown()
                server.server_close()
                service.WORKSPACE = previous_workspace


if __name__ == '__main__':
    unittest.main()
