const {chromium}=require('playwright');
const fs=require('fs'),path=require('path'),http=require('http'),assert=require('assert');
const root=path.resolve(__dirname,'..'),out=process.env.CK_RECORD_TEST_OUT||fs.mkdtempSync(path.join(require('os').tmpdir(),'ck-active-memory-browser-'));fs.mkdirSync(out,{recursive:true});
const index=fs.readFileSync(path.join(root,'index.html'),'utf8');
const section=index.slice(index.indexOf('<section class="panel-tab" id="tab-records">'),index.indexOf('<section class="panel-tab mw-page ck-maintenance" id="tab-status"'));
const html='<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/tokens.css"><link rel="stylesheet" href="/components.css"><link rel="stylesheet" href="/records-settings.css"><body style="margin:0">'+section+
  '<script>var currentPanelTab="records";var cfg={url:"/ck/chat",panelKey:"fixture"};function chatLoadConfig(){return cfg}function chatEndpoint(c){return c.url}function navTo(){}</script><script src="/daily-records.js"></script><script src="/active-memory.js"></script><script>ckActiveMemoryRefresh()</script>';
const server=http.createServer((req,res)=>{const name=new URL(req.url,'http://local').pathname;if(name==='/'){res.setHeader('Content-Type','text/html');return res.end(html)}const file=path.join(root,name);if(!file.startsWith(root+'/')||!fs.existsSync(file)){res.writeHead(404);return res.end()}res.setHeader('Content-Type',name.endsWith('.js')?'text/javascript':'text/css');res.end(fs.readFileSync(file))});
(async()=>{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const browser=await chromium.launch({args:['--no-sandbox','--disable-dev-shm-usage']});const results=[];
 try{for(const width of [320,390,1280]){
  const page=await browser.newPage({viewport:{width,height:850},serviceWorkers:'block'}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  let saved={ok:true,revision:1,content:'我记得我们约定把重要的事情留在自己的记忆里。',enabled:true,writable:true,stale:false,updated_at:1793070000},posts=0;
  await page.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
  await page.route('**/ck/active-memory*',async route=>{const request=route.request();if(request.method()==='POST'){posts++;const p=request.postDataJSON();assert.deepEqual(Object.keys(p).sort(),['action','revision']);assert(['pause','resume'].includes(p.action));if(p.revision!==saved.revision)return route.fulfill({status:409,json:{ok:false,error:'版本已更新'}});saved={...saved,revision:saved.revision+1,enabled:p.action==='resume'};}await route.fulfill({json:saved})});
  let archiveReads=0;await page.route('**/ck/daily-records*',async route=>{assert.equal(route.request().method(),'GET');archiveReads++;await route.fulfill({json:{ok:true,enabled:false,revision:1,status:'paused',todos:'- 旧待办保留',profile:'- 旧信息保留'}})});
  await page.goto('http://127.0.0.1:'+server.address().port+'/');await page.waitForFunction(()=>ckActiveMemoryData&&ckActiveMemoryData.revision===1);
  assert(await page.locator('#ck-active-memory-content').isEnabled());assert.equal(await page.locator('#ck-active-memory-content').inputValue(),saved.content);
  assert.equal(await page.locator('#ck-active-memory-content').getAttribute('readonly'),'');
  assert.equal(await page.locator('textarea:not([readonly])').count(),0,'memory has no editable field');
  assert.equal(await page.locator('#ck-active-memory-save,#ck-active-memory-merge,#ck-active-memory-load').count(),0);
  assert.equal(await page.locator('#tab-records h2').textContent(),'主动记忆');
  assert.equal(await page.locator('#ck-legacy-records').getAttribute('open'),null,'legacy records stay folded');
  assert.equal(archiveReads,0,'folded history must not start legacy polling');
  await page.locator('#ck-legacy-records summary').click();await page.waitForFunction(()=>document.getElementById('ck-records-saved-todos').textContent.includes('旧待办保留'));
  assert.equal(await page.locator('#ck-records-saved-profile').textContent(),'- 旧信息保留');
  await page.locator('#ck-legacy-records summary').click();assert.equal(archiveReads,1);
  if(!await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)){
    console.log(JSON.stringify(await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth,elements:[...document.querySelectorAll('*')].map(e=>({tag:e.tagName,id:e.id,class:e.className,left:e.getBoundingClientRect().left,right:e.getBoundingClientRect().right,width:e.scrollWidth})).filter(e=>e.right>innerWidth+0.1||e.left<0)}))));
    await page.screenshot({path:path.join(out,'overflow-'+width+'.png'),fullPage:true});
    throw Error('horizontal overflow at '+width);
  }
  await page.locator('#ck-active-memory-content').focus();await page.keyboard.type('手动改写不应生效');
  assert.equal(await page.locator('#ck-active-memory-content').inputValue(),saved.content);
  assert.equal(await page.evaluate(()=>ckActiveMemorySave()),false);assert.equal(posts,0);
  saved={...saved,revision:2,content:'小克已保存另一条重要记忆。'};await page.evaluate(()=>ckActiveMemoryRefresh());
  assert.equal(await page.locator('#ck-active-memory-content').inputValue(),saved.content);
  await page.locator('#ck-active-memory-toggle').click();await page.waitForFunction(()=>ckActiveMemoryData.enabled===false);assert.equal(saved.content,'小克已保存另一条重要记忆。');
  await page.locator('#ck-active-memory-toggle').click();await page.waitForFunction(()=>ckActiveMemoryData.enabled===true);assert.equal(saved.content,'小克已保存另一条重要记忆。');assert.equal(posts,2);
  await page.screenshot({path:path.join(out,'active-memory-'+width+'.png'),fullPage:true});assert.deepEqual(errors,[]);results.push({width,read_only:true,manual_save_blocked:true,model_updates_visible:true,pause_resume_keep_memory:true,no_overflow:true,page_errors:0});await page.close();
 }}finally{await browser.close();server.close()}
 fs.writeFileSync(path.join(out,'browser-verification.json'),JSON.stringify(results,null,2));console.log(JSON.stringify(results));
})().catch(error=>{console.error(error);server.close();process.exitCode=1});
