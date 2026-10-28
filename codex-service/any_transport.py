"""Observe ANY stream boundaries without retaining prompts, text, or credentials."""
import hashlib
import json
import os
from pathlib import Path
import re
import threading
import time

EVENT_LIMIT = 2 * 1024 * 1024
LOG_LIMIT = 256 * 1024
LOG_LOCK = threading.Lock()
TERMINALS = {'response.completed', 'response.failed', 'response.incomplete', 'error'}
EVENTS = TERMINALS | {'response.created', 'response.in_progress', 'response.output_item.added',
    'response.output_item.done', 'response.output_text.delta', 'response.output_text.done',
    'response.content_part.added', 'response.content_part.done',
    'response.function_call_arguments.delta', 'response.function_call_arguments.done',
    'response.reasoning_summary_text.delta', 'response.reasoning_summary_text.done'}
UPSTREAM_CODES = {'rate_limit_exceeded', 'insufficient_quota', 'server_error',
    'invalid_request_error', 'invalid_api_key', 'permission_denied', 'context_length_exceeded'}
MESSAGES = {
    'ck_any_upstream_stream_incomplete': 'any 上游提前结束响应，未发送 response.completed',
    'ck_any_upstream_http_incomplete': 'any 上游 HTTP 响应传输不完整',
    'ck_any_upstream_idle_timeout': '本机等待 any 上游数据超时',
    'ck_any_upstream_connection_error': '读取 any 上游连接时发生异常',
}


class StreamObservation:
    def __init__(self):
        self.started = time.monotonic()
        self.first_byte_ms = None
        self.received = self.forwarded = 0
        self.received_hash = hashlib.sha256()
        self.forwarded_hash = hashlib.sha256()
        self.buffer = bytearray()
        self.limited = False
        self.terminal = ''
        self.last_event = ''
        self.upstream_code = ''
        self.sequence = -1
        self.response_id = 'ck-any-stream-failed'
        self.upstream_error = None

    def feed(self, data):
        if data and self.first_byte_ms is None:
            self.first_byte_ms = int((time.monotonic() - self.started) * 1000)
        self.received += len(data)
        self.received_hash.update(data)
        if self.limited:
            return
        self.buffer.extend(data)
        while True:
            boundary = re.search(br'\r?\n\r?\n', self.buffer)
            if not boundary:
                if len(self.buffer) > EVENT_LIMIT:
                    self.limited = True
                    self.buffer.clear()
                return
            frame = bytes(self.buffer[:boundary.start()])
            del self.buffer[:boundary.end()]
            if len(frame) > EVENT_LIMIT:
                self.limited = True
                self.buffer.clear()
                return
            data_lines = [line[5:].lstrip(b' ') for line in frame.splitlines()
                          if line.startswith(b'data:')]
            try:
                value = json.loads(b'\n'.join(data_lines)) if data_lines else {}
            except (ValueError, UnicodeError):
                continue
            if not isinstance(value, dict):
                continue
            kind = value.get('type')
            self.last_event = kind if isinstance(kind, str) and kind in EVENTS else 'other'
            sequence = value.get('sequence_number')
            if type(sequence) is int and 0 <= sequence < 2**63 - 1:
                self.sequence = max(self.sequence, sequence)
            response = value.get('response') or {}
            if isinstance(response, dict) and isinstance(response.get('id'), str):
                self.response_id = response['id']
            if isinstance(kind, str) and kind in TERMINALS:
                self.terminal = kind
                response = value.get('response') or {}
                error = value.get('error') or (response.get('error') if isinstance(response, dict) else None) or {}
                code = error.get('code') if isinstance(error, dict) else None
                code = code or value.get('code')
                self.upstream_code = (code if isinstance(code, str) and code in UPSTREAM_CODES
                                      else 'other' if code else '')
                if kind == 'error':
                    message = error.get('message') if isinstance(error, dict) else None
                    message = message or value.get('message')
                    self.upstream_error = {'code': code if isinstance(code, str) else 'server_error',
                                           'message': message if isinstance(message, str) else 'any upstream error'}

    def sent(self, data):
        self.forwarded += len(data)
        self.forwarded_hash.update(data)

    def error_event(self, code):
        return self.failure_event({'code': 'server_error', 'message': MESSAGES[code] + ' [' + code + ']'})

    def failure_event(self, error):
        # Installed Codex ignores a standalone `error` event, but consumes
        # response.failed. Preserve the upstream error; never claim success.
        value = {'type': 'response.failed', 'sequence_number': self.sequence + 1,
                 'response': {'id': self.response_id, 'status': 'failed', 'output': [], 'error': error}}
        return b'\n\nevent: response.failed\ndata: ' + json.dumps(value).encode() + b'\n\n'

    def summary(self):
        return {'bytes_received': self.received, 'bytes_forwarded': self.forwarded,
                'received_sha256': self.received_hash.hexdigest(),
                'forwarded_sha256': self.forwarded_hash.hexdigest(),
                'elapsed_ms': int((time.monotonic() - self.started) * 1000),
                'first_byte_ms': self.first_byte_ms, 'last_event': self.last_event,
                'terminal': self.terminal, 'upstream_error_code': self.upstream_code,
                'observation_limited': self.limited}


def write_diagnostic(root, value):
    """Bounded local metadata log. Unknown keys and arbitrary text are excluded."""
    record = {'at': time.time()}
    for key in ('bytes_received', 'bytes_forwarded', 'elapsed_ms', 'first_byte_ms', 'http_status', 'parallel_count'):
        number = value.get(key)
        if type(number) is int and 0 <= number < 2**63:
            record[key] = number
    for key in ('received_sha256', 'forwarded_sha256', 'window_id'):
        text = value.get(key, '')
        size = 32 if key == 'window_id' else 64
        if isinstance(text, str) and re.fullmatch('[a-f0-9]{' + str(size) + '}', text):
            record[key] = text
    choices = {'endpoint': {'responses', 'responses/compact'},
               'last_event': EVENTS | {'other', ''}, 'terminal': TERMINALS | {''},
               'upstream_error_code': UPSTREAM_CODES | {'other', ''},
               'result': set(MESSAGES) | {'complete', 'upstream_failed', 'http_response',
                    'unobserved_stream_end', 'cancelled', 'downstream_closed', 'setup_failure'},
               'exception_type': {'TimeoutError', 'IncompleteRead', 'RemoteDisconnected',
                    'ConnectionResetError', 'BrokenPipeError', 'SSLError', 'SSLEOFError', 'OSError', 'other', ''}}
    for key, allowed in choices.items():
        text = value.get(key)
        if isinstance(text, str) and text in allowed:
            record[key] = text
    for key in ('observation_limited', 'diagnostic_emitted'):
        if type(value.get(key)) is bool:
            record[key] = value[key]
    raw = (json.dumps(record, separators=(',', ':')) + '\n').encode()
    path = Path(root) / 'any-transport.jsonl'
    previous = path.with_name('any-transport.previous.jsonl')
    with LOG_LOCK:
        if path.is_symlink() or previous.is_symlink():
            raise ValueError('Diagnostic logs must be ordinary files')
        if path.exists() and path.stat().st_size + len(raw) > LOG_LIMIT:
            path.replace(previous)
        fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_APPEND | os.O_NOFOLLOW, 0o600)
        with os.fdopen(fd, 'ab') as stream:
            os.fchmod(stream.fileno(), 0o600)
            stream.write(raw)
