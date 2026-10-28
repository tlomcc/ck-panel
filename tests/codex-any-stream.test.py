"""ANY stream integrity, safe diagnostics, and bounded task continuation."""
import http.client
import importlib.util
import json
from pathlib import Path
import stat
import sys
import tempfile
import threading
import time
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).parents[1] / 'codex-service'))
from any_race import Batch, RaceProxy
from any_retry import retryable
from any_transport import StreamObservation, write_diagnostic, EVENT_LIMIT
import any_transport


def event(kind, **fields):
    return b'data: ' + json.dumps({'type': kind, **fields}).encode() + b'\n\n'


CREATED = event('response.created', response={'id': 'fixture', 'status': 'in_progress'})
DELTA = event('response.output_text.delta', delta='fixture-private-content')
COMPLETED = event('response.completed', response={'id': 'fixture', 'status': 'completed'})


class Observations(unittest.TestCase):
    def test_split_crlf_multiline_and_utf8_keep_the_complete_event(self):
        data = (b'data: {"type":"response.output_text.delta",\r\n'
                b'data: "delta":"' + '核对'.encode() + b'"}\r\n\r\n'
                + COMPLETED)
        observer = StreamObservation()
        for byte in data:
            observer.feed(bytes([byte]))
            observer.sent(bytes([byte]))
        self.assertEqual(observer.terminal, 'response.completed')
        self.assertEqual(observer.summary()['received_sha256'], observer.summary()['forwarded_sha256'])

    def test_large_unobservable_event_does_not_become_a_false_failure(self):
        observer = StreamObservation()
        observer.feed(b'data: ' + b'x' * (EVENT_LIMIT + 1))
        self.assertTrue(observer.limited)
        self.assertEqual(observer.buffer, b'')

    def test_retry_scope_includes_eof_but_excludes_cancel_auth_and_timeouts(self):
        for message in ('stream disconnected before completion: stream closed before response.completed',
                        'ck_any_upstream_stream_incomplete', 'ck_any_upstream_http_incomplete', '503 overloaded'):
            self.assertTrue(retryable(message), message)
        for message in ('cancelled: stream closed before response.completed',
                        'invalid api key: ck_any_upstream_stream_incomplete',
                        'insufficient_quota: ck_any_upstream_http_incomplete',
                        'ck_any_upstream_idle_timeout', 'ck_any_upstream_connection_error',
                        'The requested item was created under a different Azure OpenAI resource.'):
            self.assertFalse(retryable(message), message)

    def test_metadata_allowlist_permissions_and_rotation(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            value = {'window_id': 'a' * 32, 'endpoint': 'responses', 'http_status': 200,
                     'result': 'ck_any_upstream_stream_incomplete', 'bytes_received': 30,
                     'authorization': 'private-key-fixture', 'body': 'fixture-private-content',
                     'last_event': 'private-key-fixture', 'exception_type': 'private-key-fixture'}
            write_diagnostic(root, value)
            path = root / 'any-transport.jsonl'
            raw = path.read_text()
            self.assertNotIn('private-key-fixture', raw)
            self.assertNotIn('fixture-private-content', raw)
            self.assertEqual(stat.S_IMODE(path.stat().st_mode), 0o600)
            with patch.object(any_transport, 'LOG_LIMIT', len(raw) + 10):
                write_diagnostic(root, value)
            self.assertTrue((root / 'any-transport.previous.jsonl').exists())
            self.assertEqual(len(path.read_text().splitlines()), 1)
            path.unlink()
            untouched = root / 'other'
            untouched.write_text('preserve')
            path.symlink_to(untouched)
            with self.assertRaises(ValueError):
                write_diagnostic(root, value)
            self.assertEqual(untouched.read_text(), 'preserve')


class Transport(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        fixture = self
        self.kind = 'complete'

        class Upstream(BaseHTTPRequestHandler):
            def log_message(self, *_):
                pass

            def do_POST(self):
                self.rfile.read(int(self.headers['Content-Length']))
                self.send_response(200)
                self.send_header('Content-Type', 'application/json' if fixture.kind == 'compact' else 'text/event-stream')
                if fixture.kind == 'chunked':
                    self.send_header('Transfer-Encoding', 'chunked')
                self.end_headers()
                try:
                    if fixture.kind == 'compact':
                        self.wfile.write(b'{"output":[]}')
                    elif fixture.kind == 'chunked':
                        data = CREATED + DELTA
                        self.wfile.write(format(len(data), 'x').encode() + b'\r\n' + data + b'\r\n')
                    elif fixture.kind == 'failed':
                        self.wfile.write(CREATED + event('response.failed', response={
                            'status': 'failed', 'error': {'code': 'insufficient_quota', 'message': 'fixture refusal'}}))
                    elif fixture.kind == 'error_only':
                        self.wfile.write(CREATED + event('error', code='invalid_api_key', message='fixture credential rejected'))
                    elif fixture.kind == 'large':
                        self.wfile.write(event('response.completed', response={
                            'status': 'completed', 'output_text': 'x' * (EVENT_LIMIT + 20)}))
                    else:
                        self.wfile.write(CREATED + DELTA + (COMPLETED if fixture.kind == 'complete' else b''))
                    self.wfile.flush()
                except OSError:
                    pass

        self.server = ThreadingHTTPServer(('127.0.0.1', 0), Upstream)
        self.server.daemon_threads = True
        threading.Thread(target=self.server.serve_forever, daemon=True).start()
        manager = type('FixtureManager', (), {'root': self.root})()
        self.proxy = RaceProxy(manager)
        self.route, _ = self.proxy.register('a' * 32, {
            'base_url': 'http://127.0.0.1:' + str(self.server.server_port) + '/v1',
            'api_key': 'fixture-only'})

    def tearDown(self):
        self.proxy.close()
        self.server.shutdown()
        self.server.server_close()
        self.tmp.cleanup()

    def request(self, suffix='responses'):
        connection = http.client.HTTPConnection('127.0.0.1', self.proxy.server.server_port, timeout=3)
        try:
            connection.request('POST', '/' + self.route + '/' + suffix, b'{}', {'Content-Type': 'application/json'})
            response = connection.getresponse()
            self.assertEqual(response.status, 200)
            body = response.read()
        finally:
            connection.close()
        deadline = time.monotonic() + 2
        path = self.root / 'any-transport.jsonl'
        while not path.exists() and time.monotonic() < deadline:
            time.sleep(.01)
        return body, json.loads(path.read_text().splitlines()[-1])

    def test_complete_stream_is_byte_identical_and_logs_no_content(self):
        body, record = self.request()
        self.assertEqual(body, CREATED + DELTA + COMPLETED)
        self.assertEqual(record['result'], 'complete')
        self.assertFalse(record['diagnostic_emitted'])
        self.assertEqual(record['received_sha256'], record['forwarded_sha256'])
        self.assertNotIn('fixture-private-content', json.dumps(record))

    def test_upstream_eof_is_explained_without_faking_completion(self):
        self.kind = 'eof'
        body, record = self.request()
        self.assertTrue(body.startswith(CREATED + DELTA))
        self.assertIn(b'ck_any_upstream_stream_incomplete', body)
        self.assertNotIn(b'"type": "response.completed"', body)
        self.assertEqual(record['result'], 'ck_any_upstream_stream_incomplete')
        self.assertTrue(record['diagnostic_emitted'])
        self.assertEqual(record['bytes_received'], record['bytes_forwarded'])

    def test_broken_http_frame_has_a_distinct_error(self):
        self.kind = 'chunked'
        body, record = self.request()
        self.assertIn(b'ck_any_upstream_http_incomplete', body)
        self.assertEqual(record['exception_type'], 'IncompleteRead')
        self.assertEqual(record['result'], 'ck_any_upstream_http_incomplete')

    def test_upstream_auth_failure_is_preserved_without_generic_replacement(self):
        self.kind = 'failed'
        body, record = self.request()
        self.assertIn(b'insufficient_quota', body)
        self.assertNotIn(b'ck_any_upstream', body)
        self.assertEqual(record['result'], 'upstream_failed')
        self.assertEqual(record['upstream_error_code'], 'insufficient_quota')
        self.assertFalse(record['diagnostic_emitted'])

    def test_compaction_json_remains_json(self):
        self.kind = 'compact'
        body, record = self.request('responses/compact')
        self.assertEqual(body, b'{"output":[]}')
        self.assertEqual(record['endpoint'], 'responses/compact')
        self.assertEqual(record['result'], 'http_response')

    def test_standalone_upstream_error_is_preserved_and_compatible_with_codex(self):
        self.kind = 'error_only'
        body, record = self.request()
        self.assertTrue(body.startswith(CREATED + event('error', code='invalid_api_key', message='fixture credential rejected')))
        self.assertIn(b'"type": "response.failed"', body)
        self.assertFalse(retryable(body.decode()))
        self.assertEqual(record['result'], 'upstream_failed')
        self.assertEqual(record['upstream_error_code'], 'invalid_api_key')

    def test_oversized_valid_stream_is_forwarded_without_false_failure(self):
        self.kind = 'large'
        body, record = self.request()
        self.assertNotIn(b'ck_any_upstream', body)
        self.assertTrue(record['observation_limited'])
        self.assertFalse(record['diagnostic_emitted'])
        self.assertEqual(record['received_sha256'], record['forwarded_sha256'])

    def test_observer_failure_cannot_truncate_a_healthy_stream(self):
        with patch.object(StreamObservation, 'feed', side_effect=RuntimeError('fixture observer failure')):
            body, record = self.request()
        self.assertEqual(body, CREATED + DELTA + COMPLETED)
        self.assertTrue(record['observation_limited'])
        self.assertFalse(record['diagnostic_emitted'])

    def test_local_read_timeout_is_not_labelled_upstream_eof(self):
        class TimeoutResponse:
            def read1(self, _):
                raise TimeoutError('fixture socket timeout')

        with patch.object(Batch, 'run', return_value=(200, 'text/event-stream', CREATED, TimeoutResponse())):
            body, record = self.request()
        self.assertIn(b'ck_any_upstream_idle_timeout', body)
        self.assertNotIn(b'ck_any_upstream_stream_incomplete', body)
        self.assertEqual(record['result'], 'ck_any_upstream_idle_timeout')
        self.assertFalse(retryable(body.decode()))


spec = importlib.util.spec_from_file_location('eof_lifecycle_fixture', Path(__file__).with_name('codex-any-switch.test.py'))
fixture = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fixture)


class EofLifecycle(unittest.TestCase):
    setUp = fixture.AnySwitch.setUp
    tearDown = fixture.AnySwitch.tearDown
    create = fixture.AnySwitch.create
    start_task = fixture.AnySwitch.start_task
    wait_for = fixture.AnySwitch.wait_for
    complete = fixture.AnySwitch.complete
    eof = 'stream disconnected before completion: stream closed before response.completed'

    def test_eof_respects_the_existing_attempt_cap(self):
        self.m.set_any_retry({'mode': 'limited', 'limit': 1})
        wid, engine = self.start_task()
        self.complete(wid, engine, 'failed', self.eof)
        run = self.m.automatic_retries[wid]
        run.due = 0
        self.wait_for(lambda: run.count == 1 and self.m.store.one(wid)['status'] == 'running')
        self.complete(wid, engine, 'failed', self.eof)
        time.sleep(.4)
        self.assertEqual(self.m.store.one(wid)['status'], 'failed')
        self.assertEqual(sum(method == 'turn/start' for method, _ in engine.calls), 2)

    def test_stop_cancels_pending_eof_resume(self):
        self.m.set_any_retry({'mode': 'limited', 'limit': 5})
        wid, engine = self.start_task()
        self.complete(wid, engine, 'failed', self.eof)
        self.m.action(wid, 'stop', {})
        time.sleep(.4)
        self.assertEqual(self.m.store.one(wid)['status'], 'interrupted')
        self.assertNotIn(wid, self.m.automatic_retries)
        self.assertEqual(sum(method == 'turn/start' for method, _ in engine.calls), 1)


if __name__ == '__main__':
    unittest.main()
