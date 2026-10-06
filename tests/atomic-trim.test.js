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
 chatSending:false,chatTrimBusy:false,chatCurrentSession:()=>session,chatDailyDigestFindSession:id=>ctx.chatSessions.find(s=>s.id===id),chatLoadConfig:()=>cfg,
 chatAutoTrimConfigFrom:cfg=>cfg&&cfg.windowTrimOverride?cfg.windowTrimConfig:({enabled:true,keep:2,roundLimitEnabled:false,roundLimit:10}),
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
 vm.runInContext(fs.readFileSync(require.resolve('../chat-digest-activation.js'),'utf8'),ctx);
 vm.runInContext(fs.readFileSync(require.resolve('../chat-digest-schedule.js'),'utf8'),ctx);ctx.chatScheduleNightlySync=()=>{};
 ctx.chatRenderDailyDigest=()=>{};ctx.chatDailyDigestSetStatus=()=>{};ctx.chatDailyDigestEndpoint=()=>'/digest';
 ['chatAutoTrimRoundCount','chatTimeReminderContext','chatPlanAutoTrimForPendingBatch','chatCommitAutoTrimPlan','chatApplyAutoTrimForPendingBatch'].forEach(n=>vm.runInContext(extract(n),ctx));
 return {ctx,cfg,session,requests,advance:ms=>{now+=ms},reply:data=>finish({ok:true,json:async()=>data}),run:(state=null,opts={})=>{const pending={role:'pending_user',text:'下一条'};return ctx.chatApplyAutoTrimForPendingBatch(cfg,[pending],state,opts)}};
}

