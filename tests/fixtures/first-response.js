(async()=>{
 await chatEnsureSessionsReady();
 const assert=(ok,message)=>{if(!ok)throw Error(message)};
 const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
 const until=async check=>{for(let i=0;i<100;i++){if(check())return;await pause(10)}throw Error('Timed out waiting for response receipt')};
 const source=window.__streamSource.replace(/\r\n/g,'\n');
 const start=source.indexOf('  var streamRenderRaf=0,streamRenderDirty=false,streamRenderStopped=false;');
 const end=source.indexOf('  // CK_STREAM_END:',start);
 const tail=source.slice(start,end);
 const execute=new (Object.getPrototypeOf(async function(){}).constructor)('cfg','out','requestState',`
  var assistantText='',nativeThinkingText='',toolEvents=[],firstReplyTs=0,requestTurnId='first-response',latencyTrace={},
      responseUserTs=Date.now(),userMessageIndexes=[0],requestBodyText='{}',recallInfo=null,requestUsage=null,requestCompleted=false,
      carriedReplyOwners=[],carriedReplyVariants=[],timeReminderContext={round:1},digestSync=null;
  function recordFirstDeltaLatency(){} function markFirstReplyTs(){return firstReplyTs||(firstReplyTs=Date.now())}
  ${tail}
  return requestCompleted;
 `);
 const original={fetch:window.fetch,raf:window.requestAnimationFrame,trim:chatMaybeAutoTrimAtIdleBoundary,
  clean:chatMaybeAutoClean,init:chatInit,submit:chatSubmitPendingMessages,sync:chatScheduleNightlySync,toast:toast,
  route:chatEnsureMainRouteReady,trimBatch:chatApplyAutoTrimForPendingBatch};
 let lastError='';toast=(text,ms,options)=>{if(options&&options.type==='error')lastError=text;};
 chatMaybeAutoTrimAtIdleBoundary=()=>{};chatMaybeAutoClean=()=>{};chatScheduleNightlySync=()=>{};chatInit=()=>{};
 const button=document.getElementById('chat-send-btn'),input=document.getElementById('chat-input');
 const results=[];
 try{
  for(const first of ['e','event: delta\ndata: {"text":"字"}\n\n','event: thinking\ndata: {"text":"想"}\n\n']){
   chatMessages=[{role:'user',text:'问题',turnId:'first-response',ts:Date.now(),inFlight:true}];
   chatSessions=[{id:'first-response',messages:chatMessages,transportMessages:[],updated:Date.now()}];chatActiveSessionId='first-response';
   chatEditingIndex=-1;chatRenderMessages({force:true,removeEphemeral:true});
   let stream,aborted=false,queued=[];
   window.fetch=async(url,options)=>{options.signal.addEventListener('abort',()=>aborted=true);return new Response(new ReadableStream({start(c){stream=c}}),{headers:{'Content-Type':'text/event-stream'}})};
   chatSubmitPendingMessages=options=>{queued.push(options);return Promise.resolve()};
   const request=chatBeginSendingUi();chatStreamProgressStart();
   const out=chatAddBubble('assistant','',false);
   window.requestAnimationFrame=()=>987654; // No render frame is allowed to run yet.
   const running=execute({sessionId:'first-response',recall:false,splitAssistantReplies:false},out,request);
   await until(()=>stream);
   assert(button.textContent==='停止'&&button.classList.contains('chat-stop-btn'),'Stop unavailable before response');
   stream.enqueue(new Uint8Array());await pause(20);
   assert(!request.responseReceived,'Empty read changed button state');
   stream.enqueue(new TextEncoder().encode(first));
   await until(()=>request.responseReceived);
   assert(button.textContent==='发送'&&!button.disabled&&!button.classList.contains('chat-stop-btn'),'First byte did not restore send');
   assert(chatSending&&chatActiveRequest===request&&!request.finished,'Receipt released the live request');
   assert(out.textContent==='','The test must observe the button before text renders');
   const stale={responseReceived:false};chatMarkResponseReceived(stale);
   assert(!stale.responseReceived&&chatActiveRequest===request,'Stale request changed active state');
   if(first==='e'){
    input.value='接着问';await chatSendMessage();
    assert(!aborted&&!request.stopped,'Send after receipt aborted the reply');
    assert(chatPendingMessages().some(m=>m.text==='接着问'),'New message was lost');
    const pendingIndex=chatMessages.findIndex(m=>m.text==='接着问');
    chatStartEditMessage(pendingIndex);assert(button.textContent==='保存','Pending edit unavailable');
    chatCancelEdit();assert(button.textContent==='发送'&&!button.classList.contains('chat-stop-btn'),'Cancel edit restored Stop');
    input.value='还没点发送';chatStoreDraftMessage({keepFocus:false});
    input.value='输入框草稿';
    assert(queued.length===0,'Queued message started before response completion');
   }
   window.requestAnimationFrame=original.raf;
   const rest=first==='e'?'vent: delta\ndata: {"text":"完整回复"}\n\n':first.includes('thinking')?'event: delta\ndata: {"text":"完整回复"}\n\n':'';
   stream.enqueue(new TextEncoder().encode(rest+'event: done\ndata: {}\n\n'));
   assert(await running,'Reply did not complete: '+lastError);
   assert(chatMessages.some(m=>m.role==='assistant'&&m.text),'Reply was discarded after early send restoration');
   if(first==='e'){
    assert(queued.length===1,'Queued send was not submitted exactly once');
    const chosen=chatPendingMessages().filter(m=>queued[0].pendingIds.includes(m.pendingId));
    assert(chosen.length===1&&chosen[0].text==='接着问','Unsubmitted staged draft joined the queued batch');
    assert(queued[0].inputSnapshot&&queued[0].extraText===''&&input.value==='输入框草稿','Input draft was consumed automatically');
   }
   results.push({first:first==='e'?'partial SSE byte':first.includes('thinking')?'thinking character':'text character',beforeRender:true,replyPreserved:true});
   input.value='';chatSubmitPendingMessages=original.submit;
  }
  // Exercise the complete submission path for two sequential turns, including transport.
  chatSessionsReady=true; // This fixture supplies its own fully loaded session.
  chatMessages=[];chatSessions=[{id:'queued-rounds',messages:chatMessages,transportMessages:[],updated:Date.now()}];chatActiveSessionId='queued-rounds';
  const cfg=chatDefaultConfig();cfg.sessionId='queued-rounds';cfg.panelKey='fixture';cfg.recall=false;cfg.autoTrimEnabled=false;
  chatSaveConfigObject(cfg);chatWriteForm(cfg);chatRenderMessages({force:true,removeEphemeral:true});
  chatEnsureMainRouteReady=async()=>({ok:true,apiBase:'https://example.invalid/v1',upstreamKey:'fixture',model:'fixture',provider:{id:'fixture'}});
  chatApplyAutoTrimForPendingBatch=async()=>({trimmed:false});
  const calls=[];let firstStream;
  window.fetch=async(url,options)=>{
   const body=JSON.parse(options.body);calls.push(body);
   return new Response(new ReadableStream({start(c){
    if(calls.length===1){firstStream=c;c.enqueue(new TextEncoder().encode('event: delta\ndata: {"text":"首"}\n\n'));}
    else c.enqueue(new TextEncoder().encode('event: delta\ndata: {"text":"第二轮回复"}\n\nevent: done\ndata: {}\n\n'));
   }}),{headers:{'Content-Type':'text/event-stream'}});
  };
  input.value='第一轮';const firstRun=chatSendMessage();
  await until(()=>firstStream&&chatActiveRequest.responseReceived);
  input.value='第二轮';await chatSendMessage();await chatSendMessage();
  input.value='未提交的第三轮';chatStoreDraftMessage({keepFocus:false});input.value='输入框草稿';
  assert(calls.length===1,'Two turns overlapped');
  firstStream.enqueue(new TextEncoder().encode('event: delta\ndata: {"text":"轮回复"}\n\nevent: done\ndata: {"transport_messages":[{"role":"user","content":"第一轮"},{"role":"assistant","content":"首轮回复"}]}\n\n'));
  await firstRun;await until(()=>calls.length===2&&!chatSending);
  assert(calls[1].text==='第二轮','Queued batch included unsubmitted draft');
  assert(JSON.stringify(calls[1]).includes('首轮回复'),'Next turn missed completed reply history');
  assert(chatMessages.filter(m=>m.role==='assistant').length===2,'Sequential replies were lost or duplicated');
  assert(chatPendingMessages().some(m=>m.text==='未提交的第三轮')&&input.value==='输入框草稿','Later drafts were consumed');
  const stopped=chatBeginSendingUi();stopped.pendingMessages=[];
  await chatSendMessage();assert(stopped.stopped&&stopped.controller.signal.aborted,'Stop before any response no longer works');
  chatMarkResponseReceived(stopped);assert(button.textContent==='发送'&&!stopped.responseReceived,'Late bytes revived stopped request');
  return {results,queuedSend:true,twoActualSubmissions:true,draftsPreserved:true,stopBeforeResponse:true};
 }finally{
  window.fetch=original.fetch;window.requestAnimationFrame=original.raf;
  chatMaybeAutoTrimAtIdleBoundary=original.trim;chatMaybeAutoClean=original.clean;
  chatInit=original.init;chatSubmitPendingMessages=original.submit;chatScheduleNightlySync=original.sync;
  toast=original.toast;
  chatEnsureMainRouteReady=original.route;chatApplyAutoTrimForPendingBatch=original.trimBatch;
 }
})()
