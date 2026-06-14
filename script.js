var API_BASE='https://memory-tools-kjlrchffqe.cn-hangzhou.fcapp.run';
var API_KEY_STORAGE='ckMemoryApiKey';
var API=API_BASE;
var ENTITY_GRAPH_URL=localStorage.getItem('entityGraphUrl')||API_BASE+'/entity-graph';
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
function rpc(tool,args){return apiFetch({method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',method:'tools/call',params:{name:tool,arguments:args||{}},id:Date.now()})}).then(function(r){return r.json()}).then(function(d){return d.result&&d.result.content&&d.result.content[0]?d.result.content[0].text:''}).catch(function(){return ''})}
function rpcStrict(tool,args){return apiFetch({method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',method:'tools/call',params:{name:tool,arguments:args||{}},id:Date.now()})}).then(function(r){if(!r.ok)throw new Error('HTTP '+r.status);return r.json()}).then(function(d){return d.result&&d.result.content&&d.result.content[0]?d.result.content[0].text:''})}
var catNameMap={timeline:'时间线',details:'详细记录',intimate:'亲密',preferences:'偏好',todo:'待办',rules:'规则',daily:'日常',feelings:'感受',dreams:'梦境',people:'人物',places:'地点',music:'音乐',food:'美食',health:'健康',work:'工作',memory:'记忆',important:'重要',archive:'归档',misc:'杂项',habits:'习惯',goals:'目标',ideas:'想法',quotes:'语录',gifts:'礼物',dates:'纪念日',promises:'承诺',fights:'吵架记录',growth:'成长',kinks:'癖好',body:'身体',toys:'玩具',fantasies:'幻想',aftercare:'事后关怀',boundaries:'边界','todo-panel':'面板待办','todo-memory':'记忆待办'};
function getCnName(k){return catNameMap[k.toLowerCase()]||''}
var current=null,allData={},delIdx=null,selectMode=null,selected=new Set(),currentView='active',allTags=new Set(),activeTag='',activeTags=[],editIdx=null,filterTag='',currentPanelTab='overview',returnPanelTab='overview',returnScrollY=0,graphLoaded=false,renderQueued=false,searchFilter='all',singleEntryIdx=null,tagsExpanded=false;
var currentSort='time',currentSortDir='desc';
var touchState={startX:0,startY:0,swiping:false,moved:false,idx:-1};
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
        allData[c]={entries:entries};loaded++;
        setLoading(Math.round(loaded/total*100),'后台更新 '+loaded+'/'+total);
        if(current===c&&document.getElementById('page-detail').classList.contains('active')){updateSwitchCounts();renderEntries()}
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
    return;
  }
  listEl.innerHTML=items.map(function(item){
    var e=item.entry,title=getCnName(item.cat)||item.cat;
    var tags=entryTags(e).slice(0,3).map(function(t){return'<span>#'+esc(t)+'</span>'}).join('');
    return '<div class="today-roll-item" data-cat="'+escAttr(item.cat)+'" data-idx="'+item.idx+'" onclick="openEntry(this.dataset.cat,parseInt(this.dataset.idx,10))"><div class="today-roll-top"><b>'+esc(title)+'</b><small>'+esc(item.date)+'</small></div><div class="today-roll-text">'+esc(shortText(e.content,120))+'</div>'+(tags?'<div class="today-roll-tags">'+tags+'</div>':'')+'</div>';
  }).join('');
}
function openEntry(cat,idx){
  if(!allData[cat]||!allData[cat].entries[idx])return;
  var entry=allData[cat].entries[idx];
  openDetail(cat,{view:entry.meta.archived?'archived':'active',singleIdx:idx});
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
  var nodes=document.getElementById('entity-nodes');
  var rels=document.getElementById('entity-relations');
  var status=document.getElementById('graph-status');
  if(showPanel&&currentPanelTab!=='graph'){switchPanelTab('graph');return}
  if(box)box.classList.add('loading');
  if(status)status.textContent='正在读取信息网...';
  if(nodes)nodes.innerHTML='<div class="empty-state small">加载中...</div>';
  if(rels)rels.innerHTML='';
  fetch(ENTITY_GRAPH_URL).then(function(r){if(!r.ok)throw new Error('HTTP '+r.status);return r.json()}).then(function(data){
    if(!data||typeof data!=='object'||Array.isArray(data)||(!data.counts&&!data.top_nodes&&!data.recent_relations))throw new Error('Invalid graph data');
    graphLoaded=true;
    if(box)box.classList.remove('loading');
    if(status)status.textContent='已读取面板预览数据。';
    renderEntityGraph(data);
  }).catch(function(){
    if(box)box.classList.remove('loading');
    if(status)status.textContent='没有读到可用的信息网数据。';
    if(nodes)nodes.innerHTML='<div class="entity-error">预览暂时读不到。接口当前没有返回可用的节点/关系数据。</div>';
    if(rels)rels.innerHTML='';
    var stats=document.getElementById('entity-stats');
    if(stats)stats.innerHTML='';
  });
}
function renderEntityGraph(data){
  var stats=document.getElementById('entity-stats');
  var nodes=document.getElementById('entity-nodes');
  var rels=document.getElementById('entity-relations');
  var updated=document.getElementById('entity-updated');
  var status=document.getElementById('graph-status');
  var counts=data.counts||{};
  if(updated)updated.textContent=data.updated?'更新 '+data.updated:'';
  if(status){
    if((counts.nodes||0)===0&&(counts.relations||0)===0)status.textContent='读取成功，但信息网里还没有节点和关系。通常是当天整理任务还没生成，或后端还没部署最新版本。';
    else status.textContent='已读取：'+(counts.nodes||0)+' 个节点，'+(counts.relations||0)+' 条关系。';
  }
  if(stats)stats.innerHTML='<div><b>'+(counts.nodes||0)+'</b><span>节点</span></div><div><b>'+(counts.relations||0)+'</b><span>关系</span></div><div><b>'+(counts.orphan_nodes||0)+'</b><span>孤立</span></div>';
  var nodeList=(data.top_nodes||[]).slice(0,8);
  if(nodes){
    if(!nodeList.length)nodes.innerHTML='<div class="empty-state small">暂无节点</div>';
    else nodes.innerHTML=nodeList.map(function(n){
      return '<div class="mini-item"><div class="mini-top"><span>'+esc(n.name||n.key||'')+'</span><b>'+esc(n.type||'')+'</b></div><div class="mini-text">'+esc(shortText(n.summary||'',90))+'</div><div class="mini-reason">重要性 '+(n.importance||5)+' · 提及 '+(n.mentions||0)+'</div></div>';
    }).join('');
  }
  var relList=(data.recent_relations||[]).slice(0,8);
  if(rels){
    if(!relList.length)rels.innerHTML='<div class="empty-state small">暂无关系</div>';
    else rels.innerHTML=relList.map(function(r){
      return '<div class="mini-item"><div class="mini-top"><span>'+esc(r.source||'')+' → '+esc(r.target||'')+'</span><b>'+esc(r.relation||'')+'</b></div><div class="mini-text">'+esc(shortText(r.detail||'',90))+'</div><div class="mini-reason">'+esc(r.last_seen||'')+'</div></div>';
    }).join('');
  }
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
  var tagLimit=8;
  var visible=tagsExpanded?sorted:sorted.slice(0,tagLimit);
  activeTags.forEach(function(t){if(visible.indexOf(t)<0&&sorted.indexOf(t)>=0)visible.push(t)});
  if(bar)bar.classList.toggle('expanded',tagsExpanded);
  var html='';
  visible.forEach(function(t){html+='<div class="tag-btn'+(selected.has(t)?' active':'')+'" data-tag="'+escAttr(t)+'" onclick="toggleTag(this.dataset.tag)">'+esc(t)+' ('+tagCounts[t]+')</div>'});
  bar.innerHTML=html||'<div class="empty-state small">暂无标签</div>';
  var summary=document.getElementById('tag-summary');
  if(summary)summary.textContent=sorted.length?(activeTags.length?'已选 '+activeTags.length+' 个 · 按出现次数排序':(tagsExpanded?'全部 '+sorted.length+' 个':'常用前 '+Math.min(tagLimit,sorted.length)+' / '+sorted.length+' 个')):'暂无标签';
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
  if(document.getElementById('page-memory').classList.contains('active')){
    returnPanelTab=opts.fromTab||currentPanelTab||'overview';
    returnScrollY=window.scrollY||0;
  }
  current=k;selectMode=null;selected.clear();currentView=opts.view||'active';
  singleEntryIdx=typeof opts.singleIdx==='number'?opts.singleIdx:null;
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
function renderEntryCard(i,e,isLong,compact){
  var circle=selectMode?'<div class="select-circle'+(selected.has(i)?' checked':'')+'" onclick="event.stopPropagation();toggleSelect('+i+')"></div>':'';
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
  var actionHtml='<div class="entry-actions"><div class="entry-action-btn'+(e.meta.pin?' active':'')+'" onclick="event.stopPropagation();quickPin('+i+')">★</div><div class="entry-action-btn" onclick="event.stopPropagation();showEdit('+i+')">编辑</div></div>';
  var html='<div class="entry-wrap'+(compact?' pinned-entry-wrap':'')+'"><div class="entry-del-bg" onclick="showDelConfirm('+i+')">删除</div>';
  html+='<div class="entry-item" id="entry-'+i+'" ontouchstart="ts(event,'+i+')" ontouchmove="tm(event,'+i+')" ontouchend="te(event,'+i+')">';
  html+=circle+'<div style="flex:1"><div class="entry-text'+(isLong?' collapsed':'')+'" id="text-'+i+'" onclick="if(!selectMode)toggleExpand('+i+')">'+esc(e.content)+'</div>';
  if(isLong)html+='<div class="entry-expand" onclick="if(!selectMode)toggleExpand('+i+')">展开</div>';
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
    html+='<section class="pinned-box"><div class="pinned-box-head"><span>置顶</span><small>'+pinned.length+' 条</small></div><div class="pinned-box-list">';
    pinned.forEach(function(i){html+=renderEntryCard(i,entries[i],false,true)});
    html+='</div></section>';
  }
  if(pinned.length&&normal.length)html+='<div class="entry-section-head"><span>普通记忆</span><small>'+normal.length+' 条</small></div>';
  normal.forEach(function(i){html+=renderEntryCard(i,entries[i],singleEntryIdx===null&&entries[i].content.length>100,false)});
  document.getElementById('d-entries').innerHTML=count?html:'<div class="empty-state">暂无条目</div>';
  updateSwitchCounts();
}
function quickPin(i){
  var e=allData[current].entries[i];e.meta.pin=!e.meta.pin;
  renderEntries();renderHomeInsights();toast(e.meta.pin?'已置顶':'已取消置顶');
  setTimeout(function(){saveCurrentCategory()},50);
}
function toggleExpand(i){
  if(touchState.moved){touchState.moved=false;return}
  var el=document.getElementById('text-'+i);if(!el)return;
  if(el.classList.contains('collapsed')){el.classList.remove('collapsed');var b=el.nextElementSibling;if(b&&b.classList.contains('entry-expand'))b.textContent='收起'}
  else if(allData[current].entries[i].content.length>100){el.classList.add('collapsed');var b=el.nextElementSibling;if(b&&b.classList.contains('entry-expand'))b.textContent='展开'}
}
function ts(e,i){
  if(selectMode)return;
  touchState.startX=e.touches[0].clientX;touchState.startY=e.touches[0].clientY;
  touchState.swiping=false;touchState.moved=false;touchState.idx=i;
}
function tm(e,i){
  if(selectMode)return;
  var dx=touchState.startX-e.touches[0].clientX;
  var dy=Math.abs(e.touches[0].clientY-touchState.startY);
  if(!touchState.swiping&&dy>Math.abs(dx))return;
  if(!touchState.swiping&&Math.abs(dx)<15)return;
  touchState.swiping=true;touchState.moved=true;e.preventDefault();
  var el=document.getElementById('entry-'+i);
  if(dx>0){el.style.transform='translateX(-'+Math.min(dx,80)+'px)';el.style.transition='none'}
  else{el.style.transform='translateX(0)';el.style.transition='none'}
}
function te(e,i){
  if(selectMode||!touchState.moved)return;
  var el=document.getElementById('entry-'+i);
  el.style.transition='transform 0.2s ease';
  var match=el.style.transform.match(/translateX\(-?(\d+)/);
  var offset=match?parseInt(match[1]):0;
  el.style.transform=offset>=40?'translateX(-80px)':'translateX(0)';
  touchState.swiping=false;touchState.moved=false;
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
  var e=allData[current].entries[editIdx];
  var nc=document.getElementById('edit-content').value.trim();
  if(nc)e.content=nc;
  e.meta.imp=parseInt(document.getElementById('edit-imp').value);
  e.meta.pin=document.getElementById('edit-pin').value==='1';
  e.meta.tags=document.getElementById('edit-tags').value.trim();
  e.meta.archived=document.getElementById('edit-archived').value==='1';
  hideEdit();renderEntries();renderHomeInsights();toast('已保存');
  setTimeout(function(){saveCurrentCategory()},50);
}
function showDelConfirm(i){delIdx=i;document.getElementById('confirmDel').classList.add('show')}
function cancelDel(){document.getElementById('confirmDel').classList.remove('show');delIdx=null;resetSwipes()}
function confirmDel(){
  allData[current].entries.splice(delIdx,1);
  document.getElementById('confirmDel').classList.remove('show');delIdx=null;
  renderEntries();renderHomeInsights();toast('已删除');
  setTimeout(function(){saveCurrentCategory()},50);
}
function resetSwipes(){document.querySelectorAll('.entry-item').forEach(function(el){el.style.transition='transform 0.2s ease';el.style.transform='translateX(0)'})}
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
  entries.forEach(function(e,i){if(currentView==='active'&&!e.meta.archived)view.push(i);if(currentView==='archived'&&e.meta.archived)view.push(i)});
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
  }else{
    var idxs=Array.from(selected).sort(function(a,b){return b-a});
    idxs.forEach(function(i){allData[current].entries.splice(i,1)});
    toast('已删除 '+idxs.length+' 条');
    setTimeout(function(){saveCurrentCategory()},50);
  }
  selectMode=null;selected.clear();document.getElementById('select-bar').classList.remove('show');renderEntries();updateStats();renderHomeInsights();savePanelCache();
}
function showRename(){document.getElementById('menu-popup').classList.remove('show');document.getElementById('rename-input').value=current;document.getElementById('renameModal').classList.add('show')}
function hideRename(){document.getElementById('renameModal').classList.remove('show')}
function doRename(){
  var nn=document.getElementById('rename-input').value.trim();
  if(!nn||nn===current){hideRename();return}
  var content=allData[current].entries.length?serializeEntries(allData[current].entries):'';
  rpc('write_memory',{category:nn,content:content}).then(function(){
    rpc('write_memory',{category:current,content:''});
    allData[nn]={entries:allData[current].entries};delete allData[current];current=nn;
    hideRename();document.getElementById('d-title').textContent=nn;document.getElementById('d-sub').textContent=countInfo();renderAll();savePanelCache();toast('已重命名');
  });
}
function delCategory(){
  document.getElementById('menu-popup').classList.remove('show');
  if(!confirm('确定删除分类「'+current+'」？'))return;
  rpc('delete_repo',{repo:'memory-server',path:'memories/'+current+'.md'}).then(function(){
    delete allData[current];savePanelCache();toast('已删除');goMemory();
  });
}
function addEntry(){
  var input=document.getElementById('add-input'),text=input.value.trim();if(!text)return;
  var imp=parseInt(document.getElementById('add-imp').value),tags=document.getElementById('add-tags').value.trim();
  var today=dateKey(new Date());
  singleEntryIdx=null;
  allData[current].entries.push({meta:{imp:imp,time:today,last:today,tags:tags,pin:false,resolved:false,archived:false},content:text});
  input.value='';document.getElementById('add-tags').value='';document.getElementById('char-count').textContent='0 字';
  renderEntries();updateStats();renderHomeInsights();savePanelCache();
  var wraps=document.querySelectorAll('.entry-wrap');if(wraps.length)wraps[wraps.length-1].classList.add('new-entry');
  toast('已添加');
  rpc('append_memory',{category:current,content:text,importance:imp,tags:tags});
}
function updateCount(){document.getElementById('char-count').textContent=document.getElementById('add-input').value.length+' 字'}
function saveCurrentCategory(){savePanelCache();rpc('write_memory',{category:current,content:serializeEntries(allData[current].entries)})}
function serializeEntries(entries){
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
  rpc('write_memory',{category:name,content:''});
  allData[name]={entries:[]};hideModal();toast('已创建');renderGrid();updateStats();renderHomeInsights();savePanelCache();openDetail(name);
}
function goMemory(){
  var target=returnPanelTab||currentPanelTab||'overview';
  selectMode=null;selected.clear();singleEntryIdx=null;
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
document.addEventListener('click',function(e){var m=document.getElementById('menu-popup');if(m&&m.classList.contains('show')&&!e.target.closest('.menu-btn')&&!e.target.closest('.menu-popup'))m.classList.remove('show')});
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
