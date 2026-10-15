import importlib.util
import json
from pathlib import Path
import threading
import time
import unittest

spec=importlib.util.spec_from_file_location('switch_fixture',Path(__file__).with_name('codex-any-switch.test.py'))
f=importlib.util.module_from_spec(spec);spec.loader.exec_module(f)

class Controls(unittest.TestCase):
    setUp=f.AnySwitch.setUp
    tearDown=f.AnySwitch.tearDown
    create=f.AnySwitch.create
    start_task=f.AnySwitch.start_task
    wait_for=f.AnySwitch.wait_for
    complete=f.AnySwitch.complete

    def test_exact_cap_excludes_initial_and_new_submission_resets(self):
        self.m.set_any_retry({'mode':'limited','limit':2})
        wid,e=self.start_task()
        for count in (1,2):
            self.complete(wid,e);run=self.m.automatic_retries[wid];run.due=0
            self.wait_for(lambda:run.count==count and self.m.store.one(wid)['status']=='running')
        self.complete(wid,e);time.sleep(.4)
        self.assertEqual(sum(m=='turn/start' for m,p in e.calls),3)
        self.assertEqual(self.m.store.one(wid)['status'],'failed')
        self.assertIn('已达上限',str(self.m.store.snapshot(wid)['items']))
        self.m.submit(wid,{'request_id':'next-manual-task','text':'next task'})
        self.assertEqual(self.m.automatic_retries[wid].count,0)

    def test_lowering_limit_does_not_reset_running_counter(self):
        self.m.set_any_retry({'mode':'unlimited'});wid,e=self.start_task()
        self.complete(wid,e);run=self.m.automatic_retries[wid];run.due=0
        self.wait_for(lambda:run.count==1 and self.m.store.one(wid)['status']=='running')
        self.m.set_any_retry({'mode':'limited','limit':1})
        self.assertEqual(self.m.automatic_retries[wid].count,1)
        self.assertFalse(e.closed);self.complete(wid,e)
        self.assertEqual(self.m.store.one(wid)['status'],'failed')

    def test_off_on_running_keeps_count(self):
        self.m.set_any_retry({'mode':'unlimited'});wid,e=self.start_task()
        self.complete(wid,e);run=self.m.automatic_retries[wid];run.due=0
        self.wait_for(lambda:run.count==1 and self.m.store.one(wid)['status']=='running')
        self.m.set_any_retry({'mode':'off'});self.m.set_any_retry({'mode':'limited','limit':1})
        self.assertEqual(self.m.automatic_retries[wid].count,1)
        self.complete(wid,e);self.assertEqual(self.m.store.one(wid)['status'],'failed')

    def test_lower_limit_cancels_pending_and_never_replays(self):
        self.m.set_any_retry({'mode':'unlimited'});wid,e=self.start_task()
        self.complete(wid,e);run=self.m.automatic_retries[wid];run.due=0
        self.wait_for(lambda:run.count==1 and self.m.store.one(wid)['status']=='running');self.complete(wid,e)
        self.m.set_any_retry({'mode':'limited','limit':1})
        self.assertNotIn(wid,self.m.automatic_retries)
        self.assertEqual(self.m.store.one(wid)['status'],'interrupted')

    def test_strict_validation_and_persistence(self):
        Problem=f.f.service.Problem
        for limit in [0,-1,1.5,True,'3',1000001]:
            with self.assertRaises(Problem):self.m.set_any_retry({'mode':'limited','limit':limit})
        for enabled,count in [('true',2),(True,1),(True,9),(True,2.5),(False,True)]:
            with self.assertRaises(Problem):self.m.set_any_parallel({'enabled':enabled,'count':count})
        before=self.m.public_config()['profiles']
        self.m.set_any_retry({'mode':'limited','limit':7});self.m.set_any_parallel({'enabled':True,'count':4})
        second=f.f.service.Manager(self.root,f.f.FakeEngine,start_worker=False)
        try:
            cfg=second.public_config();self.assertEqual((cfg['any_retry_mode'],cfg['any_retry_limit'],cfg['any_parallel_count']),('limited',7,4))
            self.assertTrue(cfg['any_parallel_enabled']);self.assertEqual(cfg['profiles'],before)
            self.assertNotIn('private-secret-test',json.dumps(cfg));self.assertEqual(second.automatic_retries,{})
        finally:second.shutdown();second.store.db.close()

    def test_success_and_nonretryable_failure_end_immediately(self):
        for result,message in [('completed',''),('failed','unauthorized invalid api key')]:
            self.m.set_any_retry({'mode':'limited','limit':3});wid,e=self.start_task()
            self.complete(wid,e,result,message);self.assertNotIn(wid,self.m.automatic_retries)
            self.assertEqual(sum(m=='turn/start' for m,p in e.calls),1)
            self.m.action(wid,'delete',{})

if __name__=='__main__':unittest.main()
