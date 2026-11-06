(async()=>{
 const check=(ok,message)=>{if(!ok)throw Error(message)},pause=ms=>new Promise(r=>setTimeout(r,ms));
 const until=async(fn,message)=>{for(let i=0;i<500;i++){if(fn())return;await pause(10)}throw Error(message)};
 const original={fetch:window.fetch,init:chatInit,route:chatEnsureMainRouteReady,toast,panelDataFetch,storedPanelKey};
 const results=[],notices=[],json=value=>new Response(JSON.stringify(value),{headers:{'Content-Type':'application/json'}});
 const field=id=>document.getElementById(id);
 let cfg,session,queueBody,releaseQueue,releaseReply,queueCalls,queueMethods,queueWrites,cleanCalls,posts,preparedTrims,modelRun=null,modelState='',deferQueue=false,queueReady=true,nightlyError=false,loseUploadResponse=false,failClean=false;
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
     dailyDigestEnabled:true,dailyDigestDetailDays:0,dailyDigestRollupDays:0,autoTrimEnabled:false,autoTrimKeepRounds:2,splitAssistantReplies:false,
     mainRouteCacheStrategy:'native_5m',mainRouteProviderId:'fixture'});
   chatSaveConfigObject(cfg);chatWriteForm(cfg);chatRenderMessages({force:true,removeEphemeral:true});
   chatWakeState={};chatWakeState[session.id]={enabled:true,mode:'5m',interval:4,next_at:Date.now()/1000+240};chatWakeLastFetch=Date.now();
   chatWakePending=null;chatWakeBusy=false;chatWakeWriteBusy=false;
   queueBody=null;releaseQueue=null;releaseReply=null;queueCalls=0;queueMethods=[];queueWrites=[];cleanCalls=[];posts=[];preparedTrims=null;modelRun=null;modelState='';deferQueue=false;queueReady=true;nightlyError=false;loseUploadResponse=false;failClean=false;field('chat-input').value='未发送的输入草稿';
 }
 function prepared(body){
   const groups=body.groups.filter(g=>body.candidate_keys.includes(g.key));
   if(queueReady&&groups.length&&!preparedTrims)preparedTrims=[{keys:groups.map(g=>g.key),text:'已完整整理本次选中的旧对话。',startTs:groups[0].start,endTs:groups.at(-1).end}];
   return {ok:true,status:modelState|| (nightlyError?'retry':queueReady?'succeeded':'queued'),model_run:modelRun?{id:modelRun,state:modelState}:undefined,last_error:nightlyError?'总结供应商返回 HTTP 524':'',accepted_keys:body.groups.map(g=>g.key),snapshot:{revision:2,source_stamp:body.base_stamp,config:body.config,base:body.base,
     result:queueReady?{day:chatDailyDigestDayKey(Date.now())}:null,
     trims:preparedTrims||[]}};
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

   setup('midnight');cfg.dailyDigestDetailDays=3;chatSaveConfigObject(cfg);chatWriteForm(cfg);cfg=chatLoadConfig();nightlyError=true;
   const yesterday=chatDigestShiftDay(chatDailyDigestDayKey(Date.now()),-1);
   session.dailyDigests=[{dayKey:yesterday,text:'昨日尚未精简的长总结'.repeat(500),covered:[]}];
   session.digestActivePack={scope:chatDigestActiveScope(cfg),config:chatDigestConfigStamp(cfg),text:'前一轮实际生效的稳定总结',at:Date.now()-1000};
   field('chat-digest-prepare').click();
   await until(()=>session.digestLastSync?.status==='synced','midnight summary timeout blocked a prepared manual cut');
   check(!session.digestStaged&&cleanCalls.length===1,'midnight cut did not consume its staged summary');
   field('chat-input').value='请沿用截断后的总结';const nextSend=chatSendMessage();
   await until(()=>posts.length===1&&releaseReply,'next request did not send');
   // The durable digest outbox contains source material for the background
   // worker. Only the remaining chat fields contribute to the model prompt.
   const {digest_queue:queuedSources,...chatRequest}=posts[0];
   const transmitted=JSON.stringify(chatRequest);
   check(transmitted.includes('已完整整理本次选中的旧对话。'),'the next actual request omitted the new trim summary');
   check(transmitted.includes('前一轮实际生效的稳定总结'),'the previous stable summary was lost');
   check(!transmitted.includes('昨日尚未精简的长总结'),'unready long daily source expanded the prompt');
   releaseReply();await nextSend;
   results.push({midnightSummaryInjected:true,stableSummaryPreserved:true,unrelatedNightly524DoesNotBlock:true,nextRequestChecked:true});

   for(const kind of ['changed-config','missing-pack','foreign-pack','auto-production','auto-retry','auto-guards','auto-cancelled','auto-foreign-run']){
     await until(()=>!chatDigestMaintenanceBusy,'previous maintenance did not settle');
     const automatic=kind.startsWith('auto-'),production=kind==='changed-config'||kind==='auto-production';
     setup(production?'partial-production':'partial-'+kind);
     cfg.digestCurrentModel=true;cfg.dailyDigestRetentionDays=10;cfg.dailyDigestDetailDays=3;cfg.dailyDigestRollupDays=2;
     if(production){
       cfg.autoTrimKeepRounds=100;
       session.transportMessages=session.transportMessages.map(m=>({...m,content:'传输记录 '+m.content}));
     }
     chatSaveConfigObject(cfg);chatWriteForm(cfg);cfg=chatLoadConfig();
     const yesterday=chatDigestShiftDay(chatDailyDigestDayKey(Date.now()),-1);
     session.dailyDigests=[{dayKey:yesterday,text:'完整保留的旧总结'.repeat(500),covered:[]}];
     if(kind!=='missing-pack')session.digestActivePack={scope:kind==='foreign-pack'?'another-connection':chatDigestActiveScope(cfg),
       config:chatDigestConfigStamp({...cfg,dailyDigestRollupDays:7}),text:kind==='foreign-pack'?'另一连接的冻结总结':'此前实际生效的稳定总结',at:Date.now()-1000};
     modelRun='original-partial-'+kind;modelState='blocked';
     check(await chatRequestManualDigestTrim({currentModel:true,immediate:automatic}),'partial manual request missing');
     session.digestModelRun={id:modelRun,purpose:'trim',label:'Claude 订阅 · 合成验证'};
     session.digestRemote={scope:chatDigestActiveScope(cfg),revision:1};
     const candidates=chatDigestCandidateGroups(session,cfg,chatMessages);
     queueBody={groups:candidates,candidate_keys:candidates.map(g=>g.key),base:chatNightlyBase(session),base_stamp:chatNightlyBaseStamp(cfg,session),config:chatNightlyConfig(cfg)};
     const chunks=candidates.length>306?[candidates.slice(0,306),candidates.slice(306)]:[candidates];
     preparedTrims=chunks.map((groups,i)=>({keys:groups.map(g=>g.key),text:'已复核的截断总结第'+(i+1)+'批。',startTs:groups[0].start,endTs:groups.at(-1).end}));
     const remote={session_id:session.id,revision:2,status:'blocked',ready_trim_groups:candidates.length,pending_groups:0,
       model_run:{id:modelRun,state:'blocked',route:{execution:'claude_code_subscription',model:'claude-opus-4-6'}},
       progress:{phase:'blocked',completed_batches:2,planned_batches:3,finished_at:Date.now()/1000},
       manual:{id:String(session.digestManualTrim.requestedAt),sources:candidates.length,ready_sources:candidates.length},
       last_error:'本次截断资料已完成总结，可点立刻同步；旧摘要压缩超时，保留待处理'};
     storedPanelKey=()=>cfg.panelKey;panelDataFetch=async()=>json({ok:true,sessions:[remote],history:{items:[]}});
     currentPanelTab='status';ckStatusTab='digest';document.body.classList.remove('chat-active');
     field('loading-wrap')?.remove();
     ['fact','topics','digest','events'].forEach(name=>{field('ck-status-'+name).hidden=name!=='digest';field('ck-status-tab-'+name).setAttribute('aria-selected',String(name==='digest'));});
     field('status-sub').textContent='截断进度 · 阶段、耗时与同步结果';
     document.querySelectorAll('.panel-tab').forEach(n=>n.classList.remove('active'));field('tab-status').classList.add('active');
     check(!session.digestStaged,'fixture must begin with metadata only');
     if(automatic){
       const requested=session.digestManualTrim.dropRounds,before=chatMessages.length;
       if(kind==='auto-retry')failClean=true;
       if(kind==='auto-cancelled'){modelState='cancelled';remote.model_run.state='cancelled';}
       if(kind==='auto-foreign-run')session.digestModelRun.id='different-new-request';
       if(kind==='auto-guards'){
         session.replyDraft={state:'running',turn_id:'recover-original'};
         const later=[{role:'user',text:'请求后新增的问题',turnId:'later',ts:Date.now()},
           {role:'assistant',text:'请求后新增的回答',turnId:'later',ts:Date.now()+1}];
         chatMessages.push(...later,{role:'pending_user',text:'尚未发送',pendingId:'retained-draft',ts:Date.now()+2});
         session.transportMessages.push(...later.map(m=>({role:m.role,content:m.text})));
       }
       await ckRefreshMaintenance(false);
       if(kind==='auto-cancelled'||kind==='auto-foreign-run'){
         check(cleanCalls.length===0&&chatMessages.length===before&&posts.length===0,'cancelled or unrelated request was applied automatically');
         check(session.digestManualTrim&&session.digestModelRun,'unrelated request metadata was cleared');
         results.push({automaticGuard:true,kind,historyPreserved:true,noModelRequest:true});continue;
       }
       if(kind==='auto-guards'){
         check(cleanCalls.length===0&&session.digestStaged,'active reply was not preserved');
         session.replyDraft=null;chatDigestEditors[session.id+':today']={text:'还未保存的总结编辑'};
         await ckRefreshMaintenance(false);check(cleanCalls.length===0,'unsaved editor was bypassed');
         delete chatDigestEditors[session.id+':today'];
         const staged=session.digestStaged,saved=staged.trims;
         staged.trims=saved.map((t,i)=>i?t:{...t,keys:t.keys.slice(1)});
         await ckRefreshMaintenance(false);check(cleanCalls.length===0,'missing source was cut automatically');
         staged.trims=saved;await ckRefreshMaintenance(false);
       }
       if(kind==='auto-retry'){
         check(session.digestLastSync?.status==='pending'&&cleanCalls.length===1,'failed acknowledgement was reported as synced');
         check(queueWrites.length===0,'new baseline uploaded before history acknowledgement');
         await chatDigestFinishManualTrim(cfg,session);check(cleanCalls.length===1,'failed synchronization ignored backoff');
         session.digestLastSync.lastAttemptAt=Date.now()-31000;
         await chatMaybeRollDigestAtDayBoundary();
       }
       await until(()=>session.digestLastSync?.status==='synced','original blocked run did not finish automatically: '+kind);
       check(!session.digestModelRun&&!session.digestManualTrim&&posts.length===0,'auto completion retained blocked local run or called a model');
       check(session.digestLastSync.rounds===requested,'automatic cut changed the requested boundary');
       check(cleanCalls.length===(kind==='auto-retry'?2:1),'automatic synchronization repeated a successful cut');
       const activePack=session.digestActivePack.text;
       check(activePack.includes('已复核的截断总结第1批')&&activePack.includes('此前实际生效的稳定总结'),'auto completion lost verified or previously active summary');
       check(session.digestActivePack.pendingCompaction&&remote.model_run.state==='blocked','old compaction was falsely marked complete');
       check(field('chat-input').value==='未发送的输入草稿','automatic synchronization changed input draft');
       if(production)check(candidates.length===650&&requested===325&&chatMessages.length===200&&session.transportMessages.length===200,'automatic production-shaped cut did not retain 100 rounds');
       if(kind==='auto-guards')check(chatMessages.some(m=>m.pendingId==='retained-draft')&&chatMessages.some(m=>m.text==='请求后新增的回答')&&session.transportMessages.some(m=>m.content==='请求后新增的回答'),'automatic cut removed newer or pending messages');
       await chatMaybeRollDigestAtDayBoundary();
       check(queueWrites.length>0&&queueWrites.every(w=>w.syncStatus==='synced'&&!w.body.model_run),'committed baseline was not uploaded only after acknowledgement');
       const coverage=new Set(queueWrites.at(-1).body.base.entries.flatMap(e=>e.covered||[]));
       check(candidates.every(g=>coverage.has(g.key)),'uploaded baseline omitted proven cut sources');
       const restored=chatNormalizeSession(JSON.parse(JSON.stringify(session)));
       check(chatDailyDigestPack(cfg,restored)===activePack,'automatic summary injection changed across restoration');
       chatSaveSessions({sessionIds:[session.id]});await chatSaveSessionsToIndexedDb.pending;
       const persisted=(await chatLoadSessionsFromIndexedDb()).find(s=>s.id===session.id);
       check(persisted&&persisted.digestLastSync.status==='synced'&&!persisted.digestModelRun&&
         chatDailyDigestPack(cfg,persisted)===activePack&&persisted.messages.length===session.messages.length,'IndexedDB did not persist the acknowledged cut and full summary');
       check(chatDigestSyncView(session,cfg,remote).status==='同步完成','old ready snapshot hid acknowledged synchronization');
       results.push({automaticStatusSync:true,kind,sourceGroups:candidates.length,cutRounds:requested,baselineAfterAck:true,restoredInjection:true,oldCompactionPending:true,noModelRequest:true});
       continue;
     }
     await ckRefreshMaintenance(false);
     const card=()=>field('ck-digest-monitor').querySelector('.mm-digest-result');
     const syncButton=()=>card().querySelector('[data-mm-digest-action="sync"]');
     check(queueCalls===1&&queueMethods[0]==='GET'&&session.digestStaged,'status did not read the saved snapshot once without uploading');
     check(!syncButton().disabled,'partial result button disabled: '+kind+' '+card().textContent);
     check(card().textContent.includes('等待截断同步')&&card().textContent.includes('共 3 批'),'partial result lost its honest progress');
     check(cleanCalls.length===0&&posts.length===0,'status view performed a cut or started a model');
     const before=chatMessages.length,requested=session.digestManualTrim.dropRounds;
     session.replyDraft={state:'running',turn_id:'unrecovered'};await ckRefreshMaintenance(false);
     check(syncButton().disabled,'status allowed sync during an unrecovered reply');
     session.replyDraft=null;
     const staged=session.digestStaged,trims=staged.trims;
     staged.trims=trims.map((t,i)=>i? t : {...t,keys:t.keys.slice(1)});await ckRefreshMaintenance(false);
     check(syncButton().disabled,'saved-pack recovery bypassed missing source coverage');
     check(await chatDigestSyncNow()===false&&chatMessages.length===before,'missing source was removed');
     if(chatNightlyTimer){clearTimeout(chatNightlyTimer);chatNightlyTimer=0;}
     staged.trims=trims;chatDigestEditors[session.id+':today']={text:'未保存的总结编辑'};
     await ckRefreshMaintenance(false);check(syncButton().disabled,'unsaved summary edit was bypassed');
     delete chatDigestEditors[session.id+':today'];await ckRefreshMaintenance(false);
     check(!syncButton().disabled,'button did not recover after guards cleared');
     check(syncButton().getBoundingClientRect().width>0,'status sync button is not visible');
     if(window.__clickDigestSync)await window.__clickDigestSync(kind);else syncButton().click();
     await until(()=>session.digestLastSync?.status==='synced','status button did not synchronize: '+kind);
     await until(()=>card().textContent.includes('同步完成'),'status hid the actual synchronization');
     check(cleanCalls.length===1&&posts.length===0,'partial sync did not commit exactly once without a model');
     check(session.digestLastSync.rounds===requested,'status reported the wrong actual cut');
     check(field('chat-input').value==='未发送的输入草稿','partial sync changed the input draft');
     check(session.digestActivePack.pendingCompaction&&remote.model_run.state==='blocked','partial cut falsely completed old compaction');
     const activePack=session.digestActivePack.text;
     check(activePack.includes('已复核的截断总结第1批'),'new summary missing from active pack');
     check(!activePack.includes('另一连接的冻结总结'),'foreign frozen pack was reused');
     if(kind==='changed-config'){
       check(candidates.length===650&&requested===325&&chatMessages.length===200&&session.transportMessages.length===200,'production-shaped source/round coverage is wrong');
       check(activePack.includes('此前实际生效的稳定总结')&&!activePack.includes('完整保留的旧总结'),'changed settings replaced the currently active summary');
     }else check(activePack.includes('完整保留的旧总结'),'missing pack lost the saved old summary');
     const restored=chatNormalizeSession(JSON.parse(JSON.stringify(session)));session=restored;chatSessions=[session];chatMessages=session.messages;
     check(chatDailyDigestPack(cfg,session)===activePack,'summary injection changed across session restoration');
     currentPanelTab='chat';document.body.classList.add('chat-active');field('tab-status').classList.remove('active');field('tab-chat').classList.add('active');
     field('chat-input').value='沿用这次已经同步的总结';const sending=chatSendMessage();
     await until(()=>posts.length===1&&releaseReply,'next request did not use the restored summary');
     check(posts[0].daily_digest_pack===activePack,'next request lost part of the recovered summary');
     releaseReply();await sending;
     results.push({partialStatusSync:true,kind,sourceGroups:candidates.length,cutRounds:requested,snapshotGetOnly:true,guardsPreserved:true,restoredInjection:true,oldCompactionPending:true});
     currentPanelTab='status';document.body.classList.remove('chat-active');field('tab-chat').classList.remove('active');field('tab-status').classList.add('active');
     await ckRefreshMaintenance(false);
   }
   return results;
 }finally{
   if(chatNightlyTimer){clearTimeout(chatNightlyTimer);chatNightlyTimer=0;}
   window.fetch=original.fetch;chatInit=original.init;chatEnsureMainRouteReady=original.route;toast=original.toast;
   panelDataFetch=original.panelDataFetch;storedPanelKey=original.storedPanelKey;currentPanelTab='chat';
 }
})()
