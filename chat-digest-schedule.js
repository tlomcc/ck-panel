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
function chatArchiveDigestSources(session,messages){
  var merged=new Map(chatNightlyPending(session).map(function(g){return [g.key,g]}));
  chatDigestMessageGroups(messages).forEach(function(g){merged.set(g.key,g)});
  var pending=Array.from(merged.values());
  // This small durable write precedes removing any original chat messages.
  // If local storage is full, keep the original history and continue chatting.
  try{localStorage.setItem(chatNightlyOutboxKey(session),JSON.stringify(pending))}catch(e){return false}
  session.digestPending=pending;chatScheduleNightlySync();return true;
}
function chatNightlyBase(session){var staged=chatDigestStage(session,chatLoadConfig());if(staged)return staged.base;return {entries:chatDailyDigestNormalize(session.dailyDigests),rollup:chatNormalizeDigestRollup(session.digestRollup),omitted:chatDigestOmittedCoverage(session.digestOmittedCovered)};}
function chatNightlyConfig(cfg){return Object.assign(chatDigestOptions(cfg),{enabled:cfg.dailyDigestEnabled!==false});}
function chatNightlyBaseStamp(cfg,session){return chatDigestStamp([chatNightlyBase(session),chatNightlyConfig(cfg)]);}
function chatNightlyScope(cfg){return chatDigestStamp([cfg.gatewayUrl,cfg.panelKey]);}
function chatNightlyEndpoint(cfg){return chatDailyDigestEndpoint(cfg).replace(/\/prepare$/,'/queue')+'?policy=cache-safe-v2&key='+encodeURIComponent(cfg.panelKey||'');}
function chatDigestManualStatus(session,cfg){
  var req=session.digestManualTrim,state=chatNightlyStatus[session.id]||session.digestSchedule||{};
  if(state.scope!==chatNightlyScope(cfg))state={};
  var plan=chatDigestManualPlan(session,cfg,req,[]),ready=plan.manualValid&&chatDigestManualPrepared(session,cfg,plan);
  var prefix='本次截断 '+req.dropRounds+' 轮 · 保留点击时最近 '+req.keep+' 轮及之后的新对话。';
  if(!plan.manualValid)return prefix+' 待截断原文已变化，暂不执行；可取消后重新准备。';
  if(ready)return prefix+' 总结已就绪 · 下一轮发送时一次性截断并同步总结，仅这次切换重建缓存。';
  var names={running:'正在生成总结',retry:'准备失败，后台自动重试',queued:'已提交后台，等待处理',paused:'总结已暂停',succeeded:'正在核对本次总结覆盖范围'};
  var batches=Number(state.checkpoint_batches)||Number(state.progress&&state.progress.completed_batches)||0;
  return prefix+' '+(state.local_error||names[state.status]||'正在提交后台')+(batches?' · 已完成 '+batches+' 批':'')+(state.last_error?' · '+state.last_error:'')+'。继续聊天不等待，原上下文与缓存保持。';
}
function chatRenderNightlyStatus(session){
  session=session||chatCurrentSession();if(!session||session!==chatCurrentSession())return;
  var cfg=chatLoadConfig(),scope=chatNightlyScope(cfg),state=chatNightlyStatus[session.id]||session.digestSchedule||{};
  if(state.scope!==scope)state={};
  var names={queued:'等待后台整理',waiting_window:'等待后台重试',running:'后台正在整理',retry:'失败后等待重试',succeeded:'后台准备已完成',empty:'暂无待更新内容',paused:'已暂停'};
  var node=document.getElementById('chat-digest-schedule-status');
  var ready=chatDigestStage(session,cfg)||(session.digestReadyTrims||[]).length;
  ['chat-digest-cancel-manual','chat-trim-cancel-manual'].forEach(function(id){var cancel=document.getElementById(id);if(cancel)cancel.hidden=!session.digestManualTrim});
  var button=document.getElementById('chat-digest-sync-now');if(button){button.hidden=!ready||!!session.digestManualTrim;button.disabled=chatTrimBusy;}
  var text=session.digestManualTrim?chatDigestManualStatus(session,cfg):(state.local_error||names[state.status]||'后台自动准备总结')+(state.pending_groups?' · 待整理 '+state.pending_groups+' 轮':'')+(state.last_error?' · '+state.last_error:'');
  if(!session.digestManualTrim&&typeof chatPlanAutoTrimForPendingBatch==='function'){
    var plan=chatPlanAutoTrimForPendingBatch(cfg,chatPendingMessages(),{force:true,trigger:'preview'});
    var prepared=chatDigestAutoPreparedPlan(session,cfg,plan,chatPendingMessages());
    text+=' · 目标截断 '+plan.dropped+' 轮，已就绪 '+(prepared&&prepared.trimmed?prepared.dropped:0)+' 轮';
    if(prepared&&prepared.trimmed)text+=' · 缓存过期后的新一轮发送时同步';
    else if(plan.dropped)text+=' · 原上下文保留，后台继续准备';
  }
  var decision=session.digestTrimDecision,reasons={manual_scope_mismatch:'本次请求与后台任务的连接设置不一致',manual_source_changed:'待截断原文与预约范围不一致',history_coverage_mismatch:'本机原文与实际发送历史的轮数不一致，尚不能确认总结覆盖',summary_not_ready:'本次待截断范围尚未有完整总结'};
  if(decision)text+='。上次发送未截断：'+(reasons[decision.reason]||decision.reason)+'（本机 '+decision.localRounds+' 轮／发送历史 '+decision.transportRounds+' 轮）。';
  if(!session.digestManualTrim&&session.digestManualCompleted)text='上次手动截断 '+session.digestManualCompleted.rounds+' 轮已随发送同步。'+text;
  if(node)node.textContent=text;
  var next=document.getElementById('chat-trim-next');if(next)next.textContent=text;
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
  var scope=chatNightlyScope(cfg),baseStamp=chatNightlyBaseStamp(cfg,session),base=chatNightlyBase(session);
  var syncKey=scope+':'+session.id;
  if(chatNightlySyncs.has(syncKey))return chatNightlySyncs.get(syncKey);
  var staged=chatDigestStage(session,cfg);
  var remote=staged|| (session.digestRemote&&session.digestRemote.scope===scope?session.digestRemote:{});
  var rows=session===chatCurrentSession()?chatMessages:session.messages||[];
  var signature=JSON.stringify([baseStamp,session.updated||0,rows.length,rows.length&&rows[rows.length-1].ts,session.title,(session.digestPending||[]).length,session.digestManualPending,session.digestSettingsPending,session.digestManualTrim]);
  var previous=chatNightlySynced[syncKey]||{},now=Date.now(),unchanged=previous.signature===signature;
  if(!options.notify&&(previous.retryAt>now||unchanged&&now-previous.at<(session.digestManualTrim?2000:60000)))return Promise.resolve(true);
  var body=null;
  if(!unchanged){
    var groups=new Map(chatNightlyPending(session).map(function(g){return [g.key,g]}));
    chatDigestCandidateGroups(session,cfg,rows).forEach(function(g){if(!groups.has(g.key))groups.set(g.key,g)});
    body={session_id:String(session.id),title:session.title,revision:remote.revision||0,base_stamp:baseStamp,base:base,config:chatNightlyConfig(cfg),groups:Array.from(groups.values()),candidate_keys:Array.from(groups.values()).filter(function(g){return g.candidate}).map(function(g){return g.key}),manual_request:session.digestManualTrim?String(session.digestManualTrim.requestedAt):'',manual_override:session.digestManualPending===scope,settings_override:session.digestSettingsPending===scope};
  }
  var controller=new AbortController(),timer=setTimeout(function(){controller.abort()},12000);
  var task=(async function(){
    try{
      var response=await fetch(chatNightlyEndpoint(cfg)+(body?'':'&session_id='+encodeURIComponent(session.id)),body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:controller.signal}:{cache:'no-store',signal:controller.signal});
      var data=await response.json();if(!response.ok||!data||data.ok!==true)throw new Error(data&&data.error||'夜间队列暂时不可用');
      if(data.deleted){chatDigestForgetSession(session.id,cfg);return false;}
      if(!body){if(!data.sessions||!data.sessions.length){delete chatNightlySynced[syncKey];chatScheduleNightlySync(1500);return false}data=Object.assign({ok:true},data.sessions[0]);}
      if(chatNightlyScope(chatLoadConfig())!==scope||chatDailyDigestFindSession(session.id)!==session)return false;
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
      var knownAdvance=snapshot&&snapshot.result&&remote.revision>0&&snapshot.revision>remote.revision&&!session.digestManualPending;
      if(snapshot&&currentStamp===baseStamp&&((!data.conflict&&snapshot.source_stamp===baseStamp)||knownAdvance)&&!hasDraft){
        if(snapshot.result){
          if(!session.digestRemote||snapshot.revision>session.digestRemote.revision||snapshot.trims&&snapshot.trims.length)session.digestStaged=Object.assign({},snapshot,{scope:scope,config:chatDigestConfigStamp(cfg)});
        }
        if(!snapshot.result)session.digestRemote={scope:scope,revision:snapshot.revision};
        delete session.digestRemoteConflict;
        if(body&&body.manual_override)delete session.digestManualPending;
        if(body&&body.settings_override)delete session.digestSettingsPending;
      }else if(data.conflict&&!knownAdvance){
        chatNightlyStatus[session.id].local_error='本机编辑与服务器版本不同，草稿已保留；重新保存可指定以本机为准';
        session.digestRemoteConflict={scope:scope,revision:snapshot&&snapshot.revision};
      }else if(snapshot&&(snapshot.revision!==remote.revision||currentStamp!==baseStamp)){
        delete chatNightlySynced[syncKey];chatScheduleNightlySync(1500);
      }
      if(body&&body.settings_override&&JSON.stringify(chatNightlyConfig(chatLoadConfig()))===JSON.stringify(body.config))delete session.digestSettingsPending;
      session.digestSchedule={scope:scope,status:data.status,pending_groups:data.pending_groups,last_error:data.last_error||'',progress:data.progress,checkpoint_batches:data.checkpoint_batches,stage:data.stage,completed_at:data.completed_at||0,next_retry:data.next_retry||0};
      chatSaveSessions({sessionIds:[session.id]});
      if(session.digestManualTrim)chatScheduleNightlySync(2000);
      chatRenderNightlyStatus(session);
      if(session===chatCurrentSession())chatRenderTrimState(cfg);
      if(session===chatCurrentSession()&&!chatSending){chatRenderDailyDigest(chatLoadConfig());chatRenderNightlyStatus(session);}
      if(options.notify)toast('已同步后台任务；准备完成后仍会等待缓存边界');
      return !data.conflict||!!knownAdvance;
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
  delete session.digestStaged;session.digestReadyTrims=[];
  session.digestManualPending=chatNightlyScope(chatLoadConfig());
  var conflict=session.digestRemoteConflict;
  if(conflict&&conflict.scope===chatNightlyScope(chatLoadConfig()))session.digestRemote=conflict;
  delete session.digestRemoteConflict;
}
function chatNightlySettingsPriority(cfg){
  var scope=chatNightlyScope(cfg);
  chatSessions.forEach(function(session){session.digestSettingsPending=scope;delete chatNightlySynced[scope+':'+session.id]});
  chatSaveSessions();chatScheduleNightlySync();
}
