(async()=>{
 const assert=(value,message)=>{if(!value)throw Error(message)};
 const pause=ms=>new Promise(r=>setTimeout(r,ms));
 const source=window.__streamSource.replace(/\r\n/g,'\n');
 const start=source.indexOf('  var streamRenderRaf=0,streamRenderDirty=false,streamRenderStopped=false;');
 const end=source.indexOf('  // CK_STREAM_END:',start);
 const tail=source.slice(start,end);
 const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
 const execute=new AsyncFunction('cfg','out','requestState',`
  var assistantText='',nativeThinkingText='',toolEvents=[],firstReplyTs=0,requestTurnId='completion',latencyTrace={},
      responseUserTs=Date.now(),userMessageIndexes=[0],requestBodyText='{}',recallInfo=null,requestUsage=null,requestCompleted=false,
      carriedReplyOwners=[],carriedReplyVariants=[],timeReminderContext={round:1},digestSync=null;
  function recordFirstDeltaLatency(){} function markFirstReplyTs(){return firstReplyTs||(firstReplyTs=Date.now())}
  ${tail}
  return requestCompleted;
 `);
 const originalFetch=window.fetch;
 const oldTrim=chatMaybeAutoTrimAtIdleBoundary,oldClean=chatMaybeAutoClean;
 chatMaybeAutoTrimAtIdleBoundary=()=>{};chatMaybeAutoClean=()=>{};
 try{
  for(const marker of ['event: done\ndata: {}\n\n','data: [DONE]\n\n']){
   chatMessages=[{role:'user',text:'结束测试',turnId:'completion',ts:Date.now(),inFlight:true}];
   chatSessions=[{id:'completion',messages:chatMessages,transportMessages:[],updated:Date.now()}];chatActiveSessionId='completion';
   chatRenderMessages({force:true,removeEphemeral:true});
   let cancelled=false;
   window.fetch=async()=>new Response(new ReadableStream({start(c){c.enqueue(new TextEncoder().encode('event: delta\ndata: {"text":"收到"}\n\nevent: transport\ndata: {"messages":[{"role":"assistant","content":"收到"}]}\n\n'+marker));},cancel(){cancelled=true;return new Promise(()=>{})}}),{headers:{'Content-Type':'text/event-stream'}});
   const request=chatBeginSendingUi();request.pendingMessages=[];chatStreamProgressStart();
   const out=chatAddBubble('assistant','',false);
   const completed=await Promise.race([execute({sessionId:'completion',recall:false,splitAssistantReplies:false},out,request),pause(2200).then(()=>{throw Error('done received but sending UI still waiting for EOF')})]);
   assert(completed,'reply did not finish');assert(cancelled,'reader was not cancelled after done');
   assert(!chatSending&&!document.getElementById('chat-send-btn').classList.contains('chat-stop-btn'),'send button stayed red after completion');
   assert(document.getElementById('chat-head-progress').hidden,'writing indicator survived completion');
   assert(chatCurrentSession().transportMessages.length===1,'transport before done was lost');
   assert(chatMessages.some(m=>m.role==='assistant'&&m.text==='收到'),'completed reply missing');
  }
  return {doneWithoutEOF:true,doneMarkerWithoutEOF:true,cancelWithoutResolution:true,sendButtonRestored:true};
 }finally{window.fetch=originalFetch;chatMaybeAutoTrimAtIdleBoundary=oldTrim;chatMaybeAutoClean=oldClean;}
})()
