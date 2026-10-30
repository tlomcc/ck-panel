const {chromium}=require('playwright');
const fs=require('fs'),path=require('path'),http=require('http'),assert=require('assert');
const root=path.resolve(__dirname,'..');
const out=process.env.CK_SUBSCRIPTION_TEST_OUT||fs.mkdtempSync(path.join(require('os').tmpdir(),'ck-subscription-errors-'));
fs.mkdirSync(out,{recursive:true});
const source=fs.readFileSync(path.join(root,'script.js'),'utf8');
const server=http.createServer((req,res)=>{
 const name=decodeURIComponent(new URL(req.url,'http://localhost').pathname).replace(/^\//,'')||'index.html';
 const file=path.resolve(root,name);
 if(!file.startsWith(root+path.sep)||!fs.existsSync(file)){res.writeHead(404);return res.end()}
 let data=fs.readFileSync(file);
 if(name==='index.html')data=Buffer.from(data.toString().replace(/<script src="(?:pwa|script-extra)\.js[^>]+><\/script>/g,''));
 if(name==='script.js')data=Buffer.from(data.toString().replace(/^init\(\);\s*$/m,''));
 res.setHeader('Content-Type',name.endsWith('.js')?'text/javascript':name.endsWith('.css')?'text/css':name.endsWith('.svg')?'image/svg+xml':name.endsWith('.png')?'image/png':'text/html');res.end(data);
});
const setup=async(page,dark)=>page.evaluate(({source,dark})=>{
 localStorage.clear();document.getElementById('loading-wrap').classList.add('done');
 document.body.classList.add('chat-active');document.body.classList.toggle('dark',dark);
 document.getElementById('tab-chat').classList.add('active');
 currentPanelTab='chat';
 chatSessionsReady=true;apiProvidersLoaded=true;apiProviders={};
 chatMaybeAutoTrimAtIdleBoundary=()=>{};chatMaybeAutoClean=()=>{};chatScheduleNightlySync=()=>{};
 chatStartReplyWatch=()=>()=>{};chatSendQueuedResponse=()=>{};
 window.__notices=[];window.__calls=0;window.__retryClicks=0;window.__subscriptionClicks=0;
 toast=(text)=>window.__notices.push(String(text));
 chatRetryFailedUser=()=>window.__retryClicks++;ckOpenSubscription=()=>window.__subscriptionClicks++;
 const start=source.indexOf('  var streamRenderRaf=0,streamRenderDirty=false,streamRenderStopped=false;');
 const end=source.indexOf('  // CK_STREAM_END:',start);
 if(start<0||end<0)throw Error('stream closure missing');
 const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
 window.__execute=new AsyncFunction('cfg','out','requestState',`
  var assistantText='',nativeThinkingText='',toolEvents=[],firstReplyTs=0,requestTurnId='subscription-test',latencyTrace={},
      responseUserTs=Date.now(),userMessageIndexes=[0],requestBodyText='{}',recallInfo=null,requestUsage=null,requestCompleted=false,
      carriedReplyOwners=[],carriedReplyVariants=[],timeReminderContext={round:1},digestSync=null;
  function recordFirstDeltaLatency(){} function markFirstReplyTs(){return firstReplyTs||(firstReplyTs=Date.now())}
  ${source.slice(start,end)}
  return requestCompleted;
 `);
 window.__runSubscription=async function(scenario){
  window.__notices=[];window.__calls=0;
  chatMessages=[{role:'user',text:'继续我们刚才的话题。',turnId:'subscription-test',ts:Date.now(),inFlight:true}];
  chatSessions=[{id:'subscription-test',messages:chatMessages,transportMessages:[],updated:Date.now()}];chatActiveSessionId='subscription-test';
  chatRenderMessages({force:true,removeEphemeral:true});
  const encoder=new TextEncoder();
  const frame=(event,data)=>'event: '+event+'\ndata: '+JSON.stringify(data)+'\n\n';
  window.fetch=async()=>{
   window.__calls++;
   return new Response(new ReadableStream({start(controller){
    const send=(event,data)=>controller.enqueue(encoder.encode(frame(event,data)));
    if(['success','temporary','stop'].includes(scenario))send('subscription_retry',{retry_index:1,max_retries:2,delay_seconds:3});
    if(scenario==='stop'){window.__heldController=controller;return}
    setTimeout(()=>{
     if(scenario==='success'){
      send('delta',{text:'已经接上了，我们继续。'});send('done',{});
     }else{
      const code=scenario==='temporary'?'subscription_temporary':scenario==='auth'?'subscription_auth':scenario==='limit'?'subscription_limit':scenario==='egress'?'subscription_egress':scenario==='partial'?'subscription_temporary':null;
      if(scenario==='partial')send('delta',{text:'已经收到的半句话'});
      send('error',code?{code,execution_backend:'claude_code_subscription',error:'classified fixture'}:
        {error:'Upstream HTTP 502 POST https://api.anthropic.com/v1/messages: Claude Code 返回了上游 API 错误'});
     }
     controller.close();
    },200);
   }}),{headers:{'Content-Type':'text/event-stream'}});
  };
  const request=chatBeginSendingUi();request.pendingMessages=[];chatStreamProgressStart();window.__request=request;
  const out=chatAddBubble('assistant','',false);
  return window.__execute({sessionId:'subscription-test',chatApiSource:'claude_subscription',recall:false,splitAssistantReplies:false},out,request);
 };
},{source,dark});

(async()=>{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const browser=await chromium.launch({args:['--no-sandbox','--disable-dev-shm-usage']});const results=[];
 try{
  for(const [width,dark] of [[320,false],[390,false],[768,false],[1440,false],[390,true]]){
   const page=await browser.newPage({viewport:{width,height:850},serviceWorkers:'block'}),errors=[];
   page.on('pageerror',error=>{errors.push(error.message);console.log('Fixture page error: '+error.message)});
   await page.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
   await page.goto('http://127.0.0.1:'+server.address().port+'/index.html');
   await page.waitForFunction(()=>typeof chatRenderMessages==='function'&&typeof CKChatHistory==='object');
   await setup(page,dark);
   const success=await page.evaluate(()=>window.__runSubscription('success'));
   assert.equal(success,true);assert.equal(await page.evaluate(()=>__calls),1);
   assert.deepEqual(await page.evaluate(()=>__notices),[]);
   assert.equal(await page.evaluate(()=>chatMessages.filter(m=>m.role==='assistant').length),1);
   for(const [scenario,code] of [['temporary','subscription_temporary'],['legacy','subscription_unknown'],['auth','subscription_auth'],['limit','subscription_limit'],['egress','subscription_egress'],['partial','subscription_temporary']]){
    assert.equal(await page.evaluate(value=>window.__runSubscription(value),scenario),false);
    assert.equal(await page.evaluate(()=>__calls),1,'browser must not replay failed chat');
    assert.deepEqual(await page.evaluate(()=>__notices),[],'subscription error must remain inline');
    assert.equal(await page.evaluate(()=>chatMessages[0].sendFailureCode),code);
    assert.equal(await page.locator('.chat-subscription-notice').count(),1);
    assert.equal(await page.locator('.chat-subscription-notice [data-act]').getAttribute('data-act'),['auth','limit','egress'].includes(scenario)?'subscription':'retry');
    const text=await page.locator('.chat-subscription-notice').innerText();assert(!/HTTP|https:|API Key|封号/.test(text));
    if(scenario==='partial')assert.match(await page.evaluate(()=>chatCurrentSession().replyDraft&&chatCurrentSession().replyDraft.assistant_text||''),/半句话/);
    await page.locator('.chat-subscription-notice [data-act]').click();
    if(scenario==='temporary'){
     assert.equal(await page.evaluate(()=>__retryClicks),1);
     await page.evaluate(async()=>{
      await chatSaveSessionsToIndexedDb.pending;
      const restored=await chatLoadSessionsFromIndexedDb();
      const session=restored.find(item=>item.id==='subscription-test');
      if(!session||session.messages[0].sendFailureCode!=='subscription_temporary')throw Error('failure state missing from IndexedDB');
      chatSessions=restored;chatMessages=session.messages;chatRenderMessages({force:true,removeEphemeral:true});
     });
     assert.equal(await page.locator('.chat-subscription-notice').count(),1,'saved error code survives restoration');
     assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'horizontal overflow');
     await page.screenshot({path:path.join(out,'temporary-'+width+(dark?'-dark':'')+'.png'),fullPage:true});
     if(width===390&&!dark){
      const notice=await page.locator('.chat-msg-row.send-failed').evaluate(el=>el.outerHTML);
      const css=fs.readFileSync(path.join(root,'wechat.css'),'utf8');
      const html='<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>'+css+'</style><style>body{margin:0;background:#f4f7f0;font:14px/1.5 system-ui,sans-serif;color:#243e31}main{max-width:640px;margin:0 auto;padding:20px}h1{font-size:20px;margin:0 0 24px;font-weight:600}.chat-msg-row{display:flex;flex-direction:column;align-items:flex-end}.chat-bubble.user{background:#d8eee0;padding:12px 16px;border-radius:16px}.chat-msg-time{margin-top:4px;color:#606060;font-size:12px}</style><body class="chat-active"><main><h1>CK 订阅聊天</h1>'+notice+'</main></body></html>';
      fs.writeFileSync(path.join(out,'component.html'),html);
     }
    }
   }
   assert.equal(await page.evaluate(()=>__subscriptionClicks),3);
   assert.equal(await page.evaluate(()=>chatSending),false);
   assert.deepEqual(errors,[]);
   results.push({width,dark,success_after_wait:true,inline_failures:6,no_toasts:true,no_browser_replay:true,partial_reply_preserved:true,page_errors:0});
   await page.close();
  }
 }finally{await browser.close();server.close()}
 fs.writeFileSync(path.join(out,'browser.json'),JSON.stringify(results,null,2));console.log(JSON.stringify(results));
})().catch(error=>{console.error(error);server.close();process.exitCode=1});
