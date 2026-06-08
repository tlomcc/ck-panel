var API='https://memory-tools-kjlrchffqe.cn-hangzhou.fcapp.run';
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
    if(!t||t==='Empty'){document.getElementById('cat-grid').innerHTML='<div class="empty-state">暂无记忆</div>';allData={};updateStats();if(wrap)wrap.classList.add('done');return}
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
        if(loaded===total){updateStats();renderGrid();renderTags();if(wrap)setTimeout(function(){wrap.classList.add('done')},300)}
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
  if(!current||!allData[current])return;
  var entries=allData[current].entries,html='',view=[];
  if(searchTerm){
    var reg=new RegExp(searchTerm.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),'gi');
    entries.forEach(function(e){
      if(e.content&&reg.test(e.content)){
        var hl=e.content.replace(reg,function(m){return '<span class="highlight">'+m+'</span>'});
        view.push({raw:e,content:hl});
      }
    });
    if(!view.length){
      document.getElementById('entry-list').innerHTML='<div class="empty-state">无匹配结果</div>';
      return;
    }
  }else{
    if(selectedTags.length){
      entries.forEach(function(e){
        if(e.tags){
          var arr=e.tags.split(',').map(function(t){return t.trim()});
          var match=selectedTags.every(function(st){return arr.indexOf(st)!==-1});
          if(match)view.push({raw:e,content:e.content});
        }
      });
    }else{
      entries.forEach(function(e){view.push({raw:e,content:e.content})});
    }
  }
  if(currentSort==='score'){
    view.sort(function(a,b){return (b.raw.score||0)-(a.raw.score||0)});
  }else{
    view.sort(function(a,b){return (b.raw.index||0)-(a.raw.index||0)});
  }
  
  // 倒序显示
  view.reverse().forEach(function(item,i){
    var e=item.raw;
    var txt=item.content;
    var summary=e.summary||'无摘要';
    
    // 正面卡片（摘要）
    var frontHtml='<div class="entry-front"><div class="entry-text">'+summary+'</div>';
    
    // 背面卡片（完整内容）
    var collapsed=txt.length>200;
    var backHtml='<div class="entry-back"><div class="entry-text'+(collapsed?' collapsed':'')+'" id="txt-'+current+'-'+i+'">'+txt+'</div>';
    if(collapsed)backHtml+='<div class="entry-expand" onclick="expandText(\''+current+'\','+i+')">展开全文</div>';
    
    // 元数据（标签、时间等）
    var metaHtml='';
    if(e.tags){
      var tagArr=e.tags.split(',');
      metaHtml+='<div class="entry-meta">';
      tagArr.forEach(function(t){
        if(t.trim())metaHtml+='<span class="entry-badge">'+t.trim()+'</span>';
      });
      metaHtml+='</div>';
    }
    if(e.time)metaHtml+='<div class="entry-meta"><span class="entry-badge">'+e.time+'</span></div>';
    if(e.pin)metaHtml+='<div class="entry-meta"><span class="entry-badge pin">★</span></div>';
    if(e.importance>=8)metaHtml+='<div class="entry-meta"><span class="entry-badge imp-high">'+e.importance+'/10</span></div>';
    if(e.score!==undefined){
      var formula='';
      if(e.pin){
        formula='pin=1 → 固定权重100';
      }else{
        var days=e.days_ago||0;
        var imp=e.importance||5;
        var base=Math.pow(0.99,days);
        formula='0.99^'+days+' × '+imp+' = '+base.toFixed(3)+' × '+imp+' = '+e.score.toFixed(2);
      }
      metaHtml+='<div class="entry-meta"><span class="entry-badge score-badge" data-score="'+formula+'">⚡️'+e.score.toFixed(1)+'</span></div>';
    }
    
    frontHtml+=metaHtml+'</div>';
    backHtml+=metaHtml+'</div>';
    
    var animateNew=(i===0&&lastAddedCat===current);
    html+='<div class="entry-wrap'+(animateNew?' new-entry':'')+'" data-idx="'+i+'" onclick="flipCard(this)">';
    html+='<div class="entry-item">'+frontHtml+backHtml+'</div>';
    html+='</div>';
  });
  
  document.getElementById('entry-list').innerHTML=html;
}
