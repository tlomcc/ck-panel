/* Quota-window automatic digest: arm after a subscription reply, adopt the run once the
   server starts it, and keep the composer locked while it works. The arm lives beside the
   job on the server; until it is adopted this window behaves as if nothing was armed. */
var CHAT_AUTO_DIGEST_MIN_CONTEXT=150000,CHAT_AUTO_DIGEST_LOCK_TEXT='小克正在自动生成和复核截断总结，暂时不能发送';
var chatAutoDigestTasks=new Map(),chatAutoDigestTimer=0,chatAutoDigestStopAsked={},chatAutoDigestStopBusy=false;
var chatAutoDigestControls=new Map(),chatAutoDigestSettingSyncs=new Map();
function chatAutoDigestSubscription(){return !!(window.CKBackendRoute&&CKBackendRoute.current&&CKBackendRoute.current.execution==='claude_code_subscription');}
function chatAutoDigestWindow(session){
  var status=session&&chatNightlyStatus[session.id];
  return status&&status.auto_window&&typeof status.auto_window==='object'?status.auto_window:null;
}
function chatAutoDigestLocked(session){var view=chatAutoDigestWindow(session);return !!(view&&view.locked===true);}
function chatAutoDigestLocal(session){return !!(session&&(session.digestAutoArm||session.digestAutoArmTry));}
function chatAutoDigestSetWindow(cfg,session,view,run){
  if(!view||typeof view!=='object')return;
  var next=Object.assign({scope:chatNightlyScope(cfg)},chatNightlyStatus[session.id],{auto_window:view});
  if(run)next.model_run=run;
  chatNightlyStatus[session.id]=next;
}
function chatAutoDigestContext(session){
  var rows=session===chatCurrentSession()?chatMessages:session.messages||[];
  for(var i=rows.length-1;i>=0;i--){
    var m=rows[i];if(!m||m.role!=='assistant')continue;
    var completed=session.digestServerTrim;
    if(completed&&completed.scope===chatNightlyScope(chatLoadConfig())&&Number(m.ts||0)<=Number(completed.at||0))return 0;
    return m.apiCostStatus==='subscription'?Math.floor(Number(m.tkCtx)||0):0;
  }
  return 0;
}
// The explicit server setting owns cancellation; local context only selects a new arm.
function chatAutoDigestConfigured(cfg){
  return cfg.digestAutoWindow!==false&&cfg.digestCurrentModel===true&&cfg.dailyDigestEnabled!==false&&chatAutoDigestSubscription();
}
function chatAutoDigestWanted(cfg,session){
  return chatAutoDigestConfigured(cfg)&&
    chatAutoDigestContext(session)>=CHAT_AUTO_DIGEST_MIN_CONTEXT;
}
// Hand the cut to the gateway before the phone can leave the completed reply.
// Reserve one retained turn for the incoming reply; source keys stay identical
// to a normal trim prepared after that reply. This payload never enters Claude.
function chatAutoDigestPrepareChat(cfg,session,pending){
  if(!chatAutoDigestSubscription()||!session||session.gameWindow)return null;
  if(!chatAutoDigestConfigured(cfg))return {seed:{enabled:false,auto_window_enabled:cfg.digestAutoWindow!==false}};
  if(session.digestAutoSetting&&session.digestAutoSetting.scope===chatNightlyScope(cfg))return null;
  if(session.digestManualTrim||session.digestModelRun||session.digestManualPending||session.digestSettingsPending||
     chatDigestMigrationPending(session)||chatDigestPendingSync(session,cfg))return null;
  if(session.digestManualCompleted&&session.digestManualCompleted.cleanupState==='pending')return null;
  var view=chatAutoDigestWindow(session),remote=chatNightlyStatus[session.id]||{};
  if(view&&['running','paused'].includes(view.state)||remote.manual_review_required||
     remote.model_run&&['queued','running'].includes(remote.model_run.state))return null;
  var keep=chatAutoTrimConfigFrom(cfg).keep;if(keep<1)return null;
  var plan=chatPlanAutoTrimForPendingBatch(cfg,pending,{force:true,trigger:'manual_trim',reserveRounds:1});
  if(!plan.trimmed||!chatDigestPlanSources(session,plan).length)return null;
  var route;try{route=chatManualModelRoute(cfg,'digest')}catch(e){return null}
  if(route.selected.execution!=='claude_code_subscription')return null;
  var keys=chatDigestMessageGroups(plan.droppedMessages||[]).map(function(g){return g.key});
  var trim={scope:chatDigestActiveScope(cfg),keys:keys,keep:keep,dropRounds:plan.dropped,immediate:true,requestedAt:Date.now()};
  var run={id:'auto-chat-'+Date.now()+'-'+Math.random().toString(36).slice(2,10),purpose:'trim',route:route.selected,
    auto_resume_quota:true,auto_window:true};
  var body=chatAutoDigestArmBody(cfg,session,trim,run);if(!body)return null;
  delete body.memory_cadence;
  return {seed:{enabled:true,body:body},attempt:{runId:run.id,trim:trim,label:route.label,source:'chat_receipt',at:Date.now()}};
}
// Ready: nothing else owns the digest state right now. Not ready only means "do not arm yet".
function chatAutoDigestReady(cfg,session){
  if(session.digestManualTrim||session.digestModelRun||chatDigestMigrationPending(session)||chatDigestPendingSync(session,cfg))return false;
  if(session.digestManualCompleted&&session.digestManualCompleted.cleanupState==='pending')return false;
  var view=chatAutoDigestWindow(session),run=(chatNightlyStatus[session.id]||{}).model_run;
  // A gateway that does not report auto_window would treat the arm as a normal start.
  if(!view||typeof view.state!=='string')return false;
  if(run&&['queued','running'].includes(run.state))return false;
  return !['running','paused'].includes(view.state)&&view.locked!==true;
}
async function chatAutoDigestPost(cfg,body){
  var controller=new AbortController(),timer=setTimeout(function(){controller.abort()},20000),out={answered:false,ok:false,status:0,data:null};
  try{
    var response=await fetch(chatNightlyEndpoint(cfg),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:controller.signal});
    out.status=Number(response.status)||0;out.data=await response.json();
    out.answered=!!(out.data&&typeof out.data==='object');out.ok=!!(response.ok&&out.answered&&out.data.ok===true);
  }catch(e){}
  finally{clearTimeout(timer)}
  return out;
}
function chatAutoDigestArmBody(cfg,session,trim,run){
  var scope=chatNightlyScope(cfg),staged=chatDigestStage(session,cfg);
  var rows=session===chatCurrentSession()?chatMessages:session.messages||[];
  chatDailyDigestPrune(session,null,cfg);
  var context={scope:scope,remote:staged||(session.digestRemote&&session.digestRemote.scope===scope?session.digestRemote:{}),rows:rows,
    auto:chatDigestAutoPolicy(cfg,session,rows,false),baseStamp:chatNightlyBaseStamp(cfg,session),base:chatNightlyBase(session)};
  // The request exists only while the body is built, exactly as a manual start would see it.
  session.digestManualTrim=trim;
  try{return chatNightlySyncBody(cfg,session,{modelRun:run},context);}
  finally{delete session.digestManualTrim;}
}
function chatAutoDigestSchedule(delay){
  if(chatAutoDigestTimer)clearTimeout(chatAutoDigestTimer);
  chatAutoDigestTimer=setTimeout(function(){chatAutoDigestTimer=0;chatAutoDigestEvaluate()},delay===undefined?3000:Math.max(0,Number(delay)||0));
}
function chatAutoDigestEvaluate(){
  if(!chatSessionsReady)return Promise.resolve(false);
  var cfg=chatLoadConfig(),session=chatCurrentSession();
  chatAutoDigestFlushSettings(cfg);
  if(!session||session.gameWindow||!cfg.panelKey)return Promise.resolve(false);
  if(chatAutoDigestTasks.has(session.id))return chatAutoDigestTasks.get(session.id);
  var task=chatAutoDigestRun(cfg,session).catch(function(){return false}).then(function(done){chatAutoDigestTasks.delete(session.id);return done});
  chatAutoDigestTasks.set(session.id,task);return task;
}
async function chatAutoDigestRun(cfg,session){
  if(session.digestAutoSetting&&session.digestAutoSetting.scope===chatNightlyScope(cfg))return false;
  if(chatDigestReplyActive(session)&&session.digestAutoArmTry&&session.digestAutoArmTry.source==='chat_receipt'&&chatAutoDigestConfigured(cfg))return false;
  // A page with missing/old local context or a temporarily changed route
  // cannot revoke the durable server task. Settings have an explicit action.
  if(!chatAutoDigestWanted(cfg,session))return false;
  function busy(){return chatDigestReplyActive(session)||chatTrimBusy||chatTrimTransaction||chatCurrentModelStarting;}
  if(busy())return false;
  // Same first step as a manual start: acknowledge the baseline and read the server state.
  if(!await chatSyncNightlyDigest(cfg,{session:session,force:true}))return false;
  if(session!==chatCurrentSession()||chatDigestConfigStamp(cfg)!==chatDigestConfigStamp(chatLoadConfig()))return false;
  var synced=chatNightlySynced[chatNightlyScope(cfg)+':'+session.id];
  if(synced&&synced.readBack||busy()||!chatAutoDigestWanted(cfg,session)||!chatAutoDigestReady(cfg,session))return false;
  var route;try{route=chatManualModelRoute(cfg,'digest')}catch(e){return false}
  if(route.selected.execution!=='claude_code_subscription')return false;
  var plan=chatPlanAutoTrimForPendingBatch(cfg,[],{force:true,trigger:'manual_trim'});
  if(!plan.trimmed)return false;
  var groups=chatDigestMessageGroups(plan.droppedMessages||[]);
  if(!chatDigestPlanSources(session,plan).length)return false;
  var previous=session.digestAutoArm,context=chatAutoDigestContext(session),keys=groups.map(function(g){return g.key}),view=chatAutoDigestWindow(session);
  if(previous&&view.state==='armed'&&(!view.run_id||view.run_id===previous.runId)&&previous.contextTokens===context&&previous.trim.keep===plan.keep&&
      JSON.stringify(previous.trim.keys)===JSON.stringify(keys))return true;
  var trim={scope:chatDigestActiveScope(cfg),keys:keys,keep:plan.keep,dropRounds:plan.dropped,immediate:true,
    requestedAt:Math.max(Date.now(),Number(previous&&previous.trim&&previous.trim.requestedAt||0)+1)};
  var run={id:'manual-'+Date.now()+'-'+Math.random().toString(36).slice(2,10),purpose:'trim',route:route.selected,
    auto_resume_quota:true,auto_window:true};
  var body=chatAutoDigestArmBody(cfg,session,trim,run);
  if(!body)return false;
  body.action='auto_window_arm';body.auto_window={context_tokens:context};
  // An unanswered request may still have been stored. Remember it so a start can be adopted.
  var attempt={runId:run.id,trim:trim,label:route.label,contextTokens:context,at:Date.now()};
  session.digestAutoArmTry=attempt;chatSaveSessions({sessionIds:[session.id]});
  var result=await chatAutoDigestPost(cfg,body);
  if(chatDailyDigestFindSession(session.id)!==session||session.digestAutoArmTry!==attempt||!result.answered)return false;
  delete session.digestAutoArmTry;
  var armed=result.ok&&result.data.auto_window;
  if(armed&&armed.state==='armed'&&(!armed.run_id||armed.run_id===run.id))
    session.digestAutoArm={runId:run.id,trim:trim,label:route.label,contextTokens:context,armedAt:Date.now()};
  if(armed)chatAutoDigestSetWindow(cfg,session,armed);
  chatSaveSessions({sessionIds:[session.id]});chatRenderNightlyStatus(session);
  var delay=chatDigestNextPollingDelay(cfg);if(delay)chatScheduleNightlySync(delay);
  return !!(session.digestAutoArm&&session.digestAutoArm.runId===run.id);
}
// force: the user is starting something by hand; forget the arm first and continue either way.
async function chatAutoDigestDisarm(cfg,session,options){
  if(!chatAutoDigestLocal(session)&&!(options&&options.force))return false;
  var force=!!(options&&options.force);
  function forget(){delete session.digestAutoArm;delete session.digestAutoArmTry;chatSaveSessions({sessionIds:[session.id]});}
  if(force)forget();
  var result=await chatAutoDigestPost(cfg,{action:'auto_window_disarm',session_id:String(session.id),reason:options&&options.reason||'manual_action'});
  if(result.ok){
    if(!force)forget();
    var view=chatAutoDigestWindow(session);
    if(view&&view.state==='armed')chatAutoDigestSetWindow(cfg,session,Object.assign({},view,{state:'none',run_id:''}));
  }
  chatRenderNightlyStatus(session);
  return result.ok;
}
// Apply a cut already committed by the server. This never uploads history or
// starts work; unknown local material remains available for reconciliation.
function chatAutoDigestApplyServerTrim(cfg,session,snapshot){
  var receipt=snapshot&&snapshot.server_trim,scope=chatNightlyScope(cfg);
  if(!receipt)return 'absent';
  if(session.digestServerTrim&&session.digestServerTrim.scope===scope&&session.digestServerTrim.id===receipt.id)return 'current';
  if(receipt.session_id!==session.id||!/^server-[a-f0-9]{24}$/.test(receipt.id||'')||
      !Number.isInteger(receipt.drop_rounds)||receipt.drop_rounds<1||!Array.isArray(receipt.keys)||
      !Array.isArray(receipt.turn_stamps)||receipt.turn_stamps.length!==receipt.drop_rounds||
      !Array.isArray(receipt.local_turn_stamps)||receipt.local_turn_stamps.length!==receipt.drop_rounds||
      receipt.keys.length!==receipt.drop_rounds||new Set(receipt.keys).size!==receipt.keys.length||
      !Number.isInteger(receipt.keep)||receipt.keep<1||!Number.isInteger(receipt.before_rounds)||
      !Number.isInteger(receipt.after_rounds)||receipt.after_rounds<receipt.keep||receipt.before_rounds!==receipt.after_rounds+receipt.drop_rounds||
      !Number.isFinite(receipt.completed_at)||receipt.completed_at<=0||
      !snapshot.base||!Array.isArray(snapshot.base.entries)||!Array.isArray(snapshot.base.omitted||[])||
      !Array.isArray(receipt.transport_messages)||JSON.stringify(snapshot.config)!==JSON.stringify(chatNightlyConfig(cfg)))return 'conflict';
  if(chatDigestReplyActive(session)||chatTrimBusy||chatTrimTransaction||!chatDigestCanActivate(session,cfg))return 'conflict';
  var active=session===chatCurrentSession(),rows=active?chatMessages:session.messages||[],transport=session.transportMessages||[];
  function transportStamps(messages){return CKChatHistory.transportTurnGroups(messages).map(function(t){return chatDigestStamp(chatDigestTransportRows(messages.slice(t.startIndex,t.endIndex)))})}
  var stamps=transportStamps(transport),savedStamps=transportStamps(receipt.transport_messages),drop=receipt.drop_rounds;
  if(savedStamps.length!==receipt.after_rounds)return 'conflict';
  var before=stamps.length>=drop+savedStamps.length&&receipt.turn_stamps.every(function(s,i){return stamps[i]===s})&&savedStamps.every(function(s,i){return stamps[drop+i]===s});
  var after=savedStamps.length&&stamps.length>=savedStamps.length&&savedStamps.every(function(s,i){return stamps[i]===s});
  if(transport.length&&!before&&!after)return 'conflict';
  var groups=CKChatHistory.localTurnGroups(rows),keys=new Set(receipt.keys),localDrop=0,lastSource=-1;
  function displayStamp(messages){
    var merged=[];
    var visible=messages.map(function(m){return {role:m.role,content:Array.isArray(m.content)?m.content.filter(function(b){return typeof b==='string'||b&&['text','image','document'].includes(b.type)}):m.content}});
    chatDigestTransportRows(visible).forEach(function(m){
      if(merged.length&&merged[merged.length-1].role===m.role)merged[merged.length-1].text+='\n\n'+m.text;
      else merged.push({role:m.role,text:m.text});
    });
    return chatDigestStamp(merged);
  }
  var signatures=groups.map(function(g){return displayStamp(chatDailyDigestRequestMessages(rows.slice(g.startIndex,g.endIndex)).map(function(m){return {role:m.role,content:m.text}}))});
  var sourceCounts={},localCounts={};receipt.local_turn_stamps.forEach(function(s){sourceCounts[s]=(sourceCounts[s]||0)+1});signatures.forEach(function(s){localCounts[s]=(localCounts[s]||0)+1});
  while(localDrop<groups.length){
    var group=chatDigestMessageGroups(rows.slice(groups[localDrop].startIndex,groups[localDrop].endIndex))[0],sig=signatures[localDrop];
    var index=group?receipt.keys.indexOf(group.key):-1;
    if(index<0&&sourceCounts[sig]===1&&localCounts[sig]===1)index=receipt.local_turn_stamps.indexOf(sig);
    if(index<0)break;
    if(index<=lastSource||receipt.local_turn_stamps[index]!==sig)return 'conflict';
    lastSource=index;localDrop++;
  }
  if(!transport.length&&!localDrop&&rows.length){
    var kept=CKChatHistory.transportTurnGroups(receipt.transport_messages).map(function(t){return displayStamp(receipt.transport_messages.slice(t.startIndex,t.endIndex))});
    if(signatures.length<kept.length||!kept.every(function(s,i){return signatures[i]===s}))return 'conflict';
  }
  // Repeated text alone is insufficient to identify a local cut. The
  // original source keys or a unique complete turn must prove every removal.
  if(before&&localDrop===0&&groups.length&&receipt.local_turn_stamps.includes(signatures[0]))return 'conflict';
  var cut=localDrop?(localDrop===groups.length?rows.length:groups[localDrop].startIndex):0;
  var dropped=rows.slice(0,cut),droppedKeys=chatDigestMessageGroups(dropped).map(function(g){return g.key});
  var transportGroups=CKChatHistory.transportTurnGroups(transport),transportCut=before?transportGroups[drop].startIndex:0;
  var retainedProtocol=before?transport.slice(transportCut):transport.length?transport:receipt.transport_messages;
  var retainedDisplay=CKChatHistory.transportTurnGroups(retainedProtocol).map(function(t){return displayStamp(retainedProtocol.slice(t.startIndex,t.endIndex))});
  var remaining=signatures.slice(localDrop).filter(function(s){return s!==chatDigestStamp([])});
  if(remaining.length&&!retainedDisplay.some(function(s,i){return i+remaining.length<=retainedDisplay.length&&remaining.every(function(r,j){return retainedDisplay[i+j]===r})}))return 'conflict';
  var prepared={entries:chatDigestRetainCycles(snapshot.base.entries,cfg),rollup:snapshot.base.rollup,used:[],
    activePack:{scope:scope,config:chatDigestConfigStamp(cfg),text:chatDailyDigestBuildPack(cfg,Object.assign({},session,{dailyDigests:snapshot.base.entries})),at:Date.now()}};
  if(!chatDigestPackReady(cfg,Object.assign({},session,{dailyDigests:prepared.entries})))return 'conflict';
  var covered=new Set();snapshot.base.entries.forEach(function(e){(e.covered||[]).forEach(function(k){covered.add(k)})});
  (snapshot.base.omitted||[]).forEach(function(e){covered.add(e.key)});
  if(receipt.keys.some(function(k){return !covered.has(k)}))return 'conflict';
  var pending=chatNightlyPending(session).filter(function(g){return !keys.has(g.key)&&!droppedKeys.includes(g.key)});
  try{
    if(pending.length)localStorage.setItem(chatNightlyOutboxKey(session),JSON.stringify(pending));else localStorage.removeItem(chatNightlyOutboxKey(session));
  }catch(e){return 'conflict'}
  session.digestPending=pending;
  chatCommitAutoTrimPlan(cfg,{session:session,trimmed:!!(localDrop||before),droppedMessages:dropped,
    droppedTransportMessages:before?transport.slice(0,transportCut):[],canonicalTransport:true,
    digestPrepared:prepared,cacheBoundary:true,forceCacheRebuild:true,trigger:'server_auto_summary',
    before:receipt.before_rounds,after:receipt.after_rounds,dropped:drop,keep:receipt.keep,
    transportBefore:stamps.length,transportAfter:before?stamps.length-drop:stamps.length,
    localBefore:groups.length,localAfter:groups.length-localDrop});
  if(!transport.length||before&&stamps.length===receipt.before_rounds)session.transportMessages=receipt.transport_messages;
  session.transportUpdated=Math.max(Number(session.transportUpdated)||0,Number(receipt.completed_at)*1000);
  session.digestServerTrim={id:receipt.id,scope:scope,at:Number(receipt.completed_at)*1000,runId:receipt.run_id};
  session.digestLastSync={id:receipt.id,scope:scope,at:session.digestServerTrim.at,rounds:drop,status:'synced',
    trigger:'server_auto_summary',modelRunId:receipt.run_id,syncedAt:Date.now()};
  session.digestManualCompleted={rounds:drop,at:session.digestServerTrim.at,mode:'server'};
  session.digestRemote={scope:scope,revision:snapshot.revision};
  session.digestOmittedCovered=chatDigestOmittedCoverage(snapshot.base.omitted);
  delete session.digestStaged;delete session.digestPreparingBase;delete session.digestRemoteConflict;
  if(session.digestAutoArm&&session.digestAutoArm.runId===receipt.run_id)delete session.digestAutoArm;
  if(session.digestAutoArmTry&&session.digestAutoArmTry.runId===receipt.run_id)delete session.digestAutoArmTry;
  if(session.digestModelRun&&session.digestModelRun.auto&&session.digestModelRun.id===receipt.run_id){delete session.digestModelRun;delete session.digestManualTrim;}
  chatSaveSessions({sessionIds:[session.id]});
  if(active){chatMessages=session.messages;chatRenderMessages();chatRenderDailyDigest(cfg);}
  return 'applied';
}
// Called with every server status. The server now owns the entire automatic run.
function chatAutoDigestReconcile(cfg,session,data){
  var view=data&&data.auto_window&&typeof data.auto_window==='object'?data.auto_window:{state:'none'},run=data&&data.model_run||{};
  if(view.locked!==true)delete chatAutoDigestStopAsked[session.id];
  if(view.state==='completed'||data&&data.snapshot&&data.snapshot.server_trim&&data.snapshot.server_trim.run_id===run.id){
    var changed=chatAutoDigestLocal(session);
    delete session.digestAutoArm;delete session.digestAutoArmTry;
    return changed;
  }
  if(!chatAutoDigestLocal(session))return false;
  var arm=session.digestAutoArm,attempt=session.digestAutoArmTry;
  var match=[arm,attempt].filter(function(a){return a&&a.runId&&a.runId===run.id})[0];
  if(match&&['queued','running','succeeded','blocked'].includes(run.state)){
    if(session.digestModelRun&&session.digestModelRun.id!==match.runId)return false;
    chatDigestFreezePack(cfg,session);
    session.digestManualTrim=match.trim;
    session.digestModelRun={id:match.runId,purpose:'trim',label:match.label,auto:true};
    delete session.digestAutoArm;delete session.digestAutoArmTry;
    return true;
  }
  if(view.state==='armed'){
    if(attempt&&view.run_id===attempt.runId){
      session.digestAutoArm={runId:attempt.runId,trim:attempt.trim,label:attempt.label,contextTokens:attempt.contextTokens,armedAt:Date.now()};
      delete session.digestAutoArmTry;return true;
    }
    if(view.run_id&&!(arm&&view.run_id===arm.runId)&&arm){delete session.digestAutoArm;return true;}
    return false;
  }
  if(view.state==='none'&&!match){
    // An attempt still in flight has not reached the server yet.
    var pending=attempt&&(chatAutoDigestTasks.has(session.id)||attempt.source==='chat_receipt'&&chatDigestReplyActive(session));
    if(!arm&&pending)return false;
    delete session.digestAutoArm;if(!pending)delete session.digestAutoArmTry;
    return true;
  }
  return false;
}
// Read-only status check used before any upload while an arm is outstanding.
async function chatAutoDigestProbe(cfg,session){
  var scope=chatNightlyScope(cfg),controller=new AbortController(),timer=setTimeout(function(){controller.abort()},20000);
  try{
    var response=await fetch(chatNightlyEndpoint(cfg)+'&session_id='+encodeURIComponent(session.id),{cache:'no-store',signal:controller.signal});
    var data=await response.json();
    if(!response.ok||!data||data.ok!==true)return false;
    if(chatNightlyScope(chatLoadConfig())!==scope||chatDailyDigestFindSession(session.id)!==session)return false;
    var row=data.sessions&&data.sessions[0]||{};
    if(row.snapshot&&row.snapshot.server_trim){
      var applied=chatAutoDigestApplyServerTrim(cfg,session,row.snapshot);
      if(applied==='conflict')return false;
    }
    chatAutoDigestSetWindow(cfg,session,row.auto_window,row.model_run);
    if(chatAutoDigestReconcile(cfg,session,row))chatSaveSessions({sessionIds:[session.id]});
    chatRenderNightlyStatus(session);
    return true;
  }catch(e){return false}
  finally{clearTimeout(timer)}
}
function chatAutoDigestGate(cfg,session,options){
  return chatAutoDigestProbe(cfg,session).then(function(ok){
    if(!ok){chatScheduleNightlySync(30000);return false;}
    return chatSyncNightlyDigest(cfg,Object.assign({},options,{autoGate:true}));
  });
}
// A running automatic job owns the server-side request: only read until it settles.
function chatAutoDigestSyncOptions(cfg,session,options){
  if(options.readOnly||options.modelRun||options.cancelModelRun)return options;
  var view=chatAutoDigestWindow(session),run=(chatNightlyStatus[session.id]||{}).model_run,local=session.digestModelRun;
  var own=!!(local&&local.auto&&run&&run.id===local.id&&['queued','running','succeeded'].includes(run.state)&&view&&view.state!=='completed');
  var other=!!(view&&['running','committing','paused'].includes(view.state)&&!(local&&local.id===view.run_id));
  return own||other?Object.assign({},options,{readOnly:true}):options;
}
function chatAutoDigestPollingDelay(session,cfg){
  var view=chatAutoDigestWindow(session);
  if(view&&(view.locked===true||view.state==='running'||view.state==='committing'))return 5000;
  if(view&&view.state==='paused')return 30000;
  return chatAutoDigestLocal(session)&&!document.hidden?60000:0;
}
function chatAutoDigestViewNote(session,cfg,view){
  var auto=chatAutoDigestWindow(session);
  if(auto&&auto.state==='paused')view.note+='自动整理已暂停（额度保留/已中止），条件合适时自动继续。';
  else if(auto&&(auto.state==='running'||auto.locked===true)){view.status='自动整理进行中';view.note=auto.state==='committing'?'服务器正在保存总结并完成截断。':'小克正在自动生成和复核截断总结，完成前暂不能发送；原文保留。';}
  else if(auto&&auto.state==='failed'&&['history_persistence_pending','history_changed','source_coverage_changed','reply_active','settings_or_manual_hold','summary_changed_during_commit'].includes(auto.reason)){
    view.tone='attention';view.status='总结已保存，截断待完成';
    view.note=auto.reason==='history_persistence_pending'?'服务器正在等待聊天记录保存确认，原文保留。':
      auto.reason==='reply_active'?'等待当前回复完成后继续截断，原文保留。':
      auto.reason==='settings_or_manual_hold'?'自动整理已关闭或需要人工复核，原文和完成进度保留。':'对话或总结状态有变化，服务器正在核对截断范围，原文保留。';
  }
  else if(auto&&auto.state==='armed'||session.digestAutoArm&&!auto){
    view.note+='已预约自动整理：额度快刷新时闲置 15 分钟、刚刷新后闲置 30 分钟才开始。';
    if(auto&&auto.reason==='quota_window')view.note+='当前额度尚未满足启动窗口。';
    if(auto&&auto.reason==='idle_after_reset')view.note+='正在等待满 30 分钟空闲。';
    if(auto&&auto.reason&&auto.reason!=='quota_window'&&auto.reason!=='idle_after_reset')view.note+='服务器暂未启动，预约和原文保留，等待条件恢复。';
  }
  var pending=session.digestAutoSetting;
  if(pending&&pending.scope===chatNightlyScope(cfg)){
    view.tone='attention';
    view.note+='自动整理开关'+(pending.failed?'尚未送达服务器，联网后继续同步；服务器仍按已收到的设置执行。':'正在同步到服务器。');
  }
}
function chatAutoDigestRenderBar(session){
  session=session||chatCurrentSession();
  var bar=document.getElementById('chat-auto-digest-bar'),text=document.getElementById('chat-auto-digest-text'),button=document.getElementById('chat-auto-digest-stop');
  if(!bar||!text||!button||!session||session!==chatCurrentSession())return;
  var view=chatAutoDigestWindow(session),locked=!!(view&&view.locked===true);
  if(!locked)delete chatAutoDigestStopAsked[session.id];
  var asked=locked&&(view.stop_requested===true||chatAutoDigestStopAsked[session.id]===true),changed=bar.hidden===locked;
  bar.hidden=!locked;
  text.textContent=view&&view.state==='committing'?'服务器正在保存总结并完成截断，稍后即可发送':asked?'已请求中止：等当前这一步跑完后解锁':'小克正在自动生成和复核截断总结，暂不能发送';
  button.disabled=!!(asked||chatAutoDigestStopBusy||view&&view.state==='committing');
  if(changed&&typeof chatLayoutCompose==='function')chatLayoutCompose();
}
function chatAutoDigestBlockSend(){
  var session=chatCurrentSession();
  if(!session||!chatAutoDigestLocked(session))return false;
  toast(CHAT_AUTO_DIGEST_LOCK_TEXT);chatAutoDigestRenderBar(session);chatScheduleNightlySync(0);
  return true;
}
// The gateway refused a chat request because the job started before this page noticed.
function chatAutoDigestLockedError(error){
  var message=String(error&&error.message||error||'');
  if(!/^HTTP 409\b/.test(message)||message.indexOf('auto_digest_locked')<0)return false;
  var session=chatCurrentSession(),cfg=chatLoadConfig();
  toast(CHAT_AUTO_DIGEST_LOCK_TEXT,5000);
  if(session){
    chatAutoDigestSetWindow(cfg,session,Object.assign({state:'running'},chatAutoDigestWindow(session),{locked:true}));
    chatAutoDigestRenderBar(session);
    chatSyncNightlyDigest(cfg,{session:session,readOnly:true,force:true}).catch(function(){});
  }
  return true;
}
async function chatAutoDigestStop(){
  var session=chatCurrentSession(),cfg=chatLoadConfig();
  if(!session||chatAutoDigestStopBusy)return false;
  chatAutoDigestStopBusy=true;chatAutoDigestStopAsked[session.id]=true;chatAutoDigestRenderBar(session);
  try{
    var result=await chatAutoDigestPost(cfg,{action:'auto_window_stop',session_id:String(session.id)});
    if(!result.ok){delete chatAutoDigestStopAsked[session.id];toast('中止请求没有送达，请稍后再试');return false;}
    chatAutoDigestSetWindow(cfg,session,result.data.auto_window);
    chatScheduleNightlySync(0);return true;
  }finally{chatAutoDigestStopBusy=false;chatAutoDigestRenderBar(session);chatRenderNightlyStatus(session);}
}
function chatAutoDigestControlBusy(cfg,session){return chatAutoDigestControls.has(chatNightlyScope(cfg)+':'+session.id);}
async function chatAutoDigestControl(session,action,runId){
  var cfg=chatLoadConfig(),scope=chatNightlyScope(cfg),key=scope+':'+session.id;
  if(!runId||!['pause','resume'].includes(action)||chatAutoDigestControls.has(key))return false;
  chatAutoDigestControls.set(key,action);
  var body={action:action==='resume'?'auto_window_resume':'auto_window_stop',session_id:String(session.id),run_id:String(runId)};
  if(action==='resume')body.request_id='resume-'+(typeof crypto.randomUUID==='function'?crypto.randomUUID():Date.now().toString(36)+'-'+Math.random().toString(36).slice(2));
  try{
    var result=await chatAutoDigestPost(cfg,body);
    if(chatNightlyScope(chatLoadConfig())!==scope||chatDailyDigestFindSession(session.id)!==session)return result.ok;
    if(result.data&&result.data.auto_window)chatAutoDigestSetWindow(cfg,session,result.data.auto_window);
    if(!result.ok){toast(result.data&&result.data.error||'请求未确认，请刷新状态后再试');return false;}
    if(action==='resume')toast(result.data.resumed?'已提交继续总结，沿用原进度':'总结状态已更新');
    else toast(result.data.auto_window&&result.data.auto_window.stop_requested?'已请求暂停，当前这步结束后解锁':'总结已暂停，聊天已解锁');
    // Read progress only. Continuing never uploads a new cut or starts a new run.
    await chatAutoDigestProbe(cfg,session);
    return true;
  }finally{
    chatAutoDigestControls.delete(key);
    chatAutoDigestRenderBar(chatCurrentSession());
  }
}
function chatAutoDigestQueueSetting(cfg){
  var scope=chatNightlyScope(cfg),enabled=cfg.digestAutoWindow!==false;
  (chatSessions||[]).filter(function(s){return !s.gameWindow}).forEach(function(session){
    session.digestAutoSetting={scope:scope,enabled:enabled,id:'setting-'+Date.now()+'-'+Math.random().toString(36).slice(2,10),retryAt:0};
  });
  chatSaveSessions();
  return chatAutoDigestFlushSettings(cfg);
}
function chatAutoDigestFlushSettings(cfg){
  cfg=cfg||chatLoadConfig();if(!cfg.panelKey)return Promise.resolve(false);
  var scope=chatNightlyScope(cfg);
  var tasks=(chatSessions||[]).filter(function(s){return !s.gameWindow&&s.digestAutoSetting&&s.digestAutoSetting.scope===scope}).map(function(session){
    var key=scope+':'+session.id,pending=session.digestAutoSetting;
    if(chatAutoDigestSettingSyncs.has(key))return chatAutoDigestSettingSyncs.get(key);
    if(pending.retryAt>Date.now())return Promise.resolve(false);
    var task=(async function(){
      try{
        var result=await chatAutoDigestPost(cfg,{action:'auto_window_config',session_id:String(session.id),enabled:pending.enabled,request_id:pending.id});
        if(chatNightlyScope(chatLoadConfig())!==scope||chatDailyDigestFindSession(session.id)!==session)return false;
        if(session.digestAutoSetting!==pending)return false;
        if(!result.ok||result.data.enabled!==pending.enabled){
          pending.retryAt=Date.now()+30000;
          if(!pending.failed)toast('自动整理开关尚未送达服务器，联网后将继续同步',5000);
          pending.failed=true;chatScheduleNightlySync(30000);return false;
        }
        delete session.digestAutoSetting;
        if(!pending.enabled){delete session.digestAutoArm;delete session.digestAutoArmTry;}
        chatAutoDigestSchedule(0);return true;
      }finally{
        chatAutoDigestSettingSyncs.delete(key);chatSaveSessions({sessionIds:[session.id]});chatRenderNightlyStatus(session);
        if(session.digestAutoSetting&&session.digestAutoSetting!==pending)chatAutoDigestFlushSettings(chatLoadConfig());
      }
    })();
    chatAutoDigestSettingSyncs.set(key,task);return task;
  });
  return Promise.all(tasks).then(function(results){return results.every(Boolean)});
}
function chatAutoDigestSaveSetting(){
  var cfg=chatLoadConfig();
  cfg.digestAutoWindow=chatFieldChecked('chat-digest-auto-window',cfg.digestAutoWindow!==false);
  chatSaveConfigObject(cfg);
  return chatAutoDigestQueueSetting(cfg);
}
