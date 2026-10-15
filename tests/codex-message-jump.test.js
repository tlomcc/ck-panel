const {chromium}=require('playwright');
const fs=require('fs'),path=require('path'),http=require('http'),assert=require('assert');
const root=path.resolve(__dirname,'..'),out='/home/ckcodex/workspace/work/codex-message-jump-20261015';
const server=http.createServer((req,res)=>{const file=path.resolve(root,new URL(req.url,'http://local').pathname.slice(1)||'index.html');if(!file.startsWith(root+'/')||!fs.existsSync(file)||!fs.statSync(file).isFile()){res.writeHead(404);return res.end();}res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':file.endsWith('.json')?'application/json':'text/html');res.end(fs.readFileSync(file));});
(async()=>{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const browser=await chromium.launch({args:['--no-sandbox','--disable-dev-shm-usage']});
 try{for(const width of [320,390,1440]){
  const context=await browser.newContext({viewport:{width,height:900},serviceWorkers:'block'});
  await context.addInitScript(()=>{localStorage.setItem('ck_codex_access','fixture-access');localStorage.setItem('ck_codex_endpoint','https://codex.test/codex');const vv=window.visualViewport;let h=innerHeight;Object.defineProperty(vv,'height',{get:()=>h});window.testKeyboard=height=>{h=height;vv.dispatchEvent(new Event('resize'));};});
  const page=await context.newPage(),errors=[],posts=[];page.on('pageerror',e=>errors.push(e.message));
  let seq=1;
  const windows=['one','two','empty'].map((id,i)=>({id,title:'任务'+(i+1),profile:'p',status:'running',thread_id:id,updated:1}));
  const message=(id,kind,text)=>({id,kind,text,created:1,data:{}});
  const records={one:[],two:[message('other','userMessage','另一个窗口的用户消息')],empty:[]};
  for(let i=1;i<=5;i++)records.one.push(message('u'+i,'userMessage','用户消息 '+i+'\n'+(i===3?'长消息内容\n'.repeat(55):'')),message('a'+i,'agentMessage','助手回复 '+i+'\n'+'执行进度与说明\n'.repeat(30)));
  records.one.push({id:'question',kind:'resolved',created:1,text:'',data:{method:'item/tool/requestUserInput',params:{questions:[{id:'q',question:'已回答的原生提问',options:[]}]}}});
  await page.route('https://codex.test/codex/**',async route=>{
   const req=route.request(),url=new URL(req.url());if(req.method()==='POST')posts.push(url.pathname);let result={};
   if(url.pathname.endsWith('/config'))result={profiles:[{id:'p',name:'测试供应商',model:'test-model',effort:'high',base_url:'https://model.test/v1',has_key:true}],default_profile:'p',workspace:'/workspace'};
   else if(url.pathname.endsWith('/threads'))result={windows};
   else if(url.pathname.includes('/threads/')){const id=url.pathname.split('/')[3];result={window:windows.find(w=>w.id===id),items:records[id],cursor:seq,schedules:[]};}
   await route.fulfill({json:result});
  });
  await page.goto('http://127.0.0.1:'+server.address().port+'/#codex-tasks');await page.locator('[data-item-id=u5]').waitFor();
  const prev=page.getByRole('button',{name:'上一条用户消息',exact:true}),next=page.getByRole('button',{name:'下一条用户消息',exact:true});
  const at=async id=>assert.equal(await page.locator('.cx-user-highlight').getAttribute('data-item-id'),id);
  const refresh=async()=>{seq++;await page.evaluate(()=>document.getElementById('cx-refresh').click());await page.waitForFunction(()=>document.getElementById('cx-refresh').textContent==='已刷新');};
  // From the latest output, every click targets exactly one earlier user message.
  await prev.click();await at('u5');assert(await next.isDisabled());
  await page.evaluate(()=>{document.getElementById('cx-user-prev').click();document.getElementById('cx-user-prev').click();});await at('u3');
  assert.equal(await page.locator('#cx-user-position').textContent(),'3 / 5');
  let offset=await page.locator('[data-item-id=u3]').evaluate(el=>el.getBoundingClientRect().top-document.getElementById('cx-feed').getBoundingClientRect().top);assert(offset>=14&&offset<=25);
  await prev.click();await at('u2');await prev.click();await at('u1');assert(await prev.isDisabled());
  await next.click();await at('u2');
  // Refreshes and output above/below the target preserve the selected message.
  records.one[1].text+='more output\n'.repeat(20);records.one[9].text+='new streamed output\n'.repeat(20);await refresh();await at('u2');
  offset=await page.locator('[data-item-id=u2]').evaluate(el=>el.getBoundingClientRect().top-document.getElementById('cx-feed').getBoundingClientRect().top);assert(offset>=14&&offset<=25);
  // A manual scroll re-bases navigation on the visible position instead of the old target.
  await page.locator('[data-item-id=a3]').evaluate(el=>{const f=document.getElementById('cx-feed');f.scrollTop+=el.getBoundingClientRect().top-f.getBoundingClientRect().top+80;});
  await page.waitForFunction(()=>!document.querySelector('.cx-user-highlight'));await next.click();await at('u4');
  await page.locator('#cx-input').fill('未发送草稿');
  await page.locator('[data-window-id=two]').click();await page.locator('[data-item-id=other]').waitFor();await prev.click();await at('other');assert(await prev.isDisabled());assert(await next.isDisabled());
  await page.locator('[data-window-id=one]').click();await page.locator('[data-item-id=u4]').waitFor();await at('u4');assert.equal(await page.locator('#cx-input').inputValue(),'未发送草稿');await next.click();await at('u5');
  // A short final user message is clamped by the scroll boundary, yet the next click advances.
  records.one.push(message('u6','userMessage','第六条，末尾短消息'));await refresh();assert(!await next.isDisabled());await next.click();await at('u6');assert(await next.isDisabled());await prev.click();await at('u5');
  records.one.push(message('a6','agentMessage','后续输出\n'.repeat(15)));await refresh();await at('u5');
  await page.locator('#cx-question-nav').getByRole('button',{name:'回到提问',exact:true}).click();assert.equal(await page.locator('.cx-question-highlight').getAttribute('data-item-id'),'question');
  await page.waitForFunction(()=>!document.querySelector('.cx-user-highlight'));await next.click();await at('u6');
  // Controls stay inside the chat and clear when switching to an empty window.
  const geometry=await page.evaluate(()=>{const n=document.getElementById('cx-user-nav').getBoundingClientRect(),f=document.getElementById('cx-feed').getBoundingClientRect(),c=document.getElementById('cx-compose').getBoundingClientRect();return {left:n.left,right:n.right,feedRight:f.right,bottom:n.bottom,composeTop:c.top,overflow:document.documentElement.scrollWidth>innerWidth};});assert(geometry.left>=geometry.feedRight-1);assert(geometry.right<=width);assert(geometry.bottom<=geometry.composeTop);assert(!geometry.overflow);
  for(const dark of [false,true]){await page.evaluate(d=>document.body.classList.toggle('dark',d),dark);await page.screenshot({path:out+'/jump-'+width+(dark?'-dark':'')+'.png'});}
  if(width===390){await page.locator('#cx-input').focus();await page.evaluate(()=>window.testKeyboard(420));await page.waitForTimeout(80);assert(await prev.isVisible());const bottom=await next.evaluate(el=>el.getBoundingClientRect().bottom);assert(bottom<420);await page.evaluate(()=>window.testKeyboard(900));}
  await page.locator('[data-window-id=empty]').click();await page.locator('#cx-user-nav').waitFor({state:'hidden'});
  await page.locator('#cx-exit').click();assert(!await prev.isVisible());assert.deepEqual(posts,[]);assert.deepEqual(errors,[]);
  console.log(width+': message order, rapid clicks, boundaries, long/short messages, manual scroll, live updates, window cache, drafts, question navigation, layout PASS');await context.close();
 }}finally{await browser.close();server.close();}
})().catch(e=>{console.error(e);server.close();process.exitCode=1;});
