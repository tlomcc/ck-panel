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
    var text=chatDigestTransportText(m.content).replace(/\s*<ck_gateway_context>[\s\S]*?<\/ck_gateway_context>\s*/g,'\n\n').replace(/\s*<ck_gateway_context>[\s\S]*$/g,'').replace(/\n{3,}/g,'\n\n').trim();
    if(m.role==='assistant')text=String((chatSplitThinkingText(text,{suppressThinking:true,hideUnclosedThinking:true})||{}).text||'').trim();
    return {role:m.role,text:text};
  }).filter(function(m){return (m.role==='user'||m.role==='assistant')&&m.text});
}
// Older clients sometimes trimmed visible rows without trimming the transport.
// Reuse a local summary only when its complete turn exactly matches the aligned
// transport turn. Every unmatched transport turn needs its own proven coverage.
function chatDigestTransportSources(session,rows,localSelected,drop){
  var transport=session.transportMessages||[],turns=CKChatHistory.transportTurnGroups(transport),local=chatDigestMessageGroups(rows);
  if(!drop||turns.length===local.length)return null;
  if(!session.digestTransportEpoch){session.digestTransportEpoch=String(Date.now())+'-'+Math.random().toString(36).slice(2,9);session.digestTransportSourceAt=Date.now();}
  var stamp=Number(session.digestTransportSourceAt)||Date.now(),offset=turns.length-local.length,merged=new Map();
  function signature(messages){return JSON.stringify(messages.map(function(m){return {role:m.role,text:m.text}}))}
  turns.slice(0,drop).forEach(function(turn,i){
    var source=chatDigestTransportRows(transport.slice(turn.startIndex,turn.endIndex)),match=local[i-offset],group;
    if(match&&signature(source)===signature(match.messages))group=match;
    else{
      if(!source.length)source=[{role:'user',text:'[此轮仅含非文字内容]'}];
      var key='tr:'+chatDigestStamp([session.digestTransportEpoch,i,source]);
      group={key:key,day:chatDailyDigestDayKey(stamp),start:stamp,end:stamp,messages:source.map(function(m){return Object.assign({},m,{ts:stamp,turnId:key})})};
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
function chatDigestPackReady(cfg,session){
  var range=chatDigestRange(cfg),entries=chatDailyDigestEntries(session,range.today,cfg);
  var xReady=entries.filter(function(row){return row.dayKey>=range.detailStart&&row.dayKey<range.today}).every(function(row){
    return row.edited||Array.from(row.text).length<=2500||(row.detail&&row.detail.source===chatDigestStamp(row.text));
  });
  return xReady&&chatDigestRollupFresh(cfg,session);
}
function chatDigestCanActivate(session,cfg){
  return cfg.dailyDigestEnabled!==false&&!session.digestManualPending&&!['detail','rollup','today'].some(function(k){return !!chatDigestEditors[session.id+':'+k]});
}
function chatDigestActivate(session,cfg,force){
  if(!chatDigestCanActivate(session,cfg)||(!force&&!chatDigestCacheExpired(session)))return false;
  var stage=chatDigestStage(session,cfg);
  if(!stage)return false;
  if(!chatDigestPackReady(cfg,Object.assign({},session,{dailyDigests:stage.base.entries,digestRollup:stage.base.rollup})))return false;
  session.dailyDigests=chatDailyDigestNormalize(stage.base.entries);
  session.digestRollup=chatNormalizeDigestRollup(stage.base.rollup);
  session.digestOmittedCovered=chatDigestOmittedCoverage(stage.base.omitted);
  session.digestCheckedDay=stage.result&&stage.result.day;
  session.digestReadyTrims=stage.trims||[];
  session.digestRemote={scope:stage.scope,revision:stage.revision};
  delete session.digestStaged;session.digestWork=null;
  chatDigestResetPack(cfg,session);
  if(session.digestSettingsRequest&&session.digestSettingsRequest.config===chatDigestConfigStamp(cfg))delete session.digestSettingsRequest;
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
  session.digestLastSync=record;result.syncId=record.id;
  chatSaveSessions({sessionIds:[session.id]});return record;
}
function chatDigestConfirmSync(session,cfg,id,turnId){
  var record=chatDigestPendingSync(session,cfg);
  if(!record||id&&record.id!==id||turnId&&record.turnId!==turnId||!id&&!turnId)return false;
  record.status='synced';record.syncedAt=Date.now();
  chatSaveSessions({sessionIds:[session.id]});chatRenderNightlyStatus(session);return true;
}
function chatDigestPreparedTrim(session,cfg,plan){
  var groups=chatDigestPlanSources(session,plan),keys=new Set(groups.map(function(g){return g.key}));
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
    var source=t.keys.some(function(k){return k.indexOf('tr:')===0})?'【历史发送记录（原始时间未保存）；归档 '+today+'】':'【原对话 '+chatDailyDigestRangeLabel(t)+'；归档 '+today+'】';
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
  chatDigestPlanSources(session,plan);
  var virtual=chatDigestPreparedSession(session,cfg);
  var prepared=chatDigestPreparedTrim(virtual,cfg,plan);
  if(prepared)return Object.assign({},plan,{digestPrepared:prepared});
  var groups=chatDigestPlanSources(session,plan),covered=new Set();
  chatDailyDigestNormalize(virtual.dailyDigests).forEach(function(e){(e.covered||[]).forEach(function(k){covered.add(k)})});
  chatDigestOmittedCoverage(virtual.digestOmittedCovered).forEach(function(r){covered.add(r.key)});
  (virtual.digestReadyTrims||[]).forEach(function(t){t.keys.forEach(function(k){covered.add(k)})});
  var prefix=0;while(prefix<groups.length&&covered.has(groups[prefix].key))prefix++;
  for(var drop=Math.min(prefix,plan.dropped);drop>0;drop--){
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
  var pendingSync=chatDigestPendingSync(session,cfg);
  if(pendingSync){
    var synced=await chatSyncTrimmedHistoryToGateway(cfg,{sessionId:session.id,syncId:pendingSync.id,dropped:pendingSync.rounds,trigger:'retry_sync'});
    chatRenderNightlyStatus(session);if(synced)toast('同步完成，本次截断 '+pendingSync.rounds+' 轮');return synced;
  }
  if(!chatDigestImmediateReady(session,cfg)){toast('当前范围尚未准备好，后台会继续处理；无需等待模型');chatScheduleNightlySync(0);return false;}
  var result=await chatApplyAutoTrimForPendingBatch(cfg,[],null,{force:true,trigger:'manual_digest_sync',commitPrepared:true});
  if(!result.cacheBoundary){chatRenderNightlyStatus(session);return false;}
  chatSaveSessions();chatRenderDailyDigest(cfg);chatRenderMessages();chatScheduleNightlySync();
  if(result.gatewaySynced===false){toast('本机已保存，网关尚未同步；可重试同步，或在下次发送时自动同步');return true;}
  toast(result.trimmed?'已立刻截断 '+result.dropped+' 轮并同步总结，下一条消息建立新缓存':'已立刻同步总结，下一条消息建立新缓存');return true;
}
function chatDigestImmediateReady(session,cfg){
  if(chatDigestPendingSync(session,cfg))return true;
  if(!chatDigestCanActivate(session,cfg))return false;
  if(chatDigestSettingsReady(session,cfg))return true;
  var req=session.digestManualTrim;
  if(req){
    if(req.scope!==chatDigestActiveScope(cfg))return false;
    var manual=chatDigestManualPlan(session,cfg,req,chatPendingMessages());
    return !!(manual.manualValid&&chatDigestManualPrepared(session,cfg,manual));
  }
  var plan=chatPlanAutoTrimForPendingBatch(cfg,chatPendingMessages(),{force:true,trigger:'manual_digest_sync'});
  if(plan.trimmed)return !!chatDigestAutoPreparedPlan(session,cfg,plan,chatPendingMessages());
  return !!chatDigestStage(session,cfg);
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
  chatDigestPlanSources(session,plan);
  var stage=chatDigestStage(session,cfg);
  var virtual=stage?Object.assign({},session,{dailyDigests:stage.base.entries,digestRollup:stage.base.rollup,digestOmittedCovered:stage.base.omitted,digestReadyTrims:stage.trims||[]}):session;
  return cfg.dailyDigestEnabled===false?{}:chatDigestCanActivate(session,cfg)&&chatDigestPreparedTrim(virtual,cfg,plan);
}
function chatDigestPreparationProgress(session,cfg){
  var req=session.digestManualTrim;if(!req)return null;
  var plan=chatDigestManualPlan(session,cfg,req,chatPendingMessages()),groups=chatDigestPlanSources(session,plan),virtual=chatDigestPreparedSession(session,cfg),covered=new Set();
  chatDailyDigestNormalize(virtual.dailyDigests).forEach(function(e){(e.covered||[]).forEach(function(k){covered.add(k)})});
  chatDigestOmittedCoverage(virtual.digestOmittedCovered).forEach(function(r){covered.add(r.key)});
  (virtual.digestReadyTrims||[]).forEach(function(t){t.keys.forEach(function(k){covered.add(k)})});
  return {rounds:req.dropRounds,sources:groups.length,prepared:groups.filter(function(g){return covered.has(g.key)}).length,ready:!!(req.scope===chatDigestActiveScope(cfg)&&plan.manualValid&&chatDigestManualPrepared(session,cfg,plan))};
}
async function chatRequestManualDigestTrim(){
  chatInit();
  var cfg=chatSaveConfig(true),session=chatCurrentSession();
  var previous=session.digestManualTrim;
  var plan=chatPlanAutoTrimForPendingBatch(cfg,[],{force:true,trigger:'manual_trim'});
  if(!plan.trimmed){toast('当前轮数未超过保留数量，无需截断');return false;}
  var groups=chatDigestMessageGroups(plan.droppedMessages||[]);
  if(!chatDigestPlanSources(session,plan).length){toast('没有可准备的历史内容');return false;}
  if(previous&&previous.scope===chatDigestActiveScope(cfg)&&previous.keep===plan.keep&&JSON.stringify(previous.keys)===JSON.stringify(groups.map(function(g){return g.key}))){
    chatRenderNightlyStatus(session);toast(chatDigestImmediateReady(session,cfg)?'总结已就绪，可点击「立刻同步」，不必等缓存过期':'本次范围正在后台准备；新增轮次后可继续准备');return true;
  }
  chatDigestFreezePack(cfg,session);
  session.digestManualTrim={scope:chatDigestActiveScope(cfg),keys:groups.map(function(g){return g.key}),keep:plan.keep,dropRounds:plan.dropped,requestedAt:Math.max(Date.now(),Number(previous&&previous.requestedAt||0)+1)};
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
