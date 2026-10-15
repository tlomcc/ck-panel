const {chromium}=require('playwright');
const fs=require('fs'),path=require('path'),http=require('http'),assert=require('assert');
const root=path.resolve(__dirname,'..'),out='/home/ckcodex/workspace/work/codex-task-notices-20261014';
const server=http.createServer((req,res)=>{
  const file=path.resolve(root,new URL(req.url,'http://local').pathname.slice(1)||'index.html');
  if(!file.startsWith(root+'/')||!fs.existsSync(file)||!fs.statSync(file).isFile()){res.writeHead(404);return res.end();}
  res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':file.endsWith('.json')?'application/json':'text/html');res.end(fs.readFileSync(file));
});
(async()=>{
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const browser=await chromium.launch({args:['--no-sandbox','--disable-dev-shm-usage']});
  try{for(const width of [320,390,1440]){
    const context=await browser.newContext({viewport:{width,height:900},serviceWorkers:'block'});
    await context.addInitScript(()=>{
      localStorage.setItem('ck_codex_access','fixture');localStorage.setItem('ck_codex_endpoint','https://codex.test/codex');
      localStorage.setItem('ck_codex_selected','run');
      let hidden=false;Object.defineProperty(document,'hidden',{get:()=>hidden});window.setHidden=v=>{hidden=v;document.dispatchEvent(new Event('visibilitychange'));};
      const vv=window.visualViewport;let h=innerHeight,top=0;Object.defineProperties(vv,{height:{get:()=>h},offsetTop:{get:()=>top}});window.keyboard=(height,offset)=>{h=height;top=offset;vv.dispatchEvent(new Event('resize'));};
    });
    const page=await context.newPage(),errors=[],posts=[];page.on('pageerror',e=>errors.push(e.message));
    const rows=[['run','运行窗口','running'],['done','完成窗口','completed'],['bad','异常窗口','failed'],['wait','提问窗口','waiting'],['closed','关闭窗口','closed']].map(([id,title,status],i)=>({id,title,status,profile:'p',thread_id:id,seq:10+i,created:i+1,updated:100+i,error:id==='bad'?'供应商暂时不可用':''}));
    let failDetail='',failList=false,holdId='',release,held=false;
    const row=id=>rows.find(w=>w.id===id),bump=(id,values)=>Object.assign(row(id),values,{seq:row(id).seq+1,updated:row(id).updated+1});
    await page.route('**/*',async route=>{
      const req=route.request(),url=new URL(req.url());
      if(url.hostname==='127.0.0.1')return route.continue();
      if(url.hostname!=='codex.test')return route.abort();
      if(req.method()==='POST')posts.push(url.pathname);
      let result;
      if(url.pathname.endsWith('/config'))result={profiles:[{id:'p',name:'测试供应商',model:'fixture',effort:'high',base_url:'https://fixture.test/v1',has_key:true}],default_profile:'p',workspace:'/workspace',scheduling:true};
      else if(url.pathname.endsWith('/threads')){
        if(failList)return route.fulfill({status:503,json:{error:'暂时断线'}});
        result={windows:rows};
      }else{
        const id=url.pathname.split('/')[3];
        if(id===failDetail)return route.fulfill({status:503,json:{error:'记录读取失败'}});
        result={window:{...row(id)},cursor:row(id).seq,items:[{id:'a-'+id,kind:'agentMessage',text:'记录 '+id+' / '+row(id).seq,created:100,data:{phase:row(id).status==='completed'?'final_answer':'commentary'}}],schedules:[]};
        if(id===holdId){held=true;await new Promise(r=>release=r);}
      }
      await route.fulfill({json:result}).catch(()=>{});
    });
    const notice=id=>page.locator('#cx-notice-list [data-window-id="'+id+'"]');
    const sync=async()=>{await page.evaluate(()=>window.dispatchEvent(new Event('online')));await page.waitForTimeout(130);};
    const menu=async()=>{if(width<=640&&!await page.locator('#cx-window-sidebar').isVisible())await page.locator('#cx-window-toggle').click();};
    const refresh=async()=>{if(!await page.locator('.cx-window-menu').evaluate(e=>e.open))await page.locator('.cx-window-menu summary').click();await page.locator('#cx-refresh').click();await page.waitForFunction(()=>document.querySelector('#cx-refresh').textContent!=='刷新中…');};
    await page.goto('http://127.0.0.1:'+server.address().port+'/');await page.waitForTimeout(250);assert(!await page.locator('#cx-task-notices').isVisible());await page.evaluate(()=>ckOpenCodex('api'));await notice('done').waitFor();
    assert(await page.locator('#cx-root').isVisible());assert.equal(await notice('run').getAttribute('data-tone'),'ok');assert.equal(await notice('bad').getAttribute('data-tone'),'error');assert.equal(await notice('closed').count(),0);
    const strips=await page.locator('#cx-task-notices').boundingBox();assert(strips.x<16&&strips.y<125);assert(Math.abs(strips.width-width/3)<2);const box=await notice('done').boundingBox();assert(box.height<=25&&box.width<=width/3);const runBox=await notice('run').boundingBox();assert.equal(runBox.x,box.x);assert(runBox.y+runBox.height<=box.y);
    assert((await notice('done').innerText()).includes('未查看'));
    // Clicking cannot dismiss a completed result before the detail request succeeds.
    failDetail='done';await notice('done').click();await page.getByText('记录读取失败',{exact:true}).waitFor();assert(await notice('done').isVisible());
    failDetail='';holdId='done';if(!await page.locator('.cx-window-menu').evaluate(e=>e.open))await page.locator('.cx-window-menu summary').click();await page.locator('#cx-refresh').click();while(!held)await page.waitForTimeout(20);
    assert(await notice('done').isVisible());holdId='';release();await notice('done').waitFor({state:'detached'});
    await menu();assert(await page.locator('#cx-windows').getByRole('button',{name:/完成窗口/}).isVisible());
    assert.equal(await page.locator('#cx-window-sidebar nav button').allTextContents().then(x=>x.join(',')),'API 配置,工作资料');
    if(width<=640)await page.locator('#cx-window-title').click();
    await notice('run').click();await page.getByText('记录 run / 10',{exact:true}).waitFor();await page.locator('#cx-input').fill('保留运行窗口草稿');
    await notice('bad').click();await page.getByText('记录 bad / 12',{exact:true}).waitFor();assert(await notice('bad').isVisible());
    await notice('run').click();assert.equal(await page.locator('#cx-input').inputValue(),'保留运行窗口草稿');
    // Settings polls may update status, but never acknowledge a completion.
    await menu();await page.locator('#cx-tab-api').click();bump('run',{status:'completed'});await refresh();
    assert((await notice('run').innerText()).includes('未查看'));await page.waitForTimeout(500);assert(await notice('run').isVisible());
    await notice('run').click();await notice('run').waitFor({state:'detached'});
    await page.locator('#cx-exit').click();assert(!await page.locator('#cx-task-notices').isVisible());assert.equal(await page.locator('.cx-question-outside').count(),0);await page.reload();await page.waitForTimeout(200);assert(!await page.locator('#cx-task-notices').isVisible());await page.evaluate(()=>ckOpenCodex('api'));await notice('bad').waitFor();assert.equal(await notice('done').count(),0);assert.equal(await notice('run').count(),0);
    // Another completion in the same window must notify again, even if the running transition was missed.
    bump('done',{status:'completed'});bump('run',{status:'completed'});await sync();await notice('done').waitFor();await notice('run').waitFor();
    await notice('done').click();await notice('done').waitFor({state:'detached'});assert(await notice('run').isVisible(),'switching from settings must not mark another window seen');
    // An older detail response cannot acknowledge a newer completion seen by the list poll.
    holdId='run';held=false;await notice('run').click();while(!held)await page.waitForTimeout(20);
    bump('run',{status:'completed'});await sync();holdId='';release();await page.waitForTimeout(150);assert(await notice('run').isVisible());
    await refresh();await notice('run').waitFor({state:'detached'});
    // A response arriving while hidden does not count as viewed.
    bump('done',{status:'completed'});await sync();holdId='done';held=false;await notice('done').click();while(!held)await page.waitForTimeout(20);
    await page.evaluate(()=>window.setHidden(true));holdId='';release();await page.waitForTimeout(80);assert(await notice('done').isVisible());
    await page.evaluate(()=>window.setHidden(false));await notice('done').waitFor({state:'detached'});
    // Read completion with a future schedule remains reachable until that schedule is gone.
    bump('done',{scheduled_count:1});await sync();await refresh();assert(await notice('done').isVisible());assert((await notice('done').innerText()).includes('1 个定时任务'));
    bump('done',{scheduled_count:0});await refresh();await notice('done').waitFor({state:'detached'});
    await notice('bad').click();bump('bad',{status:'running',error:''});await sync();assert.equal(await notice('bad').getAttribute('data-tone'),'ok');
    failList=true;await sync();assert.equal(await notice('wait').getAttribute('data-tone'),'error');assert((await notice('wait').innerText()).includes('待同步'));
    failList=false;await sync();assert.equal(await notice('wait').getAttribute('data-tone'),'ok');
    // Confirm multiple compact cards, actual theme colors, keyboard bounds, and no horizontal overflow.
    for(let i=0;i<6;i++)rows.push({id:'extra'+i,title:'额外任务 '+i,status:i%2?'completed':'running',seq:20+i,created:10+i,updated:100,profile:'p',error:''});await sync();
    for(const dark of [false,true]){
      await page.evaluate(d=>document.body.classList.toggle('dark',d),dark);
      const good=await notice('bad').evaluate(e=>getComputedStyle(e).backgroundColor);bump('bad',{error:'测试失败'});await sync();const bad=await notice('bad').evaluate(e=>getComputedStyle(e).backgroundColor);assert.notEqual(good,bad);bump('bad',{error:''});await sync();
      await page.screenshot({path:out+'/tasks-'+width+(dark?'-dark':'')+'.png'});
    }
    if(width<=640){await page.locator('#cx-input').focus();await page.evaluate(()=>window.keyboard(420,75));await page.waitForTimeout(80);const box=await page.locator('#cx-compose').boundingBox();await page.screenshot({path:out+'/keyboard-'+width+'.png'});assert(box.y+box.height<=496,JSON.stringify({box,root:await page.locator('#cx-root').boundingBox(),shell:await page.locator('.cx-shell').boundingBox(),rail:await page.locator('#cx-task-notices').boundingBox()}));assert((await page.locator('#cx-feed').boundingBox()).height>80);await page.evaluate(()=>window.keyboard(900,0));}
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));assert.deepEqual(posts,[]);assert.deepEqual(errors,[]);
    console.log(width+': placement, colors, unread persistence, successful view, settings/background/race isolation, archive, drafts, schedules, recovery, keyboard PASS');
    await context.close();
  }}finally{await browser.close();server.close();}
})().catch(e=>{console.error(e);server.close();process.exitCode=1;});
