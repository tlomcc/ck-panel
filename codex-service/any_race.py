"""ANY request windows share one native task; only the winning stream reaches tools.

Only the first model request of a user turn (or automatic continuation) fans out.
Tool continuations stay on that one stream. No requests or runs survive restart.
"""
import http.client
import json
import secrets
import socket
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlsplit
from any_transport import StreamObservation, write_diagnostic

LIMIT = 2 * 1024 * 1024


def close_connection(conn):
    if not conn:
        return
    try:
        sock = conn.sock or getattr(conn, '_race_sock', None)
        if sock:
            sock.shutdown(socket.SHUT_RDWR)
    except OSError:
        pass
    conn.close()


def meaningful(value):
    kind = value.get('type', '')
    if kind.endswith('.delta'):
        return bool(value.get('delta'))
    if kind in ('response.output_item.added', 'response.output_item.done'):
        item = value.get('item', {})
        return bool((item.get('type') in ('function_call', 'custom_tool_call') and item.get('name'))
                    or item.get('content') or item.get('summary') or item.get('encrypted_content'))
    return kind == 'response.completed' and value.get('response', {}).get('status') == 'completed'


class Batch:
    def __init__(self, profile, body, headers, count, publish=None, path="responses"):
        self.profile, self.body, self.headers = profile, body, headers
        self.path = path
        self.publish = publish or (lambda data: None)
        self.cv = threading.Condition()
        self.cancelled = False
        self.winner = None
        self.result = None
        self.connections = {}
        self.errors = []
        self.rows = [{'number': i+1, 'state': 'requesting'} for i in range(count)]
        self.created = time.time()
        self.revision = 0

    def notify(self):
        with self.cv:
            self.revision += 1
            visible = [self.rows[self.winner-1]] if self.winner else self.rows
            data = {'windows': [dict(row) for row in visible], 'winner': self.winner,
                    'removed_count': len(self.rows)-1 if self.winner else 0,
                    'created': self.created, 'revision': self.revision}
        self.publish(data)

    def allowed(self, i):
        return not self.cancelled and (self.winner is None or self.winner == i+1)

    def cancel(self):
        with self.cv:
            self.cancelled = True
            connections = list(self.connections.values())
            response = self.result[3] if self.result else None
            for row in self.rows:
                if row['state'] == 'requesting':
                    row['state'] = 'cancelled'
            self.cv.notify_all()
        for conn in connections:
            close_connection(conn)
        if response:
            response.close()
        self.notify()

    def select(self, i, response, prefix):
        with self.cv:
            if not self.allowed(i):
                return False
            self.winner = i+1
            result = (response.status, response.getheader('Content-Type', 'text/event-stream'), prefix, response)
            self.rows[i]['state'] = 'winner'
            others = [conn for j, conn in self.connections.items() if i != j]
            for j, row in enumerate(self.rows):
                if i != j and row['state'] == 'requesting':
                    row['state'] = 'cancelled'
        # Disconnect losers before exposing even the first tool call to Codex.
        for conn in others:
            close_connection(conn)
        self.notify()
        with self.cv:
            self.result = result
            self.cv.notify_all()
        return True

    def failure(self, i, code, content_type, raw, label):
        with self.cv:
            if not self.allowed(i):
                return
            self.rows[i].update(state='failed', detail=label)
            self.errors.append((code, content_type, raw, None))
            self.cv.notify_all()
        self.notify()

    def worker(self, i):
        conn = None
        response = None
        keep = False
        try:
            target = urlsplit(self.profile['base_url'])
            # Production config accepts HTTPS only; HTTP is used by isolated fixtures.
            cls = http.client.HTTPSConnection if target.scheme == 'https' else http.client.HTTPConnection
            conn = cls(target.hostname, target.port, timeout=30)
            with self.cv:
                if not self.allowed(i):
                    return
                self.connections[i] = conn
            conn.connect()
            conn._race_sock = conn.sock
            conn.auto_open = 0
            with self.cv:
                if not self.allowed(i):
                    return
            conn.sock.settimeout(180)
            headers = {k: v for k, v in self.headers.items() if k.lower() not in (
                'host', 'authorization', 'content-length', 'connection', 'transfer-encoding',
                'accept-encoding', 'x-api-key', 'api-key', 'upgrade', 'expect')}
            headers.update(Authorization='Bearer '+self.profile['api_key'], **{'Accept-Encoding': 'identity'})
            conn.request('POST', target.path.rstrip('/')+'/'+self.path, body=self.body, headers=headers)
            response = conn.getresponse()
            if len(self.rows) == 1:
                keep = self.select(i, response, b'')
                return
            content_type = response.getheader('Content-Type', '')
            if response.status != 200 or 'text/event-stream' not in content_type.lower():
                raw = response.read(LIMIT)
                self.failure(i, response.status, content_type or 'application/json', raw,
                             'HTTP '+str(response.status) if response.status != 200 else '未返回有效流式响应')
                return
            prefix, event_lines = bytearray(), []
            while len(prefix) < LIMIT:
                line = response.readline(LIMIT-len(prefix)+1)
                with self.cv:
                    if not self.allowed(i):
                        return
                if not line:
                    break
                prefix.extend(line)
                if line.strip():
                    if line.startswith(b'data:'):
                        event_lines.append(line[5:].strip())
                    continue
                try:
                    value = json.loads(b'\n'.join(event_lines)) if event_lines else {}
                except (ValueError, UnicodeError):
                    value = {}
                event_lines = []
                if meaningful(value):
                    keep = self.select(i, response, bytes(prefix))
                    return
                if value.get('type') in ('error', 'response.failed', 'response.incomplete'):
                    self.failure(i, 200, content_type, bytes(prefix), '上游返回失败')
                    return
            self.failure(i, 502, 'application/json', b'{"error":{"message":"ANY stream ended without a valid response"}}', '未收到有效回复')
        except Exception:
            # Ambiguous network errors must not be turned into a retryable HTTP 5xx.
            self.failure(i, 400, 'application/json', b'{"error":{"message":"ANY connection interrupted; inspect progress before continuing"}}', '连接中断，请检查后继续')
        finally:
            if not keep:
                close_connection(conn)
                if response:
                    response.close()

    def run(self):
        self.notify()
        for i in range(len(self.rows)):
            try:
                threading.Thread(target=self.worker, args=(i,), daemon=True).start()
            except RuntimeError:
                self.failure(i, 400, 'application/json', b'{"error":{"message":"Local request capacity exhausted"}}', '本机繁忙，请稍后手动提交')
        with self.cv:
            while not self.cancelled and self.result is None and len(self.errors) != len(self.rows):
                self.cv.wait(.5)
            if self.cancelled:
                return None
            if self.result:
                return self.result
            # A definite auth/permission/invalid request failure takes precedence.
            return next((error for error in self.errors if (400 <= error[0] < 500 and error[0] != 429)
                         or any(word in error[2].lower() for word in (b'unauthorized', b'invalid api key', b'insufficient_quota', b'billing', b'permission denied'))), self.errors[0])


