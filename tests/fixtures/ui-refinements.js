(async()=>{
 const check=(ok,msg)=>{if(!ok)throw Error(msg)},tick=()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
 localStorage.clear();window.fetch=async()=>{throw Error('Offline fixture')};apiProvidersLoaded=true;chatInitialized=false;chatSessionsReady=true;
 document.getElementById('loading-wrap').classList.add('done');document.body.classList.remove('chat-active');
 document.querySelectorAll('.panel-tab').forEach(e=>e.classList.toggle('active',e.id==='tab-apiconfig'));
 apiProviders={};apiProviderLibrarySlot().providers=[
  {id:'mint',name:'薄荷小站',category:'日常聊天',url:'https://mint.example/v1',key:'private-fixture-key',model:'模型A',models:['模型A'],note:'日常陪伴'},
  {id:'leaf',name:'叶子 API',category:'工作学习',url:'https://leaf.example/v1',key:'private-fixture-key',model:'模型B',models:['模型B'],note:'长文阅读'},
  {id:'cloud',name:'云朵中转',category:'备用',url:'https://cloud.example/v1',key:'private-fixture-key',model:'模型C',models:['模型C'],note:'备用服务'}];
 currentApiTab='providers';renderApiConfig();
 const folders=[...document.querySelectorAll('.prov-category')];check(folders.length===3,'Folder fixtures missing');
 check(folders.filter(f=>!f.classList.contains('collapsed')).length<=1,'Multiple folders open by default');
 for(const folder of folders){if(folder.classList.contains('collapsed'))folder.querySelector('.prov-category-head>button').click();check(folders.filter(f=>!f.classList.contains('collapsed')).length===1,'Accordion did not close siblings');check(folder.querySelector('button').getAttribute('aria-expanded')==='true','Wrong expanded state')}
 const draft=document.querySelector('[data-id="mint"] .prov-name-input');draft.value='薄荷草稿';
 filterProviderLibrary('模型B');check(document.querySelectorAll('.prov-card:not([hidden])').length===1,'Model search failed');check(!document.querySelector('[data-id="leaf"]').hidden,'Search wrong provider');
 filterProviderLibrary('private-fixture-key');check(document.querySelectorAll('.prov-card:not([hidden])').length===0,'API key must not be searchable');
 clearProviderLibrarySearch();check(draft.value==='薄荷草稿','Search erased unsaved edits');check(folders.filter(f=>!f.classList.contains('collapsed')).length===1,'Search lost folder state');
 filterProviderLibrary('mint.example');check(!document.querySelector('[data-id="mint"]').hidden,'URL search failed');clearProviderLibrarySearch();
 document.body.classList.add('chat-active');document.querySelectorAll('.panel-tab').forEach(e=>e.classList.toggle('active',e.id==='tab-chat'));
 const now=Date.now();chatMessages=Array.from({length:160},(_,i)=>({role:i%2?'assistant':'user',text:i===4?'我们养一只薄荷猫吧。':i===41?'薄荷猫会帮你收藏今天的小事。':i===153?'那只薄荷猫，我一直记得。':'今天也有一点开心的小事。',ts:now-3600000+i*1000,turnId:'turn'+Math.floor(i/2)}));
 chatSessions=[{id:'chat',title:'薄荷小站 + 模型A',messages:chatMessages,transportMessages:[],dailyDigests:[]},{id:'other',title:'旧窗口名称',messages:Array.from({length:400},(_,i)=>({role:'user',text:'完整历史'+i,ts:now+i})),dailyDigests:[]}];chatActiveSessionId='chat';
 let cfg=chatLoadConfig();cfg.sessionId='chat';chatSaveConfigObject(cfg);chatWriteForm(cfg);chatRenderMessages();
 chatToggleSearch(true);document.getElementById('chat-search-input').value='薄荷猫';await chatSearchMessages();await tick();
 check(chatSearchHits.length===3,'Search missing older unloaded history');check(document.querySelectorAll('.chat-search-result').length===3,'Preview cards missing');check(document.querySelectorAll('.chat-search-result mark').length===3,'Preview matches not highlighted');
 chatSearchPick(0);await tick();check(document.querySelector('[data-chat-index="4"]'),'Older result not loaded');
 chatMessages[4].text='安全 <img src=x onerror=alert(1)> 薄荷猫';await chatSearchMessages();check(!document.querySelector('#chat-search-results img'),'Search snippet injected HTML');
 document.getElementById('chat-search-input').value='不存在';await chatSearchMessages();check(chatSearchHits.length===0&&document.getElementById('chat-search-count').textContent==='没有找到','Empty search unclear');
 // Real IndexedDB partial writes must retain the other window's full history.
 await chatSaveSessionsToIndexedDb(chatSessions.map(chatNormalizeSession));
 chatSessions[0].latestRecall={state:'ready',preview:'按窗口保存的召回',turnId:'turn79'};
 await chatSaveSessionsToIndexedDb([chatNormalizeSession(chatSessions[0])],true);
 const stored=await chatLoadSessionsFromIndexedDb();check(stored.length===2&&stored.find(s=>s.id==='other').messages.length===400,'Partial save deleted or trimmed another window');check(stored.find(s=>s.id==='chat').latestRecall.preview==='按窗口保存的召回','Partial write lost recall');
 const save=chatSaveSessions,calls=[];chatSaveSessions=o=>calls.push(o);chatScheduleSessionSave('chat');chatScheduleSessionSave('other');chatFlushDeferredSessionSave();check(calls.length===1&&calls[0].sessionIds.length===2,'Deferred writes did not coalesce');chatSaveSessions=save;
 // Idle callback handles and timeout handles can have the same number.
 const idle=window.requestIdleCallback,cancelIdle=window.cancelIdleCallback,clearTimer=window.clearTimeout;let idleCancels=0,timerCancels=0;
 window.requestIdleCallback=()=>71;window.cancelIdleCallback=()=>idleCancels++;window.clearTimeout=()=>timerCancels++;chatSaveSessions=()=>{};
 chatScheduleSessionSave('chat');chatFlushDeferredSessionSave();check(idleCancels===1&&timerCancels===0,'Idle flush cancelled an unrelated timer');
 window.requestIdleCallback=idle;window.cancelIdleCallback=cancelIdle;window.clearTimeout=clearTimer;chatSaveSessions=save;
 chatToggleSearch(false);chatHistoryReset();chatRenderMessages();
 let synchronousSaves=0;chatSaveSessions=()=>synchronousSaves++;
 await chatAppendAssistantReplies('收到啦，我们慢慢聊。',null,[],{turnId:'reply',splitAssistantReplies:false});check(synchronousSaves===0,'Reply still synchronously saves all sessions');chatFlushDeferredSessionSave();check(synchronousSaves===1,'Reply was not persisted after render');chatSaveSessions=save;
 check(document.querySelectorAll('#chat-messages>.chat-msg-row').length<=103,'Rendered history grew beyond latest 50 rounds');
 const route=chatMainRouteConfig;chatMainRouteConfig=()=>({providerName:'薄荷小站',model:'模型A',ok:false});chatEnsureMainRouteReady=()=>Promise.resolve();chatEnsureSessionsReady=()=>Promise.resolve();await chatNewSession();check(chatCurrentSession().title==='薄荷小站 + 模型A','New title is not provider + model');check(chatSessions.find(s=>s.id==='other').title==='旧窗口名称','Old title changed');chatMainRouteConfig=route;
 chatSelectSession('chat');chatToggleSearch(true);document.getElementById('chat-search-input').value='薄荷猫';await chatSearchMessages();await tick();
 check(document.getElementById('chat-search').scrollWidth<=innerWidth,'Search overflows phone');closeToast();
 return {accordion:true,providerSearch:true,searchPreviews:3,partialPersistence:true,deferredReplySave:true,defaultTitle:true};
})()
