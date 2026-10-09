const {test}=require('node:test');
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(require.resolve('../chat-wake.js'),'utf8');
const flush=()=>new Promise(r=>setImmediate(r));
const json=data=>({ok:true,json:async()=>data});
function setup(){
 const timers=new Map(),calls=[];let sequence=0;
 const cfg={sessionId:'a',panelKey:'owner',gatewayUrl:'https://fixture.invalid'};
 const c={Date,Promise,AbortController,Number,Math,String,Object,Array,console,
  cfg,chatSessions:[{id:'a'},{id:'b'}],chatLoadConfig:()=>c.cfg,chatEndpoint:cfg=>cfg.gatewayUrl+'/chat',
  chatScheduleSessionSave(){},toast(){},chatPollingEnabledForConfig:()=>false,providerNormalizeCacheStrategy:s=>s,
  document:{getElementById:()=>null,addEventListener(){}},localStorage:{getItem:()=>null},
  setInterval(){},setTimeout(fn,ms){const id=++sequence;timers.set(id,{fn,ms});return id},clearTimeout:id=>timers.delete(id),
  fetch:(url,options)=>new Promise((resolve,reject)=>calls.push({url,options,resolve,reject}))};
 vm.createContext(c);vm.runInContext(source,c);
 return {c,cfg,calls,timers,expire(){for(const t of [...timers.values()])t.fn()}};
}
test('countdown follows the server schedule, including expiry and disabled states',()=>{
 const {c}=setup(),state={enabled:true,next_at:1240};
 assert.equal(c.chatWakeCountdown(state,1000000),'04:00');
 assert.equal(c.chatWakeCountdown(state,1001000),'03:59');
 assert.equal(c.chatWakeCountdown(state,1240000),'00:00');
 assert.equal(c.chatWakeCountdown(state,1500000),'00:00');
 assert.equal(c.chatWakeCountdown({enabled:true,next_at:4540},1000000),'59:00');
 for(const change of [{enabled:false},{status:'waiting_chat'},{status:'unsupported'},{next_at:NaN},{next_at:0}]){
  assert.equal(c.chatWakeCountdown({...state,...change},1000000),'--:--');
 }
});
test('saving is independent of a slow GET and rejects its late value or error',async()=>{
 for(const fails of [false,true]){
  const {c,calls}=setup();const read=c.chatWakeRefresh();c.chatWakeRefresh();assert.equal(calls.length,1);
  const write=c.chatWakeSave({enabled:true});assert.equal(calls.length,2);
  calls[1].resolve(json({ok:true,enabled:true}));await write;
  if(fails)calls[0].reject(Error('old connection'));else calls[0].resolve(json({ok:true,enabled:false}));
  await read;assert.equal(c.chatWakeState.a.enabled,true);assert.equal(c.chatWakeState.a.sync_error,undefined);
  assert.equal(c.chatSessions[0].wakeEnabled,true);assert.equal(c.chatWakeWriteBusy,false);
 }
});
test('different windows refresh independently and an earlier completion cannot clear the new request',async()=>{
 const {c,calls}=setup();const a=c.chatWakeRefresh();
 c.cfg={...c.cfg,sessionId:'b'};const b=c.chatWakeRefresh();assert.equal(calls.length,2);
 assert(new URL(calls[0].url).searchParams.get('session_id')==='a');
 calls[0].resolve(json({ok:true,enabled:true}));await a;assert.equal(c.chatWakeBusy,true);
 calls[1].resolve(json({ok:true,enabled:false}));await b;
 assert.equal(c.chatWakeState.a.enabled,true);assert.equal(c.chatWakeState.b.enabled,false);assert.equal(c.chatWakeBusy,false);
});
test('responses from an old account or gateway never enter current state',async()=>{
 for(const patch of [{panelKey:'new-owner'},{gatewayUrl:'https://other.invalid'}])for(const fails of [false,true]){
  const {c,calls}=setup();const read=c.chatWakeRefresh();c.cfg={...c.cfg,...patch};
  if(fails)calls[0].reject(Error('old connection'));else calls[0].resolve(json({ok:true,enabled:true}));
  await read;assert.equal(c.chatWakeState.a,undefined);assert.equal(c.chatSessions[0].wakeEnabled,undefined);
 }
});
test('GET and save release their busy flags even when a suspended fetch ignores AbortSignal',async()=>{
 for(const write of [false,true]){
  const x=setup(),pending=write?x.c.chatWakeSave({enabled:true}):x.c.chatWakeRefresh();
  x.expire();await pending;
  assert.equal(x.c.chatWakeBusy,false);assert.equal(x.c.chatWakeWriteBusy,false);assert.equal(x.timers.size,0);
  assert.equal(x.calls[0].options.signal.aborted,true);
  const next=x.c.chatWakeRefresh();assert.equal(x.calls.length,2);x.calls[1].resolve(json({ok:true,enabled:false}));await next;
 }
});
test('a response body that never arrives also times out',async()=>{
 const x=setup(),pending=x.c.chatWakeRefresh();x.calls[0].resolve({ok:true,json:()=>new Promise(()=>{})});
 await flush();x.expire();await pending;assert.equal(x.c.chatWakeBusy,false);assert.equal(x.timers.size,0);
});