function prepare(x){
 const groups=x.ctx.chatDigestMessageGroups(x.session.messages.slice(0,6));
 x.session.digestReadyTrims=[{keys:groups.map(g=>g.key),text:'她问了前三个问题，我逐一回应。',startTs:groups[0].start,endTs:groups.at(-1).end}];
}
test('ready summaries and matching full turns commit atomically at an expired cache',async()=>{
 const x=setup();prepare(x);const first=await x.run();assert.equal(first.trimmed,true);assert.equal(x.session.messages.length,4);
 assert.equal(x.session.dailyDigests.length,1);assert.match(x.session.digestActivePack.text,/前三个问题/);assert.equal(x.requests.length,0);
 assert.equal(x.session.digestPending.length,3);assert.equal(x.session.digestReadyTrims.length,0);
});
test('unprepared summaries never remove context or wait for a model',async()=>{
 const x=setup();x.ctx.fetch=()=>new Promise(()=>{});const result=await x.run();
 assert.equal(result.trimmed,false);assert.equal(x.session.messages.length,10);assert.equal(x.session.dailyDigests.length,0);assert.equal(x.requests.length,0);
});
test('idle expiry only prepares and leaves the active conversation untouched',async()=>{
 const x=setup();prepare(x);const result=await x.run(null,{idleCheck:true});
 assert.equal(result.trimmed,false);assert.equal(x.session.messages.length,10);assert.equal(x.requests.length,0);
});
test('storage failure keeps all original messages',async()=>{
 const x=setup();prepare(x);x.ctx.localStorage.setItem=()=>{throw Error('quota')};assert.equal((await x.run()).trimmed,false);assert.equal(x.session.messages.length,10);
});
test('cache reads renew the full hour and defer both summary and round-limit trimming',async()=>{
 const x=setup();prepare(x);x.session.cacheLastReadAt+=7199000;
 x.ctx.chatAutoTrimConfigFrom=()=>({enabled:true,keep:2,roundLimitEnabled:true,roundLimit:3});
 assert.equal((await x.run()).trimmed,false);assert.equal(x.session.messages.length,10);
 x.advance(3600000);assert.equal((await x.run()).trimmed,true);
});
test('a stopped request preserves source history',async()=>{
 const x=setup();prepare(x);assert.equal((await x.run({stopped:true})).trimmed,false);assert.equal(x.session.messages.length,10);
});
test('disabled summaries allow plain boundary trimming without API calls',async()=>{
 const x=setup();x.cfg.dailyDigestEnabled=false;assert.equal((await x.run()).trimmed,true);assert.equal(x.requests.length,0);
});
test('old source is accounted on the commit date without editing yesterday',async()=>{
 const x=setup();prepare(x);x.advance(86400000);
 x.session.dailyDigests=[{dayKey:'2026-10-03',text:'昨日定稿',startTs:x.session.messages[0].ts,endTs:x.session.messages[0].ts,covered:[]}];
 assert.equal((await x.run()).trimmed,true);assert.equal(x.session.dailyDigests.find(e=>e.dayKey==='2026-10-03').text,'昨日定稿');
 const today=x.session.dailyDigests.find(e=>e.dayKey==='2026-10-04');assert.match(today.text,/原对话 2026-10-03/);
 assert.equal(x.ctx.chatDailyDigestNormalize(x.session.dailyDigests).length,2);
});
test('automatic expiry commits the prepared prefix even when new rounds grew beyond it',async()=>{
 const x=setup();prepare(x);
 x.session.messages.push({role:'user',text:'新问题',turnId:'new',ts:x.ctx.Date.now()-1000},{role:'assistant',text:'新回复',turnId:'new',ts:x.ctx.Date.now()-900});
 x.session.transportMessages=x.session.messages.map(m=>({role:m.role,content:m.text}));
 const pending={role:'pending_user',text:'本次消息',ts:x.ctx.Date.now()};x.session.messages.push(pending);
 const result=await x.ctx.chatApplyAutoTrimForPendingBatch(x.cfg,[pending],{});
 assert.equal(result.trimmed,true);assert.equal(result.dropped,3);assert.equal(result.after,3);
 assert.equal(x.session.transportMessages.length,6);assert.ok(x.session.messages.includes(pending));assert.equal(x.requests.length,0);
 x.session.cacheRebuildPending=false;x.session.cacheLastReadAt=x.ctx.Date.now();
 const pack=x.ctx.chatDailyDigestPack(x.cfg,x.session);assert.equal((await x.run()).trimmed,false);assert.equal(x.ctx.chatDailyDigestPack(x.cfg,x.session),pack);
});
test('automatic expiry cannot publish staged summary when archival storage fails',async()=>{
 const x=setup();prepare(x);const pack=x.ctx.chatDailyDigestPack(x.cfg,x.session);
 x.session.digestStaged={scope:x.ctx.chatDigestActiveScope(x.cfg),config:x.ctx.chatDigestConfigStamp(x.cfg),base:{entries:[{dayKey:'2026-10-02',text:'待启用',covered:[]}],rollup:null,omitted:[]},trims:x.session.digestReadyTrims,result:{day:'2026-10-03'},revision:2};
 x.session.digestReadyTrims=[];x.ctx.localStorage.setItem=()=>{throw Error('full')};
 assert.equal((await x.run()).trimmed,false);assert.ok(x.session.digestStaged);assert.equal(x.session.dailyDigests.length,0);assert.equal(x.ctx.chatDailyDigestPack(x.cfg,x.session),pack);
});
test('expired pending rebuild no longer suppresses a prepared automatic cut',async()=>{
 const x=setup();prepare(x);x.session.cacheRebuildPending=true;
 assert.equal((await x.run()).trimmed,true);assert.equal(x.session.messages.length,4);
});
test('incomplete history coverage stays intact and records a concrete skip reason',async()=>{
 const x=setup();prepare(x);x.session.transportMessages=Array.from({length:8},(_,i)=>[{role:'user',content:'u'+i},{role:'assistant',content:'a'+i}]).flat();
 assert.equal((await x.run()).trimmed,false);assert.equal(x.session.transportMessages.length,16);assert.equal(x.session.messages.length,10);
 assert.equal(x.session.digestTrimDecision.reason,'history_coverage_mismatch');
});
test('a ready batch that extends into retained history is never partially consumed',async()=>{
 const x=setup();prepare(x);const all=x.ctx.chatDigestMessageGroups(x.session.messages);x.session.digestReadyTrims[0].keys=all.map(g=>g.key);
 assert.equal((await x.run()).trimmed,false);assert.equal(x.session.messages.length,10);assert.equal(x.session.digestReadyTrims.length,1);
});
test('manual click starts preparation during chat and commits only with the next send',async()=>{
 const x=setup();Object.assign(x.ctx,{chatInit:()=>{},chatSaveConfig:()=>x.cfg,chatRenderMessages:()=>{},chatRenderNightlyStatus:()=>{},chatRenderTrimState:()=>{}});
 let queued=0;x.ctx.chatSyncNightlyDigest=async()=>{queued++;return true};x.ctx.chatSending=true;
 assert.equal(await x.ctx.chatRequestManualDigestTrim(),true);assert.equal(queued,1);assert.equal(x.session.messages.length,10);assert.ok(x.session.digestManualTrim);
 const request=JSON.stringify(x.session.digestManualTrim);
 await x.ctx.chatRequestManualDigestTrim();assert.equal(queued,1);assert.equal(JSON.stringify(x.session.digestManualTrim),request);
 x.session.cacheLastReadAt=x.ctx.Date.now();
 prepare(x);x.ctx.chatSending=true;assert.equal(await x.ctx.chatDigestFinishManualTrim(x.cfg,x.session),false);
 x.ctx.chatSending=false;assert.equal(await x.ctx.chatDigestFinishManualTrim(x.cfg,x.session),false);assert.equal(x.session.messages.length,10);
 let clean=0;x.ctx.chatSyncTrimmedHistoryToGateway=async()=>{clean++};
 assert.equal((await x.run()).trimmed,true);assert.equal(x.session.messages.length,4);assert.equal(x.session.digestManualTrim,undefined);assert.equal(clean,0);
 x.session.cacheRebuildPending=false;
 const pack=x.ctx.chatDailyDigestPack(x.cfg,x.session);assert.equal((await x.run()).trimmed,false);assert.equal(x.ctx.chatDailyDigestPack(x.cfg,x.session),pack);
});

