(async()=>{
 document.getElementById('loading-wrap')?.remove();
 const check=(ok,message)=>{if(!ok)throw Error(message)},pause=ms=>new Promise(r=>setTimeout(r,ms));
 const until=async(fn,message)=>{for(let i=0;i<500;i++){if(fn())return;await pause(10)}throw Error(message)};
 const original={fetch:window.fetch,init:chatInit,route:chatEnsureMainRouteReady,toast,panelDataFetch,storedPanelKey};
 const results=[],notices=[],json=value=>new Response(JSON.stringify(value),{headers:{'Content-Type':'application/json'}});
 const field=id=>document.getElementById(id);
 let cfg,session,queueBody,releaseQueue,releaseReply,queueCalls,queueMethods,queueWrites,cleanCalls,posts,preparedTrims,preparedBase,preparedRevision,generatedCycles=0,modelRun=null,modelState='',deferQueue=false,queueReady=true,nightlyError=false,loseUploadResponse=false,failClean=false;
 chatInit=()=>{};chatEnsureMainRouteReady=async()=>({ok:true,apiBase:'https://example.invalid/v1',upstreamKey:'fixture',model:'fixture',provider:{id:'fixture'}});
 panelAuthKey='fixture';apiProvidersLoaded=true;apiProviders={};toast=text=>notices.push(String(text));
 function setup(label){
   if(chatNightlyTimer){clearTimeout(chatNightlyTimer);chatNightlyTimer=0;}
   chatSessionsReady=true;chatSessionsLoadPromise=null;chatSending=false;chatEditingIndex=-1;chatTrimBusy=false;chatTrimTransaction=null;
   chatNightlySynced={};chatNightlyStatus={};chatNightlySyncs=new Map();chatDigestEditors={};
   const now=Date.now();chatActiveSessionId='immediate-trim-'+label+'-'+Math.random().toString(36).slice(2);
   const messages=Array.from({length:label==='partial-production'?425:5},(_,i)=>[{role:'user',text:'原问题'+i,turnId:'old'+i,ts:now-900000+i*2000},
     {role:'assistant',text:'原回答'+i,turnId:'old'+i,ts:now-899000+i*2000}]).flat();
   session=chatNormalizeSession({id:chatActiveSessionId,title:'立即截断验证',messages,transportMessages:messages.map(m=>({role:m.role,content:m.text})),
     cacheLastReadAt:now,transportUpdated:now,updated:now,wakeEnabled:true,wakeSyncAt:now});
   chatSessions=[session];chatMessages=session.messages;chatSessionsLoadPromise=Promise.resolve(chatSessions);chatDraftImages=[];chatDraftFiles=[];
   cfg=Object.assign(chatDefaultConfig(),{sessionId:session.id,panelKey:'fixture',gatewayUrl:location.origin+'/gateway',recall:true,factRecallMode:'b',
     dailyDigestEnabled:true,digestCycleCount:3,autoTrimEnabled:false,autoTrimKeepRounds:2,splitAssistantReplies:false,
     mainRouteCacheStrategy:'native_5m',mainRouteProviderId:'fixture'});
   chatSaveConfigObject(cfg);chatWriteForm(cfg);chatRenderMessages({force:true,removeEphemeral:true});
   chatWakeState={};chatWakeState[session.id]={enabled:true,mode:'5m',interval:4,next_at:Date.now()/1000+240};chatWakeLastFetch=Date.now();
   chatWakePending=null;chatWakeBusy=false;chatWakeWriteBusy=false;
   queueBody=null;releaseQueue=null;releaseReply=null;queueCalls=0;queueMethods=[];queueWrites=[];cleanCalls=[];posts=[];preparedTrims=null;preparedBase=null;preparedRevision=0;generatedCycles=0;modelRun=null;modelState='';deferQueue=false;queueReady=true;nightlyError=false;loseUploadResponse=false;failClean=false;field('chat-input').value='未发送的输入草稿';
 }
 function prepared(body){
   const covered=new Set(body.base.entries.flatMap(e=>e.covered||[]));
   const groups=body.groups.filter(g=>body.candidate_keys.includes(g.key)&&!covered.has(g.key));
   if(queueReady&&groups.length&&!preparedTrims){
     const sequence=Math.max(0,...body.base.entries.map(e=>e.sequence||0))+1;
     preparedBase=structuredClone(body.base);
     const previous=preparedBase.entries.filter(e=>e.kind==='cycle'&&e.active!==false).at(-1);
     if(previous&&body.config.z>1)previous.brief={source:chatDigestStamp(previous.text),text:'简版第'+previous.sequence+'次'};
     preparedTrims=[{id:'cy-fixture-'+session.id+'-'+sequence,kind:'cycle',sequence,keys:groups.map(g=>g.key),text:'详细第'+sequence+'次：已完整整理本次选中的旧对话。',startTs:groups[0].start,endTs:groups.at(-1).end}];
     preparedRevision=(Number(body.revision)||1)+1;generatedCycles++;
   }
   const outstanding=preparedTrims&&preparedTrims.some(t=>t.keys.some(k=>!covered.has(k)));
   return {ok:true,status:modelState||(queueReady?'succeeded':'queued'),model_run:modelRun?{id:modelRun,state:modelState}:undefined,accepted_keys:body.groups.map(g=>g.key),snapshot:{revision:outstanding?preparedRevision:(Number(body.revision)||1)+(body.settings_override?1:0),source_stamp:body.base_stamp,config:body.config,base:outstanding?preparedBase:body.base,
     result:outstanding&&queueReady?{day:chatDailyDigestDayKey(Date.now())}:body.settings_override?{settings_only:true}:null,
     trims:outstanding?preparedTrims:[]}};
 }
 window.fetch=async(url,options={})=>{
   const target=new URL(url,location.href),body=options.body?JSON.parse(options.body):null;
   if(target.pathname.endsWith('/wake'))return json({ok:true,enabled:true,mode:'5m',interval:4,next_at:Date.now()/1000+240});
   if(target.pathname.endsWith('/queue')){
     queueCalls++;queueMethods.push(options.method||'GET');if(body)queueBody=body;
     if(body)queueWrites.push({body:structuredClone(body),syncStatus:session.digestLastSync?.status});
     if(body&&loseUploadResponse){prepared(body);loseUploadResponse=false;throw new TypeError('Failed to fetch')}
     const reply=()=>json(body?prepared(body):{ok:true,sessions:[prepared(queueBody)]});
     if(deferQueue)return new Promise(resolve=>{releaseQueue=()=>resolve(reply())});
     return reply();
   }
   if(target.pathname.endsWith('/clean-history')){
     cleanCalls.push(body);if(failClean){failClean=false;throw new TypeError('Failed to fetch')}
     return json({ok:true,synchronized:true,digest_sync_id:body.digest_sync_id});
   }
   if(target.pathname.endsWith('/chat')){
     posts.push(body);
     return new Response(new ReadableStream({start(controller){
       const emit=(event,data)=>controller.enqueue(new TextEncoder().encode('event: '+event+'\ndata: '+JSON.stringify(data)+'\n\n'));
       emit('delta',{text:'当前合成回复'});
       releaseReply=()=>{
         emit('reply_complete',{usage:{output_tokens:10,cache_read_input_tokens:5000}});
         emit('done',{transport_messages:[...(body.transport_messages||[]),{role:'user',content:body.text},{role:'assistant',content:'当前合成回复'}],usage:{output_tokens:10,cache_read_input_tokens:5000}});
         controller.close();
       };
     }}),{headers:{'Content-Type':'text/event-stream'}});
   }
   throw Error('Unexpected immediate-trim fixture request '+target.pathname);
 };
 try{
   setup('active');field('chat-input').value='正在发送的新问题';const sending=chatSendMessage();
   await until(()=>releaseReply&&chatMessages.some(m=>m.inFlight),'actual reply did not start');
   field('chat-digest-prepare').click();await until(()=>session.digestManualTrim&&queueBody?.manual_request,'manual click did not reach queue');
   const requested=[...session.digestManualTrim.keys];
   await until(()=>session.digestStaged,'ready snapshot not staged');
   check(cleanCalls.length===0,'manual trim ran during the active reply');
   field('chat-input').value='截断后仍保留的输入草稿';
   releaseReply();await sending;
   await until(()=>session.digestLastSync?.status==='synced','prepared manual range did not finish after transport caught up: '+JSON.stringify({requested:requested.length,candidates:queueBody.candidate_keys.length,view:chatDigestSyncView(session,cfg),decision:session.digestTrimDecision}));
   check(!session.digestManualTrim&&cleanCalls.length===1,'manual operation did not commit exactly once');
   check(chatMessages.some(m=>m.text==='正在发送的新问题')&&chatMessages.some(m=>m.text==='当前合成回复'),'new turn lost');
   check(CKChatHistory.localTurnGroups(chatMessages).length>=2&&CKChatHistory.transportTurnGroups(session.transportMessages).length>=2,'retained rounds lost');
   check(field('chat-input').value==='截断后仍保留的输入草稿','unsent draft changed');
   check(posts.length===1,'summary preparation submitted another chat');
   results.push({activeReply:true,alignedAfterReply:true,summaryReused:true,cleanCalls:cleanCalls.length,requestedSources:requested.length,preparedSources:preparedTrims[0].keys.length,queueCalls});
   await until(()=>!chatDigestMaintenanceBusy,'background maintenance did not settle');

   setup('poll');queueReady=false;field('chat-digest-prepare').click();await until(()=>queueBody,'queue request missing');
   delete session.digestManualTrim.immediate; // A pending request saved by the previous release.
   await until(()=>!chatNightlySyncs.size,'initial queue request did not finish');
   check(chatMessages.length===10&&cleanCalls.length===0,'unprepared sources were removed');
   chatMessages.push({role:'pending_user',text:'尚未提交的排队消息',pendingId:'pending-new',ts:Date.now()});
   queueReady=true;
   await until(()=>session.digestLastSync?.status==='synced','polling did not finish an existing legacy manual request');
   check(chatMessages.some(m=>m.pendingId==='pending-new'),'pending message removed');
   check(cleanCalls.length===1&&posts.length===0,'polling did not commit exactly once without a model request');
   results.push({pollToComplete:true,legacyRequest:true,pendingPreserved:true,queueCalls});
   await until(()=>!chatDigestMaintenanceBusy,'polling maintenance did not settle');

   setup('cancel');deferQueue=true;field('chat-digest-prepare').click();await until(()=>releaseQueue,'delayed queue missing');
   field('chat-digest-cancel-manual').click();releaseQueue();await until(()=>!chatNightlySyncs.size,'cancelled queue did not settle');await pause(60);
   check(!session.digestManualTrim&&chatMessages.length===10&&cleanCalls.length===0,'a late result executed a cancelled manual trim');
   results.push({cancelBeforeReady:true,lateResultPreservedHistory:true});

   setup('blocked');cfg.digestCurrentModel=true;chatSaveConfigObject(cfg);chatWriteForm(cfg);cfg=chatLoadConfig();
   modelRun='original-manual-run';modelState='blocked';queueReady=false;
   check(await chatRequestManualDigestTrim({currentModel:true}),'failed-run manual range missing');
   session.digestModelRun={id:modelRun,purpose:'trim',label:'合成订阅模型'};
   await chatSyncNightlyDigest(cfg,{force:true});
   const failedUpload=queueBody,failedSyncKey=chatNightlyScope(cfg)+':'+session.id;
   check(!failedUpload.model_run,'fixture unexpectedly started another model');
   const later=[{role:'user',text:'截断请求以后的新问题',turnId:'later',ts:Date.now()},{role:'assistant',text:'截断请求以后的新回答',turnId:'later',ts:Date.now()+1}];
   chatMessages.push(...later);session.transportMessages.push(...later.map(m=>({role:m.role,content:m.text})));session.updated=Date.now()+2;session.title+=' 本机新增';
   chatNightlySynced[failedSyncKey].at=Date.now()-30001;
   await chatMaybeRollDigestAtDayBoundary();
   check(queueBody===failedUpload&&cleanCalls.length===0,'blocked polling uploaded sources or cut history');
   check(chatDigestNeedsPolling(session,cfg),'failed run stopped looking for saved results');
   modelState='succeeded';queueReady=true;chatNightlySynced[failedSyncKey].readAt=Date.now()-30001;
   await chatMaybeRollDigestAtDayBoundary();
   await until(()=>session.digestLastSync?.status==='synced','saved failed-run result did not finish its original cut');
   check(queueBody===failedUpload&&queueCalls===3,'saved-result recovery uploaded history again');
   check(cleanCalls.length===1&&posts.length===0,'saved-result recovery submitted another model call or cut twice');
   check(session.digestLastSync.rounds===3&&CKChatHistory.localTurnGroups(chatMessages).length===3,'saved result cut the wrong range');
   check(later.every(m=>chatMessages.some(row=>row.text===m.text))&&session.transportMessages.some(m=>m.content===later[1].text),'newer completed round lost');
   check(!session.digestModelRun&&field('chat-input').value==='未发送的输入草稿','completed request or input draft changed');
   results.push({blockedSavedRecovery:true,originalRunOnly:true,newerRoundPreserved:true,noModelRequest:true});
   await until(()=>!chatDigestMaintenanceBusy,'failed-run recovery maintenance did not settle');

   setup('lost-upload');loseUploadResponse=true;field('chat-digest-prepare').click();
   await until(()=>chatNightlyStatus[session.id]?.local_error,'lost upload did not expose a recoverable error');
   check(chatMessages.length===10&&cleanCalls.length===0,'failed upload cut original history');
   const uploaded=queueBody;chatNightlySynced[chatNightlyScope(cfg)+':'+session.id].retryAt=0;
   await chatMaybeRollDigestAtDayBoundary();
   await until(()=>session.digestLastSync?.status==='synced','GET recovery did not finish the prepared cut');
   check(queueBody===uploaded,'recovery uploaded the old source again');
   check(chatMessages.length===4&&cleanCalls.length===1&&posts.length===0,'recovery did not commit exactly one cut without a model request');
   results.push({lostUploadRecovered:true,readBeforeResend:true,summaryReused:true});
   await until(()=>!chatDigestMaintenanceBusy,'recovery maintenance did not settle');

   setup('restored');session.replyDraft={state:'running',turn_id:'restored-original'};field('chat-digest-prepare').click();
   await until(()=>session.digestStaged,'restored task did not prepare');
   check(field('chat-digest-sync-now').disabled,'sync button allowed a restored active reply');
   check(field('chat-digest-schedule-status').textContent.includes('当前回复'),'waiting reason absent');
   check(cleanCalls.length===0,'restored active reply was trimmed');
   session.replyDraft=null;await chatMaybeRollDigestAtDayBoundary();
   await until(()=>session.digestLastSync?.status==='synced','restored task did not finish after recovery');
   results.push({restoredReplyGuard:true,visibleWaitReason:true});
   chatRenderNightlyStatus(session);
   check(field('chat-digest-schedule-status').textContent.includes('同步完成'),'final completion status missing');
   check(!field('chat-digest-prepare').textContent.includes('后台准备'),'old action wording remains');
   await until(()=>!chatDigestMaintenanceBusy,'restored maintenance did not settle');


   setup('cycles');
   navTo('chat');chatOpenSettingTab('digest');chatSelectCompactTab('digest');
   const originalInjection='【已实际注入的原总结】\n第一份完整正文。\n';
   session.dailyDigests=[{dayKey:chatDailyDigestDayKey(Date.now()),text:'原来的按天归档',covered:['historic-source']}];
   session.digestActivePack={scope:chatDigestActiveScope(cfg),config:'legacy-config',text:originalInjection,at:Date.now()};
   chatRenderDailyDigest(cfg);
   check(chatDailyDigestPack(cfg,session)===originalInjection,'initial migration changed actual injected bytes');
   check(session.dailyDigests.at(-1).sequence===1,'initial injection is not cycle one');
   const signed={type:'thinking',thinking:'synthetic thinking',signature:'fixture-signature'};
   session.transportMessages.at(-1).content=[signed,{type:'text',text:'原回答4'},{type:'text',text:'  保留空格\n'},
     {type:'text',text:'<ck_active_memory_event>旧记忆全本</ck_active_memory_event>'}];
   for(let sequence=2;sequence<=4;sequence++){
     if(sequence>2){
       const now=Date.now(),fresh=Array.from({length:3},(_,i)=>[{role:'user',text:'第'+sequence+'批新问题'+i,turnId:'cycle-'+sequence+'-'+i,ts:now+i*2000},
         {role:'assistant',text:'第'+sequence+'批新回答'+i,turnId:'cycle-'+sequence+'-'+i,ts:now+i*2000+1000}]).flat();
       chatMessages.push(...fresh);session.transportMessages.push(...fresh.map(m=>({role:m.role,content:m.text})));session.updated=now;
       preparedTrims=null;preparedBase=null;chatNightlySynced={};
     }
     const lastId=session.digestLastSync?.id;
     await window.__clickCycleAction('#chat-digest-prepare');
     await until(()=>session.digestLastSync?.status==='synced'&&session.digestLastSync.id!==lastId,'cycle '+sequence+' did not finish');
     await until(()=>!chatDigestMaintenanceBusy&&!chatNightlySyncs.size,'cycle queue did not settle');
     check(CKChatHistory.transportTurnGroups(session.transportMessages).length===2,'cycle did not retain two complete turns');
     if(sequence===2){
       check(session.transportMessages.some(m=>JSON.stringify(m.content).includes('fixture-signature')),'retained signature was lost');
       check(session.transportMessages.some(m=>JSON.stringify(m.content).includes('  保留空格\\n')),'unrelated whitespace changed');
     }
     check(!JSON.stringify(session.transportMessages).includes('旧记忆全本'),'an old full memory survived the cut');
     check(session.dailyDigests.filter(e=>e.kind==='cycle'&&e.active!==false).at(-1).sequence===sequence,'summary sequence drift');
   }
   const pack=chatDailyDigestPack(cfg,session);
   check(pack.includes('简版第2次')&&pack.includes('简版第3次')&&pack.includes('详细第4次'),'Z=3 did not yield brief2 + brief3 + detail4');
   check(!pack.includes('第一份完整正文')&&!pack.includes('详细第2次')&&!pack.includes('详细第3次'),'obsolete detail entered the active prompt');
   check(session.dailyDigests.find(e=>e.sequence===1).text===originalInjection,'first full original was not archived intact');
   check(generatedCycles===3,'completed cycle regenerated');
   check(field('chat-input').value==='未发送的输入草稿','cycles changed the unsent draft');

   field('chat-input').value='沿用已经同步的第 4 份总结';const nextSend=chatSendMessage();
   await until(()=>posts.length===1&&releaseReply,'next chat was not sent');
   check(posts[0].daily_digest_pack===pack,'next real chat request lost the frozen cycle pack');
   releaseReply();await nextSend;
   check(generatedCycles===3,'normal chat generated a new summary');
   await until(()=>!chatDigestMaintenanceBusy&&!chatNightlySyncs.size,'chat queue did not settle');
   results.push({zThreeFourCycles:true,originalInjectionPreserved:true,fullArchivePreserved:true,oldMemoryRemoved:true,signaturePreserved:true,nextRequestChecked:true,generatedCycles});
   for(const z of [2,3]){
     chatOpenSettingTab('digest');
     field('chat-digest-cycle-count').value=String(z);field('chat-digest-cycle-count').dispatchEvent(new Event('input',{bubbles:true}));
     const frozen=session.digestActivePack.text,beforeMessages=JSON.stringify(chatMessages);
     await window.__clickCycleAction('#chat-compact-digest button[onclick="chatSaveDailyDigestSetting()"]');cfg=chatLoadConfig();
     check(cfg.digestCycleCount===z&&session.digestActivePack.text===frozen,'Z save changed the warm prefix');
     await until(()=>session.digestStaged,'saved Z did not become ready for sync');
     await window.__clickCycleAction('#chat-digest-sync-now');
     await until(()=>session.digestLastSync?.status==='synced'&&!chatDigestMaintenanceBusy&&!chatNightlySyncs.size,'settings-only sync not acknowledged');
     check(generatedCycles===3&&JSON.stringify(chatMessages)===beforeMessages,'Z change generated a summary or cut conversation');
     check(JSON.stringify(session.dailyDigests.filter(e=>e.kind==='cycle'&&e.active!==false).map(e=>e.sequence))==='[3,4]','increasing Z revived a discarded archive');
     results.push({zSetting:z,noGeneration:true,noConversationCut:true,appliedAtSync:true});
   }
   chatSaveSessions();await chatSaveSessionsToIndexedDb.pending;
   const restored=(await chatLoadSessionsFromIndexedDb()).find(s=>s.id===session.id),finalPack=session.digestActivePack.text;
   check(restored.digestActivePack.text===finalPack&&restored.digestCycleMigration.firstId===session.digestCycleMigration.firstId,'durable reload lost cycle migration or injection');
   localStorage.setItem('ck_cycle_reload_fixture',JSON.stringify({id:session.id,pack:finalPack,first:originalInjection}));
   results.push({durableRestore:true,firstFullOriginal:true});
   chatOpenSettingTab('digest');chatSelectCompactTab('digest');chatRenderDailyDigest(cfg);
   check(!field('chat-digest-retention-days')&&!field('chat-digest-detail-days')&&!field('chat-digest-rollup-days'),'old X/Y fields remain');
   check(field('chat-digest-cycle-count').value==='3','Z default is not rendered');
   check(document.documentElement.scrollWidth<=innerWidth+1,'horizontal overflow');
   if(window.__captureCycleSettings)await window.__captureCycleSettings();

   return results;
 }finally{
   if(chatNightlyTimer){clearTimeout(chatNightlyTimer);chatNightlyTimer=0;}
   window.fetch=original.fetch;chatInit=original.init;chatEnsureMainRouteReady=original.route;toast=original.toast;
   panelDataFetch=original.panelDataFetch;storedPanelKey=original.storedPanelKey;currentPanelTab='chat';
 }
})()
