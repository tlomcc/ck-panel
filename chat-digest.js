/* Z summary cycles. Generation and checkpoints use the existing server queue. */
var chatDailyDigestLastError="",chatDigestEditors={},chatDigestSettingsDirty=false,chatDigestMaintenanceBusy=false,chatActiveDigestJob=null;
function chatDigestSubscriptionSummary(cfg){
  cfg=cfg||chatLoadConfig();
  if(cfg.digestCurrentModel!==true)return false;
  var execution=cfg.executionBackend||cfg.execution_backend||cfg.backend;
  if(cfg.digestCurrentModel===true&&typeof chatManualModelRoute==='function'){
    try{execution=chatManualModelRoute(cfg,'digest').selected.execution}catch(ignore){}
  }
  return execution==='claude_code_subscription';
}

function chatDigestSafeError(error,cfg){
  var text=String(error&&error.message||error||'');
  if(cfg&&cfg.panelKey)text=text.split(cfg.panelKey).join('[redacted]');
  return text.replace(/https?:\/\/[^\s)]+/gi,'[接口地址]').replace(/(?:bearer\s+|(?:api[_ -]?key|token|password|authorization)\s*[:=]\s*)[^\s,;，；}]+|\bsk-[\w-]{8,}/gi,'[redacted]').slice(0,500);
}

function chatDigestLog(event,data){
  chatDebug(event,data);
  if(typeof chatFlushDebugSave==='function')chatFlushDebugSave();
}

function chatSetActiveDigestJob(job){
  chatActiveDigestJob=job;
  ['chat-digest-cancel-btn','chat-trim-cancel-btn'].forEach(function(id){var el=document.getElementById(id);if(el)el.hidden=!job});
}

function chatCancelDigestWork(){
  if(!chatActiveDigestJob)return;
  chatActiveDigestJob.cancelled=true;
  if(chatActiveDigestJob.controller)chatActiveDigestJob.controller.abort();
  chatDailyDigestSetStatus('正在停止；已完成批次和原对话会保留。');
}

// Checkpoints are unpublished results: they never change the active prompt or
// trim boundary. A source/config edit invalidates the checkpoint namespace.

function chatDailyDigestPad2(value){return String(Math.floor(Number(value)||0)).padStart(2,'0');}

function chatDailyDigestDayKey(ts){
  if(!(Number(ts)>0))return '';
  var d=new Date(Number(ts)+8*3600000);
  return isNaN(d.getTime())?'':d.toISOString().slice(0,10);
}

function chatDigestValidDay(day){
  if(!/^\d{4}-\d{2}-\d{2}$/.test(String(day||'')))return false;
  var d=new Date(day+'T12:00:00+08:00');
  return chatDailyDigestDayKey(d.getTime())===day;
}

function chatDigestShiftDay(day,offset){
  if(!chatDigestValidDay(day))return '';
  var d=new Date(day+'T12:00:00+08:00');d.setUTCDate(d.getUTCDate()+Number(offset||0));
  return chatDailyDigestDayKey(d.getTime());
}

function chatDailyDigestClock(ts){
  var d=new Date((Number(ts)||0)+8*3600000);
  return Number(ts)>0&&!isNaN(d.getTime())?chatDailyDigestPad2(d.getUTCHours())+':'+chatDailyDigestPad2(d.getUTCMinutes()):'??:??';
}

function chatDailyDigestRangeLabel(entry){
  entry=entry||{};
  var start=chatDailyDigestDayKey(entry.startTs),end=chatDailyDigestDayKey(entry.endTs);
  return (start||entry.dayKey||'日期未知')+' '+chatDailyDigestClock(entry.startTs)+'-'+(start!==end?end+' ':'')+chatDailyDigestClock(entry.endTs);
}

function chatDigestOmittedCoverage(list){
  var seen=new Set();return (Array.isArray(list)?list:[]).filter(function(row){
    if(!row||!chatDigestValidDay(row.day)||typeof row.key!=='string'||!row.key)return false;
    var key=row.day+':'+row.key;if(seen.has(key))return false;seen.add(key);return true;
  }).map(function(row){return {day:row.day,key:row.key}});
}

function chatDigestStamp(value){
  var text=typeof value==='string'?value:JSON.stringify(value),a=2166136261,b=5381;
  for(var i=0;i<text.length;i++){a=Math.imul(a^text.charCodeAt(i),16777619);b=Math.imul(b,33)^text.charCodeAt(i);}
  return text.length+':'+(a>>>0).toString(36)+':'+(b>>>0).toString(36);
}

