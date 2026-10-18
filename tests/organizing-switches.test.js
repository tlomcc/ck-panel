const {chromium}=require('playwright');
const fs=require('fs'),path=require('path'),http=require('http'),assert=require('assert');
const root=path.resolve(__dirname,'..'),out=path.resolve(root,'../screenshots');fs.mkdirSync(out,{recursive:true});
const markup=fs.readFileSync(path.join(root,'index.html'),'utf8').match(/<div id="ck-organizing-control"[\s\S]*?(?=\n<div id="ck-status-fact")/)[0];
let states={fact:false,topics:false,events:false,records:false},posts=[],failure=false,delay=0;
const server=http.createServer(async(req,res)=>{
 const url=new URL(req.url,'http://fixture');
 if(url.pathname==='/fixture'){
  res.setHeader('Content-Type','text/html');return res.end('<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><link rel="stylesheet" href="tokens.css"><link rel="stylesheet" href="maintenance.css"><style>body{margin:16px;font-family:sans-serif;background:var(--ck-surface);color:var(--ck-text)}main{max-width:960px;margin:auto}</style><main><h2>运行状态</h2>'+markup+'</main><script>var ckStatusTab="fact",currentPanelTab="status",GRAPH_API_BASE=location.origin,key="a";function storedPanelKey(){return key}function chatLoadConfig(){return {panelKey:key}}function chatEndpoint(){return location.origin+"/chat"}function panelDataFetch(fn,options){return fetch(fn(key),options)}function loadDailyStatus(){}function ckRefreshMaintenance(){}function ckRecordsRefresh(){}</script><script src="organizing-switches.js"></script><script>ckOrganizingEnter()</script></html>');
 }
 const section=url.pathname==='/ck/fact-control'?'fact':url.pathname==='/ck/event-automation'?'events':url.pathname==='/daily-records'?'records':url.pathname.startsWith('/ck/')?'topics':null;
 if(section){
  if(failure){res.writeHead(503,{'Content-Type':'application/json'});return res.end(JSON.stringify({ok:false,error:'测试连接失败'}))}
  if(req.method==='POST'){
   let raw='';for await(const c of req)raw+=c;const body=JSON.parse(raw);posts.push({section,body});
   states[section]=section==='fact'?body.enabled:['resume','organizer_start'].includes(body.action);
  }
  const enabled=states[section],payload=section==='topics'?(req.method==='POST'?{organizer:{settings:{enabled}},revision:7}:{overview:{settings:{enabled}},revision:6}):section==='events'?{control:{enabled}}:{enabled,revision:3};
  if(delay)await new Promise(r=>setTimeout(r,delay));res.setHeader('Content-Type','application/json');return res.end(JSON.stringify({ok:true,...payload}));
 }
 const file=path.join(root,url.pathname);if(!file.startsWith(root)||!fs.existsSync(file)){res.writeHead(404);return res.end()}
 res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':'text/css');res.end(fs.readFileSync(file));
});
(async()=>{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const browser=await chromium.launch({headless:true});
 try{
  const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://127.0.0.1:'+server.address().port+'/fixture');
  const toggle=page.locator('#ck-organizing-toggle');await page.waitForFunction(()=>!document.querySelector('#ck-organizing-toggle').disabled);
  for(const section of Object.keys(states)){
   await page.evaluate(s=>{ckStatusTab=s;ckOrganizingEnter()},section);await page.waitForFunction(()=>!document.querySelector('#ck-organizing-toggle').disabled);
   assert.equal(await toggle.getAttribute('aria-checked'),'false');await toggle.click();await page.waitForFunction(()=>document.querySelector('#ck-organizing-toggle').getAttribute('aria-checked')==='true'&&!document.querySelector('#ck-organizing-toggle').disabled);
   await toggle.press('Space');await page.waitForFunction(()=>document.querySelector('#ck-organizing-toggle').getAttribute('aria-checked')==='false'&&!document.querySelector('#ck-organizing-toggle').disabled);
  }
  assert.equal(posts.length,8);assert.equal(posts[2].body.expected_revision,6);assert.equal(posts[0].body.revision,3);
  for(const width of [320,390,1280]){
   await page.setViewportSize({width,height:700});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
   await page.screenshot({path:path.join(out,'switch-'+width+'.png')});
  }
  await page.evaluate(()=>{ckStatusTab='digest';ckOrganizingEnter()});assert(await page.locator('#ck-organizing-control').isHidden());
  failure=true;await page.evaluate(()=>{ckStatusTab='events';ckOrganizingEnter()});await page.waitForFunction(()=>document.querySelector('#ck-organizing-note').textContent.includes('测试连接失败'));assert(await toggle.isDisabled());failure=false;
  delay=200;await page.evaluate(()=>{ckStatusTab='fact';ckOrganizingEnter();ckStatusTab='topics';ckOrganizingEnter()});await page.waitForFunction(()=>!document.querySelector('#ck-organizing-toggle').disabled);assert.equal(await toggle.getAttribute('aria-label'),'主题整理');
  await page.evaluate(()=>{key='b';ckOrganizingEnter()});assert(await toggle.isDisabled());await page.waitForFunction(()=>!document.querySelector('#ck-organizing-toggle').disabled);
  assert.deepEqual(errors,[]);console.log('PASS: four durable switches, keyboard, refresh, failure, stale replies, principal change, 320/390/1280 layouts');
 }finally{await browser.close();server.close()}
})().catch(e=>{console.error(e);server.close();process.exitCode=1});
