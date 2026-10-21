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
    chatWindowTrimConfigFromSession:()=>null,chatAutoTrimConfigFrom:()=>({enabled:true,keep:40,minimum:30}),chatCacheActivityReference:(s,last)=>({timestamp:Math.max(s.cacheFullCreatedAt||0,s.cacheLastReadAt||0,last||0)}),
    chatSessions:[session],chatMessages:session.messages,chatCurrentSession:()=>session,chatLoadConfig:()=>cfg,
    chatSaveSessions:()=>{},chatRenderTrimState:()=>{},chatSplitThinkingText:text=>({text}),chatDebug:()=>{},toast:()=>{},
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

test('wake GET bypasses throttle and stages the finished result without acknowledging unsent edits',async()=>{
  const x=setup();await x.sync();const original=x.calls[0].body;
  x.session.title='本机尚未上传的标题';
  x.ctx.fetch=async(url,init)=>{
    assert.equal(init.method,undefined);assert.equal(init.body,undefined);
    return {ok:true,json:async()=>({ok:true,sessions:[result(x,original)]})};
  };
  assert.equal(await x.ctx.chatRefreshPreparedDigest(x.cfg,x.session),true);
  assert(x.session.digestStaged);assert.equal(x.session.dailyDigests.length,0);
  let posted=false;x.ctx.fetch=async(url,init)=>{posted=init.method==='POST';return x.response(JSON.parse(init.body))};
  await x.sync();assert(posted,'read-only refresh falsely acknowledged a local change');
});

test('an extra failed local turn does not rename already summarized transport turns',()=>{
  const x=setup(),old=x.ctx.chatDigestMessageGroups(x.session.messages)[0];
  x.session.transportMessages=x.session.messages.map(m=>({role:m.role,content:m.text}));
  x.session.messages.push({role:'user',text:'尚未完成的另一轮',ts:Date.now(),turnId:'failed',sendFailed:true});
  const groups=x.ctx.chatDigestTransportSources(x.session,x.session.messages,[old],1);
  assert.equal(groups.length,1);assert.equal(groups[0].key,old.key);
  x.session.transportMessages[1].content='不同内容';
  const changed=x.ctx.chatDigestTransportSources(x.session,x.session.messages,[old],1);
  assert.equal(changed.length,2,'changed transport content must still require separate proven coverage');
});

test('expanding x waits for compact summaries instead of freezing a 24k source fallback',()=>{
  const x=setup();x.cfg.dailyDigestDetailDays=3;x.cfg.dailyDigestRollupDays=0;
  const raw='详细底稿'.repeat(6000);
  x.session.dailyDigests=[{dayKey:'2026-10-02',text:raw}];
  x.session.digestActivePack={scope:x.ctx.chatDigestActiveScope(x.cfg),text:'已启用的五千字摘要',at:1};
  assert.equal(x.ctx.chatDigestResetPack(x.cfg,x.session),false);
  assert.equal(x.ctx.chatDailyDigestPack(x.cfg,x.session),'已启用的五千字摘要');
  x.session.dailyDigests[0].detail={source:x.ctx.chatDigestStamp(raw),text:'压缩后摘要'};
  assert.equal(x.ctx.chatDigestResetPack(x.cfg,x.session),true);
  assert.match(x.ctx.chatDailyDigestPack(x.cfg,x.session),/压缩后摘要/);
  assert.ok(!x.ctx.chatDailyDigestPack(x.cfg,x.session).includes(raw));
});

