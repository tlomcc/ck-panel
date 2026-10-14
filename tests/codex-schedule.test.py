"""Durable once-only scheduling, including crash recovery and real worker ticks."""
import importlib.util
import json
from pathlib import Path
import threading
import time
import unittest
from unittest.mock import patch
from urllib.request import Request, urlopen
import hashlib

spec = importlib.util.spec_from_file_location('fixtures', Path(__file__).with_name('codex-service.test.py'))
fixtures = importlib.util.module_from_spec(spec); spec.loader.exec_module(fixtures)
service = fixtures.service

class Scheduling(unittest.TestCase):
    setUp = fixtures.Lifecycle.setUp
    tearDown = fixtures.Lifecycle.tearDown
    create = fixtures.Lifecycle.create

    def schedule(self, wid, key='scheduled-task-1', due=None):
        body = {'request_id':key, 'text':'scheduled work', 'scheduled_for':due or time.time()+3600}
        self.m.schedule(wid, body)
        return body

    def due(self):
        with self.m.store.lock:
            self.m.store.db.execute('UPDATE schedules SET scheduled_for=?', (time.time()-1,))
            self.m.store.db.commit()

    def task_count(self):
        return self.m.store.db.execute('SELECT count(*) FROM tasks').fetchone()[0]

    def test_future_does_not_execute_and_restart_retains_pending(self):
        wid=self.create()['id']; self.schedule(wid); self.m.dispatch_due()
        self.assertEqual(self.task_count(),0)
        self.m.shutdown(); self.m.store.db.close()
        self.m=service.Manager(self.root,fixtures.FakeEngine,start_worker=False)
        self.assertEqual(self.m.store.schedules(wid)[0]['state'],'scheduled')
        self.m.dispatch_due(); self.assertEqual(self.task_count(),0)
        self.due(); self.m.dispatch_due(); self.m.dispatch_due()
        self.assertEqual(self.task_count(),1)
        self.assertEqual(self.m.store.schedules(wid)[0]['state'],'queued')

    def test_claim_is_durable_and_restart_does_not_replay(self):
        wid=self.create()['id']; body=self.schedule(wid); self.due(); self.m.dispatch_due()
        self.m.shutdown(); self.m.store.db.close()
        self.m=service.Manager(self.root,fixtures.FakeEngine,start_worker=False)
        self.m.dispatch_due(); self.m.schedule(wid,body)
        self.assertEqual(self.task_count(),1)
        self.assertEqual(self.m.store.schedules(wid)[0]['state'],'interrupted')

    def test_same_window_waits_but_other_window_dispatches(self):
        a=self.create()['id']; b=self.create('another-window')['id']
        self.m.submit(a,{'request_id':'immediate-task','text':'immediate'})
        self.schedule(a); self.schedule(a,'scheduled-task-2'); self.schedule(b,'scheduled-task-3'); self.due()
        self.m.dispatch_due(); self.assertEqual(self.task_count(),2)
        self.assertEqual(self.m.store.schedules(a)[0]['state'],'scheduled')
        self.m.finish(a,'completed'); self.m.dispatch_due(); self.assertEqual(self.task_count(),3)
        self.m.dispatch_due(); self.assertEqual(self.task_count(),3)
        self.m.finish(a,'completed'); self.m.dispatch_due(); self.assertEqual(self.task_count(),4)

    def test_cancel_close_delete_and_stop_have_distinct_effects(self):
        wid=self.create()['id']; self.schedule(wid)
        self.m.action(wid,'stop',{}); self.assertEqual(self.m.store.schedules(wid)[0]['state'],'scheduled')
        self.m.action(wid,'cancel-schedule',{'request_id':'scheduled-task-1'})
        self.m.action(wid,'cancel-schedule',{'request_id':'scheduled-task-1'})
        self.due(); self.m.dispatch_due(); self.assertEqual(self.task_count(),0)
        self.schedule(wid,'scheduled-task-2'); self.m.action(wid,'close',{}); self.m.action(wid,'reopen',{})
        self.due(); self.m.dispatch_due(); self.assertEqual(self.task_count(),0)
        self.assertTrue(all(s['state']=='cancelled' for s in self.m.store.schedules(wid)))
        self.m.action(wid,'delete',{}); self.assertEqual(self.m.store.schedules(wid),[])

    def test_duplicate_and_cross_endpoint_ids_cannot_execute_twice(self):
        a=self.create()['id']; b=self.create('another-window')['id']; body=self.schedule(a)
        self.m.schedule(a,body)
        self.assertEqual(len(self.m.store.schedules(a)),1)
        for fn in [lambda:self.m.schedule(b,body),lambda:self.m.submit(a,body),lambda:self.m.action(b,'cancel-schedule',body)]:
            with self.assertRaises(service.Problem):fn()
        self.due(); self.m.dispatch_due()
        with self.assertRaises(service.Problem):self.m.action(a,'cancel-schedule',body)
        self.m.schedule(a,body); self.assertEqual(self.task_count(),1)

    def test_invalid_or_past_times_never_create_task(self):
        wid=self.create()['id']
        for due in [None,True,'2026-10-14T12:00',float('nan'),float('inf'),0,time.time()-1,1e100]:
            with self.subTest(due=due), self.assertRaises(service.Problem):
                self.m.schedule(wid,{'request_id':'invalid-schedule','text':'work','scheduled_for':due})
        self.assertEqual(self.m.store.schedules(wid),[])

    def test_selected_provider_is_retained_and_any_never_arms_retry(self):
        self.m.config['profiles'].append(dict(self.profile,id=fixtures.ANY_PROFILE_ID,name='any',model='any-model'))
        wid=self.create()['id']; self.m.action(wid,'profile',{'profile':fixtures.ANY_PROFILE_ID}); self.schedule(wid)
        self.assertNotIn(wid,self.m.automatic_retries)
        self.m.action(wid,'profile',{'profile':'p'})
        with self.assertRaises(service.Problem):self.m.save_config({'profiles':[self.profile]})
        self.due(); self.m.dispatch_due(); self.assertNotIn(wid,self.m.automatic_retries)
        worker=threading.Thread(target=self.m.pump); worker.start()
        try:
            deadline=time.monotonic()+3
            while self.m.store.one(wid)['status']!='running' and time.monotonic()<deadline:time.sleep(.02)
            starts=[p for method,p in self.m.engines[wid].calls if method=='turn/start']
            self.assertEqual(len(starts),1); self.assertEqual(starts[0]['model'],'any-model')
            self.assertEqual(self.m.store.one(wid)['profile'],'p')
            engine=self.m.engines[wid]
            self.m.event(engine,{'method':'turn/completed','params':{'turn':{
                'id':self.m.store.one(wid)['turn_id'],'status':'failed',
                'error':{'message':'503 high demand'}}}})
            time.sleep(.5)
            self.assertEqual(self.m.store.one(wid)['status'],'failed')
            self.assertEqual(sum(m=='turn/start' for m,_ in engine.calls),1)
        finally:self.m.quit.set(); worker.join(3)

    def test_simultaneous_dispatch_claims_once(self):
        wid=self.create()['id']; self.schedule(wid); self.due()
        workers=[threading.Thread(target=self.m.dispatch_due) for _ in range(8)]
        for w in workers:w.start()
        for w in workers:w.join()
        self.assertEqual(self.task_count(),1)

    def test_http_schedule_runs_after_browser_disconnect_once(self):
        wid=self.create()['id']; self.m.config['access_hash']=hashlib.sha256(b'fixture-access').hexdigest()
        handler=type('TestHandler',(service.Handler,),{'manager':self.m})
        server=service.ThreadingHTTPServer(('127.0.0.1',0),handler)
        http=threading.Thread(target=server.serve_forever); http.start()
        worker=threading.Thread(target=self.m.pump); worker.start()
        body={'request_id':'http-scheduled-001','text':'only execute once','scheduled_for':time.time()+.8}
        try:
            req=Request('http://127.0.0.1:'+str(server.server_port)+'/threads/'+wid+'/schedule',data=json.dumps(body).encode(),headers={'Authorization':'Bearer fixture-access','Content-Type':'application/json'})
            with urlopen(req) as r:self.assertTrue(json.load(r)['accepted'])
            server.shutdown();http.join(3);server.server_close()
            deadline=time.monotonic()+4
            while self.m.store.one(wid)['status']!='running' and time.monotonic()<deadline:time.sleep(.02)
            self.assertEqual(self.m.store.one(wid)['status'],'running')
            time.sleep(.5)
            self.assertEqual(len([1 for method,_ in self.m.engines[wid].calls if method=='turn/start']),1)
        finally:
            self.m.quit.set();worker.join(3)
            if http.is_alive():server.shutdown();http.join(3);server.server_close()

if __name__=='__main__':unittest.main()
