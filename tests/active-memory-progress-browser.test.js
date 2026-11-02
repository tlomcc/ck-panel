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
       carriedReplyOwners=[],carriedReplyVariants=[],timeReminderContext={round:1},digestSync=null;
   function recordFirstDeltaLatency(){} function markFirstReplyTs(){return firstReplyTs||(firstReplyTs=Date.now())}
   ${source.slice(start,end)}
   return requestCompleted;
  `);
  window.__start=function(){
   window.__calls=0;window.__clockOffset=0;
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
   await page.screenshot({path:path.join(out,'before-'+width+'-'+dark+'.png')});
   await send(page,'tool',tool('generating'));
   assert.match(await status(page),/^正在记忆 /);
   assert.equal(await page.locator('.chat-tool-card').count(),0,'partial arguments must not create an empty tool card');
   await page.screenshot({path:path.join(out,'memory-'+width+'-'+dark+'.png')});
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
   await page.screenshot({path:path.join(out,'saving-'+width+'-'+dark+'.png')});
   await send(page,'tool',tool('done',{saved:true,unchanged:false,result_preview:'主动记忆已保存'}));
   assert.match(await status(page),/^记忆已保存 /);
   await send(page,'delta',{text:'好，我们慢慢看，留足时间。'});assert.match(await status(page),/^正在写 /);
   await send(page,'done',{active_memory:{saved:true}});
   assert.equal(await page.evaluate(()=>__result),true);
   assert(await page.locator('#chat-head-progress').isHidden());
   assert.equal(await page.evaluate(()=>__calls),1,'no extra model request for status');
   assert.equal(await page.evaluate(()=>chatMessages.filter(m=>m.role==='assistant').length),1);
   await page.screenshot({path:path.join(out,'complete-'+width+'-'+dark+'.png')});
   for(const scenario of ['keep','error','stop','ordinary']){
    await page.evaluate(()=>__start());await page.waitForTimeout(30);
    if(scenario==='ordinary'){
     await send(page,'tool',{name:'fixture_search',id:'other',status:'running'});
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
     await send(page,'tool',tool(scenario==='error'?'error':'done',{
      saved:false,unchanged:scenario==='keep',is_error:scenario==='error',result_preview:scenario==='error'?'合成保存失败':'主动记忆保持原样'}));
     assert.match(await status(page),scenario==='error'?/^记忆未保存 /:/^记忆未变 /);
    }
    await send(page,'delta',{text:'继续这段对话。'});await send(page,'done',{});
    assert.equal(await page.evaluate(()=>__result),true);assert(await page.locator('#chat-head-progress').isHidden());
    assert.equal(await page.evaluate(()=>__calls),1);
   }
   assert.deepEqual(errors,[]);
   results.push({width,dark,early_memory_status:true,private_arguments_hidden:true,stalled_and_resumed:true,saved_keep_error:true,stop_cleans_status:true,ordinary_tool_preserved:true,no_extra_request:true,layout:true,page_errors:0});
   await page.close();
  }
 }finally{await browser.close();server.close()}
 fs.writeFileSync(path.join(out,'verification.json'),JSON.stringify(results,null,2));console.log(JSON.stringify(results));
})().catch(error=>{console.error(error);server.close();process.exitCode=1});
