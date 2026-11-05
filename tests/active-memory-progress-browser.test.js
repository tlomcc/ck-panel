const {chromium}=require('playwright');
const fs=require('fs'),path=require('path'),http=require('http'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');
const out=process.env.CK_MEMORY_PROGRESS_OUT||fs.mkdtempSync(path.join(require('os').tmpdir(),'ck-memory-progress-'));
fs.mkdirSync(out,{recursive:true});
const source=fs.readFileSync(path.join(root,'script.js'),'utf8');
const server=http.createServer((req,res)=>{
 const url=new URL(req.url,'http://localhost'),name=decodeURIComponent(url.pathname).replace(/^\//,'')||'index.html';
 const file=path.resolve(root,name);
 if(!file.startsWith(root+path.sep)||!fs.existsSync(file)){res.writeHead(404);return res.end()}
 let data=fs.readFileSync(file);
 if(name==='index.html')data=Buffer.from(data.toString().replace(/<script src="(?:pwa|script-extra)\.js[^>]+><\/script>/g,''));
 if(name==='script.js')data=Buffer.from(data.toString().replace(/^init\(\);\s*$/m,''));
 res.setHeader('Content-Type',name.endsWith('.js')?'text/javascript':name.endsWith('.css')?'text/css':name.endsWith('.svg')?'image/svg+xml':name.endsWith('.png')?'image/png':'text/html');
 res.end(data);
});

async function setup(page,dark){
 await page.evaluate(({source,dark})=>{
  localStorage.clear();document.getElementById('loading-wrap').classList.add('done');
  document.getElementById('loading-wrap').style.setProperty('display','none','important');
  document.body.classList.add('chat-active');document.body.classList.toggle('dark',dark);
  document.getElementById('tab-chat').classList.add('active');currentPanelTab='chat';
  chatSessionsReady=true;apiProvidersLoaded=true;apiProviders={};
  chatMaybeAutoTrimAtIdleBoundary=()=>{};chatMaybeAutoClean=()=>{};chatScheduleNightlySync=()=>{};
  chatStartReplyWatch=()=>()=>{};chatSendQueuedResponse=()=>{};toast=()=>{};
  const realNow=Date.now.bind(Date);window.__clockOffset=0;Date.now=()=>realNow()+window.__clockOffset;
  const start=source.indexOf('  var streamRenderRaf=0,streamRenderDirty=false,streamRenderStopped=false;');
  const end=source.indexOf('  // CK_STREAM_END:',start);
  if(start<0||end<0)throw Error('stream closure missing');
  const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
  window.__execute=new AsyncFunction('cfg','out','requestState',`
   var assistantText='',nativeThinkingText='',toolEvents=[],firstReplyTs=0,requestTurnId='memory-progress-fixture',latencyTrace={},
       responseUserTs=Date.now(),userMessageIndexes=[0],requestBodyText='{}',recallInfo=null,requestUsage=null,requestCompleted=false,
       carriedReplyOwners=[],carriedReplyVariants=[],timeReminderContext={round:1},digestSync=null,queuedIds=[];
   function recordFirstDeltaLatency(){} function markFirstReplyTs(){return firstReplyTs||(firstReplyTs=Date.now())}
   ${source.slice(start,end)}
   return requestCompleted;
  `);
  window.__start=function(){
   window.__calls=0;window.__clockOffset=0;window.__refreshes=0;
   window.ckActiveMemoryRefresh=()=>window.__refreshes++;
   chatMessages=[{role:'user',text:'下次去看展，记得留出慢慢逛的时间。',turnId:'memory-progress-fixture',ts:Date.now(),inFlight:true}];
   chatSessions=[{id:'memory-progress-fixture',name:'小克',messages:chatMessages,transportMessages:[],updated:Date.now()}];
   chatActiveSessionId='memory-progress-fixture';document.getElementById('chat-title').textContent='小克';
   chatRenderMessages({force:true,removeEphemeral:true});
   const encoder=new TextEncoder();
   window.fetch=async()=>{
    window.__calls++;
    return new Response(new ReadableStream({start(controller){window.__controller=controller}}),{headers:{'Content-Type':'text/event-stream'}});
   };
   window.__send=(event,data)=>window.__controller.enqueue(encoder.encode('event: '+event+'\ndata: '+JSON.stringify(data)+'\n\n'));
   const request=chatBeginSendingUi();request.pendingMessages=[];chatStreamProgressStart();window.__request=request;
   chatSetStatus('正在请求网关...');
   window.__result=window.__execute({sessionId:'memory-progress-fixture',chatApiSource:'claude_subscription',recall:false,splitAssistantReplies:false},chatAddBubble('assistant','',false),request);
  };
 },{source,dark});
}
async function send(page,event,data){
 await page.evaluate(({event,data})=>__send(event,data),{event,data});
 await page.waitForTimeout(30);
}
const tool=(status,extra={})=>({name:'update_active_memory',id:'memory-call-fixture',source:'active_memory',status,...extra});
const status=page=>page.locator('#chat-head-progress').textContent();
async function layout(page){
 return page.evaluate(()=>{
  const p=document.getElementById('chat-head-progress'),r=p.getBoundingClientRect();
  const overlaps=e=>{const b=e.getBoundingClientRect();return r.left<b.right&&b.left<r.right&&r.top<b.bottom&&b.top<r.bottom};
  return {visible:!p.hidden&&r.width>0&&r.height>0,inside:r.left>=0&&r.right<=innerWidth,
   clipped:p.scrollWidth>p.clientWidth,overlap:[...document.querySelectorAll('.chat-head-actions button,.chat-title-center')].filter(e=>e.getClientRects().length&&!e.hidden).some(overlaps),
   pageOverflow:document.documentElement.scrollWidth>innerWidth};
 });
}

(async()=>{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const browser=await chromium.launch({args:['--no-sandbox','--disable-dev-shm-usage']});const results=[];
 try{
  for(const [width,dark] of [[320,false],[390,false],[768,false],[1440,false],[390,true]]){
   const page=await browser.newPage({viewport:{width,height:850},serviceWorkers:'block'}),errors=[];
   page.on('pageerror',error=>errors.push(error.message));
   await page.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
   await page.goto('http://127.0.0.1:'+server.address().port+'/index.html');
   await page.waitForFunction(()=>typeof chatRenderMessages==='function'&&typeof CKChatHistory==='object');
   await setup(page,dark);await page.evaluate(()=>__start());
   await page.waitForFunction(()=>!!window.__controller);
   await send(page,'thinking',{text:'我想记下这个约定。'});
   // The old gateway emits nothing while it collects memory arguments.
   await page.evaluate(()=>{__clockOffset+=18000;chatStreamProgressRender()});
   assert.match(await status(page),/^等待上游继续 /);
   await page.screenshot({animations:'disabled',path:path.join(out,'before-'+width+'-'+dark+'.png')});
   await send(page,'tool',tool('generating'));
   assert.match(await status(page),/^正在记忆 /);
   assert.equal(await page.locator('.chat-tool-card').count(),0,'partial arguments must not create an empty tool card');
   await page.screenshot({animations:'disabled',path:path.join(out,'memory-'+width+'-'+dark+'.png')});
   assert.deepEqual(await layout(page),{visible:true,inside:true,clipped:false,overlap:false,pageOverflow:false});
   await page.evaluate(()=>{__clockOffset+=9000});await send(page,'tool',tool('generating'));
   assert.match(await status(page),/^正在记忆 /);
   const liveProgress=await page.evaluate(()=>__request.modelProgressAt);
   assert(liveProgress>0,'memory chunks refresh delivery progress');
   await page.evaluate(()=>{__clockOffset+=16000;chatStreamProgressRender()});
   assert.match(await status(page),/^等待记忆继续 16s$/);
   await send(page,'tool',tool('generating'));assert.match(await status(page),/^正在记忆 /);
   await send(page,'tool',tool('running',{input:{action:'update',revision:0}}));
   assert.match(await status(page),/^保存记忆 /);
   assert.equal(await page.locator('.chat-tool-card').count(),0,'memory progress belongs in the header until a result is known');
   await page.screenshot({animations:'disabled',path:path.join(out,'saving-'+width+'-'+dark+'.png')});
   await send(page,'tool',tool('done',{saved:true,unchanged:false,result_preview:'主动记忆已保存'}));
   assert.match(await status(page),/^记忆已保存 /);
   assert.equal(await page.locator('.chat-tool-card').count(),1,'confirmed saves remain visible');
   await send(page,'delta',{text:'好，我们慢慢看，留足时间。'});assert.match(await status(page),/^正在写 /);
   await page.evaluate(()=>currentPanelTab='records');
   await send(page,'done',{active_memory:{saved:true}});
   assert.equal(await page.evaluate(()=>__result),true);
   assert.equal(await page.evaluate(()=>__refreshes),1,'confirmed saves refresh the memory document');
   await page.evaluate(()=>currentPanelTab='chat');
   assert(await page.locator('#chat-head-progress').isHidden());
   assert.equal(await page.evaluate(()=>__calls),1,'no extra model request for status');
   assert.equal(await page.evaluate(()=>chatMessages.filter(m=>m.role==='assistant').length),1);
   await page.screenshot({animations:'disabled',path:path.join(out,'complete-'+width+'-'+dark+'.png')});
   for(const scenario of ['keep','unchanged-update','error','stop','ordinary']){
    await page.evaluate(()=>__start());await page.waitForTimeout(30);
    const unchanged=scenario==='keep'||scenario==='unchanged-update';
    if(scenario==='ordinary'){
     await send(page,'tool',{name:'fixture_search',id:'other',status:'running',unchanged:true});
     assert.match(await status(page),/^工具：fixture_search /);
    }else{
     await send(page,'tool',tool('generating'));assert.match(await status(page),/^正在记忆 /);
     if(scenario==='stop'){
      await page.evaluate(()=>chatStopMessage());await page.waitForTimeout(50);
      assert.equal(await page.evaluate(()=>__result),false);
      assert(await page.locator('#chat-head-progress').isHidden());
      assert.equal(await page.evaluate(()=>__calls),1);continue;
     }
     await send(page,'tool',tool('running',{input:{action:scenario==='keep'?'keep':'update',revision:0}}));
     assert.match(await status(page),scenario==='keep'?/^核对记忆 /:/^保存记忆 /);
     assert.equal(await page.locator('.chat-tool-card').count(),0,'keep and update progress never flash an empty memory card');
     await send(page,'tool',tool(scenario==='error'?'error':'done',{
      saved:false,unchanged:true,is_error:scenario==='error',result_preview:scenario==='error'?'合成保存失败':'主动记忆保持原样'}));
     assert.match(await status(page),scenario==='error'?/^记忆未保存 /:/^正在写 /);
     assert.equal(await page.locator('.chat-tool-card').count(),unchanged?0:1,'errors take precedence over an unchanged flag');
    }
    await send(page,'delta',{text:'继续这段对话。'});
    await page.evaluate(()=>currentPanelTab='records');
    await send(page,'done',{active_memory:{saved:false,unchanged}});
    assert.equal(await page.evaluate(()=>__result),true);assert(await page.locator('#chat-head-progress').isHidden());
    await page.evaluate(()=>currentPanelTab='chat');
    assert.equal(await page.evaluate(()=>__refreshes),0,'no-change and error results do not reload an unchanged memory document');
    assert.equal(await page.locator('.chat-tool-card').count(),unchanged?0:1);
    assert.equal(await page.evaluate(()=>chatMessages.filter(m=>m.role==='assistant').map(m=>m.text).join('')),'继续这段对话。');
    const persisted=await page.evaluate(()=>JSON.stringify(chatMessages));
    await page.evaluate(raw=>{chatMessages=JSON.parse(raw);chatCurrentSession().messages=chatMessages;chatRenderMessages({force:true,removeEphemeral:true})},persisted);
    assert.equal(await page.locator('.chat-tool-card').count(),unchanged?0:1,'old persisted tool records follow the same display rule');
    assert.equal(await page.evaluate(()=>JSON.stringify(chatMessages)),persisted,'rendering preserves the original reply and tool record');
    if(unchanged){
     await page.screenshot({animations:'disabled',path:path.join(out,scenario+'-'+width+'-'+dark+'.png')});
     assert(!(await page.locator('#chat-messages').textContent()).includes('主动记忆保持原样'));
    }
    assert.equal(await page.evaluate(()=>__calls),1);
   }
   const legacy=await page.evaluate(memory=>JSON.stringify([
    {role:'user',text:'继续聊天。',ts:Date.now()-2000},
    {role:'assistant',text:'当然，接着聊。',ts:Date.now()-1000,tools:[memory]}
   ]),tool('done',{input:{action:'keep',revision:22},saved:false,unchanged:true,result_preview:'主动记忆保持原样'}));
   await page.reload();
   await page.waitForFunction(()=>typeof chatRenderMessages==='function'&&typeof CKChatHistory==='object');
   await setup(page,dark);
   await page.evaluate(raw=>{
    chatMessages=JSON.parse(raw);chatSessions=[{id:'memory-progress-fixture',name:'小克',messages:chatMessages,transportMessages:[],updated:Date.now()}];
    chatActiveSessionId='memory-progress-fixture';chatRenderMessages({force:true,removeEphemeral:true});
   },legacy);
   assert.equal(await page.locator('.chat-tool-card').count(),0,'a real reload does not redisplay an old keep receipt');
   assert.equal(await page.evaluate(()=>JSON.stringify(chatMessages)),legacy);
   const recovery=await page.evaluate(async memory=>{
    const prefix=[{role:'user',content:'已有的合成历史。'},{role:'assistant',content:'已有的合成回复。'}];
    const history=prefix.concat([{role:'user',content:'接着聊。'},{role:'assistant',content:'补收的完整回复。'}]);
    const session=chatCurrentSession(),turn='memory-recovery-fixture';
    chatMessages=[{role:'user',text:'接着聊。',ts:Date.now(),inFlight:true,inFlightTurnId:turn}];
    session.messages=chatMessages;session.transportMessages=prefix;
    const cfg={sessionId:session.id,panelKey:'fixture',splitAssistantReplies:false,chatApiSource:'claude_subscription'};
    chatLoadConfig=()=>cfg;chatEndpoint=()=>'/ck/chat';
    const requests=[];
    window.fetch=async (url,init)=>{
     requests.push({path:new URL(url,location.origin).pathname,method:init&&init.method||'GET'});
     return new Response(JSON.stringify({found:true,turn_matched:true,turn_id:turn,state:'complete',
      assistant_text:'补收的完整回复。',tools:[memory],transport_messages:history}),{headers:{'Content-Type':'application/json'}});
    };
    const first=await chatRecoverInterruptedTurns(),second=await chatRecoverInterruptedTurns();
    return {first,second,requests,prefixPreserved:JSON.stringify(session.transportMessages.slice(0,prefix.length))===JSON.stringify(prefix),
     reply:chatMessages.filter(m=>m.role==='assistant').map(m=>m.text),tools:chatMessages.find(m=>m.role==='assistant').tools};
   },tool('done',{input:{action:'keep',revision:22},saved:false,unchanged:true,result_preview:'主动记忆保持原样'}));
   assert.deepEqual(recovery.first,{checked:true,recovered:1});assert.deepEqual(recovery.second,{checked:false});
   assert.deepEqual(recovery.requests,[{path:'/ck/chat/last',method:'GET'}],'recovery reads the original receipt once and never resends chat');
   assert(recovery.prefixPreserved);assert.deepEqual(recovery.reply,['补收的完整回复。']);
   assert.equal(recovery.tools[0].unchanged,true,'recovery keeps original metadata');
   assert.equal(await page.locator('.chat-tool-card').count(),0,'a recovered keep receipt is also hidden');
   await page.screenshot({animations:'disabled',path:path.join(out,'recovered-'+width+'-'+dark+'.png')});
   const game=await page.evaluate(memory=>{
    const message={role:'assistant',text:'【落子：I9】',turnId:'game-memory-fixture',ts:Date.now(),
     gameReply:{gameId:'memory-game',requestId:'memory-move',notice:'小克落子 I9'},tools:[memory]};
    chatMessages=[message];chatCurrentSession().messages=chatMessages;
    const original=JSON.stringify(message),html=chatRenderMessageRow(message,0);
    const container=document.createElement('div');container.innerHTML=html;
    return {view:CKGames.messageView(message),cards:container.querySelectorAll('.chat-tool-card').length,
     bubbles:container.querySelectorAll('.chat-bubble').length,notice:container.querySelector('.ck-game-event').textContent,
     preserved:JSON.stringify(message)===original};
   },tool('done',{saved:false,unchanged:true,result_preview:'主动记忆保持原样'}));
   assert.equal(game.view.text,'');assert.equal(game.cards,0);assert.equal(game.bubbles,0);
   assert(game.notice.includes('小克落子 I9'));assert(game.preserved,'a no-op memory receipt cannot create a blank game speech bubble');
   assert.deepEqual(errors,[]);
   results.push({width,dark,early_memory_status:true,private_arguments_hidden:true,stalled_and_resumed:true,saved_keep_error:true,unchanged_update_hidden:true,persisted_records_hidden:true,reload_and_recovery_hidden:true,recovered_once_without_resend:true,game_event_without_empty_bubble:true,raw_records_preserved:true,transport_prefix_preserved:true,no_unchanged_refresh:true,stop_cleans_status:true,ordinary_tool_preserved:true,no_extra_request:true,layout:true,page_errors:0});
   await page.close();
  }
 }finally{await browser.close();server.close()}
 fs.writeFileSync(path.join(out,'verification.json'),JSON.stringify(results,null,2));console.log(JSON.stringify(results));
})().catch(error=>{console.error(error);server.close();process.exitCode=1});
