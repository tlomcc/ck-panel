const {test}=require('node:test');
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),{webcrypto,createHash}=require('node:crypto');
const source=fs.readFileSync(require.resolve('../chat-recovery.js'),'utf8');
const flush=()=>new Promise(r=>setImmediate(r));
const plain=x=>JSON.parse(JSON.stringify(x));
const base=[{role:'user',content:'中文\nemoji🙂'},{role:'assistant',content:[{type:'thinking',thinking:'已存在的思考',signature:'signed-prefix+/=='},{type:'tool_use',id:'tool1',name:'search',input:{query:'合成查询',limit:2}}]}];
function setup(){
 const timers=new Map();let seq=0;
 const session={id:'a',transportMessages:plain(base)},cfg={sessionId:'a',panelKey:'fixture'};
 const c={Date,Promise,AbortController,TextEncoder,Uint8Array,Array,Object,Number,String,Math,console,
  window:{crypto:webcrypto},chatSessions:[session],chatEndpoint:()=>'/ck/chat',
  setTimeout(fn,ms){const id=++seq;timers.set(id,{fn,ms});return id},clearTimeout:id=>timers.delete(id),
  fetch:async()=>{throw Error('missing fixture')},chatMarkNetworkFailure:e=>Object.assign(e,{chatNetworkFailure:true}),chatCreateAbortError:()=>Object.assign(Error('aborted'),{name:'AbortError'})};
 vm.createContext(c);vm.runInContext(source,c);
 return {c,cfg,session,timers,expire(){for(const t of [...timers.values()])t.fn()}};
}
test('a verified delta reconstructs native thinking, signatures, tools and the new tail exactly',async()=>{
 const {c,cfg,session}=setup(),original=plain(session.transportMessages),tail=[{role:'user',content:'下一轮'},{role:'assistant',content:'完整答复'}];
 c.fetch=async url=>{
  const query=new URL(url,'https://fixture.invalid').searchParams;
  assert.equal(query.get('known_transport_count'),'2');assert.equal(query.get('turn_id'),'turn1');
  const canonical='[{"content":"中文\\nemoji🙂","role":"user"},{"content":[{"signature":"signed-prefix+/==","thinking":"已存在的思考","type":"thinking"},{"id":"tool1","input":{"limit":2,"query":"合成查询"},"name":"search","type":"tool_use"}],"role":"assistant"}]';
  const hash=createHash('sha256').update(canonical).digest('hex');assert.equal(query.get('known_transport_sha256'),hash);
  return {ok:true,json:async()=>({found:true,turn_id:'turn1',transport_delta:{base_count:2,base_sha256:hash,messages:tail}})};
 };
 const result=await c.chatReadDelivery(cfg,'turn1');
 assert.deepEqual(plain(result.transport_messages),original.concat(tail));assert.equal(result.transport_delta,undefined);
 assert.deepEqual(session.transportMessages,original,'reading a receipt must not mutate the active prefix');
});
test('old servers and mismatching prefixes remain compatible through a full response',async()=>{
 const {c,cfg}=setup(),rows=[{role:'assistant',content:'完整替代历史'}];
 c.fetch=async()=>({ok:true,json:async()=>({transport_messages:rows})});
 assert.deepEqual((await c.chatReadDelivery(cfg,'t')).transport_messages,rows);
 c.window.crypto={};let requested;
 c.fetch=async url=>{requested=url;return {ok:true,json:async()=>({transport_messages:rows})}};
 await c.chatReadDelivery(cfg,'t');assert(!requested.includes('known_transport'));
});
test('a changing prefix or invalid delta is retried, never silently spliced into another history',async()=>{
 for(const variant of ['changed','count','hash','messages']){
  const {c,cfg,session}=setup();
  c.fetch=async url=>{const q=new URL(url,'https://fixture.invalid').searchParams;
   const delta={base_count:2,base_sha256:q.get('known_transport_sha256'),messages:[]};
   if(variant==='changed')session.transportMessages[0].content='编辑后的新前缀';
   if(variant==='count')delta.base_count=1;if(variant==='hash')delta.base_sha256='f'.repeat(64);if(variant==='messages')delta.messages=null;
   return {ok:true,json:async()=>({transport_delta:delta})};
  };
  await assert.rejects(c.chatReadDelivery(cfg,'t'),/上下文已变化/);
 }
});
test('the 12-second recovery deadline covers both stalled fetch and stalled JSON',async()=>{
 for(const body of [false,true]){
  const x=setup();let called=false;
  x.c.fetch=async()=>{called=true;return body?{ok:true,json:()=>new Promise(()=>{})}:new Promise(()=>{})};
  const pending=x.c.chatReadDelivery(x.cfg,'t');
  for(let i=0;i<50&&!called;i++)await flush();assert(called);x.expire();
  await assert.rejects(pending,/补收连接等待超时/);assert.equal(x.timers.size,0);
 }
});
test('foreground recovery detaches the old stream and is distinct from user Stop or preparation',()=>{
 const {c}=setup();let aborts=0,polls=0,checkpoints=0;
 c.chatSending=true;c.chatSetStatus=()=>{};c.chatRecoverInterruptedTurns=()=>polls++;
 c.chatActiveRequest={hiddenAt:1,streamStarted:true,controller:{abort(){aborts++}},checkpointReply(){checkpoints++}};
 c.chatResumeAfterVisibility();assert.equal(aborts,1);assert.equal(checkpoints,1);assert.equal(c.chatActiveRequest.recovering,true);assert(!c.chatActiveRequest.stopped);
 c.chatResumeAfterVisibility();assert.equal(aborts,1);
 c.chatActiveRequest={hiddenAt:1,streamStarted:false,controller:{abort(){aborts++}}};c.chatResumeAfterVisibility();assert.equal(aborts,1);
 c.chatActiveRequest={hiddenAt:1,streamStarted:true,stopped:true,controller:{abort(){aborts++}}};c.chatResumeAfterVisibility();assert.equal(aborts,1);assert.equal(polls,3);
});

test('foreground abort releases a read even if the old network stream ignores cancellation',async()=>{
 const x=setup(),controller=new AbortController();
 const pending=x.c.chatReadStreamChunk({read:()=>new Promise(()=>{})},controller.signal);
 controller.abort();await assert.rejects(pending,{name:'AbortError'});assert.equal(x.timers.size,0);
});
