/* Automatic preparation waits for a cache boundary; explicit manual trim commits when ready. */
function chatDigestActiveScope(cfg){return chatNightlyScope(cfg);}
function chatDigestCacheExpired(session,now){
  var rows=session===chatCurrentSession()?chatMessages:session.messages||[],last=0;
  rows.forEach(function(m){if(m.role==='user'||m.role==='assistant')last=Math.max(last,Number(m.ts)||0)});
  var ref=typeof chatCacheActivityReference==='function'?chatCacheActivityReference(session,last):{timestamp:Math.max(session.cacheFullCreatedAt||0,session.cacheLastReadAt||0,last)};
  return !ref.timestamp||(Number(now)||Date.now())-ref.timestamp>=chatDigestCacheTtl(chatLoadConfig());
}
function chatDigestCacheTtl(cfg){cfg=cfg||{};var strategy=typeof chatEffectiveCacheStrategy==='function'?chatEffectiveCacheStrategy(cfg):cfg.mainRouteCacheStrategy||cfg.cacheStrategy||'';return ['native_5m','single_5m','assistant_latest','native_tiered'].includes(strategy)?300000:strategy==='prefix_24h'?86400000:3600000;}
function chatDigestStage(session,cfg){
  var stage=session.digestStaged;
  return stage&&stage.scope===chatDigestActiveScope(cfg)&&stage.config===chatDigestConfigStamp(cfg)&&!session.digestManualPending?stage:null;
}
function chatDigestTransportText(content){
  if(typeof content==='string')return content;
  if(!Array.isArray(content))return '';
  return content.map(function(b){
    if(typeof b==='string')return b;
    if(!b)return '';
    if(b.type==='text')return String(b.text||'');
    if(b.type==='tool_result')return '【工具结果】'+chatDigestTransportText(b.content);
    if(b.type==='tool_use')return '【工具调用 '+String(b.name||'')+'】'+JSON.stringify(b.input||{});
    if(b.type==='image')return '[发送了 1 张图片，文字记录不包含图片内容]';
    if(b.type==='document')return '[附件内容未包含在文字记录中]';
    return '';
  }).filter(Boolean).join('\n');
}
function chatDigestTransportRows(messages){
  return messages.map(function(m){
    var text=chatDigestTransportText(m.content).replace(/\s*<(ck_active_memory_(?:current|event))>[\s\S]*?<\/\1>\s*/g,'').replace(/\s*<ck_gateway_context>[\s\S]*?<\/ck_gateway_context>\s*/g,'\n\n').replace(/\s*<ck_gateway_context>[\s\S]*$/g,'').replace(/\n{3,}/g,'\n\n').trim();
    if(m.role==='assistant')text=String((chatSplitThinkingText(text,{suppressThinking:true,hideUnclosedThinking:true})||{}).text||'').trim();
    return {role:m.role,text:text};
  }).filter(function(m){return (m.role==='user'||m.role==='assistant')&&m.text});
}
// Older clients sometimes trimmed visible rows without trimming the transport.
// Reuse a local summary only when its complete turn exactly matches the aligned
// transport turn. Every unmatched transport turn needs its own proven coverage.
function chatDigestTransportSources(session,rows,localSelected,drop){
  var transport=session.transportMessages||[],turns=CKChatHistory.transportTurnGroups(transport),local=chatDigestMessageGroups(rows);
  if(!drop||!turns.length)return null;
  if(!session.digestTransportEpoch){session.digestTransportEpoch=String(Date.now())+'-'+Math.random().toString(36).slice(2,9);session.digestTransportSourceAt=Date.now();}
  var stamp=Number(session.digestTransportSourceAt)||Date.now(),offset=turns.length-local.length,merged=new Map();
  function signature(messages){return JSON.stringify(messages.map(function(m){return {role:m.role,text:m.text}}))}
  var localByText=new Map(),transportCounts=new Map();
  local.forEach(function(g){var key=signature(g.messages);localByText.set(key,localByText.has(key)?null:g)});
  var sources=turns.map(function(turn){return chatDigestTransportRows(transport.slice(turn.startIndex,turn.endIndex))});
  sources.forEach(function(source){var key=signature(source);transportCounts.set(key,(transportCounts.get(key)||0)+1)});
  turns.slice(0,drop).forEach(function(turn,i){
    var source=sources[i],keyText=signature(source),match=transportCounts.get(keyText)===1?localByText.get(keyText):null,group;
    // Unique exact turns survive extra failed/pending rows at either end.
    // Ambiguous repeated turns retain the old positional safety check.
    if(!match)match=local[i-offset];
    if(match&&signature(source)===signature(match.messages))group=match;
    else{
      if(!source.length)source=[{role:'user',text:'[此轮仅含非文字内容]'}];
      var key='tr:'+chatDigestStamp([session.digestTransportEpoch,i,source]);
      group={key:key,day:chatDailyDigestDayKey(stamp),start:stamp,end:stamp,messages:source.map(function(m){return Object.assign({},m,{ts:0,turnId:key})})};
    }
    merged.set(group.key,group);
  });
  localSelected.forEach(function(g){merged.set(g.key,g)});
  return Array.from(merged.values());
}
function chatDigestPlanSources(session,plan){
  if(!plan.digestSourceGroups&&plan.canonicalTransport){
    var rows=session===chatCurrentSession()?chatMessages:session.messages||[];
    plan.digestSourceGroups=chatDigestTransportSources(session,rows,chatDigestMessageGroups(plan.droppedMessages||[]),plan.transportDropped);
  }
  return plan.digestSourceGroups||chatDigestMessageGroups(plan.droppedMessages||[]);
}
function chatDigestCandidateGroups(session,cfg,rows){
  var trim=typeof chatWindowTrimConfigFromSession==='function'&&chatWindowTrimConfigFromSession(session);
  if(!trim&&typeof chatAutoTrimConfigFrom==='function')trim=chatAutoTrimConfigFrom(Object.assign({},cfg,{windowTrimOverride:false}));
  var request=session.digestManualTrim;
  if(request&&request.scope===chatDigestActiveScope(cfg)){
    var selected=chatDigestMessageGroups(rows).filter(function(g){return request.keys.includes(g.key)});
    return (chatDigestTransportSources(session,rows,selected,request.dropRounds)||selected).map(function(g){return Object.assign({},g,{candidate:true})});
  }
  if(!trim||(!trim.enabled&&!trim.roundLimitEnabled))return [];
  var plan=CKChatHistory.trimLocalTurns(rows,trim.keep);
  var selected=chatDigestMessageGroups(plan.droppedMessages),transport=CKChatHistory.trimTransportTurns(session.transportMessages||[],trim.keep);
  return (chatDigestTransportSources(session,rows,selected,transport.dropped)||selected).map(function(g){return Object.assign({},g,{candidate:true})});
}
function chatDigestFreezePack(cfg,session){
  var scope=chatDigestActiveScope(cfg);
  if(!session.digestActivePack||session.digestActivePack.scope!==scope){
    if(!chatDigestPackReady(cfg,session))return '';
    session.digestActivePack={scope:scope,config:chatDigestConfigStamp(cfg),text:chatDailyDigestBuildPack(cfg,session),at:Date.now()};
  }
  return session.digestActivePack.text;
}
function chatDigestResetPack(cfg,session){
  if(!chatDigestPackReady(cfg,session))return false;
  session.digestActivePack={scope:chatDigestActiveScope(cfg),config:chatDigestConfigStamp(cfg),text:chatDailyDigestBuildPack(cfg,session),at:Date.now()};
  return true;
}
function chatDigestCanActivate(session,cfg){
  return cfg.dailyDigestEnabled!==false&&!session.digestManualPending&&!['detail','rollup','today'].some(function(k){return !!chatDigestEditors[session.id+':'+k]});
}
function chatDigestActivate(session,cfg,force,preparedPack){
  if(!chatDigestCanActivate(session,cfg)||(!force&&!chatDigestCacheExpired(session)))return false;
  var stage=chatDigestStage(session,cfg);
  if(!stage)return false;
  var packProven=preparedPack&&preparedPack.scope===chatDigestActiveScope(cfg)&&preparedPack.config===chatDigestConfigStamp(cfg);
  if(!packProven&&!chatDigestPackReady(cfg,Object.assign({},session,{dailyDigests:stage.base.entries,digestRollup:stage.base.rollup})))return false;
  session.dailyDigests=chatDigestRetainCycles(stage.base.entries,cfg);
  session.digestRollup=chatNormalizeDigestRollup(stage.base.rollup);
  session.digestOmittedCovered=chatDigestOmittedCoverage(stage.base.omitted);
  session.digestCheckedDay=stage.result&&stage.result.day;
  session.digestReadyTrims=stage.trims||[];
  session.digestRemote={scope:stage.scope,revision:stage.revision};
  delete session.digestStaged;session.digestWork=null;
  if(packProven)session.digestActivePack=preparedPack;else chatDigestResetPack(cfg,session);
  if(session.digestSettingsRequest&&session.digestSettingsRequest.config===chatDigestConfigStamp(cfg)&&!(packProven&&preparedPack.pendingCompaction))delete session.digestSettingsRequest;
  return true;
}
function chatDigestSettingsReady(session,cfg){
  return !!(session.digestSettingsRequest&&session.digestSettingsRequest.scope===chatDigestActiveScope(cfg)&&chatDigestStage(session,cfg)&&chatDigestPackReady(cfg,chatDigestPreparedSession(session,cfg)));
}
function chatDigestPendingSync(session,cfg){
  var record=session.digestLastSync;
  return record&&record.scope===chatDigestActiveScope(cfg)&&record.status!=='synced'?record:null;
}
function chatDigestRecordSync(session,cfg,result){
  var record={id:String(Date.now())+'-'+Math.random().toString(36).slice(2,8),scope:chatDigestActiveScope(cfg),at:Date.now(),rounds:Number(result.dropped)||0,status:'pending',trigger:result.trigger};
  if(session.digestModelRun&&session.digestModelRun.purpose==='trim')record.modelRunId=session.digestModelRun.id;
  session.digestLastSync=record;result.syncId=record.id;
  chatSaveSessions({sessionIds:[session.id]});return record;
}
function chatDigestConfirmSync(session,cfg,id,turnId){
  var record=chatDigestPendingSync(session,cfg);
  if(!record||id&&record.id!==id||turnId&&record.turnId!==turnId||!id&&!turnId)return false;
  record.status='synced';record.syncedAt=Date.now();
  chatDigestReleaseCompletedRun(session,cfg);
  chatSaveSessions({sessionIds:[session.id]});chatRenderNightlyStatus(session);return true;
}
function chatDigestReleaseCompletedRun(session,cfg){
  var record=session.digestLastSync,run=session.digestModelRun;
  if(!record||record.scope!==chatDigestActiveScope(cfg)||record.status!=='synced'||session.digestManualTrim||!run||run.purpose!=='trim')return false;
  if(record.modelRunId){if(record.modelRunId!==run.id)return false;}
  else{
    var legacy=/^manual-(\d+)-/.exec(run.id||'');
    if(!legacy||Number(legacy[1])>record.at)return false;
  }
  // A confirmed cut has a new local baseline to publish. Keeping the old
  // blocked run here would leave every subsequent queue request read-only.
  delete session.digestModelRun;return true;
}
function chatDigestPreparedSession(session,cfg){
  var stage=chatDigestStage(session,cfg);
  return stage?Object.assign({},session,{dailyDigests:stage.base.entries,digestRollup:stage.base.rollup,digestOmittedCovered:stage.base.omitted,digestReadyTrims:stage.trims||[]}):session;
}
// A growing conversation must not invalidate a completed, fully covered prefix.
// Re-plan both histories with the same retained-round count and prove coverage
// again before committing. Never split a summary batch or drop unknown history.
function chatDigestAutoPreparedPlan(session,cfg,plan,pending,explicitSync){
  if(!plan.trimmed||cfg.dailyDigestEnabled===false)return plan;
  if(!chatDigestCanActivate(session,cfg))return null;
  chatDigestPlanSources(session,plan);
  var virtual=chatDigestPreparedSession(session,cfg);
  var prepared=chatDigestPreparedTrim(virtual,cfg,plan,explicitSync);
  if(prepared)return Object.assign({},plan,{digestPrepared:prepared});
  if(!plan.manual)return null; // An automatic cut keeps exactly the configured recent rounds.
  var groups=chatDigestPlanSources(session,plan),covered=new Set();
  chatDailyDigestNormalize(virtual.dailyDigests).forEach(function(e){(e.covered||[]).forEach(function(k){covered.add(k)})});
  chatDigestOmittedCoverage(virtual.digestOmittedCovered).forEach(function(r){covered.add(r.key)});
  (virtual.digestReadyTrims||[]).forEach(function(t){t.keys.forEach(function(k){covered.add(k)})});
  var prefix=0;while(prefix<groups.length&&covered.has(groups[prefix].key))prefix++;
  for(var drop=Math.min(prefix,plan.dropped);drop>0;drop--){
    var smaller=Object.assign({},cfg,{windowTrimOverride:true,windowTrimConfig:Object.assign({},chatAutoTrimConfigFrom(cfg),{keep:Math.max(plan.keep,plan.before-drop)})});
    var candidate=chatPlanAutoTrimForPendingBatch(smaller,pending||[],{force:true,trigger:plan.trigger});
    if(!candidate.trimmed)continue;
    prepared=chatDigestPreparedTrim(virtual,cfg,candidate,explicitSync);
    if(prepared)return Object.assign({},candidate,{manual:plan.manual,digestPrepared:prepared,targetDrop:plan.dropped});
  }
  return null;
}
function chatDigestRecordTrimDecision(session,plan,reason){
  session.digestTrimDecision={at:Date.now(),reason:reason,before:plan.before,target:plan.dropped||0,cacheAgeMs:plan.cacheAgeMs||0,localRounds:plan.localBefore||0,transportRounds:plan.transportBefore||0};
  chatDigestLog('trim_result',Object.assign({ok:false,skipped:true,session_id:session.id,trigger:plan.trigger},session.digestTrimDecision));
  chatSaveSessions();chatRenderNightlyStatus(session);
}
async function chatDigestSyncNow(options){
  var session=chatCurrentSession(),cfg=chatLoadConfig();
  if(chatDigestReplyActive(session)||chatTrimBusy||chatTrimTransaction){toast(session.digestManualTrim&&session.digestManualTrim.immediate!==false?'当前回复结束后自动完成截断':'请等当前回复结束后同步');return false;}
  var pendingSync=chatDigestPendingSync(session,cfg);
  if(pendingSync){
    var release;chatTrimTransaction=new Promise(function(resolve){release=resolve});
    try{
      var synced=await chatSyncTrimmedHistoryToGateway(cfg,{sessionId:session.id,syncId:pendingSync.id,dropped:pendingSync.rounds,trigger:'retry_sync',automatic:!!(options&&options.automatic)});
      chatRenderNightlyStatus(session);if(synced){chatScheduleNightlySync(0);toast('同步完成，本次截断 '+pendingSync.rounds+' 轮');}return synced;
    }finally{chatTrimTransaction=null;release();}
  }
  if(!chatDigestImmediateReady(session,cfg)){
    var scope=chatDigestActiveScope(cfg),config=chatDigestConfigStamp(cfg);
    await chatSyncNightlyDigest(cfg,{session:session,readOnly:true,force:true});
    if(chatCurrentSession()!==session||chatDigestActiveScope(chatLoadConfig())!==scope||chatDigestConfigStamp(chatLoadConfig())!==config)return false;
    if(chatDigestReplyActive(session)||chatTrimBusy||chatTrimTransaction){chatRenderNightlyStatus(session);return false;}
    if(!chatDigestImmediateReady(session,cfg)){toast('已检查服务器结果；当前范围尚未准备齐全，原文保留');chatRenderNightlyStatus(session);return false;}
  }
  var result=await chatApplyAutoTrimForPendingBatch(cfg,[],null,{force:true,trigger:'manual_digest_sync',commitPrepared:true,skipTrim:!!(options&&options.summaryOnly)});
  if(!result.cacheBoundary){chatRenderNightlyStatus(session);return false;}
  chatSaveSessions();chatRenderDailyDigest(cfg);chatRenderMessages();chatScheduleNightlySync();
  if(result.gatewaySynced===false){toast('本机已保存，网关尚未同步；可重试同步，或在下次发送时自动同步');return true;}
  toast(result.trimmed?'已立刻截断 '+result.dropped+' 轮并同步总结，下一条消息建立新缓存':'已立刻同步总结，下一条消息建立新缓存');return true;
}
function chatDigestImmediateReady(session,cfg,explicitSync){
  if(chatDigestPendingSync(session,cfg))return true;
  if(!chatDigestCanActivate(session,cfg))return false;
  if(chatDigestSettingsReady(session,cfg))return true;
  var req=session.digestManualTrim;
  if(req){
    if(req.scope!==chatDigestActiveScope(cfg))return false;
    var manual=chatDigestManualPlan(session,cfg,req,chatPendingMessages());
    return !!(manual.manualValid&&chatDigestManualPrepared(session,cfg,manual,explicitSync!==false));
  }
  var plan=chatPlanAutoTrimForPendingBatch(cfg,chatPendingMessages(),{force:true,trigger:'manual_digest_sync'});
  if(plan.trimmed)return !!chatDigestAutoPreparedPlan(session,cfg,plan,chatPendingMessages(),explicitSync!==false);
  return !!chatDigestStage(session,cfg);
}
function chatDigestCancelManualTrim(){
  var session=chatCurrentSession();delete session.digestManualTrim;
  if(chatLoadConfig().digestCurrentModel===true){delete session.digestModelRun;chatSyncNightlyDigest(chatLoadConfig(),{force:true,cancelModelRun:true});}
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
  // A click during a reply can see one more local turn than the last completed
  // transport. After it catches up, keep the exact requested source prefix.
  // Counts alone must neither invalidate it nor authorize deleting other text.
  if(!plan.manualValid&&request.keys.length&&groups.length!==request.keys.length){
    var keep=plan.keep+groups.length-request.keys.length;
    if(keep>=request.keep){
      var alignedCfg=Object.assign({},zero,{windowTrimConfig:Object.assign({},zero.windowTrimConfig,{keep:keep})});
      var aligned=chatPlanAutoTrimForPendingBatch(alignedCfg,pending||[],{force:true,trigger:'manual_trim'});
      var alignedGroups=chatDigestMessageGroups(aligned.droppedMessages||[]);
      if(aligned.trimmed&&alignedGroups.length===request.keys.length&&alignedGroups.every(function(g,i){return g.key===request.keys[i]})){
        aligned.manualValid=true;plan=aligned;
      }
    }
  }
  return plan;
}
function chatDigestRefreshManualSources(session,cfg){
  var req=session.digestManualTrim;
  if(session!==chatCurrentSession()||!req||req.scope!==chatDigestActiveScope(cfg))return false;
  var plan=chatDigestManualPlan(session,cfg,req,chatPendingMessages());
  if(plan.manualValid||!plan.trimmed)return false;
  var keys=chatDigestMessageGroups(plan.droppedMessages||[]).map(function(g){return g.key});
  if(!keys.length||JSON.stringify(keys)===JSON.stringify(req.keys))return false;
  // Preserve the requested boundary and reuse every still-valid summary. Edited
  // source text must be queued again instead of waiting forever on obsolete keys.
  session.digestManualTrim=Object.assign({},req,{keys:keys,dropRounds:plan.dropped,
    requestedAt:Math.max(Date.now(),Number(req.requestedAt||0)+1),sourcesUpdatedAt:Date.now()});
  delete chatNightlySynced[chatNightlyScope(cfg)+':'+session.id];
  chatSaveSessions({sessionIds:[session.id]});return true;
}
function chatDigestManualPrepared(session,cfg,plan,explicitSync){
  chatDigestPlanSources(session,plan);
  var stage=chatDigestStage(session,cfg);
  var virtual=stage?Object.assign({},session,{dailyDigests:stage.base.entries,digestRollup:stage.base.rollup,digestOmittedCovered:stage.base.omitted,digestReadyTrims:stage.trims||[]}):session;
  return cfg.dailyDigestEnabled===false?{}:chatDigestCanActivate(session,cfg)&&chatDigestPreparedTrim(virtual,cfg,plan,explicitSync);
}
function chatDigestPreparationProgress(session,cfg){
  var req=session.digestManualTrim;if(!req)return null;
  var plan=chatDigestManualPlan(session,cfg,req,chatPendingMessages()),groups=chatDigestPlanSources(session,plan),virtual=chatDigestPreparedSession(session,cfg),covered=new Set();
  chatDailyDigestNormalize(virtual.dailyDigests).forEach(function(e){(e.covered||[]).forEach(function(k){covered.add(k)})});
  chatDigestOmittedCoverage(virtual.digestOmittedCovered).forEach(function(r){covered.add(r.key)});
  (virtual.digestReadyTrims||[]).forEach(function(t){t.keys.forEach(function(k){covered.add(k)})});
  return {rounds:plan.manualValid?plan.dropped:req.dropRounds,sources:groups.length,prepared:groups.filter(function(g){return covered.has(g.key)}).length,
    valid:!!plan.manualValid,ready:!!(req.scope===chatDigestActiveScope(cfg)&&plan.manualValid&&chatDigestManualPrepared(session,cfg,plan,true))};
}
async function chatRequestManualDigestTrim(options){
  chatInit();
  var cfg=chatSaveConfig(true),session=chatCurrentSession();
  if(cfg.digestCurrentModel===true&&!(options&&options.currentModel))return chatStartCurrentModelDigest('trim');
  var previous=session.digestManualTrim;
  var plan=chatPlanAutoTrimForPendingBatch(cfg,[],{force:true,trigger:'manual_trim'});
  if(!plan.trimmed){toast('当前轮数未超过保留数量，无需截断');return false;}
  var groups=chatDigestMessageGroups(plan.droppedMessages||[]);
  if(!chatDigestPlanSources(session,plan).length){toast('没有可准备的历史内容');return false;}
  if(cfg.digestCurrentModel!==true&&previous&&previous.scope===chatDigestActiveScope(cfg)&&previous.keep===plan.keep&&JSON.stringify(previous.keys)===JSON.stringify(groups.map(function(g){return g.key}))){
    previous.immediate=!(options&&options.immediate===false);chatSaveSessions({sessionIds:[session.id]});
    if(previous.immediate&&!chatDigestReplyActive(session)&&chatDigestImmediateReady(session,cfg))return chatDigestSyncNow();
    chatRenderNightlyStatus(session);toast('正在整理本次截断，总结齐全后自动完成');chatScheduleNightlySync(0);return true;
  }
  chatDigestFreezePack(cfg,session);
  session.digestManualTrim={scope:chatDigestActiveScope(cfg),keys:groups.map(function(g){return g.key}),keep:plan.keep,dropRounds:plan.dropped,
    immediate:!(options&&options.immediate===false),requestedAt:Math.max(Date.now(),Number(previous&&previous.requestedAt||0)+1)};
  chatSaveSessions();chatRenderNightlyStatus(session);chatRenderTrimState(cfg);
  delete chatNightlySynced[chatNightlyScope(cfg)+':'+session.id];
  if(options&&options.currentModel)return true;
  if(session.digestManualTrim.immediate&&!chatDigestReplyActive(session)&&chatDigestImmediateReady(session,cfg))return chatDigestSyncNow();
  chatSyncNightlyDigest(cfg,{session:session}).then(function(){return chatDigestFinishManualTrim(cfg,session)}).catch(function(){});
  chatScheduleNightlySync(2000);
  toast('正在整理 '+plan.dropped+' 轮，'+(session.digestManualTrim.immediate?'总结齐全后自动截断':'准备好后可立刻同步')+(chatDigestReplyActive(session)?'；先完成当前回复':''));
  return true;
}
// Only an explicit manual request may commit during a warm cache. Automatic
// preparation still waits for the existing send/expiry transaction.
function chatDigestReplyActive(session){
  var rows=session===chatCurrentSession()?chatMessages:session.messages||[];
  return chatSending||rows.some(function(m){return m.inFlight})||!!(session.replyDraft&&['running','finalizing'].includes(session.replyDraft.state));
}
async function chatDigestFinishManualTrim(cfg,session){
  chatRenderNightlyStatus(session);
  if(chatDigestReleaseCompletedRun(session,cfg)){chatSaveSessions({sessionIds:[session.id]});chatScheduleNightlySync(0);return false;}
  var pendingSync=chatDigestPendingSync(session,cfg);
  if(pendingSync){
    if(session!==chatCurrentSession()||chatDigestReplyActive(session)||chatTrimBusy||chatTrimTransaction||
      Date.now()-Number(pendingSync.lastAttemptAt||0)<30000)return false;
    return chatDigestSyncNow({automatic:true});
  }
  var stage=chatDigestStage(session,cfg),once=stage&&stage.result&&stage.result.sync_once;
  if(once&&typeof once.id==='string'&&once.session_id===session.id&&
      JSON.stringify(once.config)===JSON.stringify(chatNightlyConfig(cfg))&&!session.digestManualTrim&&!session.digestModelRun){
    if(session!==chatCurrentSession()||chatDigestReplyActive(session)||chatTrimBusy||chatTrimTransaction||
        !chatDigestCanActivate(session,cfg)||!chatDigestPackReady(cfg,chatDigestPreparedSession(session,cfg)))return false;
    return chatDigestSyncNow({summaryOnly:true,automatic:true});
  }
  var partial=false;
  if(cfg.digestCurrentModel===true){
    var local=session.digestModelRun,remote=(chatNightlyStatus[session.id]||session.digestSchedule||{}).model_run;
    if(!local||!remote||local.id!==remote.id)return false;
    partial=local.purpose==='trim'&&remote.state==='blocked';
    if(remote.state!=='succeeded'&&!partial)return false;
    if(local.purpose==='daily'){
      if(session!==chatCurrentSession()||chatDigestReplyActive(session)||chatTrimBusy||chatTrimTransaction)return false;
      var done=await chatDigestSyncNow({summaryOnly:true});
      if(done){delete session.digestModelRun;chatSaveSessions();}return done;
    }
  }
  var req=session.digestManualTrim;
  if(session!==chatCurrentSession()||!req||req.immediate===false||req.scope!==chatDigestActiveScope(cfg)||
      chatDigestReplyActive(session)||chatTrimBusy||chatTrimTransaction||!chatDigestImmediateReady(session,cfg,partial))return false;
  var done=await chatDigestSyncNow();
  if(done&&cfg.digestCurrentModel===true){delete session.digestModelRun;chatSaveSessions();}return done;
}