test('manual preparation preserves new rounds and waits without changing either prompt component',async()=>{
 const x=setup();Object.assign(x.ctx,{chatInit:()=>{},chatSaveConfig:()=>x.cfg,chatSyncNightlyDigest:async()=>true,chatRenderNightlyStatus:()=>{}});
 const original=x.ctx.chatDailyDigestPack(x.cfg,x.session);await x.ctx.chatRequestManualDigestTrim();
 assert.equal((await x.run()).trimmed,false);assert.equal(x.session.messages.length,10);assert.equal(x.ctx.chatDailyDigestPack(x.cfg,x.session),original);
 prepare(x);x.session.messages.push({role:'user',text:'新问题',turnId:'new',ts:x.ctx.Date.now()},{role:'assistant',text:'新回复',turnId:'new',ts:x.ctx.Date.now()+1});
 assert.equal((await x.run()).trimmed,true);assert.equal(x.session.messages.length,6);assert.equal(x.session.messages.at(-1).text,'新回复');
});

test('ready manual cut still commits when an earlier send left a pending cache rebuild',async()=>{
 const x=setup();Object.assign(x.ctx,{chatInit:()=>{},chatSaveConfig:()=>x.cfg,chatSyncNightlyDigest:async()=>true,chatRenderNightlyStatus:()=>{}});
 x.session.transportMessages=x.session.messages.map(m=>({role:m.role,content:m.text}));
 await x.ctx.chatRequestManualDigestTrim();prepare(x);x.session.cacheRebuildPending=true;
 const plan=x.ctx.chatDigestManualPlan(x.session,x.cfg,x.session.digestManualTrim,[]);
 assert.equal(plan.manualValid,true);assert.ok(x.ctx.chatDigestManualPrepared(x.session,x.cfg,plan));
 const result=await x.run();assert.equal(result.trimmed,true);assert.equal(x.session.transportMessages.length,4);
});

test('manual cut refuses edited sources and storage failures without publishing a staged summary',async()=>{
 for(const fail of ['edit','storage']){
 const x=setup();Object.assign(x.ctx,{chatInit:()=>{},chatSaveConfig:()=>x.cfg,chatSyncNightlyDigest:async()=>true,chatRenderNightlyStatus:()=>{}});
 await x.ctx.chatRequestManualDigestTrim();prepare(x);
 const original=x.ctx.chatDailyDigestPack(x.cfg,x.session);
 x.session.digestStaged={scope:x.ctx.chatDigestActiveScope(x.cfg),config:x.ctx.chatDigestConfigStamp(x.cfg),base:{entries:[],rollup:null,omitted:[]},trims:x.session.digestReadyTrims,result:{day:'2026-10-03'},revision:2};
 x.session.digestReadyTrims=[];
 if(fail==='edit')x.session.messages[0].text='编辑过的原文';else x.ctx.localStorage.setItem=()=>{throw Error('full')};
 assert.equal((await x.run()).trimmed,false);assert.equal(x.session.messages.length,10);assert.equal(x.ctx.chatDailyDigestPack(x.cfg,x.session),original);assert.ok(x.session.digestStaged);
 }
});
test('manual preparation cancellation prevents later automatic cache-breaking trim',async()=>{
 const x=setup();Object.assign(x.ctx,{chatInit:()=>{},chatSaveConfig:()=>x.cfg,chatRenderMessages:()=>{},chatRenderNightlyStatus:()=>{},ckConfirmDialog:async()=>true});
 x.ctx.chatSyncNightlyDigest=async()=>true;
 await x.ctx.chatRequestManualDigestTrim();x.ctx.chatDigestCancelManualTrim();prepare(x);
 assert.equal(await x.ctx.chatDigestFinishManualTrim(x.cfg,x.session),false);assert.equal(x.session.messages.length,10);
});

test('fetched models never acquire a previously configured model',async()=>{
 const ctx={panelDataFetch:async()=>({ok:true,json:async()=>({ok:true,models:['new','new','second']})}),PROVIDER_MODELS_URL:'/models',providerNormalizeApiType:()=> 'openai',esc:x=>x,escAttr:x=>x};
 const storage=new Map();ctx.localStorage={getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)};
 vm.createContext(ctx);['cleanModelList','fetchModelsForProvider','modelOptionsHtml'].forEach(n=>vm.runInContext(extract(n),ctx));
 const models=await ctx.fetchModelsForProvider({model:'old',url:'x',key:'fixture'});assert.deepEqual(Array.from(models),['new','second']);
 assert.ok(!ctx.modelOptionsHtml(models,'old').includes('old'));
 ctx.panelDataFetch=async()=>({ok:true,json:async()=>({ok:true,models:[]})});assert.equal((await ctx.fetchModelsForProvider({model:'old'})).length,0);
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
