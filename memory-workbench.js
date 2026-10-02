/* Theme curation and recall C over existing Facts. */
(function(){
  'use strict';
  var state={key:'',loaded:false,revision:0,topics:[],draft:null,dirty:false,busy:false,conflict:false,request:null,loadSeq:0,searchSeq:0,results:[],offset:0,more:false,searching:false};
  var lab={running:false,seq:0,results:{}};
  var review=null;
  function el(id){return document.getElementById(id)}
  function clone(x){return JSON.parse(JSON.stringify(x))}
  function uid(){return window.crypto&&crypto.randomUUID?crypto.randomUUID():'topic_'+Date.now().toString(36)+'_'+Math.random().toString(36).slice(2)}
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
  function buildTopics(){
    var page=el('tab-topics');
    page.innerHTML=header('主题记忆','把同一段经历的 Fact 收在一起，随时沿着时间回看。','M5 4h14v16H5zM9 4v16M12 8h4M12 12h4M12 16h2')+
      '<div class="mw-toolbar">'+button('new','新建主题')+button('reload','载入最新目录')+button('topic-api','主题 API')+'<span class="mw-note">后台整理 · 疑点审批 · 聊天选择 C 按需读取</span></div>'+
      '<p id="mw-status" class="mw-status" role="status">正在读取主题目录…</p><div id="mw-organizer"></div><div class="mw-workspace"><aside class="mw-card mw-shelf" aria-label="主题目录"><h3>我的主题</h3><div id="mw-topics-list"></div></aside>'+
      '<div class="mw-detail"><div id="mw-topic-editor"></div><section id="mw-search" class="mw-card" hidden><h3>为主题找材料</h3><p class="mw-note">先填写主题名称和说明，再自动检索已有 Fact。每次最多显示 40 条候选；已加入的材料会排除，可继续检查新材料。无需整理全库。</p><div class="mw-toolbar">'+button('suggest','智能找材料／检查新材料')+button('local-suggest','仅关键词找材料')+button('add-selected','加入勾选材料')+'</div><p class="mw-cost">智能查找可能调用一次查询向量和一次主题选材模型；仅关键词不调用模型。模型建议仅预勾选，确认加入并保存后才生效。</p><form id="mw-search-form" class="mw-search-form"><label for="mw-query">搜索正文、人物或分类</label><div><input id="mw-query" type="search" maxlength="200" placeholder="例如：旅行、读书、某个项目" autocomplete="off"><button type="submit" class="btn btn-outline btn-sm">搜索 Fact</button></div></form><p class="mw-note" id="mw-search-status">只查询已有事实库，不调用模型。选中后，记得保存主题。</p><div id="mw-results"></div><div class="mw-toolbar">'+button('more','继续加载','id="mw-more" hidden')+'</div></section></div></div>';
    page.addEventListener('click',onTopicAction);
    page.addEventListener('input',function(e){if(!state.draft||state.busy)return;if(e.target.dataset.mwPick){var found=state.results.find(function(m){return m.fact_id===e.target.dataset.mwPick});if(found)found.picked=e.target.checked;return}if(['mw-title','mw-note','mw-aliases','mw-enabled'].indexOf(e.target.id)>=0){state.draft.title=el('mw-title').value;state.draft.note=el('mw-note').value;state.draft.aliases=el('mw-aliases').value.split(/[,，\n]/).map(function(x){return x.trim()}).filter(Boolean);state.draft.recall_enabled=el('mw-enabled').checked;++state.searchSeq;state.searching=false;markDirty()}});
    el('mw-search-form').addEventListener('submit',function(e){e.preventDefault();search(false)});
    if(window.memoryReviewMount)review=window.memoryReviewMount({
      canWrite:function(){return state.loaded&&!state.busy&&!state.dirty},revision:function(){return state.revision},
      request:async function(body){state.busy=true;syncButtons();try{return await request('/ck/memory-topics',body)}finally{state.busy=false;syncButtons()}},
      read:async function(){state.busy=true;syncButtons();try{return await request('/ck/memory-topics')}finally{state.busy=false;syncButtons()}},
      apply:function(data){var selected=state.draft&&state.draft.id;state.topics=data.topics;state.revision=data.revision;state.conflict=false;state.request=null;state.draft=clone(state.topics.find(function(t){return t.id===selected})||state.topics[0]||null);renderList();renderEditor();if(review)review.update(data)}
    });
  }
  function renderList(){
    el('mw-topics-list').innerHTML=state.topics.length?state.topics.map(function(t){return '<button type="button" class="mw-topic-link'+(state.draft&&state.draft.id===t.id?' selected':'')+'" data-mw="select" data-id="'+escAttr(t.id)+'" aria-pressed="'+!!(state.draft&&state.draft.id===t.id)+'"><b>'+esc(t.title)+'</b><small>'+t.materials.length+' 条材料'+(t.changed_count?' · '+t.changed_count+' 条有变化':'')+'</small></button>'}).join(''):'<p class="mw-empty">还没有主题。新建一个，收藏同一段经历中的小事。</p>';
  }
  function materialMarkup(m,removable){
    var missing=m.status==='missing',active=m.status==='active'||!m.status;
    return '<article class="mw-material"><div class="mw-material-head"><time>'+esc(m.time||'日期未记录')+'</time><span>'+esc(missing?'来源已缺失':!active?'已过期 · 历史状态':m.changed?'内容有更新':'有效 Fact')+'</span></div><p>'+esc(m.text||m.value||(missing?'原 Fact 已不存在，目录仍保留其编号。':'正文请打开 Fact 查看'))+'</p>'+
      (m.situation?'<small>'+esc(m.situation)+'</small>':'')+'<div class="mw-toolbar">'+(!missing?button('fact','查看原文与历史','data-id="'+escAttr(m.fact_id||m.fact_key)+'"'):'')+(removable?button('remove','移出主题','data-id="'+escAttr(m.fact_id||m.fact_key)+'"'):'')+'</div></article>';
  }
  function renderMaterials(){
    var d=state.draft;if(!d)return;
    function timeKey(value){var m=String(value||'').match(/(20\d{2})[年./-](\d{1,2})(?:[月./-](\d{1,2})日?)?/);return m?m[1]+'-'+m[2].padStart(2,'0')+'-'+(m[3]||'1').padStart(2,'0'):'9999'}
    var items=d.materials.slice().sort(function(a,b){return timeKey(a.time).localeCompare(timeKey(b.time))});
    message('mw-material-count',items.length+' / 200 条材料 · 按日期排列');
    el('mw-materials').innerHTML=items.length?items.map(function(m){return materialMarkup(m,true)}).join(''):'<p class="mw-empty">这个主题还没有材料。在下方搜索并加入 Fact。</p>';
  }
  function renderEditor(){
    var d=state.draft;el('mw-search').hidden=!d;
    if(!d){el('mw-topic-editor').innerHTML='<div class="mw-card mw-empty">选择一个主题，或新建主题开始整理。</div>';return}
    el('mw-topic-editor').innerHTML='<section class="mw-card"><div class="mw-editor-head"><h3>主题内容</h3><span id="mw-draft-status" class="mw-note">已保存</span></div><fieldset id="mw-editor-fields"><label for="mw-title">主题名称</label><input id="mw-title" maxlength="80" value="'+escAttr(d.title)+'" placeholder="给这段经历起个名字"><label for="mw-note">我的说明</label><textarea id="mw-note" rows="3" maxlength="2000" placeholder="这份目录想收下什么？">'+esc(d.note||'')+'</textarea><label for="mw-aliases">主题别名（逗号分隔，最多 12 个，每个至少 2 字）</label><input id="mw-aliases" maxlength="970" value="'+escAttr((d.aliases||[]).join('，'))+'" placeholder="例如：日本旅行、东京行程"><label class="mw-check"><input id="mw-enabled" type="checkbox" '+(d.recall_enabled!==false?'checked':'')+'>允许召回 C 使用这个主题</label></fieldset><div class="mw-toolbar">'+button('save','保存主题','id="mw-save"')+button('delete','删除主题','id="mw-delete"')+button('copy','复制目录')+'</div><p class="mw-note">保存只更新关联，不修改原始 Fact。聊天设置选择 C 后，提到主题名或别名会限定检索；普通问题命中相关材料时附目录。主题按时间展示当前有效材料，过期及被替代的版本不再收录。</p><h3 id="mw-material-count"></h3><div id="mw-materials" class="mw-timeline"></div></section>';
    renderMaterials();syncButtons();
  }
  function syncButtons(){
    if(el('mw-save'))el('mw-save').disabled=state.busy||state.conflict||!state.dirty||!String(state.draft.title).trim();
    if(el('mw-delete'))el('mw-delete').disabled=state.busy||state.conflict||!state.topics.some(function(t){return t.id===state.draft.id});
    if(el('mw-editor-fields'))el('mw-editor-fields').disabled=state.busy;
    message('mw-draft-status',state.busy?'正在保存…':state.conflict?'目录冲突 · 草稿保留':state.dirty?'尚未保存':'已保存');
    el('tab-topics').querySelectorAll('[data-mw="new"],[data-mw="reload"],[data-mw="select"],[data-mw="remove"],[data-mw="add"]').forEach(function(b){b.disabled=state.busy||(!state.loaded&&b.dataset.mw!=='reload')||(b.dataset.mw==='add'&&state.draft&&state.draft.materials.some(function(m){return m.fact_id===b.dataset.id}))});
  }
  function markDirty(){state.dirty=true;state.request=null;syncButtons()}
  async function discard(){return !state.dirty||await ckConfirmDialog('当前主题有未保存内容，是否放弃草稿？',{title:'保留当前编辑？',confirmText:'放弃草稿',cancelText:'继续编辑'})}
  async function load(force){
    if(state.busy)return;
    if(force&&!(await discard()))return;
    var seq=++state.loadSeq,key=state.key;state.busy=true;syncButtons();message('mw-status','正在读取最新目录…');
    try{
      var data=await request('/ck/memory-topics');if(seq!==state.loadSeq||!validKey(key))return;
      if(!Array.isArray(data.topics)||!Number.isInteger(data.revision))throw new Error('主题目录格式无效');
      var selected=state.draft&&state.draft.id;
      state.topics=data.topics;state.revision=data.revision;state.loaded=true;state.conflict=false;state.dirty=false;state.request=null;
      state.draft=clone(state.topics.find(function(t){return t.id===selected})||state.topics[0]||null);
      renderList();renderEditor();message('mw-status','目录已同步。保存到当前面板 Key 的主题目录，可跨设备读取。');
      if(review)review.update(data);
    }catch(e){if(validKey(key))message('mw-status',e.message)}
    finally{if(seq===state.loadSeq&&validKey(key)){state.busy=false;syncButtons()}}
  }
  async function save(action){
    if(state.busy||!state.draft||state.conflict)return;
    if(action==='delete'&&!(await ckConfirmDialog('仅删除这个主题目录，原始 Fact 会保留。',{title:'删除主题',confirmText:'删除主题',danger:true})))return;
    var d=state.draft,key=state.key;
    var body={action:action,id:d.id,expected_revision:state.revision,title:d.title,note:d.note,aliases:d.aliases||[],recall_enabled:d.recall_enabled!==false,material_stamps:Object.fromEntries(d.materials.filter(function(m){return m.stamp}).map(function(m){return [m.fact_id,m.stamp]})),fact_ids:d.materials.map(function(m){return m.fact_id})};
    var signature=JSON.stringify(body);
    if(!state.request||state.request.signature!==signature)state.request={signature:signature,body:Object.assign({request_id:uid()},body)};
    state.busy=true;syncButtons();message('mw-status','正在保存主题…');
    try{
      var data=await request('/ck/memory-topics',state.request.body);if(!validKey(key))return;
      state.topics=data.topics;state.revision=data.revision;state.dirty=false;state.request=null;
      state.draft=clone(data.topics.find(function(t){return t.id===d.id})||data.topics[0]||null);
      renderList();renderEditor();message('mw-status',action==='delete'?'主题已删除，原始 Fact 保留。':'主题已保存。');
      if(review)review.update(data);
    }catch(e){if(validKey(key)){state.conflict=e.status===409;message('mw-status',e.message+(state.conflict?' 可先复制目录保留草稿，再载入最新目录。':' 草稿已保留，可再次点击保存。'))}}
    finally{if(validKey(key)){state.busy=false;syncButtons()}}
  }
  async function search(more){
    if(!state.draft||state.busy||(more&&state.searching))return;
    var key=state.key,seq=++state.searchSeq,query=more?state.searchQuery:el('mw-query').value.trim(),offset=more?state.offset:0;
    if(!more){state.results=[];state.more=false;renderResults()}
    state.searching=true;message('mw-search-status','正在搜索已有 Fact…');el('mw-more').disabled=true;
    try{
      var data=await request('/entity-facts?state=active&sort=recent&limit=30&offset='+offset+'&q='+encodeURIComponent(query));
      if(seq!==state.searchSeq||!validKey(key))return;
      if(!Array.isArray(data.items)||!data.pagination)throw new Error('Fact 搜索格式无效');
      var eligible=data.items.filter(function(m){return (!m.status||m.status==='active')&&!m.superseded_by});state.results=more?state.results.concat(eligible):eligible;state.searchQuery=query;state.offset=data.pagination.next_offset;state.more=data.pagination.has_more;
      renderResults();message('mw-search-status','找到 '+data.pagination.total+' 条，已显示 '+state.results.length+' 条。加入后保存主题即可。');
    }catch(e){if(seq===state.searchSeq&&validKey(key)){message('mw-search-status',e.message);state.more=false;el('mw-more').hidden=true}}
    finally{if(seq===state.searchSeq&&validKey(key)){state.searching=false;el('mw-more').disabled=false}}
  }
  async function suggest(smart){
    if(!state.draft||state.busy||state.searching)return;
    var title=state.draft.title.trim();if(!title){message('mw-search-status','请先填写主题名称。');return}
    var key=state.key,seq=++state.searchSeq,draftId=state.draft.id;
    state.searching=true;state.more=false;message('mw-search-status','正在从已有 Fact 查找材料…');
    try{
      var data=await request('/ck/memory-topics',{action:'suggest',title:title,note:state.draft.note||'',exclude_ids:state.draft.materials.map(function(m){return m.fact_id}),smart:smart});
      if(!validKey(key)||seq!==state.searchSeq||!state.draft||state.draft.id!==draftId)return;
      state.results=data.items;renderResults();message('mw-search-status','检索 '+data.scanned+' 条有效 Fact，显示 '+data.candidate_count+' 条候选，模型建议 '+data.recommended_count+' 条。请核对勾选后加入并保存。 '+(data.warnings||[]).join(' '));
    }catch(e){if(validKey(key)&&seq===state.searchSeq)message('mw-search-status',e.message)}
    finally{if(validKey(key)&&seq===state.searchSeq)state.searching=false}
  }
  function renderResults(){
    var ids=new Set((state.draft&&state.draft.materials||[]).map(function(m){return m.fact_id}));
    el('mw-results').innerHTML=state.results.map(function(m){var id=m.fact_id||m.fact_key;return '<article class="mw-search-result"><label class="mw-pick"><input type="checkbox" data-mw-pick="'+escAttr(id)+'" aria-label="选择此材料" '+(ids.has(id)?'disabled':(m.picked===undefined?m.recommended:m.picked)?'checked':'')+'></label><div><small>'+esc(m.time||'日期未记录')+(m.status==='expired'?' · 已过期 · 历史状态':'')+' · '+esc(m.recommended?'模型建议':m.category||m.field||'Fact')+'</small><p>'+esc(m.text||m.value||'')+'</p></div>'+button('add',ids.has(id)?'已加入':'加入主题','data-id="'+escAttr(id)+'"'+(ids.has(id)?' disabled':''))+'</article>'}).join('')||'<p class="mw-empty">没有找到匹配的 Fact，换个关键词试试。</p>';
    el('mw-more').hidden=!state.more;
  }
  async function onTopicAction(e){
    var b=e.target.closest('[data-mw]');if(!b||b.disabled)return;var action=b.dataset.mw,id=b.dataset.id;
    if(action==='topic-api'){navTo('apiconfig');switchApiTab('topics');return}
    if(action==='fact'){openFactDetail(id);return}
    if(action==='copy'){
      var d=state.draft;if(!d)return;
      var text=d.title+'\n'+(d.note||'')+'\n\n'+d.materials.map(function(m){return (m.time||'日期未记录')+' ['+(m.status||'active')+'] '+(m.text||m.fact_id)}).join('\n\n');
      try{await navigator.clipboard.writeText(text);message('mw-status','目录已复制。')}catch(err){message('mw-status','复制未成功，请允许浏览器访问剪贴板。')}return;
    }
    if(state.busy)return;
    if(action==='reload'){await load(true);return}
    if(action==='new'||action==='select'){
      if(!state.loaded||!(await discard()))return;
      state.draft=action==='new'?{id:uid(),title:'',note:'',materials:[]}:clone(state.topics.find(function(t){return t.id===id}));
      state.dirty=action==='new';state.request=null;state.conflict=false;state.results=[];state.more=false;state.searching=false;++state.searchSeq;
      renderList();renderEditor();renderResults();message('mw-status',action==='new'?'填写主题名称，再挑选材料。':'正在查看已保存的主题。');return;
    }
    if(action==='save'||action==='delete'){await save(action);return}
    if(action==='suggest'||action==='local-suggest'){await suggest(action==='suggest');return}
    if(action==='add-selected'){var selected=Array.from(el('mw-results').querySelectorAll('[data-mw-pick]:checked')).map(function(n){return n.dataset.mwPick});selected.forEach(function(fid){var f=state.results.find(function(m){return m.fact_id===fid});if(f&&state.draft.materials.length<200&&!state.draft.materials.some(function(m){return m.fact_id===fid}))state.draft.materials.push(clone(f))});markDirty();renderMaterials();renderResults();message('mw-status','已加入勾选材料，请核对后保存主题（每主题最多 200 条）。');return}
    if(action==='more'){await search(true);return}
    if(action==='remove'){state.draft.materials=state.draft.materials.filter(function(m){return m.fact_id!==id});markDirty();renderMaterials();renderResults();return}
    if(action==='add'){
      if(!state.draft||state.draft.materials.some(function(m){return m.fact_id===id}))return;
      if(state.draft.materials.length>=200){message('mw-status','每个主题最多关联 200 条 Fact。');return}
      var found=state.results.find(function(m){return (m.fact_id||m.fact_key)===id});if(!found)return;
      var material=clone(found);material.fact_id=id;state.draft.materials.push(material);markDirty();renderMaterials();renderResults();
    }
  }
  function buildLab(){
    var page=el('tab-recall-lab');
    page.innerHTML=header('召回实验','用同一个问题，对照 A、B、C 会想起哪些 Fact。','M5 5h5v14H5zM14 5h5v14h-5M7 9h1M16 13h1')+
      '<section class="mw-card"><form id="mw-lab-form"><label for="mw-lab-query">想测试的问题</label><textarea id="mw-lab-query" rows="3" maxlength="2000" required placeholder="例如：上次说的旅行安排是什么？"></textarea><details class="mw-context"><summary>补充前文（可选）</summary><label for="mw-lab-context">上一条用户消息</label><textarea id="mw-lab-context" rows="2" maxlength="2000" placeholder="用于理解“那个”“上次”等指代；不会读取聊天窗口历史。"></textarea></details><div class="mw-toolbar"><label for="mw-lab-mode">运行方案</label><select id="mw-lab-mode"><option value="both">A / B 对比</option><option value="all">A / B / C 对比</option><option value="c">只运行 C（主题辅助）</option><option value="a">只运行 A（严格）</option><option value="b">只运行 B（宽松）</option></select><button class="btn btn-blue btn-sm" id="mw-lab-run" type="submit">运行对比</button>'+button('api','选择供应商与模型')+'</div></form><p class="mw-cost">仅点击运行时调用现有召回 API，可能计费。A/B 对比各跑一次，B 可能包含改写和精筛两步；提前跳过或缓存命中时调用会减少。</p><p class="mw-note">使用“召回 → 意图改写、向量化”配置。实验不发送聊天回复、不记召回次数、不改变聊天设置；本页不模拟窗口冷却。C 会展示相关主题目录，实验不继续调用聊天模型展开材料。</p><p id="mw-provider-summary" class="mw-note"></p></section><p class="mw-status" id="mw-lab-status" role="status">填写问题后运行。模型结果可能波动，命中多不等于更相关。</p><div id="mw-comparison" class="mw-comparison"></div>';
    el('mw-lab-form').addEventListener('submit',function(e){e.preventDefault();runLab()});
    page.addEventListener('click',function(e){var b=e.target.closest('[data-mw]');if(!b)return;if(b.dataset.mw==='api'){navTo('apiconfig');switchApiTab('experiment')}if(b.dataset.mw==='fact')openFactDetail(b.dataset.id)});
    el('mw-lab-mode').addEventListener('change',function(){el('mw-lab-run').textContent=this.value==='both'?'运行对比':'运行模拟'});
  }
  function providerSummary(){
    if(!apiProvidersLoaded){message('mw-provider-summary','供应商详情可在“实验 API”页查看和选择。');return}
    message('mw-provider-summary',['recall_rewrite','recall_vector'].map(function(group){var s=apiGroupSlot(group),p=findLibraryProvider(s.current);return (group==='recall_rewrite'?'改写／精筛':'向量')+'：'+(p?providerDisplayName(p)+' · '+(s.model||p.model||'未选模型'):'使用现有后端配置（请在 API 页核对）')}).join('；'));
  }
  function resultMarkup(path,result){
    var label=path==='a'?'A · 严格':path==='c'?'C · 主题辅助':'B · 宽松';
    if(result.pending)return '<section class="mw-card"><h3>'+label+'</h3><p class="mw-note">正在运行…</p></section>';
    if(result.error)return '<section class="mw-card"><h3>'+label+'</h3><p class="mw-status">'+esc(result.error)+'</p></section>';
    var d=result.diag||{},items=result.items||[],candidates=d.candidate_preview||[];
    var html='<section class="mw-card"><div class="mw-editor-head"><h3>'+label+'</h3><small>'+esc(result.elapsed_seconds)+' 秒</small></div><p class="mw-result-count">选中 '+items.length+' 条 Fact</p>';
    (result.warnings||[]).forEach(function(w){html+='<p class="mw-cost">'+esc(w)+'</p>'});
    html+=items.length?'<div class="mw-selected">'+items.map(function(m){var candidate=candidates.find(function(c){return c.fact_id===m.fact_id})||{};return '<article><p>'+esc(candidate.content_preview||m.situation||m.fact_id)+'</p>'+button('fact','查看 Fact','data-id="'+escAttr(m.fact_id)+'"')+'</article>'}).join('')+'</div>':'<p class="mw-empty">本次没有选中记忆。查看下方诊断，区分主动跳过与筛选未通过。</p>';
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
    if(tab!=='topics'&&tab!=='recall-lab')return;
    var key=storedPanelKey();
    if(state.key!==key){state={key:key,loaded:false,revision:0,topics:[],draft:null,dirty:false,busy:false,conflict:false,request:null,loadSeq:state.loadSeq+1,searchSeq:state.searchSeq+1,results:[],offset:0,more:false,searching:false};lab={running:false,seq:lab.seq+1,results:{}};el('tab-topics').replaceWith(el('tab-topics').cloneNode(false));el('tab-recall-lab').replaceWith(el('tab-recall-lab').cloneNode(false))}
    if(!el('mw-status'))buildTopics();if(!el('mw-lab-form'))buildLab();
    if(tab==='topics'&&!state.loaded&&!state.busy)load(false);
    if(tab==='recall-lab')providerSummary();
  };
  window.addEventListener('beforeunload',function(e){if(state.dirty||(review&&review.hasDraft())){e.preventDefault();e.returnValue=''}});
})();
