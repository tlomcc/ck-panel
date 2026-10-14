import importlib.util
import json
from pathlib import Path
import tempfile
import threading
import time
import unittest
import uuid
import sys
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).parents[1]/'codex-service'))

spec=importlib.util.spec_from_file_location('codex_service',Path(__file__).parents[1]/'codex-service/service.py')
service=importlib.util.module_from_spec(spec);spec.loader.exec_module(service)
ANY_PROFILE_ID = service.ANY_PROFILE_ID

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
    def test_numbered_titles_are_atomic_and_replayed_creation_keeps_its_title(self):
        a=self.m.create({'request_id':'numbered-one','auto_title':True,'title':'任务99'})
        b=self.m.create({'request_id':'numbered-two'})
        again=self.m.create({'request_id':'numbered-one','auto_title':True})
        self.assertEqual([a['title'],b['title'],again['title']],['任务1','任务2','任务1'])
        self.m.action(a['id'],'rename',{'title':'部署面板'})
        c=self.m.create({'request_id':'numbered-three','auto_title':True})
        self.assertEqual(c['title'],'任务3')
    def test_error_display_does_not_allow_a_second_active_turn_and_clears_on_recovery(self):
        w=self.create();wid=w['id'];engine=self.m.engines[wid]
        self.m.store.update(wid,status='running',turn_id='active-turn')
        self.m.event(engine,{'method':'error','params':{'turnId':'active-turn','error':{'message':'provider private-secret-test failed'},'willRetry':True}})
        actual=self.m.store.one(wid)
        self.assertEqual(actual['status'],'running');self.assertNotIn('private-secret-test',actual['error'])
        self.assertIn('failed',actual['error'])
        with self.assertRaises(service.Problem):self.m.submit(wid,{'request_id':'error-submit','text':'second task'})
        self.assertEqual(self.m.store.snapshot(wid)['items'][0]['kind'],'error')
        self.m.event(engine,{'method':'item/agentMessage/delta','params':{'itemId':'response','delta':'recovered'}})
        self.assertEqual(self.m.store.one(wid)['error'],'')
        self.m.event(engine,{'method':'error','params':{'message':'another failure'}})
        self.assertEqual(self.m.store.one(wid)['error'],'another failure')
        rows=self.m.store.snapshot(wid)['items']
        self.assertEqual([r['kind'] for r in rows],['error','agentMessage','error'])
        self.m.event(engine,{'method':'item/completed','params':{'item':{'id':'recovered2','type':'agentMessage','text':'recovered without delta'}}})
        self.assertEqual(self.m.store.one(wid)['error'],'')
        self.m.log_problem(wid,'first warning');self.m.log_problem(wid,'second warning')
        self.assertEqual([r['text'] for r in self.m.store.snapshot(wid)['items'] if r['kind']=='warning'],['first warning','second warning'])
        self.m.event(engine,{'method':'turn/completed','params':{'turn':{'id':'active-turn','status':'failed','error':{'message':'failed finally'}}}})
        self.assertEqual(self.m.store.one(wid)['status'],'failed')
    def test_resolved_questions_keep_options_after_reload_and_other_questions_still_wait(self):
        w=self.create();wid=w['id'];engine=self.m.engines[wid]
        question={'method':'item/tool/requestUserInput','params':{'questions':[{'id':'scope','question':'执行范围','options':[{'label':'仅本次','description':'只处理当前任务'}]}]}}
        for rid in ('1','2'):
            engine.requests[rid]=dict(question,id=rid)
            self.m.store.item(wid,'request:'+rid,'request','',engine.requests[rid])
        self.m.store.update(wid,status='waiting')
        self.m.action(wid,'answer',{'request_id':'1','answers':{'scope':'仅本次'}})
        self.assertEqual(self.m.store.one(wid)['status'],'waiting')
        record=self.m.store.snapshot(wid)['items'][0]
        self.assertEqual(record['kind'],'resolved');self.assertEqual(record['data']['params'],question['params'])
        self.m.event(engine,{'method':'serverRequest/resolved','params':{'requestId':'2'}})
        self.assertEqual(self.m.store.one(wid)['status'],'running')
        self.assertTrue(all(item['data']['method']==question['method'] for item in self.m.store.snapshot(wid)['items']))
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
    def test_parallel_windows_waiting_and_stop_are_isolated(self):
        windows=[self.create('parallel-create-'+str(i)) for i in range(3)]
        for i,w in enumerate(windows):
            self.m.submit(w['id'],{'text':'task','request_id':'parallel-submit-'+str(i)})
        pump=threading.Thread(target=self.m.pump);pump.start()
        try:
            deadline=time.monotonic()+4
            while self.m.store.one(windows[0]['id'])['status']!='running' and time.monotonic()<deadline:time.sleep(.02)
            self.m.store.update(windows[0]['id'],status='waiting')
            while any(self.m.store.one(w['id'])['status']!='running' for w in windows[1:]) and time.monotonic()<deadline:time.sleep(.02)
            self.assertEqual([self.m.store.one(w['id'])['status'] for w in windows],['waiting','running','running'])
            self.m.action(windows[1]['id'],'stop',{})
            self.assertEqual(self.m.store.one(windows[2]['id'])['status'],'running')
            for w in windows:
                if w['id'] in self.m.engines:self.assertEqual(sum(call[0]=='turn/start' for call in self.m.engines[w['id']].calls),1)
        finally:self.m.quit.set();pump.join(2)
    def test_text_is_complete_across_large_stream_and_reconnect(self):
        w=self.create();wid=w['id'];text='完整文字进展。'*50000
        self.m.store.item(wid,'long','agentMessage',text[:200000])
        self.m.store.item(wid,'long','agentMessage',text[200000:],append=True)
        self.assertEqual(self.m.store.snapshot(wid)['items'][0]['text'],text)

