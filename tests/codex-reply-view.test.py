import importlib.util
import json
import sqlite3
import sys
import tempfile
import threading
import unittest
from datetime import datetime
from http.server import ThreadingHTTPServer
from pathlib import Path
from unittest.mock import patch
from urllib.error import HTTPError
from urllib.request import Request, urlopen
from zoneinfo import ZoneInfo

sys.path.insert(0, str(Path(__file__).parents[1] / 'codex-service'))
import reply_proxy
import reply_view

spec = importlib.util.spec_from_file_location('fixture_service', Path(__file__).with_name('codex-service.test.py'))
fixture = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fixture)


class View(unittest.TestCase):
    def setUp(self):
        fixture.Lifecycle.setUp(self)
        self.wid = self.m.create({'request_id': 'reply-view-fixture'})['id']
        now = datetime(2026, 10, 21, 13, tzinfo=ZoneInfo('Asia/Shanghai')).timestamp()
        self.m.store.db.execute('UPDATE windows SET created=?,updated=? WHERE id=?', (now, now, self.wid))
        self.m.store.db.commit()
        self.workspace = self.root / 'workspace'
        (self.workspace / 'diary').mkdir(parents=True)
        (self.workspace / 'diary' / '2026-10-21.md').write_text('日记记录，已验证部署。')
        (self.workspace / 'diary' / '2026-10-20.md').write_text('earlier unrelated diary')
        (self.workspace / 'diary' / '2026-10-22.md').write_text('future unrelated diary')

    tearDown = fixture.Lifecycle.tearDown

    def snapshot(self, after=0, diary_cursor=''):
        return reply_view.snapshot(self.m.store.db, self.wid, after, self.workspace, diary_cursor)

    def test_large_code_and_tool_records_never_enter_the_read_view(self):
        db = self.m.store.db
        payload = 'PRIVATE_CODE_AND_TOOL_OUTPUT' * 100000
        for i, kind in enumerate(('commandExecution', 'fileChange', 'diff', 'mcpToolCall', 'dynamicToolCall', 'reasoning', 'plan', 'anyRace')):
            db.execute('INSERT INTO items VALUES (?,?,?,?,?,?,?)', (self.wid, str(i), kind, payload, '{invalid hidden data', i, 1))
        db.commit()
        self.m.store.item(self.wid, 'reply', 'agentMessage', '完成回复', {'phase': 'final_answer', 'toolArgs': payload})
        value = self.snapshot()
        self.assertEqual([i['kind'] for i in value['items']], ['agentMessage', 'diary'])
        self.assertNotIn('PRIVATE_CODE', json.dumps(value))
        self.assertLess(len(json.dumps(value)), 3000)
        self.assertEqual(db.execute('SELECT count(*) FROM items').fetchone()[0], 9)

    def test_offline_delta_recovery_and_diary_updates_use_independent_cursors(self):
        first = self.snapshot()
        self.m.store.item(self.wid, 'reply', 'agentMessage', '完整回复')
        next_value = self.snapshot(first['cursor'], first['diary_cursor'])
        self.assertEqual([i['text'] for i in next_value['items']], ['完整回复'])
        self.assertEqual(self.snapshot(next_value['cursor'], next_value['diary_cursor'])['items'], [])
        path = self.workspace / 'diary' / '2026-10-21.md'
        path.write_text('日记记录，追加了本次验证结果。')
        changed = self.snapshot(next_value['cursor'], next_value['diary_cursor'])
        self.assertEqual(changed['cursor'], next_value['cursor'])
        self.assertEqual(changed['items'][0]['kind'], 'diary')
        self.assertIn('追加', changed['items'][0]['text'])
        self.assertNotIn('unrelated', json.dumps(changed))

    def test_approval_questions_keep_options_but_never_send_patches(self):
        event = {'id': 1, 'method': 'item/fileChange/requestApproval',
                 'params': {'reason': '需要你确认', 'changes': 'PRIVATE_PATCH', 'command': 'PRIVATE_COMMAND'}}
        self.m.store.item(self.wid, 'request:1', 'request', '', event)
        self.m.store.item(self.wid, 'request:1', 'resolved', '已回复')
        row = next(i for i in self.snapshot()['items'] if i['id'] == 'request:1')
        self.assertEqual(row['kind'], 'resolved')
        self.assertEqual(row['data']['params'], {'reason': '需要你确认'})
        self.assertEqual(self.m.store.db.execute('SELECT data FROM items').fetchone()[0], json.dumps(event, ensure_ascii=False))

    def test_diary_symlink_cannot_expose_other_files(self):
        path = self.workspace / 'diary' / '2026-10-21.md'
        path.unlink()
        target = self.root / 'private'
        target.write_text('PRIVATE_DATA')
        path.symlink_to(target)
        self.assertEqual(self.snapshot()['items'], [])

    def test_missing_window_does_not_write_or_create_state(self):
        with self.assertRaises(LookupError):
            reply_view.snapshot(self.m.store.db, 'missing')

    def test_http_auth_filter_actions_and_unavailable_reads(self):
        calls = []
        handler = reply_proxy.Handler
        def upstream(instance, method, path, body=None):
            calls.append((method, path, body))
            headers = {'Content-Type': 'application/json', 'Access-Control-Allow-Origin': 'https://tlomcc.github.io'}
            if instance.headers.get('Authorization') != 'Bearer fixture-access':
                return 401, headers, b'{"error":"access required"}'
            return 200, headers, b'{"ok":true}'
        self.m.store.item(self.wid, 'reply', 'agentMessage', '回复含 private-secret-test')
        self.m.store.item(self.wid, 'code', 'fileChange', 'PRIVATE_PATCH')
        server = ThreadingHTTPServer(('127.0.0.1', 0), handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        with patch.object(reply_proxy, 'STATE', self.root), patch.object(reply_proxy, 'WORKSPACE', self.workspace), patch.object(handler, 'upstream', upstream):
            thread.start()
            base = 'http://127.0.0.1:' + str(server.server_address[1])
            try:
                with self.assertRaises(HTTPError) as exc:
                    urlopen(base + '/threads/' + self.wid)
                self.assertEqual(exc.exception.code, 401)
                headers = {'Authorization': 'Bearer fixture-access'}
                with urlopen(Request(base + '/threads/' + self.wid, headers=headers)) as r:
                    value = r.read().decode()
                    self.assertEqual(r.headers['X-CK-Codex-View'], reply_view.OUTPUT_MODE)
                self.assertNotIn('PRIVATE_PATCH', value)
                self.assertNotIn('private-secret-test', value)
                self.assertIn('回复含', value)
                self.assertIn('日记', value)
                body = b'{"request_id":"same-request","text":"append instruction"}'
                with urlopen(Request(base + '/threads/' + self.wid + '/send', headers=headers, data=body)) as r:
                    self.assertEqual(r.status, 200)
                self.assertEqual(calls[-1], ('POST', '/threads/' + self.wid + '/send', body))
                with patch.object(reply_proxy, 'snapshot', side_effect=RuntimeError('broken read')):
                    with self.assertRaises(HTTPError) as exc:
                        urlopen(Request(base + '/threads/' + self.wid, headers=headers))
                    self.assertEqual(exc.exception.code, 503)
                    self.assertNotIn('PRIVATE_PATCH', exc.exception.read().decode())
                self.assertFalse(any(p == '/threads/' + self.wid for _, p, _ in calls))
            finally:
                server.shutdown()
                thread.join(2)
                server.server_close()


if __name__ == '__main__':
    unittest.main()
