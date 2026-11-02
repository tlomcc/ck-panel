(async()=>{
 const check=(ok,message)=>{if(!ok)throw Error(message)};
 const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
 const until=async(test,message)=>{for(let i=0;i<250;i++){if(test())return;await pause(20)}throw Error(message)};
 const source=window.__streamSource.replace(/\r\n/g,'\n');
 const start=source.indexOf('  var streamRenderRaf=0,streamRenderDirty=false,streamRenderStopped=false;');
 const end=source.indexOf('  // CK_STREAM_END:',start);
 check(start>0&&end>start,'Missing production stream handler');
 const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
 const execute=new AsyncFunction('cfg','out','requestState',`
  var assistantText='',nativeThinkingText='',toolEvents=[],firstReplyTs=0,requestTurnId='auto-mode-turn',latencyTrace={},
      responseUserTs=Date.now(),userMessageIndexes=[0],requestBodyText='{}',recallInfo=null,requestUsage=null,requestCompleted=false,
      carriedReplyOwners=[],carriedReplyVariants=[],timeReminderContext={round:1},digestSync=null;
  function recordFirstDeltaLatency(){} function markFirstReplyTs(){return firstReplyTs||(firstReplyTs=Date.now())}
  ${source.slice(start,end)}
  return requestCompleted;
 `);
 const original={fetch:window.fetch,load:chatLoadConfig,delivery:chatReadDelivery,
  trim:chatMaybeAutoTrimAtIdleBoundary,clean:chatMaybeAutoClean,sync:chatScheduleNightlySync,recovery:chatScheduleRecovery};
 const short='甲'.repeat(74)+'，。！？；：“”「」（）……—\n'+'乙'.repeat(75)+'！';
 const finalText=short+'丙丁';
 const results=[];
 let requests=0,receipts=0;
 const visible=()=>Array.from(document.querySelectorAll('.chat-ephemeral-row .chat-bubble.assistant'))
  .filter(el=>!el.closest('.chat-msg-row').hidden&&!el.classList.contains('streaming-empty'));
 function reset(mode){
  chatFlushAssistantRevealQueue({render:false});
  chatMessages=[{role:'user',text:'合成测试：核对回复显示。',turnId:'auto-mode-turn',ts:Date.now(),inFlight:true,inFlightTurnId:'auto-mode-turn'}];
  chatSessions=[{id:'auto-mode-session',messages:chatMessages,transportMessages:[],updated:Date.now()}];
  chatActiveSessionId='auto-mode-session';chatSessionsReady=true;chatEditingIndex=-1;
  const cfg={...original.load(),sessionId:chatActiveSessionId,splitAssistantReplies:mode,recall:false,autoTrimEnabled:false,autoCleanEnabled:false};
  chatLoadConfig=()=>cfg;
  chatRenderMessages({force:true,removeEphemeral:true});chatTogglePlus(false);
  return cfg;
 }
 try{
  chatMaybeAutoTrimAtIdleBoundary=()=>{};chatMaybeAutoClean=()=>{};chatScheduleNightlySync=()=>{};chatScheduleRecovery=()=>{};
  for(const mode of [true,'auto',false]){
   const cfg=reset(mode);let controller;
   window.fetch=async(url,options={})=>{
    if(options.method!=='POST')return original.fetch(url,options);
    requests++;
    return new Response(new ReadableStream({start(c){controller=c}}),{headers:{'Content-Type':'text/event-stream'}});
   };
   const send=(event,value)=>controller.enqueue(new TextEncoder().encode('event: '+event+'\ndata: '+JSON.stringify(value)+'\n\n'));
   const request=chatBeginSendingUi();request.pendingMessages=[];chatStreamProgressStart();
   const running=execute(cfg,chatAddBubble('assistant','',false),request);
   await until(()=>controller,'No synthetic response stream');
   send('thinking',{text:'想'.repeat(500)});
   send('delta',{text:short});
   await until(()=>visible().map(x=>x.textContent).join('').replace(/\s/g,'')===short.replace(/\s/g,''),'149-character text missing');
   check(visible().length===(mode===false?1:2),'149 characters split incorrectly: '+mode);
   const first=visible()[0];
   send('delta',{text:'丙'});
   await until(()=>visible().map(x=>x.textContent).join('').replace(/\s/g,'')===(short+'丙').replace(/\s/g,''),'150-character text missing');
   check(visible().length===(mode===true?2:1),'150 characters did not select the right mode: '+mode);
   check(visible()[0]===first,'Merging replaced the first bubble');
   send('delta',{text:'丁'});
   await until(()=>visible().map(x=>x.textContent).join('').replace(/\s/g,'')===finalText.replace(/\s/g,''),'151-character text missing');
   send('done',{});
   check(await running,'Completion did not finish');
   const replies=chatMessages.filter(m=>m.role==='assistant');
   check(replies.length===(mode===true?2:1),'Completed reply lost the selected mode: '+mode);
   check(replies.map(m=>m.text).join('\n')===finalText,'Completion changed or duplicated text');
   check(replies[0].thinking==='想'.repeat(500),'Native thinking was lost');
   check(!document.querySelector('.chat-ephemeral-row'),'Preview bubbles survived completion');
   check(!chatAssistantRevealQueue?.hidden.size,'Merged text was hidden again');
   results.push({mode,stream149:true,stream150:true,stream151:true,complete:true,originalText:true,thinkingPreserved:true});
  }
  // A short completed answer must still split after long tagged/native thinking.
  {
   const cfg=reset('auto');
   window.fetch=async()=>{
    requests++;
    const payload='event: delta\ndata: '+JSON.stringify({text:'<think>'+'想'.repeat(500)+'</think>'+short})+'\n\nevent: done\ndata: {}\n\n';
    return new Response(payload,{headers:{'Content-Type':'text/event-stream'}});
   };
   const request=chatBeginSendingUi();request.pendingMessages=[];chatStreamProgressStart();
   check(await execute(cfg,chatAddBubble('assistant','',false),request),'Short response failed');
   chatFlushAssistantRevealQueue();
   check(chatMessages.filter(m=>m.role==='assistant').length===2,'Thinking pushed short body over the threshold');
   check(chatMessages[1].text.includes('想'.repeat(500)),'Tagged thinking was lost');
   results.push({mode:'auto',shortComplete:true,taggedThinkingExcluded:true});
  }
  for(const [text,count] of [[short,2],[short+'丙',1]]){
   reset('auto');
   const postsBefore=requests;
   chatReadDelivery=async()=>{receipts++;return {found:true,turn_id:'auto-mode-turn',turn_matched:true,assistant_text:text,assistant_thinking:'恢复的思考',created_at:Math.floor(Date.now()/1000),tools:[]}};
   await chatRecoverInterruptedTurns({silent:true});
   await chatRecoverInterruptedTurns({silent:true});
   const replies=chatMessages.filter(m=>m.role==='assistant');
   check(replies.length===count,'Recovered reply discarded auto mode');
   check(replies.map(m=>m.text).join('\n')===text,'Recovery lost or duplicated text');
   check(requests===postsBefore,'Recovery resent the request');
   check(replies[0].thinking==='恢复的思考','Recovered thinking lost');
   results.push({mode:'auto',recoveryCount:count,noReplay:true,originalText:true});
  }
  check(requests===4&&receipts===2,'Unexpected chat request or repeated receipt');
  check(document.getElementById('chat-messages').scrollWidth<=document.getElementById('chat-messages').clientWidth+2,'Chat overflows horizontally');
  return {results,requests,receipts};
 }finally{
  window.fetch=original.fetch;chatLoadConfig=original.load;chatReadDelivery=original.delivery;
  chatMaybeAutoTrimAtIdleBoundary=original.trim;chatMaybeAutoClean=original.clean;
  chatScheduleNightlySync=original.sync;chatScheduleRecovery=original.recovery;
  chatFlushAssistantRevealQueue({render:false});
 }
})()
