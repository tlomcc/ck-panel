const {chromium}=require('playwright');
const fs=require('fs'),path=require('path'),http=require('http'),assert=require('assert');
const root=path.resolve(__dirname,'..');
const server=http.createServer((req,res)=>{const name=new URL(req.url,'http://local').pathname.slice(1)||'index.html',file=path.resolve(root,name);if(!file.startsWith(root+'/')||!fs.existsSync(file)||!fs.statSync(file).isFile()){res.writeHead(404);return res.end();}res.setHeader('Content-Type',name.endsWith('.js')?'text/javascript':name.endsWith('.css')?'text/css':name.endsWith('.json')?'application/json':'text/html');res.end(fs.readFileSync(file));});
(async()=>{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const browser=await chromium.launch({args:['--no-sandbox','--disable-dev-shm-usage']});
 try{for(const width of [390,1440]){
  const context=await browser.newContext({viewport:{width,height:1000},serviceWorkers:'block'});
  await context.addInitScript(()=>{localStorage.setItem('ck_codex_access','fixture-access');localStorage.setItem('ck_codex_endpoint','https://codex.test/codex');window.copied=[];Object.defineProperty(navigator,'clipboard',{value:{writeText:async text=>{await new Promise(r=>setTimeout(r,80));if(window.copyFail)throw Error('denied');window.copied.push(text);}}});});
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  let windows=[{id:'one',title:'任务1',profile:'p',thread_id:'native',status:'running',updated:1},{id:'two',title:'任务2',profile:'p',thread_id:'other',status:'completed',updated:1}],seq=1,fail=false,delay=0,requests=[],posted=[],created=[];
  const q=(id,label)=>({id,kind:'request',seq:seq++,text:'',created:10,data:{id,method:'item/tool/requestUserInput',params:{questions:[{id:'scope',question:label,options:[{label:'仅本次',description:'只处理当前任务'},{label:'全部窗口',description:'包括其它窗口'}]}]}}});
  const base=[{id:'u',kind:'userMessage',text:'检查任务并保留已完成操作。',created:1,data:{}},{id:'a',kind:'agentMessage',text:'开始检查。\n'.repeat(70),created:2,data:{}},{id:'cmd',kind:'commandExecution',text:'complete command output',created:3,data:{command:'check status'}}];
  await page.route('https://codex.test/codex/**',async route=>{
   const url=new URL(route.request().url()),body=route.request().postDataJSON();let result={};
   if(delay)await new Promise(r=>setTimeout(r,delay));if(fail)return route.fulfill({status:503,json:{error:'temporary connection failure'}});
   if(url.pathname.endsWith('/config'))result={profiles:[{id:'p',name:'供应商A',model:'model-a',effort:'high',base_url:'https://a.test/v1',has_key:true},{id:'q',name:'供应商B',model:'model-b',effort:'high',base_url:'https://b.test/v1',has_key:true}],default_profile:'p',efforts:['high','xhigh'],workspace:'/workspace'};
   else if(url.pathname.endsWith('/threads')&&body){created.push(body);const w={...windows[0],id:'new'+created.length,title:body.title,status:'idle',error:''};windows.unshift(w);result=w;}
   else if(url.pathname.endsWith('/threads'))result={windows};
   else if(url.pathname.endsWith('/answer')){posted.push(body);requests=requests.map(r=>r.id===body.request_id?{...r,kind:'resolved',seq:seq++}:r);windows[1].status=requests.some(r=>r.kind==='request')?'waiting':'running';}
   else if(url.pathname.includes('/threads/')){const id=url.pathname.split('/')[3];result={window:windows.find(w=>w.id===id),items:base.concat(id==='two'?requests:[]),cursor:seq++};}
   await route.fulfill({json:result});
  });
  await page.goto('http://127.0.0.1:'+server.address().port+'/#codex-tasks');await page.locator('.cx-item-agentMessage').waitFor();
  const refresh=async()=>{await page.locator('#cx-refresh').click();await page.waitForFunction(()=>document.getElementById('cx-refresh').textContent==='已刷新');};
  assert.equal(await page.locator('.cx-task-status').textContent(),'正常运行');
  for(const dark of [false,true]){await page.evaluate(d=>document.body.classList.toggle('dark',d),dark);assert.equal(await page.locator('.cx-task-status').evaluate(e=>getComputedStyle(e).color),await page.locator('#cx-root').evaluate(e=>getComputedStyle(e).getPropertyValue('--ck-accent-strong').trim()).then(hex=>{const n=parseInt(hex.slice(1),16);return `rgb(${n>>16}, ${(n>>8)&255}, ${n&255})`;}));}
  const positions=await page.evaluate(()=>['.cx-item-userMessage .cx-text','.cx-item-agentMessage .cx-text'].map(s=>document.querySelector(s).getBoundingClientRect().left));assert(Math.abs(positions[0]-positions[1])<1);
  if(width<640){await page.locator('#cx-window-toggle').click();await page.locator('#cx-search').fill('任务');assert(await page.locator('#cx-window-sidebar').isVisible());await page.locator('#cx-window-title').click();assert.equal(await page.locator('#cx-window-sidebar').isVisible(),false);assert.equal(await page.locator('#cx-window-toggle').getAttribute('aria-expanded'),'false');}
  await page.locator('.cx-window-menu summary').click();await page.locator('#cx-window-title').click();assert.equal(await page.locator('.cx-window-menu').getAttribute('open'),null);
  await page.locator('.cx-window-menu summary').click();await page.locator('#cx-rename').click();await page.locator('dialog[open]').waitFor();await page.locator('dialog input').fill('草稿名字');await page.mouse.click(3,3);await page.locator('dialog').waitFor({state:'detached'});assert.equal(windows[0].title,'任务1');
  await page.locator('.cx-detail summary').click();assert.equal(await page.locator('.cx-detail').getAttribute('open'),'');await page.locator('#cx-window-title').click();assert.equal(await page.locator('.cx-detail').getAttribute('open'),null);
  const copy=page.locator('.cx-item-userMessage .cx-copy');await copy.click();await page.waitForFunction(()=>window.copied.length===1);assert.equal(await copy.textContent(),'已复制');
  await page.evaluate(()=>window.copyFail=true);await copy.click();base[0].text='更新中的任务文字';await refresh();await page.waitForFunction(()=>document.querySelector('.cx-item-userMessage .cx-copy').textContent==='复制失败');await page.evaluate(()=>window.copyFail=false);
  delay=160;await page.locator('#cx-refresh').click();assert.equal(await page.locator('#cx-refresh').textContent(),'刷新中…');assert(await page.locator('#cx-refresh').isDisabled());await page.waitForFunction(()=>document.getElementById('cx-refresh').textContent==='已刷新');delay=0;
  fail=true;await page.locator('#cx-refresh').click();await page.waitForFunction(()=>document.getElementById('cx-refresh').textContent==='刷新失败');fail=false;
  windows[0].error='provider failed';await refresh();assert.equal(await page.locator('.cx-task-status').textContent(),'运行出错');assert.equal(await page.locator('.cx-task-status').getAttribute('data-status'),'error');assert(await page.locator('#cx-stop').isVisible());
  base.push({id:'err1',kind:'error',text:'rate limit exceeded',created:20,data:{}});await refresh();
  assert((await page.locator('.cx-item-error').innerText()).includes('rate limit exceeded'));
  assert(!(await page.locator('#cx-message').innerText()).includes('provider failed'));
  assert.equal(await page.locator('#cx-other-errors').isVisible(),false);
  windows[1].error='另一窗口限流';windows[1].status='running';await refresh();
  assert((await page.locator('#cx-other-errors').innerText()).includes('任务2：另一窗口限流'));
  windows[1].error='';await refresh();assert.equal(await page.locator('#cx-other-errors').isVisible(),false);
  base.push({id:'recovered',kind:'agentMessage',text:'已经恢复，继续处理。',created:21,data:{}});windows[0].error='';await refresh();
  assert(await page.locator('#cx-feed').evaluate(e=>{var all=[...e.children];return all.indexOf(e.querySelector('[data-item-id=err1]'))<all.indexOf(e.querySelector('[data-item-id=recovered]'));}));
  windows[0].status='failed';await refresh();assert.equal(await page.locator('.cx-task-status').textContent(),'运行异常');
  windows[0].status='completed';windows[0].error='';await refresh();
  await page.locator('.cx-compose-bar .ck-select-button').click();await page.locator('dialog[open]').waitFor();await page.getByRole('button',{name:'复制选项：供应商B · model-b',exact:true}).click();await page.waitForFunction(()=>window.copied.includes('供应商B · model-b'));assert.equal(await page.locator('#cx-profile').inputValue(),'p');assert(await page.locator('dialog[open]').isVisible());await page.mouse.click(3,3);await page.locator('dialog').waitFor({state:'detached'});
  if(width<=640)await page.locator('#cx-window-toggle').click();await page.locator('#cx-tab-api').click();const p=page.locator('.cx-profile-card[data-id=p]');await p.locator('summary').click();await p.locator('[name=name]').fill('未保存草稿');await page.locator('.cx-section-heading h3').click();assert.equal(await p.getAttribute('open'),null);await p.locator('summary').click();assert.equal(await p.locator('[name=name]').inputValue(),'未保存草稿');if(width<=640)await page.locator('#cx-window-toggle').click();await page.locator('#cx-tab-tasks').click();
  requests=[q('q1','先选择执行范围'),q('q2','再选择检查范围')];windows[1].status='waiting';await refresh();await page.locator('#cx-question-notice').click();await page.locator('.cx-question').first().waitFor();assert.equal(await page.locator('#cx-window-title').textContent(),'任务2');assert.equal(await page.locator('.cx-item-question').count(),2);
  const answer=page.locator('.cx-question').first();await answer.getByRole('button',{name:'复制选项：仅本次',exact:true}).click();await page.waitForFunction(()=>window.copied.includes('仅本次\n只处理当前任务'));assert.equal(await answer.locator('textarea').inputValue(),'');assert.equal(posted.length,0);
  await answer.getByRole('button',{name:'仅本次',exact:false}).first().click();assert.equal(await answer.locator('textarea').inputValue(),'仅本次');
  await page.locator('#cx-feed').evaluate(e=>e.scrollTop=0);await page.locator('#cx-question-nav').getByRole('button',{name:'回到提问',exact:true}).click();assert.equal(await page.locator('.cx-question-highlight').getAttribute('data-item-id'),'q1');await page.locator('#cx-question-nav').getByRole('button',{name:'下一处'}).click();assert.equal(await page.locator('#cx-question-nav span').textContent(),'提问 2 / 2');
  await page.locator('.cx-question').nth(1).locator('textarea').fill('保留这个答案');await answer.getByRole('button',{name:'回复并继续'}).click();await page.waitForFunction(()=>document.querySelectorAll('.cx-question').length===1);assert.equal(posted.length,1);assert.equal(await page.locator('.cx-question textarea').inputValue(),'保留这个答案');assert(await page.locator('#cx-question-notice').isVisible());
  await page.reload();await page.locator('.cx-item-question').first().waitFor();assert.equal(await page.locator('.cx-item-question').count(),2);assert((await page.locator('.cx-item-question').first().innerText()).includes('已结束'));
  await page.locator('#cx-exit').click();assert(await page.locator('#cx-question-outside').isVisible());await page.locator('#cx-question-outside').click();await page.locator('.cx-question').waitFor();assert(await page.locator('#cx-tasks').isVisible());
  await page.goto('http://127.0.0.1:'+server.address().port+'/');await page.locator('#cx-question-outside').waitFor();assert.equal(await page.locator('#cx-root').isVisible(),false);await page.locator('#cx-question-outside').click();await page.locator('.cx-question').waitFor();
  await page.screenshot({path:'/home/ckcodex/workspace/work/codex-workspace-check/interactions-'+width+'.png'});
  if(width<640)await page.locator('#cx-window-toggle').click();await page.locator('#cx-new').click();await page.waitForFunction(()=>document.getElementById('cx-window-title').textContent==='任务3');if(width<640)await page.locator('#cx-window-toggle').click();await page.locator('#cx-new').click();await page.waitForFunction(()=>document.getElementById('cx-window-title').textContent==='任务4');assert.deepEqual(created.map(w=>w.title),['任务3','任务4']);
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));assert.deepEqual(errors,[]);console.log(width+': outside dismissal, feedback, status, alignment, question navigation/copy/history/cross-window alert, sequential names PASS');await context.close();
 }}finally{await browser.close();server.close();}
})().catch(e=>{console.error(e);server.close();process.exitCode=1;});
