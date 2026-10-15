"""Real installed CLI, isolated workspace and loopback fixture; no provider calls."""
import importlib.util
import json
from pathlib import Path
import tempfile
import threading
import time
import unittest
from http.server import BaseHTTPRequestHandler,ThreadingHTTPServer
import sys
sys.path.insert(0,str(Path(__file__).parents[1]/'codex-service'))
import service

class NativeRace(unittest.TestCase):
    def test_real_cli_fans_out_once_and_only_winner_runs_tool(self):
        self.exercise(False)

    def test_real_cli_retries_batch_in_same_thread_then_runs_once(self):
        self.exercise(True)

    def exercise(self, retry):
        with tempfile.TemporaryDirectory(prefix='ck-any-native-') as directory:
            root=Path(directory);workspace=root/'workspace';workspace.mkdir();marker=workspace/'marker.txt'
            original_workspace=service.WORKSPACE;service.WORKSPACE=workspace
            bodies=[];tools_round=[];errors=[];lock=threading.Lock();barrier=threading.Barrier(3)
            class Handler(BaseHTTPRequestHandler):
                def log_message(self,*_):pass
                def do_POST(self):
                    try:
                        raw=self.rfile.read(int(self.headers['Content-Length']));body=json.loads(raw)
                        is_tool=any(x.get('type')=='function_call_output' for x in body.get('input',[]))
                        with lock:
                            if is_tool:tools_round.append(raw);index=0
                            else:index=len(bodies);bodies.append(raw)
                        if not is_tool:barrier.wait(10)
                        if retry and not is_tool and index < 3:
                            self.send_response(503);self.end_headers();self.wfile.write(b'{"error":{"message":"HTTP 503 high demand"}}');return
                        self.send_response(200);self.send_header('Content-Type','text/event-stream');self.end_headers()
                        def emit(value):self.wfile.write(b'data: '+json.dumps(value).encode()+b'\n\n');self.wfile.flush()
                        emit({'type':'response.created','response':{'id':'r-fixture','status':'in_progress','output':[]}})
                        if not is_tool:
                            time.sleep((index % 3)*.3)
                            names=[x.get('name') for x in body.get('tools',[])];assert 'exec_command' in names,names
                            args=json.dumps({'cmd':'printf fixture >> '+str(marker),'max_output_tokens':100})
                            item={'id':'fc-fixture','type':'function_call','call_id':'call-fixture','name':'exec_command','arguments':args}
                            emit({'type':'response.output_item.added','output_index':0,'item':dict(item,arguments='')})
                            emit({'type':'response.function_call_arguments.delta','item_id':item['id'],'output_index':0,'delta':args})
                        else:
                            item={'id':'msg-fixture','type':'message','role':'assistant','status':'completed','content':[{'type':'output_text','text':'fixture complete','annotations':[]}]}
                            emit({'type':'response.output_item.added','output_index':0,'item':dict(item,content=[])})
                            emit({'type':'response.output_text.delta','item_id':item['id'],'output_index':0,'content_index':0,'delta':'fixture complete'})
                        emit({'type':'response.output_item.done','output_index':0,'item':item})
                        emit({'type':'response.completed','response':{'id':'r-fixture','status':'completed','output':[item],'usage':{'input_tokens':1,'output_tokens':1,'total_tokens':2}}})
                    except (BrokenPipeError,ConnectionResetError):pass
                    except Exception as exc:errors.append(type(exc).__name__+': '+str(exc)[:500])
            server=ThreadingHTTPServer(('127.0.0.1',0),Handler);server.daemon_threads=True
            threading.Thread(target=server.serve_forever,daemon=True).start()
            profile={'id':service.ANY_PROFILE_ID,'name':'fixture','base_url':'http://127.0.0.1:'+str(server.server_port)+'/v1','api_key':'fixture-only','model':'gpt-5.4','effort':'high'}
            service.write_json(root/'config.json',{'profiles':[profile],'default_profile':profile['id'],'any_parallel_enabled':True,'any_parallel_count':3,'any_retry_mode':'limited' if retry else 'off','any_retry_limit':1,'any_auto_retry':retry})
            manager=service.Manager(root)
            try:
                w=manager.create({'request_id':'native-create','title':'isolated fixture'})
                manager.submit(w['id'],{'request_id':'native-submit','text':'Run the fixture command once, then report completion.'})
                end=time.monotonic()+35
                while time.monotonic()<end:
                    status=manager.store.one(w['id'])['status']
                    if status in ('completed','failed','interrupted'):break
                    time.sleep(.05)
                self.assertEqual(errors,[])
                snapshot=manager.store.snapshot(w['id'])
                self.assertEqual(status,'completed',[(x['kind'],x['text'][:300]) for x in snapshot['items']])
                self.assertEqual(marker.read_text(),'fixture')
                self.assertEqual(len(bodies),6 if retry else 3);self.assertEqual(len(set(bodies[:3])),1);self.assertEqual(len(set(bodies[-3:])),1);self.assertEqual(len(tools_round),1)
                folders=[i for i in snapshot['items'] if i['kind']=='anyRace'];self.assertEqual(len(folders),1);self.assertEqual(folders[0]['data']['retry'],1 if retry else 0)
                self.assertEqual(sum(w['state']=='winner' for w in folders[0]['data']['windows']),1)
                self.assertEqual(sum(w['state']=='cancelled' for w in folders[0]['data']['windows']),2)
                self.assertIn('fixture complete',str(snapshot['items']))
            finally:
                engines=list(manager.engines.values());manager.shutdown()
                for engine in engines:
                    for stream in (engine.proc.stdin,engine.proc.stdout,engine.proc.stderr):stream.close()
                manager.store.db.close();server.shutdown();server.server_close();service.WORKSPACE=original_workspace
if __name__=='__main__':unittest.main()
