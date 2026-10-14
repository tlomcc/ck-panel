const {chromium}=require('playwright');
const fs=require('fs'),path=require('path'),http=require('http'),assert=require('assert');
const root=path.resolve(__dirname,'..');
const server=http.createServer((req,res)=>{const name=new URL(req.url,'http://local').pathname.slice(1)||'index.html',file=path.resolve(root,name);if(!file.startsWith(root+'/')||!fs.existsSync(file)||!fs.statSync(file).isFile()){res.writeHead(404);return res.end();}res.setHeader('Content-Type',name.endsWith('.js')?'text/javascript':name.endsWith('.css')?'text/css':name.endsWith('.json')?'application/json':'text/html');res.end(fs.readFileSync(file));});
(async()=>{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const browser=await chromium.launch({args:['--no-sandbox','--disable-dev-shm-usage']});
 try{for(const width of [390,1440]){
  const context=await browser.newContext({viewport:{width,height:900},timezoneId:'America/New_York',serviceWorkers:'block'});
  await context.addInitScript(()=>{if(!localStorage.getItem('fixture-seeded')){localStorage.setItem('ck_codex_access','fixture-access');localStorage.setItem('ck_codex_endpoint','https://codex.test/codex');localStorage.setItem('ck_codex_selected','one');localStorage.setItem('ck_codex_draft_one','刷新前未发送的草稿');localStorage.setItem('fixture-seeded','1');}});
  let windows=['one','two'].map(id=>({id,title:id==='one'?'窗口一':'窗口二',profile:'p',thread_id:'native-'+id,status:'completed',updated:1}));
  let scheduled=[],posts=[],dropNext=false,delayNext=false,rejectCancel=false;
  await context.route('https://codex.test/codex/**',async route=>{
   const req=route.request(),url=new URL(req.url()),parts=url.pathname.split('/'),wid=parts[3],action=parts[4];let result={};
   if(url.pathname.endsWith('/config'))result={profiles:[{id:'p',name:'测试供应商',model:'test-model',effort:'high',has_key:true}],default_profile:'p',workspace:'/workspace',scheduling:true};
   else if(req.method()==='POST'){
    const b=req.postDataJSON();posts.push({wid,action,...b});
    if(action==='cancel-schedule'&&rejectCancel){rejectCancel=false;return route.fulfill({status:409,json:{error:'定时任务已开始，请使用「停止任务」'}});}
    if(action==='schedule'&&!scheduled.some(s=>s.request_id===b.request_id))scheduled.push({...b,window_id:wid,profile:'p',state:'scheduled'});
    if(action==='cancel-schedule')scheduled.find(s=>s.request_id===b.request_id).state='cancelled';
    if(action==='delete'){windows=windows.filter(w=>w.id!==wid);scheduled=scheduled.filter(s=>s.window_id!==wid);}
    if(delayNext){delayNext=false;await new Promise(r=>setTimeout(r,800));}
    if(dropNext){dropNext=false;return route.abort('failed');}
    result={accepted:true};
   }else if(url.pathname.endsWith('/threads'))result={windows};
   else result={window:windows.find(w=>w.id===wid),items:[],cursor:0,schedules:scheduled.filter(s=>s.window_id===wid)};
   await route.fulfill({json:result});
  });
  let page=await context.newPage();let errors=[];const observe=p=>p.on('pageerror',e=>errors.push(e.message));observe(page);
  const url='http://127.0.0.1:'+server.address().port+'/#codex-tasks';
  const ready=async()=>{await page.waitForFunction(()=>document.getElementById('cx-window-title')?.textContent==='窗口一');};
  const choose=async title=>{if(width<640)await page.locator('#cx-window-toggle').click();await page.locator('#cx-windows button').filter({hasText:title}).click();await page.waitForFunction(t=>document.getElementById('cx-window-title').textContent===t,title);};
  const setTime=async value=>{if(!await page.locator('#cx-schedule-time').isVisible())await page.locator('#cx-schedule-summary').click();await page.locator('#cx-schedule-time').fill(value);await page.locator('#cx-schedule-summary').click();};
  await page.goto(url);await ready();assert.equal(await page.locator('#cx-input').inputValue(),'刷新前未发送的草稿');
  await page.locator('#cx-input').fill('窗口一草稿\n保留换行与空格  ');await setTime('2090-06-15T13:45');
  await page.reload();await ready();assert.equal(await page.locator('#cx-input').inputValue(),'窗口一草稿\n保留换行与空格  ');assert.equal(await page.locator('#cx-schedule-time').inputValue(),'2090-06-15T13:45');
  await choose('窗口二');await page.locator('#cx-input').fill('窗口二独立草稿');await choose('窗口一');assert.equal(await page.locator('#cx-input').inputValue(),'窗口一草稿\n保留换行与空格  ');
  await page.locator('#cx-exit').click();await page.evaluate(()=>ckOpenCodex('tasks'));await ready();assert.equal(await page.locator('#cx-input').inputValue(),'窗口一草稿\n保留换行与空格  ');
  await page.close();page=await context.newPage();observe(page);await page.goto(url);await ready();assert.equal(await page.locator('#cx-schedule-time').inputValue(),'2090-06-15T13:45');
  dropNext=true;await page.locator('#cx-send').click();await page.waitForFunction(()=>document.getElementById('cx-message').textContent.includes('暂时无法连接'));
  assert.equal(posts.at(-1).action,'schedule');assert.equal(posts.at(-1).scheduled_for,Date.parse('2090-06-15T13:45:00+08:00')/1000);const firstId=posts.at(-1).request_id;
  assert((await page.locator('#cx-input').inputValue()).includes('窗口一草稿'));
  await page.reload();await ready();await page.locator('#cx-send').click();await page.waitForFunction(()=>document.getElementById('cx-input').value==='');assert.equal(posts.at(-1).request_id,firstId);assert.equal(scheduled.length,1);
  await page.locator('.cx-scheduled summary').click();assert((await page.locator('#cx-schedules').innerText()).includes('2090/06/15 13:45'));await page.getByRole('button',{name:'取消定时任务',exact:true}).click();await page.waitForFunction(()=>document.getElementById('cx-input').value==='窗口一草稿\n保留换行与空格');
  assert(await page.locator('#cx-schedules').isHidden());assert.equal(await page.locator('#cx-schedule-time').inputValue(),'');
  await page.reload();await ready();assert.equal(await page.locator('#cx-input').inputValue(),'窗口一草稿\n保留换行与空格');assert(await page.locator('#cx-schedules').isHidden());
  const addSchedule=async(text,time='2092-03-04T05:06')=>{await page.locator('#cx-input').fill(text);await setTime(time);await page.locator('#cx-send').click();await page.waitForFunction(()=>document.getElementById('cx-input').value===''&&!document.getElementById('cx-send').disabled);};
  const cancelFirst=async()=>{await page.locator('.cx-scheduled summary').first().click();await page.getByRole('button',{name:'取消定时任务',exact:true}).first().click();};
  await addSchedule('保留另一项安排');await addSchedule('等待取消的任务');
  await page.locator('#cx-input').fill('原有草稿');rejectCancel=true;await cancelFirst();await page.waitForFunction(()=>!document.getElementById('cx-send').disabled);
  assert.equal(await page.locator('#cx-input').inputValue(),'原有草稿');assert.equal(await page.locator('.cx-scheduled').count(),2);assert((await page.locator('#cx-message').innerText()).includes('已开始'));
  delayNext=true;await page.getByRole('button',{name:'取消定时任务',exact:true}).first().click();await page.locator('#cx-input').fill('取消期间继续编辑\n新草稿');
  await page.waitForFunction(()=>!document.getElementById('cx-send').disabled);assert.equal(await page.locator('#cx-input').inputValue(),'取消期间继续编辑\n新草稿\n\n保留另一项安排');assert.equal(await page.locator('.cx-scheduled').count(),1);
  delayNext=true;await cancelFirst();await choose('窗口二');await page.waitForFunction(()=>!document.getElementById('cx-send').disabled);
  assert.equal(await page.locator('#cx-input').inputValue(),'窗口二独立草稿');await choose('窗口一');
  assert.equal(await page.locator('#cx-input').inputValue(),'取消期间继续编辑\n新草稿\n\n保留另一项安排\n\n等待取消的任务');assert(await page.locator('#cx-schedules').isHidden());
  await addSchedule('丢失取消响应仍恢复');dropNext=true;await cancelFirst();await page.waitForFunction(()=>!document.getElementById('cx-send').disabled);assert.equal(await page.locator('#cx-input').inputValue(),'丢失取消响应仍恢复');assert(await page.locator('#cx-schedules').isHidden());
  await page.reload();await ready();assert.equal(await page.locator('#cx-input').inputValue(),'丢失取消响应仍恢复');assert(await page.locator('#cx-schedules').isHidden());
  await page.locator('#cx-input').fill('普通立即任务');await page.locator('#cx-send').click();await page.waitForFunction(()=>document.getElementById('cx-input').value==='');assert.equal(posts.at(-1).action,'send');
  await page.locator('#cx-input').fill('正在发送的内容');delayNext=true;await page.locator('#cx-send').click();await page.locator('#cx-input').fill('发送期间输入的新草稿');await page.waitForFunction(()=>!document.getElementById('cx-send').disabled);assert.equal(await page.locator('#cx-input').inputValue(),'发送期间输入的新草稿');
  await setTime('2020-01-01T00:00');const count=posts.length;await page.locator('#cx-send').click();assert.equal(posts.length,count);assert((await page.locator('#cx-message').innerText()).includes('未来'));
  await page.locator('#cx-schedule-summary').click();await page.locator('#cx-schedule-clear').click();await page.locator('#cx-schedule-summary').click();assert.equal(await page.locator('#cx-send').innerText(),'开始执行');
  windows[0].status='running';await page.locator('#cx-refresh').click();await page.waitForFunction(()=>document.getElementById('cx-send').textContent==='补充指令');await page.locator('#cx-send').click();await page.waitForFunction(()=>document.getElementById('cx-input').value==='');assert.equal(posts.at(-1).action,'steer');
  await page.locator('#cx-input').fill('等当前任务结束再执行');await setTime('2091-01-02T03:04');await page.locator('#cx-send').click();await page.waitForFunction(()=>document.getElementById('cx-input').value==='');assert.equal(posts.at(-1).action,'schedule');
  await page.locator('#cx-input').fill('删除窗口时同时清理的草稿');await page.screenshot({path:'/home/ckcodex/workspace/work/cancel-schedule-20261014/compose-'+width+'.png'});
  await page.locator('.cx-window-menu summary').click();await page.locator('#cx-delete-window').click();await page.locator('dialog').getByRole('button',{name:'删除窗口',exact:true}).click();await page.waitForFunction(()=>document.getElementById('cx-window-title').textContent==='窗口二');
  assert.equal(await page.locator('#cx-input').inputValue(),'窗口二独立草稿');assert.equal(await page.evaluate(()=>localStorage.getItem('ck_codex_draft_one')),null);
  await page.locator('#cx-input').fill('');await page.reload();await page.waitForFunction(()=>document.getElementById('cx-window-title').textContent==='窗口二');assert.equal(await page.locator('#cx-input').inputValue(),'');
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));assert.deepEqual(errors,[]);
  console.log(width+': drafts, timezone, scheduled/immediate/steer, send race, deletion, cancel restore/hide/reload, existing draft, editing/switching races, partial cancel, rejected/lost response PASS');await context.close();
 }}finally{await browser.close();server.close();}
})().catch(e=>{console.error(e);server.close();process.exitCode=1;});
