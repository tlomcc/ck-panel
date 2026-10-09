/* Delivery receipts survive a suspended tab. Polling never starts a model call. */
var chatRecoveryTimer=0;
async function chatResumeAfterVisibility(){
  var request=chatActiveRequest;
  if(chatSending&&request&&request.hiddenAt&&request.streamStarted&&!request.stopped&&!request.finished){
    request.hiddenAt=0;
    if(!request.responseReceived){
      // The upload may still be in transit. Detach only once the gateway has
      // acknowledged this exact turn; otherwise keep the original POST alive.
      try{
        var receipt=await chatReadDelivery(chatLoadConfig(),request.turnId);
        if(!receipt||receipt.turn_id!==request.turnId||!receipt.found&&!receipt.pending)return;
      }catch(error){return;}
    }
    if(request!==chatActiveRequest||!chatSending||request.stopped||request.finished)return;
    request.recovering=true;
    if(request.checkpointReply)request.checkpointReply();
    chatSetStatus('连接恢复中，正在补收回复');
    // This closes only the browser stream. The gateway keeps the original turn.
    if(request.controller)request.controller.abort();
    return;
  }
  return chatRecoverInterruptedTurns({silent:false});
}
function chatScheduleRecovery(delay){
  if(chatRecoveryTimer)return;
  chatRecoveryTimer=setTimeout(function(){chatRecoveryTimer=0;chatRecoverInterruptedTurns({silent:true});},delay===undefined?2500:delay);
}
function chatKeepReplyDraft(session,data){
  if(!session||!data)return;
  var old=session.replyDraft;
  if(old&&old.turn_id===data.turn_id&&!data.assistant_text&&!data.assistant_thinking&&!data.queuedPendingIds)return;
  session.replyDraft=Object.assign({},old&&old.turn_id===data.turn_id?old:{},data);
  chatSaveSessions({sessionIds:[session.id]});
}
function chatRenderReplyDraft(){
  var box=chatMessagesBox(),session=chatCurrentSession(),draft=session&&session.replyDraft;
  if(!box)return;
  box.querySelectorAll('.chat-recovery-draft').forEach(function(el){el.remove()});
  if(chatSending||!draft||(!draft.assistant_text&&!draft.assistant_thinking))return;
  if(chatMessages.some(function(m){return m.role==='assistant'&&m.turnId===draft.turn_id}))return;
  var row=document.createElement('div');row.className='chat-msg-row assistant chat-recovery-draft';
  var bubble=document.createElement('div');bubble.className='chat-bubble assistant';
  bubble.innerHTML=chatRenderAssistantContent(draft.assistant_text||'',false,draft.tools||[],undefined,draft.assistant_thinking||'',true);
  var note=document.createElement('div');note.className='chat-msg-time';
  note.textContent=draft.state==='error'||draft.state==='interrupted'?'已保留收到的内容 · 本次未完成':'已保留收到的内容 · 正在补收';
  row.appendChild(bubble);row.appendChild(note);box.appendChild(row);
}
function chatRecoveryCanonical(value){
  if(Array.isArray(value))return '['+value.map(chatRecoveryCanonical).join(',')+']';
  if(value&&typeof value==='object')return '{'+Object.keys(value).sort().filter(function(k){return value[k]!==undefined}).map(function(k){return JSON.stringify(k)+':'+chatRecoveryCanonical(value[k])}).join(',')+'}';
  return JSON.stringify(value);
}
async function chatRecoveryTransportHint(cfg){
  var session=chatSessions.find(function(s){return s.id===cfg.sessionId}),rows=session&&session.transportMessages;
  if(!Array.isArray(rows)||!rows.length||!window.crypto||!window.crypto.subtle)return null;
  var canonical=chatRecoveryCanonical(rows);
  var hash=await window.crypto.subtle.digest('SHA-256',new TextEncoder().encode(canonical));
  return {session:session,count:rows.length,canonical:canonical,hash:Array.from(new Uint8Array(hash)).map(function(b){return b.toString(16).padStart(2,'0')}).join('')};
}
async function chatReadDelivery(cfg,turnId){
  var controller=new AbortController(),timer;
  var timeout=new Promise(function(resolve,reject){timer=setTimeout(function(){controller.abort();reject(new Error('补收连接等待超时'))},12000)});
  try{
    var url=chatEndpoint(cfg).replace(/\/chat$/,'/chat/last')+'?key='+encodeURIComponent(cfg.panelKey)
      +'&session_id='+encodeURIComponent(cfg.sessionId)+'&turn_id='+encodeURIComponent(turnId);
    var hint=await Promise.race([chatRecoveryTransportHint(cfg),timeout]);
    if(hint)url+='&known_transport_count='+hint.count+'&known_transport_sha256='+hint.hash;
    var response=await Promise.race([fetch(url,{cache:'no-store',signal:controller.signal}),timeout]);
    if(!response.ok)throw new Error('补收连接暂不可用');
    var data=await Promise.race([response.json(),timeout]),delta=data.transport_delta;
    if(delta){
      if(!hint||delta.base_count!==hint.count||delta.base_sha256!==hint.hash||!Array.isArray(delta.messages)||chatRecoveryCanonical(hint.session.transportMessages)!==hint.canonical)throw new Error('上下文已变化，重新读取补收回复');
      data.transport_messages=hint.session.transportMessages.concat(delta.messages);delete data.transport_delta;
    }
    return data;
  }finally{clearTimeout(timer)}
}
async function chatReadStreamChunk(reader,signal){
  var timer,onAbort;
  try{
    var pending=[reader.read(),new Promise(function(resolve,reject){
      timer=setTimeout(function(){reject(chatMarkNetworkFailure(new Error('回复连接暂时中断，正在补收')))},45000);
    })];
    if(signal)pending.push(new Promise(function(resolve,reject){
      onAbort=function(){reject(chatCreateAbortError())};
      if(signal.aborted)onAbort();else signal.addEventListener('abort',onAbort,{once:true});
    }));
    return await Promise.race(pending);
  }finally{clearTimeout(timer);if(signal&&onAbort)signal.removeEventListener('abort',onAbort)}
}
