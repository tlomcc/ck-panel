import importlib.util
import json
from pathlib import Path
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('fixtures', Path(__file__).with_name('codex-service.test.py'))
f = importlib.util.module_from_spec(spec)
spec.loader.exec_module(f)


class Recovery(unittest.TestCase):
    create = f.Lifecycle.create

    def setUp(self):
        f.Lifecycle.setUp(self)
        self.wid = self.create()['id']
        self.engine = self.m.engines[self.wid]
        self.m.store.update(self.wid, status='running', turn_id='current')

    tearDown = f.Lifecycle.tearDown

    def emit(self, method, **params):
        self.m.event(self.engine, {'method': method, 'params': {'turnId': 'current', **params}})

    def fail(self):
        self.emit('error', error={'message': 'upstream temporary failure'}, willRetry=True)
        self.assertTrue(self.m.store.one(self.wid)['error'])
        return self.m.store.one(self.wid)['seq']

    def test_execution_resumes_without_assistant_prose_and_updates_both_reads(self):
        events = [
            ('item/reasoning/summaryTextDelta', {'itemId': 'reasoning', 'delta': 'Next step'}),
            ('item/reasoning/textDelta', {'itemId': 'private-reasoning', 'delta': 'native activity'}),
            ('item/commandExecution/outputDelta', {'itemId': 'command', 'delta': 'Check passed'}),
            ('item/plan/delta', {'itemId': 'plan', 'delta': 'Verify deployment'}),
            ('item/started', {'item': {'type': 'commandExecution', 'id': 'cmd', 'command': 'true'}}),
            ('item/completed', {'item': {'type': 'reasoning', 'id': 'reason', 'summary': ['Resume work']}}),
            ('item/completed', {'item': {'type': 'fileChange', 'id': 'file', 'changes': []}}),
            ('item/started', {'item': {'type': 'mcpToolCall', 'id': 'tool'}}),
            ('item/completed', {'item': {'type': 'imageView', 'id': 'image'}}),
            ('turn/plan/updated', {'plan': [{'status': 'inProgress', 'step': 'Verify'}]}),
        ]
        for method, params in events:
            with self.subTest(method=method, params=params):
                cursor = self.fail()
                self.emit(method, **params)
                snapshot = self.m.store.snapshot(self.wid, cursor)
                self.assertGreater(snapshot['cursor'], cursor)
                self.assertEqual(snapshot['window']['error'], '')
                self.assertEqual(snapshot['window']['status'], 'running')
                self.assertEqual(self.m.store.list()[0]['error'], '')
        self.assertEqual(len([i for i in self.m.store.snapshot(self.wid)['items'] if i['kind'] == 'error']), len(events))
        # Native raw reasoning is only a health signal; the UI keeps the summary contract.
        self.assertFalse(any(i['id'] == 'private-reasoning' for i in self.m.store.snapshot(self.wid)['items']))

    def test_user_input_usage_empty_output_and_old_turn_do_not_clear_error(self):
        self.fail()
        events = [
            ('item/started', {'item': {'type': 'userMessage', 'id': 'user'}}),
            ('item/started', {'item': {'type': 'agentMessage', 'id': 'empty', 'text': ''}}),
            ('item/started', {'item': {'type': 'reasoning', 'id': 'empty-reason', 'summary': []}}),
            ('item/reasoning/summaryTextDelta', {'itemId': 'empty-delta', 'delta': ''}),
            ('thread/tokenUsage/updated', {'tokenUsage': {'total': {'totalTokens': 100}}}),
            ('turn/diff/updated', {'diff': 'old accumulated diff'}),
            ('item/reasoning/summaryTextDelta', {'turnId': 'old', 'itemId': 'old', 'delta': 'late'}),
            ('item/agentMessage/delta', {'turnId': 'old', 'itemId': 'old-text', 'delta': 'late'}),
        ]
        for method, params in events:
            with self.subTest(method=method):
                self.emit(method, **params)
                self.assertTrue(self.m.store.one(self.wid)['error'])

    def test_late_old_error_does_not_override_current_recovery(self):
        self.fail()
        self.emit('item/reasoning/summaryTextDelta', itemId='thinking', delta='Recovered')
        self.emit('error', turnId='previous', error={'message': 'late previous error'})
        self.assertEqual(self.m.store.one(self.wid)['error'], '')
        self.emit('error', error={'message': 'new current failure'})
        self.assertEqual(self.m.store.one(self.wid)['error'], 'new current failure')
        self.assertEqual(len([i for i in self.m.store.snapshot(self.wid)['items'] if i['kind'] == 'error']), 3)

    def test_terminal_failure_and_retry_queue_are_not_recovered_by_late_items(self):
        self.fail()
        for status in ('failed', 'completed', 'interrupted', 'closed', 'queued', 'starting'):
            with self.subTest(status=status):
                self.m.store.update(self.wid, status=status, error='preserved outcome')
                self.emit('item/reasoning/summaryTextDelta', itemId='late-'+status, delta='late')
                self.assertEqual(self.m.store.one(self.wid)['error'], 'preserved outcome')
                self.assertEqual(self.m.store.one(self.wid)['status'], status)

    def test_completed_window_is_not_reopened_by_late_error(self):
        self.emit('turn/completed', turn={'id': 'current', 'status': 'completed'})
        self.emit('error', error={'message': 'late current error'})
        w = self.m.store.one(self.wid)
        self.assertEqual((w['status'], w['error']), ('completed', ''))
        self.assertEqual(self.m.store.snapshot(self.wid)['items'][-1]['kind'], 'error')

    def test_waiting_question_can_replace_error_but_remains_waiting(self):
        self.fail()
        self.m.store.update(self.wid, status='waiting')
        self.emit('item/started', item={'type': 'dynamicToolCall', 'id': 'question'})
        self.assertEqual((self.m.store.one(self.wid)['status'], self.m.store.one(self.wid)['error']), ('waiting', ''))

    def test_native_question_request_clears_error_and_keeps_pending_question(self):
        self.fail()
        request = {'id': 17, 'method': 'item/tool/requestUserInput', 'params': {'turnId': 'current', 'questions': []}}
        reader = object.__new__(f.service.Engine)
        reader.manager, reader.wid, reader.requests, reader.waiters = self.m, self.wid, {}, {}
        reader.stopping = False
        reader.proc = type('Process', (), {'stdout': [json.dumps(request)]})()
        with patch.object(self.m, 'failed'):
            reader.read()
        w = self.m.store.one(self.wid)
        self.assertEqual((w['status'], w['error']), ('waiting', ''))
        self.assertIn('17', reader.requests)

    def test_recovery_is_isolated_and_does_not_submit_or_stop_tasks(self):
        other = self.create('other-window')['id']
        self.m.store.update(other, status='running', turn_id='other', error='other failure')
        self.fail()
        calls = list(self.engine.calls)
        self.emit('item/started', item={'type': 'commandExecution', 'id': 'cmd', 'command': 'true'})
        self.assertEqual(self.m.store.one(self.wid)['error'], '')
        self.assertEqual(self.m.store.one(other)['error'], 'other failure')
        self.assertEqual(self.engine.calls, calls)
        with self.assertRaises(f.service.Problem):
            self.m.submit(self.wid, {'request_id': 'second-task', 'text': 'must not submit'})


if __name__ == '__main__':
    unittest.main()
