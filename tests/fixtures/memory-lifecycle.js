(async()=>{
 const check=(ok,msg)=>{if(!ok)throw new Error(msg)},tick=()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
 window.fetch=async()=>{throw new Error('Offline fixture')};localStorage.clear();apiProvidersLoaded=true;chatInitialized=false;chatSessionsReady=true;
 chatSaveSessionsToIndexedDb=()=>Promise.resolve();chatEnsureSessionsReady=()=>Promise.resolve(chatSessions);
 chatSaveWorldbooksRemote=async()=>true;chatLoadWorldbooksRemote=async()=>true;
 document.getElementById('loading-wrap').classList.add('done');
 document.querySelectorAll('.panel-tab').forEach(el=>el.classList.toggle('active',el.id==='tab-chat'));
 const now=Date.now(),day=chatDailyDigestDayKey(now);
 const entry=(id,text)=>({id,dayKey:day,startTs:now-4000,endTs:now-2000,text,createdAt:now-1000});
 chatSessions=[{id:'small',title:'小克',created:now-10000,updated:now-1000,messages:[],dailyDigests:[entry('d1','今天的约定')]},{id:'other',title:'其他窗口',messages:[],dailyDigests:[]}];
 chatActiveSessionId='other';chatMessages=[];
 let cfg=chatLoadConfig();cfg.sessionId='other';cfg.newSessionDigestSyncEnabled=true;cfg.worldbooks=Array.from({length:100},(_,i)=>({id:'b'+i,name:i===0?'小克与我的日常约定':'人物与背景资料 '+i,enabled:i<4,priority:i,content:'一起收集日常的小事。\n\n称呼、喜好和共同的约定，都可以写在这里。\n\n对话中自然地使用这些背景，不需要每轮重复。'}));
 chatSaveConfigObject(cfg);chatWriteForm(cfg);
 // Delayed IDB hydration must still gate New chat, but a pending nightly
 // summary is background work and must not hold the conversation hostage.
 let hydrate,finish;chatEnsureSessionsReady=()=>new Promise(r=>hydrate=r);chatDailyDigestChain=new Promise(r=>finish=r);
 const creating=chatNewSession();await Promise.resolve();check(chatSessions.length===2,'Created before hydration');hydrate();await creating;await tick();check(chatSessions.length===3,'New chat waited for hydration, not for the pending digest');
 finish();
 check(chatCurrentSession().dailyDigests.length===1,'Existing summary inheritance missing');
 check(chatCurrentSession().dailyDigests[0].text.includes('今天的约定'),'Earlier summary content not inherited');chatCurrentSession().dailyDigests[0].text='独立修改';check(chatSessions.find(s=>s.id==='small').dailyDigests.every(d=>d.text!=='独立修改'),'Inherited summary shares references');
 chatEnsureSessionsReady=()=>Promise.resolve(chatSessions);
 cfg=chatLoadConfig();cfg.newSessionDigestSyncEnabled=false;chatSaveConfigObject(cfg);chatWriteForm(cfg);await chatNewSession();check(chatCurrentSession().dailyDigests.length===0,'Disabled inheritance still copied');
 // Per-window recall persists through config saves, hydration and latest empty turns.
 const a=chatCurrentSession(),user={role:'user',text:'我们上次约定了什么？',turnId:'t1',ts:now};a.messages=[user];chatMessages=a.messages;
 chatStoreSessionRecall(a.id,{state:'ready',preview:'约定：每天留一点时间分享日常。',chars:19},now,'t1');
 chatOpenSettingTab('memory');check(document.getElementById('chat-memory-pack').value.includes('分享日常'),'Recall missing from settings');chatSaveConfig(true);
 chatSelectSession('other');chatOpenSettingTab('memory');check(document.getElementById('chat-memory-pack').value==='','Recall leaked to other window');
 chatSelectSession(a.id);check(document.getElementById('chat-memory-pack').value.includes('分享日常'),'Recall lost on return');
 const stored=chatSessionStorageData(100,100,100).find(s=>s.id===a.id);check(chatNormalizeSession(stored).latestRecall.preview.includes('分享日常'),'Recall lost on persistence');
 chatMessages.push({role:'assistant',text:'当然记得。',recall:{preview:'旧召回'},turnId:'t1',ts:now+1},{role:'user',text:'新一轮',turnId:'t2',ts:now+2});
 chatStoreSessionRecall(a.id,{state:'empty',preview:'',chars:0},now+2,'t2');chatRenderSessionRecall();check(document.getElementById('chat-memory-pack').value==='','Latest miss displayed older recall');
 chatToggleSettings(false);cfg=chatLoadConfig();cfg.recall=true;cfg.factRecallMode='b';chatSaveConfigObject(cfg);chatWriteForm(cfg);chatRenderQuickRecallControls(cfg);
 const button=document.getElementById('chat-quick-fact-toggle');button.click();button.focus();await tick();
 check(button.getAttribute('aria-pressed')==='false','Recall B did not switch off');check(getComputedStyle(button).backgroundColor==='rgba(0, 0, 0, 0)','Off toggle retains background');check(getComputedStyle(button.querySelector('.chat-recall-bookmark')).fill==='none','Off toggle retains fill');
 button.click();check(button.getAttribute('aria-pressed')==='true','Recall B did not switch on');
 const wrap=document.createElement('div');wrap.innerHTML=chatCacheTickHtml({cacheState:'full'})+chatCacheTickHtml({cacheState:'partial'});document.body.append(wrap);
 check(getComputedStyle(wrap.children[0]).color!==getComputedStyle(wrap.children[1]).color,'Full and partial cache colors identical');wrap.remove();
 chatOpenSettingTab('worldbook');await tick();
 check(document.querySelectorAll('#chat-worldbook-select option').length===100,'Large catalog missing entries');
 check(document.getElementById('chat-worldbook-priority').value==='0','Priority zero lost');
 document.getElementById('chat-worldbook-content').value='未保存的条目草稿';chatSelectWorldbook('b1');chatSelectWorldbook('b0');check(document.getElementById('chat-worldbook-content').value==='未保存的条目草稿','Switching entry loses draft');
 document.getElementById('chat-worldbook-content').value=cfg.worldbooks[0].content;chatWorldbookContentCount();
 const panel=document.getElementById('chat-side-worldbook');check(panel.scrollWidth<=panel.clientWidth+1,'Worldbook overflows horizontally');
 for(const id of ['chat-worldbook-name','chat-worldbook-content','chat-worldbook-select']){const r=document.getElementById(id).getBoundingClientRect();check(r.width>150&&r.right<=innerWidth&&r.left>=0,'Clipped control '+id)}
 return {inheritedPassages:2,inheritedDays:1,recallIsolated:true,toggleClear:true,worldbooks:100,width:innerWidth};
})()
