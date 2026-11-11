/* Readable maintenance monitoring: current state, durable history, explicit controls. */
var ckStatusTab='fact';
async function ckRunDigestAction(id,action){
  await chatEnsureSessionsReady();
  var session=chatSessions.find(function(s){return String(s.id)===String(id)});
  if(!session){toast('该窗口已删除');return false;}
  if(chatCurrentSession()!==session){
    if(chatSending||chatTrimTransaction){toast('当前回复结束后可操作其他窗口');return false;}
    chatSelectSession(session.id);
  }
  var result=action==='sync'?await chatDigestSyncNow():await chatManualTrimNow();
  ckRefreshMaintenance(false);return result;
}
(function(){
  'use strict';
  var timer=0,ticker=0,seq=0,controller=null,principal=null,state={events:{rows:[],cursor:null,filter:'all',data:null},digest:{rows:[],cursor:null,filter:'all',data:null}};
  function el(id){return document.getElementById(id)}
  function escape(value){return esc(String(value==null?'—':value))}
  function attr(value){return escAttr(String(value==null?'':value))}
  function clock(value){
    if(!value)return '—';var date=new Date(typeof value==='number'?(value<1e12?value*1000:value):value);
    if(isNaN(date.getTime()))return String(value);
    return new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false}).format(date);
  }
  function num(value){return value===undefined||value===null?'—':Number(value).toLocaleString('zh-CN')}
  var names={running:'正在整理',retry:'等待重试',queued:'等待开始',paused:'已暂停',ok:'本轮完成',succeeded:'更新完成',summaries_updated:'摘要已更新',changed:'按最新内容重排',up_to_date:'当前已整理完毕',needs_model:'等待配置 API',daily_limit:'今日预算已用完',review_limit:'等待处理审批',waiting_window:'等待后台重试',empty:'暂无待办',outside_window:'等待下次检查',idle:'等待新材料',context:'准备材料',model:'调用模型',validate:'校验结果',refresh_facts:'核对最新材料',save:'保存更改',saved:'保存完成',finished:'本轮结束',deferred:'暂让出处理',failed:'本轮未成功',started:'已开始',summaries:'整理摘要',organize:'归类材料'};
  function label(value){return names[value]||value||'等待新任务'}
  function chip(text,kind){return '<span class="mm-state '+(kind||'')+'">'+escape(text)+'</span>'}
  function pairs(rows){return '<dl class="mm-fields">'+rows.map(function(r){return '<div><dt>'+escape(r[0])+'</dt><dd>'+escape(r[1])+'</dd></div>'}).join('')+'</dl>'}
  function statistic(title,value,detail){return '<div class="mm-stat"><span>'+escape(title)+'</span><b>'+escape(value)+'</b><small>'+escape(detail)+'</small></div>'}
  function root(section){return el(section==='events'?'ck-event-monitor':'ck-digest-monitor')}
  function build(section){
    if(root(section).querySelector('.mm-overview'))return;
    if(section==='events'){root(section).innerHTML='<p class="mm-message" role="status">正在读取事件状态…</p><div class="mm-overview"></div>';return;}
    root(section).innerHTML='<p class="mm-message" role="status">正在读取最新状态…</p><div class="mm-overview"></div><details class="mm-history-fold"><summary>查看后台整理记录</summary><section class="mm-history"><div class="mm-history-heading"><h3>整理记录</h3><span class="mm-history-help">上海时间 · 保留90天</span></div><div class="mm-view-intro"></div><div class="mm-records" aria-live="polite"></div><button type="button" class="btn btn-outline btn-sm mm-more" hidden>加载更早记录</button></section></details>';
    if(root(section).__mmBound)return;root(section).__mmBound=true;
    root(section).addEventListener('click',function(e){
      var action=e.target.closest('[data-mm-digest-action]');
      if(action){ckRunDigestAction(action.dataset.mmSession,action.dataset.mmDigestAction);return;}
      if(e.target.closest('.mm-more'))ckRefreshMaintenance(false,true);
    });
  }
  function manualCards(sessions){
    var current=chatCurrentSession(),locals=(typeof chatSessions!=='undefined'?chatSessions:[]).filter(function(s){return s===current||chatDigestHasContent(s)}),cfg=chatLoadConfig();
    function card(local){
      var remote=sessions.find(function(s){return s.session_id===String(local.id)}),v=chatDigestSyncView(local,cfg,remote);
      var busy=chatDigestReplyActive(local)||chatTrimBusy||chatTrimTransaction;
      return '<section class="mm-digest-result" aria-label="'+attr(local.title||'当前对话')+'的截断结果"><div class="mm-summary-line"><h3>'+escape(local.title||'当前对话')+'</h3>'+(local===current?'<small>当前对话</small>':'')+'</div>'+progressCard(local,remote,v)+'<div class="mm-digest-metrics">'+statistic('本次截断',num(v.rounds)+' 轮',v.cutNote)+statistic('同步状态',v.status,v.at?'操作时间 '+clock(v.at):busy?'当前回复结束后可同步':v.ready?'可立刻同步':'准备完成后再同步')+'</div><p class="mm-current-note mm-digest-'+attr(v.tone||'neutral')+'">'+escape(v.note)+'</p><div class="chat-actions"><button class="btn btn-outline btn-sm" type="button" data-mm-digest-action="prepare" data-mm-session="'+attr(local.id)+'">'+(local.digestManualTrim?'更新准备范围':'后台准备截断')+'</button><button class="btn btn-primary btn-sm" type="button" data-mm-digest-action="sync" data-mm-session="'+attr(local.id)+'"'+(busy?' disabled':'')+'>'+(v.retry?'重试同步':'立刻同步')+'</button></div></section>';
    }
    var others=locals.filter(function(s){return s!==current});
    return (current?card(current):'')+(others.length?'<details class="mm-current-details" data-session="other-results"><summary>其他对话 · '+others.length+' 个</summary>'+others.map(card).join('')+'</details>':'');
  }
  function progressView(local,remote,sync){
    return CKDigestProgress.view(local,remote,sync,{receivedAt:state.digest.receivedAt,refreshFailed:state.digest.refreshFailed});
  }
  function progressCard(local,remote,sync){
    var v=progressView(local,remote,sync);
    return '<section class="mm-digest-progress" data-digest-progress="'+attr(local.id)+'" aria-label="截断执行进度">'+
      '<div class="mm-progress-heading"><h4>截断进度</h4><span>'+escape(v.model)+'</span></div>'+
      '<p class="mm-digest-phase" data-digest-field="stage" role="status" aria-live="polite">'+escape(v.stage)+'</p>'+
      '<ol class="mm-digest-steps" aria-label="截断步骤">'+v.steps.map(function(text,i){return '<li'+(i===v.step?' aria-current="step"':'')+' class="'+(i<v.step?'done':i===v.step?'current':'')+'">'+escape(text)+'</li>'}).join('')+'</ol>'+
      '<p class="mm-digest-batch">'+escape(v.batch||v.detail)+'</p>'+
      (v.percent!==null?'<div class="mm-progress" role="progressbar" aria-label="已完成批次占当前计划比例" aria-valuemin="0" aria-valuemax="100" aria-valuenow="'+Math.round(v.percent)+'" aria-valuetext="'+attr(v.batch)+'"><span style="width:'+v.percent+'%"></span></div>':'')+
      '<dl class="mm-digest-timing"><div><dt data-digest-field="elapsedLabel">'+escape(v.elapsedLabel)+'</dt><dd data-digest-field="elapsed">'+escape(v.elapsed)+'</dd></div><div><dt>预计剩余</dt><dd data-digest-field="eta">'+escape(v.eta)+'</dd></div></dl>'+
      '<p class="mm-digest-estimate" data-digest-field="etaNote">'+escape(v.etaNote||v.detail)+'</p></section>';
  }
  function tickProgress(){
    if(ckStatusTab!=='digest'||currentPanelTab!=='status'||document.hidden){clearInterval(ticker);ticker=0;return;}
    var data=state.digest.data;if(!data)return;
    var cfg=chatLoadConfig();
    root('digest').querySelectorAll('[data-digest-progress]').forEach(function(card){
      var local=chatSessions.find(function(s){return String(s.id)===card.dataset.digestProgress});if(!local)return;
      var remote=(data.sessions||[]).find(function(s){return s.session_id===String(local.id)});
      var v=progressView(local,remote,chatDigestSyncView(local,cfg,remote));
      card.querySelectorAll('[data-digest-field]').forEach(function(node){var key=node.dataset.digestField,text=v[key]||(key==='etaNote'?v.detail:'');if(node.textContent!==text)node.textContent=text;});
    });
  }
  function renderOverview(section,data){
    var box=root(section).querySelector('.mm-overview');
      var sessions=data.sessions||[];
      box.innerHTML=manualCards(sessions)+'<details class="mm-current-details mm-digest-background" data-session="background"><summary>后台整理详情</summary><p class="mm-current-note">下面的“材料组”是后台整理单位，不是截断轮数。</p><div class="mm-session-list">'+(sessions.map(function(s){return '<details class="mm-session" data-session="'+attr(s.session_id)+'"><summary><strong>'+escape(s.title||s.session_id)+'</strong>'+chip(label(s.status),s.status==='retry'?'attention':'')+'</summary>'+pairs([['待处理材料',num(s.pending_groups)+' 组'],['已保存批次',num(s.checkpoint_batches)],['最近准备完成',clock(s.completed_at)],['最近问题',s.last_error||'无']])+'</details>'}).join('')||'<p class="mw-empty">暂无后台任务。</p>')+'</div></details>';

  }
  function renderEvents(data){
    var r=root('events'),p=data.progress||{},c=data.control||{},pre=data.preload||{},g=data.git||{},current=data.current||{},failures=data.failures||[],u=data.usage||{},limits=data.settings||{daily_calls:120,max_attempts:3};
    var focused=r.contains(document.activeElement)&&document.activeElement.matches('input');
    if(focused)return;
    var opened=Array.from(r.querySelectorAll('details[open]')).map(function(x){return x.dataset.eventDetail});
    var stages={model:'正在生成事件',generation:'生成事件',audit:'核对证据',validate:'核对最新来源',updated:'已保存事件',retry:'等待重试',blocked:'已暂停重复消耗',budget:'今日预算已用完',interrupted:'上次任务中断',pause:'已暂停',resume:'已恢复',check:'请求后台检查',synced:'已同步',pending:'等待同步',settings:'已保存预算',api:'API 请求'};
    function stage(v){return stages[v]||v||'等待新变化'}
    var active=['model','audit','validate'].includes(current.status),enabled=c.enabled!==false;
    r.querySelector('.mm-message').textContent='观测于 '+clock(data.observed_at);
    var stats=statistic('已就绪材料组',num(p.ready_scopes)+' / '+num(p.scope_count),num(p.events)+' 条事件')+statistic('新增变化待处理',num(p.automatic_pending_scopes),'含失败和冷却中的材料组')+statistic('旧资料待人工整理',num(p.manual_pending_scopes),'与自动任务分开保留')+statistic('今日 API 调用',num(u.calls)+' / '+num(limits.daily_calls),'生成、审核和备选请求都计入');
    var explanation='<p class="mm-current-note"><strong>'+escape(data.explanation||'正在读取任务进度')+'</strong></p>';
    var usage=pairs([['今日新记录的请求','生成 '+num(u.generation)+' 次 · 审核 '+num(u.audit)+' 次 · 其中备选 '+num(u.fallback)+' 次'],['请求返回结果','成功 '+num(u.succeeded)+' 次 · 失败 '+num(u.failed)+' 次（返回成功仍须通过质量审核）'],['最近任务',stage(current.status)+(current.scope?' · '+current.scope:'')],['最近后台检查',clock(p.checked_at)],['已就绪召回',pre.ready?num(pre.events)+' 条事件':'等待预加载'],['Git 备份',stage(g.status)]]);
    if(u.legacy_attempts)usage+='<p class="mw-note">今天升级前已有 '+num(u.legacy_attempts)+' 次整理尝试，已纳入上限；旧版漏计了独立审核请求，无法还原当天完整 API 总数。新记录从升级后开始逐次统计。</p>';
    var budget='<div class="mw-toolbar"><label>每日 API 上限 <input id="event-daily-limit" type="number" min="1" max="10000" step="1" inputmode="numeric" value="'+num(limits.daily_calls).replace(/,/g,'')+'"></label><label>每组连续失败上限 <input id="event-attempt-limit" type="number" min="1" max="10" step="1" value="'+limits.max_attempts+'"></label><button class="btn btn-outline btn-sm" data-event-action="settings">保存预算</button></div><p class="mw-note">按北京时间零点重置。达到连续失败上限后暂停该组；更换对应模型或点“重试失败任务”后重新尝试。审核连接或格式失败时复用已经生成的候选事件。</p>';
    var actions='<div class="mw-toolbar"><button class="btn btn-outline btn-sm" data-event-action="check">请求后台检查</button><button class="btn btn-outline btn-sm" data-event-action="'+(enabled?'pause':'resume')+'">'+(enabled?'暂停自动整理':'恢复自动整理')+'</button><button class="btn btn-outline btn-sm" data-event-action="retry">重试失败任务</button><button class="btn btn-outline btn-sm" onclick="navTo(\'apiconfig\');switchApiTab(\'topics\')">主用与备选模型</button></div>';
    var problems='<details data-event-detail="failures"'+(failures.length?' open':'')+'><summary>为什么还没完成 · '+failures.length+' 组</summary>'+failures.map(function(f){
      var next=f.blocked?'已暂停重复消耗；调整对应模型或手动重试':clock(f.retry_at);
      return '<div class="mm-change-card">'+pairs([['材料组',f.scope],['失败步骤',stage(f.phase)],['具体原因',f.reason||f.error],['接下来',f.next_action||'等待重试'],['累计 / 本轮尝试',num(f.attempts)+' / '+num(f.cycle_attempts)],['下一次',next]])+(f.review_notes||[]).map(function(n){return '<p class="mw-note">审核意见：'+escape(n.message)+'</p>'}).join('')+'</div>';
    }).join('')+'</details>';
    var records='<details data-event-detail="history"><summary>最近执行与 API 用量</summary>'+(c.history||[]).map(function(x){return '<p><time>'+escape(clock(x.at))+'</time> · '+escape(stage(x.status))+(x.phase?' · '+escape(stage(x.phase)):'')+(x.provider?' · '+escape(x.provider)+' / '+escape(x.model||''):'')+(x.fallback?' · 备选':'')+(x.ok!==undefined?' · '+(x.ok?'返回成功':'请求失败'):'')+(x.reason?' · '+escape(x.reason):x.error?' · '+escape(x.error):'')+(x.duration_ms!==undefined?' · '+(x.duration_ms/1000).toFixed(1)+' 秒':'')+(x.usage?' · 输入 '+num(x.usage.prompt_tokens)+' / 输出 '+num(x.usage.completion_tokens)+' token':'')+'</p>'}).join('')+'</details>';
    r.querySelector('.mm-overview').innerHTML='<div class="mm-summary-line"><h3>事件整理</h3>'+chip(!enabled?'已暂停':active?stage(current.status):'后台自动处理',active?'live':'')+'</div>'+explanation+'<div class="mm-stat-grid">'+stats+'</div>'+usage+budget+actions+problems+records;
    r.querySelectorAll('details').forEach(function(x){if(opened.includes(x.dataset.eventDetail))x.open=true});
    r.querySelectorAll('[data-event-action]').forEach(function(button){button.onclick=async function(){
      var key=storedPanelKey(),action=button.dataset.eventAction,body={action:action};
      if(action==='settings'){
        body.settings={daily_calls:Number(r.querySelector('#event-daily-limit').value),max_attempts:Number(r.querySelector('#event-attempt-limit').value)};
        if(!Number.isInteger(body.settings.daily_calls)||body.settings.daily_calls<1||body.settings.daily_calls>10000||!Number.isInteger(body.settings.max_attempts)||body.settings.max_attempts<1||body.settings.max_attempts>10){r.querySelector('.mm-message').textContent='每日上限需为 1–10000，连续失败上限需为 1–10 的整数';return;}
      }
      button.disabled=true;
      try{var response=await panelDataFetch(function(auth){if(auth!==key)throw new Error('连接已变化');return GRAPH_API_BASE+'/ck/event-automation'}, {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)},{label:'事件自动化'});var result=await response.json();if(!response.ok||result.ok===false)throw new Error(result.error||'操作失败');if(key===storedPanelKey()&&ckStatusTab==='events'){state.events.data=result;renderEvents(result);}}
      catch(error){if(key===storedPanelKey())r.querySelector('.mm-message').textContent=error.message;}
      finally{button.disabled=false;}
    }});
  }

  function record(row,open){
    var diagnostic=row.diagnostic||{},ok=row.ok===false?'未成功':row.phase==='started'?'调用开始':row.ok===true?'已完成':label(row.phase),title=(row.title||'截断总结')+' · '+label(row.stage||row.phase);
    var duration=row.duration_ms!==undefined?Number(row.duration_ms).toLocaleString('zh-CN',{maximumFractionDigits:1})+' ms':'';
    var detail=pairs([['执行结果',ok],['任务阶段',label(row.stage||row.phase)],['HTTP 状态',row.http_status||diagnostic.http_status||'—'],['耗时',duration||'—'],['失败原因',row.error||diagnostic.error||({timeout:'调用超时',http_error:'供应商返回错误',connection_error:'无法连接供应商'}[row.error_code])||row.error_code||'无'],['请求编号',row.call_id||diagnostic.request_id||row.run_id||'—']]);
    if(row.usage)detail+=pairs([['输入 token',num(row.usage.prompt_tokens)],['输出 token',num(row.usage.completion_tokens)],['合计 token',num(row.usage.total_tokens)]]);
    if(diagnostic.attempts&&diagnostic.attempts.length)detail+='<details><summary>API 尝试明细 · '+diagnostic.attempts.length+' 次</summary>'+diagnostic.attempts.map(function(a){return pairs([['第几次',a.number],['HTTP 状态',a.http_status||'—'],['耗时',a.duration_ms===undefined?'—':a.duration_ms+' ms'],['结束原因',a.finish_reason||a.error_code||'—'],['调用模型',diagnostic.model||'—']])}).join('')+'</details>';
    return '<details class="mm-record" data-record="'+attr(row.id)+'"'+(open?' open':'')+'><summary><time>'+escape(clock(row.at))+'</time>'+chip(ok,row.ok===false?'attention':'')+'<strong>'+escape(title)+'</strong><span class="mm-duration">'+escape(duration)+'</span></summary><div class="mm-record-body">'+detail+'</div></details>';
  }
  function render(section){
    var s=state[section],r=root(section);if(!s.data)return;
    if(section==='events'){renderEvents(s.data);return;}
    var focused=document.activeElement,actionFocus=section==='digest'&&r.contains(focused)&&focused.dataset.mmDigestAction?
      {session:focused.dataset.mmSession,action:focused.dataset.mmDigestAction}:null;
    var open=new Set(Array.from(r.querySelectorAll('[data-record][open]')).map(function(n){return n.dataset.record}));
    var details=r.querySelector('.mm-current-details'),showDetails=details&&details.open;
    var sessionsOpen=new Set(Array.from(r.querySelectorAll('[data-session][open]')).map(function(n){return n.dataset.session}));
    renderOverview(section,s.data);r.querySelectorAll('[data-session]').forEach(function(n){n.open=sessionsOpen.has(n.dataset.session)});if(showDetails&&r.querySelector('.mm-current-details'))r.querySelector('.mm-current-details').open=true;
    if(actionFocus){var replacement=Array.from(r.querySelectorAll('[data-mm-digest-action]')).find(function(n){return n.dataset.mmSession===actionFocus.session&&n.dataset.mmDigestAction===actionFocus.action});if(replacement&&!replacement.disabled)replacement.focus({preventScroll:true});}
    r.querySelector('.mm-message').textContent='已刷新 · '+clock(Date.now());
    var intro=['后台准备记录','手动准备完成后随下一轮发送启用；自动任务仍等待缓存过期。'];
    r.querySelector('.mm-view-intro').innerHTML='<h4>'+escape(intro[0])+'</h4><p>'+escape(intro[1])+'</p>';
    r.querySelector('.mm-records').innerHTML=s.rows.map(function(row){return record(row,open.has(String(row.id)))}).join('')||'<div class="mm-empty-state"><b>暂无总结记录</b><p>后续产生的记录会自动显示在这里。</p></div>';
    r.querySelector('.mm-more').hidden=!s.cursor;
  }
  function schedule(){clearTimeout(timer);if(ckStatusTab==='fact')return;var fast=ckStatusTab==='digest'&&state.digest.data&&(state.digest.data.sessions||[]).some(function(s){return ['queued','running'].includes((s.model_run||{}).state||s.status)});timer=setTimeout(function(){if(currentPanelTab==='status'&&!document.hidden)ckRefreshMaintenance(false);else schedule()},fast?2000:15000);}
  window.ckRefreshMaintenance=async function(force,more){
    if(ckStatusTab==='fact'||currentPanelTab!=='status')return;
    if(ckStatusTab==='records')return ckRecordsRefresh();
    var section=ckStatusTab,key=storedPanelKey(),backend=GRAPH_API_BASE,identity=key+'\n'+backend,mySeq=++seq;
    if(section==='digest'&&!chatSessionsReady){chatLoadSessions();await chatEnsureSessionsReady();if(mySeq!==seq||key!==storedPanelKey()||section!==ckStatusTab)return;}
    if(principal!==identity){
      principal=identity;
      ['digest','events'].forEach(function(name){state[name]={rows:[],cursor:null,filter:'all',data:null};root(name).innerHTML='';});
    }
    var s=state[section];
    if(controller)controller.abort();var requestController=new AbortController();controller=requestController;
    var signal=requestController.signal,timeout=setTimeout(function(){requestController.abort()},15000);
    build(section);var r=root(section);r.querySelector('.mm-message').textContent='正在刷新…';
    var path='/ck/maintenance/status?section='+section+'&kind='+s.filter+(more&&s.cursor?'&before='+s.cursor:'')+(force?'&refresh=1':'');
    if(section==='events')path='/ck/event-automation';
    try{
      var response=await panelDataFetch(function(auth){if(auth!==key)throw new Error('连接已变化');return GRAPH_API_BASE+path},{cache:'no-store',signal:signal},{label:'整理状态'});
      var data=await response.json();if(!response.ok||data.ok===false)throw new Error(data.error||'状态读取失败');
      if(seq!==mySeq||key!==storedPanelKey()||backend!==GRAPH_API_BASE||section!==ckStatusTab)return;
      if(section==='digest'){
        var cfg=chatLoadConfig(),visible=new Set(chatSessions.filter(function(session){return !chatDigestIsDeleted(session.id,cfg)&&chatDigestHasContent(session)}).map(function(session){return String(session.id)}));
        data.sessions=(data.sessions||[]).filter(function(session){return visible.has(String(session.session_id))});
        data.history=Object.assign({},data.history,{items:((data.history||{}).items||[]).filter(function(row){return visible.has(String(row.session_id))})});
        s.rows=s.rows.filter(function(row){return visible.has(String(row.session_id))});
        // This endpoint carries progress metadata, not the saved summaries.
        // Reuse the queue reader and all its source/config/edit checks before
        // deriving button readiness; merely visiting status never starts a run.
        for(var remote of data.sessions){
          var local=chatSessions.find(function(session){return String(session.id)===String(remote.session_id)});
          var staged=local&&chatDigestStage(local,cfg);
          if(local&&(local.digestManualTrim||local.digestSettingsRequest||local.digestModelRun&&local.digestModelRun.purpose==='daily')&&
            (remote.ready_trim_groups>0||remote.status==='succeeded')&&(!staged||Number(remote.revision)>Number(staged.revision))){
            await chatSyncNightlyDigest(cfg,{session:local,readOnly:true});
            if(seq!==mySeq||key!==storedPanelKey()||backend!==GRAPH_API_BASE||section!==ckStatusTab||chatDigestConfigStamp(cfg)!==chatDigestConfigStamp(chatLoadConfig()))return;
          }
          if(local===chatCurrentSession())await chatDigestFinishManualTrim(cfg,local);
        }
      }
      s.data=data;s.receivedAt=Date.now();s.refreshFailed=false;
      var rows=data.history&&data.history.items||[];
      var overlap=rows.some(function(row){return s.rows.some(function(old){return old.id===row.id})});
      var reset=!more&&(force||!s.rows.length||!overlap),merged=new Map();
      (reset?rows:rows.concat(s.rows)).forEach(function(row){if(!merged.has(row.id))merged.set(row.id,row)});
      s.rows=Array.from(merged.values()).sort(function(a,b){return b.id-a.id});
      if(more||reset)s.cursor=data.history&&data.history.next_cursor;
      if(s.rows.length>500){s.rows=s.rows.slice(0,500);s.cursor=s.rows[s.rows.length-1].id;}
      render(section);
      if(section==='digest'&&!ticker)ticker=setInterval(tickProgress,1000);
    }catch(error){if(seq===mySeq){s.refreshFailed=true;r.querySelector('.mm-message').textContent=(error.name==='AbortError'?'刷新超时':error.message)+'；上次读取的内容仍保留。';if(section==='digest')tickProgress();}}
    finally{clearTimeout(timeout);if(seq===mySeq){controller=null;schedule();}}
  };
  window.ckSelectStatusTab=function(tab){
    if(tab==='records'){navTo('records');return;}
    ckStatusTab=['digest','events'].includes(tab)?tab:'fact';if(typeof ckOrganizingEnter==='function')ckOrganizingEnter();++seq;if(controller)controller.abort();clearTimeout(timer);
    ['fact','digest','events'].forEach(function(name){var active=name===ckStatusTab;el('ck-status-'+name).hidden=!active;var button=el('ck-status-tab-'+name);button.setAttribute('aria-selected',String(active));button.tabIndex=active?0:-1;});
    el('status-sub').textContent=ckStatusTab==='events'?'事件整理、Git 备份与预加载':ckStatusTab==='fact'?'每日 Fact 提取 · 任务与进度':'截断进度 · 阶段、耗时与同步结果';
    if(ckStatusTab==='fact'){loadDailyStatus(false);startDailyStatusRealtime();}else{stopDailyStatusRealtime();build(ckStatusTab);ckRefreshMaintenance(false);}
  };
  window.ckStatusEnter=function(){ckSelectStatusTab(ckStatusTab)};
  document.addEventListener('visibilitychange',function(){if(!document.hidden&&currentPanelTab==='status'&&ckStatusTab==='digest')ckRefreshMaintenance(false);else if(document.hidden){clearInterval(ticker);ticker=0;}});
  window.ckRefreshStatus=function(){if(typeof ckOrganizingEnter==='function')ckOrganizingEnter();if(ckStatusTab==='fact')loadDailyStatus(true);else ckRefreshMaintenance(true)};
  el('ck-status-tabs').addEventListener('keydown',function(e){
    if(!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;e.preventDefault();
    var tabs=['fact','digest','events'],index=tabs.indexOf(ckStatusTab);index=e.key==='Home'?0:e.key==='End'?tabs.length-1:(index+(e.key==='ArrowLeft'?tabs.length-1:1))%tabs.length;
    ckSelectStatusTab(tabs[index]);el('ck-status-tab-'+tabs[index]).focus();
  });
})();
