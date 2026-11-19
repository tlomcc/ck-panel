const {chromium}=require('playwright');
const fs=require('fs'),path=require('path'),http=require('http'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),out=process.env.CK_BROWSER_OUTPUT||'';
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
 const check=(value,message)=>{if(!value)throw Error(message)},pause=ms=>new Promise(r=>setTimeout(r,ms));
 const wait=async(fn,message)=>{for(let i=0;i<200;i++){if(fn())return;await pause(20)}throw Error('timeout: '+message)};
 localStorage.clear();document.getElementById('loading-wrap').remove();
 CKBackendRoute.current.execution='claude_code_subscription';storedPanelKey=()=> 'fixture-panel';
 chatEnsureSessionsReady=()=>Promise.resolve();chatScheduleNightlySync=()=>{};chatAutoDigestSchedule=()=>{};
 chatSyncNightlyDigest=async()=>false;chatDigestFinishManualTrim=async()=>false;
 const cfg=chatLoadConfig();cfg.panelKey='fixture-panel';cfg.digestCurrentModel=true;cfg.dailyDigestEnabled=true;chatSaveConfigObject(cfg);
 const now=Date.now(),make=id=>chatNormalizeSession({id,title:id==='one'?'当前对话':'另一段对话',messages:[{role:'user',text:'保留问题',ts:now-10000},{role:'assistant',text:'保留回答',ts:now-9000}]});
 const one=make('one'),two=make('two');chatSessions=[one,two];chatMessages=one.messages;chatActiveSessionId=one.id;chatSessionsReady=true;chatSending=false;
 const originals=JSON.stringify(chatSessions),requests=[],notices=[];toast=text=>notices.push(String(text));
 const remote=id=>({session_id:id,title:id,revision:4,status:'blocked',ready_trim_groups:0,model_run:{id:'run-'+id,state:'blocked',purpose:'trim',route:{execution:'claude_code_subscription',model:'claude-sonnet-5-5'}},
  progress:{phase:'draft',completed_batches:2},auto_window:{state:'paused',run_id:'run-'+id,locked:false,can_resume:true,stop_requested:false,reason:'auto_window_stop'}});
 const rows=[remote('one'),remote('two')];let held=false,release=null,offline=false;
 const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json'}});
 panelDataFetch=async()=>json({ok:true,sessions:rows,history:{items:[]}});
 window.fetch=async(url,init={})=>{
  if(String(url).split('&session_id=')[0]!==chatNightlyEndpoint(chatLoadConfig()))throw Error('unexpected fetch');
  if(!init.body){const id=new URL(url,location.href).searchParams.get('session_id');return json({ok:true,sessions:rows.filter(row=>row.session_id===id)});}
  const body=JSON.parse(init.body);requests.push(body);
  if(offline)throw Error('offline');
  if(held)await new Promise(resolve=>release=resolve);
  const row=rows.find(row=>row.session_id===body.session_id);
  if(body.run_id!==row.auto_window.run_id)return json({ok:false,error:'总结任务已变化，请刷新后再试',auto_window:row.auto_window});
  if(body.action==='auto_window_resume'){
   row.status='queued';row.model_run.state='queued';row.auto_window={state:'running',run_id:body.run_id,locked:true,can_resume:false,stop_requested:false};
   return json({ok:true,resumed:true,auto_window:row.auto_window});
  }
  check(body.action==='auto_window_stop','unexpected action');row.auto_window.stop_requested=true;
  return json({ok:true,auto_window:row.auto_window});
 };
 currentPanelTab='status';document.body.classList.remove('chat-active');
 document.querySelectorAll('.panel-tab').forEach(n=>n.classList.remove('active'));document.getElementById('tab-status').classList.add('active');
 ckSelectStatusTab('digest');await ckRefreshMaintenance(false);await pause(60);
 const monitor=document.getElementById('ck-digest-monitor'),button=(id,action)=>monitor.querySelector('[data-mm-session="'+id+'"][data-mm-digest-action="'+action+'"]');
 check(button('one','resume')?.textContent==='继续总结'&&!button('one','resume').disabled,'paused run has a continue button');
 check(button('one','resume').closest('.mm-digest-result')&&button('one','resume').dataset.mmRun==='run-one','button belongs to the original status card');
 check(requests.length===0,'opening status never resumes');
 held=true;button('one','resume').click();await wait(()=>release,'continue posted');
 check(button('one','resume').disabled,'continue disables immediately');
 await ckRunDigestAction('one','resume','run-one');
 check(requests.length===1,'rapid second activation never posts another continue');
 await ckRefreshMaintenance(false);check(button('one','resume').disabled&&button('one','resume').textContent==='提交中…','refresh preserves in-flight control');
 held=false;release();await wait(()=>button('one','pause')&&!button('one','pause').disabled,'running control');
 check(currentPanelTab==='status'&&chatCurrentSession()===one,'continue stays on status and preserves current chat');
 check(JSON.stringify(chatSessions)===originals,'continue does not replace the local cut, sources or run');
 check(Object.keys(requests[0]).sort().join(',')==='action,request_id,run_id,session_id'&&requests[0].run_id==='run-one','continue sends only an idempotent same-run action');
 button('one','pause').click();await wait(()=>button('one','pause')?.textContent==='等待暂停…','pause waits for current request');
 check(button('one','pause').disabled&&requests[1].action==='auto_window_stop'&&requests[1].run_id==='run-one','pause is tied to the same run');
 rows[0].status='blocked';rows[0].model_run.state='blocked';rows[0].auto_window={state:'paused',run_id:'run-one',locked:false,can_resume:true,stop_requested:false,reason:'auto_window_stop'};
 await ckRefreshMaintenance(false);check(!button('one','resume').disabled&&!chatAutoDigestLocked(one),'pause boundary restores continue and unlocks chat');
 monitor.querySelector('[data-session="other-results"]').open=true;button('two','resume').click();await wait(()=>button('two','pause'),'other session continues');
 check(requests[2].session_id==='two'&&requests[2].run_id==='run-two'&&chatCurrentSession()===one,'other card controls its own run without switching chat');
 rows[0].auto_window.can_resume=false;rows[0].auto_window.resume_problem='总结结果待人工复核，不能直接继续';await ckRefreshMaintenance(false);
 check(button('one','resume').disabled&&button('one','resume').closest('.mm-digest-control').textContent.includes('待人工复核'),'manual hold stays disabled with its reason');
 rows[0].auto_window={state:'failed',run_id:'run-one',locked:false,can_resume:true,reason:'provider_output_blocked'};
 await ckRefreshMaintenance(false);check(!button('one','resume').disabled&&requests.length===3,'failed run requires an explicit user click');
 offline=true;button('one','resume').click();await wait(()=>button('one','resume')&&!button('one','resume').disabled&&requests.length===4,'failed post recovers control');
 await pause(80);check(requests.length===4&&notices.some(text=>text.includes('请求未确认')),'network failure has no hidden retry');offline=false;
 rows[0].model_run.id='new-run';rows[0].auto_window.run_id='new-run';
 button('one','resume').click();await wait(()=>notices.some(text=>text.includes('总结任务已变化')),'stale button rejected');
 check(requests[4].run_id==='run-one'&&rows[0].model_run.state==='blocked','stale button cannot start the replacement run');
 await ckRefreshMaintenance(false);
 const control=button('one','resume'),rect=control.getBoundingClientRect(),card=control.closest('.mm-digest-result');
 check(rect.height>=44&&rect.left>=0&&rect.right<=innerWidth&&card.scrollWidth<=card.clientWidth+1,'control fits and has a mobile touch target');
 window.__digestContinueBox={height:rect.height,width:card.clientWidth,scroll:card.scrollWidth};
 return {sameRun:true,noDuplicate:true,otherSession:true,manualHold:true,noNetworkRetry:true,staleRun:true};
};
(async()=>{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const browser=await chromium.launch({args:['--no-sandbox','--disable-dev-shm-usage']});
 try{for(const [width,dark] of [[320,false],[390,false],[390,true],[1280,false]]){
  const page=await browser.newPage({viewport:{width,height:950}}),errors=[];
  await page.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
  page.on('pageerror',e=>errors.push(e.message));await page.goto('http://127.0.0.1:'+server.address().port);
  await page.waitForFunction(()=>typeof chatAutoDigestControl==='function'&&typeof CKDigestProgress==='object');
  await page.evaluate(d=>document.body.classList.toggle('dark',d),dark);
  console.log(width+' '+dark+': '+JSON.stringify(await page.evaluate(fixture)));
  assert.deepEqual(errors,[]);
  if(out)await page.screenshot({path:path.join(out,'digest-continue-'+width+'-'+dark+'.png'),fullPage:true});
  await page.close();
 }}finally{await browser.close();server.close()}
})().catch(e=>{console.error(e);server.close();process.exitCode=1});
