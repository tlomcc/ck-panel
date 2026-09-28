(()=>{
 localStorage.clear();window.fetch=async()=>{throw Error('Offline drawer fixture')};apiProvidersLoaded=true;chatInitialized=false;chatSessionsReady=true;
 document.getElementById('loading-wrap').classList.add('done');document.body.classList.add('chat-active');
 document.querySelectorAll('.panel-tab').forEach(el=>el.classList.toggle('active',el.id==='tab-chat'));
 chatMessages=[];chatFolders=[];chatActiveSessionId='drawer-0';
 chatSessions=Array.from({length:20},(_,i)=>({id:'drawer-'+i,title:'对话 '+i,messages:[{role:'user',text:'检查左滑与上下滚动',ts:Date.now()}],updated:Date.now()-i*60000}));
 const cfg=chatLoadConfig();cfg.sessionId=chatActiveSessionId;chatSaveConfigObject(cfg);chatWriteForm(cfg);chatRenderMessages();chatToggleSessions(true);
 window.drawerEvents=[];['pointerdown','pointermove','pointerup','pointercancel','lostpointercapture','gotpointercapture','resize','blur'].forEach(type=>window.addEventListener(type,e=>drawerEvents.push({type,target:e.target.className,x:e.clientX,y:e.clientY,cancelable:e.cancelable}),true));
 window.drawerState=()=>{
  const drawer=document.querySelector('.chat-drawer'),rect=drawer.getBoundingClientRect(),list=drawer.querySelector('.chat-session-list');
  return {left:rect.left,width:rect.width,open:drawer.closest('.chat-shell').classList.contains('chat-sessions-open'),hidden:drawer.getAttribute('aria-hidden'),inert:drawer.inert,scroll:list.scrollTop,opacity:Number(getComputedStyle(document.querySelector('.chat-drawer-mask')).opacity),transform:drawer.style.transform,events:drawerEvents};
 };
})()
