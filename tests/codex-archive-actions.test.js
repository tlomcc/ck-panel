const {chromium}=require('playwright');
const fs=require('fs'),path=require('path'),http=require('http'),assert=require('assert');
const root=path.resolve(__dirname,'..'),out=process.env.CX_TEST_OUT||'/home/ckcodex/workspace/work/codex-opaque-seen-20261015';
const server=http.createServer((req,res)=>{const file=path.resolve(root,new URL(req.url,'http://local').pathname.slice(1)||'index.html');if(!file.startsWith(root+'/')||!fs.existsSync(file)||!fs.statSync(file).isFile()){res.writeHead(404);return res.end();}res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':file.endsWith('.json')?'application/json':'text/html');res.end(fs.readFileSync(file));});
(async()=>{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const browser=await chromium.launch({args:['--no-sandbox','--disable-dev-shm-usage']});
 try{for(const width of [390,1440]){
  const context=await browser.newContext({viewport:{width,height:900},serviceWorkers:'block'});
  await context.addInitScript(()=>{localStorage.setItem('ck_codex_access','fixture');localStorage.setItem('ck_codex_endpoint','https://codex.test/codex');localStorage.setItem('ck_codex_selected','run');for(const id of ['a','b','c','d','scheduled'])localStorage.setItem('ck_codex_seen_'+encodeURIComponent('https://codex.test/codex')+'_'+id,'1');});
  const page=await context.newPage(),errors=[],posts=[],reads=[];page.on('pageerror',e=>errors.push(e.message));
  let rows=[['run','运行中','running'],['a','完成甲','completed'],['b','完成乙','completed'],['c','完成丙','completed'],['d','完成丁','completed'],['unread','未查看','completed'],['bad','异常','failed'],['scheduled','还有定时','completed'],['closed','已关闭','closed']].map(([id,title,status],i)=>({id,title,status,profile:'p',thread_id:id,seq:1,created:i+1,updated:100,error:id==='bad'?'失败':'',scheduled_count:id==='scheduled'?1:0}));
  let failDelete='',records=[{id:'plain',kind:'agentMessage',text:'普通回复',created:1,data:{}}];
  const get=id=>rows.find(w=>w.id===id);
  await page.route('**/*',async route=>{
   const req=route.request(),u=new URL(req.url());if(u.hostname==='127.0.0.1')return route.continue();if(u.hostname!=='codex.test')return route.abort();
   let result={};if(req.method()==='POST')posts.push(u.pathname);
   if(u.pathname.endsWith('/config'))result={profiles:[{id:'p',name:'测试供应商',model:'fixture',effort:'high',has_key:true}],default_profile:'p',workspace:'/workspace',scheduling:true};
   else if(u.pathname.endsWith('/threads'))result={windows:rows};
   else {const id=u.pathname.split('/')[3];if(u.pathname.endsWith('/delete')){if(id===failDelete)return route.fulfill({status:503,json:{error:'删除暂时失败'}});rows=rows.filter(w=>w.id!==id);result={deleted:true,id};}else {reads.push(id);result={window:{...get(id)},cursor:get(id).seq,items:records,schedules:[]};}}
   await route.fulfill({json:result});
  });
  const menu=async()=>{if(width<=640&&!await page.locator('#cx-window-sidebar').isVisible())await page.locator('#cx-window-toggle').click();};
  const sync=async()=>{await page.evaluate(()=>window.dispatchEvent(new Event('online')));await page.waitForTimeout(160);};
  const confirm=async()=>{await page.locator('dialog[open]').getByRole('button',{name:'删除窗口',exact:true}).click();};
  const row=id=>page.locator('#cx-windows .cx-window[data-window-id="'+id+'"]');
  const remove=id=>page.getByRole('button',{name:'删除已完成窗口：'+get(id).title,exact:true});
  await page.goto('http://127.0.0.1:'+server.address().port+'/#codex-tasks');await page.getByText('普通回复',{exact:true}).waitFor();await menu();
  assert.equal(await page.locator('.cx-delete-archived').count(),4);
  await remove('a').click();await page.locator('dialog[open]').getByRole('button',{name:'取消',exact:true}).click();assert.deepEqual(posts,[]);
  const beforeReads=reads.length;await remove('a').click();await confirm();await row('a').waitFor({state:'detached'});await page.getByText('已删除 1 个完成窗口',{exact:true}).waitFor();assert.equal(await page.locator('#cx-window-title').textContent(),'运行中');assert(!reads.slice(beforeReads).includes('a'));assert.equal(await page.evaluate(()=>localStorage.getItem('ck_codex_selected')),'run');
  failDelete='b';await page.locator('#cx-delete-completed').click();get('c').status='running';get('c').seq++;
  await confirm();await page.getByText(/已删除 1 个完成窗口；1 个状态已变化.*1 个未删除/).waitFor();assert(get('b')&&get('c')&&!get('d'));assert(await row('b').isVisible());assert(!posts.includes('/codex/threads/c/delete'));assert(!posts.includes('/codex/threads/unread/delete'));assert(!posts.includes('/codex/threads/scheduled/delete'));assert(!posts.includes('/codex/threads/bad/delete'));assert(!posts.includes('/codex/threads/closed/delete'));
  failDelete='';await remove('b').click();await confirm();await page.getByText('已删除 1 个完成窗口',{exact:true}).waitFor();
  for(const id of ['e','f'])rows.push({id,title:'完成'+id,status:'completed',profile:'p',seq:1,created:20,updated:1,scheduled_count:0});
  await page.evaluate(()=>{for(const id of ['e','f'])localStorage.setItem('ck_codex_seen_'+encodeURIComponent('https://codex.test/codex')+'_'+id,'1');});await sync();await row('e').click();await menu();assert.equal(await row('e').getAttribute('aria-current'),'page');assert.equal(await page.locator('.cx-task-notice[aria-current=page]').count(),0);
  await page.locator('#cx-delete-completed').click();await confirm();await page.getByText('已删除 2 个完成窗口',{exact:true}).waitFor();assert(!get('e')&&!get('f'));assert.equal(await page.locator('#cx-window-title').textContent(),'运行中');assert.equal(await page.locator('.cx-task-notice[aria-current=page]').getAttribute('data-window-id'),'run');assert.equal(await page.evaluate(()=>localStorage.getItem('ck_codex_selected')),'run');
  // Exercise real message rendering and hit testing where cards overlap the task rail.
  if(width<=640)await page.locator('#cx-window-title').click();
  for(let i=0;i<28;i++)rows.push({id:'extra'+i,title:'任务'+i,status:'running',profile:'p',seq:1,created:30+i,updated:1});
  records=[{id:'user',kind:'userMessage',text:'这是用户发送的信息，需要保持可见。',created:1,data:{}},{id:'native-question',kind:'resolved',text:'',created:1,data:{method:'item/tool/requestUserInput',params:{questions:[{id:'q',question:'请选择处理方式',options:[{label:'继续',description:'保留已有结果'}]}]}}},{id:'text-question',kind:'agentMessage',text:'请选择一个方案？\nA. 第一种处理\nB. 第二种处理',created:1,data:{}},{id:'plain-after',kind:'agentMessage',text:'普通执行输出仍在浮动窗口下方。\n'.repeat(12),created:1,data:{}}];get('run').seq++;
  await page.evaluate(()=>document.getElementById('cx-refresh').click());await page.locator('[data-item-id=user]').waitFor();
  const hitAbove=async selector=>{const result=await page.locator(selector).evaluate(el=>{el.scrollIntoView({block:'start'});const a=el.getBoundingClientRect(),r=document.getElementById('cx-task-notices').getBoundingClientRect(),f=document.getElementById('cx-feed').getBoundingClientRect();const x=Math.max(a.left,r.left,f.left)+12,y=Math.max(a.top,r.top,f.top)+12;return {overlap:x<Math.min(a.right,r.right)&&y<Math.min(a.bottom,r.bottom,f.bottom),hit:el.contains(document.elementFromPoint(x,y))};});assert(result.overlap&&result.hit,selector+JSON.stringify(result));};
  for(const selector of ['[data-item-id=user]','[data-item-id=native-question]','.cx-text-question'])await hitAbove(selector);
  await page.screenshot({path:out+'/priority-'+width+'.png'});
  await page.locator('[data-item-id=plain-after]').evaluate(el=>el.scrollIntoView({block:'start'}));
  assert(await page.locator('[data-item-id=plain-after]').evaluate(el=>{const a=el.getBoundingClientRect(),rail=document.getElementById('cx-task-notices'),r=rail.getBoundingClientRect();return rail.contains(document.elementFromPoint(Math.max(a.x,r.x)+18,Math.max(a.y,r.y)+44));}));
  assert(await page.locator('#cx-compose').evaluate(el=>{const r=el.getBoundingClientRect();return el.contains(document.elementFromPoint(r.x+20,r.y+20));}));
  records.push({id:'pending-question',kind:'request',text:'',created:1,data:{id:'pending',method:'item/tool/requestUserInput',params:{questions:[{id:'pending-choice',question:'底部待回复问题必须可以操作',options:[{label:'保留',description:'继续保留记录'},{label:'查看',description:'先查看结果'}]}]}}});get('run').seq++;await page.evaluate(()=>document.getElementById('cx-refresh').click());await page.locator('#cx-pending .cx-question').waitFor();
  assert(await page.locator('#cx-pending .cx-question').evaluate(el=>{const r=el.getBoundingClientRect(),rail=document.getElementById('cx-task-notices').getBoundingClientRect(),x=Math.max(r.x,rail.x)+20,y=r.y+20;return y<rail.bottom&&el.contains(document.elementFromPoint(x,y));}));await page.locator('#cx-pending .cx-answer-option').first().click();assert.equal(await page.locator('#cx-pending .cx-answer-option').first().getAttribute('aria-pressed'),'true');
  await page.evaluate(()=>document.body.classList.add('dark'));await page.screenshot({path:out+'/priority-pending-'+width+'-dark.png'});
  await menu();assert(await page.locator('#cx-tab-api').evaluate(el=>{const r=el.getBoundingClientRect();return el.contains(document.elementFromPoint(r.x+10,r.y+10));}));
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));assert.deepEqual(errors,[]);
  console.log(width+': direct delete/cancel, batch scope, partial failure, changed status skip, current selection cleanup, user/native/text question priority, ordinary output and menu layering PASS');await context.close();
 }}finally{await browser.close();server.close();}
})().catch(e=>{console.error(e);server.close();process.exitCode=1;});
