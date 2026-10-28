"""Separate bounded startup retries from rate limits after real task progress."""
import importlib.util
from pathlib import Path
import time
import unittest

spec = importlib.util.spec_from_file_location('switch_fixture', Path(__file__).with_name('codex-any-switch.test.py'))
f = importlib.util.module_from_spec(spec)
spec.loader.exec_module(f)


class RetryPolicy(unittest.TestCase):
    setUp = f.AnySwitch.setUp
    tearDown = f.AnySwitch.tearDown
    create = f.AnySwitch.create
    start_task = f.AnySwitch.start_task
    wait_for = f.AnySwitch.wait_for
    complete = f.AnySwitch.complete

    def progress(self, wid, engine, kind='agentMessage', turn_id=None):
        item = {'id': 'fixture-progress-' + str(len(engine.calls)), 'type': kind,
                'text': 'Working on the requested task.', 'status': 'running'}
        if kind == 'reasoning':
            item['summary'] = ['Checking the requested task.']
        self.m.event(engine, {'method': 'item/started', 'params': {
            'turnId': turn_id or self.m.store.one(wid)['turn_id'], 'item': item}})

    def retry(self, wid, engine, count, message='rate_limit_exceeded'):
        self.complete(wid, engine, message=message)
        self.assertIn(wid, self.m.automatic_retries)
        run = self.m.automatic_retries[wid]
        run.due = 0
        self.wait_for(lambda: run.count == count and self.m.store.one(wid)['status'] == 'running')
        return run

    def test_initial_high_demand_stops_at_configured_limit(self):
        self.m.set_any_retry({'mode': 'limited', 'limit': 2})
        wid, engine = self.start_task()
        for count in (1, 2):
            self.retry(wid, engine, count, 'HTTP 429: high demand, temporarily overloaded')
        self.complete(wid, engine, message='HTTP 429: high demand, temporarily overloaded')
        self.assertEqual(self.m.store.one(wid)['status'], 'failed')
        self.assertEqual(sum(method == 'turn/start' for method, _ in engine.calls), 3)

    def test_rate_limit_after_progress_continues_beyond_limit_same_thread(self):
        self.m.set_any_retry({'mode': 'limited', 'limit': 1})
        wid, engine = self.start_task()
        self.progress(wid, engine)
        for count in range(1, 7):
            self.retry(wid, engine, count)
        self.complete(wid, engine, 'completed', '')
        starts = [params for method, params in engine.calls if method == 'turn/start']
        self.assertEqual(len(starts), 7)
        self.assertEqual(len({params['threadId'] for params in starts}), 1)
        self.assertTrue(all(params['input'][0]['text'] == f.f.service.CONTINUE_TASK for params in starts[1:]))
        self.assertEqual(self.m.store.one(wid)['status'], 'completed')
        self.assertNotIn(wid, self.m.automatic_retries)

    def test_rate_limit_does_not_use_up_busy_retry_budget(self):
        self.m.set_any_retry({'mode': 'limited', 'limit': 2})
        wid, engine = self.start_task()
        self.retry(wid, engine, 1, 'high demand')
        self.progress(wid, engine, 'commandExecution')
        for count in range(2, 6):
            self.retry(wid, engine, count)
        self.retry(wid, engine, 6, 'high demand')
        self.complete(wid, engine, message='high demand')
        self.assertEqual(self.m.store.one(wid)['status'], 'failed')
        self.assertEqual(sum(method == 'turn/start' for method, _ in engine.calls), 7)

    def test_created_user_usage_or_stale_progress_does_not_unlock_unlimited(self):
        self.m.set_any_retry({'mode': 'limited', 'limit': 1})
        wid, engine = self.start_task()
        self.progress(wid, engine, 'userMessage')
        self.progress(wid, engine, turn_id='stale-turn')
        self.m.event(engine, {'method': 'thread/tokenUsage/updated', 'params': {'tokenUsage': {}}})
        self.retry(wid, engine, 1)
        self.complete(wid, engine, message='rate_limit_exceeded')
        self.assertEqual(self.m.store.one(wid)['status'], 'failed')

    def test_high_demand_after_progress_still_uses_configured_limit(self):
        self.m.set_any_retry({'mode': 'limited', 'limit': 1})
        wid, engine = self.start_task()
        self.progress(wid, engine)
        self.retry(wid, engine, 1, '429 high demand')
        self.complete(wid, engine, message='429 high demand')
        self.assertEqual(self.m.store.one(wid)['status'], 'failed')

    def test_disable_cancels_rate_limit_wait_and_reenable_never_replays(self):
        self.m.set_any_retry({'mode': 'limited', 'limit': 1})
        wid, engine = self.start_task()
        self.progress(wid, engine)
        self.retry(wid, engine, 1)
        self.complete(wid, engine, message='rate_limit_exceeded')
        self.assertEqual(self.m.store.one(wid)['status'], 'queued')
        self.m.set_any_retry({'mode': 'off'})
        self.assertEqual(self.m.store.one(wid)['status'], 'interrupted')
        self.m.set_any_retry({'mode': 'limited', 'limit': 1})
        self.assertNotIn(wid, self.m.automatic_retries)
        self.assertEqual(sum(method == 'turn/start' for method, _ in engine.calls), 2)

    def test_switching_off_on_running_preserves_both_counters_and_progress(self):
        self.m.set_any_retry({'mode': 'limited', 'limit': 1})
        wid, engine = self.start_task()
        self.progress(wid, engine)
        self.retry(wid, engine, 1)
        self.m.set_any_retry({'mode': 'off'})
        self.m.set_any_retry({'mode': 'limited', 'limit': 1})
        self.retry(wid, engine, 2)
        self.retry(wid, engine, 3, 'high demand')
        self.complete(wid, engine, message='high demand')
        self.assertEqual(self.m.store.one(wid)['status'], 'failed')

    def test_enable_after_existing_progress_and_new_task_resets_progress(self):
        wid, engine = self.start_task()
        self.progress(wid, engine, 'reasoning')
        self.m.set_any_retry({'mode': 'limited', 'limit': 1})
        self.retry(wid, engine, 1)
        self.retry(wid, engine, 2)
        self.complete(wid, engine, 'completed', '')
        self.m.submit(wid, {'request_id': 'new-request', 'text': 'A new task in the same window.'})
        self.wait_for(lambda: self.m.store.one(wid)['status'] == 'running')
        self.retry(wid, engine, 1)
        self.complete(wid, engine, message='rate_limit_exceeded')
        self.assertEqual(self.m.store.one(wid)['status'], 'failed')

    def test_auth_and_balance_failures_never_continue_after_progress(self):
        self.m.set_any_retry({'mode': 'limited', 'limit': 1})
        wid, engine = self.start_task()
        self.progress(wid, engine)
        self.complete(wid, engine, message='rate_limit_exceeded insufficient_quota')
        self.assertEqual(self.m.store.one(wid)['status'], 'failed')
        self.assertEqual(sum(method == 'turn/start' for method, _ in engine.calls), 1)

    def test_stale_item_while_disabled_does_not_unlock_continuation(self):
        wid, engine = self.start_task()
        self.progress(wid, engine, turn_id='earlier-turn')
        self.m.set_any_retry({'mode': 'limited', 'limit': 1})
        self.retry(wid, engine, 1)
        self.complete(wid, engine, message='rate_limit_exceeded')
        self.assertEqual(self.m.store.one(wid)['status'], 'failed')

    def test_reasoning_delta_while_disabled_retains_real_progress(self):
        wid, engine = self.start_task()
        self.m.event(engine, {'method': 'item/reasoning/textDelta', 'params': {
            'turnId': self.m.store.one(wid)['turn_id'], 'itemId': 'reasoning-fixture',
            'delta': 'Working on the task.'}})
        self.m.set_any_retry({'mode': 'limited', 'limit': 1})
        self.retry(wid, engine, 1)
        self.retry(wid, engine, 2)
        self.complete(wid, engine, 'completed', '')
        self.assertEqual(self.m.store.one(wid)['status'], 'completed')

    def test_explicit_overload_with_rate_limit_label_is_bounded(self):
        self.m.set_any_retry({'mode': 'limited', 'limit': 1})
        wid, engine = self.start_task()
        self.progress(wid, engine)
        message = 'rate_limit_exceeded: temporarily overloaded due to high demand'
        self.retry(wid, engine, 1, message)
        self.complete(wid, engine, message=message)
        self.assertEqual(self.m.store.one(wid)['status'], 'failed')

    def test_chinese_rate_limit_after_progress_continues(self):
        self.m.set_any_retry({'mode': 'limited', 'limit': 1})
        wid, engine = self.start_task()
        self.progress(wid, engine)
        self.retry(wid, engine, 1, '请求限速，请稍后继续')
        self.retry(wid, engine, 2, '触发限流')
        self.complete(wid, engine, 'completed', '')
        self.assertEqual(self.m.store.one(wid)['status'], 'completed')

    def test_lowering_busy_limit_keeps_pending_rate_limit_continuation(self):
        self.m.set_any_retry({'mode': 'limited', 'limit': 2})
        wid, engine = self.start_task()
        self.retry(wid, engine, 1, 'high demand')
        self.progress(wid, engine)
        self.retry(wid, engine, 2)
        self.complete(wid, engine, message='rate_limit_exceeded')
        self.m.set_any_retry({'mode': 'limited', 'limit': 1})
        run = self.m.automatic_retries[wid]
        self.assertEqual(self.m.store.one(wid)['status'], 'queued')
        run.due = 0
        self.wait_for(lambda: run.count == 3 and self.m.store.one(wid)['status'] == 'running')
        self.complete(wid, engine, message='high demand')
        self.assertEqual(self.m.store.one(wid)['status'], 'failed')

    def test_stop_cancels_pending_unlimited_continuation(self):
        self.m.set_any_retry({'mode': 'limited', 'limit': 1})
        wid, engine = self.start_task()
        self.progress(wid, engine)
        self.complete(wid, engine, message='rate_limit_exceeded')
        run = self.m.automatic_retries[wid]
        self.m.action(wid, 'stop', {})
        run.due = 0
        time.sleep(.4)
        self.assertNotIn(wid, self.m.automatic_retries)
        self.assertEqual(self.m.store.one(wid)['status'], 'interrupted')
        self.assertEqual(sum(method == 'turn/start' for method, _ in engine.calls), 1)


if __name__ == '__main__':
    unittest.main()
