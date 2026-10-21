/* Explicit handoff before deleting a temporary chat. Commit before destruction. */
var chatDeleteDigestBusy=false;
function chatDeleteDigestMain(source){
  var matches=chatSessions.filter(function(s){return s!==source&&String(s.title||'').trim()==='小克'});
  if(matches.length!==1)throw Error(matches.length?'有多个名为「小克」的窗口，请先保留唯一主窗口。':'未找到名为「小克」的主窗口，原窗口已保留。');
  return matches[0];
}
function chatDeleteDigestKey(source,key){return 'window-handoff:'+source.id+':'+key;}
function chatDeleteDigestCovered(entries,omitted){
  var keys=new Set();chatDailyDigestNormalize(entries).forEach(function(e){(e.covered||[]).forEach(function(k){keys.add(k)})});
  chatDigestOmittedCoverage(omitted).forEach(function(r){keys.add(r.key)});return keys;
}
function chatDeleteDigestGroups(source,target){
  var rows=source===chatCurrentSession()?chatMessages:source.messages||[];
  var local=chatDigestMessageGroups(rows),count=CKChatHistory.transportTurnGroups(source.transportMessages||[]).length;
  var all=chatDigestTransportSources(source,rows,local,count)||local;
  var groups=new Map(chatNightlyPending(source).map(function(g){return [g.key,g]}));all.forEach(function(g){groups.set(g.key,g)});
  var covered=chatDeleteDigestCovered(source.dailyDigests,source.digestOmittedCovered);
  var saved=target?chatDeleteDigestCovered(chatNightlyBase(target).entries,chatNightlyBase(target).omitted):new Set();
  // No retention-date filter: all remaining original chat belongs in today's handoff.
  return Array.from(groups.values()).filter(function(g){return !covered.has(g.key)&&!saved.has(chatDeleteDigestKey(source,g.key))});
}
function chatDeleteDigestSourceStamp(source){
  var rows=source===chatCurrentSession()?chatMessages:source.messages||[];
  return chatDigestStamp([source.title,rows,source.transportMessages,source.dailyDigests,source.digestOmittedCovered,chatNightlyPending(source)]);
}
function chatDeleteDigestCheck(source,target){
  if(!chatSessionsReady||chatIndexedDbFailed||!chatIndexedDbSupported())throw Error('完整聊天记录尚未安全加载或保存，原窗口已保留。');
  if(chatDailyDigestFindSession(source.id)!==source||chatDeleteDigestMain(source)!==target)throw Error('窗口已变化，原窗口已保留。');
  if([source,target].some(function(s){return chatDigestReplyActive(s)||(s.messages||[]).some(function(m){return m.role==='pending_user'})}))throw Error('请等当前回复完成，并处理尚未发送的消息后再删除。');
  if([source,target].some(function(s){return ['today','detail','rollup'].some(function(k){return !!chatDigestEditors[s.id+':'+k]})}))throw Error('请先保存或撤销这两个窗口中正在编辑的总结。');
}
async function chatDeleteDigestPersist(target){
  chatSaveSessions({sessionIds:[target.id]});await chatSaveSessionsToIndexedDb.pending;
  if(chatIndexedDbFailed)throw Error('总结未能安全保存，原窗口已保留。');
}
async function chatDeleteDigestHandoff(source){
  var target=chatDeleteDigestMain(source),cfg=Object.assign({},chatLoadConfig());
  chatDeleteDigestCheck(source,target);
  if(!cfg.panelKey)throw Error('请先连接网关，原窗口已保留。');
  if(cfg.dailyDigestEnabled===false)throw Error('请先开启当日总结，再选择总结后删除。');
  // Let already-started queue reads settle before freezing the source and target.
  await Promise.all(Array.from(chatNightlySyncs.values()));
  // Read the current main baseline before appending, including another device's
  // completed summaries. Unknown revision conflicts must preserve both copies.
  if(chatDigestHasContent(target)&&(!await chatSyncNightlyDigest(cfg,{session:target,force:true})||target.digestRemoteConflict))throw Error('「小克」的总结尚未同步，请完成同步后再删除；原窗口已保留。');
  chatDeleteDigestCheck(source,target);
  if(chatSending||chatTrimBusy||chatTrimTransaction||chatActiveDigestJob)throw Error('正在处理聊天或总结，请完成后再删除。');
  var job={sessionId:source.id,trigger:'window_delete',cancelled:false};
  chatTrimBusy=true;chatSetActiveDigestJob(job);
  try{
    var groups=chatDeleteDigestGroups(source,target),base=chatNightlyBase(target);
    if(!groups.length){
      var emptyStamp=chatDeleteDigestSourceStamp(source);await chatDeleteDigestPersist(target);
      return {target:target,groups:0,sourceStamp:emptyStamp,scope:chatNightlyScope(cfg)};
    }
    var sourceStamp=chatDeleteDigestSourceStamp(source),targetStamp=chatNightlyBaseStamp(cfg,target);
    var context=chatDigestWorkContext(cfg,source),scope=chatNightlyScope(cfg);
    var day=chatDailyDigestDayKey(Date.now()),batches=chatDigestMessagePlan(groups,cfg,job,day,{tz_offset_minutes:480}),parts=[];
    for(var i=0;i<batches.length;i++){
      job.batchIndex=i+1;job.batchCount=batches.length;job.stage='daily';job.range=day;
      var progress='正在总结「'+source.title+'」并汇入「小克」（'+(i+1)+'/'+batches.length+'）…';
      chatSetStatus(progress);chatDailyDigestSetStatus(progress);
      var data=await chatDigestCheckpointApi(cfg,job,{mode:'daily_part',messages:batches[i],day_key:day,tz_offset_minutes:480});
      parts.push(String(data.text).trim());
    }
    chatDeleteDigestCheck(source,target);
    if(job.cancelled||scope!==chatNightlyScope(chatLoadConfig())||context!==chatDigestWorkContext(chatLoadConfig(),source)||
       sourceStamp!==chatDeleteDigestSourceStamp(source)||targetStamp!==chatNightlyBaseStamp(chatLoadConfig(),target))throw Error('总结期间聊天、总结或设置已变化；原窗口已保留，请重新操作。');
    // A batch crossing midnight is still saved under the actual handoff day.
    day=chatDailyDigestDayKey(Date.now());
    var entries=chatDailyDigestNormalize(base.entries),entry=entries.find(function(e){return e.dayKey===day});
    var now=Date.now(),text='【来自临时窗口「'+String(source.title||'未命名对话').replace(/[\r\n]/g,' ')+'」】\n'+parts.join('\n\n');
    entry=Object.assign({},entry||{dayKey:day,startTs:now,endTs:now,rounds:0,covered:[]},{
      text:(entry?entry.text+'\n\n':'')+text,endTs:now,detail:null,brief:null,trigger:'window_delete',
      covered:Array.from(new Set((entry?entry.covered:[]).concat(groups.map(function(g){return chatDeleteDigestKey(source,g.key)})))),
      rounds:(entry?entry.rounds:0)+groups.length
    });
    target.dailyDigests=chatDailyDigestNormalize(entries.filter(function(e){return e.dayKey!==day}).concat([entry]));
    target.digestRollup=chatNormalizeDigestRollup(base.rollup);target.digestOmittedCovered=chatDigestOmittedCoverage(base.omitted);
    // Same durable publication path as saving a manually edited daily summary.
    chatNightlyManualPriority(target);target.updated=now;target.cacheRebuildPending=true;
    target.digestActivePack={scope:chatDigestActiveScope(cfg),config:chatDigestConfigStamp(cfg),text:chatDailyDigestBuildPack(cfg,target),at:now};
    await chatDeleteDigestPersist(target);
    chatDigestLog('window_digest_handoff',{ok:true,source_session:source.id,target_session:target.id,day:day,groups:groups.length,batches:batches.length});
    return {target:target,groups:groups.length,sourceStamp:sourceStamp,scope:scope};
  }finally{
    if(chatActiveDigestJob===job)chatSetActiveDigestJob(null);
    chatTrimBusy=false;chatScheduleNightlySync(0);
  }
}
