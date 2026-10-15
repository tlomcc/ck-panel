import importlib.util
import http.client
import json
from pathlib import Path
import socket
import sys
import threading
import time
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
sys.path.insert(0,str(Path(__file__).parents[1]/'codex-service'))
from any_race import Batch, meaningful


def event(value):
    return b'data: '+json.dumps(value).encode()+b'\n\n'

class Racing(unittest.TestCase):
    def setUp(self):
        self.bodies=[];self.arrivals=[];self.disconnected=[];self.lock=threading.Lock();self.barrier=None
        self.plans=[];fixture=self
        class Handler(BaseHTTPRequestHandler):
            def log_message(self,*_):pass
            def do_POST(self):
                body=self.rfile.read(int(self.headers['Content-Length']))
                with fixture.lock:
                    i=len(fixture.bodies);fixture.bodies.append(body);fixture.arrivals.append(time.monotonic())
                try:
                    if fixture.barrier:fixture.barrier.wait(4)
                    fixture.plans[i](self,i)
                except (OSError,threading.BrokenBarrierError):pass
        self.server=ThreadingHTTPServer(('127.0.0.1',0),Handler);self.server.daemon_threads=True
        threading.Thread(target=self.server.serve_forever,daemon=True).start()
        self.profile={'base_url':'http://127.0.0.1:'+str(self.server.server_port)+'/v1','api_key':'test-only'}
        self.batch=None
    def tearDown(self):
        if self.batch:self.batch.cancel()
        self.server.shutdown();self.server.server_close()
    def stream(self,h,prelude=True):
        h.send_response(200);h.send_header('Content-Type','text/event-stream');h.end_headers()
        if prelude:h.wfile.write(event({'type':'response.created','response':{'id':'test'}}));h.wfile.flush()
    def good(self,text,delay=0):
        def plan(h,i):
            self.stream(h);time.sleep(delay);h.wfile.write(event({'type':'response.output_text.delta','delta':text}));h.wfile.flush()
        return plan
    def bad(self,code):
        def plan(h,i):h.send_response(code);h.end_headers();h.wfile.write(json.dumps({'error':{'message':'HTTP '+str(code)}}).encode())
        return plan
    def run_batch(self,n):
        self.barrier=threading.Barrier(n);self.batch=Batch(self.profile,b'{"input":"same complete context","stream":true}',{'Content-Type':'application/json'},n)
        return self.batch.run()
    def test_same_body_and_first_valid_not_first_headers_wins(self):
        self.plans=[self.good('slow',.4),self.good('winner',.05),self.bad(503)]
        code,kind,prefix,response=self.run_batch(3)
        self.assertEqual(code,200);self.assertIn(b'winner',prefix);self.assertNotIn(b'slow',prefix)
        self.assertEqual(len(set(self.bodies)),1);self.assertEqual(len(self.bodies),3)
        self.assertLess(max(self.arrivals)-min(self.arrivals),.3)
        self.assertEqual(sum(r['state']=='winner' for r in self.batch.rows),1)
    def test_disconnect_before_winner_reaches_execution(self):
        ready=threading.Event()
        def loser(h,i):
            self.stream(h);ready.set();h.connection.settimeout(3)
            if h.connection.recv(1)==b'':self.disconnected.append(i)
        def winner(h,i):
            ready.wait(3);self.stream(h);h.wfile.write(event({'type':'response.output_item.added','item':{'type':'function_call','name':'exec_command','arguments':'{}'}}));h.wfile.flush()
        self.plans=[loser,winner]
        code,kind,prefix,response=self.run_batch(2)
        self.assertIn(b'exec_command',prefix)
        end=time.monotonic()+1
        while not self.disconnected and time.monotonic()<end:time.sleep(.01)
        self.assertEqual(len(self.disconnected),1)
        self.assertEqual([r['state'] for r in self.batch.rows].count('cancelled'),1)
    def test_all_fail_and_auth_has_precedence(self):
        self.plans=[self.bad(503),self.bad(401),self.bad(429)]
        code,kind,prefix,response=self.run_batch(3);self.assertEqual(code,401)
        self.assertIsNone(self.batch.winner);self.assertTrue(all(r['state']=='failed' for r in self.batch.rows))
    def test_simultaneous_success_has_one_winner(self):
        self.plans=[self.good(str(i)) for i in range(8)]
        result=self.run_batch(8)
        self.assertEqual(sum(r['state']=='winner' for r in self.batch.rows),1)
        self.assertEqual(len(self.bodies),8)
    def test_stop_cancels_all_connections(self):
        arrived=threading.Barrier(3)
        def slow(h,i):
            self.stream(h);arrived.wait(3);h.connection.settimeout(3)
            if h.connection.recv(1)==b'':self.disconnected.append(i)
        self.plans=[slow,slow];self.batch=Batch(self.profile,b'{}',{},2)
        result=[];thread=threading.Thread(target=lambda:result.append(self.batch.run()));thread.start()
        arrived.wait(3);self.batch.cancel();thread.join(2)
        self.assertEqual(result,[None]);self.assertTrue(all(r['state']=='cancelled' for r in self.batch.rows))
    def test_single_request_forwards_error_without_fanout(self):
        self.plans=[self.bad(429)];code,kind,prefix,response=self.run_batch(1)
        self.assertEqual(code,429);self.assertEqual(len(self.bodies),1);self.assertIn(b'429',response.read())
    def test_empty_preamble_is_not_success(self):
        for value in [{'type':'response.created'},{'type':'response.in_progress'},{'type':'response.output_item.added','item':{'type':'message','content':[]}}]:self.assertFalse(meaningful(value))
        self.assertTrue(meaningful({'type':'response.reasoning_summary_text.delta','delta':'working'}))

if __name__=='__main__':unittest.main()
