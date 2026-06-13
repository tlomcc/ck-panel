var API='https://memory-tools-kjlrchffqe.cn-hangzhou.fcapp.run';
var ENTITY_GRAPH_URL=localStorage.getItem('entityGraphUrl')||API+'/entity-graph';
function rpc(tool,args){return fetch(API,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',method:'tools/call',params:{name:tool,arguments:args||{}},id:Date.now()})}).then(function(r){return r.json()}).then(function(d){return d.result&&d.result.content&&d.result.content[0]?d.result.content[0].text:''}).catch(function(){return ''})}
var catNameMap={timeline:'时间线',details:'详细记录',intimate:'亲密',preferences:'偏好',todo:'待办',rules:'规则',daily:'日常',feelings:'感受',dreams:'梦境',people:'人物',places:'地点',music:'音乐',food:'美食',health:'健康',work:'工作',memory:'记忆',important:'重要',archive:'归档',misc:'杂项',habits:'习惯',goals:'目标',ideas:'想法',quotes:'语录',gifts:'礼物',dates:'纪念日',promises:'承诺',fights:'吵架记录',growth:'成长',kinks:'癖好',body:'身体',toys:'玩具',fantasies:'幻想',aftercare:'事后关怀',boundaries:'边界','todo-panel':'面板待办','todo-memory':'记忆待办'};
function getCnName(k){return catNameMap[k.toLowerCase()]||''}
var current=null,allData={},delIdx=null,selectMode=null,selected=new Set(),currentView='active',allTags=new Set(),activeTag='',editIdx=null,filterTag='';
var currentSort='time';
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
function init(){
  document.getElementById('day-num').textContent=daysSince();
  var d=new Date(),w=['周日','周一','周二','周三','周四','周五','周六'];
  document.getElementById('mem-date').textContent=d.getFullYear()+'.'+(d.getMonth()+1)+'.'+d.getDate()+' '+w[d.getDay()];
  loadAll();
}
function loadAll(){
  var wrap=document.getElementById('loading-wrap');
  var inner=document.getElementById('loading-inner');
  var text=document.getElementById('loading-text');
  rpc('list_memories').then(function(t){
    if(!t||t==='Empty'){document.getElementById('cat-grid').innerHTML='<div class="empty-state">暂无记忆</div>';allData={};updateStats();renderHomeInsights();if(wrap)wrap.classList.add('done');return}
    var cats=t.split('\n').filter(Boolean);
    allData={};allTags=new Set();var loaded=0;var total=cats.length;
    cats.forEach(function(c){
      rpc('read_memory',{category:c}).then(function(raw){
        var entries=parseEntries(raw);
        entries.forEach(function(e){if(e.meta.tags)e.meta.tags.split(',').forEach(function(t){var tag=t.trim();if(tag)allTags.add(tag)})});
        allData[c]={entries:entries};loaded++;
        var pct=Math.round(loaded/total*100);
        if(inner)inner.style.width=pct+'%';
        if(text)text.textContent='加载中 '+loaded+'/'+total;
        if(loaded===total){updateStats();renderGrid();renderTags();renderHomeInsights();if(wrap)setTimeout(function(){wrap.classList.add('done')},300)}
      });
    });
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
function shortText(s,n){
  s=(s||'').replace(/\s+/g,' ').trim();
  return s.length>n?s.slice(0,n)+'...':s;
}
function entityGraphFullUrl(){
  return ENTITY_GRAPH_URL+(ENTITY_GRAPH_URL.indexOf('?')>=0?'&':'?')+'full=1';
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
  var list=flattenEntries();
  var recent=list.filter(function(x){return x.date}).sort(function(a,b){return b.date.localeCompare(a.date)}).slice(0,5);
  var important=list.filter(function(x){return !x.entry.meta.archived&&(x.entry.meta.imp>=8||x.entry.meta.pin)}).sort(function(a,b){return b.score-a.score||b.date.localeCompare(a.date)}).slice(0,5);
  var cleanup=list.filter(function(x){
    var e=x.entry;
    return !e.meta.tags||!e.meta.time||!e.meta.last||e.content.length>900;
  }).slice(0,5);
  renderMiniList('recent-list',recent,'暂无更新',function(x){return x.date?timeAgo(x.date):''});
  renderMiniList('important-list',important,'暂无重点',function(x){return x.entry.meta.pin?'置顶':'高重要性'});
  renderMiniList('cleanup-list',cleanup,'暂无待整理',function(x){
    var e=x.entry,reasons=[];
    if(!e.meta.tags)reasons.push('缺标签');
    if(!e.meta.time||!e.meta.last)reasons.push('缺日期');
    if(e.content.length>900)reasons.push('较长');
    return reasons.join(' · ');
  });
}
function openEntry(cat,idx){
  openDetail(cat);
  setTimeout(function(){
    var el=document.getElementById('entry-'+idx);
    if(el){el.scrollIntoView({behavior:'smooth',block:'center'});el.classList.add('focus-entry');setTimeout(function(){el.classList.remove('focus-entry')},1600)}
  },80);
}
function hideEntityGraph(){
  var box=document.getElementById('entity-console');
  if(box)box.style.display='none';
}
function loadEntityGraph(showPanel){
  var box=document.getElementById('entity-console');
  var nodes=document.getElementById('entity-nodes');
  var rels=document.getElementById('entity-relations');
  var open=document.getElementById('entity-open');
  if(open)open.href=entityGraphFullUrl();
  if(showPanel&&box)box.style.display='block';
  if(nodes)nodes.innerHTML='<div class="empty-state small">加载中...</div>';
  if(rels)rels.innerHTML='';
  fetch(ENTITY_GRAPH_URL).then(function(r){return r.json()}).then(function(data){
    renderEntityGraph(data);
  }).catch(function(){
    var link=entityGraphFullUrl();
    if(nodes)nodes.innerHTML='<div class="entity-error">信息网暂时无法嵌入读取。<br><a href="'+escAttr(link)+'" target="_blank" rel="noopener">直接打开信息网</a></div>';
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
  var counts=data.counts||{};
  if(updated)updated.textContent=data.updated?'更新 '+data.updated:'';
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
  var html='<div class="tag-btn'+(activeTag===''?' active':'')+'" onclick="filterByTag(\'\')">全部</div>';
  sorted.forEach(function(t){html+='<div class="tag-btn'+(activeTag===t?' active':'')+'" onclick="filterByTag(\''+t+'\')">'+t+' ('+tagCounts[t]+')</div>'});
  bar.innerHTML=html;
  var actionsEl=document.getElementById('tags-actions');
  if(actionsEl){
    var clearBtn=document.getElementById('tag-clear');
    if(clearBtn){if(activeTag)clearBtn.classList.add('show');else clearBtn.classList.remove('show')}
  }
}

function toggleTagsExpand(){
  var bar=document.getElementById('tags-bar');
  var btn=document.querySelector('.tag-expand-btn');
  if(bar.classList.contains('expanded')){
    bar.classList.remove('expanded');
    btn.textContent='展开';
  }else{
    bar.classList.add('expanded');
    btn.textContent='收起';
  }
}
function filterByTag(t){
  activeTag=t;filterTag=t;
  document.getElementById('search-input').value='';
  renderTags();
  if(!t){
    document.getElementById('search-results').style.display='none';
    document.getElementById('cat-grid').style.display='grid';
    renderGrid();
  }else{
    var results=[];
    Object.keys(allData).forEach(function(cat){
      allData[cat].entries.forEach(function(e){
        if(e.meta.tags&&e.meta.tags.indexOf(t)>=0)results.push({cat:cat,content:e.content,meta:e.meta});
      });
    });
    var html='<div style="font-size:11px;color:#8c939e;margin-bottom:8px">#'+t+' · 共 '+results.length+' 条</div>';
    if(!results.length){html+='<div class="empty-state">暂无</div>'}
    else{results.forEach(function(r,i){
      var p=r.content.length>120?r.content.slice(0,120)+'...':r.content;
      html+='<div class="search-result-item" onclick="toggleSearchResult(\'tag-'+i+'\')"><div class="search-result-cat">'+r.cat+(r.meta.pin?' ★':'')+'</div><div class="search-result-text" id="sr-preview-tag-'+i+'">'+esc(p)+'</div><div class="search-result-text" id="sr-full-tag-'+i+'" style="display:none">'+esc(r.content)+'</div></div>';
    })}
    document.getElementById('cat-grid').style.display='none';
    document.getElementById('search-results').innerHTML=html;
    document.getElementById('search-results').style.display='block';
  }
  if(current&&document.getElementById('page-detail').classList.contains('active'))renderEntries();
  window.scrollTo(0,0);
}
function onSearch(){
  var q=(document.getElementById('search-input').value||'').trim().toLowerCase();
  var cb=document.getElementById('search-clear');if(q)cb.classList.add('show');else cb.classList.remove('show');
  var rd=document.getElementById('search-results');
  if(!q){rd.style.display='none';document.getElementById('cat-grid').style.display='grid';renderGrid();return}
  var results=[];
  Object.keys(allData).forEach(function(cat){
    var catMatch=cat.toLowerCase().indexOf(q)>=0||getCnName(cat).indexOf(q)>=0;
    allData[cat].entries.forEach(function(e,idx){
      if(catMatch||e.content.toLowerCase().indexOf(q)>=0)results.push({cat:cat,idx:idx,content:e.content,meta:e.meta});
    });
  });
  if(!results.length){rd.innerHTML='<div class="empty-state">未找到相关记忆</div>';rd.style.display='block';document.getElementById('cat-grid').style.display='none';return}
  var html='<div style="font-size:11px;color:#8c939e;margin-bottom:8px">找到 '+results.length+' 条</div>';
  results.forEach(function(r,i){
    var preview=r.content.length>80?r.content.slice(0,80)+'...':r.content;
    html+='<div class="search-result-item" onclick="toggleSearchResult(\'s-'+i+'\')"><div class="search-result-cat">'+r.cat+(r.meta.pin?' ★':'')+' · '+r.meta.imp+'/10</div><div class="search-result-text" id="sr-preview-s-'+i+'">'+highlightText(preview,q)+'</div><div class="search-result-text" id="sr-full-s-'+i+'" style="display:none">'+highlightText(r.content,q)+'</div></div>';
  });
  rd.innerHTML=html;rd.style.display='block';document.getElementById('cat-grid').style.display='none';
}
function clearSearch(){document.getElementById('search-input').value='';document.getElementById('search-clear').classList.remove('show');document.getElementById('search-results').style.display='none';document.getElementById('cat-grid').style.display='grid';renderGrid()}
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
    if(activeTag){if(!d.entries.some(function(e){return e.meta.tags&&e.meta.tags.indexOf(activeTag)>=0}))return false}
    if(!q)return true;
    if(k.toLowerCase().indexOf(q)>=0)return true;
    return d.entries.some(function(e){return e.content.toLowerCase().indexOf(q)>=0});
  });
  var html='';
  var colorMap={'her-':'#fce4ec','us-':'#e8f5e9','sys-':'#e3f2fd','tech-':'#fff3e0'};
  for(var i=0;i<filtered.length;i++){
    var k=filtered[i],d=allData[k],ac=0,arc=0,chars=0;
    d.entries.forEach(function(e){if(e.meta.archived)arc++;else{ac++;chars+=e.content.length}});
    var color='#f3e5f5';
    var prefixes=Object.keys(colorMap);
    for(var p=0;p<prefixes.length;p++){if(k.startsWith(prefixes[p])){color=colorMap[prefixes[p]];break}}
    var cn=getCnName(k);html+='<div class="cat-card" onclick="openDetail(\''+k+'\')" style="background-color:'+color+'"><div class="cat-card-body"><div><div class="cat-card-name">'+k+'</div>'+(cn?'<div style="font-size:10px;color:#b0b7c0;margin-top:2px">'+cn+'</div>':'')+'</div><div class="cat-card-right"><div class="cat-card-num">'+ac+'</div><div class="cat-card-detail">'+chars+'字'+(arc>0?' · 归档'+arc:'')+'</div></div></div></div>';
  }
  document.getElementById('cat-grid').innerHTML=filtered.length?html:'<div class="empty-state">无结果</div>';
}
function openDetail(k){
  current=k;selectMode=null;selected.clear();currentView='active';
  document.getElementById('select-bar').classList.remove('show');
  document.getElementById('menu-popup').classList.remove('show');
  document.getElementById('d-title').textContent=k;
  document.getElementById('d-sub').textContent=countInfo();
  updateSwitchCounts();renderEntries();
  document.querySelectorAll('.page').forEach(function(p){p.classList.remove('active')});
  document.getElementById('page-detail').classList.add('active');
  window.scrollTo(0,0);
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
function renderEntries(){
  var entries=allData[current].entries;
  var sortedIdxs=[];for(var si=0;si<entries.length;si++)sortedIdxs.push(si);
  sortedIdxs.sort(function(a,b){
  var ea=entries[a],eb=entries[b];
  if(ea.meta.pin&&!eb.meta.pin)return -1;
  if(!ea.meta.pin&&eb.meta.pin)return 1;
  if(currentSort==='time'){
    var ta=ea.meta.time||'',tb=eb.meta.time||'';
    return tb.localeCompare(ta);
  }else if(currentSort==='weight'){
    var da=ea.meta.last?Math.floor((new Date()-new Date(ea.meta.last))/864e5):0;
    var db=eb.meta.last?Math.floor((new Date()-new Date(eb.meta.last))/864e5):0;
    var sa=ea.meta.imp*Math.pow(0.99,da);
    var sb=eb.meta.imp*Math.pow(0.99,db);
    return sb-sa;
  }
  return 0;
});
  var html='',count=0;
  sortedIdxs.reverse();
  for(var si=0;si<sortedIdxs.length;si++){var i=sortedIdxs[si];
    var e=entries[i];
    if(currentView==='active'&&e.meta.archived)continue;
    if(currentView==='archived'&&!e.meta.archived)continue;
    if(filterTag&&!(e.meta.tags&&e.meta.tags.indexOf(filterTag)>=0))continue;
    count++;
    var isLong=e.content.length>100;
    var circle=selectMode?'<div class="select-circle'+(selected.has(i)?' checked':'')+'" onclick="event.stopPropagation();toggleSelect('+i+')"></div>':'';
    var metaHtml='<div class="entry-meta">';
    if(e.meta.pin)metaHtml+='<span class="entry-badge pin">★ 置顶</span>';
    if(e.meta.imp>=7)metaHtml+='<span class="entry-badge imp-high">'+e.meta.imp+'/10</span>';
    else metaHtml+='<span class="entry-badge">'+e.meta.imp+'/10</span>';
    if(e.meta.tags)e.meta.tags.split(',').forEach(function(t){var tag=t.trim();if(tag)metaHtml+='<span class="entry-badge">#'+tag+'</span>'});
    if(e.meta.time)metaHtml+='<span class="entry-badge">'+timeAgo(e.meta.time)+'</span>';
    var days=e.meta.last?Math.floor((new Date()-new Date(e.meta.last))/864e5):0;var score;if(e.meta.pin&&e.meta.imp>=10){score='∞'}else if(e.meta.pin&&e.meta.imp>=9){score=Math.max(e.meta.imp*Math.pow(0.99,days),4).toFixed(2)}else{score=(e.meta.imp*Math.pow(0.99,days)).toFixed(2)}var scoreDetail='imp:'+e.meta.imp+' \u00d7 0.99^'+days+' = '+score;
if(e.meta.pin&&e.meta.imp>=10)scoreDetail='imp:10 [pin] \u4e0d\u8870\u51cf';
else if(e.meta.pin&&e.meta.imp>=9)scoreDetail='imp:'+e.meta.imp+' \u00d7 0.99^'+days+' (\u4fdd\u5e954)';
metaHtml+='<span class="entry-badge score-badge" style="color:#e67e22;position:relative;cursor:pointer" data-score="'+scoreDetail+'">⚡'+score+'</span>';
    metaHtml+='</div>';
    var actionHtml='<div class="entry-actions"><div class="entry-action-btn'+(e.meta.pin?' active':'')+'" onclick="event.stopPropagation();quickPin('+i+')">★</div><div class="entry-action-btn" onclick="event.stopPropagation();showEdit('+i+')">编辑</div></div>';
    html+='<div class="entry-wrap"><div class="entry-del-bg" onclick="showDelConfirm('+i+')">删除</div>';
    html+='<div class="entry-item" id="entry-'+i+'" ontouchstart="ts(event,'+i+')" ontouchmove="tm(event,'+i+')" ontouchend="te(event,'+i+')">';
    html+=circle+'<div style="flex:1"><div class="entry-text'+(isLong?' collapsed':'')+'" id="text-'+i+'" onclick="if(!selectMode)toggleExpand('+i+')">'+esc(e.content)+'</div>';
    if(isLong)html+='<div class="entry-expand" onclick="if(!selectMode)toggleExpand('+i+')">展开</div>';
    html+=metaHtml+actionHtml+'</div></div></div>';
  }
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
  selectMode=null;selected.clear();document.getElementById('select-bar').classList.remove('show');renderEntries();
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
    hideRename();document.getElementById('d-title').textContent=nn;document.getElementById('d-sub').textContent=countInfo();toast('已重命名');
  });
}
function delCategory(){
  document.getElementById('menu-popup').classList.remove('show');
  if(!confirm('确定删除分类「'+current+'」？'))return;
  rpc('delete_repo',{repo:'memory-server',path:'memories/'+current+'.md'}).then(function(){
    delete allData[current];toast('已删除');goMemory();
  });
}
function addEntry(){
  var input=document.getElementById('add-input'),text=input.value.trim();if(!text)return;
  var imp=parseInt(document.getElementById('add-imp').value),tags=document.getElementById('add-tags').value.trim();
  var today=new Date().toISOString().slice(0,10);
  allData[current].entries.push({meta:{imp:imp,time:today,last:today,tags:tags,pin:false,resolved:false,archived:false},content:text});
  input.value='';document.getElementById('add-tags').value='';document.getElementById('char-count').textContent='0 字';
  renderEntries();updateStats();renderHomeInsights();
  var wraps=document.querySelectorAll('.entry-wrap');if(wraps.length)wraps[wraps.length-1].classList.add('new-entry');
  toast('已添加');
  rpc('append_memory',{category:current,content:text,importance:imp,tags:tags});
}
function updateCount(){document.getElementById('char-count').textContent=document.getElementById('add-input').value.length+' 字'}
function saveCurrentCategory(){rpc('write_memory',{category:current,content:serializeEntries(allData[current].entries)})}
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
  allData[name]={entries:[]};hideModal();toast('已创建');renderGrid();updateStats();renderHomeInsights();openDetail(name);
}
function goMemory(){
  selectMode=null;selected.clear();filterTag='';activeTag='';
  document.getElementById('select-bar').classList.remove('show');
  document.getElementById('search-input').value='';
  document.getElementById('search-results').style.display='none';
  document.getElementById('cat-grid').style.display='grid';
  document.querySelectorAll('.page').forEach(function(p){p.classList.remove('active')});
  document.getElementById('page-memory').classList.add('active');
  updateStats();renderGrid();renderTags();renderHomeInsights();
  window.scrollTo(0,0);
}
function toast(msg){var t=document.getElementById('toast');t.textContent=msg;t.className='toast show';setTimeout(function(){t.className='toast'},2000)}
function esc(s){var d=document.createElement('div');d.textContent=s;return d.innerHTML}
function escAttr(s){return esc(s).replace(/"/g,'&quot;').replace(/'/g,'&#39;')}
document.addEventListener('click',function(e){var m=document.getElementById('menu-popup');if(m&&m.classList.contains('show')&&!e.target.closest('.menu-btn')&&!e.target.closest('.menu-popup'))m.classList.remove('show')});
function switchTab(tab) {
  document.querySelectorAll('.tab-content').forEach(function(el) {
    el.classList.remove('active');
  });
  document.querySelectorAll('.nav-item').forEach(function(el) {
    el.classList.remove('active');
  });
  if (tab === 'home') {
    document.getElementById('tab-home').classList.add('active');
    document.querySelectorAll('.nav-item')[0].classList.add('active');
  } else {
    document.getElementById('tab-cats').classList.add('active');
    document.querySelectorAll('.nav-item')[1].classList.add('active');
  }
}
function switchSort(s){
  currentSort=s;
  document.querySelectorAll('.sort-btn').forEach(function(el){el.classList.remove('active')});
  document.querySelector('.sort-btn[data-sort="'+s+'"]').classList.add('active');
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
