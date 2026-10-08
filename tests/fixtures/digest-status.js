(async()=>{
 const check=(value,message)=>{if(!value)throw Error(message)},pause=ms=>new Promise(r=>setTimeout(r,ms));
 const cfg=chatLoadConfig(),scope=chatDigestActiveScope(cfg),now=Date.now();
 const session=chatNormalizeSession({id:'status-test',title:'我的当前对话',messages:[{role:'user',text:'保留问题',ts:now-10000},{role:'assistant',text:'保留正文',ts:now-9000}],
   digestLastSync:{id:'cut-7',scope,at:now-1000,rounds:17,status:'pending'}});
 chatSessions=[session];chatMessages=session.messages;chatActiveSessionId=session.id;chatSessionsReady=true;chatSending=false;
 const oldKey=storedPanelKey,oldFetch=panelDataFetch;
 storedPanelKey=()=>cfg.panelKey||'fixture';
 panelDataFetch=async()=>new Response(JSON.stringify({ok:true,sessions:[{session_id:session.id,title:session.title,status:'running',pending_groups:122,checkpoint_batches:8}],history:{items:[]}}),{headers:{'Content-Type':'application/json'}});
 currentPanelTab='status';document.body.classList.remove('chat-active');
 document.querySelectorAll('.panel-tab').forEach(n=>n.classList.remove('active'));
 document.getElementById('tab-status').classList.add('active');
 ckSelectStatusTab('digest');await ckRefreshMaintenance(false);await pause(80);
 const root=document.getElementById('ck-digest-monitor');
 const card=()=>root.querySelector('.mm-digest-result');
 check(card()?.textContent.includes('17 轮'),'actual cut rounds missing');
 check(card().textContent.includes('同步未完成'),'pending operation falsely completed');
 check(!card().textContent.includes('122'),'materials leaked into the primary result');
 check(!root.querySelector('.mm-digest-background').open,'background details should start folded');
 check(!root.querySelector('.mm-history-fold').open,'raw records should start folded');
 check(card().scrollWidth<=card().clientWidth+1,'result card overflows '+JSON.stringify({width:card().clientWidth,scroll:card().scrollWidth,children:Array.from(card().querySelectorAll('*')).filter(n=>n.scrollWidth>n.clientWidth+1&&n.clientWidth).map(n=>({tag:n.tagName,css:n.className,width:n.clientWidth,scroll:n.scrollWidth,text:n.textContent.slice(0,80)}))}));
 session.digestLastSync.status='synced';await ckRefreshMaintenance(false);
 check(card().textContent.includes('同步完成'),'ACK not reflected');
 root.querySelector('.mm-digest-background').open=true;await ckRefreshMaintenance(false);
 check(root.querySelector('.mm-digest-background').open,'refresh collapsed requested details');
 root.querySelector('.mm-digest-background').open=false;
 session.digestManualTrim={scope,requestedAt:Date.now()+1,dropRounds:5,keep:1,keys:[]};
 await ckRefreshMaintenance(false);
 check(card().textContent.includes('0 轮')&&card().textContent.includes('尚未截断'),'preparation looked committed');
 delete session.digestManualTrim;await ckRefreshMaintenance(false);
 window.__closeDigestStatusTest=()=>{storedPanelKey=oldKey;panelDataFetch=oldFetch;currentPanelTab='chat';document.body.classList.add('chat-active');document.getElementById('tab-status').classList.remove('active');document.getElementById('tab-chat').classList.add('active')};
 return {actualRounds:17,unconfirmedNotComplete:true,preparationIsZero:true,materialsFolded:true,detailsSurviveRefresh:true,width:card().clientWidth};
})()
