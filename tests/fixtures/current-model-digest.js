(async()=>{
 const check=(ok,message)=>{if(!ok)throw Error(message)},pause=ms=>new Promise(r=>setTimeout(r,ms));
 const until=async(fn,message)=>{for(let i=0;i<180;i++){if(fn())return;await pause(50)}throw Error(message+': '+document.getElementById('chat-digest-schedule-status').textContent)};
 const field=id=>document.getElementById(id),originalFetch=window.fetch,stats=()=>originalFetch('/fixture-stats').then(r=>r.json());
 let cleans=0,posts=0;window.fetch=(url,opts={})=>{if(String(url).endsWith('/clean-history'))cleans++;if(opts.method==='POST'&&String(url).includes('/queue'))posts++;return originalFetch(url,opts)};
 GRAPH_API_BASE=location.origin+'/gateway';API_BASE=location.origin+'/mcp';const notices=[];toast=text=>notices.push(String(text));chatInit=()=>{};panelAuthKey='fixture';apiProvidersLoaded=true;apiProviders={};
 CKBackendRoute.current.execution='claude_code_subscription';CKBackendRoute.current.mode='vps';CKBackendRoute.current.subscriptionModel='opus';
 let cfg,session;
 function setup(label){
  if(chatNightlyTimer){clearTimeout(chatNightlyTimer);chatNightlyTimer=0;}
  chatSessionsReady=true;chatSessionsLoadPromise=null;chatSending=false;chatEditingIndex=-1;chatTrimBusy=false;chatTrimTransaction=null;
  chatNightlySynced={};chatNightlyStatus={};chatNightlySyncs=new Map();chatDigestEditors={};
  const now=Date.now();chatActiveSessionId='manual-model-'+label+'-'+Math.random().toString(36).slice(2);
  const messages=Array.from({length:5},(_,i)=>[{role:'user',text:'周末安排'+i,turnId:'t'+i,ts:now-9000000+i*2000},{role:'assistant',text:'我记下了'+i,turnId:'t'+i,ts:now-8999000+i*2000}]).flat();
  session=chatNormalizeSession({id:chatActiveSessionId,title:'手动总结验证',messages,transportMessages:messages.map(m=>({role:m.role,content:m.text})),cacheLastReadAt:now-8000000,transportUpdated:now,updated:now});
  chatSessions=[session];chatMessages=session.messages;chatSessionsLoadPromise=Promise.resolve(chatSessions);
  cfg=Object.assign(chatDefaultConfig(),{sessionId:session.id,panelKey:'fixture',gatewayUrl:location.origin+'/gateway',dailyDigestEnabled:true,digestCurrentModel:true,dailyDigestDetailDays:0,dailyDigestRollupDays:0,autoTrimEnabled:true,autoTrimKeepRounds:2,autoTrimMinDropRounds:1,splitAssistantReplies:false});
  chatSaveConfigObject(cfg);chatWriteForm(cfg);chatRenderMessages({force:true,removeEphemeral:true});chatRenderDailyDigest(cfg);
  chatOpenSettingTab('digest');
 }
 document.getElementById('loading-wrap')?.remove();
 const before=await stats();setup('daily');
 check(field('chat-digest-current-model').checked,'current-model setting not rendered');
 const original=JSON.stringify(chatMessages);
 check(field('chat-digest-manual-model').value==='sonnet','subscription organizer default');
 field('chat-digest-manual-model').value='claude-sonnet-5-5';field('chat-digest-manual-model').dispatchEvent(new Event('input',{bubbles:true}));
 cfg=chatLoadConfig();check(chatManualModelRoute(cfg,'digest').selected.model==='claude-sonnet-5-5','specific model not selected');
 chatSaveConfig(true);check(chatLoadConfig().digestManualModel==='claude-sonnet-5-5','model lost on settings save');
 check(CKBackendRoute.current.subscriptionModel==='opus','organizer changed chat model');
 await chatSyncNightlyDigest(cfg,{force:true});await chatMaybeRollDigestAtDayBoundary();
 check((await stats()).runs===before.runs,'background started model');
 check(!(await chatApplyAutoTrimForPendingBatch(cfg,[{role:'pending_user',text:'next'}],null,{idleCheck:true})).trimmed,'idle auto trim enabled');
 check(await chatRefreshDigestNow('today'),'daily click not accepted '+JSON.stringify({notices,mode:chatLoadConfig().digestCurrentModel,gateway:chatLoadConfig().gatewayUrl,route:chatWindowApiRouteConfig(chatLoadConfig())}));
 await until(()=>session.digestLastSync?.status==='synced','daily not synced');
 check(JSON.stringify(chatMessages)===original,'daily summary cut chat');check(session.dailyDigests.length===1,'daily not saved');
 check(!session.digestManualTrim,'daily left manual trim request');check((await stats()).runs===before.runs+1,'daily request repeated');check((await stats()).lastModel==='claude-sonnet-5-5','exact model lost in real backend queue');
 const normalized=chatNormalizeSession(session);check(!normalized.digestModelRun,'completed run still pending');
 await until(()=>!chatDigestMaintenanceBusy,'maintenance not settled');
 setup('trim');field('chat-input').value='保留的草稿';
 check(await chatManualTrimNow(),'trim click not accepted');
 await until(()=>session.digestLastSync?.status==='synced','manual trim not synced');
 check(CKChatHistory.localTurnGroups(chatMessages).length===2,'wrong retained rounds');
 check(session.digestLastSync.rounds===3,'wrong cut count');check(field('chat-input').value==='保留的草稿','draft changed');
 check((await stats()).runs===before.runs+2,'trim request repeated');
 await chatMaybeRollDigestAtDayBoundary();check((await stats()).runs===before.runs+2,'completed run restarted');
 check(document.documentElement.scrollWidth<=innerWidth+1,'horizontal overflow');
 const chatBeforeRecords=JSON.stringify({messages:chatMessages,transport:session.transportMessages});
 await originalFetch('/fixture-seed-records',{method:'POST',body:'{}'});
 await ckRecordsRefresh();await ckRecordsModelMode(true);
 check(ckRecordsData.current_model===true,'records manual mode not saved');
 field('ck-records-manual-model').value='claude-sonnet-4-6';field('ck-records-manual-model').dispatchEvent(new Event('input',{bubbles:true}));
 check(await ckRecordsRun(),'records click not accepted');
 await ckRecordsRefresh();
 check(ckRecordsData.model_run.state==='succeeded','records not completed');check(ckRecordsData.model_run.route.model==='claude-sonnet-4-6','records exact model lost');
 check(chatLoadConfig().recordsManualModel==='claude-sonnet-4-6','record model not saved');
 check(JSON.stringify({messages:chatMessages,transport:session.transportMessages})===chatBeforeRecords,'records leaked work into chat');
 const priorPosts=(await stats()).organizer_posts.length;
 for(const kind of ['fact','events']){
  storedPanelKey=()=> 'fixture';panelDataFetch=(url,opts)=>originalFetch(typeof url==='function'?url('fixture'):url,opts);
  await ckManualOrganizerRefresh(kind);
  check((await stats()).organizer_posts.length===priorPosts+(kind==='fact'?0:3),'status triggered organizer');
  field('manual-'+kind+'-mode').checked=true;await ckManualOrganizerAction(kind,'model_mode');
  field('manual-'+kind+'-model').value='claude-sonnet-5-5';
  if(kind==='fact')field('manual-fact-day').value='2026-10-19';
  check(await ckManualOrganizerAction(kind,'run_model'),'manual organizer not accepted');
  const accepted=(await stats()).organizer_posts.at(-1);
  check(accepted.model==='claude-sonnet-5-5','organizer exact model lost');
  if(kind==='fact')check(accepted.day==='2026-10-19','fact day lost');
  check(field('manual-'+kind+'-run').disabled,'duplicate start enabled');
  check(await ckManualOrganizerAction(kind,'cancel_model'),'stop not accepted');
  check(field('manual-'+kind+'-stop').disabled,'stop did not settle');
 }
 check(JSON.stringify({messages:chatMessages,transport:session.transportMessages})===chatBeforeRecords,'organizers changed chat');
 navTo('records');
 return {dailySavedWithoutTrim:true,recordsDoNotChangeChat:true,manualTrimRounds:3,noAutomaticCalls:true,cleans,queuePosts:posts};
})()
