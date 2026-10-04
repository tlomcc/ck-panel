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
  toast('已取消待执行截断，原对话保留');
}
function chatDigestManualConfig(session,cfg,request){
  var count=typeof chatConversationRoundCount==='function'?chatConversationRoundCount(chatMessages,session.transportMessages||[]):CKChatHistory.localTurnGroups(chatMessages).length;
  var keep=Math.max(request.keep,count-request.dropRounds);
  return Object.assign({},cfg,{windowTrimOverride:true,windowTrimConfig:Object.assign({},chatAutoTrimConfigFrom(cfg),{keep:keep})});
}
async function chatRequestManualDigestTrim(){
  chatInit();
  if(chatSending||chatTrimBusy||chatTrimTransaction){toast('当前正在回复或处理截断，请结束后再操作');return false;}
  var cfg=chatSaveConfig(true),session=chatCurrentSession(),plan=chatPlanAutoTrimForPendingBatch(cfg,[],{force:true,trigger:'manual_trim'});
  if(!plan.trimmed){toast('当前轮数未超过保留数量，无需截断');return false;}
  var groups=chatDigestMessageGroups(plan.droppedMessages||[]),stage=chatDigestStage(session,cfg);
  var virtual=stage?Object.assign({},session,{dailyDigests:stage.base.entries,digestRollup:stage.base.rollup,digestReadyTrims:stage.trims||[]}):session;
  var ready=cfg.dailyDigestEnabled===false||!!chatDigestPreparedTrim(virtual,cfg,plan);
  var answer=await ckConfirmDialog(ready?'总结已准备好。现在截断会替换上下文并打断现有缓存，下一条消息重新建立缓存。':'总结还未准备好。确认后会在后台准备并自动重试；准备好且当前回复结束后立即截断，这会打断现有缓存。期间可以继续聊天，也可以取消。',
    {title:ready?'立即截断会中断缓存':'后台准备后立即截断',confirmText:ready?'确认截断':'后台准备并截断',cancelText:'暂不截断'});
  if(!answer||session!==chatCurrentSession()||chatSending||chatTrimBusy||chatDigestActiveScope(cfg)!==chatDigestActiveScope(chatLoadConfig()))return false;
  session.digestManualTrim={scope:chatDigestActiveScope(cfg),keys:groups.map(function(g){return g.key}),keep:plan.keep,dropRounds:plan.dropped,requestedAt:Date.now()};
  chatSaveSessions();chatRenderNightlyStatus(session);
  if(!await chatDigestFinishManualTrim(cfg,session)){delete chatNightlySynced[chatNightlyScope(cfg)+':'+session.id];chatScheduleNightlySync(0);toast('正在后台准备，可继续聊天或取消待执行截断');}
  return true;
}
async function chatDigestFinishManualTrim(cfg,session){
  var request=session.digestManualTrim;
  if(!request||request.scope!==chatDigestActiveScope(cfg)||session!==chatCurrentSession()||chatSending||chatTrimBusy||chatTrimTransaction)return false;
  if(!chatDigestCanActivate(session,cfg)&&cfg.dailyDigestEnabled!==false)return false;
  var manualCfg=chatDigestManualConfig(session,cfg,request),plan=chatPlanAutoTrimForPendingBatch(manualCfg,[],{force:true,trigger:'manual_trim'});
  var groups=chatDigestMessageGroups(plan.droppedMessages||[]);
  if(!plan.trimmed||groups.some(function(g){return !request.keys.includes(g.key)})){
    delete session.digestManualTrim;chatSaveSessions();chatRenderNightlyStatus(session);
    toast('待截断的对话已变化，已取消原预约；需要时可重新发起手动截断');return false;
  }
  var stage=chatDigestStage(session,cfg),virtual=stage?Object.assign({},session,{dailyDigests:stage.base.entries,digestRollup:stage.base.rollup,digestReadyTrims:stage.trims||[]}):session;
  if(cfg.dailyDigestEnabled!==false&&!chatDigestPreparedTrim(virtual,cfg,plan))return false;
  chatTrimBusy=true;
  try{
    chatDigestFreezePack(cfg,session);chatDigestActivate(session,cfg,true);
    var result=await chatApplyAutoTrimForPendingBatch(manualCfg,[],null,{force:true,trigger:'manual_trim'});
    if(!result.trimmed)return false;
    delete session.digestManualTrim;session.cacheRebuildPending=true;
    chatSaveSessions();chatRenderMessages();chatRenderDailyDigest(cfg);chatScheduleNightlySync();
    toast('手动截断已完成，下一条消息重新建立缓存');return true;
  }finally{chatTrimBusy=false;chatRenderTrimState(cfg);chatRenderNightlyStatus(session);}
}
