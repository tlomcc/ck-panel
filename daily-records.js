var ckRecordsData=null,ckRecordsBusy=false,ckRecordsPrincipal='',ckRecordsTimer=0;
function ckRecordsScope(cfg){return chatEndpoint(cfg)+'|'+cfg.panelKey}
function ckRecordsRender(){
  var data=ckRecordsData||{},names={waiting:'等待每日检查',not_configured:'等待配置模型',reading:'读取昨日聊天',summarizing:'提炼记录',checking:'检查事实与精炼程度',batch_saved:'已保存本批进度',updated:'记录已更新',unchanged:'已检查，无需更新',retry:'等待自动重试',needs_attention:'检查未通过，保留上一版',paused:'已暂停',queued:'等待开始'};
  ['todos','profile'].forEach(function(kind){var box=document.getElementById('ck-records-'+kind),count=document.getElementById('ck-records-'+kind+'-count');if(box)box.value=data[kind]||'';if(count)count.textContent=Array.from(data[kind]||'').length+' / 5000 字'});
  var time=function(n){return n?new Date(n*1000).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false}):'尚无'};
  var message=(names[data.status]||'正在读取记录')+(data.last_day?' · 已检查 '+data.last_day:'')+(data.batch&&['summarizing','checking','batch_saved'].includes(data.status)?' · 第 '+data.batch+' / '+data.batches+' 批':'');
  ['ck-records-state','ck-records-monitor'].forEach(function(id){var el=document.getElementById(id);if(!el)return;el.textContent=message+'\n最近检查：'+time(data.last_checked_at)+'\n最近内容更新：'+time(data.last_updated_at)+(data.last_error?'\n'+data.last_error:'')});
  var toggle=document.getElementById('ck-records-toggle');if(toggle){toggle.textContent=data.enabled===false?'恢复每日更新':'暂停每日更新';toggle.disabled=ckRecordsBusy;}
  document.querySelectorAll('[data-records-action]').forEach(function(b){b.disabled=ckRecordsBusy});
}
async function ckRecordsRefresh(action){
  var cfg=chatLoadConfig(),scope=ckRecordsScope(cfg);
  if(ckRecordsPrincipal!==scope){ckRecordsPrincipal=scope;ckRecordsData=null;ckRecordsRender();}
  if(ckRecordsBusy)return;ckRecordsBusy=true;ckRecordsRender();
  var controller=new AbortController(),timer=setTimeout(function(){controller.abort()},12000);
  try{
    var response=await fetch(chatEndpoint(cfg).replace(/\/chat$/,'/daily-records')+'?key='+encodeURIComponent(cfg.panelKey),action?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:action}),signal:controller.signal}:{cache:'no-store',signal:controller.signal});
    var data=await response.json();if(!response.ok||data.ok!==true)throw new Error(data.error||'记录暂时无法读取');
    if(ckRecordsScope(chatLoadConfig())!==scope)return;ckRecordsData=data;
  }catch(error){if(ckRecordsScope(chatLoadConfig())===scope)ckRecordsData=Object.assign({},ckRecordsData,{last_error:'记录连接暂未完成，稍后自动重试。'});}
  finally{clearTimeout(timer);ckRecordsBusy=false;ckRecordsRender();clearTimeout(ckRecordsTimer);if(currentPanelTab==='records'||currentPanelTab==='status'&&ckStatusTab==='records')ckRecordsTimer=setTimeout(function(){ckRecordsRefresh()},10000);}
}
function ckRecordsToggle(){return ckRecordsRefresh(ckRecordsData&&ckRecordsData.enabled===false?'resume':'pause')}
