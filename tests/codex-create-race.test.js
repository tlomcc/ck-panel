const {chromium}=require('playwright');
const fs=require('fs'),path=require('path'),http=require('http'),assert=require('assert');
const root=path.resolve(__dirname,'..');
const server=http.createServer((req,res)=>{
 const file=path.resolve(root,new URL(req.url,'http://local').pathname.slice(1)||'index.html');
 if(!file.startsWith(root+'/')||!fs.existsSync(file)||!fs.statSync(file).isFile()){res.writeHead(404);return res.end();}
 res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':file.endsWith('.json')?'application/json':'text/html');res.end(fs.readFileSync(file));
});
(async()=>{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const browser=await chromium.launch({args:['--no-sandbox','--disable-dev-shm-usage']});
 try{for(const width of [390,1440]){
  const context=await browser.newContext({viewport:{width,height:900},serviceWorkers:'block'});
  await context.addInitScript(()=>{localStorage.setItem('ck_codex_access','fixture-access');localStorage.setItem('ck_codex_endpoint','https://codex.test/codex');});
  const page=await context.newPage(),errors=[],posts=[];page.on('pageerror',e=>errors.push(e.message));
  const old={id:'old',title:'任务8',profile:'p',status:'running',created:1,updated:1,seq:1};
  let windows=[old],created,releaseCreate;
  const creationGate=new Promise(r=>releaseCreate=r);
  await page.route('https://codex.test/codex/**',async route=>{
   const req=route.request(),url=new URL(req.url());let result={};
   if(req.method()==='POST')posts.push(url.pathname);
   if(url.pathname.endsWith('/config'))result={profiles:[{id:'p',name:'测试',model:'test',effort:'high',has_key:true}],default_profile:'p'};
   else if(url.pathname.endsWith('/threads')&&req.method()==='POST'){
    created={...old,id:'new',title:'任务9',status:'opening',created:2,seq:2};windows.push(created);
    await creationGate;result={...created,status:'idle'};
   }else if(url.pathname.endsWith('/threads'))result={windows};
   else if(url.pathname.includes('/threads/')){
    const w=windows.find(w=>w.id===url.pathname.split('/')[3]);
    result={window:w,items:[{id:'message',kind:'userMessage',text:'保留原任务内容',data:{},created:1}],cursor:w.seq,schedules:[]};
   }
   await route.fulfill({json:result});
  });
  await page.goto('http://127.0.0.1:'+server.address().port+'/#codex-tasks');await page.locator('[data-item-id=message]').waitFor();
  await page.locator('#cx-input').fill('原窗口的未发送草稿');
  await page.locator('#cx-new').click();
  // The list poll sees the server-created window before the POST response returns.
  await page.locator('#cx-notice-list [data-window-id=new]').waitFor();
  assert(await page.locator('#cx-new').isDisabled());
  // Later status must win over the delayed creation response.
  created.status='running';created.seq=3;
  await page.waitForFunction(()=>document.querySelector('#cx-notice-list [data-window-id=new]').dataset.status==='running');
  releaseCreate();
  await page.waitForFunction(()=>document.getElementById('cx-window-title').textContent==='任务9'&&!document.getElementById('cx-new').disabled);
  assert.equal(await page.locator('#cx-notice-list [data-window-id=new]').count(),1,'one creation must render one notice');
  assert.equal(await page.locator('#cx-notice-list').locator('button').count(),2);
  assert.equal(await page.locator('#cx-notice-list [data-window-id=new]').getAttribute('data-status'),'running');
  // Simulate stale duplicates left by an older renderer; the next render removes them.
  await page.evaluate(()=>{const row=document.querySelector('#cx-notice-list [data-window-id=new]');for(let i=0;i<3;i++)row.after(row.cloneNode(true));});
  created.title='任务9 · 已更新';created.seq++;
  await page.waitForFunction(()=>document.querySelector('#cx-notice-list [data-window-id=new] strong').textContent==='任务9 · 已更新');
  assert.equal(await page.locator('#cx-notice-list [data-window-id=new]').count(),1,'poll must remove stale duplicate notices');
  await page.locator('#cx-notice-list [data-window-id=old]').click();
  assert.equal(await page.locator('#cx-input').inputValue(),'原窗口的未发送草稿');
  // Distinct windows may intentionally share a title and must both remain visible.
  old.title=created.title;old.seq++;
  await page.waitForFunction(()=>document.querySelector('#cx-notice-list [data-window-id=old] strong').textContent==='任务9 · 已更新');
  assert.equal(await page.locator('#cx-notice-list button').count(),2);
  created.status='closed';created.seq++;
  await page.locator('#cx-notice-list [data-window-id=new]').waitFor({state:'detached'});
  assert.equal(await page.locator('#cx-notice-list button').count(),1);
  assert.deepEqual(posts,['/codex/threads']);assert.deepEqual(errors,[]);
  console.log(width+': create/poll race, one notice per ID, newer status, stale duplicate cleanup, distinct same-title windows, preserved drafts PASS');
  await context.close();
 }}finally{await browser.close();server.close();}
})().catch(e=>{console.error(e);server.close();process.exitCode=1;});
