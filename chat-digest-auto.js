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
function chatAutoDigestRetainedTurnMatches(current,saved){
  if(chatDigestStamp(chatDigestTransportRows(current))===chatDigestStamp(chatDigestTransportRows(saved)))return true;
  function images(messages){return messages.reduce(function(n,m){return n+(Array.isArray(m.content)?m.content.filter(function(b){return b&&b.type==='image'}).length:0)},0)}
  // Either side may already have applied the established image cleanup.
  // This only recognizes the retained boundary; the local retained blocks
  // stay in place and the source prefix still requires its original stamps.
  if(!!images(current)===!!images(saved))return false;
  function withoutImages(messages){return messages.map(function(m){return Object.assign({},m,{content:Array.isArray(m.content)?m.content.filter(function(b){return !b||b.type!=='image'}):m.content})})}
  return chatDigestStamp(chatDigestTransportRows(withoutImages(current)))===chatDigestStamp(chatDigestTransportRows(withoutImages(saved)));
}
function chatAutoDigestRetireCoveredRequest(cfg,session,receipt,coveredKeys,sourceProven){
  var run=session.digestModelRun,req=session.digestManualTrim,scope=chatNightlyScope(cfg);
  if(run&&run.auto&&run.id===receipt.run_id){
    delete session.digestModelRun;
    if(req&&req.scope===scope&&Number(req.requestedAt||0)<=Number(receipt.completed_at)*1000)delete session.digestManualTrim;
    return true;
  }
  var covered=new Set((receipt.keys||[]).concat(coveredKeys||[]));
  // Before v436 saved manual runs had no startState. A completed, proven
  // source must retire that legacy intent using the same coverage checks.
  if(run&&run.auto!==true&&run.purpose==='trim'&&(run.startState==='unconfirmed'||!run.startState)&&req&&req.scope===scope&&
      Number(req.requestedAt)<=Number(receipt.completed_at)*1000&&req.keep===receipt.keep&&
      req.dropRounds<=receipt.drop_rounds&&Array.isArray(req.keys)&&req.keys.length&&
      // Display keys change when images are cleaned or text differs. The
      // complete canonical prefix on this device already proves the source.
      (sourceProven===true||req.keys.every(function(k){return covered.has(k)}))){
    delete session.digestModelRun;delete session.digestManualTrim;return true;
  }
  return false;
}
// Displayed turns can differ from their canonical text, and some canonical
// turns are never displayed. Pair every displayed turn that is unique on both
// sides, exactly or ignoring whitespace. Returns the canonical index of each
// displayed turn (-1 when unpaired), or null when the two orders disagree.
function chatAutoDigestMatchTurns(local,reference,localLoose,referenceLoose){
  function unique(list){
    var counts={},at={};list.forEach(function(s,i){counts[s]=(counts[s]||0)+1;at[s]=i});
    return function(s){return s&&counts[s]===1?at[s]:-1};
  }
  var exactLocal=unique(local),exactReference=unique(reference),looseLocal=unique(localLoose),looseReference=unique(referenceLoose),last=-1,ordered=true;
  var matches=local.map(function(s,i){
    var index=exactLocal(s)<0?-1:exactReference(s);
    if(index<0&&looseLocal(localLoose[i])>=0)index=looseReference(localLoose[i]);
    if(index>=0){if(index<=last)ordered=false;last=index;}
    return index;
  });
  return ordered?matches:null;
}
function chatAutoDigestApplyServerTrim(cfg,session,snapshot){
  var receipt=snapshot&&snapshot.server_trim,scope=chatNightlyScope(cfg);
  if(!receipt)return 'absent';
  var check={receipt_id:receipt.id,panel_version:window.CK_PANEL_VERSION||'',
    local_config:chatNightlyConfig(cfg),manual_pending:!!session.digestManualPending,
    editor_open:['detail','rollup','today'].some(function(k){return !!chatDigestEditors[session.id+':'+k]}),
    request_at:Number((session.digestManualTrim||{}).requestedAt)||0,
    request_keep:Number((session.digestManualTrim||{}).keep)||0,
    request_drop:Number((session.digestManualTrim||{}).dropRounds)||0,
    request_scope_matches:!!(session.digestManualTrim&&session.digestManualTrim.scope===scope),
    run_start_state:String((session.digestModelRun||{}).startState||'legacy'),
    request_keys:(session.digestManualTrim&&session.digestManualTrim.keys||[]).slice(0,700)};
  session.digestServerTrimCheck=check;
  function conflict(reason){check.outcome='conflict';check.reason=reason;return 'conflict';}
  var previousReceipt=session.digestServerTrim,isCurrent=previousReceipt&&previousReceipt.scope===scope&&previousReceipt.id===receipt.id;
  if(receipt.session_id!==session.id||!/^server-[a-f0-9]{24}$/.test(receipt.id||'')||
      !Number.isInteger(receipt.drop_rounds)||receipt.drop_rounds<1||!Array.isArray(receipt.keys)||
      !Array.isArray(receipt.turn_stamps)||receipt.turn_stamps.length!==receipt.drop_rounds||
      !Array.isArray(receipt.local_turn_stamps)||receipt.local_turn_stamps.length!==receipt.drop_rounds||
      receipt.keys.length!==receipt.drop_rounds||new Set(receipt.keys).size!==receipt.keys.length||
      !Number.isInteger(receipt.keep)||receipt.keep<1||!Number.isInteger(receipt.before_rounds)||
      !Number.isInteger(receipt.after_rounds)||receipt.after_rounds<receipt.keep||receipt.before_rounds!==receipt.after_rounds+receipt.drop_rounds||
      !Number.isFinite(receipt.completed_at)||receipt.completed_at<=0||
      !snapshot.base||!Array.isArray(snapshot.base.entries)||!Array.isArray(snapshot.base.omitted||[])||
      !Array.isArray(receipt.transport_messages))return conflict('invalid_receipt');
  if(JSON.stringify(snapshot.config)!==JSON.stringify(chatNightlyConfig(cfg)))return conflict('settings_changed');
  if(chatDigestReplyActive(session)||chatTrimBusy||chatTrimTransaction)return conflict('reply_active');
  if(!chatDigestCanActivate(session,cfg))return conflict('summary_edit_pending');
  var active=session===chatCurrentSession(),rows=active?chatMessages:session.messages||[],transport=session.transportMessages||[],recoveredTransport=false;
  // The display may contain extra old rows and omits signed protocol blocks.
  // A committed server history restores the protocol without removing display edits.
  if(!transport.length&&Array.isArray(receipt.current_transport_messages)&&receipt.current_transport_messages.length){
    transport=receipt.current_transport_messages;recoveredTransport=true;
  }
  function transportStamps(messages){return CKChatHistory.transportTurnGroups(messages).map(function(t){return chatDigestStamp(chatDigestTransportRows(messages.slice(t.startIndex,t.endIndex)))})}
  var stamps=transportStamps(transport),savedStamps=transportStamps(receipt.transport_messages),drop=receipt.drop_rounds;
  check.transport_rounds=stamps.length;check.transport_stamps=stamps.slice(0,700);check.retained_stamps=savedStamps.slice(0,700);
  if(savedStamps.length!==receipt.after_rounds)return conflict('invalid_retained_count');
  var transportGroups=CKChatHistory.transportTurnGroups(transport),savedGroups=CKChatHistory.transportTurnGroups(receipt.transport_messages);
  function retainedMatches(offset){return savedGroups.every(function(t,i){var current=transportGroups[offset+i];return current&&chatAutoDigestRetainedTurnMatches(transport.slice(current.startIndex,current.endIndex),receipt.transport_messages.slice(t.startIndex,t.endIndex))})}
  var before=stamps.length>=drop+savedStamps.length&&receipt.turn_stamps.every(function(s,i){return stamps[i]===s})&&retainedMatches(drop);
  var after=savedStamps.length&&stamps.length>=savedStamps.length&&retainedMatches(0);
  check.boundary_before=!!before;check.boundary_after=!!after;
  var groups=CKChatHistory.localTurnGroups(rows),keys=new Set(receipt.keys),localDrop=0,lastSource=-1;
  function sourceRows(messages){
    var visible=messages.map(function(m){return {role:m.role,content:Array.isArray(m.content)?m.content.filter(function(b){return typeof b==='string'||b&&['text','image','document'].includes(b.type)}):m.content}});
    return chatDigestTransportRows(visible);
  }
  function displayRows(messages){
    var merged=[];
    sourceRows(messages).forEach(function(m){
      if(merged.length&&merged[merged.length-1].role===m.role)merged[merged.length-1].text+='\n\n'+m.text;
      else merged.push({role:m.role,text:m.text});
    });
    return merged;
  }
  function displayStamp(messages){return chatDigestStamp(displayRows(messages));}
  function localProtocol(messages){return chatDailyDigestRequestMessages(messages).map(function(m){return {role:m.role,content:m.text}});}
  function rowStamps(messages){return displayRows(messages).map(function(m){return chatDigestStamp(m)});}
  function positions(source,pattern){
    var found=[];if(!pattern.length)return found;
    for(var i=0;i+pattern.length<=source.length;i++)if(pattern.every(function(s,j){return source[i+j]===s}))found.push(i);
    return found;
  }
  function imageFree(messages){
    function text(value){return String(value||'').replace(/\[发送了 \d+ 张图片，文字记录不包含图片内容\]/g,'').replace(/\n{3,}/g,'\n\n').trim();}
    return messages.map(function(m){
      var content=m.content;
      if(typeof content==='string')content=text(content);
      else if(Array.isArray(content))content=content.filter(function(b){return !b||b.type!=='image'}).map(function(b){
        return typeof b==='string'?text(b):b&&b.type==='text'?Object.assign({},b,{text:text(b.text)}):b;
      });
      return {role:m.role,content:content};
    });
  }
  var localParts=groups.map(function(g){return localProtocol(rows.slice(g.startIndex,g.endIndex))});
  var signatures=localParts.map(displayStamp);
  check.local_rounds=groups.length;check.local_stamps=signatures.slice(0,700);
  check.local_keys=groups.slice(0,700).map(function(g){return (chatDigestMessageGroups(rows.slice(g.startIndex,g.endIndex))[0]||{}).key||''});
  if(transport.length&&!before&&!after)return conflict('transport_boundary');
  var sourceManifest=receipt.display_source||[];
  if(!Array.isArray(sourceManifest)||sourceManifest.length>20000||sourceManifest.some(function(m,i){
    return !m||!['user','assistant'].includes(m.role)||!/^\d{1,9}:[a-z0-9]{1,10}:[a-z0-9]{1,10}$/.test(m.stamp||'')||
      !Number.isInteger(m.first)||!Number.isInteger(m.last)||m.first<0||m.last<m.first||m.last>=drop||
      i>0&&sourceManifest[i-1].last>m.first;
  }))return conflict('invalid_receipt');
  check.source_manifest_rows=sourceManifest.length;check.source_manifest_used=false;
  var retainedProtocol=before?transport.slice(transportGroups[drop].startIndex):transport.length?transport:receipt.transport_messages;
  var retainedRows=rowStamps(retainedProtocol),retainedWithoutImages=rowStamps(imageFree(retainedProtocol));
  var manifestStamps=sourceManifest.map(function(m){return m.stamp});
  function alreadyRetained(part){return positions(retainedRows,rowStamps(part)).length||positions(retainedWithoutImages,rowStamps(imageFree(part))).length;}
  var sourceCounts={},localCounts={};receipt.local_turn_stamps.forEach(function(s){sourceCounts[s]=(sourceCounts[s]||0)+1});signatures.forEach(function(s){localCounts[s]=(localCounts[s]||0)+1});
  while(localDrop<groups.length){
    var group=chatDigestMessageGroups(rows.slice(groups[localDrop].startIndex,groups[localDrop].endIndex))[0],sig=signatures[localDrop];
    var index=group?receipt.keys.indexOf(group.key):-1;
    if(index<0&&sourceCounts[sig]===1&&localCounts[sig]===1&&(before||!alreadyRetained(localParts[localDrop])))index=receipt.local_turn_stamps.indexOf(sig);
    var rangeMatched=false;
    if(before&&(index<0||receipt.local_turn_stamps[index]!==sig)){
      // The complete canonical prefix proves order even when an older display
      // merged adjacent turns or assigned different local IDs.
      for(var end=lastSource+1;end<drop;end++){
        var start=transportGroups[lastSource+1],tail=transportGroups[end];
        var joined=displayStamp(transport.slice(start.startIndex,tail.endIndex));
        if(joined===sig){index=end;rangeMatched=true;break;}
        if(Number(joined.split(':')[0])>Number(sig.split(':')[0]))break;
      }
    }
    if(!rangeMatched&&(index<0||receipt.local_turn_stamps[index]!==sig)&&localCounts[sig]===1&&sourceManifest.length&&(before||!alreadyRetained(localParts[localDrop]))){
      var pattern=rowStamps(localParts[localDrop]),matches=positions(manifestStamps,pattern).filter(function(start){
        var first=sourceManifest[start],end=start+pattern.length-1,last=sourceManifest[end],next=sourceManifest[end+1];
        return first.role==='user'&&(start===0||sourceManifest[start-1].last<first.first)&&(!next||next.first>last.last);
      });
      if(matches.length===1&&sourceManifest[matches[0]].first>lastSource){
        index=sourceManifest[matches[0]+pattern.length-1].last;rangeMatched=true;check.source_manifest_used=true;
      }
    }
    if(index<0)break;
    if(index<=lastSource||!rangeMatched&&receipt.local_turn_stamps[index]!==sig){check.mismatch_index=localDrop;return conflict('display_source_order');}
    lastSource=index;localDrop++;
  }
  // The exact walk stops at the first displayed turn whose text differs
  // from its canonical source. Turns paired after that point are still
  // proven; an unpaired turn is never removed, it simply stays displayed.
  function looseStamp(messages){return chatDigestStamp(displayRows(messages).map(function(m){return {role:m.role,text:m.text.replace(/\s+/g,'')}}))}
  var reference=receipt.local_turn_stamps.concat(CKChatHistory.transportTurnGroups(retainedProtocol).map(function(t){return displayStamp(retainedProtocol.slice(t.startIndex,t.endIndex))}));
  var matched=chatAutoDigestMatchTurns(signatures,reference,before?localParts.map(looseStamp):[],
    before?transportGroups.map(function(t){return looseStamp(transport.slice(t.startIndex,t.endIndex))}):[]);
  var exactDrop=localDrop,paired=(matched||[]).map(function(index,i){return i>=exactDrop&&index>=0&&index<drop?i:-1}).filter(function(i){return i>=0});
  if(!transport.length&&!localDrop&&!paired.length&&rows.length){
    var kept=CKChatHistory.transportTurnGroups(receipt.transport_messages).map(function(t){return displayStamp(receipt.transport_messages.slice(t.startIndex,t.endIndex))});
    if(signatures.length<kept.length||!kept.every(function(s,i){return signatures[i]===s}))return conflict('display_without_transport');
  }
  // Repeated text alone is insufficient to identify a local cut. The
  // original source keys or a unique complete turn must prove every removal.
  check.local_drop=localDrop+paired.length;
  if(before&&localDrop===0&&!paired.length&&groups.length&&receipt.local_turn_stamps.includes(signatures[0]))return conflict('ambiguous_source');
  var cut=localDrop?(localDrop===groups.length?rows.length:groups[localDrop].startIndex):0;
  var dropped=rows.slice(0,cut),droppedKeys=chatDigestMessageGroups(dropped).map(function(g){return g.key});
  var transportCut=before?transportGroups[drop].startIndex:0;
  // localTurnGroups omits assistant-only and stopped records. A proven turn
  // cannot silently authorize the surrounding records that it did not check.
  var checkedGroups=groups.slice(0,localDrop),uncovered=false,placedKeys=[];
  if(paired.length){
    var completed=Number(receipt.completed_at)*1000,end=groups[paired[paired.length-1]].endIndex,take=new Set(paired);
    var known=new Set(before?rowStamps(transport.slice(0,transportCut)):manifestStamps);
    if(before)sourceRows(transport.slice(0,transportCut)).forEach(function(m){known.add(chatDigestStamp(m))});
    // Unsent, stopped or later material stays even inside a paired turn.
    function settled(m){
      var latest=(m.versions||[]).reduce(function(at,v){return Math.max(at,Number(v&&v.ts)||0)},Number(m.ts||0));
      return ['user','assistant'].includes(m.role)&&!m.sendFailed&&!m.inFlight&&m.stopped!==true&&latest<=completed;
    }
    dropped=rows.slice(0,end).filter(function(m,i){
      if(!m||!String(m.text||'').trim()&&!(m.images||[]).length&&!(m.files||[]).length)return true;
      var at=groups.findIndex(function(g){return i>=g.startIndex&&i<g.endIndex});
      if(at>=0)return (at<exactDrop||take.has(at))&&settled(m);
      // A record outside every turn leaves only as text of the summarized source.
      return settled(m)&&sourceRows(localProtocol([m])).every(function(r){return known.has(chatDigestStamp(r))});
    });
    var leaving=new Set(dropped);
    droppedKeys=chatDigestMessageGroups(dropped).map(function(g){return g.key});
    placedKeys=chatDigestMessageGroups(rows.slice(0,end).filter(function(m){return !leaving.has(m)})).map(function(g){return g.key});
  }
  for(var removedIndex=0;!paired.length&&removedIndex<dropped.length;removedIndex++){
    var removed=dropped[removedIndex];
    if(!removed||!String(removed.text||'').trim()&&!(removed.images||[]).length&&!(removed.files||[]).length)continue;
    if(!['user','assistant'].includes(removed.role)||removed.sendFailed||removed.inFlight||removed.stopped===true)return conflict('display_source_order');
    if(!checkedGroups.some(function(g){return removedIndex>=g.startIndex&&removedIndex<g.endIndex})){
      if(Number(removed.ts||0)>Number(receipt.completed_at)*1000)return conflict('display_source_order');
      uncovered=true;
    }
  }
  if(uncovered&&!paired.length){
    var removedRows=rowStamps(localProtocol(dropped));
    var provenRows=before?rowStamps(transport.slice(0,transportCut)):manifestStamps;
    if(positions(provenRows,removedRows).length!==1)return conflict('display_source_order');
  }
  var remainingProtocol=localProtocol(rows.slice(cut)),remaining=rowStamps(remainingProtocol),remainingWithoutImages=rowStamps(imageFree(remainingProtocol));
  check.local_retained_rows=remaining.length;check.retained_visible_rows=retainedRows.length;
  // Paired turns in one common order already fix the cut; displayed turns
  // that stay unpaired are kept and need no alignment.
  if(!matched&&remaining.length&&!positions(retainedRows,remaining).length&&!positions(retainedWithoutImages,remainingWithoutImages).length)return conflict('display_retained_alignment');
  var leftRows=new Set(dropped),localAfter=CKChatHistory.localTurnGroups(rows.filter(function(m){return !leftRows.has(m)})).length;
  var prepared={entries:chatDigestRetainCycles(snapshot.base.entries,cfg),rollup:snapshot.base.rollup,used:[],
    activePack:{scope:scope,config:chatDigestConfigStamp(cfg),text:chatDailyDigestBuildPack(cfg,Object.assign({},session,{dailyDigests:snapshot.base.entries})),at:Date.now()}};
  if(!chatDigestPackReady(cfg,Object.assign({},session,{dailyDigests:prepared.entries})))return conflict('summary_pack');
  var covered=new Set();snapshot.base.entries.forEach(function(e){(e.covered||[]).forEach(function(k){covered.add(k)})});
  (snapshot.base.omitted||[]).forEach(function(e){covered.add(e.key)});
  if(receipt.keys.some(function(k){return !covered.has(k)}))return conflict('source_coverage');
  // A receipt marker can survive a late local history restore. Only a
  // validated retained history may acknowledge this cut without applying it.
  if(isCurrent&&after&&!before&&!localDrop&&!paired.length){
    var retired=chatAutoDigestRetireCoveredRequest(cfg,session,receipt,Array.from(covered).concat(previousReceipt.localKeys||[]));
    if(recoveredTransport){
      session.transportMessages=transport;
      session.transportUpdated=Math.max(Number(session.transportUpdated)||0,Number(receipt.current_transport_updated||receipt.completed_at)*1000);
      retired=true;
    }
    var lastSync=session.digestLastSync;
    if(!lastSync||lastSync.scope!==scope||Number(lastSync.at||0)<=Number(receipt.completed_at)*1000){
      session.digestLastSync={id:receipt.id,scope:scope,at:Number(receipt.completed_at)*1000,rounds:drop,status:'synced',
        trigger:'server_auto_summary',modelRunId:receipt.run_id,syncedAt:Date.now()};
      session.digestManualCompleted={rounds:drop,at:Number(receipt.completed_at)*1000,mode:'server'};retired=true;
    }
    if(retired)chatSaveSessions({sessionIds:[session.id]});
    check.outcome='current';check.manual_remains=!!session.digestManualTrim;check.run_remains=!!session.digestModelRun;
    check.synced=session.digestLastSync&&session.digestLastSync.id===receipt.id&&session.digestLastSync.status==='synced';
    check.local_after=groups.length;check.transport_after=stamps.length;return 'current';
  }
  var pending=chatNightlyPending(session).filter(function(g){return !keys.has(g.key)&&!droppedKeys.includes(g.key)});
  try{
    if(pending.length)localStorage.setItem(chatNightlyOutboxKey(session),JSON.stringify(pending));else localStorage.removeItem(chatNightlyOutboxKey(session));
  }catch(e){return conflict('outbox_storage')}
  session.digestPending=pending;
  chatCommitAutoTrimPlan(cfg,{session:session,trimmed:!!(dropped.length||before),droppedMessages:dropped,
    droppedTransportMessages:before?transport.slice(0,transportCut):[],canonicalTransport:true,
    digestPrepared:prepared,cacheBoundary:!!(dropped.length||before),forceCacheRebuild:!!(dropped.length||before),trigger:'server_auto_summary',
    before:receipt.before_rounds,after:receipt.after_rounds,dropped:drop,keep:receipt.keep,
    transportBefore:stamps.length,transportAfter:before?stamps.length-drop:stamps.length,
    localBefore:groups.length,localAfter:localAfter});
  if(recoveredTransport)session.transportMessages=transport;
  else if(!transport.length)session.transportMessages=receipt.transport_messages;
  session.transportUpdated=Math.max(Number(session.transportUpdated)||0,Number(recoveredTransport?receipt.current_transport_updated||receipt.completed_at:receipt.completed_at)*1000);
  session.digestServerTrim={id:receipt.id,scope:scope,at:Number(receipt.completed_at)*1000,runId:receipt.run_id,localKeys:droppedKeys.concat(placedKeys)};
  session.digestLastSync={id:receipt.id,scope:scope,at:session.digestServerTrim.at,rounds:drop,status:'synced',
    trigger:'server_auto_summary',modelRunId:receipt.run_id,syncedAt:Date.now()};
  session.digestManualCompleted={rounds:drop,at:session.digestServerTrim.at,mode:'server'};
  session.digestRemote={scope:scope,revision:snapshot.revision};
  session.digestOmittedCovered=chatDigestOmittedCoverage(snapshot.base.omitted);
  delete session.digestStaged;delete session.digestPreparingBase;delete session.digestRemoteConflict;
  if(session.digestAutoArm&&session.digestAutoArm.runId===receipt.run_id)delete session.digestAutoArm;
  if(session.digestAutoArmTry&&session.digestAutoArmTry.runId===receipt.run_id)delete session.digestAutoArmTry;
  chatAutoDigestRetireCoveredRequest(cfg,session,receipt,droppedKeys.concat(placedKeys),!!before);
  chatSaveSessions({sessionIds:[session.id]});
  if(active){chatMessages=session.messages;chatRenderMessages();chatRenderDailyDigest(cfg);}
  check.outcome='applied';check.manual_remains=!!session.digestManualTrim;check.run_remains=!!session.digestModelRun;
  check.synced=true;check.local_after=localAfter;
  check.transport_after=CKChatHistory.transportTurnGroups(session.transportMessages||[]).length;return 'applied';
}
// Reuse the authenticated queue and bounded maintenance journal. Only counts,
// source fingerprints and the checked outcome leave the browser.
async function chatAutoDigestReportServerTrim(cfg,session){
  var check=session.digestServerTrimCheck;if(!check||!check.outcome)return false;
  var signature=chatDigestStamp(check),previous=session.digestServerTrimReported;
  if(previous&&previous.signature===signature&&Date.now()-previous.at<30000)return previous.ok;
  var clientId;try{
    clientId=localStorage.getItem('ck_digest_sync_client_v1');
    if(!clientId){clientId='sync-'+Date.now()+'-'+Math.random().toString(36).slice(2,12);localStorage.setItem('ck_digest_sync_client_v1',clientId);}
  }catch(e){clientId='sync-'+Date.now()+'-'+Math.random().toString(36).slice(2,12);}
  var controller=new AbortController(),timer=setTimeout(function(){controller.abort()},5000);
  try{
    var response=await fetch(chatNightlyEndpoint(cfg),{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({action:'server_trim_sync',session_id:session.id,client_id:clientId,check:check}),signal:controller.signal});
    var data=await response.json(),ok=response.ok&&data&&data.ok===true&&data.recorded===true;
    session.digestServerTrimReported={signature:signature,at:Date.now(),ok:ok};return ok;
  }catch(e){return false;}finally{clearTimeout(timer);}
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
