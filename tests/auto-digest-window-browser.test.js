const {chromium}=require('playwright');
const fs=require('fs'),path=require('path'),http=require('http'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');
const out=process.env.CK_BROWSER_OUTPUT||'';
if(out)fs.mkdirSync(out,{recursive:true});
const server=http.createServer((req,res)=>{
 const name=new URL(req.url,'http://local').pathname.slice(1)||'index.html',file=path.resolve(root,name);
 if(!file.startsWith(root+'/')||!fs.existsSync(file)){res.writeHead(404);return res.end()}
 let data=fs.readFileSync(file);
 if(name==='index.html')data=Buffer.from(data.toString().replace(/<script src="(?:pwa|script-extra)\.js[^>]+><\/script>/g,''));
 if(name==='script.js')data=Buffer.from(data.toString().replace(/^init\(\);\s*$/m,''));
 res.setHeader('Content-Type',name.endsWith('.js')?'text/javascript':name.endsWith('.css')?'text/css':name.endsWith('.svg')?'image/svg+xml':name.endsWith('.png')?'image/png':'text/html');res.end(data);
});
const fixture=async()=>{
 const assert=(x,m)=>{if(!x)throw Error(m)};
 const wait=async(fn,label)=>{for(let i=0;i<200;i++){if(fn())return;await new Promise(r=>setTimeout(r,20))}throw Error('condition timeout: '+label)};
 const $=id=>document.getElementById(id),same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
 localStorage.clear();$('loading-wrap').remove();
 document.body.classList.add('chat-active');$('tab-chat').classList.add('active');currentPanelTab='chat';
 CKBackendRoute.current.execution='claude_code_subscription';
 window.storedPanelKey=()=> 'fixture-panel';
 chatSessionsReady=true;apiProvidersLoaded=true;apiProviders={};
 // No background timers: every request below is caused by the step under test.
 chatMaybeAutoTrimAtIdleBoundary=()=>{};chatMaybeAutoClean=()=>{};chatMaybeRollDigestAtDayBoundary=()=>{};chatRefreshPreparedDigest=async()=>false;
 chatScheduleNightlySync=()=>{};chatAutoDigestSchedule=()=>{};chatStartReplyWatch=()=>()=>{};chatEnsureSessionsReady=()=>Promise.resolve();
 const notices=[];toast=text=>notices.push(String(text));
 const lockText='小克正在自动生成和复核截断总结，暂时不能发送';

 // Gateway double: the queue endpoint with the auto-window actions, and a chat endpoint that can refuse.
 const requests=[],srv={window:{state:'none',locked:false,run_id:'',stop_requested:false},run:null,chat:'locked',fail:false};
 const json=(data,status)=>new Response(JSON.stringify(data),{status:status||200,headers:{'Content-Type':'application/json'}});
 window.fetch=async(url,init)=>{
  url=String(url);init=init||{};
  if(url.split('&session_id=')[0]===chatNightlyEndpoint(chatLoadConfig())){
   const body=init.body?JSON.parse(init.body):null;requests.push({kind:body?(body.action||'sync'):'read',body});
   if(srv.fail)throw Error('offline');
   if(!body)return json({ok:true,sessions:[{session_id:'auto-1',revision:0,status:'idle',auto_window:srv.window,model_run:srv.run}]});
   if(body.action==='auto_window_arm'){
    if(!['running','paused'].includes(srv.window.state))srv.window={state:'armed',locked:false,run_id:body.model_run.id,stop_requested:false,context_tokens:body.auto_window.context_tokens};
    return json({ok:true,auto_window:srv.window});
   }
   if(body.action==='auto_window_disarm'){if(srv.window.state==='armed')srv.window={state:'none',locked:false,run_id:''};return json({ok:true});}
   if(body.action==='auto_window_stop'){srv.window=Object.assign({},srv.window,{stop_requested:true});return json({ok:true,auto_window:srv.window});}
   if(body.model_run){
    srv.run={id:body.model_run.id,state:'running',purpose:body.model_run.purpose};
    if(srv.window.state==='armed')srv.window={state:'none',locked:false,run_id:''};
   }
   if(body.cancel_model_run)srv.run=null;
   return json({ok:true,accepted_keys:[],status:'idle',auto_window:srv.window,model_run:srv.run});
  }
  if(init.method==='POST'&&url===chatEndpoint(chatLoadConfig())){
   requests.push({kind:'chat',body:JSON.parse(init.body)});
   return json({error:'自动整理进行中',code:'auto_digest_locked'},409);
  }
  return json({ok:true,enabled:false,ready:true});
 };

 const turn=(i,extra)=>[{role:'user',text:'第 '+i+' 轮提问',ts:1700000000000+i*60000,turnId:'t'+i},Object.assign({role:'assistant',text:'第 '+i+' 轮回答',ts:1700000000000+i*60000+1000,turnId:'t'+i},extra||{})];
 const last=size=>({apiCostStatus:'subscription',tkCtx:size});
 chatMessages=[].concat(turn(1),turn(2),turn(3),turn(4),turn(5,last(100000)));
 const session={id:'auto-1',title:'auto',messages:chatMessages,transportMessages:[],firstUserText:'',firstUserTs:0,created:Date.now(),updated:Date.now(),
  trimOverrideEnabled:true,trimConfig:{enabled:false,keep:2,minimum:1,roundLimitEnabled:false}};
 chatSessions=[session];chatActiveSessionId='auto-1';
 const base=chatLoadConfig();base.panelKey='fixture-panel';base.sessionId='auto-1';base.digestCurrentModel=true;base.dailyDigestEnabled=true;base.digestManualModel='claude-haiku-4-5';base.digestModelPolicy='sonnet55-adaptive-medium-v2';chatSaveConfigObject(base);
 const cfg=()=>chatLoadConfig();
 chatWriteForm(cfg());chatRenderDailyDigest(cfg());
 assert(cfg().digestAutoWindow===true&&$('chat-digest-auto-window'),'the switch exists and defaults on');
 assert(chatCurrentSession()===session&&chatPlanAutoTrimForPendingBatch(cfg(),[],{force:true,trigger:'manual_trim'}).trimmed,'fixture has rounds to cut');
 const kinds=()=>requests.map(r=>r.kind).join(',');
 const sync=options=>chatSyncNightlyDigest(cfg(),Object.assign({session,force:true},options));

 // A. Below 150k nothing is sent at all.
 assert(await chatAutoDigestEvaluate()===false&&requests.length===0&&!session.digestAutoArm,'100k does not arm or even ask');
 chatMessages[chatMessages.length-1].tkCtx=149999;
 assert(await chatAutoDigestEvaluate()===false&&requests.length===0,'149999 does not arm');

 // A2. Prepare the cut before an incoming reply crosses the context threshold.
 // The arriving turn occupies the final retained slot, so the cut is exactly
 // what a manual trim would choose after that turn finishes.
 const prepared=chatAutoDigestPrepareChat(cfg(),session,[]);
 assert(prepared&&prepared.seed.enabled&&prepared.attempt.trim.keep===2&&prepared.attempt.trim.dropRounds===4,'pre-chat cut reserves the incoming retained turn');
 assert(prepared.seed.body.model_run.id===prepared.attempt.runId&&!prepared.seed.body.memory_cadence&&!prepared.seed.body.auto_window,'chat handoff carries the cut without overriding independent memory or claiming context');
 const beforeReply=chatMessages.slice();chatMessages.push(...turn(6,last(150000)));
 const afterReply=chatPlanAutoTrimForPendingBatch(cfg(),[],{force:true,trigger:'manual_trim'});
 assert(same(prepared.attempt.trim.keys,chatDigestMessageGroups(afterReply.droppedMessages).map(g=>g.key)),'pre-chat and completed-reply cuts retain exactly the same two turns');
 chatMessages=beforeReply;session.messages=chatMessages;
 const toTransport=m=>({role:m.role,content:[{type:'text',text:m.text}]});
 session.transportMessages=beforeReply.map(toTransport);
 const transportPrepared=chatAutoDigestPrepareChat(cfg(),session,[]);
 const incoming=turn(6,last(150000));chatMessages.push(...incoming);session.transportMessages.push(...incoming.map(toTransport));
 const transportAfterReply=chatPlanAutoTrimForPendingBatch(cfg(),[],{force:true,trigger:'manual_trim'});
 assert(transportPrepared&&transportPrepared.attempt.trim.dropRounds===4&&transportAfterReply.canonicalTransport&&transportAfterReply.transportDropped===4&&
   same(transportPrepared.attempt.trim.keys,chatDigestMessageGroups(transportAfterReply.droppedMessages).map(g=>g.key)),'canonical transport and local sources retain the same two completed turns');
 chatMessages=beforeReply.slice(0,-2);session.messages=chatMessages;session.transportMessages=[];
 const originalBusy=chatDigestReplyActive;chatDigestReplyActive=()=>true;
 session.digestAutoArmTry=prepared.attempt;
 assert(await chatAutoDigestEvaluate()===false&&requests.length===0&&session.digestAutoArmTry===prepared.attempt,'in-flight first-threshold reply does not revoke its pre-chat handoff');
 assert(chatAutoDigestReconcile(cfg(),session,{auto_window:{state:'none'}})===false&&session.digestAutoArmTry===prepared.attempt,'status reads preserve an in-flight handoff');
 chatDigestReplyActive=originalBusy;delete session.digestAutoArmTry;
 const recovered={role:'assistant',text:'recovered',apiCostStatus:'subscription'};
 chatAttachAssistantCost(recovered,{input_tokens_total:150000,context_input_tokens:150000,execution_backend:'claude_code_subscription',billing_status:'subscription'});
 assert(recovered.tkCtx===150000,'offline receipt retains the actual context for automatic admission');
 assert(chatUsageContextInput({usage:{input_tokens_total:300000,context_input_tokens:150000},upstream_rounds:2})===150000,'replayed receipt preserves the verified last request instead of aggregate tool input');

 // B. At 150k the arm carries a complete manual-start body and leaves no local request behind.
 chatMessages[chatMessages.length-1].tkCtx=150000;
 assert(await chatAutoDigestEvaluate()===true,'150k arms: '+kinds()+' '+notices.join('|'));
 assert(requests[requests.length-1].kind==='auto_window_arm'&&requests.slice(0,-1).every(r=>r.kind==='sync'||r.kind==='read'),'baseline first, then the arm: '+kinds());
 const armBody=requests[requests.length-1].body,arm=session.digestAutoArm;
 assert(arm&&arm.runId===armBody.model_run.id&&arm.contextTokens===150000&&arm.trim.immediate===true&&arm.trim.dropRounds===3&&arm.trim.keys.length===3,'the confirmed arm is stored');
 assert(!session.digestManualTrim&&!session.digestModelRun&&!session.digestAutoArmTry,'no manual request or run is left on the window');
 assert(armBody.auto_window.context_tokens===150000&&armBody.model_run.auto_window===true&&armBody.model_run.purpose==='trim'&&armBody.model_run.auto_resume_quota===true,'arm marks the run');
 assert(armBody.manual_request===String(arm.trim.requestedAt)&&same(armBody.candidate_keys,arm.trim.keys)&&armBody.session_id==='auto-1'&&armBody.memory_cadence&&armBody.base&&armBody.config.current_model===true,'arm body is the manual start body');
 assert(notices.length===0,'arming is silent: '+notices.join('|'));
 assert(chatDigestSyncView(session,cfg()).note.includes('已预约自动整理：额度快刷新时闲置 15 分钟、刚刷新后闲置 30 分钟才开始'),'armed note');
 assert(chatDigestPollingDelay(session,cfg())===60000,'armed windows are read once a minute');
 assert($('chat-auto-digest-bar').hidden&&$('chat-trim-cancel-manual').hidden!==false,'armed looks like nothing is pending');
 requests.length=0;
 assert(await chatAutoDigestEvaluate()===true&&!requests.some(r=>r.kind==='auto_window_arm')&&session.digestAutoArm===arm,'an unchanged window is not armed twice');

 // C. With an arm outstanding an upload is preceded by a read; a still-armed server then gets the ordinary body.
 requests.length=0;session.title='auto renamed';
 assert(await sync()===true&&kinds()==='read,sync','read first, then the ordinary upload: '+kinds());
 assert(requests[1].body.manual_request===''&&!requests[1].body.model_run&&!requests[1].body.action&&session.digestAutoArm===arm,'ordinary sync is unchanged while armed');

 // G. Failed preparation keeps the reservation; the accepted manual run supersedes it.
 requests.length=0;srv.fail=true;
 assert(await chatStartCurrentModelDigest('trim')===false,'failed preparation is not a started manual run');
 assert(requests.every(r=>r.kind!=='auto_window_disarm')&&session.digestAutoArm===arm,'failed preparation preserves the automatic reservation');
 srv.fail=false;
 requests.length=0;
 assert(await chatStartCurrentModelDigest('trim')===true,'manual start works: '+notices.join('|'));
 assert(requests.every(r=>r.kind!=='auto_window_disarm')&&!session.digestAutoArm,'accepted run replaces the arm without early withdrawal: '+kinds());
 const manualBody=requests[requests.length-1].body;
 assert(manualBody.model_run&&manualBody.model_run.auto_window===undefined&&!manualBody.action,'manual run is not marked automatic');
 const strip=b=>{const c=Object.assign({},b);delete c.action;delete c.auto_window;return Object.keys(c).sort()};
 assert(same(strip(armBody),strip(manualBody))&&same(armBody.candidate_keys,manualBody.candidate_keys)&&same(armBody.groups,manualBody.groups)&&same(armBody.config,manualBody.config)&&
  same(Object.keys(armBody.model_run).filter(k=>k!=='auto_window').sort(),Object.keys(manualBody.model_run).sort())&&same(armBody.model_run.route,manualBody.model_run.route),'arm and manual bodies have the same shape');
 // Back to an idle window for the rest.
 delete session.digestManualTrim;delete session.digestModelRun;srv.run=null;notices.length=0;
 await sync({readOnly:true});

 // An unanswered arm is remembered, so a run started from it can still be adopted.
 requests.length=0;srv.fail=true;chatMessages[chatMessages.length-1].tkCtx=230000;
 delete chatNightlySynced[chatNightlyScope(cfg())+':auto-1'];
 assert(await chatAutoDigestEvaluate()===false&&!session.digestAutoArm,'no confirmation, no arm');
 srv.fail=false;delete chatNightlySynced[chatNightlyScope(cfg())+':auto-1'];
 assert(await chatAutoDigestEvaluate()===true&&session.digestAutoArm&&session.digestAutoArm.contextTokens===230000&&!session.digestAutoArmTry,'armed again after the gateway answers: '+kinds());
 const arm2=session.digestAutoArm;

 // B2. Switching the feature off withdraws the arm.
 requests.length=0;$('chat-digest-auto-window').checked=false;chatAutoDigestSaveSetting();
 assert(cfg().digestAutoWindow===false&&await chatAutoDigestEvaluate()===true&&kinds()==='auto_window_disarm'&&!session.digestAutoArm,'switch off disarms: '+kinds());
 assert(chatSaveConfig(true).digestAutoWindow===false,'the form save keeps the switch');
 $('chat-digest-auto-window').checked=true;chatAutoDigestSaveSetting();
 assert(await chatAutoDigestEvaluate()===true&&session.digestAutoArm&&session.digestAutoArm.runId!==arm2.runId,'switch on arms again');
 const arm3=session.digestAutoArm;

 // C2. The server started the run: the upload is withheld and the run is adopted into the manual flow.
 srv.run={id:arm3.runId,state:'running',purpose:'trim'};srv.window={state:'running',locked:true,run_id:arm3.runId,stop_requested:false};
 requests.length=0;session.title='auto renamed again';
 await sync();
 assert(requests.length>0&&requests.every(r=>r.kind==='read'),'nothing is uploaded once the run started: '+kinds());
 assert(same(session.digestManualTrim,arm3.trim)&&same(session.digestModelRun,{id:arm3.runId,purpose:'trim',label:arm3.label,auto:true})&&!session.digestAutoArm,'the run is adopted');
 assert(chatDigestPollingDelay(session,cfg())===5000,'a running job is read every 5 seconds');
 requests.length=0;session.title='auto renamed while running';await sync();
 assert(kinds()==='read','still read-only while it runs: '+kinds());
 assert(chatDigestSyncView(session,cfg()).status==='自动整理进行中'&&!$('chat-trim-cancel-manual').hidden,'running shows as a job that can be cancelled');

 // E. Locked: the composer keeps the text and nothing is posted.
 const bar=$('chat-auto-digest-bar'),stop=$('chat-auto-digest-stop'),input=$('chat-input');
 assert(!bar.hidden&&$('chat-auto-digest-text').textContent==='小克正在自动生成和复核截断总结，暂不能发送'&&stop.textContent==='中止并解锁'&&!stop.disabled,'lock bar');
 requests.length=0;notices.length=0;input.value='先别发';const count=chatMessages.length;
 await chatSendMessage();
 assert(input.value==='先别发'&&chatMessages.length===count&&!requests.some(r=>r.kind==='chat')&&notices.includes(lockText),'send is held and the text stays: '+kinds());
 window.__barBox=()=>{const b=bar.getBoundingClientRect(),s=stop.getBoundingClientRect(),c=getComputedStyle(bar);return {hidden:bar.hidden,left:b.left,right:b.right,scroll:bar.scrollWidth,client:bar.clientWidth,button:s.height,buttonRight:s.right,inside:s.right<=b.right+0.5&&s.left>=b.left,color:c.color,background:c.backgroundColor,text:$('chat-auto-digest-text').textContent,disabled:stop.disabled}};
 window.__locked=window.__barBox();

 // Stop: one request, then the bar waits for the current step.
 requests.length=0;stop.click();await wait(()=>requests.length&&!chatAutoDigestStopBusy,'stop request');
 assert(kinds()==='auto_window_stop'&&same(requests[0].body,{action:'auto_window_stop',session_id:'auto-1'}),'stop sends the action: '+kinds());
 assert(!bar.hidden&&$('chat-auto-digest-text').textContent==='已请求中止：等当前这一步跑完后解锁'&&stop.disabled,'stop is acknowledged and the button is off');
 window.__stopping=window.__barBox();
 input.value='还是不能发';await chatSendMessage();assert(input.value==='还是不能发','still locked until the server unlocks');

 // Paused: unlocked again, note explains, polled every 30 seconds.
 srv.run.state='blocked';srv.window={state:'paused',locked:false,run_id:arm3.runId,stop_requested:false};
 await sync({readOnly:true});
 assert(bar.hidden&&!chatAutoDigestLocked(session)&&chatDigestSyncView(session,cfg()).note.includes('自动整理已暂停（额度保留/已中止），条件合适时自动继续'),'paused unlocks and says so');
 assert(chatDigestPollingDelay(session,cfg())===30000,'a paused job is read every 30 seconds');

 // E2. The gateway refuses a chat request this page thought was allowed: keep the text as a failed turn and refresh.
 delete session.digestManualTrim;delete session.digestModelRun;srv.run=null;srv.window={state:'none',locked:false,run_id:''};
 await sync({readOnly:true});assert(!chatAutoDigestLocked(session),'unlocked before the refused send');
 srv.window={state:'running',locked:true,run_id:'other-device',stop_requested:false};
 requests.length=0;notices.length=0;input.value='被网关拦下的话';
 await chatSendMessage();await wait(()=>notices.includes(lockText)&&!chatSending,'409 notice: '+notices.join('|')+' '+kinds());
 const kept=chatMessages.filter(m=>m.text==='被网关拦下的话');
 assert(requests.filter(r=>r.kind==='chat').length===1&&kept.length===1&&kept[0].role==='user'&&kept[0].sendFailed===true,'the refused text is kept as a failed turn');
 const posted=requests.find(r=>r.kind==='chat').body;
 assert(posted.auto_digest_seed&&posted.auto_digest_seed.enabled===true&&posted.auto_digest_seed.body.session_id===session.id&&
   posted.auto_digest_seed.body.model_run.id.startsWith('auto-chat-')&&posted.auto_digest_seed.body.candidate_keys.length>0,'ordinary send carries the full handoff through chatLockGatewayBody');
 assert(!posted.messages&&!posted.history&&!posted.auto_digest_seed.body.memory_cadence,'ordinary chat retains its cache restrictions and independent memory settings');
 await wait(()=>requests.some(r=>r.kind==='read')&&!bar.hidden,'status refresh after 409');
 assert(chatCurrentSession()===session&&chatAutoDigestLocked(session)&&requests.every(r=>r.kind!=='sync'),'the lock is shown and nothing is uploaded over the job: '+kinds());
 await sync({readOnly:true});requests.length=0;session.title='another name';await sync();
 assert(kinds()==='read','a job armed elsewhere is only read: '+kinds());
 // A lost manual submission must remain unconfirmed after an ordinary read of the old job.
 srv.window={state:'none',locked:false,run_id:''};srv.run={id:'old-manual',state:'cancelled'};
 delete session.digestAutoArm;delete session.digestAutoArmTry;
 session.digestModelRun={id:'unconfirmed-manual',purpose:'trim',label:'Sonnet',startState:'unconfirmed'};
 session.digestManualTrim={scope:chatDigestActiveScope(cfg()),requestedAt:Date.now(),dropRounds:3,keep:2,keys:[],immediate:true};
 await sync({readOnly:true});chatRenderNightlyStatus(session);
 const pendingView=chatDigestSyncView(session,cfg());
 assert(pendingView.status==='启动未确认'&&$('chat-trim-next').textContent.includes('启动未确认'),'old successful status read cannot restore the false wait');
 const pendingProgress=CKDigestProgress.view(session,{model_run:srv.run,status:'manual_only'},pendingView);
 assert(pendingProgress.stage==='启动未确认'&&!pendingProgress.running&&pendingProgress.elapsed==='—','unconfirmed run does not keep a waiting timer');
 assert(chatNormalizeSession(session).digestModelRun.startState==='unconfirmed','unconfirmed intent survives saved session normalization');
 return true;
};
(async()=>{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const browser=await chromium.launch({args:['--no-sandbox','--disable-dev-shm-usage']});
 try{for(const [width,dark] of [[320,false],[390,false],[390,true],[1280,false]]){
  const page=await browser.newPage({viewport:{width,height:800}}),errors=[];
  await page.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
  page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://127.0.0.1:'+server.address().port);
  await page.waitForFunction(()=>typeof chatRenderMessages==='function'&&typeof CKChatHistory==='object'&&typeof chatAutoDigestEvaluate==='function');
  await page.evaluate(d=>document.body.classList.toggle('dark',d),dark);
  assert.equal(await page.evaluate(fixture),true);
  const label=' at '+width+(dark?' dark':'');
  for(const name of ['__locked','__stopping']){
   const box=await page.evaluate(n=>window[n],name);
   assert(!box.hidden&&box.left>=0&&box.right<=width&&box.scroll<=box.client+1&&box.inside,'the bar fits the viewport: '+name+label+JSON.stringify(box));
   assert(box.button>=44,'the button is a full touch target: '+name+label);
   const rgb=s=>s.match(/[\d.]+/g).slice(0,3).map(Number),lum=c=>{const [r,g,b]=rgb(c).map(v=>{v/=255;return v<=0.03928?v/12.92:Math.pow((v+0.055)/1.055,2.4)});return 0.2126*r+0.7152*g+0.0722*b};
   const a=lum(box.color),b=lum(box.background),ratio=(Math.max(a,b)+0.05)/(Math.min(a,b)+0.05);
   assert(ratio>=4.5,'text is readable: '+name+label+' '+ratio.toFixed(2));
  }
  assert.deepEqual(errors,[]);
  console.log(width+' '+dark+': auto digest window PASS');
  await page.close();
 }}finally{await browser.close();server.close()}
})().catch(e=>{console.error(e);server.close();process.exitCode=1});