function chatNormalizeDigestRollup(value){
  if(!value||typeof value!=='object'||!chatDigestValidDay(value.start)||!chatDigestValidDay(value.end))return null;
  return {start:value.start,end:value.end,text:String(value.text||''),source:String(value.source||''),updatedAt:Number(value.updatedAt)||0,edited:value.edited===true};
}

function chatDailyDigestFindSession(id){return (chatSessions||[]).find(function(s){return String(s.id)===String(id)})||null;}

function chatDailyDigestSetStatus(text,kind){
  var el=document.getElementById('chat-daily-digest-save-status');
  if(el){el.textContent=String(text||'');el.className='chat-cache-save-status'+(kind==='ok'?' ok':kind==='error'?' error':'');}
}

function chatDailyDigestEndpoint(cfg){return (cfg.gatewayUrl||GRAPH_API_BASE).trim().replace(/\/+$/,'').replace(/\/ck\/chat$/,'')+'/ck/chat-digest/prepare';}

function chatDailyDigestRequestMessages(list){
  var out=[];
  (Array.isArray(list)?list:[]).forEach(function(m){
    if(!m||!['user','assistant'].includes(m.role)||m.sendFailed||m.inFlight||(m.role==='assistant'&&m.stopped))return;
    var text=String(m.text||'');
    if(m.role==='assistant')text=String((chatSplitThinkingText(text,{suppressThinking:true,hideUnclosedThinking:true})||{}).text||'');
    if(!text.trim()&&Array.isArray(m.images)&&m.images.length)text='[发送了 '+m.images.length+' 张图片，文字记录不包含图片内容]';
    if(text.trim())out.push({role:m.role,text:text.trim(),ts:Number(m.ts)||0,turnId:String(m.turnId||m.turn_id||'')});
  });return out;
}

function chatDigestMessageGroups(list){
  var rows=chatDailyDigestRequestMessages(list),groups=CKChatHistory.localTurnGroups(rows);
  return groups.filter(function(g){return g.userMessages>0}).map(function(g){
    var messages=rows.slice(g.startIndex,g.endIndex),stamps=messages.map(function(m){return m.ts}).filter(function(t){return t>0});
    var end=stamps.length?Math.max.apply(null,stamps):Date.now();
    return {key:chatDigestStamp(messages),day:chatDailyDigestDayKey(end),start:stamps.length?Math.min.apply(null,stamps):end,end:end,messages:messages};
  });
}

function chatDigestConfigStamp(cfg){return JSON.stringify([cfg.panelKey,cfg.dailyDigestEnabled!==false,chatDigestOptions(cfg),cfg.digestCurrentModel===true]);}

async function chatAwaitTrimDigest(result,requestState){
  if(!result||!result.digestWait)return result;
  var start=Date.now(),poll=0;
  try{
    if(requestState)poll=setInterval(function(){if(requestState.stopped&&result.cancelDigest)result.cancelDigest()},100);
    var prepared=await result.digestWait;
    result.digestPrepared=prepared;result.digestWaited=prepared?'ok':'failed';
  }catch(error){result.digestWaited='failed';}
  finally{clearInterval(poll);}
  result.digestWaitMs=Date.now()-start;
  chatDebug('daily_digest_wait',{ok:result.digestWaited==='ok',outcome:result.digestWaited,wait_ms:result.digestWaitMs,trigger:result.trigger,dropped:result.dropped});return result;
}

function chatRefreshRollingDigest(cfg,options){
  return typeof chatSyncNightlyDigest==='function'?chatSyncNightlyDigest(cfg,options):Promise.resolve(false);
}

