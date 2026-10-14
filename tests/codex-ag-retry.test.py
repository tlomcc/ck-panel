import importlib.util
from pathlib import Path
import threading,time,unittest
from unittest.mock import patch
spec=importlib.util.spec_from_file_location('fixtures',Path(__file__).with_name('codex-service.test.py'))
f=importlib.util.module_from_spec(spec);spec.loader.exec_module(f)
from ag_retry import AgRetry,AG_PROFILE_ID,is_ag

class AG(unittest.TestCase):
    create=f.Lifecycle.create
    wait_for=f.AnyRetryLifecycle.wait_for
    complete=f.AnyRetryLifecycle.complete
    def setUp(self):
        f.Lifecycle.setUp(self)
        self.profile.update(id=AG_PROFILE_ID,name='ag',base_url='https://agentrouter.org/v1')
        self.m.config.update(profiles=[self.profile],default_profile=AG_PROFILE_ID)
    def tearDown(self):
        self.m.quit.set()
        if hasattr(self,'pump'):self.pump.join(3)
        f.Lifecycle.tearDown(self)
    def start(self):
        w=self.create();wid=w['id'];self.m.submit(wid,{'request_id':'ag-submit-001','text':'original'})
        self.pump=threading.Thread(target=self.m.pump);self.pump.start()
        self.wait_for(lambda:self.m.store.one(wid)['status']=='running')
        return wid,self.m.engines[wid]
    def test_rate_limit_continues_original_thread_then_stops_after_success(self):
        wid,engine=self.start()
        for count in range(1,5):
            self.m.event(engine,{'method':'error','params':{'error':{'message':'429 rate limit reached'}}})
            self.assertEqual(self.m.store.one(wid)['error'],'AG 限流，等待自动继续')
            self.complete(wid,engine,message='429 rate limit reached')
            run=self.m.any_retries[wid];self.assertIsInstance(run,AgRetry);self.assertEqual(run.delay,[10,20,40,60][count-1]);run.due=0
            self.wait_for(lambda:run.count==count and self.m.store.one(wid)['status']=='running')
            self.assertEqual(self.m.store.one(wid)['error'],'')
        starts=[p for method,p in engine.calls if method=='turn/start']
        self.assertEqual(len(starts),5);self.assertEqual(len({p['threadId'] for p in starts}),1)
        self.assertEqual(starts[-1]['input'][0]['text'],f.service.CONTINUE_TASK)
        self.complete(wid,engine,'completed','');self.assertNotIn(wid,self.m.any_retries)
        warnings=[i for i in self.m.store.snapshot(wid)['items'] if i['kind']=='warning'];self.assertEqual(len(warnings),1)
        self.assertIn('4 次',warnings[0]['text'])
    def test_stop_cancels_wait_and_reopen_does_not_rearm(self):
        wid,engine=self.start();self.complete(wid,engine,message='rate_limit_exceeded')
        self.m.action(wid,'close',{});self.m.action(wid,'reopen',{})
        self.assertNotIn(wid,self.m.any_retries);time.sleep(.4)
        self.assertEqual(len([1 for method,_ in engine.calls if method=='turn/start']),1)
    def test_only_rate_limit_is_retryable(self):
        run=AgRetry('fixture')
        for error in ['rate limit reached','rate_limit_exceeded','rate-limit exceeded','HTTP 429','Too many requests']:
            self.assertTrue(run.accepts(error),error)
        for error in ['401 unauthorized client','502 server error','high demand','429 insufficient_quota','rate limit: invalid API key','model_refusal']:
            self.assertFalse(run.accepts(error),error)
        self.assertTrue(is_ag(self.profile));self.assertFalse(is_ag(dict(self.profile,id='other')));self.assertFalse(is_ag(dict(self.profile,base_url='https://other.test/v1')))
    def test_retry_after_respected(self):
        run=AgRetry('fixture')
        with patch('ag_retry.time.monotonic',return_value=100):
            run.schedule({'message':'429 rate limit','Retry-After':120});self.assertEqual(run.due,220)
            run.schedule({'retryAfterMs':90000});self.assertEqual(run.due,190)
    def test_non_rate_limit_failure_finishes_without_continuation(self):
        wid,engine=self.start();self.complete(wid,engine,message='401 unauthorized client')
        self.assertEqual(self.m.store.one(wid)['status'],'failed');self.assertNotIn(wid,self.m.any_retries)

if __name__=='__main__':unittest.main()
