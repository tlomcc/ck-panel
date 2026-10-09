(async()=>{
 const assert=(ok,message)=>{if(!ok)throw Error(message)},pause=ms=>new Promise(r=>setTimeout(r,ms));
 const until=async(fn,message)=>{for(let i=0;i<200;i++){if(fn())return;await pause(10)}throw Error(message)};
 const original={fetch:window.fetch,init:chatInit,route:chatEnsureMainRouteReady,trim:chatApplyAutoTrimForPendingBatch,
   idle:chatMaybeAutoTrimAtIdleBoundary,clean:chatMaybeAutoClean,sync:chatScheduleNightlySync,schedule:chatScheduleRecovery,toast};
 chatInit=()=>{};chatEnsureMainRouteReady=async()=>({ok:true,apiBase:'https://example.invalid/v1',upstreamKey:'fixture',model:'fixture',provider:{id:'fixture'}});
 panelAuthKey='fixture';apiProvidersLoaded=true;apiProviders={};
 chatApplyAutoTrimForPendingBatch=async()=>({trimmed:false});chatMaybeAutoTrimAtIdleBoundary=()=>{};chatMaybeAutoClean=()=>{};chatScheduleNightlySync=()=>{};
 chatScheduleRecovery=delay=>original.schedule(Math.min(Number(delay)||0,10));
 const notices=[];toast=text=>notices.push(String(text));
 const input=document.getElementById('chat-input'),results=[];let cfg,posts,wakes,writes,mode,stream,receiptPolls,finishNormal,finishUpload,receiptMode;
 const json=value=>new Response(JSON.stringify(value),{headers:{'Content-Type':'application/json'}});
 function setup(enabled,recall){
   chatReleaseSendingUi();chatStreamProgressStop();chatFlushAssistantRevealQueue();
   if(chatRecoveryTimer){clearTimeout(chatRecoveryTimer);chatRecoveryTimer=0;}
   chatRecoverInFlightBusy=false;chatSessionsReady=true;chatSessionsLoadPromise=null;chatEditingIndex=-1;
   chatMessages=[];chatActiveSessionId='wake-compat-'+Math.random().toString(36).slice(2);
   chatSessions=[chatNormalizeSession({id:chatActiveSessionId,messages:chatMessages,transportMessages:[],updated:Date.now(),wakeEnabled:enabled,wakeSyncAt:Date.now()})];
   chatSessionsLoadPromise=Promise.resolve(chatSessions);
   chatMessages=chatSessions[0].messages;chatDraftImages=[];chatDraftFiles=[];
   cfg=chatDefaultConfig();Object.assign(cfg,{sessionId:chatActiveSessionId,panelKey:'fixture',recall,factRecallMode:'b',autoTrimEnabled:false,splitAssistantReplies:false,mainRouteCacheStrategy:'native_5m',mainRouteProviderId:'fixture'});
   chatSaveConfigObject(cfg);chatWriteForm(cfg);chatRenderMessages({force:true,removeEphemeral:true});
   chatWakeState={};chatWakeState[cfg.sessionId]={enabled,mode:'5m',interval:4,next_at:Date.now()/1000+240};
   chatWakePending=null;chatWakePendingScope='';chatWakeWriteBusy=false;chatWakeBusy=false;chatWakeLastFetch=Infinity;
   posts=[];wakes=[];writes=[];mode='normal';stream=null;receiptPolls=0;finishNormal=null;finishUpload=null;receiptMode='complete';
 }
 window.fetch=async(url,options={})=>{
   const target=new URL(url,location.href),body=options.body?JSON.parse(options.body):{};
   if(target.pathname.endsWith('/wake')){
     if(options.method==='POST'){writes.push(body);return json({ok:true,enabled:body.enabled,mode:'5m',interval:4,next_at:Date.now()/1000+240});}
     return new Promise((resolve,reject)=>{wakes.push({resolve,sid:target.searchParams.get('session_id')});options.signal?.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError')),{once:true})});
   }
   if(target.pathname.endsWith('/chat/last')){
     receiptPolls++;const last=posts.at(-1);
     if(receiptMode==='error')throw new TypeError('synthetic recovery connection failure');
     if(receiptMode==='missing')return json({ok:true,found:false,pending:false,turn_id:''});
     return json({ok:true,found:true,pending:false,state:'complete',turn_matched:true,turn_id:last.turn_id,created_at:Date.now()/1000,
       assistant_text:'息屏前的片段，恢复后的完整回复。',usage:{output_tokens:12,cache_read_input_tokens:5000},
       transport_messages:[{role:'user',content:last.text},{role:'assistant',content:'息屏前的片段，恢复后的完整回复。'}]});
   }
   if(target.pathname.endsWith('/chat')){
     posts.push(body);
     const openStream=()=>new Response(new ReadableStream({start(c){
       stream=c;if(mode!=='suspended')options.signal?.addEventListener('abort',()=>{try{c.error(new DOMException('Aborted','AbortError'))}catch(e){}},{once:true});
       const emit=(event,data)=>c.enqueue(new TextEncoder().encode('event: '+event+'\ndata: '+JSON.stringify(data)+'\n\n'));
       emit('memory',{chars:body.recall?120:0,preview:body.recall?'合成召回材料':''});
       emit('delta',{text:mode==='suspended'?'息屏前的片段':'兼容性回复'});
       if(mode==='suspended')return;
       emit('reply_complete',{usage:{output_tokens:12,cache_read_input_tokens:5000}});
       finishNormal=()=>emit('done',{});
       setTimeout(finishNormal,80);
     }}),{headers:{'Content-Type':'text/event-stream'}});
     if(mode==='uploading')return new Promise((resolve,reject)=>{
       finishUpload=()=>resolve(openStream());
       options.signal?.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError')),{once:true});
     });
     return openStream();
   }
   throw Error('Unexpected fixture request '+target.pathname);
 };
 function releaseReads(){for(const item of wakes)item.resolve(json({ok:true,enabled:false,mode:'5m',interval:4}));}
 try{
   for(const enabled of [false,true])for(const recall of [false,true]){
     setup(enabled,recall);input.value='正常发送';const started=performance.now(),running=chatSendMessage();
     await until(()=>posts.length===1,'normal chat waited for wake-state GET');
     assert(wakes.length===1,'fixture must leave the actual wake GET unresolved');
     assert(posts[0].recall===recall,'recall switch changed in outgoing request');
     const elapsed=performance.now()-started;assert(elapsed<1500,'wake state delayed normal send');
     await until(()=>document.getElementById('chat-head-progress').textContent.includes('同步回复'),'normal completion sync not visible');
     assert(!document.getElementById('chat-head-progress').textContent.includes('补收'),'normal stream falsely showed recovery');
     await running;assert(!chatSending&&chatMessages.some(m=>m.role==='assistant'),'normal send stuck');
     releaseReads();await pause(10);results.push({wake:enabled,recall,sendBeforeWakeRead:true,elapsedMs:Math.round(elapsed)});
   }
   setup(true,true);mode='suspended';input.value='息屏恢复';const running=chatSendMessage();
   await until(()=>stream&&chatActiveRequest?.responseReceived,'stream did not start');
   input.value='用户已点击发送的下一条';await chatSendMessage();
   assert(chatPendingMessages().some(m=>m.text==='用户已点击发送的下一条'),'queued message missing');
   const request=chatActiveRequest;request.hiddenAt=Date.now()-60000;
   assert(chatSessionStorageData(100,1000,1000)[0].replyDraft.queuedPendingIds.length===1,'queued intent missing from the reload snapshot');
   input.value='尚未点击发送的草稿';
   mode='normal';
   const resumed=performance.now();window.dispatchEvent(new Event('pageshow'));
   await running;await until(()=>receiptPolls===1&&!chatMessages.some(m=>m.inFlight&&m.turnId===request.turnId),'foreground recovery did not complete promptly');
   assert(performance.now()-resumed<1500,'foreground waited for the stale 45s stream timeout');
   assert(posts.filter(p=>p.turn_id===request.turnId).length===1,'recovery resent a paid model request');
   assert(chatMessages.filter(m=>m.role==='assistant'&&m.turnId===request.turnId).length===1,'recovery lost or duplicated the original reply');
   assert(!request.stopped,'resuming was treated as user Stop');
   assert(chatMessages.some(m=>m.text==='用户已点击发送的下一条'),'recovery lost explicitly queued message');
   await until(()=>posts.length===2,'explicitly queued send did not resume automatically');await until(()=>!chatSending,'queued send did not finish');
   assert(posts[1].text==='用户已点击发送的下一条'&&input.value==='尚未点击发送的草稿','recovery included an unsubmitted draft');
   assert(!chatPendingMessages().length&&!chatSending,'queued message remained stuck');releaseReads();await pause(10);
   results.push({screenResume:true,originalPosts:1,recoveryGets:receiptPolls,nextMessageSent:true});

   for(const receipt of ['missing','error','complete']){
     setup(true,true);mode='uploading';receiptMode=receipt;input.value='尚在上传的消息';const running=chatSendMessage();
     await until(()=>posts.length===1,'upload did not start');const request=chatActiveRequest;request.hiddenAt=Date.now()-1000;
     assert(!request.responseReceived,'fixture unexpectedly received a first byte');
     await chatResumeAfterVisibility();
     if(receipt==='complete'){
       await running;await until(()=>chatMessages.some(m=>m.role==='assistant'&&m.turnId===request.turnId),'confirmed upload did not recover');
       assert(request.controller.signal.aborted&&!request.stopped,'confirmed turn did not switch to recovery');
     }else{
       assert(!request.controller.signal.aborted&&chatActiveRequest===request,'unconfirmed upload was prematurely aborted');
       mode='normal';finishUpload();await running;
       assert(chatMessages.some(m=>m.role==='assistant'&&m.turnId===request.turnId),'original upload was lost');
     }
     assert(posts.length===1,'upload recovery duplicated the original POST');releaseReads();await pause(10);
     results.push({uploadReceipt:receipt,originalPosts:1,unconfirmedUploadPreserved:receipt!=='complete'});
   }

   setup(false,true);const read=chatWakeRefresh();await until(()=>wakes.length===1,'wake read not started');
   await chatWakeSave({enabled:true});assert(writes.length===1,'save waited for slow read');
   assert(chatWakeState[cfg.sessionId].enabled===true,'save not reflected');releaseReads();await read;
   assert(chatWakeState[cfg.sessionId].enabled===true,'late read overwrote saved switch');
   results.push({lateReadCannotUndoToggle:true});
   return {cases:results,notices:notices.filter(n=>/超时|失败/.test(n))};
 }finally{
   releaseReads();window.fetch=original.fetch;chatInit=original.init;chatEnsureMainRouteReady=original.route;chatApplyAutoTrimForPendingBatch=original.trim;
   chatMaybeAutoTrimAtIdleBoundary=original.idle;chatMaybeAutoClean=original.clean;chatScheduleNightlySync=original.sync;chatScheduleRecovery=original.schedule;toast=original.toast;
   if(chatRecoveryTimer){clearTimeout(chatRecoveryTimer);chatRecoveryTimer=0;}chatWakeLastFetch=Infinity;
 }
})()
