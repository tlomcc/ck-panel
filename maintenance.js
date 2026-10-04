/* Readable maintenance monitoring: current state, durable history, explicit controls. */
var ckStatusTab='fact';
(function(){
  'use strict';
  var timer=0,seq=0,controller=null,principal=null,state={topics:{rows:[],cursor:null,filter:'all',data:null},digest:{rows:[],cursor:null,filter:'all',data:null}};
  function el(id){return document.getElementById(id)}
  function escape(value){return esc(String(value==null?'—':value))}
  function attr(value){return escAttr(String(value==null?'':value))}
  function clock(value){
    if(!value)return '—';var date=new Date(typeof value==='number'?(value<1e12?value*1000:value):value);
    if(isNaN(date.getTime()))return String(value);
    return new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false}).format(date);
  }
  function num(value){return value===undefined||value===null?'—':Number(value).toLocaleString('zh-CN')}
  var names={running:'正在整理',retry:'等待重试',queued:'等待开始',paused:'已暂停',ok:'本轮完成',succeeded:'更新完成',summaries_updated:'摘要已更新',changed:'按最新内容重排',up_to_date:'当前已整理完毕',needs_model:'等待配置 API',daily_limit:'今日预算已用完',review_limit:'等待处理审批',waiting_window:'等待04:00',empty:'暂无待办',outside_window:'等待夜间时段',idle:'等待新材料',context:'准备材料',model:'调用模型',validate:'校验结果',refresh_facts:'核对最新材料',save:'保存更改',saved:'保存完成',finished:'本轮结束',deferred:'暂让出处理',failed:'本轮未成功',started:'已开始',summaries:'整理摘要',organize:'归类材料'};
  function label(value){return names[value]||value||'等待新任务'}
  function chip(text,kind){return '<span class="mm-state '+(kind||'')+'">'+escape(text)+'</span>'}
  function pairs(rows){return '<dl class="mm-fields">'+rows.map(function(r){return '<div><dt>'+escape(r[0])+'</dt><dd>'+escape(r[1])+'</dd></div>'}).join('')+'</dl>'}
  function statistic(title,value,detail){return '<div class="mm-stat"><span>'+escape(title)+'</span><b>'+escape(value)+'</b><small>'+escape(detail)+'</small></div>'}
  function root(section){return el(section==='topics'?'ck-topic-monitor':'ck-digest-monitor')}
  function build(section){
    if(root(section).querySelector('.mm-overview'))return;
    root(section).innerHTML='<p class="mm-message" role="status">正在读取最新状态…</p><div class="mm-overview"></div><section class="mm-history"><div class="mm-history-heading"><h3>更新与调用记录</h3><span class="mm-history-help">上海时间 · 保留90天</span></div>'+(section==='topics'?'<div class="mm-filters" role="group" aria-label="记录类型">'+[['all','全部'],['runs','整理进度'],['changes','更改明细'],['api','API调用']].map(function(pair){return '<button type="button" data-mm-filter="'+pair[0]+'" aria-pressed="'+(pair[0]==='all')+'">'+pair[1]+'</button>'}).join('')+'</div>':'')+'<div class="mm-records"></div><button type="button" class="btn btn-outline btn-sm mm-more" hidden>加载更早记录</button><div class="mm-legacy"></div></section>';
    if(root(section).__mmBound)return;root(section).__mmBound=true;
    root(section).addEventListener('click',function(e){
      var button=e.target.closest('[data-mm-filter]');
      if(button){var current=state[section];current.filter=button.dataset.mmFilter;current.rows=[];current.cursor=null;ckRefreshMaintenance(true);}
      if(e.target.closest('.mm-more'))ckRefreshMaintenance(false,true);
    });
  }
  function renderOverview(section,data){
    var box=root(section).querySelector('.mm-overview');
    if(section==='topics'){
      var o=data.overview||{},progress=o.progress||{},summary=data.summaries||{},usage=o.usage||{},settings=o.settings||{},last=o.last_run||{},status=o.running?'running':settings.enabled===false?'paused':last.status;
      var today=new Date(Date.now()+8*3600000).toISOString().slice(0,10),todayCalls=usage.date===today?Number(usage.calls)||0:0,api=data.api||{};
      var total=Number(progress.total)||0,checked=Number(progress.checked)||0,pct=total?Math.min(100,checked*100/total):0;
      var stages=state.topics.rows.filter(function(r){return r.kind==='topic_run'}),latestStage=stages.find(function(r){return r.phase!=='finished'&&r.phase!=='failed'});
      box.innerHTML='<div class="mm-summary-line"><h3>主题整理</h3>'+chip(label(status),o.running?'live':status==='retry'?'attention':'')+'<small>观测于 '+escape(clock(data.observed_at))+'</small></div><div class="mm-stat-grid">'+statistic('材料整理',num(checked)+' / '+num(total),'剩余 '+num(progress.remaining)+' 份有效材料')+statistic('主题摘要',num(summary.ready)+' / '+num(summary.total),'共 '+num(data.topic_count)+' 个小主题')+statistic('今日 API 调用',num(todayCalls)+' / '+num(settings.daily_calls),usage.date&&usage.date!==today?'最近记账 '+usage.date+' · '+num(usage.calls)+' 次':today+' · 上海时间')+'</div><div class="mm-progress" role="progressbar" aria-label="材料整理进度" aria-valuemin="0" aria-valuemax="'+total+'" aria-valuenow="'+checked+'"><span style="width:'+pct+'%"></span></div><p class="mm-current-note">'+escape(last.message||'等待新增材料或新的处理意见')+'</p><details class="mm-current-details"><summary>本轮状态与下一步</summary>'+pairs([['当前阶段',o.running&&latestStage?label(latestStage.phase):label(last.stage||last.status)],['最近运行',clock(last.at)],['下一次重试',last.retry_after?clock(last.retry_after):'按后台调度检查'],['API 配置',api.configured?'可调用':'等待配置'],['供应商 / 模型',[api.provider,api.model].filter(Boolean).join(' / ')||'尚未选择'],['待审批',num(o.pending_count)+' 项'],['每批材料',num(settings.batch_size)+' 份'],['你的控制',settings.enabled===false?'自动整理已暂停':'可编辑、暂停、修改预算和撤销自动处理']])+'</details>';
    }else{
      var sessions=data.sessions||[],schedule=data.schedule||{},running=sessions.filter(function(s){return s.status==='running'}).length,pending=sessions.reduce(function(n,s){return n+(s.pending_groups||0)},0);
      box.innerHTML='<div class="mm-summary-line"><h3>截断总结</h3>'+chip(running?'正在后台更新':schedule.in_window?'夜间更新时段':'等待04:00',running?'live':'')+'</div><p class="mm-current-note">每天04:00开始，失败自动重试至07:00；之后保留旧版，次日再继续。聊天不会等待总结。</p><div class="mm-stat-grid">'+statistic('下一次开始',clock(schedule.next_window),'Asia/Shanghai')+statistic('等待整理',num(pending)+' 轮',sessions.length+' 个已同步会话')+statistic('更新中的会话',num(running),'原文与完成批次持续保留')+'</div><div class="mm-session-list">'+(sessions.map(function(s){return '<details class="mm-session" data-session="'+attr(s.session_id)+'"><summary><strong>'+escape(s.title||s.session_id)+'</strong>'+chip(label(s.status),s.status==='retry'?'attention':'')+'<span>'+num(s.pending_groups)+' 轮待处理</span></summary>'+pairs([['最近完成',clock(s.completed_at)],['本日尝试',num(s.attempts)],['完成批次',num(s.checkpoint_batches)],['阶段',s.stage||'等待开始'],['下次重试',s.status==='retry'?clock(s.next_retry):'下个夜间窗口'],['最近问题',s.last_error||'暂无']])+'</details>'}).join('')||'<p class="mw-empty">打开聊天后，现有会话和待总结内容会自动同步到这里。</p>')+'</div>';
    }
  }
  function changeDetails(row){
    if(row.change==='summary')return '<div class="mm-diff"><section><h4>更改前</h4><p>'+escape(row.before||'空')+'</p></section><section><h4>更改后</h4><p>'+escape(row.after||'空')+'</p></section></div>';
    var before=row.before||{},after=row.after||{},fields=[['title','名称'],['group_title','所属大主题'],['note','补充说明'],['aliases','别名'],['recall_enabled','允许召回']];
    var rows=fields.filter(function(f){return JSON.stringify(before[f[0]])!==JSON.stringify(after[f[0]])}).map(function(f){
      function value(v){return v===true?'开启':v===false?'关闭':Array.isArray(v)?v.join('、'):v||'空'}
      return '<tr><th>'+escape(f[1])+'</th><td>'+escape(value(before[f[0]]))+'</td><td>'+escape(value(after[f[0]]))+'</td></tr>';
    });
    return (rows.length?'<div class="mm-table-wrap"><table><thead><tr><th>项目</th><th>更改前</th><th>更改后</th></tr></thead><tbody>'+rows.join('')+'</tbody></table></div>':'')+pairs([['新增关联',num((row.added||[]).length)+' 条'],['移出关联',num((row.removed||[]).length)+' 条']])+((row.added||[]).length||(row.removed||[]).length?'<details><summary>材料编号</summary><p>新增：'+escape((row.added||[]).join('、')||'无')+'</p><p>移出：'+escape((row.removed||[]).join('、')||'无')+'</p></details>':'');
  }
  function record(row,open){
    var diagnostic=row.diagnostic||{},ok=row.ok===false?'未成功':row.phase==='started'?'调用开始':row.kind==='topic_change'?'已更改':row.kind==='topic_control'?'手动操作':row.ok===true?'已完成':label(row.phase),title=row.kind==='topic_api'?'API · '+(row.provider||'当前供应商')+' / '+(row.model||'当前模型'):row.kind==='topic_change'?row.title||'主题更改':row.kind==='topic_control'?({organizer_start:'开始整理',organizer_pause:'暂停整理',organizer_settings:'保存整理设置',organizer_review:'保存审批意见',organizer_undo:'撤销自动处理',organizer_recheck:'重新检查历史',save:'保存主题',delete:'删除主题'}[row.action]||row.action):row.kind==='digest_run'?(row.title||'截断总结')+' · '+label(row.stage||row.phase):label(row.task)+' · '+label(row.phase);
    var duration=row.duration_ms!==undefined?Number(row.duration_ms).toLocaleString('zh-CN',{maximumFractionDigits:1})+' ms':'';
    var detail=row.kind==='topic_change'?changeDetails(row):pairs([['执行结果',ok],['任务阶段',label(row.stage||row.phase)],['HTTP 状态',row.http_status||diagnostic.http_status||'—'],['耗时',duration||'—'],['失败原因',row.error||diagnostic.error||({timeout:'调用超时',http_error:'供应商返回错误',connection_error:'无法连接供应商'}[row.error_code])||row.error_code||'无'],['请求编号',row.call_id||diagnostic.request_id||row.run_id||'—']]);
    if(row.usage)detail+=pairs([['输入 token',num(row.usage.prompt_tokens)],['输出 token',num(row.usage.completion_tokens)],['合计 token',num(row.usage.total_tokens)]]);
    if(diagnostic.attempts&&diagnostic.attempts.length)detail+='<details><summary>API 尝试明细 · '+diagnostic.attempts.length+' 次</summary>'+diagnostic.attempts.map(function(a){return pairs([['第几次',a.number],['HTTP 状态',a.http_status||'—'],['耗时',a.duration_ms===undefined?'—':a.duration_ms+' ms'],['结束原因',a.finish_reason||a.error_code||'—'],['调用模型',diagnostic.model||'—']])}).join('')+'</details>';
    return '<details class="mm-record" data-record="'+attr(row.id)+'"'+(open?' open':'')+'><summary><time>'+escape(clock(row.at))+'</time>'+chip(ok,row.ok===false?'attention':'')+'<strong>'+escape(title)+'</strong><span class="mm-duration">'+escape(duration)+'</span></summary><div class="mm-record-body">'+detail+'<details><summary>完整记录字段</summary><pre>'+escape(JSON.stringify(row,null,2))+'</pre></details></div></details>';
  }
  function render(section){
    var s=state[section],r=root(section);if(!s.data)return;
    var open=new Set(Array.from(r.querySelectorAll('[data-record][open]')).map(function(n){return n.dataset.record}));
    var details=r.querySelector('.mm-current-details'),showDetails=details&&details.open;
    var sessionsOpen=new Set(Array.from(r.querySelectorAll('[data-session][open]')).map(function(n){return n.dataset.session}));
    renderOverview(section,s.data);r.querySelectorAll('[data-session]').forEach(function(n){n.open=sessionsOpen.has(n.dataset.session)});if(showDetails&&r.querySelector('.mm-current-details'))r.querySelector('.mm-current-details').open=true;
    r.querySelector('.mm-message').textContent='已刷新 · '+clock(Date.now());
    r.querySelectorAll('[data-mm-filter]').forEach(function(b){b.setAttribute('aria-pressed',String(b.dataset.mmFilter===s.filter))});
    r.querySelector('.mm-records').innerHTML=s.rows.map(function(row){return record(row,open.has(String(row.id)))}).join('')||'<p class="mw-empty">暂无此类记录。后续运行的进度、结果和调用会显示在这里。</p>';
    r.querySelector('.mm-more').hidden=!s.cursor;
    var legacy=r.querySelector('.mm-legacy');
    if(section==='topics'&&s.data.legacy_operations&&s.data.legacy_operations.length&&!legacy.innerHTML){
      legacy.innerHTML='<details><summary>此前的自动处理与意见 · '+s.data.legacy_operations.length+' 条处理记录</summary><p class="mw-note">需要撤销或补充意见，可展开下方整理控制。</p>'+s.data.legacy_operations.map(function(op){return '<details><summary>'+escape(clock(op.at))+' · '+escape(op.title||op.kind||'主题处理')+'</summary><pre>'+escape(JSON.stringify(op,null,2))+'</pre></details>'}).join('')+'<details><summary>已保存的处理意见</summary><pre>'+escape(JSON.stringify(s.data.legacy_decisions||[],null,2))+'</pre></details></details>';
    }
  }
  function schedule(){clearTimeout(timer);if(ckStatusTab==='fact')return;timer=setTimeout(function(){if(currentPanelTab==='status'&&!document.hidden)ckRefreshMaintenance(false);else schedule()},15000);}
  window.ckRefreshMaintenance=async function(force,more){
    if(ckStatusTab==='fact'||currentPanelTab!=='status')return;
    var section=ckStatusTab,key=storedPanelKey(),mySeq=++seq;
    if(principal!==key){
      var changedPrincipal=principal!==null;principal=key;
      ['topics','digest'].forEach(function(name){state[name]={rows:[],cursor:null,filter:'all',data:null};root(name).innerHTML='';});
      if(changedPrincipal&&el('ck-topic-controls').open&&typeof memoryWorkbenchEnter==='function')memoryWorkbenchEnter('topics');
      else if(changedPrincipal&&el('mw-organizer'))el('mw-organizer').innerHTML='';
    }
    var s=state[section];
    if(controller)controller.abort();var requestController=new AbortController();controller=requestController;
    var signal=requestController.signal,timeout=setTimeout(function(){requestController.abort()},15000);
    build(section);var r=root(section);r.querySelector('.mm-message').textContent='正在刷新…';
    var path='/ck/maintenance/status?section='+section+'&kind='+s.filter+(more&&s.cursor?'&before='+s.cursor:'')+(force?'&refresh=1':'');
    try{
      var response=await panelDataFetch(function(auth){if(auth!==key)throw new Error('连接已变化');return GRAPH_API_BASE+path},{cache:'no-store',signal:signal},{label:'整理状态'});
      var data=await response.json();if(!response.ok||data.ok===false)throw new Error(data.error||'状态读取失败');
      if(seq!==mySeq||key!==storedPanelKey()||section!==ckStatusTab)return;
      s.data=data;
      var rows=data.history&&data.history.items||[];
      var overlap=rows.some(function(row){return s.rows.some(function(old){return old.id===row.id})});
      var reset=!more&&(force||!s.rows.length||!overlap),merged=new Map();
      (reset?rows:rows.concat(s.rows)).forEach(function(row){if(!merged.has(row.id))merged.set(row.id,row)});
      s.rows=Array.from(merged.values()).sort(function(a,b){return b.id-a.id});
      if(more||reset)s.cursor=data.history&&data.history.next_cursor;
      if(s.rows.length>500){s.rows=s.rows.slice(0,500);s.cursor=s.rows[s.rows.length-1].id;}
      render(section);
    }catch(error){if(seq===mySeq)r.querySelector('.mm-message').textContent=(error.name==='AbortError'?'刷新超时':error.message)+'；上次读取的内容仍保留。';}
    finally{clearTimeout(timeout);if(seq===mySeq){controller=null;schedule();}}
  };
  window.ckSelectStatusTab=function(tab){
    ckStatusTab=['topics','digest'].includes(tab)?tab:'fact';++seq;if(controller)controller.abort();clearTimeout(timer);
    ['fact','topics','digest'].forEach(function(name){var active=name===ckStatusTab;el('ck-status-'+name).hidden=!active;var button=el('ck-status-tab-'+name);button.setAttribute('aria-selected',String(active));button.tabIndex=active?0:-1;});
    el('status-sub').textContent=ckStatusTab==='fact'?'每日 Fact 提取 · 任务与进度':ckStatusTab==='topics'?'主题归类、摘要更新与每次更改':'04:00–07:00 · 夜间更新与失败重试';
    if(ckStatusTab==='fact'){loadDailyStatus(false);startDailyStatusRealtime();}else{stopDailyStatusRealtime();build(ckStatusTab);ckRefreshMaintenance(false);}
  };
  window.ckStatusEnter=function(){ckSelectStatusTab(ckStatusTab)};
  window.ckRefreshStatus=function(){if(ckStatusTab==='fact')loadDailyStatus(true);else ckRefreshMaintenance(true)};
  el('ck-status-tabs').addEventListener('keydown',function(e){
    if(!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;e.preventDefault();
    var tabs=['fact','topics','digest'],index=tabs.indexOf(ckStatusTab);index=e.key==='Home'?0:e.key==='End'?2:(index+(e.key==='ArrowLeft'?2:1))%3;
    ckSelectStatusTab(tabs[index]);el('ck-status-tab-'+tabs[index]).focus();
  });
  el('ck-topic-controls').addEventListener('toggle',function(){if(this.open&&typeof memoryWorkbenchEnter==='function')memoryWorkbenchEnter('topics')});
})();
