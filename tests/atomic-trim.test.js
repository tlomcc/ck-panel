const {test}=require('node:test');
const assert=require('node:assert/strict'),fs=require('fs'),vm=require('vm');
const source=fs.readFileSync(require.resolve('../script.js'),'utf8');
const history=require('../chat-history.js');
function extract(name){let a=source.indexOf('function '+name+'(');assert.ok(a>=0,name);if(source.slice(a-6,a)==='async ')a-=6;return source.slice(a,source.indexOf('\n}',a)+2)}
const tick=()=>new Promise(r=>setImmediate(r));
function setup(){
 let now=Date.now(),finish;const requests=[];
 const messages=Array.from({length:5},(_,i)=>[{role:'user',text:'问'+i,turnId:'t'+i,ts:now-7200000},{role:'assistant',text:'答'+i,turnId:'t'+i,ts:now-7199000}]).flat();
 const session={id:'s',messages,transportMessages:[],dailyDigests:[],cacheLastReadAt:now-7200000};
 const cfg={dailyDigestEnabled:true,panelKey:'fixture',dailyDigestRetentionDays:3};
 const ctx={console,Set,Map,Promise,AbortController,setTimeout,clearTimeout,setInterval,clearInterval,
 Date:class extends Date{static now(){return now}},CHAT_HISTORY_TOOLS:history,CHAT_AUTO_TRIM_IDLE_MS:3600000,CHAT_DAILY_DIGEST_TIMEOUT_MS:90000,CHAT_MAX_TRANSPORT_MESSAGES:0,
 chatMessages:messages,chatEditingIndex:-1,chatSessions:[session],chatTrimTransaction:null,chatDailyDigestChain:Promise.resolve(),
 chatCurrentSession:()=>session,chatDailyDigestFindSession:id=>ctx.chatSessions.find(s=>s.id===id),chatLoadConfig:()=>cfg,
 chatAutoTrimConfigFrom:()=>({enabled:true,keep:2,roundLimitEnabled:false,roundLimit:10}),
 chatPendingMessages:()=>ctx.chatMessages.filter(m=>m.role==='pending_user'),chatIsRealMessage:m=>m.role==='user'||m.role==='assistant',
 chatCacheActivityReference:()=>({timestamp:session.cacheLastReadAt,source:'cache_read'}),chatHasCacheNoticeAfter:()=>false,
 chatDailyDigestRequestMessages:list=>list.map(m=>({...m})),chatDailyDigestFirstDay:()=> '2000-01-01',
 chatDailyDigestDayKey:t=>new Date(t).toISOString().slice(0,10),chatDailyDigestNormalize:list=>list||[],
 chatDailyDigestEntries:s=>s.dailyDigests||[],chatDailyDigestEndpoint:()=>'/digest',chatLimitArray:list=>list,
 chatSaveSessions:()=>{},chatRenderSessions:()=>{},chatRenderTrimState:()=>{},chatRenderDailyDigest:()=>{},chatResetSessionAnchorFromMessages:()=>{},
 chatDailyDigestSetStatus:()=>{},chatDebug:()=>{},toast:()=>{},chatSyncTrimmedHistoryToGateway:async()=>true,
 fetch:async(url,opts)=>{requests.push({url,body:JSON.parse(opts.body),signal:opts.signal});return await new Promise(r=>{finish=r})}
 };
 vm.createContext(ctx);
 ['chatPlanAutoTrimForPendingBatch','chatDailyDigestScheduleForTrim','chatAwaitTrimDigest','chatDailyDigestRequest','chatCommitAutoTrimPlan','chatApplyAutoTrimForPendingBatch'].forEach(n=>vm.runInContext(extract(n),ctx));
 return {ctx,cfg,session,requests,advance:ms=>{now+=ms},reply:data=>finish({ok:true,json:async()=>data}),run:(state=null,opts={idleCheck:true})=>ctx.chatApplyAutoTrimForPendingBatch(cfg,[],state,opts)};
}
test('slow summary is a barrier; history and prefix change together exactly once',async()=>{
 const x=setup();let done=false;const first=x.run().then(r=>{done=true;return r});await tick();
 x.advance(46000);await tick();assert.equal(done,false);assert.equal(x.session.messages.length,10);assert.equal(x.session.dailyDigests.length,0);
 const pending={role:'pending_user',text:'当前消息'};x.ctx.chatMessages.push(pending);
 const second=x.ctx.chatApplyAutoTrimForPendingBatch(x.cfg,[pending],{});await tick();assert.equal(x.requests.length,1);
 x.reply({prepared:true,text:'反复询问后才得到明确答复'});const a=await first,b=await second;
 assert.equal(a.trimmed,true);assert.equal(b.trimmed,false);assert.equal(b.trigger,'pending_rebuild');
 assert.equal(x.session.messages.length,5);assert.equal(x.session.messages.at(-1),pending);
 assert.equal(x.session.dailyDigests[0].text,'反复询问后才得到明确答复');assert.equal(x.requests.length,1);
});
test('API failure preserves all history and waits a fresh hour before a new plan',async()=>{
 const x=setup();const original=JSON.stringify(x.session);const work=x.run();await tick();x.reply({ok:false,error:'API unavailable'});
 const failed=await work;assert.equal(failed.cacheBoundary,false);assert.equal(failed.trimmed,false);
 assert.equal(x.session.messages.length,10);assert.equal(x.session.dailyDigests.length,0);assert.equal(x.session.cacheRebuildPending,undefined);
 assert.ok(x.session.trimRetryAfter>Date.now());await x.run();assert.equal(x.requests.length,1);
 x.advance(3600001);const next=x.run();await tick();assert.equal(x.requests.length,2);x.reply({prepared:true,text:'新的成功总结'});assert.equal((await next).trimmed,true);assert.equal(x.session.trimRetryAfter,0);
});
test('stop cancels preparation and an ignored late response cannot alter the prefix',async()=>{
 const x=setup(),state={stopped:false};const work=x.run(state);await tick();state.stopped=true;
 const result=await work;assert.equal(result.trimmed,false);assert.equal(x.requests[0].signal.aborted,true);
 x.reply({prepared:true,text:'迟到结果'});await x.ctx.chatDailyDigestChain;assert.equal(x.session.dailyDigests.length,0);assert.equal(x.session.messages.length,10);
});
test('editing during preparation invalidates the plan without deleting the edit',async()=>{
 const x=setup();const work=x.run();await tick();x.session.messages[0].text='新编辑';x.reply({prepared:true,text:'旧快照总结'});
 assert.equal((await work).trimmed,false);assert.equal(x.session.messages[0].text,'新编辑');assert.equal(x.session.dailyDigests.length,0);
});
test('switching windows cannot move a summary or delete another window',async()=>{
 const x=setup();const work=x.run();await tick();const other={id:'other',messages:[{role:'user',text:'另一个窗口'}],dailyDigests:[]};
 x.ctx.chatSessions.push(other);x.ctx.chatCurrentSession=()=>other;x.ctx.chatMessages=other.messages;
 x.reply({prepared:true,text:'只属于原窗口'});await work;
 assert.equal(x.session.messages.length,4);assert.equal(other.messages.length,1);assert.equal(other.dailyDigests.length,0);
});
test('disabled summary allows a plain trim; normal rounds never invoke the summary API',async()=>{
 const x=setup();x.cfg.dailyDigestEnabled=false;assert.equal((await x.run()).trimmed,true);assert.equal(x.requests.length,0);
 const y=setup();y.session.cacheLastReadAt=Date.now();assert.equal((await y.run()).trimmed,false);assert.equal(y.requests.length,0);
});
test('fetched models never acquire a previously configured model',async()=>{
 const ctx={panelDataFetch:async()=>({ok:true,json:async()=>({ok:true,models:['new','new','second']})}),PROVIDER_MODELS_URL:'/models',providerNormalizeApiType:()=> 'openai',esc:x=>x,escAttr:x=>x};
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
 assert.equal(x.requests.length,1,'no send or manual click needed');
 x.reply({prepared:true,text:'自动整理的总结'});await work;
 assert.equal(x.session.messages.length,4);assert.equal(x.ctx.chatIdleTrimBusy,false);
});
test('the API deadline aborts and skips both summary and truncation',async()=>{
 const x=setup();x.ctx.CHAT_DAILY_DIGEST_TIMEOUT_MS=15;
 x.ctx.fetch=async(url,opts)=>new Promise((resolve,reject)=>opts.signal.addEventListener('abort',()=>reject(new Error('aborted'))));
 const result=await x.run();assert.equal(result.trimmed,false);assert.equal(result.cacheBoundary,false);
 assert.equal(x.session.messages.length,10);assert.equal(x.session.dailyDigests.length,0);assert.ok(x.session.trimRetryAfter>Date.now());
});
test('a send waits for idle gateway-history synchronization as well as the summary',async()=>{
 const x=setup();let syncDone,sendReady=false;
 x.ctx.chatSyncTrimmedHistoryToGateway=()=>new Promise(r=>syncDone=r);
 const idle=x.run();await tick();x.reply({prepared:true,text:'完成的总结'});await tick();
 const pending={role:'pending_user',text:'随后发送'};x.ctx.chatMessages.push(pending);
 const send=x.ctx.chatApplyAutoTrimForPendingBatch(x.cfg,[pending],{}).then(r=>{sendReady=true;return r});
 await tick();assert.equal(sendReady,false);syncDone(true);await idle;await send;assert.equal(sendReady,true);assert.equal(x.requests.length,1);
});
