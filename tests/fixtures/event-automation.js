(async()=>{
 const check=(v,m)=>{if(!v)throw Error(m)},pause=ms=>new Promise(r=>setTimeout(r,ms));
 const wait=async f=>{for(let i=0;i<100;i++){if(f())return;await pause(20)}throw Error('Timed out')};
 const $=id=>document.getElementById(id);
 panelAuthKey='fixture-key';localStorage.setItem(API_KEY_STORAGE,panelAuthKey);panelAppStarted=false;
 $('loading-wrap').classList.add('done');
 let actions=[],fail=false;
 let value={ok:true,observed_at:Date.now()/1000,control:{enabled:true,history:[]},current:{status:'updated',scope:'旅行 <img src=x onerror="window.bad=1">',duration_ms:1234},progress:{events:344,ready_scopes:45,scope_count:233,manual_pending_scopes:188,automatic_pending_scopes:0,checked_at:Date.now()/1000,daily_calls:0},preload:{ready:true,events:344,fallback_facts:100},git:{status:'synced',path:'panel-event-memories/test.json'},api:{topic_materials:{model:'test-model'},recall_rewrite:{model:'review-model'}}};
 window.fetch=async(url,init={})=>{
   const path=new URL(String(url)).pathname.replace(/^\/gateway/,'');
   check(path==='/ck/event-automation','Unexpected request '+path);
   if(fail)return {ok:false,status:503,json:async()=>({ok:false,error:'测试失败'})};
   if(init.method==='POST'){
     let action=JSON.parse(init.body).action;actions.push(action);
     if(action==='pause')value.control.enabled=false;
     if(action==='resume')value.control.enabled=true;
     value.control.history.push({status:action,at:Date.now()/1000});
   }
   return {ok:true,status:200,json:async()=>structuredClone(value)};
 };
 currentPanelTab='status';document.querySelectorAll('.panel-tab').forEach(el=>el.classList.toggle('active',el.id==='tab-status'));
 ckSelectStatusTab('events');await wait(()=>$('ck-event-monitor').textContent.includes('344'));
 check($('ck-status-topics').hidden&&$('ck-status-digest').hidden&&!$('ck-status-events').hidden,'Panels overlap');
 check(!window.bad&&!$('ck-event-monitor').querySelector('img'),'Unescaped output');
 check($('ck-event-monitor').textContent.includes('188'),'Manual backlog missing');
 document.querySelector('[data-event-action="pause"]').click();await wait(()=>document.querySelector('[data-event-action="resume"]'));
 document.querySelector('[data-event-action="resume"]').click();await wait(()=>document.querySelector('[data-event-action="pause"]'));
 document.querySelector('[data-event-action="check"]').click();await wait(()=>actions.includes('check'));
 await pause(30);document.querySelector('[data-event-action="retry"]').click();await wait(()=>actions.includes('retry'));await pause(30);
 check(actions.join(',')==='pause,resume,check,retry','Wrong control action');
 fail=true;await ckRefreshMaintenance(true);check($('ck-event-monitor').textContent.includes('测试失败'),'Refresh error invisible');
 check($('ck-event-monitor').textContent.includes('344'),'Error erased previous status');
 fail=false;panelAuthKey='second-key';localStorage.setItem(API_KEY_STORAGE,panelAuthKey);value.progress.events=0;value.preload.events=0;value.progress.manual_pending_scopes=0;
 await ckRefreshMaintenance(true);check(!$('ck-event-monitor').textContent.includes('344'),'Principal data retained');
 const last=$('ck-status-tab-events');last.focus();last.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowLeft',bubbles:true}));
 check(ckStatusTab==='digest','Keyboard navigation failed');ckSelectStatusTab('events');await pause(50);
 return {actions,manual_separate:true,escaped:true,key_isolation:true};
})()
