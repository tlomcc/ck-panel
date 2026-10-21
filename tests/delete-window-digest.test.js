const {test}=require('node:test');
const assert=require('node:assert/strict'),fs=require('fs'),vm=require('vm');
const history=require('../chat-history.js'),copy=x=>JSON.parse(JSON.stringify(x));
function setup(){
  let now=Date.parse('2026-10-14T23:59:00+08:00'),choice='summarize',answer,saveFailure=false;
  const cfg={gatewayUrl:'https://fixture.invalid',panelKey:'fixture',dailyDigestEnabled:true,dailyDigestRetentionDays:7,dailyDigestDetailDays:3,dailyDigestRollupDays:0};
  const turn=(id,ts=now)=>[{role:'user',text:'问题 '+id,ts,turnId:id},{role:'assistant',text:'答复 '+id,ts:ts+1,turnId:id}];
  const source={id:'temp',title:'临时对话',messages:[...turn('old'),...turn('new')],dailyDigests:[],transportMessages:[]};
  const target={id:'main',title:'小克',messages:turn('main'),dailyDigests:[{dayKey:'2026-10-14',text:'主窗口已有总结',startTs:now,endTs:now,covered:[]}]};
  const other={id:'other',title:'其它',messages:turn('other'),dailyDigests:[]};
  const storage=new Map(),saved=new Map(),calls=[],events=[],messages=[];
  const ctx={console,Promise,AbortController,setTimeout,clearTimeout,setInterval,clearInterval,
    Date:class extends Date{constructor(...a){super(...(a.length?a:[now]))}static now(){return now}},
    CKChatHistory:history,CHAT_DAILY_DIGEST_TIMEOUT_MS:1000,chatSending:false,chatTrimBusy:false,chatTrimTransaction:null,
    chatSessionsReady:true,chatIndexedDbFailed:false,chatIndexedDbSupported:()=>true,
    chatSessions:[source,target,other],chatActiveSessionId:source.id,chatMessages:source.messages,chatDeletedSessionIds:{},
    chatLoadConfig:()=>cfg,chatSaveConfigObject:()=>{},chatCurrentSession:()=>ctx.chatSessions.find(s=>s.id===ctx.chatActiveSessionId),
    document:{getElementById:()=>null},localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)},
    chatSaveSessionsToIndexedDb:{pending:Promise.resolve()},
    chatSaveSessions:()=>{ctx.chatSaveSessionsToIndexedDb.pending=Promise.resolve().then(()=>{if(saveFailure){ctx.chatIndexedDbFailed=true;return}ctx.chatSessions.forEach(s=>saved.set(s.id,copy(s)))})},
    chatSplitThinkingText:t=>({text:t.replace(/<thinking>[\s\S]*?<\/thinking>/g,'')}),
    chatDebug:(name,data)=>events.push({name,data}),chatSetStatus:m=>messages.push(m),toast:m=>messages.push(m),
    chatFlushAssistantRevealQueue:()=>{},chatWakeForget:async()=>true,ckChooseDialog:async()=>choice,ckConfirmDialog:async()=>true,
    chatRenderSessions:()=>{},chatRenderMessages:()=>{},chatUpdateRuntime:()=>{},
    fetch:async(url,init)=>{const body=JSON.parse(init.body);calls.push(body);return answer?answer(body):{ok:true,json:async()=>({ok:true,prepared:true,text:'整理后的 '+body.messages.map(m=>m.text).join(' / ')})}}
  };
  vm.createContext(ctx);
  for(const name of ['chat-digest.js','chat-digest-activation.js','chat-digest-schedule.js','chat-delete-digest.js'])vm.runInContext(fs.readFileSync(require.resolve('../'+name),'utf8'),ctx);
  const script=fs.readFileSync(require.resolve('../script.js'),'utf8');vm.runInContext(script.slice(script.indexOf('async function chatDeleteSession('),script.indexOf('\nfunction chatSelectSession(')),ctx);
  const realSync=ctx.chatSyncNightlyDigest;
  ctx.chatSyncNightlyDigest=async(c,o)=>{delete o.session.digestManualPending;return true};
  ctx.chatScheduleNightlySync=()=>{};ctx.chatRenderDailyDigest=()=>{};ctx.chatDigestForgetSession=id=>events.push({name:'delete',id});
  return {ctx,cfg,source,target,other,calls,saved,events,messages,turn,realSync,choice:v=>choice=v,reply:v=>answer=v,failSave:()=>saveFailure=true,advance:ms=>now+=ms,run:()=>ctx.chatDeleteSession(source.id)};
}
test('only unsummarized chat goes into today; durable main precedes deletion and raw main is unchanged',async()=>{
  const x=setup(),old=x.ctx.chatDigestMessageGroups(x.source.messages)[0];
  x.source.dailyDigests=[{dayKey:'2026-10-14',text:'已有临时总结',covered:[old.key]}];
  const mainRaw=copy(x.target.messages),other=copy(x.other);
  x.ctx.chatWakeForget=async()=>{assert.match(x.saved.get('main').dailyDigests[0].text,/问题 new/);assert(!x.events.some(e=>e.name==='delete'));return true};
  await x.run();assert.equal(x.calls.length,1);assert.equal(x.calls[0].mode,'daily_part');assert.equal(x.calls[0].trigger,'window_delete');assert.equal(x.calls[0].tz_offset_minutes,480);
  assert(!JSON.stringify(x.calls).includes('问题 old'));assert.match(x.target.dailyDigests[0].text,/主窗口已有总结/);
  assert.equal(x.ctx.chatSessions.length,2);assert.equal(x.ctx.chatActiveSessionId,'main');assert.deepEqual(x.target.messages,mainRaw);assert.deepEqual(x.other,other);
  assert.match(x.ctx.chatDailyDigestPack(x.cfg,x.target),/问题 new/);assert.equal(x.target.digestManualPending,undefined);
});
test('direct delete and cancel never call the model, main uses normal delete confirmation',async()=>{
  for(const value of ['delete',null]){const x=setup();x.choice(value);await x.run();assert.equal(x.calls.length,0);assert.equal(x.ctx.chatSessions.length,value==='delete'?2:3)}
  const x=setup();x.ctx.ckChooseDialog=()=>{throw Error('main must not see handoff choices')};await x.ctx.chatDeleteSession('main');assert.equal(x.ctx.chatSessions.length,2);assert.equal(x.calls.length,0);
});
test('absent/ambiguous main, disabled summaries, unsaved edits, incomplete history and busy replies preserve source',async()=>{
  for(const change of [x=>x.target.title='其它名称',x=>x.ctx.chatSessions.push({...x.target,id:'second-main'}),x=>x.cfg.dailyDigestEnabled=false,
    x=>x.ctx.chatDigestEditors['main:today']={text:'草稿'},x=>x.ctx.chatSessionsReady=false,x=>x.source.messages[0].inFlight=true,
    x=>x.source.messages.push({role:'pending_user',text:'尚未发送'}),x=>x.ctx.chatIndexedDbFailed=true]){
    const x=setup();change(x);await x.run();assert(x.ctx.chatSessions.includes(x.source));assert.equal(x.calls.length,0);assert.equal(x.ctx.chatDeleteDigestBusy,false);
  }
});
test('all dates, pending archives, long messages and stripped thinking; no cutoff by retention or chunk size',async()=>{
  const x=setup();x.source.messages=[...x.turn('ancient',Date.parse('2020-01-01')), ...x.turn('long')];
  x.source.messages[2].text='文'.repeat(31000);x.source.messages[3].text='<thinking>秘密</thinking>最终答复';x.ctx.chatMessages=x.source.messages;
  x.source.digestPending=x.ctx.chatDigestMessageGroups(x.turn('archived',Date.parse('2019-01-01')));
  await x.run();assert.equal(x.calls.length,1);assert(x.calls.every(c=>c.day_key==='2026-10-14'));
  const texts=x.calls.flatMap(c=>c.messages.map(m=>m.text));assert.equal(texts.join('').split('文').length-1,31000);assert(texts.includes('问题 ancient'));assert(texts.includes('问题 archived'));assert(!texts.join('').includes('秘密'));
});
test('partial batch failure keeps source and resumes completed checkpoints exactly once',async()=>{
  const x=setup();x.source.messages[0].text='长'.repeat(40000);x.source.messages[1].text='续'.repeat(40000);let n=0;
  x.reply(async b=>({ok:++n!==2,json:async()=>n===2?{ok:false,error:'fixture failure'}:{ok:true,prepared:true,text:'批次 '+n}}));
  await x.run();assert(x.ctx.chatSessions.includes(x.source));assert.equal(x.target.dailyDigests[0].text,'主窗口已有总结');assert.equal(x.source.digestWork.results.length,1);
  x.reply(null);await x.run();assert(!x.ctx.chatSessions.includes(x.source));assert.equal(x.calls.length,3);assert.equal((x.target.dailyDigests[0].text.match(/批次 1/g)||[]).length,1);
});
test('incomplete output, cancellation and persistence failure never delete the source',async()=>{
  for(const type of ['salvaged','cancelled','storage']){
    const x=setup();x.reply(async()=>{if(type==='cancelled')x.ctx.chatCancelDigestWork();if(type==='storage')x.failSave();return {ok:true,json:async()=>({ok:true,prepared:true,text:'总结',salvaged:type==='salvaged'})}});
    await x.run();assert(x.ctx.chatSessions.includes(x.source));assert(!x.events.some(e=>e.name==='delete'));assert.equal(x.ctx.chatTrimBusy,false);assert.equal(x.ctx.chatActiveDigestJob,null);
  }
});
test('source, target or gateway changes while the model runs cannot delete or overwrite',async()=>{
  for(const change of [x=>x.source.messages.push(...x.turn('arrived')),x=>x.target.dailyDigests[0].text='刚编辑的总结',x=>x.cfg.gatewayUrl='https://other.invalid']){
    const x=setup();x.reply(async()=>{change(x);return {ok:true,json:async()=>({ok:true,prepared:true,text:'旧结果'})}});await x.run();
    assert(x.ctx.chatSessions.includes(x.source));assert(!x.target.dailyDigests[0].text.includes('旧结果'));
  }
});
test('cleanup failure after commit retries without a second model call or duplicate text, even after reload',async()=>{
  const x=setup();x.ctx.chatWakeForget=async()=>false;await x.run();assert(x.ctx.chatSessions.includes(x.source));const text=x.target.dailyDigests[0].text;
  const reload=copy(x.saved.get('main'));Object.assign(x.target,reload);x.ctx.chatWakeForget=async()=>true;await x.run();
  assert.equal(x.calls.length,1);assert.equal(x.target.dailyDigests[0].text,text);assert(!x.ctx.chatSessions.includes(x.source));
});
test('midnight handoff is assigned to the actual save date; prior days remain intact',async()=>{
  const x=setup();x.reply(async()=>{x.advance(120000);return {ok:true,json:async()=>({ok:true,prepared:true,text:'跨日内容'})}});await x.run();
  assert.equal(x.target.dailyDigests.length,2);assert.equal(x.target.dailyDigests[0].text,'主窗口已有总结');assert.equal(x.target.dailyDigests[1].dayKey,'2026-10-15');assert.match(x.target.dailyDigests[1].text,/跨日内容/);
});
test('prepared main summaries and raw transport-only history are preserved',async()=>{
  const x=setup(),cfgStamp=x.ctx.chatDigestConfigStamp(x.cfg),scope=x.ctx.chatNightlyScope(x.cfg);
  x.target.digestStaged={scope,config:cfgStamp,base:{entries:[{dayKey:'2026-10-14',text:'后台最新总结',covered:[]}],rollup:null,omitted:[]},revision:3};
  x.source.transportMessages=[{role:'user',content:'仅传输历史问题'},{role:'assistant',content:'仅传输历史答案'},...x.source.messages.map(m=>({role:m.role,content:m.text}))];
  await x.run();assert.match(x.target.dailyDigests[0].text,/后台最新总结/);assert(x.calls.flatMap(c=>c.messages).some(m=>m.text==='仅传输历史问题'));
  assert.equal(x.calls.flatMap(c=>c.messages).filter(m=>m.text==='问题 new').length,1);
});
test('server sync failure preserves both the handoff and source; a later retry sends no model request',async()=>{
  const x=setup();let count=0;x.ctx.chatSyncNightlyDigest=async()=>++count===1;await x.run();assert(x.ctx.chatSessions.includes(x.source));assert.match(x.target.dailyDigests[0].text,/问题 new/);
  x.ctx.chatSyncNightlyDigest=async(c,o)=>{delete o.session.digestManualPending;return true};await x.run();assert.equal(x.calls.length,1);assert(!x.ctx.chatSessions.includes(x.source));
});
test('existing queue publication acknowledges the appended main base before deletion',async()=>{
  const x=setup();x.ctx.chatSyncNightlyDigest=x.realSync;x.ctx.chatRenderNightlyStatus=()=>{};x.ctx.chatRenderTrimState=()=>{};
  x.ctx.chatWindowTrimConfigFromSession=()=>null;x.ctx.chatAutoTrimConfigFrom=()=>({enabled:false,roundLimitEnabled:false,keep:40,minimum:30});x.ctx.chatCacheActivityReference=()=>({timestamp:0});
  const fetch=x.ctx.fetch;let acknowledged=false;
  x.ctx.fetch=async(url,init)=>{if(!url.includes('/queue'))return fetch(url,init);const b=JSON.parse(init.body);assert.equal(b.session_id,'main');if(b.manual_override){assert.match(b.base.entries[0].text,/问题 new/);acknowledged=true}return {ok:true,json:async()=>({ok:true,accepted_keys:[],snapshot:{revision:2,source_stamp:b.base_stamp,base:b.base,config:b.config,result:null}})}};
  x.ctx.chatWakeForget=async()=>{assert(acknowledged);assert.equal(x.target.digestManualPending,undefined);return true};await x.run();assert(!x.ctx.chatSessions.includes(x.source));assert.equal(x.target.digestRemote.revision,2);
});
test('new chat during final publication survives and a retry only summarizes the additional turn',async()=>{
  const x=setup();let count=0;
  x.ctx.chatSyncNightlyDigest=async(c,o)=>{if(++count===2)x.source.messages.push(...x.turn('late'));delete o.session.digestManualPending;return true};
  await x.run();assert(x.ctx.chatSessions.includes(x.source));assert.equal(x.calls.length,1);
  await x.run();assert(!x.ctx.chatSessions.includes(x.source));assert.equal(x.calls.length,2);assert.deepEqual(x.calls[1].messages.map(m=>m.text),['问题 late','答复 late']);
});
test('main synchronization failure or an unknown device conflict stops before any model request',async()=>{
  for(const conflict of [false,true]){const x=setup();x.ctx.chatSyncNightlyDigest=async()=>{if(conflict)x.target.digestRemoteConflict={revision:4};return conflict};await x.run();assert(x.ctx.chatSessions.includes(x.source));assert.equal(x.calls.length,0)}
});
