(async function(){
  var checks=[],assert=function(ok,message){if(!ok)throw new Error(message);checks.push(message)};
  var cfg=chatLoadConfig();cfg.sessionId='v303-test';cfg.mainRouteCacheStrategy='native_5m';chatLoadConfig=function(){return cfg};
  chatWakeLastFetch=Infinity;
  chatWakeState[cfg.sessionId]={enabled:true,mode:'5m',interval_seconds:240,idle_shutdown_enabled:true,idle_shutdown_minutes:30,idle_shutdown_at:Date.now()/1000+1800};
  chatOpenSettingTab('display');ckSettingsSelect('wake');chatWakeRender();
  assert(document.getElementById('chat-wake-idle-enabled').checked,'auto-stop switch reflects server');
  assert(document.getElementById('chat-wake-idle-minutes').value==='30','default 30 minutes visible');
  var saved=[],save=chatWakeSave;chatWakeSave=function(changes){saved.push(changes)};
  var input=document.getElementById('chat-wake-idle-minutes');input.focus();input.value='45';chatWakeRender();
  assert(input.value==='45','status refresh preserves minute editing');
  chatWakeSaveIdle();assert(saved[0].idle_shutdown_enabled===true&&saved[0].idle_shutdown_minutes===45,'user switch and minutes sent together');
  input.value='0';chatWakeSaveIdle();assert(saved.length===1,'zero minutes rejected');
  input.value='45';document.getElementById('chat-wake-idle-enabled').checked=false;chatWakeSaveIdle();assert(saved[1].idle_shutdown_enabled===false,'user can disable auto-stop');
  chatWakeSave=save;input.blur();chatWakeState[cfg.sessionId].enabled=false;chatWakeState[cfg.sessionId].status='auto_off';chatWakeRender();
  assert(document.getElementById('chat-wake-status').textContent.includes('自动关闭'),'auto-stop reason visible');
  assert(!document.getElementById('chat-wake-enabled').checked,'server stop turns wake switch off');
  var box=document.getElementById('chat-wake-idle-minutes').getBoundingClientRect();assert(box.left>=0&&box.right<=innerWidth,'minutes field fits viewport');
  return checks;
})()
