const {test}=require('node:test');
const assert=require('node:assert/strict'),fs=require('fs'),vm=require('vm');
const source=fs.readFileSync(require.resolve('../script.js'),'utf8');
const history=require('../chat-history.js');
function extract(name){let a=source.indexOf('function '+name+'(');assert.ok(a>=0,name);if(source.slice(a-6,a)==='async ')a-=6;return source.slice(a,source.indexOf('\n}',a)+2)}
const tick=()=>new Promise(r=>setImmediate(r));
function setup(){
 let now=new Date('2026-10-03T12:00:00').getTime(),finish;const requests=[];
 const messages=Array.from({length:5},(_,i)=>[{role:'user',text:'问'+i,turnId:'t'+i,ts:now-7200000},{role:'assistant',text:'答'+i,turnId:'t'+i,ts:now-7199000}]).flat();
 const session={id:'s',messages,transportMessages:[],dailyDigests:[],cacheLastReadAt:now-7200000};
 const cfg={dailyDigestEnabled:true,panelKey:'fixture',dailyDigestRetentionDays:3};
 const ctx={console,Set,Map,Promise,AbortController,setTimeout,clearTimeout,setInterval,clearInterval,
 Date:class extends Date{static now(){return now}},CHAT_HISTORY_TOOLS:history,CKChatHistory:history,CHAT_AUTO_TRIM_IDLE_MS:3600000,CHAT_DAILY_DIGEST_TIMEOUT_MS:90000,CHAT_MAX_TRANSPORT_MESSAGES:0,
 chatSplitThinkingText:text=>({text}),document:{getElementById:()=>null},
 chatMessages:messages,chatEditingIndex:-1,chatSessions:[session],chatTrimTransaction:null,chatDailyDigestChain:Promise.resolve(),
 chatCurrentSession:()=>session,chatDailyDigestFindSession:id=>ctx.chatSessions.find(s=>s.id===id),chatLoadConfig:()=>cfg,
 chatAutoTrimConfigFrom:()=>({enabled:true,keep:2,roundLimitEnabled:false,roundLimit:10}),
 chatPendingMessages:()=>ctx.chatMessages.filter(m=>m.role==='pending_user'),chatIsRealMessage:m=>m.role==='user'||m.role==='assistant',
 chatCacheActivityReference:()=>({timestamp:session.cacheLastReadAt,source:'cache_read'}),chatHasCacheNoticeAfter:()=>false,
 chatDailyDigestRequestMessages:list=>list.map(m=>({...m})),chatDailyDigestFirstDay:()=> '2000-01-01',
 chatDailyDigestDayKey:t=>new Date(t).toISOString().slice(0,10),chatDailyDigestNormalize:list=>list||[],
 chatDailyDigestEntries:s=>s.dailyDigests||[],chatDailyDigestEndpoint:()=>'/digest',chatLimitArray:list=>list,
 chatSaveSessions:()=>{},chatRenderSessions:()=>{},chatRenderTrimState:()=>{},chatRenderDailyDigest:()=>{},chatResetSessionAnchorFromMessages:()=>{},
 chatDailyDigestSetStatus:()=>{},chatDebug:()=>{},toast:()=>{},chatShowTrimFailure:(...args)=>ctx.alerts.push(args),alerts:[],chatFriendlyError:e=>e.message,chatSyncTrimmedHistoryToGateway:async()=>true,
 fetch:async(url,opts)=>{requests.push({url,body:JSON.parse(opts.body),signal:opts.signal});return await new Promise(r=>{finish=r})}
 };
 const storage=new Map();ctx.localStorage={getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)};
 vm.createContext(ctx);
 vm.runInContext(fs.readFileSync(require.resolve('../chat-digest.js'),'utf8'),ctx);
 vm.runInContext(fs.readFileSync(require.resolve('../chat-digest-schedule.js'),'utf8'),ctx);ctx.chatScheduleNightlySync=()=>{};
 ctx.chatRenderDailyDigest=()=>{};ctx.chatDailyDigestSetStatus=()=>{};ctx.chatDailyDigestEndpoint=()=>'/digest';
 ['chatAutoTrimRoundCount','chatTimeReminderContext','chatPlanAutoTrimForPendingBatch','chatCommitAutoTrimPlan','chatApplyAutoTrimForPendingBatch'].forEach(n=>vm.runInContext(extract(n),ctx));
 return {ctx,cfg,session,requests,advance:ms=>{now+=ms},reply:data=>finish({ok:true,json:async()=>data}),run:(state=null,opts={idleCheck:true})=>ctx.chatApplyAutoTrimForPendingBatch(cfg,[],state,opts)};
}