test('reviewed subscription summaries above X and Y suggestions activate and upload intact',async()=>{
  const x=setup();x.cfg.digestCurrentModel=true;x.cfg.executionBackend='claude_code_subscription';
  x.cfg.dailyDigestDetailDays=1;x.cfg.dailyDigestRollupDays=2;
  const raw='详细来源'.repeat(2000),longX='近期摘要'.repeat(1200)+'近期尾部保留。',longY='较早摘要'.repeat(800)+'较早尾部保留。';
  x.session.dailyDigests=[{dayKey:'2026-10-03',text:raw,detail:{source:x.ctx.chatDigestStamp(raw),text:longX}},
    {dayKey:'2026-10-02',text:'较早来源'}];
  x.session.digestRollup={start:'2026-10-01',end:'2026-10-02',text:longY,source:x.ctx.chatDigestRollupSource(x.cfg,x.session).stamp};
  assert.equal(x.ctx.chatDigestPackReady(x.cfg,x.session),true);
  assert.equal(x.ctx.chatDigestResetPack(x.cfg,x.session),true);
  const pack=x.ctx.chatDailyDigestPack(x.cfg,x.session);
  assert.ok(pack.includes(longX));assert.ok(pack.includes(longY));
  await x.sync();const base=x.calls[0].body.base;
  assert.equal(base.entries[0].text,'较早来源');assert.equal(base.entries[1].detail.text,longX);assert.equal(base.rollup.text,longY);
});
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
test('chat activity permits background synchronization without changing the active summary',async()=>{
  const x=setup();x.ctx.chatSending=true;assert.equal(await x.sync(),true);assert.equal(x.calls.length,1);assert.equal(x.session.dailyDigests.length,0);
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

test('lost upload response recovers the saved summary with GET before resending sources',async()=>{
  const x=setup();x.ctx.chatArchiveDigestSources(x.session,x.session.messages);
  let uploaded,reads=0;
  x.ctx.fetch=async(u,o)=>{uploaded=JSON.parse(o.body);throw new TypeError('Failed to fetch')};
  assert.equal(await x.sync(),false);
  assert.equal(x.session.digestPending.length,1);
  x.advance(31000);
  x.ctx.fetch=async(u,o)=>{
    reads++;assert.equal(o.method,undefined);assert.equal(o.body,undefined);
    const saved=result(x,uploaded);delete saved.accepted_keys;
    return {ok:true,json:async()=>({ok:true,sessions:[saved]})};
  };
  assert.equal(await x.sync(),true);assert.equal(reads,1);
  assert.equal(x.session.digestStaged.revision,2);
  assert.equal(x.session.dailyDigests.length,0,'recovery must not publish during a warm cache');
  assert.equal(x.session.digestPending.length,1,'GET must not acknowledge an unconfirmed source upload');
  x.session.messages.push({role:'user',text:'上传之后的新消息',ts:x.ctx.Date.now(),turnId:'new'});
  let next;x.ctx.fetch=async(u,o)=>{next=JSON.parse(o.body);return x.response(next)};
  await x.sync();assert(next,'later local changes still need a real upload');
});

test('send stops waiting at 2.5 seconds but a slower summary download still stages its result',async()=>{
  const x=setup();await x.sync();const original=x.calls[0].body;let finish,signal;
  x.ctx.fetch=async(u,o)=>{signal=o.signal;return new Promise(r=>finish=r)};
  const work=x.ctx.chatRefreshPreparedDigest(x.cfg,x.session);
  const wait=[...x.timers.values()].find(t=>t.delay===2500);assert(wait);
  wait.callback();assert.equal(await work,false);assert.equal(signal.aborted,false);
  finish({ok:true,json:async()=>({ok:true,sessions:[result(x,original)]})});
  await Promise.all([...x.ctx.chatNightlySyncs.values()]);
  assert.equal(x.session.digestStaged.revision,2);assert.equal(x.session.dailyDigests.length,0);
});

test('failed polling preserves the known upload signature instead of uploading history again',async()=>{
  const x=setup();await x.sync();x.advance(61000);
  x.ctx.fetch=async(u,o)=>{assert.equal(o.body,undefined);throw new TypeError('Failed to fetch')};
  assert.equal(await x.sync(),false);x.advance(31000);
  x.ctx.fetch=async(u,o)=>{assert.equal(o.body,undefined);return x.response(null)};
  assert.equal(await x.sync(),true);
});

test('snapshot processing errors remain distinct from network failures and hide credentials',async()=>{
  const x=setup();x.ctx.chatApplyWindowCleanup=async()=>{throw new Error('bad '+x.cfg.panelKey+' https://example.invalid/?key=private')};
  assert.equal(await x.sync(),false);
  const message=x.ctx.chatNightlyStatus[x.session.id].local_error;
  assert.match(message,/页面处理失败/);assert(!message.includes(x.cfg.panelKey));assert(!message.includes('private'));
});

test('changing XY during an upload rejects the old range and queues the new settings',async()=>{
  const x=setup();let finish,body;
  x.ctx.fetch=async(u,o)=>{body=JSON.parse(o.body);return new Promise(r=>finish=r)};
  const work=x.sync();
  x.cfg.dailyDigestDetailDays=2;x.cfg.dailyDigestRollupDays=0;
  x.ctx.chatNightlySettingsPriority(x.cfg);
  const old=result(x,body);old.snapshot.config=body.config;
  finish({ok:true,json:async()=>old});
  assert.equal(await work,false);assert.equal(x.session.digestStaged,undefined);
  assert.equal(x.session.digestSettingsPending,x.ctx.chatNightlyScope(x.cfg));
  assert.ok([...x.timers.values()].some(t=>t.delay===0));
});

test('accepted XY changes preserve a newer server baseline on the next upload',async()=>{
  const x=setup();x.cfg.dailyDigestDetailDays=2;x.cfg.dailyDigestRollupDays=0;x.ctx.chatNightlySettingsPriority(x.cfg);
  const serverBase={entries:[{dayKey:'2026-10-02',text:'后台刚保存的新底稿',covered:['archived']}],rollup:null,omitted:[]};
  let firstBody;
  x.ctx.fetch=async(u,o)=>{firstBody=JSON.parse(o.body);return {ok:true,json:async()=>({ok:true,conflict:true,settings_accepted:true,status:'queued',snapshot:{revision:8,config:firstBody.config,source_stamp:'server-newer',base:serverBase,result:null}})}};
  assert.equal(await x.sync(),true);
  assert.deepEqual(copy(x.ctx.chatNightlyBase(x.session)),serverBase);
  assert.equal(x.session.digestRemote.revision,8);assert.equal(x.session.digestRemoteConflict,undefined);
  x.session.updated++;let nextBody;
  x.ctx.fetch=async(u,o)=>{nextBody=JSON.parse(o.body);return {ok:true,json:async()=>({ok:true,status:'queued'})}};
  await x.sync();assert.deepEqual(nextBody.base,serverBase);assert.equal(nextBody.revision,8);
});

test('blank fallback windows do not create background summary jobs',async()=>{
  const x=setup();x.session.messages=[];x.ctx.chatMessages=[];
  assert.equal(await x.sync(),false);assert.equal(x.calls.length,0);
});

test('deletion survives offline reload and retries only under the matching principal',async()=>{
  const x=setup();x.ctx.chatArchiveDigestSources(x.session,x.session.messages);
  x.ctx.fetch=async()=>{throw Error('offline')};x.ctx.chatDigestForgetSession(x.session.id,x.cfg);
  await x.ctx.chatFlushDigestDeletes(x.cfg);
  assert.equal(x.ctx.chatDigestIsDeleted(x.session.id,x.cfg),true);
  assert.equal(x.storage.has(x.ctx.chatNightlyOutboxKey(x.session)),false);
  assert.equal(await x.sync(),false);
  let calls=0;x.ctx.fetch=async(u,o)=>{calls++;assert.equal(JSON.parse(o.body).action,'delete');return {ok:true,json:async()=>({ok:true,deleted:true})}};
  x.cfg.panelKey='other';await x.ctx.chatFlushDigestDeletes(x.cfg);assert.equal(calls,0);
  x.cfg.panelKey='fixture-key';await x.ctx.chatFlushDigestDeletes(x.cfg);assert.equal(calls,1);
  assert.equal(x.ctx.chatDigestDeletionRecords()[0].ack,true);
});

test('an in-flight source upload cannot restore a deleted local session',async()=>{
  const x=setup();let finish,body;x.ctx.fetch=async(u,o)=>{body=JSON.parse(o.body);return new Promise(r=>finish=r)};
  const pending=x.sync();x.ctx.chatSessions=[];
  finish({ok:true,json:async()=>result(x,body)});assert.equal(await pending,false);assert.equal(x.session.digestStaged,undefined);
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
test('immediate sync during an active reply preserves the staged snapshot',async()=>{
  const x=setup();x.session.cacheLastReadAt=x.ctx.Date.now();x.ctx.fetch=async(u,o)=>({ok:true,json:async()=>result(x,JSON.parse(o.body))});await x.sync();
  x.ctx.chatSending=true;
  assert.equal(await x.ctx.chatDigestSyncNow(),false);assert.equal(x.session.dailyDigests.length,0);assert.ok(x.session.digestStaged);
});
