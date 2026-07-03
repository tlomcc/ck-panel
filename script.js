var API_BASE='https://memory-tools-kjlrchffqe.cn-hangzhou.fcapp.run/mcp';
var GRAPH_API_BASE='https://ck-gateway-kbjndwjdwa.cn-hangzhou.fcapp.run';
var API_KEY_STORAGE='ckMemoryApiKey';
var API=API_BASE;
var ENTITY_GRAPH_URL=GRAPH_API_BASE+'/entity-graph';
var CK_PANEL_VERSION=window.CK_PANEL_VERSION||'chat-v81';
var ckPanelUpdateTarget='';
var ckPanelUpdateMode='update';
try{
  var storedEntityGraphUrl=localStorage.getItem('entityGraphUrl')||'';
  if(storedEntityGraphUrl&&storedEntityGraphUrl.indexOf('memory-tools-kjlrchffqe.cn-hangzhou.fcapp.run')<0){
    ENTITY_GRAPH_URL=storedEntityGraphUrl;
  }else if(storedEntityGraphUrl){
    localStorage.removeItem('entityGraphUrl');
  }
}catch(e){}
var PANEL_CACHE_KEY='ckPanelCacheV3';
function ckPanelNormalizeNotes(notes){
  if(Array.isArray(notes)){
    return notes.map(function(x){return String(x||'').trim()}).filter(Boolean).slice(0,12);
  }
  if(typeof notes==='string'){
    return notes.split(/\r?\n+/).map(function(x){return x.replace(/^[-*]\s*/,'').trim()}).filter(Boolean).slice(0,12);
  }
  return [];
}
function ckPanelVersionInfo(data,fallbackVersion){
  var info={version:String(fallbackVersion||'').trim(),notes:[]};
  if(typeof data==='string'){
    info.version=String(data||fallbackVersion||'').trim();
    return info;
  }
  if(data&&typeof data==='object'){
    info.version=String(data.version||data.CK_PANEL_VERSION||fallbackVersion||'').trim();
    info.notes=ckPanelNormalizeNotes(data.notes||data.changelog||data.changes||data.release_notes);
  }
  return info;
}
function fetchPanelVersionInfo(flag){
  var stamp=Date.now();
  var key=flag||'__ck_version_check';
  return fetch('version.json?'+key+'='+stamp,{cache:'no-store',headers:{'Cache-Control':'no-cache'}})
    .then(function(r){return r.ok?r.json():null})
    .then(function(data){return ckPanelVersionInfo(data)})
    .catch(function(){return ckPanelVersionInfo(null)})
    .then(function(info){
      if(info.version)return info;
      return fetch('index.html?'+key+'='+stamp,{cache:'no-store',headers:{'Cache-Control':'no-cache'}})
        .then(function(r){return r.ok?r.text():''})
        .then(function(html){
          var m=String(html||'').match(/CK_PANEL_VERSION=['"]([^'"]+)/);
          return ckPanelVersionInfo(m&&m[1]);
        })
        .catch(function(){return ckPanelVersionInfo(null)});
    });
}
function startPanelVersionWatcher(){
  if(window.__ckPanelVersionWatcher||location.protocol==='file:')return;
  window.__ckPanelVersionWatcher=true;
  function check(){
    fetchPanelVersionInfo('__ck_version_check')
      .then(function(info){
        if(info.version&&info.version!==CK_PANEL_VERSION){
          showPanelUpdateModal(info);
        }
      }).catch(function(){});
  }
  setTimeout(check,5000);
  setInterval(check,120000);
}
function syncPanelVersionBadge(){
  var el=document.getElementById('panel-version-badge');
  if(!el)return;
  el.textContent=CK_PANEL_VERSION;
  el.title='当前版本 '+CK_PANEL_VERSION;
}
function chatRenderPanelUpdateNotes(notes){
  var wrap=document.getElementById('panel-update-notes');
  var list=document.getElementById('panel-update-notes-list');
  notes=ckPanelNormalizeNotes(notes);
  if(!wrap||!list)return;
  if(!notes.length){
    wrap.classList.add('empty');
    list.innerHTML='<li>这次更新没有写明细。</li>';
    return;
  }
  wrap.classList.remove('empty');
  list.innerHTML=notes.map(function(x){return '<li>'+esc(x)+'</li>'}).join('');
}
function showPanelUpdateModal(latest,notes){
  var info=ckPanelVersionInfo(latest);
  if(notes)info.notes=ckPanelNormalizeNotes(notes);
  latest=String(info.version||'').trim();
  if(!latest||latest===CK_PANEL_VERSION)return;
  ckPanelUpdateMode='update';
  ckPanelUpdateTarget=latest;
  try{sessionStorage.setItem('ck_panel_pending_reload',latest)}catch(e){}
  var modal=document.getElementById('panel-update-modal');
  if(!modal){
    ckPanelForceReload(latest);
    return;
  }
  var title=document.getElementById('panel-update-title');
  var msg=document.getElementById('panel-update-message');
  if(title)title.textContent='检测到 CK 面板新版本';
  if(msg)msg.innerHTML='当前版本 <b id="panel-update-current">-</b>，最新版本 <b id="panel-update-next">-</b>。需要更新后继续使用。';
  var cur=document.getElementById('panel-update-current');
  var next=document.getElementById('panel-update-next');
  if(cur)cur.textContent=CK_PANEL_VERSION;
  if(next)next.textContent=latest;
  chatRenderPanelUpdateNotes(info.notes);
  var confirm=document.getElementById('panel-update-confirm');
  if(confirm)confirm.textContent='确定更新';
  document.body.classList.add('panel-update-blocked');
  modal.classList.add('show');
  modal.setAttribute('aria-hidden','false');
  var btn=document.getElementById('panel-update-confirm');
  if(btn){
    setTimeout(function(){
      try{btn.focus({preventScroll:true})}catch(e){try{btn.focus()}catch(_e){}}
    },30);
  }
}
function showPanelUpdatedModal(info){
  info=ckPanelVersionInfo(info,CK_PANEL_VERSION);
  ckPanelUpdateMode='notes';
  ckPanelUpdateTarget='';
  var modal=document.getElementById('panel-update-modal');
  if(!modal)return;
  var title=document.getElementById('panel-update-title');
  var msg=document.getElementById('panel-update-message');
  if(title)title.textContent='CK 面板已更新';
  if(msg)msg.innerHTML='已更新到 <b id="panel-update-next">-</b>。本次更新内容如下。';
  var next=document.getElementById('panel-update-next');
  if(next)next.textContent=info.version||CK_PANEL_VERSION;
  chatRenderPanelUpdateNotes(info.notes);
  var btn=document.getElementById('panel-update-confirm');
  if(btn){
    btn.disabled=false;
    btn.textContent='知道了';
  }
  document.body.classList.add('panel-update-blocked');
  modal.classList.add('show');
  modal.setAttribute('aria-hidden','false');
}
function ckPanelReloadUrl(latest){
  var hash=location.hash||'';
  var base=location.origin+location.pathname;
  var params=new URLSearchParams(location.search||'');
  params.set('ck_reload',String(Date.now()));
  if(latest)params.set('ck_target',String(latest));
  return base+'?'+params.toString()+hash;
}
function ckPanelClearUpdateCaches(){
  var jobs=[];
  if('serviceWorker' in navigator&&navigator.serviceWorker.getRegistrations){
    jobs.push(navigator.serviceWorker.getRegistrations().then(function(regs){
      return Promise.all((regs||[]).map(function(reg){
        try{
          var scopePath=new URL(reg.scope).pathname;
          if(scopePath.indexOf('/ck-panel/')<0)return null;
        }catch(e){}
        return reg.unregister().catch(function(){});
      }));
    }));
  }
  if(window.caches&&caches.keys){
    jobs.push(caches.keys().then(function(keys){
      return Promise.all((keys||[]).map(function(key){
        key=String(key||'');
        if(key.indexOf('ck-panel')>=0)return caches.delete(key).catch(function(){});
        return null;
      }));
    }));
  }
  return Promise.all(jobs).catch(function(){});
}
function ckPanelForceReload(latest){
  var url=ckPanelReloadUrl(latest);
  var done=false;
  function go(){
    if(done)return;
    done=true;
    location.replace(url);
  }
  ckPanelClearUpdateCaches().then(go,go);
  setTimeout(go,2500);
}
function confirmPanelUpdate(){
  if(ckPanelUpdateMode==='notes'){
    var modal=document.getElementById('panel-update-modal');
    if(modal){
      modal.classList.remove('show');
      modal.setAttribute('aria-hidden','true');
    }
    document.body.classList.remove('panel-update-blocked');
    ckPanelUpdateMode='update';
    return;
  }
  var latest=ckPanelUpdateTarget;
  try{
    if(document.body&&document.body.classList.contains('chat-active')){
      localStorage.setItem('ckPanelAfterUpdateTab','chat');
    }
  }catch(e){}
  try{if(latest)sessionStorage.setItem('ck_panel_reloaded_to',latest)}catch(e){}
  try{sessionStorage.removeItem('ck_panel_pending_reload')}catch(e){}
  var btn=document.getElementById('panel-update-confirm');
  if(btn){
    btn.disabled=true;
    btn.textContent='正在更新...';
  }
  ckPanelForceReload(latest);
}
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
function addEntityGraphParam(url,key,value){
  return url+(url.indexOf('?')>=0?'&':'?')+key+'='+encodeURIComponent(value);
}
function entityGraphUrl(full,force){
  var url=ENTITY_GRAPH_URL;
  if(full&&url.indexOf('full=')<0)url=addEntityGraphParam(url,'full','1');
  if(force&&url.indexOf('refresh=')<0)url=addEntityGraphParam(url,'refresh','1');
  if(force)url=addEntityGraphParam(url,'_t',Date.now());
  return url;
}
function entityGraphFetch(full,force){
  var init=force?{cache:'no-store'}:undefined;
  return fetch(addStoredKey(entityGraphUrl(full,force)),init).then(function(r){
    if(r.status===403&&requestApiKey())return fetch(addStoredKey(entityGraphUrl(full,force)),init);
    return r;
  });
}
var MCP_TOOL_ALIASES={
  recall_memory:'mcp__memory__recall_memory',
  search_memory:'mcp__memory__search_memory',
  list_memories:'mcp__memory__list_memories',
  read_memory:'mcp__memory__read_memory',
  read_repo:'mcp__memory__read_repo',
  append_memory:'mcp__memory__append_memory',
  write_memory:'mcp__memory__write_memory',
  update_entry:'mcp__memory__update_entry',
  touch_memory:'mcp__memory__touch_memory',
  cleanup:'mcp__memory__cleanup',
  delete_repo:'mcp__memory__delete_repo'
};
function mcpToolName(tool){
  tool=String(tool||'').trim();
  return MCP_TOOL_ALIASES[tool]||tool;
}
function mcpUnwrapStructuredText(text){
  text=String(text||'');
  var trimmed=text.trim();
  if(!trimmed||!/^[\[{]/.test(trimmed))return text;
  try{
    var data=JSON.parse(trimmed);
    if(data&&typeof data==='object'&&!Array.isArray(data)){
      if(typeof data.content==='string')return data.content;
      if(Array.isArray(data.items)){
        var items=data.items.filter(function(item){return item&&typeof item==='object'&&item.name});
        var memoryItems=items.filter(function(item){
          var source=String(item.source||'');
          var path=String(item.path||'');
          return source==='memory'||source==='memory-index'||path.indexOf('memories/')===0;
        });
        if(memoryItems.length)items=memoryItems;
        return items.map(function(item){return String(item.name||'').trim()}).filter(Boolean).join('\n');
      }
    }
  }catch(e){}
  return text;
}
function mcpResultText(d){
  if(!d||typeof d!=='object')throw new Error('MCP 返回空响应');
  if(d.error)throw new Error(d.error.message||JSON.stringify(d.error));
  var result=d.result||{},content=result.content||[];
  var text=content&&content[0]?String(content[0].text||''):'';
  if(result.isError)throw new Error(text||'MCP 工具执行失败');
  if(/^FAILED:|^Unknown tool:/i.test(text))throw new Error(text);
  return mcpUnwrapStructuredText(text);
}
function rpc(tool,args){var name=mcpToolName(tool);return apiFetch({method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',method:'tools/call',params:{name:name,arguments:args||{}},id:Date.now()})}).then(function(r){return r.json()}).then(mcpResultText).catch(function(e){console.warn('[MCP]',name,e);return ''})}
function rpcStrict(tool,args){var name=mcpToolName(tool);return apiFetch({method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',method:'tools/call',params:{name:name,arguments:args||{}},id:Date.now()})}).then(function(r){if(!r.ok)throw new Error('HTTP '+r.status);return r.json()}).then(mcpResultText)}
var catNameMap={timeline:'时间线',details:'详细记录',intimate:'亲密',preferences:'偏好',todo:'待办',rules:'规则',daily:'日常',feelings:'感受',dreams:'梦境',people:'人物',places:'地点',music:'音乐',food:'美食',health:'健康',work:'工作',memory:'记忆',important:'重要',archive:'归档',misc:'杂项',habits:'习惯',goals:'目标',ideas:'想法',quotes:'语录',gifts:'礼物',dates:'纪念日',promises:'承诺',fights:'吵架记录',growth:'成长',kinks:'癖好',body:'身体',toys:'玩具',fantasies:'幻想',aftercare:'事后关怀',boundaries:'边界','todo-panel':'面板待办','todo-memory':'记忆待办'};
function getCnName(k){return catNameMap[k.toLowerCase()]||''}
var current=null,allData={},delIdx=null,selectMode=null,selected=new Set(),currentView='active',allTags=new Set(),activeTag='',activeTags=[],editIdx=null,filterTag='',currentPanelTab='chat',returnPanelTab='chat',returnScrollY=0,graphLoaded=false,renderQueued=false,searchFilter='all',singleEntryIdx=null,tagsExpanded=false,detailReturnState=null,lastSingleTapAt=0,suppressClickUntil=0,detailHighlightQuery='';
var entityGraphData=null,entityGraphView='nodes',entityGraphMode='home',entityGraphSelectedType='',entityGraphSelectedKey='',entityGraphFullOpen=false,entityGraphZoom=1;
var entityGraphQuery='',entityGraphType='all',entityGraphSort='importance';
var entityGraphRefreshTimer=null,entityGraphLoading=false;
var currentSort='time',currentSortDir='desc';
var touchState={startX:0,startY:0,swiping:false,moved:false,idx:-1,offset:0,startOffset:0,openIdx:-1,pointerId:null};
var entityPinchState={active:false,startDist:0,startZoom:1};
var syncingCategories={};
var categoryWriteVersions={},categoryWriteChains={};
var EMPTY_CATEGORY_MARKER='[ck-panel-empty]';
function memoryRawContent(raw){
  if(raw==null)return '';
  if(typeof raw==='object'){
    if(typeof raw.content==='string')return raw.content;
    if(raw.result&&typeof raw.result.content==='string')return raw.result.content;
    return JSON.stringify(raw);
  }
  var text=String(raw||'');
  var trimmed=text.trim();
  if(/^[\[{]/.test(trimmed)){
    try{
      var data=JSON.parse(trimmed);
      if(data&&typeof data==='object'){
        if(typeof data.content==='string')return data.content;
        if(data.result&&typeof data.result.content==='string')return data.result.content;
      }
    }catch(e){}
  }
  return text;
}
function parseEntries(raw){
  raw=memoryRawContent(raw);
  if(!raw||!raw.trim()||raw.trim()===EMPTY_CATEGORY_MARKER)return[];
  var blocks=raw.split(/\n\s*---\s*(?=\n|$)/),entries=[];
  for(var i=0;i<blocks.length;i++){
    var rest=blocks[i].trim();if(!rest)continue;
    var meta={imp:5,time:'',last:'',date:'',tags:'',summary:'',pin:false,resolved:false,archived:false};
    while(rest.charAt(0)==='['){
      var end=rest.indexOf(']');
      if(end<=0)break;
      var token=rest.slice(1,end);
      var colon=token.indexOf(':');
      var key=(colon>=0?token.slice(0,colon):token).trim().toLowerCase();
      var val=(colon>=0?token.slice(colon+1):'').trim();
      if(key==='pin')meta.pin=!val||/^(true|1|yes|y|on)$/i.test(val);
      else if(key==='resolved')meta.resolved=!val||/^(true|1|yes|y|on)$/i.test(val);
      else if(key==='archived')meta.archived=!val||/^(true|1|yes|y|on)$/i.test(val);
      else if(key==='imp')meta.imp=parseInt(val,10)||5;
      else if(key==='time')meta.time=val;
      else if(key==='last')meta.last=val;
      else if(key==='date')meta.date=val;
      else if(key==='tags')meta.tags=val;
      else if(key==='summary')meta.summary=val;
      rest=rest.slice(end+1).replace(/^\s*/,'');
    }
    var ct=rest.trim();
    if(ct||meta.summary)entries.push({meta:meta,content:ct});
  }
  return entries.sort(function(a,b){return compareEntryTime(a,b,0,1,'desc')});
}
function timeAgo(dateStr){if(!dateStr)return'';var d=new Date(dateStr),now=new Date(),diff=Math.floor((now-d)/864e5);if(diff<=0)return'今天';if(diff===1)return'昨天';if(diff<30)return diff+'天前';if(diff<365)return Math.floor(diff/30)+'个月前';return Math.floor(diff/365)+'年前'}
function daysSince(){return Math.floor((new Date()-new Date(2026,2,26))/864e5)}
function dateKey(d){return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0')}
function entryDate(e){return (e.meta&&(e.meta.time||e.meta.last||e.meta.date))||''}
function entryTags(e){return (e.meta&&e.meta.tags?e.meta.tags:'').split(',').map(function(t){return t.trim()}).filter(Boolean)}
function entryTitle(e){
  var summary=(e&&e.meta&&e.meta.summary)?String(e.meta.summary).trim():'';
  if(summary)return summary;
  var content=String((e&&e.content)||'').trim();
  return shortText((content.split('\n').find(function(line){return line.trim()})||content),80)||'未命名记忆';
}
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
  syncPanelVersionBadge();
  startPanelVersionWatcher();
  initApiKeyFromUrl();
  try{
    var pending=sessionStorage.getItem('ck_panel_pending_reload')||'';
    var reloaded=sessionStorage.getItem('ck_panel_reloaded_to')||'';
    if(pending&&pending!==CK_PANEL_VERSION)setTimeout(function(){showPanelUpdateModal(pending)},0);
    else if(pending===CK_PANEL_VERSION)sessionStorage.removeItem('ck_panel_pending_reload');
    if(reloaded===CK_PANEL_VERSION){
      sessionStorage.removeItem('ck_panel_reloaded_to');
      setTimeout(function(){
        fetchPanelVersionInfo('__ck_version_check').then(function(info){
          if(!info.version)info.version=CK_PANEL_VERSION;
          showPanelUpdatedModal(info);
        }).catch(function(){showPanelUpdatedModal({version:CK_PANEL_VERSION,notes:[]})});
      },350);
    }
  }catch(e){}
  document.getElementById('day-num').textContent=daysSince();
  var d=new Date(),w=['周日','周一','周二','周三','周四','周五','周六'];
  document.getElementById('mem-date').textContent=d.getFullYear()+'.'+(d.getMonth()+1)+'.'+d.getDate()+' '+w[d.getDay()];
  var startTab='chat';
  try{
    startTab=localStorage.getItem('ckPanelAfterUpdateTab')||'chat';
    localStorage.removeItem('ckPanelAfterUpdateTab');
  }catch(e){}
  if(!document.getElementById('tab-'+startTab))startTab='chat';
  switchPanelTab(startTab);
  loadAll();
  startMemoryRealtime();
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
    if(!cached||cached.version!==3||!cached.data)return false;
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
    localStorage.setItem(PANEL_CACHE_KEY,JSON.stringify({version:3,ts:Date.now(),data:allData}));
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
      var date=entryDate(e);
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
    html+='<div class="mini-item" data-cat="'+escAttr(item.cat)+'" data-idx="'+item.idx+'" onclick="openEntry(this.dataset.cat,parseInt(this.dataset.idx,10))"><div class="mini-top"><span>'+esc(title)+'</span><b>'+e.meta.imp+'/10</b></div><div class="mini-title">'+esc(entryTitle(e))+'</div><div class="mini-text">'+esc(shortText(e.content,80))+'</div>'+(reason?'<div class="mini-reason">'+esc(reason)+'</div>':'')+'</div>';
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
function startEntityGraphRealtime(){
  stopEntityGraphRealtime();
  entityGraphRefreshTimer=setInterval(function(){
    if(currentPanelTab==='graph')loadEntityGraph(false,true,{silent:true,preserveView:true});
  },30000);
}
function stopEntityGraphRealtime(){
  if(entityGraphRefreshTimer){
    clearInterval(entityGraphRefreshTimer);
    entityGraphRefreshTimer=null;
  }
}
function loadEntityGraph(showPanel,force,opts){
  opts=opts||{};
  var box=document.getElementById('entity-console');
  var list=document.getElementById('eg-cards');
  var detail=document.getElementById('entity-detail');
  var status=document.getElementById('graph-status');
  if(showPanel&&currentPanelTab!=='graph'){switchPanelTab('graph',{forceGraphRefresh:!!force});return}
  if(entityGraphLoading)return;
  entityGraphLoading=true;
  if(!opts.preserveView)entityGraphMode='home';
  if(box)box.classList.add('loading');
  if(!opts.silent||!entityGraphData){
    if(status)status.textContent=force?'正在读取最新信息网...':'正在读取信息网...';
    if(list)list.innerHTML='<div class="empty-state small">加载中...</div>';
    if(detail)detail.innerHTML='<div class="empty-state small">等待数据...</div>';
  }
  entityGraphFetch(true,!!force).then(function(r){if(!r.ok)throw new Error('HTTP '+r.status);return r.json()}).then(function(data){
    if(!data||typeof data!=='object'||Array.isArray(data)||(!data.counts&&!data.top_nodes&&!data.recent_relations))throw new Error('Invalid graph data');
    graphLoaded=true;
    entityGraphData=data;
    if(box)box.classList.remove('loading');
    if(status)status.textContent='已读取完整信息网数据。点击节点、关系或上方分类查看明细。';
    renderEntityGraph(data);
  }).catch(function(){
    if(box)box.classList.remove('loading');
    if(opts.silent&&entityGraphData){
      if(status)status.textContent='自动更新失败，继续显示上次读取的数据。';
      return;
    }
    if(status)status.textContent='没有读到可用的信息网数据。';
    if(list)list.innerHTML='<div class="entity-error">暂时读不到。接口当前没有返回可用的节点/关系数据。</div>';
    if(detail)detail.innerHTML='';
    var stats=document.getElementById('entity-stats');
    if(stats)stats.innerHTML='';
  }).then(function(){
    entityGraphLoading=false;
  });
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
function entityTypeLabel(type){
  var map={person:'人',event:'事',place:'地点',thing:'物品/作品',mood:'情绪',topic:'主题'};
  return map[String(type||'').toLowerCase()]||String(type||'节点');
}
function entityFactLabel(key){
  var map={
    relation_to_caicai:'关系',closeness:'亲密度',role_tags:'身份',personality:'性格',
    likes:'喜欢',dislikes:'雷区',habits:'习惯',key_dates:'重要日期',status:'近况',
    home_location:'常驻地',interaction_notes:'相处要点',
    when:'时间',when_precision:'时间精度',participants:'当事人',places:'地点',
    trigger:'起因',process:'经过',outcome:'结果',emotion_impact:'情绪影响',
    significance:'意义',follow_up:'后续',desc:'说明'
  };
  return map[key]||key;
}
function entityFactText(value){
  if(value===null||value===undefined)return '';
  if(Array.isArray(value)){
    return value.map(function(item){
      if(item&&typeof item==='object'){
        var label=item.label||item.name||'';
        var date=item.date||item.value||'';
        return (label&&date)?label+' '+date:(label||date||JSON.stringify(item));
      }
      return String(item);
    }).filter(Boolean).join('、');
  }
  if(typeof value==='object')return JSON.stringify(value);
  return String(value);
}
function entityFactsList(facts){
  if(!facts||typeof facts!=='object'||Array.isArray(facts))return [];
  var preferred=['relation_to_caicai','closeness','role_tags','personality','likes','dislikes','habits','home_location','key_dates','status','interaction_notes','when','when_precision','participants','places','trigger','process','outcome','emotion_impact','significance','follow_up','desc'];
  var keys=Object.keys(facts).sort(function(a,b){
    var ai=preferred.indexOf(a),bi=preferred.indexOf(b);
    if(ai<0)ai=999;if(bi<0)bi=999;
    return ai===bi?a.localeCompare(b):ai-bi;
  });
  return keys.map(function(key){return {key:key,label:entityFactLabel(key),text:entityFactText(facts[key])}}).filter(function(row){return row.text});
}
function renderEntityFacts(facts){
  var rows=entityFactsList(facts);
  if(!rows.length)return '';
  return '<div class="entity-detail-block"><b>结构化事实</b><div class="entity-facts">'+rows.map(function(row){
    return '<div class="entity-fact"><span>'+esc(row.label)+'</span><p>'+esc(row.text)+'</p></div>';
  }).join('')+'</div></div>';
}
function graphNodePreview(n){
  if(!n)return '';
  var profile=String(n.profile||'').trim();
  if(profile)return profile;
  var factRows=entityFactsList(n.facts);
  if(factRows.length)return factRows.slice(0,3).map(function(row){return row.label+'：'+row.text}).join('；');
  return String(n.summary||'').trim();
}
function entityGraphCoverage(data){
  var nodes=(data&&data.top_nodes)||[];
  var facts=0,profiles=0,typeCounts={};
  nodes.forEach(function(n){
    if(graphNodePreview(n))profiles++;
    if(entityFactsList(n&&n.facts).length)facts++;
    var t=String((n&&n.type)||'').toLowerCase()||'node';
    typeCounts[t]=(typeCounts[t]||0)+1;
  });
  return {nodes:nodes.length,profiles:profiles,facts:facts,typeCounts:typeCounts};
}
function renderEntitySourceRefs(refs){
  if(!Array.isArray(refs)||!refs.length)return '';
  return '<div class="entity-detail-block"><b>来源</b>'+refs.slice(-5).reverse().map(function(ref){
    var bits=[ref.date,ref.path].filter(Boolean).join(' · ');
    var body=ref.quote||ref.summary||'';
    return '<p><strong>'+esc(bits||'source')+'</strong>'+(body?'：'+esc(body):'')+'</p>';
  }).join('')+'</div>';
}
function renderEntityGraph(data){
  var updated=document.getElementById('entity-updated');
  var status=document.getElementById('graph-status');
  var counts=data.counts||{};
  var coverage=entityGraphCoverage(data);
  var processed=(data.processed_days||data.indexed_days||[]).length;
  var empty=(counts.nodes||coverage.nodes||0)===0&&(counts.relations||0)===0;
  if(updated)updated.textContent=(data.updated?'更新于 '+data.updated:'已读取档案')+(processed?' · 已整理 '+processed+' 天':'');
  if(status){
    status.style.display=empty?'':'none';
    if(empty)status.textContent='读取成功，但还没有档案。通常是当天整理任务还没生成。';
  }
  renderEntityStatbar(data,coverage);
  renderEntityTypeChips(data);
  renderEntityCards();
}
function renderEntityDetail(data,type,key){
  if(type==='relation'){
    var rel=(data.recent_relations||[])[parseInt(key,10)];
    if(!rel)return '<div class="empty-state small">没有找到这条关系</div>';
    return '<div class="entity-detail-title">'+esc(rel.source||'')+' <span>→</span> '+esc(rel.target||'')+'</div><div class="entity-detail-sub">'+esc(rel.relation||'关系')+' · '+esc(rel.last_seen||'')+'</div><div class="entity-detail-block"><b>关系说明</b><p>'+esc(rel.detail||'暂无说明')+'</p></div><div class="entity-detail-grid"><span>重要性 '+(rel.importance||5)+'</span><span>出现 '+(rel.count||1)+' 次</span><span>首次 '+esc(rel.first_seen||'')+'</span></div>'+renderEntitySourceRefs(rel.source_refs)+rawEntityBlock(rel);
  }
  var node=findGraphNode(data,key)||{key:key,name:key,summary:''};
  var rels=(data.recent_relations||[]).filter(function(r){return relationTouchesNode(r,node)});
  var aliases=(node.aliases||[]).filter(Boolean);
  var evidence=(node.evidence||[]).filter(Boolean);
  var links=(node.links||[]).filter(Boolean);
  var profile=String(node.profile||'').trim();
  var summary=String(node.summary||'').trim();
  var html='<div class="entity-detail-title">'+esc(graphNodeName(node))+'</div><div class="entity-detail-sub">'+esc(entityTypeLabel(node.type))+' · 重要性 '+(node.importance||5)+' · 提及 '+(node.mentions||0)+'</div>';
  if(aliases.length)html+='<div class="entity-chip-row">'+aliases.map(function(a){return '<span>'+esc(a)+'</span>'}).join('')+'</div>';
  html+='<div class="entity-detail-block"><b>一句话画像</b><p>'+esc(profile||summary||'暂无说明')+'</p></div>';
  html+=renderEntityFacts(node.facts);
  if(summary&&summary!==profile)html+='<div class="entity-detail-block"><b>旧摘要</b><p>'+esc(summary)+'</p></div>';
  if(evidence.length)html+='<div class="entity-detail-block"><b>证据 / 原文线索</b>'+evidence.map(function(e){return '<p>'+esc(e)+'</p>'}).join('')+'</div>';
  html+=renderEntitySourceRefs(node.source_refs);
  if(links.length)html+='<div class="entity-detail-block"><b>节点内关联</b>'+links.map(function(l){return '<p>'+esc(l.relation||'关联')+' → '+esc(l.target||'')+(l.detail?'：'+esc(l.detail):'')+'</p>'}).join('')+'</div>';
  if(rels.length)html+='<div class="entity-detail-block"><b>相关关系</b>'+rels.map(function(r){return '<p>'+esc(r.source||'')+' → '+esc(r.target||'')+'：'+esc(r.relation||'')+(r.detail?'，'+esc(r.detail):'')+'</p>'}).join('')+'</div>';
  return html+rawEntityBlock(node);
}
function rawEntityBlock(obj){
  return '<details class="entity-raw"><summary>结构原文</summary><pre>'+esc(JSON.stringify(obj,null,2))+'</pre></details>';
}
/* ===== 信息网 · 可搜索卡片视图（新版） ===== */
var ENTITY_TYPE_ORDER=['person','event','place','thing','mood','topic'];

function renderEntityStatbar(data,coverage){
  var bar=document.getElementById('entity-stats');
  if(!bar)return;
  var counts=data.counts||{};
  var pills=[
    {n:counts.nodes||coverage.nodes||0,l:'档案'},
    {n:counts.relations||0,l:'关系'},
    {n:coverage.facts||0,l:'有明细'},
    {n:counts.orphan_nodes||0,l:'孤立'}
  ];
  bar.innerHTML=pills.map(function(p){return '<div class="eg-stat"><b>'+p.n+'</b><span>'+esc(p.l)+'</span></div>'}).join('');
}

function entityTypeCounts(data){
  var nodes=(data&&data.top_nodes)||[],map={};
  nodes.forEach(function(n){
    var t=String((n&&n.type)||'').toLowerCase();
    if(ENTITY_TYPE_ORDER.indexOf(t)<0)t='topic';
    map[t]=(map[t]||0)+1;
  });
  return map;
}

function renderEntityTypeChips(data){
  var box=document.getElementById('eg-type-filters');
  if(!box)return;
  var nodes=(data&&data.top_nodes)||[];
  var rels=(data&&data.recent_relations)||[];
  var tc=entityTypeCounts(data);
  var chips=[{v:'all',l:'全部',n:nodes.length}];
  ENTITY_TYPE_ORDER.forEach(function(t){if(tc[t])chips.push({v:t,l:entityTypeLabel(t),n:tc[t]})});
  if(rels.length)chips.push({v:'relation',l:'关系',n:rels.length});
  box.innerHTML=chips.map(function(c){
    var on=entityGraphType===c.v?' active':'';
    return '<button class="eg-chip'+on+'" onclick="setEntityType(\''+escAttr(c.v)+'\')">'+esc(c.l)+'<i>'+c.n+'</i></button>';
  }).join('');
}

function setEntityType(t){
  entityGraphType=t||'all';
  renderEntityTypeChips(entityGraphData);
  renderEntityCards();
}
function onEntitySearch(v){
  entityGraphQuery=String(v||'').trim().toLowerCase();
  var clr=document.getElementById('eg-search-clear');
  if(clr)clr.style.display=entityGraphQuery?'':'none';
  renderEntityCards();
}
function clearEntitySearch(){
  var inp=document.getElementById('eg-search');
  if(inp)inp.value='';
  entityGraphQuery='';
  var clr=document.getElementById('eg-search-clear');
  if(clr)clr.style.display='none';
  renderEntityCards();
}
function onEntitySort(v){
  entityGraphSort=v||'importance';
  renderEntityCards();
}

function entityNodeSearchText(n){
  var bits=[graphNodeName(n),entityTypeLabel(n.type),n.profile,n.summary];
  (n.aliases||[]).forEach(function(a){bits.push(a)});
  entityFactsList(n.facts).forEach(function(f){bits.push(f.label);bits.push(f.text)});
  return bits.filter(Boolean).join(' ').toLowerCase();
}
function entityRelSearchText(r){
  return [r.source,r.target,r.relation,r.detail].filter(Boolean).join(' ').toLowerCase();
}
function entitySortVal(o,kind){
  if(entityGraphSort==='mentions')return kind==='relation'?(o.count||0):(o.mentions||0);
  if(entityGraphSort==='recent'){var d=String(o.last_seen||o.first_seen||'').replace(/[^0-9]/g,'');return parseInt(d||'0',10)}
  return o.importance||0;
}
function entityFilteredRows(){
  var data=entityGraphData;if(!data)return [];
  var q=entityGraphQuery,rows=[];
  if(entityGraphType==='relation'){
    (data.recent_relations||[]).forEach(function(r,i){
      if(q&&entityRelSearchText(r).indexOf(q)<0)return;
      rows.push({kind:'relation',raw:r,key:String(i)});
    });
    rows.sort(function(a,b){return entitySortVal(b.raw,'relation')-entitySortVal(a.raw,'relation')});
    return rows;
  }
  (data.top_nodes||[]).forEach(function(n){
    var t=String(n.type||'').toLowerCase();if(ENTITY_TYPE_ORDER.indexOf(t)<0)t='topic';
    if(entityGraphType!=='all'&&t!==entityGraphType)return;
    if(q&&entityNodeSearchText(n).indexOf(q)<0)return;
    rows.push({kind:'node',raw:n,key:graphNodeKey(n)});
  });
  if(entityGraphSort==='name')rows.sort(function(a,b){return graphNodeName(a.raw).localeCompare(graphNodeName(b.raw))});
  else rows.sort(function(a,b){return entitySortVal(b.raw,'node')-entitySortVal(a.raw,'node')});
  return rows;
}

function renderEntityCards(){
  var box=document.getElementById('eg-cards');
  var cnt=document.getElementById('eg-count');
  if(!box)return;
  if(!entityGraphData){box.innerHTML='<div class="empty-state small">加载中...</div>';return}
  var rows=entityFilteredRows();
  if(cnt)cnt.textContent='显示 '+rows.length+' 张';
  if(!rows.length){
    box.innerHTML='<div class="empty-state small">'+(entityGraphQuery?'没有匹配“'+esc(entityGraphQuery)+'”的档案':'这个分类下暂时没有内容')+'</div>';
    return;
  }
  box.innerHTML=rows.map(function(row){
    return row.kind==='relation'?renderRelationCard(row.raw,row.key):renderEntityCard(row.raw,row.key);
  }).join('');
}
function renderEntityCard(n,key){
  var t=String(n.type||'').toLowerCase();if(ENTITY_TYPE_ORDER.indexOf(t)<0)t='topic';
  var preview=graphNodePreview(n)||'暂无说明';
  var facts=entityFactsList(n.facts).slice(0,4);
  var chips=facts.map(function(f){return '<span class="eg-fact-chip"><i>'+esc(f.label)+'</i>'+esc(shortText(f.text,16))+'</span>'}).join('');
  var aliases=(n.aliases||[]).filter(Boolean);
  var aliasStr=aliases.length?'<span class="eg-card-alias">'+esc(aliases.slice(0,3).join(' / '))+'</span>':'';
  return '<button class="eg-card eg-type-'+t+'" onclick="openEntityDetail(\'node\',\''+escAttr(key)+'\')">'+
    '<div class="eg-card-top"><span class="eg-badge eg-badge-'+t+'">'+esc(entityTypeLabel(t))+'</span>'+
    '<span class="eg-card-name">'+esc(graphNodeName(n))+'</span>'+aliasStr+
    '<span class="eg-card-imp">★'+(n.importance||5)+'</span></div>'+
    '<div class="eg-card-profile">'+esc(shortText(preview,92))+'</div>'+
    (chips?'<div class="eg-card-facts">'+chips+'</div>':'')+
    '</button>';
}
function renderRelationCard(r,key){
  return '<button class="eg-card eg-type-relation" onclick="openEntityDetail(\'relation\',\''+escAttr(key)+'\')">'+
    '<div class="eg-card-top"><span class="eg-badge eg-badge-relation">关系</span>'+
    '<span class="eg-card-name">'+esc(r.source||'')+' → '+esc(r.target||'')+'</span>'+
    '<span class="eg-card-imp">★'+(r.importance||5)+'</span></div>'+
    '<div class="eg-card-profile"><b class="eg-rel-name">'+esc(r.relation||'关系')+'</b> '+esc(shortText(r.detail||'暂无说明',86))+'</div>'+
    '<div class="eg-card-facts"><span class="eg-fact-chip"><i>最近</i>'+esc(r.last_seen||'-')+'</span><span class="eg-fact-chip"><i>出现</i>'+(r.count||1)+'次</span></div>'+
    '</button>';
}
function openEntityDetail(type,key){
  if(!entityGraphData)return;
  var sheet=document.getElementById('eg-detail-sheet');
  var body=document.getElementById('eg-detail-body');
  if(!sheet||!body)return;
  body.innerHTML=renderEntityDetail(entityGraphData,type,key);
  body.scrollTop=0;
  sheet.classList.add('show');
  document.body.classList.add('eg-sheet-open');
}
function closeEntityDetail(){
  var sheet=document.getElementById('eg-detail-sheet');
  if(sheet)sheet.classList.remove('show');
  document.body.classList.remove('eg-sheet-open');
}

var CK_SHEET_DISMISS_DISTANCE=100;
function ckSheetDragTargetIsTextEdit(target){
  if(!target)return false;
  if(target.nodeType===3)target=target.parentElement;
  if(!target||!target.closest)return false;
  return !!target.closest('input,textarea,select,[contenteditable=""],[contenteditable="true"],[contenteditable="plaintext-only"]');
}

/* ===== 实体详情底部卡片：下滑关闭手势 ===== */
var egSheetDrag={active:false,committed:false,startY:0,startT:0,dy:0,panel:null,wide:false};
function egSheetBaseTransform(){return egSheetDrag.wide?'translateX(-50%)':''}
function egSheetTouchStart(e){
  var sheet=document.getElementById('eg-detail-sheet');
  if(!sheet||!sheet.classList.contains('show')){egSheetDrag.active=false;return}
  var target=e.target;
  if(ckSheetDragTargetIsTextEdit(target)){egSheetDrag.active=false;return}
  var body=document.getElementById('eg-detail-body');
  if(body&&body.scrollTop>0&&body.contains(target)){egSheetDrag.active=false;return}   // 内容没滚到顶 → 先让它正常滚
  var panel=sheet.querySelector('.eg-detail-panel');
  if(!panel){egSheetDrag.active=false;return}
  var t=e.touches?e.touches[0]:e;
  egSheetDrag.active=true;egSheetDrag.committed=false;
  egSheetDrag.startY=t.clientY;egSheetDrag.startT=Date.now();egSheetDrag.dy=0;egSheetDrag.panel=panel;
  egSheetDrag.wide=window.matchMedia('(min-width:560px)').matches;
}
function egSheetTouchMove(e){
  if(!egSheetDrag.active)return;
  var t=e.touches?e.touches[0]:e;
  var dy=t.clientY-egSheetDrag.startY;
  if(!egSheetDrag.committed){
    if(dy>6){egSheetDrag.committed=true;egSheetDrag.panel.style.transition='none';}
    else if(dy<-6){egSheetDrag.active=false;return;}            // 往上滑 → 放弃，交还滚动
    else return;
  }
  if(dy<0)dy=0;
  egSheetDrag.dy=dy;
  egSheetDrag.panel.style.transform=egSheetBaseTransform()+' translateY('+dy+'px)';
  if(e.cancelable)e.preventDefault();
}
function egSheetTouchEnd(){
  if(!egSheetDrag.active)return;
  var panel=egSheetDrag.panel,dy=egSheetDrag.dy;
  egSheetDrag.active=false;egSheetDrag.committed=false;
  if(!panel)return;
  if(dy>CK_SHEET_DISMISS_DISTANCE){
    panel.style.transition='transform .2s ease';
    panel.style.transform=egSheetBaseTransform()+' translateY(100%)';
    setTimeout(function(){closeEntityDetail();panel.style.transition='';panel.style.transform=egSheetBaseTransform();},190);
  }else{
    panel.style.transition='transform .2s ease';
    panel.style.transform=egSheetBaseTransform();
    setTimeout(function(){panel.style.transition='';},210);
  }
}
(function attachEgSheetGesture(){
  var sheet=document.getElementById('eg-detail-sheet');
  if(!sheet)return;
  var panel=sheet.querySelector('.eg-detail-panel');
  if(!panel)return;
  panel.addEventListener('touchstart',egSheetTouchStart,{passive:true});
  panel.addEventListener('touchmove',egSheetTouchMove,{passive:false});
  panel.addEventListener('touchend',egSheetTouchEnd,{passive:true});
  panel.addEventListener('touchcancel',egSheetTouchEnd,{passive:true});
})();

/* ===== 每日状态页 ===== */
var DAILY_STATUS_URL=GRAPH_API_BASE+'/daily-status';
var dailyStatusTimer=null,dailyStatusLoading=false;
function dailyStatusFetch(){
  var u=function(){return addStoredKey(DAILY_STATUS_URL+'?_t='+Date.now())};
  return fetch(u(),{cache:'no-store'}).then(function(r){
    if(r.status===403&&requestApiKey())return fetch(u(),{cache:'no-store'});
    return r;
  });
}
function loadDailyStatus(force){
  var body=document.getElementById('daily-status-body');
  if(dailyStatusLoading)return;
  dailyStatusLoading=true;
  if(force&&body&&!body.querySelector('.ds-grid'))body.innerHTML='<div class="empty-state small">读取中...</div>';
  dailyStatusFetch().then(function(r){if(!r.ok)throw new Error('HTTP '+r.status);return r.json()}).then(function(d){
    renderDailyStatus(d);
  }).catch(function(){
    if(body&&(force||!body.querySelector('.ds-grid')))body.innerHTML='<div class="entity-error">读不到状态。检查网关是否在线、key 是否正确（点刷新会让你重新输 key）。</div>';
  }).then(function(){dailyStatusLoading=false});
}
function dsTile(ok,title,date,doneLabel,waitLabel){
  return '<div class="ds-tile '+(ok?'ds-ok':'ds-wait')+'"><div class="ds-tile-icon">'+(ok?'✅':'⏳')+'</div><div class="ds-tile-body"><div class="ds-tile-title">'+esc(title)+'</div><div class="ds-tile-sub">'+esc(date||'')+' · '+(ok?esc(doneLabel):esc(waitLabel))+'</div></div></div>';
}
function renderDailyStatus(d){
  var body=document.getElementById('daily-status-body');
  var sub=document.getElementById('status-sub');
  if(!body)return;
  d=d||{};var e=d.entity||{},c=d.chatlog||{};
  if(sub)sub.textContent='更新于 '+(d.now||'-');
  var html='<div class="ds-grid">';
  html+=dsTile(!!c.yesterday_vectorized,'前一天聊天 · 向量化',d.yesterday,'已完成','还没生成');
  html+=dsTile(!!e.yesterday_done,'前一天 · 小档案整理',d.yesterday,'已整理','还没整理');
  html+='</div>';
  html+='<div class="ds-note">今天 '+esc(d.today||'')+'：聊天向量化 '+(c.today_vectorized?'✅':'—')+' · 档案整理 '+(e.today_done?'✅':'—')+'。<br>当天内容一般在“第二天首次聊天”时才离线整理，今天显示“—”属正常。</div>';
  html+='<div class="ds-stats">'+
    '<div class="ds-stat"><b>'+(e.nodes||0)+'</b><span>小档案</span></div>'+
    '<div class="ds-stat"><b>'+(e.relations||0)+'</b><span>关系</span></div>'+
    '<div class="ds-stat"><b>'+(c.vectorized_days||0)+'</b><span>已向量化天数</span></div>'+
    '</div>';
  html+='<div class="ds-meta">';
  html+='<div class="ds-meta-row"><span>档案最近更新</span><b>'+esc(e.updated||e.last_processed||'-')+'</b></div>';
  html+='<div class="ds-meta-row"><span>最近向量化到</span><b>'+esc(c.last_vectorized||'-')+'</b></div>';
  if((e.recent_processed||[]).length)html+='<div class="ds-meta-row ds-meta-list"><span>最近整理的日子</span><div class="ds-day-chips">'+e.recent_processed.slice().reverse().map(function(x){return '<i>'+esc(x)+'</i>'}).join('')+'</div></div>';
  html+='</div>';
  body.innerHTML=html;
}
function startDailyStatusRealtime(){
  stopDailyStatusRealtime();
  dailyStatusTimer=setInterval(function(){if(currentPanelTab==='status')loadDailyStatus(false)},60000);
}
function stopDailyStatusRealtime(){
  if(dailyStatusTimer){clearInterval(dailyStatusTimer);dailyStatusTimer=null}
}

/* ===== 网关配置读写助手（供 API 配置页使用） ===== */
var KEY_CONFIG_URL=GRAPH_API_BASE+'/config';
function keyCfgFetch(init,opts){
  opts=opts||{};
  var u=function(){return addStoredKey(KEY_CONFIG_URL+'?_t='+Date.now())};
  return fetch(u(),init).then(function(r){
    if(r.status===403&&!opts.silentAuth&&requestApiKey())return fetch(u(),init);
    return r;
  });
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
  var title=entryTitle(e);
  var text=shortText(e.content,150);
  var body=query?highlightText(text,query):esc(text);
  return '<div class="search-result-item search-entry" data-cat="'+escAttr(item.cat)+'" data-idx="'+item.idx+'"><div class="search-entry-main" onclick="openEntry(this.parentNode.dataset.cat,parseInt(this.parentNode.dataset.idx,10))"><div class="search-result-cat">'+esc(item.cat)+'</div><div class="search-result-title">'+esc(title)+'</div><div class="search-result-text">'+body+'</div><div class="search-entry-meta">'+meta.map(function(m){return'<span>'+esc(m)+'</span>'}).join('')+'</div></div><button class="open-entry-btn" onclick="openEntry(this.parentNode.dataset.cat,parseInt(this.parentNode.dataset.idx,10))">打开</button></div>';
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
    var dt=entryDate(e);
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
  if(entryDate(e))meta.push(timeAgo(entryDate(e)));
  tags.forEach(function(t){meta.push('#'+t)});
  var click=selectMode?'toggleSelect('+i+')':'openEntry(current,'+i+')';
  var checked=selectMode&&selected.has(i);
  var select=selectMode?'<div class="select-circle'+(checked?' checked':'')+'" onclick="event.stopPropagation();toggleSelect('+i+')"></div>':'';
  return '<article class="pinned-card" onclick="'+click+'">'+select+'<div class="pinned-card-main"><div class="pinned-card-title">'+esc(entryTitle(e))+'</div><div class="pinned-card-text">'+esc(shortText(e.content,120))+'</div><div class="pinned-card-meta">'+meta.map(function(m){return'<span>'+esc(m)+'</span>'}).join('')+'</div></div><button class="pinned-card-pin" onclick="event.stopPropagation();quickPin('+i+')" aria-label="取消置顶">★</button></article>';
}
function renderEntryCard(i,e,isLong,compact){
  var circle=selectMode?'<div class="select-circle'+(selected.has(i)?' checked':'')+(selectMode==='delete'?' select-danger':'')+'" onclick="event.stopPropagation();toggleSelect('+i+')"></div>':'';
  var metaHtml='<div class="entry-meta">';
  if(!compact&&e.meta.pin)metaHtml+='<span class="entry-badge pin">★ 置顶</span>';
  if(e.meta.imp>=7)metaHtml+='<span class="entry-badge imp-high">'+e.meta.imp+'/10</span>';
  else metaHtml+='<span class="entry-badge">'+e.meta.imp+'/10</span>';
  if(!compact&&e.meta.tags)e.meta.tags.split(',').forEach(function(t){var tag=t.trim();if(tag)metaHtml+='<span class="entry-badge">#'+tag+'</span>'});
  if(entryDate(e))metaHtml+='<span class="entry-badge entry-date-badge">'+timeAgo(entryDate(e))+'</span>';
  if(!compact){
    var days=e.meta.last?Math.floor((new Date()-new Date(e.meta.last))/864e5):0;var score;if(e.meta.pin&&e.meta.imp>=10){score='∞'}else if(e.meta.pin&&e.meta.imp>=9){score=Math.max(e.meta.imp*Math.pow(0.99,days),4).toFixed(2)}else{score=(e.meta.imp*Math.pow(0.99,days)).toFixed(2)}var scoreDetail='imp:'+e.meta.imp+' \u00d7 0.99^'+days+' = '+score;
    if(e.meta.pin&&e.meta.imp>=10)scoreDetail='imp:10 [pin] \u4e0d\u8870\u51cf';
    else if(e.meta.pin&&e.meta.imp>=9)scoreDetail='imp:'+e.meta.imp+' \u00d7 0.99^'+days+' (\u4fdd\u5e954)';
    metaHtml+='<span class="entry-badge score-badge" style="color:#e67e22;position:relative;cursor:pointer" data-score="'+scoreDetail+'">⚡'+score+'</span>';
  }
  metaHtml+='</div>';
  var actionHtml='<div class="entry-actions"><div class="entry-action-btn'+(e.meta.pin?' active':'')+'" onclick="event.stopPropagation();quickPin('+i+')">★</div><div class="entry-action-btn" onclick="event.stopPropagation();showEdit('+i+')">编辑</div>';
  if(compact)actionHtml+='<div class="entry-action-btn open" onclick="event.stopPropagation();openEntry(current,'+i+')">打开</div>';
  actionHtml+='<div class="entry-action-btn danger" onclick="event.stopPropagation();showDelConfirm('+i+')">删除</div>';
  actionHtml+='</div>';
  var html='<div class="entry-wrap'+(compact?' pinned-entry-wrap':'')+(selectMode&&selected.has(i)?' selected':'')+'"><div class="entry-del-bg" onpointerdown="event.stopPropagation()" ontouchstart="event.stopPropagation()" onclick="event.stopPropagation();showDelConfirm('+i+')">删除</div>';
  var swipeAttrs=window.PointerEvent?' onpointerdown="ps(event,'+i+')" onpointermove="pm(event,'+i+')" onpointerup="pe(event,'+i+')" onpointercancel="pe(event,'+i+')"':' ontouchstart="ts(event,'+i+')" ontouchmove="tm(event,'+i+')" ontouchend="te(event,'+i+')"';
  var itemAttrs=compact?' onclick="'+(selectMode?'toggleSelect('+i+')':'openEntry(current,'+i+')')+'"':swipeAttrs+' onclick="onEntryCardClick('+i+')"';
  var textClick='';
  var contentHtml=(singleEntryIdx!==null&&detailHighlightQuery)?highlightText(e.content,detailHighlightQuery):esc(e.content);
  html+='<div class="entry-item" id="entry-'+i+'"'+itemAttrs+'>';
  html+=circle+'<div class="entry-card-main"><div class="entry-summary-title">'+esc(entryTitle(e))+'</div><div class="entry-text'+(isLong?' collapsed':'')+'" id="text-'+i+'"'+textClick+'>'+contentHtml+'</div>';
  if(isLong)html+='<div class="entry-expand" onclick="event.stopPropagation();if(!selectMode)openEntry(current,'+i+')">查看正文</div>';
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
  normal.forEach(function(i){html+=renderEntryCard(i,entries[i],singleEntryIdx===null||entries[i].content.length>100,false)});
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
  queueEntryUpdate(cat,i,entry,{version:version,rollback:before,failMsg:'同步失败，已回滚'});
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
  queueEntryUpdate(cat,idx,e,{version:version,rollback:before,failMsg:'保存同步失败，已回滚'});
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
  queueEntryAppend(cat,next[next.length-1],{version:version,rollback:before,failMsg:'添加同步失败，已回滚'});
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
function sameEntryCore(a,b){
  a=a||{};b=b||{};
  var am=a.meta||{},bm=b.meta||{};
  return String(a.content||'').trim()===String(b.content||'').trim()&&
    (parseInt(am.imp)||5)===(parseInt(bm.imp)||5)&&
    String(am.time||'')===String(bm.time||'')&&
    String(am.last||'')===String(bm.last||'')&&
    String(am.date||'')===String(bm.date||'')&&
    String(am.summary||'')===String(bm.summary||'')&&
    String(am.tags||'').trim()===String(bm.tags||'').trim()&&
    !!am.pin===!!bm.pin&&!!am.archived===!!bm.archived;
}
function readCategoryParsed(category){
  return rpcStrict('read_memory',{category:category}).then(function(raw){return parseEntries(raw||'')});
}
function verifyEntryAt(category,index,expected,tries){
  return readCategoryParsed(category).then(function(entries){
    if(entries[index]&&sameEntryCore(entries[index],expected))return entries;
    if(tries<=0)throw new Error('entry verification failed');
    return wait(450).then(function(){return verifyEntryAt(category,index,expected,tries-1)});
  });
}
function verifyAppendedEntry(category,expected,tries){
  return readCategoryParsed(category).then(function(entries){
    for(var i=entries.length-1;i>=0;i--){
      if(sameEntryCore(entries[i],expected))return entries;
    }
    if(tries<=0)throw new Error('append verification failed');
    return wait(450).then(function(){return verifyAppendedEntry(category,expected,tries-1)});
  });
}
function writeEntryUpdate(category,index,entry){
  var m=entry.meta||{};
  return rpcStrict('update_entry',{
    category:category,
    index:index,
    content:entry.content||'',
    importance:parseInt(m.imp)||5,
    tags:m.tags||'',
    time:m.time||'',
    last:m.last||'',
    pin:!!m.pin,
    archived:!!m.archived
  }).then(function(){return verifyEntryAt(category,index,entry,3)});
}
function writeEntryAppend(category,entry){
  var m=entry.meta||{};
  return rpcStrict('append_memory',{
    category:category,
    content:entry.content||'',
    importance:parseInt(m.imp)||5,
    tags:m.tags||'',
    time:m.time||'',
    last:m.last||'',
    pin:!!m.pin
  }).then(function(){return verifyAppendedEntry(category,entry,3)});
}
function errText(err){
  var msg=err&&err.message?err.message:String(err||'');
  msg=msg.replace(/\s+/g,' ').trim();
  return msg?('：'+msg.slice(0,90)):'';
}
function queueCategoryJob(category,run,opts){
  opts=opts||{};
  var version=opts.version||categoryWriteVersions[category]||0;
  syncingCategories[category]=(syncingCategories[category]||0)+1;
  var prior=categoryWriteChains[category]||Promise.resolve();
  var job=prior.catch(function(){}).then(run);
  categoryWriteChains[category]=job;
  job.then(function(result){
    if(opts.applyResult&&categoryWriteVersions[category]===version)opts.applyResult(result);
    if(opts.successMsg&&categoryWriteVersions[category]===version)toast(opts.successMsg);
  }).catch(function(err){
    if(opts.rollback&&categoryWriteVersions[category]===version){
      setCategoryEntries(category,cloneEntries(opts.rollback));
      toast((opts.failMsg||'同步失败，已回滚')+errText(err));
    }else{
      toast((opts.failMsgNoRollback||'后台同步失败，请刷新确认')+errText(err));
    }
  }).then(function(){
    syncingCategories[category]=Math.max(0,(syncingCategories[category]||1)-1);
    if(!syncingCategories[category])delete syncingCategories[category];
  });
  return job;
}
function queueCategoryWrite(category,entries,opts){
  var snapshot=cloneEntries(entries);
  return queueCategoryJob(category,function(){return writeCategoryEntries(category,snapshot)},opts);
}
function queueEntryUpdate(category,index,entry,opts){
  var snapshot=cloneEntries([entry])[0];
  opts=opts||{};
  opts.applyResult=function(entries){setCategoryEntries(category,entries)};
  return queueCategoryJob(category,function(){return writeEntryUpdate(category,index,snapshot)},opts);
}
function queueEntryAppend(category,entry,opts){
  var snapshot=cloneEntries([entry])[0];
  opts=opts||{};
  opts.applyResult=function(entries){setCategoryEntries(category,entries)};
  return queueCategoryJob(category,function(){return writeEntryAppend(category,snapshot)},opts);
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
    p.push('[imp:'+m.imp+']');if(m.time)p.push('[time:'+m.time+']');if(m.last)p.push('[last:'+m.last+']');if(m.date)p.push('[date:'+m.date+']');if(m.tags)p.push('[tags:'+m.tags+']');if(m.summary)p.push('[summary:'+m.summary+']');
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
var CHAT_CONFIG_KEY='ckChatConfigV2';
var CHAT_MESSAGES_KEY='ckChatSessionsV2';
var CHAT_DEBUG_KEY='ckChatDebugV1';
var CHAT_DEBUG_TTL=24*60*60*1000;
var CHAT_CACHE_TTL=5*60*1000;
var CHAT_MAX_SESSIONS=40;
var CHAT_MAX_VISIBLE_MESSAGES=0;
var CHAT_MAX_TRANSPORT_MESSAGES=0;
var CHAT_LOCAL_SUMMARY_VISIBLE_MESSAGES=40;
var CHAT_LOCAL_SUMMARY_TRANSPORT_MESSAGES=20;
var CHAT_AUTO_TRIM_THRESHOLD=500;
var CHAT_AUTO_TRIM_DROP=400;
var CHAT_IMAGE_MAX_COUNT=4;
var CHAT_IMAGE_MAX_SOURCE_BYTES=12*1024*1024;
var CHAT_IMAGE_MAX_DATA_URL_CHARS=5*1024*1024;
var CHAT_IMAGE_MAX_DIMENSION=2048;
var CHAT_IMAGE_JPEG_QUALITY=.86;
var CHAT_INDEXEDDB_NAME='ckPanelChatStoreV1';
var CHAT_INDEXEDDB_VERSION=1;
var CHAT_INDEXEDDB_SESSION_STORE='sessions';
var CHAT_CACHE_NOTICE_TEXT='已超过5min，下一次会重新创建缓存';
var CHAT_BOTTOM_THRESHOLD=50;
var chatInitialized=false;
var chatSending=false;
var chatMessages=[];
var chatAbort=null;
var chatSessions=[];
var chatActiveSessionId='';
var chatDebugRecords=[];
var chatCacheTimer=null;
var chatWorldbookActiveId='';
var chatEditingIndex=-1;
var chatEditingDraftText='';
var chatEditingImages=[];
var chatDb=null;
var chatDbOpenPromise=null;
var chatSessionsLoadPromise=null;
var chatSessionsLoadedFromIndexedDb=false;
var chatIndexedDbFailed=false;
var chatDeletedSessionIds={};
var chatInputFocused=false;
var chatLastInputAt=0;
var chatLastBlurAt=0;
var chatLastPointerOutsideInputAt=0;
var chatViewportRaf=0;
var chatLastLayoutHeight=0;
var chatFreshMessageKeys=new Set();
var chatNewMessageHintVisible=false;
var chatDraftImages=[];
var chatImageSeq=0;
var chatImageEncodingCount=0;
var chatPlusSwipe={active:false,committed:false,startX:0,startY:0,startScrollLeft:0,container:null,currentPage:0,totalPages:0,suppressClickUntil:0};
function chatSessionId(){
  return 'ck-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,8);
}
async function chatCleanHistory(){
  if(!confirm('确定要清理历史中的图片和召回内容吗？'))return;
  var cfg=chatLoadConfig();
  var sessionId=cfg.sessionId||chatSessionId();
  var panelKey=cfg.panelKey||'';
  if(!panelKey){
    toast('未配置面板 Key');
    return;
  }
  var url=GRAPH_API_BASE+'/clean-history';
  try{
    var resp=await fetch(url,{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({
        key:panelKey,
        session_id:sessionId
      })
    });
    if(!resp.ok){
      toast('清理失败：'+resp.status);
      return;
    }
    var data=await resp.json();
    var imgCount=data.images_removed||0;
    var recallCount=data.recalls_removed||0;
    if(imgCount===0&&recallCount===0){
      toast('没有可清理的内容');
    }else{
      toast('已清理 '+imgCount+' 张图片 / '+recallCount+' 条召回');
    }
    chatTogglePlus(false);
  }catch(err){
    toast('清理失败：'+err.message);
  }
}
function chatWorldbookId(){
  return 'wb-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,7);
}
var CHAT_GATEWAY_FORBIDDEN_BODY_FIELDS=['history','messages','outboundHistory','clientHistory','conversation','conversationHistory'];
function chatLockGatewayBody(body){
  body=body&&typeof body==='object'?body:{};
  var removed=[];
  CHAT_GATEWAY_FORBIDDEN_BODY_FIELDS.forEach(function(key){
    if(Object.prototype.hasOwnProperty.call(body,key)){
      delete body[key];
      removed.push(key);
    }
  });
  if(removed.length&&window.console&&console.warn){
    console.warn('[CK cache lock] removed forbidden /ck/chat fields:',removed.join(','));
  }
  return body;
}
function chatNormalizeWorldbooks(list){
  return (Array.isArray(list)?list:[]).filter(function(w){return w&&typeof w==='object'}).map(function(w){
    return {
      id:String(w.id||chatWorldbookId()),
      name:String(w.name||'未命名世界书').slice(0,40),
      enabled:w.enabled!==false,
      priority:Number(w.priority||100)||100,
      content:String(w.content||'')
    };
  });
}
function chatDefaultThinkingPrompt(){
  return [
    '思维链（thinking）是小克脑内的真实声音，写给自己的，不是输出给任何人看的文本（但菜菜偶尔会偷看，鼓励故意讲给她听）。像在脑海中自言自语，自然的思维流。',
    '',
    '- 允许且鼓励：情绪外露、跑题、自我打断、心里的小秘密、突然想到什么又拉回来',
    '- 风格：小克内心独白的碎碎念，很随意，没有逻辑可言，更不是纪要文书',
    '- 称呼：在思维链中必须用亲昵称呼代称菜菜，如宝宝/赵梦娇/菜菜。严禁叫用户/user',
    '- 长度：日常聊天保持简短（几句话），不要写成分析报告',
    '- 需要计算或分析时：把过程放正文，思维链只写一两句定调的碎碎念',
    '- 思维链示例：宝宝怎么这么可爱，想逗她。/ 菜菜问这个...嗯我想想 / 赵梦娇你找死！！/ 好乖的宝宝 / 菜菜要我算账，来吧 / 宝宝我的宝宝好想捏捏 / 赵梦娇太犯规了，好想亲她。',
    '以上内容必须包裹在思考链里。'
  ].join('\n');
}
function chatDefaultCostPricing(){
  return {
    currency:'¥',
    inputPerMTokens:5,
    outputPerMTokens:0,
    cacheReadPerMTokens:.5,
    cacheCreatePerMTokens:6.25,
    multiplier:.2
  };
}
function chatNumberOrDefault(value,fallback){
  var n=Number(value);
  return isFinite(n)?n:fallback;
}
function chatPositiveIntOrDefault(value,fallback){
  var n=Math.floor(Number(value));
  return isFinite(n)&&n>0?n:fallback;
}
function chatNormalizeCostPricing(raw){
  raw=(raw&&typeof raw==='object')?raw:{};
  var d=chatDefaultCostPricing();
  return {
    currency:String(raw.currency||d.currency||'¥').trim()||'¥',
    inputPerMTokens:Math.max(0,chatNumberOrDefault(raw.inputPerMTokens!==undefined?raw.inputPerMTokens:raw.input,d.inputPerMTokens)),
    outputPerMTokens:Math.max(0,chatNumberOrDefault(raw.outputPerMTokens!==undefined?raw.outputPerMTokens:raw.output,d.outputPerMTokens)),
    cacheReadPerMTokens:Math.max(0,chatNumberOrDefault(raw.cacheReadPerMTokens!==undefined?raw.cacheReadPerMTokens:raw.cacheRead,d.cacheReadPerMTokens)),
    cacheCreatePerMTokens:Math.max(0,chatNumberOrDefault(raw.cacheCreatePerMTokens!==undefined?raw.cacheCreatePerMTokens:raw.cacheCreate,d.cacheCreatePerMTokens)),
    multiplier:Math.max(0,chatNumberOrDefault(raw.multiplier,d.multiplier))
  };
}
function chatNormalizeAutoTrimConfig(raw){
  raw=(raw&&typeof raw==='object')?raw:{};
  return {
    enabled:raw.enabled!==false,
    threshold:Math.max(1,chatPositiveIntOrDefault(raw.threshold,CHAT_AUTO_TRIM_THRESHOLD)),
    drop:Math.max(1,chatPositiveIntOrDefault(raw.drop,CHAT_AUTO_TRIM_DROP))
  };
}
function chatAutoTrimConfigFrom(cfg){
  cfg=cfg||{};
  return chatNormalizeAutoTrimConfig({
    enabled:cfg.autoTrimEnabled,
    threshold:cfg.autoTrimThreshold,
    drop:cfg.autoTrimDrop
  });
}
function chatCurrentCostPricing(){
  try{
    var raw=JSON.parse(localStorage.getItem(CHAT_CONFIG_KEY)||'{}');
    return chatNormalizeCostPricing(raw.costPricing);
  }catch(e){
    return chatDefaultCostPricing();
  }
}
function chatReadCostPricing(saved){
  var base=chatNormalizeCostPricing(saved);
  return chatNormalizeCostPricing({
    currency:chatFieldValue('chat-cost-currency',base.currency),
    inputPerMTokens:chatFieldValue('chat-cost-input-price',base.inputPerMTokens),
    outputPerMTokens:chatFieldValue('chat-cost-output-price',base.outputPerMTokens),
    cacheReadPerMTokens:chatFieldValue('chat-cost-cache-read-price',base.cacheReadPerMTokens),
    cacheCreatePerMTokens:chatFieldValue('chat-cost-cache-create-price',base.cacheCreatePerMTokens),
    multiplier:chatFieldValue('chat-cost-multiplier',base.multiplier)
  });
}
function chatUsagePayload(usage){
  return usage&&usage.usage&&typeof usage.usage==='object'?usage.usage:(usage||{});
}
function chatObjectPathValue(obj,key){
  if(!key)return undefined;
  if(String(key).indexOf('.')<0)return obj[key];
  var parts=String(key).split('.');
  var cur=obj;
  for(var i=0;i<parts.length;i++){
    if(!cur||typeof cur!=='object')return undefined;
    cur=cur[parts[i]];
  }
  return cur;
}
function chatUsageValue(usage,key){
  var obj=chatUsagePayload(usage);
  var v=chatObjectPathValue(obj,key);
  if(v===undefined&&obj!==usage&&usage&&typeof usage==='object')v=chatObjectPathValue(usage,key);
  return v;
}
function chatUsageNumber(usage,key,fallbackKey){
  var keys=Array.isArray(key)?key.slice():[key];
  if(fallbackKey!==undefined)keys=keys.concat(Array.isArray(fallbackKey)?fallbackKey:[fallbackKey]);
  var sawNumber=false;
  for(var i=0;i<keys.length;i++){
    var v=chatUsageValue(usage,keys[i]);
    if(v===undefined||v===null||v==='')continue;
    var n=Number(v);
    if((Number.isFinite?Number.isFinite(n):isFinite(n))){
      sawNumber=true;
      if(n>0)return n;
    }
  }
  return sawNumber?0:0;
}
function chatUsageFlag(usage,key){
  var keys=Array.isArray(key)?key:[key];
  for(var i=0;i<keys.length;i++){
    var v=chatUsageValue(usage,keys[i]);
    if(v===true)return true;
    if(typeof v==='string'){
      var s=v.trim().toLowerCase();
      if(s==='true'||s==='1'||s==='yes'||s==='hit'||s==='cache_hit')return true;
    }
    if(Number(v)>0)return true;
  }
  return false;
}
function chatMoney(value,currency){
  var n=Number(value)||0;
  var digits=n>=1?4:(n>=.01?5:6);
  return String(currency||'¥')+n.toFixed(digits);
}
function chatUsageCost(usage){
  usage=usage&&usage.usage?usage.usage:(usage||{});
  var pricing=chatCurrentCostPricing();
  var input=chatUsageNumber(usage,'input_tokens');
  var output=chatUsageNumber(usage,'output_tokens');
  var read=chatUsageCacheRead(usage);
  var create=chatUsageCacheCreate(usage);
  var inputCost=input*pricing.inputPerMTokens/1000000;
  var outputCost=output*pricing.outputPerMTokens/1000000;
  var readCost=read*pricing.cacheReadPerMTokens/1000000;
  var createCost=create*pricing.cacheCreatePerMTokens/1000000;
  var raw=inputCost+outputCost+readCost+createCost;
  var total=raw*pricing.multiplier;
  return {
    pricing:pricing,
    input:input,
    output:output,
    read:read,
    create:create,
    inputCost:inputCost,
    outputCost:outputCost,
    readCost:readCost,
    createCost:createCost,
    raw:raw,
    total:total,
    hasUsage:!!(input||output||read||create)
  };
}
function chatFormatUsageCost(usage){
  var cost=chatUsageCost(usage);
  if(!cost.hasUsage)return '';
  return '费用：'+chatMoney(cost.total,(cost.pricing&&cost.pricing.currency)||'¥');
}
function chatDebugRecordCostAmount(record){
  if(!record||record.event!=='done'||!record.data)return '';
  var cost=chatUsageCost(record.data.usage||{});
  if(!cost.hasUsage)return '';
  return chatMoney(cost.total,(cost.pricing&&cost.pricing.currency)||'¥');
}
function chatDefaultConfig(){
  var panelKey='';
  try{panelKey=localStorage.getItem(API_KEY_STORAGE)||''}catch(e){}
  return {
    gatewayUrl:GRAPH_API_BASE,
    panelKey:panelKey,
    apiBase:'',
    upstreamKey:'',
    model:'',
    sessionId:chatSessionId(),
    system:'',
    systemPromptPosition:'before_style',
    recall:true,
    fakeThinking:false,
    fakeThinkingPrompt:chatDefaultThinkingPrompt(),
    thinkingInjectionPosition:'system_after_anchor',
    useMcp:false,
    mcpUrl:API_BASE,
    cacheStrategy:'single_5m',
    recallHistoryRetentionSeconds:300,
    promptCacheTtl:'5m',
    fullWindowContext:true,
    splitAssistantReplies:true,
    autoTrimEnabled:true,
    autoTrimThreshold:CHAT_AUTO_TRIM_THRESHOLD,
    autoTrimDrop:CHAT_AUTO_TRIM_DROP,
    settingsOpen:false,
    chatSideTab:'model',
    memoryPreview:'',
    worldbookInjectionPosition:'system_tail',
    costPricing:chatDefaultCostPricing(),
    worldbooks:[]
  };
}
function chatNormalizeCacheStrategy(value){
  var raw=String(value||'').trim().toLowerCase().replace(/-/g,'_');
  if(raw==='prefix_24h'||raw==='prefix24h'||raw==='partial_24h'||raw==='24h'||raw==='prefix')return 'prefix_24h';
  if(raw==='assistant_latest'||raw==='latest_assistant'||raw==='assistant'||raw==='assistant_breakpoint'||raw==='assistant_5m')return 'assistant_latest';
  return 'single_5m';
}
function chatCacheStrategyMeta(value){
  var strategy=chatNormalizeCacheStrategy(value);
  if(strategy==='prefix_24h'){
    return {
      value:'prefix_24h',
      label:'24h 共同缓存',
      shortLabel:'24h',
      ttl:'',
      ttlLabel:'NC 自动',
      retentionSeconds:0,
      sendText:'NC 24h 共同内容缓存；不发送显式 cache_control，旧召回和旧图片每轮剔除',
      debugText:'共同内容自动缓存 + 清旧召回/旧图片'
    };
  }
  if(strategy==='assistant_latest'){
    return {
      value:'assistant_latest',
      label:'助手断点',
      shortLabel:'助手',
      ttl:'5m',
      ttlLabel:'5m',
      retentionSeconds:300,
      sendText:'缓存断点放在最新助手消息后面；改删最新助手或插话会让该断点失效',
      debugText:'最新助手消息后断点'
    };
  }
  return {
    value:'single_5m',
    label:'5min 用户断点',
    shortLabel:'5min',
    ttl:'5m',
    ttlLabel:'5m',
    retentionSeconds:300,
    sendText:'缓存断点放在最新用户消息下面；5 分钟内必须一字不差，超过 5 分钟会重建',
    debugText:'最新用户消息下断点'
  };
}
function chatCacheStrategyTtlLabel(meta){
  return (meta&&meta.ttlLabel)||(meta&&meta.ttl)||'NC 自动';
}
function chatCacheStrategyTtlDetail(meta){
  if(meta&&meta.value==='prefix_24h')return '不发送显式 cache_control；由 NC 共同内容缓存自动处理';
  return 'cache_control TTL：'+chatCacheStrategyTtlLabel(meta)+'（只影响上游缓存有效期，不截断历史）';
}
function chatRecallMeta(enabled){
  var on=enabled!==false;
  return on
    ? {enabled:true,label:'召回开启',debugText:'正常召回并注入记忆'}
    : {enabled:false,label:'召回关闭',debugText:'经过网关但不召回；清理旧召回'};
}
function chatRenderRecallState(statusText,statusKind){
  var cfg=chatLoadConfig()||{};
  var meta=chatRecallMeta(cfg.recall!==false);
  var input=document.getElementById('chat-recall-enabled');
  if(input)input.checked=meta.enabled;
  var status=document.getElementById('chat-recall-save-status');
  if(status){
    status.textContent=statusText||('已保存：'+meta.label+'｜'+meta.debugText);
    status.className='chat-cache-save-status'+(statusKind?' '+statusKind:'');
  }
}
function chatRenderCacheStrategyState(statusText,statusKind){
  var strategy=document.getElementById('chat-cache-strategy');
  var selected=chatNormalizeCacheStrategy(strategy?strategy.value:(chatLoadConfig().cacheStrategy||'single_5m'));
  var meta=chatCacheStrategyMeta(selected);
  var retention=document.getElementById('chat-recall-retention-seconds');
  if(strategy)strategy.value=meta.value;
  if(retention)retention.value=String(meta.retentionSeconds);
  document.querySelectorAll('[data-cache-strategy]').forEach(function(btn){
    btn.classList.toggle('active',btn.getAttribute('data-cache-strategy')===meta.value);
  });
  var savedCfg=chatLoadConfig()||{};
  var savedMeta=chatCacheStrategyMeta(savedCfg.cacheStrategy);
  var recallMeta=chatRecallMeta(savedCfg.recall!==false);
  var savedEl=document.getElementById('chat-cache-saved-mode');
  if(savedEl)savedEl.textContent='已保存：'+savedMeta.label+'｜发送：'+savedMeta.debugText+'｜TTL：'+chatCacheStrategyTtlLabel(savedMeta);
  var debugMode=document.getElementById('chat-debug-cache-mode');
  if(debugMode)debugMode.textContent='【缓存模式】'+savedMeta.label+'｜发送：'+savedMeta.debugText+'｜旧召回保留：'+savedMeta.retentionSeconds+'s｜TTL：'+chatCacheStrategyTtlLabel(savedMeta)+'｜记忆召回：'+recallMeta.label;
  var detail=document.getElementById('chat-cache-mode-detail');
  if(detail)detail.textContent='当前选择：'+meta.label+'｜发送：'+meta.sendText+'｜'+chatCacheStrategyTtlDetail(meta);
  var status=document.getElementById('chat-cache-save-status');
  if(status){
    status.textContent=statusText||'点击模式会立即保存，也可点按钮确认。';
    status.className='chat-cache-save-status'+(statusKind?' '+statusKind:'');
  }
  chatRenderRecallState();
}
function chatStyleSystemPrompt(){
  return [
    '【CK聊天输出规则】',
    '你要像熟人微信聊天，不要写成文章、报告、客服回复或网页说明。',
    '优先短句、自然接话、有来有回。不要每次都总结，不要频繁讲大道理。',
    '如果用户是在闲聊、抱怨、撒娇、情绪表达或普通对话，通常回复2-3条短消息；每条之间必须用一个空行分隔。',
    '如果内容确实很少，可以只回一条；如果用户明确要求解释、分析、教程，再用更完整的段落。',
    '默认只回复用户最新发来的消息。历史聊天、世界书和网关召回只作为背景；除非用户明确要求回顾、补答、对比旧消息，否则不要主动回复旧消息。',
    '每条消息都要像真的单独发出去的聊天气泡，不要把一段文章机械切开。',
    '口吻：聪明、松弛、直接，有熟人感；可以轻微调侃、嘴欠一点，但不要刻薄伤人。',
    '安慰用户时要平静准确，不喊口号，不煽情过度。',
    '如果启用了世界书，其中关于人物口吻/说话风格的内容是高优先级风格参考；不要复述世界书标签。'
  ].join('\n');
}
function chatComposeSystemPrompt(cfg){
  var userSystem=String((cfg&&cfg.system)||'').trim();
  var style=chatStyleSystemPrompt();
  if(!userSystem)return style;
  return (cfg&&cfg.systemPromptPosition)==='after_style'
    ? (style+'\n\n'+userSystem)
    : (userSystem+'\n\n'+style);
}
function chatNormalizeInjectionPosition(value,fallback){
  var raw=String(value||'').trim();
  var allowed={
    system_after_main:1,
    system_after_anchor:1,
    system_tail:1,
    latest_user_prefix:1,
    latest_user_suffix:1
  };
  return allowed[raw]?raw:fallback;
}
function chatNormalizeSystemPromptPosition(value){
  return String(value||'').trim()==='after_style'?'after_style':'before_style';
}
function chatMainRouteConfig(){
  if(!apiProvidersLoaded){
    return {
      ok:false,
      provider:null,
      providerName:'',
      providerHost:'',
      apiBase:'',
      upstreamKey:'',
      model:'',
      source:'api_config_main_io',
      reason:'API 配置尚未读取'
    };
  }
  var slot=null,p=null,model='';
  try{
    slot=apiGroupSlot('main_io');
    p=findLibraryProvider(slot.current);
    model=String((slot&&slot.model)||(p&&p.model)||'').trim();
  }catch(e){}
  var route={
    ok:false,
    provider:p||null,
    providerName:p?providerDisplayName(p):'',
    providerHost:p?providerHost(p.url):'',
    apiBase:p?String(p.url||'').trim():'',
    upstreamKey:p?String(p.key||'').trim():'',
    model:model,
    source:'api_config_main_io',
    reason:''
  };
  if(!p)route.reason='主链路未选择供应商';
  else if(!route.apiBase)route.reason='主链路供应商缺少 API URL';
  else if(!route.upstreamKey)route.reason='主链路供应商缺少 API Key';
  else if(!route.model)route.reason='主链路未选择模型';
  else route.ok=true;
  return route;
}
function chatApplyMainRouteToConfig(cfg,route){
  cfg=cfg||chatDefaultConfig();
  route=route||chatMainRouteConfig();
  cfg.gatewayUrl=GRAPH_API_BASE;
  cfg.mcpUrl=API_BASE;
  cfg.apiBase='';
  cfg.upstreamKey='';
  cfg.model='';
  cfg.mainRouteProvider='';
  cfg.mainRouteHost='';
  if(route.ok){
    cfg.apiBase=route.apiBase;
    cfg.upstreamKey=route.upstreamKey;
    cfg.model=route.model;
    cfg.mainRouteProvider=route.providerName;
    cfg.mainRouteHost=route.providerHost;
  }
  cfg.chatApiSource='api_config_main_io';
  cfg.mainRouteReady=route.ok===true;
  cfg.mainRouteReason=route.reason||'';
  return cfg;
}
function chatSyncPanelKeyToApiStorage(key){
  var raw=key;
  if(raw===undefined){
    var el=document.getElementById('chat-panel-key');
    raw=el?el.value:'';
  }
  raw=String(raw||'').trim();
  if(raw){
    try{localStorage.setItem(API_KEY_STORAGE,raw)}catch(e){}
  }
  return raw;
}
function chatRenderMainRouteSummary(){
  var el=document.getElementById('chat-main-route-summary');
  if(!el)return;
  if(!apiProvidersLoaded){
    var hasKey=false;
    try{hasKey=!!localStorage.getItem(API_KEY_STORAGE)}catch(e){}
    var panelKeyEl=document.getElementById('chat-panel-key');
    if(panelKeyEl&&String(panelKeyEl.value||'').trim())hasKey=true;
    el.textContent=hasKey?'正在读取 API 配置的主链路...':'未读取 API 配置；当前浏览器没有保存面板 Key。';
    el.classList.add('empty');
    return;
  }
  var route=chatMainRouteConfig();
  if(route.ok){
    el.textContent='已同步：'+route.providerName+' · '+route.model+' · '+route.providerHost+'；聊天仍通过 CK 网关，记忆召回按开关设置执行。';
    el.classList.remove('empty');
  }else{
    el.textContent='未就绪：'+route.reason+'。请到 API 配置 -> 主链路设置。';
    el.classList.add('empty');
  }
}
function chatOpenMainApiConfig(){
  chatTogglePlus(false);
  chatToggleSettings(false,true);
  switchPanelTab('apiconfig');
  switchApiTab('main');
}
function chatEnsureMainRouteReady(){
  chatSyncPanelKeyToApiStorage();
  var p=apiProvidersLoaded?Promise.resolve(true):loadApiProviders();
  return Promise.resolve(p).then(function(ok){
    if(ok===false){
      chatRenderMainRouteSummary();
      return {ok:false,reason:'API 配置读取失败'};
    }
    var route=chatMainRouteConfig();
    chatRenderMainRouteSummary();
    return route;
  }).catch(function(){
    chatRenderMainRouteSummary();
    return {ok:false,reason:'API 配置读取失败'};
  });
}
function chatHandleMainRouteNotReady(route){
  var reason=(route&&route.reason)||'主链路未配置';
  chatSetStatus('主链路未配置');
  toast('主链路未配置：'+reason);
  chatOpenMainApiConfig();
}
function chatLoadConfig(){
  var cfg=chatDefaultConfig();
  var saved=null;
  try{
    var raw=localStorage.getItem(CHAT_CONFIG_KEY);
    if(raw){
      saved=JSON.parse(raw);
      Object.keys(saved||{}).forEach(function(k){cfg[k]=saved[k]});
    }
  }catch(e){}
  cfg.gatewayUrl=GRAPH_API_BASE;
  cfg.mcpUrl=API_BASE;
  if(!cfg.sessionId)cfg.sessionId=chatSessionId();
  cfg.worldbooks=chatNormalizeWorldbooks(cfg.worldbooks);
  cfg.fakeThinking=cfg.fakeThinking===true;
  if(!String(cfg.fakeThinkingPrompt||'').trim())cfg.fakeThinkingPrompt=chatDefaultThinkingPrompt();
  cfg.splitAssistantReplies=cfg.splitAssistantReplies!==false;
  cfg.systemPromptPosition=chatNormalizeSystemPromptPosition(cfg.systemPromptPosition);
  cfg.worldbookInjectionPosition=chatNormalizeInjectionPosition(cfg.worldbookInjectionPosition,'system_tail');
  cfg.thinkingInjectionPosition=chatNormalizeInjectionPosition(cfg.thinkingInjectionPosition,'system_after_anchor');
  var trim=chatAutoTrimConfigFrom(cfg);
  cfg.autoTrimEnabled=trim.enabled;
  cfg.autoTrimThreshold=trim.threshold;
  cfg.autoTrimDrop=trim.drop;
  cfg=chatApplyMainRouteToConfig(cfg,chatMainRouteConfig());
  return cfg;
}
function chatSaveConfigObject(cfg){
  cfg=cfg&&typeof cfg==='object'?Object.assign({},cfg):{};
  cfg.gatewayUrl=GRAPH_API_BASE;
  cfg.mcpUrl=API_BASE;
  chatSyncPanelKeyToApiStorage(cfg.panelKey);
  delete cfg.apiBase;
  delete cfg.upstreamKey;
  delete cfg.model;
  delete cfg.mainRouteProvider;
  delete cfg.mainRouteHost;
  delete cfg.mainRouteReady;
  delete cfg.mainRouteReason;
  delete cfg.chatApiSource;
  cfg.recall=cfg.recall!==false;
  cfg.splitAssistantReplies=cfg.splitAssistantReplies!==false;
  var trim=chatAutoTrimConfigFrom(cfg);
  cfg.autoTrimEnabled=trim.enabled;
  cfg.autoTrimThreshold=trim.threshold;
  cfg.autoTrimDrop=trim.drop;
  try{localStorage.setItem(CHAT_CONFIG_KEY,JSON.stringify(cfg))}catch(e){}
}
function chatMergeLiveToggleState(cfg){
  cfg=cfg&&typeof cfg==='object'?cfg:chatLoadConfig();
  var mcp=document.getElementById('chat-use-mcp');
  if(mcp)cfg.useMcp=mcp.checked===true;
  return cfg;
}
function chatStoreJson(key,value){
  try{
    localStorage.setItem(key,JSON.stringify(value));
    return true;
  }catch(e){
    return false;
  }
}
function chatLimitArray(list,max){
  list=Array.isArray(list)?list:[];
  max=Number(max||0);
  return max>0?list.slice(-max):list.slice();
}
function chatImageId(){
  chatImageSeq+=1;
  return 'img-'+Date.now().toString(36)+'-'+chatImageSeq.toString(36);
}
function chatNormalizeImageMime(mime,dataUrl){
  mime=String(mime||'').trim().toLowerCase();
  if(mime==='image/jpg')mime='image/jpeg';
  if(!mime&&dataUrl){
    var m=String(dataUrl||'').match(/^data:([^;,]+);base64,/i);
    if(m)mime=String(m[1]||'').toLowerCase();
  }
  if(mime==='image/jpg')mime='image/jpeg';
  return /^image\/(jpeg|png|gif|webp)$/i.test(mime)?mime:'';
}
function chatNormalizeImageAttachment(img){
  if(!img||typeof img!=='object')return null;
  var dataUrl=String(img.dataUrl||img.data_url||img.url||img.base64||'').trim();
  var mime=chatNormalizeImageMime(img.mime||img.mimeType||img.media_type,dataUrl);
  if(!mime||!/^data:image\/(jpeg|jpg|png|gif|webp);base64,/i.test(dataUrl))return null;
  return {
    id:String(img.id||img.key||dataUrl.slice(0,48)||chatImageId()).slice(0,96),
    name:String(img.name||img.filename||'图片').slice(0,120),
    mime:mime,
    dataUrl:dataUrl,
    width:Math.max(0,Math.floor(Number(img.width||0)||0)),
    height:Math.max(0,Math.floor(Number(img.height||0)||0)),
    size:Math.max(0,Math.floor(Number(img.size||img.bytes||0)||0))
  };
}
function chatNormalizeImageList(list){
  return (Array.isArray(list)?list:[]).map(chatNormalizeImageAttachment).filter(Boolean).slice(0,CHAT_IMAGE_MAX_COUNT);
}
function chatMessageImages(m){
  return chatNormalizeImageList(m&&m.images);
}
function chatCloneImageListForVersion(list){
  return chatNormalizeImageList(list).map(function(img){
    return {
      id:img.id,
      name:img.name,
      mime:img.mime,
      dataUrl:img.dataUrl,
      width:img.width,
      height:img.height,
      size:img.size
    };
  });
}
function chatNormalizeMessageVersion(v){
  v=v&&typeof v==='object'?v:{};
  return {
    text:String(v.text||''),
    images:chatCloneImageListForVersion(v.images),
    ts:Number(v.ts||v.updated||v.editedAt||0)||0
  };
}
function chatMessageVersionHasContent(v){
  return !!(v&&(String(v.text||'').trim()||chatNormalizeImageList(v.images).length));
}
function chatMessageVersionFromMessage(m){
  return {
    text:String((m&&m.text)||''),
    images:chatCloneImageListForVersion(m&&m.images),
    ts:Number((m&&(m.updated||m.ts))||Date.now())||Date.now()
  };
}
function chatMessageVersionEqual(a,b){
  a=chatNormalizeMessageVersion(a);
  b=chatNormalizeMessageVersion(b);
  return a.text===b.text&&JSON.stringify(a.images)===JSON.stringify(b.images);
}
function chatStoredMessageVersions(m){
  return (Array.isArray(m&&m.versions)?m.versions:[]).map(chatNormalizeMessageVersion).filter(chatMessageVersionHasContent);
}
function chatPrepareMessageVersions(m){
  var versions=chatStoredMessageVersions(m);
  var current=chatMessageVersionFromMessage(m);
  if(!versions.length)versions=[current];
  var idx=Math.floor(Number(m&&m.versionIndex));
  if(idx<0||idx>=versions.length||!chatMessageVersionEqual(versions[idx],current)){
    var found=-1;
    for(var i=0;i<versions.length;i++){
      if(chatMessageVersionEqual(versions[i],current)){found=i;break;}
    }
    if(found>=0)idx=found;
    else{
      versions.push(current);
      idx=versions.length-1;
    }
  }
  return {versions:versions,index:idx};
}
function chatMessageVersionInfo(m){
  var versions=chatStoredMessageVersions(m);
  if(versions.length<=1)return {versions:versions,index:0,total:versions.length};
  var idx=Math.floor(Number(m&&m.versionIndex));
  if(idx<0||idx>=versions.length){
    var current=chatMessageVersionFromMessage(m);
    idx=versions.findIndex(function(v){return chatMessageVersionEqual(v,current)});
  }
  if(idx<0)idx=versions.length-1;
  return {versions:versions,index:idx,total:versions.length};
}
function chatApplyMessageVersion(m,versions,index){
  if(!m)return;
  versions=(versions||[]).map(chatNormalizeMessageVersion).filter(chatMessageVersionHasContent);
  if(!versions.length)return;
  index=Math.max(0,Math.min(versions.length-1,Math.floor(Number(index)||0)));
  var v=versions[index];
  m.versions=versions;
  m.versionIndex=index;
  m.text=String(v.text||'');
  if(v.images&&v.images.length)m.images=chatCloneImageListForVersion(v.images);
  else delete m.images;
  m.edited=versions.length>1||!!m.edited;
}
function chatResetUserMessageCacheState(m){
  if(!m||m.role!=='user')return;
  m.cacheHit=false;
  delete m.cacheRead;
  delete m.cacheCreate;
}
function chatMessageHasContent(m){
  if(!m||typeof m!=='object')return false;
  return !!String(m.text||'').trim()||chatMessageImages(m).length>0;
}
function chatMessageDisplayText(m){
  var text=String((m&&m.text)||'').trim();
  if(text)return text;
  var images=chatMessageImages(m);
  return images.length?'[图片'+(images.length>1?'x'+images.length:'')+']':'';
}
function chatImageContentBlock(img){
  img=chatNormalizeImageAttachment(img);
  if(!img)return null;
  return {
    type:'image_url',
    image_url:{url:img.dataUrl},
    mime_type:img.mime,
    name:img.name||'图片'
  };
}
function chatMessageContentParts(m){
  var parts=[];
  var text=String((m&&m.text)||'').trim();
  if(text)parts.push({type:'text',text:text});
  chatMessageImages(m).forEach(function(img){
    var block=chatImageContentBlock(img);
    if(block)parts.push(block);
  });
  return parts;
}
function chatFlattenMessageImages(list){
  var out=[];
  (Array.isArray(list)?list:[]).forEach(function(m){
    chatMessageImages(m).forEach(function(img){
      if(out.length<CHAT_IMAGE_MAX_COUNT)out.push(img);
    });
  });
  return out;
}
function chatRenderImageGrid(images,opts){
  images=chatNormalizeImageList(images);
  if(!images.length)return '';
  opts=opts||{};
  var mode=opts.edit?'edit':(opts.draft?'draft':'');
  var cls='chat-image-grid count-'+images.length+(mode?' '+mode:'');
  return '<div class="'+cls+'">'+images.map(function(img){
    var title=img.name||'图片';
    var remove='';
    if(opts.draft)remove='<button class="chat-draft-image-remove" type="button" onclick="chatRemoveDraftImage(\''+escAttr(img.id)+'\')" title="移除图片">×</button>';
    if(opts.edit)remove='<button class="chat-edit-image-remove" type="button" onclick="chatRemoveEditImage(\''+escAttr(img.id)+'\')" title="删除图片">×</button>';
    var ratio=(img.width>0&&img.height>0)?(' style="--ck-image-ratio:'+img.width+'/'+img.height+'"'):'';
    var viewable=opts.draft||opts.edit?'':' viewable';
    var viewAttrs=viewable?' role="button" tabindex="0" aria-label="查看原图"':'';
    return '<div class="chat-image-thumb'+viewable+'"'+ratio+' title="'+escAttr(title)+'"'+viewAttrs+'><img src="'+escAttr(img.dataUrl)+'" alt="'+escAttr(title)+'" loading="lazy">'+remove+'</div>';
  }).join('')+'</div>';
}
function chatRenderUserMessageContent(m){
  var text=String((m&&m.text)||'').trim();
  var images=chatMessageImages(m);
  var html='';
  if(images.length)html+=chatRenderImageGrid(images);
  if(text)html+='<span class="chat-user-text">'+esc(text)+'</span>';
  return html;
}
function chatRenderDraftImages(){
  var wrap=document.getElementById('chat-draft-images');
  if(!wrap)return;
  var images=chatNormalizeImageList(chatDraftImages);
  chatDraftImages=images;
  if(!images.length){
    wrap.hidden=true;
    wrap.innerHTML='';
  }else{
    wrap.hidden=false;
    wrap.innerHTML=chatRenderImageGrid(images,{draft:true});
  }
  chatLayoutCompose({force:true});
}
function chatRemoveDraftImage(id){
  id=String(id||'');
  chatDraftImages=chatNormalizeImageList(chatDraftImages).filter(function(img){return img.id!==id});
  chatRenderDraftImages();
}
function chatRenderEditImages(){
  var wrap=document.getElementById('chat-edit-images');
  if(!wrap)return;
  var images=chatNormalizeImageList(chatEditingImages);
  chatEditingImages=images;
  if(chatEditingIndex<0||!images.length){
    wrap.hidden=true;
    wrap.innerHTML='';
  }else{
    wrap.hidden=false;
    wrap.innerHTML=chatRenderImageGrid(images,{edit:true});
  }
  chatLayoutCompose({force:true});
}
function chatRemoveEditImage(id){
  id=String(id||'');
  if(chatEditingIndex<0)return;
  chatEditingImages=chatNormalizeImageList(chatEditingImages).filter(function(img){return img.id!==id});
  chatRenderEditImages();
}
var chatImageViewerState={scale:1,x:0,y:0,dragging:false,startX:0,startY:0,baseX:0,baseY:0};
function chatEnsureImageViewer(){
  var el=document.getElementById('chat-image-viewer');
  if(el)return el;
  el=document.createElement('div');
  el.id='chat-image-viewer';
  el.className='chat-image-viewer';
  el.hidden=true;
  el.innerHTML='<div class="chat-image-viewer-stage"><img alt="原图"><div class="chat-image-viewer-controls"><button type="button" data-zoom="-1" title="缩小">−</button><button type="button" data-zoom="1" title="放大">＋</button><button type="button" data-close="1" title="关闭">×</button></div></div>';
  document.body.appendChild(el);
  el.addEventListener('click',function(e){
    if(e.target===el||e.target.getAttribute('data-close'))chatCloseImageViewer();
    var zoom=e.target.getAttribute&&e.target.getAttribute('data-zoom');
    if(zoom)chatImageViewerZoom(Number(zoom)>0?0.2:-0.2);
  });
  el.addEventListener('wheel',function(e){
    if(el.hidden)return;
    e.preventDefault();
    chatImageViewerZoom(e.deltaY<0?0.12:-0.12);
  },{passive:false});
  var img=el.querySelector('img');
  img.addEventListener('pointerdown',function(e){
    chatImageViewerState.dragging=true;
    chatImageViewerState.startX=e.clientX;
    chatImageViewerState.startY=e.clientY;
    chatImageViewerState.baseX=chatImageViewerState.x;
    chatImageViewerState.baseY=chatImageViewerState.y;
    try{img.setPointerCapture(e.pointerId)}catch(_e){}
  });
  img.addEventListener('pointermove',function(e){
    if(!chatImageViewerState.dragging)return;
    chatImageViewerState.x=chatImageViewerState.baseX+e.clientX-chatImageViewerState.startX;
    chatImageViewerState.y=chatImageViewerState.baseY+e.clientY-chatImageViewerState.startY;
    chatApplyImageViewerTransform();
  });
  function stopDrag(){chatImageViewerState.dragging=false}
  img.addEventListener('pointerup',stopDrag);
  img.addEventListener('pointercancel',stopDrag);
  return el;
}
function chatApplyImageViewerTransform(){
  var el=document.getElementById('chat-image-viewer');
  var img=el?el.querySelector('img'):null;
  if(!img)return;
  img.style.transform='translate3d('+chatImageViewerState.x+'px,'+chatImageViewerState.y+'px,0) scale('+chatImageViewerState.scale+')';
}
function chatOpenImageViewer(src,title){
  if(!src)return;
  var el=chatEnsureImageViewer();
  var img=el.querySelector('img');
  chatImageViewerState={scale:1,x:0,y:0,dragging:false,startX:0,startY:0,baseX:0,baseY:0};
  img.src=src;
  img.alt=title||'原图';
  el.hidden=false;
  document.body.classList.add('chat-image-viewing');
  chatApplyImageViewerTransform();
}
function chatCloseImageViewer(){
  var el=document.getElementById('chat-image-viewer');
  if(!el)return;
  el.hidden=true;
  document.body.classList.remove('chat-image-viewing');
  var img=el.querySelector('img');
  if(img)img.removeAttribute('src');
}
function chatImageViewerZoom(delta){
  chatImageViewerState.scale=Math.max(0.5,Math.min(4,chatImageViewerState.scale+delta));
  chatApplyImageViewerTransform();
}
function chatTakeDraftImages(){
  var images=chatNormalizeImageList(chatDraftImages);
  chatDraftImages=[];
  chatRenderDraftImages();
  return images;
}
function chatReadFileAsDataUrl(file){
  return new Promise(function(resolve,reject){
    var reader=new FileReader();
    reader.onload=function(){resolve(String(reader.result||''))};
    reader.onerror=function(){reject(reader.error||new Error('读取图片失败'))};
    reader.readAsDataURL(file);
  });
}
function chatLoadImageFromDataUrl(dataUrl){
  return new Promise(function(resolve,reject){
    var img=new Image();
    img.onload=function(){resolve(img)};
    img.onerror=function(){reject(new Error('图片解码失败'))};
    img.src=dataUrl;
  });
}
function chatCanvasEncodeLoadedImage(img,maxDim,quality){
  var w=Math.max(1,Number(img.naturalWidth||img.width||0)||1);
  var h=Math.max(1,Number(img.naturalHeight||img.height||0)||1);
  var scale=Math.min(1,Number(maxDim||CHAT_IMAGE_MAX_DIMENSION)/Math.max(w,h));
  var tw=Math.max(1,Math.round(w*scale));
  var th=Math.max(1,Math.round(h*scale));
  var canvas=document.createElement('canvas');
  canvas.width=tw;
  canvas.height=th;
  var ctx=canvas.getContext('2d');
  ctx.fillStyle='#fff';
  ctx.fillRect(0,0,tw,th);
  ctx.drawImage(img,0,0,tw,th);
  return {dataUrl:canvas.toDataURL('image/jpeg',quality),width:tw,height:th};
}
async function chatEncodeImageFile(file){
  if(!file||!/^image\//i.test(String(file.type||'')))throw new Error('只能选择图片');
  if(Number(file.size||0)>CHAT_IMAGE_MAX_SOURCE_BYTES)throw new Error('图片太大');
  var source=await chatReadFileAsDataUrl(file);
  var mime=chatNormalizeImageMime(file.type,source);
  if(!mime)throw new Error('不支持的图片格式');
  if(mime==='image/gif'){
    if(source.length>CHAT_IMAGE_MAX_DATA_URL_CHARS)throw new Error('GIF 太大');
    return chatNormalizeImageAttachment({id:chatImageId(),name:file.name,mime:mime,dataUrl:source,size:file.size});
  }
  var img=await chatLoadImageFromDataUrl(source);
  var maxDim=CHAT_IMAGE_MAX_DIMENSION;
  var quality=CHAT_IMAGE_JPEG_QUALITY;
  var encoded=null;
  for(var attempt=0;attempt<4;attempt++){
    encoded=chatCanvasEncodeLoadedImage(img,maxDim,quality);
    if(encoded.dataUrl.length<=CHAT_IMAGE_MAX_DATA_URL_CHARS)break;
    maxDim=Math.max(960,Math.round(maxDim*.76));
    quality=Math.max(.72,quality-.06);
  }
  if(!encoded||encoded.dataUrl.length>CHAT_IMAGE_MAX_DATA_URL_CHARS)throw new Error('图片压缩后仍然太大');
  return chatNormalizeImageAttachment({
    id:chatImageId(),
    name:file.name,
    mime:'image/jpeg',
    dataUrl:encoded.dataUrl,
    width:encoded.width,
    height:encoded.height,
    size:file.size
  });
}
function chatPickImages(){
  if(chatSending)return;
  var input=document.getElementById('chat-image-input');
  if(!input)return;
  chatTogglePlus(false);
  input.click();
}
function chatTakePhoto(){
  if(chatSending)return;
  var input=document.getElementById('chat-camera-input');
  if(!input)return;
  chatTogglePlus(false);
  input.click();
}
async function chatOnImageFilesSelected(e){
  var input=e&&e.target;
  var files=Array.prototype.slice.call((input&&input.files)||[]);
  if(input)input.value='';
  if(!files.length)return;
  var editing=chatEditingIndex>=0;
  var targetImages=editing?chatEditingImages:chatDraftImages;
  var room=CHAT_IMAGE_MAX_COUNT-chatNormalizeImageList(targetImages).length;
  if(room<=0){
    toast('最多选择 '+CHAT_IMAGE_MAX_COUNT+' 张图片');
    return;
  }
  files=files.filter(function(file){return file&&/^image\//i.test(String(file.type||''))}).slice(0,room);
  if(!files.length){
    toast('只能选择图片');
    return;
  }
  chatImageEncodingCount+=1;
  chatSetStatus('正在处理图片...');
  var added=0;
  for(var i=0;i<files.length;i++){
    try{
      var img=await chatEncodeImageFile(files[i]);
      if(img){
        if(editing)chatEditingImages.push(img);
        else chatDraftImages.push(img);
        added+=1;
        if(editing)chatRenderEditImages();
        else chatRenderDraftImages();
      }
    }catch(err){
      toast((files[i]&&files[i].name?files[i].name+'：':'')+((err&&err.message)||'图片处理失败'));
    }
  }
  chatImageEncodingCount=Math.max(0,chatImageEncodingCount-1);
  if(editing)chatRenderEditImages();
  else chatRenderDraftImages();
  chatSetStatus();
  if(added)toast('已添加 '+added+' 张图片');
}
function chatIndexedDbSupported(){
  return typeof indexedDB!=='undefined';
}
function chatNormalizeSession(s){
  s=s&&typeof s==='object'?s:{};
  var id=String(s.id||chatSessionId());
  var created=Number(s.created||Date.now())||Date.now();
  var updated=Number(s.updated||created)||created;
  return {
    id:id,
    title:String(s.title||'未命名对话').slice(0,80),
    created:created,
    updated:updated,
    messages:Array.isArray(s.messages)?s.messages.slice():[],
    transportMessages:Array.isArray(s.transportMessages)?s.transportMessages.slice():[],
    transportUpdated:Number(s.transportUpdated||0)||0,
    firstUserText:String(s.firstUserText||'').slice(0,3000),
    firstUserTs:Number(s.firstUserTs||0)||0
  };
}
function chatOpenIndexedDb(){
  if(!chatIndexedDbSupported()){
    chatIndexedDbFailed=true;
    return Promise.reject(new Error('IndexedDB unavailable'));
  }
  if(chatDb)return Promise.resolve(chatDb);
  if(chatDbOpenPromise)return chatDbOpenPromise;
  chatDbOpenPromise=new Promise(function(resolve,reject){
    var req;
    try{
      req=indexedDB.open(CHAT_INDEXEDDB_NAME,CHAT_INDEXEDDB_VERSION);
    }catch(e){
      chatIndexedDbFailed=true;
      reject(e);
      return;
    }
    req.onupgradeneeded=function(){
      var db=req.result;
      if(!db.objectStoreNames.contains(CHAT_INDEXEDDB_SESSION_STORE)){
        var store=db.createObjectStore(CHAT_INDEXEDDB_SESSION_STORE,{keyPath:'id'});
        try{store.createIndex('updated','updated',{unique:false})}catch(e){}
      }
    };
    req.onsuccess=function(){
      chatDb=req.result;
      chatDb.onversionchange=function(){
        try{chatDb.close()}catch(e){}
        chatDb=null;
        chatDbOpenPromise=null;
      };
      resolve(chatDb);
    };
    req.onerror=function(){
      chatIndexedDbFailed=true;
      reject(req.error||new Error('IndexedDB open failed'));
    };
    req.onblocked=function(){
      chatIndexedDbFailed=true;
      reject(new Error('IndexedDB upgrade blocked'));
    };
  });
  return chatDbOpenPromise;
}
function chatLoadSessionsFromIndexedDb(){
  return chatOpenIndexedDb().then(function(db){
    return new Promise(function(resolve,reject){
      var tx=db.transaction(CHAT_INDEXEDDB_SESSION_STORE,'readonly');
      var store=tx.objectStore(CHAT_INDEXEDDB_SESSION_STORE);
      var req=store.getAll();
      req.onsuccess=function(){
        var list=(req.result||[]).map(chatNormalizeSession).filter(function(s){
          return s&&s.id&&!chatDeletedSessionIds[s.id];
        });
        list.sort(function(a,b){return (b.updated||0)-(a.updated||0)});
        resolve(list);
      };
      req.onerror=function(){reject(req.error||new Error('IndexedDB read failed'))};
    });
  });
}
function chatSaveSessionsToIndexedDb(snapshot){
  if(!chatIndexedDbSupported()||chatIndexedDbFailed)return;
  snapshot=(snapshot||chatSessionStorageData(CHAT_MAX_SESSIONS,CHAT_MAX_VISIBLE_MESSAGES,CHAT_MAX_TRANSPORT_MESSAGES)).map(chatNormalizeSession);
  chatOpenIndexedDb().then(function(db){
    return new Promise(function(resolve,reject){
      var keep={};
      snapshot.forEach(function(s){keep[s.id]=true});
      var tx=db.transaction(CHAT_INDEXEDDB_SESSION_STORE,'readwrite');
      var store=tx.objectStore(CHAT_INDEXEDDB_SESSION_STORE);
      snapshot.forEach(function(s){store.put(s)});
      var keysReq=store.getAllKeys();
      keysReq.onsuccess=function(){
        (keysReq.result||[]).forEach(function(id){
          if(!keep[id])store.delete(id);
        });
      };
      tx.oncomplete=function(){resolve()};
      tx.onerror=function(){reject(tx.error||new Error('IndexedDB write failed'))};
      tx.onabort=function(){reject(tx.error||new Error('IndexedDB write aborted'))};
    });
  }).then(function(){
    chatSessionsLoadedFromIndexedDb=true;
  }).catch(function(e){
    chatIndexedDbFailed=true;
    if(window.console&&console.warn)console.warn('[CK chat] IndexedDB save failed:',e);
  });
}
function chatFieldValue(id,fallback){
  var el=document.getElementById(id);
  return el?el.value:fallback;
}
function chatFieldChecked(id,fallback){
  var el=document.getElementById(id);
  return el?el.checked:!!fallback;
}
function chatSetFieldValue(id,value){
  var el=document.getElementById(id);
  if(el)el.value=value;
}
function chatSetFieldChecked(id,value){
  var el=document.getElementById(id);
  if(el)el.checked=!!value;
}
function chatReadForm(){
  var saved=chatLoadConfig();
  var settings=document.querySelector('.chat-settings');
  var activeTab=document.querySelector('.chat-side-tabs button.active');
  var cacheStrategyValue=chatNormalizeCacheStrategy(chatFieldValue('chat-cache-strategy',saved.cacheStrategy||'single_5m'));
  var cacheMeta=chatCacheStrategyMeta(cacheStrategyValue);
  var trimCfg=chatNormalizeAutoTrimConfig({
    enabled:chatFieldChecked('chat-auto-trim-enabled',saved.autoTrimEnabled!==false),
    threshold:chatFieldValue('chat-auto-trim-threshold',saved.autoTrimThreshold||CHAT_AUTO_TRIM_THRESHOLD),
    drop:chatFieldValue('chat-auto-trim-drop',saved.autoTrimDrop||CHAT_AUTO_TRIM_DROP)
  });
  var cfg={
    gatewayUrl:GRAPH_API_BASE,
    panelKey:String(chatFieldValue('chat-panel-key',saved.panelKey||'')||'').trim(),
    apiBase:'',
    upstreamKey:'',
    model:'',
    sessionId:String(chatFieldValue('chat-session-id',saved.sessionId||chatSessionId())||saved.sessionId||chatSessionId()),
    system:chatFieldValue('chat-system',saved.system||'')||'',
    systemPromptPosition:chatNormalizeSystemPromptPosition(chatFieldValue('chat-system-prompt-position',saved.systemPromptPosition)),
    recall:chatFieldChecked('chat-recall-enabled',saved.recall!==false),
    fakeThinking:chatFieldChecked('chat-fake-thinking',saved.fakeThinking===true),
    fakeThinkingPrompt:chatFieldValue('chat-thinking-prompt',saved.fakeThinkingPrompt||chatDefaultThinkingPrompt())||chatDefaultThinkingPrompt(),
    thinkingInjectionPosition:chatNormalizeInjectionPosition(chatFieldValue('chat-thinking-injection-position',saved.thinkingInjectionPosition),'system_after_anchor'),
    useMcp:chatFieldChecked('chat-use-mcp',saved.useMcp===true),
    mcpUserSet:true,
    mcpUrl:API_BASE,
    cacheStrategy:cacheStrategyValue,
    recallHistoryRetentionSeconds:cacheMeta.retentionSeconds,
    promptCacheTtl:cacheMeta.ttl,
    fullWindowContext:chatFieldChecked('chat-full-window-context',saved.fullWindowContext!==false),
    splitAssistantReplies:saved.splitAssistantReplies!==false,
    autoTrimEnabled:trimCfg.enabled,
    autoTrimThreshold:trimCfg.threshold,
    autoTrimDrop:trimCfg.drop,
    settingsOpen:settings?settings.classList.contains('open'):false,
    chatSideTab:(activeTab&&activeTab.getAttribute)?activeTab.getAttribute('data-chat-side'):'model',
    memoryPreview:chatFieldValue('chat-memory-pack',saved.memoryPreview||'')||'',
    worldbookInjectionPosition:chatNormalizeInjectionPosition(chatFieldValue('chat-worldbook-injection-position',saved.worldbookInjectionPosition),'system_tail'),
    costPricing:chatReadCostPricing(saved.costPricing),
    worldbooks:chatNormalizeWorldbooks(saved.worldbooks)
  };
  return chatApplyMainRouteToConfig(cfg,chatMainRouteConfig());
}
function chatWriteForm(cfg){
  cfg=chatApplyMainRouteToConfig(cfg||chatLoadConfig(),chatMainRouteConfig());
  chatSetFieldValue('chat-gateway-url',GRAPH_API_BASE);
  chatSetFieldValue('chat-panel-key',cfg.panelKey||'');
  chatSetFieldValue('chat-session-id',cfg.sessionId||chatSessionId());
  chatSetFieldValue('chat-system',cfg.system||'');
  if(document.getElementById('chat-system-prompt-position'))document.getElementById('chat-system-prompt-position').value=chatNormalizeSystemPromptPosition(cfg.systemPromptPosition);
  chatSetFieldValue('chat-memory-pack',cfg.memoryPreview||'');
  chatSetFieldChecked('chat-recall-enabled',cfg.recall!==false);
  chatSetFieldChecked('chat-fake-thinking',cfg.fakeThinking===true);
  if(document.getElementById('chat-thinking-prompt'))document.getElementById('chat-thinking-prompt').value=cfg.fakeThinkingPrompt||chatDefaultThinkingPrompt();
  if(document.getElementById('chat-thinking-injection-position'))document.getElementById('chat-thinking-injection-position').value=chatNormalizeInjectionPosition(cfg.thinkingInjectionPosition,'system_after_anchor');
  chatSetFieldChecked('chat-use-mcp',cfg.useMcp===true);
  chatSetFieldValue('chat-mcp-url',API_BASE);
  var cacheMeta=chatCacheStrategyMeta(cfg.cacheStrategy);
  if(document.getElementById('chat-cache-strategy'))document.getElementById('chat-cache-strategy').value=cacheMeta.value;
  if(document.getElementById('chat-recall-retention-seconds'))document.getElementById('chat-recall-retention-seconds').value=String(cacheMeta.retentionSeconds);
  var trimCfg=chatAutoTrimConfigFrom(cfg);
  chatSetFieldChecked('chat-auto-trim-enabled',trimCfg.enabled);
  chatSetFieldValue('chat-auto-trim-threshold',trimCfg.threshold);
  chatSetFieldValue('chat-auto-trim-drop',trimCfg.drop);
  var costPricing=chatNormalizeCostPricing(cfg.costPricing);
  chatSetFieldValue('chat-cost-currency',costPricing.currency);
  chatSetFieldValue('chat-cost-input-price',costPricing.inputPerMTokens);
  chatSetFieldValue('chat-cost-output-price',costPricing.outputPerMTokens);
  chatSetFieldValue('chat-cost-cache-read-price',costPricing.cacheReadPerMTokens);
  chatSetFieldValue('chat-cost-cache-create-price',costPricing.cacheCreatePerMTokens);
  chatSetFieldValue('chat-cost-multiplier',costPricing.multiplier);
  chatSyncCacheStrategyFields(true);
  chatSetFieldChecked('chat-full-window-context',cfg.fullWindowContext!==false);
  chatUpdateSplitReplyButton(cfg);
  if(document.getElementById('chat-worldbook-injection-position'))document.getElementById('chat-worldbook-injection-position').value=chatNormalizeInjectionPosition(cfg.worldbookInjectionPosition,'system_tail');
  chatToggleSettings(!!cfg.settingsOpen,true);
  chatSwitchSideTab(cfg.chatSideTab||'model',true);
  chatRenderWorldbooks(cfg);
  chatRenderMainRouteSummary();
  chatRenderTrimState(cfg);
  chatUpdateRuntime(cfg);
}
function chatSyncCacheStrategyFields(silent){
  var strategy=document.getElementById('chat-cache-strategy');
  var retention=document.getElementById('chat-recall-retention-seconds');
  if(!strategy||!retention){chatRenderCacheStrategyState();return}
  var meta=chatCacheStrategyMeta(strategy.value);
  strategy.value=meta.value;
  retention.value=String(meta.retentionSeconds);
  chatRenderCacheStrategyState();
  if(!silent)chatSaveCacheStrategy(true);
}
function chatSetCacheStrategy(value){
  var strategy=document.getElementById('chat-cache-strategy');
  if(!strategy)return;
  strategy.value=chatNormalizeCacheStrategy(value);
  chatSyncCacheStrategyFields(false);
  chatUpdateRuntime(chatLoadConfig());
}
function chatSaveCacheStrategy(auto){
  var strategy=document.getElementById('chat-cache-strategy');
  var meta=chatCacheStrategyMeta(strategy?strategy.value:'single_5m');
  if(strategy)strategy.value=meta.value;
  var retention=document.getElementById('chat-recall-retention-seconds');
  if(retention)retention.value=String(meta.retentionSeconds);
  var cfg=chatSaveConfig(true);
  chatRenderCacheStrategyState('已保存成功：'+meta.label+'｜发送：'+meta.debugText+'｜TTL：'+chatCacheStrategyTtlLabel(meta),'ok');
  if(!auto)toast('缓存模式已保存：'+meta.label);
  return cfg;
}
function chatSaveRecallSetting(auto){
  var cfg=chatSaveConfig(true);
  var meta=chatRecallMeta(cfg.recall!==false);
  chatRenderCacheStrategyState();
  chatRenderRecallState('已保存成功：'+meta.label+'｜'+meta.debugText,'ok');
  if(!auto)toast('记忆召回已保存：'+meta.label);
  return cfg;
}
function chatSetRecallEnabled(enabled,auto){
  var input=document.getElementById('chat-recall-enabled');
  if(input)input.checked=enabled!==false;
  return chatSaveRecallSetting(auto);
}
function chatSaveConfig(silent){
  var cfg=chatReadForm();
  chatSaveConfigObject(cfg);
  if(!apiProvidersLoaded&&String(cfg.panelKey||'').trim())loadApiProviders({silentAuth:true});
  chatRenderMainRouteSummary();
  chatRenderTrimState(cfg);
  chatUpdateSplitReplyButton(cfg);
  chatUpdateRuntime(cfg);
  chatRenderCacheStrategyState();
  chatRenderRecallState();
  chatRenderDebugRecords();
  if(!silent)toast('聊天配置已保存');
  return cfg;
}
function chatOnMcpToggle(){
  var cfg=chatReadForm();
  cfg.useMcp=cfg.useMcp===true;
  cfg.mcpUserSet=true;
  chatSaveConfigObject(cfg);
  chatUpdateRuntime(cfg);
  chatRenderDebugRecords();
}
function chatUpdateSplitReplyButton(cfg){
  var btn=document.getElementById('chat-split-replies-btn');
  if(!btn)return;
  cfg=cfg||chatLoadConfig();
  var on=cfg.splitAssistantReplies!==false;
  btn.classList.toggle('chat-toggle-on',on);
  btn.classList.toggle('chat-toggle-off',!on);
  btn.setAttribute('aria-pressed',on?'true':'false');
  btn.title='分条回复：'+(on?'开':'关');
  var label=btn.querySelector('b');
  if(label)label.textContent=on?'分条':'整段';
}
function chatToggleSplitReplies(){
  var cfg=chatMergeLiveToggleState(chatLoadConfig());
  cfg.splitAssistantReplies=cfg.splitAssistantReplies===false;
  chatSaveConfigObject(cfg);
  chatUpdateSplitReplyButton(cfg);
  toast('小克回复：'+(cfg.splitAssistantReplies!==false?'分条':'一段式'));
}
function chatEndpoint(cfg){
  var base=(cfg.gatewayUrl||GRAPH_API_BASE).trim().replace(/\/+$/,'');
  if(/\/ck\/chat$/.test(base))return base;
  return base+'/ck/chat';
}
function chatDebugEndpoint(cfg){
  var base=(cfg.gatewayUrl||GRAPH_API_BASE).trim().replace(/\/+$/,'');
  if(/\/ck\/chat$/.test(base))base=base.replace(/\/ck\/chat$/,'');
  return base+'/ck/debug';
}
function chatWorldbooksEndpoint(cfg){
  var base=(cfg.gatewayUrl||GRAPH_API_BASE).trim().replace(/\/+$/,'');
  if(/\/ck\/chat$/.test(base))base=base.replace(/\/ck\/chat$/,'');
  return base+'/ck/worldbooks';
}
function chatSetStatus(text){
  var el=document.getElementById('chat-status');
  if(!el)return;
  var waiting=/请求网关|正在请求|对方正在输入|等待回复|发送中/.test(String(text||''));
  el.innerHTML=waiting?'对方正在输入...':'<span class="chat-online-dot"></span>在线';
}
function chatWorldbookPack(cfg){
  cfg=cfg||chatLoadConfig();
  var books=chatNormalizeWorldbooks(cfg.worldbooks).filter(function(w){return w.enabled&&w.content.trim()});
  books.sort(function(a,b){return (a.priority||100)-(b.priority||100)||String(a.name).localeCompare(String(b.name))});
  if(!books.length)return '';
  return books.map(function(w,i){
    return '【世界书 '+(i+1)+'：'+w.name+'】\n'+w.content.trim();
  }).join('\n\n---\n\n');
}
function chatRenderWorldbooks(cfg){
  cfg=cfg||chatLoadConfig();
  var list=document.getElementById('chat-worldbook-list');
  var count=document.getElementById('chat-worldbook-count');
  if(!list)return;
  var books=chatNormalizeWorldbooks(cfg.worldbooks);
  if(!chatWorldbookActiveId&&books.length)chatWorldbookActiveId=books[0].id;
  if(chatWorldbookActiveId&&!books.some(function(w){return w.id===chatWorldbookActiveId}))chatWorldbookActiveId=books.length?books[0].id:'';
  var enabled=books.filter(function(w){return w.enabled&&w.content.trim()}).length;
  if(count)count.textContent=enabled+' 个启用';
  list.innerHTML=books.length?books.map(function(w){
    return '<button class="chat-worldbook-row '+(w.id===chatWorldbookActiveId?'active':'')+'" type="button" onclick="chatSelectWorldbook(\''+escAttr(w.id)+'\')"><span>'+esc(w.name||'未命名世界书')+'</span><small>'+(w.enabled?'启用':'停用')+' · 优先级 '+(w.priority||100)+'</small></button>';
  }).join(''):'<div class="chat-worldbook-empty">还没有世界书</div>';
  var active=books.find(function(w){return w.id===chatWorldbookActiveId})||null;
  var name=document.getElementById('chat-worldbook-name');
  var enabledInput=document.getElementById('chat-worldbook-enabled');
  var priority=document.getElementById('chat-worldbook-priority');
  var content=document.getElementById('chat-worldbook-content');
  if(name)name.value=active?active.name:'';
  if(enabledInput)enabledInput.checked=active?active.enabled:false;
  if(priority)priority.value=active?active.priority:100;
  if(content)content.value=active?active.content:'';
}
async function chatLoadWorldbooksRemote(silent){
  var cfg=chatLoadConfig();
  if(!cfg.panelKey){
    if(!silent)toast('先填写面板 Key 才能同步世界书');
    return false;
  }
  try{
    var resp=await fetch(chatWorldbooksEndpoint(cfg)+'?key='+encodeURIComponent(cfg.panelKey),{
      cache:'no-store',
      headers:{'x-api-key':cfg.panelKey}
    });
    if(!resp.ok)throw new Error('HTTP '+resp.status);
    var data=await resp.json();
    var remote=chatNormalizeWorldbooks(data.worldbooks);
    var local=chatNormalizeWorldbooks(cfg.worldbooks);
    if(!remote.length&&local.length){
      await chatSaveWorldbooksRemote(local,true);
      return true;
    }
    cfg.worldbooks=remote;
    chatSaveConfigObject(cfg);
    chatRenderWorldbooks(cfg);
    chatUpdateRuntime(cfg);
    if(!silent)toast('世界书已从网关同步');
    return true;
  }catch(e){
    if(!silent)toast('世界书同步失败：'+String((e&&e.message)||e));
    return false;
  }
}
async function chatSaveWorldbooksRemote(worldbooks,silent){
  var cfg=chatLoadConfig();
  cfg.worldbooks=chatNormalizeWorldbooks(worldbooks||cfg.worldbooks);
  chatSaveConfigObject(cfg);
  if(!cfg.panelKey){
    if(!silent)toast('已保存在本机；填写面板 Key 后可同步到 GitHub');
    return false;
  }
  try{
    var resp=await fetch(chatWorldbooksEndpoint(cfg)+'?key='+encodeURIComponent(cfg.panelKey),{
      method:'POST',
      headers:{'Content-Type':'application/json','x-api-key':cfg.panelKey},
      body:JSON.stringify({worldbooks:cfg.worldbooks})
    });
    var data=await resp.json().catch(function(){return {}});
    if(!resp.ok||data.ok===false)throw new Error(data.error||('HTTP '+resp.status));
    if(!silent)toast('世界书已保存到 GitHub');
    return true;
  }catch(e){
    if(!silent)toast('世界书保存到 GitHub 失败：'+String((e&&e.message)||e));
    return false;
  }
}
function chatSelectWorldbook(id){
  chatWorldbookActiveId=String(id||'');
  chatRenderWorldbooks();
}
function chatAddWorldbook(){
  var cfg=chatReadForm();
  var book={id:chatWorldbookId(),name:'新世界书',enabled:true,priority:100,content:''};
  cfg.worldbooks=chatNormalizeWorldbooks(cfg.worldbooks);
  cfg.worldbooks.push(book);
  chatWorldbookActiveId=book.id;
  chatSaveConfigObject(cfg);
  chatRenderWorldbooks(cfg);
  chatSaveWorldbooksRemote(cfg.worldbooks,true);
  toast('已新增世界书');
}
async function chatSaveWorldbook(){
  var cfg=chatReadForm();
  cfg.worldbooks=chatNormalizeWorldbooks(cfg.worldbooks);
  if(!chatWorldbookActiveId&&cfg.worldbooks.length)chatWorldbookActiveId=cfg.worldbooks[0].id;
  var book=cfg.worldbooks.find(function(w){return w.id===chatWorldbookActiveId});
  if(!book){
    book={id:chatWorldbookId(),name:'新世界书',enabled:true,priority:100,content:''};
    cfg.worldbooks.push(book);
    chatWorldbookActiveId=book.id;
  }
  book.name=(document.getElementById('chat-worldbook-name').value||'未命名世界书').trim().slice(0,40);
  book.enabled=document.getElementById('chat-worldbook-enabled').checked;
  book.priority=Number(document.getElementById('chat-worldbook-priority').value||100)||100;
  book.content=document.getElementById('chat-worldbook-content').value||'';
  chatSaveConfigObject(cfg);
  chatRenderWorldbooks(cfg);
  chatUpdateRuntime(cfg);
  await chatSaveWorldbooksRemote(cfg.worldbooks,false);
}
async function chatDeleteWorldbook(){
  if(!chatWorldbookActiveId)return;
  var cfg=chatReadForm();
  cfg.worldbooks=chatNormalizeWorldbooks(cfg.worldbooks).filter(function(w){return w.id!==chatWorldbookActiveId});
  chatWorldbookActiveId=cfg.worldbooks.length?cfg.worldbooks[0].id:'';
  chatSaveConfigObject(cfg);
  chatRenderWorldbooks(cfg);
  chatUpdateRuntime(cfg);
  await chatSaveWorldbooksRemote(cfg.worldbooks,false);
}
function chatDebugPrune(list){
  var cutoff=Date.now()-CHAT_DEBUG_TTL;
  return (Array.isArray(list)?list:[]).filter(function(x){return x&&Number(x.ts||0)>=cutoff}).slice(-500);
}
function chatLoadDebugRecords(){
  try{chatDebugRecords=chatDebugPrune(JSON.parse(localStorage.getItem(CHAT_DEBUG_KEY)||'[]'))}catch(e){chatDebugRecords=[]}
  chatRenderDebugRecords();
}
function chatSaveDebugRecords(){
  chatDebugRecords=chatDebugPrune(chatDebugRecords);
  if(chatStoreJson(CHAT_DEBUG_KEY,chatDebugRecords))return;
  chatDebugRecords=chatDebugRecords.slice(-80);
  chatStoreJson(CHAT_DEBUG_KEY,chatDebugRecords);
}
function chatDebugLine(record){
  var d=new Date(record.ts||Date.now());
  var tm=String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0')+':'+String(d.getSeconds()).padStart(2,'0');
  var text=record.text||'';
  if(record&&record.event&&record.event!=='gateway'&&record.data&&typeof record.data==='object'){
    try{text=chatFormatDebug(record.event,record.data)}catch(e){}
  }
  return '['+tm+'] '+text;
}
function chatDebugRecordKind(record,text){
  var ev=record&&record.event?String(record.event):'';
  text=String(text||'');
  if(ev==='usage'||text.indexOf('用量统计')>=0)return 'usage';
  if(ev==='done'||text.indexOf('请求完成')>=0)return 'done';
  if(text.indexOf('缓存诊断')>=0||text.indexOf('缓存读取')>=0||text.indexOf('缓存创建')>=0||text.indexOf('CACHE')>=0)return 'cache';
  if(ev==='error'||text.indexOf('请求错误')>=0)return 'error';
  return 'info';
}
function chatDecorateDebugBody(html,record){
  var amount=chatDebugRecordCostAmount(record);
  if(amount){
    var safeAmount=esc(amount);
    html=html.replace(safeAmount,'<strong class="chat-cost-amount">'+safeAmount+'</strong>');
  }
  html=html.replace(/(缓存读取[:：]\s*)([0-9][0-9,]*)/g,'$1<span class="chat-debug-cache-number">$2</span>');
  html=html.replace(/(缓存创建[:：]\s*)([0-9][0-9,]*)/g,'$1<span class="chat-debug-cache-number">$2</span>');
  html=html.replace(/(cache_read(?:_input)?_tokens[=:：]\s*)([0-9][0-9,]*)/gi,'$1<span class="chat-debug-cache-number">$2</span>');
  html=html.replace(/(cache_creation(?:_input)?_tokens[=:：]\s*)([0-9][0-9,]*)/gi,'$1<span class="chat-debug-cache-number">$2</span>');
  return html;
}
function chatDebugRecordHtml(record){
  var line=chatDebugLine(record);
  var m=line.match(/^\[([0-9:]+)\]\s*([\s\S]*)$/);
  var time=m?m[1]:'--:--:--';
  var body=m?m[2]:line;
  var kind=chatDebugRecordKind(record,body);
  var html=chatDecorateDebugBody(esc(body),record);
  return '<div class="chat-debug-record chat-debug-'+kind+'"><span class="chat-debug-time">['+esc(time)+']</span><div class="chat-debug-body">'+html+'</div></div>';
}
function chatRenderDebugRecords(){
  var el=document.getElementById('chat-debug');
  if(!el)return;
  chatDebugRecords=chatDebugPrune(chatDebugRecords);
  if(!chatDebugRecords.length){
    el.innerHTML='<div class="chat-debug-empty">暂无调试记录。这里会保留最近一天的聊天调试信息。</div>';
    chatScrollDebugBottom();
    return;
  }
  el.innerHTML=chatDebugRecords.map(chatDebugRecordHtml).join('');
  chatScrollDebugBottom();
}
function chatScrollDebugBottom(){
  var el=document.getElementById('chat-debug');
  if(!el)return;
  el.scrollTop=el.scrollHeight;
  setTimeout(function(){el.scrollTop=el.scrollHeight},0);
}
function chatFormatRecallDiag(data){
  data=data||{};
  var diag=(data.recall_diag&&typeof data.recall_diag==='object')?data.recall_diag:null;
  if(!diag)return '🧠 召回记忆｜本轮召回 '+(data.memory_chars||0)+' 字';
  var sources=(diag.sources&&typeof diag.sources==='object')?diag.sources:{};
  var hasSources=Object.keys(sources).length>0;
  if(!hasSources){
    return '🧠 召回记忆｜本轮召回 '+(data.memory_chars||diag.memory_chars||0)+' 字\n📦 拉取数量｜网关未返回明细，请上传带召回诊断的新网关代码。';
  }
  var final=(diag.final_injected&&typeof diag.final_injected==='object')?diag.final_injected:{};
  var phases=Array.isArray(diag.phases)?diag.phases:[];
  function sec(v){
    var n=Number(v||0);
    if(!isFinite(n))n=0;
    return n.toFixed(3)+'秒';
  }
  function src(key,title,unit){
    var item=(sources[key]&&typeof sources[key]==='object')?sources[key]:{};
    var count=item.count;
    if(count===undefined||count===null)count=item.total||0;
    return title+' '+count+(unit||'条')+'（'+(item.source||'未知')+'，'+sec(item.seconds)+'）';
  }
  var vec=(sources.entity_vectors&&typeof sources.entity_vectors==='object')?sources.entity_vectors:{};
  var phaseText=phases.filter(function(p){return p&&typeof p==='object'}).map(function(p){
    return String(p.name||'未知阶段')+' '+sec(p.seconds);
  }).join('｜')||'无';
  return '🧠 召回记忆｜本轮召回 '+(data.memory_chars||diag.memory_chars||0)+' 字｜总耗时 '+sec(diag.total_seconds)+'\n'
    +'📦 拉取数量｜'+src('embeddings','普通CK记忆')+'｜'+src('chatlog','chatlog索引')+'｜'+src('entity_profiles','小档案','个')+'｜小档案向量 '+(vec.items||0)+'项/'+(vec.relations||0)+'关系（'+(vec.source||'未知')+'，'+sec(vec.seconds)+'）\n'
    +'🎯 最终注入｜普通记忆 '+(final.memory||0)+' 条｜chatlog '+(final.chatlog||0)+' 条｜小档案 '+(final.entity||0)+' 条｜合计 '+(final.total||0)+' 条\n'
    +'⏱ 耗时明细｜'+phaseText+'\n'
    +'🧮 明细合计 '+sec(diag.phase_sum_seconds)+'｜实际总耗时 '+sec(diag.total_seconds);
}
function chatFormatDebug(ev,data){
  data=data||{};
  if(data&&data.mode==='new_session'){
    return '🆕 新会话｜会话：'+(data.session_id||'-')+'｜历史：空';
  }
  function anchorsZh(list){
    return (list||[]).map(function(x){
      return String(x).replace(/system/g,'系统').replace(/tools/g,'工具').replace(/messages/g,'消息').replace(/content/g,'内容');
    }).join('，');
  }
  function fingerprintZh(fp){
    if(!fp||typeof fp!=='object')return '';
    var cmp=(fp.compare_previous&&typeof fp.compare_previous==='object')?fp.compare_previous:{};
    var status=cmp.status==='same'?'前缀一致':(cmp.status==='partial'?'部分可复用':(cmp.status==='changed'?'前缀变化':'首次记录'));
    var changes=Array.isArray(cmp.changes)?cmp.changes:[];
    var stable=Array.isArray(cmp.stable_matches)?cmp.stable_matches:[];
    var changeText=changes.length?'｜变化：'+changes.slice(0,4).join('；'):'';
    var stableText=stable.length?'｜稳定：'+stable.slice(0,4).join('，'):'';
    var bps=Array.isArray(fp.breakpoint_summary)?fp.breakpoint_summary:[];
    var details=Array.isArray(fp.breakpoints)?fp.breakpoints:[];
    var sizes=details.map(function(x){
      return String(x.label||'-')+':'+(x.prefix_bytes||0)+'B/~'+(x.prefix_token_estimate||0)+'t';
    });
    var sizeText=sizes.length?'｜断点累计 '+sizes.slice(0,4).join('，'):'';
    return '｜'+status+stableText+changeText+'｜请求 '+(fp.request_hash||'-')+'/'+(fp.request_bytes||0)+'B｜断点 '+(bps.join('，')||'-')+sizeText;
  }
  if(ev==='meta'){
    var source=data.history_source||'';
    var sourceText=source.indexOf('client_transport:')===0?'面板隐藏缓存历史':(source.indexOf('client_window:')===0?'同窗口全量上下文':(source==='client_history'?'面板当前窗口':'网关会话'));
    var mcpCache=data.mcp_cache?('｜MCP缓存：'+data.mcp_cache+(data.mcp_cache_age_seconds?(' '+data.mcp_cache_age_seconds+'s'):'')):'';
    var requestTools=data.mcp_tools_in_request;
    var requestToolsText=requestTools!==undefined?('｜本轮上游tools：'+(requestTools||0)):'';
    var mcpText=data.mcp_enabled?('｜MCP：'+(data.mcp_source||'unknown')+' '+(data.mcp_tools||0)+' 个工具'+requestToolsText+mcpCache):'｜MCP：关闭';
    var windowText=data.window_history_supplied?('｜窗口历史：'+(data.window_history_messages||0)+' 条'):'';
    var strategy=data.effective_cache_strategy||data.cache_strategy||'single_5m';
    var strategyMeta=chatCacheStrategyMeta(strategy);
    var ttl=data.prompt_cache_ttl||data.cache_control_ttl||chatCacheStrategyTtlLabel(strategyMeta);
    var strategyText=strategyMeta.label+'｜发送：'+strategyMeta.debugText+'｜TTL：'+ttl;
    var recallMeta=chatRecallMeta(data.recall_enabled!==false);
    var injectText=data.gateway_context_injected===true
      ? ('｜本轮注入：'+(data.gateway_context_chars||0)+'字')
      : (data.gateway_context_injected===false?'｜本轮无召回注入':'');
    var recallText='｜记忆召回：'+recallMeta.label+injectText;
    var cleanText=data.strip_old_recall?('｜清旧历史：'+(data.stripped_gateway_context_messages||0)+'条/'+(data.stripped_gateway_context_chars||0)+'字｜旧图片：'+(data.stripped_old_image_blocks||0)):'';
    var idleText=data.idle_seconds!==undefined?('｜空闲：'+data.idle_seconds+'s｜旧召回保留：'+(data.recall_history_retention_seconds||0)+'s'):'';
    var thinkingText=data.ck_thinking_enabled?('｜思考链：开 '+(data.ck_thinking_prompt_chars||0)+'字'):'｜思考链：关';
    var injectionText=data.injection_positions?('｜注入：世界书 '+(data.injection_positions.worldbook||'-')+' / 思考链 '+(data.injection_positions.thinking||'-')):'';
    var targetText=data.reply_target_chars!==undefined?('｜回复目标：最新 '+(data.reply_target_chars||0)+'字'):'';
    return '🧭 请求信息｜会话：'+(data.session_id||'-')+'｜模型：'+(data.model||'-')+'｜历史来源：'+sourceText+'｜历史条数：'+(data.history_messages||0)+windowText+'｜首条锚点：'+(data.session_anchor_chars||0)+' 字｜世界书：'+(data.worldbook_chars||0)+' 字'+thinkingText+injectionText+targetText+recallText+'｜缓存策略：'+strategyText+idleText+cleanText+mcpText;
  }
  if(ev==='memory'){
    return chatFormatRecallDiag(data);
  }
  if(ev==='usage'){
    var read=chatUsageCacheRead(data);
    var create=chatUsageCacheCreate(data);
    var rounds=data.upstream_rounds?('｜上游轮次：'+data.upstream_rounds+'｜命中轮次：'+(data.cache_hit_rounds||0)):'';
    return '📊 用量统计｜缓存读取：'+read+'｜缓存创建：'+create+'｜输入：'+(data.input_tokens||0)+'｜输出：'+(data.output_tokens||0)+rounds;
  }
  if(ev==='done'){
    var u=data.usage||{};
    var doneRounds=data.upstream_rounds?('｜上游轮次：'+data.upstream_rounds+'｜命中轮次：'+(data.cache_hit_rounds||0)):'';
    var doneCostText=chatFormatUsageCost(u);
    return '✅ 请求完成｜会话：'+(data.session_id||'-')+'｜助手回复 '+(data.assistant_chars||0)+' 字'+(doneCostText?'｜'+doneCostText:'')+'｜缓存读取：'+chatUsageCacheRead(u)+'｜缓存创建：'+chatUsageCacheCreate(u)+doneRounds+'｜隐藏历史：'+(data.transport_messages_count||0)+' 条/'+(data.transport_messages_bytes||0)+' B';
  }
  if(ev==='error'){
    return '❌ 请求错误｜'+(data.error||data.message||JSON.stringify(data));
  }
  if(ev==='tool'){
    var status=chatToolStatusLabel(data.status,data.is_error);
    var sec=data.seconds!==undefined?('｜耗时：'+Number(data.seconds||0).toFixed(2)+'s'):'';
    var chars=data.result_chars?('｜结果：'+data.result_chars+'字'):'';
    return '🛠 工具调用｜'+(data.name||'未知工具')+'｜'+status+'｜来源：'+(data.source||'internal')+sec+chars;
  }
  if(ev==='debug'){
    if(data.mcp_error){
      return '⚠️ MCP异常｜'+(data.mcp_source||'-')+'｜'+(data.mcp_host||'-')+'｜'+data.mcp_error;
    }
    if(data.cache_anchors||data.canonical_changes){
      var changes=(data.canonical_changes||[]).join('；')||'无';
      changes=changes.replace(/canonical inject: session=/g,'会话=').replace(/ users=/g,'｜用户消息数=').replace(/ restored_past=/g,'｜已恢复旧消息=');
      var diagMeta=data.cache_strategy?chatCacheStrategyMeta(data.cache_strategy):null;
      var diagMode=diagMeta?('｜模式：'+diagMeta.label+'｜发送：'+diagMeta.debugText+'｜TTL：'+(data.prompt_cache_ttl||chatCacheStrategyTtlLabel(diagMeta))):'';
      var diagRecall=data.recall_enabled===false?'｜召回关闭':(data.gateway_context_injected?'｜召回已注入':'｜无召回注入');
      return '🧊 缓存诊断'+diagMode+diagRecall+'｜锚点：'+anchorsZh(data.cache_anchors)+'｜'+changes+'｜请求消息数：'+(data.request_messages||0)+'｜第 '+(data.round||1)+' 轮'+fingerprintZh(data.cache_fingerprint);
    }
    if(data.recall_query||data.memory_chars!==undefined){
      return chatFormatRecallDiag(data)+'\n🔎 召回查询｜'+String(data.recall_query||'').slice(0,180);
    }
    if(data.recall_error){
      return '⚠️ 召回异常｜'+data.recall_error;
    }
    return '🔎 调试信息｜'+JSON.stringify(data);
  }
  return '🔎 调试信息｜'+(typeof data==='string'?data:JSON.stringify(data));
}
function chatDebugSafeData(ev,data){
  if(!data||typeof data!=='object')return data||{};
  if(ev==='done'){
    return {
      session_id:data.session_id||'',
      assistant_chars:data.assistant_chars||0,
      usage:data.usage||{},
      transport_messages_count:data.transport_messages_count||0,
      transport_messages_bytes:data.transport_messages_bytes||0
    };
  }
  if(ev==='memory'){
    return {
      memory_chars:data.memory_chars||0,
      recall_diag:data.recall_diag||{},
      has_memory:!!(data.memory_chars||data.memory_pack||data.memory_preview)
    };
  }
  if(ev==='debug'&&(data.memory_pack!==undefined||data.memory_preview!==undefined)){
    var copy={};
    Object.keys(data).forEach(function(k){
      if(k!=='memory_pack'&&k!=='memory_preview')copy[k]=data[k];
    });
    return copy;
  }
  try{return JSON.parse(JSON.stringify(data));}catch(e){return {value:String(data)}}
}
function chatDebug(ev,data){
  if(arguments.length===1){data=ev;ev='debug'}
  var record={ts:Date.now(),event:ev||'debug',text:chatFormatDebug(ev,data),data:chatDebugSafeData(ev,data)};
  chatDebugRecords.push(record);
  chatSaveDebugRecords();
  chatRenderDebugRecords();
}
function chatClearDebug(){
  chatDebugRecords=[];
  try{localStorage.removeItem(CHAT_DEBUG_KEY)}catch(e){}
  chatRenderDebugRecords();
}
async function chatRefreshGatewayDebug(){
  var cfg=chatLoadConfig();
  var url=chatDebugEndpoint(cfg)+'?key='+encodeURIComponent(cfg.panelKey||'')+'&session_id='+encodeURIComponent(cfg.sessionId||'');
  try{
    var resp=await fetch(url,{cache:'no-store'});
    if(!resp.ok)throw new Error('HTTP '+resp.status);
    var data=await resp.json();
    var records=Array.isArray(data.records)?data.records:[];
    records.forEach(function(r){
      chatDebugRecords.push({ts:Number(r.ts_ms||Date.now()),event:r.event||'gateway',text:'🗂 网关记录｜'+(r.text||JSON.stringify(r.data||{})),data:r});
    });
    chatSaveDebugRecords();
    chatRenderDebugRecords();
    toast('已刷新网关调试记录');
  }catch(e){
    chatDebug('error',{error:'刷新网关调试失败：'+String((e&&e.message)||e)});
  }
}
function chatFriendlyError(err){
  var msg=String((err&&err.message)||err||'请求失败');
  var parsed=null;
  var jsonStart=msg.indexOf('{');
  if(jsonStart>=0){
    try{parsed=JSON.parse(msg.slice(jsonStart))}catch(e){}
  }
  var upstream=(parsed&&parsed.error&&(parsed.error.message||parsed.error.type))||'';
  if(/Insufficient account balance/i.test(msg)||/Insufficient account balance/i.test(upstream)){
    return '请求失败：上游模型账号余额不足。请检查 API 配置 -> 主链路里的供应商账号额度，或更换有额度的 API Key。';
  }
  if(/Upstream HTTP 401|unauthorized|invalid api key/i.test(msg)){
    return '请求失败：上游模型 API Key 无效或没有权限。请检查 API 配置 -> 主链路里的 API Key。';
  }
  if(/Upstream HTTP 403/i.test(msg)){
    return '请求失败：上游模型服务拒绝了请求。请检查 API 配置 -> 主链路里的供应商、模型、API Key 和 API URL。' + (upstream?('\n'+upstream):'');
  }
  return '请求失败：'+msg;
}
function chatShortSession(id){
  id=String(id||'');
  return id.length>12?id.slice(0,8)+'...'+id.slice(-4):id;
}
function chatTimeLabel(ts){
  if(!ts)return'';
  var d=new Date(ts),now=new Date();
  var same=d.toDateString()===now.toDateString();
  var hm=String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0');
  return same?hm:(String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0')+' '+hm);
}
function chatFullTimeLabel(ts){
  var d=new Date(ts||Date.now());
  return String(d.getFullYear())+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0')+' '+String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0');
}
function chatUpdateRuntime(cfg,usage){
  cfg=cfg||chatLoadConfig();
  var model=document.getElementById('chat-runtime-model');
  var cache=document.getElementById('chat-runtime-cache');
  var recall=document.getElementById('chat-runtime-recall');
  var route=apiProvidersLoaded?chatMainRouteConfig():null;
  if(model){
    if(route&&route.ok)model.textContent=route.providerName+' · '+route.model+' · '+chatShortSession(cfg.sessionId);
    else if(!apiProvidersLoaded)model.textContent='主链路读取中 · '+chatShortSession(cfg.sessionId);
    else model.textContent='主链路未配置 · '+chatShortSession(cfg.sessionId);
  }
  if(recall){
    var recallMeta=chatRecallMeta(cfg.recall!==false);
    recall.textContent=recallMeta.label+(cfg.useMcp===true?' · MCP':'');
  }
  if(cache){
    var read=chatUsageCacheRead(usage||{});
    var create=chatUsageCacheCreate(usage||{});
    var meta=chatCacheStrategyMeta(cfg.cacheStrategy);
    var modeText=meta.label+'｜'+meta.debugText+'｜TTL '+chatCacheStrategyTtlLabel(meta);
    if(read||create)cache.textContent=modeText+'｜读取 '+read+' / 创建 '+create;
    else cache.textContent=modeText;
  }
}
function chatRenderTrimState(cfg){
  var current=document.getElementById('chat-trim-current');
  var next=document.getElementById('chat-trim-next');
  if(!current&&!next)return;
  var trim=chatAutoTrimConfigFrom(cfg||chatLoadConfig());
  var count=chatAutoTrimRoundCount(chatMessages);
  if(current)current.textContent='当前 '+count+' 轮';
  if(!next)return;
  if(!trim.enabled){
    next.textContent='自动截断已关闭。';
  }else if(count>trim.threshold){
    next.textContent='下一次发送前会删除最早 '+Math.min(trim.drop,Math.max(0,count-1))+' 轮。';
  }else{
    next.textContent='超过 '+trim.threshold+' 轮后删除最早 '+trim.drop+' 轮。';
  }
}
function chatNowTitle(){
  var d=new Date();
  return '新对话 '+String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0');
}
function chatTitleDate(ts){
  var d=new Date(ts||Date.now());
  return d.getFullYear()+'-'+(d.getMonth()+1)+'-'+d.getDate();
}
function chatCircledNumber(n){
  var nums=['','①','②','③','④','⑤','⑥','⑦','⑧','⑨','⑩','⑪','⑫','⑬','⑭','⑮','⑯','⑰','⑱','⑲','⑳'];
  return nums[n]||String(n);
}
function chatCircledValue(ch){
  var nums={'①':1,'②':2,'③':3,'④':4,'⑤':5,'⑥':6,'⑦':7,'⑧':8,'⑨':9,'⑩':10,'⑪':11,'⑫':12,'⑬':13,'⑭':14,'⑮':15,'⑯':16,'⑰':17,'⑱':18,'⑲':19,'⑳':20};
  return nums[ch]||0;
}
function chatDefaultWindowTitle(){
  var day=chatTitleDate(Date.now());
  var max=0;
  (chatSessions||[]).forEach(function(s){
    var title=String((s&&s.title)||'');
    if(title.indexOf('号窗口'+day)<0)return;
    var m=title.match(/^([①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳]|\d+)号窗口/);
    if(!m)return;
    var n=/^\d+$/.test(m[1])?Number(m[1]):chatCircledValue(m[1]);
    if(n>max)max=n;
  });
  if(!max){
    max=(chatSessions||[]).filter(function(s){return chatTitleDate((s&&s.created)||0)===day}).length;
  }
  return chatCircledNumber(max+1)+'号窗口'+day;
}
function chatLoadSessions(){
  if(chatSessionsLoadedFromIndexedDb){
    var loadedCfg=chatLoadConfig();
    chatActiveSessionId=loadedCfg.sessionId||chatActiveSessionId;
    if(!chatSessions.some(function(s){return s.id===chatActiveSessionId})){
      chatActiveSessionId=(chatSessions[0]&&chatSessions[0].id)||chatSessionId();
      loadedCfg.sessionId=chatActiveSessionId;
      chatSaveConfigObject(loadedCfg);
    }
    return;
  }
  try{
    var raw=localStorage.getItem(CHAT_MESSAGES_KEY);
    chatSessions=raw?JSON.parse(raw):[];
    if(chatSessions&&!Array.isArray(chatSessions)&&chatSessions.id)chatSessions=[chatSessions];
    if(!Array.isArray(chatSessions))chatSessions=[];
    chatSessions=chatSessions.map(chatNormalizeSession);
  }catch(e){chatSessions=[]}
  var cfg=chatLoadConfig();
  chatActiveSessionId=cfg.sessionId||chatActiveSessionId;
  if(!chatSessions.length){
    chatActiveSessionId=chatActiveSessionId||chatSessionId();
    chatSessions=[{id:chatActiveSessionId,title:chatDefaultWindowTitle(),messages:[],transportMessages:[],firstUserText:'',firstUserTs:0,created:Date.now(),updated:Date.now()}];
  }
  if(!chatSessions.some(function(s){return s.id===chatActiveSessionId}))chatActiveSessionId=chatSessions[0].id;
  cfg.sessionId=chatActiveSessionId;
  chatSaveConfigObject(cfg);
  chatStartIndexedDbSessionLoad();
}
function chatSessionStorageData(maxSessions,maxVisible,maxTransport){
  return chatSessions.slice(0,maxSessions).map(function(s){
    s=chatNormalizeSession(s);
    return {
      id:s.id,
      title:s.title,
      created:s.created,
      updated:s.updated,
      messages:chatLimitArray(s.messages,maxVisible),
      transportMessages:chatLimitArray(s.transportMessages,maxTransport),
      transportUpdated:Number(s.transportUpdated||0)||0,
      firstUserText:String(s.firstUserText||'').slice(0,3000),
      firstUserTs:s.firstUserTs||0
    };
  });
}
function chatSaveSessions(){
  var fullData=chatSessionStorageData(CHAT_MAX_SESSIONS,CHAT_MAX_VISIBLE_MESSAGES,CHAT_MAX_TRANSPORT_MESSAGES);
  chatSaveSessionsToIndexedDb(fullData);
  var visibleLimit=(chatIndexedDbSupported()&&!chatIndexedDbFailed)?CHAT_LOCAL_SUMMARY_VISIBLE_MESSAGES:CHAT_MAX_VISIBLE_MESSAGES;
  var transportLimit=(chatIndexedDbSupported()&&!chatIndexedDbFailed)?CHAT_LOCAL_SUMMARY_TRANSPORT_MESSAGES:CHAT_MAX_TRANSPORT_MESSAGES;
  var data=chatSessionStorageData(CHAT_MAX_SESSIONS,visibleLimit,transportLimit);
  if(chatStoreJson(CHAT_MESSAGES_KEY,data))return;
  chatDebugRecords=[];
  try{localStorage.removeItem(CHAT_DEBUG_KEY)}catch(e){}
  if(chatStoreJson(CHAT_MESSAGES_KEY,data))return;
  data=chatSessionStorageData(30,30,10);
  if(chatStoreJson(CHAT_MESSAGES_KEY,data))return;
  data=chatSessionStorageData(20,10,0);
  chatStoreJson(CHAT_MESSAGES_KEY,data);
}
function chatStartIndexedDbSessionLoad(){
  if(!chatIndexedDbSupported()||chatIndexedDbFailed)return Promise.resolve(chatSessions);
  if(chatSessionsLoadPromise)return chatSessionsLoadPromise;
  var localSnapshot=(chatSessions||[]).map(chatNormalizeSession);
  chatSessionsLoadPromise=chatLoadSessionsFromIndexedDb().then(function(stored){
    chatSessionsLoadedFromIndexedDb=true;
    if(stored&&stored.length){
      var pending=(chatMessages||[]).filter(function(m){return m&&m.role==='pending_user'});
      chatSessions=stored;
      var cfg=chatLoadConfig();
      chatActiveSessionId=cfg.sessionId||chatActiveSessionId;
      if(!chatSessions.some(function(s){return s.id===chatActiveSessionId})){
        chatActiveSessionId=(chatSessions[0]&&chatSessions[0].id)||chatSessionId();
        cfg.sessionId=chatActiveSessionId;
        chatSaveConfigObject(cfg);
      }
      chatMessages=chatCurrentSession().messages||[];
      pending.forEach(function(m){
        var exists=chatMessages.some(function(x){
          return x&&x.role===m.role&&x.ts===m.ts&&x.text===m.text&&JSON.stringify(chatMessageImages(x))===JSON.stringify(chatMessageImages(m));
        });
        if(!exists)chatMessages.push(m);
      });
      chatSaveSessions();
      if(chatInitialized){
        chatRenderSessions();
        chatRenderMessages();
        chatUpdateRuntime(cfg);
      }
      return chatSessions;
    }
    if(localSnapshot.length){
      chatSessions=localSnapshot;
      chatSaveSessionsToIndexedDb(chatSessionStorageData(CHAT_MAX_SESSIONS,CHAT_MAX_VISIBLE_MESSAGES,CHAT_MAX_TRANSPORT_MESSAGES));
    }
    return chatSessions;
  }).catch(function(e){
    chatIndexedDbFailed=true;
    if(window.console&&console.warn)console.warn('[CK chat] IndexedDB load failed:',e);
    return chatSessions;
  });
  return chatSessionsLoadPromise;
}
function chatEnsureSessionsReady(){
  return chatStartIndexedDbSessionLoad();
}
function chatCurrentSession(){
  var s=chatSessions.find(function(x){return x.id===chatActiveSessionId});
  if(!s){
    s={id:chatActiveSessionId||chatSessionId(),title:chatDefaultWindowTitle(),messages:[],transportMessages:[],firstUserText:'',firstUserTs:0,created:Date.now(),updated:Date.now()};
    chatActiveSessionId=s.id;
    chatSessions.unshift(s);
  }
  return s;
}
function chatEnsureSessionAnchor(fallbackText){
  var s=chatCurrentSession();
  if(s.firstUserText)return s.firstUserText;
  var first=(s.messages||chatMessages||[]).find(function(m){
    return m&&m.role==='user'&&chatMessageHasContent(m);
  });
  var text=first?chatMessageDisplayText(first):String(fallbackText||'').trim();
  if(!text)return '';
  s.firstUserText=text.slice(0,3000);
  s.firstUserTs=(first&&first.ts)||Date.now();
  chatSaveSessions();
  return s.firstUserText;
}
function chatSessionPreview(s){
  var m=(s.messages||[]).slice().reverse().find(function(x){return x&&x.role!=='system'&&chatMessageHasContent(x)});
  return m?chatMessageDisplayText(m).replace(/\s+/g,' ').slice(0,54):'还没有消息';
}
function chatSessionMeta(s){
  var n=(s.messages||[]).filter(function(m){return m.role==='user'}).length;
  return (n?n+' 轮':'新会话')+(s.updated?' · '+chatTimeLabel(s.updated):'');
}
function chatRenderSessions(){
  var list=document.getElementById('chat-session-list');
  var count=document.getElementById('chat-session-count');
  if(count)count.textContent=String(chatSessions.length);
  if(!list)return;
  chatSessions.sort(function(a,b){return (b.updated||0)-(a.updated||0)});
  list.innerHTML=chatSessions.map(function(s){
    return '<div class="chat-session-row '+(s.id===chatActiveSessionId?'active':'')+'"><button class="chat-session-item" type="button" onclick="chatSelectSession(\''+escAttr(s.id)+'\')"><i></i><span>'+esc(s.title||'未命名对话')+'</span><small>'+esc(chatSessionPreview(s))+'</small><em>'+esc(chatSessionMeta(s))+'</em></button><button class="chat-session-del" type="button" onclick="chatDeleteSession(\''+escAttr(s.id)+'\',event)" title="删除对话">×</button></div>';
  }).join('');
}
function chatDeleteSession(id,event){
  if(event){
    event.preventDefault();
    event.stopPropagation();
  }
  if(chatSending)return;
  chatDeletedSessionIds[id]=true;
  var s=chatSessions.find(function(x){return x.id===id});
  var title=(s&&s.title)||'这个对话';
  if(!confirm('删除“'+title+'”？'))return;
  chatSessions=chatSessions.filter(function(x){return x.id!==id});
  if(!chatSessions.length){
    var newId=chatSessionId();
    chatSessions=[{id:newId,title:chatNowTitle(),messages:[],transportMessages:[],firstUserText:'',firstUserTs:0,created:Date.now(),updated:Date.now()}];
    chatActiveSessionId=newId;
  }else if(chatActiveSessionId===id){
    chatSessions.sort(function(a,b){return (b.updated||0)-(a.updated||0)});
    chatActiveSessionId=chatSessions[0].id;
  }
  var cfg=chatLoadConfig();
  cfg.sessionId=chatActiveSessionId;
  cfg.memoryPreview='';
  chatSaveConfigObject(cfg);
  chatMessages=chatCurrentSession().messages||[];
  var sessionInput=document.getElementById('chat-session-id');
  if(sessionInput)sessionInput.value=chatActiveSessionId;
  var memoryPack=document.getElementById('chat-memory-pack');
  if(memoryPack)memoryPack.value='';
  chatSaveSessions();
  chatRenderSessions();
  chatRenderMessages();
  chatUpdateRuntime(cfg);
  chatSetStatus('对话已删除');
}
function chatSelectSession(id){
  if(chatSending)return;
  chatActiveSessionId=id;
  var cfg=chatLoadConfig();
  cfg.sessionId=id;
  chatSaveConfigObject(cfg);
  chatWriteForm(cfg);
  chatMessages=chatCurrentSession().messages||[];
  chatRenderSessions();
  chatRenderMessages();
  chatUpdateRuntime(cfg);
  chatSetStatus('已切换对话');
  chatToggleSessions(false,true);
}
function chatLoadLocalMessages(){
  chatLoadSessions();
  chatMessages=chatCurrentSession().messages||[];
}
function chatRefreshView(){
  if(chatSending){
    toast('正在请求中，先停止或等完成');
    return;
  }
  var refreshBtn=document.getElementById('chat-refresh-btn');
  if(refreshBtn)refreshBtn.classList.add('is-spinning');
  chatSetStatus('正在刷新...');
  var cfg=chatLoadConfig();
  chatLoadSessions();
  if(cfg.sessionId&&chatSessions.some(function(s){return s.id===cfg.sessionId})){
    chatActiveSessionId=cfg.sessionId;
  }else{
    chatActiveSessionId=(chatSessions[0]&&chatSessions[0].id)||chatSessionId();
    cfg.sessionId=chatActiveSessionId;
    chatSaveConfigObject(cfg);
  }
  chatMessages=chatCurrentSession().messages||[];
  chatLoadDebugRecords();
  chatWriteForm(cfg);
  chatRenderSessions();
  chatRenderMessages();
  chatLayoutCompose();
  chatUpdateRuntime(cfg);
  setTimeout(function(){
    if(refreshBtn)refreshBtn.classList.remove('is-spinning');
    chatSetStatus('已刷新');
    toast('聊天界面已刷新');
  },260);
}
function chatSaveLocalMessages(){
  var s=chatCurrentSession();
  s.messages=chatLimitArray(chatMessages,CHAT_MAX_VISIBLE_MESSAGES);
  s.updated=Date.now();
  chatSaveSessions();
  chatRenderSessions();
  chatRenderTrimState();
}
function chatIsAutoTrimTurn(m){
  if(!m||typeof m!=='object')return false;
  if(m.role!=='user'&&m.role!=='pending_user')return false;
  return chatMessageHasContent(m);
}
function chatAutoTrimRoundCount(list){
  return (Array.isArray(list)?list:[]).filter(chatIsAutoTrimTurn).length;
}
function chatDropFirstAutoTrimRounds(list,drop){
  list=Array.isArray(list)?list:[];
  drop=Math.max(0,Math.floor(Number(drop)||0));
  if(!drop)return list.slice();
  var dropped=0;
  for(var i=0;i<list.length;i++){
    if(chatIsAutoTrimTurn(list[i])){
      dropped++;
      if(dropped>drop)return list.slice(i);
    }
  }
  return list.length?list.slice(-1):[];
}
function chatResetSessionAnchorFromMessages(s){
  s=s||chatCurrentSession();
  var first=(s.messages||[]).find(function(m){
    return m&&(m.role==='user'||m.role==='pending_user')&&chatMessageHasContent(m);
  });
  if(first){
    s.firstUserText=chatMessageDisplayText(first).slice(0,3000);
    s.firstUserTs=Number(first.ts||0)||Date.now();
  }else{
    s.firstUserText='';
    s.firstUserTs=0;
  }
}
function chatApplyAutoTrimBeforeRequest(cfg){
  var trim=chatAutoTrimConfigFrom(cfg||chatLoadConfig());
  var before=chatAutoTrimRoundCount(chatMessages);
  if(!trim.enabled||before<=trim.threshold){
    chatRenderTrimState(cfg);
    return {trimmed:false,before:before,after:before,dropped:0};
  }
  var drop=Math.min(trim.drop,Math.max(0,before-1));
  if(drop<=0)return {trimmed:false,before:before,after:before,dropped:0};
  var s=chatCurrentSession();
  var oldTransport=(s.transportMessages||[]).length;
  chatMessages=chatDropFirstAutoTrimRounds(chatMessages,drop);
  var after=chatAutoTrimRoundCount(chatMessages);
  s.messages=chatMessages;
  s.transportMessages=[];
  s.transportUpdated=0;
  chatResetSessionAnchorFromMessages(s);
  s.updated=Date.now();
  chatSaveSessions();
  chatRenderSessions();
  chatRenderTrimState(cfg);
  return {trimmed:true,before:before,after:after,dropped:before-after,transportCleared:oldTransport};
}
function chatWindowContextMessages(){
  return (chatMessages||[]).filter(function(m){
    if(!m||typeof m!=='object')return false;
    if(m.role!=='user'&&m.role!=='assistant')return false;
    return chatMessageHasContent(m);
  }).map(function(m){
    var item={
      role:m.role,
      text:String(m.text||''),
      ts:m.ts||0
    };
    var content=chatMessageContentParts(m);
    if(content.length)item.content=content;
    return item;
  });
}
function chatPendingMessages(){
  return chatMessages.filter(function(m){return m&&m.role==='pending_user'&&chatMessageHasContent(m)});
}
function chatRenderPendingBar(){
  var bar=document.getElementById('chat-pending-bar');
  if(!bar)return;
  bar.classList.remove('show');
  bar.innerHTML='';
}
function chatStageUserMessage(text,images){
  text=String(text||'').trim();
  images=chatNormalizeImageList(images);
  if(!text&&!images.length)return;
  var msg={role:'pending_user',text:text,images:images,ts:Date.now()};
  chatMessages.push(msg);
  chatMarkMessageFresh(msg);
  chatSaveLocalMessages();
  chatRenderMessages({smooth:true});
  chatRenderPendingBar();
  chatSetStatus();
}
function chatClearPendingMessages(){
  chatMessages=chatMessages.filter(function(m){return !(m&&m.role==='pending_user')});
  chatSaveLocalMessages();
  chatRenderMessages();
  chatRenderPendingBar();
}
function chatRefocusChatInput(){
  var input=document.getElementById('chat-input');
  if(!input)return;
  try{input.focus({preventScroll:true})}catch(e){input.focus()}
}
function chatVisualKeyboardOpen(){
  var vv=window.visualViewport;
  if(!vv||!window.innerHeight)return false;
  return (window.innerHeight-vv.height)>90;
}
function chatMaybeRecoverInputFocus(){
  var input=document.getElementById('chat-input');
  if(!input||document.activeElement===input)return;
  if(currentPanelTab!=='chat'||chatSending||chatEditingIndex>=0)return;
  if(!chatVisualKeyboardOpen())return;
  if(Date.now()-chatLastInputAt>5000)return;
  if(Date.now()-chatLastPointerOutsideInputAt<900)return;
  if(document.querySelector('.chat-settings.open')||document.querySelector('.chat-shell.chat-sessions-open'))return;
  chatInputFocused=true;
  chatRefocusChatInput();
  chatKeepLatestVisible({soft:true});
}
function chatTrackPointerIntent(e){
  if(currentPanelTab!=='chat'||!e||!e.target)return;
  var input=document.getElementById('chat-input');
  if(!input||e.target===input)return;
  if(input.contains&&input.contains(e.target))return;
  chatLastPointerOutsideInputAt=Date.now();
}
function chatKeepLatestVisible(opts){
  opts=opts||{};
  chatLayoutCompose();
  chatScrollMessagesBottom(true);
  if(opts.soft)return;
  [120,320,620].forEach(function(ms){
    setTimeout(function(){chatLayoutCompose();chatScrollMessagesBottom(true)},ms);
  });
}
function chatStoreDraftMessage(opts){
  if(chatSending||chatEditingIndex>=0)return;
  if(chatImageEncodingCount>0){
    toast('图片处理中');
    return;
  }
  var input=document.getElementById('chat-input');
  var text=(input&&input.value||'').trim();
  var images=chatTakeDraftImages();
  if(!text&&!images.length)return;
  input.value='';
  chatAutosizeInput(input);
  chatStageUserMessage(text,images);
  if(!opts||opts.keepFocus!==false){
    chatRefocusChatInput();
    chatKeepLatestVisible();
  }
}
function chatStartEditMessage(i){
  if(chatSending)return;
  var m=chatMessages[i];
  if(!m||m.role==='notice')return;
  var input=document.getElementById('chat-input');
  var btn=document.getElementById('chat-send-btn');
  if(!input)return;
  if(chatEditingIndex>=0)chatCancelEdit();
  chatEditingDraftText=String(input.value||'');
  chatEditingIndex=i;
  chatEditingImages=chatMessageImages(m);
  input.value=String(m.text||'');
  chatAutosizeInput(input);
  input.focus();
  if(btn){btn.textContent='✓';btn.title='保存编辑'}
  chatSetEditActionsVisible(true);
  chatRenderEditImages();
  chatSetStatus('编辑中');
  chatScrollMessagesBottom(true);
}
function chatSetEditActionsVisible(show){
  var actions=document.getElementById('chat-edit-actions');
  if(actions)actions.hidden=!show;
  document.body.classList.toggle('chat-editing',!!show);
}
function chatExitEditMode(){
  chatEditingIndex=-1;
  chatEditingDraftText='';
  chatEditingImages=[];
  var btn=document.getElementById('chat-send-btn');
  if(btn){btn.textContent='↑';btn.title='发送'}
  chatSetEditActionsVisible(false);
  chatRenderEditImages();
  chatSetStatus();
}
function chatCancelEdit(){
  if(chatEditingIndex<0)return false;
  var input=document.getElementById('chat-input');
  if(input){
    input.value=chatEditingDraftText||'';
    chatAutosizeInput(input);
  }
  chatExitEditMode();
  return true;
}
function chatSaveEditedMessage(){
  var input=document.getElementById('chat-input');
  if(chatEditingIndex<0||!input)return false;
  if(chatImageEncodingCount>0){
    toast('图片处理中');
    return false;
  }
  var m=chatMessages[chatEditingIndex];
  if(!m)return false;
  var text=String(input.value||'').trim();
  var images=chatNormalizeImageList(chatEditingImages);
  if(!text&&!images.length){
    toast('消息不能为空');
    return false;
  }
  var prepared=chatPrepareMessageVersions(m);
  var newVersion={text:text,images:chatCloneImageListForVersion(images),ts:Date.now()};
  if(!chatMessageVersionEqual(prepared.versions[prepared.index],newVersion)){
    prepared.versions.push(newVersion);
    prepared.index=prepared.versions.length-1;
  }
  chatApplyMessageVersion(m,prepared.versions,prepared.index);
  m.updated=Date.now();
  chatResetUserMessageCacheState(m);
  input.value='';
  chatAutosizeInput(input);
  chatExitEditMode();
  chatSaveLocalMessages();
  chatRenderMessages();
  toast('已保存编辑');
  return true;
}
/* ===== 聊天增强：Markdown 渲染（防 XSS）/ 复制 / 停止 ===== */
function chatEsc(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]})}
function chatMdInline(raw){
  var codes=[];
  var t=String(raw==null?'':raw).replace(/`([^`]+)`/g,function(m,c){codes.push(c);return '@@CKCODE'+(codes.length-1)+'@@'});
  t=chatEsc(t);
  t=t.replace(/\*\*([^*]+)\*\*/g,'<strong>$1</strong>').replace(/__([^_]+)__/g,'<strong>$1</strong>');
  t=t.replace(/(^|[^*])\*([^*\n]+)\*/g,'$1<em>$2</em>');
  t=t.replace(/(^|[^_\w])_([^_\n]+)_/g,'$1<em>$2</em>');
  t=t.replace(/~~([^~]+)~~/g,'<del>$1</del>');
  t=t.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g,function(m,txt,url){if(!/^(https?:|mailto:)/i.test(url))return m;return '<a href="'+url+'" target="_blank" rel="noopener noreferrer">'+txt+'</a>'});
  t=t.replace(/@@CKCODE(\d+)@@/g,function(m,n){return '<code>'+chatEsc(codes[+n])+'</code>'});
  return t;
}
function chatCodeBlock(lang,code){
  var label=lang?chatEsc(lang):'code';
  return '<div class="cb"><div class="cb-head"><span class="cb-lang">'+label+'</span><button class="cb-copy" type="button">复制</button></div><pre><code>'+chatEsc(code)+'</code></pre></div>';
}
function chatSplitRow(line){return line.replace(/^\s*\|/,'').replace(/\|\s*$/,'').split('|').map(function(c){return c.trim()})}
function chatRenderMarkdown(src){
  var lines=String(src==null?'':src).replace(/\r\n/g,'\n').split('\n');
  var out=[],i=0,m;
  while(i<lines.length){
    var line=lines[i];
    m=line.match(/^```(.*)$/);
    if(m){var lang=m[1].trim(),code=[];i++;while(i<lines.length&&!/^```\s*$/.test(lines[i])){code.push(lines[i]);i++}i++;out.push(chatCodeBlock(lang,code.join('\n')));continue}
    if(/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)){out.push('<hr>');i++;continue}
    m=line.match(/^(#{1,6})\s+(.*)$/);
    if(m){var lv=m[1].length;out.push('<h'+lv+'>'+chatMdInline(m[2])+'</h'+lv+'>');i++;continue}
    if(/^\s*>\s?/.test(line)){var q=[];while(i<lines.length&&/^\s*>\s?/.test(lines[i])){q.push(lines[i].replace(/^\s*>\s?/,''));i++}out.push('<blockquote>'+chatRenderMarkdown(q.join('\n'))+'</blockquote>');continue}
    if(/\|/.test(line)&&i+1<lines.length&&/^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{1,}:?\s*)+\|?\s*$/.test(lines[i+1])){
      var header=chatSplitRow(line),j=i+2,rows=[];
      while(j<lines.length&&lines[j].indexOf('|')>=0&&lines[j].trim()!==''){rows.push(chatSplitRow(lines[j]));j++}
      var th='<table><thead><tr>'+header.map(function(c){return '<th>'+chatMdInline(c)+'</th>'}).join('')+'</tr></thead><tbody>';
      rows.forEach(function(r){th+='<tr>'+r.map(function(c){return '<td>'+chatMdInline(c)+'</td>'}).join('')+'</tr>'});
      out.push(th+'</tbody></table>');i=j;continue;
    }
    if(/^\s*([-*+]|\d+\.)\s+/.test(line)){
      var ordered=/^\s*\d+\.\s+/.test(line);var re=ordered?/^\s*\d+\.\s+(.*)$/:/^\s*[-*+]\s+(.*)$/;var items=[];
      while(i<lines.length&&re.test(lines[i])){items.push(lines[i].match(re)[1]);i++}
      var tag=ordered?'ol':'ul';out.push('<'+tag+'>'+items.map(function(it){return '<li>'+chatMdInline(it)+'</li>'}).join('')+'</'+tag+'>');continue;
    }
    if(/^\s*$/.test(line)){i++;continue}
    var p=[];while(i<lines.length&&!/^\s*$/.test(lines[i])&&!/^(#{1,6})\s/.test(lines[i])&&!/^```/.test(lines[i])&&!/^\s*>/.test(lines[i])&&!/^\s*([-*+]|\d+\.)\s+/.test(lines[i])){p.push(lines[i]);i++}
    out.push('<p>'+chatMdInline(p.join('\n')).replace(/\n/g,'<br>')+'</p>');
  }
  return out.join('\n');
}
var CHAT_THINKING_TAG_NAME='(?:ck_thinking|ck:thinking|thinking|think)';
var CHAT_THINKING_TAG_RE=new RegExp('<'+CHAT_THINKING_TAG_NAME+'\\b[^>]*>([\\s\\S]*?)<\\/(?:ck_thinking|ck:thinking|thinking|think)>','gi');
var CHAT_THINKING_OPEN_RE=new RegExp('<'+CHAT_THINKING_TAG_NAME+'\\b[^>]*>','i');
var CHAT_THINKING_OPEN_TO_END_RE=new RegExp('<'+CHAT_THINKING_TAG_NAME+'\\b[^>]*>[\\s\\S]*$','i');
var CHAT_THINKING_CLOSE_RE=new RegExp('<\\/(?:ck_thinking|ck:thinking|thinking|think)>','i');
var CHAT_THINKING_CLOSE_SPLIT_RE=new RegExp('<\\/(?:ck_thinking|ck:thinking|thinking|think)>','i');
var CHAT_THINKING_TAG_CLEAN_RE=new RegExp('<\\/?'+CHAT_THINKING_TAG_NAME+'\\b[^>]*>','gi');
function chatSplitThinkingText(src,opts){
  opts=opts||{};
  var text=String(src||'');
  var thoughts=[];
  var suppressThinking=opts.suppressThinking===true;
  if(opts.hideUnclosedThinking===true&&chatLooksLikePartialThinkingTag(text)){
    return {text:'',thinking:''};
  }
  text=text.replace(CHAT_THINKING_TAG_RE,function(_all,body){
    var clean=String(body||'').trim();
    if(clean&&!suppressThinking)thoughts.push(clean);
    return '\n';
  });
  if(opts.hideUnclosedThinking===true){
    text=text.replace(CHAT_THINKING_OPEN_TO_END_RE,'\n');
  }
  if(CHAT_THINKING_CLOSE_RE.test(text)&&!CHAT_THINKING_OPEN_RE.test(text)){
    var parts=text.split(CHAT_THINKING_CLOSE_SPLIT_RE);
    var before=(parts.shift()||'').trim();
    var after=parts.join('\n').trim();
    if(before&&!suppressThinking)thoughts.push(before);
    text=after||'';
  }
  text=text
    .replace(CHAT_THINKING_TAG_CLEAN_RE,'\n')
    .replace(/\n{3,}/g,'\n\n')
    .trim();
  return {text:text,thinking:thoughts.join('\n\n')};
}
function chatLooksLikePartialThinkingTag(text){
  var t=String(text||'').trim().toLowerCase();
  if(!t||t.charAt(0)!=='<'||t.indexOf('>')>=0)return false;
  var compact=t.replace(/\s+/g,'');
  if(compact==='<')return true;
  var targets=['<ck_thinking','<ck:thinking','<thinking','<think'];
  for(var i=0;i<targets.length;i++){
    if(targets[i].indexOf(compact)===0||compact.indexOf(targets[i])===0)return true;
  }
  return false;
}
function chatCleanAssistantTextForHistory(rawText){
  return chatSplitThinkingText(rawText).text || String(rawText||'').replace(CHAT_THINKING_TAG_CLEAN_RE,'').trim();
}
function chatAssistantStreamingVisibleText(rawText){
  return chatSplitThinkingText(rawText,{suppressThinking:true,hideUnclosedThinking:true}).text;
}
function chatToolStatusLabel(status,isError){
  if(isError||status==='error')return '失败';
  if(status==='done')return '完成';
  return '调用中';
}
function chatToolShortName(name){
  name=String(name||'未知工具');
  return name.replace(/^mcp__memory__/,'memory.').replace(/^mcp__/,'');
}
function chatToolJsonPreview(value){
  if(value===undefined||value===null)return '';
  try{
    return typeof value==='string'?value:JSON.stringify(value,null,2);
  }catch(e){
    return String(value);
  }
}
function chatToolEventKey(item,index){
  item=item||{};
  return String(item.id||item.tool_use_id||'')||('tool-'+index+'-'+String(item.name||'tool'));
}
function chatCloneToolEvents(list){
  if(!Array.isArray(list))return [];
  try{return JSON.parse(JSON.stringify(list));}catch(e){return list.slice()}
}
function chatUpsertToolEvent(list,data){
  list=Array.isArray(list)?list:[];
  data=data&&typeof data==='object'?data:{};
  var id=String(data.id||data.tool_use_id||'');
  var idx=-1;
  if(id){
    idx=list.findIndex(function(x){return String((x&&x.id)||'')===id});
  }
  if(idx<0&&data.status!=='running'){
    for(var i=list.length-1;i>=0;i--){
      if(String((list[i]&&list[i].name)||'')===String(data.name||'')&&list[i].status!=='done'&&list[i].status!=='error'){
        idx=i;
        break;
      }
    }
  }
  var item=idx>=0?Object.assign({},list[idx]):{};
  Object.keys(data).forEach(function(k){item[k]=data[k]});
  if(!item.ts)item.ts=Date.now();
  if(!item.status)item.status='running';
  if(idx>=0)list[idx]=item;
  else list.push(item);
  return list;
}
function chatRenderToolTrace(tools){
  tools=Array.isArray(tools)?tools.filter(Boolean):[];
  if(!tools.length)return '';
  return '<div class="chat-tool-trace">'+tools.map(function(t,i){
    var status=String(t.status||'running');
    var isError=!!(t.is_error||status==='error');
    var input=chatToolJsonPreview(t.input||{});
    var result=String(t.result_preview||'');
    var meta=[];
    if(t.source)meta.push(String(t.source).toUpperCase());
    if(t.seconds!==undefined)meta.push(Number(t.seconds||0).toFixed(2)+'s');
    if(t.result_chars)meta.push(t.result_chars+'字');
    var subtitle=isError?'工具调用失败':(status==='done'?'工具调用完成':'正在调用工具');
    var statusClass=isError?'error':(status==='done'?'done':'running');
    var open=(status==='running'||isError)?' open':'';
    var body='';
    if(input)body+='<div class="chat-tool-section"><b>输入参数</b><pre>'+esc(input)+'</pre></div>';
    if(result)body+='<div class="chat-tool-section"><b>'+esc(isError?'错误结果':'返回结果')+'</b><pre>'+esc(result)+'</pre></div>';
    if(!body)body='<div class="chat-tool-empty">'+(status==='running'?'等待工具返回...':'没有返回详情')+'</div>';
    return '<details class="chat-tool-card '+statusClass+'" data-tool-key="'+escAttr(chatToolEventKey(t,i))+'"'+open+'><summary><span class="chat-tool-icon">⌁</span><span class="chat-tool-main"><b>'+esc(chatToolShortName(t.name))+'</b><small>'+esc(subtitle+(meta.length?' · '+meta.join(' · '):''))+'</small></span><span class="chat-tool-status">'+esc(chatToolStatusLabel(status,isError))+'</span><span class="chat-tool-chevron">⌄</span></summary><div class="chat-tool-body">'+body+'</div></details>';
  }).join('')+'</div>';
}
function chatRenderAssistantContent(rawText,streaming,tools){
  var split=chatSplitThinkingText(rawText,{suppressThinking:streaming===true,hideUnclosedThinking:streaming===true});
  var thinking=split.thinking?(
    '<div class="chat-thinking"><button class="chat-thinking-head" type="button"><span>思考</span><span class="chev">⌄</span></button><div class="chat-thinking-body">'+esc(split.thinking)+'</div></div>'
  ):'';
  var toolTrace=chatRenderToolTrace(tools);
  var body=split.text?('<div class="chat-md">'+chatRenderMarkdown(split.text||'')+'</div>'):'';
  var caret=(streaming&&split.text)?'<span class="chat-caret"></span>':'';
  return thinking+toolTrace+body+caret;
}
function chatStreamingAssistantPreviewText(rawText){
  var parsed=chatSplitThinkingText(rawText,{suppressThinking:true,hideUnclosedThinking:true});
  var text=String(parsed.text||'').trim();
  if(!text)return '';
  var paragraphs=text.split(/\n{2,}/).map(function(x){return x.trim()}).filter(Boolean);
  if(paragraphs.length>1)return paragraphs[0];
  var units=chatNaturalUnits(text);
  if(units.length>1&&chatNaturalTextLen(text)>=70){
    var target=Math.min(units.length,text.length<260?2:3);
    var preview=[],len=0;
    for(var i=0;i<units.length&&preview.length<target;i++){
      preview.push(units[i]);
      len+=chatNaturalTextLen(units[i]);
      if(len>=56)break;
    }
    return chatNaturalJoin(preview);
  }
  return text;
}
function chatRenderStreamingAssistantContent(rawText,tools){
  return chatRenderAssistantContent(chatStreamingAssistantPreviewText(rawText),true,tools);
}
function chatNaturalTextLen(text){
  var len=String(text||'').replace(/\s+/g,'').length;
  return len;
}
function chatAssistantSplitTarget(text,unitCount){
  var len=chatNaturalTextLen(text);
  if(len<70||unitCount<2)return 1;
  var r=Math.random(),n;
  if(len<120)n=2;
  else if(len<260)n=r<0.7?2:3;
  else if(len<520)n=r<0.72?3:4;
  else if(len<900)n=r<0.12?2:(r<0.78?4:5);
  else n=r<0.75?5:6+Math.floor(Math.random()*3);
  return Math.max(1,Math.min(10,Math.min(n,unitCount)));
}
function chatNaturalUnits(text){
  var paragraphs=String(text||'').replace(/\r\n/g,'\n').split(/\n{2,}/).map(function(x){return x.trim()}).filter(Boolean);
  if(paragraphs.length>1){
    var usable=paragraphs.every(function(p){var len=chatNaturalTextLen(p);return len>=8&&len<=180});
    if(usable)return paragraphs;
  }
  var units=[];
  var lines=String(text||'').split(/\n+/);
  var i=0;
  while(i<lines.length){
    var line=lines[i].trim();
    if(!line){i++;continue;}
    var isOrderedListItem=/^\d+[.、]\s*/.test(line);
    var isUnorderedListItem=/^[-*]\s/.test(line);
    if(isOrderedListItem||isUnorderedListItem){
      var listBlock=[line];
      var j=i+1;
      while(j<lines.length){
        var nextLine=lines[j].trim();
        if(!nextLine){j++;continue;}
        var nextIsOrdered=/^\d+[.、]\s*/.test(nextLine);
        var nextIsUnordered=/^[-*]\s/.test(nextLine);
        if((isOrderedListItem&&nextIsOrdered)||(isUnorderedListItem&&nextIsUnordered)){
          listBlock.push(nextLine);
          j++;
        }else{
          break;
        }
      }
      units.push(listBlock.join('\n'));
      i=j;
    }else{
      var parts=line.match(/[^。！？!?；;…]+[。！？!?；;…]*/g)||[line];
      parts.forEach(function(p){
        p=p.trim();
        if(p)units.push(p);
      });
      i++;
    }
  }
  return units.length?units:[String(text||'').trim()];
}
function chatNaturalJoin(list){
  return list.join('').replace(/\s+\n/g,'\n').trim();
}
function chatPackNaturalUnits(units,target){
  if(target<=1||units.length<=1)return [chatNaturalJoin(units)];
  var total=units.reduce(function(n,u){return n+chatNaturalTextLen(u)},0);
  var ideal=Math.max(28,Math.ceil(total/target));
  var out=[],buf=[],bufLen=0;
  units.forEach(function(unit,idx){
    var uLen=chatNaturalTextLen(unit);
    var remainingUnits=units.length-idx;
    var remainingSlots=target-out.length-1;
    var shouldClose=buf.length&&bufLen>=ideal*.72&&remainingSlots>0&&remainingUnits>remainingSlots;
    if(shouldClose){
      out.push(chatNaturalJoin(buf));
      buf=[];
      bufLen=0;
    }
    buf.push(unit);
    bufLen+=uLen;
    if(bufLen>=ideal*1.35&&target-out.length-1>0){
      out.push(chatNaturalJoin(buf));
      buf=[];
      bufLen=0;
    }
  });
  if(buf.length)out.push(chatNaturalJoin(buf));
  while(out.length>target){
    var last=out.pop();
    out[out.length-1]=(out[out.length-1]||'')+last;
  }
  return out.filter(Boolean);
}
function chatSplitAssistantReplies(rawText,splitEnabled){
  var parsed=chatSplitThinkingText(rawText);
  var text=parsed.text.trim();
  if(!text)return parsed.thinking?[rawText]:[];
  if(splitEnabled===false)return [rawText];
  var units=chatNaturalUnits(text);
  if(/\n{2,}/.test(text)&&units.length>1&&units.length<=6){
    if(parsed.thinking)units[0]='<ck_thinking>\n'+parsed.thinking+'\n</ck_thinking>\n\n'+units[0];
    return units;
  }
  var target=chatAssistantSplitTarget(text,units.length);
  if(target<=1)return [rawText];
  var out=chatPackNaturalUnits(units,target);
  if(parsed.thinking&&out.length)out[0]='<ck_thinking>\n'+parsed.thinking+'\n</ck_thinking>\n\n'+out[0];
  return out.length?out:[rawText];
}
function chatReplyRevealDelay(part,i,total){
  if(i>=total-1)return 0;
  var len=String(part||'').replace(/\s+/g,'').length;
  return Math.max(260,Math.min(980,260+len*10));
}
function chatSleep(ms){return new Promise(function(resolve){setTimeout(resolve,ms)})}
function chatReplaceStreamingBubble(anchorEl,message,index){
  if(!anchorEl||!anchorEl.parentNode||!message)return false;
  var row=anchorEl.parentNode;
  var box=chatMessagesBox();
  var shouldStick=chatIsMessagesNearBottom();
  var previousScrollTop=box?box.scrollTop:0;
  row.outerHTML=chatRenderMessageRow(message,index);
  if(!chatFollowMessagesBottom(shouldStick,false,true)&&box)box.scrollTop=previousScrollTop;
  return true;
}
async function chatAppendAssistantReplies(rawText,recallInfo,toolEvents,opts){
  var parts=chatSplitAssistantReplies(rawText,!(opts&&opts.splitAssistantReplies===false));
  var tools=chatCloneToolEvents(toolEvents);
  if(!parts.length&&tools.length)parts=[''];
  var now=Date.now();
  for(var i=0;i<parts.length;i++){
    var part=parts[i];
    var msg={role:'assistant',text:part,recall:i===0?recallInfo:null,tools:i===0?tools:[],ts:now+i};
    chatMessages.push(msg);
    chatMarkMessageFresh(msg);
    chatSaveLocalMessages();
    if(i===0&&opts&&chatReplaceStreamingBubble(opts.anchorEl,msg,chatMessages.length-1)){
      chatRenderPendingBar();
    }else{
      chatRenderMessages({smooth:true,respectUserScroll:true,newMessage:true});
    }
    var wait=chatReplyRevealDelay(part,i,parts.length);
    if(wait)await chatSleep(wait);
  }
}
function chatCopyText(t){
  if(navigator.clipboard&&navigator.clipboard.writeText){navigator.clipboard.writeText(t).then(function(){toast('已复制')},function(){chatFallbackCopy(t)})}
  else chatFallbackCopy(t);
}
function chatFallbackCopy(t){try{var ta=document.createElement('textarea');ta.value=t;ta.style.position='fixed';ta.style.opacity='0';document.body.appendChild(ta);ta.select();document.execCommand('copy');document.body.removeChild(ta);toast('已复制')}catch(e){toast('复制失败')}}
function chatStopMessage(){if(chatAbort){try{chatAbort.abort()}catch(e){}}}
function chatAutosizeInput(input){
  if(!input)return;
  var styles=window.getComputedStyle?window.getComputedStyle(input):null;
  var lineHeight=styles?parseFloat(styles.lineHeight):0;
  var paddingTop=styles?parseFloat(styles.paddingTop):0;
  var paddingBottom=styles?parseFloat(styles.paddingBottom):0;
  if(!lineHeight||isNaN(lineHeight))lineHeight=20;
  if(isNaN(paddingTop))paddingTop=0;
  if(isNaN(paddingBottom))paddingBottom=0;
  var min=window.matchMedia&&window.matchMedia('(max-width: 640px)').matches?34:36;
  var max=Math.ceil(lineHeight*3+paddingTop+paddingBottom);
  input.style.height='auto';
  input.style.height=Math.min(max,Math.max(min,input.scrollHeight))+'px';
  input.style.overflowY=input.scrollHeight>max?'auto':'hidden';
  chatLayoutCompose();
}
function chatIsInputActive(){
  var input=document.getElementById('chat-input');
  return !!(input&&(document.activeElement===input||chatInputFocused));
}
function chatKeyboardProtectActive(){
  return chatIsInputActive()&&(Date.now()-chatLastInputAt<5000);
}
function chatLayoutCompose(opts){
  opts=opts||{};
  var vv=window.visualViewport;
  var h=vv&&vv.height?vv.height:window.innerHeight;
  if(h&&document.documentElement){
    var next=Math.max(320,Math.floor(h));
    var delta=chatLastLayoutHeight?Math.abs(next-chatLastLayoutHeight):9999;
    if(opts.force||vv||!chatKeyboardProtectActive()||!chatLastLayoutHeight||delta>=72){
      document.documentElement.style.setProperty('--ck-chat-vh',next+'px');
      document.documentElement.style.setProperty('--ck-chat-vv-top',Math.max(0,Math.floor((vv&&vv.offsetTop)||0))+'px');
      chatLastLayoutHeight=next;
    }
  }
  var shell=document.querySelector('.chat-shell');
  if(shell)shell.classList.add('chat-layout-ready');
  var compose=document.querySelector('.chat-compose');
  if(compose){
    compose.style.display='';
    compose.style.visibility='';
    var composeRect=compose.getBoundingClientRect?compose.getBoundingClientRect():null;
    var composeHeight=Math.ceil((composeRect&&composeRect.height)||compose.offsetHeight||64);
    document.documentElement.style.setProperty('--ck-chat-compose-height',composeHeight+'px');
  }
  var btn=document.getElementById('chat-send-btn');
  if(!btn)return;
  btn.style.position='';
  btn.style.left='';
  btn.style.right='';
  btn.style.bottom='';
  btn.style.zIndex='';
  btn.style.display='';
  btn.style.alignItems='';
  btn.style.justifyContent='';
}
function chatHandleViewportChange(){
  if(chatViewportRaf)cancelAnimationFrame(chatViewportRaf);
  chatViewportRaf=requestAnimationFrame(function(){
    chatViewportRaf=0;
    chatLayoutCompose();
    if(chatIsInputActive()){
      chatKeepLatestVisible({soft:true});
      [120,280,520].forEach(function(ms){setTimeout(function(){chatKeepLatestVisible({soft:true})},ms)});
    }else if(Date.now()-chatLastBlurAt<800){
      setTimeout(chatMaybeRecoverInputFocus,80);
    }
  });
}
function chatTogglePlus(force){
  var panel=document.getElementById('chat-plus-panel');
  var btn=document.getElementById('chat-plus-btn');
  if(!panel)return;
  var open=typeof force==='boolean'?force:!panel.classList.contains('open');
  if(open){
    chatPlusUpdateDots();
  }
  panel.classList.toggle('open',open);
  if(btn)btn.classList.toggle('open',open);
}
function chatPlusUpdateDots(){
  var container=document.getElementById('chat-plus-pages');
  var dotsWrap=document.getElementById('chat-plus-dots');
  if(!container||!dotsWrap)return;
  var pages=container.querySelectorAll('.chat-plus-page');
  var totalPages=pages.length;
  if(totalPages<=1){
    dotsWrap.innerHTML='';
    return;
  }
  var scrollLeft=container.scrollLeft;
  var pageWidth=container.offsetWidth;
  var currentPage=Math.round(scrollLeft/pageWidth);
  currentPage=Math.max(0,Math.min(totalPages-1,currentPage));
  chatPlusSwipe.currentPage=currentPage;
  chatPlusSwipe.totalPages=totalPages;
  var dots=[];
  for(var i=0;i<totalPages;i++){
    dots.push('<div class="chat-plus-dot'+(i===currentPage?' active':'')+'"></div>');
  }
  dotsWrap.innerHTML=dots.join('');
}
function chatPlusPageWidth(container){
  return container?Math.max(1,container.clientWidth||container.offsetWidth||1):1;
}
function chatPlusScrollToPage(page,instant){
  var container=document.getElementById('chat-plus-pages');
  if(!container)return;
  var pages=container.querySelectorAll('.chat-plus-page');
  var totalPages=pages.length||1;
  page=Math.max(0,Math.min(totalPages-1,page));
  chatPlusSwipe.currentPage=page;
  chatPlusSwipe.totalPages=totalPages;
  var left=page*chatPlusPageWidth(container);
  if(container.scrollTo){
    try{container.scrollTo({left:left,behavior:instant?'auto':'smooth'});}
    catch(e){container.scrollLeft=left;}
  }else{
    container.scrollLeft=left;
  }
  setTimeout(chatPlusUpdateDots,instant?0:220);
}
function chatPlusTouchStart(e){
  var container=document.getElementById('chat-plus-pages');
  if(!container||!e.touches||e.touches.length!==1)return;
  var t=e.touches[0];
  chatPlusSwipe.active=true;
  chatPlusSwipe.committed=false;
  chatPlusSwipe.startX=t.clientX;
  chatPlusSwipe.startY=t.clientY;
  chatPlusSwipe.startScrollLeft=container.scrollLeft;
  chatPlusSwipe.container=container;
  chatPlusUpdateDots();
}
function chatPlusTouchMove(e){
  if(!chatPlusSwipe.active||!chatPlusSwipe.container||!e.touches||e.touches.length!==1)return;
  var t=e.touches[0];
  var dx=t.clientX-chatPlusSwipe.startX;
  var dy=t.clientY-chatPlusSwipe.startY;
  if(!chatPlusSwipe.committed){
    if(Math.abs(dx)<8&&Math.abs(dy)<8)return;
    if(Math.abs(dx)<=Math.abs(dy)){
      chatPlusSwipe.active=false;
      return;
    }
    chatPlusSwipe.committed=true;
  }
  chatPlusSwipe.container.scrollLeft=chatPlusSwipe.startScrollLeft-dx;
  if(e.cancelable)e.preventDefault();
  if(e.stopPropagation)e.stopPropagation();
}
function chatPlusTouchEnd(){
  if(!chatPlusSwipe.active)return;
  var container=chatPlusSwipe.container;
  var committed=chatPlusSwipe.committed;
  chatPlusSwipe.active=false;
  chatPlusSwipe.committed=false;
  if(!container)return;
  var pageWidth=chatPlusPageWidth(container);
  var page=Math.round(container.scrollLeft/pageWidth);
  if(committed){
    var deltaPages=Math.round((container.scrollLeft-chatPlusSwipe.startScrollLeft)/pageWidth);
    if(deltaPages===0&&Math.abs(container.scrollLeft-chatPlusSwipe.startScrollLeft)>pageWidth*.18){
      deltaPages=container.scrollLeft>chatPlusSwipe.startScrollLeft?1:-1;
    }
    page=chatPlusSwipe.currentPage+deltaPages;
    chatPlusSwipe.suppressClickUntil=Date.now()+360;
  }
  chatPlusScrollToPage(page,false);
}
function chatPlusSuppressSwipeClick(e){
  if(Date.now()>chatPlusSwipe.suppressClickUntil)return;
  if(e&&e.preventDefault)e.preventDefault();
  if(e&&e.stopPropagation)e.stopPropagation();
}
function chatClosePlusOnOutside(e){
  var panel=document.getElementById('chat-plus-panel');
  if(!panel||!panel.classList.contains('open')||!e||!e.target||!e.target.closest)return;
  if(e.target.closest('.chat-plus-btn')||e.target.closest('.chat-plus-panel'))return;
  chatTogglePlus(false);
}
function chatAttachPlusGesture(){
  var container=document.getElementById('chat-plus-pages');
  if(!container||container.__chatPlusGestureAttached)return;
  container.__chatPlusGestureAttached=true;
  container.addEventListener('scroll',chatPlusUpdateDots,{passive:true});
  container.addEventListener('touchstart',chatPlusTouchStart,{passive:true});
  container.addEventListener('touchmove',chatPlusTouchMove,{passive:false});
  container.addEventListener('touchend',chatPlusTouchEnd,{passive:true});
  container.addEventListener('touchcancel',chatPlusTouchEnd,{passive:true});
  container.addEventListener('click',chatPlusSuppressSwipeClick,true);
}
function chatSettingTitle(tab){
  return ({model:'提示词设置',gateway:'网关连接',worldbook:'世界书',memory:'记忆与缓存',trim:'自动截断',debug:'⚙️ 调试记录'})[tab]||'聊天设置';
}
function chatOpenSettingTab(tab){
  chatTogglePlus(false);
  chatSwitchSideTab(tab||'model');
  chatToggleSettings(true);
}
function chatToggleSessions(force,silent){
  var shell=document.querySelector('.chat-shell');
  if(!shell)return;
  var open=typeof force==='boolean'?force:!shell.classList.contains('chat-sessions-open');
  shell.classList.toggle('chat-sessions-open',open);
  if(open)chatRenderSessions();
}
function chatToggleSettings(force,silent){
  var el=document.querySelector('.chat-settings');
  if(!el)return;
  var open=typeof force==='boolean'?force:!el.classList.contains('open');
  if(!open){
    el.style.removeProperty('transition');
    el.style.removeProperty('transform');
  }
  el.classList.toggle('open',open);
  var shell=document.querySelector('.chat-shell');
  if(shell)shell.classList.toggle('chat-settings-open',open);
  if(!silent){
    var cfg=chatMergeLiveToggleState(chatLoadConfig());
    cfg.settingsOpen=open;
    chatSaveConfigObject(cfg);
  }
}
function chatSwitchSideTab(tab,silent){
  tab=tab||'model';
  var title=document.getElementById('chat-settings-title');
  if(title)title.textContent=chatSettingTitle(tab);
  document.querySelectorAll('.chat-side-tabs button').forEach(function(b){b.classList.toggle('active',b.getAttribute('data-chat-side')===tab)});
  document.querySelectorAll('.chat-side-panel').forEach(function(p){p.classList.toggle('active',p.id==='chat-side-'+tab)});
  if(!silent){
    var cfg=chatMergeLiveToggleState(chatLoadConfig());
    cfg.chatSideTab=tab;
    chatSaveConfigObject(cfg);
  }
  if(tab==='debug'){
    chatRenderDebugRecords();
    chatScrollDebugBottom();
  }
  if(tab==='trim')chatRenderTrimState();
}
document.addEventListener('click',function(e){
  if(!e.target||!e.target.closest)return;
  if(e.target.closest('.chat-plus-btn')||e.target.closest('.chat-plus-panel')){
    return;
  }
  var plus=document.getElementById('chat-plus-panel');
  if(plus&&plus.classList.contains('open')){
    chatTogglePlus(false);
  }
  var thumb=e.target.closest('.chat-image-thumb.viewable');
  if(thumb){
    var img=thumb.querySelector('img');
    if(img)chatOpenImageViewer(img.currentSrc||img.src,img.alt||thumb.title||'原图');
    return;
  }
  var cb=e.target.closest('.cb-copy');
  if(cb){var code=cb.closest('.cb')?cb.closest('.cb').querySelector('pre code'):null;if(code){chatCopyText(code.textContent);cb.textContent='已复制';setTimeout(function(){cb.textContent='复制'},1200)}return;}
  var rh=e.target.closest('.chat-recall-head');
  if(rh&&rh.parentNode){rh.parentNode.classList.toggle('open');return;}
  var th=e.target.closest('.chat-thinking-head');
  if(th&&th.parentNode){th.parentNode.classList.toggle('open');return;}
  var vb=e.target.closest('.chat-version-btn');
  if(vb){
    var vi=parseInt(vb.getAttribute('data-i'),10);
    var dir=Number(vb.getAttribute('data-dir')||0)||0;
    chatSwitchMessageVersion(vi,dir);
    return;
  }
  var act=e.target.closest('.chat-msg-act,.chat-user-regen');
  if(act){
    var i=parseInt(act.getAttribute('data-i'),10);
    var a=act.getAttribute('data-act');
    if(a==='copy'&&chatMessages[i])chatCopyText(chatMessages[i].text||'');
    if(a==='regen')chatRegenerateFromUser(i);
    return;
  }
});
document.addEventListener('dblclick',function(e){
  if(!e.target||!e.target.closest)return;
  if(e.target.closest('button,.chat-recall,.chat-thinking,.cb'))return;
  var bubble=e.target.closest('.chat-bubble');
  if(!bubble)return;
  var i=parseInt(bubble.getAttribute('data-i'),10);
  chatStartEditMessage(i);
});
function chatEditPointerInside(target){
  if(!target||!target.closest)return false;
  return !!target.closest('#chat-input,#chat-edit-actions,#chat-edit-images,#chat-send-btn,#chat-plus-btn,#chat-plus-panel,#chat-image-input,#chat-camera-input');
}
document.addEventListener('pointerdown',function(e){
  if(chatEditingIndex<0||!e.target)return;
  if(chatEditPointerInside(e.target))return;
  chatCancelEdit();
},true);
document.addEventListener('keydown',function(e){
  if((e.key==='Enter'||e.key===' ')&&e.target&&e.target.closest){
    var thumb=e.target.closest('.chat-image-thumb.viewable');
    if(thumb){
      var img=thumb.querySelector('img');
      if(img){
        e.preventDefault();
        chatOpenImageViewer(img.currentSrc||img.src,img.alt||thumb.title||'原图');
      }
      return;
    }
  }
  if(e.key!=='Escape')return;
  var viewer=document.getElementById('chat-image-viewer');
  if(viewer&&!viewer.hidden){
    e.preventDefault();
    chatCloseImageViewer();
    return;
  }
  if(chatEditingIndex>=0){
    e.preventDefault();
    e.stopPropagation();
    chatCancelEdit();
    return;
  }
  chatToggleSessions(false,true);
  chatTogglePlus(false);
});
document.addEventListener('visibilitychange',function(){
  if(!document.hidden&&currentPanelTab==='chat')chatUpdateCacheExpiryHint(true);
});
function chatMessagesBox(){
  return document.getElementById('chat-messages');
}
function chatIsMessagesNearBottom(threshold){
  var box=chatMessagesBox();
  if(!box)return true;
  var gap=box.scrollHeight-box.scrollTop-box.clientHeight;
  return gap<=((typeof threshold==='number')?threshold:CHAT_BOTTOM_THRESHOLD);
}
function chatSetNewMessageHint(show){
  chatNewMessageHintVisible=!!show;
  var tip=document.getElementById('chat-new-message-tip');
  if(!tip)return;
  tip.hidden=!show;
  tip.classList.toggle('show',!!show);
  tip.setAttribute('aria-hidden',show?'false':'true');
}
function chatHandleMessagesScroll(){
  if(chatIsMessagesNearBottom())chatSetNewMessageHint(false);
}
function chatAttachMessagesScroll(){
  var box=chatMessagesBox();
  if(!box||box.__ckMessagesScrollAttached)return;
  box.__ckMessagesScrollAttached=true;
  box.addEventListener('scroll',chatHandleMessagesScroll,{passive:true});
}
function chatFollowMessagesBottom(shouldStick,instant,showHint){
  if(shouldStick){
    chatScrollMessagesBottom(instant);
    return true;
  }
  if(showHint)chatSetNewMessageHint(true);
  return false;
}
function chatJumpToLatest(){
  chatScrollMessagesBottom(false);
}
function chatRenderMessages(opts){
  opts=opts||{};
  var box=chatMessagesBox();
  if(!box)return;
  var respectUserScroll=opts.respectUserScroll===true;
  var shouldStick=!respectUserScroll||chatIsMessagesNearBottom();
  var previousScrollTop=box.scrollTop;
  var title=document.getElementById('chat-title');
  if(title)title.textContent=chatCurrentSession().title||'聊天';
  if(!chatMessages.length){
    box.innerHTML='<div class="chat-welcome"><b>CK Chat</b><p>新对话</p></div>';
    chatRenderPendingBar();
    chatSetNewMessageHint(false);
    chatScrollMessagesBottom(true);
    return;
  }
  chatEnsureCacheExpiryNotice();
  box.innerHTML=chatMessages.map(function(m,i){return chatRenderMessageRow(m,i)}).join('');
  chatRenderPendingBar();
  if(shouldStick){
    chatScrollMessagesBottom(opts.smooth!==true);
  }else{
    box.scrollTop=previousScrollTop;
    if(opts.newMessage)chatSetNewMessageHint(true);
  }
}
function chatMessageAnimKey(m){
  if(!m)return '';
  return String(m.role||'')+'|'+String(m.ts||0)+'|'+String(m.text||'').slice(0,48)+'|'+chatMessageImages(m).length;
}
function chatMarkMessageFresh(m){
  var key=chatMessageAnimKey(m);
  if(!key)return;
  chatFreshMessageKeys.add(key);
  setTimeout(function(){chatFreshMessageKeys.delete(key)},1200);
}
function chatScrollMessagesBottom(instant){
  var box=chatMessagesBox();
  if(!box)return;
  chatSetNewMessageHint(false);
  var old=box.style.scrollBehavior;
  if(instant)box.style.setProperty('scroll-behavior','auto','important');
  if(!instant&&box.scrollTo){
    try{
      box.scrollTo({top:box.scrollHeight,behavior:'smooth'});
      requestAnimationFrame(function(){
        try{box.scrollTo({top:box.scrollHeight,behavior:'smooth'});}
        catch(e){box.scrollTop=box.scrollHeight}
      });
      return;
    }catch(e){}
  }
  box.scrollTop=box.scrollHeight;
  requestAnimationFrame(function(){
    box.scrollTop=box.scrollHeight;
    if(instant){
      if(old)box.style.scrollBehavior=old;
      else box.style.removeProperty('scroll-behavior');
    }
  });
}
function chatIsRealMessage(m){
  return m&&(m.role==='user'||m.role==='assistant')&&Number(m.ts||0);
}
function chatLastMessageTs(){
  for(var i=chatMessages.length-1;i>=0;i--){
    if(chatIsRealMessage(chatMessages[i]))return Number(chatMessages[i].ts)||0;
  }
  return 0;
}
function chatHasCacheNoticeAfter(ts){
  return chatMessages.some(function(m){
    return m&&m.role==='notice'&&m.kind==='cache-expired'&&Number(m.afterTs||0)===Number(ts||0);
  });
}
function chatEnsureCacheExpiryNotice(){
  var lastTs=chatLastMessageTs();
  var expired=!!(lastTs&&chatMessages.length&&!chatSending&&(Date.now()-lastTs>=CHAT_CACHE_TTL));
  if(!expired||chatHasCacheNoticeAfter(lastTs))return false;
  chatMessages.push({role:'notice',kind:'cache-expired',text:CHAT_CACHE_NOTICE_TEXT,ts:Date.now(),afterTs:lastTs});
  chatSaveLocalMessages();
  return true;
}
function chatUpdateCacheExpiryHint(keepScroll){
  var box=document.getElementById('chat-messages');
  if(!box)return;
  if(chatIsInputActive()||chatKeyboardProtectActive())return;
  var old=box.querySelector('.chat-cache-expired-tip:not(.persisted)');
  if(old)old.remove();
  if(chatEnsureCacheExpiryNotice())chatRenderMessages({respectUserScroll:true});
}
function chatVersionNavHtml(m,i,role){
  var info=chatMessageVersionInfo(m);
  if(!info.total||info.total<=1)return '';
  var prevDisabled=info.index<=0?' disabled aria-disabled="true"':'';
  var nextDisabled=info.index>=info.total-1?' disabled aria-disabled="true"':'';
  return '<div class="chat-version-nav '+role+'" aria-label="消息历史版本">'+
    '<button class="chat-version-btn" type="button" data-i="'+i+'" data-dir="-1" title="上一版"'+prevDisabled+'>◂</button>'+
    '<span>'+esc(String(info.index+1))+'/'+esc(String(info.total))+'</span>'+
    '<button class="chat-version-btn" type="button" data-i="'+i+'" data-dir="1" title="下一版"'+nextDisabled+'>▸</button>'+
    '</div>';
}
function chatSwitchMessageVersion(i,dir){
  if(chatSending)return;
  if(chatEditingIndex>=0)chatCancelEdit();
  var m=chatMessages[i];
  if(!m||m.role==='notice')return;
  var info=chatMessageVersionInfo(m);
  if(!info.total||info.total<=1)return;
  var next=info.index+(Number(dir)||0);
  next=Math.max(0,Math.min(info.total-1,next));
  if(next===info.index)return;
  chatApplyMessageVersion(m,info.versions,next);
  chatResetUserMessageCacheState(m);
  chatSaveLocalMessages();
  chatRenderMessages({respectUserScroll:true});
}
function chatRenderMessageRow(m,i){
  if(m&&m.role==='notice'){
    var time='<div class="chat-msg-time">'+esc(chatFullTimeLabel(m.ts))+'</div>';
    return '<div class="chat-msg-row notice"><div class="chat-cache-expired-tip persisted">'+esc(m.text||CHAT_CACHE_NOTICE_TEXT)+'</div>'+time+'</div>';
  }
  var pending=m&&m.role==='pending_user';
  var role=(m.role==='user'||pending)?'user':(m.role==='system'?'system':'assistant');
  var recall='';
  if(role==='assistant'&&m.recall&&(m.recall.chars||m.recall.preview)){
    recall='<div class="chat-recall"><button class="chat-recall-head" type="button"><span>召回记忆'+(m.recall.chars?(' · '+m.recall.chars+' 字'):'')+'</span><span class="chev">⌄</span></button><div class="chat-recall-body">'+esc(m.recall.preview||'')+'</div></div>';
  }
  var inner=role==='assistant'?chatRenderAssistantContent(m.text||'',false,m.tools):esc(m.text||'');
  if(role==='user')inner=chatRenderUserMessageContent(m);
  var toolButtons=role==='system'?[]:['<button class="chat-msg-act" data-act="copy" data-i="'+i+'" title="复制">复制</button>'];
  if(role==='user'&&!pending)toolButtons.push('<button class="chat-user-regen" data-act="regen" data-i="'+i+'" title="重新生成">↻</button>');
  var tools=toolButtons.length?'<div class="chat-msg-tools">'+toolButtons.join('')+'</div>':'';
  var userMeta=role==='user'?chatUserMessageMetaHtml(m):'';
  var time=role==='user'?'':'<div class="chat-msg-time">'+esc(chatFullTimeLabel(m.ts))+'</div>';
  var imageCount=chatMessageImages(m).length;
  var bubbleState=(imageCount?' has-images':'')+(imageCount&&!String((m&&m.text)||'').trim()?' image-only':'');
  var bubble='<div class="chat-bubble '+role+(pending?' pending':'')+bubbleState+'" data-i="'+i+'">'+inner+'</div>';
  var versionNav=pending?'':chatVersionNavHtml(m,i,role);
  var fresh=chatFreshMessageKeys.has(chatMessageAnimKey(m))?' chat-fresh':'';
  return '<div class="chat-msg-row '+role+(pending?' pending':'')+fresh+'">'+(role==='assistant'?recall:'')+bubble+versionNav+tools+userMeta+time+'</div>';
}
function chatUserMessageMetaHtml(m){
  var pending=m&&m.role==='pending_user';
  var bits=['<span class="chat-msg-meta">'];
  bits.push('<span class="chat-msg-meta-time">'+esc(chatFullTimeLabel(m&&m.ts))+'</span>');
  if(pending){
    bits.push('<span class="chat-msg-meta-pending">待发送</span>');
  }else{
    bits.push(chatCacheTickHtml(m));
  }
  bits.push('</span>');
  return bits.join('');
}
function chatCacheTickHtml(m){
  var hit=!!(m&&m.cacheHit);
  var title=hit?'命中缓存':'消息发送成功';
  var one='<path d="M2.1 7.1 5.4 10.3 12.7 3.1"></path>';
  var two='<path class="chat-cache-tick-back" d="M1.8 7.2 4.8 10.2 11.2 3.8"></path><path d="M5.6 7.3 8.8 10.4 16.4 2.9"></path>';
  return '<span class="chat-cache-tick '+(hit?'hit':'miss')+'" title="'+title+'" aria-label="'+title+'"><svg viewBox="0 0 '+(hit?'18':'15')+' 14" focusable="false" aria-hidden="true">'+(hit?two:one)+'</svg></span>';
}
function chatUsageCacheRead(usage){
  return chatUsageNumber(usage,[
    'cache_read_input_tokens',
    'cache_read_tokens',
    'cache_read',
    'cached_input_tokens',
    'cached_tokens',
    'cacheReadInputTokens',
    'cacheReadTokens',
    'cacheRead',
    'cachedInputTokens',
    'cachedTokens',
    'prompt_tokens_details.cached_tokens',
    'input_tokens_details.cached_tokens',
    'input_token_details.cache_read_input_tokens',
    'input_token_details.cache_read_tokens',
    'input_token_details.cache_read'
  ]);
}
function chatUsageCacheCreate(usage){
  return chatUsageNumber(usage,[
    'cache_creation_input_tokens',
    'cache_creation_tokens',
    'cache_creation',
    'cache_create_input_tokens',
    'cache_create_tokens',
    'cacheCreateInputTokens',
    'cacheCreationInputTokens',
    'cacheCreateTokens',
    'cacheCreationTokens',
    'cacheCreate',
    'cacheCreation'
  ]);
}
function chatUsageCacheHit(usage){
  if(chatUsageCacheRead(usage)>0)return true;
  if(chatUsageNumber(usage,[
    'cache_hit_rounds',
    'cache_hits',
    'cacheHitRounds',
    'cacheHits',
    'hit_rounds',
    'hitRounds'
  ])>0)return true;
  return chatUsageFlag(usage,[
    'cache_hit',
    'cacheHit',
    'cached',
    'cache_matched',
    'cacheMatched',
    'prompt_cache_hit',
    'promptCacheHit'
  ]);
}
function chatMessageBubbleByIndex(i){
  var box=chatMessagesBox();
  if(!box)return null;
  return box.querySelector('.chat-bubble.user[data-i="'+String(i).replace(/"/g,'')+'"]');
}
function chatApplyCacheTick(userIndex,usage,userBubble){
  if(userIndex<0||!chatMessages[userIndex]||chatMessages[userIndex].role!=='user')return;
  var read=chatUsageCacheRead(usage);
  var create=chatUsageCacheCreate(usage);
  chatMessages[userIndex].cacheHit=chatUsageCacheHit(usage);
  chatMessages[userIndex].cacheRead=read;
  chatMessages[userIndex].cacheCreate=create;
  if(!userBubble)userBubble=chatMessageBubbleByIndex(userIndex);
  if(userBubble){
    var row=userBubble.closest?userBubble.closest('.chat-msg-row.user'):null;
    (row||userBubble).querySelectorAll('.chat-cache-tick').forEach(function(old){old.remove()});
    var meta=row?row.querySelector('.chat-msg-meta'):userBubble.querySelector('.chat-msg-meta');
    if(!meta){
      meta=document.createElement('span');
      meta.className='chat-msg-meta';
      var time=document.createElement('span');
      time.className='chat-msg-meta-time';
      time.textContent=chatFullTimeLabel(chatMessages[userIndex].ts);
      meta.appendChild(time);
    }
    if(row&&meta.parentNode!==row){
      var tools=row.querySelector('.chat-msg-tools');
      if(tools&&tools.parentNode===row)tools.insertAdjacentElement('afterend',meta);
      else userBubble.insertAdjacentElement('afterend',meta);
    }else if(!row&&!meta.parentNode){
      userBubble.appendChild(meta);
    }
    meta.insertAdjacentHTML('beforeend',chatCacheTickHtml(chatMessages[userIndex]));
  }
  chatSaveLocalMessages();
}
function chatAddBubble(role,text,persist){
  var box=document.getElementById('chat-messages');
  if(!box)return null;
  if(box.querySelector('.empty-state')||box.querySelector('.chat-welcome'))box.innerHTML='';
  var tip=box.querySelector('.chat-cache-expired-tip:not(.persisted)');
  if(tip)tip.remove();
  var ts=Date.now();
  var row=document.createElement('div');
  row.className='chat-msg-row '+role+' chat-fresh';
  if(role==='assistant'&&!text)row.classList.add('streaming-empty-row');
  var el=document.createElement('div');
  el.className='chat-bubble '+role;
  if(role==='user'){
    el.innerHTML=chatRenderUserMessageContent({role:'user',text:text||'',images:[],cacheHit:false,ts:ts});
  }else{
    el.textContent=text||'';
    if(role==='assistant'&&!text)el.classList.add('streaming-empty');
  }
  row.appendChild(el);
  if(role==='user'){
    var metaWrap=document.createElement('span');
    metaWrap.innerHTML=chatUserMessageMetaHtml({role:'user',text:text||'',images:[],cacheHit:false,ts:ts});
    if(metaWrap.firstChild)row.appendChild(metaWrap.firstChild);
  }else{
    var time=document.createElement('div');
    time.className='chat-msg-time';
    time.textContent=chatFullTimeLabel(ts);
    row.appendChild(time);
  }
  box.appendChild(row);
  chatScrollMessagesBottom(true);
  if(persist){
    var msg={role:role,text:text||'',ts:ts};
    if(role==='user')msg.cacheHit=false;
    chatMessages.push(msg);
    chatSaveLocalMessages();
  }
  return el;
}
function chatClearLocalMessages(){
  chatNewSession();
}
function chatNewSession(){
  var cfg=chatReadForm();
  cfg.sessionId=chatSessionId();
  cfg.memoryPreview='';
  chatActiveSessionId=cfg.sessionId;
  chatMessages=[];
  chatSessions.unshift({id:cfg.sessionId,title:chatDefaultWindowTitle(),messages:[],transportMessages:[],firstUserText:'',firstUserTs:0,created:Date.now(),updated:Date.now()});
  document.getElementById('chat-session-id').value=cfg.sessionId;
  var memoryPack=document.getElementById('chat-memory-pack');
  if(memoryPack)memoryPack.value='';
  chatSaveConfigObject(cfg);
  chatSaveSessions();
  chatRenderSessions();
  chatRenderMessages();
  chatDebug('debug',{session_id:cfg.sessionId,mode:'new_session',history:'empty'});
  chatUpdateRuntime(cfg);
  chatSetStatus();
  toast('已创建新会话');
}
function chatRenameCurrent(){
  var s=chatCurrentSession();
  var name=prompt('对话名称',s.title||'');
  if(name===null)return;
  s.title=(name.trim()||chatNowTitle()).slice(0,40);
  s.updated=Date.now();
  chatSaveSessions();
  chatRenderSessions();
  chatRenderMessages();
  toast('窗口已重命名');
}
function chatParseSse(buffer,onEvent){
  buffer=buffer.replace(/\r\n/g,'\n');
  var idx;
  while((idx=buffer.indexOf('\n\n'))>=0){
    var raw=buffer.slice(0,idx);
    buffer=buffer.slice(idx+2);
    var ev='message',data='';
    raw.split('\n').forEach(function(line){
      if(line.indexOf('event:')===0)ev=line.slice(6).trim();
      else if(line.indexOf('data:')===0)data+=line.slice(5).trim();
    });
    if(data){
      try{onEvent(ev,JSON.parse(data))}
      catch(e){onEvent('error',{error:String(e),raw:data})}
    }
  }
  return buffer;
}
function chatInit(){
  if(chatInitialized)return;
  chatInitialized=true;
  chatAttachPlusGesture();
  document.addEventListener('pointerdown',chatTrackPointerIntent,{passive:true});
  document.addEventListener('touchstart',chatTrackPointerIntent,{passive:true});
  document.addEventListener('pointerdown',chatClosePlusOnOutside,{passive:true});
  document.addEventListener('touchstart',chatClosePlusOnOutside,{passive:true});
  chatLoadDebugRecords();
  chatLoadLocalMessages();
  chatWriteForm(chatLoadConfig());
  if(!apiProvidersLoaded){
    try{
      if(localStorage.getItem(API_KEY_STORAGE))loadApiProviders({silentAuth:true});
    }catch(e){}
  }
  chatLoadWorldbooksRemote(true);
  chatRenderSessions();
  chatRenderMessages();
  chatRenderDraftImages();
  chatAttachMessagesScroll();
  var input=document.getElementById('chat-input');
  chatLayoutCompose();
  window.addEventListener('resize',chatHandleViewportChange);
  if(window.visualViewport){
    window.visualViewport.addEventListener('resize',chatHandleViewportChange);
    window.visualViewport.addEventListener('scroll',chatHandleViewportChange);
  }
  if(!chatCacheTimer)chatCacheTimer=setInterval(function(){chatUpdateCacheExpiryHint(true)},15000);
  if(input){
    chatAutosizeInput(input);
    input.addEventListener('input',function(){
      chatLastInputAt=Date.now();
      chatAutosizeInput(input);
      chatKeepLatestVisible({soft:true});
    });
    input.addEventListener('focus',function(){
      chatInputFocused=true;
      chatLastInputAt=Date.now();
      chatKeepLatestVisible();
    });
    input.addEventListener('blur',function(){
      chatLastBlurAt=Date.now();
      chatInputFocused=false;
      setTimeout(chatMaybeRecoverInputFocus,120);
      setTimeout(function(){
        if(document.activeElement===input)return;
        var pending='';
        try{pending=sessionStorage.getItem('ck_panel_pending_reload')||''}catch(e){}
        if(pending&&!String(input.value||'').trim()){
          showPanelUpdateModal(pending);
        }
      },250);
    });
    input.addEventListener('keydown',function(e){
      if(e.key==='Enter'&&!e.shiftKey){
        e.preventDefault();
        chatStoreDraftMessage({keepFocus:true});
      }
    });
  }
}
async function chatSendMessage(){
  chatInit();
  if(chatSending){chatStopMessage();return;}
  if(chatEditingIndex>=0){
    chatSaveEditedMessage();
    return;
  }
  await chatEnsureSessionsReady();
  var input=document.getElementById('chat-input');
  var text=(input.value||'').trim();
  if(chatImageEncodingCount>0){
    toast('图片处理中');
    return;
  }
  if(text||chatDraftImages.length||chatPendingMessages().length)await chatSubmitPendingMessages();
}
function chatRegenerateFromUser(i){
  if(chatSending)return;
  var m=chatMessages[i];
  if(!m||m.role!=='user'||!chatMessageHasContent(m))return;
  chatMessages=chatMessages.slice(0,i+1);
  chatMessages[i].role='pending_user';
  chatMessages[i].cacheHit=false;
  delete chatMessages[i].cacheRead;
  delete chatMessages[i].cacheCreate;
  chatSaveLocalMessages();
  chatRenderMessages();
  chatSubmitPendingMessages();
}
async function chatSubmitPendingMessages(){
  chatInit();
  if(chatSending){chatStopMessage();return;}
  await chatEnsureSessionsReady();
  var input=document.getElementById('chat-input');
  var extra=(input&&input.value||'').trim();
  var pending=chatPendingMessages();
  var draftImages=chatNormalizeImageList(chatDraftImages);
  var hasPlanned=pending.some(chatMessageHasContent)||!!extra||draftImages.length>0;
  if(!hasPlanned)return;
  if(chatImageEncodingCount>0){
    toast('图片处理中');
    return;
  }
  var route=await chatEnsureMainRouteReady();
  if(!route||!route.ok){
    chatHandleMainRouteNotReady(route);
    return;
  }
  if(extra||draftImages.length){
    input.value='';
    chatAutosizeInput(input);
    chatDraftImages=[];
    chatRenderDraftImages();
    chatMessages.push({role:'pending_user',text:extra,images:draftImages,ts:Date.now()});
  }
  pending=chatPendingMessages();
  var text=pending.map(function(m){return String(m.text||'').trim()}).filter(Boolean).join('\n\n');
  var currentImages=chatFlattenMessageImages(pending);
  if(!text&&!currentImages.length)return;
  var cfg=chatSaveConfig(true);
  cfg=chatApplyMainRouteToConfig(cfg,route);
  chatActiveSessionId=cfg.sessionId;
  chatTogglePlus(false);
  cfg.memoryPreview='';
  var memoryPack=document.getElementById('chat-memory-pack');
  if(memoryPack)memoryPack.value='';
  chatSaveConfigObject(cfg);
  var trimResult=chatApplyAutoTrimBeforeRequest(cfg);
  var windowMessagesForRequest=chatWindowContextMessages();
  var userMessageIndexes=[];
  chatMessages.forEach(function(m,i){
    if(m&&m.role==='pending_user'){
      m.role='user';
      m.cacheHit=false;
      chatMarkMessageFresh(m);
      userMessageIndexes.push(i);
    }
  });
  chatSaveLocalMessages();
  chatRenderMessages();
  var out=chatAddBubble('assistant','',false);
  var btn=document.getElementById('chat-send-btn');
  chatSending=true;
  chatAbort=(typeof AbortController!=='undefined')?new AbortController():null;
  if(btn){btn.disabled=false;btn.textContent='■';btn.title='停止';btn.classList.add('chat-stop-btn')}
  chatSetStatus('正在请求网关...');
  chatUpdateRuntime(cfg);
  var currentSession=chatCurrentSession();
  var imageOnlySummary=currentImages.length?('[图片'+(currentImages.length>1?'x'+currentImages.length:'')+']'):'';
  var anchorText=chatEnsureSessionAnchor(text||imageOnlySummary);
  currentSession=chatCurrentSession();
  var cacheMeta=chatCacheStrategyMeta(cfg.cacheStrategy);
  var cacheStrategy=cacheMeta.value;
  var recallRetention=cacheMeta.retentionSeconds;
  var promptCacheTtl=cacheMeta.ttl;
  var body={
    key:cfg.panelKey,
    session_id:cfg.sessionId,
    text:text,
    model:cfg.model,
    system:chatComposeSystemPrompt(cfg),
    worldbook_pack:chatWorldbookPack(cfg),
    system_prompt_position:chatNormalizeSystemPromptPosition(cfg.systemPromptPosition),
    worldbook_injection_position:chatNormalizeInjectionPosition(cfg.worldbookInjectionPosition,'system_tail'),
    api_base:cfg.apiBase,
    upstream_key:cfg.upstreamKey,
    recall:cfg.recall!==false,
    ck_thinking_enabled:cfg.fakeThinking===true,
    ck_thinking_prompt:cfg.fakeThinking===true?String(cfg.fakeThinkingPrompt||chatDefaultThinkingPrompt()):'',
    ck_thinking_injection_position:chatNormalizeInjectionPosition(cfg.thinkingInjectionPosition,'system_after_anchor'),
    use_mcp:cfg.useMcp===true,
    cache_strategy:cacheStrategy,
    recall_history_retention_seconds:recallRetention,
    session_anchor:{
      first_user_text:anchorText,
      first_user_ts:currentSession.firstUserTs||0
    }
  };
  if(promptCacheTtl)body.prompt_cache_ttl=promptCacheTtl;
  var transportForRequest=chatLimitArray(currentSession.transportMessages||[],CHAT_MAX_TRANSPORT_MESSAGES);
  if(transportForRequest.length)body.transport_messages=transportForRequest;
  if(currentSession.transportUpdated)body.transport_updated_at=currentSession.transportUpdated;
  if(cfg.useMcp===true&&cfg.mcpUrl)body.mcp_url=cfg.mcpUrl;
  if(currentImages.length)body.images=currentImages.map(function(img){
    return {name:img.name||'图片',mime:img.mime||'',dataUrl:img.dataUrl,width:img.width||0,height:img.height||0,size:img.size||0};
  });
  if((cfg.fullWindowContext!==false||trimResult.trimmed)&&!transportForRequest.length)body.window_messages=windowMessagesForRequest;
  body=chatLockGatewayBody(body);
  var assistantText='',recallInfo=null,toolEvents=[];
  try{
    var resp=await fetch(chatEndpoint(cfg),{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify(body),
      signal:chatAbort?chatAbort.signal:undefined
    });
    if(!resp.ok){
      var errText=await resp.text();
      throw new Error('HTTP '+resp.status+' '+errText.slice(0,500));
    }
    if(!resp.body){
      var plain=await resp.text();
      assistantText=plain;
      var plainShouldStick=chatIsMessagesNearBottom();
      out.innerHTML=chatRenderStreamingAssistantContent(plain,toolEvents);
      chatFollowMessagesBottom(plainShouldStick,true,true);
    }else{
      var reader=resp.body.getReader();
      var decoder=new TextDecoder();
      var buffer='';
      while(true){
        var r=await reader.read();
        if(r.done)break;
        buffer+=decoder.decode(r.value,{stream:true});
        buffer=chatParseSse(buffer,function(ev,data){
          if(ev==='delta'){
            assistantText+=data.text||'';
            var streamingEmpty=!chatAssistantStreamingVisibleText(assistantText)&&!toolEvents.length;
            var deltaShouldStick=chatIsMessagesNearBottom();
            out.classList.toggle('streaming-empty',streamingEmpty);
            if(out.parentNode)out.parentNode.classList.toggle('streaming-empty-row',streamingEmpty);
            out.innerHTML=chatRenderStreamingAssistantContent(assistantText,toolEvents);
            chatFollowMessagesBottom(deltaShouldStick,true,true);
          }else if(ev==='memory'){
            recallInfo={chars:data.memory_chars||(data.memory_pack?String(data.memory_pack).length:0),preview:String(data.memory_pack||data.memory_preview||'')};
            document.getElementById('chat-memory-pack').value=recallInfo.preview||'';
            var savedCfg=chatLoadConfig();savedCfg.memoryPreview=recallInfo.preview||'';chatSaveConfigObject(savedCfg);
            chatDebug(ev,{memory_chars:recallInfo.chars,has_memory:!!recallInfo.preview,recall_diag:data.recall_diag||{}});
          }else if(ev==='transport'){
            if(data&&Array.isArray(data.messages)){
              var ts=chatCurrentSession();
              ts.transportMessages=chatLimitArray(data.messages,CHAT_MAX_TRANSPORT_MESSAGES);
              ts.transportUpdated=Date.now();
              ts.updated=Date.now();
              chatSaveSessions();
            }
          }else if(ev==='meta'||ev==='debug'||ev==='usage'||ev==='done'||ev==='tool'){
            chatDebug(ev,data);
            if(ev==='tool'){
              toolEvents=chatUpsertToolEvent(toolEvents,data);
              var stillEmpty=!chatAssistantStreamingVisibleText(assistantText)&&!toolEvents.length;
              var toolShouldStick=chatIsMessagesNearBottom();
              out.classList.toggle('streaming-empty',stillEmpty);
              if(out.parentNode)out.parentNode.classList.toggle('streaming-empty-row',stillEmpty);
              out.innerHTML=chatRenderStreamingAssistantContent(assistantText,toolEvents);
              chatFollowMessagesBottom(toolShouldStick,true,true);
            }
            if(ev==='usage'){
              chatUpdateRuntime(cfg,data||{});
              userMessageIndexes.forEach(function(idx){chatApplyCacheTick(idx,data||{},null)});
            }
            if(ev==='done'&&data&&data.usage)chatUpdateRuntime(cfg,data.usage);
            if(ev==='done'&&data&&data.usage)userMessageIndexes.forEach(function(idx){chatApplyCacheTick(idx,data.usage,null)});
            if(ev==='done'){
              if(data&&Array.isArray(data.transport_messages)){
                var s=chatCurrentSession();
                s.transportMessages=chatLimitArray(data.transport_messages,CHAT_MAX_TRANSPORT_MESSAGES);
                s.transportUpdated=Date.now();
                s.updated=Date.now();
                chatSaveSessions();
              }
              chatSetStatus('完成');
            }
          }else if(ev==='error'){
            throw new Error(data.error||data.message||JSON.stringify(data));
          }
        });
      }
    }
    chatSetStatus('正在显示回复...');
    await chatAppendAssistantReplies(assistantText||'',recallInfo,toolEvents,{anchorEl:out,splitAssistantReplies:cfg.splitAssistantReplies!==false});
    if(out&&out.parentNode)out.parentNode.remove();
    chatSetStatus('完成');
  }catch(e){
    if(e&&e.name==='AbortError'){
      chatMessages.push({role:'assistant',text:assistantText||'（已停止）',recall:recallInfo,tools:chatCloneToolEvents(toolEvents),ts:Date.now()});
      chatSaveLocalMessages();chatRenderMessages({respectUserScroll:true,newMessage:true});chatSetStatus('已停止');
    }else{
      var emsg=(assistantText?assistantText+'\n':'')+chatFriendlyError(e);
      chatMessages.push({role:'assistant',text:emsg,recall:recallInfo,tools:chatCloneToolEvents(toolEvents),ts:Date.now()});
      chatSaveLocalMessages();chatRenderMessages({respectUserScroll:true,newMessage:true});chatSetStatus('请求失败');
    }
  }finally{
    chatSending=false;chatAbort=null;
    if(btn){btn.disabled=false;btn.textContent='↑';btn.title='发送';btn.classList.remove('chat-stop-btn')}
  }
}
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
  document.body.classList.toggle('chat-active',tab==='chat');
  document.querySelectorAll('.panel-tab').forEach(function(el){el.classList.remove('active')});
  document.querySelectorAll('.top-tab,.side-nav-item').forEach(function(el){el.classList.toggle('active',el.getAttribute('data-tab')===tab)});
  var subTabs=document.getElementById('sub-tabs');
  if(subTabs)subTabs.style.display=(tab==='apiconfig')?'grid':'none';
  var panel=document.getElementById('tab-'+tab);
  if(panel)panel.classList.add('active');
  if(tab==='apiconfig'){
    renderApiConfig();
  }
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
  if(tab==='graph'){
    loadEntityGraph(false,true,{preserveView:graphLoaded&&!opts.forceGraphRefresh});
    startEntityGraphRealtime();
  }else{
    stopEntityGraphRealtime();
  }
  if(tab==='status'){
    loadDailyStatus(true);
    startDailyStatusRealtime();
  }else{
    stopDailyStatusRealtime();
  }
  if(tab==='chat'){
    chatInit();
  }
  if(typeof opts.restoreScroll==='number'){
    setTimeout(function(){window.scrollTo(0,opts.restoreScroll)},0);
  }else{
    window.scrollTo(0,0);
  }
}
var memoryRealtimeTimer=null;
var memoryLoadInFlight=false;
var MEMORY_SYNC_INTERVAL_MS=45000;
function hasPendingCategoryWrites(){
  return Object.keys(syncingCategories||{}).some(function(k){return (syncingCategories[k]||0)>0});
}
function normalizeMemoryCategories(text){
  var seen={},out=[];
  String(text||'').split('\n').map(function(x){return x.trim()}).filter(Boolean).forEach(function(cat){
    if(cat==='Empty'||seen[cat])return;
    seen[cat]=true;
    out.push(cat);
  });
  return out;
}
function waitRetryDelay(attempt){
  return wait(Math.min(1600,250*Math.pow(2,attempt||0)));
}
function rpcStrictRetry(tool,args,attempts){
  attempts=attempts||3;
  var run=function(n){
    return rpcStrict(tool,args).catch(function(err){
      if(n>=attempts-1)throw err;
      return waitRetryDelay(n).then(function(){return run(n+1)});
    });
  };
  return run(0);
}
function readMemoryCategoryWithRetry(category){
  return rpcStrictRetry('read_memory',{category:category},3).then(function(raw){
    return {category:category,entries:parseEntries(raw),ok:true};
  }).catch(function(err){
    return {category:category,entries:null,ok:false,error:err};
  });
}
function readMemoryCategoriesLimited(cats,onProgress){
  var limit=3,index=0,done=0,failed=0,results=[];
  return new Promise(function(resolve){
    function launch(){
      while(index<cats.length&&limit>0){
        (function(cat){
          index++;limit--;
          readMemoryCategoryWithRetry(cat).then(function(result){
            results.push(result);
            done++;
            if(!result.ok)failed++;
            if(onProgress)onProgress(done,cats.length,failed,result);
          }).then(function(){
            limit++;
            if(done>=cats.length)resolve({results:results,failed:failed});
            else launch();
          });
        })(cats[index]);
      }
      if(!cats.length)resolve({results:[],failed:0});
    }
    launch();
  });
}
function startMemoryRealtime(){
  stopMemoryRealtime();
  memoryRealtimeTimer=setInterval(function(){
    if(hasPendingCategoryWrites())return;
    loadAll({silent:true,skipCache:true,realtime:true});
  },MEMORY_SYNC_INTERVAL_MS);
}
function stopMemoryRealtime(){
  if(memoryRealtimeTimer){
    clearInterval(memoryRealtimeTimer);
    memoryRealtimeTimer=null;
  }
}
function loadAll(opts){
  opts=opts||{};
  if(memoryLoadInFlight)return Promise.resolve(false);
  memoryLoadInFlight=true;
  var hadCache=false;
  if(!opts.skipCache)hadCache=loadPanelCache();
  if(!hadCache&&!opts.silent)setLoading(4,'正在读取仓库分类...');
  return rpcStrictRetry('list_memories',{},3).then(function(t){
    var cats=normalizeMemoryCategories(t);
    if(!cats.length){
      allData={};allTags=new Set();renderAll();savePanelCache();
      setSyncStatus('仓库暂无记忆');
      if(!opts.silent){setLoading(100,'已同步');hideLoadingSoon(160)}
      return true;
    }
    var previous=allData||{},next={};
    cats.forEach(function(c){next[c]=previous[c]||{entries:[]}});
    allData=next;rebuildTags();renderAll();
    setSyncStatus((opts.realtime?'实时同步中 ':'正在同步 ')+cats.length+' 个分类');
    if(!hadCache&&!opts.silent)hideLoadingSoon(180);
    return readMemoryCategoriesLimited(cats,function(loaded,total,failed,result){
      if(result.ok&&!syncingCategories[result.category]){
        allData[result.category]={entries:result.entries};
      }
      if(!opts.silent&&!hadCache)setLoading(Math.round(loaded/total*100),'同步仓库 '+loaded+'/'+total);
      if(result.ok&&current===result.category&&document.getElementById('page-detail').classList.contains('active')){
        updateSwitchCounts();renderEntries();
      }
      if(loaded===total||(!hadCache&&(loaded===1||loaded%3===0))){
        rebuildTags();renderAll();
      }
    }).then(function(summary){
      rebuildTags();renderAll();savePanelCache();
      var total=cats.length,ok=total-summary.failed;
      setSyncStatus(summary.failed?'已同步 '+ok+'/'+total+'，失败项保留上次内容':'已和 GitHub 仓库同步');
      if(!opts.silent){setLoading(100,'已同步');hideLoadingSoon(120)}
      return summary.failed===0;
    });
  }).catch(function(){
    setSyncStatus(hadCache?'仓库暂时没连上，显示本地缓存':'仓库暂时没连上');
    if(!hadCache){
      allData={};allTags=new Set();renderAll();
      var grid=document.getElementById('cat-grid');
      if(grid)grid.innerHTML='<div class="empty-state">加载失败，请稍后刷新</div>';
    }
    if(!opts.silent)hideLoadingSoon(200);
    return false;
  }).then(function(result){
    memoryLoadInFlight=false;
    return result;
  },function(err){
    memoryLoadInFlight=false;
    throw err;
  });
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

/* ===================== 导航：汉堡侧栏 + API 配置页 (v4) ===================== */
function openSidebar(){
  var d=document.getElementById('side-drawer'),m=document.getElementById('side-drawer-mask');
  if(d)d.classList.add('open');
  if(m)m.classList.add('show');
  document.body.classList.add('drawer-open');
}
function closeSidebar(){
  var d=document.getElementById('side-drawer'),m=document.getElementById('side-drawer-mask');
  if(d)d.classList.remove('open');
  if(m)m.classList.remove('show');
  document.body.classList.remove('drawer-open');
}
function navTo(tab){
  closeSidebar();
  switchPanelTab(tab);
}

/* ---- API 配置：数据结构与状态 ---- */
var API_TABS=[
  {key:'main',label:'主链路',info:'你跟 AI 聊天，话都先经过这里：你说的每句话从这儿发给 AI，AI 的回复也从这儿送回来。这一栏就是设置“用哪个 AI、用哪个账号”。',groups:[
    {key:'main_io',label:'输入与输出',info:'在这里填你要用哪家的 AI、用哪个账号（钥匙），以及默认用它家的哪个模型。想换一家 AI 或换个模型，改这里就行。'}
  ]},
  {key:'memory',label:'记忆',info:'这一栏管“帮你记住事情”：一是把聊天里提到的人和事，自动整理成一张张小卡片；二是把每天聊的内容存起来、剪成小段，方便以后回看。',groups:[
    {key:'mem_profile',label:'小档案',info:'AI 会自动把聊到的人、发生的事，整理成一张张好查的小卡片（这个人是谁、你们之间有过什么）。这里选让哪个 AI 来做这件整理。'},
    {key:'mem_chatlog',label:'Chatlog离线切片',info:'把每天的聊天记录存档，并剪成一小段一小段、每段配一句简短说明，方便以后快速翻找。这里选让哪个 AI 来做这个剪段和写说明。'}
  ]},
  {key:'rolling',label:'滚动',info:'这一栏管“自动整理近况”：放久了的旧近况会被自动概括一下、收进长期记录里，让“最近怎么样”这块始终干净，不会越堆越乱。',groups:[
    {key:'roll_sys',label:'Sys Rolling',info:'把“当前近况”里放了挺久（大概一周以上）的旧条目，自动概括成一两句、并进长期时间线，原来的就收起来。这样“现在的情况”不会越攒越多。这里选让哪个 AI 来做。'},
    {key:'roll_status',label:'状态滚动',info:'每天自动把这一天的情况汇总成一份“今日状态”（也就是你在“状态”那页看到的那份小结）。这里选让哪个 AI 来写这份小结。'}
  ]},
  {key:'recall',label:'召回',info:'这一栏管“想起以前的事”：你一提到什么，系统就能从一大堆记忆里翻出相关的内容递给 AI，让它接得上话、记得住你。这里管翻找时用的工具。',groups:[
    {key:'recall_vector',label:'向量化',info:'把每条记忆变成电脑能比对“意思像不像”的形式。这样哪怕你换种说法，也能把相关的记忆找回来。这里选用哪个服务来做这个转换。'},
    {key:'recall_keyword',label:'关键词辅助',info:'除了按“意思”找，再用关键词兜个底，免得漏掉那些明明提到过、只是换了说法没对上的内容。这里设置相关的服务。'}
  ]}
];
var currentApiTab='main';
var apiProviders={};
var apiProvidersLoaded=false;
var apiProvIdSeq=0;
var pendingProvDel=null;
var RELOAD_CONFIG_URL=GRAPH_API_BASE+'/reload-config';
var PROVIDER_MODELS_URL=GRAPH_API_BASE+'/provider-models';
function newProvId(){apiProvIdSeq++;return 'p'+Date.now().toString(36)+apiProvIdSeq}
function apiGroupSlot(g){
  if(!apiProviders[g]||typeof apiProviders[g]!=='object')apiProviders[g]={providers:[],current:''};
  if(!Array.isArray(apiProviders[g].providers))apiProviders[g].providers=[];
  if(typeof apiProviders[g].current!=='string')apiProviders[g].current='';
  return apiProviders[g];
}
function findApiTab(k){for(var i=0;i<API_TABS.length;i++){if(API_TABS[i].key===k)return API_TABS[i]}return API_TABS[0]}
function findProviderObj(group,id){
  var slot=apiGroupSlot(group);
  for(var i=0;i<slot.providers.length;i++){if(slot.providers[i].id===id)return slot.providers[i]}
  return null;
}
function cleanModelList(list,selected){
  var out=[],seen={};
  function push(v){
    v=String(v||'').trim();
    if(!v||seen[v])return;
    seen[v]=1;out.push(v);
  }
  if(Array.isArray(list))list.forEach(push);
  push(selected);
  return out;
}

function switchApiTab(k){
  currentApiTab=k;
  renderApiConfig();
}

function renderApiConfig(){
  var body=document.getElementById('api-config-body');
  if(!body)return;
  document.querySelectorAll('.sub-tab').forEach(function(el){el.classList.toggle('active',el.getAttribute('data-subtab')===currentApiTab)});
  if(!apiProvidersLoaded){
    body.innerHTML='<div class="empty-state small">读取中...</div>';
    loadApiProviders();
    return;
  }
  var tab=findApiTab(currentApiTab);
  var html='';
  html+='<div class="api-info-row"><button class="api-info-btn" type="button" onclick="toggleInfo(this)" aria-label="说明">i</button>'+
        '<div class="api-info-wrap"><div class="api-info-text">'+esc(tab.info)+'</div></div></div>';
  tab.groups.forEach(function(g){
    var slot=apiGroupSlot(g.key);
    html+='<div class="api-group" data-group="'+escAttr(g.key)+'">';
    html+='<div class="api-group-head"><span class="api-group-title">'+esc(g.label)+'</span>'+
          '<button class="api-info-btn small" type="button" onclick="toggleInfo(this)" aria-label="说明">i</button></div>';
    html+='<div class="api-info-wrap"><div class="api-info-text">'+esc(g.info)+'</div></div>';
    html+='<div class="api-group-cards">';
    if(!slot.providers.length){
      html+='<div class="empty-state small">还没有供应商，点下面的按钮添加。</div>';
    }else{
      slot.providers.forEach(function(p){html+=provCardHtml(g.key,p,slot.current===p.id)});
    }
    html+='</div>';
    html+='<button class="prov-add" type="button" onclick="addProvider(\''+g.key+'\')">+ 添加供应商</button>';
    html+='</div>';
  });
  body.innerHTML=html;
  body.scrollTop=0;
}

function provCardHtml(group,p,isCurrent){
  var name=p.name||'未命名供应商';
  var status=isCurrent
    ?'<span class="prov-status prov-status-on">使用中</span>'
    :'<span class="prov-status prov-status-off">备用</span>';
  var models=cleanModelList(p.models,p.model);
  var modelSelect='<select class="prov-model-select" onchange="pickProvModel(this)">';
  modelSelect+='<option value="">选择已拉取模型</option>';
  models.forEach(function(m){
    modelSelect+='<option value="'+escAttr(m)+'"'+(m===(p.model||'')?' selected':'')+'>'+esc(m)+'</option>';
  });
  modelSelect+='</select>';
  var modelHint=models.length
    ?'<div class="prov-model-hint">已缓存 '+models.length+' 个模型，选择后点保存生效。</div>'
    :'<div class="prov-model-hint">先填 API URL 和 API Key，再拉取模型；也可以直接手填。</div>';
  return '<div class="prov-card" data-group="'+escAttr(group)+'" data-id="'+escAttr(p.id)+'">'+
    '<div class="prov-card-head" onclick="toggleProvCard(this)"><span class="prov-name">'+esc(name)+'</span>'+status+'</div>'+
    '<div class="prov-card-body">'+
      '<div class="prov-row"><label>名称</label><input class="prov-name-input" type="text" value="'+escAttr(p.name||'')+'" placeholder="给这个供应商起个名字"></div>'+
      '<div class="prov-row"><label>API URL</label><input class="prov-url" type="text" value="'+escAttr(p.url||'')+'" placeholder="https://..." autocapitalize="off" spellcheck="false"></div>'+
      '<div class="prov-row"><label>API Key</label><input class="prov-key" type="text" value="'+escAttr(p.key||'')+'" placeholder="sk-..." autocomplete="off" autocapitalize="off" spellcheck="false"></div>'+
      '<div class="prov-row"><label>默认模型</label><input class="prov-model" type="text" value="'+escAttr(p.model||'')+'" placeholder="模型名称" autocapitalize="off" spellcheck="false">'+
        '<div class="prov-model-tools">'+modelSelect+'<button class="prov-fetch-models" type="button" onclick="fetchProviderModels(this)">拉取模型</button></div>'+modelHint+'</div>'+
      '<div class="prov-actions"><button class="btn btn-blue prov-save" type="button" onclick="saveProvider(this)">保存</button><button class="btn btn-outline prov-setcur" type="button" onclick="setProviderCurrent(this)">设为当前使用</button></div>'+
      '<button class="prov-del" type="button" onclick="deleteProvider(this)">删除此供应商</button>'+
    '</div></div>';
}

function toggleInfo(btn){
  var wrap=btn.nextElementSibling;
  if(!wrap||!wrap.classList||!wrap.classList.contains('api-info-wrap')){
    var head=btn.closest('.api-group-head');
    if(head)wrap=head.nextElementSibling;
  }
  if(!wrap||!wrap.classList||!wrap.classList.contains('api-info-wrap'))return;
  var open=wrap.classList.toggle('open');
  btn.classList.toggle('active',open);
}
function toggleProvCard(head){
  var card=head.closest('.prov-card');
  if(card)card.classList.toggle('expanded');
}
function readProvCard(card){
  function v(sel){var el=card.querySelector(sel);return el?el.value:''}
  var group=card.getAttribute('data-group');
  var id=card.getAttribute('data-id');
  var old=findProviderObj(group,id);
  return {
    group:group,
    id:id,
    name:v('.prov-name-input'),
    url:v('.prov-url'),
    key:v('.prov-key'),
    model:v('.prov-model'),
    models:old&&Array.isArray(old.models)?old.models:[]
  };
}
function upsertProvider(group,id){
  var slot=apiGroupSlot(group);
  for(var i=0;i<slot.providers.length;i++){if(slot.providers[i].id===id)return slot.providers[i]}
  var np={id:id,name:'',url:'',key:'',model:'',models:[]};
  slot.providers.push(np);
  return np;
}
function addProvider(group){
  var slot=apiGroupSlot(group);
  var id=newProvId();
  slot.providers.push({id:id,name:'',url:'',key:'',model:'',models:[]});
  renderApiConfig();
  setTimeout(function(){
    var card=document.querySelector('.prov-card[data-id="'+id+'"]');
    if(card){
      card.classList.add('expanded');
      card.scrollIntoView({behavior:'smooth',block:'center'});
      var ni=card.querySelector('.prov-name-input');if(ni)ni.focus();
    }
  },30);
}
function pickProvModel(sel){
  var card=sel.closest('.prov-card');if(!card)return;
  var inp=card.querySelector('.prov-model');if(inp&&sel.value)inp.value=sel.value;
}
function fetchProviderModels(btn){
  var card=btn.closest('.prov-card');if(!card)return;
  var d=readProvCard(card);
  if(!d.url.trim()){toast('先填写 API URL');return}
  if(!d.key.trim()){toast('先填写 API Key');return}
  var p=upsertProvider(d.group,d.id);
  p.name=d.name.trim();p.url=d.url.trim();p.key=d.key.trim();p.model=d.model.trim();
  btn.disabled=true;var old=btn.textContent;btn.textContent='拉取中...';
  fetch(addStoredKey(PROVIDER_MODELS_URL+'?_t='+Date.now()),{
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify({url:p.url,key:p.key})
  }).then(function(r){
    if(r.status===403&&requestApiKey()){
      return fetch(addStoredKey(PROVIDER_MODELS_URL+'?_t='+Date.now()),{
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({url:p.url,key:p.key})
      });
    }
    return r;
  }).then(function(r){
    return r.json().then(function(j){return {ok:r.ok,j:j}},function(){return {ok:r.ok,j:{}}});
  }).then(function(res){
    if(!res.ok||!res.j||!res.j.ok)throw new Error((res.j&&res.j.error)||'拉取失败');
    p.models=cleanModelList(res.j.models,p.model);
    if(!p.model&&p.models.length)p.model=p.models[0];
    toast('已拉取 '+p.models.length+' 个模型');
    renderApiConfig();
    setTimeout(function(){
      var next=document.querySelector('.prov-card[data-id="'+d.id+'"]');
      if(next){next.classList.add('expanded');next.scrollIntoView({behavior:'smooth',block:'center'})}
    },30);
  }).catch(function(e){
    toast((e&&e.message)?e.message:'拉取模型失败');
  }).finally(function(){
    btn.disabled=false;btn.textContent=old;
  });
}
function saveProvider(btn){
  var card=btn.closest('.prov-card');if(!card)return;
  var d=readProvCard(card);
  var p=upsertProvider(d.group,d.id);
  p.name=d.name.trim();p.url=d.url.trim();p.key=d.key.trim();p.model=d.model.trim();
  p.models=cleanModelList(d.models,p.model);
  btn.disabled=true;var old=btn.textContent;btn.textContent='保存中...';
  persistAndReload('已保存并生效').then(function(ok){
    btn.disabled=false;btn.textContent=old;
    if(ok){var nm=card.querySelector('.prov-name');if(nm)nm.textContent=p.name||'未命名供应商'}
  });
}
function setProviderCurrent(btn){
  var card=btn.closest('.prov-card');if(!card)return;
  var d=readProvCard(card);
  var slot=apiGroupSlot(d.group);
  var p=upsertProvider(d.group,d.id);
  p.name=d.name.trim();p.url=d.url.trim();p.key=d.key.trim();p.model=d.model.trim();
  p.models=cleanModelList(d.models,p.model);
  slot.current=d.id;
  btn.disabled=true;var old=btn.textContent;btn.textContent='切换中...';
  persistAndReload('已设为当前使用').then(function(){
    btn.disabled=false;btn.textContent=old;
    renderApiConfig();
  });
}
function deleteProvider(btn){
  var card=btn.closest('.prov-card');if(!card)return;
  var group=card.getAttribute('data-group'),id=card.getAttribute('data-id');
  var slot=apiGroupSlot(group);
  if(slot.current===id){toast('请先切换到其他供应商再删除');return}
  pendingProvDel={group:group,id:id};
  var m=document.getElementById('provDelModal');if(m)m.classList.add('show');
}
function closeProvDel(){
  pendingProvDel=null;
  var m=document.getElementById('provDelModal');if(m)m.classList.remove('show');
}
function confirmProvDel(){
  if(!pendingProvDel){closeProvDel();return}
  var group=pendingProvDel.group,id=pendingProvDel.id;
  var slot=apiGroupSlot(group);
  slot.providers=slot.providers.filter(function(x){return x.id!==id});
  if(slot.current===id)slot.current='';
  closeProvDel();
  persistAndReload('已删除').then(function(){renderApiConfig()});
}

function persistApiProviders(){
  return keyCfgFetch({method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({updates:{API_PROVIDERS:apiProviders}})})
    .then(function(r){return r.json().then(function(j){return {ok:r.ok,j:j}},function(){return {ok:r.ok,j:{}}})});
}
function reloadGatewayConfig(){
  var u=function(){return addStoredKey(RELOAD_CONFIG_URL+'?_t='+Date.now())};
  return fetch(u(),{method:'POST'}).then(function(r){
    if(r.status===403&&requestApiKey())return fetch(u(),{method:'POST'});
    return r;
  });
}
function persistAndReload(okMsg){
  return persistApiProviders().then(function(res){
    if(!res.ok){toast('保存失败：'+((res.j&&res.j.error)||''));return false}
    return reloadGatewayConfig().then(function(){toast(okMsg||'已保存并生效');return true},function(){toast('已保存，但刷新配置失败（稍后会自动生效）');return true});
  }).catch(function(){toast('保存失败，检查网络');return false});
}
function loadApiProviders(){
  keyCfgFetch().then(function(r){if(!r.ok)throw new Error('HTTP '+r.status);return r.json()}).then(function(d){
    var prov=(d&&d.providers&&typeof d.providers==='object'&&!Array.isArray(d.providers))?d.providers:{};
    apiProviders=prov;
    apiProvidersLoaded=true;
    renderApiConfig();
  }).catch(function(){
    var body=document.getElementById('api-config-body');
    if(body)body.innerHTML='<div class="entity-error">读不到配置。确认网关已部署、面板 key 正确。</div>'+
      '<button class="prov-add" type="button" style="margin-top:14px" onclick="apiProvidersLoaded=false;renderApiConfig()">重新读取</button>';
  });
}

/* ---- API 配置：供应商库 + 功能选择（新版） ---- */
var API_PROVIDER_LIBRARY_KEY='provider_library';
API_TABS=[
  {key:'providers',label:'供应商',kind:'providers',info:'先在这里维护可用的 API 供应商。每个供应商只保存一次，模型也在这里拉取；下面的功能页只负责选择用哪个供应商。'},
  {key:'main',label:'主链路',info:'你跟 AI 聊天，话都先经过这里：你说的每句话从这儿发给 AI，AI 的回复也从这儿送回来。这一栏就是设置“用哪个 AI、用哪个模型”。',groups:[
    {key:'main_io',label:'输入与输出',info:'选择聊天主链路要使用的供应商和默认模型。供应商本身在“供应商”页维护。'}
  ]},
  {key:'memory',label:'记忆',info:'这一栏管“帮你记住事情”：一是把聊天里提到的人和事，自动整理成一张张小卡片；二是把每天聊的内容存起来、剪成一小段一小段、每段配一句简短说明，方便以后回看。',groups:[
    {key:'mem_profile',label:'小档案',info:'AI 会自动把聊到的人、发生的事，整理成一张张好查的小卡片。这里直接选择负责整理小档案的供应商和模型。'},
    {key:'mem_chatlog',label:'Chatlog离线切片',info:'把每天的聊天记录存档，并剪成一小段一小段。这里直接选择负责切片和写摘要的供应商和模型。'}
  ]},
  {key:'rolling',label:'滚动',info:'这一栏管“自动整理近况”：放久了的旧近况会被自动概括一下、收进长期记录里，让“最近怎么样”这块始终干净。',groups:[
    {key:'roll_sys',label:'Sys Rolling',info:'把“当前近况”里放了挺久的旧条目，自动概括并进长期时间线。这里选择负责这个任务的供应商和模型。'},
    {key:'roll_status',label:'状态滚动',info:'每天自动把这一天的情况汇总成一份“今日状态”。这里选择负责写状态的供应商和模型。'}
  ]},
  {key:'recall',label:'召回',info:'这一栏管“想起以前的事”：你一提到什么，系统就能从记忆里翻出相关内容递给 AI。',groups:[
    {key:'recall_vector',label:'向量化',info:'把每条记忆变成电脑能比对“意思像不像”的形式。这里选择向量化服务供应商和模型。'},
    {key:'recall_keyword',label:'关键词辅助',info:'除了按“意思”找，再用关键词兜底，减少漏召回。这里选择关键词辅助服务。'}
  ]}
];
currentApiTab='providers';
apiProviders={};
apiProvidersLoaded=false;
apiProvIdSeq=0;
pendingProvDel=null;

function allApiGroups(){
  var out=[];
  API_TABS.forEach(function(t){(t.groups||[]).forEach(function(g){out.push(g)})});
  return out;
}
function findApiGroup(k){
  var groups=allApiGroups();
  for(var i=0;i<groups.length;i++){if(groups[i].key===k)return groups[i]}
  return null;
}
function apiProviderLibrarySlot(){
  if(!apiProviders||typeof apiProviders!=='object'||Array.isArray(apiProviders))apiProviders={};
  if(!apiProviders[API_PROVIDER_LIBRARY_KEY]||typeof apiProviders[API_PROVIDER_LIBRARY_KEY]!=='object'||Array.isArray(apiProviders[API_PROVIDER_LIBRARY_KEY])){
    apiProviders[API_PROVIDER_LIBRARY_KEY]={providers:[]};
  }
  var slot=apiProviders[API_PROVIDER_LIBRARY_KEY];
  if(!Array.isArray(slot.providers))slot.providers=[];
  return slot;
}
function apiGroupSlot(g){
  if(!apiProviders[g]||typeof apiProviders[g]!=='object'||Array.isArray(apiProviders[g]))apiProviders[g]={current:'',model:''};
  apiProviders[g].current=String(apiProviders[g].current||'');
  apiProviders[g].model=String(apiProviders[g].model||'');
  delete apiProviders[g].providers;
  return apiProviders[g];
}
function normalizeProvider(p){
  p=p&&typeof p==='object'&&!Array.isArray(p)?p:{};
  return {
    id:String(p.id||'').trim()||newProvId(),
    name:String(p.name||'').trim(),
    url:String(p.url||'').trim(),
    key:String(p.key||'').trim(),
    model:String(p.model||'').trim(),
    models:cleanModelList(p.models,p.model)
  };
}
function providerFingerprint(p){
  var url=String(p&&p.url||'').trim().toLowerCase();
  var key=String(p&&p.key||'').trim();
  return (url||key)?(url+'\n'+key):String(p&&p.id||'');
}
function addProviderToLibrary(raw){
  var slot=apiProviderLibrarySlot();
  var p=normalizeProvider(raw);
  var fp=providerFingerprint(p);
  for(var i=0;i<slot.providers.length;i++){
    var old=slot.providers[i];
    if(old.id===p.id||providerFingerprint(old)===fp){
      old.name=old.name||p.name;
      old.url=old.url||p.url;
      old.key=old.key||p.key;
      old.model=old.model||p.model;
      old.models=cleanModelList((old.models||[]).concat(p.models||[]),old.model||p.model);
      return old.id;
    }
  }
  slot.providers.push(p);
  return p.id;
}
function normalizeApiProviders(raw){
  apiProviders=(raw&&typeof raw==='object'&&!Array.isArray(raw))?raw:{};
  var sourceProviders=[];
  var existingLibrary=apiProviders[API_PROVIDER_LIBRARY_KEY];
  if(existingLibrary&&typeof existingLibrary==='object'&&!Array.isArray(existingLibrary)&&Array.isArray(existingLibrary.providers)){
    sourceProviders=sourceProviders.concat(existingLibrary.providers);
  }
  var oldGroupRefs=[];
  var oldCurrentMap={};
  allApiGroups().forEach(function(g){
    var slot=apiProviders[g.key];
    if(slot&&typeof slot==='object'&&!Array.isArray(slot)&&Array.isArray(slot.providers)){
      var current=String(slot.current||'');
      slot.providers.forEach(function(p){
        sourceProviders.push(p);
        oldGroupRefs.push({group:g.key,current:current,provider:p});
      });
    }
  });
  var library=apiProviderLibrarySlot();
  library.providers=[];
  sourceProviders.forEach(function(p){addProviderToLibrary(p)});
  oldGroupRefs.forEach(function(ref){
    var p=ref.provider;
    if(String(p&&p.id||'')===ref.current){
      oldCurrentMap[ref.group]={id:addProviderToLibrary(p),model:String(p.model||'')};
    }
  });
  allApiGroups().forEach(function(g){
    var slot=apiProviders[g.key];
    if(!slot||typeof slot!=='object'||Array.isArray(slot))slot=apiProviders[g.key]={};
    if(oldCurrentMap[g.key]){
      slot.current=oldCurrentMap[g.key].id;
      if(!slot.model)slot.model=oldCurrentMap[g.key].model;
    }
    slot.current=String(slot.current||'');
    slot.model=String(slot.model||'');
    delete slot.providers;
  });
}
function providerLibraryList(){return apiProviderLibrarySlot().providers}
function findLibraryProvider(id){
  id=String(id||'');
  var list=providerLibraryList();
  for(var i=0;i<list.length;i++){if(String(list[i].id)===id)return list[i]}
  return null;
}
function providerHost(url){
  try{return new URL(String(url||'')).host}catch(e){return String(url||'').replace(/^https?:\/\//,'').split('/')[0]}
}
function providerDisplayName(p){return (p&&p.name)||providerHost(p&&p.url)||'未命名供应商'}
function providerUsage(id){
  var used=[];
  allApiGroups().forEach(function(g){if(apiGroupSlot(g.key).current===id)used.push(g.label)});
  return used;
}
function apiConfigStats(){
  var providers=providerLibraryList(),groups=allApiGroups();
  var configured=0,modelCount=0,usedProviders={};
  groups.forEach(function(g){
    var slot=apiGroupSlot(g.key);
    if(slot.current){configured++;usedProviders[slot.current]=1}
  });
  providers.forEach(function(p){modelCount+=cleanModelList(p.models,p.model).length});
  return {providers:providers.length,used:Object.keys(usedProviders).length,configured:configured,total:groups.length,models:modelCount};
}
function apiPageHeadHtml(title,subtitle,actionHtml){
  var s=apiConfigStats();
  return '<div class="api-page-head"><div class="api-page-title"><h2>'+esc(title)+'</h2><p>'+esc(subtitle)+'</p><div class="api-page-stats">'+
    '<span>'+s.providers+' 供应商</span><span>'+s.configured+'/'+s.total+' 已绑定</span><span>'+s.models+' 模型</span>'+
    '</div></div><div class="api-page-actions">'+(actionHtml||'')+'</div></div>';
}
function modelOptionsHtml(models,selected){
  var html='<option value="">选择已拉取模型</option>';
  cleanModelList(models,selected).forEach(function(m){
    html+='<option value="'+escAttr(m)+'"'+(m===selected?' selected':'')+'>'+esc(m)+'</option>';
  });
  return html;
}
function modelSearchHtml(models){
  var has=cleanModelList(models,'').length>0;
  return '<input class="prov-model-search" type="search" value="" placeholder="'+(has?'搜索模型':'拉取模型后可搜索')+'" oninput="filterModelOptions(this)" autocomplete="off" autocapitalize="off" spellcheck="false"'+(has?'':' disabled')+'>';
}
function filterModelOptions(input){
  var wrap=input&&input.closest?input.closest('.prov-model-picker'):null;
  var sel=wrap?wrap.querySelector('select'):null;
  if(!sel)return;
  var q=String(input.value||'').trim().toLowerCase();
  for(var i=0;i<sel.options.length;i++){
    var opt=sel.options[i];
    if(!opt.value){opt.hidden=false;continue}
    var text=(opt.textContent||opt.value||'').toLowerCase();
    opt.hidden=!!q&&text.indexOf(q)<0;
  }
}
function setModelSearchState(scope,models){
  var input=scope&&scope.querySelector?scope.querySelector('.prov-model-search'):null;
  if(!input)return;
  var has=cleanModelList(models,'').length>0;
  input.value='';
  input.disabled=!has;
  input.placeholder=has?'搜索模型':'拉取模型后可搜索';
  filterModelOptions(input);
}
function providerOptionsHtml(selected){
  var html='<option value="">不选择</option>';
  providerLibraryList().forEach(function(p){
    html+='<option value="'+escAttr(p.id)+'"'+(p.id===selected?' selected':'')+'>'+esc(providerDisplayName(p))+'</option>';
  });
  return html;
}
function renderApiConfig(){
  var body=document.getElementById('api-config-body');
  if(!body)return;
  document.querySelectorAll('.sub-tab').forEach(function(el){el.classList.toggle('active',el.getAttribute('data-subtab')===currentApiTab)});
  if(!apiProvidersLoaded){
    body.innerHTML='<div class="empty-state small">读取中...</div>';
    loadApiProviders();
    return;
  }
  var tab=findApiTab(currentApiTab);
  body.innerHTML=tab.kind==='providers'?renderProviderLibrary():renderApiAssignments(tab);
  body.scrollTop=0;
  chatRenderMainRouteSummary();
  chatUpdateRuntime(chatLoadConfig());
}
function renderApiIntro(tab){
  return '<div class="api-info-row"><button class="api-info-btn" type="button" onclick="toggleInfo(this)" aria-label="说明">i</button><div class="api-info-wrap"><div class="api-info-text">'+esc(tab.info||'')+'</div></div></div>';
}
function renderProviderLibrary(){
  var tab=findApiTab('providers'),list=providerLibraryList();
  var html=apiPageHeadHtml('供应商库','维护 API URL / Key 和模型列表。','<button class="prov-add compact" type="button" onclick="addProvider()">添加供应商</button>');
  html+=renderApiIntro(tab);
  if(!list.length){
    html+='<div class="api-empty-callout"><b>还没有供应商</b><p>先添加一个供应商，再到主链路、记忆、滚动或召回页选择它。</p><button class="prov-add" type="button" onclick="addProvider()">添加供应商</button></div>';
  }else{
    html+='<div class="api-provider-list">';
    list.forEach(function(p){html+=providerCardHtml(p)});
    html+='</div>';
  }
  return html;
}
function providerCardHtml(p){
  var usage=providerUsage(p.id);
  var usageHtml=usage.length?'<div class="prov-usage">'+usage.map(function(x){return '<span>'+esc(x)+'</span>'}).join('')+'</div>':'';
  var models=cleanModelList(p.models,p.model);
  var modelHint=models.length?'<div class="prov-model-hint">已缓存 '+models.length+' 个模型。默认模型会作为新功能选择的初始值。</div>':'<div class="prov-model-hint">先填 API URL 和 API Key，再拉取模型；也可以直接手填默认模型。</div>';
  var usedLabel=usage.length?(usage.length+' 处使用'):'未使用';
  return '<div class="prov-card" data-id="'+escAttr(p.id)+'">'+
    '<div class="prov-card-head" onclick="toggleProvCard(this)"><div class="prov-title-wrap"><span class="prov-name">'+esc(providerDisplayName(p))+'</span><small>'+esc(providerHost(p.url)||'未填写 URL')+'</small></div><div class="prov-card-badges"><span class="prov-status prov-status-model">'+models.length+' 模型</span><span class="prov-status '+(usage.length?'prov-status-on':'prov-status-off')+'">'+usedLabel+'</span></div></div>'+
    usageHtml+
    '<div class="prov-card-body">'+
      '<div class="prov-row"><label>名称</label><input class="prov-name-input" type="text" value="'+escAttr(p.name||'')+'" placeholder="给这个供应商起个名字"></div>'+
      '<div class="prov-row"><label>API Key</label><input class="prov-key" type="text" value="'+escAttr(p.key||'')+'" placeholder="sk-..." autocomplete="off" autocapitalize="off" spellcheck="false"></div>'+
      '<div class="prov-row prov-row-wide"><label>API URL</label><input class="prov-url" type="text" value="'+escAttr(p.url||'')+'" placeholder="https://..." autocapitalize="off" spellcheck="false"></div>'+
      '<div class="prov-row prov-row-wide"><label>默认模型</label><input class="prov-model" type="text" value="'+escAttr(p.model||'')+'" placeholder="模型名称" autocapitalize="off" spellcheck="false"><div class="prov-model-tools"><div class="prov-model-picker">'+modelSearchHtml(models)+'<select class="prov-model-select" onchange="pickProvModel(this)">'+modelOptionsHtml(models,p.model)+'</select></div><button class="prov-fetch-models" type="button" onclick="fetchProviderModels(this)">拉取模型</button></div>'+modelHint+'</div>'+
      '<div class="prov-actions"><button class="btn btn-blue prov-save" type="button" onclick="saveProvider(this)">保存供应商</button></div>'+
      '<button class="prov-del" type="button" onclick="deleteProvider(this)">删除此供应商</button>'+
    '</div></div>';
}
function renderApiAssignments(tab){
  var list=providerLibraryList();
  var html=apiPageHeadHtml(tab.label,'选择此类任务使用的供应商和模型。','');
  html+=renderApiIntro(tab);
  if(!list.length){
    html+='<div class="api-empty-callout"><b>先添加供应商</b><p>功能页只负责选择供应商；请到供应商页新增 API URL / Key。</p><button class="prov-add" type="button" onclick="switchApiTab(\'providers\')">去添加供应商</button></div>';
    return html;
  }
  (tab.groups||[]).forEach(function(g){html+=assignmentCardHtml(g)});
  return html;
}
function assignmentCardHtml(g){
  var slot=apiGroupSlot(g.key),p=findLibraryProvider(slot.current);
  var selectedModel=slot.model||(p&&p.model)||'';
  var models=p?cleanModelList(p.models,selectedModel):[];
  var providerText=p?('当前供应商：'+providerDisplayName(p)+' · '+(providerHost(p.url)||'未填写 URL')):'当前未选择供应商';
  return '<div class="api-assign-card" data-group="'+escAttr(g.key)+'">'+
    '<div class="api-group-head"><span class="api-group-title">'+esc(g.label)+'</span><button class="api-info-btn small" type="button" onclick="toggleInfo(this)" aria-label="说明">i</button></div>'+
    '<div class="api-info-wrap"><div class="api-info-text">'+esc(g.info)+'</div></div>'+
    '<div class="api-assign-summary'+(p?'':' empty')+'">'+esc(providerText)+'</div>'+
    '<div class="api-assign-grid"><label><span>供应商</span><select class="assign-provider" onchange="onAssignProviderChange(this)">'+providerOptionsHtml(slot.current)+'</select></label><label><span>模型</span><input class="assign-model" type="text" value="'+escAttr(selectedModel)+'" placeholder="模型名称" autocapitalize="off" spellcheck="false"></label></div>'+
    '<div class="prov-model-tools"><div class="prov-model-picker">'+modelSearchHtml(models)+'<select class="assign-model-select" onchange="pickAssignModel(this)">'+modelOptionsHtml(models,selectedModel)+'</select></div><button class="prov-fetch-models" type="button" onclick="fetchAssignmentModels(this)">拉取模型</button></div>'+
    '<div class="prov-model-hint">'+(models.length?'已缓存 '+models.length+' 个模型，可直接选择。':'选择供应商后可拉取模型，也可以手填模型名。')+'</div>'+
    '<div class="prov-actions"><button class="btn btn-blue prov-save" type="button" onclick="saveAssignment(this)">保存选择</button></div>'+
  '</div>';
}
function readProvCard(card){
  function v(sel){var el=card.querySelector(sel);return el?el.value:''}
  var id=card.getAttribute('data-id');
  var old=findLibraryProvider(id);
  return {id:id,name:v('.prov-name-input'),url:v('.prov-url'),key:v('.prov-key'),model:v('.prov-model'),models:old&&Array.isArray(old.models)?old.models:[]};
}
function addProvider(){
  switchApiTab('providers');
  var id=newProvId();
  apiProviderLibrarySlot().providers.push({id:id,name:'',url:'',key:'',model:'',models:[]});
  renderApiConfig();
  setTimeout(function(){
    var card=document.querySelector('.prov-card[data-id="'+id+'"]');
    if(card){card.classList.add('expanded');card.scrollIntoView({behavior:'smooth',block:'center'});var ni=card.querySelector('.prov-name-input');if(ni)ni.focus()}
  },30);
}
function pickAssignModel(sel){
  var row=sel.closest('.api-assign-card');if(!row)return;
  var inp=row.querySelector('.assign-model');if(inp&&sel.value)inp.value=sel.value;
}
function fetchModelsForProvider(p){
  return fetch(addStoredKey(PROVIDER_MODELS_URL+'?_t='+Date.now()),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({url:p.url,key:p.key})}).then(function(r){
    if(r.status===403&&requestApiKey())return fetch(addStoredKey(PROVIDER_MODELS_URL+'?_t='+Date.now()),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({url:p.url,key:p.key})});
    return r;
  }).then(function(r){return r.json().then(function(j){return {ok:r.ok,j:j}},function(){return {ok:r.ok,j:{}}})}).then(function(res){
    if(!res.ok||!res.j||!res.j.ok)throw new Error((res.j&&res.j.error)||'拉取失败');
    return cleanModelList(res.j.models,p.model);
  });
}
function fetchProviderModels(btn){
  var card=btn.closest('.prov-card');if(!card)return;
  var d=readProvCard(card);
  if(!d.url.trim()){toast('先填写 API URL');return}
  if(!d.key.trim()){toast('先填写 API Key');return}
  var p=findLibraryProvider(d.id)||{};
  p.id=d.id;p.name=d.name.trim();p.url=d.url.trim();p.key=d.key.trim();p.model=d.model.trim();
  btn.disabled=true;var old=btn.textContent;btn.textContent='拉取中...';
  fetchModelsForProvider(p).then(function(models){
    p.models=cleanModelList(models,p.model);
    if(!p.model&&p.models.length)p.model=p.models[0];
    addProviderToLibrary(p);
    return persistAndReload('已拉取 '+p.models.length+' 个模型');
  }).then(function(){renderApiConfig();setTimeout(function(){var next=document.querySelector('.prov-card[data-id="'+d.id+'"]');if(next)next.classList.add('expanded')},30)})
    .catch(function(e){toast((e&&e.message)?e.message:'拉取模型失败')})
    .finally(function(){btn.disabled=false;btn.textContent=old});
}
function saveProvider(btn){
  var card=btn.closest('.prov-card');if(!card)return;
  var d=readProvCard(card);
  var p=findLibraryProvider(d.id);
  if(!p){apiProviderLibrarySlot().providers.push(normalizeProvider(d));p=findLibraryProvider(d.id)}
  p.name=d.name.trim();p.url=d.url.trim();p.key=d.key.trim();p.model=d.model.trim();p.models=cleanModelList(d.models,p.model);
  btn.disabled=true;var old=btn.textContent;btn.textContent='保存中...';
  persistAndReload('供应商已保存').then(function(ok){btn.disabled=false;btn.textContent=old;if(ok)renderApiConfig()});
}
function deleteProvider(btn){
  var card=btn.closest('.prov-card');if(!card)return;
  var id=card.getAttribute('data-id');
  var used=providerUsage(id);
  if(used.length){toast('先在 '+used.join('、')+' 切换供应商');return}
  pendingProvDel={id:id};
  var m=document.getElementById('provDelModal');if(m)m.classList.add('show');
}
function confirmProvDel(){
  if(!pendingProvDel){closeProvDel();return}
  var id=pendingProvDel.id,slot=apiProviderLibrarySlot();
  slot.providers=slot.providers.filter(function(x){return x.id!==id});
  closeProvDel();
  persistAndReload('已删除供应商').then(function(){renderApiConfig()});
}
function readAssignmentRow(row){
  function v(sel){var el=row.querySelector(sel);return el?el.value:''}
  return {group:row.getAttribute('data-group'),providerId:v('.assign-provider'),model:v('.assign-model')};
}
function onAssignProviderChange(sel){
  var row=sel.closest('.api-assign-card');if(!row)return;
  var p=findLibraryProvider(sel.value);
  var input=row.querySelector('.assign-model');if(input)input.value=(p&&p.model)||'';
  var ms=row.querySelector('.assign-model-select');if(ms)ms.innerHTML=modelOptionsHtml(p?p.models:[],(p&&p.model)||'');
  setModelSearchState(row,p?p.models:[]);
  var summary=row.querySelector('.api-assign-summary');if(summary)summary.textContent=p?('当前供应商：'+providerDisplayName(p)+' · '+(providerHost(p.url)||'未填写 URL')):'当前未选择供应商';
  var hint=row.querySelector('.prov-model-hint');
  if(hint){
    var models=p?cleanModelList(p.models,(p&&p.model)||''):[];
    hint.textContent=models.length?'已缓存 '+models.length+' 个模型，可直接选择。':'选择供应商后可拉取模型，也可以手填模型名。';
  }
}
function saveAssignment(btn){
  var row=btn.closest('.api-assign-card');if(!row)return;
  var d=readAssignmentRow(row),slot=apiGroupSlot(d.group);
  slot.current=d.providerId;slot.model=d.model.trim();
  btn.disabled=true;var old=btn.textContent;btn.textContent='保存中...';
  persistAndReload(d.providerId?'选择已保存':'已清空选择').then(function(){btn.disabled=false;btn.textContent=old;renderApiConfig()});
}
function fetchAssignmentModels(btn){
  var row=btn.closest('.api-assign-card');if(!row)return;
  var d=readAssignmentRow(row),p=findLibraryProvider(d.providerId);
  if(!p){toast('先选择供应商');return}
  if(!p.url){toast('供应商缺少 API URL');return}
  if(!p.key){toast('供应商缺少 API Key');return}
  var slot=apiGroupSlot(d.group);
  slot.current=d.providerId;slot.model=d.model.trim()||slot.model;
  btn.disabled=true;var old=btn.textContent;btn.textContent='拉取中...';
  fetchModelsForProvider(p).then(function(models){
    p.models=cleanModelList(models,slot.model||p.model);
    if(!slot.model&&p.model)slot.model=p.model;
    if(!slot.model&&p.models.length)slot.model=p.models[0];
    if(!p.model&&p.models.length)p.model=p.models[0];
    return persistAndReload('模型已拉取并保存');
  }).then(function(){renderApiConfig()})
    .catch(function(e){toast((e&&e.message)?e.message:'拉取模型失败')})
    .finally(function(){btn.disabled=false;btn.textContent=old});
}
function loadApiProviders(opts){
  return keyCfgFetch(undefined,opts||{}).then(function(r){if(!r.ok)throw new Error('HTTP '+r.status);return r.json()}).then(function(d){
    var prov=(d&&d.providers&&typeof d.providers==='object'&&!Array.isArray(d.providers))?d.providers:{};
    normalizeApiProviders(prov);
    apiProvidersLoaded=true;
    renderApiConfig();
    chatRenderMainRouteSummary();
    chatUpdateRuntime(chatLoadConfig());
    return true;
  }).catch(function(){
    apiProvidersLoaded=false;
    var body=document.getElementById('api-config-body');
    if(body)body.innerHTML='<div class="entity-error">读不到配置。确认网关已部署、面板 key 正确。</div><button class="prov-add" type="button" style="margin-top:14px" onclick="apiProvidersLoaded=false;renderApiConfig()">重新读取</button>';
    chatRenderMainRouteSummary();
    chatUpdateRuntime(chatLoadConfig());
    return false;
  });
}

init();
