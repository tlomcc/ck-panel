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
  if(cfg.dailyDigestEnabled===false)throw Error('请先开启截断总结，再选择总结后删除。');
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
    var entries=chatDailyDigestNormalize(base.entries),active=entries.filter(function(e){return e.kind==='cycle'&&e.active!==false}),entry=active[active.length-1];
    if(!entry&&entries.some(function(e){return e.kind!=='legacy_archive'}))throw Error('主窗口的旧总结尚未迁移，原窗口已保留。');
    var now=Date.now(),text='【来自临时窗口「'+String(source.title||'未命名对话').replace(/[\r\n]/g,' ')+'」】\n'+parts.join('\n\n');
    entry=Object.assign({},entry||{id:'cy-handoff-'+now,kind:'cycle',sequence:1,active:true,dayKey:day,startTs:now,endTs:now,rounds:0,covered:[]},{
      imported:false,
      text:(entry?entry.text+'\n\n':'')+text,endTs:now,detail:null,brief:null,trigger:'window_delete',
      covered:Array.from(new Set((entry?entry.covered:[]).concat(groups.map(function(g){return chatDeleteDigestKey(source,g.key)})))),
      rounds:(entry?entry.rounds:0)+groups.length
    });
    target.dailyDigests=chatDailyDigestNormalize(entries.filter(function(e){return e.id!==entry.id}).concat([entry]));
    target.digestRollup=chatNormalizeDigestRollup(base.rollup);target.digestOmittedCovered=chatDigestOmittedCoverage(base.omitted);
    // Append an explicit handoff to the latest detailed cycle, then publish durably.
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

function chatDigestWorkContext(cfg,session){
  return chatDigestStamp([2,cfg.gatewayUrl,chatDigestConfigStamp(cfg),typeof apiProviders==='object'?[apiProviders.chat_digest,apiProviders.provider_library]:null,chatDailyDigestNormalize(session.dailyDigests),chatNormalizeDigestRollup(session.digestRollup),chatDigestOmittedCoverage(session.digestOmittedCovered)]);
}

function chatDigestMessageChunks(groups,limit){
  limit=limit||chatDigestBatchChars();
  var chunks=[],current=[],chars=0;
  groups.forEach(function(group){group.messages.forEach(function(message){
    for(var offset=0;offset<message.text.length;){
      var end=Math.min(message.text.length,offset+limit-128);
      if(limit!==12000&&end<message.text.length&&/[\uD800-\uDBFF]/.test(message.text[end-1])&&/[\uDC00-\uDFFF]/.test(message.text[end]))end--;
      var part=Object.assign({},message,{text:message.text.slice(offset,end),digestOffset:(Number(message.digestOffset)||0)+offset});
      if(chars+part.text.length+64>limit&&current.length){chunks.push(current);current=[];chars=0;}
      current.push(part);chars+=part.text.length+64;
      offset=end;
    }
  });});if(current.length)chunks.push(current);return chunks;
}

function chatDigestMessagePlan(groups,cfg,job,day,extra){
  var session=chatDailyDigestFindSession(job.sessionId),work=chatDigestNormalizeWork(session&&session.digestWork);
  var limit=chatDigestBatchChars(cfg),legacy=chatDigestMessageChunks(groups,12000),parts=[],pending=[];
  if(!work||work.context!==chatDigestWorkContext(cfg,session))return chatDigestMessageChunks(groups,limit);
  var known=legacy.map(function(messages){
    var body=Object.assign({mode:'daily_part',messages:messages,day_key:day},extra||{});
    return work.results.some(function(r){return r.key===chatDigestStamp(body)});
  });
  if(!known.some(Boolean))return chatDigestMessageChunks(groups,limit);
  legacy.forEach(function(messages,index){
    if(known[index]){
      if(pending.length){parts.push.apply(parts,chatDigestMessageChunks([{messages:pending}],limit));pending=[]}
      parts.push(messages);
    }else pending.push.apply(pending,messages);
  });
  if(pending.length)parts.push.apply(parts,chatDigestMessageChunks([{messages:pending}],limit));
  return parts;
}

function chatDigestBatchInfo(job,body){
  return {session_id:job.sessionId,trigger:job.trigger||'',mode:body.mode,tier:body.tier||'',day_key:body.day_key||'',
    batch:job.batchIndex||1,batches:job.batchCount||1,input_messages:Array.isArray(body.messages)?body.messages.length:0,
    input_chars:Array.isArray(body.messages)?body.messages.reduce(function(n,m){return n+String(m.text||'').length},0):0,source_chars:String(body.text||'').length};
}

