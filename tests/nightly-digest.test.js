const {test}=require('node:test');
const assert=require('node:assert/strict'),fs=require('fs'),vm=require('vm');
const history=require('../chat-history.js');
const copy=value=>JSON.parse(JSON.stringify(value));
function setup(){
  let now=Date.parse('2026-10-04T04:00:00+08:00'),sequence=0;
  const storage=new Map(),timers=new Map(),calls=[];
  const cfg={panelKey:'fixture-key',gatewayUrl:'https://fixture.invalid',dailyDigestEnabled:true,dailyDigestRetentionDays:7};
  const session={id:'nightly-one',title:'夜间测试',messages:[{role:'user',text:'她的周末安排',ts:now-10*3600000,turnId:'t1'},{role:'assistant',text:'我记住了。',ts:now-10*3600000+1000,turnId:'t1'}],dailyDigests:[],updated:1};
  const ctx={console,Set,Map,Promise,AbortController,CKChatHistory:history,chatSessionsReady:true,chatSending:false,chatTrimBusy:false,chatTrimTransaction:null,
    Date:class extends Date{static now(){return now}},document:{hidden:false,getElementById:()=>null},
    setTimeout:(callback,delay)=>{timers.set(++sequence,{callback,delay});return sequence},clearTimeout:id=>timers.delete(id),
    localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)},
    chatSessions:[session],chatMessages:session.messages,chatCurrentSession:()=>session,chatLoadConfig:()=>cfg,
    chatSaveSessions:()=>{},chatSplitThinkingText:text=>({text}),chatDebug:()=>{},toast:()=>{},
    fetch:async(url,init={})=>{const body=init.body?JSON.parse(init.body):null;calls.push({url,body,init});return response(body)}
  };
  function response(body){return {ok:true,json:async()=>body?{ok:true,status:'queued',accepted_keys:body.groups.map(g=>g.key),snapshot:{revision:1,source_stamp:body.base_stamp,base:body.base,result:null}}:{ok:true,sessions:[{status:'queued',snapshot:{revision:1,source_stamp:ctx.chatNightlyBaseStamp(cfg,session),base:ctx.chatNightlyBase(session),result:null}}]}}}
  vm.createContext(ctx);
  for(const name of ['chat-digest.js','chat-digest-activation.js','chat-digest-schedule.js'])vm.runInContext(fs.readFileSync(require.resolve('../'+name),'utf8'),ctx);
  ctx.chatRenderDailyDigest=()=>{};ctx.chatRenderNightlyStatus=()=>{};
  return {ctx,cfg,session,calls,storage,timers,advance:ms=>now+=ms,response,sync:()=>ctx.chatSyncNightlyDigest(cfg)};
}
function result(x,body,revision=2){
  return {ok:true,status:'succeeded',accepted_keys:body.groups.map(g=>g.key),snapshot:{revision,source_stamp:body.base_stamp,
    base:{entries:[{dayKey:'2026-10-03',startTs:x.session.messages[0].ts,endTs:x.session.messages[1].ts,text:'我记下了她的安排。',covered:body.groups.map(g=>g.key)}],rollup:null,omitted:[]},result:{day:'2026-10-04'}}};
}
test('Shanghai preparation runs all day starting at midnight',()=>{
  const x=setup();
  for(const [time,expected] of [['00:00:00',true],['03:59:59',true],['07:00:00',true],['23:59:59',true]])assert.equal(x.ctx.chatNightlyWindow(Date.parse('2026-10-04T'+time+'+08:00')).inWindow,expected);
});
test('trimming archives complete sources durably before any network work',()=>{
  const x=setup();assert.equal(x.ctx.chatArchiveDigestSources(x.session,x.session.messages),true);
  assert.equal(x.calls.length,0);assert.equal(x.session.messages.length,2);
  const queued=JSON.parse([...x.storage.values()][0]);assert.equal(queued.length,1);assert.equal(queued[0].messages[0].text,'她的周末安排');
  x.ctx.chatArchiveDigestSources(x.session,x.session.messages);assert.equal(x.session.digestPending.length,1);
});
test('storage failure leaves the original chat available',()=>{
  const x=setup(),before=copy(x.session);x.ctx.localStorage.setItem=()=>{throw Error('quota')};
  assert.equal(x.ctx.chatArchiveDigestSources(x.session,x.session.messages),false);assert.deepEqual(copy(x.session),before);assert.equal(x.calls.length,0);
});
test('disabling summaries is sent for every session, without generating summaries',async()=>{
  const x=setup();x.ctx.chatSessions.push({...copy(x.session),id:'nightly-two'});x.cfg.dailyDigestEnabled=false;
  x.ctx.chatNightlySettingsPriority(x.cfg);await x.ctx.chatMaybeRollDigestAtDayBoundary();
  assert.equal(x.calls.length,2);
  for(const call of x.calls){assert.match(call.url,/\/queue\?/);assert.equal(call.body.config.enabled,false);assert.equal(call.body.settings_override,true);}
});
test('chat activity defers synchronization immediately',async()=>{
  const x=setup();x.ctx.chatSending=true;assert.equal(await x.sync(),false);assert.equal(x.calls.length,0);assert.ok(x.timers.size);
});
test('acknowledgement clears only sources durably accepted by the server',async()=>{
  const x=setup();x.ctx.chatArchiveDigestSources(x.session,x.session.messages);let finish;
  x.ctx.fetch=async()=>new Promise(r=>finish=r);const work=x.sync();
  const fresh=[{role:'user',text:'后来补充',ts:x.session.messages[1].ts+2000,turnId:'t2'}];
  const first=x.ctx.chatNightlyPending(x.session)[0];x.ctx.chatArchiveDigestSources(x.session,fresh);
  finish({ok:true,json:async()=>({ok:true,status:'queued',accepted_keys:[first.key]})});await work;
  assert.equal(x.session.digestPending.length,1);assert.equal(x.session.digestPending[0].messages[0].text,'后来补充');
});
test('a nightly result arriving during chat waits until the chat finishes',async()=>{
  const x=setup();let finish,body;x.ctx.fetch=async(u,o)=>{body=JSON.parse(o.body);return new Promise(r=>finish=r)};
  const work=x.sync();x.ctx.chatSending=true;const payload=result(x,body);finish({ok:true,json:async()=>payload});await work;
  assert.equal(x.session.dailyDigests.length,0);
  x.ctx.chatSending=false;x.ctx.fetch=async()=>({ok:true,json:async()=>payload});await x.sync();
  assert.equal(x.session.dailyDigests.length,0);assert.equal(x.session.digestStaged.revision,2);
  assert.equal(x.ctx.chatDigestActivate(x.session,x.cfg,false),true);assert.equal(x.session.dailyDigests[0].text,'我记下了她的安排。');
});
test('an open summary editor is never replaced by a background result',async()=>{
  const x=setup();x.ctx.chatDigestEditors[x.session.id+':detail']={value:'草稿'};
  x.ctx.fetch=async(u,o)=>({ok:true,json:async()=>result(x,JSON.parse(o.body))});await x.sync();
  assert.equal(x.session.dailyDigests.length,0);assert.equal(x.ctx.chatDigestEditors[x.session.id+':detail'].value,'草稿');
});
test('explicit manual edits carry durable priority until acknowledged',async()=>{
  const x=setup();x.ctx.chatNightlyManualPriority(x.session);let body;
  x.ctx.fetch=async(u,o)=>{body=JSON.parse(o.body);return {ok:true,json:async()=>({ok:true,status:'queued',snapshot:{revision:5,source_stamp:body.base_stamp,base:body.base,result:null}})}};
  await x.sync();assert.equal(body.manual_override,true);assert.equal(x.session.digestManualPending,undefined);assert.equal(x.session.digestRemote.revision,5);
});
test('normal date pruning can adopt an advanced known result without losing manual drafts',async()=>{
  const x=setup();x.session.digestRemote={scope:x.ctx.chatNightlyScope(x.cfg),revision:1};
  x.ctx.fetch=async(u,o)=>{const payload=result(x,JSON.parse(o.body));payload.conflict=true;payload.snapshot.source_stamp='yesterday';return {ok:true,json:async()=>payload}};
  assert.equal(await x.sync(),true);assert.equal(x.session.dailyDigests.length,0);assert.equal(x.session.digestStaged.revision,2);assert.equal(x.session.digestRemoteConflict,undefined);
});
test('an unknown device conflict is visible and preserves local content',async()=>{
  const x=setup();x.ctx.fetch=async(u,o)=>{const payload=result(x,JSON.parse(o.body));payload.conflict=true;payload.snapshot.source_stamp='another-device';return {ok:true,json:async()=>payload}};
  assert.equal(await x.sync(),false);assert.equal(x.session.dailyDigests.length,0);assert.equal(x.session.digestRemoteConflict.revision,2);
});
test('stale responses cannot update a different principal',async()=>{
  const x=setup();let finish,body;x.ctx.fetch=async(u,o)=>{body=JSON.parse(o.body);return new Promise(r=>finish=r)};
  const work=x.sync();x.cfg.panelKey='different-key';finish({ok:true,json:async()=>result(x,body)});await work;
  assert.equal(x.session.dailyDigests.length,0);assert.equal(x.session.digestRemote,undefined);assert.equal(Object.keys(x.ctx.chatNightlyStatus).length,0);
});
test('unchanged sources use a low frequency GET instead of repeated history uploads',async()=>{
  const x=setup();await x.sync();await x.sync();assert.equal(x.calls.length,1);
  x.advance(61000);await x.sync();assert.equal(x.calls.length,2);assert.equal(x.calls[1].body,null);assert.match(x.calls[1].url,/session_id=nightly-one/);
});
test('network failures retain the outbox and back off before retrying',async()=>{
  const x=setup();x.ctx.chatArchiveDigestSources(x.session,x.session.messages);let count=0;
  x.ctx.fetch=async()=>{count++;throw Error('offline')};await x.sync();await x.sync();assert.equal(count,1);assert.equal(x.session.digestPending.length,1);
  x.advance(31000);await x.sync();assert.equal(count,2);assert.equal(JSON.parse([...x.storage.values()][0]).length,1);
});
test('background completion and midnight do not change the byte-exact active prompt',async()=>{
  const x=setup();x.session.dailyDigests=[{dayKey:'2026-10-03',text:'昨天定稿',covered:[]}];
  const original=x.ctx.chatDailyDigestPack(x.cfg,x.session);x.session.cacheLastReadAt=x.ctx.Date.now();
  x.ctx.fetch=async(u,o)=>({ok:true,json:async()=>result(x,JSON.parse(o.body))});await x.sync();
  assert.equal(x.ctx.chatDailyDigestPack(x.cfg,x.session),original);assert.equal(x.ctx.chatDigestActivate(x.session,x.cfg,false),false);
  x.advance(3599999);assert.equal(x.ctx.chatDigestActivate(x.session,x.cfg,false),false);
  x.advance(1);assert.equal(x.ctx.chatDigestActivate(x.session,x.cfg,false),true);assert.match(x.ctx.chatDailyDigestPack(x.cfg,x.session),/安排/);
  const activated=x.ctx.chatDailyDigestPack(x.cfg,x.session);x.advance(86400000);
  assert.equal(x.ctx.chatDailyDigestPack(x.cfg,x.session),activated);
});
test('renewed reads defer a ready snapshot, including after restoring saved session state',async()=>{
  const x=setup();x.ctx.chatDailyDigestPack(x.cfg,x.session);x.session.cacheLastReadAt=x.ctx.Date.now();
  x.ctx.fetch=async(u,o)=>({ok:true,json:async()=>result(x,JSON.parse(o.body))});await x.sync();
  const restored=copy(x.session);Object.assign(x.session,restored);x.advance(3500000);x.session.cacheLastReadAt=x.ctx.Date.now();x.advance(100001);
  assert.equal(x.ctx.chatDigestActivate(x.session,x.cfg,false),false);assert.equal(x.session.digestActivePack.text,'');
  x.advance(3500000);assert.equal(x.ctx.chatDigestActivate(x.session,x.cfg,false),true);
});
test('canceling immediate sync preserves the active snapshot and shows a cache warning',async()=>{
  const x=setup();x.session.cacheLastReadAt=x.ctx.Date.now();x.ctx.fetch=async(u,o)=>({ok:true,json:async()=>result(x,JSON.parse(o.body))});await x.sync();
  let prompt;x.ctx.ckConfirmDialog=async(message,options)=>{prompt={message,options};return false};
  assert.equal(await x.ctx.chatDigestSyncNow(),false);assert.match(prompt.message,/打断现有缓存/);assert.equal(x.session.dailyDigests.length,0);assert.ok(x.session.digestStaged);
});
