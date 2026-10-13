(function(root){
  'use strict';
  var key='ckBackendRouteV1';
  var servers={cn:'https://123.57.175.84:18443',us:'https://tlomcc.cc.cd:18443'};
  var defaults={mode:'vps',gateway:servers.cn+'/gateway',mcp:servers.cn+'/mcp',execution:'claude_code_api',subscriptionModel:'sonnet',server:'cn'};
  function serverOf(route){
    if(route&&route.gateway===servers.cn+'/gateway'&&route.mcp===servers.cn+'/mcp')return 'cn';
    if(route&&((route.gateway===servers.us+'/gateway'&&route.mcp===servers.us+'/mcp')||(route.gateway==='https://tlomcc.us.ci:18443/gateway'&&route.mcp==='https://tlomcc.us.ci:18443/mcp')))return 'us';
    return 'custom';
  }
  function normalize(value){
    var url=new URL(String(value||'').trim());
    if(url.username||url.password||url.search||url.hash)throw new Error('地址不能包含密钥、账号、查询参数或片段。');
    var local=['localhost','127.0.0.1','[::1]'].indexOf(url.hostname)>=0;
    if(url.protocol!=='https:'&&!(local&&url.protocol==='http:'))throw new Error('公网地址请使用 HTTPS；HTTP 仅允许本机隧道。');
    return url.href.replace(/\/+$/,'');
  }
  function parse(saved){
    if(!saved||saved.mode!=='vps')return Object.assign({},defaults);
    var execution=saved.execution||'direct_api';
    if(['direct_api','claude_code_api','claude_code_subscription'].indexOf(execution)<0)throw new Error('未知聊天执行路径');
    var model=String(saved.subscriptionModel||'sonnet').trim();
    if(!/^(sonnet|opus|haiku|claude-[a-zA-Z0-9._-]{1,100})$/.test(model))throw new Error('请填写官方 Claude 模型名或 sonnet、opus、haiku');
    var route={mode:'vps',gateway:normalize(saved.gateway),mcp:normalize(saved.mcp),execution:execution,subscriptionModel:model};
    var server=serverOf(route);
    if(server==='us'&&!saved.server&&execution!=='claude_code_subscription'){
      route.gateway=defaults.gateway;route.mcp=defaults.mcp;server='cn';
    }
    if(server==='cn'&&execution==='claude_code_subscription')throw new Error('国内 VPS 只提供 API 路线；订阅请选择美国 VPS。');
    if(server!=='custom')route.server=server;
    return route;
  }
  var current=Object.assign({},defaults),saved;
  try{saved=JSON.parse(root.localStorage.getItem(key)||'null');current=parse(saved)}catch(e){}
  if(!saved&&root.location&&root.location.hostname==='127.0.0.1'&&root.location.port==='19080'){
    current={mode:'vps',gateway:root.location.origin+'/gateway',mcp:root.location.origin+'/mcp'};
  }
  function storageValue(route){var value={mode:route.mode,gateway:route.gateway,mcp:route.mcp,execution:route.execution||'direct_api',subscriptionModel:route.subscriptionModel||'sonnet'};if(serverOf(route)!=='custom')value.server=serverOf(route);return JSON.stringify(value)}
  var routeHintSignature='';
  function routeHintOrigins(route){
    if(!route||route.mode!=='vps')return [];
    var seen={},origins=[];
    [route.gateway,route.mcp].forEach(function(value){
      try{
        var url=new URL(String(value||'')),origin=url.origin;
        if(!origin||origin==='null'||seen[origin])return;
        seen[origin]=true;origins.push({origin:origin,host:url.hostname});
      }catch(e){}
    });
    return origins;
  }
  function refreshRouteHints(route,force){
    if(typeof document!=='object'||!document.head||typeof document.createElement!=='function'||typeof document.querySelectorAll!=='function')return;
    var origins=routeHintOrigins(route),signature=origins.map(function(item){return item.origin}).join('|');
    if(!force&&signature===routeHintSignature)return;
    var old=document.querySelectorAll('link[data-ck-route-hint]');
    for(var i=old.length-1;i>=0;i--){
      if(old[i]&&typeof old[i].remove==='function')old[i].remove();
      else if(old[i]&&old[i].parentNode)old[i].parentNode.removeChild(old[i]);
    }
    origins.forEach(function(item){
      var dns=document.createElement('link');
      dns.rel='dns-prefetch';dns.href='//'+item.host;dns.setAttribute('data-ck-route-hint','dns');
      document.head.appendChild(dns);
      var preconnect=document.createElement('link');
      preconnect.rel='preconnect';preconnect.href=item.origin;preconnect.crossOrigin='anonymous';
      preconnect.setAttribute('crossorigin','anonymous');preconnect.setAttribute('data-ck-route-hint','preconnect');
      document.head.appendChild(preconnect);
    });
    routeHintSignature=signature;
  }
  async function probe(route,authKey,fetcher){
    var controller=new AbortController(),timer=setTimeout(function(){controller.abort()},20000);
    try{
      var health=await fetcher(route.gateway+'/health',{cache:'no-store',signal:controller.signal});
      if(!health.ok)throw new Error('网关健康检查失败：HTTP '+health.status);
      var status=await health.json();
      if(status.status!=='ok')throw new Error('这个地址没有返回 CK 网关状态。');
      if(status.migration_read_only===true)throw new Error('VPS 仍是只读预览，暂不能作为正式连接。');
      if(route.execution==='claude_code_api'&&(status.claude_code_api!==true||status.claude_code_native!==true))throw new Error('目标 VPS 的 Claude Code 原生服务尚未就绪。');
      if(route.execution==='claude_code_subscription'){
        if(!authKey)throw new Error('请先登录 CK 面板');
        var subscription=await subscriptionStatus(route,authKey,fetcher,controller.signal);
        if(!subscription.ready)throw new Error(subscription.message||'订阅未登录，暂不可用');
      }
      if(!authKey)return;
      var headers={'x-api-key':authKey,'Content-Type':'application/json'};
      var cfg=await fetcher(route.gateway+'/config',{headers:headers,cache:'no-store',signal:controller.signal});
      if(!cfg.ok)throw new Error('目标网关未通过现有面板 Key 验证：HTTP '+cfg.status);
      var data=await cfg.json();
      if(!data.config_status||!data.config_status.ok||!data.providers||!Object.keys(data.providers).length)throw new Error('目标网关的配置或供应商列表未就绪。');
      var mcp=await fetcher(route.mcp,{method:'POST',headers:headers,body:JSON.stringify({jsonrpc:'2.0',id:'route-check',method:'tools/list'}),signal:controller.signal});
      if(!mcp.ok)throw new Error('记忆接口验证失败：HTTP '+mcp.status);
      var tools=await mcp.json();
      if(!tools.result||!Array.isArray(tools.result.tools)||!tools.result.tools.length)throw new Error('记忆接口没有返回工具列表。');
    }finally{clearTimeout(timer)}
  }
  async function subscriptionStatus(route,authKey,fetcher,signal){
    var response=await fetcher(route.gateway+'/ck/subscription/status',{headers:{'x-api-key':authKey},cache:'no-store',signal:signal});
    if(!response.ok)throw new Error(response.status===404?'当前网关尚未安装订阅功能':'订阅状态检查失败：HTTP '+response.status);
    return response.json();
  }
  function isSubscription(){return current.mode==='vps'&&current.execution==='claude_code_subscription'}
  function subscriptionRoute(){return {ok:true,source:'claude_subscription',provider:null,providerName:'Claude 订阅',providerHost:'api.anthropic.com',apiBase:'',upstreamKey:'',apiType:'claude',model:current.subscriptionModel||'sonnet',reason:''}}
  root.CKBackendRoute={servers:servers,serverOf:serverOf,isSubscription:isSubscription,subscriptionRoute:subscriptionRoute,subscriptionStatus:subscriptionStatus,key:key,current:current,defaults:defaults,normalize:normalize,parse:parse,probe:probe,storageValue:storageValue,refreshRouteHints:refreshRouteHints};
  if(typeof module==='object'&&module.exports)module.exports=root.CKBackendRoute;
})(typeof window==='object'?window:globalThis);