async function chatDigestRequestApi(cfg,job,body){
  if(job.cancelled)throw new Error('总结已取消');
  if(cfg.digestCurrentModel===true)throw new Error('当前聊天模型总结请使用手动启动入口');
  var controller=new AbortController(),timedOut=false;
  job.controller=controller;
  var rejectAbort;
  var aborted=new Promise(function(resolve,reject){rejectAbort=function(){reject(new Error('总结已取消'))};controller.signal.addEventListener('abort',rejectAbort,{once:true});});
  var timer=setTimeout(function(){timedOut=true;controller.abort()},CHAT_DAILY_DIGEST_TIMEOUT_MS);
  var started=Date.now(),status=document.getElementById('chat-daily-digest-save-status'),label=status?status.textContent:'';
  var eventId='dg-'+Date.now()+'-'+Math.random().toString(36).slice(2,10),response,data;
  var info=Object.assign(chatDigestBatchInfo(job,body),{event_id:eventId,phase:'started'});
  chatDigestLog('digest_batch',info);
  var progress=setInterval(function(){if(status&&!job.cancelled)status.textContent=label+' 已等待 '+Math.floor((Date.now()-started)/1000)+' 秒，可停止后续做。'},1000);
  try{
    response=await Promise.race([aborted,fetch(chatDailyDigestEndpoint(cfg),{method:'POST',headers:{'Content-Type':'application/json'},signal:controller.signal,
      body:JSON.stringify(Object.assign({key:cfg.panelKey,session_id:job.sessionId,event_id:eventId,trigger:job.trigger,batch_index:job.batchIndex||1,batch_count:job.batchCount||1,tz_offset_minutes:-new Date().getTimezoneOffset()},body))})]);
    data=await Promise.race([aborted,response.json()]);
    if(job.cancelled)throw new Error('总结已取消');
    if(chatDigestConfigStamp(cfg)!==chatDigestConfigStamp(chatLoadConfig())||!chatDailyDigestFindSession(job.sessionId))throw new Error('设置或会话已变化，本次结果未写入');
    if(!response.ok||data.ok===false||data.prepared!==true||!String(data.text||'').trim())throw new Error(data.error||'总结接口未返回完整正文');
    if(data.salvaged||data.guard_trimmed)throw new Error('总结输出不完整，已保留原内容，请调整截断总结 API 后重试');
    job.lastRequestId=data.diagnostic&&data.diagnostic.request_id||eventId;
    chatDigestLog('digest_batch',Object.assign({},info,data.diagnostic||{},{ok:true,phase:'generated',batch:info.batch,batches:info.batches,
      client_duration_ms:Date.now()-started,http_status:response.status,output_chars:String(data.text).length,provider_model:data.provider_model||''}));
    return data;
  }catch(error){
    if(timedOut)error=new Error('本批总结等待超时，已完成进度和原内容已保留，下次从未完成批次继续');
    var diagnostic=data&&data.diagnostic||{};
    job.lastRequestId=diagnostic.request_id||eventId;
    chatDigestLog('digest_batch',Object.assign({},info,diagnostic,{ok:false,phase:job.cancelled?'cancelled':'failed',batch:info.batch,batches:info.batches,
      request_id:job.lastRequestId,client_duration_ms:Date.now()-started,http_status:response?response.status:null,
      error_code:timedOut?'client_timeout':job.cancelled?'cancelled':diagnostic.error_code||(!response?'network_error':data?'result_rejected':'invalid_response'),
      error:chatDigestSafeError(error,cfg),history_preserved:true}));
    throw error;
  }
  finally{clearTimeout(timer);clearInterval(progress);controller.signal.removeEventListener('abort',rejectAbort);if(job.controller===controller)job.controller=null;}
}

async function chatDigestCheckpointApi(cfg,job,body){
  if(job.cancelled)throw new Error('总结已取消');
  var session=chatDailyDigestFindSession(job.sessionId),context=chatDigestWorkContext(cfg,session);
  var work=chatDigestNormalizeWork(session.digestWork);
  if(!work||work.context!==context)work={version:2,context:context,results:[]};
  var key=chatDigestStamp(body),found=work.results.find(function(r){return r.key===key});
  if(found){chatDigestLog('digest_batch',Object.assign(chatDigestBatchInfo(job,body),{ok:true,phase:'reused',output_chars:found.text.length,attempt_count:0}));return {ok:true,prepared:true,text:found.text};}
  var data=await chatDigestRequestApi(cfg,job,body);
  if(job.cancelled||chatDailyDigestFindSession(job.sessionId)!==session||context!==chatDigestWorkContext(chatLoadConfig(),session))throw new Error('总结期间设置或已保存内容变化，旧结果未写入');
  work.results.push({key:key,text:data.text});work.results=work.results.slice(-400);
  session.digestWork=work;chatSaveSessions();
  chatDigestLog('digest_batch',Object.assign(chatDigestBatchInfo(job,body),{ok:true,phase:'checkpoint',request_id:data.diagnostic&&data.diagnostic.request_id,output_chars:data.text.length}));return data;
}

function chatDigestBatchChars(cfg){return chatDigestSubscriptionSummary(cfg)?120000:60000;}