test('truncation commits without waiting for summary generation and archives dropped turns',async()=>{
 const x=setup();const first=await x.run();
 assert.equal(first.trimmed,true);assert.equal(x.session.messages.length,4);assert.equal(x.session.dailyDigests.length,0);
 assert.equal(x.session.digestPending.length,3);assert.equal(x.requests.length,0);
 const pending={role:'pending_user',text:'当前消息'};x.ctx.chatMessages.push(pending);
 const second=await x.ctx.chatApplyAutoTrimForPendingBatch(x.cfg,[pending],{});
 assert.equal(second.trimmed,false);assert.equal(second.trigger,'pending_rebuild');assert.equal(x.session.messages.at(-1),pending);
});
test('outbox storage failure skips truncation and preserves the existing prompt',async()=>{
 const x=setup();x.ctx.localStorage.setItem=()=>{throw Error('quota')};
 const result=await x.run();assert.equal(result.trimmed,false);assert.equal(result.cacheBoundary,false);
 assert.equal(x.session.messages.length,10);assert.equal(x.session.dailyDigests.length,0);assert.equal(x.ctx.alerts.length,0);assert.equal(x.requests.length,0);
});
test('a stopped send does not archive or truncate',async()=>{
 const x=setup();assert.equal((await x.run({stopped:true})).trimmed,false);
 assert.equal(x.session.messages.length,10);assert.equal(x.session.digestPending,undefined);assert.equal(x.requests.length,0);
});
test('archived sources remain complete after their chat rows are removed',async()=>{
 const x=setup(),original=JSON.stringify(x.session.messages.slice(0,6));await x.run();
 const archived=x.ctx.chatNightlyPending(x.session).flatMap(g=>g.messages);
 assert.deepEqual(JSON.parse(JSON.stringify(archived)),JSON.parse(original));assert.equal(x.session.messages[0].text,'问3');
});
test('switching windows during gateway acknowledgement preserves both windows',async()=>{
 const x=setup();let finish;x.ctx.chatSyncTrimmedHistoryToGateway=()=>new Promise(r=>finish=r);
 const work=x.run();await tick();const other={id:'other',messages:[{role:'user',text:'另一个窗口'}],dailyDigests:[]};
 x.ctx.chatSessions.push(other);x.ctx.chatCurrentSession=()=>other;x.ctx.chatMessages=other.messages;
 finish(true);await work;assert.equal(x.session.messages.length,4);assert.equal(other.messages.length,1);assert.equal(other.dailyDigests.length,0);assert.equal(x.session.digestPending.length,3);
});
test('disabled summary allows a plain trim; normal rounds never invoke the summary API',async()=>{
 const x=setup();x.cfg.dailyDigestEnabled=false;assert.equal((await x.run()).trimmed,true);assert.equal(x.requests.length,0);
 const y=setup();y.session.cacheLastReadAt=Date.now();assert.equal((await y.run()).trimmed,false);assert.equal(y.requests.length,0);
});
test('fetched models never acquire a previously configured model',async()=>{
 const ctx={panelDataFetch:async()=>({ok:true,json:async()=>({ok:true,models:['new','new','second']})}),PROVIDER_MODELS_URL:'/models',providerNormalizeApiType:()=> 'openai',esc:x=>x,escAttr:x=>x};
 const storage=new Map();ctx.localStorage={getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)};
 vm.createContext(ctx);['cleanModelList','fetchModelsForProvider','modelOptionsHtml'].forEach(n=>vm.runInContext(extract(n),ctx));
 const models=await ctx.fetchModelsForProvider({model:'old',url:'x',key:'fixture'});assert.deepEqual(Array.from(models),['new','second']);
 assert.ok(!ctx.modelOptionsHtml(models,'old').includes('old'));
 ctx.panelDataFetch=async()=>({ok:true,json:async()=>({ok:true,models:[]})});assert.equal((await ctx.fetchModelsForProvider({model:'old'})).length,0);
});
test('idle boundary executes automatically even while viewing a different CK page',async()=>{
 const x=setup();Object.assign(x.ctx,{
   chatIdleTrimBusy:false,chatSending:false,chatTrimBusy:false,chatSessionsReady:true,chatIdleTrimLastCheckAt:0,
   currentPanelTab:'status',chatLastMessageTs:()=>0,chatCurrentConversationRoundCount:()=>5,
   chatSaveLocalMessages:()=>{},chatRenderMessages:()=>{},chatEffectiveCacheStrategy:()=> 'native_stable'
 });
 vm.runInContext(extract('chatMaybeAutoTrimAtIdleBoundary'),x.ctx);
 const work=x.ctx.chatMaybeAutoTrimAtIdleBoundary({forceCheck:true});await tick();
 await work;assert.equal(x.requests.length,0,'idle truncation cannot call a summary model');assert.equal(x.session.digestPending.length,3);
 assert.equal(x.session.messages.length,4);assert.equal(x.ctx.chatIdleTrimBusy,false);
});

