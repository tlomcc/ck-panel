(async()=>{
 const assert=(v,m)=>{if(!v)throw Error(m)};
 const source=window.__streamSource.replace(/\r\n/g,'\n');
 const start=source.indexOf('  var streamRenderRaf=0,streamRenderDirty=false,streamRenderStopped=false;');
 const end=source.indexOf('  // CK_STREAM_END:',start);
 const tail=source.slice(start,end);
 const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
 const execute=new AsyncFunction('cfg','out','requestState',`
  var assistantText='',nativeThinkingText='',toolEvents=[],firstReplyTs=0,requestTurnId='recover-turn',latencyTrace={},
      responseUserTs=Date.now(),userMessageIndexes=[0],requestBodyText='{}',recallInfo=null,requestUsage=null,requestCompleted=false,
      carriedReplyOwners=[],carriedReplyVariants=[],timeReminderContext={round:1},digestSync=null;
  function recordFirstDeltaLatency(){} function markFirstReplyTs(){return firstReplyTs||(firstReplyTs=Date.now())}
  ${tail}
  return requestCompleted;
 `);
 const saved={fetch:window.fetch,load:chatLoadConfig,schedule:chatScheduleRecovery,trim:chatMaybeAutoTrimAtIdleBoundary,clean:chatMaybeAutoClean};
 let posts=0,polls=0,scheduled=0;const recoveredAt=Math.floor(Date.now()/1000)-120;
 const cfg={sessionId:'recovery-session',panelKey:'fixture',gatewayUrl:'https://fixture.invalid',recall:false,splitAssistantReplies:false};
 try{
  chatLoadConfig=()=>cfg;chatScheduleRecovery=()=>{scheduled++};chatMaybeAutoTrimAtIdleBoundary=()=>{};chatMaybeAutoClean=()=>{};
  chatMessages=[{role:'user',text:'测试断线',turnId:'recover-turn',ts:Date.now(),inFlight:true,inFlightAt:Date.now(),inFlightTurnId:'recover-turn'}];
  chatSessions=[{id:cfg.sessionId,messages:chatMessages,transportMessages:[],updated:Date.now(),cacheRebuildPending:true,
    digestLastSync:{id:'resume-sync',scope:chatDigestActiveScope(cfg),turnId:'recover-turn',at:Date.now()-130000,rounds:5,status:'pending'}}];chatActiveSessionId=cfg.sessionId;
  chatRenderMessages({force:true,removeEphemeral:true});
  window.fetch=async(url,init)=>{
   if(init.method==='POST'){
    posts++;let pulled=false;
    return new Response(new ReadableStream({pull(c){
     if(pulled){c.error(new TypeError('NetworkError'));return}pulled=true;
     c.enqueue(new TextEncoder().encode('event: thinking\ndata: {"text":"思考片段"}\n\nevent: delta\ndata: {"text":"已显示的部分"}\n\n'));
    }}),{headers:{'Content-Type':'text/event-stream'}});
   }
   polls++;
   return new Response(JSON.stringify(polls<3?{ok:true,pending:true,found:false,state:'running',turn_id:'recover-turn',assistant_text:'已显示的部分',assistant_thinking:'思考片段'}:
     {ok:true,pending:false,found:true,state:'complete',created_at:recoveredAt,turn_id:'recover-turn',turn_matched:true,assistant_text:'已显示的部分，完整结束。',assistant_thinking:'思考片段',usage:{output_tokens:8,cache_read_input_tokens:21000},transport_messages:[{role:'assistant',content:'完整结束'}]}),{headers:{'Content-Type':'application/json'}});
  };
  const request=chatBeginSendingUi();request.pendingMessages=[];chatStreamProgressStart();
  const completed=await execute(cfg,chatAddBubble('assistant','',false),request);
  assert(!completed&&posts===1,'disconnect replayed the paid POST');
  assert(chatMessages[0].inFlight&&!chatMessages[0].sendFailed,'disconnect was prematurely declared failure');
  assert(chatCurrentSession().replyDraft.assistant_text==='已显示的部分','draft not persisted');
  assert(chatSessionStorageData(100,1000,1000)[0].replyDraft.assistant_thinking==='思考片段','draft missing from reload snapshot');
  assert(document.querySelector('.chat-recovery-draft').textContent.includes('已显示的部分'),'partial reply disappeared');
  await chatRecoverInterruptedTurns({silent:true});await chatRecoverInterruptedTurns({silent:true});
  assert(chatMessages[0].inFlight&&!chatMessages[0].sendFailed,'running response lost after two pending polls');
  await chatRecoverInterruptedTurns({silent:true});await chatRecoverInterruptedTurns({silent:true});
  assert(chatMessages.filter(m=>m.role==='assistant').length===1,'recovery duplicated or lost assistant');
  assert(chatMessages.find(m=>m.role==='assistant').text==='已显示的部分，完整结束。','final text missing');
  assert(!chatMessages[0].inFlight&&!chatCurrentSession().replyDraft,'completed receipt not cleared');
  assert(chatCurrentSession().transportMessages.length===1,'context missing after resume');
  assert(chatCurrentSession().cacheRebuildPending===false,'completed recovery would rebuild the cache again');
  assert(chatCurrentSession().cacheLastReadAt===recoveredAt*1000,'cache renewal must use the receipt timestamp');
  assert(chatCurrentSession().digestLastSync.status==='synced','same-turn recovery did not confirm synchronization');
  assert(document.getElementById('chat-head-progress').hidden,'writing indicator still running');
  return {posts,polls,scheduled,partialSaved:true,pendingSurvives:true,completeOnce:true,cacheRenewed:true,syncConfirmed:true};
 }finally{window.fetch=saved.fetch;chatLoadConfig=saved.load;chatScheduleRecovery=saved.schedule;chatMaybeAutoTrimAtIdleBoundary=saved.trim;chatMaybeAutoClean=saved.clean;}
})()
