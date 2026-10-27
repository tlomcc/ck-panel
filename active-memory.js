var ckActiveMemoryData=null,ckActiveMemoryPrincipal='',ckActiveMemoryBusy=false,ckActiveMemoryTimer=0,ckActiveMemoryMessage='';
var ckActiveMemoryDrafts=new Map();
function ckActiveMemoryScope(cfg){return chatEndpoint(cfg)+'|'+cfg.panelKey}
function ckActiveMemoryDraft(){
  var draft=ckActiveMemoryDrafts.get(ckActiveMemoryPrincipal),data=ckActiveMemoryData;
  if(!draft&&data){draft={text:data.content,saved:data.content,revision:data.revision};ckActiveMemoryDrafts.set(ckActiveMemoryPrincipal,draft)}
  return draft;
}
function ckActiveMemoryInput(){var draft=ckActiveMemoryDraft();if(draft){draft.text=document.getElementById('ck-active-memory-content').value;ckActiveMemoryMessage='';ckActiveMemoryRender()}}
function ckActiveMemoryRender(){
  var data=ckActiveMemoryData,draft=ckActiveMemoryDraft(),dirty=!!draft&&draft.text!==draft.saved;
  if(data&&draft&&data.revision!==draft.revision&&(!dirty||data.content===draft.saved)){
    if(!dirty)draft.text=data.content;draft.saved=data.content;draft.revision=data.revision;
  }
  var conflict=!!draft&&!!data&&draft.revision!==data.revision,text=draft?draft.text:'',count=Array.from(text).length;
  var box=document.getElementById('ck-active-memory-content');if(box){if(box.value!==text)box.value=text;box.disabled=!data}
  var counter=document.getElementById('ck-active-memory-count');if(counter)counter.textContent=count+' / 5000 字';
  var lines=[];
  if(data){lines.push((data.enabled?'小克自主更新已开启':'小克自主更新已暂停')+' · 版本 '+data.revision);if(data.updated_at)lines.push('最近更新：'+new Date(data.updated_at*1000).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false}));if(data.stale)lines.push('正在显示上次保存的记忆；连接恢复后才能保存。')}
  else lines.push('正在读取主动记忆…');
  if(dirty)lines.push('有未保存的编辑。');
  if(conflict)lines.push('小克或其他窗口已更新记忆。请核对已保存内容后合并；你的草稿已保留。');
  if(count>5000)lines.push('主动记忆最多5000字，请精炼后保存。');
  if(ckActiveMemoryMessage)lines.push(ckActiveMemoryMessage);
  var state=document.getElementById('ck-active-memory-state');if(state)state.textContent=lines.join('\n');
  var save=document.getElementById('ck-active-memory-save');if(save)save.disabled=!data||!data.writable||ckActiveMemoryBusy||!dirty||conflict||count>5000;
  var load=document.getElementById('ck-active-memory-load');if(load)load.disabled=!data||ckActiveMemoryBusy;
  var merge=document.getElementById('ck-active-memory-merge');if(merge){merge.hidden=!conflict;merge.disabled=ckActiveMemoryBusy}
  var toggle=document.getElementById('ck-active-memory-toggle');if(toggle){toggle.textContent=data&&data.enabled===false?'恢复小克自主更新':'暂停小克自主更新';toggle.disabled=!data||!data.writable||ckActiveMemoryBusy}
  var saved=document.getElementById('ck-active-memory-saved');if(saved)saved.textContent=data&&data.content||'小克会在聊天中自行决定值得记住的内容。';
}
function ckActiveMemoryMerge(){
  var draft=ckActiveMemoryDraft(),data=ckActiveMemoryData;if(!draft||!data)return;
  draft.saved=data.content;draft.revision=data.revision;ckActiveMemoryMessage='已保留草稿，请核对后保存完整记忆。';ckActiveMemoryRender();
}
function ckActiveMemoryLoad(){
  if(ckActiveMemoryData&&!ckActiveMemoryBusy){ckActiveMemoryDrafts.delete(ckActiveMemoryPrincipal);ckActiveMemoryMessage='已载入服务器保存的内容。';ckActiveMemoryRender()}
}
function ckActiveMemorySave(){
  if(ckActiveMemoryPrincipal!==ckActiveMemoryScope(chatLoadConfig()))return ckActiveMemoryRefresh();
  var draft=ckActiveMemoryDraft();if(!draft||!ckActiveMemoryData||draft.revision!==ckActiveMemoryData.revision)return;
  return ckActiveMemoryRefresh('save',{revision:draft.revision,content:draft.text});
}
function ckActiveMemoryToggle(){if(ckActiveMemoryData)return ckActiveMemoryRefresh(ckActiveMemoryData.enabled?'pause':'resume',{revision:ckActiveMemoryData.revision})}
async function ckActiveMemoryRefresh(action,payload){
  var cfg=chatLoadConfig(),scope=ckActiveMemoryScope(cfg);
  if(scope!==ckActiveMemoryPrincipal){ckActiveMemoryPrincipal=scope;ckActiveMemoryData=null;ckActiveMemoryMessage='';ckActiveMemoryRender()}
  if(ckActiveMemoryBusy)return false;ckActiveMemoryBusy=true;ckActiveMemoryRender();
  var controller=new AbortController(),timer=setTimeout(function(){controller.abort()},18000);
  var endpoint=chatEndpoint(cfg).replace(/\/chat$/,'/active-memory')+'?key='+encodeURIComponent(cfg.panelKey);
  try{
    var response=await fetch(endpoint,action?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(Object.assign({action:action},payload||{})),signal:controller.signal}:{cache:'no-store',signal:controller.signal});
    var data=await response.json();
    if(response.status===409&&action){var latest=await fetch(endpoint,{cache:'no-store',signal:controller.signal});var current=await latest.json();if(latest.ok&&current.ok&&ckActiveMemoryScope(chatLoadConfig())===scope)ckActiveMemoryData=current}
    if(!response.ok||data.ok!==true)throw new Error(data.error||'主动记忆暂时无法读取');
    if(ckActiveMemoryScope(chatLoadConfig())!==scope)return false;ckActiveMemoryData=data;
    if(action==='save'){
      var draft=ckActiveMemoryDrafts.get(scope);if(draft){if(draft.text===payload.content)draft.text=data.content;draft.saved=data.content;draft.revision=data.revision}
      ckActiveMemoryMessage='已保存，下次聊天直接带入最新记忆。';
    }else if(action)ckActiveMemoryMessage=data.enabled?'小克可以继续自主更新记忆。':'已暂停自主更新，保存的记忆仍在每轮带入。';
    else ckActiveMemoryMessage='';
    return true;
  }catch(error){if(ckActiveMemoryScope(chatLoadConfig())===scope)ckActiveMemoryMessage=(action?'操作尚未完成，草稿与已保存内容保留：':'读取尚未完成：')+(error.message||'连接失败');return false}
  finally{
    clearTimeout(timer);ckActiveMemoryBusy=false;ckActiveMemoryRender();clearTimeout(ckActiveMemoryTimer);
    if(ckActiveMemoryScope(chatLoadConfig())!==scope){ckActiveMemoryRefresh();}
    else if(currentPanelTab==='records')ckActiveMemoryTimer=setTimeout(function(){if(currentPanelTab==='records')ckActiveMemoryRefresh()},30000);
  }
}