class AnyNoRetryLifecycle(Lifecycle):
    def setUp(self):
        super().setUp()
        self.profile.update(id=ANY_PROFILE_ID, name='any')
        self.m.config.update(profiles=[self.profile], default_profile=self.profile['id'])
        service.write_json(self.root/'config.json', self.m.config)

    def start_task(self):
        w=self.create();wid=w['id']
        self.m.submit(wid, {'text':'original user task','request_id':'any-submit-001'})
        self.pump=threading.Thread(target=self.m.pump);self.pump.start()
        self.wait_for(lambda:self.m.store.one(wid)['status']=='running')
        return wid,self.m.engines[wid]

    def wait_for(self, condition):
        deadline=time.monotonic()+3
        while not condition() and time.monotonic()<deadline:time.sleep(.01)
        self.assertTrue(condition())

    def tearDown(self):
        self.m.quit.set()
        if hasattr(self,'pump'):self.pump.join(3)
        super().tearDown()

    def complete(self,wid,engine,status='failed',message='We’re currently experiencing high demand, which may cause temporary errors.'):
        turn={'id':self.m.store.one(wid)['turn_id'],'status':status,'error':{'message':message}}
        self.m.event(engine,{'method':'turn/completed','params':{'turn':turn}})
        return turn

    def test_overload_failure_never_submits_automatic_continuation(self):
        wid,engine=self.start_task()
        self.m.event(engine,{'method':'error','params':{'error':{'message':'high demand'}}})
        self.assertNotIn('等待自动',self.m.store.one(wid)['error'])
        self.complete(wid,engine)
        time.sleep(.8)
        self.assertEqual(self.m.store.one(wid)['status'],'failed')
        self.assertNotIn(wid,self.m.ag_retries)
        self.assertEqual(sum(m=='turn/start' for m,_ in engine.calls),1)
        self.assertFalse(any(i['id'].startswith(('any-retry:','ag-retry:'))
                             for i in self.m.store.snapshot(wid)['items']))
        self.m.submit(wid,{'text':'user manually continues','request_id':'manual-again-001'})
        self.wait_for(lambda:self.m.store.one(wid)['status']=='running')
        self.assertEqual(sum(m=='turn/start' for m,_ in engine.calls),2)
        self.assertNotIn(wid,self.m.ag_retries)

    def test_native_any_retries_remain_zero_other_providers_unchanged(self):
        for profile,expected in [(self.profile,0),(dict(self.profile,id='other'),2)]:
            wid=uuid.uuid4().hex
            with patch.object(service.subprocess,'Popen'), patch.object(service.threading.Thread,'start'), \
                 patch.object(service.Engine,'rpc'), patch.object(service.Engine,'send'):
                service.Engine(self.m,wid,profile)
            config=(self.m.window_home(wid)/'config.toml').read_text()
            self.assertIn(f'request_max_retries = {expected}',config)
            self.assertIn(f'stream_max_retries = {expected}',config)

if __name__=='__main__':unittest.main()
