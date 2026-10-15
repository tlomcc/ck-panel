const {chromium}=require('playwright');
const {execFileSync}=require('child_process');
const fs=require('fs'),path=require('path'),http=require('http'),assert=require('assert');
const root=path.resolve(__dirname,'..'),out='/home/ckcodex/workspace/work/codex-workspace-check';
const server=http.createServer((req,res)=>{const name=new URL(req.url,'http://local').pathname.slice(1)||'index.html',file=path.resolve(root,name);if(!file.startsWith(root+'/')||!fs.existsSync(file)||!fs.statSync(file).isFile()){res.writeHead(404);return res.end();}res.setHeader('Content-Type',name.endsWith('.js')?'text/javascript':name.endsWith('.css')?'text/css':name.endsWith('.json')?'application/json':'text/html');res.end(process.env.CODEX_MEASURE_BASELINE?execFileSync('git',['show','e7e9c79:'+name],{cwd:root}):fs.readFileSync(file));});
(async()=>{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const browser=await chromium.launch({args:['--no-sandbox','--disable-dev-shm-usage']});
 const measurements=[];
 try{for(const width of [320,390,640,768,1280,1440]){
  const context=await browser.newContext({viewport:{width,height:900},serviceWorkers:'block'});
  await context.addInitScript(()=>{localStorage.setItem('ck_codex_access','fixture-access');localStorage.setItem('ck_codex_endpoint','https://codex.test/codex');const vv=window.visualViewport;let h=innerHeight,top=0;Object.defineProperties(vv,{height:{get:()=>h},offsetTop:{get:()=>top}});window.testKeyboard=(height,offset)=>{h=height;top=offset;vv.dispatchEvent(new Event('resize'));vv.dispatchEvent(new Event('scroll'));};});
  const page=await context.newPage(),errors=[],calls=[];page.on('pageerror',e=>errors.push(e.message));
  let config={profiles:[{id:'p',name:'AgentRouter',model:'gpt-6-astra',effort:'ultra',base_url:'https://a.test/v1',has_key:true,revision:'r1'}],default_profile:'p',workspace:'/workspace'};
  const windows=Array.from({length:5},(_,i)=>({id:'w'+i,title:'任务窗口 '+i,profile:'p',thread_id:'native-'+i,status:i?'running':'completed',updated:1,usage:'{}'}));
  let delayWindow='',delayList=false,statusFail=false,version=1;const waiters=[];
  await page.route('https://codex.test/codex/**',async route=>{
   const req=route.request(),url=new URL(req.url()),id=url.pathname.split('/')[3];calls.push({path:url.pathname,after:url.searchParams.get('after'),method:req.method()});let result={};
   if(url.pathname.endsWith('/config'))result=config;
   else if(url.pathname.endsWith('/threads')){if(statusFail)return route.fulfill({status:503,json:{error:'fixture status unavailable'}});if(delayList)await new Promise(r=>waiters.push(r));result={windows};}
   else if(url.pathname.endsWith('/send')){windows[0].status='running';version++;result={};}
   else if(url.pathname.endsWith('/stop')){windows.find(w=>w.id===id).status='interrupted';version++;result={};}
   else if(url.pathname.includes('/threads/')){if(id===delayWindow)await new Promise(r=>waiters.push(r));const after=Number(url.searchParams.get('after'));result={window:windows.find(w=>w.id===id),items:after>=version?[]:[{id:'a-'+id,kind:'agentMessage',text:'已收到 '+id+' 的任务进度 · '+version,created:1,data:{}},{id:'tool-'+id,kind:'commandExecution',text:'fixture output',created:2,data:{}}],cursor:version,schedules:[]};}
   await route.fulfill({json:result}).catch(()=>{});
  });
  await page.goto('http://127.0.0.1:'+server.address().port+'/#codex-tasks');await page.getByText('已收到 w0 的任务进度 · 1',{exact:true}).waitFor();
  async function menu(){if(width<=640&&!await page.locator('#cx-window-sidebar').isVisible())await page.locator('#cx-window-toggle').click();}
  async function select(id){const live=page.locator('#cx-notice-list button').filter({hasText:'任务窗口 '+id});if(await live.count())await live.click();else{await menu();await page.locator('#cx-windows .cx-window').filter({hasText:'任务窗口 '+id}).click();}}
  const geometry=()=>page.evaluate(()=>{const rect=s=>{const b=document.querySelector(s).getBoundingClientRect();return {x:b.x,y:b.y,width:b.width,height:b.height,bottom:b.bottom};};return {feed:rect('#cx-feed'),selector:rect('.cx-compose-bar .ck-select-button'),send:rect('#cx-send'),compose:rect('#cx-compose'),head:rect('.cx-head')};});
  const idle=await geometry();if(process.env.CODEX_MEASURE_BASELINE){measurements.push({width,idle});await context.close();continue;}assert(idle.feed.height>530,`message height ${width}: ${idle.feed.height}`);assert.equal(await page.locator('.side-nav-item').filter({hasText:/^Codex/}).count(),1);
  await page.locator('#cx-input').fill('fixture task');await page.locator('#cx-send').click();await page.locator('#cx-stop').waitFor();
  windows[0].usage=JSON.stringify({total:{totalTokens:98765432}});if(!await page.locator('.cx-window-menu').evaluate(e=>e.open))await page.locator('.cx-window-menu summary').click();await page.locator('#cx-refresh').click();await page.getByText('98,765,432 tokens',{exact:true}).waitFor();
  const running=await geometry();assert(Math.abs(running.selector.width-idle.selector.width)<1,'stop/usage changes selector width');assert.equal(running.selector.height,idle.selector.height);assert.equal(running.send.x,idle.send.x);assert.equal(running.send.y,idle.send.y);assert.equal(await page.locator('#cx-profile').isDisabled(),true);
  await page.locator('#cx-stop').click();await page.locator('#cx-stop').waitFor({state:'hidden'});assert.equal(await page.locator('#cx-profile').isDisabled(),false);
  config.profiles[0].name='很长的供应商名称 AgentRouter 自定义线路';config.profiles[0].model='gpt-6-astra-extended-context-preview';if(!await page.locator('.cx-window-menu').evaluate(e=>e.open))await page.locator('.cx-window-menu summary').click();await page.locator('#cx-refresh').click();await page.waitForFunction(()=>document.querySelector('.cx-compose-settings .ck-select-button').textContent.includes('extended-context'));
  assert.equal((await geometry()).selector.height,idle.selector.height);await page.locator('.cx-compose-settings .ck-select-button').click();await page.locator('dialog[open]').waitFor();assert((await page.locator('dialog').innerText()).includes('extended-context-preview'));await page.keyboard.press('Escape');
  await page.locator('#cx-input').fill('w0 的未发送草稿');await page.locator('.cx-detail summary').click();await page.evaluate(()=>window.cachedMessage=document.querySelector('.cx-item-agentMessage'));
  for(const n of [1,2,3,4]){await select(n);await page.getByText('已收到 w'+n+' 的任务进度 · '+version,{exact:true}).waitFor();}
  // The fifth window's next poll never returns. Switching must cancel only that read.
  delayWindow='w4';if(!await page.locator('.cx-window-menu').evaluate(e=>e.open))await page.locator('.cx-window-menu summary').click();await page.locator('#cx-refresh').click();await page.waitForFunction(()=>document.querySelector('#cx-window-title').textContent==='任务窗口 4');await page.waitForTimeout(80);
  windows[2].status='failed';windows[2].error='fixture failure';await page.locator('#cx-notice-list button').filter({hasText:'任务窗口 2'}).getByText('运行异常',{exact:true}).waitFor({state:'attached',timeout:4000});
  delayWindow='w0';const t=Date.now();await select(0);await page.getByText('已收到 w0 的任务进度 · '+version,{exact:true}).waitFor({timeout:1500});const switchMs=Date.now()-t;assert(switchMs<1500,'old request blocked switch');assert.equal(await page.locator('#cx-input').inputValue(),'w0 的未发送草稿');assert(await page.evaluate(()=>document.querySelector('.cx-item-agentMessage')===window.cachedMessage),'cached message DOM was rebuilt');
  await page.waitForTimeout(100);assert(calls.some(c=>c.path.endsWith('/w0')&&Number(c.after)>0),'return should fetch incremental records');
  delayWindow='';version++;waiters.splice(0).forEach(r=>r());await page.getByText('已收到 w0 的任务进度 · '+version,{exact:true}).waitFor();
  delayList=true;version++;if(!await page.locator('.cx-window-menu').evaluate(e=>e.open))await page.locator('.cx-window-menu summary').click();await page.locator('#cx-refresh').click();await page.getByText('已收到 w0 的任务进度 · '+version,{exact:true}).waitFor({timeout:1500});delayList=false;waiters.splice(0).forEach(r=>r());
  if(width===390||width===1280){statusFail=true;await page.locator('#cx-notice-list button').filter({hasText:'任务窗口 2'}).getByText('连接异常 · 待同步',{exact:true}).waitFor({state:'attached',timeout:4000});statusFail=false;await page.locator('#cx-notice-list button').filter({hasText:'任务窗口 2'}).getByText('运行异常',{exact:true}).waitFor({state:'attached',timeout:4000});}
  assert.equal(calls.filter(c=>c.path.endsWith('/send')&&c.method==='POST').length,1);assert.equal(calls.filter(c=>c.path.endsWith('/stop')&&c.method==='POST').length,1);
  // Navigation lives in Codex's own sidebar, never in a second row above the chat.
  await menu();await page.locator('#cx-tab-api').click();assert(await page.locator('#cx-api').isVisible());assert.equal(await page.locator('#cx-tasks').isVisible(),false);assert.equal(await page.locator('#cx-window-toolbar').isVisible(),false);
  await menu();await page.locator('#cx-tab-info').click();assert(await page.locator('#cx-info').isVisible());
  await menu();await page.locator('#cx-tab-tasks').click();assert(await page.locator('#cx-tasks').isVisible());assert.equal(await page.locator('#cx-input').inputValue(),'w0 的未发送草稿');
  if(width<=640){
   await page.locator('#cx-input').focus();await page.evaluate(()=>window.testKeyboard(420,75));await page.waitForTimeout(80);const keyboard=await geometry();assert.equal(keyboard.head.y,75);assert(keyboard.compose.bottom<=496);assert(keyboard.feed.height>100);assert.equal(await page.evaluate(()=>window.scrollY),0);assert.equal(await page.locator('#cx-input').evaluate(e=>getComputedStyle(e).fontSize),'16px');
   await page.screenshot({path:out+'/keyboard-'+width+'.png'});await page.evaluate(()=>window.testKeyboard(900,0));await page.waitForTimeout(80);assert.equal((await geometry()).head.y,0);
  }
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));assert.equal(await page.evaluate(()=>document.querySelector('.cx-shell').scrollHeight<=document.querySelector('.cx-shell').clientHeight+1),true);
  await page.screenshot({path:out+'/tasks-'+width+'.png'});await page.evaluate(()=>document.body.classList.add('dark'));await page.screenshot({path:out+'/tasks-dark-'+width+'.png'});
  assert.deepEqual(errors,[]);measurements.push({width,idle,running,switchMs});console.log(width+': layout, stable controls, five-window switching, cached drafts/details, own navigation, keyboard PASS');
  await context.close();
 }
 fs.writeFileSync(out+(process.env.CODEX_MEASURE_BASELINE?'/baseline.json':'/measurements.json'),JSON.stringify(measurements,null,2));
 }finally{await browser.close();server.close();}
})().catch(e=>{console.error(e);server.close();process.exitCode=1;});
