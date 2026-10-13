import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
import uuid

spec=importlib.util.spec_from_file_location('codex_service',Path(__file__).parents[1]/'codex-service/service.py')
service=importlib.util.module_from_spec(spec);spec.loader.exec_module(service)

class FakeEngine:
    def __init__(self,manager,wid,profile):
        self.manager,self.wid,self.requests=manager,wid,{}
        self.calls=[];self.closed=False;self.profile_fingerprint=json.dumps(profile,sort_keys=True)
        manager.window_home(wid).mkdir(parents=True,exist_ok=True)
    def rpc(self,method,params=None,**_):
        self.calls.append((method,params))
        if method=='thread/start':return {'thread':{'id':'native-'+self.wid}}
        if method=='turn/start':return {'turn':{'id':'turn-'+uuid.uuid4().hex}}
        return {}
    def close(self):self.closed=True
    def send(self,value):self.calls.append(('response',value))

class Lifecycle(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.root=Path(self.tmp.name)
        self.profile={'id':'p','name':'test','base_url':'https://api.example.test/v1','api_key':'private-secret-test','model':'test-model','effort':'high'}
        service.write_json(self.root/'config.json',{'profiles':[self.profile],'default_profile':'p','access_hash':'hash'})
        self.m=service.Manager(self.root,FakeEngine,start_worker=False)
    def tearDown(self):
        self.m.shutdown();self.m.store.db.close();self.tmp.cleanup()
    def create(self,key='create-request-1'):
        return self.m.create({'request_id':key,'title':'test'})
    def test_creation_owns_native_thread_and_is_idempotent(self):
        a=self.create();b=self.create();c=self.create('create-request-2')
        self.assertEqual(a['id'],b['id']);self.assertNotEqual(a['thread_id'],c['thread_id'])
        self.assertEqual(len(self.m.engines),2)
    def test_submission_retry_never_duplicates_task(self):
        w=self.create();body={'text':'do work','request_id':'submit-request-1'}
        self.m.submit(w['id'],body);self.m.submit(w['id'],body)
        self.assertEqual(self.m.store.db.execute('SELECT count(*) FROM tasks').fetchone()[0],1)
        with self.assertRaises(service.Problem):self.m.submit(w['id'],dict(body,request_id='submit-request-2'))
    def test_request_id_cannot_cross_windows(self):
        a=self.create();b=self.create('create-request-2');body={'text':'task','request_id':'submit-request-1'}
        self.m.submit(a['id'],body)
        with self.assertRaises(service.Problem):self.m.submit(b['id'],body)
    def test_close_reopen_keeps_native_thread_delete_clears_everything(self):
        w=self.create();wid=w['id'];native=w['thread_id'];self.m.submit(wid,{'text':'task','request_id':'submit-request-1'})
        self.m.action(wid,'close',{});self.assertEqual(self.m.store.one(wid)['status'],'closed')
        self.assertEqual(self.m.store.db.execute('SELECT status FROM tasks').fetchone()[0],'interrupted')
        self.m.action(wid,'reopen',{});self.assertEqual(self.m.store.one(wid)['thread_id'],native)
        self.assertIn('thread/resume',[x[0] for x in self.m.engines[wid].calls])
        self.m.action(wid,'delete',{})
        self.assertFalse(self.m.window_home(wid).parent.exists());self.assertEqual(len(self.m.store.list()),0)
        self.assertEqual(self.m.store.db.execute('SELECT count(*) FROM items').fetchone()[0],0)
        self.m.store.item(wid,'late','agentMessage','late output');self.assertEqual(len(self.m.store.list()),0)
    def test_incremental_snapshot_recovers_offline_deltas(self):
        w=self.create();wid=w['id'];first=self.m.store.snapshot(wid)
        self.m.store.item(wid,'msg','agentMessage','hello')
        self.m.store.item(wid,'msg','agentMessage',' world',append=True)
        snapshot=self.m.store.snapshot(wid,first['cursor'])
        self.assertEqual(snapshot['items'][0]['text'],'hello world')
        self.assertEqual(self.m.store.snapshot(wid,snapshot['cursor'])['items'],[])
    def test_buffered_event_cannot_reopen_stopping_window(self):
        w=self.create();engine=self.m.engines[w['id']];engine.stopping=True
        self.m.store.update(w['id'],status='closed')
        self.m.event(engine,{'method':'turn/started','params':{'turn':{'id':'late'}}})
        self.assertEqual(self.m.store.one(w['id'])['status'],'closed')
    def test_api_keys_never_return_and_blank_preserves_key(self):
        self.assertNotIn('private-secret-test',json.dumps(self.m.public_config()))
        p=dict(self.profile,api_key='',model='new-model');self.m.save_config({'profiles':[p]})
        self.assertEqual(self.m.profile()['api_key'],'private-secret-test')
        self.assertNotIn('private-secret-test',self.m.redact('output private-secret-test'))
    def test_config_change_does_not_kill_running_turn_and_refreshes_next_turn(self):
        w=self.create();wid=w['id'];old=self.m.engines[wid];self.m.store.update(wid,status='running')
        self.m.save_config({'profiles':[dict(self.profile,base_url='https://new.example.test/v1')]})
        self.assertFalse(old.closed)
        self.m.store.update(wid,status='completed');self.m.engine(wid,fresh_config=True)
        self.assertTrue(old.closed);self.assertIsNot(self.m.engines[wid],old)
    def test_used_profile_cannot_be_removed(self):
        self.create()
        with self.assertRaises(service.Problem):self.m.save_config({'profiles':[dict(self.profile,id='other')]})
    def test_path_traversal_rejected(self):
        with self.assertRaises(service.Problem):self.m.window_home('../outside')
    def test_raw_reasoning_is_not_saved(self):
        w=self.create();engine=self.m.engines[w['id']]
        self.m.event(engine,{'method':'item/completed','params':{'item':{'id':'reason','type':'reasoning','summary':['brief summary'],'content':['private raw reasoning']}}})
        value=json.dumps(self.m.store.snapshot(w['id']));self.assertIn('brief summary',value);self.assertNotIn('private raw reasoning',value)
    def test_stop_clears_pending_question(self):
        w=self.create();engine=self.m.engines[w['id']];engine.requests['1']={'id':1}
        self.m.store.item(w['id'],'request:1','request','question');self.m.action(w['id'],'stop',{})
        self.assertEqual(self.m.store.snapshot(w['id'])['items'][0]['kind'],'resolved')
    def test_restart_marks_active_task_interrupted_without_resubmitting(self):
        w=self.create();self.m.submit(w['id'],{'text':'deploy','request_id':'submit-request-1'})
        self.m.store.db.execute("UPDATE tasks SET status='running'");self.m.store.db.commit();self.m.store.update(w['id'],status='running')
        second=service.Store(self.root)
        try:self.assertEqual(second.one(w['id'])['status'],'interrupted');self.assertEqual(second.db.execute('SELECT status FROM tasks').fetchone()[0],'interrupted')
        finally:second.db.close()

if __name__=='__main__':unittest.main()
