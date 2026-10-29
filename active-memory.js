var ckActiveMemoryData=null,ckActiveMemoryPrincipal='',ckActiveMemoryBusy=false,ckActiveMemoryTimer=0,ckActiveMemoryMessage='';
function ckActiveMemoryScope(cfg){return chatEndpoint(cfg)+'|'+cfg.panelKey}
function ckActiveMemoryRender(){
  var data=ckActiveMemoryData,text=data?String(data.content||''):'',count=Array.from(text).length;
  var box=document.getElementById('ck-active-memory-content');if(box){if(box.value!==text)box.value=text;box.readOnly=true;box.disabled=!data}
  var counter=document.getElementById('ck-active-memory-count');if(counter)counter.textContent=count+' / 5000 字';
  var lines=[];
  if(data){
    lines.push('仅小克可修改 · '+(data.enabled?'自主更新已开启':'自主更新已暂停')+' · 版本 '+data.revision);
    if(data.updated_at)lines.push('最近更新：'+new Date(data.updated_at*1000).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false}));
    if(data.stale)lines.push('正在显示上次保存的记忆，连接恢复后会读取最新内容。');
  }else lines.push('正在读取主动记忆…');
  if(ckActiveMemoryMessage)lines.push(ckActiveMemoryMessage);
  var state=document.getElementById('ck-active-memory-state');if(state)state.textContent=lines.join('\n');
  // Also make an older cached page read-only while it receives the new shell.
  ['save','merge','load'].forEach(function(name){var button=document.getElementById('ck-active-memory-'+name);if(button){button.disabled=true;button.hidden=true}});
  var toggle=document.getElementById('ck-active-memory-toggle');if(toggle){toggle.textContent=data&&data.enabled===false?'恢复小克自主更新':'暂停小克自主更新';toggle.disabled=!data||!data.writable||ckActiveMemoryBusy}
  var saved=document.getElementById('ck-active-memory-saved');if(saved)saved.textContent=text||'小克会在聊天中自行决定值得记住的内容。';
}
function ckActiveMemoryInput(){ckActiveMemoryRender()}
function ckActiveMemorySave(){ckActiveMemoryMessage='主动记忆正文只能由小克更新。';ckActiveMemoryRender();return false}
function ckActiveMemoryToggle(){if(ckActiveMemoryData)return ckActiveMemoryRefresh(ckActiveMemoryData.enabled?'pause':'resume',{revision:ckActiveMemoryData.revision})}
async function ckActiveMemoryRefresh(action,payload){
  if(action&&action!=='pause'&&action!=='resume')return ckActiveMemorySave();
  var cfg=chatLoadConfig(),scope=ckActiveMemoryScope(cfg);
  if(scope!==ckActiveMemoryPrincipal){ckActiveMemoryPrincipal=scope;ckActiveMemoryData=null;ckActiveMemoryMessage='';ckActiveMemoryRender()}
  if(ckActiveMemoryBusy)return false;ckActiveMemoryBusy=true;ckActiveMemoryRender();
  var controller=new AbortController(),timer=setTimeout(function(){controller.abort()},18000);
  var endpoint=chatEndpoint(cfg).replace(/\/chat$/,'/active-memory')+'?key='+encodeURIComponent(cfg.panelKey);
  try{
    var response=await fetch(endpoint,action?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:action,revision:payload&&payload.revision}),signal:controller.signal}:{cache:'no-store',signal:controller.signal});
    var data=await response.json();
    if(response.status===409&&action){var latest=await fetch(endpoint,{cache:'no-store',signal:controller.signal});var current=await latest.json();if(latest.ok&&current.ok&&ckActiveMemoryScope(chatLoadConfig())===scope)ckActiveMemoryData=current}
    if(!response.ok||data.ok!==true)throw new Error(data.error||'主动记忆暂时无法读取');
    if(ckActiveMemoryScope(chatLoadConfig())!==scope)return false;ckActiveMemoryData=data;
    ckActiveMemoryMessage=action?(data.enabled?'小克可以继续自主更新记忆。':'已暂停自主更新，保存的记忆仍在每轮带入。'):'';
    return true;
  }catch(error){if(ckActiveMemoryScope(chatLoadConfig())===scope)ckActiveMemoryMessage=(action?'开关操作尚未确认，已有记忆保留：':'读取尚未完成：')+(error.message||'连接失败');return false}
  finally{
    clearTimeout(timer);ckActiveMemoryBusy=false;ckActiveMemoryRender();clearTimeout(ckActiveMemoryTimer);
    if(ckActiveMemoryScope(chatLoadConfig())!==scope){ckActiveMemoryRefresh();}
    else if(currentPanelTab==='records')ckActiveMemoryTimer=setTimeout(function(){if(currentPanelTab==='records')ckActiveMemoryRefresh()},30000);
  }
}
function ckLegacyRecordsOpen(){
  var archive=document.getElementById('ck-legacy-records');
  if(archive&&archive.open&&typeof ckRecordsRefresh==='function')ckRecordsRefresh();
  else if(typeof ckRecordsTimer!=='undefined')clearTimeout(ckRecordsTimer);
}
