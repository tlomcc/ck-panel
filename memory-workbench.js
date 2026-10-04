/* Theme curation and recall C over existing Facts. */
(function(){
  'use strict';
  var state={key:'',loaded:false,revision:0,topics:[],groups:[],draft:null,dirty:false,busy:false,conflict:false,request:null,loadSeq:0,searchSeq:0,results:[],offset:0,more:false,searching:false};
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
    var page=el('tab-topics');state.view='groups';state.group='';state.query='';state.materialLimit=30;state.materialOrder='recent';state.materialQuery='';
    page.innerHTML=header('主题记忆','从一个主题，读回事情的前因后果。','M5 4h14v16H5zM9 4v16M12 8h4M12 12h4M12 16h2')+
      '<div class="mw-library-toolbar"><label class="mw-directory-search"><span class="sr-only">搜索主题目录</span><input id="mw-directory-query" type="search" placeholder="搜索大主题、小主题或摘要" autocomplete="off"></label>'+button('new','新建小主题')+button('monitor','整理状态')+button('events','全部事件')+'<details class="mw-menu"><summary aria-label="更多目录操作">···</summary><div>'+button('reload','刷新目录')+button('topic-api','主题 API')+'</div></details></div>'+
      '<p id="mw-status" class="mw-library-status" role="status">正在读取主题目录…</p><nav id="mw-breadcrumb" class="mw-breadcrumb" aria-label="主题路径"></nav><div id="mw-directory-heading"></div><div id="mw-topics-list" class="mw-directory-grid"></div><div id="mw-topic-editor"></div><section id="mw-events" class="mw-reader" hidden></section>'+
      '<details class="mw-library-help"><summary>主题、摘要与召回如何使用</summary><p>大主题收纳小主题，主题负责归类和浏览，事件记录事情的起因、变化和结果，Fact 保留原始证据。主题摘要用于目录介绍，C 召回以事件为准。你可以直接改名、修改摘要与说明、移动归属、移出材料、关闭召回或暂停整理。自动处理记录可在状态页查看和撤销。编辑目录不会删除原始 Fact。</p></details>';
    page.addEventListener('click',onTopicAction);
    page.addEventListener('input',function(e){
      var id=e.target.id;
      if(id==='mw-directory-query'){state.query=e.target.value.trim().toLocaleLowerCase();renderList();return}
      if(id==='mw-material-query'){state.materialQuery=e.target.value.trim().toLocaleLowerCase();state.materialLimit=30;renderMaterials();return}
      if(!state.draft||state.busy)return;
      if(['mw-title','mw-note','mw-aliases','mw-group','mw-summary'].indexOf(id)>=0){
        state.draft.group_title=el('mw-group').value;state.draft.title=el('mw-title').value;state.draft.note=el('mw-note').value;
        state.draft.aliases=el('mw-aliases').value.split(/[,，\n]/).map(function(x){return x.trim()}).filter(Boolean);
        state.draft.summary=el('mw-summary').value;if(id==='mw-summary')state.draft.summary_edited=true;markDirty();
      }
    });
    page.addEventListener('change',function(e){
      if(e.target.id==='mw-material-order'){state.materialOrder=e.target.value;renderMaterials();return}
      if(e.target.id==='mw-enabled'&&state.draft){var dirty=state.dirty;state.draft.recall_enabled=e.target.checked;markDirty();if(!dirty)save('save');}
    });
    if(window.memoryReviewMount)review=window.memoryReviewMount({
      canWrite:function(){return state.loaded&&!state.busy&&!state.dirty},revision:function(){return state.revision},
      request:async function(body){state.busy=true;syncButtons();try{return await request('/ck/memory-topics',body)}finally{state.busy=false;syncButtons()}},
      read:async function(){state.busy=true;syncButtons();try{return await request('/ck/memory-topics')}finally{state.busy=false;syncButtons()}},
      apply:function(data){applyData(data);renderList();renderEditor();if(review)review.update(data);if(window.ckRefreshMaintenance)ckRefreshMaintenance(false)}
    });
  }
  function applyData(data){
    var selected=state.draft&&state.draft.id;
    state.topics=data.topics;state.groups=data.topic_groups||[];state.revision=data.revision;state.loaded=true;state.conflict=false;state.request=null;
    state.draft=clone(state.topics.find(function(t){return t.id===selected})||null);
    if(state.view==='detail'&&!state.draft)state.view=state.group?'topics':'groups';
  }
  function breadcrumb(){
    var current=state.view||'groups';
    el('mw-breadcrumb').innerHTML='<ol><li>'+button('root','全部大主题',current==='groups'?'aria-current="page"':'')+'</li>'+(current!=='groups'?'<li><span aria-hidden="true">/</span>'+button('group',state.group||'待归类','data-group="'+escAttr(state.group||'')+'"'+(current==='topics'?' aria-current="page"':''))+'</li>':'')+(current==='detail'&&state.draft?'<li><span aria-hidden="true">/</span><span aria-current="page">'+esc(state.draft.title||'新主题')+'</span></li>':'')+'</ol>';
  }
  function renderList(){
    var shelf=el('mw-topics-list');if(!shelf)return;breadcrumb();
    shelf.hidden=state.view==='detail';el('mw-directory-heading').hidden=state.view==='detail';
    if(state.view==='detail')return;
    var groups=new Map();state.topics.forEach(function(t){var name=t.group_title||'';if(!groups.has(name))groups.set(name,[]);groups.get(name).push(t)});
    var query=state.query||'',match=function(t){return !query||[t.title,t.group_title,t.summary,(t.aliases||[]).join(' ')].join(' ').toLocaleLowerCase().includes(query)};
    var arrow='<span class="mw-directory-arrow" aria-hidden="true">↗</span>';
    if(state.view==='groups'){
      el('mw-directory-heading').innerHTML='<div class="mw-directory-heading"><h3 tabindex="-1">我的主题目录</h3><span>'+groups.size+' 个大主题 · '+state.topics.length+' 个小主题</span></div>';
      shelf.innerHTML=Array.from(groups).filter(function(pair){return !query||pair[0].toLocaleLowerCase().includes(query)||pair[1].some(match)}).map(function(pair){
        var name=pair[0],topics=pair[1],group=state.groups.find(function(g){return g.title===name})||{},count=new Set(topics.flatMap(function(t){return t.materials.map(function(m){return m.fact_id})})).size;
        return '<button class="mw-directory-card mw-group-card" type="button" data-mw="group" data-group="'+escAttr(name)+'"><span class="mw-directory-kicker">大主题</span><span class="mw-directory-title">'+esc(name||'待归类')+'</span><span class="mw-directory-excerpt">'+esc(group.summary||topics.slice(0,3).map(function(t){return t.title}).join(' · '))+'</span><span class="mw-directory-meta">'+topics.length+' 个小主题 <i>·</i> '+count+' 条明细</span>'+arrow+'</button>';
      }).join('')||'<p class="mw-empty">'+(query?'没有匹配的主题，试试更短的关键词。':'还没有主题。可以先新建一个小主题。')+'</p>';
    }else{
      var list=(groups.get(state.group)||[]).filter(match),group=state.groups.find(function(g){return g.title===state.group})||{};
      el('mw-directory-heading').innerHTML='<div class="mw-directory-heading"><h3 tabindex="-1">'+esc(state.group||'待归类')+'</h3><span>'+list.length+' 个小主题</span></div>'+(group.summary?'<p class="mw-directory-intro">'+esc(group.summary)+'</p>':'');
      shelf.innerHTML=list.map(function(t){return '<button class="mw-directory-card mw-leaf-card" type="button" data-mw="select" data-id="'+escAttr(t.id)+'"><span class="mw-directory-title">'+esc(t.title)+'</span><span class="mw-directory-excerpt">'+esc(t.summary||t.note||'进入后查看明细')+'</span><span class="mw-directory-meta">'+t.materials.length+' 条明细 <i>·</i> '+(t.recall_enabled===false?'召回已关闭':'允许召回')+(t.changed_count?' · 有更新':'')+'</span>'+arrow+'</button>'}).join('')||'<p class="mw-empty">'+(query?'这个目录下没有匹配的小主题。':'此目录还没有小主题。')+'</p>';
    }
  }
  function materialMarkup(m){
    var missing=m.status==='missing',body=String(m.text||m.value||(missing?'原 Fact 已不存在，目录仍保留编号。':'打开原文查看完整内容。'));
    return '<article class="mw-material"><div class="mw-material-head"><time>'+esc(m.time||'日期未记录')+'</time><span>'+esc(missing?'来源已缺失':m.changed?'内容已更新':'')+'</span></div>'+
      (body.length>420?'<details class="mw-long-material"><summary>'+esc(body.slice(0,160))+'… <span>展开全文</span></summary><p>'+esc(body)+'</p></details>':'<p>'+esc(body)+'</p>')+
      '<details class="mw-material-actions"><summary>原文与关联操作</summary>'+(m.situation?'<p class="mw-note">'+esc(m.situation)+'</p>':'')+'<div class="mw-toolbar">'+(!missing?button('fact','查看原文与历史','data-id="'+escAttr(m.fact_id)+'"'):'')+button('remove','移出此主题','data-id="'+escAttr(m.fact_id)+'"')+'</div></details></article>';
  }
  function renderMaterials(){
    var d=state.draft;if(!d||!el('mw-materials'))return;
    function timeKey(value){var m=String(value||'').match(/(20\d{2})[年./-](\d{1,2})(?:[月./-](\d{1,2})日?)?/);return m?m[1]+'-'+m[2].padStart(2,'0')+'-'+(m[3]||'1').padStart(2,'0'):''}
    var query=state.materialQuery||'',items=d.materials.filter(function(m){return !query||[m.text,m.time,m.situation].join(' ').toLocaleLowerCase().includes(query)}).sort(function(a,b){return timeKey(a.time).localeCompare(timeKey(b.time))*(state.materialOrder==='oldest'?1:-1)});
    var shown=items.slice(0,state.materialLimit||30);
    message('mw-material-count',items.length+' 条明细'+(query?' · 已筛选':''));
    el('mw-materials').innerHTML=shown.map(materialMarkup).join('')||'<p class="mw-empty">'+(query?'没有匹配的明细。':'还没有关联材料。后台会根据主题范围整理，你也可以在事实库核对已有内容。')+'</p>';
    var more=el('mw-material-more');more.hidden=shown.length>=items.length;more.textContent='继续显示 '+Math.min(30,items.length-shown.length)+' 条';
    message('mw-material-page',shown.length<items.length?'已显示 '+shown.length+' / '+items.length+' 条':'');
  }
  function renderEditor(){
    var root=el('mw-topic-editor');if(!root)return;var d=state.draft;
    root.hidden=state.view!=='detail'||!d;if(root.hidden){root.innerHTML='';return}
    var fresh=!state.topics.some(function(t){return t.id===d.id});
    root.innerHTML='<section class="mw-reader"><header class="mw-reader-head"><div><span class="mw-directory-kicker">小主题</span><h3 tabindex="-1">'+esc(d.title||'新建小主题')+'</h3></div><label class="mw-recall-switch"><input id="mw-enabled" type="checkbox" role="switch" '+(d.recall_enabled!==false?'checked':'')+'><span class="mw-switch-track" aria-hidden="true"></span><span>允许召回</span></label></header>'+
      '<p class="mw-reader-summary">'+esc(d.summary||'摘要待更新。可以先阅读明细，或在下方编辑摘要。')+'</p><div class="mw-save-line"><span id="mw-draft-status" role="status">已保存</span>'+button('save','保存改动','id="mw-save"')+'</div>'+
      '<details class="mw-edit-panel"'+(fresh||state.dirty?' open':'')+'><summary>编辑名称、摘要与归属</summary><fieldset id="mw-editor-fields"><div class="mw-form-pair"><label>小主题名称<input id="mw-title" maxlength="80" value="'+escAttr(d.title)+'" placeholder="给这段经历起个名字"></label><label>所属大主题<input id="mw-group" maxlength="80" list="mw-group-options" value="'+escAttr(d.group_title||'')+'" placeholder="选择已有目录，或输入新名称"></label></div><datalist id="mw-group-options">'+Array.from(new Set(state.topics.map(function(t){return t.group_title}).filter(Boolean))).map(function(n){return '<option value="'+escAttr(n)+'"></option>'}).join('')+'</datalist><label>小主题摘要<textarea id="mw-summary" maxlength="360" rows="4" placeholder="简明写出事情的脉络">'+esc(d.summary||'')+'</textarea></label><label>补充说明<textarea id="mw-note" maxlength="2000" rows="3">'+esc(d.note||'')+'</textarea></label><label>别名<input id="mw-aliases" value="'+escAttr((d.aliases||[]).join('，'))+'" maxlength="970" placeholder="用逗号分隔"></label></fieldset><p class="mw-note">你的编辑直接生效。摘要随后仅在材料或目录内容发生变化时重新整理；后台处理可到状态页暂停。</p><div class="mw-toolbar">'+button('topic-events','查看相关事件')+button('copy','复制主题内容')+button('delete','删除此主题','id="mw-delete"')+'</div></details></section>'+
      '<section class="mw-material-section"><div class="mw-directory-heading"><h3 id="mw-material-count"></h3><label class="mw-order-label"><span class="sr-only">明细时间排序</span><select id="mw-material-order"><option value="recent"'+(state.materialOrder!=='oldest'?' selected':'')+'>最近在前</option><option value="oldest"'+(state.materialOrder==='oldest'?' selected':'')+'>从早到晚</option></select></label></div><label class="mw-material-filter"><span class="sr-only">搜索此主题的明细</span><input id="mw-material-query" type="search" value="'+escAttr(state.materialQuery||'')+'" placeholder="在这个小主题中搜索"></label><div id="mw-materials" class="mw-timeline"></div><div class="mw-more-row">'+button('material-more','继续显示','id="mw-material-more" hidden')+'<span id="mw-material-page"></span></div></section>';
    renderMaterials();syncButtons();
  }
  function syncButtons(){
    if(!el('mw-status'))return;
    if(el('mw-save'))el('mw-save').disabled=state.busy||state.conflict||!state.dirty||!String(state.draft.title).trim();
    if(el('mw-delete'))el('mw-delete').disabled=state.busy||state.conflict||!state.topics.some(function(t){return t.id===state.draft.id});
    if(el('mw-editor-fields'))el('mw-editor-fields').disabled=state.busy;
    if(el('mw-enabled'))el('mw-enabled').disabled=state.busy;
    message('mw-draft-status',state.busy?'正在保存…':state.conflict?'版本有冲突 · 草稿已保留':state.dirty?'有未保存改动':'已保存');
    if(el('mw-draft-status'))el('mw-draft-status').dataset.state=state.busy?'saving':state.dirty?'dirty':'saved';
    el('tab-topics').querySelectorAll('[data-mw="new"],[data-mw="reload"],[data-mw="select"],[data-mw="group"],[data-mw="root"],[data-mw="remove"]').forEach(function(b){b.disabled=state.busy||(!state.loaded&&b.dataset.mw!=='reload')});
  }
  function markDirty(){state.dirty=true;state.request=null;syncButtons()}
  async function discard(){return !state.dirty||await ckConfirmDialog('当前主题有未保存内容，是否放弃草稿？',{title:'保留当前编辑？',confirmText:'放弃草稿',cancelText:'继续编辑'})}
  async function load(force){
    if(state.busy||force&&!(await discard()))return;
    var seq=++state.loadSeq,key=state.key;state.busy=true;syncButtons();message('mw-status','正在读取目录…');
    try{
      var data=await request('/ck/memory-topics');if(seq!==state.loadSeq||!validKey(key))return;
      if(!Array.isArray(data.topics)||!Number.isInteger(data.revision))throw new Error('主题目录格式无效');
      applyData(data);state.dirty=false;renderList();renderEditor();message('mw-status','目录已同步');if(review)review.update(data);
    }catch(e){if(validKey(key))message('mw-status',e.message)}
    finally{if(seq===state.loadSeq&&validKey(key)){state.busy=false;syncButtons()}}
  }
  async function save(action){
    if(state.busy||!state.draft||state.conflict)return;
    if(action==='delete'&&!(await ckConfirmDialog('仅删除这个主题目录，原始 Fact 会保留。',{title:'删除主题',confirmText:'删除主题',danger:true})))return;
    var d=state.draft,key=state.key;
    var body={action:action,id:d.id,expected_revision:state.revision,title:d.title,group_title:d.group_title||'',note:d.note||'',aliases:d.aliases||[],recall_enabled:d.recall_enabled!==false,material_stamps:Object.fromEntries(d.materials.filter(function(m){return m.stamp}).map(function(m){return [m.fact_id,m.stamp]})),fact_ids:d.materials.map(function(m){return m.fact_id})};
    if(d.summary_edited)body.summary_text=d.summary||'';
    var signature=JSON.stringify(body);if(!state.request||state.request.signature!==signature)state.request={signature:signature,body:Object.assign({request_id:uid()},body)};
    state.busy=true;syncButtons();message('mw-status','正在保存…');
    try{
      var data=await request('/ck/memory-topics',state.request.body);if(!validKey(key))return;
      applyData(data);state.dirty=false;if(state.draft)state.group=state.draft.group_title||'';renderList();renderEditor();message('mw-status',action==='delete'?'主题已删除，原始 Fact 保留。':'已保存，你的修改已生效。');if(review)review.update(data);
    }catch(e){if(validKey(key)){state.conflict=e.status===409;message('mw-status',e.message+(state.conflict?' 先复制草稿，再刷新目录核对。':' 草稿已保留，可重试保存。'))}}
    finally{if(validKey(key)){state.busy=false;syncButtons()}}
  }
  async function onTopicAction(e){
    var b=e.target.closest('[data-mw]');if(!b||b.disabled)return;var action=b.dataset.mw,id=b.dataset.id;
    if(action==='topic-api'){navTo('apiconfig');switchApiTab('topics');return}
    if(action==='monitor'){navTo('status');if(window.ckSelectStatusTab)ckSelectStatusTab('topics');return}
    if(action==='events'||action==='topic-events'){await showEvents(action==='topic-events'&&state.draft?state.draft.id:'',false);return}
    if(action==='events-git'){await showEvents(state.eventTopic||'',true);return}
    if(action==='events-vps'){await showEvents(state.eventTopic||'',false);return}
    if(action==='events-close'){el('mw-events').hidden=true;return}
    if(action==='fact'){openFactDetail(id);return}
    if(action==='copy'){if(state.draft)ckCopyText(JSON.stringify(state.draft,null,2)).then(function(){toast('主题内容已复制')});return}
    if(action==='reload'){await load(true);return}
    if(['root','group','new','select'].includes(action)){
      if(!state.loaded||!(await discard()))return;
      state.dirty=false;state.request=null;state.conflict=false;state.materialLimit=30;state.materialQuery='';
      if(action==='root'){state.view='groups';state.draft=null;}
      if(action==='group'){state.view='topics';state.group=b.dataset.group||'';state.draft=null;}
      if(action==='new'||action==='select'){
        state.view='detail';state.draft=action==='new'?{id:uid(),title:'',group_title:state.view==='groups'?'':state.group||'',note:'',summary:'',materials:[]}:clone(state.topics.find(function(t){return t.id===id}));
        state.group=state.draft.group_title||'';state.dirty=action==='new';
      }
      renderList();renderEditor();syncButtons();message('mw-status',action==='new'?'填写后保存，新主题会进入目录。':'目录已同步');
      var heading=el('tab-topics').querySelector(state.view==='detail'?'.mw-reader h3':'.mw-directory-heading h3');if(heading)heading.focus({preventScroll:true});
      return;
    }
    if(action==='save'||action==='delete'){await save(action);return}
    if(action==='material-more'){state.materialLimit+=30;renderMaterials();return}
    if(action==='remove'){state.draft.materials=state.draft.materials.filter(function(m){return m.fact_id!==id});markDirty();renderMaterials();message('mw-status','已从草稿移出，保存后生效；原始 Fact 保留。');return}
  }

  async function showEvents(topic,fromGit){
    var key=state.key,seq=(state.eventSeq||0)+1;state.eventSeq=seq;state.eventTopic=topic;
    var root=el('mw-events');root.hidden=false;root.textContent='正在读取事件记忆…';
    try{
      var data=await request('/ck/event-memories'+(fromGit?'?source=git':''));
      if(!validKey(key)||state.eventSeq!==seq)return;
      var events=data.events.filter(function(e){return !topic||(e.topic_ids||[]).includes(topic)});
      var git=data.git||{},status=data.status||{};
      root.innerHTML='<header class="mw-reader-head"><h3>事件记忆'+(fromGit?' · Git 备份':'')+'</h3>'+button('events-close','收起')+'</header><div class="mw-toolbar">'+button('events-vps','刷新 VPS 内容')+button('events-git','拉取 Git 备份')+'</div><p class="mw-note">'+esc(fromGit?'这是独立保存的备份，可能包含已失效的旧记录；聊天只召回当前证据有效的事件。':'这是 VPS 已预加载、当前可供 C 召回的事件。点击出处可核对原始 Fact。')+'</p><p role="status">'+events.length+' 条事件 · '+esc(git.status==='synced'?'Git 已同步':git.status==='restored'?'已从 Git 恢复':git.status==='retry'?'Git 同步待重试':'Git 同步待确认')+(status.manual_pending_scopes?' · '+status.manual_pending_scopes+' 组旧材料待人工整理':'')+'</p>'+
        (events.map(function(event){return '<article class="mw-card"><h4>'+esc(event.title)+'</h4>'+event.beats.map(function(beat){return '<p>'+esc(beat.text)+'</p><div class="mw-toolbar">'+beat.fact_ids.map(function(fid){return button('fact','查看出处','data-id="'+escAttr(fid)+'"')}).join('')+'</div>'}).join('')+(event.unresolved?'<p class="mw-note">尚未确定：'+esc(event.unresolved)+'</p>':'')+'<details><summary>查看召回正文</summary><pre style="white-space:pre-wrap;overflow-wrap:anywhere">'+esc(event.injection)+'</pre><p class="mw-note">这是该事件的正文。实际注入可能包含其他命中事件，并使用网关统一的记忆边界包装。</p></details></article>'}).join('')||'<p>暂无可显示事件。旧材料正在分批人工整理，新变化由后台更新。</p>');
      root.scrollIntoView({behavior:'smooth',block:'start'});
    }catch(e){if(validKey(key)&&state.eventSeq===seq)root.textContent=e.message}
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
    var d=result.diag||{},items=result.items||[],candidates=d.candidate_preview||[],topics=result.topics||[];
    var html='<section class="mw-card"><div class="mw-editor-head"><h3>'+label+'</h3><small>'+esc(result.elapsed_seconds)+' 秒</small></div><p class="mw-result-count">选中 '+(path==='c'?topics.length+' 个主题':items.length+' 条 Fact')+'</p>';
    (result.warnings||[]).forEach(function(w){html+='<p class="mw-cost">'+esc(w)+'</p>'});
    if(path==='c'){html+=topics.map(function(t){return '<article><h4>'+esc(t.title)+'</h4><p>'+esc(t.summary)+'</p></article>'}).join('')||(result.text?'':'<p class="mw-empty">本次没有相关主题。</p>')}else html+=items.length?'<div class="mw-selected">'+items.map(function(m){var candidate=candidates.find(function(c){return c.fact_id===m.fact_id})||{};return '<article><p>'+esc(candidate.content_preview||m.situation||m.fact_id)+'</p>'+button('fact','查看 Fact','data-id="'+escAttr(m.fact_id)+'"')+'</article>'}).join('')+'</div>':'<p class="mw-empty">本次没有选中记忆。查看下方诊断，区分主动跳过与筛选未通过。</p>';
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
    if(state.key!==key){state={key:key,loaded:false,revision:0,topics:[],groups:[],draft:null,dirty:false,busy:false,conflict:false,request:null,loadSeq:state.loadSeq+1,searchSeq:state.searchSeq+1,results:[],offset:0,more:false,searching:false};lab={running:false,seq:lab.seq+1,results:{}};el('tab-topics').replaceWith(el('tab-topics').cloneNode(false));el('tab-recall-lab').replaceWith(el('tab-recall-lab').cloneNode(false))}
    if(!el('mw-status'))buildTopics();if(!el('mw-lab-form'))buildLab();
    if(tab==='topics'&&!state.loaded&&!state.busy)load(false);
    if(tab==='recall-lab')providerSummary();
  };
  window.addEventListener('beforeunload',function(e){if(state.dirty||(review&&review.hasDraft())){e.preventDefault();e.returnValue=''}});
})();
