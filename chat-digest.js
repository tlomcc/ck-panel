/* Rolling summaries: the saved daily records are the source of every injection. */
var chatDailyDigestChain=Promise.resolve();
var chatDailyDigestLastError='';
var chatDigestEditors={};
var chatDigestSettingsDirty=false;
var chatDigestMaintenanceBusy=false;

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
  var d=new Date(Number(ts));
  return isNaN(d.getTime())?'':d.getFullYear()+'-'+chatDailyDigestPad2(d.getMonth()+1)+'-'+chatDailyDigestPad2(d.getDate());
}
function chatDigestValidDay(day){
  if(!/^\d{4}-\d{2}-\d{2}$/.test(String(day||'')))return false;
  var d=new Date(day+'T12:00:00');
  return chatDailyDigestDayKey(d.getTime())===day;
}
function chatDigestShiftDay(day,offset){
  if(!chatDigestValidDay(day))return '';
  var d=new Date(day+'T12:00:00');d.setDate(d.getDate()+Number(offset||0));
  return chatDailyDigestDayKey(d.getTime());
}
function chatDailyDigestFirstDay(dayKey,days){return chatDigestShiftDay(dayKey,-chatDailyDigestRetentionDays(days));}
function chatDailyDigestClock(ts){
  var d=new Date(Number(ts)||0);
  return Number(ts)>0&&!isNaN(d.getTime())?chatDailyDigestPad2(d.getHours())+':'+chatDailyDigestPad2(d.getMinutes()):'??:??';
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
    if(!end)end=new Date(day+'T12:00:00').getTime();
    if(!start)start=end;
    var covered=Array.isArray(row.covered)?row.covered.filter(function(k){return typeof k==='string'}):[];
    if(days[day]){
      var old=days[day];
      old.text+='\n\n'+text;old.startTs=Math.min(old.startTs,start);old.endTs=Math.max(old.endTs,end);
      old.rounds+=Number(row.rounds)||0;old.mergedCount+=(Number(row.mergedCount)||0)+1;
      old.covered=Array.from(new Set(old.covered.concat(covered)));old.edited=old.edited||row.edited===true;
    }else days[day]={id:'dg-'+day,dayKey:day,kind:'daily',startTs:start,endTs:end,text:text,
      rounds:Number(row.rounds)||0,mergedCount:Number(row.mergedCount)||0,covered:Array.from(new Set(covered)),
      edited:row.edited===true,trigger:String(row.trigger||''),createdAt:Number(row.createdAt||row.created_at)||0};
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
  return {range:range,entries:entries,stamp:chatDigestStamp(['compact-v1',original]),legacyStamp:chatDigestStamp(original)};
}
function chatDigestRollupFresh(cfg,session,today){
  var source=chatDigestRollupSource(cfg,session,today),rollup=chatNormalizeDigestRollup(session&&session.digestRollup);
  return !source.range.y||!source.entries.length||!!(rollup&&rollup.start===source.range.start&&rollup.end===source.range.end&&(rollup.source===source.stamp||(rollup.edited&&rollup.source===source.legacyStamp)));
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
    if(row.dayKey===range.today||(range.x&&row.dayKey>=range.detailStart&&row.dayKey<range.today))parts.push(chatDailyDigestBlockText(row));
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
  return chatDailyDigestDisplayText(entries.filter(function(row){return row.dayKey<today}));
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
  if(detail)detail.textContent='滚动范围：'+chatDigestShiftDay(range.today,-range.n)+' 至 '+chatDigestShiftDay(range.today,-1)+'。每天一条，表头固定为【YYYY-MM-DD】；跨日内容归入结束日期。';
  var roll=document.getElementById('chat-digest-rollup-hint'),fresh=chatDigestRollupFresh(cfg,session),rollSource=chatDigestRollupSource(cfg,session);
  var rollSaved=chatNormalizeDigestRollup(session.digestRollup);
  if(roll)roll.textContent=!range.y?'y=0，不注入大总结。':('合并范围：'+range.start+' 至 '+range.end+'。'+(!rollSource.entries.length?'范围内暂无摘要，无需压缩。':fresh?
    (rollSaved.edited?'使用手工保存的总结：':'已压缩：')+rollSource.entries.reduce(function(n,row){return n+Array.from(row.text).length},0)+' → '+Array.from(rollSaved.text).length+' 字。':
    '尚未完成压缩，实际注入暂用这些日期的原摘要；生成成功后替换。'));
  if(!chatDigestSettingsDirty)chatDigestValidateSettings(false);
  chatRenderDigestCounts();return pruned.entries;
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
  if(cfg.dailyDigestEnabled!==false){chatDailyDigestSetStatus('设置已保存，正在检查并更新总结…');chatRefreshRollingDigest(cfg,{force:true,notify:true});}
  else chatDailyDigestSetStatus('设置已保存：总结已关闭，不生成也不注入。','ok');
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
      return Object.assign({},old||{startTs:new Date(row.dayKey+'T12:00:00').getTime(),endTs:new Date(row.dayKey+'T12:00:00').getTime()},row,{edited:true});
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
  delete chatDigestEditors[key];chatSaveSessions();chatRenderDailyDigest(cfg);chatDailyDigestSetStatus('总结已保存，下一轮使用已保存内容。','ok');toast('总结已保存');
  if(kind!=='rollup'&&cfg.dailyDigestEnabled!==false)chatRefreshRollingDigest(cfg,{force:true});
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
  try{
    var response=await Promise.race([aborted,fetch(chatDailyDigestEndpoint(cfg),{method:'POST',headers:{'Content-Type':'application/json'},signal:controller.signal,
      body:JSON.stringify(Object.assign({key:cfg.panelKey,session_id:job.sessionId,event_id:'dg-'+Date.now(),tz_offset_minutes:-new Date().getTimezoneOffset()},body))})]);
    var data=await Promise.race([aborted,response.json()]);
    if(job.cancelled)throw new Error('总结已取消');
    if(chatDigestConfigStamp(cfg)!==chatDigestConfigStamp(chatLoadConfig())||!chatDailyDigestFindSession(job.sessionId))throw new Error('设置或会话已变化，本次结果未写入');
    if(!response.ok||data.ok===false||data.prepared!==true||!String(data.text||'').trim())throw new Error(data.error||'总结接口未返回完整正文');
    if(data.salvaged||data.guard_trimmed)throw new Error('总结输出不完整，已保留原内容，请调整截断总结 API 后重试');
    return data;
  }catch(error){if(timedOut)throw new Error('总结接口超时（90 秒），原内容已保留');throw error;}
  finally{clearTimeout(timer);controller.signal.removeEventListener('abort',rejectAbort);if(job.controller===controller)job.controller=null;}
}
function chatDigestMessageChunks(groups){
  var chunks=[],current=[],chars=0;
  groups.forEach(function(group){group.messages.forEach(function(message){
    for(var offset=0;offset<message.text.length;offset+=45000){
      var part=Object.assign({},message,{text:message.text.slice(offset,offset+45000)});
      if(chars+part.text.length+64>50000&&current.length){chunks.push(current);current=[];chars=0;}
      current.push(part);chars+=part.text.length+64;
    }
  });});if(current.length)chunks.push(current);return chunks;
}
async function chatDigestPrepareRollup(cfg,job,session,entries){
  var virtual={dailyDigests:entries,digestRollup:session.digestRollup},source=chatDigestRollupSource(cfg,virtual),range=source.range;
  if(!range.y)return session.digestRollup||null;
  if(!job.forceRollup&&chatDigestRollupFresh(cfg,virtual)&&source.entries.length)return session.digestRollup;
  var text='',chunks=[],chunk=[],chars=0;
  source.entries.forEach(function(row){
    if(chars+row.text.length>50000&&chunk.length){chunks.push(chunk);chunk=[];chars=0;}
    // Summaries can be edited without a length limit; split long passages too.
    for(var offset=0;offset<row.text.length;offset+=45000){
      var part={day_key:row.dayKey,text:row.text.slice(offset,offset+45000)};
      if(chars+part.text.length>50000&&chunk.length){chunks.push(chunk);chunk=[];chars=0;}
      chunk.push(part);chars+=part.text.length;
    }
  });if(chunk.length)chunks.push(chunk);
  for(var i=0;i<chunks.length;i++){
    job.stage='rollup';job.range=range.start+' 至 '+range.end;job.batchMessages=null;
    chatDailyDigestSetStatus('正在生成 '+range.start+' 至 '+range.end+' 的大总结'+(chunks.length>1?'（'+(i+1)+'/'+chunks.length+'）':'')+'…');
    var data=await chatDigestRequestApi(cfg,job,{mode:'rolling_summary',reason:'rolling_summary',start_day:range.start,end_day:range.end,summaries:chunks[i],previous_summary:text});text=String(data.text).trim();
  }
  return {start:range.start,end:range.end,text:text,source:source.stamp,updatedAt:Date.now(),edited:false};
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
  try{
    for(var day of Object.keys(days).sort()){
      var batches=chatDigestMessageChunks(days[day]),entry=entries.find(function(row){return row.dayKey===day});
      for(var index=0;index<batches.length;index++){
        job.stage='daily';job.range=day;job.batchMessages=batches[index].length;
        chatDailyDigestSetStatus('正在更新 '+day+' 的详细总结…');
        var stamps=batches[index].map(function(row){return row.ts}).filter(function(ts){return ts>0});
        var end=stamps.length?Math.max.apply(null,stamps):Date.now(),start=stamps.length?Math.min.apply(null,stamps):end;
        var data=await chatDigestRequestApi(cfg,job,{messages:batches[index],previous:entry?[{start_ts:entry.startTs,end_ts:entry.endTs,text:entry.text,rounds:entry.rounds}]:[],reason:job.trigger||'daily_rollover',merge_mode:'end_date',day_key:day});
        var text=String(data.text).trim();if(entry&&data.merge_with_previous!==true)text=entry.text+'\n\n'+text;
        entry={id:'dg-'+day,dayKey:day,kind:'daily',text:text,startTs:entry?Math.min(entry.startTs,start):start,endTs:Math.max(end,new Date(day+'T00:00:00').getTime(),entry?entry.endTs:0),
          covered:entry?entry.covered||[]:[],rounds:(entry?entry.rounds:0)+batches[index].filter(function(row){return row.role==='user'}).length,
          mergedCount:(entry?entry.mergedCount:0)+1,trigger:job.trigger||'daily_rollover',createdAt:Date.now()};
      }
      entry.covered=Array.from(new Set((entry.covered||[]).concat(days[day].map(function(g){return g.key}))));
      entries=entries.filter(function(row){return row.dayKey!==day});entries.push(entry);entries=chatDailyDigestNormalize(entries);
    }
    var rollup=await chatDigestPrepareRollup(cfg,job,session,entries);
    if(job.cancelled)return null;
    return {entries:entries,rollup:rollup,source:source,omittedBefore:omittedBefore,rollupBefore:rollupBefore,config:chatDigestConfigStamp(cfg),day:range.today};
  }catch(error){
    job.failureReason=String(error&&error.message||error).slice(0,300);chatDailyDigestLastError=job.failureReason;
    var label=job.stage==='rollup'?'y 天大总结压缩':job.trigger==='daily_rollover'?'跨日补总结':job.trigger==='daily_update'?'手动当日总结':'截断前总结';
    job.failureReason=label+'（'+(job.range||'日期未知')+'）失败：'+job.failureReason;
    chatDailyDigestSetStatus(job.failureReason+'；原内容已保留。','error');chatDebug('daily_digest',{ok:false,error:job.failureReason,stage:job.stage,trigger:job.trigger,range:job.range,messages:job.batchMessages});return null;
  }
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
  cfg=cfg||chatLoadConfig();options=options||{};var session=options.session||chatCurrentSession(),today=chatDailyDigestDayKey(Date.now());
  if(!chatSessionsReady||cfg.dailyDigestEnabled===false||!session)return Promise.resolve(false);
  if(!options.force&&!options.includeToday&&session.digestCheckedDay===today&&chatDigestRollupFresh(cfg,session))return Promise.resolve(true);
  if(!options.force&&Number(session.digestRetryAfter)>Date.now())return Promise.resolve(false);
  var sessionId=session.id;
  var task=chatDailyDigestChain.then(async function(){
    session=chatDailyDigestFindSession(sessionId);if(!session)return false;
    var all=session===chatCurrentSession()?chatMessages:session.messages||[];
    var allowed=new Set(chatDigestMessageGroups(all).filter(function(g){return options.includeToday||g.day<today}).flatMap(function(g){return g.messages.map(function(m){return chatDigestStamp(m)})}));
    var raw=all.filter(function(m){return chatDailyDigestRequestMessages([m]).some(function(row){return allowed.has(chatDigestStamp(row))})});
    var snapshot=JSON.stringify(chatDailyDigestRequestMessages(raw));
    var job={sessionId:session.id,messages:raw,trigger:options.includeToday?'daily_update':'daily_rollover',forceRollup:options.forceRollup===true,cancelled:false};
    var poll=options.requestState?setInterval(function(){if(options.requestState.stopped){job.cancelled=true;if(job.controller)job.controller.abort()}},100):0;
    var prepared;
    try{prepared=await chatDailyDigestRequest(cfg,job);}finally{clearInterval(poll);}
    var current=chatDailyDigestFindSession(sessionId),currentMessages=current?(current===chatCurrentSession()?chatMessages:current.messages||[]):[];
    if(!job.cancelled&&current===session&&chatDigestPreparedStillValid(session,prepared)&&snapshot===JSON.stringify(chatDailyDigestRequestMessages(raw))&&raw.every(function(m){return currentMessages.includes(m)})){
      session.dailyDigests=prepared.entries;session.digestRollup=prepared.rollup;session.digestCheckedDay=prepared.day;session.digestRetryAfter=0;
      chatDailyDigestLastError='';chatSaveSessions();if(session===chatCurrentSession())chatRenderDailyDigest();
      var source=chatDigestRollupSource(cfg,session),rollup=chatNormalizeDigestRollup(session.digestRollup);
      var summary=!source.range.y?'y=0，无需压缩。':!source.entries.length?'y 范围内暂无摘要，无需压缩。':
        'y 天压缩已就绪：'+source.entries.reduce(function(n,row){return n+Array.from(row.text).length},0)+' → '+Array.from(rollup.text).length+' 字。';
      var todayEntry=prepared.entries.some(function(row){return row.dayKey===prepared.day});
      var notice='总结检查完成，实际注入内容已更新。'+summary+(todayEntry?'':' 今天暂无已生成总结，属正常状态。');
      chatDailyDigestSetStatus(notice,'ok');if(options.notify)toast(notice,7000);
      if(options.notify)chatDebug('daily_digest_refresh',{ok:true,message:notice});return true;
    }
    if(current===session){session.digestRetryAfter=Date.now()+3600000;chatSaveSessions();}
    if(options.force||options.requestState)toast(job.failureReason||'总结期间内容发生变化，原内容已保留。',6000);
    return false;
  });
  chatDailyDigestChain=task.catch(function(error){chatDailyDigestSetStatus('总结更新失败：'+String(error.message||error),'error');return false});
  return chatDailyDigestChain;
}
async function chatMaybeRollDigestAtDayBoundary(){
  if(chatDigestMaintenanceBusy||chatSending||chatTrimBusy||chatTrimTransaction||!chatSessionsReady||document.hidden)return;
  var cfg=chatLoadConfig();if(cfg.dailyDigestEnabled===false)return;
  chatDigestMaintenanceBusy=true;
  try{
    for(var session of chatSessions.slice()){
      if(chatSending||chatTrimBusy||chatTrimTransaction)break;
      await chatRefreshRollingDigest(cfg,{session:session});
    }
  }finally{chatDigestMaintenanceBusy=false;}
}
async function chatRefreshDigestNow(kind){
  if(chatSending||chatTrimBusy||chatTrimTransaction){toast('当前任务完成后再更新总结');return false;}
  if(chatLoadConfig().dailyDigestEnabled===false){toast('请先启用截断总结');return false;}
  var ok=await chatRefreshRollingDigest(chatLoadConfig(),{force:true,includeToday:kind==='today',forceRollup:kind==='rollup'});
  if(ok)toast('总结已更新');return ok;
}
