const {chromium}=require('playwright');
const fs=require('fs'),path=require('path'),http=require('http'),assert=require('assert');
const root=path.resolve(__dirname,'..');
const out=process.env.CK_FEEDBACK_TEST_OUT||path.resolve(root,'../screenshots');fs.mkdirSync(out,{recursive:true});
const section=fs.readFileSync(path.join(root,'index.html'),'utf8').match(/<section class="panel-tab" id="tab-records">[\s\S]*?(?=<section class="panel-tab mw-page)/)[0];
const css=fs.readFileSync(path.join(root,'index.html'),'utf8').match(/<link rel="stylesheet"[^>]*>/g).join('');
const states={};let delay=0,fail=false,posts=[];
const initial=()=>({ok:true,enabled:true,status:'updated',todos:'- 小明计划2026.10.18归还图书。',profile:'- 小明喜欢游泳。',feedback_text:'不用写自述，直接说事实。',feedback_revision:1,feedback_saved_at:1792230000});
const server=http.createServer(async(req,res)=>{
 const url=new URL(req.url,'http://local');
 if(url.pathname==='/daily-records'){
  const key=url.searchParams.get('key');let state=states[key]||(states[key]=initial());
  if(fail){res.writeHead(503,{'Content-Type':'application/json'});return res.end(JSON.stringify({ok:false,error:'测试连接失败'}))}
  if(req.method==='POST'){
   let raw='';for await(const chunk of req)raw+=chunk;const payload=JSON.parse(raw);posts.push({key,payload});
   if(payload.feedback_revision!==state.feedback_revision){res.writeHead(409,{'Content-Type':'application/json'});return res.end(JSON.stringify({ok:false,error:'评价已在其他页面修改，请先读取已保存评价再合并。'}))}
   state.feedback_text=payload.text.trim();state.feedback_revision++;state.feedback_saved_at=1792230200;
  }
  const body=JSON.stringify(state);if(delay)await new Promise(r=>setTimeout(r,delay));res.setHeader('Content-Type','application/json');return res.end(body);
 }
 if(url.pathname==='/'){
  res.setHeader('Content-Type','text/html');return res.end('<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width">'+css+'<style>.panel-tab{display:block}body{margin:0}</style><body>'+section+'<script>var currentPanelTab="records",ckStatusTab="records",fixtureKey="a";function chatLoadConfig(){return {panelKey:fixtureKey}}function chatEndpoint(){return location.origin+"/chat"}</script><script src="daily-records.js"></script><script>ckRecordsRefresh()</script></body></html>');
 }
 const file=path.resolve(root,url.pathname.slice(1));if(!file.startsWith(root+'/')||!fs.existsSync(file)){res.writeHead(404);return res.end()}
 res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':'text/css');res.end(fs.readFileSync(file));
});
(async()=>{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const browser=await chromium.launch({args:['--no-sandbox','--disable-dev-shm-usage']});
 try{for(const width of [320,390,1280]){
  states.a=initial();states.b={...initial(),feedback_text:'乙的评价'};posts=[];delay=0;fail=false;
  const page=await browser.newPage({viewport:{width,height:900}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://127.0.0.1:'+server.address().port);await page.waitForFunction(()=>!!ckRecordsData);
  const box=page.locator('#ck-records-feedback'),save=page.locator('#ck-records-feedback-save');
  assert.equal(await box.inputValue(),'不用写自述，直接说事实。');
  await box.fill('我的新建议');await page.evaluate(()=>ckRecordsRefresh());assert.equal(await box.inputValue(),'我的新建议');
  states.a.feedback_text='另一页面保存的建议';states.a.feedback_revision=2;
  await page.evaluate(()=>ckRecordsRefresh());assert.equal(await box.inputValue(),'我的新建议');
  await save.click();await page.waitForFunction(()=>!ckRecordsBusy);assert.equal(states.a.feedback_text,'另一页面保存的建议');
  assert((await page.locator('#ck-records-feedback-state').textContent()).includes('保存未完成'),JSON.stringify({state:await page.locator('#ck-records-feedback-state').textContent(),posts,errors}));assert.equal(await box.inputValue(),'我的新建议');
  await page.locator('.ck-records-feedback-saved summary').click();await page.locator('#ck-records-feedback-load').click();assert.equal(await box.inputValue(),'另一页面保存的建议');
  await box.fill('合并后的建议');delay=300;await save.click();await box.fill('提交期间继续写');await page.waitForFunction(()=>!ckRecordsBusy);delay=0;
  assert.equal(states.a.feedback_text,'合并后的建议');assert.equal(await box.inputValue(),'提交期间继续写');assert(await save.isEnabled());
  fail=true;await save.click();await page.waitForFunction(()=>!ckRecordsBusy);assert.equal(await box.inputValue(),'提交期间继续写');fail=false;
  await save.click();await page.waitForFunction(()=>!ckRecordsBusy);await page.reload();await page.waitForFunction(()=>!!ckRecordsData);assert.equal(await box.inputValue(),'提交期间继续写');
  const priorPosts=posts.length;await page.evaluate(()=>{fixtureKey='b';return ckRecordsFeedbackSave()});
  assert.equal(posts.length,priorPosts);assert.equal(await box.inputValue(),'乙的评价');
  await box.fill('乙的未保存意见');await page.evaluate(()=>{fixtureKey='a';return ckRecordsRefresh()});assert.equal(await box.inputValue(),'提交期间继续写');
  delay=200;await page.evaluate(()=>{void ckRecordsRefresh();fixtureKey='b';return ckRecordsRefresh()});await page.waitForFunction(()=>!ckRecordsBusy);delay=0;
  assert.notEqual(await box.inputValue(),'提交期间继续写');await page.evaluate(()=>ckRecordsRefresh());assert.equal(await box.inputValue(),'乙的未保存意见');
  states.b.feedback_learning={revision:1,at:1792230400,rules:[{rule:'直接写姓名和事实；一次性的闲聊不必长期保留。<img src=x onerror=alert(1)>'}]};
  await page.evaluate(()=>ckRecordsRefresh());assert.equal(await page.locator('#ck-records-feedback-learning img').count(),0);
  await box.fill('😀'.repeat(5001));assert(await save.isDisabled());assert((await page.locator('#ck-records-feedback-count').textContent()).includes('5001'));await box.fill('只保留值得长期记住的内容，写清楚具体事实。');
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'horizontal overflow');
  await page.locator('.ck-records-feedback-box').scrollIntoViewIfNeeded();await page.screenshot({path:path.join(out,'feedback-'+width+'.png'),fullPage:true});
  await page.evaluate(()=>document.body.classList.add('dark'));await page.screenshot({path:path.join(out,'feedback-dark-'+width+'.png'),fullPage:true});
  assert.deepEqual(errors,[]);await page.close();console.log(width+': save, reload, polling, conflicts, in-flight edits, failure, account isolation, escaping and layout PASS');
 }}finally{await browser.close();server.close()}
})().catch(error=>{console.error(error);server.close();process.exitCode=1});