async function chatMaybeRollDigestAtDayBoundary(){
  if(chatDigestMaintenanceBusy||chatTrimBusy||chatTrimTransaction||!chatSessionsReady)return;
  var cfg=chatLoadConfig();
  if(cfg.digestCurrentModel===true&&chatSending){chatScheduleNightlySync(3000);return;}
  chatDigestMaintenanceBusy=true;
  if(typeof chatFlushDigestDeletes==='function')chatFlushDigestDeletes(cfg);
  try{
    for(var session of chatSessions.slice()){
      if(chatTrimBusy||chatTrimTransaction||chatDigestConfigStamp(cfg)!==chatDigestConfigStamp(chatLoadConfig())){chatScheduleNightlySync(1500);break;}
      if(typeof chatDigestReleaseCompletedRun==='function'&&chatDigestReleaseCompletedRun(session,cfg))chatSaveSessions({sessionIds:[session.id]});
      if(typeof chatDigestPendingSync==='function'&&chatDigestPendingSync(session,cfg)){
        await chatDigestFinishManualTrim(cfg,session);
        if(chatDigestPendingSync(session,cfg))continue;
      }
      await chatRefreshRollingDigest(cfg,{session:session,readOnly:cfg.digestCurrentModel===true&&chatDigestPollingDelay(session,cfg)===30000});
      if(typeof chatDigestFinishManualTrim==='function')await chatDigestFinishManualTrim(cfg,session);
    }
  }finally{chatDigestMaintenanceBusy=false;var pollDelay=chatDigestNextPollingDelay(cfg);if(pollDelay)chatScheduleNightlySync(pollDelay);}
}

