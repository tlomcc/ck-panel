/* Synthetic browser fixture only. No fetch in this file can reach a real server. */
window.__fixtureErrors=[];window.__fixtureRequests=[];window.__fixturePlans=[];window.__fixtureSubscriptionReady=true;
addEventListener('error',function(event){__fixtureErrors.push(event.message)});
addEventListener('unhandledrejection',function(event){__fixtureErrors.push(String(event.reason))});
if(!localStorage.getItem('__gomoku_fixture_initialized')){
  localStorage.setItem('__gomoku_fixture_initialized','1');
  localStorage.setItem('ckMemoryApiKey','fixture-panel');
  localStorage.setItem('themePalette','fresh-green-folio-v3');localStorage.setItem('theme','light');
  localStorage.setItem('ckBackendRouteV1',JSON.stringify({mode:'vps',gateway:'https://tlomcc.cc.cd:18443/gateway',mcp:'https://tlomcc.cc.cd:18443/mcp',execution:'claude_code_subscription',subscriptionModel:'sonnet',server:'us'}));
  localStorage.setItem('ckChatConfigV2',JSON.stringify({sessionId:'ck-gomoku-fixture',system:'你是小克。延续当前聊天里的记忆与话题。',systemPromptEnabled:true,thinkingPromptEnabled:false,thinkingMode:'off',recall:true,factRecallMode:'b',autoTrimEnabled:false,autoCleanEnabled:false,dailyDigestEnabled:false,newSessionDigestSyncEnabled:false,splitAssistantReplies:false,retainNativeThinkingHistory:true}));
  var now=Date.now(),messages=[
    {role:'user',text:'今天想喝茉莉花茶，帮我记着这个小计划。',turnId:'fixture-old-1',ts:now-120000},
    {role:'assistant',text:'记着了。等会儿泡一杯，我们慢慢聊。',turnId:'fixture-old-1',ts:now-119000},
    {role:'user',text:'等下想和你下五子棋，还想接着聊天。',turnId:'fixture-old-2',ts:now-60000},
    {role:'assistant',text:'好呀，下棋的时候也可以说话。你先执黑，我拿白棋。',turnId:'fixture-old-2',ts:now-59000}
  ];
  var transport=messages.map(function(m){return {role:m.role,content:[{type:'text',text:m.text}]}});
  var session={id:'ck-gomoku-fixture',title:'小克',created:now-200000,updated:now,messages:messages,transportMessages:transport,transportUpdated:now-59000,firstUserText:messages[0].text,firstUserTs:messages[0].ts,cacheFullCreatedAt:now-120000,cacheFullCreateTokens:8000,cacheLastReadAt:now-60000,cacheLastReadTokens:8000,cacheGeneration:7,wakeEnabled:true,wakeSyncAt:now};
  localStorage.setItem('ckChatSessionsV2',JSON.stringify([session,{id:'ck-gomoku-other',title:'另一个窗口',messages:[{role:'user',text:'这个窗口有自己单独的记忆。',ts:now-1000}],transportMessages:[],created:now-200000,updated:now-1000,wakeEnabled:true,wakeSyncAt:now}]));
}
function fixtureJson(data,status){return new Response(JSON.stringify(data),{status:status||200,headers:{'Content-Type':'application/json'}})}
function fixtureSse(body,options){
  var plan=__fixturePlans.shift()||{},reply=plan.reply||'我记得那杯茉莉花茶，我们一边下棋一边聊。\n【落子：I9】';
  var previous=body.transport_messages||[],transport=previous.concat([{role:'user',content:[{type:'text',text:body.text}]},{role:'assistant',content:[{type:'text',text:reply}]}]);
  var usage={cache_hit:true,cache_read_input_tokens:8000,cache_creation_input_tokens:120,input_tokens:120,output_tokens:55,model:'sonnet',execution_backend:'claude_code_subscription'};
  var receipt={ok:true,found:true,turn_matched:true,turn_id:body.turn_id,state:'done',pending:false,created_at:Date.now()/1000,assistant_text:reply,assistant_thinking:'',tools:[],usage:usage,transport_messages:transport};
  var encoder=new TextEncoder(),timers=[],closed=false;
  function storeReceipt(){sessionStorage.setItem('__gomoku_receipt_'+body.turn_id,JSON.stringify(receipt))}
  if(plan.durableReceipt)storeReceipt();
  return new Response(new ReadableStream({
    start:function(controller){
      function emit(event,value){if(!closed)controller.enqueue(encoder.encode('event: '+event+'\ndata: '+JSON.stringify(value)+'\n\n'))}
      function later(fn,ms){timers.push(setTimeout(function(){if(!closed)fn()},ms))}
      if(options.signal)options.signal.addEventListener('abort',function(){if(!closed){closed=true;timers.forEach(clearTimeout);controller.error(new DOMException('Aborted','AbortError'))}});
      if(plan.failure){later(function(){emit('error',{error:'测试中的请求未完成',code:'subscription_temporary',execution_backend:'claude_code_subscription'});closed=true;controller.close()},50);return}
      later(function(){emit('delta',{text:plan.partial||reply})},plan.startDelay||50);
      later(function(){
        storeReceipt();
        if(!plan.disconnect){if(plan.partial&&reply.indexOf(plan.partial)===0)emit('delta',{text:reply.slice(plan.partial.length)});emit('transport',{messages:transport});emit('done',{usage:usage})}
        closed=true;controller.close();
      },plan.delay||120);
    },
    cancel:function(){closed=true;timers.forEach(clearTimeout)}
  }),{status:200,headers:{'Content-Type':'text/event-stream'}});
}
window.fetch=async function(input,options){
  var url=new URL(typeof input==='string'?input:input.url,location.href),opts=options||{},body;
  try{body=opts.body?JSON.parse(opts.body):null}catch(e){}
  __fixtureRequests.push({path:url.pathname,method:opts.method||'GET',body:body,origin:url.origin});
  if(url.pathname.endsWith('/chat')&&opts.method==='POST')return fixtureSse(body,opts);
  if(url.pathname.endsWith('/ck/subscription/status'))return fixtureJson({ok:true,ready:__fixtureSubscriptionReady,status:__fixtureSubscriptionReady?'ready':'unavailable',message:__fixtureSubscriptionReady?'':'固定出口验证未通过',egress:{ready:__fixtureSubscriptionReady,state:__fixtureSubscriptionReady?'verified':'blocked',observed_ip:'192.220.15.95',expected_ip:'192.220.15.95'}});
  if(url.pathname.endsWith('/ck/chat/last')){
    var turn=url.searchParams.get('turn_id')||'',raw=sessionStorage.getItem('__gomoku_receipt_'+turn);
    return fixtureJson(raw?JSON.parse(raw):{ok:true,found:false,pending:true,state:'running',turn_id:turn});
  }
  if(url.pathname.includes('wake'))return fixtureJson({ok:true,enabled:true,status:'scheduled',interval_seconds:3000,next_wake_at:Date.now()/1000+2800,cache_strategy:'dual_1h',session_id:url.searchParams.get('session_id')||'ck-gomoku-fixture'});
  if(url.pathname.endsWith('/config'))return fixtureJson({providers:{},keys:[]});
  if(url.pathname.endsWith('version.json'))return fixtureJson({version:window.CK_PANEL_VERSION});
  if(url.pathname.includes('health'))return fixtureJson({status:'ok',chat_region:'us',chat_backends:['claude_code_subscription']});
  return fixtureJson({ok:true,items:[],windows:[],providers:{},worldbooks:[],enabled:false,status:'off',jobs:[]});
};
