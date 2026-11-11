/* Existing event memories and A/B/C recall experiments. */
(function(){
  'use strict';
  var state={key:'',eventSeq:0,eventsLoaded:false};
  var lab={running:false,seq:0,results:{}};
  function el(id){return document.getElementById(id)}
  function validKey(key){return state.key===key&&storedPanelKey()===key}
  function message(id,text){var node=el(id);if(node)node.textContent=text}
  function button(action,label,extra){return '<button type="button" class="btn btn-outline btn-sm" data-mw="'+action+'" '+(extra||'')+'>'+esc(label)+'</button>'}
  function header(title,description,path){return '<header class="ck-notebook-heading"><span class="ck-notebook-stamp"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="'+path+'"/></svg></span><div><h2>'+title+'</h2><p>'+description+'</p></div></header>'}
  async function request(path,body){
    var key=state.key,controller=new AbortController(),timer=setTimeout(function(){controller.abort()},path==='/ck/recall-experiment'?240000:90000);
    var response;
    try{response=await panelDataFetch(function(authKey){if(authKey!==key)throw new Error('面板 Key 已变化，请重新进入本页。');return GRAPH_API_BASE+path},body===undefined?{cache:'no-store',signal:controller.signal}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:controller.signal},{label:'记忆工作台'})}
    catch(e){if(e.name==='AbortError')throw new Error('等待超时。服务端可能仍在处理，请稍后核对结果。');throw e}
    finally{clearTimeout(timer)}
    var data;try{data=await response.json()}catch(e){throw new Error('返回内容无法读取，请重试')}
    if(!validKey(key))throw new Error('面板 Key 已变化，请重新进入本页。');
    if(!response.ok||!data||data.ok===false){var error=new Error(data&&data.error||(response.status===404?'请先更新 CK 网关，再使用此功能':'读取失败（HTTP '+response.status+'）'));error.status=response.status;throw error}
    return data;
  }
  function buildEvents(){
    var page=el('tab-events');
    page.innerHTML=header('事件记忆','查看事情的起因、经过与结果，随时核对原始出处。','M5 4h14v16H5zM9 4v16M12 8h4M12 12h4M12 16h2')+'<section id="mw-events" class="mw-reader"></section>';
    page.addEventListener('click',function(e){
      var button=e.target.closest('[data-mw]');if(!button)return;
      var action=button.dataset.mw;
      if(action==='fact')openFactDetail(button.dataset.id);
      else if(action==='events-vps')showEvents(false);
      else if(action==='events-git')showEvents(true);
      else if(action==='events-status'){navTo('status');ckSelectStatusTab('events');}
    });
  }

  async function showEvents(fromGit){
    var key=state.key,seq=(state.eventSeq||0)+1;state.eventSeq=seq;
    var root=el('mw-events');root.hidden=false;root.textContent='正在读取事件记忆…';
    try{
      var data=await request('/ck/event-memories'+(fromGit?'?source=git':''));
      if(!validKey(key)||state.eventSeq!==seq)return;
      var events=data.events.slice().sort(function(a,b){return String(b.latest_date||'').localeCompare(String(a.latest_date||''))||String(b.id||'').localeCompare(String(a.id||''))});
      var git=data.git||{},status=data.status||{};
      root.innerHTML='<header class="mw-reader-head"><h3>事件记忆'+(fromGit?' · Git 备份':'')+'</h3></header><div class="mw-toolbar">'+button('events-vps','刷新 VPS 内容')+button('events-git','拉取 Git 备份')+button('events-status','自动化与状态')+'</div><p class="mw-note">'+esc(fromGit?'这是独立保存的备份，可能包含已失效的旧记录；聊天只召回当前证据有效的事件。':'按最新材料日期从近到远排列；无日期的事件放在最后。点击出处可核对原始 Fact。')+'</p><p role="status">'+events.length+' 条事件 · '+esc(git.status==='synced'?'Git 已同步':git.status==='restored'?'已从 Git 恢复':git.status==='retry'?'Git 同步待重试':'Git 同步待确认')+(status.manual_pending_scopes?' · '+status.manual_pending_scopes+' 组旧材料待人工整理':'')+'</p>'+
        '<label for="mw-event-search">查找事件</label><input id="mw-event-search" type="search" placeholder="输入事件、人物或细节"><p id="mw-event-count" class="mw-note"></p><div id="mw-event-cards"></div><button class="btn btn-outline btn-sm" id="mw-event-more" type="button" hidden>显示更多事件</button>';
      var limit=30;
      function renderCards(){
        var query=el('mw-event-search').value.trim().toLowerCase();
        var matched=events.filter(function(event){return !query||(event.title+' '+event.beats.map(function(b){return b.text}).join(' ')).toLowerCase().includes(query)});
        el('mw-event-cards').innerHTML=matched.slice(0,limit).map(function(event){return '<article class="mw-card"><h4>'+esc(event.title)+'</h4><p class="mw-note">'+esc(event.latest_date?(event.earliest_date!==event.latest_date?event.earliest_date+' 至 '+event.latest_date:event.latest_date):'事件日期未确认')+'</p>'+event.beats.map(function(beat){return '<p>'+esc(beat.text)+'</p><div class="mw-toolbar">'+beat.fact_ids.map(function(fid){return button('fact','查看出处','data-id="'+escAttr(fid)+'"')}).join('')+'</div>'}).join('')+(event.unresolved?'<p class="mw-note">尚未确定：'+esc(event.unresolved)+'</p>':'')+'<details><summary>查看召回正文</summary><pre style="white-space:pre-wrap;overflow-wrap:anywhere">'+esc(event.injection)+'</pre><p class="mw-note">这是该事件的正文。实际注入可能包含其他命中事件，并使用网关统一的记忆边界包装。</p></details></article>'}).join('')||'<p>暂无匹配事件。</p>';
        el('mw-event-count').textContent='显示 '+Math.min(limit,matched.length)+' / '+matched.length+' 条';
        el('mw-event-more').hidden=limit>=matched.length;
      }
      el('mw-event-search').oninput=function(){limit=30;renderCards()};
      el('mw-event-more').onclick=function(){limit+=30;renderCards()};
      renderCards();state.eventsLoaded=true;

    }catch(e){if(validKey(key)&&state.eventSeq===seq)root.innerHTML='<p role="alert">'+esc(e.message)+'</p>'+button('events-vps','重新读取')}
  }

  function buildLab(){
    var page=el('tab-recall-lab');
    page.innerHTML=header('召回实验','用同一个问题，对照 A、B、C 会想起哪些 Fact。','M5 5h5v14H5zM14 5h5v14h-5M7 9h1M16 13h1')+
      '<section class="mw-card"><form id="mw-lab-form"><label for="mw-lab-query">想测试的问题</label><textarea id="mw-lab-query" rows="3" maxlength="2000" required placeholder="例如：上次说的旅行安排是什么？"></textarea><details class="mw-context"><summary>补充前文（可选）</summary><label for="mw-lab-context">上一条用户消息</label><textarea id="mw-lab-context" rows="2" maxlength="2000" placeholder="用于理解“那个”“上次”等指代；不会读取聊天窗口历史。"></textarea></details><div class="mw-toolbar"><label for="mw-lab-mode">运行方案</label><select id="mw-lab-mode"><option value="both">A / B 对比</option><option value="all">A / B / C 对比</option><option value="c">只运行 C（事件脉络）</option><option value="a">只运行 A（严格）</option><option value="b">只运行 B（宽松）</option></select><button class="btn btn-blue btn-sm" id="mw-lab-run" type="submit">运行对比</button>'+button('api','选择供应商与模型')+'</div></form><p class="mw-cost">仅点击运行时调用现有召回 API，可能计费。A/B 对比各跑一次，B 可能包含改写和精筛两步；提前跳过或缓存命中时调用会减少。</p><p class="mw-note">使用“召回 → 意图改写、向量化”配置。实验不发送聊天回复、不记召回次数、不改变聊天设置；本页不模拟窗口冷却。C 从 VPS 预加载的事件中选择相关脉络，使用召回 API；事件整理在后台完成。尚未整理的旧材料暂时从内存中的 Fact 补充。</p><p id="mw-provider-summary" class="mw-note"></p></section><p class="mw-status" id="mw-lab-status" role="status">填写问题后运行。模型结果可能波动，命中多不等于更相关。</p><div id="mw-comparison" class="mw-comparison"></div>';
    el('mw-lab-form').addEventListener('submit',function(e){e.preventDefault();runLab()});
    page.addEventListener('click',function(e){var b=e.target.closest('[data-mw]');if(!b)return;if(b.dataset.mw==='api'){navTo('apiconfig');switchApiTab('recall')}if(b.dataset.mw==='fact')openFactDetail(b.dataset.id)});
    el('mw-lab-mode').addEventListener('change',function(){el('mw-lab-run').textContent=this.value==='both'?'运行对比':'运行模拟'});
  }
  function providerSummary(){
    if(!apiProvidersLoaded){message('mw-provider-summary','供应商详情可在“API → 召回”页查看和选择。');return}
    message('mw-provider-summary',['recall_rewrite','recall_vector'].map(function(group){var s=apiGroupSlot(group),p=findLibraryProvider(s.current);return (group==='recall_rewrite'?'改写／精筛':'向量')+'：'+(p?providerDisplayName(p)+' · '+(s.model||p.model||'未选模型'):'使用现有后端配置（请在 API 页核对）')}).join('；'));
  }
  function resultMarkup(path,result){
    var label=path==='a'?'A · 严格':path==='c'?'C · 事件脉络':'B · 宽松';
    if(result.pending)return '<section class="mw-card"><h3>'+label+'</h3><p class="mw-note">正在运行…</p></section>';
    if(result.error)return '<section class="mw-card"><h3>'+label+'</h3><p class="mw-status">'+esc(result.error)+'</p></section>';
    var d=result.diag||{},items=result.items||[],candidates=d.candidate_preview||[],events=(d.topic_recall||{}).events||[];
    var html='<section class="mw-card"><div class="mw-editor-head"><h3>'+label+'</h3><small>'+esc(result.elapsed_seconds)+' 秒</small></div><p class="mw-result-count">选中 '+(path==='c'?events.length+' 个事件':items.length+' 条 Fact')+'</p>';
    (result.warnings||[]).forEach(function(w){html+='<p class="mw-cost">'+esc(w)+'</p>'});
    if(path==='c'){html+=events.map(function(t){return '<article><h4>'+esc(t.title)+'</h4><p>'+esc(t.summary||'')+'</p></article>'}).join('')||(result.text?'':'<p class="mw-empty">本次没有相关事件。</p>')}else html+=items.length?'<div class="mw-selected">'+items.map(function(m){var candidate=candidates.find(function(c){return c.fact_id===m.fact_id})||{};return '<article><p>'+esc(candidate.content_preview||m.situation||m.fact_id)+'</p>'+button('fact','查看 Fact','data-id="'+escAttr(m.fact_id)+'"')+'</article>'}).join('')+'</div>':'<p class="mw-empty">本次没有选中记忆。查看下方诊断，区分主动跳过与筛选未通过。</p>';
    if(result.text)html+='<details><summary>将交给模型的记忆文本（预览）</summary><pre>'+esc(result.text)+'</pre></details>';
    html+='<details><summary>候选、分数与筛选原因</summary><p class="mw-note">这里是诊断保留的候选预览，未必包含全部候选；两种路径的分数不直接等价。</p>';
    html+=candidates.map(function(c){return '<article class="mw-candidate"><p>'+esc(c.content_preview||c.fact_id)+'</p><small>'+esc(c.selected?'选中':c.rejection_reason||'未选中')+' · 相似度 '+esc(c.similarity==null?'未记录':c.similarity)+' · 分数 '+esc(c.score==null?'未记录':c.score)+'</small></article>'}).join('');
    html+='<pre>'+esc(JSON.stringify({topic:d.topic_recall||null,gate:d.recall_gate||null,model_steps:d.model_steps||{},counts:d.counts||{},filter_reasons:d.filter_reasons||{},selection:d.fact_selection||{},fact_generation:d.fact_generation||null,vector_generation:d.vector_generation||null,phases:d.phases||[]},null,2))+'</pre></details></section>';
    return html;
  }
  function renderComparison(){el('mw-comparison').innerHTML=Object.keys(lab.results).map(function(path){return resultMarkup(path,lab.results[path])}).join('')}
  async function runLab(){
    if(lab.running)return;
    var query=el('mw-lab-query').value.trim(),context=el('mw-lab-context').value.trim();if(!query)return;
    var paths=el('mw-lab-mode').value==='both'?['a','b']:el('mw-lab-mode').value==='all'?['a','b','c']:[el('mw-lab-mode').value],seq=++lab.seq,key=state.key;
    lab.running=true;lab.results={};paths.forEach(function(p){lab.results[p]={pending:true}});renderComparison();
    ['mw-lab-run','mw-lab-mode','mw-lab-query','mw-lab-context'].forEach(function(id){el(id).disabled=true});
    message('mw-lab-status','实验运行中。请勿重复点击，离开本页后仍可返回查看结果。');
    try{
      // Sequential runs avoid doubling instantaneous load on the normal recall providers.
      for(var i=0;i<paths.length;i++){
        if(!validKey(key)||seq!==lab.seq)return;
        var result;
        try{result=await request('/ck/recall-experiment',{query:query,context:context,path:paths[i]})}
        catch(e){result={error:e.message}}
        if(!validKey(key)||seq!==lab.seq)return;lab.results[paths[i]]=result;renderComparison();
      }
      var failed=paths.filter(function(p){return lab.results[p].error}).length;
      var text=failed?'实验结束，'+failed+' 个方案未成功；成功结果已保留。':'实验完成。未增加召回统计，也未修改聊天设置。';
      if(paths.length===2&&!failed){var a=new Set(lab.results.a.items.map(function(x){return x.fact_id})),b=new Set(lab.results.b.items.map(function(x){return x.fact_id}));text+=' 共同选中 '+Array.from(a).filter(function(id){return b.has(id)}).length+' 条，只有 A '+Array.from(a).filter(function(id){return !b.has(id)}).length+' 条，只有 B '+Array.from(b).filter(function(id){return !a.has(id)}).length+' 条。'}
      message('mw-lab-status',text);
    }finally{if(seq===lab.seq&&validKey(key)){lab.running=false;['mw-lab-run','mw-lab-mode','mw-lab-query','mw-lab-context'].forEach(function(id){el(id).disabled=false})}}
  }
  window.memoryWorkbenchEnter=function(tab){
    if(tab!=='events'&&tab!=='recall-lab')return;
    var key=storedPanelKey();
    if(state.key!==key){
      state={key:key,eventSeq:state.eventSeq+1,eventsLoaded:false};
      lab={running:false,seq:lab.seq+1,results:{}};
      ['tab-events','tab-recall-lab'].forEach(function(id){var node=el(id);node.replaceWith(node.cloneNode(false));});
    }
    if(tab==='events'){
      if(!el('mw-events'))buildEvents();
      if(!state.eventsLoaded)showEvents(false);
    }else{
      if(!el('mw-lab-form'))buildLab();
      providerSummary();
    }
  };
})();