function chatDigestCount(value){var n=Number(value);return Number.isInteger(n)&&n>=1&&n<=100?n:3;}
function chatDigestOptions(cfg){return {z:chatDigestCount((cfg||{}).digestCycleCount)};}
function chatDailyDigestNormalize(list){
  var seen=new Set();
  return (Array.isArray(list)?list:[]).filter(function(row){return row&&typeof row.text==='string'&&row.text.trim()}).map(function(row,index){
    var value=Object.assign({},row),id=String(row.id||'legacy-'+row.dayKey+'-'+index);
    value.id=id;value.text=row.text;value.dayKey=chatDigestValidDay(row.dayKey)?row.dayKey:chatDailyDigestDayKey(row.endTs||Date.now());
    value.covered=Array.from(new Set(Array.isArray(row.covered)?row.covered:[]));
    value.sequence=Math.max(0,Number(row.sequence)||0);value.active=row.active!==false;
    return value;
  }).filter(function(row){if(seen.has(row.id))return false;seen.add(row.id);return true});
}
function chatDigestMigrateCycles(session,cfg){
  if(!session||session.gameWindow)return false;
  if(typeof chatDigestReleaseCompletedRun==='function')chatDigestReleaseCompletedRun(session,cfg);
  var rows=chatDailyDigestNormalize(session.dailyDigests);
  if(rows.some(function(row){return row.kind==='cycle'}))return false;
  var run=session.digestModelRun,remote=(session.digestSchedule||{}).model_run;
  if(session.digestManualTrim||run||remote&&['queued','running'].includes(remote.state)||session.digestLastSync&&session.digestLastSync.status!=='synced')return false;
  var frozen=session.digestActivePack;
  if(!frozen||frozen.scope!==chatDigestActiveScope(cfg)||!String(frozen.text||'').trim())return false;
  var text=frozen.text,stamp=chatDigestStamp(text),covered=[];
  rows.forEach(function(row){covered.push.apply(covered,row.covered||[]);row.active=false;row.kind='legacy_archive'});
  var cycle={id:'cy-import-'+stamp,kind:'cycle',sequence:1,active:true,imported:true,
    text:text,dayKey:chatDailyDigestDayKey(frozen.at||Date.now()),createdAt:frozen.at||Date.now(),
    startTs:rows.length?Math.min.apply(null,rows.map(function(r){return r.startTs||r.endTs||Date.now()})):Date.now(),
    endTs:rows.length?Math.max.apply(null,rows.map(function(r){return r.endTs||Date.now()})):Date.now(),
    covered:Array.from(new Set(covered)),brief:null};
  if(session.digestRollup&&session.digestRollup.text)rows.push({id:'legacy-rollup-'+chatDigestStamp(session.digestRollup),kind:'legacy_archive',active:false,
    dayKey:cycle.dayKey,text:session.digestRollup.text,covered:[],sequence:0});
  session.dailyDigests=rows.concat(cycle);session.digestRollup=null;
  // Preserve the actual injected bytes until the next explicit history boundary.
  session.digestCycleMigration={version:1,firstId:cycle.id,source:stamp,at:Date.now()};
  delete session.digestStaged;delete session.digestPreparingBase;
  return true;
}
function chatDailyDigestEntries(session,day,cfg){
  session=session||chatCurrentSession();cfg=cfg||chatLoadConfig();
  return chatDailyDigestNormalize(session.dailyDigests).filter(function(row){return row.kind==='cycle'&&row.active!==false}).slice(-chatDigestOptions(cfg).z);
}
function chatDailyDigestPrune(session,day,cfg){
  var changed=chatDigestMigrateCycles(session,cfg||chatLoadConfig());
  return {changed:changed,entries:chatDailyDigestEntries(session,day,cfg)};
}
function chatDigestCycleText(row,latest){
  return latest?row.text:row.brief&&row.brief.source===chatDigestStamp(row.text)?row.brief.text:'';
}
function chatDailyDigestBlockText(row,latest){
  return '【第 '+row.sequence+' 次总结 · '+(latest?'详细':'简版')+'】\n'+chatDigestCycleText(row,latest);
}
function chatDailyDigestBuildPack(cfg,session){
  cfg=cfg||chatLoadConfig();session=session||chatCurrentSession();if(cfg.dailyDigestEnabled===false)return '';
  var rows=chatDailyDigestEntries(session,null,cfg);
  // The imported first injection is kept verbatim, including its existing headings.
  if(rows.length===1&&rows[0].imported)return rows[0].text;
  return rows.map(function(row,index){return chatDailyDigestBlockText(row,index===rows.length-1)}).join('\n\n');
}
function chatDailyDigestPack(cfg,session){
  cfg=cfg||chatLoadConfig();session=session||chatCurrentSession();if(cfg.dailyDigestEnabled===false)return '';
  return typeof chatDigestFreezePack==='function'?chatDigestFreezePack(cfg,session):chatDailyDigestBuildPack(cfg,session);
}
function chatDigestPackReady(cfg,session){
  if(chatDigestMigrationPending(session))return false;
  var rows=chatDailyDigestEntries(session,null,cfg);
  return rows.every(function(row,index){return index===rows.length-1||!!(row.brief&&row.brief.source===chatDigestStamp(row.text)&&row.brief.text)});
}
function chatDigestMigrationPending(session){
  var rows=chatDailyDigestNormalize(session.dailyDigests);
  return !rows.some(function(row){return row.kind==='cycle'})&&!!(rows.length||(session.digestRollup||{}).text||(session.digestActivePack||{}).text);
}
function chatDigestRetainCycles(entries,cfg){
  var rows=chatDailyDigestNormalize(entries),active=rows.filter(function(row){return row.kind==='cycle'&&row.active!==false});
  var kept=new Set(active.slice(-chatDigestOptions(cfg).z).map(function(row){return row.id}));
  return rows.map(function(row){return row.kind==='cycle'&&!kept.has(row.id)?Object.assign({},row,{active:false}):row});
}
function chatDigestCompactMemoryHistory(messages){
  return (messages||[]).map(function(message){
    if(!message||typeof message!=='object')return message;
    var value=Object.assign({},message);
    function clean(text){return text.replace(/<(ck_active_memory_(?:current|event))>[\s\S]*?<\/\1>/g,'')}
    if(typeof value.content==='string')value.content=clean(value.content);
    else if(Array.isArray(value.content))value.content=value.content.flatMap(function(block){
      if(!block||block.type!=='text'||typeof block.text!=='string')return [block];
      var text=clean(block.text);if(text===block.text)return [block];
      return text.trim()?[Object.assign({},block,{text:text})]:[];
    });
    if(value.content===message.content||Array.isArray(value.content)&&Array.isArray(message.content)&&value.content.length===message.content.length&&value.content.every(function(block,index){return block===message.content[index]}))return message;
    return value;
  });
}
function chatDigestEditorValue(kind,cfg,session){
  var rows=chatDailyDigestEntries(session,null,cfg);
  if(kind==='today')return rows.length?rows[rows.length-1].text:'';
  return rows.slice(0,-1).map(function(row){return chatDailyDigestBlockText(row,false)}).join('\n\n');
}
function chatDigestEditorChanged(kind){
  if(kind!=='today')return;
  var session=chatCurrentSession(),key=session.id+':today',node=document.getElementById('chat-digest-today');if(!node)return;
  if(!chatDigestEditors[key])chatDigestEditors[key]={base:chatDigestEditorValue('today',chatLoadConfig(),session)};
  chatDigestEditors[key].text=node.value;chatRenderDigestCounts();chatDailyDigestSetStatus('最新总结有未保存的修改。');
}
function chatRenderDigestCounts(){
  ['today','detail'].forEach(function(kind){var node=document.getElementById('chat-digest-'+kind),count=document.getElementById('chat-digest-'+kind+'-count');if(node&&count)count.textContent='当前 '+Array.from(node.value).length+' 字'});
  var pack=document.getElementById('chat-daily-digest-pack'),count=document.getElementById('chat-daily-digest-count');if(pack&&count)count.textContent='当前 '+Array.from(pack.value).length+' 字';
}
function chatRenderDailyDigest(cfg){
  cfg=cfg||chatLoadConfig();var session=chatCurrentSession();if(!session)return [];
  var state=chatDailyDigestPrune(session,null,cfg),rows=state.entries;
  if(state.changed)chatSaveSessions({sessionIds:[session.id]});
  chatSetFieldChecked('chat-daily-digest-enabled',cfg.dailyDigestEnabled!==false);
  chatSetFieldChecked('chat-digest-current-model',cfg.digestCurrentModel===true);
  if(!chatDigestSettingsDirty)chatSetFieldValue('chat-digest-cycle-count',chatDigestOptions(cfg).z);
  ['detail','today'].forEach(function(kind){if(!chatDigestEditors[session.id+':'+kind])chatSetFieldValue('chat-digest-'+kind,chatDigestEditorValue(kind,cfg,session))});
  chatSetFieldValue('chat-daily-digest-pack',chatDailyDigestPack(cfg,session));
  var hint=document.getElementById('chat-daily-digest-hint');if(hint)hint.textContent=cfg.dailyDigestEnabled===false?'已关闭总结注入，已保存的内容保留。':'当前保留 '+rows.length+' / '+chatDigestOptions(cfg).z+' 次：最新一份详细，其余为简版。更早内容留在归档。';
  var title=document.getElementById('chat-digest-latest-label');if(title)title.textContent=rows.length?'第 '+rows[rows.length-1].sequence+' 次总结 · 详细':'最新总结 · 详细';
  if(!chatDigestSettingsDirty)chatDigestValidateSettings(false);
  chatRenderDigestCounts();if(typeof chatRenderNightlyStatus==='function')chatRenderNightlyStatus(session);return rows;
}
function chatDigestValidateSettings(showError){
  var el=document.getElementById('chat-digest-cycle-count'),z=el&&el.value.trim()!==''?Number(el.value):NaN,valid=Number.isInteger(z)&&z>=1&&z<=100;
  var hint=document.getElementById('chat-digest-range-hint');if(hint){hint.classList.toggle('error',!valid);hint.textContent=valid?'保留最近 '+z+' 次总结；最新详细，其余简版。调整后在下一次截断或同步时生效。':'Z 请输入 1–100 的整数。'}
  if(!valid&&showError)toast('Z 请输入 1–100 的整数',5000);return valid?{z:z}:null;
}
function chatDigestSettingsEdited(){chatDigestSettingsDirty=true;chatDigestValidateSettings(false);}
function chatSaveDailyDigestSetting(auto){
  var cfg=chatLoadConfig(),before=chatDigestConfigStamp(cfg),values=auto?null:chatDigestValidateSettings(true);if(!auto&&!values)return null;
  chatSessions.forEach(function(session){chatDailyDigestPrune(session,null,cfg);chatDigestFreezePack(cfg,session)});
  if(values){cfg.digestCycleCount=values.z;chatDigestSettingsDirty=false;}
  delete cfg.dailyDigestRetentionDays;delete cfg.dailyDigestDetailDays;delete cfg.dailyDigestRollupDays;
  cfg.dailyDigestEnabled=chatFieldChecked('chat-daily-digest-enabled',cfg.dailyDigestEnabled!==false);
  cfg.digestCurrentModel=chatFieldChecked('chat-digest-current-model',cfg.digestCurrentModel===true);
  chatSaveConfigObject(cfg);chatRenderDailyDigest(cfg);chatSaveSessions();
  chatDailyDigestSetStatus('已保存 Z='+chatDigestOptions(cfg).z+'；下一次截断或同步时使用，保存设置不生成总结。','ok');
  if(before!==chatDigestConfigStamp(cfg))chatNightlySettingsPriority(cfg);else chatScheduleNightlySync(0);
  return cfg;
}
function chatSaveDigestEditor(kind){
  if(kind!=='today')return false;
  var cfg=chatLoadConfig(),session=chatCurrentSession(),key=session.id+':today',editor=chatDigestEditors[key],node=document.getElementById('chat-digest-today');
  var rows=chatDailyDigestNormalize(session.dailyDigests),active=rows.filter(function(row){return row.kind==='cycle'&&row.active!==false}),latest=active[active.length-1];
  if(!node||!latest)return false;
  if(editor&&editor.base!==latest.text){chatDailyDigestSetStatus('已保存的总结发生变化，编辑草稿已保留。','error');return false;}
  if(!node.value.trim()){chatDailyDigestSetStatus('不能用空白覆盖总结。','error');return false;}
  latest.text=node.value.trim();latest.brief=null;latest.edited=true;latest.imported=false;
  session.dailyDigests=rows;delete chatDigestEditors[key];chatDigestResetPack(cfg,session);chatSaveSessions();
  chatNightlyManualPriority(session);chatRenderDailyDigest(cfg);chatDailyDigestSetStatus('最新总结已保存。','ok');return true;
}
function chatResetDigestEditor(kind){delete chatDigestEditors[chatCurrentSession().id+':'+kind];chatRenderDailyDigest();}
function chatNewSessionDigestSource(cfg,preferred){
  var sources=(chatSessions||[]).filter(function(s){return String(s.title||'').trim()===CHAT_NEW_SESSION_DIGEST_SOURCE_TITLE&&chatDailyDigestEntries(s,null,cfg).length});
  if(preferred&&sources.some(function(s){return s.id===preferred.id}))return preferred;
  sources.sort(function(a,b){return (b.updated||b.created||0)-(a.updated||a.created||0)});return sources[0]||null;
}
function chatNewSessionDailyDigests(cfg,source){
  cfg=cfg||chatLoadConfig();if(cfg.newSessionDigestSyncEnabled===false)return [];
  (chatSessions||[]).forEach(function(session){chatDailyDigestPrune(session,null,cfg)});
  source=chatNewSessionDigestSource(cfg,source);return source?JSON.parse(JSON.stringify(chatDailyDigestEntries(source,null,cfg))):[];
}
function chatDigestPreparedTrim(session,cfg,plan){
  var groups=chatDigestPlanSources(session,plan),keys=new Set(groups.map(function(g){return g.key}));
  if(!groups.length||plan.canonicalTransport&&plan.transportDropped>groups.length)return null;
  var entries=chatDailyDigestNormalize(session.dailyDigests),covered=new Set();
  entries.forEach(function(e){(e.covered||[]).forEach(function(k){covered.add(k)})});
  chatDigestOmittedCoverage(session.digestOmittedCovered).forEach(function(r){covered.add(r.key)});
  var used=(session.digestReadyTrims||[]).filter(function(t){return t.kind==='cycle'&&t.keys.some(function(k){return keys.has(k)&&!covered.has(k)})&&t.keys.every(function(k){return keys.has(k)||covered.has(k)})});
  if(used.some(function(t){var m=t.memory||{};return t.memory_required&&(!m.decided||!m.confirmed_at||!m.model||
    !['keep','update'].includes(m.decision)||m.decision==='update'&&!m.saved&&!m.unchanged)}))return null;
  used.forEach(function(t){t.keys.forEach(function(k){covered.add(k)})});
  if(groups.some(function(g){return !covered.has(g.key)}))return null;
  used.forEach(function(t){if(!entries.some(function(e){return e.id===t.id}))entries.push({id:t.id,kind:'cycle',sequence:t.sequence,active:true,dayKey:chatDailyDigestDayKey(Date.now()),
    text:t.text,covered:t.keys.slice(),startTs:t.startTs,endTs:t.endTs,brief:null,memory:t.memory,createdAt:Date.now()})});
  entries=chatDigestRetainCycles(entries,cfg);
  var candidate=Object.assign({},session,{dailyDigests:entries});if(!chatDigestPackReady(cfg,candidate))return null;
  return {entries:entries,rollup:null,used:used,activePack:{scope:chatDigestActiveScope(cfg),config:chatDigestConfigStamp(cfg),text:chatDailyDigestBuildPack(cfg,candidate),at:Date.now()}};
}
async function chatRefreshDigestNow(){
  if(chatLoadConfig().dailyDigestEnabled===false){toast('请先启用截断总结');return false;}
  return chatRequestManualDigestTrim();
}

// Preserve saved pre-upgrade checkpoints for explicit window handoffs.
function chatDigestNormalizeWork(value){
  if(!value||value.version!==2||typeof value.context!=='string'||!Array.isArray(value.results))return null;
  return {version:2,context:value.context,results:value.results.filter(function(r){return r&&typeof r.key==='string'&&typeof r.text==='string'&&r.text.length<=200000}).slice(-400).map(function(r){return {key:r.key,text:r.text}})};
}
