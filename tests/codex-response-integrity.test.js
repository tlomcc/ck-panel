const {chromium}=require('playwright');
const fs=require('fs'),path=require('path'),http=require('http'),assert=require('assert');
const root=process.env.CK_TEST_PANEL_ROOT||path.resolve(__dirname,'..');
const server=http.createServer((req,res)=>{
  const file=path.resolve(root,new URL(req.url,'http://local').pathname.slice(1)||'index.html');
  if(!file.startsWith(root+'/')||!fs.existsSync(file)||!fs.statSync(file).isFile()){res.writeHead(404);return res.end();}
  res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':file.endsWith('.json')?'application/json':'text/html');res.end(fs.readFileSync(file));
});
(async()=>{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const browser=await chromium.launch({args:['--no-sandbox','--disable-dev-shm-usage']});
 try{for(const width of [390,1280]){
  const context=await browser.newContext({viewport:{width,height:900},serviceWorkers:'block'});
  await context.addInitScript(()=>{
   localStorage.setItem('ck_codex_access','fixture');localStorage.setItem('ck_codex_endpoint','https://codex.test/codex');localStorage.setItem('ck_codex_selected','run');
   const original=window.fetch;
   window.__readFailure=null;
   window.fetch=async function(url,options){
    const response=await original(url,options),fault=window.__readFailure;
    if(fault&&String(url).includes(fault.path)){
     // Headers arrived, then reading the body failed: fetch itself has already succeeded.
     return {ok:response.ok,status:response.status,json:async()=>{
      if(fault.mode==='abort')throw new DOMException('The operation was aborted.','AbortError');
      if(fault.mode==='network')throw new TypeError('Failed to fetch');
      if(fault.mode==='truncated')throw new SyntaxError('Unexpected end of JSON input');
      return fault.value;
     }};
    }
    return response;
   };
  });
  const page=await context.newPage(),errors=[],requests=[],posts=[];
  page.on('pageerror',e=>errors.push(e.message));
  const w={id:'run',title:'保留任务',profile:'p',status:'running',error:'',seq:5,updated:1};
  await page.route('**/*',async route=>{
   const req=route.request(),url=new URL(req.url());if(url.hostname==='127.0.0.1')return route.continue();if(url.hostname!=='codex.test')return route.abort();
   requests.push(url.pathname+url.search);if(req.method()==='POST')posts.push(url.pathname);
   const cfg={profiles:[{id:'p',name:'测试供应商',model:'fixture',effort:'high'}],default_profile:'p'};
   const value=url.pathname.endsWith('/config')?cfg:url.pathname.endsWith('/threads')?{windows:[w]}:{window:w,cursor:w.seq,schedules:[],items:[{id:'saved',kind:'agentMessage',text:'已经收到的完整记录',seq:5,created:1,data:{}}]};
   await route.fulfill({json:value});
  });
  await page.goto('http://127.0.0.1:'+server.address().port+'/#codex-tasks');await page.getByText('已经收到的完整记录',{exact:true}).waitFor();
  await page.locator('#cx-input').fill('未发送草稿');
  const cases=[
   {path:'/config',mode:'abort'},
   {path:'/config',mode:'truncated'},
   {path:'/config',mode:'shape',value:{}},
   {path:'/threads/run',mode:'abort'},
   {path:'/threads/run',mode:'network'},
   {path:'/threads/run',mode:'truncated'},
   {path:'/threads/run',mode:'shape',value:{}},
   {path:'/threads/run',mode:'shape',value:{window:w,cursor:'undefined',items:[]}},
   {path:'/threads/run',mode:'shape',value:{window:{...w,id:'other'},cursor:6,items:[]}},
   {path:'/threads/run',mode:'shape',value:{window:w,cursor:6,items:[null]}},
   {path:'/threads',mode:'shape',value:{windows:[null]}},
  ];
  for(const fault of cases.filter(f=>!process.env.CK_TEST_FAULT||f.path+':'+f.mode===process.env.CK_TEST_FAULT)){
   const start=requests.length;await page.evaluate(f=>{window.__readFailure=f;},fault);
   await page.evaluate(()=>window.ckOpenCodex('tasks'));
   await page.waitForTimeout(1000);
   const banner=await page.locator('#cx-message').innerText();
   console.log(JSON.stringify({width,fault:fault.path+':'+fault.mode,banner,errors:errors.slice(),requests:requests.slice(start)}));
   assert(!/Cannot read properties/.test(banner),'invalid response must not become application state');
   assert(!requests.slice(start).some(p=>/after=(undefined|NaN|null)/.test(p)),'cursor must stay valid');
   assert.equal(await page.getByText('已经收到的完整记录',{exact:true}).count(),1);assert.equal(await page.locator('#cx-input').inputValue(),'未发送草稿');
   await page.evaluate(()=>{window.__readFailure=null;});
   // Automatic recovery must work without reloading or re-sending the task.
   await page.waitForFunction(()=>document.getElementById('cx-connection').dataset.state==='ok'&&document.getElementById('cx-message').textContent==='',null,{timeout:5000});
  }
  assert.deepEqual(posts,[]);assert.deepEqual(errors,[]);
  console.log(width+': body abort, network interruption, truncated JSON, invalid shapes, retained records/draft/cursor, automatic recovery PASS');
  await context.close();
 }}finally{await browser.close();server.close();}
})().catch(e=>{console.error(e);server.close();process.exitCode=1;});
