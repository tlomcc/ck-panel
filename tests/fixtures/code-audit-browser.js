(async()=>{
 const check=(ok,msg)=>{if(!ok)throw Error(msg)},deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {resolve,promise}};
 localStorage.clear();window.fetch=async()=>{throw Error('Offline fixture')};apiProvidersLoaded=true;chatInitialized=false;chatSessionsReady=true;
 document.getElementById('loading-wrap').classList.add('done');document.body.classList.add('chat-active');
 document.querySelectorAll('.panel-tab').forEach(el=>el.classList.toggle('active',el.id==='tab-chat'));
 chatActiveSessionId='one';chatMessages=[];chatSessions=[{id:'one',title:'附件检查',messages:[],dailyDigests:[]},{id:'two',title:'另一个窗口',messages:[],dailyDigests:[]}];
 let cfg=chatLoadConfig();cfg.sessionId='one';chatSaveConfigObject(cfg);chatWriteForm(cfg);chatRenderMessages();
 const textReader=chatReadTextFile,imageEncoder=chatEncodeImageFile;
 // Real FileReader + real render normalization must retain every file in one selection.
 chatDraftFiles=[];await chatOnFilesSelected({target:{files:[new File(['one'],'one.txt'),new File(['two'],'two.txt')]}});
 check(chatDraftFiles.length===2&&document.querySelectorAll('.chat-draft-file').length===2,'File batch was dropped by render normalization');
 chatDraftFiles=[];let pending=deferred();chatReadTextFile=()=>pending.promise;
 let reading=chatOnFilesSelected({target:{files:[{name:'late.txt'}]}});chatSelectSession('two');chatSelectSession('one');pending.resolve({name:'late.txt',content:'late'});await reading;
 check(chatDraftFiles.length===0,'A delayed file survived switching away and back');check(chatFileReadingCount===0,'Text read counter leaked');chatReadTextFile=textReader;
 const png='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aV1EAAAAASUVORK5CYII=';
 chatDraftImages=[];chatEncodeImageFile=async file=>({id:file.name,name:file.name,dataUrl:png});
 await chatOnImageFilesSelected({target:{files:[{name:'one',type:'image/png'},{name:'two',type:'image/png'}]}});
 check(chatDraftImages.length===2&&document.querySelectorAll('#chat-draft-images img').length===2,'Image batch was dropped by render normalization');
 chatDraftImages=[];pending=deferred();chatEncodeImageFile=()=>pending.promise;
 reading=chatOnImageFilesSelected({target:{files:[{name:'late',type:'image/png'}]}});chatSelectSession('two');pending.resolve({name:'late',dataUrl:png});await reading;
 check(chatDraftImages.length===0,'Image leaked to another session');
 // Cancelling and reopening the same message index is still a new editing context.
 chatEditingIndex=0;chatEditingImages=[];pending=deferred();
 reading=chatOnImageFilesSelected({target:{files:[{name:'edit',type:'image/png'}]}});chatCancelEdit();chatEditingIndex=0;chatEditingImages=[];pending.resolve({name:'edit',dataUrl:png});await reading;
 check(chatEditingImages.length===0,'Image leaked into a reopened editor');check(chatImageEncodingCount===0,'Image encoding counter leaked');chatCancelEdit();chatEncodeImageFile=imageEncoder;
 // When an IndexedDB transaction fails, immediately persist the full current fallback.
 chatActiveSessionId='one';chatSessions[0].messages=Array.from({length:140},(_,i)=>({role:i%2?'assistant':'user',text:'历史记录 '+i,ts:Date.now()+i}));chatMessages=chatSessions[0].messages;
 const open=chatOpenIndexedDb,originalToast=toast;let warnings=0;toast=()=>warnings++;
 chatIndexedDbFailed=false;chatStorageDegradedWarned=false;chatOpenIndexedDb=async()=>({transaction:()=>{throw Error('write failed')}});
 await chatSaveSessionsToIndexedDb(chatSessions.map(chatNormalizeSession));
 const stored=JSON.parse(localStorage.getItem(CHAT_MESSAGES_KEY));
 check(stored.find(s=>s.id==='one').messages.length===140,'IDB failure only preserved the 40-message summary');check(warnings===1,'Persistence failure did not warn exactly once');
 chatOpenIndexedDb=open;toast=originalToast;chatRenderMessages();closeToast();
 return {fileBatch:true,fileSessionRace:true,imageBatch:true,imageSessionRace:true,reopenedEditRace:true,fullFallbackMessages:140};
})()
