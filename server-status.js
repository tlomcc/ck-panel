(function(){
 'use strict';
 var dialog=null,timer=0,controller=null,generation=0,returnFocus=null;
 var $=function(id){return document.getElementById(id)};
 function make(){
  if(dialog)return;
  dialog=document.createElement('div');dialog.id='ck-server-dialog';dialog.className='modal-bg';dialog.setAttribute('aria-hidden','true');
  dialog.innerHTML='<section class="modal ck-server-card" role="dialog" aria-modal="true" aria-labelledby="ck-server-title"><div class="ck-server-heading"><h3 id="ck-server-title">服务器状态</h3><button class="btn btn-outline btn-sm" id="ck-server-close" type="button">关闭</button></div><div class="ck-server-banner"><div><strong id="ck-server-name">我的美国 VPS</strong><p id="ck-server-state" role="status">正在读取状态</p></div><button class="btn btn-outline btn-sm" type="button" id="ck-server-refresh">刷新</button></div><div id="ck-server-body"></div><footer id="ck-server-updated">打开时每 5 秒刷新</footer></section>';
  document.body.appendChild(dialog);
  $('ck-server-close').onclick=close;dialog.onclick=function(e){if(e.target===dialog)close()};$('ck-server-refresh').onclick=refresh;
  dialog.addEventListener('keydown',function(e){if(e.key==='Escape'){e.preventDefault();close()}if(e.key==='Tab'){var items=Array.from(dialog.querySelectorAll('button:not([disabled])'));var first=items[0],last=items[items.length-1];if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus()}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus()}}});
 }
 function close(){generation++;clearTimeout(timer);if(controller)controller.abort();controller=null;dialog.classList.remove('show');dialog.setAttribute('aria-hidden','true');if(returnFocus&&returnFocus.isConnected)returnFocus.focus()}
 function node(tag,cls,text){var n=document.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=text;return n}
 function gb(n){return (Number(n)/1073741824).toFixed(1)+' GB'}
 function uptime(seconds){var hours=Math.floor(Number(seconds)/3600);return Math.floor(hours/24)+'天 '+hours%24+'时'}
 function metric(label,value,percent,wide){var n=node('div','ck-server-metric'+(wide?' wide':''));n.append(node('label','',label),node('strong','ck-server-number',value));if(percent!==null&&isFinite(percent)){var p=node('progress');p.max=100;p.value=Math.max(0,Math.min(100,percent));p.setAttribute('aria-label',label+' '+percent+'%');n.append(p)}return n}
 function render(data){
  var body=$('ck-server-body');body.replaceChildren();
  if(!data.resource_metrics_available){body.append(node('p','ck-server-note',data.note||'函数计算按请求运行，没有可比较的整台服务器资源指标。'));return}
  var grid=node('div','ck-server-grid');grid.append(metric('CPU',data.cpu_percent===null?'采样中':data.cpu_percent+'%',data.cpu_percent),metric('已运行',uptime(data.uptime_seconds),null));
  ['memory','disk'].forEach(function(key){var d=data[key];grid.append(metric((key==='memory'?'内存':'磁盘')+' · '+d.percent+'%',gb(d.used)+' / '+gb(d.total),d.percent,true))});
  var services=node('div','ck-server-metric wide');services.append(node('label','','关键服务'));var list=node('div','ck-server-services');
  (data.services||[]).forEach(function(s){var label={ok:'正常',reachable:'端口可用',unavailable:'未连通',error:'异常',unknown:'未知'}[s.state]||'未知';var n=node('span','ck-server-service',s.name+' · '+label+(s.active_sessions?' · '+s.active_sessions+' 个请求':''));n.dataset.state=s.state;list.append(n)});services.append(list);grid.append(services);body.append(grid);
 }
 function endpoint(){return CKBackendRoute.current.gateway}
 async function refresh(){
  clearTimeout(timer);if(controller)controller.abort();var token=++generation;controller=new AbortController();var active=controller,timeout=setTimeout(function(){active.abort()},10000);
  $('ck-server-name').textContent='我的美国 VPS';$('ck-server-state').textContent='正在读取状态';$('ck-server-refresh').disabled=true;
  try{
   var base=endpoint(),path='/ck/server-status',key=typeof storedPanelKey==='function'?storedPanelKey():'';
   var response=await fetch(base+path,{headers:key?{'x-api-key':key}:{},cache:'no-store',signal:active.signal});
   if(!response.ok)throw Error(response.status===404?'VPS 尚未安装服务器状态更新。':response.status===403?'当前面板尚未通过身份验证。':'暂时无法读取服务器状态（HTTP '+response.status+'）。');
   var data=await response.json();if(token!==generation)return;
   render(data);$('ck-server-state').textContent='已连接';$('ck-server-updated').textContent='更新于 '+new Date(data.updated_at*1000).toLocaleTimeString('zh-CN')+' · 每 5 秒刷新';
  }catch(e){if(token!==generation)return;$('ck-server-state').textContent='暂未取得最新状态';$('ck-server-body').replaceChildren(node('p','ck-server-error',e.name==='AbortError'?'连接超时，请检查到 VPS 的网络后刷新。':e.message));$('ck-server-updated').textContent='等待重试；没有把旧数值当作当前状态。';}
  finally{clearTimeout(timeout);if(token===generation){$('ck-server-refresh').disabled=false;controller=null;if(dialog.classList.contains('show')&&!document.hidden)timer=setTimeout(refresh,5000)}}
 }
 window.ckOpenServerStatus=function(){make();returnFocus=document.activeElement;dialog.classList.add('show');dialog.setAttribute('aria-hidden','false');$('ck-server-close').focus();refresh()};
 document.addEventListener('visibilitychange',function(){if(!dialog||!dialog.classList.contains('show'))return;if(document.hidden){clearTimeout(timer);generation++;if(controller)controller.abort()}else refresh()});
})();
