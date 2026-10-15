const {chromium}=require('playwright');
const fs=require('fs'),path=require('path'),http=require('http'),assert=require('assert');
const root=path.resolve(__dirname,'..'),any='75c76315-eb66-4fa0-ab6d-f0d2b9ef344e';
const server=http.createServer((req,res)=>{const name=new URL(req.url,'http://local').pathname.slice(1)||'index.html',file=path.resolve(root,name);if(!file.startsWith(root+'/')||!fs.existsSync(file)||!fs.statSync(file).isFile()){res.writeHead(404);return res.end();}res.setHeader('Content-Type',name.endsWith('.js')?'text/javascript':name.endsWith('.css')?'text/css':name.endsWith('.json')?'application/json':'text/html');res.end(fs.readFileSync(file));});
(async()=>{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const browser=await chromium.launch({args:['--no-sandbox','--disable-dev-shm-usage']});
 try{for(const width of [390,1440]){
  const context=await browser.newContext({viewport:{width,height:900},serviceWorkers:'block'});
  await context.addInitScript(()=>{localStorage.setItem('ck_codex_access','fixture-access');localStorage.setItem('ck_codex_endpoint','https://codex.test/codex');});
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  let config={profiles:[{id:any,name:'any',model:'test-model',effort:'high',base_url:'https://a.test/v1',has_key:true},{id:'q',name:'AG',model:'test-model',effort:'high',base_url:'https://b.test/v1',has_key:true}],default_profile:any,any_retry_switch:true,any_retry_profile:any,any_auto_retry:false,any_retry_controls:true,any_retry_mode:"off",any_retry_limit:3,any_parallel_count:2,any_parallel_enabled:false};
  let switches=[],saves=0,fail=false,parallel=[];
  const w={id:'race-task',title:'并发请求任务',profile:any,status:'completed',updated:1,seq:3};
  const folder={id:'any-race:task',kind:'anyRace',created:1,text:'',data:{count:3,retry:2,winner:2,windows:[{number:1,state:'cancelled'},{number:2,state:'winner'},{number:3,state:'failed',detail:'HTTP 503'}]}};
  await page.route('https://codex.test/codex/**',async route=>{
   const url=new URL(route.request().url());let result={};
   if(url.pathname.endsWith('/config'))result=config;
   else if(url.pathname.endsWith('/profiles/any-retry')){
    switches.push(route.request().postDataJSON());
    if(fail)return route.fulfill({status:500,json:{error:'保存失败，请重试'}});
    const b=switches.at(-1);config={...config,any_retry_mode:b.mode,any_auto_retry:b.mode!=='off',any_retry_limit:b.limit||config.any_retry_limit};result=config;
   }else if(url.pathname.endsWith('/profiles/any-parallel')){const b=route.request().postDataJSON();parallel.push(b);config={...config,any_parallel_enabled:b.enabled,any_parallel_count:b.count};result=config;}else if(url.pathname.endsWith('/profiles/save')){saves++;result=config;}
   else if(url.pathname.endsWith('/threads'))result={windows:[w]};
   else if(url.pathname.includes('/threads/'))result={window:w,items:[folder],cursor:3};
   await route.fulfill({json:result});
  });
  await page.goto('http://127.0.0.1:'+server.address().port+'/#codex-api');await page.locator('.cx-profile-card').first().waitFor();
  const card=page.locator('.cx-profile-card[data-id="'+any+'"]'),other=page.locator('.cx-profile-card[data-id=q]');
  await other.locator('summary').click();await other.locator('[name=name]').fill('AG草稿');
  await card.locator('summary').click();await card.locator('[name=base_url]').fill('');
  const off=card.getByRole('button',{name:'关闭重试',exact:true}),unlimited=card.getByRole('button',{name:'开启无限重试',exact:true}),limited=card.getByRole('button',{name:'设置重试次数',exact:true});
  assert.equal(await off.getAttribute('aria-pressed'),'true');await unlimited.click();await card.getByText('已开启无限重试。',{exact:true}).waitFor();
  assert.equal(await unlimited.getAttribute('aria-pressed'),'true');assert.equal(saves,0);
  assert.equal(await other.locator('[name=name]').inputValue(),'AG草稿');assert.equal(await card.locator('[name=base_url]').inputValue(),'');
  await card.getByLabel('最多重试次数').fill('5');await limited.click();await card.getByText('已设置：首次失败后，最多再试 5 次。',{exact:true}).waitFor();
  assert.equal(await limited.getAttribute('aria-pressed'),'true');
  await card.getByLabel('多开窗口数').fill('3');await card.getByRole('button',{name:'开启多开 / 保存个数',exact:true}).click();await card.getByText('已开启：每轮同时请求 3 个窗口。',{exact:true}).waitFor();
  assert.deepEqual(parallel,[{enabled:true,count:3}]);assert.equal(saves,0);
  fail=true;await unlimited.click();await card.getByText('保存失败，请重试',{exact:true}).waitFor();assert.equal(await limited.getAttribute('aria-pressed'),'true');fail=false;
  await page.screenshot({path:'/home/ckcodex/workspace/work/any-controls-20261015/any-controls-'+width+'.png'});
  await page.reload();await page.locator('.cx-profile-card').first().waitFor();await card.locator('summary').click();assert.equal(await limited.getAttribute('aria-pressed'),'true');assert.equal(await card.getByLabel('最多重试次数').inputValue(),'5');assert.equal(await card.getByLabel('多开窗口数').inputValue(),'3');
  await off.click();await card.getByText('已关闭；待重试已取消。',{exact:true}).waitFor();assert.equal(await off.getAttribute('aria-pressed'),'true');
  // Turning off remains possible even with an invalid draft count.
  await card.getByLabel('多开窗口数').fill('');await card.getByRole('button',{name:'关闭多开',exact:true}).click();await card.getByText('已关闭多开，后续请求使用单窗口。',{exact:true}).waitFor();
  assert.deepEqual(parallel.at(-1),{enabled:false,count:3});
  await page.evaluate(()=>window.ckOpenCodex('tasks'));await page.locator('.cx-any-folder').waitFor();
  await page.locator('.cx-any-folder>details>summary').click();assert.equal(await page.locator('.cx-any-window').count(),3);assert((await page.locator('.cx-any-folder').innerText()).includes('窗口 2 胜出'));
  await page.locator('.cx-any-window[data-state=winner]>summary').click();assert(await page.getByText('此窗口的回复与后续执行显示在下方任务记录。',{exact:true}).isVisible());
  await page.screenshot({path:'/home/ckcodex/workspace/work/any-controls-20261015/any-folder-'+width+'.png'});
  await page.evaluate(()=>location.hash='codex-tasks');await page.reload();await page.locator('.cx-any-folder').waitFor();assert((await page.locator('.cx-any-folder').innerText()).includes('窗口 2 胜出'));
  config.any_retry_controls=false;await page.evaluate(()=>window.ckOpenCodex('api'));await card.locator('summary').click();assert(await unlimited.isDisabled());assert(await card.getByRole('button',{name:'开启多开 / 保存个数',exact:true}).isDisabled());
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));assert.deepEqual(errors,[]);
  console.log(width+': three retry modes, limits, parallel count, independent drafts, failed save, folder, refresh, old backend PASS');await context.close();
 }}finally{await browser.close();server.close();}
})().catch(e=>{console.error(e);server.close();process.exitCode=1;});
