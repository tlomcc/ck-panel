/* Durable source outbox and nightly results. Never awaited by chat generation. */
var chatNightlySyncs=new Map(),chatNightlyTimer=0,chatNightlyStatus={},chatNightlySynced={};
var chatDigestDeleteSyncs=new Map();
function chatDigestDeletionRecords(){
  try{var rows=JSON.parse(localStorage.getItem('ck_digest_deleted_v1')||'[]');return Array.isArray(rows)?rows.filter(function(r){return r&&typeof r.id==='string'&&typeof r.scope==='string'}):[]}catch(e){return []}
}
function chatDigestIsDeleted(id,cfg){return chatDigestDeletionRecords().some(function(r){return r.id===String(id)&&r.scope===chatNightlyScope(cfg)})}
function chatDigestForgetSession(id,cfg){
  cfg=cfg||chatLoadConfig();var scope=chatNightlyScope(cfg),rows=chatDigestDeletionRecords();
  if(!rows.some(function(r){return r.id===String(id)&&r.scope===scope}))rows.push({id:String(id),scope:scope,at:Date.now(),ack:false});
  try{localStorage.setItem('ck_digest_deleted_v1',JSON.stringify(rows));localStorage.removeItem(chatNightlyOutboxKey({id:id}))}catch(e){toast('删除记录暂未持久保存，请保持页面联网以完成后台清理',5000)}
  delete chatNightlyStatus[id];delete chatNightlySynced[scope+':'+id];
  chatFlushDigestDeletes(cfg);chatScheduleNightlySync(0);
}
function chatFlushDigestDeletes(cfg){
  cfg=cfg||chatLoadConfig();var scope=chatNightlyScope(cfg);
  if(!cfg.panelKey)return Promise.resolve(false);
  if(chatDigestDeleteSyncs.has(scope))return chatDigestDeleteSyncs.get(scope);
  var pending=chatDigestDeletionRecords().filter(function(r){return r.scope===scope&&!r.ack});
  if(!pending.length)return Promise.resolve(true);
  var task=(async function(){
    try{
      for(var row of pending){
        if(chatNightlyScope(chatLoadConfig())!==scope)return false;
        var controller=new AbortController(),timer=setTimeout(function(){controller.abort()},10000);
        try{
          var response=await fetch(chatNightlyEndpoint(cfg),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'delete',session_id:row.id}),signal:controller.signal});
          var data=await response.json();if(!response.ok||!data||data.deleted!==true)throw Error('delete_pending');
          var latest=chatDigestDeletionRecords();latest.forEach(function(r){if(r.id===row.id&&r.scope===scope)r.ack=true});
          localStorage.setItem('ck_digest_deleted_v1',JSON.stringify(latest));
        }finally{clearTimeout(timer)}
      }
      return true;
    }catch(e){chatScheduleNightlySync(30000);return false}
    finally{chatDigestDeleteSyncs.delete(scope);if(chatNightlyScope(chatLoadConfig())===scope&&chatDigestDeletionRecords().some(function(r){return r.scope===scope&&!r.ack}))chatScheduleNightlySync(2000)}
  })();
  chatDigestDeleteSyncs.set(scope,task);return task;
}
function chatDigestHasContent(session){
  return !!((session.messages||[]).some(function(m){return m&&['user','assistant'].includes(m.role)&&(String(m.text||'').trim()||(m.images||[]).length)})||
    (session.dailyDigests||[]).length||(session.digestRollup||{}).text||(session.digestPending||[]).length||session.digestManualTrim||session.digestStaged);
}
function chatNightlyWindow(now){
  now=Number(now)||Date.now();var shifted=new Date(now+8*3600000),day=shifted.toISOString().slice(0,10);
  var start=Date.parse(day+'T00:00:00+08:00'),end=start+24*3600000;
  return {day:day,inWindow:now>=start&&now<end,start:start,end:end,next:now<start?start:start+86400000};
}
function chatNightlyOutboxKey(session){return 'ck_digest_pending_v1_'+session.id;}
function chatNightlyPending(session){
  var values=Array.isArray(session.digestPending)?session.digestPending:[];
  try{var stored=JSON.parse(localStorage.getItem(chatNightlyOutboxKey(session))||'[]');if(Array.isArray(stored))values=values.concat(stored)}catch(e){}
  var groups=new Map();values.forEach(function(g){if(g&&typeof g.key==='string'&&Array.isArray(g.messages))groups.set(g.key,g)});
  return Array.from(groups.values());
}
function chatArchiveDigestSources(session,messages,sourceGroups){
  var merged=new Map(chatNightlyPending(session).map(function(g){return [g.key,g]}));
  (sourceGroups||chatDigestMessageGroups(messages)).forEach(function(g){merged.set(g.key,g)});
  var pending=Array.from(merged.values());
  // This small durable write precedes removing any original chat messages.
  // If local storage is full, keep the original history and continue chatting.
  try{localStorage.setItem(chatNightlyOutboxKey(session),JSON.stringify(pending))}catch(e){return false}
  session.digestPending=pending;chatScheduleNightlySync();return true;
}
function chatNightlyBase(session){
  var cfg=chatLoadConfig(),staged=chatDigestStage(session,cfg);if(staged)return staged.base;
  var preparing=session.digestPreparingBase;
  if(preparing&&preparing.scope===chatNightlyScope(cfg)&&preparing.config===chatDigestConfigStamp(cfg)&&!session.digestManualPending)return preparing.base;
  return {entries:chatDailyDigestNormalize(session.dailyDigests),rollup:chatNormalizeDigestRollup(session.digestRollup),omitted:chatDigestOmittedCoverage(session.digestOmittedCovered)};
}
function chatNightlyConfig(cfg){return Object.assign(chatDigestOptions(cfg),{enabled:cfg.dailyDigestEnabled!==false});}
function chatNightlyBaseStamp(cfg,session){return chatDigestStamp([chatNightlyBase(session),chatNightlyConfig(cfg)]);}
function chatNightlyScope(cfg){return chatDigestStamp([cfg.gatewayUrl,cfg.panelKey]);}
function chatNightlyEndpoint(cfg){return chatDailyDigestEndpoint(cfg).replace(/\/prepare$/,'/queue')+'?policy=cache-safe-v2&key='+encodeURIComponent(cfg.panelKey||'');}
function chatDigestSyncView(session,cfg,remote){
  var scope=chatDigestActiveScope(cfg),record=session.digestLastSync,req=session.digestManualTrim,settings=session.digestSettingsRequest;
  if(record&&record.scope!==scope)record=null;
  if(req&&req.scope!==scope)req=null;
  if(settings&&settings.scope!==scope)settings=null;
  var state=remote||chatNightlyStatus[session.id]||session.digestSchedule||{};
  var stage=chatDigestStage(session,cfg),current=session===chatCurrentSession();
  var ready=current&&typeof chatPlanAutoTrimForPendingBatch==='function'?chatDigestImmediateReady(session,cfg):!!stage;
  var view={rounds:0,status:'尚未截断',tone:'',note:'后台准备总结；准备完成不代表已经截断或同步。',cutNote:'原对话仍保留',ready:ready,prepare:!!req};
  if(record){
    view.rounds=Number(record.rounds)||0;view.at=record.at;
    view.cutNote=view.rounds?'已实际移除的完整对话轮数':'本次只更新总结';
    view.status=record.status==='synced'?'同步完成':'同步未完成';
    view.tone=record.status==='synced'?'success':'attention';
    view.note=record.status==='synced'?'本机与网关已同步。下一条消息使用当前总结。':'本机已保存，网关尚未确认。可重试同步，也会随下一次发送重试。';
    view.retry=record.status!=='synced';view.ready=view.ready||view.retry;
  }else if(session.digestManualCompleted){
    view.rounds=Number(session.digestManualCompleted.rounds)||0;view.status='同步结果未记录';view.tone='attention';
    view.cutNote='上次记录的实际截断轮数';view.note='旧版本没有保存网关确认结果；下次截断会显示明确结果。';
  }
  var preparing=!!(req&&(!record||Number(req.requestedAt)>record.at)||settings&&(!record||Number(settings.at)>record.at));
  if(preparing&&!view.retry){
    view.rounds=0;view.status=ready?'待同步':'正在准备';view.tone=ready?'live':'';view.cutNote='尚未截断';view.at=0;
    var progress=req&&current&&typeof chatPlanAutoTrimForPendingBatch==='function'?chatDigestPreparationProgress(session,cfg):null;
    view.note=settings?'正在按 X='+settings.x+'、Y='+settings.y+' 准备新总结。':'计划截断 '+(progress?progress.rounds:req.dropRounds)+' 轮。';
    if(progress&&progress.sources)view.note+='总结已准备 '+progress.prepared+' / '+progress.sources+' 组。';
    if(progress&&!progress.valid){view.status='正在更新截断范围';view.note+='原内容有变化，正在复用已有总结并补齐变化部分。';}
    else if(req&&req.immediate!==false){
      if(ready)view.status=chatDigestReplyActive(session)?'等待当前回复':'正在完成截断';
      view.note+=ready?(chatDigestReplyActive(session)?'总结已就绪，当前回复结束后自动截断。':'总结已就绪，正在完成截断。'):'整理完成后自动截断，期间可继续聊天。';
    }else view.note+=ready?'已准备好，可立刻同步。':'后台继续整理，准备好后可立刻同步。';
    if(!ready&&(state.status==='retry'||state.local_error)){view.status='准备暂未完成';view.tone='attention';view.note+=(state.local_error||state.last_error||'后台会自动重试。');}
  }else if(!record&&!session.digestManualCompleted){
    if(cfg.dailyDigestEnabled===false){view.status='总结已关闭';view.note='开启总结后会自动准备。';}
    else if(ready){view.status='待同步';view.tone='live';view.note='总结已准备好，尚未截断。等 1h 缓存过期后的下一次发送同步，也可立刻同步。';}
  }
  return view;
}
function chatDigestManualStatus(session,cfg){
  var view=chatDigestSyncView(session,cfg);return '本次截断 '+view.rounds+' 轮 · '+view.status+'。'+view.note;
}
function chatRenderNightlyStatus(session){
  session=session||chatCurrentSession();if(!session||session!==chatCurrentSession())return;
  var cfg=chatLoadConfig(),view=chatDigestSyncView(session,cfg),replyActive=chatDigestReplyActive(session);
  ['chat-digest-cancel-manual','chat-trim-cancel-manual'].forEach(function(id){var node=document.getElementById(id);if(node)node.hidden=!session.digestManualTrim});
  ['chat-digest-sync-now','chat-trim-sync-now'].forEach(function(id){
    var button=document.getElementById(id);if(!button)return;
    button.hidden=false;button.disabled=!!(replyActive||chatTrimBusy||chatTrimTransaction||!view.ready);
    button.textContent=view.retry?'重试同步':'立刻同步';
    button.title=replyActive?'当前回复结束后可同步':view.ready?'应用已准备的总结；下一条消息建立新缓存':'总结准备完成后可同步';
  });
  var prepare=document.getElementById('chat-digest-prepare');if(prepare){prepare.hidden=false;prepare.disabled=!!(chatTrimBusy||chatTrimTransaction);prepare.textContent=session.digestManualTrim?'更新截断范围':'立即截断';}
  var text='本次截断 '+view.rounds+' 轮 · '+view.status+'。'+view.note;
  ['chat-digest-schedule-status','chat-trim-next'].forEach(function(id){var node=document.getElementById(id);if(node)node.textContent=text});
}
function chatScheduleNightlySync(delay){
  if(chatNightlyTimer){if(delay!==0)return;clearTimeout(chatNightlyTimer);chatNightlyTimer=0;}
  chatNightlyTimer=setTimeout(function(){chatNightlyTimer=0;chatMaybeRollDigestAtDayBoundary()},delay===undefined?800:delay);
}
function chatSyncNightlyDigest(cfg,options){
  cfg=cfg||chatLoadConfig();options=options||{};var session=options.session||chatCurrentSession();
  if(!chatSessionsReady||!session||!cfg.panelKey)return Promise.resolve(false);
  if(chatDigestIsDeleted(session.id,cfg)||!chatDigestHasContent(session))return Promise.resolve(false);
  if(chatTrimBusy||chatTrimTransaction){chatScheduleNightlySync(1500);return Promise.resolve(false);}
  chatDigestRefreshManualSources(session,cfg);
  var scope=chatNightlyScope(cfg),configStamp=chatDigestConfigStamp(cfg),baseStamp=chatNightlyBaseStamp(cfg,session),base=chatNightlyBase(session);
  var syncKey=scope+':'+session.id;
  if(chatNightlySyncs.has(syncKey))return chatNightlySyncs.get(syncKey);
  var staged=chatDigestStage(session,cfg);
  var remote=staged|| (session.digestRemote&&session.digestRemote.scope===scope?session.digestRemote:{});
  var rows=session===chatCurrentSession()?chatMessages:session.messages||[];
  var signature=JSON.stringify([baseStamp,session.updated||0,rows.length,rows.length&&rows[rows.length-1].ts,session.title,(session.digestPending||[]).length,session.digestManualPending,session.digestSettingsPending,session.digestManualTrim]);
  var previous=chatNightlySynced[syncKey]||{},now=Date.now(),unchanged=previous.signature===signature;
  if(!options.notify&&(previous.retryAt>now||unchanged&&now-previous.at<(session.digestManualTrim||session.digestSettingsRequest?2000:60000)))return Promise.resolve(true);
  var body=null;
  if(!unchanged){
    var groups=new Map(chatNightlyPending(session).map(function(g){return [g.key,g]}));
    chatDigestCandidateGroups(session,cfg,rows).forEach(function(g){if(!groups.has(g.key))groups.set(g.key,g)});
    body={session_id:String(session.id),title:session.title,revision:remote.revision||0,base_stamp:baseStamp,base:base,config:chatNightlyConfig(cfg),groups:Array.from(groups.values()),candidate_keys:Array.from(groups.values()).filter(function(g){return g.candidate}).map(function(g){return g.key}),manual_request:session.digestManualTrim?String(session.digestManualTrim.requestedAt):'',manual_override:session.digestManualPending===scope,settings_override:session.digestSettingsPending===scope,settings_request:session.digestSettingsRequest&&session.digestSettingsRequest.id||''};
  }
  var controller=new AbortController(),timer=setTimeout(function(){controller.abort()},12000);
  var task=(async function(){
    try{
      var response=await fetch(chatNightlyEndpoint(cfg)+(body?'':'&session_id='+encodeURIComponent(session.id)),body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:controller.signal}:{cache:'no-store',signal:controller.signal});
      var data=await response.json();if(!response.ok||!data||data.ok!==true)throw new Error(data&&data.error||'夜间队列暂时不可用');
      if(data.deleted){chatDigestForgetSession(session.id,cfg);return false;}
      if(!body){if(!data.sessions||!data.sessions.length){delete chatNightlySynced[syncKey];chatScheduleNightlySync(1500);return false}data=Object.assign({ok:true},data.sessions[0]);}
      if(chatNightlyScope(chatLoadConfig())!==scope||chatDailyDigestFindSession(session.id)!==session)return false;
      if(chatDigestConfigStamp(chatLoadConfig())!==configStamp){
        delete chatNightlySynced[syncKey];chatScheduleNightlySync(0);return false;
      }
      chatNightlySynced[syncKey]={signature:signature,at:Date.now()};
      chatNightlyStatus[session.id]=Object.assign({scope:scope},data);
      var accepted=new Set(data.accepted_keys||[]),pending=chatNightlyPending(session).filter(function(g){return !accepted.has(g.key)});
      try{if(pending.length)localStorage.setItem(chatNightlyOutboxKey(session),JSON.stringify(pending));else localStorage.removeItem(chatNightlyOutboxKey(session))}catch(e){}
      session.digestPending=pending;
      var snapshot=data.snapshot,currentStamp=chatNightlyBaseStamp(chatLoadConfig(),session);
      var hasDraft=['detail','rollup','today'].some(function(k){return !!chatDigestEditors[session.id+':'+k]});
      // A stored revision identifies the baseline already acknowledged by this
      // device. Daily pruning/settings must not turn its next result into a
      // manual-edit conflict. Explicit edits carry a durable override instead.
      var matchingConfig=!snapshot||(!snapshot.config?!session.digestSettingsRequest:JSON.stringify(snapshot.config)===JSON.stringify(chatNightlyConfig(cfg)));
      var knownAdvance=matchingConfig&&snapshot&&snapshot.result&&remote.revision>0&&snapshot.revision>remote.revision&&!session.digestManualPending;
      if(matchingConfig&&snapshot&&currentStamp===baseStamp&&((!data.conflict&&snapshot.source_stamp===baseStamp)||knownAdvance||data.settings_accepted===true)&&!hasDraft){
        if(snapshot.result){
          if(!session.digestRemote||snapshot.revision>session.digestRemote.revision||snapshot.trims&&snapshot.trims.length)session.digestStaged=Object.assign({},snapshot,{scope:scope,config:chatDigestConfigStamp(cfg)});
          delete session.digestPreparingBase;
        }
        if(!snapshot.result){session.digestRemote={scope:scope,revision:snapshot.revision};session.digestPreparingBase={scope:scope,config:configStamp,base:snapshot.base};}
        delete session.digestRemoteConflict;
        if(body&&body.manual_override)delete session.digestManualPending;
        if(body&&body.settings_override)delete session.digestSettingsPending;
      }else if(data.conflict&&!knownAdvance){
        chatNightlyStatus[session.id].local_error='本机编辑与服务器版本不同，草稿已保留；重新保存可指定以本机为准';
        session.digestRemoteConflict={scope:scope,revision:snapshot&&snapshot.revision};
      }else if(snapshot&&(snapshot.revision!==remote.revision||currentStamp!==baseStamp)){
        delete chatNightlySynced[syncKey];chatScheduleNightlySync(1500);
      }
      if(body&&body.settings_override&&matchingConfig&&JSON.stringify(chatNightlyConfig(chatLoadConfig()))===JSON.stringify(body.config))delete session.digestSettingsPending;
      session.digestSchedule={scope:scope,status:data.status,pending_groups:data.pending_groups,last_error:data.last_error||'',progress:data.progress,checkpoint_batches:data.checkpoint_batches,stage:data.stage,completed_at:data.completed_at||0,next_retry:data.next_retry||0};
      chatSaveSessions({sessionIds:[session.id]});
      if(session.digestManualTrim||session.digestSettingsRequest)chatScheduleNightlySync(2000);
      chatRenderNightlyStatus(session);
      if(session===chatCurrentSession())chatRenderTrimState(cfg);
      if(session===chatCurrentSession()&&!chatSending){chatRenderDailyDigest(chatLoadConfig());chatRenderNightlyStatus(session);}
      if(options.notify)toast(session.digestManualTrim&&session.digestManualTrim.immediate!==false?'已同步截断进度；总结齐全、当前回复结束后自动截断':'已同步后台任务；准备好后可立刻同步');
      return !data.conflict||!!knownAdvance||data.settings_accepted===true;
    }catch(error){
      if(chatNightlyScope(chatLoadConfig())!==scope||chatDailyDigestFindSession(session.id)!==session)return false;
      chatNightlySynced[syncKey]={retryAt:Date.now()+30000};
      chatNightlyStatus[session.id]={scope:scope,local_error:'同步暂未完成，原文已保留，稍后重试'};
      chatRenderNightlyStatus(session);
      chatScheduleNightlySync(30000);
      if(options.notify)toast(chatDigestSafeError(error,cfg),5000);
      return false;
    }finally{clearTimeout(timer);chatNightlySyncs.delete(syncKey);}
  })();
  chatNightlySyncs.set(syncKey,task);return task;
}
function chatNightlyManualPriority(session){
  delete session.digestPreparingBase;
  delete session.digestStaged;session.digestReadyTrims=[];
  session.digestManualPending=chatNightlyScope(chatLoadConfig());
  var conflict=session.digestRemoteConflict;
  if(conflict&&conflict.scope===chatNightlyScope(chatLoadConfig()))session.digestRemote=conflict;
  delete session.digestRemoteConflict;
}
function chatNightlySettingsPriority(cfg){
  var scope=chatNightlyScope(cfg);
  chatSessions.forEach(function(session){
    session.digestSettingsPending=scope;
    session.digestSettingsRequest=cfg.dailyDigestEnabled===false?null:{id:String(Date.now()),at:Date.now(),scope:scope,config:chatDigestConfigStamp(cfg),x:chatDigestOptions(cfg).x,y:chatDigestOptions(cfg).y};
    delete session.digestStaged;delete chatNightlySynced[scope+':'+session.id];
  });
  chatSaveSessions();chatScheduleNightlySync(0);
}
