const {chromium}=require('playwright');
const fs=require('fs'),path=require('path'),http=require('http'),assert=require('assert');
const root=path.resolve(__dirname,'..'),out='/home/ckcodex/workspace/work/codex-message-jump-20261015';
const server=http.createServer((req,res)=>{const file=path.resolve(root,new URL(req.url,'http://local').pathname.slice(1)||'index.html');if(!file.startsWith(root+'/')||!fs.existsSync(file)||!fs.statSync(file).isFile()){res.writeHead(404);return res.end();}res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':file.endsWith('.json')?'application/json':'text/html');res.end(fs.readFileSync(file));});
(async()=>{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const browser=await chromium.launch({args:['--no-sandbox','--disable-dev-shm-usage']});
 try{for(const width of [320,390,1440]){
  const context=await browser.newContext({viewport:{width,height:900},serviceWorkers:'block'});
  await context.addInitScript(()=>{window.copied=[];Object.defineProperty(navigator,'clipboard',{value:{writeText:async text=>{window.copied.push(text);}}});localStorage.setItem('ck_codex_access','fixture-access');localStorage.setItem('ck_codex_endpoint','https://codex.test/codex');const vv=window.visualViewport;let h=innerHeight;Object.defineProperty(vv,'height',{get:()=>h});window.testKeyboard=height=>{h=height;vv.dispatchEvent(new Event('resize'));};});
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
  await page.locator('[data-window-id=two]').click({position:{x:2,y:6}});await page.locator('[data-item-id=other]').waitFor();await prev.click();await at('other');assert(await prev.isDisabled());assert(await next.isDisabled());
  await page.locator('[data-window-id=one]').click({position:{x:2,y:6}});await page.locator('[data-item-id=u4]').waitFor();await at('u4');assert.equal(await page.locator('#cx-input').inputValue(),'未发送草稿');await next.click();await at('u5');
  // A short final user message is clamped by the scroll boundary, yet the next click advances.
  records.one.push(message('u6','userMessage','第六条，末尾短消息'));await refresh();assert(!await next.isDisabled());await next.click();await at('u6');assert(await next.isDisabled());await prev.click();await at('u5');
  records.one.push(message('a6','agentMessage','后续输出\n'.repeat(15)));await refresh();await at('u5');
  await page.locator('#cx-question-nav').getByRole('button',{name:'回到提问',exact:true}).click();assert.equal(await page.locator('.cx-question-highlight').getAttribute('data-item-id'),'question');
  await page.waitForFunction(()=>!document.querySelector('.cx-user-highlight'));await next.click();await at('u6');
  // Controls stay inside the chat and clear when switching to an empty window.
  const geometry=await page.evaluate(()=>{const n=document.getElementById('cx-user-nav').getBoundingClientRect(),f=document.getElementById('cx-feed').getBoundingClientRect(),c=document.getElementById('cx-compose').getBoundingClientRect();return {left:n.left,right:n.right,feedRight:f.right,bottom:n.bottom,composeTop:c.top,overflow:document.documentElement.scrollWidth>innerWidth};});assert(geometry.left>=geometry.feedRight-1);assert(geometry.right<=width);assert(geometry.bottom<=geometry.composeTop);assert(!geometry.overflow);
  for(const dark of [false,true]){await page.evaluate(d=>document.body.classList.toggle('dark',d),dark);await page.screenshot({path:out+'/jump-'+width+(dark?'-dark':'')+'.png'});}
  if(width===390){await page.locator('#cx-input').focus();await page.evaluate(()=>window.testKeyboard(420));await page.waitForTimeout(80);assert(await prev.isVisible());const bottom=await next.evaluate(el=>el.getBoundingClientRect().bottom);assert(bottom<420);await page.evaluate(()=>window.testKeyboard(900));}
  await page.locator('[data-window-id=empty]').click({position:{x:2,y:6}});await page.locator('#cx-user-nav').waitFor({state:'hidden'});
  assert(!await page.locator('#cx-question-nav').isVisible());
  // Ordinary lists, quoted examples, code and the user's own question are not assistant questions.
  const example='any 同时请求 n 个窗口时，哪个时点选中胜出窗口并断开其余窗口？\n- 最先开始正常回复或执行的窗口胜出（推荐，尽早断开其余请求）\n- 最先完整完成任务的窗口胜出（其余窗口也可能已经执行相同操作）';
  records.empty.push(message('ordinary','agentMessage','执行步骤：\n- 检查现役\n- 验证修改\n\n```text\n'+example+'\n```\n> 哪个选项？\n> - 甲\n> - 乙'),message('user-example','userMessage',example));await refresh();
  assert(!await page.locator('#cx-question-nav').isVisible());assert.equal(await page.locator('.cx-text-question').count(),0);
  records.empty.push(message('choice','agentMessage','已确认当前设置。\n\n'+example+'\n\n请按偏好选择。'));await refresh();
  const box=page.locator('[data-item-id=choice] .cx-text-question');assert.equal(await box.count(),1);assert.equal(await box.locator('.cx-choice-row').count(),2);assert(await page.locator('#cx-question-nav').isVisible());
  await page.locator('#cx-input').fill('保留选择前的草稿');
  for(let n=0;n<2;n++){await box.locator('.cx-copy').nth(n).click();assert.equal(await page.evaluate(n=>window.copied[n],n),example.split('\n')[n+1].slice(2));}
  assert.equal(await page.locator('#cx-input').inputValue(),'保留选择前的草稿');
  await page.locator('#cx-feed').evaluate(e=>e.scrollTop=0);await page.locator('#cx-question-nav').getByRole('button',{name:'回到提问',exact:true}).click();assert(await box.evaluate(e=>e.classList.contains('cx-question-highlight')));
  for(const dark of [false,true]){await page.evaluate(d=>document.body.classList.toggle('dark',d),dark);assert.notEqual(await box.evaluate(e=>getComputedStyle(e).backgroundColor),'rgba(0, 0, 0, 0)');await page.screenshot({path:out+'/question-'+width+(dark?'-dark':'')+'.png'});}
  // A streamed choice becomes a question only after both options arrive; each keeps its own copy content.
  records.empty.push(message('stream','agentMessage','**使用哪一种方式？**\n1. 方式甲'));await refresh();assert.equal(await page.locator('.cx-text-question').count(),1);
  records.empty.at(-1).text+='\n2. 方式乙\n   保留附加说明';await refresh();assert.equal(await page.locator('.cx-text-question').count(),2);assert.equal(await page.locator('[data-item-id=stream] .cx-choice-row').count(),2);
  await page.locator('[data-item-id=stream] .cx-copy').last().click();assert.equal(await page.evaluate(()=>window.copied.at(-1)),'方式乙\n保留附加说明');
  await page.locator('#cx-question-nav').getByRole('button',{name:'回到提问',exact:true}).click();assert(await page.locator('[data-item-id=stream] .cx-text-question').evaluate(e=>e.classList.contains('cx-question-highlight')));
  records.empty.at(-1).text='提问已改为普通执行说明。';records.empty.find(r=>r.id==='choice').text='普通答复，没有选项。';await refresh();assert(!await page.locator('#cx-question-nav').isVisible());
  await page.locator('#cx-exit').click();assert(!await prev.isVisible());assert.deepEqual(posts,[]);assert.deepEqual(errors,[]);
  console.log(width+': message order, rapid clicks, boundaries, long/short messages, manual scroll, live updates, window cache, drafts, native/text question detection, individual option copy, conditional navigation, layout PASS');await context.close();
 }}finally{await browser.close();server.close();}
})().catch(e=>{console.error(e);server.close();process.exitCode=1;});
