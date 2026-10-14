var ckRecordsData=null,ckRecordsBusy=false,ckRecordsPrincipal='',ckRecordsTimer=0,ckRecordsConnectionError='';
function ckRecordsScope(cfg){return chatEndpoint(cfg)+'|'+cfg.panelKey}
function ckRecordsTime(n){return n?new Date(n*1000).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false}):'尚无'}
function ckRecordsFailure(f){
  var stages={reading:'读取聊天来源',summarizing:'整理模型生成',validating:'程序校验',checking:'独立模型检查',batch_saved:'保存批次'},checks={grounded:'事实依据',important:'重要性',concise:'精炼程度',current:'最新状态',limits:'字数限制'};
  var lines=['失败时间：'+ckRecordsTime(f.at),'失败阶段：'+(stages[f.stage]||f.stage||'旧版未保存')+(f.day?' · 处理 '+f.day:'')+(f.batch?' · 第 '+f.batch+' / '+f.batches+' 批':''),
    '原因：'+(f.message||'未保存具体原因')+(f.error_code?'（'+f.error_code+'）':'')];
  if(f.provider||f.model)lines.push('本次模型：'+[f.provider,f.model].filter(Boolean).join(' / '));
  if(f.attempt||f.stage_attempt)lines.push('当日第 '+(f.attempt||'—')+' 次运行 · 本批第 '+(f.stage_attempt||'—')+' 次提炼');
  var failed=Object.keys(f.checks||{}).filter(function(k){return f.checks[k]===false}).map(function(k){return checks[k]||k});
  if(failed.length)lines.push('未通过：'+failed.join('、'));
  (f.notes||[]).forEach(function(note){lines.push('审核意见：'+note)});
  return lines.join('\n');
}
function ckRecordsRender(){
  var data=ckRecordsData||{},names={waiting:'等待每日检查',not_configured:'等待配置模型',reading:'读取待处理聊天',summarizing:'提炼记录',validating:'核对格式与原文证据',checking:'检查事实与精炼程度',batch_saved:'已保存本批进度',updated:'记录已更新',unchanged:'已检查，无需更新',retry:'等待自动重试',needs_attention:'本轮未通过，保留上一版',paused:'已暂停',queued:'等待开始'};
  ['todos','profile'].forEach(function(kind){var box=document.getElementById('ck-records-'+kind),count=document.getElementById('ck-records-'+kind+'-count');if(box)box.value=data[kind]||'';if(count)count.textContent=Array.from(data[kind]||'').length+' / 5000 字'});
  var message=(names[data.status]||'正在读取记录')+(data.last_day?' · 已完成至 '+data.last_day:'')+(data.batch&&['summarizing','validating','checking','batch_saved','retry','needs_attention'].includes(data.status)?' · 第 '+data.batch+' / '+data.batches+' 批':'');
  var lines=[message,'最近检查成功：'+ckRecordsTime(data.last_checked_at),'最近内容更新：'+ckRecordsTime(data.last_updated_at)];
  if(data.last_attempt_at)lines.push('最近尝试：'+ckRecordsTime(data.last_attempt_at));
  if(data.last_error)lines.push(data.last_failure?ckRecordsFailure(data.last_failure):'最近问题：'+data.last_error);
  if(data.legacy_failure)lines.push('旧版本未保存具体失败阶段、时间和审核意见；更新后的新失败会显示详情。');
  if(data.status==='needs_attention')lines.push('下一步：查看失败原因与模型配置后手动重新检查；本轮已停止重试。');
  else if(data.status==='retry'&&data.next_retry)lines.push('下次重试：'+ckRecordsTime(data.next_retry));
  var api=data.api||{};['daily_records','daily_records_audit'].forEach(function(group){var cfg=api[group];if(cfg)lines.push((group==='daily_records'?'当前整理模型：':'当前检查模型：')+[cfg.provider,cfg.model].filter(Boolean).join(' / ')+(cfg.configured?'':'（未配置完整）'))});
  if(ckRecordsConnectionError)lines.push(ckRecordsConnectionError);
  ['ck-records-state','ck-records-monitor'].forEach(function(id){
    var el=document.getElementById(id);if(!el)return;
    var opened=el.querySelector('details[open]');el.replaceChildren();el.dataset.state=data.last_error?'error':'ok';
    var summary=document.createElement('div');summary.textContent=lines.join('\n');el.append(summary);
    var history=data.failure_history||[];
    if(history.length){var fold=document.createElement('details'),title=document.createElement('summary');fold.open=!!opened;title.textContent='最近失败记录 · '+history.length+' 条';fold.append(title);history.forEach(function(f){var row=document.createElement('p');row.textContent=ckRecordsFailure(f);fold.append(row)});el.append(fold);}
  });
  var toggle=document.getElementById('ck-records-toggle');if(toggle){toggle.textContent=data.enabled===false?'恢复每日更新':'暂停每日更新';toggle.disabled=ckRecordsBusy;}
  document.querySelectorAll('[data-records-action]').forEach(function(b){b.disabled=ckRecordsBusy});
}
async function ckRecordsRefresh(action){
  var cfg=chatLoadConfig(),scope=ckRecordsScope(cfg);
  if(ckRecordsPrincipal!==scope){ckRecordsPrincipal=scope;ckRecordsData=null;ckRecordsConnectionError='';ckRecordsRender();}
  if(ckRecordsBusy)return;ckRecordsBusy=true;ckRecordsRender();
  var controller=new AbortController(),timer=setTimeout(function(){controller.abort()},12000);
  try{
    var response=await fetch(chatEndpoint(cfg).replace(/\/chat$/,'/daily-records')+'?key='+encodeURIComponent(cfg.panelKey),action?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:action}),signal:controller.signal}:{cache:'no-store',signal:controller.signal});
    var data=await response.json();if(!response.ok||data.ok!==true)throw new Error(data.error||'记录暂时无法读取');
    if(ckRecordsScope(chatLoadConfig())!==scope)return;ckRecordsData=data;ckRecordsConnectionError='';
  }catch(error){if(ckRecordsScope(chatLoadConfig())===scope)ckRecordsConnectionError='状态连接暂未完成；上次读取的结果仍保留，稍后重新读取。';}
  finally{clearTimeout(timer);ckRecordsBusy=false;ckRecordsRender();clearTimeout(ckRecordsTimer);if(currentPanelTab==='records'||currentPanelTab==='status'&&ckStatusTab==='records')ckRecordsTimer=setTimeout(function(){ckRecordsRefresh()},10000);}
}
function ckRecordsToggle(){return ckRecordsRefresh(ckRecordsData&&ckRecordsData.enabled===false?'resume':'pause')}
