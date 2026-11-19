/* Quota-window automatic digest: arm after a subscription reply, adopt the run once the
   server starts it, and keep the composer locked while it works. The arm lives beside the
   job on the server; until it is adopted this window behaves as if nothing was armed. */
var CHAT_AUTO_DIGEST_MIN_CONTEXT=200000,CHAT_AUTO_DIGEST_LOCK_TEXT='小克正在自动整理记忆与总结，暂时不能发送';
var chatAutoDigestTasks=new Map(),chatAutoDigestTimer=0,chatAutoDigestStopAsked={},chatAutoDigestStopBusy=false;
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
    return m.apiCostStatus==='subscription'?Math.floor(Number(m.tkCtx)||0):0;
  }
  return 0;
}
// Wanted: the user-visible conditions. When these stop holding an existing arm is withdrawn.
function chatAutoDigestWanted(cfg,session){
  return cfg.digestAutoWindow!==false&&cfg.digestCurrentModel===true&&cfg.dailyDigestEnabled!==false&&chatAutoDigestSubscription()&&
    chatAutoDigestContext(session)>=CHAT_AUTO_DIGEST_MIN_CONTEXT;
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
  if(!session||session.gameWindow||!cfg.panelKey)return Promise.resolve(false);
  if(chatAutoDigestTasks.has(session.id))return chatAutoDigestTasks.get(session.id);
  var task=chatAutoDigestRun(cfg,session).catch(function(){return false}).then(function(done){chatAutoDigestTasks.delete(session.id);return done});
  chatAutoDigestTasks.set(session.id,task);return task;
}
async function chatAutoDigestRun(cfg,session){
  if(!chatAutoDigestWanted(cfg,session))return chatAutoDigestLocal(session)?chatAutoDigestDisarm(cfg,session):false;
  function busy(){return chatDigestReplyActive(session)||chatTrimBusy||chatTrimTransaction||chatCurrentModelStarting;}
  if(busy())return false;
  // Same first step as a manual start: acknowledge the baseline and read the server state.
  if(!await chatSyncNightlyDigest(cfg,{session:session,force:true}))return false;
  if(session!==chatCurrentSession()||chatDigestConfigStamp(cfg)!==chatDigestConfigStamp(chatLoadConfig()))return false;
  var synced=chatNightlySynced[chatNightlyScope(cfg)+':'+session.id];
  if(synced&&synced.readBack||busy()||!chatAutoDigestWanted(cfg,session)||!chatAutoDigestReady(cfg,session))return false;
  var route,memoryRoute;try{route=chatManualModelRoute(cfg,'digest');memoryRoute=chatMemoryModelRoute(cfg)}catch(e){return false}
  if(route.selected.execution!=='claude_code_subscription'||chatDigestSameModel(route.selected,memoryRoute))return false;
  var plan=chatPlanAutoTrimForPendingBatch(cfg,[],{force:true,trigger:'manual_trim'});
  if(!plan.trimmed)return chatAutoDigestLocal(session)?chatAutoDigestDisarm(cfg,session):false;
  var groups=chatDigestMessageGroups(plan.droppedMessages||[]);
  if(!chatDigestPlanSources(session,plan).length)return false;
  var previous=session.digestAutoArm,context=chatAutoDigestContext(session),keys=groups.map(function(g){return g.key}),view=chatAutoDigestWindow(session);
  if(previous&&view.state==='armed'&&(!view.run_id||view.run_id===previous.runId)&&previous.contextTokens===context&&previous.trim.keep===plan.keep&&
      JSON.stringify(previous.trim.keys)===JSON.stringify(keys))return true;
  var trim={scope:chatDigestActiveScope(cfg),keys:keys,keep:plan.keep,dropRounds:plan.dropped,immediate:true,
    requestedAt:Math.max(Date.now(),Number(previous&&previous.trim&&previous.trim.requestedAt||0)+1)};
  var run={id:'manual-'+Date.now()+'-'+Math.random().toString(36).slice(2,10),purpose:'trim',route:route.selected,
    memory_route:memoryRoute,auto_resume_quota:true,auto_window:true};
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
  if(!chatAutoDigestLocal(session))return false;
  var force=!!(options&&options.force);
  function forget(){delete session.digestAutoArm;delete session.digestAutoArmTry;chatSaveSessions({sessionIds:[session.id]});}
  if(force)forget();
  var result=await chatAutoDigestPost(cfg,{action:'auto_window_disarm',session_id:String(session.id)});
  if(result.ok){
    if(!force)forget();
    var view=chatAutoDigestWindow(session);
    if(view&&view.state==='armed')chatAutoDigestSetWindow(cfg,session,Object.assign({},view,{state:'none',run_id:''}));
  }
  chatRenderNightlyStatus(session);
  return result.ok;
}
// Called with every server status. Adopting hands the run to the existing manual flow.
function chatAutoDigestReconcile(cfg,session,data){
  var view=data&&data.auto_window&&typeof data.auto_window==='object'?data.auto_window:{state:'none'},run=data&&data.model_run||{};
  if(view.locked!==true)delete chatAutoDigestStopAsked[session.id];
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
    var pending=attempt&&chatAutoDigestTasks.has(session.id);
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
  var own=!!(local&&local.auto&&run&&run.id===local.id&&['queued','running'].includes(run.state));
  var other=!!(view&&['running','paused'].includes(view.state)&&!(local&&local.id===view.run_id));
  return own||other?Object.assign({},options,{readOnly:true}):options;
}
function chatAutoDigestPollingDelay(session,cfg){
  var view=chatAutoDigestWindow(session);
  if(view&&(view.locked===true||view.state==='running'))return 5000;
  if(view&&view.state==='paused')return 30000;
  return chatAutoDigestLocal(session)&&!document.hidden?60000:0;
}
function chatAutoDigestViewNote(session,cfg,view){
  var auto=chatAutoDigestWindow(session);
  if(auto&&auto.state==='paused')view.note+='自动整理已暂停（额度保留/已中止），条件合适时自动继续。';
  else if(auto&&(auto.state==='running'||auto.locked===true)){view.status='自动整理进行中';view.note='小克正在自动整理（先记忆，后总结截断），完成前暂不能发送；原文保留。';}
  else if(session.digestAutoArm&&(!auto||auto.state==='armed'))view.note+='已预约自动整理：额度快刷新时闲置 15 分钟、刚刷新后闲置 30 分钟才开始。';
}
function chatAutoDigestRenderBar(session){
  session=session||chatCurrentSession();
  var bar=document.getElementById('chat-auto-digest-bar'),text=document.getElementById('chat-auto-digest-text'),button=document.getElementById('chat-auto-digest-stop');
  if(!bar||!text||!button||!session||session!==chatCurrentSession())return;
  var view=chatAutoDigestWindow(session),locked=!!(view&&view.locked===true);
  if(!locked)delete chatAutoDigestStopAsked[session.id];
  var asked=locked&&(view.stop_requested===true||chatAutoDigestStopAsked[session.id]===true),changed=bar.hidden===locked;
  bar.hidden=!locked;
  text.textContent=asked?'已请求中止：等当前这一步跑完后解锁':'小克正在自动整理（先记忆，后总结截断），暂不能发送';
  button.disabled=!!(asked||chatAutoDigestStopBusy);
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
function chatAutoDigestSaveSetting(){
  var cfg=chatLoadConfig();
  cfg.digestAutoWindow=chatFieldChecked('chat-digest-auto-window',cfg.digestAutoWindow!==false);
  chatSaveConfigObject(cfg);chatAutoDigestSchedule(0);
}
