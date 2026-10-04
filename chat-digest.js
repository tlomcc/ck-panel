/* Rolling summaries: the saved daily records are the source of every injection. */
var chatDailyDigestChain=Promise.resolve();
var chatDailyDigestLastError='';
var chatDigestEditors={};
var chatDigestSettingsDirty=false;
var chatDigestMaintenanceBusy=false;
var CHAT_DIGEST_BATCH_CHARS=12000;
var chatActiveDigestJob=null;
function chatDigestSafeError(error,cfg){
  var text=String(error&&error.message||error||'');
  if(cfg&&cfg.panelKey)text=text.split(cfg.panelKey).join('[redacted]');
  return text.replace(/https?:\/\/[^\s)]+/gi,'[接口地址]').replace(/(?:bearer\s+|(?:api[_ -]?key|token|password|authorization)\s*[:=]\s*)[^\s,;，；}]+|\bsk-[\w-]{8,}/gi,'[redacted]').slice(0,500);
}
function chatDigestLog(event,data){
  chatDebug(event,data);
  if(typeof chatFlushDebugSave==='function')chatFlushDebugSave();
}
function chatDigestBatchInfo(job,body){
  return {session_id:job.sessionId,trigger:job.trigger||'',mode:body.mode,tier:body.tier||'',day_key:body.day_key||'',
    batch:job.batchIndex||1,batches:job.batchCount||1,input_messages:Array.isArray(body.messages)?body.messages.length:0,
    input_chars:Array.isArray(body.messages)?body.messages.reduce(function(n,m){return n+String(m.text||'').length},0):0,source_chars:String(body.text||'').length};
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
function chatDigestNormalizeWork(value){
  if(!value||value.version!==2||typeof value.context!=='string'||!Array.isArray(value.results))return null;
  return {version:2,context:value.context,results:value.results.filter(function(r){return r&&typeof r.key==='string'&&typeof r.text==='string'&&r.text.length<=200000}).slice(-400).map(function(r){return {key:r.key,text:r.text}})};
}
function chatDigestWorkContext(cfg,session){
  return chatDigestStamp([2,cfg.gatewayUrl,chatDigestConfigStamp(cfg),typeof apiProviders==='object'?[apiProviders.chat_digest,apiProviders.provider_library]:null,chatDailyDigestNormalize(session.dailyDigests),chatNormalizeDigestRollup(session.digestRollup),chatDigestOmittedCoverage(session.digestOmittedCovered)]);
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
function chatDigestTierText(entry,tier){
  var compact=entry&&entry[tier];
  return compact&&compact.source===chatDigestStamp(entry.text)?compact.text:entry.text;
}
function chatDigestDetailsFresh(cfg,session){
  var today=chatDailyDigestDayKey(Date.now()),range=chatDigestRange(cfg,today);
  return chatDailyDigestEntries(session,today,cfg).filter(function(row){return row.dayKey>=range.start&&row.dayKey<today}).every(function(row){return row.detail&&row.detail.source===chatDigestStamp(row.text)});
}

function chatDailyDigestRetentionDays(value){
  var n=Number(value);
  return isFinite(n)&&n>0?Math.max(1,Math.min(100,Math.floor(n))):7;
}
function chatDigestOptions(cfg){
  cfg=cfg||{};
  var n=chatDailyDigestRetentionDays(cfg.dailyDigestRetentionDays);
  var x=cfg.dailyDigestDetailDays==null?Math.min(3,n):Number(cfg.dailyDigestDetailDays);
  x=isFinite(x)?Math.max(0,Math.min(n,Math.floor(x))):Math.min(3,n);
  var y=cfg.dailyDigestRollupDays==null?n-x:Number(cfg.dailyDigestRollupDays);
  y=isFinite(y)?Math.max(0,Math.min(n-x,Math.floor(y))):n-x;
  return {n:n,x:x,y:y};
}
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
function chatDailyDigestFirstDay(dayKey,days){return chatDigestShiftDay(dayKey,-chatDailyDigestRetentionDays(days));}
function chatDailyDigestClock(ts){
  var d=new Date((Number(ts)||0)+8*3600000);
  return Number(ts)>0&&!isNaN(d.getTime())?chatDailyDigestPad2(d.getUTCHours())+':'+chatDailyDigestPad2(d.getUTCMinutes()):'??:??';
}
function chatDailyDigestRangeLabel(entry){
  entry=entry||{};
  var start=chatDailyDigestDayKey(entry.startTs),end=chatDailyDigestDayKey(entry.endTs);
  return (start||entry.dayKey||'日期未知')+' '+chatDailyDigestClock(entry.startTs)+'-'+(start!==end?end+' ':'')+chatDailyDigestClock(entry.endTs);
}
function chatDailyDigestNormalize(list){
  var days={};
  (Array.isArray(list)?list:[]).slice().sort(function(a,b){return Number(a&&a.endTs||a&&a.end_ts||0)-Number(b&&b.endTs||b&&b.end_ts||0)}).forEach(function(row){
    if(!row||typeof row!=='object')return;
    var text=String(row.text||'').trim();if(!text)return;
    var end=Number(row.endTs!=null?row.endTs:row.end_ts)||0;
    var start=Number(row.startTs!=null?row.startTs:row.start_ts)||end;
    var day=chatDailyDigestDayKey(end)||String(row.dayKey||row.day_key||'');
    if(!chatDigestValidDay(day))return;
    if(!end)end=new Date(day+'T12:00:00+08:00').getTime();
    if(!start)start=end;
    var covered=Array.isArray(row.covered)?row.covered.filter(function(k){return typeof k==='string'}):[];
    if(days[day]){
      var old=days[day];
      old.text+='\n\n'+text;old.startTs=Math.min(old.startTs,start);old.endTs=Math.max(old.endTs,end);
      old.rounds+=Number(row.rounds)||0;old.mergedCount+=(Number(row.mergedCount)||0)+1;
      old.covered=Array.from(new Set(old.covered.concat(covered)));old.edited=old.edited||row.edited===true;
      old.detail=null;old.brief=null;
    }else days[day]={id:'dg-'+day,dayKey:day,kind:'daily',startTs:start,endTs:end,text:text,
      rounds:Number(row.rounds)||0,mergedCount:Number(row.mergedCount)||0,covered:Array.from(new Set(covered)),
      edited:row.edited===true,trigger:String(row.trigger||''),createdAt:Number(row.createdAt||row.created_at)||0,
      detail:row.detail&&typeof row.detail.text==='string'?{source:String(row.detail.source||''),text:row.detail.text}:null,
      brief:row.brief&&typeof row.brief.text==='string'?{source:String(row.brief.source||''),text:row.brief.text}:null};
  });
  return Object.keys(days).sort().map(function(day){return days[day]});
}
function chatDailyDigestKeepDay(list,dayKey){return chatDailyDigestNormalize(list).filter(function(row){return row.dayKey===dayKey});}
function chatDigestOmittedCoverage(list){
  var seen=new Set();return (Array.isArray(list)?list:[]).filter(function(row){
    if(!row||!chatDigestValidDay(row.day)||typeof row.key!=='string'||!row.key)return false;
    var key=row.day+':'+row.key;if(seen.has(key))return false;seen.add(key);return true;
  }).map(function(row){return {day:row.day,key:row.key}});
}
function chatDailyDigestEntries(session,dayKey,cfg){
  session=session||chatCurrentSession();cfg=cfg||chatLoadConfig();dayKey=dayKey||chatDailyDigestDayKey(Date.now());
  var first=chatDailyDigestFirstDay(dayKey,chatDigestOptions(cfg).n);
  return chatDailyDigestNormalize(session&&session.dailyDigests).filter(function(row){return row.dayKey>=first&&row.dayKey<=dayKey});
}
function chatDailyDigestPrune(session,dayKey,cfg){
  if(!session)return {changed:false,entries:[]};
  var kept=chatDailyDigestEntries(session,dayKey,cfg),changed=JSON.stringify(session.dailyDigests||[])!==JSON.stringify(kept);
  var today=dayKey||chatDailyDigestDayKey(Date.now()),first=chatDailyDigestFirstDay(today,chatDigestOptions(cfg||chatLoadConfig()).n);
  var omitted=chatDigestOmittedCoverage(session.digestOmittedCovered).filter(function(row){return row.day>=first&&row.day<=today});
  if(JSON.stringify(omitted)!==JSON.stringify(session.digestOmittedCovered||[])){session.digestOmittedCovered=omitted;changed=true;}
  if(changed)session.dailyDigests=kept;
  return {changed:changed,entries:kept};
}
function chatDailyDigestBlockText(entry){return '【'+entry.dayKey+'】\n'+entry.text;}
function chatDailyDigestDisplayText(entries){return (entries||[]).map(chatDailyDigestBlockText).join('\n\n');}
function chatDigestStamp(value){
  var text=typeof value==='string'?value:JSON.stringify(value),a=2166136261,b=5381;
  for(var i=0;i<text.length;i++){a=Math.imul(a^text.charCodeAt(i),16777619);b=Math.imul(b,33)^text.charCodeAt(i);}
  return text.length+':'+(a>>>0).toString(36)+':'+(b>>>0).toString(36);
}
function chatDigestRange(cfg,today){
  var options=chatDigestOptions(cfg);today=today||chatDailyDigestDayKey(Date.now());
  return {today:today,detailStart:chatDigestShiftDay(today,-options.x),start:chatDigestShiftDay(today,-options.x-options.y),end:chatDigestShiftDay(today,-options.x-1),n:options.n,x:options.x,y:options.y};
}
function chatNormalizeDigestRollup(value){
  if(!value||typeof value!=='object'||!chatDigestValidDay(value.start)||!chatDigestValidDay(value.end))return null;
  return {start:value.start,end:value.end,text:String(value.text||''),source:String(value.source||''),updatedAt:Number(value.updatedAt)||0,edited:value.edited===true};
}
function chatDigestRollupSource(cfg,session,today){
  var range=chatDigestRange(cfg,today),entries=chatDailyDigestEntries(session,range.today,cfg).filter(function(row){return range.y&&row.dayKey>=range.start&&row.dayKey<=range.end});
  var original=[range.start,range.end,entries.map(function(row){return [row.dayKey,row.text]})];
  return {range:range,entries:entries,stamp:chatDigestStamp(['per-day-1500-v2',original]),previousStamp:chatDigestStamp(['compact-v1',original]),legacyStamp:chatDigestStamp(original)};
}
function chatDigestRollupFresh(cfg,session,today){
  var source=chatDigestRollupSource(cfg,session,today),rollup=chatNormalizeDigestRollup(session&&session.digestRollup);
  return !source.range.y||!source.entries.length||!!(rollup&&rollup.start===source.range.start&&rollup.end===source.range.end&&(rollup.source===source.stamp||(rollup.edited&&(rollup.source===source.legacyStamp||rollup.source===source.previousStamp))));
}
function chatDigestRollupText(cfg,session){
  var source=chatDigestRollupSource(cfg,session),rollup=chatNormalizeDigestRollup(session&&session.digestRollup);
  if(!source.range.y||!source.entries.length)return '';
  // A failed compression must not erase older memories from the request. Until
  // retry succeeds, keep the source passages together under the exact range.
  var text=chatDigestRollupFresh(cfg,session)?rollup.text:source.entries.map(function(row){return row.text}).join('\n\n');
  return text?'【'+source.range.start+'-'+source.range.end+'】\n'+text:'';
}
function chatDailyDigestPack(cfg,session){
  cfg=cfg||chatLoadConfig();session=session||chatCurrentSession();
  if(cfg.dailyDigestEnabled===false)return '';
  var range=chatDigestRange(cfg),parts=[],rollup=chatDigestRollupText(cfg,session);
  if(rollup)parts.push(rollup);
  chatDailyDigestEntries(session,range.today,cfg).forEach(function(row){
    if(row.dayKey===range.today)parts.push(chatDailyDigestBlockText(row));
    else if(range.x&&row.dayKey>=range.detailStart&&row.dayKey<range.today)parts.push(chatDailyDigestBlockText(Object.assign({},row,{text:chatDigestTierText(row,'detail')})));
  });
  return parts.join('\n\n');
}
function chatNewSessionDigestSource(cfg,preferred){
  var sources=(chatSessions||[]).filter(function(s){return String(s.title||'').trim()===CHAT_NEW_SESSION_DIGEST_SOURCE_TITLE&&chatDailyDigestEntries(s,null,cfg).length});
  if(preferred&&sources.some(function(s){return s.id===preferred.id}))return preferred;
  sources.sort(function(a,b){return (b.updated||b.created||0)-(a.updated||a.created||0)});return sources[0]||null;
}
function chatNewSessionDailyDigests(cfg,source){
  cfg=cfg||chatLoadConfig();if(cfg.newSessionDigestSyncEnabled===false)return [];
  source=chatNewSessionDigestSource(cfg,source);return source?JSON.parse(JSON.stringify(chatDailyDigestEntries(source,null,cfg))):[];
}
function chatDailyDigestFindSession(id){return (chatSessions||[]).find(function(s){return String(s.id)===String(id)})||null;}
function chatDailyDigestSetStatus(text,kind){
  var el=document.getElementById('chat-daily-digest-save-status');
  if(el){el.textContent=String(text||'');el.className='chat-cache-save-status'+(kind==='ok'?' ok':kind==='error'?' error':'');}
}
function chatDigestEditorValue(kind,cfg,session){
  var today=chatDailyDigestDayKey(Date.now()),entries=chatDailyDigestEntries(session,today,cfg);
  if(kind==='rollup')return chatDigestRollupText(cfg,session);
  if(kind==='today')return (entries.find(function(row){return row.dayKey===today})||{}).text||'';
  return chatDailyDigestDisplayText(entries.filter(function(row){return row.dayKey<today}).map(function(row){return Object.assign({},row,{text:chatDigestTierText(row,'detail')})}));
}
function chatDigestEditorChanged(kind){
  var session=chatCurrentSession(),key=session.id+':'+kind,el=document.getElementById('chat-digest-'+kind);
  if(!el)return;
  if(!chatDigestEditors[key])chatDigestEditors[key]={base:chatDigestEditorValue(kind,chatLoadConfig(),session),day:chatDailyDigestDayKey(Date.now())};
  chatDigestEditors[key].text=el.value;chatRenderDigestCounts();chatDailyDigestSetStatus('有未保存的'+(kind==='today'?'当日总结':kind==='rollup'?'大总结':'详细总结')+'修改。');
}
function chatRenderDigestCounts(){
  ['detail','rollup','today'].forEach(function(kind){
    var el=document.getElementById('chat-digest-'+kind),count=document.getElementById('chat-digest-'+kind+'-count');
    if(el&&count)count.textContent=(kind==='today'?chatDailyDigestDayKey(Date.now())+' · ':'')+'当前 '+Array.from(el.value).length+' 字';
  });
  var pack=document.getElementById('chat-daily-digest-pack'),count=document.getElementById('chat-daily-digest-count');
  if(pack&&count)count.textContent='当前 '+Array.from(pack.value).length+' 字';
}
function chatRenderDailyDigest(cfg){
  cfg=cfg||chatLoadConfig();var session=chatCurrentSession(),pruned=chatDailyDigestPrune(session,null,cfg),range=chatDigestRange(cfg);
  if(pruned.changed&&chatSessionsReady)chatSaveSessions();
  ['detail','rollup','today'].forEach(function(kind){
    var editor=chatDigestEditors[session.id+':'+kind];
    chatSetFieldValue('chat-digest-'+kind,editor?editor.text:chatDigestEditorValue(kind,cfg,session));
  });
  chatSetFieldValue('chat-daily-digest-pack',chatDailyDigestPack(cfg,session));
  chatSetFieldChecked('chat-daily-digest-enabled',cfg.dailyDigestEnabled!==false);
  if(!chatDigestSettingsDirty){
    chatSetFieldValue('chat-daily-digest-retention-days',range.n);chatSetFieldValue('chat-digest-detail-days',range.x);chatSetFieldValue('chat-digest-rollup-days',range.y);
  }
  var hint=document.getElementById('chat-daily-digest-hint');
  if(hint)hint.textContent=cfg.dailyDigestEnabled===false?'已关闭：保留已有总结，不生成也不注入。':'注入顺序：'+range.y+' 天大总结 → '+range.x+' 天详细总结 → 当日新总结；直接读取已保存的内容。';
  var detail=document.getElementById('chat-digest-detail-hint');
  if(detail)detail.textContent='x 每天最多2500字，y 每天最多1500字，都不凑字；当天不设字数预算。滚动范围：'+chatDigestShiftDay(range.today,-range.n)+' 至 '+chatDigestShiftDay(range.today,-1)+'。每天一条，表头固定为【YYYY-MM-DD】；跨日内容归入结束日期。';
  var roll=document.getElementById('chat-digest-rollup-hint'),fresh=chatDigestRollupFresh(cfg,session),rollSource=chatDigestRollupSource(cfg,session);
  var rollSaved=chatNormalizeDigestRollup(session.digestRollup);
  if(roll)roll.textContent=!range.y?'y=0，不注入大总结。':('合并范围：'+range.start+' 至 '+range.end+'。'+(!rollSource.entries.length?'范围内暂无摘要，无需压缩。':fresh?
    (rollSaved.edited?'使用手工保存的总结：':'已压缩：')+rollSource.entries.reduce(function(n,row){return n+Array.from(row.text).length},0)+' → '+Array.from(rollSaved.text).length+' 字。':
    '尚未完成压缩，实际注入暂用这些日期的原摘要；生成成功后替换。'));
  if(!chatDigestSettingsDirty)chatDigestValidateSettings(false);
  chatRenderDigestCounts();if(typeof chatRenderNightlyStatus==='function')chatRenderNightlyStatus(session);return pruned.entries;
}
function chatDigestValidateSettings(showError){
  var ids=['chat-daily-digest-retention-days','chat-digest-detail-days','chat-digest-rollup-days'];
  var values=ids.map(function(id){var el=document.getElementById(id);return el&&el.value.trim()!==''?Number(el.value):NaN});
  var n=values[0],x=values[1],y=values[2],valid=values.every(Number.isInteger)&&n>=1&&n<=100&&x>=0&&y>=0&&x+y<=n;
  var hint=document.getElementById('chat-digest-range-hint');
  if(hint){hint.classList.toggle('error',!valid);hint.textContent=valid?'保留过去 '+n+' 天；最近 '+x+' 天逐日注入，之前 '+y+' 天合并注入。今天另算。':'请输入整数：1 ≤ n ≤ 100，x、y ≥ 0，且 x + y ≤ n。';}
  if(!valid&&showError)toast('总结天数无效：x + y 必须小于或等于 n',5000);
  return valid?{n:n,x:x,y:y}:null;
}
function chatDigestSettingsEdited(){chatDigestSettingsDirty=true;chatDigestValidateSettings(false);}
function chatSaveDailyDigestSetting(auto){
  var cfg=chatLoadConfig(),values=auto?null:chatDigestValidateSettings(true);
  if(!auto&&!values)return null;
  if(values){cfg.dailyDigestRetentionDays=values.n;cfg.dailyDigestDetailDays=values.x;cfg.dailyDigestRollupDays=values.y;chatDigestSettingsDirty=false;}
  cfg.dailyDigestEnabled=chatFieldChecked('chat-daily-digest-enabled',cfg.dailyDigestEnabled!==false);
  chatSaveConfigObject(cfg);chatRenderDailyDigest(cfg);chatDailyDigestSetStatus('总结设置已保存','ok');
  if(!auto)toast('总结设置已保存');
  if(cfg.dailyDigestEnabled!==false){chatDailyDigestSetStatus('已保存：每天04:00后台更新，失败重试到07:00。','ok');}
  else chatDailyDigestSetStatus('设置已保存：总结已关闭，不生成也不注入。','ok');
  chatNightlySettingsPriority(cfg);
  return cfg;
}
function chatDigestParseDays(raw,first,last){
  var entries=[],day='',lines=[],error='';
  function finish(){if(!day)return;var text=lines.join('\n').trim();if(text)entries.push({dayKey:day,text:text});}
  String(raw||'').replace(/\r\n?/g,'\n').split('\n').forEach(function(line){
    var match=/^【(\d{4}-\d{2}-\d{2})】\s*$/.exec(line);
    if(match){finish();day=match[1];lines=[];if(!chatDigestValidDay(day)||day<first||day>last)error='日期必须在 '+first+' 至 '+last+' 之间。';}
    else if(/^【.*】\s*$/.test(line))error='日期表头必须严格使用【YYYY-MM-DD】。';
    else if(!day&&line.trim())error='每条详细总结必须先写【YYYY-MM-DD】日期表头。';
    else lines.push(line);
  });finish();
  if(new Set(entries.map(function(row){return row.dayKey})).size!==entries.length)error='同一天只能有一条详细总结。';
  return {entries:entries,error:error};
}
function chatSaveDigestEditor(kind){
  var cfg=chatLoadConfig(),session=chatCurrentSession(),key=session.id+':'+kind,editor=chatDigestEditors[key];
  var el=document.getElementById('chat-digest-'+kind);if(!el)return false;
  var range=chatDigestRange(cfg),entries=chatDailyDigestEntries(session,null,cfg),raw=el.value.trim(),error='';
  if(editor&&(editor.day!==range.today||editor.base!==chatDigestEditorValue(kind,cfg,session)))error='日期或已保存内容已更新，草稿仍保留。请先复制草稿，再放弃修改以查看最新内容。';
  var next=entries;
  if(!error&&kind==='detail'){
    var parsed=chatDigestParseDays(raw,chatDigestShiftDay(range.today,-range.n),chatDigestShiftDay(range.today,-1));error=parsed.error;
    if(!error)next=entries.filter(function(row){return row.dayKey===range.today}).concat(parsed.entries.map(function(row){
      var old=entries.find(function(item){return item.dayKey===row.dayKey});
      return Object.assign({},old||{startTs:new Date(row.dayKey+'T12:00:00+08:00').getTime(),endTs:new Date(row.dayKey+'T12:00:00+08:00').getTime()},row,{edited:true});
    }));
  }else if(!error&&kind==='today'){
    var header='【'+range.today+'】';if(raw.startsWith(header))raw=raw.slice(header.length).trim();
    if(/^【\d{4}-\d{2}-\d{2}】/m.test(raw))error='当日框只保存 '+range.today+' 的正文；其他日期请在详细总结框编辑。';
    if(!error){next=entries.filter(function(row){return row.dayKey!==range.today});if(raw)next.push(Object.assign({},entries.find(function(row){return row.dayKey===range.today})||{startTs:Date.now(),endTs:Date.now(),dayKey:range.today},{text:raw,edited:true}));}
  }else if(!error&&kind==='rollup'){
    var source=chatDigestRollupSource(cfg,session),header='【'+range.start+'-'+range.end+'】';
    if(!range.y)error='y=0 时不需要大总结。';
    else if(raw&&!raw.startsWith(header))error='大总结表头必须是 '+header+'。';
    else{raw=raw.slice(header.length).trim();if(/^【\d{4}-\d{2}-\d{2}/m.test(raw))error='y 天应合成一段，只保留一个日期区间表头。';}
    if(!error)session.digestRollup={start:range.start,end:range.end,text:raw,source:source.stamp,updatedAt:Date.now(),edited:true};
  }
  if(error){chatDailyDigestSetStatus(error,'error');toast(error,6000);return false;}
  if(kind!=='rollup'){
    var keptDays=new Set(next.filter(function(row){return String(row.text||'').trim()}).map(function(row){return row.dayKey}));
    var omitted=entries.filter(function(row){return !keptDays.has(row.dayKey)}).flatMap(function(row){return (row.covered||[]).map(function(key){return {day:row.dayKey,key:key}})});
    session.digestOmittedCovered=chatDigestOmittedCoverage((session.digestOmittedCovered||[]).concat(omitted));
  }
  session.dailyDigests=chatDailyDigestNormalize(next);session.updated=Date.now();session.digestRetryAfter=0;
  if(typeof chatNightlyManualPriority==='function')chatNightlyManualPriority(session);
  delete chatDigestEditors[key];chatSaveSessions();chatRenderDailyDigest(cfg);chatDailyDigestSetStatus('总结已保存，下一轮使用已保存内容。','ok');toast('总结已保存');
  if(typeof chatScheduleNightlySync==='function')chatScheduleNightlySync();
  return true;
}
function chatResetDigestEditor(kind){delete chatDigestEditors[chatCurrentSession().id+':'+kind];chatRenderDailyDigest();chatDailyDigestSetStatus('已恢复为当前保存的内容。','ok');}
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
function chatDigestConfigStamp(cfg){return JSON.stringify([cfg.panelKey,cfg.dailyDigestEnabled!==false,chatDigestOptions(cfg)]);}
function chatDigestPreparedStillValid(session,prepared,cfg){
  return !!(session&&prepared&&prepared.source===JSON.stringify(session.dailyDigests||[])&&prepared.omittedBefore===JSON.stringify(session.digestOmittedCovered||[])&&prepared.rollupBefore===JSON.stringify(session.digestRollup||null)&&prepared.config===chatDigestConfigStamp(cfg||chatLoadConfig()));
}
async function chatDigestRequestApi(cfg,job,body){
  if(job.cancelled)throw new Error('总结已取消');
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
function chatDigestMessageChunks(groups){
  var chunks=[],current=[],chars=0;
  groups.forEach(function(group){group.messages.forEach(function(message){
    for(var offset=0;offset<message.text.length;offset+=CHAT_DIGEST_BATCH_CHARS-128){
      var part=Object.assign({},message,{text:message.text.slice(offset,offset+CHAT_DIGEST_BATCH_CHARS-128),digestOffset:offset});
      if(chars+part.text.length+64>CHAT_DIGEST_BATCH_CHARS&&current.length){chunks.push(current);current=[];chars=0;}
      current.push(part);chars+=part.text.length+64;
    }
  });});if(current.length)chunks.push(current);return chunks;
}
async function chatDigestCompactDay(cfg,job,entry,tier){
  var field=tier==='x'?'detail':'brief',stamp=chatDigestStamp(entry.text),saved=entry[field];
  if(saved&&saved.source===stamp&&!(tier==='y'&&job.forceRollup))return saved.text;
  var source=tier==='y'?chatDigestTierText(entry,'detail'):entry.text,text='';
  var count=Math.ceil(source.length/CHAT_DIGEST_BATCH_CHARS);
  for(var offset=0;offset<source.length;offset+=CHAT_DIGEST_BATCH_CHARS){
    job.stage=tier==='x'?'detail':'rollup';job.range=entry.dayKey;job.batchMessages=null;
    job.batchIndex=Math.floor(offset/CHAT_DIGEST_BATCH_CHARS)+1;job.batchCount=count;
    chatDailyDigestSetStatus('正在整理 '+entry.dayKey+' 的 '+tier+' 摘要（'+(Math.floor(offset/CHAT_DIGEST_BATCH_CHARS)+1)+'/'+count+'）；已完成批次会保留…');
    var data=await chatDigestCheckpointApi(cfg,job,{mode:'compact_day',tier:tier,day_key:entry.dayKey,text:source.slice(offset,offset+CHAT_DIGEST_BATCH_CHARS),previous_summary:text});
    text=String(data.text).trim();
  }
  entry[field]={source:stamp,text:text};return text;
}
async function chatDigestPrepareRollup(cfg,job,session,entries){
  var virtual={dailyDigests:entries,digestRollup:session.digestRollup},source=chatDigestRollupSource(cfg,virtual),range=source.range;
  if(!range.y)return session.digestRollup||null;
  if(!job.forceRollup&&chatDigestRollupFresh(cfg,virtual)&&source.entries.length)return session.digestRollup;
  var parts=[];
  for(var entry of entries.filter(function(row){return row.dayKey>=range.start&&row.dayKey<=range.end})){
    var text=await chatDigestCompactDay(cfg,job,entry,'y');
    if(text)parts.push(entry.dayKey+'：'+text);
  }
  return {start:range.start,end:range.end,text:parts.join('\n\n'),source:source.stamp,updatedAt:Date.now(),edited:false};
}
async function chatDailyDigestRequest(cfg,job){
  job=job||{};cfg=Object.assign({},chatLoadConfig());var session=chatDailyDigestFindSession(job.sessionId);
  if(!session||cfg.dailyDigestEnabled===false||job.cancelled)return null;
  var source=JSON.stringify(session.dailyDigests||[]),rollupBefore=JSON.stringify(session.digestRollup||null),entries=chatDailyDigestEntries(session,null,cfg);
  var omittedBefore=JSON.stringify(session.digestOmittedCovered||[]);
  var range=chatDigestRange(cfg),first=chatDigestShiftDay(range.today,-range.n),groups=chatDigestMessageGroups(job.messages||[]),covered=new Set();
  entries.forEach(function(row){(row.covered||[]).forEach(function(key){covered.add(key)})});
  chatDigestOmittedCoverage(session.digestOmittedCovered).forEach(function(row){covered.add(row.key)});
  groups=groups.filter(function(g){return g.day>=first&&g.day<=range.today&&!covered.has(g.key)});
  var days={};groups.forEach(function(g){(days[g.day]||(days[g.day]=[])).push(g)});
  chatSetActiveDigestJob(job);
  try{
    for(var day of Object.keys(days).sort()){
      var batches=chatDigestMessageChunks(days[day]),entry=entries.find(function(row){return row.dayKey===day}),previousRounds=entry?entry.rounds||0:0;
      for(var index=0;index<batches.length;index++){
        job.stage='daily';job.range=day;job.batchMessages=batches[index].length;
        job.batchIndex=index+1;job.batchCount=batches.length;
        chatDailyDigestSetStatus('正在更新 '+day+' 的当日记录（'+(index+1)+'/'+batches.length+'）；完成进度会保留…');
        var stamps=batches[index].map(function(row){return row.ts}).filter(function(ts){return ts>0});
        var end=stamps.length?Math.max.apply(null,stamps):Date.now(),start=stamps.length?Math.min.apply(null,stamps):end;
        var data=await chatDigestCheckpointApi(cfg,job,{mode:'daily_part',messages:batches[index],day_key:day});
        var text=(entry?entry.text+'\n\n':'')+String(data.text).trim();
        entry={id:'dg-'+day,dayKey:day,kind:'daily',text:text,startTs:entry?Math.min(entry.startTs,start):start,endTs:Math.max(end,new Date(day+'T00:00:00+08:00').getTime(),entry?entry.endTs:0),
          covered:entry?entry.covered||[]:[],rounds:(entry?entry.rounds:0)+batches[index].filter(function(row){return row.role==='user'}).length,
          mergedCount:(entry?entry.mergedCount:0)+1,trigger:job.trigger||'daily_rollover',createdAt:Date.now()};
      }
      entry.rounds=previousRounds+days[day].length;
      entry.covered=Array.from(new Set((entry.covered||[]).concat(days[day].map(function(g){return g.key}))));
      entries=entries.filter(function(row){return row.dayKey!==day});entries.push(entry);entries=chatDailyDigestNormalize(entries);
    }
    for(var entry of entries.filter(function(row){return row.dayKey>=range.start&&row.dayKey<range.today})){
      await chatDigestCompactDay(cfg,job,entry,'x');
    }
    var rollup=await chatDigestPrepareRollup(cfg,job,session,entries);
    if(job.cancelled)return null;
    return {entries:entries,rollup:rollup,source:source,omittedBefore:omittedBefore,rollupBefore:rollupBefore,config:chatDigestConfigStamp(cfg),day:range.today};
  }catch(error){
    job.failureReason=chatDigestSafeError(error,cfg);chatDailyDigestLastError=job.failureReason;
    var label=job.stage==='rollup'?'y 天大总结压缩':job.stage==='detail'?'x 每日摘要压缩':job.trigger==='daily_rollover'?'跨日补总结':job.trigger==='daily_update'?'手动当日总结':'截断前总结';
    job.failureReason=label+'（'+(job.range||'日期未知')+'）失败：'+job.failureReason;
    chatDailyDigestSetStatus(job.failureReason+'；原内容已保留。','error');chatDigestLog('daily_digest',{ok:false,error:job.failureReason,stage:job.stage,trigger:job.trigger,range:job.range,messages:job.batchMessages,request_id:job.lastRequestId});return null;
  }finally{if(chatActiveDigestJob===job)chatSetActiveDigestJob(null);}
}
function chatDailyDigestScheduleForTrim(cfg,plan,job){
  if(cfg.dailyDigestEnabled===false)return null;
  job=Object.assign(job||{},{messages:plan.droppedMessages||[],sessionId:(plan.session||chatCurrentSession()).id,trigger:plan.trigger||'auto_trim'});
  var task=chatDailyDigestChain.then(function(){return chatDailyDigestRequest(cfg,job)});
  chatDailyDigestChain=task.catch(function(){return null});return task;
}
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
  if(chatDigestMaintenanceBusy||chatSending||chatTrimBusy||chatTrimTransaction||!chatSessionsReady||document.hidden)return;
  var cfg=chatLoadConfig();
  chatDigestMaintenanceBusy=true;
  try{
    for(var session of chatSessions.slice()){
      if(chatSending||chatTrimBusy||chatTrimTransaction||chatDigestConfigStamp(cfg)!==chatDigestConfigStamp(chatLoadConfig())){chatScheduleNightlySync(1500);break;}
      await chatRefreshRollingDigest(cfg,{session:session});
    }
  }finally{chatDigestMaintenanceBusy=false;}
}
async function chatRefreshDigestNow(kind){
  if(chatLoadConfig().dailyDigestEnabled===false){toast('请先启用截断总结');return false;}
  return chatSyncNightlyDigest(chatLoadConfig(),{notify:true});
}
