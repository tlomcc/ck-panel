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
  let config={profiles:[{id:any,name:'any',model:'test-model',effort:'high',base_url:'https://a.test/v1',has_key:true},{id:'q',name:'AG',model:'test-model',effort:'high',base_url:'https://b.test/v1',has_key:true}],default_profile:any,any_retry_switch:true,any_retry_profile:any,any_auto_retry:false};
  let switches=[],saves=0,fail=false;
  await page.route('https://codex.test/codex/**',async route=>{
   const url=new URL(route.request().url());let result={};
   if(url.pathname.endsWith('/config'))result=config;
   else if(url.pathname.endsWith('/profiles/any-retry')){
    switches.push(route.request().postDataJSON());
    if(fail)return route.fulfill({status:500,json:{error:'保存失败，请重试'}});
    config={...config,any_auto_retry:switches.at(-1).enabled};result=config;
   }else if(url.pathname.endsWith('/profiles/save')){saves++;result=config;}
   else if(url.pathname.endsWith('/threads'))result={windows:[]};
   await route.fulfill({json:result});
  });
  await page.goto('http://127.0.0.1:'+server.address().port+'/#codex-api');await page.locator('.cx-profile-card').first().waitFor();
  const card=page.locator('.cx-profile-card[data-id="'+any+'"]'),other=page.locator('.cx-profile-card[data-id=q]');
  await other.locator('summary').click();await other.locator('[name=name]').fill('AG草稿');
  await card.locator('summary').click();await card.locator('[name=base_url]').fill('');
  const toggle=card.getByRole('switch');assert.equal(await page.getByRole('switch').count(),1);
  assert.equal(await toggle.getAttribute('aria-checked'),'false');await toggle.click();
  await card.getByText('已开启；仅对未完成任务生效，不会重跑历史失败。',{exact:true}).waitFor();
  assert.equal(await toggle.getAttribute('aria-checked'),'true');assert.equal(saves,0);
  assert.equal(await other.locator('[name=name]').inputValue(),'AG草稿');assert.equal(await card.locator('[name=base_url]').inputValue(),'');
  await toggle.click();await card.getByText('已关闭；待重试已取消，正在执行的请求完成后不再重试。',{exact:true}).waitFor();
  assert.equal(await toggle.getAttribute('aria-checked'),'false');assert.deepEqual(switches,[{enabled:true},{enabled:false}]);
  fail=true;await toggle.click();await card.getByText('保存失败，请重试',{exact:true}).waitFor();assert.equal(await toggle.getAttribute('aria-checked'),'false');fail=false;
  await page.screenshot({path:'/home/ckcodex/workspace/work/remove-any-retry-20261014/any-switch-'+width+'.png'});
  await page.reload();await page.locator('.cx-profile-card').first().waitFor();await card.locator('summary').click();assert.equal(await toggle.getAttribute('aria-checked'),'false');
  config.any_retry_switch=false;await page.reload();await page.locator('.cx-profile-card').first().waitFor();await card.locator('summary').click();assert(await toggle.isDisabled());
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));assert.deepEqual(errors,[]);
  console.log(width+': default off, toggle on/off, independent drafts, failed save, refresh, old backend PASS');await context.close();
 }}finally{await browser.close();server.close();}
})().catch(e=>{console.error(e);server.close();process.exitCode=1;});
