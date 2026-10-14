const {chromium}=require('playwright');
const fs=require('fs'),path=require('path'),http=require('http'),assert=require('assert');
const root=path.resolve(__dirname,'..');
const server=http.createServer((req,res)=>{const name=new URL(req.url,'http://local').pathname.slice(1)||'index.html',file=path.resolve(root,name);if(!file.startsWith(root+'/')||!fs.existsSync(file)||!fs.statSync(file).isFile()){res.writeHead(404);return res.end();}res.setHeader('Content-Type',name.endsWith('.js')?'text/javascript':name.endsWith('.css')?'text/css':name.endsWith('.json')?'application/json':'text/html');res.end(fs.readFileSync(file));});
(async()=>{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const browser=await chromium.launch({args:['--no-sandbox','--disable-dev-shm-usage']});
 try{for(const width of [390,1440]){
  const context=await browser.newContext({viewport:{width,height:900},serviceWorkers:'block'});
  await context.addInitScript(()=>{localStorage.setItem('ck_codex_access','fixture-access');localStorage.setItem('ck_codex_endpoint','https://codex.test/codex');});
  const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  let config={profiles:[{id:'p',name:'AgentRouter',model:'gpt-6-astra',effort:'high',base_url:'https://a.test/v1',has_key:true,revision:'r1'},{id:'q',name:'4router',model:'gpt-6-astra',effort:'xhigh',base_url:'https://b.test/v1',has_key:true,revision:'r2'}],default_profile:'p',efforts:['none','minimal','low','medium','high','xhigh','max','ultra'],key_storage:'encrypted',workspace:'/workspace'};
  let posted=[],window={id:'task',title:'检查双服务器并整理维护记录',profile:'p',thread_id:'native',status:'completed',updated:Date.now()/1000};
  await page.route('https://codex.test/codex/**',async route=>{
   const url=new URL(route.request().url());let result={};
   if(url.pathname.endsWith('/config'))result=config;
   else if(url.pathname.endsWith('/profiles/save')){const b=route.request().postDataJSON();posted.push(b);assert.equal(Object.keys(b).includes('profiles'),false);const old=config.profiles.find(p=>p.id===b.profile.id);config={...config,profiles:config.profiles.map(p=>p.id===b.profile.id?{...p,...b.profile,api_key:undefined,revision:old.revision+'x'}:p)};result=config;}
   else if(url.pathname.endsWith('/models'))result={models:['gpt-6-astra'],source:'configured',warning:'供应商拒绝当前客户端（HTTP 401，unauthorized_client_error）。仍可手动填写模型。'};
   else if(url.pathname.endsWith('/threads'))result={windows:[window,{...window,id:'task2',title:'另一个正在执行的任务',status:'running'}]};
   else if(url.pathname.includes('/threads/'))result={window:{...window,id:url.pathname.split('/')[3]},items:[{id:'u',kind:'userMessage',text:'检查两台服务器，保留已成功的操作，并报告剩余事项。',created:1,data:{}},{id:'a',kind:'agentMessage',text:'两台服务器都已连通。\n\n国内 VPS 负责聊天 API 和记忆整理；美国 VPS 保留 Codex 任务与订阅服务。接下来核对各自的运行状态。',created:2,data:{}},{id:'t',kind:'commandExecution',text:'technical output remains folded',created:3,data:{}}],cursor:3};
   await route.fulfill({json:result});
  });
  await page.goto('http://127.0.0.1:'+server.address().port+'/#codex-tasks');await page.locator('.cx-item-agentMessage').waitFor();
  assert.equal(await page.evaluate(()=>localStorage.getItem('ck_codex_access')),null);
  assert.equal(await page.evaluate(()=>CKCodexStorage.load()),'fixture-access');
  const feed=await page.locator('#cx-feed').boundingBox();assert(feed.height>480,`feed height ${feed.height}`);
  assert.equal(await page.locator('details.cx-detail[open]').count(),0);
  if(width<640){assert.equal(await page.locator('#cx-window-sidebar').isVisible(),false);await page.locator('#cx-window-toggle').click();assert(await page.locator('#cx-window-sidebar').isVisible());await page.getByRole('button',{name:'另一个正在执行的任务',exact:false}).click();assert.equal(await page.locator('#cx-window-sidebar').isVisible(),false);}
  await page.screenshot({path:'/home/ckcodex/workspace/work/codex-workspace-check/legacy/tasks-'+width+'.png'});
  if(width<=640)await page.locator('#cx-window-toggle').click();await page.locator('#cx-tab-api').click();assert.equal(await page.locator('.cx-profile-card[open]').count(),0);
  const p=page.locator('.cx-profile-card[data-id=p]'),q=page.locator('.cx-profile-card[data-id=q]');
  await q.locator('summary').click();
  await q.locator('[name=name]').fill('尚未保存的另一个供应商');await q.locator('[name=base_url]').fill('');
  await p.locator('summary').click();await p.locator('[name=name]').fill('AgentRouter · 独立保存');
  await p.getByRole('button',{name:'保存供应商',exact:true}).click();await p.getByText('已保存 · 下次任务生效',{exact:true}).waitFor();
  assert.equal(posted.length,1);assert.equal(posted[0].profile.id,'p');assert.equal(config.profiles[1].name,'4router');assert.equal(await q.locator('[name=name]').inputValue(),'尚未保存的另一个供应商');assert.equal(await q.locator('[name=base_url]').inputValue(),'');
  await p.locator('.ck-select-button').click();for(const effort of ['high','xhigh','max','ultra'])assert(await page.locator('dialog').getByRole('button',{name:effort,exact:true}).isVisible());await page.locator('dialog').getByRole('button',{name:'max',exact:true}).click();
  await p.getByRole('button',{name:'刷新模型',exact:true}).click();await page.locator('dialog[open]').waitFor();assert((await page.locator('dialog').innerText()).includes('unauthorized_client_error'));await page.keyboard.press('Escape');assert(await page.locator('#cx-api').isVisible());
  await page.locator('#cx-api').evaluate(e=>e.scrollTop=0);await page.screenshot({path:'/home/ckcodex/workspace/work/codex-workspace-check/legacy/api-'+width+'.png'});
  await page.evaluate(()=>document.body.classList.add('dark'));assert(await p.isVisible());await page.screenshot({path:'/home/ckcodex/workspace/work/codex-workspace-check/legacy/api-dark-'+width+'.png'});
  await page.locator('#cx-exit').click();
  await page.evaluate(()=>{window.storedPanelKey=()=> 'fixture-panel-key';document.getElementById('ckActionModal').classList.remove('show');document.getElementById('loading-wrap').style.setProperty('display','none','important');});
  let statusCalls=[];
  await page.route('https://*/gateway/ck/server-status',async route=>{assert.equal(route.request().headers()['x-api-key'],'fixture-panel-key');const cn=route.request().url().includes('123.57');statusCalls.push(cn?'cn':'us');if(cn)await new Promise(r=>setTimeout(r,180));await route.fulfill({json:{resource_metrics_available:true,updated_at:Date.now()/1000,cpu_percent:cn?11:22,uptime_seconds:172800,memory:{used:2**30,total:cn?2*2**30:4*2**30,percent:cn?50:25},disk:{used:10*2**30,total:50*2**30,percent:20},services:[{name:'CK 网关',state:'ok'}]}});});
  await page.route('https://*/codex/health',route=>route.fulfill({json:{ok:true}}));
  await page.evaluate(()=>ckOpenServerStatus());await page.locator('#ck-server-tab-us').click();await page.getByText('22%',{exact:true}).waitFor();await page.waitForTimeout(250);assert((await page.locator('#ck-server-name').innerText()).includes('美国'));assert(await page.getByText('Codex 任务 · 正常',{exact:true}).isVisible());assert.equal(await page.locator('#ck-server-tab-us').getAttribute('aria-selected'),'true');
  await page.locator('#ck-server-tab-cn').click();await page.getByText('11%',{exact:true}).waitFor();assert((await page.locator('#ck-server-name').innerText()).includes('国内'));assert((await page.locator('#ck-server-body').innerText()).includes('1.0 GB / 2.0 GB'));
  assert.equal(await page.evaluate(()=>CKBackendRoute.current.server),'cn');
  await page.screenshot({path:'/home/ckcodex/workspace/work/codex-workspace-check/legacy/servers-'+width+'.png'});
  await page.locator('#ck-server-close').click();assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));assert.deepEqual(errors,[]);
  console.log(width+': layout, mobile drawer, encrypted storage, independent save, drafts, efforts, upstream error, two-server race PASS');await context.close();
 }}finally{await browser.close();server.close();}
})().catch(e=>{console.error(e);server.close();process.exitCode=1;});
