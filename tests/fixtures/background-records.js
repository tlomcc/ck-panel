(async()=>{
 const check=(ok,message)=>{if(!ok)throw Error(message)},json=x=>new Response(JSON.stringify(x),{headers:{'Content-Type':'application/json'}}),results=[];
 const original=window.fetch;let wakeWrites=[],cleanCalls=0;
 panelAuthKey='fixture';apiProvidersLoaded=true;chatInit=()=>{};toast=()=>{};
 window.fetch=async(url,options={})=>{
   const path=new URL(url,location.href).pathname,body=options.body?JSON.parse(options.body):null;
   if(path.endsWith('/wake')){if(body)wakeWrites.push(body);return json({ok:true,enabled:false,mode:'5m',interval_seconds:body?.interval_seconds||240})}
   if(path.endsWith('/daily-records'))return json({ok:true,enabled:true,status:'updated',last_day:'2026-10-09',todos:'- 周五归还图书',profile:'- 生日：5月21日',last_checked_at:1791540000,counts:{todos:10,profile:11},limit:5000});
   if(path.endsWith('/clean-history')){cleanCalls++;return json({ok:true,synchronized:true,digest_sync_id:body.digest_sync_id})}
   return json({ok:true,sessions:[]});
 };
 function setup(total,age=600000){
   if(chatNightlyTimer)clearTimeout(chatNightlyTimer);chatNightlyTimer=0;chatScheduleNightlySync=()=>{};
   chatSessionsReady=true;chatSending=false;chatTrimBusy=false;chatTrimTransaction=null;chatEditingIndex=-1;chatIdleTrimBusy=false;
   const now=Date.now(),messages=Array.from({length:total},(_,i)=>[{role:'user',text:'问题'+i,turnId:'t'+i,ts:now-age+i},{role:'assistant',text:'回答'+i,turnId:'t'+i,ts:now-age+i}]).flat();
   chatActiveSessionId='background-'+total+'-'+now;const session=chatNormalizeSession({id:chatActiveSessionId,title:'后台截断测试',messages,transportMessages:messages.map(m=>({role:m.role,content:m.text})),cacheLastReadAt:now-age,transportUpdated:now-age,updated:now-age});
   chatSessions=[session];chatMessages=session.messages;chatSessionsLoadPromise=Promise.resolve(chatSessions);chatDigestEditors={};chatNightlyStatus={};chatNightlySynced={};
   const cfg=Object.assign(chatDefaultConfig(),{sessionId:session.id,panelKey:'fixture',gatewayUrl:location.origin+'/gateway',autoTrimEnabled:true,autoTrimKeepRounds:40,autoTrimMinimumRounds:30,dailyDigestDetailDays:0,dailyDigestRollupDays:0,mainRouteCacheStrategy:'native_5m',mainRouteProviderId:'fixture'});
   apiProviders={provider_library:{providers:[{id:'fixture',name:'测试',url:'https://fixture.invalid/v1',key:'fixture',model:'fixture',cache_strategy:'native_5m'}]}};
   chatSaveConfigObject(cfg);chatWriteForm(cfg);chatWakeState={};chatWakeState[session.id]={enabled:false,mode:'5m',interval_seconds:240};chatWakeLastFetch=Date.now();
   const groups=chatDigestCandidateGroups(session,cfg,messages);session.digestReadyTrims=groups.length?[{keys:groups.map(g=>g.key),text:'已依据原文整理这批旧对话。',startTs:groups[0].start,endTs:groups.at(-1).end}]:[];
   return {session,cfg,groups};
 }
 let x=setup(78);
 check(x.groups.length===38,'78轮应有38轮候选');
 const prospective=chatDigestQueueForReply(x.cfg,x.session);check(prospective.auto.total===79&&prospective.candidate_keys.length===39,'手机离线后下一轮应可由服务器登记39轮');
 document.getElementById('chat-input').value='保留输入草稿';
 const cut=await chatApplyAutoTrimForPendingBatch(x.cfg,[],null,{idleCheck:true});
 check(cut.trimmed&&x.session.transportMessages.filter(m=>m.role==='user').length===40,'78轮缓存到期应自动保留40轮 '+JSON.stringify({boundary:cut.boundary,age:cut.cacheAgeMs,ttl:chatDigestCacheTtl(x.cfg),mode:chatWakeMode(x.cfg),strategy:x.cfg.mainRouteCacheStrategy,cache:x.cfg.cacheStrategy,polling:chatPollingEnabledForConfig(x.cfg),before:cut.before,keep:cut.keep,trim:chatAutoTrimConfigFrom(x.cfg),decision:x.session.digestTrimDecision,wakeStale:chatWakeStatusStale(x.session)}));
 check(x.session.messages.filter(m=>m.role==='user').length===40,'可见历史和发送历史必须同步');
 check(cleanCalls===1&&x.session.digestActivePack.text.includes('依据原文'),'新总结和历史需要一起提交');
 check(document.getElementById('chat-input').value==='保留输入草稿','截断不得丢草稿');results.push('78→40，无发送自动应用且保留草稿');
 x=setup(69);const skipped=await chatApplyAutoTrimForPendingBatch(x.cfg,[],null,{idleCheck:true});check(!skipped.trimmed&&x.session.messages.length===138,'69轮不应截断');results.push('69轮跳过');
 x=setup(70);const threshold=await chatApplyAutoTrimForPendingBatch(x.cfg,[],null,{idleCheck:true});check(threshold.trimmed&&threshold.dropped===30,'70轮达到阈值');results.push('70轮处理30轮');
 x=setup(78,120000);check(!(await chatApplyAutoTrimForPendingBatch(x.cfg,[],null,{idleCheck:true})).trimmed,'5m缓存仍有效不得提前截断');results.push('缓存有效期保护');
 chatOpenSettingTab('display');ckSettingsMount();
 for(const tab of ['interface','wake','connection','history','time','billing','cleanup','tools']){ckSettingsSelect(tab);check(document.querySelectorAll('.ck-settings-page:not([hidden])').length===1,'设置必须一次只显示一个小tab');}
 chatOpenSettingTab('gateway');check(ckSettingsPage==='connection'&&document.getElementById('chat-side-display').classList.contains('active'),'旧API入口须定位合并后的连接tab');
 chatOpenSettingTab('cleanup');check(ckSettingsPage==='cleanup','旧清理入口须定位清理tab');results.push('8个设置tab与旧入口定位');
 ckSettingsSelect('wake');await chatWakeRefresh();
 const minuteRect=document.getElementById('chat-wake-minutes').getBoundingClientRect(),secondRect=document.getElementById('chat-wake-seconds').getBoundingClientRect();check(Math.abs(minuteRect.top-secondRect.top)<2&&minuteRect.width<=64,'分秒输入必须同一行固定宽度');
 const oldMode=chatWakeMode;chatWakeMode=()=> '5m';
 document.getElementById('chat-wake-minutes').value='4';document.getElementById('chat-wake-seconds').value='51';const before=wakeWrites.length;await chatWakeSaveInterval();check(wakeWrites.length===before,'4分51秒不可保存');
 document.getElementById('chat-wake-seconds').value='50';await chatWakeSaveInterval();check(wakeWrites.at(-1).interval_seconds===290,'4分50秒应保存290秒');
 chatWakeMode=()=> '1h';document.getElementById('chat-wake-minutes').value='59';document.getElementById('chat-wake-seconds').value='51';const count=wakeWrites.length;await chatWakeSaveInterval();check(wakeWrites.length===count,'59分51秒不可保存');
 document.getElementById('chat-wake-seconds').value='50';await chatWakeSaveInterval();check(wakeWrites.at(-1).interval_seconds===3590,'59分50秒应保存3590秒');chatWakeMode=oldMode;results.push('秒级唤醒边界');
 check(allApiGroups().some(g=>g.key==='event_audit')&&allApiGroups().some(g=>g.key==='daily_records_audit'),'两种新审核必须独立配置');
 chatToggleSettings(false);currentPanelTab='records';document.querySelectorAll('.panel-tab').forEach(p=>p.classList.toggle('active',p.id==='tab-records'));await ckRecordsRefresh();
 check(document.getElementById('ck-records-todos').value==='- 周五归还图书','待办框显示');check(document.getElementById('ck-records-profile').value==='- 生日：5月21日','基本信息框显示');
 check(!document.getElementById('ck-records-state').textContent.includes('正在读取'),'每日记录更新状态');results.push('两个记录框与独立模型配置');
 const rect=document.getElementById('tab-records').getBoundingClientRect();check(rect.width<=innerWidth+1,'记录页不得横向溢出');
 return results;
})()
