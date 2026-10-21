const {chromium}=require('playwright');
const fs=require('fs'),path=require('path'),http=require('http'),assert=require('assert');
const root=path.resolve(__dirname,'..'),out=process.env.CK_RECORD_TEST_OUT||path.resolve(root,'../screenshots');fs.mkdirSync(out,{recursive:true});
const section=fs.readFileSync(path.join(root,'index.html'),'utf8').match(/<section class="panel-tab" id="tab-records">[\s\S]*?(?=<section class="panel-tab mw-page)/)[0];
const css=fs.readFileSync(path.join(root,'index.html'),'utf8').match(/<link rel="stylesheet"[^>]*>/g).join('');
const states={};let delay=0,fail=false,posts=[];
const initial=()=>({ok:true,enabled:true,status:'updated',todos:'- 小明计划2026.10.18归还图书。',profile:'- 小明喜欢游泳。',revision:1,manual_editable:true,source_range:{start:'2026-10-18',end:'2026-10-21',rows:780,batches:1,reused_batches:0}});
const canonical=s=>s.split(/\r?\n/).map(l=>l.trim().replace(/^- /,'').trim()).filter(Boolean).map(l=>'- '+l).join('\n');
const server=http.createServer(async(req,res)=>{
 const url=new URL(req.url,'http://local');
 if(url.pathname==='/daily-records'){
  const key=url.searchParams.get('key');let state=states[key]||(states[key]=initial());
  if(fail){res.writeHead(503,{'Content-Type':'application/json'});return res.end(JSON.stringify({ok:false,error:'测试连接失败'}))}
  if(req.method==='POST'){
   let raw='';for await(const chunk of req)raw+=chunk;const payload=JSON.parse(raw);posts.push({key,payload});
   if(payload.revision!==state.revision){res.writeHead(409,{'Content-Type':'application/json'});return res.end(JSON.stringify({ok:false,error:'记录已更新，请先核对'}))}
   assert.equal(payload.action,'save');state.todos=canonical(payload.todos);state.profile=canonical(payload.profile);state.revision++;state.manual_saved_at=1792230200;
  }
  const body=JSON.stringify(state);if(delay)await new Promise(r=>setTimeout(r,delay));res.setHeader('Content-Type','application/json');return res.end(body);
 }
 if(url.pathname==='/'){
  res.setHeader('Content-Type','text/html');return res.end('<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width">'+css+'<style>.panel-tab{display:block}body{margin:0}</style><body>'+section+'<script>var currentPanelTab="records",ckStatusTab="records",fixtureKey="a";function chatLoadConfig(){return {panelKey:fixtureKey}}function chatManualModelValue(){return "sonnet"}function chatEndpoint(){return location.origin+"/chat"}</script><script src="daily-records.js"></script><script>ckRecordsRefresh()</script></body></html>');
 }
 const file=path.resolve(root,url.pathname.slice(1));if(!file.startsWith(root+'/')||!fs.existsSync(file)){res.writeHead(404);return res.end()}
 res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':'text/css');res.end(fs.readFileSync(file));
});
(async()=>{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const browser=await chromium.launch({args:['--no-sandbox','--disable-dev-shm-usage']});
 try{for(const width of [320,390,1280]){
  states.a=initial();states.b={...initial(),todos:'- 乙的待办',profile:'- 乙的信息'};posts=[];delay=0;fail=false;
  const page=await browser.newPage({viewport:{width,height:900}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://127.0.0.1:'+server.address().port);await page.waitForFunction(()=>!!ckRecordsData);
  assert.equal(await page.locator('#ck-records-current-model,#ck-records-manual-model,#ck-records-cancel-model').count(),0);
  assert.equal(await page.evaluate(()=>typeof ckRecordsModelMode),'undefined');
  assert((await page.locator('#ck-records-state').textContent()).includes('2026-10-18 至 2026-10-21 · 780 条 · 1 批'));
  const box=page.locator('#ck-records-todos'),profile=page.locator('#ck-records-profile'),save=page.locator('#ck-records-save');
  assert.equal(await page.locator('#ck-records-feedback').count(),0);assert(await box.isEditable());assert(await profile.isEditable());
  await box.fill('我的新待办');await page.evaluate(()=>ckRecordsRefresh());assert.equal(await box.inputValue(),'我的新待办');
  // Another writer updates between the last GET and this POST.
  states.a.profile='- 另一页面的新信息';states.a.revision++;
  await save.click();await page.waitForFunction(()=>!ckRecordsBusy);assert.equal(states.a.todos,initial().todos);
  assert((await page.locator('#ck-records-save-state').textContent()).includes('保存未完成'));assert.equal(await box.inputValue(),'我的新待办');assert(await save.isDisabled());
  await page.locator('#ck-records-merge').click();assert.equal(await profile.inputValue(),'- 另一页面的新信息');
  delay=300;await save.click();await box.fill('提交期间继续写');await profile.fill('提交期间的新信息');await page.waitForFunction(()=>!ckRecordsBusy);delay=0;
  assert.equal(states.a.todos,'- 我的新待办');assert.equal(await box.inputValue(),'提交期间继续写');assert.equal(await profile.inputValue(),'提交期间的新信息');assert(await save.isEnabled());
  fail=true;await save.click();await page.waitForFunction(()=>!ckRecordsBusy);assert.equal(await box.inputValue(),'提交期间继续写');fail=false;
  await save.click();await page.waitForFunction(()=>!ckRecordsBusy);await page.reload();await page.waitForFunction(()=>!!ckRecordsData);assert.equal(await box.inputValue(),'- 提交期间继续写');assert.equal(await profile.inputValue(),'- 提交期间的新信息');
  assert((await page.locator('#ck-records-save-state').textContent()).includes('最近手动保存'));
  const priorPosts=posts.length;await page.evaluate(()=>{fixtureKey='b';return ckRecordsSave()});assert.equal(posts.length,priorPosts);assert.equal(await box.inputValue(),'- 乙的待办');
  await box.fill('乙的未保存内容');await page.evaluate(()=>{fixtureKey='a';return ckRecordsRefresh()});assert.equal(await box.inputValue(),'- 提交期间继续写');
  delay=200;await page.evaluate(()=>{void ckRecordsRefresh();fixtureKey='b';return ckRecordsRefresh()});await page.waitForFunction(()=>!ckRecordsBusy);delay=0;
  assert.notEqual(await box.inputValue(),'- 提交期间继续写');await page.evaluate(()=>ckRecordsRefresh());assert.equal(await box.inputValue(),'乙的未保存内容');
  await page.locator('.ck-records-saved summary').click();await page.locator('#ck-records-load').click();await page.waitForFunction(()=>!ckRecordsBusy);assert.equal(await box.inputValue(),'- 乙的待办');
  await box.fill('😀'.repeat(4999));assert(await save.isDisabled());assert((await page.locator('#ck-records-todos-count').textContent()).includes('5001'));
  await box.fill('<img src=x onerror=alert(1)>');await save.click();await page.waitForFunction(()=>!ckRecordsBusy);assert.equal(await page.locator('.ck-records-saved img').count(),0);
  await box.fill('');await profile.fill('');await save.click();await page.waitForFunction(()=>!ckRecordsBusy);assert.equal(states.b.todos,'');assert.equal(states.b.profile,'');
  await box.fill('- 2026.10.18下午，小明计划归还图书。');await profile.fill('- 小明喜欢游泳。');await save.click();await page.waitForFunction(()=>!ckRecordsBusy);
  assert((await page.locator('#ck-records-save-state').textContent()).includes('缓存有效期内继续使用旧版'));
  await page.locator('.ck-records-saved summary').click();
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'horizontal overflow');
  await page.screenshot({path:path.join(out,'manual-'+width+'.png'),fullPage:true});await page.evaluate(()=>document.body.classList.add('dark'));await page.screenshot({path:path.join(out,'manual-dark-'+width+'.png'),fullPage:true});
  assert.deepEqual(errors,[]);await page.close();console.log(width+': edit, save, reload, polling, conflicts, in-flight edits, errors, isolation, limits, clear, escaping and layout PASS');
 }}finally{await browser.close();server.close()}
})().catch(error=>{console.error(error);server.close();process.exitCode=1});
