var API_BASE='https://memory-tools-kjlrchffqe.cn-hangzhou.fcapp.run';
var GRAPH_API_BASE='https://ck-gateway-kbjndwjdwa.cn-hangzhou.fcapp.run';
var API_KEY_STORAGE='ckMemoryApiKey';
var API=API_BASE;
var ENTITY_GRAPH_URL=GRAPH_API_BASE+'/entity-graph';
try{
  var storedEntityGraphUrl=localStorage.getItem('entityGraphUrl')||'';
  if(storedEntityGraphUrl&&storedEntityGraphUrl.indexOf('memory-tools-kjlrchffqe.cn-hangzhou.fcapp.run')<0){
    ENTITY_GRAPH_URL=storedEntityGraphUrl;
  }else if(storedEntityGraphUrl){
    localStorage.removeItem('entityGraphUrl');
  }
}catch(e){}
var PANEL_CACHE_KEY='ckPanelCacheV2';
function initApiKeyFromUrl(){
  try{
    var params=new URLSearchParams(window.location.search||'');
    var key=params.get('key');
    if(key){
      localStorage.setItem(API_KEY_STORAGE,key);
      params.delete('key');
      var qs=params.toString();
      var clean=window.location.pathname+(qs?'?'+qs:'')+(window.location.hash||'');
      history.replaceState(null,'',clean);
    }
  }catch(e){}
}
function apiUrl(){
  var key='';
  try{key=localStorage.getItem(API_KEY_STORAGE)||''}catch(e){}
  return key?API_BASE+'?key='+encodeURIComponent(key):API_BASE;
}
function addStoredKey(url){
  var key='';
  try{key=localStorage.getItem(API_KEY_STORAGE)||''}catch(e){}
  if(!key)return url;
  try{
    var u=new URL(url,window.location.href);
    if(!u.searchParams.get('key'))u.searchParams.set('key',key);
    return u.toString();
  }catch(e){
    return url+(url.indexOf('?')>=0?'&':'?')+'key='+encodeURIComponent(key);
  }
}
function requestApiKey(){
  var key=window.prompt('后端已开启访问密钥，请输入 memory_tools 的 AUTH_KEY');
  if(!key)return false;
  try{localStorage.setItem(API_KEY_STORAGE,key.trim())}catch(e){}
  return true;
}
function apiFetch(init){
  return fetch(apiUrl(),init).then(function(r){
    if(r.status===403&&requestApiKey())return fetch(apiUrl(),init);
    return r;
  });
}
function entityGraphUrl(full){
  var url=ENTITY_GRAPH_URL;
  if(full&&url.indexOf('full=')<0)url+=(url.indexOf('?')>=0?'&':'?')+'full=1';
  return url;
}
function entityGraphFetch(full){
  return fetch(addStoredKey(entityGraphUrl(full))).then(function(r){
    if(r.status===403&&requestApiKey())return fetch(addStoredKey(entityGraphUrl(full)));
    return r;
  });
}
function rpc(tool,args){return apiFetch({method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',method:'tools/call',params:{name:tool,arguments:args||{}},id:Date.now()})}).then(function(r){return r.json()}).then(function(d){return d.result&&d.result.content&&d.result.content[0]?d.result.content[0].text:''}).catch(function(){return ''})}
function rpcStrict(tool,args){return apiFetch({method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',method:'tools/call',params:{name:tool,arguments:args||{}},id:Date.now()})}).then(function(r){if(!r.ok)throw new Error('HTTP '+r.status);return r.json()}).then(function(d){return d.result&&d.result.content&&d.result.content[0]?d.result.content[0].text:''})}
var catNameMap={timeline:'时间线',details:'详细记录',intimate:'亲密',preferences:'偏好',todo:'待办',rules:'规则',daily:'日常',feelings:'感受',dreams:'梦境',people:'人物',places:'地点',music:'音乐',food:'美食',health:'健康',work:'工作',memory:'记忆',important:'重要',archive:'归档',misc:'杂项',habits:'习惯',goals:'目标',ideas:'想法',quotes:'语录',gifts:'礼物',dates:'纪念日',promises:'承诺',fights:'吵架记录',growth:'成长',kinks:'癖好',body:'身体',toys:'玩具',fantasies:'幻想',aftercare:'事后关怀',boundaries:'边界','todo-panel':'面板待办','todo-memory':'记忆待办'};
function getCnName(k){return catNameMap[k.toLowerCase()]||''}
var current=null,allData={},delIdx=null,selectMode=null,selected=new Set(),currentView='active',allTags=new Set(),activeTag='',activeTags=[],editIdx=null,filterTag='',currentPanelTab='overview',returnPanelTab='overview',returnScrollY=0,graphLoaded=false,renderQueued=false,searchFilter='all',singleEntryIdx=null,tagsExpanded=false,detailReturnState=null,lastSingleTapAt=0,suppressClickUntil=0,detailHighlightQuery='';
var entityGraphData=null,entityGraphView='nodes',entityGraphMode='home',entityGraphSelectedType='',entityGraphSelectedKey='',entityGraphFullOpen=false,entityGraphZoom=1;
var currentSort='time',currentSortDir='desc';
var touchState={startX:0,startY:0,swiping:false,moved:false,idx:-1,offset:0,startOffset:0,openIdx:-1,pointerId:null};
var entityPinchState={active:false,startDist:0,startZoom:1};
var syncingCategories={};
var categoryWriteVersions={},categoryWriteChains={};
var EMPTY_CATEGORY_MARKER='[ck-panel-empty]';
function parseEntries(raw){
  if(!raw||!raw.trim())return[];
  var blocks=raw.split(/\n---\n|\n---$/),entries=[];
  for(var i=0;i<blocks.length;i++){
    var block=blocks[i].trim();if(!block)continue;
    var lines=block.split('\n'),meta={imp:5,time:'',last:'',tags:'',pin:false,resolved:false,archived:false};
    var first=lines[0],contentLines;
    if(first.charAt(0)==='['){
      if(first.indexOf('[pin]')>=0)meta.pin=true;
      if(first.indexOf('[resolved]')>=0)meta.resolved=true;
      if(first.indexOf('[archived]')>=0)meta.archived=true;
      var impIdx=first.indexOf('[imp:');
      if(impIdx>=0){var impEnd=first.indexOf(']',impIdx);if(impEnd>impIdx)meta.imp=parseInt(first.substring(impIdx+5,impEnd))||5}
      var timeIdx=first.indexOf('[time:');
      if(timeIdx>=0){var timeEnd=first.indexOf(']',timeIdx);if(timeEnd>timeIdx)meta.time=first.substring(timeIdx+6,timeEnd)}
      var lastIdx=first.indexOf('[last:');
      if(lastIdx>=0){var lastEnd=first.indexOf(']',lastIdx);if(lastEnd>lastIdx)meta.last=first.substring(lastIdx+6,lastEnd)}
      var tagsIdx=first.indexOf('[tags:');
      if(tagsIdx>=0){var tagsEnd=first.indexOf(']',tagsIdx);if(tagsEnd>tagsIdx)meta.tags=first.substring(tagsIdx+6,tagsEnd)}
      contentLines=lines.slice(1);
    }else{contentLines=lines}
    var ct=contentLines.join('\n').trim();
    if(ct)entries.push({meta:meta,content:ct});
  }
  return entries;
}
function timeAgo(dateStr){if(!dateStr)return'';var d=new Date(dateStr),now=new Date(),diff=Math.floor((now-d)/864e5);if(diff<=0)return'今天';if(diff===1)return'昨天';if(diff<30)return diff+'天前';if(diff<365)return Math.floor(diff/30)+'个月前';return Math.floor(diff/365)+'年前'}
function daysSince(){return Math.floor((new Date()-new Date(2026,2,26))/864e5)}
function dateKey(d){return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0')}
function entryDate(e){return (e.meta&&(e.meta.time||e.meta.last))||''}
function entryTags(e){return (e.meta&&e.meta.tags?e.meta.tags:'').split(',').map(function(t){return t.trim()}).filter(Boolean)}
function syncActiveTag(){activeTag=activeTags.length===1?activeTags[0]:'';filterTag=activeTag}
function hasActiveTags(){return activeTags.length>0}
function entryMatchesTags(e,tags){
  if(!tags||!tags.length)return true;
  var set=new Set(entryTags(e));
  return tags.every(function(t){return set.has(t)});
}
function decayedScore(e){
  var days=e.meta.last?Math.floor((new Date()-new Date(e.meta.last))/864e5):0;
  if(e.meta.pin&&e.meta.imp>=10)return Number.POSITIVE_INFINITY;
  if(e.meta.pin&&e.meta.imp>=9)return Math.max(e.meta.imp*Math.pow(0.99,days),4);
  return e.meta.imp*Math.pow(0.99,days);
}
function parseEntryTimeValue(s){
  if(!s)return null;
  var normalized=String(s).trim().replace(/\./g,'-').replace(/\//g,'-');
  var t=Date.parse(normalized);
  return isNaN(t)?normalized:t;
}
function compareEntryTimeAsc(ea,eb,a,b){
  var va=parseEntryTimeValue(entryDate(ea)),vb=parseEntryTimeValue(entryDate(eb));
  if(va===null&&vb===null)return a-b;
  if(va===null)return 1;
  if(vb===null)return -1;
  if(typeof va==='number'&&typeof vb==='number'){
    if(va!==vb)return va-vb;
  }else{
    var cmp=String(va).localeCompare(String(vb));
    if(cmp!==0)return cmp;
  }
  return a-b;
}
function compareEntryTime(ea,eb,a,b,dir){
  var da=entryDate(ea),db=entryDate(eb);
  if(!da&&!db)return a-b;
  if(!da)return 1;
  if(!db)return -1;
  var cmp=compareEntryTimeAsc(ea,eb,a,b);
  return dir==='asc'?cmp:-cmp;
}
function init(){
  initApiKeyFromUrl();
  document.getElementById('day-num').textContent=daysSince();
  var d=new Date(),w=['周日','周一','周二','周三','周四','周五','周六'];
  document.getElementById('mem-date').textContent=d.getFullYear()+'.'+(d.getMonth()+1)+'.'+d.getDate()+' '+w[d.getDay()];
  loadAll();
}
function setLoading(pct,msg){
  var inner=document.getElementById('loading-inner');
  var text=document.getElementById('loading-text');
  if(inner)inner.style.width=Math.max(0,Math.min(100,pct))+'%';
  if(text)text.textContent=msg;
}
function hideLoadingSoon(delay){
  var wrap=document.getElementById('loading-wrap');
  if(wrap)setTimeout(function(){wrap.classList.add('done')},delay||120);
}
function setSyncStatus(msg){
  var el=document.getElementById('console-sub');
  if(el)el.textContent=msg;
}
function rebuildTags(){
  allTags=new Set();
  Object.keys(allData).forEach(function(cat){
    (allData[cat].entries||[]).forEach(function(e){
      if(e.meta&&e.meta.tags)e.meta.tags.split(',').forEach(function(t){var tag=t.trim();if(tag)allTags.add(tag)});
    });
  });
}
function renderAll(){
  updateStats();renderGrid();renderTags();renderHomeInsights();
  if(currentPanelTab==='search'){
    var q=document.getElementById('search-input').value.trim();
    if(!q&&!hasActiveTags()&&searchFilter==='all')renderSearchLanding();
    else onSearch();
  }
}
function scheduleRender(){
  if(renderQueued)return;
  renderQueued=true;
  setTimeout(function(){renderQueued=false;renderAll()},80);
}
function loadPanelCache(){
  try{
    var raw=localStorage.getItem(PANEL_CACHE_KEY);
    if(!raw)return false;
    var cached=JSON.parse(raw);
    if(!cached||cached.version!==2||!cached.data)return false;
    allData=cached.data;
    rebuildTags();
    renderAll();
    setSyncStatus('已先显示本地缓存，后台更新中');
    setLoading(18,'已显示缓存，正在更新...');
    hideLoadingSoon(120);
    return true;
  }catch(e){
    return false;
  }
}
function savePanelCache(){
  try{
    localStorage.setItem(PANEL_CACHE_KEY,JSON.stringify({version:2,ts:Date.now(),data:allData}));
  }catch(e){
    try{localStorage.removeItem(PANEL_CACHE_KEY)}catch(_e){}
  }
}
function loadAll(){
  var hadCache=loadPanelCache();
  if(!hadCache)setLoading(4,'正在读取分类...');
  rpcStrict('list_memories').then(function(t){
    if(!t||t==='Empty'){allData={};allTags=new Set();renderAll();savePanelCache();setSyncStatus('暂无记忆');setLoading(100,'已更新');hideLoadingSoon(160);return}
    var cats=t.split('\n').filter(Boolean);
    var previous=allData||{},next={};
    cats.forEach(function(c){next[c]=previous[c]||{entries:[]}});
    allData=next;rebuildTags();renderAll();
    setSyncStatus('正在后台更新 '+cats.length+' 个分类');
    if(!hadCache)hideLoadingSoon(180);
    var loaded=0,total=cats.length,failed=0;
    cats.forEach(function(c){
      rpcStrict('read_memory',{category:c}).then(function(raw){
        var entries=parseEntries(raw);
        entries.forEach(function(e){if(e.meta.tags)e.meta.tags.split(',').forEach(function(t){var tag=t.trim();if(tag)allTags.add(tag)})});
        if(!syncingCategories[c])allData[c]={entries:entries};
        loaded++;
        setLoading(Math.round(loaded/total*100),'后台更新 '+loaded+'/'+total);
        if(!syncingCategories[c]&&current===c&&document.getElementById('page-detail').classList.contains('active')){updateSwitchCounts();renderEntries()}
        if(loaded===total){rebuildTags();renderAll();savePanelCache();setSyncStatus(failed?'已更新，少数分类读取失败':'已更新到最新');setLoading(100,'已更新');hideLoadingSoon(120)}
        else if(loaded===1||loaded%3===0)scheduleRender();
      }).catch(function(){
        loaded++;failed++;
        setLoading(Math.round(loaded/total*100),'后台更新 '+loaded+'/'+total);
        if(loaded===total){rebuildTags();renderAll();savePanelCache();setSyncStatus('已更新，少数分类读取失败');hideLoadingSoon(120)}
        else if(loaded%3===0)scheduleRender();
      });
    });
  }).catch(function(){
    setSyncStatus(hadCache?'服务器暂时没连上，当前显示缓存':'服务器暂时没连上');
    if(!hadCache){allData={};allTags=new Set();renderAll();document.getElementById('cat-grid').innerHTML='<div class="empty-state">加载失败，请稍后刷新</div>'}
    hideLoadingSoon(200);
  });
}
function updateStats(){
  var keys=Object.keys(allData),total=0,active=0,archived=0;
  keys.forEach(function(k){allData[k].entries.forEach(function(e){total++;if(e.meta.archived)archived++;else active++})});
  document.getElementById('st-total').textContent=total;
  document.getElementById('st-active').textContent=active;
  document.getElementById('st-archived').textContent=archived;
}
function flattenEntries(){
  var list=[];
  Object.keys(allData).forEach(function(cat){
    allData[cat].entries.forEach(function(e,idx){
      var date=e.meta.last||e.meta.time||'';
      list.push({cat:cat,idx:idx,entry:e,date:date,score:e.meta.imp+(e.meta.pin?2:0)});
    });
  });
  return list;
}
function passesSearchFilter(item){
  var e=item.entry;
  if(searchFilter==='pinned')return !!e.meta.pin;
  return true;
}
function sortSearchItems(items){
  return items.sort(function(a,b){
    return b.date.localeCompare(a.date)||b.score-a.score;
  });
}
function shortText(s,n){
  s=(s||'').replace(/\s+/g,' ').trim();
  return s.length>n?s.slice(0,n)+'...':s;
}
function renderMiniList(elId,items,emptyText,reasonFn){
  var el=document.getElementById(elId);if(!el)return;
  if(!items.length){el.innerHTML='<div class="empty-state small">'+emptyText+'</div>';return}
  var html='';
  items.forEach(function(item){
    var e=item.entry,reason=reasonFn?reasonFn(item):'';
    var title=getCnName(item.cat)||item.cat;
    html+='<div class="mini-item" data-cat="'+escAttr(item.cat)+'" data-idx="'+item.idx+'" onclick="openEntry(this.dataset.cat,parseInt(this.dataset.idx,10))"><div class="mini-top"><span>'+esc(title)+'</span><b>'+e.meta.imp+'/10</b></div><div class="mini-text">'+esc(shortText(e.content,80))+'</div>'+(reason?'<div class="mini-reason">'+esc(reason)+'</div>':'')+'</div>';
  });
  el.innerHTML=html;
}
function renderHomeInsights(){
  var listEl=document.getElementById('today-roll-list');
  var countEl=document.getElementById('today-roll-count');
  var focusCountEl=document.getElementById('recent-focus-count');
  if(!listEl)return;
  var today=dateKey(new Date()),items=[],seq=0;
  Object.keys(allData).forEach(function(cat){
    (allData[cat].entries||[]).forEach(function(e,idx){
      var d=entryDate(e);
      if(!e.meta.archived&&d&&d.slice(0,10)===today)items.push({cat:cat,idx:idx,entry:e,date:d,order:seq});
      seq++;
    });
  });
  items.sort(function(a,b){
    var d=a.date.localeCompare(b.date);
    return d!==0?d:a.order-b.order;
  });
  if(countEl)countEl.textContent=items.length+' 条';
  if(!items.length){
    listEl.innerHTML='<div class="empty-state small">今天还没有新增记忆</div>';
  }else{
    listEl.innerHTML=items.map(function(item){
      var e=item.entry,title=getCnName(item.cat)||item.cat;
      var tags=entryTags(e).slice(0,3).map(function(t){return'<span>#'+esc(t)+'</span>'}).join('');
      return '<div class="today-roll-item" data-cat="'+escAttr(item.cat)+'" data-idx="'+item.idx+'" onclick="openEntry(this.dataset.cat,parseInt(this.dataset.idx,10))"><div class="today-roll-top"><b>'+esc(title)+'</b><small>'+esc(item.date)+'</small></div><div class="today-roll-text">'+esc(shortText(e.content,120))+'</div>'+(tags?'<div class="today-roll-tags">'+tags+'</div>':'')+'</div>';
    }).join('');
  }
  var focus=flattenEntries().filter(function(item){
    return !item.entry.meta.archived&&item.entry.meta.imp>=8;
  }).sort(function(a,b){
    var d=(b.date||'').localeCompare(a.date||'');
    return d!==0?d:b.score-a.score;
  }).slice(0,5);
  if(focusCountEl)focusCountEl.textContent=focus.length+' 条';
  renderMiniList('recent-focus-list',focus,'暂无高权重更新',function(item){
    return (item.date?timeAgo(item.date)+' · ':'')+(item.entry.meta.pin?'置顶 · ':'')+'重要性 '+item.entry.meta.imp+'/10';
  });
}
function openEntry(cat,idx){
  if(!allData[cat]||!allData[cat].entries[idx])return;
  var entry=allData[cat].entries[idx];
  var fromDetail=document.getElementById('page-detail').classList.contains('active')&&cat===current&&singleEntryIdx===null;
  var searchInput=document.getElementById('search-input');
  var highlight=(currentPanelTab==='search'&&searchInput)?searchInput.value.trim():'';
  detailReturnState=fromDetail?{cat:current,view:currentView,scrollY:window.scrollY||0,filterTag:filterTag,sort:currentSort,sortDir:currentSortDir}:null;
  openDetail(cat,{view:entry.meta.archived?'archived':'active',singleIdx:idx,fromDetail:fromDetail,highlightQuery:highlight});
}
function focusEntry(idx){
  setTimeout(function(){
    var el=document.getElementById('entry-'+idx);
    var text=document.getElementById('text-'+idx);
    if(!el)return;
    if(text&&text.classList.contains('collapsed')){
      text.classList.remove('collapsed');
      var expand=text.nextElementSibling;
      if(expand&&expand.classList.contains('entry-expand'))expand.textContent='收起';
    }
    el.scrollIntoView({behavior:'smooth',block:'center'});
    el.classList.add('focus-entry');
    setTimeout(function(){el.classList.remove('focus-entry')},2200);
  },180);
}
function hideEntityGraph(){
  switchPanelTab('overview');
}
function loadEntityGraph(showPanel){
  var box=document.getElementById('entity-console');
  var list=document.getElementById('entity-list');
  var detail=document.getElementById('entity-detail');
  var status=document.getElementById('graph-status');
  if(showPanel&&currentPanelTab!=='graph'){switchPanelTab('graph');return}
  entityGraphMode='home';
  if(box)box.classList.add('loading');
  if(status)status.textContent='正在读取信息网...';
  if(list)list.innerHTML='<div class="empty-state small">加载中...</div>';
  if(detail)detail.innerHTML='<div class="empty-state small">等待数据...</div>';
  entityGraphFetch(true).then(function(r){if(!r.ok)throw new Error('HTTP '+r.status);return r.json()}).then(function(data){
    if(!data||typeof data!=='object'||Array.isArray(data)||(!data.counts&&!data.top_nodes&&!data.recent_relations))throw new Error('Invalid graph data');
    graphLoaded=true;
    entityGraphData=data;
    if(box)box.classList.remove('loading');
    if(status)status.textContent='已读取完整信息网数据。点击节点、关系或上方分类查看明细。';
    renderEntityGraph(data);
  }).catch(function(){
    if(box)box.classList.remove('loading');
    if(status)status.textContent='没有读到可用的信息网数据。';
    if(list)list.innerHTML='<div class="entity-error">暂时读不到。接口当前没有返回可用的节点/关系数据。</div>';
    if(detail)detail.innerHTML='';
    var stats=document.getElementById('entity-stats');
    if(stats)stats.innerHTML='';
  });
}
function renderEntityGraph(data){
  var stats=document.getElementById('entity-stats');
  var updated=document.getElementById('entity-updated');
  var status=document.getElementById('graph-status');
  var counts=data.counts||{};
  if(updated)updated.textContent=data.updated?'更新 '+data.updated:'';
  if(status){
    if((counts.nodes||0)===0&&(counts.relations||0)===0)status.textContent='读取成功，但信息网里还没有节点和关系。通常是当天整理任务还没生成，或后端还没部署最新版本。';
    else status.textContent='已读取：'+(counts.nodes||0)+' 个节点，'+(counts.relations||0)+' 条关系。';
  }
  if(stats)stats.innerHTML=[
    entityStatHtml('nodes',counts.nodes||0,'节点'),
    entityStatHtml('relations',counts.relations||0,'关系'),
    entityStatHtml('orphans',counts.orphan_nodes||0,'孤立')
  ].join('');
  renderEntityBrowser(data);
}
function entityStatHtml(view,count,label){
  var sub=view==='nodes'?'核心节点明细':(view==='relations'?'关系链路明细':'未连线节点明细');
  var note=view==='nodes'?'查看人物、地点、主题等节点':(view==='relations'?'查看节点之间的关系':'查看暂时没有关系线的节点');
  return '<button class="entity-stat entity-block-card '+(entityGraphView===view?'active':'')+'" onclick="openEntityGraphList(\''+view+'\')"><div class="entity-block-left"><div class="entity-block-mark">'+label.slice(0,1)+'</div><div><strong>'+label+'</strong><small>'+sub+'</small></div></div><div class="entity-block-right"><b>'+count+'</b><span>'+note+'</span></div></button>';
}
function graphTerm(s){return String(s||'').trim().toLowerCase()}
function graphNodeKey(n){return String((n&&n.key)||(n&&n.name)||'').trim()}
function graphNodeName(n){return String((n&&n.name)||(n&&n.key)||'').trim()}
function findGraphNode(data,key){
  var term=graphTerm(key),nodes=(data&&data.top_nodes)||[];
  for(var i=0;i<nodes.length;i++){
    var n=nodes[i],aliases=n.aliases||[];
    if(graphTerm(n.key)===term||graphTerm(n.name)===term)return n;
    for(var j=0;j<aliases.length;j++){if(graphTerm(aliases[j])===term)return n}
  }
  return null;
}
function relationTouchesNode(r,n){
  var terms=[graphTerm(n.key),graphTerm(n.name)];
  return terms.indexOf(graphTerm(r.source))>=0||terms.indexOf(graphTerm(r.target))>=0;
}
function setEntityGraphView(view){
  openEntityGraphList(view||'nodes');
}
function openEntityGraphList(view){
  entityGraphView=view||'nodes';
  entityGraphMode='list';
  entityGraphSelectedType='';
  entityGraphSelectedKey='';
  if(entityGraphData)renderEntityGraph(entityGraphData);
}
function backEntityGraphHome(){
  entityGraphMode='home';
  entityGraphSelectedType='';
  entityGraphSelectedKey='';
  if(entityGraphData)renderEntityGraph(entityGraphData);
}
function backEntityGraphList(){
  entityGraphMode='list';
  if(entityGraphData)renderEntityBrowser(entityGraphData);
}
function openEntityGraphItem(type,key,evt){
  entityGraphSelectedType=type||'';
  entityGraphSelectedKey=key||'';
  if(!entityGraphFullOpen)entityGraphMode='detail';
  renderEntityBrowser(entityGraphData);
  if(entityGraphFullOpen){
    renderEntityMap(entityGraphData,'entity-graph-stage',true);
    showEntityPopover(evt);
  }
}
function openEntityGraphPage(){
  if(!entityGraphData){
    loadEntityGraph(false);
    return;
  }
  entityGraphFullOpen=true;
  var page=document.getElementById('entity-graph-page');
  if(page)page.classList.add('show');
  document.body.classList.add('entity-graph-open');
  renderEntityMap(entityGraphData,'entity-graph-stage',true);
  setupEntityGraphGestures();
  hideEntityPopover();
}
function closeEntityGraphPage(){
  entityGraphFullOpen=false;
  var page=document.getElementById('entity-graph-page');
  var pop=document.getElementById('entity-popover');
  if(page)page.classList.remove('show');
  if(pop)pop.classList.remove('show');
  document.body.classList.remove('entity-graph-open');
}
function hideEntityPopover(){
  var pop=document.getElementById('entity-popover');
  if(pop)pop.classList.remove('show');
}
function updateEntityZoomLabel(){
  var label=document.getElementById('entity-zoom-label');
  if(label)label.textContent=Math.round(entityGraphZoom*100)+'%';
}
function setEntityGraphZoom(delta){
  entityGraphZoom=Math.max(.35,Math.min(3.5,Math.round((entityGraphZoom+(delta||0))*100)/100));
  applyEntityGraphZoom();
}
function resetEntityGraphZoom(){
  entityGraphZoom=1;
  applyEntityGraphZoom();
}
function applyEntityGraphZoom(){
  var svg=document.querySelector('#entity-graph-stage .entity-svg-full');
  if(svg){
    var w=parseFloat(svg.getAttribute('data-base-w'))||1180;
    var h=parseFloat(svg.getAttribute('data-base-h'))||680;
    svg.style.width=Math.round(w*entityGraphZoom)+'px';
    svg.style.height=Math.round(h*entityGraphZoom)+'px';
  }
  updateEntityZoomLabel();
}
function entityTouchDistance(touches){
  var dx=touches[0].clientX-touches[1].clientX;
  var dy=touches[0].clientY-touches[1].clientY;
  return Math.sqrt(dx*dx+dy*dy);
}
function entityTouchMidpoint(touches){
  return {x:(touches[0].clientX+touches[1].clientX)/2,y:(touches[0].clientY+touches[1].clientY)/2};
}
function setupEntityGraphGestures(){
  var stage=document.getElementById('entity-graph-stage');
  if(!stage||stage.getAttribute('data-gesture-ready'))return;
  stage.setAttribute('data-gesture-ready','1');
  stage.addEventListener('touchstart',function(e){
    if(!entityGraphFullOpen)return;
    if(e.touches.length>=2){
      entityPinchState.active=true;
      entityPinchState.panning=false;
      entityPinchState.startDist=entityTouchDistance(e.touches);
      entityPinchState.startZoom=entityGraphZoom;
      e.preventDefault();
    }else if(e.touches.length===1){
      entityPinchState.panning=true;
      entityPinchState.panMoved=false;
      entityPinchState.panX=e.touches[0].clientX;
      entityPinchState.panY=e.touches[0].clientY;
      entityPinchState.scrollLeft=stage.scrollLeft;
      entityPinchState.scrollTop=stage.scrollTop;
    }
  },{passive:false});
  stage.addEventListener('touchmove',function(e){
    if(entityPinchState.panning&&e.touches.length===1&&!entityPinchState.active){
      var dx=e.touches[0].clientX-entityPinchState.panX;
      var dy=e.touches[0].clientY-entityPinchState.panY;
      if(Math.abs(dx)+Math.abs(dy)<5)return;
      entityPinchState.panMoved=true;
      stage.scrollLeft=entityPinchState.scrollLeft-dx;
      stage.scrollTop=entityPinchState.scrollTop-dy;
      e.preventDefault();
      return;
    }
    if(!entityPinchState.active||e.touches.length<2)return;
    var oldZoom=entityGraphZoom;
    var rect=stage.getBoundingClientRect();
    var mid=entityTouchMidpoint(e.touches);
    var localX=mid.x-rect.left,localY=mid.y-rect.top;
    var beforeX=(stage.scrollLeft+localX)/oldZoom;
    var beforeY=(stage.scrollTop+localY)/oldZoom;
    var dist=entityTouchDistance(e.touches);
    if(!entityPinchState.startDist)return;
    var next=entityPinchState.startZoom*(dist/entityPinchState.startDist);
    entityGraphZoom=Math.max(.35,Math.min(3.5,Math.round(next*100)/100));
    applyEntityGraphZoom();
    stage.scrollLeft=beforeX*entityGraphZoom-localX;
    stage.scrollTop=beforeY*entityGraphZoom-localY;
    e.preventDefault();
  },{passive:false});
  stage.addEventListener('touchend',function(e){
    if(e.touches.length<2)entityPinchState.active=false;
    if(!e.touches.length){
      if(entityPinchState.panMoved)suppressClickUntil=Date.now()+120;
      entityPinchState.panning=false;
      entityPinchState.panMoved=false;
    }
  },{passive:false});
  stage.addEventListener('wheel',function(e){
    if(!entityGraphFullOpen||!e.ctrlKey)return;
    e.preventDefault();
    setEntityGraphZoom(e.deltaY>0?-.12:.12);
  },{passive:false});
}
function showEntityPopover(evt){
  var pop=document.getElementById('entity-popover');
  var page=document.getElementById('entity-graph-page');
  if(!pop||!page||!entityGraphSelectedType||!entityGraphSelectedKey)return;
  pop.innerHTML=renderEntityDetail(entityGraphData,entityGraphSelectedType,entityGraphSelectedKey);
  pop.classList.add('show');
  var rect=page.getBoundingClientRect();
  var x=evt&&evt.clientX?evt.clientX-rect.left:rect.width-360;
  var y=evt&&evt.clientY?evt.clientY-rect.top:92;
  var w=Math.min(360,rect.width-28),h=Math.min(430,rect.height-110);
  x=Math.max(14,Math.min(x+14,rect.width-w-14));
  y=Math.max(76,Math.min(y+14,rect.height-h-14));
  pop.style.width=w+'px';
  pop.style.maxHeight=h+'px';
  pop.style.left=x+'px';
  pop.style.top=y+'px';
}
function graphNodeTerms(n){
  var raw=[n&&n.key,n&&n.name].concat((n&&n.aliases)||[]),out=[];
  raw.forEach(function(v){
    var term=graphTerm(v);
    if(term&&out.indexOf(term)<0)out.push(term);
  });
  return out;
}
function graphLabelTerms(data,label){
  var node=findGraphNode(data,label),terms=node?graphNodeTerms(node):[];
  var labelTerm=graphTerm(label);
  if(labelTerm&&terms.indexOf(labelTerm)<0)terms.push(labelTerm);
  return terms;
}
function graphAddTerms(set,terms){
  terms.forEach(function(t){if(t)set[t]=true});
}
function graphHasTerm(set,terms){
  for(var i=0;i<terms.length;i++){if(set[terms[i]])return true}
  return false;
}
function graphNodeForLabel(data,label){
  return findGraphNode(data,label)||{key:label,name:label,type:'节点',importance:5,mentions:0,summary:'暂时没有完整说明'};
}
function graphJsArg(s){
  return escAttr(JSON.stringify(String(s||'')));
}
function entityGraphContext(data){
  var ctx={active:false,selectedTerms:{},relatedTerms:{},relatedRelations:{}};
  if(!data||!entityGraphSelectedType||!entityGraphSelectedKey)return ctx;
  ctx.active=true;
  var rels=data.recent_relations||[];
  if(entityGraphSelectedType==='relation'){
    var idx=parseInt(entityGraphSelectedKey,10),rel=rels[idx];
    if(rel){
      ctx.relatedRelations[String(idx)]=true;
      graphAddTerms(ctx.selectedTerms,graphLabelTerms(data,rel.source));
      graphAddTerms(ctx.selectedTerms,graphLabelTerms(data,rel.target));
      graphAddTerms(ctx.relatedTerms,graphLabelTerms(data,rel.source));
      graphAddTerms(ctx.relatedTerms,graphLabelTerms(data,rel.target));
    }
    return ctx;
  }
  var node=findGraphNode(data,entityGraphSelectedKey)||{key:entityGraphSelectedKey,name:entityGraphSelectedKey};
  var selected=graphNodeTerms(node);
  graphAddTerms(ctx.selectedTerms,selected);
  graphAddTerms(ctx.relatedTerms,selected);
  rels.forEach(function(rel,i){
    var sourceTerms=graphLabelTerms(data,rel.source);
    var targetTerms=graphLabelTerms(data,rel.target);
    if(graphHasTerm(ctx.selectedTerms,sourceTerms)||graphHasTerm(ctx.selectedTerms,targetTerms)){
      ctx.relatedRelations[String(i)]=true;
      graphAddTerms(ctx.relatedTerms,sourceTerms);
      graphAddTerms(ctx.relatedTerms,targetTerms);
    }
  });
  return ctx;
}
function graphNodeClass(data,label,ctx){
  if(!ctx.active)return '';
  var terms=graphLabelTerms(data,label);
  if(graphHasTerm(ctx.selectedTerms,terms))return ' is-selected active';
  if(graphHasTerm(ctx.relatedTerms,terms))return ' is-related';
  return ' is-dim';
}
function graphEdgeClass(idx,ctx){
  if(!ctx.active)return '';
  return ctx.relatedRelations[String(idx)]?' is-related':' is-dim';
}
function graphUniqueNames(names){
  var seen={},out=[];
  names.forEach(function(name){
    var key=graphTerm(name);
    if(key&&!seen[key]){seen[key]=true;out.push(name)}
  });
  return out;
}
function renderEntityMap(data,targetId,full){
  var map=document.getElementById(targetId||'entity-map');
  if(!map)return;
  var allNodes=data.top_nodes||[],allRels=data.recent_relations||[];
  var rels=allRels.filter(function(r){return r&&r.source&&r.target}).slice(0,full?36:8);
  var touched={};
  rels.forEach(function(r){
    graphLabelTerms(data,r.source).forEach(function(t){touched[t]=true});
    graphLabelTerms(data,r.target).forEach(function(t){touched[t]=true});
  });
  var orphanNames=graphUniqueNames((data.orphan_nodes||[]).concat(allNodes.filter(function(n){
    return !graphHasTerm(touched,graphNodeTerms(n));
  }).map(function(n){return graphNodeName(n)}))).slice(0,full?32:9);
  if(!rels.length&&!orphanNames.length){map.innerHTML='<div class="empty-state small">暂无示意图</div>';return}
  var w=full?1320:720,rowGap=full?112:74,topPad=full?76:44,bottomPad=full?78:38;
  var sourceX=full?260:148,targetX=full?1060:572,midX=(sourceX+targetX)/2;
  var nodeR=full?28:17,labelW=full?250:134;
  var relationBottom=rels.length?topPad+(rels.length-1)*rowGap+72:topPad;
  var orphanCols=full?4:3,orphanGapX=full?285:190,orphanGapY=full?104:68;
  var orphanStartX=full?190:105,orphanTop=relationBottom+(orphanNames.length?(full?82:42):0);
  var orphanRows=orphanNames.length?Math.ceil(orphanNames.length/orphanCols):0;
  var h=Math.max(full?680:300,orphanTop+(orphanRows?orphanRows*orphanGapY+28:0)+bottomPad);
  var ctx=entityGraphContext(data),parts=[],markerId=full?'entity-arrow-full':'entity-arrow-mini';
  var scale=full?entityGraphZoom:1,svgStyle=full?' style="width:'+Math.round(w*scale)+'px;height:'+Math.round(h*scale)+'px"':'';
  parts.push('<svg class="entity-svg '+(full?'entity-svg-full':'entity-svg-preview')+'" viewBox="0 0 '+w+' '+h+'"'+svgStyle+(full?' data-base-w="'+w+'" data-base-h="'+h+'"':'')+' role="img" aria-label="信息网关系示意图"><defs><marker id="'+markerId+'" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 z"></path></marker></defs>');
  if(rels.length)parts.push('<text class="entity-cluster-title" x="'+(full?34:22)+'" y="'+(full?30:26)+'">关系通道</text>');
  rels.forEach(function(r,i){
    var y=topPad+i*rowGap,edgeClass=graphEdgeClass(i,ctx),sx=sourceX+nodeR+12,tx=targetX-nodeR-12;
    var sourceNode=graphNodeForLabel(data,r.source),targetNode=graphNodeForLabel(data,r.target);
    var sourceKey=graphNodeKey(sourceNode)||r.source,targetKey=graphNodeKey(targetNode)||r.target;
    var sourceClass=graphNodeClass(data,r.source,ctx),targetClass=graphNodeClass(data,r.target,ctx);
    parts.push('<line class="entity-lane-guide'+edgeClass+'" x1="'+(full?44:24)+'" y1="'+y+'" x2="'+(w-(full?44:24))+'" y2="'+y+'"></line>');
    parts.push('<line class="entity-edge-hit" x1="'+sx+'" y1="'+y+'" x2="'+tx+'" y2="'+y+'" onclick="event.stopPropagation();openEntityGraphItem(\'relation\','+graphJsArg(i)+',event)"></line>');
    parts.push('<line class="entity-edge'+edgeClass+'" x1="'+sx+'" y1="'+y+'" x2="'+tx+'" y2="'+y+'" marker-end="url(#'+markerId+')"></line>');
    parts.push('<rect class="entity-edge-pill'+edgeClass+'" x="'+(midX-labelW/2)+'" y="'+(y-(full?22:16))+'" width="'+labelW+'" height="'+(full?44:32)+'" rx="'+(full?22:16)+'"></rect>');
    parts.push('<text class="entity-edge-label'+edgeClass+'" x="'+midX+'" y="'+(y+(full?6:4))+'" onclick="event.stopPropagation();openEntityGraphItem(\'relation\','+graphJsArg(i)+',event)">'+esc(shortText(r.relation||'关系',full?22:10))+'</text>');
    parts.push('<g class="entity-node entity-node-source'+sourceClass+'" onclick="event.stopPropagation();openEntityGraphItem(\'node\','+graphJsArg(sourceKey)+',event)" tabindex="0">');
    parts.push('<circle cx="'+sourceX+'" cy="'+y+'" r="'+nodeR+'"></circle><text class="entity-node-name" x="'+sourceX+'" y="'+(y+nodeR+(full?25:18))+'">'+esc(shortText(graphNodeName(sourceNode),full?16:9))+'</text>');
    parts.push('</g>');
    parts.push('<g class="entity-node entity-node-target'+targetClass+'" onclick="event.stopPropagation();openEntityGraphItem(\'node\','+graphJsArg(targetKey)+',event)" tabindex="0">');
    parts.push('<circle cx="'+targetX+'" cy="'+y+'" r="'+nodeR+'"></circle><text class="entity-node-name" x="'+targetX+'" y="'+(y+nodeR+(full?25:18))+'">'+esc(shortText(graphNodeName(targetNode),full?16:9))+'</text>');
    parts.push('</g>');
  });
  if(orphanNames.length){
    parts.push('<text class="entity-cluster-title entity-orphan-title" x="'+(full?34:22)+'" y="'+(orphanTop-24)+'">'+(rels.length?'孤立节点':'节点概览')+'</text>');
    orphanNames.forEach(function(name,i){
      var col=i%orphanCols,row=Math.floor(i/orphanCols),x=orphanStartX+col*orphanGapX,y=orphanTop+row*orphanGapY;
      var node=graphNodeForLabel(data,name),key=graphNodeKey(node)||name,nodeClass=graphNodeClass(data,name,ctx);
      parts.push('<g class="entity-node entity-orphan-node'+nodeClass+'" onclick="event.stopPropagation();openEntityGraphItem(\'node\','+graphJsArg(key)+',event)" tabindex="0">');
      parts.push('<circle cx="'+x+'" cy="'+y+'" r="'+(nodeR-2)+'"></circle><text class="entity-node-name" x="'+x+'" y="'+(y+nodeR+(full?22:15))+'">'+esc(shortText(graphNodeName(node),full?16:9))+'</text>');
      parts.push('</g>');
    });
  }
  parts.push('</svg>');
  map.innerHTML=parts.join('');
  if(full){updateEntityZoomLabel();setupEntityGraphGestures();}
}
function entityGraphViewLabel(view){
  if(view==='relations')return '关系';
  if(view==='orphans')return '孤立';
  return '节点';
}
function entityGraphRows(data,view){
  if(view==='relations'){
    return (data.recent_relations||[]).map(function(r,i){return {type:'relation',key:String(i),raw:r}});
  }
  if(view==='orphans'){
    return (data.orphan_nodes||[]).map(function(name){
      var node=findGraphNode(data,name)||{key:name,name:name,summary:'暂时没有关系线。'};
      return {type:'node',key:graphNodeKey(node),raw:node};
    });
  }
  return (data.top_nodes||[]).map(function(n){return {type:'node',key:graphNodeKey(n),raw:n}});
}
function renderEntityListRow(row){
  var active=row.type===entityGraphSelectedType&&row.key===entityGraphSelectedKey?' active':'';
  if(row.type==='relation'){
    var r=row.raw;
    return '<div class="mini-item entity-row'+active+'" onclick="openEntityGraphItem(\'relation\',\''+escAttr(row.key)+'\')"><div class="mini-top"><span>'+esc(r.source||'')+' → '+esc(r.target||'')+'</span><b>'+esc(r.relation||'关系')+'</b></div><div class="mini-text">'+esc(shortText(r.detail||'',140))+'</div><div class="mini-reason">'+esc(r.last_seen||'')+' · 重要性 '+(r.importance||5)+'</div></div>';
  }
  var n=row.raw;
  return '<div class="mini-item entity-row'+active+'" onclick="openEntityGraphItem(\'node\',\''+escAttr(row.key)+'\')"><div class="mini-top"><span>'+esc(graphNodeName(n))+'</span><b>'+esc(n.type||'节点')+'</b></div><div class="mini-text">'+esc(shortText(n.summary||'',140))+'</div><div class="mini-reason">重要性 '+(n.importance||5)+' · 提及 '+(n.mentions||0)+(entityGraphView==='orphans'?' · 孤立':'')+'</div></div>';
}
function renderEntityBrowser(data){
  var browser=document.querySelector('.entity-browser');
  var listPanel=document.querySelector('.entity-list-panel');
  var detailPanel=document.querySelector('.entity-detail-panel');
  var list=document.getElementById('entity-list');
  var title=document.getElementById('entity-list-title');
  var detail=document.getElementById('entity-detail');
  var meta=document.getElementById('entity-detail-meta');
  var detailTitle=detailPanel?detailPanel.querySelector('.console-card-title'):null;
  var detailHint=detailPanel?detailPanel.querySelector('.entity-section-head small'):null;
  if(!data||!browser||!list||!detail)return;
  browser.classList.remove('entity-browser-home','entity-browser-list','entity-browser-detail');
  browser.classList.add('entity-browser-'+entityGraphMode);
  if(entityGraphMode==='home'){
    if(listPanel)listPanel.style.display='none';
    if(detailPanel)detailPanel.style.display='none';
    if(meta)meta.textContent='';
    return;
  }
  if(entityGraphMode==='list'){
    var rows=entityGraphRows(data,entityGraphView);
    if(listPanel)listPanel.style.display='';
    if(detailPanel)detailPanel.style.display='none';
    if(title)title.innerHTML='<button class="entity-view-back" onclick="backEntityGraphHome()">返回</button><span>'+entityGraphViewLabel(entityGraphView)+'明细</span>';
    var hint=listPanel?listPanel.querySelector('.entity-section-head small'):null;
    if(hint)hint.textContent='点一条内容查看完整明细';
    list.innerHTML=rows.length?rows.map(renderEntityListRow).join(''):'<div class="empty-state small">暂无内容</div>';
    if(meta)meta.textContent='';
    return;
  }
  if(listPanel)listPanel.style.display='none';
  if(detailPanel)detailPanel.style.display='';
  if(detailTitle)detailTitle.innerHTML='<button class="entity-view-back" onclick="backEntityGraphList()">返回</button><span>完整明细</span>';
  if(detailHint)detailHint.textContent=entityGraphViewLabel(entityGraphView);
  detail.innerHTML=renderEntityDetail(data,entityGraphSelectedType,entityGraphSelectedKey);
  if(meta)meta.textContent=entityGraphSelectedType==='relation'?'关系':'节点';
}
function renderEntityDetail(data,type,key){
  if(type==='relation'){
    var rel=(data.recent_relations||[])[parseInt(key,10)];
    if(!rel)return '<div class="empty-state small">没有找到这条关系</div>';
    return '<div class="entity-detail-title">'+esc(rel.source||'')+' <span>→</span> '+esc(rel.target||'')+'</div><div class="entity-detail-sub">'+esc(rel.relation||'关系')+' · '+esc(rel.last_seen||'')+'</div><div class="entity-detail-block"><b>关系说明</b><p>'+esc(rel.detail||'暂无说明')+'</p></div><div class="entity-detail-grid"><span>重要性 '+(rel.importance||5)+'</span><span>出现 '+(rel.count||1)+' 次</span><span>首次 '+esc(rel.first_seen||'')+'</span></div>'+rawEntityBlock(rel);
  }
  var node=findGraphNode(data,key)||{key:key,name:key,summary:''};
  var rels=(data.recent_relations||[]).filter(function(r){return relationTouchesNode(r,node)});
  var aliases=(node.aliases||[]).filter(Boolean);
  var evidence=(node.evidence||[]).filter(Boolean);
  var links=(node.links||[]).filter(Boolean);
  var html='<div class="entity-detail-title">'+esc(graphNodeName(node))+'</div><div class="entity-detail-sub">'+esc(node.type||'节点')+' · 重要性 '+(node.importance||5)+' · 提及 '+(node.mentions||0)+'</div>';
  if(aliases.length)html+='<div class="entity-chip-row">'+aliases.map(function(a){return '<span>'+esc(a)+'</span>'}).join('')+'</div>';
  html+='<div class="entity-detail-block"><b>完整说明</b><p>'+esc(node.summary||'暂无说明')+'</p></div>';
  if(evidence.length)html+='<div class="entity-detail-block"><b>证据 / 原文线索</b>'+evidence.map(function(e){return '<p>'+esc(e)+'</p>'}).join('')+'</div>';
  if(links.length)html+='<div class="entity-detail-block"><b>节点内关联</b>'+links.map(function(l){return '<p>'+esc(l.relation||'关联')+' → '+esc(l.target||'')+(l.detail?'：'+esc(l.detail):'')+'</p>'}).join('')+'</div>';
  if(rels.length)html+='<div class="entity-detail-block"><b>相关关系</b>'+rels.map(function(r){return '<p>'+esc(r.source||'')+' → '+esc(r.target||'')+'：'+esc(r.relation||'')+(r.detail?'，'+esc(r.detail):'')+'</p>'}).join('')+'</div>';
  return html+rawEntityBlock(node);
}
function rawEntityBlock(obj){
  return '<details class="entity-raw"><summary>结构原文</summary><pre>'+esc(JSON.stringify(obj,null,2))+'</pre></details>';
}
function renderTags(){
  var bar=document.getElementById('tags-bar');
  var tagCounts={};
  Object.keys(allData).forEach(function(cat){
    allData[cat].entries.forEach(function(e){
      if(e.meta.tags)e.meta.tags.split(',').forEach(function(t){
        var tag=t.trim();if(tag){tagCounts[tag]=(tagCounts[tag]||0)+1}
      })
    })
  });
  var sorted=Object.keys(tagCounts).sort(function(a,b){return tagCounts[b]-tagCounts[a]});
  var selected=new Set(activeTags);
  var tagLimit=4;
  var visible=tagsExpanded?sorted:sorted.slice(0,tagLimit);
  activeTags.forEach(function(t){if(visible.indexOf(t)<0&&sorted.indexOf(t)>=0)visible.push(t)});
  if(bar)bar.classList.toggle('expanded',tagsExpanded);
  var html='';
  visible.forEach(function(t){html+='<div class="tag-btn'+(selected.has(t)?' active':'')+'" data-tag="'+escAttr(t)+'" onclick="toggleTag(this.dataset.tag)">'+esc(t)+' ('+tagCounts[t]+')</div>'});
  bar.innerHTML=html||'<div class="empty-state small">暂无标签</div>';
  var summary=document.getElementById('tag-summary');
  if(summary)summary.textContent=sorted.length?(activeTags.length?'已选 '+activeTags.length+' 个':(tagsExpanded?'全部 '+sorted.length+' 个':'常用 '+Math.min(tagLimit,sorted.length)+' / '+sorted.length)):'暂无标签';
  var expandBtn=document.querySelector('.tag-expand-btn');
  if(expandBtn)expandBtn.textContent=tagsExpanded?'收起标签':'更多标签';
  var clearBtn=document.getElementById('tag-clear');
  if(clearBtn){if(activeTags.length)clearBtn.classList.add('show');else clearBtn.classList.remove('show')}
  renderActiveFilters(null,(document.getElementById('search-input')||{}).value||'');
}

function toggleTagsExpand(){
  tagsExpanded=!tagsExpanded;
  renderTags();
}
function switchSearchFilter(mode){
  mode=mode||'all';
  searchFilter=(searchFilter===mode&&mode!=='all')?'all':mode;
  document.querySelectorAll('.search-filter').forEach(function(btn){
    btn.classList.toggle('active',btn.getAttribute('data-filter')===searchFilter);
  });
  onSearch();
}
function filterByTag(t){
  activeTags=t?[t]:[];
  syncActiveTag();
  applyTagFilterChange();
}
function toggleTag(t){
  if(!t)activeTags=[];
  else if(activeTags.indexOf(t)>=0)activeTags=activeTags.filter(function(tag){return tag!==t});
  else activeTags=activeTags.concat(t);
  syncActiveTag();
  applyTagFilterChange();
}
function applyTagFilterChange(){
  if(currentPanelTab!=='search')switchPanelTab('search');
  renderTags();
  onSearch();
  if(current&&document.getElementById('page-detail').classList.contains('active'))renderEntries();
  window.scrollTo(0,0);
}
function getSearchItems(query){
  var q=(query||'').trim().toLowerCase();
  var items=flattenEntries().filter(function(item){
    var e=item.entry,cat=item.cat,cn=getCnName(cat),tagText=e.meta.tags||'';
    if(!entryMatchesTags(e,activeTags))return false;
    if(q){
      var hay=(cat+' '+cn+' '+tagText+' '+e.content).toLowerCase();
      if(hay.indexOf(q)<0)return false;
    }
    return passesSearchFilter(item);
  });
  return sortSearchItems(items);
}
function searchFilterName(){
  if(searchFilter==='pinned')return'置顶';
  return'全部';
}
function renderActiveFilters(itemsCount,query){
  var bar=document.getElementById('active-filter-bar');
  if(!bar)return;
  var chips=[];
  if(query)chips.push('<span class="filter-chip">关键词：'+esc(query)+'</span>');
  if(searchFilter!=='all')chips.push('<span class="filter-chip">范围：'+esc(searchFilterName())+'</span>');
  activeTags.forEach(function(t){chips.push('<button class="filter-chip removable" data-tag="'+escAttr(t)+'" onclick="toggleTag(this.dataset.tag)">#'+esc(t)+' ×</button>')});
  if(!chips.length){bar.innerHTML='';return}
  var count=itemsCount===null||itemsCount===undefined?'':'<b>'+itemsCount+' 条</b>';
  bar.innerHTML='<div class="active-filter-main"><span>当前筛选</span>'+chips.join('')+'</div>'+count;
}
function renderSearchLanding(){
  var list=flattenEntries();
  document.getElementById('search-results').innerHTML='<div class="search-empty-card"><div class="search-empty-title">输入关键词开始搜索</div><div class="search-empty-sub">也可以点上方标签缩小范围</div></div>';
  var count=document.getElementById('search-count');
  if(count)count.textContent='共 '+list.length+' 条记忆';
  renderActiveFilters(null,'');
}
function renderSearchSuggestionBlock(title,items,emptyText){
  var html='<section class="search-suggest"><div class="search-suggest-title">'+esc(title)+'</div>';
  if(!items.length)return html+'<div class="empty-state small">'+emptyText+'</div></section>';
  items.forEach(function(item){html+=renderSearchResultItem(item,'')});
  return html+'</section>';
}
function renderSearchResultItem(item,query){
  var e=item.entry;
  var tags=(e.meta.tags||'').split(',').map(function(t){return t.trim()}).filter(Boolean).slice(0,3);
  var meta=[];
  meta.push(e.meta.imp+'/10');
  if(e.meta.pin)meta.push('置顶');
  if(item.date)meta.push(timeAgo(item.date));
  tags.forEach(function(t){meta.push('#'+t)});
  var text=shortText(e.content,150);
  var body=query?highlightText(text,query):esc(text);
  return '<div class="search-result-item search-entry" data-cat="'+escAttr(item.cat)+'" data-idx="'+item.idx+'"><div class="search-entry-main" onclick="openEntry(this.parentNode.dataset.cat,parseInt(this.parentNode.dataset.idx,10))"><div class="search-result-cat">'+esc(item.cat)+'</div><div class="search-result-text">'+body+'</div><div class="search-entry-meta">'+meta.map(function(m){return'<span>'+esc(m)+'</span>'}).join('')+'</div></div><button class="open-entry-btn" onclick="openEntry(this.parentNode.dataset.cat,parseInt(this.parentNode.dataset.idx,10))">打开</button></div>';
}
function renderSearchResults(items,query){
  var title=query?'关键词：'+query:'筛选结果';
  var count=document.getElementById('search-count');
  if(count)count.textContent=title+' · '+items.length+' 条';
  renderActiveFilters(items.length,query);
  if(!items.length){document.getElementById('search-results').innerHTML='<div class="empty-state">没有找到匹配记忆</div>';return}
  var html='<div class="search-result-head"><span>明细</span><b>'+items.length+'</b></div>';
  items.slice(0,80).forEach(function(item){html+=renderSearchResultItem(item,query)});
  if(items.length>80)html+='<div class="empty-state small">只显示前 80 条，请加关键词缩小范围</div>';
  document.getElementById('search-results').innerHTML=html;
}
function onSearch(){
  var q=(document.getElementById('search-input').value||'').trim().toLowerCase();
  var cb=document.getElementById('search-clear');if(q)cb.classList.add('show');else cb.classList.remove('show');
  document.getElementById('search-results').style.display='block';
  if(!q&&!hasActiveTags()&&searchFilter==='all'){renderSearchLanding();return}
  renderSearchResults(getSearchItems(q),q);
}
function clearSearch(){document.getElementById('search-input').value='';document.getElementById('search-clear').classList.remove('show');activeTags=[];syncActiveTag();searchFilter='all';document.querySelectorAll('.search-filter').forEach(function(btn){btn.classList.toggle('active',btn.getAttribute('data-filter')==='all')});renderTags();renderSearchLanding();renderGrid()}
function toggleSearchResult(id){
  var preview=document.getElementById('sr-preview-'+id);
  var full=document.getElementById('sr-full-'+id);
  if(full.style.display==='none'){full.style.display='block';preview.style.display='none'}
  else{full.style.display='none';preview.style.display='block'}
}
function highlightText(text,query){
  if(!query)return esc(text);
  var escaped=esc(text);
  try{var re=new RegExp('('+query.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+')','gi');return escaped.replace(re,'<span class="highlight">$1</span>')}catch(e){return escaped}
}
function renderGrid(){
  var keys=Object.keys(allData);
  var q=(document.getElementById('search-input').value||'').toLowerCase();
  var filtered=keys.filter(function(k){
    var d=allData[k];
    if(hasActiveTags()){if(!d.entries.some(function(e){return entryMatchesTags(e,activeTags)}))return false}
    if(!q)return true;
    if(k.toLowerCase().indexOf(q)>=0)return true;
    return d.entries.some(function(e){return e.content.toLowerCase().indexOf(q)>=0});
  });
  filtered.sort(function(a,b){
    var da=allData[a].entries.length,db=allData[b].entries.length;
    if(db!==da)return db-da;
    return a.localeCompare(b);
  });
  var groups=[
    {key:'us',title:'我们 / us',items:[]},
    {key:'her',title:'她 / her',items:[]},
    {key:'sys',title:'系统 / sys',items:[]},
    {key:'todo',title:'待办 / todo',items:[]},
    {key:'chat',title:'聊天 / chat',items:[]},
    {key:'tech',title:'技术 / tech',items:[]},
    {key:'other',title:'其他',items:[]}
  ];
  var groupMap={us:groups[0],her:groups[1],sys:groups[2],todo:groups[3],chat:groups[4],tech:groups[5],other:groups[6]};
  filtered.forEach(function(k){
    var key='other';
    if(k.indexOf('us-')===0)key='us';
    else if(k.indexOf('her-')===0)key='her';
    else if(k.indexOf('sys-')===0)key='sys';
    else if(k.indexOf('todo-')===0)key='todo';
    else if(k.indexOf('chat-log')===0)key='chat';
    else if(k.indexOf('tech-')===0||k.indexOf('dev-')===0)key='tech';
    groupMap[key].items.push(k);
  });
  var html='';
  groups.forEach(function(group){
    if(!group.items.length)return;
    var section='<section class="cat-section"><div class="cat-section-head"><span>'+esc(group.title)+'</span><small>'+group.items.length+' 类</small></div><div class="cat-section-list">';
    group.items.forEach(function(k){
      section+=renderCategoryCard(k);
    });
    html+=section+'</div></section>';
  });
  document.getElementById('cat-grid').innerHTML=filtered.length?html:'<div class="empty-state">无结果</div>';
}
function renderCategoryCard(k){
  var d=allData[k],ac=0,arc=0,chars=0,high=0,last='';
  d.entries.forEach(function(e){
    if(e.meta.archived)arc++;else{ac++;chars+=e.content.length}
    if(e.meta.imp>=8||e.meta.pin)high++;
    var dt=e.meta.last||e.meta.time||'';
    if(dt&&dt>last)last=dt;
  });
  var cn=getCnName(k);
  var prefix=k.indexOf('-')>0?k.split('-')[0]:k.slice(0,2);
  var detail=(cn?cn+' · ':'')+(last?timeAgo(last):'无日期')+(arc>0?' · 归档 '+arc:'');
  return '<div class="cat-card" data-cat="'+escAttr(k)+'" onclick="openDetail(this.dataset.cat)"><div class="cat-card-body"><div class="cat-left"><div class="cat-mark">'+esc(prefix)+'</div><div class="cat-main"><div class="cat-card-name">'+esc(k)+'</div><div class="cat-card-detail">'+esc(detail)+'</div></div></div><div class="cat-card-right"><div class="cat-card-num">'+ac+'</div><div class="cat-card-detail">'+high+' 重点 · '+chars+' 字</div></div></div></div>';
}
function openDetail(k,opts){
  opts=opts||{};
  if(!opts.fromDetail)detailReturnState=null;
  if(document.getElementById('page-memory').classList.contains('active')){
    returnPanelTab=opts.fromTab||currentPanelTab||'overview';
    returnScrollY=window.scrollY||0;
  }
  current=k;selectMode=null;selected.clear();currentView=opts.view||'active';
  singleEntryIdx=typeof opts.singleIdx==='number'?opts.singleIdx:null;
  detailHighlightQuery=singleEntryIdx!==null?(opts.highlightQuery||''):'';
  if(!opts.keepFilter)filterTag='';
  document.getElementById('select-bar').classList.remove('show');
  document.getElementById('menu-popup').classList.remove('show');
  document.getElementById('d-title').textContent=k;
  document.getElementById('d-sub').textContent=singleEntryIdx!==null?'单条记忆 · '+countInfo():countInfo();
  updateSwitchCounts();updateSortButtons();renderEntries();
  document.querySelectorAll('.switch-item').forEach(function(el,i){el.classList.toggle('active',(currentView==='active'&&i===0)||(currentView==='archived'&&i===1))});
  document.querySelectorAll('.page').forEach(function(p){p.classList.remove('active')});
  document.getElementById('page-detail').classList.add('active');
  if(opts.focusIdx!==undefined)focusEntry(opts.focusIdx);
  else window.scrollTo(0,0);
}
function countInfo(){
  var d=allData[current],a=0,ar=0;
  d.entries.forEach(function(e){if(e.meta.archived)ar++;else a++});
  return '活跃 '+a+' · 归档 '+ar;
}
function updateSwitchCounts(){
  var d=allData[current],a=0,ar=0;
  d.entries.forEach(function(e){if(e.meta.archived)ar++;else a++});
  document.getElementById('active-count').textContent='('+a+')';
  document.getElementById('archived-count').textContent='('+ar+')';
}
function switchView(v){
  currentView=v;
  document.querySelectorAll('.switch-item').forEach(function(el,i){el.classList.toggle('active',(v==='active'&&i===0)||(v==='archived'&&i===1))});
  renderEntries();
}
function renderPinnedCard(i,e){
  var tags=entryTags(e).slice(0,2);
  var meta=['重要性 '+e.meta.imp+'/10'];
  if(e.meta.time)meta.push(timeAgo(e.meta.time));
  tags.forEach(function(t){meta.push('#'+t)});
  var click=selectMode?'toggleSelect('+i+')':'openEntry(current,'+i+')';
  var checked=selectMode&&selected.has(i);
  var select=selectMode?'<div class="select-circle'+(checked?' checked':'')+'" onclick="event.stopPropagation();toggleSelect('+i+')"></div>':'';
  return '<article class="pinned-card" onclick="'+click+'">'+select+'<div class="pinned-card-main"><div class="pinned-card-text">'+esc(e.content)+'</div><div class="pinned-card-meta">'+meta.map(function(m){return'<span>'+esc(m)+'</span>'}).join('')+'</div></div><button class="pinned-card-pin" onclick="event.stopPropagation();quickPin('+i+')" aria-label="取消置顶">★</button></article>';
}
function renderEntryCard(i,e,isLong,compact){
  var circle=selectMode?'<div class="select-circle'+(selected.has(i)?' checked':'')+(selectMode==='delete'?' select-danger':'')+'" onclick="event.stopPropagation();toggleSelect('+i+')"></div>':'';
  var metaHtml='<div class="entry-meta">';
  if(!compact&&e.meta.pin)metaHtml+='<span class="entry-badge pin">★ 置顶</span>';
  if(e.meta.imp>=7)metaHtml+='<span class="entry-badge imp-high">'+e.meta.imp+'/10</span>';
  else metaHtml+='<span class="entry-badge">'+e.meta.imp+'/10</span>';
  if(!compact&&e.meta.tags)e.meta.tags.split(',').forEach(function(t){var tag=t.trim();if(tag)metaHtml+='<span class="entry-badge">#'+tag+'</span>'});
  if(e.meta.time)metaHtml+='<span class="entry-badge">'+timeAgo(e.meta.time)+'</span>';
  if(!compact){
    var days=e.meta.last?Math.floor((new Date()-new Date(e.meta.last))/864e5):0;var score;if(e.meta.pin&&e.meta.imp>=10){score='∞'}else if(e.meta.pin&&e.meta.imp>=9){score=Math.max(e.meta.imp*Math.pow(0.99,days),4).toFixed(2)}else{score=(e.meta.imp*Math.pow(0.99,days)).toFixed(2)}var scoreDetail='imp:'+e.meta.imp+' \u00d7 0.99^'+days+' = '+score;
    if(e.meta.pin&&e.meta.imp>=10)scoreDetail='imp:10 [pin] \u4e0d\u8870\u51cf';
    else if(e.meta.pin&&e.meta.imp>=9)scoreDetail='imp:'+e.meta.imp+' \u00d7 0.99^'+days+' (\u4fdd\u5e954)';
    metaHtml+='<span class="entry-badge score-badge" style="color:#e67e22;position:relative;cursor:pointer" data-score="'+scoreDetail+'">⚡'+score+'</span>';
  }
  metaHtml+='</div>';
  var actionHtml='<div class="entry-actions"><div class="entry-action-btn'+(e.meta.pin?' active':'')+'" onclick="event.stopPropagation();quickPin('+i+')">★</div><div class="entry-action-btn" onclick="event.stopPropagation();showEdit('+i+')">编辑</div>';
  if(compact)actionHtml+='<div class="entry-action-btn open" onclick="event.stopPropagation();openEntry(current,'+i+')">打开</div>';
  actionHtml+='</div>';
  var html='<div class="entry-wrap'+(compact?' pinned-entry-wrap':'')+(selectMode&&selected.has(i)?' selected':'')+'"><div class="entry-del-bg" onpointerdown="event.stopPropagation()" ontouchstart="event.stopPropagation()" onclick="event.stopPropagation();showDelConfirm('+i+')">删除</div>';
  var swipeAttrs=window.PointerEvent?' onpointerdown="ps(event,'+i+')" onpointermove="pm(event,'+i+')" onpointerup="pe(event,'+i+')" onpointercancel="pe(event,'+i+')"':' ontouchstart="ts(event,'+i+')" ontouchmove="tm(event,'+i+')" ontouchend="te(event,'+i+')"';
  var itemAttrs=compact?' onclick="'+(selectMode?'toggleSelect('+i+')':'openEntry(current,'+i+')')+'"':swipeAttrs+' onclick="onEntryCardClick('+i+')"';
  var textClick='';
  var contentHtml=(singleEntryIdx!==null&&detailHighlightQuery)?highlightText(e.content,detailHighlightQuery):esc(e.content);
  html+='<div class="entry-item" id="entry-'+i+'"'+itemAttrs+'>';
  html+=circle+'<div style="flex:1;min-width:0"><div class="entry-text'+(isLong?' collapsed':'')+'" id="text-'+i+'"'+textClick+'>'+contentHtml+'</div>';
  if(isLong)html+='<div class="entry-expand" onclick="event.stopPropagation();if(!selectMode)openEntry(current,'+i+')">阅读全文</div>';
  html+=metaHtml+actionHtml+'</div></div></div>';
  return html;
}
function entryVisibleInDetail(e,i){
  if(singleEntryIdx!==null&&i!==singleEntryIdx)return false;
  if(currentView==='active'&&e.meta.archived)return false;
  if(currentView==='archived'&&!e.meta.archived)return false;
  if(singleEntryIdx===null&&filterTag&&!(e.meta.tags&&e.meta.tags.indexOf(filterTag)>=0))return false;
  return true;
}
function sortEntryIndexes(idxs,entries){
  return idxs.sort(function(a,b){
    var ea=entries[a],eb=entries[b],cmp=0;
    if(currentSort==='time'){
      return compareEntryTime(ea,eb,a,b,currentSortDir);
    }else if(currentSort==='weight'){
      var sa=decayedScore(ea),sb=decayedScore(eb);
      if(sa===sb)return compareEntryTime(ea,eb,a,b,currentSortDir);
      else cmp=sa<sb?-1:1;
    }
    return currentSortDir==='asc'?cmp:-cmp;
  });
}
function renderEntries(){
  var entries=allData[current].entries,pinned=[],normal=[];
  for(var i=0;i<entries.length;i++){
    var e=entries[i];
    if(!entryVisibleInDetail(e,i))continue;
    if(singleEntryIdx===null&&e.meta.pin)pinned.push(i);
    else normal.push(i);
  }
  normal=sortEntryIndexes(normal,entries);
  var html='',count=pinned.length+normal.length;
  if(pinned.length){
    html+='<section class="pinned-window"><div class="pinned-window-head"><div><span>置顶</span><small>当前分类</small></div><b>'+pinned.length+' 条</b></div><div class="pinned-window-track">';
    pinned.forEach(function(i){html+=renderPinnedCard(i,entries[i])});
    html+='</div></section>';
  }
  if(pinned.length&&normal.length)html+='<div class="entry-section-head"><span>普通记忆</span><small>'+normal.length+' 条</small></div>';
  normal.forEach(function(i){html+=renderEntryCard(i,entries[i],singleEntryIdx===null&&entries[i].content.length>100,false)});
  document.getElementById('d-entries').innerHTML=count?html:'<div class="empty-state">暂无条目</div>';
  updateSwitchCounts();
}
function quickPin(i){
  var cat=current,before=cloneEntries(allData[cat].entries),next=cloneEntries(allData[cat].entries),entry=next[i];
  if(!entry)return;
  entry.meta.pin=!entry.meta.pin;
  var version=nextCategoryVersion(cat);
  setCategoryEntries(cat,next);
  toast((entry.meta.pin?'已置顶':'已取消置顶')+'，后台同步中');
  queueCategoryWrite(cat,next,{version:version,rollback:before,failMsg:'同步失败，已回滚'});
}
function toggleExpand(i){
  if(touchState.moved){touchState.moved=false;return}
  var el=document.getElementById('text-'+i);if(!el)return;
  if(el.classList.contains('collapsed')){el.classList.remove('collapsed');var b=el.nextElementSibling;if(b&&b.classList.contains('entry-expand'))b.textContent='收起'}
  else if(allData[current].entries[i].content.length>100){el.classList.add('collapsed');var b=el.nextElementSibling;if(b&&b.classList.contains('entry-expand'))b.textContent='展开'}
}
function startSwipeAt(x,y,i){
  if(touchState.openIdx!==-1&&touchState.openIdx!==i)closeSwipe(touchState.openIdx);
  touchState.startX=x;touchState.startY=y;
  touchState.swiping=false;touchState.moved=false;touchState.idx=i;touchState.offset=touchState.openIdx===i?86:0;touchState.startOffset=touchState.offset;
}
function moveSwipeAt(x,y,i,e){
  var dx=touchState.startX-x;
  var dy=Math.abs(y-touchState.startY);
  if(!touchState.swiping&&dy>Math.abs(dx))return;
  if(!touchState.swiping&&Math.abs(dx)<15)return;
  touchState.swiping=true;touchState.moved=true;
  if(e&&e.preventDefault)e.preventDefault();
  var el=document.getElementById('entry-'+i);
  if(!el)return;
  var wrap=el.closest('.entry-wrap');
  if(wrap)wrap.classList.add('swiping');
  var offset=Math.max(0,Math.min(86,touchState.startOffset+dx));
  touchState.offset=offset;
  el.style.transform='translate3d(-'+offset+'px,0,0)';
  el.style.transition='none';
}
function endSwipe(i){
  if(selectMode||!touchState.moved)return;
  var el=document.getElementById('entry-'+i);
  var wrap=el?el.closest('.entry-wrap'):null;
  var open=touchState.offset>=46;
  if(el){
    el.style.transition='transform 0.22s cubic-bezier(.2,.8,.2,1)';
    el.style.transform=open?'translate3d(-86px,0,0)':'translate3d(0,0,0)';
  }
  if(wrap){
    wrap.classList.remove('swiping');
    wrap.classList.toggle('swiped',open);
  }
  touchState.openIdx=open?i:-1;
  touchState.swiping=false;
  suppressClickUntil=Date.now()+280;
  setTimeout(function(){touchState.moved=false},300);
}
function ts(e,i){
  if(selectMode||e.touches.length!==1)return;
  startSwipeAt(e.touches[0].clientX,e.touches[0].clientY,i);
}
function tm(e,i){
  if(selectMode||e.touches.length!==1)return;
  moveSwipeAt(e.touches[0].clientX,e.touches[0].clientY,i,e);
}
function te(e,i){endSwipe(i)}
function ps(e,i){
  if(selectMode||(e.pointerType==='mouse'&&e.button!==0))return;
  touchState.pointerId=e.pointerId;
  if(e.currentTarget&&e.currentTarget.setPointerCapture){
    try{e.currentTarget.setPointerCapture(e.pointerId)}catch(_e){}
  }
  startSwipeAt(e.clientX,e.clientY,i);
}
function pm(e,i){
  if(selectMode||touchState.pointerId!==e.pointerId)return;
  moveSwipeAt(e.clientX,e.clientY,i,e);
}
function pe(e,i){
  if(touchState.pointerId!==null&&touchState.pointerId!==e.pointerId)return;
  endSwipe(i);
  touchState.pointerId=null;
}
function onEntryCardClick(i){
  if(selectMode){toggleSelect(i);return}
  if(touchState.openIdx===i){closeSwipe(i);return}
  if(singleEntryIdx===null&&!touchState.moved)openEntry(current,i);
}
function showEdit(i){
  editIdx=i;var e=allData[current].entries[i];
  document.getElementById('edit-content').value=e.content;
  var sel=document.getElementById('edit-imp');sel.innerHTML='';
  for(var n=1;n<=10;n++)sel.innerHTML+='<option value="'+n+'"'+(e.meta.imp===n?' selected':'')+'>'+n+'</option>';
  document.getElementById('edit-pin').value=e.meta.pin?'1':'0';
  document.getElementById('edit-tags').value=e.meta.tags||'';
  document.getElementById('edit-archived').value=e.meta.archived?'1':'0';
  document.getElementById('editModal').classList.add('show');
}
function hideEdit(){document.getElementById('editModal').classList.remove('show');editIdx=null}
function saveEdit(){
  if(editIdx===null)return;
  var cat=current,idx=editIdx,before=cloneEntries(allData[cat].entries),next=cloneEntries(allData[cat].entries),e=next[idx];
  if(!e)return;
  var nc=document.getElementById('edit-content').value.trim();
  if(nc)e.content=nc;
  e.meta.imp=parseInt(document.getElementById('edit-imp').value);
  e.meta.pin=document.getElementById('edit-pin').value==='1';
  e.meta.tags=document.getElementById('edit-tags').value.trim();
  e.meta.archived=document.getElementById('edit-archived').value==='1';
  var version=nextCategoryVersion(cat);
  hideEdit();
  setCategoryEntries(cat,next);
  toast('已保存，后台同步中');
  queueCategoryWrite(cat,next,{version:version,rollback:before,failMsg:'保存同步失败，已回滚'});
}
function showDelConfirm(i){
  suppressClickUntil=0;
  delIdx=i;
  var btn=document.querySelector('#confirmDel .btn-red');
  if(btn){btn.disabled=false;btn.textContent='删除'}
  document.getElementById('confirmDel').classList.add('show');
}
function cancelDel(){document.getElementById('confirmDel').classList.remove('show');delIdx=null;resetSwipes()}
function confirmDel(){
  if(delIdx===null||!allData[current]||!allData[current].entries[delIdx]){cancelDel();return}
  var idx=delIdx,cat=current,before=cloneEntries(allData[cat].entries),next=cloneEntries(allData[cat].entries);
  next.splice(idx,1);
  var btn=document.querySelector('#confirmDel .btn-red');
  if(btn){btn.disabled=false;btn.textContent='删除'}
  document.getElementById('confirmDel').classList.remove('show');delIdx=null;
  resetSwipes();
  var version=nextCategoryVersion(cat);
  setCategoryEntries(cat,next);
  toast('已删除，后台同步中');
  queueCategoryWrite(cat,next,{version:version,rollback:before,failMsg:'删除同步失败，已恢复'});
}
function closeSwipe(i){
  var el=document.getElementById('entry-'+i);
  if(!el)return;
  var wrap=el.closest('.entry-wrap');
  el.style.transition='transform 0.2s ease';
  el.style.transform='translate3d(0,0,0)';
  if(wrap)wrap.classList.remove('swiping','swiped');
  if(touchState.openIdx===i)touchState.openIdx=-1;
}
function resetSwipes(){
  document.querySelectorAll('.entry-item').forEach(function(el){
    el.style.transition='transform 0.2s ease';
    el.style.transform='translate3d(0,0,0)';
    var wrap=el.closest('.entry-wrap');
    if(wrap)wrap.classList.remove('swiping','swiped');
  });
  touchState.openIdx=-1;
}
function toggleMenu(){document.getElementById('menu-popup').classList.toggle('show')}
function startSelect(mode){
  selectMode=mode;selected.clear();
  document.getElementById('menu-popup').classList.remove('show');
  document.getElementById('select-bar').classList.add('show');
  var btn=document.getElementById('select-action-btn');
  btn.textContent=mode==='export'?'导出 (0)':'删除 (0)';
  btn.className=mode==='export'?'btn btn-blue btn-sm':'btn btn-red btn-sm';
  renderEntries();renderHomeInsights();
}
function cancelSelect(){selectMode=null;selected.clear();document.getElementById('select-bar').classList.remove('show');renderEntries()}
function toggleSelect(i){
  if(selected.has(i))selected.delete(i);else selected.add(i);
  document.getElementById('select-action-btn').textContent=(selectMode==='export'?'导出':'删除')+' ('+selected.size+')';
  renderEntries();
}
function selectAll(){
  var entries=allData[current].entries,view=[];
  entries.forEach(function(e,i){if(entryVisibleInDetail(e,i))view.push(i)});
  if(selected.size===view.length)selected.clear();else view.forEach(function(i){selected.add(i)});
  document.getElementById('select-action-btn').textContent=(selectMode==='export'?'导出':'删除')+' ('+selected.size+')';
  renderEntries();
}
function doSelectAction(){
  if(!selected.size){toast('请选择条目');return}
  if(selectMode==='export'){
    var entries=allData[current].entries;
    var content=Array.from(selected).sort(function(a,b){return a-b}).map(function(i){return entries[i].content}).join('\n---\n');
    var blob=new Blob([content],{type:'text/plain;charset=utf-8'});
    var url=URL.createObjectURL(blob);var a=document.createElement('a');a.href=url;a.download=current+'_export.txt';a.click();URL.revokeObjectURL(url);toast('已导出');
    selectMode=null;selected.clear();document.getElementById('select-bar').classList.remove('show');renderEntries();return;
  }else{
    var idxs=Array.from(selected).sort(function(a,b){return b-a});
    if(!confirm('确定删除选中的 '+idxs.length+' 条记忆？'))return;
    var cat=current,before=cloneEntries(allData[cat].entries),next=cloneEntries(allData[cat].entries);
    idxs.forEach(function(i){next.splice(i,1)});
    var btn=document.getElementById('select-action-btn');
    if(btn)btn.disabled=false;
    selectMode=null;selected.clear();document.getElementById('select-bar').classList.remove('show');
    var version=nextCategoryVersion(cat);
    setCategoryEntries(cat,next);
    toast('已删除 '+idxs.length+' 条，后台同步中');
    queueCategoryWrite(cat,next,{version:version,rollback:before,failMsg:'批量删除同步失败，已恢复'});
    return;
  }
}
function showRename(){document.getElementById('menu-popup').classList.remove('show');document.getElementById('rename-input').value=current;document.getElementById('renameModal').classList.add('show')}
function hideRename(){document.getElementById('renameModal').classList.remove('show')}
function doRename(){
  var nn=document.getElementById('rename-input').value.trim();
  if(!nn||nn===current){hideRename();return}
  if(allData[nn]){toast('分类已存在');return}
  var old=current,entries=cloneEntries(allData[old].entries),backup=allData[old],version=nextCategoryVersion(nn);
  allData[nn]={entries:entries};delete allData[old];current=nn;
  hideRename();document.getElementById('d-title').textContent=nn;document.getElementById('d-sub').textContent=countInfo();renderAll();savePanelCache();toast('已重命名，后台同步中');
  syncingCategories[nn]=(syncingCategories[nn]||0)+1;
  writeCategoryEntries(nn,entries).then(function(){
    return rpcStrict('delete_repo',{repo:'memory-server',path:'memories/'+old+'.md'});
  }).then(function(){
    toast('重命名已同步');
  }).catch(function(){
    if(categoryWriteVersions[nn]===version){
      delete allData[nn];allData[old]=backup;current=old;
      document.getElementById('d-title').textContent=old;document.getElementById('d-sub').textContent=countInfo();
      renderAll();renderEntries();savePanelCache();toast('重命名同步失败，已恢复');
    }else{
      toast('重命名后台同步失败，请刷新确认');
    }
  }).then(function(){
    syncingCategories[nn]=Math.max(0,(syncingCategories[nn]||1)-1);
    if(!syncingCategories[nn])delete syncingCategories[nn];
  });
}
function delCategory(){
  document.getElementById('menu-popup').classList.remove('show');
  if(!confirm('确定删除分类「'+current+'」？'))return;
  var cat=current,backup=allData[cat];
  delete allData[cat];savePanelCache();toast('已删除分类，后台同步中');goMemory();
  rpcStrict('delete_repo',{repo:'memory-server',path:'memories/'+cat+'.md'}).then(function(){
    toast('分类已同步删除');
  }).catch(function(){
    allData[cat]=backup;savePanelCache();renderAll();toast('分类删除失败，已恢复');
  });
}
function addEntry(){
  var input=document.getElementById('add-input'),text=input.value.trim();if(!text)return;
  var imp=parseInt(document.getElementById('add-imp').value),tags=document.getElementById('add-tags').value.trim();
  var today=dateKey(new Date());
  var cat=current,before=cloneEntries(allData[cat].entries),next=cloneEntries(allData[cat].entries);
  next.push({meta:{imp:imp,time:today,last:today,tags:tags,pin:false,resolved:false,archived:false},content:text});
  singleEntryIdx=null;
  input.value='';document.getElementById('add-tags').value='';document.getElementById('char-count').textContent='0 字';
  var version=nextCategoryVersion(cat);
  setCategoryEntries(cat,next);
  var wraps=document.querySelectorAll('.entry-wrap');if(wraps.length)wraps[wraps.length-1].classList.add('new-entry');
  toast('已添加，后台同步中');
  queueCategoryWrite(cat,next,{version:version,rollback:before,failMsg:'添加同步失败，已回滚'});
}
function updateCount(){document.getElementById('char-count').textContent=document.getElementById('add-input').value.length+' 字'}
function wait(ms){return new Promise(function(resolve){setTimeout(resolve,ms)})}
function cloneEntries(entries){
  return JSON.parse(JSON.stringify(entries||[]));
}
function nextCategoryVersion(category){
  categoryWriteVersions[category]=(categoryWriteVersions[category]||0)+1;
  return categoryWriteVersions[category];
}
function renderCategoryState(category){
  if(current===category&&document.getElementById('page-detail').classList.contains('active')){
    updateSwitchCounts();
    renderEntries();
  }
  updateStats();
  renderHomeInsights();
  savePanelCache();
}
function setCategoryEntries(category,entries){
  if(!allData[category])allData[category]={entries:[]};
  allData[category].entries=entries;
  renderCategoryState(category);
}
function writeCategoryEntries(category,entries){
  var content=serializeEntries(entries);
  return rpcStrict('write_memory',{category:category,content:content}).then(function(){
    function verify(tries){
      return rpcStrict('read_memory',{category:category}).then(function(raw){
        var actual=(!raw||raw==='Empty')?'':serializeEntries(parseEntries(raw));
        if(actual.trim()===content.trim())return raw;
        if(tries<=0)throw new Error('write verification failed');
        return wait(450).then(function(){return verify(tries-1)});
      });
    }
    return verify(3);
  });
}
function queueCategoryWrite(category,entries,opts){
  opts=opts||{};
  var snapshot=cloneEntries(entries);
  var version=opts.version||categoryWriteVersions[category]||0;
  syncingCategories[category]=(syncingCategories[category]||0)+1;
  var prior=categoryWriteChains[category]||Promise.resolve();
  var job=prior.catch(function(){}).then(function(){return writeCategoryEntries(category,snapshot)});
  categoryWriteChains[category]=job;
  job.then(function(){
    if(opts.successMsg&&categoryWriteVersions[category]===version)toast(opts.successMsg);
  }).catch(function(){
    if(opts.rollback&&categoryWriteVersions[category]===version){
      setCategoryEntries(category,cloneEntries(opts.rollback));
      toast(opts.failMsg||'同步失败，已回滚');
    }else{
      toast(opts.failMsgNoRollback||'后台同步失败，请刷新确认');
    }
  }).then(function(){
    syncingCategories[category]=Math.max(0,(syncingCategories[category]||1)-1);
    if(!syncingCategories[category])delete syncingCategories[category];
  });
  return job;
}
function saveCurrentCategory(){
  savePanelCache();
  return writeCategoryEntries(current,allData[current].entries).catch(function(err){
    toast('同步失败，请稍后重试');
    return '';
  });
}
function serializeEntries(entries){
  if(!entries||!entries.length)return EMPTY_CATEGORY_MARKER;
  return entries.map(function(e){
    var m=e.meta,p=[];
    if(m.pin)p.push('[pin]');if(m.resolved)p.push('[resolved]');if(m.archived)p.push('[archived]');
    p.push('[imp:'+m.imp+']');if(m.time)p.push('[time:'+m.time+']');if(m.last)p.push('[last:'+m.last+']');if(m.tags)p.push('[tags:'+m.tags+']');
    return p.join('')+'\n'+e.content;
  }).join('\n---\n');
}
function showModal(){document.getElementById('newModal').classList.add('show');document.getElementById('new-name').focus()}
function hideModal(){document.getElementById('newModal').classList.remove('show');document.getElementById('new-name').value=''}
function createCat(){
  var name=document.getElementById('new-name').value.trim();if(!name)return;
  if(allData[name]){hideModal();openDetail(name);return}
  allData[name]={entries:[]};hideModal();renderGrid();updateStats();renderHomeInsights();savePanelCache();openDetail(name);
  var version=nextCategoryVersion(name);
  toast('已创建，后台同步中');
  queueCategoryWrite(name,[],{version:version,failMsgNoRollback:'分类创建同步失败'}).catch(function(){
    if(categoryWriteVersions[name]===version&&allData[name]&&!(allData[name].entries||[]).length){
      delete allData[name];savePanelCache();renderGrid();goMemory();
    }
  });
}
function goMemory(){
  if(singleEntryIdx!==null&&detailReturnState&&detailReturnState.cat===current){
    var state=detailReturnState;
    detailReturnState=null;
    singleEntryIdx=null;
    detailHighlightQuery='';
    currentView=state.view||'active';
    filterTag=state.filterTag||'';
    activeTags=filterTag?[filterTag]:[];
    syncActiveTag();
    currentSort=state.sort||currentSort;
    currentSortDir=state.sortDir||currentSortDir;
    selectMode=null;selected.clear();
    document.getElementById('select-bar').classList.remove('show');
    document.getElementById('menu-popup').classList.remove('show');
    document.getElementById('d-sub').textContent=countInfo();
    updateSwitchCounts();updateSortButtons();renderEntries();
    document.querySelectorAll('.switch-item').forEach(function(el,i){el.classList.toggle('active',(currentView==='active'&&i===0)||(currentView==='archived'&&i===1))});
    setTimeout(function(){window.scrollTo(0,state.scrollY||0)},0);
    return;
  }
  var target=returnPanelTab||currentPanelTab||'overview';
  selectMode=null;selected.clear();singleEntryIdx=null;
  detailHighlightQuery='';
  if(target!=='search'){
    filterTag='';activeTags=[];syncActiveTag();
    document.getElementById('search-input').value='';
    document.getElementById('search-results').style.display='none';
  }
  document.getElementById('select-bar').classList.remove('show');
  document.getElementById('cat-grid').style.display='grid';
  document.querySelectorAll('.page').forEach(function(p){p.classList.remove('active')});
  document.getElementById('page-memory').classList.add('active');
  updateStats();renderGrid();renderTags();renderHomeInsights();
  switchPanelTab(target,{restoreScroll:returnScrollY});
}
function toast(msg){var t=document.getElementById('toast');t.textContent=msg;t.className='toast show';setTimeout(function(){t.className='toast'},2000)}
function esc(s){var d=document.createElement('div');d.textContent=s;return d.innerHTML}
function escAttr(s){return esc(s).replace(/"/g,'&quot;').replace(/'/g,'&#39;')}
document.addEventListener('click',function(e){
  if(e.target.closest('.entry-del-bg'))return;
  if(Date.now()<suppressClickUntil){
    e.preventDefault();
    e.stopImmediatePropagation();
  }
},true);
document.addEventListener('click',function(e){var m=document.getElementById('menu-popup');if(m&&m.classList.contains('show')&&!e.target.closest('.menu-btn')&&!e.target.closest('.menu-popup'))m.classList.remove('show')});
function isSingleDetailBackTarget(target){
  if(singleEntryIdx===null)return false;
  if(!document.getElementById('page-detail').classList.contains('active'))return false;
  if(!target.closest('#d-entries'))return false;
  if(target.closest('button,.back-btn,.entry-action-btn,.entry-expand,.menu-btn,.menu-popup,.switch-bar,.sort-bar,.select-bar,.add-area,.modal-bg,.confirm-bg,.score-badge'))return false;
  return true;
}
function goBackFromSingleDetail(target){
  if(isSingleDetailBackTarget(target)){
    suppressClickUntil=Date.now()+520;
    goMemory();
  }
}
document.addEventListener('dblclick',function(e){
  if(isSingleDetailBackTarget(e.target)){
    e.preventDefault();
    e.stopPropagation();
    goBackFromSingleDetail(e.target);
  }
});
document.addEventListener('touchend',function(e){
  if(!isSingleDetailBackTarget(e.target))return;
  var now=Date.now();
  if(now-lastSingleTapAt<320){
    lastSingleTapAt=0;
    suppressClickUntil=now+650;
    e.preventDefault();
    e.stopPropagation();
    goMemory();
  }else{
    lastSingleTapAt=now;
  }
},{passive:false});
function switchPanelTab(tab,opts) {
  opts=opts||{};
  currentPanelTab=tab;
  document.querySelectorAll('.panel-tab').forEach(function(el){el.classList.remove('active')});
  document.querySelectorAll('.top-tab').forEach(function(el){el.classList.toggle('active',el.getAttribute('data-tab')===tab)});
  var panel=document.getElementById('tab-'+tab);
  if(panel)panel.classList.add('active');
  if(tab==='categories'){
    document.getElementById('cat-grid').style.display='grid';
    renderGrid();
  }
  if(tab==='search'){
    renderTags();
    document.getElementById('search-results').style.display='block';
    if(!document.getElementById('search-input').value.trim()&&!hasActiveTags()&&searchFilter==='all')renderSearchLanding();
    else onSearch();
  }
  if(tab==='graph'&&!graphLoaded){
    loadEntityGraph(false);
  }
  if(typeof opts.restoreScroll==='number'){
    setTimeout(function(){window.scrollTo(0,opts.restoreScroll)},0);
  }else{
    window.scrollTo(0,0);
  }
}
function updateSortButtons(){
  document.querySelectorAll('.sort-btn').forEach(function(el){
    var key=el.getAttribute('data-sort');
    var active=key===currentSort;
    el.classList.toggle('active',active);
    var label=key==='time'?'按时间':'按权重';
    el.textContent=active?label+' '+(currentSortDir==='asc'?'↑':'↓'):label;
    el.title=active?(currentSortDir==='asc'?'正序':'倒序'):'点击排序';
  });
}
function switchSort(s){
  if(currentSort===s)currentSortDir=currentSortDir==='asc'?'desc':'asc';
  else{currentSort=s;currentSortDir='asc'}
  updateSortButtons();
  renderEntries();
}
document.addEventListener('click',function(e){
  var badge=e.target.closest('.score-badge');
  if(!badge)return;
  e.stopPropagation();
  var old=document.querySelector('.score-popup');
  if(old)old.remove();
  var popup=document.createElement('div');
  popup.className='score-popup';
  popup.textContent=badge.getAttribute('data-score');
  badge.appendChild(popup);
  setTimeout(function(){popup.remove()},3000);
});
init();
