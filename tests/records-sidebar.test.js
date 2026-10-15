const {chromium}=require('playwright');
const fs=require('fs'),path=require('path'),http=require('http'),assert=require('assert');
const root=path.resolve(__dirname,'..'),out='/home/ckcodex/workspace/work/records-status-sidebar-20261014';
const server=http.createServer((req,res)=>{if(req.url==='/blank'){res.setHeader('Content-Type','text/html');return res.end('<!doctype html><title>test</title>');}const file=path.resolve(root,new URL(req.url,'http://local').pathname.slice(1)||'index.html');if(!file.startsWith(root+'/')||!fs.existsSync(file)||!fs.statSync(file).isFile()){res.writeHead(404);return res.end();}res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':file.endsWith('.json')?'application/json':'text/html');res.end(fs.readFileSync(file));});
(async()=>{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const browser=await chromium.launch({args:['--no-sandbox','--disable-dev-shm-usage']});
 try{for(const width of [320,390,1440]){
  const context=await browser.newContext({viewport:{width,height:850},serviceWorkers:'block'});
  await context.addInitScript(()=>{localStorage.setItem('ck_codex_access','fixture');localStorage.setItem('ck_codex_endpoint','https://codex.test/codex');});
  const page=await context.newPage(),calls=[],errors=[];page.on('pageerror',e=>errors.push(e.message));
  let windows=Array.from({length:24},(_,i)=>({id:'w'+i,title:'任务'+(i+1),profile:'p',status:'completed',updated:1}));
  await page.route('https://codex.test/codex/**',async route=>{
   const url=new URL(route.request().url()),method=route.request().method();calls.push([url.pathname,method]);let data={};
   if(url.pathname.endsWith('/config'))data={profiles:[{id:'p',name:'测试',model:'model',has_key:true,base_url:'https://fixture.invalid'}],default_profile:'p'};
   else if(url.pathname.endsWith('/delete'))windows=[];
   else if(url.pathname.endsWith('/threads'))data={windows};
   else if(url.pathname.includes('/threads/'))data={window:windows.find(w=>w.id===url.pathname.split('/')[3]),items:[],cursor:1};
   await route.fulfill({json:data});
  });
  await page.goto('http://127.0.0.1:'+server.address().port+'/#codex-tasks');await page.waitForFunction(()=>document.querySelectorAll('#cx-windows .cx-window').length===24);
  const rect=selector=>page.locator(selector).boundingBox();
  const exit=await rect('#cx-exit');assert(exit.x+exit.width>width-22,'Return CK is right aligned');
  if(width<=640){assert((await rect('#cx-window-toggle')).x<15);await page.locator('#cx-window-toggle').click();}
  const before=await rect('.cx-navigation-bottom');await page.locator('#cx-windows').evaluate(e=>e.scrollTop=e.scrollHeight);
  assert.deepEqual(await rect('.cx-navigation-bottom'),before,'fixed footer moved while windows scrolled');
  const sidebar=await rect('#cx-window-sidebar');assert(before.y+before.height>sidebar.y+sidebar.height-30);
  assert(Number(await page.locator('.cx-window-menu summary').evaluate(e=>parseFloat(getComputedStyle(e).fontSize)))<=18);
  await page.screenshot({path:out+'/sidebar-'+width+'.png'});
  await page.locator('#cx-tab-api').click();if(width<=640)await page.locator('#cx-window-toggle').click();
  assert(await page.locator('#cx-task-list').isVisible());await page.locator('#cx-windows').evaluate(e=>e.scrollTop=0);await page.locator('#cx-windows .cx-window').first().click();
  assert(await page.locator('#cx-tasks').isVisible());
  windows=windows.slice(0,1);if(!await page.locator('.cx-window-menu').evaluate(e=>e.open))await page.locator('.cx-window-menu summary').click();await page.locator('#cx-refresh').click();await page.waitForFunction(()=>document.querySelectorAll('#cx-windows .cx-window').length===1);
  await page.locator('#cx-input').fill('待删除草稿');await page.locator('.cx-window-menu summary').click();await page.locator('#cx-delete-window').click();await page.locator('dialog button[type=submit]').click();
  await page.waitForFunction(()=>document.querySelectorAll('#cx-windows .cx-window').length===0);if(!await page.locator('.cx-window-menu').evaluate(e=>e.open))await page.locator('.cx-window-menu summary').click();await page.locator('#cx-refresh').click();await page.waitForTimeout(1700);
  assert.equal(await page.locator('#cx-window-title').textContent(),'选择或新建任务窗口');assert(await page.locator('#cx-input').isDisabled());
  assert(!calls.some(([p,m])=>p.endsWith('/threads')&&m==='POST'),'deletion created a new native window');
  await page.reload();await page.waitForFunction(()=>document.querySelector('#cx-windows')?.textContent.includes('还没有窗口'));assert.equal(await page.locator('#cx-windows .cx-window').count(),0);
  await page.locator('#cx-exit').click();
  await page.goto('http://127.0.0.1:'+server.address().port+'/blank');await page.setContent('<html lang=zh-CN><meta name=viewport content="width=device-width"><link rel=stylesheet href="http://127.0.0.1:'+server.address().port+'/tokens.css"><link rel=stylesheet href="http://127.0.0.1:'+server.address().port+'/records-settings.css"><body style="margin:12px;font-family:sans-serif"><h2>每日记录 · 更新状态</h2><div id=ck-records-monitor class=ck-records-status></div></body></html>');await page.addScriptTag({path:path.join(root,'daily-records.js')});
  await page.evaluate(()=>{
   const failure={at:1791950000,day:'2026-10-12',stage:'checking',stage_attempt:3,attempt:3,batch:1,batches:5,error_code:'audit_rejected',message:'独立检查未通过',provider:'测试供应商',model:'check-model',checks:{grounded:false},notes:['t2 缺少原文依据 <img src=x onerror=alert(1)>']};
   ckRecordsData={ok:true,status:'needs_attention',last_day:'2026-10-11',last_error:failure.message,last_failure:failure,failure_history:[failure],todos:'- 已保存待办',profile:'- 已保存信息'};ckRecordsRender();
  });
  let monitor=page.locator('#ck-records-monitor');assert((await monitor.textContent()).includes('未通过：事实依据'),await monitor.textContent());assert((await monitor.innerText()).includes('第 1 / 5 批'));assert.equal(await monitor.locator('img').count(),0);
  await monitor.locator('summary').click();await page.evaluate(()=>{ckRecordsConnectionError='状态连接暂未完成';ckRecordsRender()});assert.equal(await monitor.locator('details').getAttribute('open'),'');assert((await monitor.innerText()).includes('audit_rejected'));assert((await monitor.innerText()).includes('状态连接暂未完成'));
  await page.screenshot({path:out+'/record-status-'+width+'.png'});
  await page.evaluate(()=>{ckRecordsData={status:'needs_attention',last_error:'总结生成或结果校验失败',legacy_failure:true};ckRecordsRender()});assert((await monitor.innerText()).includes('旧版本未保存具体失败阶段'));
  await page.evaluate(()=>{ckRecordsData={status:'updated',last_day:'2026-10-13',history:[{method:'manual',start_day:'2026-10-12',day:'2026-10-14',partial:true,source_cutoff:1791950000}]};ckRecordsRender()});assert((await monitor.innerText()).includes('最近人工核对：2026-10-12 至 2026-10-14'));assert((await monitor.innerText()).includes('当天资料截至'));
  assert.deepEqual(errors,[]);console.log(width+': footer, header, navigation, last-window deletion, reload, failure details, history, escaping PASS');await context.close();
 }}finally{await browser.close();server.close();}
})().catch(e=>{console.error(e);server.close();process.exitCode=1});
