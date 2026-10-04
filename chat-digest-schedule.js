/* Durable source outbox and nightly results. Never awaited by chat generation. */
var chatNightlySyncs=new Map(),chatNightlyTimer=0,chatNightlyStatus={},chatNightlySynced={};
function chatNightlyWindow(now){
  now=Number(now)||Date.now();var shifted=new Date(now+8*3600000),day=shifted.toISOString().slice(0,10);
  var start=Date.parse(day+'T04:00:00+08:00'),end=start+3*3600000;
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
function chatNightlyBase(session){return {entries:chatDailyDigestNormalize(session.dailyDigests),rollup:chatNormalizeDigestRollup(session.digestRollup),omitted:chatDigestOmittedCoverage(session.digestOmittedCovered)};}
function chatNightlyConfig(cfg){return Object.assign(chatDigestOptions(cfg),{enabled:cfg.dailyDigestEnabled!==false});}
function chatNightlyBaseStamp(cfg,session){return chatDigestStamp([chatNightlyBase(session),chatNightlyConfig(cfg)]);}
function chatNightlyScope(cfg){return chatDigestStamp([cfg.gatewayUrl,cfg.panelKey]);}
function chatNightlyEndpoint(cfg){return chatDailyDigestEndpoint(cfg).replace(/\/prepare$/,'/queue')+'?key='+encodeURIComponent(cfg.panelKey||'');}
function chatRenderNightlyStatus(session){
  session=session||chatCurrentSession();if(!session)return;
  var scope=chatNightlyScope(chatLoadConfig()),state=chatNightlyStatus[session.id]||session.digestSchedule||{};
  if(state.scope!==scope)state={};
  var names={queued:'等待夜间更新',waiting_window:'等待下一次04:00',running:'后台正在整理',retry:'失败后等待重试',succeeded:'最近更新已完成',empty:'暂无待更新内容',paused:'已暂停'};
  var node=document.getElementById('chat-digest-schedule-status');
  if(node)node.textContent=(state.local_error||names[state.status]||'资料会自动同步到夜间队列')+' · 上海时间04:00–07:00'+(state.pending_groups?' · 待整理 '+state.pending_groups+' 轮':'')+(state.last_error?' · '+state.last_error:'');
}
function chatScheduleNightlySync(delay){
  if(chatNightlyTimer)return;
  chatNightlyTimer=setTimeout(function(){chatNightlyTimer=0;chatMaybeRollDigestAtDayBoundary()},delay===undefined?800:delay);
}
function chatSyncNightlyDigest(cfg,options){
  cfg=cfg||chatLoadConfig();options=options||{};var session=options.session||chatCurrentSession();
  if(!chatSessionsReady||!session||!cfg.panelKey)return Promise.resolve(false);
  if(chatSending||chatTrimBusy||chatTrimTransaction){chatScheduleNightlySync(1500);return Promise.resolve(false);}
  var scope=chatNightlyScope(cfg),baseStamp=chatNightlyBaseStamp(cfg,session),base=chatNightlyBase(session);
  var syncKey=scope+':'+session.id;
  if(chatNightlySyncs.has(syncKey))return chatNightlySyncs.get(syncKey);
  var remote=session.digestRemote&&session.digestRemote.scope===scope?session.digestRemote:{};
  var rows=session===chatCurrentSession()?chatMessages:session.messages||[];
  var signature=JSON.stringify([baseStamp,session.updated||0,rows.length,rows.length&&rows[rows.length-1].ts,session.title,(session.digestPending||[]).length,session.digestManualPending,session.digestSettingsPending]);
  var previous=chatNightlySynced[syncKey]||{},now=Date.now(),unchanged=previous.signature===signature;
  if(!options.notify&&(previous.retryAt>now||unchanged&&now-previous.at<(chatNightlyWindow().inWindow?60000:300000)))return Promise.resolve(true);
  var body=null;
  if(!unchanged){
    var groups=new Map(chatNightlyPending(session).map(function(g){return [g.key,g]}));
    chatDigestMessageGroups(rows).forEach(function(g){groups.set(g.key,g)});
    body={session_id:String(session.id),title:session.title,revision:remote.revision||0,base_stamp:baseStamp,base:base,config:chatNightlyConfig(cfg),groups:Array.from(groups.values()),manual_override:session.digestManualPending===scope,settings_override:session.digestSettingsPending===scope};
  }
  var controller=new AbortController(),timer=setTimeout(function(){controller.abort()},12000);
  var task=(async function(){
    try{
      var response=await fetch(chatNightlyEndpoint(cfg)+(body?'':'&session_id='+encodeURIComponent(session.id)),body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:controller.signal}:{cache:'no-store',signal:controller.signal});
      var data=await response.json();if(!response.ok||!data||data.ok!==true)throw new Error(data&&data.error||'夜间队列暂时不可用');
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
      if(snapshot&&currentStamp===baseStamp&&((!data.conflict&&snapshot.source_stamp===baseStamp)||knownAdvance)&&!chatSending&&!hasDraft){
        if(snapshot.result){
          session.dailyDigests=chatDailyDigestNormalize(snapshot.base.entries);session.digestRollup=chatNormalizeDigestRollup(snapshot.base.rollup);
          session.digestOmittedCovered=chatDigestOmittedCoverage(snapshot.base.omitted);session.digestCheckedDay=snapshot.result.day;session.digestWork=null;
        }
        session.digestRemote={scope:scope,revision:snapshot.revision};
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
      session.digestSchedule={scope:scope,status:data.status,pending_groups:data.pending_groups,last_error:data.last_error||'',completed_at:data.completed_at||0,next_retry:data.next_retry||0};
      chatSaveSessions({sessionIds:[session.id]});
      if(session===chatCurrentSession()&&!chatSending){chatRenderDailyDigest(chatLoadConfig());chatRenderNightlyStatus(session);}
      if(options.notify)toast('已同步夜间任务：04:00开始，07:00停止重试');
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
