/* Authenticated, source-checked maintenance receipts. No chat text is shipped here. */
var chatWindowCleanupBusy=false;
function chatWindowCleanupText(text){return String(text||'').replace(/\s+/g,'');}
async function chatWindowCleanupHash(role,text){
  var bytes=new TextEncoder().encode(role+'\n'+chatWindowCleanupText(text));
  var hash=await crypto.subtle.digest('SHA-256',bytes);
  return Array.from(new Uint8Array(hash)).map(function(n){return n.toString(16).padStart(2,'0')}).join('');
}
async function chatWindowCleanupCovered(rows,hashes,cutoff){
  var known=new Set(hashes||[]);
  for(var row of rows){
    if(row.inFlight||row.role==='pending_user'||Number(row.ts)>cutoff)return false;
    if(!['user','assistant'].includes(row.role))continue;
    if(!chatWindowCleanupText(row.text))continue;
    if(!known.has(await chatWindowCleanupHash(row.role,row.text)))return false;
  }
  return true;
}
async function chatApplyWindowCleanup(session,cfg,snapshot){
  var pending=session.digestManualCompleted;
  if(pending&&pending.cleanupState==='pending'&&pending.scope!==chatNightlyScope(cfg))return false;
  if(pending&&pending.cleanupState==='pending'&&pending.snapshot)snapshot=pending.snapshot;
  var action=snapshot&&snapshot.result&&snapshot.result.window_cleanup;
  if(!action)return false;
  if(action.target!==session.id||action.source===session.id||action.keep!==40||!action.id||!snapshot.base)return false;
  var receipt=session.digestManualCompleted;
  if(receipt&&receipt.cleanupId===action.id&&receipt.cleanupState==='done')return true;
  if(chatWindowCleanupBusy||chatSending||chatTrimBusy||chatTrimTransaction||!chatSessionsReady)return true;
  if(typeof chatDigestEditors!=='undefined'&&Object.keys(chatDigestEditors).some(function(k){return (k.startsWith(session.id+':')||k.startsWith(action.source+':'))&&chatDigestEditors[k]}))return true;
  chatWindowCleanupBusy=true;
  var before=null,persisted=false,ownsTrim=false;
  try{
    var source=chatDailyDigestFindSession(action.source),rows=session===chatCurrentSession()?chatMessages:session.messages||[];
    var sourceRows=source?(source===chatCurrentSession()?chatMessages:source.messages||[]):[];
    var original=JSON.stringify([rows,sourceRows]);
    if(rows.some(function(m){return m.inFlight||m.role==='pending_user'})||sourceRows.some(function(m){return m.inFlight||m.role==='pending_user'}))return true;
    var historical=rows.filter(function(m){return Number(m.ts||0)<=action.cutoff;});
    var kept=historical.slice(-action.keep),removed=historical.slice(0,-action.keep);
    if(!await chatWindowCleanupCovered(removed,action.target_hashes,action.cutoff)||
       !await chatWindowCleanupCovered(sourceRows,action.source_hashes,action.cutoff)){
      chatSetStatus('合并总结已准备好；本机有尚未核对的原文，暂未删除。');return true;
    }
    if(chatSending||original!==JSON.stringify([session===chatCurrentSession()?chatMessages:session.messages||[],source?(source===chatCurrentSession()?chatMessages:source.messages||[]):[]]))return true;
    before=JSON.parse(JSON.stringify(session));chatTrimBusy=true;ownsTrim=true;
    var keepSet=new Set(kept);
    session.messages=rows.filter(function(m){return Number(m.ts||0)>action.cutoff||keepSet.has(m)});
    session.transportMessages=[];session.transportUpdated=Date.now();session.cacheRebuildPending=true;
    session.dailyDigests=chatDailyDigestNormalize(snapshot.base.entries);
    session.digestRollup=chatNormalizeDigestRollup(snapshot.base.rollup);
    session.digestOmittedCovered=chatDigestOmittedCoverage(snapshot.base.omitted);
    session.digestRemote={scope:chatNightlyScope(cfg),revision:snapshot.revision};
    ['digestStaged','digestPreparingBase','digestManualTrim','digestSettingsRequest','digestRemoteConflict','digestManualPending','digestSettingsPending','digestActivePack'].forEach(function(k){session[k]=null});
    session.digestWork=null;session.digestPending=[];session.digestReadyTrims=[];
    session.digestCheckedDay=snapshot.result.day;session.digestRetryAfter=0;
    session.updated=Date.now();
    session.digestManualCompleted={cleanupId:action.id,cleanupState:'pending',scope:chatNightlyScope(cfg),snapshot:snapshot,at:Date.now(),rounds:0,messagesRemoved:removed.length};
    var sync={trimmed:true,sessionId:session.id,trigger:'window_merge',dropped:0};
    chatDigestRecordSync(session,cfg,sync);
    if(session===chatCurrentSession())chatMessages=session.messages;
    localStorage.removeItem(chatNightlyOutboxKey(session));
    chatSaveSessions({sessionIds:[session.id]});
    await chatSaveSessionsToIndexedDb.pending;
    if(chatIndexedDbFailed)throw Error('合并保存未完成，原窗口仍保留');
    persisted=true;
    if(source){
      if(typeof chatWakeForget==='function'&&!await chatWakeForget(source.id))throw Error('临时窗口后台清理尚未完成');
      chatDigestForgetSession(source.id,cfg);chatDeletedSessionIds[source.id]=true;
      chatSessions=chatSessions.filter(function(s){return s.id!==source.id});
    }
    if(chatActiveSessionId===action.source){chatActiveSessionId=session.id;cfg.sessionId=session.id;chatSaveConfigObject(cfg);chatMessages=session.messages;}
    chatSaveSessions();await chatSaveSessionsToIndexedDb.pending;
    chatDigestResetPack(cfg,session);
    if(!await chatSyncTrimmedHistoryToGateway(cfg,sync))throw Error('网关同步尚未确认');
    session.digestManualCompleted.cleanupState='done';delete session.digestManualCompleted.snapshot;
    chatSaveSessions({sessionIds:[session.id]});await chatSaveSessionsToIndexedDb.pending;
    delete chatNightlySynced[chatNightlyScope(cfg)+':'+session.id];
    chatRenderSessions();chatRenderMessages();chatRenderDailyDigest(cfg);
    chatSetStatus('窗口已合并，较早消息已总结；保留最近40条原文。');
    chatScheduleNightlySync(0);
    return true;
  }catch(error){
    if(before&&!persisted){Object.keys(session).forEach(function(k){delete session[k]});Object.assign(session,before);if(session===chatCurrentSession())chatMessages=session.messages;chatSaveSessions({sessionIds:[session.id]});}
    throw error;
  }finally{chatWindowCleanupBusy=false;if(ownsTrim)chatTrimBusy=false;}
}
