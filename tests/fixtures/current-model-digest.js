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
 check(!field('ck-records-current-model')&&!field('ck-records-manual-model'),'retired records mode remains');
 check(typeof ckRecordsModelMode==='undefined'&&typeof ckManualOrganizerAction==='undefined','retired actions remain');
 for(const kind of ['fact','events'])check(!field('manual-'+kind+'-mode'),'retired organizer remains');
 check(JSON.stringify({messages:chatMessages,transport:session.transportMessages})===chatBeforeRecords,'chat changed');
 navTo('records');
 return {dailySavedWithoutTrim:true,retiredOrganizersAbsent:true,manualTrimRounds:3,noAutomaticCalls:true,cleans,queuePosts:posts};
})()
