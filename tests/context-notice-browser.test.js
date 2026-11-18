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
 const wait=async(fn)=>{for(let i=0;i<150;i++){if(fn())return;await new Promise(r=>setTimeout(r,20))}throw Error('condition timeout')};
 const $=id=>document.getElementById(id),now=Date.now()/1000;
 CKBackendRoute.current.execution='claude_code_subscription';
 window.storedPanelKey=()=> 'fixture-panel';
 const state={monitor_version:1,auth:{ready:true,state:'ready',renewal:{prepared:true,message:'订阅已连接'}},event_supported:true,quota:{policy:{enabled:true,paused:false,warn_percent:70,high_percent:85,stop_percent:95},windows:[{key:'five_hour',used_percent:13.8,resets_at:now+1800,updated_at:now,status:'allowed'},{key:'seven_day',used_percent:40,resets_at:now+86400,updated_at:now,status:'allowed'}],level:'normal',blocked:false,reason:'',last_observed_at:now}};
 window.fetch=async url=>{
  if(url.includes('/ck/wake?'))return {ok:true,json:async()=>({enabled:false})};
  assert(url.includes('/ck/subscription/'),'no model or unrelated endpoint');
  return {ok:true,json:async()=>structuredClone(state)};
 };
 document.getElementById('loading-wrap').remove();
 ckOpenSubscription();await wait(()=>$('ck-sub-inline').textContent.includes('5h 86.2%'));
 $('ck-sub-close').click();
 const bar=$('ck-sub-inline'),tips=()=>[...bar.querySelectorAll('.ck-sub-inline-context')],tipText=()=>tips().map(n=>n.textContent).join('');
 const reload=async()=>{$('ck-sub-refresh').click();await wait(()=>!$('ck-sub-refresh').disabled)};
 const reply=(usage,done)=>{
  // Same two steps as the stream handler: mark the prompt size on done, then attach it to the stored reply.
  const data=Object.assign({usage},done||{});chatUsagePayload(data.usage).context_input_tokens=chatUsageContextInput(data);
  return chatAttachAssistantCost({role:'assistant',text:'ok',ts:Date.now()},data.usage);
 };
 const sub=fields=>Object.assign({execution_backend:'claude_code_subscription',output_tokens:10},fields);
 const show=async messages=>{chatMessages=messages;await reload();return tips()};

 // The prompt size is the last upstream request, never the sum over tool rounds.
 assert(chatUsageContextInput({usage:{input_tokens:2,cache_read_input_tokens:300000},last_usage:{input_tokens:1,cache_read_input_tokens:100000,cache_creation_input_tokens:60000},upstream_rounds:3})===160001,'last_usage wins and includes cache read and creation');
 assert(chatUsageContextInput({usage:{input_tokens:5,cache_read_input_tokens:150000},upstream_rounds:1})===150005,'a single round may use the total');
 assert(chatUsageContextInput({usage:{input_tokens:5,cache_read_input_tokens:300000},upstream_rounds:2})===0,'a summed total without last_usage is not trusted');
 assert(chatUsageContextInput({usage:{input_tokens:5,cache_read_input_tokens:300000}})===0&&chatUsageContextInput(null)===0,'unknown rounds are not trusted');

 const user={role:'user',text:'hi',ts:Date.now()};
 assert(!(await show([user,reply(sub({input_tokens:9,cache_read_input_tokens:149990}),{upstream_rounds:1})])).length,'149999 stays quiet');
 let tip=await show([user,reply(sub({input_tokens:10,cache_read_input_tokens:100000,cache_creation_input_tokens:49990}),{upstream_rounds:1})]);
 assert(tipText()===' · 上下文 15 万，建议整理'&&tip.length===2&&tip.every(n=>n.dataset.level==='warn'),'150000 reminds');
 tip=await show([user,reply(sub({input_tokens:300,cache_read_input_tokens:500000}),{upstream_rounds:4,last_usage:{input_tokens:300,cache_read_input_tokens:152000}})]);
 assert(tipText()===' · 上下文 15.2 万，建议整理','tool rounds report the last request only');
 // On the quota row after both percentages and before the details, so a narrow bar drops the details first.
 const row=bar.querySelector('.ck-sub-inline-quota');
 assert([...row.children].map(n=>n.className).join('|').startsWith('ck-sub-inline-summary|ck-sub-inline-context|ck-sub-inline-context ck-sub-inline-context-hint|ck-sub-inline-detail')&&tip.every(n=>n.parentNode===row),'reminder order on the quota row');
 assert(row.firstChild.textContent==='Claude 剩余 · 5h 86.2% · 7天 60%'&&bar.title===bar.textContent&&bar.title.includes('建议整理'),'quota is unchanged and the tooltip keeps the full reminder');
 assert(!(await show([user,reply(sub({input_tokens:300,cache_read_input_tokens:500000}),{upstream_rounds:4})])).length,'a summed total alone shows nothing');
 tip=await show([user,reply(sub({cache_read_input_tokens:189999}),{upstream_rounds:1})]);
 assert(tip.length===2&&tip.every(n=>n.dataset.level==='warn'),'189999 is still the plain reminder');
 tip=await show([user,reply(sub({cache_read_input_tokens:190000}),{upstream_rounds:1})]);
 assert(tipText()===' · 上下文 19 万，接近上限'&&tip.every(n=>n.dataset.level==='high'),'190000 is the stronger wording');
 const high=chatMessages[1];
 assert(!(await show([user,high,user,reply(sub({cache_read_input_tokens:60000}),{upstream_rounds:1})])).length,'the next smaller reply clears it');
 assert((await show([user,high,{role:'assistant',text:'part',ts:Date.now()}])).length,'a reply part without usage keeps the latest known size');
 const api=reply({input_tokens:10,cache_read_input_tokens:200000,output_tokens:5,provider_id:'other'},{upstream_rounds:1});
 assert(api.tkInTotal===200010&&api.tkCtx===undefined&&api.apiCostStatus!=='subscription','API replies never store a context size');
 assert(!(await show([user,high,user,api])).length,'a later API reply shows nothing');
 assert(!(await show([user,Object.assign({},api,{tkCtx:200010})])).length,'a non-subscription reply is ignored even with a size');
 assert((await show([user,high])).length,'reminder is back for the hidden-route check');
 assert(!$('chat-send-btn').disabled&&!$('chat-input').disabled,'sending is never blocked');
 CKBackendRoute.current.execution='direct_api';await reload();
 assert(bar.hidden&&!CKBackendRoute.isSubscription(),'nothing is shown outside the subscription route');
 CKBackendRoute.current.execution='claude_code_subscription';await show([user]);

 // Changing window follows the window now shown, without waiting for the next poll.
 chatEnsureMainRouteReady=()=>Promise.resolve();chatEnsureSessionsReady=()=>Promise.resolve();
 chatSessions.push({id:'ctx-long',title:'long',messages:[user,high],transportMessages:[],firstUserText:'',firstUserTs:0,created:Date.now(),updated:Date.now()});
 chatSelectSession('ctx-long');await wait(()=>tipText().includes('上下文 19 万'));
 await chatNewSession();await wait(()=>!tips().length);
 assert(chatMessages.length===0&&chatActiveSessionId!=='ctx-long','the new window starts without a reminder');

 // A piece is either fully visible or wrapped out of the fixed-height row, never cut.
 const pieces=()=>{const box=bar.getBoundingClientRect(),line=bar.querySelector('.ck-sub-inline-quota').getBoundingClientRect();return {height:box.height,right:box.right,scroll:bar.scrollWidth,client:bar.clientWidth,parts:[...bar.querySelectorAll('.ck-sub-inline-activity,.ck-sub-inline-summary,.ck-sub-inline-context,.ck-sub-inline-detail')].map(n=>{const r=n.getBoundingClientRect(),own=n.className==='ck-sub-inline-activity'?box:line;return {cls:n.className,text:n.textContent,top:r.top,bottom:r.bottom,hidden:getComputedStyle(n).display==='none',whole:n.scrollWidth<=n.clientWidth+1&&r.left>=box.left-1&&r.right<=box.right+1&&r.bottom<=own.bottom+1,dropped:r.top>=line.bottom-1}})}};
 window.__contextPreview=async mode=>{
  delete state.activity;if(mode==='crowded')state.activity={state:'memory_paused',background_purpose:'memory',chat_priority:true};
  const size=mode==='quiet'?60000:mode==='warn'?172300:193400;
  await show([user,reply(sub({input_tokens:300,cache_read_input_tokens:size-300}),{upstream_rounds:1})]);
  assert(tipText()===(mode==='quiet'?'':mode==='warn'?' · 上下文 17.2 万，建议整理':' · 上下文 19.3 万，接近上限'),'preview text '+mode+': '+tipText());
  return pieces();
 };
 return true;
};
(async()=>{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const browser=await chromium.launch({args:['--no-sandbox','--disable-dev-shm-usage']});
 const results=[];
 try{for(const [width,dark] of [[320,false],[390,false],[1280,false],[390,true]]){
  const page=await browser.newPage({viewport:{width,height:900}}),errors=[];
  await page.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
  page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://127.0.0.1:'+server.address().port);
  await page.waitForFunction(()=>typeof chatRenderMessages==='function'&&typeof CKChatHistory==='object');
  await page.evaluate(d=>document.body.classList.toggle('dark',d),dark);
  assert.equal(await page.evaluate(fixture),true);
  let quiet=0;
  for(const mode of ['quiet','warn','high','crowded']){
   const view=await page.evaluate(mode=>window.__contextPreview(mode),mode),label=mode+' at '+width+(dark?' dark':'');
   if(out)await page.locator('.chat-compose').screenshot({path:path.join(out,'context-'+width+'-'+dark+'-'+mode+'.png')});
   results.push({width,dark,mode,...view});
   const find=cls=>view.parts.find(p=>p.cls===cls),summary=find('ck-sub-inline-summary'),memory=find('ck-sub-inline-activity'),size=find('ck-sub-inline-context'),hint=find('ck-sub-inline-context ck-sub-inline-context-hint');
   if(mode==='quiet'){quiet=view.height;assert(!size&&!hint&&view.height<=26,'no reminder below the threshold: '+label);}
   // The reminder lives on the existing quota row: no extra height and no overflow.
   if(memory)assert(memory.whole&&memory.bottom<=summary.top+1&&view.height<=42,'memory keeps its own row above: '+label);
   else assert(Math.abs(view.height-quiet)<=1,'reminder adds no height: '+label);
   assert(view.scroll<=view.client+1&&view.right<=width,'the bar fits the viewport: '+label);
   assert(summary.whole,'both percentages stay whole: '+label);
   for(const p of view.parts)if(p!==summary&&p!==memory)assert(p.hidden||p.whole||p.dropped,'a piece is shown whole or not at all: '+label+p.text);
   if(mode==='quiet')continue;
   if(width>=390)assert(size.whole,'a phone shows the size itself: '+label);
   // Phones drop the plain advice to leave room; the stronger wording is kept when it fits.
   assert.equal(hint.hidden,mode==='warn'&&width<=600,'advice follows the screen width: '+label);
   if(width>=1280)assert(view.parts.every(p=>p.whole),'a wide screen shows every piece: '+label);
  }
  assert.deepEqual(errors,[]);
  console.log(width+' '+dark+': context size notice PASS');
  await page.close();
 }
 if(out)fs.writeFileSync(path.join(out,'context-results.json'),JSON.stringify(results,null,2));
 }finally{await browser.close();server.close()}
})().catch(e=>{console.error(e);server.close();process.exitCode=1});
