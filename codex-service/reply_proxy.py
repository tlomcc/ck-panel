#!/usr/bin/env python3
"""CK read view; native task execution and authentication stay in the existing service."""
import http.client
import base64
import json
import os
import re
import signal
import sqlite3
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlsplit
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

from reply_view import OUTPUT_MODE, snapshot

VIEW_VERSION = '1.0.0'
STATE = Path(os.environ.get('CK_CODEX_STATE', '/var/lib/ck-codex'))
WORKSPACE = Path(os.environ.get('CK_CODEX_WORKSPACE', '/home/ckcodex/workspace'))


def clean(value):
    # Match the task service's response redaction, using read-only credential access.
    config = json.loads((STATE / 'config.json').read_text('utf-8'))
    keys = []
    for profile in config.get('profiles', []):
        key = profile.get('api_key', '')
        if profile.get('api_key_encrypted'):
            data = base64.b64decode(profile['api_key_encrypted'], validate=True)
            key = AESGCM((STATE / 'provider.key').read_bytes()).decrypt(data[:12], data[12:], profile['id'].encode()).decode()
        if key:
            keys.append(key)
    def redact(item):
        if isinstance(item, str):
            for key in keys:
                item = item.replace(key, '[密钥已隐藏]')
            return re.sub(r'(?i)(Bearer\s+)[^\s"\x27,]+', r'\1[已隐藏]', item)
        if isinstance(item, list):
            return [redact(v) for v in item]
        if isinstance(item, dict):
            return {k: '[已隐藏]' if re.fullmatch(r'(?i)(api_key|apiKey|authorization|password|token|secret)', k)
                    else redact(v) for k, v in item.items()}
        return item
    return redact(value)


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *_):
        pass  # Request headers and user content must not enter service logs.

    def upstream(self, method, path, body=None):
        headers = {key: self.headers[key] for key in ('Authorization', 'X-API-Key', 'Origin', 'Content-Type')
                   if key in self.headers}
        connection = http.client.HTTPConnection('127.0.0.1', 19007, timeout=180)
        try:
            connection.request(method, path, body=body, headers=headers)
            response = connection.getresponse()
            return response.status, dict(response.getheaders()), response.read()
        finally:
            connection.close()

    def reply(self, status, headers, raw):
        self.send_response(status)
        for key, value in headers.items():
            if key.lower() in ('content-type', 'access-control-allow-origin', 'access-control-allow-headers',
                               'access-control-allow-methods', 'vary'):
                self.send_header(key, value)
        self.send_header('Content-Length', str(len(raw)))
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('X-CK-Codex-View', OUTPUT_MODE)
        self.end_headers()
        self.wfile.write(raw)

    def handle_request(self):
        try:
            path = urlsplit(self.path)
            parts = path.path.strip('/').split('/')
            if self.command == 'GET' and len(parts) == 2 and parts[0] == 'threads':
                # Delegate auth to the live service, including its origin and access-key rules.
                status, headers, raw = self.upstream('GET', '/threads')
                if status != 200:
                    return self.reply(status, headers, raw)
                query = parse_qs(path.query)
                after = max(0, int(query.get('after', ['0'])[0]))
                diary_cursor = query.get('diary_cursor', [''])[0]
                if not re.fullmatch(r'[a-f0-9]{32}', parts[1]):
                    raise LookupError('窗口不存在或已删除')
                with sqlite3.connect('file:' + str(STATE / 'tasks.sqlite3') + '?mode=ro', uri=True, timeout=5) as db:
                    db.row_factory = sqlite3.Row
                    db.execute('BEGIN')
                    result = snapshot(db, parts[1], after, WORKSPACE, diary_cursor)
                raw = json.dumps(clean(result), ensure_ascii=False).encode('utf-8')
                return self.reply(200, headers, raw)
            body = None
            if self.command == 'POST':
                size = int(self.headers.get('Content-Length', '0'))
                if not 0 < size <= 1_000_000:
                    return self.reply(413, {'Content-Type': 'application/json'}, b'{"error":"Invalid request size"}')
                body = self.rfile.read(size)
            status, headers, raw = self.upstream(self.command, self.path, body)
            if status == 200 and self.command == 'GET' and path.path in ('/health', '/config'):
                result = json.loads(raw)
                result.update(view_version=VIEW_VERSION, output_mode=OUTPUT_MODE)
                raw = json.dumps(result, ensure_ascii=False).encode('utf-8')
            self.reply(status, headers, raw)
        except (BrokenPipeError, ConnectionResetError):
            pass
        except (ValueError, OverflowError):
            self.reply(400, {'Content-Type': 'application/json'}, json.dumps({'error': '请求字段无效，请刷新核对。'}, ensure_ascii=False).encode())
        except LookupError:
            self.reply(404, {'Content-Type': 'application/json'}, json.dumps({'error': '窗口不存在或已删除'}, ensure_ascii=False).encode())
        except Exception:
            # Failure stays closed; never fall back to returning native tool/code records.
            self.reply(503, {'Content-Type': 'application/json'}, json.dumps({'error': 'Codex 记录暂时读取失败，已保留任务，请稍后刷新。'}, ensure_ascii=False).encode())

    do_GET = handle_request
    do_POST = handle_request
    do_OPTIONS = handle_request


def main():
    server = ThreadingHTTPServer(('127.0.0.1', 19008), Handler)
    server.daemon_threads = True
    def stop(*_):
        threading.Thread(target=server.shutdown, daemon=True).start()
    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)
    try:
        server.serve_forever()
    finally:
        server.server_close()


if __name__ == '__main__':
    main()
