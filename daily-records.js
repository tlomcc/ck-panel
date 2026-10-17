var ckRecordsData=null,ckRecordsBusy=false,ckRecordsPrincipal='',ckRecordsTimer=0,ckRecordsConnectionError='';
var ckRecordsFeedbackDrafts=new Map(),ckRecordsFeedbackMessage='';
function ckRecordsFeedbackDraft(){
  var draft=ckRecordsFeedbackDrafts.get(ckRecordsPrincipal),data=ckRecordsData;
  if(!draft&&data){draft={text:data.feedback_text||'',revision:data.feedback_revision||0,saved:data.feedback_text||''};ckRecordsFeedbackDrafts.set(ckRecordsPrincipal,draft)}
  return draft;
}
function ckRecordsFeedbackInput(){
  var draft=ckRecordsFeedbackDraft(),box=document.getElementById('ck-records-feedback');
  if(draft&&box){draft.text=box.value;ckRecordsFeedbackMessage='';ckRecordsFeedbackRender()}
}
function ckRecordsFeedbackLoad(){
  if(!ckRecordsData)return;
  ckRecordsFeedbackDrafts.delete(ckRecordsPrincipal);ckRecordsFeedbackMessage='已读取服务器保存的评价。';ckRecordsFeedbackRender();
}
function ckRecordsFeedbackRender(){
  var box=document.getElementById('ck-records-feedback');if(!box)return;
  var data=ckRecordsData,draft=ckRecordsFeedbackDraft();
  if(draft&&data&&draft.text===draft.saved&&draft.revision!==(data.feedback_revision||0)){
    draft.text=draft.saved=data.feedback_text||'';draft.revision=data.feedback_revision||0;
  }
  if(box.value!==(draft?draft.text:''))box.value=draft?draft.text:'';
  box.disabled=!data;
  var count=Array.from(box.value).length,dirty=!!draft&&draft.text!==draft.saved;
  document.getElementById('ck-records-feedback-count').textContent=count+' / 5000 字';
  document.getElementById('ck-records-feedback-save').disabled=!data||ckRecordsBusy||!dirty||count>5000;
  var state=document.getElementById('ck-records-feedback-state'),lines=[];
  if(ckRecordsFeedbackMessage)lines.push(ckRecordsFeedbackMessage);
  if(!data)lines.push('正在读取已保存评价…');
  else{
    if(dirty)lines.push('有未保存的修改。');
    if(draft.revision!==(data.feedback_revision||0))lines.push('其他页面已修改评价，请对照下方已保存内容后合并；读取已保存评价会替换框中的草稿。');
    if(data.feedback_saved_at)lines.push('最近保存：'+ckRecordsTime(data.feedback_saved_at));
    if(data.feedback_text)lines.push(data.feedback_applied_revision===data.feedback_revision?'本版评价已用于整理并通过检查：'+ckRecordsTime(data.feedback_applied_at):'本版评价将在下轮整理开始时先复核；当前尚未完成落实检查。');
    if(data.enabled===false)lines.push('每日更新已暂停，评价会保留到恢复后的整理。');
  }
  state.textContent=lines.join('\n');
  document.getElementById('ck-records-feedback-saved').textContent=data&&data.feedback_text||'尚未保存评价。';
  document.getElementById('ck-records-feedback-load').disabled=!data||ckRecordsBusy;
  var learning=data&&data.feedback_learning,learned=document.getElementById('ck-records-feedback-learning');
  learned.replaceChildren();
  if(learning&&learning.rules){
    var title=document.createElement('p');title.textContent=(learning.revision===data.feedback_revision?'本版评价的改进要点':'上一版评价的改进要点')+' · '+ckRecordsTime(learning.at);learned.append(title);
    var list=document.createElement('ul');learning.rules.forEach(function(rule){var row=document.createElement('li');row.textContent=rule.rule;list.append(row)});learned.append(list);
  }
}
function ckRecordsFeedbackSave(){
  if(ckRecordsPrincipal!==ckRecordsScope(chatLoadConfig()))return ckRecordsRefresh();
  var draft=ckRecordsFeedbackDraft();if(!draft)return;
  return ckRecordsRefresh('feedback',{text:draft.text,feedback_revision:draft.revision});
}
function ckRecordsScope(cfg){return chatEndpoint(cfg)+'|'+cfg.panelKey}
function ckRecordsTime(n){return n?new Date(n*1000).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false}):'尚无'}
function ckRecordsFailure(f){
  var stages={learning:'复核评价并提炼改进要求',reading:'读取聊天来源',summarizing:'整理模型生成',validating:'程序校验',checking:'独立模型检查',batch_saved:'保存批次',unknown:'旧版未保存'},checks={grounded:'事实依据',important:'重要性',concise:'精炼程度',current:'最新状态',limits:'字数限制',feedback:'评价落实'};
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
  var data=ckRecordsData||{},names={waiting:'等待每日检查',not_configured:'等待配置模型',learning:'先复核评价，提炼改进要求',reading:'读取待处理聊天',summarizing:'提炼记录',validating:'核对格式与原文证据',checking:'检查事实、精炼程度与评价落实',batch_saved:'已保存本批进度',updated:'记录已更新',unchanged:'已检查，无需更新',retry:'等待自动重试',needs_attention:'本轮未通过，保留上一版',paused:'已暂停',queued:'等待开始'};
  ['todos','profile'].forEach(function(kind){var box=document.getElementById('ck-records-'+kind),count=document.getElementById('ck-records-'+kind+'-count');if(box)box.value=data[kind]||'';if(count)count.textContent=Array.from(data[kind]||'').length+' / 5000 字'});
  var message=(names[data.status]||'正在读取记录')+(data.last_day?' · 已完成至 '+data.last_day:'')+(data.batch&&['summarizing','validating','checking','batch_saved','retry','needs_attention'].includes(data.status)?' · 第 '+data.batch+' / '+data.batches+' 批':'');
  var lines=[message,'最近检查成功：'+ckRecordsTime(data.last_checked_at),'最近内容更新：'+ckRecordsTime(data.last_updated_at)];
  var latest=(data.history||[])[0];
  if(latest&&latest.method==='manual')lines.push('最近人工核对：'+(latest.start_day?latest.start_day+' 至 ':'')+latest.day+(latest.partial?'（当天资料截至 '+ckRecordsTime(latest.source_cutoff)+'）':''));
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
  ckRecordsFeedbackRender();
}
async function ckRecordsRefresh(action,payload){
  var cfg=chatLoadConfig(),scope=ckRecordsScope(cfg);
  if(ckRecordsPrincipal!==scope){ckRecordsPrincipal=scope;ckRecordsData=null;ckRecordsConnectionError='';ckRecordsFeedbackMessage='';ckRecordsRender();}
  if(ckRecordsBusy)return;ckRecordsBusy=true;ckRecordsRender();
  var controller=new AbortController(),timer=setTimeout(function(){controller.abort()},12000);
  try{
    var response=await fetch(chatEndpoint(cfg).replace(/\/chat$/,'/daily-records')+'?key='+encodeURIComponent(cfg.panelKey),action?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(Object.assign({action:action},payload||{})),signal:controller.signal}:{cache:'no-store',signal:controller.signal});
    var data=await response.json();if(!response.ok||data.ok!==true)throw new Error(data.error||'记录暂时无法读取');
    if(ckRecordsScope(chatLoadConfig())!==scope)return;ckRecordsData=data;ckRecordsConnectionError='';
    if(action==='feedback'){
      var draft=ckRecordsFeedbackDrafts.get(scope);
      if(draft){if(draft.text===payload.text)draft.text=data.feedback_text||'';draft.saved=data.feedback_text||'';draft.revision=data.feedback_revision||0}
      ckRecordsFeedbackMessage='评价已保存，下轮整理会先复核并提炼改进要求。';
    }
  }catch(error){if(ckRecordsScope(chatLoadConfig())===scope){
    if(action==='feedback')ckRecordsFeedbackMessage='保存未完成：'+(error.message||'连接失败')+'。框中内容已保留。';
    else ckRecordsConnectionError='状态连接暂未完成；上次读取的结果仍保留，稍后重新读取。';
  }}
  finally{clearTimeout(timer);ckRecordsBusy=false;ckRecordsRender();clearTimeout(ckRecordsTimer);if(currentPanelTab==='records'||currentPanelTab==='status'&&ckStatusTab==='records')ckRecordsTimer=setTimeout(function(){ckRecordsRefresh()},10000);}
}
function ckRecordsToggle(){return ckRecordsRefresh(ckRecordsData&&ckRecordsData.enabled===false?'resume':'pause')}
