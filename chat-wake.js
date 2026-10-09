/* Server-owned clocks keep running while the phone sleeps. */
var chatWakeState={},chatWakeBusy=false,chatWakeWriteBusy=false,chatWakeLastFetch=0,chatWakePending=null;
function chatWakeMode(cfg){
  cfg=cfg||chatLoadConfig();
  var strategy=chatPollingEnabledForConfig(cfg)?chatCacheNoticeStrategy(cfg):providerNormalizeCacheStrategy(cfg.mainRouteCacheStrategy);
  return strategy==='native_stable'?'1h':['native_5m','single_5m','assistant_latest','native_tiered'].includes(strategy)?'5m':'';
}
function chatWakeShortcut(){try{return localStorage.getItem('ck_wake_shortcut')==='show'}catch(e){return false}}
function chatWakeVisibility(show){
  try{localStorage.setItem('ck_wake_shortcut',show?'show':'settings')}catch(e){}
  chatWakeRender();
}
function chatWakeRender(){
  if(typeof chatLoadConfig!=='function')return;
  var cfg=chatLoadConfig(),s=chatWakeState[cfg.sessionId]||{},mode=chatWakeMode(cfg),enabled=s.enabled===true;
  var icon=document.getElementById('chat-wake-shortcut');
  if(icon){icon.hidden=!chatWakeShortcut();icon.setAttribute('aria-pressed',String(enabled));icon.title=enabled?'关闭当前窗口唤醒':'开启当前窗口唤醒';icon.setAttribute('aria-label',icon.title);icon.disabled=chatWakeWriteBusy;}
  var visible=document.getElementById('chat-wake-visibility');if(visible)visible.value=chatWakeShortcut()?'show':'settings';
  var toggle=document.getElementById('chat-wake-enabled');if(toggle){toggle.checked=enabled;toggle.disabled=chatWakeWriteBusy||!mode;}
  var input=document.getElementById('chat-wake-interval');
  if(input){input.max=mode==='1h'?59:4;input.disabled=chatWakeWriteBusy||!mode;if(document.activeElement!==input)input.value=s.interval|| (mode==='1h'?50:4);}
  var label=document.getElementById('chat-wake-mode');
  if(label)label.textContent=mode?(mode==='1h'?'1h · 1–59 分钟':'5min · 1–4 分钟'):'当前供应商策略不使用 5min / 1h 唤醒';
  var status=document.getElementById('chat-wake-status');
  if(status){
    var remaining=Math.max(0,Math.ceil((Number(s.next_at||0)*1000-Date.now())/1000));
    var text=!enabled?'当前窗口已关闭':!mode?'等待供应商改为 5min / 1h 策略':s.status==='waiting_chat'?'已开启，发送一条正常消息后开始维持缓存':s.status==='chatting'?'正在聊天，本轮结束后继续计时':s.status==='waking'?'正在唤醒':s.last_error?'上次唤醒失败：'+s.last_error+'；下一次按间隔重试':'下次唤醒 '+Math.floor(remaining/60)+'分'+String(remaining%60).padStart(2,'0')+'秒';
    if(s.last_success_at)text+=' · 最近成功 '+new Date(s.last_success_at*1000).toLocaleTimeString('zh-CN',{hour12:false});
    if(s.usage){var u=s.usage;text+=' · 上次缓存读 '+(u.cache_read_input_tokens||0)+' / 创建 '+(u.cache_creation_input_tokens||0)+' / '+(u.output_tokens_partial?'已收到输出 ':'输出 ')+(u.output_tokens||u.completion_tokens||0)+' token'+(u.output_tokens_partial?'（结束前用量，最终结算可能更多）':'');}
    if(s.sync_error)text+=' · '+s.sync_error;
    status.textContent=text;
  }
}
async function chatWakeRequest(changes,sessionId){
  var cfg=chatLoadConfig(),sid=sessionId||cfg.sessionId,controller=new AbortController(),timer=setTimeout(function(){controller.abort()},10000);
  try{
    var url=chatEndpoint(cfg).replace(/\/chat$/,'/wake');
    var options={cache:'no-store',signal:controller.signal};
    if(changes){options.method='POST';options.headers={'Content-Type':'application/json'};options.body=JSON.stringify(Object.assign({key:cfg.panelKey,session_id:sid,provider_id:cfg.mainRouteProviderId||''},changes));}
    else url+='?key='+encodeURIComponent(cfg.panelKey)+'&session_id='+encodeURIComponent(sid);
    var response=await fetch(url,options),data=await response.json();
    if(!response.ok||data.ok===false)throw new Error(data.error||'唤醒状态读取失败');
    if(chatLoadConfig().panelKey!==cfg.panelKey)return;
    chatWakeState[sid]=data;
    var session=chatSessions.find(function(x){return x.id===sid});
    if(session){
      session.wakeEnabled=data.enabled===true;session.wakeSyncAt=Date.now();
      var u=data.usage||{};
      if(data.last_success_at&&(Number(u.cache_read_input_tokens)>0||Number(u.cache_creation_input_tokens)>0)){
        session.cacheLastReadAt=Math.max(Number(session.cacheLastReadAt)||0,data.last_success_at*1000);
        session.systemPromptCacheUntil=Math.max(Number(session.systemPromptCacheUntil)||0,data.last_success_at*1000+(data.mode==='1h'?3600000:300000));
      }
      chatScheduleSessionSave(sid);
    }
    chatWakeRender();return data;
  }finally{clearTimeout(timer)}
}
async function chatWakeRefresh(){
  if(chatWakePending)return chatWakePending;
  if(chatWakeWriteBusy||!chatLoadConfig().panelKey)return;
  chatWakeBusy=true;
  var sid=chatLoadConfig().sessionId;
  chatWakePending=(async function(){
    try{return await chatWakeRequest()}
    catch(error){chatWakeState[sid]=Object.assign({},chatWakeState[sid],{sync_error:'暂时无法确认后台状态'});chatWakeRender();}
    finally{chatWakeBusy=false;chatWakeLastFetch=Date.now();chatWakePending=null;}
  })();
  return chatWakePending;
}
async function chatWakeSave(changes){
  if(chatWakeWriteBusy)return;
  chatWakeWriteBusy=true;chatWakeRender();
  try{if(chatWakePending)await chatWakePending;await chatWakeRequest(changes);toast('唤醒设置已保存');}
  catch(error){toast('唤醒设置未保存，请重试',4000);}
  finally{chatWakeWriteBusy=false;chatWakeRender();}
}
function chatWakeToggle(){
  var s=chatWakeState[chatLoadConfig().sessionId]||{};
  return chatWakeSave({enabled:!s.enabled});
}
function chatWakeSaveInterval(value){
  var n=Number(value),max=chatWakeMode()==='1h'?59:4;
  if(!Number.isInteger(n)||n<1||n>max){toast('唤醒间隔必须为 1–'+max+' 的整数分钟');chatWakeRender();return;}
  return chatWakeSave({interval:n});
}
async function chatWakeForget(id){
  try{await chatWakeRequest({enabled:false,forget:true},id);return true;}
  catch(error){toast('未能关闭该窗口的后台唤醒，请恢复连接后再删除');return false;}
}
setInterval(function(){
  if(typeof currentPanelTab==='undefined'||currentPanelTab!=='chat')return;
  chatWakeRender();
  if(Date.now()-chatWakeLastFetch>=10000)chatWakeRefresh();
},1000);
document.addEventListener('visibilitychange',function(){if(!document.hidden){chatWakeLastFetch=0;chatWakeRefresh()}});