class RaceProxy:
    def __init__(self, manager):
        self.manager = manager
        self.lock = threading.RLock()
        self.routes, self.armed = {}, {}
        proxy = self

        class Handler(BaseHTTPRequestHandler):
            protocol_version = 'HTTP/1.0'

            def log_message(self, *_):
                pass

            def do_POST(self):
                parts = self.path.strip('/').split('/')
                suffix = '/'.join(parts[1:])
                route_id = parts[0] if suffix in ('responses', 'responses/compact') else ''
                with proxy.lock:
                    route = proxy.routes.get(route_id)
                    if route:
                        wid = route['wid']
                        key, count, retry = proxy.armed.pop(wid, ('', 1, 0)) if suffix == 'responses' else ('', 1, 0)
                if not route:
                    self.send_error(404)
                    return
                batch = None
                observation = StreamObservation()
                outcome, exception_type = 'setup_failure', ''
                code, diagnostic_emitted, headers_sent = None, False, False

                def forward(data):
                    try:
                        observation.feed(data)
                    except Exception:
                        observation.limited = True
                        observation.buffer.clear()
                    self.wfile.write(data)
                    self.wfile.flush()
                    observation.sent(data)

                try:
                    size = int(self.headers.get('Content-Length', '0'))
                    if not 0 < size <= 32 * 1024 * 1024:
                        self.send_error(413)
                        return
                    body = self.rfile.read(size)
                    if len(body) != size:
                        return
                    iid = 'any-race:'+key
                    def publish(data):
                        if count <= 1:
                            return
                        data.update(count=count, retry=retry)
                        with proxy.manager.store.lock:
                            old = proxy.manager.store.db.execute('SELECT data FROM items WHERE window_id=? AND id=?', (wid, iid)).fetchone()
                            old_data = json.loads(old['data']) if old else {}
                            if (old_data.get('retry', -1), old_data.get('revision', 0)) > (retry, data['revision']):
                                return
                            proxy.manager.store.item(wid, iid, 'anyRace', '', data)
                    batch = Batch(route['profile'], body, dict(self.headers), count, publish, suffix)
                    with proxy.lock:
                        registered = route_id in proxy.routes
                        if registered:
                            route['batches'].add(batch)
                    if not registered:
                        batch.cancel()
                        return
                    result = batch.run()
                    if result is None:
                        outcome = 'cancelled'
                        return
                    code, content_type, prefix, response = result
                    self.send_response(code)
                    self.send_header('Content-Type', content_type)
                    self.send_header('Cache-Control', 'no-store')
                    self.end_headers()
                    headers_sent = True
                    is_stream = code == 200 and 'text/event-stream' in content_type.lower()
                    forward(prefix)
                    failure = ''
                    if response:
                        while not batch.cancelled:
                            try:
                                chunk = response.read1(65536)
                            except (OSError, http.client.HTTPException) as exc:
                                exception_type = type(exc).__name__
                                if isinstance(exc, TimeoutError):
                                    failure = 'ck_any_upstream_idle_timeout'
                                elif isinstance(exc, http.client.IncompleteRead):
                                    failure = 'ck_any_upstream_http_incomplete'
                                else:
                                    failure = 'ck_any_upstream_connection_error'
                                break
                            if not chunk:
                                break
                            forward(chunk)
                    if batch.cancelled:
                        outcome = 'cancelled'
                    elif is_stream and observation.terminal == 'error' and observation.upstream_error:
                        self.wfile.write(observation.failure_event(observation.upstream_error))
                        self.wfile.flush()
                        diagnostic_emitted = True
                        outcome = 'upstream_failed'
                    elif observation.terminal:
                        outcome = 'complete' if observation.terminal == 'response.completed' else 'upstream_failed'
                    elif is_stream and response and not observation.limited:
                        outcome = failure or 'ck_any_upstream_stream_incomplete'
                        # A failure event explains the source. Never manufacture a
                        # successful completion or substitute another model stream.
                        self.wfile.write(observation.error_event(outcome))
                        self.wfile.flush()
                        diagnostic_emitted = True
                    else:
                        outcome = failure or ('unobserved_stream_end' if is_stream else 'http_response')
                except (OSError, ValueError, http.client.HTTPException) as exc:
                    exception_type = type(exc).__name__
                    outcome = ('cancelled' if batch and batch.cancelled else
                               'downstream_closed' if headers_sent else 'setup_failure')
                finally:
                    root = getattr(proxy.manager, 'root', None)
                    if root:
                        try:
                            write_diagnostic(root, observation.summary() | {
                                'window_id': wid, 'endpoint': suffix, 'http_status': code,
                                'parallel_count': count, 'result': outcome,
                                'exception_type': exception_type,
                                'diagnostic_emitted': diagnostic_emitted})
                        except Exception:
                            pass  # Logging failure cannot break a model stream.
                    if batch:
                        batch.cancel()
                    with proxy.lock:
                        route['batches'].discard(batch)

        self.server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        self.server.daemon_threads = True
        threading.Thread(target=self.server.serve_forever, daemon=True).start()

    def register(self, wid, profile):
        key = secrets.token_hex(24)
        with self.lock:
            self.routes[key] = {'wid': wid, 'profile': dict(profile), 'batches': set()}
        return key, 'http://127.0.0.1:'+str(self.server.server_port)+'/'+key

    def arm(self, wid, key, count, retry=0):
        with self.lock:
            self.armed[wid] = (key, count, retry)

    def unregister(self, key):
        with self.lock:
            route = self.routes.pop(key, None)
            if not route:
                return
            self.armed.pop(route['wid'], None)
            batches = list(route['batches'])
        for batch in batches:
            batch.cancel()

    def close(self):
        for key in list(self.routes):
            self.unregister(key)
        self.server.shutdown()
        self.server.server_close()
