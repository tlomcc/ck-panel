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
 chatDailyDigestSetStatus:()=>{},chatDebug:()=>{},toast:()=>{},chatShowTrimFailure:(...args)=>ctx.alerts.push(args),alerts:[],chatFriendlyError:e=>e.message,chatSyncTrimmedHistoryToGateway:async(c,r)=>{if(r.syncId)ctx.chatDigestConfirmSync(session,c,r.syncId);return true},
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
test('legacy extra transport history is summarized in background and joins a ready manual cut',async()=>{
 const x=setup();prepare(x);
 const old=[{role:'user',content:'旧问A'},{role:'assistant',content:'旧答A'},{role:'user',content:'旧问B'},{role:'assistant',content:'旧答B'}];
 x.session.transportMessages=old.concat(x.session.messages.map(m=>({role:m.role,content:m.text+(m.role==='user'?'\n<ck_gateway_context>召回内容</ck_gateway_context>':'')})));
 x.session.digestManualTrim={scope:x.ctx.chatDigestActiveScope(x.cfg),keys:x.session.digestReadyTrims[0].keys,dropRounds:5,keep:2,requestedAt:x.ctx.Date.now()};
 const original=x.ctx.chatDailyDigestPack(x.cfg,x.session);
 assert.equal((await x.run()).trimmed,false);assert.equal(x.session.messages.length,10);assert.equal(x.session.transportMessages.length,14);assert.equal(x.ctx.chatDailyDigestPack(x.cfg,x.session),original);
 const groups=x.ctx.chatDigestCandidateGroups(x.session,x.cfg,x.session.messages),extra=groups.filter(g=>g.key.startsWith('tr:'));
 assert.equal(groups.length,5);assert.equal(extra.length,2);assert.equal(groups.filter(g=>x.session.digestReadyTrims[0].keys.includes(g.key)).length,3);
 assert.ok(!JSON.stringify(groups).includes('召回内容'));
 assert.equal(JSON.stringify(groups.map(g=>g.key)),JSON.stringify(x.ctx.chatDigestCandidateGroups(x.session,x.cfg,x.session.messages).map(g=>g.key)));
 x.session.digestReadyTrims.push({keys:extra.map(g=>g.key),text:'额外旧发送历史总结',startTs:extra[0].start,endTs:extra.at(-1).end});
 assert.equal(x.ctx.chatDigestImmediateReady(x.session,x.cfg),true);
 const epoch=x.session.digestTransportEpoch;const result=await x.run();assert.equal(result.trimmed,true);assert.equal(result.dropped,5);
 assert.equal(x.session.messages.length,4);assert.equal(x.session.transportMessages.length,4);assert.notEqual(x.session.digestTransportEpoch,epoch);
 assert.match(x.ctx.chatDailyDigestPack(x.cfg,x.session),/额外旧发送历史总结/);assert.match(x.ctx.chatDailyDigestPack(x.cfg,x.session),/原始时间未保存/);
 assert.equal(x.session.digestPending.length,5);assert.equal(x.requests.length,0);
});
test('different transport answers cannot borrow coverage from local answers',async()=>{
 const x=setup();prepare(x);x.session.transportMessages=[{role:'user',content:'额外旧问'},{role:'assistant',content:'额外旧答'}].concat(x.session.messages.map(m=>({role:m.role,content:m.text})));
 x.session.transportMessages[3].content='不同的真实发送答案';
 const groups=x.ctx.chatDigestCandidateGroups(x.session,x.cfg,x.session.messages);
 assert.equal(groups.filter(g=>g.key.startsWith('tr:')).length,2);assert.ok(groups.some(g=>g.messages.some(m=>m.text==='不同的真实发送答案')));
 assert.equal((await x.run()).trimmed,false);
});
test('manual prepare accepts extra transport and queues all required sources instead of demanding a reload',async()=>{
 const x=setup();Object.assign(x.ctx,{chatInit:()=>{},chatSaveConfig:()=>x.cfg,chatSyncNightlyDigest:async()=>true});
 x.session.transportMessages=[{role:'user',content:'旧问'},{role:'assistant',content:'旧答'}].concat(x.session.messages.map(m=>({role:m.role,content:m.text})));
 assert.equal(await x.ctx.chatRequestManualDigestTrim(),true);assert.equal(x.session.digestManualTrim.dropRounds,4);
 assert.equal(x.ctx.chatDigestCandidateGroups(x.session,x.cfg,x.session.messages).length,4);assert.equal(x.session.messages.length,10);
});
test('a ready batch that extends into retained history is never partially consumed',async()=>{
 const x=setup();prepare(x);const all=x.ctx.chatDigestMessageGroups(x.session.messages);x.session.digestReadyTrims[0].keys=all.map(g=>g.key);
 assert.equal((await x.run()).trimmed,false);assert.equal(x.session.messages.length,10);assert.equal(x.session.digestReadyTrims.length,1);
});
test('immediate manual trim waits for the active reply then commits without another send',async()=>{
 const x=setup();Object.assign(x.ctx,{chatInit:()=>{},chatSaveConfig:()=>x.cfg,chatRenderMessages:()=>{},chatRenderNightlyStatus:()=>{},chatRenderTrimState:()=>{}});
 let queued=0;x.ctx.chatSyncNightlyDigest=async()=>{queued++;return true};x.ctx.chatSending=true;
 assert.equal(await x.ctx.chatRequestManualDigestTrim(),true);assert.equal(queued,1);assert.equal(x.session.messages.length,10);assert.ok(x.session.digestManualTrim);
 const request=JSON.stringify(x.session.digestManualTrim);
 await x.ctx.chatRequestManualDigestTrim();assert.equal(queued,1);assert.equal(JSON.stringify(x.session.digestManualTrim),request);
 x.session.cacheLastReadAt=x.ctx.Date.now();
 prepare(x);x.ctx.chatSending=true;assert.equal(await x.ctx.chatDigestFinishManualTrim(x.cfg,x.session),false);
 let clean=0;x.ctx.chatSyncTrimmedHistoryToGateway=async()=>{clean++;return true};
 x.ctx.chatSending=false;assert.equal(await x.ctx.chatDigestFinishManualTrim(x.cfg,x.session),true);
 assert.equal(x.session.messages.length,4);assert.equal(x.session.digestManualTrim,undefined);assert.equal(clean,1);
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

test('a manual range prepared during a reply remains usable after transport catches up',async()=>{
 const x=setup();Object.assign(x.ctx,{chatInit:()=>{},chatSaveConfig:()=>x.cfg,chatSyncNightlyDigest:async()=>true,chatRenderMessages:()=>{}});
 x.session.transportMessages=x.session.messages.map(m=>({role:m.role,content:m.text}));
 x.session.messages.push({role:'user',text:'生成中的问题',turnId:'active',ts:x.ctx.Date.now()},
   {role:'assistant',text:'生成中',turnId:'active',ts:x.ctx.Date.now()+1,inFlight:true});
 x.ctx.chatSending=true;await x.ctx.chatRequestManualDigestTrim();
 const req=JSON.parse(JSON.stringify(x.session.digestManualTrim));
 const groups=x.ctx.chatDigestMessageGroups(x.session.messages).filter(g=>req.keys.includes(g.key));
 x.session.digestReadyTrims=[{keys:req.keys,text:'覆盖全部已请求资料的总结',startTs:groups[0].start,endTs:groups.at(-1).end}];
 delete x.session.messages.at(-1).inFlight;x.session.messages.at(-1).text='生成完成';
 x.session.transportMessages=x.session.messages.map(m=>({role:m.role,content:m.text}));
 x.ctx.chatSending=false;
 const plan=x.ctx.chatDigestManualPlan(x.session,x.cfg,x.session.digestManualTrim,[]);
 assert.equal(plan.manualValid,true);
 assert.equal(x.ctx.chatDigestImmediateReady(x.session,x.cfg),true);
 assert.equal(await x.ctx.chatDigestSyncNow(),true);
 assert.equal(x.session.messages.at(-1).text,'生成完成');
 assert.ok(history.localTurnGroups(x.session.messages).length>=req.keep);
 assert.ok(history.transportTurnGroups(x.session.transportMessages).length>=req.keep);
 assert.equal(x.requests.length,0);
});

test('changed manual sources are requeued and only fresh complete coverage may commit',async()=>{
 const x=setup();Object.assign(x.ctx,{chatInit:()=>{},chatSaveConfig:()=>x.cfg,chatSyncNightlyDigest:async()=>true,chatRenderMessages:()=>{}});
 await x.ctx.chatRequestManualDigestTrim();prepare(x);
 const oldId=x.session.digestManualTrim.requestedAt,oldKeys=[...x.session.digestManualTrim.keys];
 x.session.messages[0].text='后来修正的原文';
 assert.equal(x.ctx.chatDigestRefreshManualSources(x.session,x.cfg),true);
 assert.ok(x.session.digestManualTrim.requestedAt>oldId);
 assert.notEqual(x.session.digestManualTrim.keys[0],oldKeys[0]);
 assert.equal(x.session.digestManualTrim.keys[1],oldKeys[1]);
 assert.equal(x.ctx.chatDigestRefreshManualSources(x.session,x.cfg),false);
 assert.equal(await x.ctx.chatDigestFinishManualTrim(x.cfg,x.session),false);
 assert.equal(x.session.messages.length,10);
 prepare(x);assert.equal(await x.ctx.chatDigestFinishManualTrim(x.cfg,x.session),true);
 assert.equal(x.session.messages.length,4);assert.equal(x.requests.length,0);
});

test('an older queued result cannot finish a newer manual source revision',async()=>{
 const x=setup();Object.assign(x.ctx,{chatInit:()=>{},chatSaveConfig:()=>x.cfg,chatSessionsReady:true,chatRenderMessages:()=>{}});
 const pending=[];
 x.ctx.fetch=async(url,opts)=>new Promise(resolve=>pending.push({body:JSON.parse(opts.body),resolve}));
 const finish=(call,revision)=>call.resolve({ok:true,json:async()=>({ok:true,status:'succeeded',accepted_keys:call.body.groups.map(g=>g.key),
   snapshot:{revision,source_stamp:call.body.base_stamp,config:call.body.config,base:call.body.base,result:{day:'2026-10-03'},
     trims:[{keys:call.body.candidate_keys,text:'已完成第'+revision+'版原文总结',startTs:x.session.messages[0].ts,endTs:x.session.messages[5].ts}]}})});
 await x.ctx.chatRequestManualDigestTrim();assert.equal(pending.length,1);
 const oldRequest=x.session.digestManualTrim.requestedAt;
 x.session.messages[0].text='队列请求期间修改的原文';
 const oldSync=x.ctx.chatSyncNightlyDigest(x.cfg);
 assert.ok(x.session.digestManualTrim.requestedAt>oldRequest);
 assert.equal(pending.length,1,'the existing queue request must remain single-flight');
 finish(pending[0],1);await oldSync;await tick();
 assert.equal(x.session.messages.length,10,'the stale prepared batch must not delete edited source');
 assert.ok(x.session.digestManualTrim);
 const updated=x.ctx.chatMaybeRollDigestAtDayBoundary();assert.equal(pending.length,2);
 assert.notDeepEqual(pending[1].body.candidate_keys,pending[0].body.candidate_keys);
 finish(pending[1],2);await updated;
 assert.equal(x.session.messages.length,4);assert.equal(x.session.digestManualTrim,undefined);
 assert.ok(x.session.digestPending.some(g=>g.messages.some(m=>m.text==='队列请求期间修改的原文')));
 assert.match(x.session.digestActivePack.text,/第2版/);
 assert.doesNotMatch(x.session.digestActivePack.text,/第1版/);
});

test('a restored unfinished reply delays manual commit until its original turn is recovered',async()=>{
 const x=setup();Object.assign(x.ctx,{chatInit:()=>{},chatSaveConfig:()=>x.cfg,chatSyncNightlyDigest:async()=>true,chatRenderMessages:()=>{}});
 await x.ctx.chatRequestManualDigestTrim();prepare(x);x.session.replyDraft={state:'running',turn_id:'recover-original'};
 assert.equal(await x.ctx.chatDigestFinishManualTrim(x.cfg,x.session),false);
 assert.equal(x.session.messages.length,10);assert.ok(x.session.digestManualTrim);
 x.session.replyDraft=null;
 assert.equal(await x.ctx.chatDigestFinishManualTrim(x.cfg,x.session),true);
 assert.equal(x.session.messages.length,4);
});

test('a manual cut injects its prepared summary when midnight compaction is unavailable',async()=>{
 const x=setup();Object.assign(x.ctx,{chatInit:()=>{},chatSaveConfig:()=>x.cfg,chatSyncNightlyDigest:async()=>true,chatRenderMessages:()=>{}});
 await x.ctx.chatRequestManualDigestTrim();prepare(x);
 const yesterday=x.ctx.chatDigestShiftDay(x.ctx.chatDailyDigestDayKey(x.ctx.Date.now()),-1);
 const entries=[{dayKey:yesterday,text:'昨日尚未精简的长总结'.repeat(500),covered:[]}];
 x.session.digestActivePack={scope:x.ctx.chatDigestActiveScope(x.cfg),config:x.ctx.chatDigestConfigStamp(x.cfg),text:'前一轮实际发送过的稳定总结',at:x.ctx.Date.now()-1000};
 x.session.digestStaged={scope:x.ctx.chatDigestActiveScope(x.cfg),config:x.ctx.chatDigestConfigStamp(x.cfg),base:{entries,rollup:null,omitted:[]},trims:x.session.digestReadyTrims,result:{day:yesterday},revision:2};
 x.session.digestReadyTrims=[];
 assert.equal(x.ctx.chatDigestPackReady(x.cfg,x.ctx.chatDigestPreparedSession(x.session,x.cfg)),false);
 assert.equal(await x.ctx.chatDigestFinishManualTrim(x.cfg,x.session),true);
 const pack=x.ctx.chatDailyDigestPack(x.cfg,x.session);
 assert.match(pack,/前一轮实际发送过的稳定总结/);
 assert.match(pack,/她问了前三个问题/,'new summary must be injected in the same transaction as the cut');
 assert.doesNotMatch(pack,/昨日尚未精简的长总结/);
 assert.equal(x.session.messages.length,4);assert.equal(x.session.digestStaged,undefined);
 assert.equal(x.session.digestReadyTrims.length,0);
});

test('missing both a ready injection and a stable saved pack preserves original history',async()=>{
 const x=setup();Object.assign(x.ctx,{chatInit:()=>{},chatSaveConfig:()=>x.cfg,chatSyncNightlyDigest:async()=>true,chatRenderMessages:()=>{}});
 await x.ctx.chatRequestManualDigestTrim();prepare(x);
 x.session.dailyDigests=[{dayKey:x.ctx.chatDigestShiftDay(x.ctx.chatDailyDigestDayKey(x.ctx.Date.now()),-1),text:'长总结'.repeat(1000),covered:[]}];
 delete x.session.digestActivePack;
 assert.equal(await x.ctx.chatDigestFinishManualTrim(x.cfg,x.session),false);
 assert.equal(x.session.messages.length,10);assert.ok(x.session.digestManualTrim);
});

test('an unrelated nightly error does not hide a prepared manual cut waiting for a reply',async()=>{
 const x=setup();Object.assign(x.ctx,{chatInit:()=>{},chatSaveConfig:()=>x.cfg,chatSyncNightlyDigest:async()=>true});
 await x.ctx.chatRequestManualDigestTrim();prepare(x);x.ctx.chatSending=true;
 const view=x.ctx.chatDigestSyncView(x.session,x.cfg,{status:'retry',last_error:'总结供应商返回 HTTP 524'});
 assert.equal(view.ready,true);assert.equal(view.status,'等待当前回复');
 assert.doesNotMatch(view.note,/HTTP 524/);
});

test('preparation status displays actual summary coverage without claiming a completed cut',async()=>{
 const x=setup();Object.assign(x.ctx,{chatInit:()=>{},chatSaveConfig:()=>x.cfg,chatSyncNightlyDigest:async()=>true});
 await x.ctx.chatRequestManualDigestTrim();
 const group=x.ctx.chatDigestMessageGroups(x.session.messages)[0];
 x.session.digestReadyTrims=[{keys:[group.key],text:'第一轮总结',startTs:group.start,endTs:group.end}];
 const view=x.ctx.chatDigestSyncView(x.session,x.cfg);
 assert.equal(view.rounds,0);assert.match(view.note,/已准备 1 \/ 3 组/);
 assert.match(view.note,/自动截断/);
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
test('ready manual task can synchronize immediately during a warm cache without a model or confirmation',async()=>{
 const x=setup();Object.assign(x.ctx,{chatInit:()=>{},chatSaveConfig:()=>x.cfg,chatSyncNightlyDigest:async()=>true,chatRenderMessages:()=>{}});
 await x.ctx.chatRequestManualDigestTrim();prepare(x);x.session.cacheLastReadAt=x.ctx.Date.now();
 let synced=0;x.ctx.chatSyncTrimmedHistoryToGateway=async(c,r)=>{synced++;x.ctx.chatDigestConfirmSync(x.session,c,r.syncId);return true};x.ctx.ckConfirmDialog=()=>{throw Error('unexpected dialog')};
 assert.equal(await x.ctx.chatDigestSyncNow(),true);assert.equal(synced,1);assert.equal(x.session.messages.length,4);assert.equal(x.session.digestManualTrim,undefined);assert.equal(x.requests.length,0);
 assert.equal(await x.ctx.chatDigestSyncNow(),false);assert.equal(synced,1);
});
test('preparation-only requests remain reusable and can extend to newly added rounds',async()=>{
 const x=setup();let queued=0;Object.assign(x.ctx,{chatInit:()=>{},chatSaveConfig:()=>x.cfg,chatSyncNightlyDigest:async()=>{queued++},chatRenderMessages:()=>{}});
 await x.ctx.chatRequestManualDigestTrim({immediate:false});prepare(x);const first=x.session.digestManualTrim;
 await x.ctx.chatRequestManualDigestTrim({immediate:false});assert.equal(queued,1);assert.equal(x.session.digestManualTrim,first);
 x.session.messages.push({role:'user',text:'新增',turnId:'new',ts:x.ctx.Date.now()},{role:'assistant',text:'新答',turnId:'new',ts:x.ctx.Date.now()+1});
 await x.ctx.chatRequestManualDigestTrim({immediate:false});assert.equal(queued,2);assert.equal(x.session.digestManualTrim.dropRounds,4);assert.ok(x.session.digestManualTrim.requestedAt>first.requestedAt);
 assert.equal(x.session.digestReadyTrims.length,1);assert.equal(x.session.messages.length,12);assert.equal(x.ctx.chatDigestImmediateReady(x.session,x.cfg),false);
 const g=x.ctx.chatDigestMessageGroups(x.session.messages.slice(6,8))[0];x.session.digestReadyTrims.push({keys:[g.key],text:'补充总结',startTs:g.start,endTs:g.end});
 assert.equal(x.ctx.chatDigestImmediateReady(x.session,x.cfg),true);assert.equal(await x.ctx.chatDigestSyncNow(),true);assert.equal(x.session.messages.length,4);
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
 assert.equal(x.session.messages.length,10);assert.match(x.ctx.alerts[0][0],/本机已保存，但网关尚未同步/);
});

test('actual cut count remains unsynchronized until the same operation is acknowledged',async()=>{
 const x=setup();prepare(x);
 const result=await x.run();
 assert.equal(result.dropped,3);
 assert.equal(x.ctx.chatDigestSyncView(x.session,x.cfg).rounds,3);
 assert.equal(x.ctx.chatDigestSyncView(x.session,x.cfg).status,'同步未完成');
 const copy=JSON.parse(JSON.stringify(x.session.digestLastSync));x.session.digestLastSync=copy;
 assert.equal(x.ctx.chatDigestConfirmSync(x.session,x.cfg,'older-operation'),false);
 copy.turnId='new-turn';
 assert.equal(x.ctx.chatDigestConfirmSync(x.session,x.cfg,null,'old-turn'),false);
 assert.equal(x.ctx.chatDigestConfirmSync(x.session,{...x.cfg,panelKey:'other'},copy.id),false);
 assert.equal(x.ctx.chatDigestConfirmSync(x.session,x.cfg,copy.id,'new-turn'),true);
 assert.equal(x.ctx.chatDigestSyncView(x.session,x.cfg).status,'同步完成');
});

test('background source counts never masquerade as rounds already cut',()=>{
 const x=setup();x.session.digestManualTrim={scope:x.ctx.chatDigestActiveScope(x.cfg),requestedAt:x.ctx.Date.now(),dropRounds:3,keep:2,keys:[]};
 const view=x.ctx.chatDigestSyncView(x.session,x.cfg,{pending_groups:122,manual:{sources:122,ready_sources:122}});
 assert.equal(view.rounds,0);assert.equal(view.cutNote,'尚未截断');assert.ok(!JSON.stringify(view).includes('122'));
});

function stageRange(x){
 x.cfg.dailyDigestDetailDays=1;x.cfg.dailyDigestRollupDays=0;
 x.session.digestActivePack={scope:x.ctx.chatDigestActiveScope(x.cfg),text:'旧启用总结'};
 x.session.digestSettingsRequest={at:x.ctx.Date.now(),scope:x.ctx.chatDigestActiveScope(x.cfg),config:x.ctx.chatDigestConfigStamp(x.cfg),x:1,y:0};
 x.session.digestStaged={scope:x.ctx.chatDigestActiveScope(x.cfg),config:x.ctx.chatDigestConfigStamp(x.cfg),revision:9,
  base:{entries:[{dayKey:'2026-10-02',text:'新范围摘要',covered:[]}],rollup:null,omitted:[]},result:{day:'2026-10-03'},trims:[]};
}
test('new XY activates at expiry even with automatic trimming disabled',async()=>{
 const x=setup();stageRange(x);x.ctx.chatAutoTrimConfigFrom=()=>({enabled:false,keep:2,roundLimitEnabled:false});
 x.session.cacheLastReadAt=x.ctx.Date.now();
 assert.equal((await x.run()).cacheBoundary,false);assert.equal(x.ctx.chatDailyDigestPack(x.cfg,x.session),'旧启用总结');
 x.advance(3600000);const result=await x.run();
 assert.equal(result.trimmed,false);assert.equal(result.dropped,0);assert.equal(x.session.messages.length,10);
 assert.match(x.ctx.chatDailyDigestPack(x.cfg,x.session),/新范围摘要/);assert.equal(x.session.digestSettingsRequest,undefined);
 assert.equal(x.ctx.chatDigestSyncView(x.session,x.cfg).status,'同步未完成');
});
test('manual XY sync succeeds with zero cut rounds while unrelated cuts are still preparing',async()=>{
 const x=setup();stageRange(x);x.session.cacheLastReadAt=x.ctx.Date.now();x.ctx.chatRenderMessages=()=>{};
 assert.equal(x.ctx.chatDigestImmediateReady(x.session,x.cfg),true);
 assert.equal(await x.ctx.chatDigestSyncNow(),true);
 assert.equal(x.session.messages.length,10);assert.equal(x.session.digestLastSync.rounds,0);
 assert.equal(x.ctx.chatDigestSyncView(x.session,x.cfg).status,'同步完成');
});

test('stale wake status preserves a ready prefix without making normal sends wait',async()=>{
 const x=setup();prepare(x);let reads=0;
 x.session.wakeEnabled=true;x.session.wakeSyncAt=x.ctx.Date.now()-60000;
 x.ctx.chatWakeRefresh=()=>{reads++;return new Promise(()=>{})};
 vm.runInContext(extract('chatWakeStatusStale'),x.ctx);
 const before=JSON.stringify(x.session.messages),result=await x.run();
 assert.equal(reads,1);assert.equal(result.trimmed,false);assert.equal(result.cacheBoundary,false);assert.equal(result.forceCacheRebuild,false);
 assert.equal(JSON.stringify(x.session.messages),before);assert.equal(x.requests.length,0);
 x.session.wakeSyncAt=x.ctx.Date.now();assert.equal((await x.run()).trimmed,true);
});