test('an unavailable summary API cannot delay an idle truncation',async()=>{
 const x=setup();x.ctx.fetch=()=>new Promise(()=>{});
 const result=await Promise.race([x.run(),new Promise((r,j)=>setTimeout(()=>j(Error('summary blocked trim')),100))]);
 assert.equal(result.trimmed,true);assert.equal(x.session.digestPending.length,3);assert.equal(x.session.dailyDigests.length,0);
});
test('a send waits only for the gateway history ACK, never for summary generation',async()=>{
 const x=setup();let syncDone,sendReady=false;
 x.ctx.chatSyncTrimmedHistoryToGateway=()=>new Promise(r=>syncDone=r);
 const idle=x.run();await tick();assert.equal(x.session.messages.length,4);
 const pending={role:'pending_user',text:'随后发送'};x.ctx.chatMessages.push(pending);
 const send=x.ctx.chatApplyAutoTrimForPendingBatch(x.cfg,[pending],{}).then(r=>{sendReady=true;return r});
 await tick();assert.equal(sendReady,false);syncDone(true);await idle;await send;assert.equal(sendReady,true);assert.equal(x.requests.length,0);
});
test('trim sync sends the correct execution route and never replaces newer local history',async()=>{
 const x=setup();let resolve;
 Object.assign(x.ctx,{window:{CKBackendRoute:{}},CKBackendRoute:{current:{mode:'vps',execution:'claude_code_api'}},
 chatCleanEndpoint:()=>'/clean',chatNormalizeRecallMode:v=>v,chatNormalizeFactRecallMode:v=>v,chatNormalizeRecallRecentRounds:v=>v,
 chatWindowContextMessages:m=>m,chatPollingEnabledForConfig:()=>false});
 vm.runInContext(extract('chatSyncTrimmedHistoryToGateway'),x.ctx);
 x.session.transportMessages=[{role:'user',content:'保留历史'}];let payload;
 x.ctx.fetch=async(url,options)=>{payload=JSON.parse(options.body);return await new Promise(r=>resolve=r)};
 const work=x.ctx.chatSyncTrimmedHistoryToGateway(x.cfg,{trimmed:true,sessionId:'s'});
 x.session.transportMessages.push({role:'assistant',content:'新回复'});
 resolve({ok:true,json:async()=>({ok:true,transport_messages:[{role:'user',content:'旧响应'}]})});
 assert.equal(await work,true);assert.equal(payload.execution_backend,'claude_code_api');assert.equal(payload.trim_sync_only,true);
 assert.equal(payload.window_messages,undefined);assert.equal(x.session.transportMessages.length,2);
 assert.equal(x.session.transportMessages[1].content,'新回复');
});

test('trim sync cannot hang forever when fetch ignores abort',async()=>{
 const x=setup();Object.assign(x.ctx,{window:{},chatCleanEndpoint:()=>'/clean',chatNormalizeRecallMode:v=>v,chatNormalizeFactRecallMode:v=>v,
 chatNormalizeRecallRecentRounds:v=>v,chatWindowContextMessages:m=>m,chatPollingEnabledForConfig:()=>false,
 setTimeout:(fn,ms)=>setTimeout(fn,Math.min(ms,10)),fetch:()=>new Promise(()=>{})});
 vm.runInContext(extract('chatSyncTrimmedHistoryToGateway'),x.ctx);
 assert.equal(await x.ctx.chatSyncTrimmedHistoryToGateway(x.cfg,{trimmed:true,sessionId:'s'}),false);
 assert.equal(x.session.messages.length,10);assert.match(x.ctx.alerts[0][0],/本地截断已完成/);
});
