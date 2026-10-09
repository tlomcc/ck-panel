(async()=>{
 const check=(ok,message)=>{if(!ok)throw Error(message)},pause=ms=>new Promise(r=>setTimeout(r,ms));
 const until=async(fn,message)=>{for(let i=0;i<500;i++){if(fn())return;await pause(10)}throw Error(message)};
 const original={fetch:window.fetch,init:chatInit,route:chatEnsureMainRouteReady,toast};
 const results=[],notices=[],json=value=>new Response(JSON.stringify(value),{headers:{'Content-Type':'application/json'}});
 const field=id=>document.getElementById(id);
 let cfg,session,queueBody,releaseQueue,releaseReply,queueCalls,cleanCalls,posts,preparedTrims,deferQueue=false,queueReady=true;
 chatInit=()=>{};chatEnsureMainRouteReady=async()=>({ok:true,apiBase:'https://example.invalid/v1',upstreamKey:'fixture',model:'fixture',provider:{id:'fixture'}});
 panelAuthKey='fixture';apiProvidersLoaded=true;apiProviders={};toast=text=>notices.push(String(text));
 function setup(label){
   if(chatNightlyTimer){clearTimeout(chatNightlyTimer);chatNightlyTimer=0;}
   chatSessionsReady=true;chatSessionsLoadPromise=null;chatSending=false;chatEditingIndex=-1;chatTrimBusy=false;chatTrimTransaction=null;
   chatNightlySynced={};chatNightlyStatus={};chatNightlySyncs=new Map();chatDigestEditors={};
   const now=Date.now();chatActiveSessionId='immediate-trim-'+label+'-'+Math.random().toString(36).slice(2);
   const messages=Array.from({length:5},(_,i)=>[{role:'user',text:'原问题'+i,turnId:'old'+i,ts:now-60000+i*2000},
     {role:'assistant',text:'原回答'+i,turnId:'old'+i,ts:now-59000+i*2000}]).flat();
   session=chatNormalizeSession({id:chatActiveSessionId,title:'立即截断验证',messages,transportMessages:messages.map(m=>({role:m.role,content:m.text})),
     cacheLastReadAt:now,transportUpdated:now,updated:now,wakeEnabled:true,wakeSyncAt:now});
   chatSessions=[session];chatMessages=session.messages;chatSessionsLoadPromise=Promise.resolve(chatSessions);chatDraftImages=[];chatDraftFiles=[];
   cfg=Object.assign(chatDefaultConfig(),{sessionId:session.id,panelKey:'fixture',gatewayUrl:location.origin+'/gateway',recall:true,factRecallMode:'b',
     dailyDigestEnabled:true,dailyDigestDetailDays:0,dailyDigestRollupDays:0,autoTrimEnabled:false,autoTrimKeepRounds:2,splitAssistantReplies:false,
     mainRouteCacheStrategy:'native_5m',mainRouteProviderId:'fixture'});
   chatSaveConfigObject(cfg);chatWriteForm(cfg);chatRenderMessages({force:true,removeEphemeral:true});
   chatWakeState={};chatWakeState[session.id]={enabled:true,mode:'5m',interval:4,next_at:Date.now()/1000+240};chatWakeLastFetch=Date.now();
   chatWakePending=null;chatWakeBusy=false;chatWakeWriteBusy=false;
   queueBody=null;releaseQueue=null;releaseReply=null;queueCalls=0;cleanCalls=[];posts=[];preparedTrims=null;deferQueue=false;queueReady=true;field('chat-input').value='未发送的输入草稿';
 }
 function prepared(body){
   const groups=body.groups.filter(g=>body.candidate_keys.includes(g.key));
   if(queueReady&&groups.length&&!preparedTrims)preparedTrims=[{keys:groups.map(g=>g.key),text:'已完整整理本次选中的旧对话。',startTs:groups[0].start,endTs:groups.at(-1).end}];
   return {ok:true,status:queueReady?'succeeded':'queued',accepted_keys:body.groups.map(g=>g.key),snapshot:{revision:2,source_stamp:body.base_stamp,config:body.config,base:body.base,
     result:queueReady?{day:chatDailyDigestDayKey(Date.now())}:null,
     trims:preparedTrims||[]}};
 }
 window.fetch=async(url,options={})=>{
   const target=new URL(url,location.href),body=options.body?JSON.parse(options.body):null;
   if(target.pathname.endsWith('/wake'))return json({ok:true,enabled:true,mode:'5m',interval:4,next_at:Date.now()/1000+240});
   if(target.pathname.endsWith('/queue')){
     queueCalls++;if(body)queueBody=body;
     const reply=()=>json(body?prepared(body):{ok:true,sessions:[prepared(queueBody)]});
     if(deferQueue)return new Promise(resolve=>{releaseQueue=()=>resolve(reply())});
     return reply();
   }
   if(target.pathname.endsWith('/clean-history')){
     cleanCalls.push(body);return json({ok:true,synchronized:true,digest_sync_id:body.digest_sync_id});
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
   return results;
 }finally{
   if(chatNightlyTimer){clearTimeout(chatNightlyTimer);chatNightlyTimer=0;}
   window.fetch=original.fetch;chatInit=original.init;chatEnsureMainRouteReady=original.route;toast=original.toast;
 }
})()