function ckOpenBackendRoute(){
  var active=CKBackendRoute.current;
  document.getElementById('ck-backend-mode').value=active.mode;
  document.getElementById('ck-execution-mode').value=active.execution||'direct_api';
  document.getElementById('ck-vps-server').value=CKBackendRoute.serverOf(active);
  document.getElementById('ck-subscription-model').value=active.subscriptionModel||'sonnet';
  var previous;
  try{previous=JSON.parse(localStorage.getItem(CKBackendRoute.key)||'null')}catch(e){}
  document.getElementById('ck-vps-gateway').value=(previous&&previous.gateway&&previous.mode==='vps'?previous.gateway:'https://tlomcc.cc.cd:18443/gateway');
  document.getElementById('ck-vps-mcp').value=(previous&&previous.mcp&&previous.mode==='vps'?previous.mcp:'https://tlomcc.cc.cd:18443/mcp');
  if(active.mode==='vps'){
    document.getElementById('ck-vps-gateway').value=active.gateway;
    document.getElementById('ck-vps-mcp').value=active.mcp;
  }
  document.getElementById('ck-backend-status').textContent='切换只改变连接地址；聊天、提示词和本地设置继续保留。';
  document.getElementById('ck-backend-dialog').classList.add('show');
  document.getElementById('ck-backend-dialog').setAttribute('aria-hidden','false');
  ckBackendFieldsChanged();
}
function ckCloseBackendRoute(){
  if(window.ckBackendSwitchBusy)return;
  document.getElementById('ck-backend-dialog').classList.remove('show');
  document.getElementById('ck-backend-dialog').setAttribute('aria-hidden','true');
}
function ckBackendFieldsChanged(){
  document.getElementById('ck-vps-fields').hidden=document.getElementById('ck-backend-mode').value!=='vps';
  var sub=document.getElementById('ck-execution-mode').value==='claude_code_subscription';
  document.getElementById('ck-subscription-fields').hidden=!sub;
  document.getElementById('ck-execution-hint').textContent=sub?'使用独立的官方订阅登录；CK 继续管理提示词、记忆、历史与工具。辅助总结和向量等仍使用各自 API。订阅不可用时不会自动切回 API。':'使用面板中的供应商 API 配置。Claude Code · API 使用官方客户端，由 CK 管理提示词、工具和聊天历史。';
  var server=document.getElementById('ck-vps-server');
  var option=document.querySelector('#ck-execution-mode option[value="claude_code_subscription"]');
  if(option)option.disabled=!!server&&server.value==='cn';
}
function ckBackendServerChanged(){
  var server=document.getElementById('ck-vps-server').value,origin=CKBackendRoute.servers[server];
  if(origin){
    document.getElementById('ck-vps-gateway').value=origin+'/gateway';
    document.getElementById('ck-vps-mcp').value=origin+'/mcp';
    document.getElementById('ck-execution-mode').value=server==='cn'?'claude_code_api':'claude_code_subscription';
  }
  ckBackendFieldsChanged();
}
function ckRenderBackendRoute(){
  var place=CKBackendRoute.serverOf(CKBackendRoute.current)==='cn'?'国内 VPS':CKBackendRoute.serverOf(CKBackendRoute.current)==='us'?'美国 VPS':'VPS';
  document.querySelectorAll('[data-ck-backend-label]').forEach(function(el){el.textContent=place+' · '+(CKBackendRoute.current.execution==='claude_code_subscription'?'Claude Code（订阅）':CKBackendRoute.current.execution==='claude_code_api'?'Claude Code（API）':'直接 API')});
}
if(typeof document==='object'){
  if(window.CKBackendRoute&&typeof window.CKBackendRoute.refreshRouteHints==='function')window.CKBackendRoute.refreshRouteHints(window.CKBackendRoute.current);
  document.addEventListener('DOMContentLoaded',ckRenderBackendRoute);
  document.addEventListener('visibilitychange',function(){if(!document.hidden&&window.CKBackendRoute)window.CKBackendRoute.refreshRouteHints(window.CKBackendRoute.current,true)});
  if(window.addEventListener)window.addEventListener('pageshow',function(){if(window.CKBackendRoute)window.CKBackendRoute.refreshRouteHints(window.CKBackendRoute.current,true)});
  var ckBackendDraftTimer=setInterval(function(){
    if(!window.chatSessionsReady)return;
    clearInterval(ckBackendDraftTimer);
    try{
      var draft=sessionStorage.getItem('ckBackendComposerDraft'),input=document.getElementById('chat-input');
      if(draft&&input&&!input.value){input.value=draft;input.dispatchEvent(new Event('input',{bubbles:true}));sessionStorage.removeItem('ckBackendComposerDraft')}
    }catch(e){}
  },500);
}
async function ckSaveBackendRoute(){
  var message=document.getElementById('ck-backend-status');
  if(window.ckBackendSwitchBusy)return;
  if(window.chatSending||window.chatTrimBusy||window.chatTrimTransaction||window.chatIdleTrimBusy||window.chatAutoCleanBusy||window.chatNewSessionPending){message.textContent='请等待当前回复、截断或保存完成后再切换。';return}
  if(window.panelAppStarted&&window.chatSessionsReady===false){message.textContent='聊天记录还在加载，请稍后再切换。';return}
  var button=document.getElementById('ck-backend-save'),oldValue,committed=false;
  window.ckBackendSwitchBusy=true;button.disabled=true;
  try{
    oldValue=localStorage.getItem(CKBackendRoute.key);
    var route=CKBackendRoute.parse({mode:document.getElementById('ck-backend-mode').value,gateway:document.getElementById('ck-vps-gateway').value,mcp:document.getElementById('ck-vps-mcp').value,execution:document.getElementById('ck-execution-mode').value,subscriptionModel:(document.getElementById('ck-subscription-model')||{}).value||'sonnet',server:(document.getElementById('ck-vps-server')||{}).value||'custom'});
    var auth=typeof storedPanelKey==='function'?storedPanelKey():'';
    if(!auth&&route.mode==='vps')throw new Error('请先在当前面板登录，验证现有配置后再切换 VPS。');
    message.textContent='正在检查网关、配置和记忆接口…';
    await CKBackendRoute.probe(route,auth,window.fetch.bind(window));
    // Keep the same storage keys and IndexedDB: location changes, not chat identity.
    if(window.panelAppStarted){
      if(typeof chatSaveConfig==='function')chatSaveConfig(true);
      if(typeof chatSaveLocalMessages==='function')chatSaveLocalMessages();
      if(typeof chatSaveSessionsToIndexedDb==='function')await chatSaveSessionsToIndexedDb();
      if(window.chatIndexedDbFailed)throw new Error('完整聊天记录暂时无法保存，已保留当前连接。');
    }
    if(window.chatSending||window.chatTrimBusy||window.chatTrimTransaction||window.chatIdleTrimBusy||window.chatAutoCleanBusy||window.chatNewSessionPending)throw new Error('当前有未完成的回复或保存，请稍后切换。');
    var draft=document.getElementById('chat-input');
    if(draft&&draft.value)sessionStorage.setItem('ckBackendComposerDraft',draft.value);
    var value=CKBackendRoute.storageValue(route);
    localStorage.setItem(CKBackendRoute.key,value);
    committed=true;
    if(localStorage.getItem(CKBackendRoute.key)!==value)throw new Error('连接选择未能保存，已保留当前连接。');
    CKBackendRoute.refreshRouteHints(route,true);
    message.textContent='验证通过，正在使用所选网关重新加载…';
    window.location.reload();
  }catch(e){
    if(committed){try{if(oldValue===null)localStorage.removeItem(CKBackendRoute.key);else localStorage.setItem(CKBackendRoute.key,oldValue)}catch(rollback){message.textContent='保存连接时发生异常，请暂勿刷新并重新选择原网关。';return}}
    message.textContent=(e.name==='AbortError'?'连接验证超时。':(e.message||'连接失败。'))+' 当前连接没有切换。'
  }
  finally{window.ckBackendSwitchBusy=false;button.disabled=false}
}

async function ckCheckSubscriptionStatus(){
  var el=document.getElementById('ck-subscription-status');el.textContent='正在检查…';
  var controller=new AbortController(),timer=setTimeout(function(){controller.abort()},20000);
  try{
    var route={gateway:CKBackendRoute.normalize(document.getElementById('ck-vps-gateway').value)};
    var status=await CKBackendRoute.subscriptionStatus(route,storedPanelKey(),window.fetch.bind(window),controller.signal);
    el.textContent=status.message||'订阅尚未就绪';
  }catch(e){el.textContent=e.name==='AbortError'?'检查超时，请稍后重试':e.message}finally{clearTimeout(timer)}
}
