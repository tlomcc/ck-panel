/* Preparation never changes a live prompt. Only a send at expiry activates it. */
function chatDigestActiveScope(cfg){return chatNightlyScope(cfg);}
function chatDigestCacheExpired(session,now){
  var rows=session===chatCurrentSession()?chatMessages:session.messages||[],last=0;
  rows.forEach(function(m){if(m.role==='user'||m.role==='assistant')last=Math.max(last,Number(m.ts)||0)});
  var ref=typeof chatCacheActivityReference==='function'?chatCacheActivityReference(session,last):{timestamp:Math.max(session.cacheFullCreatedAt||0,session.cacheLastReadAt||0,last)};
  return !ref.timestamp||(Number(now)||Date.now())-ref.timestamp>=3600000;
}
function chatDigestStage(session,cfg){
  var stage=session.digestStaged;
  return stage&&stage.scope===chatDigestActiveScope(cfg)&&stage.config===chatDigestConfigStamp(cfg)&&!session.digestManualPending?stage:null;
}
function chatDigestCandidateGroups(session,cfg,rows){
  var trim=typeof chatWindowTrimConfigFromSession==='function'&&chatWindowTrimConfigFromSession(session);
  if(!trim&&typeof chatAutoTrimConfigFrom==='function')trim=chatAutoTrimConfigFrom(Object.assign({},cfg,{windowTrimOverride:false}));
  var request=session.digestManualTrim;
  if(request&&request.scope===chatDigestActiveScope(cfg)){
    return chatDigestMessageGroups(rows).filter(function(g){return request.keys.includes(g.key)}).map(function(g){return Object.assign({},g,{candidate:true})});
  }
  if(!trim||(!trim.enabled&&!trim.roundLimitEnabled))return [];
  var plan=CKChatHistory.trimLocalTurns(rows,trim.keep);
  return chatDigestMessageGroups(plan.droppedMessages).map(function(g){return Object.assign({},g,{candidate:true})});
}
function chatDigestFreezePack(cfg,session){
  var scope=chatDigestActiveScope(cfg);
  if(!session.digestActivePack||session.digestActivePack.scope!==scope){
    session.digestActivePack={scope:scope,text:chatDailyDigestBuildPack(cfg,session),at:Date.now()};
  }
  return session.digestActivePack.text;
}
function chatDigestResetPack(cfg,session){
  session.digestActivePack={scope:chatDigestActiveScope(cfg),text:chatDailyDigestBuildPack(cfg,session),at:Date.now()};
}
function chatDigestCanActivate(session,cfg){
  return cfg.dailyDigestEnabled!==false&&!session.digestManualPending&&!['detail','rollup','today'].some(function(k){return !!chatDigestEditors[session.id+':'+k]});
}
function chatDigestActivate(session,cfg,force){
  if(!chatDigestCanActivate(session,cfg)||(!force&&!chatDigestCacheExpired(session)))return false;
  var stage=chatDigestStage(session,cfg);
  if(!stage)return false;
  session.dailyDigests=chatDailyDigestNormalize(stage.base.entries);
  session.digestRollup=chatNormalizeDigestRollup(stage.base.rollup);
  session.digestOmittedCovered=chatDigestOmittedCoverage(stage.base.omitted);
  session.digestCheckedDay=stage.result&&stage.result.day;
  session.digestReadyTrims=stage.trims||[];
  session.digestRemote={scope:stage.scope,revision:stage.revision};
  delete session.digestStaged;session.digestWork=null;
  chatDigestResetPack(cfg,session);
  return true;
}
function chatDigestPreparedTrim(session,cfg,plan){
  var groups=chatDigestMessageGroups(plan.droppedMessages||[]),keys=new Set(groups.map(function(g){return g.key}));
  // With only transport history available we cannot safely prove coverage.
  if(!groups.length||plan.canonicalTransport&&plan.transportDropped>groups.length)return null;
  var covered=new Set();chatDailyDigestNormalize(session.dailyDigests).forEach(function(e){(e.covered||[]).forEach(function(k){covered.add(k)})});
  chatDigestOmittedCoverage(session.digestOmittedCovered).forEach(function(r){covered.add(r.key)});
  var used=(session.digestReadyTrims||[]).filter(function(t){return t.keys.some(function(k){return keys.has(k)&&!covered.has(k)})&&t.keys.every(function(k){return keys.has(k)||covered.has(k)})});
  used.forEach(function(t){t.keys.forEach(function(k){covered.add(k)})});
  if(groups.some(function(g){return !covered.has(g.key)}))return null;
  var entries=chatDailyDigestNormalize(session.dailyDigests),today=chatDailyDigestDayKey(Date.now());
  var entry=entries.find(function(e){return e.dayKey===today});
  if(!entry){entry={id:'dg-'+today,dayKey:today,kind:'daily',text:'',covered:[],rounds:0,startTs:0,endTs:0};entries.push(entry)}
  used.forEach(function(t){
    if(t.keys.every(function(k){return entry.covered.includes(k)}))return;
    var source='【原对话 '+chatDailyDigestRangeLabel(t)+'；归档 '+today+'】';
    entry.text+=(entry.text?'\n\n':'')+source+'\n'+t.text;
    entry.startTs=entry.startTs?Math.min(entry.startTs,t.startTs):t.startTs;entry.endTs=Math.max(entry.endTs,t.endTs);
    entry.covered=Array.from(new Set(entry.covered.concat(t.keys)));entry.rounds+=t.keys.length;entry.detail=null;entry.brief=null;
  });
  return {entries:entries.filter(function(e){return e.text}),rollup:session.digestRollup,used:used};
}
function chatDigestPreparedSession(session,cfg){
  var stage=chatDigestStage(session,cfg);
  return stage?Object.assign({},session,{dailyDigests:stage.base.entries,digestRollup:stage.base.rollup,digestOmittedCovered:stage.base.omitted,digestReadyTrims:stage.trims||[]}):session;
}
// A growing conversation must not invalidate a completed, fully covered prefix.
// Re-plan both histories with the same retained-round count and prove coverage
// again before committing. Never split a summary batch or drop unknown history.
function chatDigestAutoPreparedPlan(session,cfg,plan,pending){
  if(!plan.trimmed||cfg.dailyDigestEnabled===false)return plan;
  if(!chatDigestCanActivate(session,cfg))return null;
  var virtual=chatDigestPreparedSession(session,cfg);
  var prepared=chatDigestPreparedTrim(virtual,cfg,plan);
  if(prepared)return Object.assign({},plan,{digestPrepared:prepared});
  var groups=chatDigestMessageGroups(plan.droppedMessages||[]),covered=new Set();
  chatDailyDigestNormalize(virtual.dailyDigests).forEach(function(e){(e.covered||[]).forEach(function(k){covered.add(k)})});
  chatDigestOmittedCoverage(virtual.digestOmittedCovered).forEach(function(r){covered.add(r.key)});
  (virtual.digestReadyTrims||[]).forEach(function(t){t.keys.forEach(function(k){covered.add(k)})});
  var prefix=0;while(prefix<groups.length&&covered.has(groups[prefix].key))prefix++;
  for(var drop=prefix;drop>0;drop--){
    var smaller=Object.assign({},cfg,{windowTrimOverride:true,windowTrimConfig:Object.assign({},chatAutoTrimConfigFrom(cfg),{keep:Math.max(plan.keep,plan.before-drop)})});
    var candidate=chatPlanAutoTrimForPendingBatch(smaller,pending||[],{force:true,trigger:plan.trigger});
    if(!candidate.trimmed)continue;
    prepared=chatDigestPreparedTrim(virtual,cfg,candidate);
    if(prepared)return Object.assign({},candidate,{manual:plan.manual,digestPrepared:prepared,targetDrop:plan.dropped});
  }
  return null;
}
function chatDigestRecordTrimDecision(session,plan,reason){
  session.digestTrimDecision={at:Date.now(),reason:reason,before:plan.before,target:plan.dropped||0,cacheAgeMs:plan.cacheAgeMs||0,localRounds:plan.localBefore||0,transportRounds:plan.transportBefore||0};
  chatDigestLog('trim_result',Object.assign({ok:false,skipped:true,session_id:session.id,trigger:plan.trigger},session.digestTrimDecision));
  chatSaveSessions();chatRenderNightlyStatus(session);
}
async function chatDigestSyncNow(){
  var session=chatCurrentSession(),cfg=chatLoadConfig();
  if(chatSending||chatTrimBusy||chatTrimTransaction){toast('请等当前回复结束后同步');return false;}
  if(!chatDigestStage(session,cfg)&&!(session.digestReadyTrims||[]).length){toast('总结尚未准备好，后台会继续处理');return false;}
  var accepted=await ckConfirmDialog('立即同步会替换当前上下文，打断现有缓存；下一条消息将重新建立缓存。也可以继续等待，系统会在 1 小时缓存过期后自动同步。',{title:'同步后缓存会中断',confirmText:'立即同步',cancelText:'等缓存过期'});
  if(!accepted||session!==chatCurrentSession()||chatSending||chatTrimBusy||chatTrimTransaction)return false;
  chatDigestFreezePack(cfg,session);
  chatDigestActivate(session,cfg,true);
  var result=await chatApplyAutoTrimForPendingBatch(cfg,[],null,{force:true,trigger:'manual_digest_sync'});
  session.cacheRebuildPending=true;chatDigestResetPack(cfg,session);
  chatSaveSessions();chatRenderDailyDigest(cfg);chatRenderMessages();chatScheduleNightlySync();
  toast('已同步准备好的总结，下一条消息建立新缓存');return true;
}
function chatDigestCancelManualTrim(){
  var session=chatCurrentSession();delete session.digestManualTrim;
  chatSaveSessions();chatRenderNightlyStatus(session);chatScheduleNightlySync();
  chatRenderTrimState(chatLoadConfig());
  toast('已取消待执行截断，原对话保留');
}
function chatDigestManualPlan(session,cfg,request,pending){
  var zero=Object.assign({},cfg,{windowTrimOverride:true,windowTrimConfig:Object.assign({},chatAutoTrimConfigFrom(cfg),{keep:0})});
  var total=chatPlanAutoTrimForPendingBatch(zero,pending||[],{force:true,trigger:'manual_trim'}).before;
  var manualCfg=Object.assign({},zero,{windowTrimConfig:Object.assign({},zero.windowTrimConfig,{keep:Math.max(request.keep,total-request.dropRounds)})});
  var plan=chatPlanAutoTrimForPendingBatch(manualCfg,pending||[],{force:true,trigger:'manual_trim'});
  var groups=chatDigestMessageGroups(plan.droppedMessages||[]);
  plan.manualValid=plan.trimmed&&groups.length===request.keys.length&&groups.every(function(g,i){return g.key===request.keys[i]});
  return plan;
}
function chatDigestManualPrepared(session,cfg,plan){
  var stage=chatDigestStage(session,cfg);
  var virtual=stage?Object.assign({},session,{dailyDigests:stage.base.entries,digestRollup:stage.base.rollup,digestOmittedCovered:stage.base.omitted,digestReadyTrims:stage.trims||[]}):session;
  return cfg.dailyDigestEnabled===false?{}:chatDigestCanActivate(session,cfg)&&chatDigestPreparedTrim(virtual,cfg,plan);
}
async function chatRequestManualDigestTrim(){
  chatInit();
  var cfg=chatSaveConfig(true),session=chatCurrentSession();
  if(session.digestManualTrim&&session.digestManualTrim.scope===chatDigestActiveScope(cfg)){
    chatRenderNightlyStatus(session);toast('本次截断已在后台准备，完成后在下一轮发送时同步；无需重复点击');return true;
  }
  var plan=chatPlanAutoTrimForPendingBatch(cfg,[],{force:true,trigger:'manual_trim'});
  if(!plan.trimmed){toast('当前轮数未超过保留数量，无需截断');return false;}
  var groups=chatDigestMessageGroups(plan.droppedMessages||[]);
  if(!groups.length||plan.canonicalTransport&&plan.transportDropped>groups.length){toast('本机旧对话尚不完整，请先同步历史后再准备截断');return false;}
  chatDigestFreezePack(cfg,session);
  session.digestManualTrim={scope:chatDigestActiveScope(cfg),keys:groups.map(function(g){return g.key}),keep:plan.keep,dropRounds:plan.dropped,requestedAt:Date.now()};
  chatSaveSessions();chatRenderNightlyStatus(session);chatRenderTrimState(cfg);
  delete chatNightlySynced[chatNightlyScope(cfg)+':'+session.id];
  chatSyncNightlyDigest(cfg,{session:session}).catch(function(){});
  chatScheduleNightlySync(2000);
  toast('已开始后台准备 '+plan.dropped+' 轮；准备好后随下一轮消息同步，期间照常聊天');
  return true;
}
// Background observers only report readiness. Activation belongs to the send transaction.
function chatDigestFinishManualTrim(cfg,session){
  chatRenderNightlyStatus(session);return false;
}
