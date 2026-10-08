/* Delivery receipts survive a suspended tab. Polling never starts a model call. */
var chatRecoveryTimer=0;
function chatScheduleRecovery(delay){
  if(chatRecoveryTimer)return;
  chatRecoveryTimer=setTimeout(function(){chatRecoveryTimer=0;chatRecoverInterruptedTurns({silent:true});},delay===undefined?2500:delay);
}
function chatKeepReplyDraft(session,data){
  if(!session||!data)return;
  var old=session.replyDraft;
  if(old&&old.turn_id===data.turn_id&&!data.assistant_text&&!data.assistant_thinking)return;
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
async function chatReadDelivery(cfg,turnId){
  var controller=new AbortController(),timer=setTimeout(function(){controller.abort()},12000);
  try{
    var url=chatEndpoint(cfg).replace(/\/chat$/,'/chat/last')+'?key='+encodeURIComponent(cfg.panelKey)
      +'&session_id='+encodeURIComponent(cfg.sessionId)+'&turn_id='+encodeURIComponent(turnId);
    var response=await fetch(url,{cache:'no-store',signal:controller.signal});
    if(!response.ok)throw new Error('补收连接暂不可用');
    return await response.json();
  }finally{clearTimeout(timer)}
}
async function chatReadStreamChunk(reader){
  var timer;
  try{
    return await Promise.race([reader.read(),new Promise(function(resolve,reject){
      timer=setTimeout(function(){reject(chatMarkNetworkFailure(new Error('回复连接暂时中断，正在补收')))},45000);
    })]);
  }finally{clearTimeout(timer)}
}
