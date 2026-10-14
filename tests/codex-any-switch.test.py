import importlib.util,json,threading,time,unittest
from pathlib import Path
from unittest.mock import patch
spec=importlib.util.spec_from_file_location('fixtures',Path(__file__).with_name('codex-service.test.py'))
f=importlib.util.module_from_spec(spec);spec.loader.exec_module(f)

class AnySwitch(unittest.TestCase):
    def setUp(self):
        f.Lifecycle.setUp(self)
        self.profile.update(id=f.ANY_PROFILE_ID,name='any')
        self.m.config.update(profiles=[self.profile],default_profile=f.ANY_PROFILE_ID)
    def tearDown(self):
        self.m.quit.set()
        if hasattr(self,'pump'):self.pump.join(3)
        f.Lifecycle.tearDown(self)
    create=f.Lifecycle.create
    start_task=f.AnyNoRetryLifecycle.start_task
    wait_for=f.AnyNoRetryLifecycle.wait_for
    complete=f.AnyNoRetryLifecycle.complete

    def test_default_off_and_strict_boolean(self):
        self.assertFalse(self.m.public_config()['any_auto_retry'])
        for value in ['false','true',0,1,None]:
            with self.assertRaises(f.service.Problem):self.m.set_any_retry({'enabled':value})
        self.assertNotIn('private-secret-test',json.dumps(self.m.public_config()))

    def test_enabled_retries_same_thread_and_stops_on_success(self):
        self.m.set_any_retry({'enabled':True})
        wid,engine=self.start_task()
        for count in range(1,13):
            self.complete(wid,engine)
            run=self.m.automatic_retries[wid]
            self.assertGreater(run.due,time.monotonic())
            run.due=0
            self.wait_for(lambda:run.count==count and self.m.store.one(wid)['status']=='running')
        self.complete(wid,engine,'completed','')
        starts=[p for m,p in engine.calls if m=='turn/start']
        self.assertEqual(len(starts),13)
        self.assertEqual(len({p['threadId'] for p in starts}),1)
        self.assertEqual(starts[-1]['input'][0]['text'],f.service.CONTINUE_TASK)
        self.assertNotIn(wid,self.m.automatic_retries)

    def test_disable_pending_retry_cancels_and_enable_never_replays(self):
        self.m.set_any_retry({'enabled':True});wid,engine=self.start_task();self.complete(wid,engine)
        self.m.set_any_retry({'enabled':False})
        self.assertEqual(self.m.store.one(wid)['status'],'interrupted')
        self.assertNotIn(wid,self.m.automatic_retries)
        self.m.set_any_retry({'enabled':True});time.sleep(.5)
        self.assertEqual(sum(m=='turn/start' for m,_ in engine.calls),1)
        self.assertNotIn(wid,self.m.automatic_retries)

    def test_enable_running_then_disable_keeps_request_but_no_retry(self):
        wid,engine=self.start_task();self.m.set_any_retry({'enabled':True})
        self.assertIn(wid,self.m.automatic_retries)
        self.m.set_any_retry({'enabled':False})
        self.assertEqual(self.m.store.one(wid)['status'],'running')
        self.assertFalse(engine.closed);self.complete(wid,engine);time.sleep(.5)
        self.assertEqual(self.m.store.one(wid)['status'],'failed')
        self.assertEqual(sum(m=='turn/start' for m,_ in engine.calls),1)

    def test_preference_persists_and_profiles_and_keys_unchanged(self):
        before=self.m.public_config()['profiles']
        self.m.set_any_retry({'enabled':True})
        second=f.service.Manager(self.root,f.FakeEngine,start_worker=False)
        try:
            self.assertTrue(second.public_config()['any_auto_retry'])
            self.assertEqual(second.public_config()['profiles'],before)
            self.assertEqual(second.profile()['api_key'],'private-secret-test')
            self.assertEqual(second.automatic_retries,{})
        finally:second.shutdown();second.store.db.close()
        self.m.set_any_retry({'enabled':False})
        raw=self.m.key_store.load(self.root/'config.json',f.service.write_json)
        self.assertFalse(raw['any_auto_retry'])

    def test_switch_does_not_cancel_ag(self):
        from ag_retry import AgRetry
        self.m.automatic_retries['ag-window']=AgRetry('ag-task')
        self.m.set_any_retry({'enabled':False})
        self.assertIn('ag-window',self.m.automatic_retries)

    def test_schedule_reads_switch_at_dispatch(self):
        wid=self.create()['id']
        self.m.schedule(wid,{'request_id':'scheduled-any','text':'work','scheduled_for':time.time()+100})
        self.m.set_any_retry({'enabled':True})
        self.m.store.db.execute('UPDATE schedules SET scheduled_for=0');self.m.store.db.commit()
        self.m.dispatch_due()
        self.assertIn(wid,self.m.automatic_retries)
        self.m.set_any_retry({'enabled':False})
        self.assertNotIn(wid,self.m.automatic_retries)
        self.assertEqual(self.m.store.one(wid)['status'],'queued')

    def test_delay_remains_one_to_ten_and_duplicate_completion_preserves_due(self):
        import any_retry
        with patch.object(any_retry.random,'SystemRandom') as rng,patch.object(any_retry.time,'monotonic',return_value=100):
            rng.return_value.randint.side_effect=[1,10]
            run=any_retry.AnyRetry('task');run.schedule();self.assertEqual(run.due,101)
            run.schedule();self.assertEqual(run.due,110)
        self.m.set_any_retry({'enabled':True});wid,engine=self.start_task();turn=self.complete(wid,engine)
        due=self.m.automatic_retries[wid].due
        self.m.event(engine,{'method':'turn/completed','params':{'turn':turn}})
        self.assertEqual(self.m.automatic_retries[wid].due,due)

if __name__=='__main__':unittest.main()
