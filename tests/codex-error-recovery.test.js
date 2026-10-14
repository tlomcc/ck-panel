const {chromium}=require('playwright');
const fs=require('fs'),path=require('path'),http=require('http'),assert=require('assert');
const root=path.resolve(__dirname,'..');
const server=http.createServer((req,res)=>{
  const file=path.resolve(root,new URL(req.url,'http://local').pathname.slice(1)||'index.html');
  if(!file.startsWith(root+'/')||!fs.existsSync(file)||!fs.statSync(file).isFile()){res.writeHead(404);return res.end();}
  res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':file.endsWith('.json')?'application/json':'text/html');
  res.end(fs.readFileSync(file));
});
(async()=>{
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const browser=await chromium.launch({args:['--no-sandbox','--disable-dev-shm-usage']});
  try{for(const width of [390,1440]){
    const context=await browser.newContext({viewport:{width,height:900},serviceWorkers:'block'});
    await context.addInitScript(()=>{
      localStorage.setItem('ck_codex_access','fixture');
      localStorage.setItem('ck_codex_endpoint','https://codex.test/codex');
      localStorage.setItem('ck_codex_selected','run');
    });
    const page=await context.newPage(),errors=[],posts=[];
    page.on('pageerror',e=>errors.push(e.message));
    const rows=[
      {id:'run',title:'本窗口',profile:'p',status:'running',error:'',seq:1,updated:1},
      {id:'other',title:'其他窗口',profile:'p',status:'running',error:'另一个真实错误',seq:1,updated:1}
    ];
    let failDetail=false,detailFailures=0,reads=0,holdDetail=false,release,held=false;
    await page.route('**/*',async route=>{
      const req=route.request(),url=new URL(req.url());
      if(url.hostname==='127.0.0.1')return route.continue();
      if(url.hostname!=='codex.test')return route.abort();
      if(req.method()==='POST'){
        posts.push(url.pathname);
        return route.fulfill({status:503,json:{error:'停止请求失败，请核对任务'}});
      }
      let result;
      if(url.pathname.endsWith('/config'))result={profiles:[{id:'p',name:'测试',model:'fixture',effort:'high',base_url:'https://fixture.test/v1'}],default_profile:'p'};
      else if(url.pathname.endsWith('/threads'))result={windows:rows};
      else{
        reads++;
        if(failDetail){detailFailures++;return route.fulfill({status:503,json:{error:'进度暂时读取失败'}});}
        result={window:{...rows[0]},cursor:rows[0].seq,schedules:[],items:[
          {id:'old-error',kind:'error',text:'已发生的错误记录',created:1,seq:1,data:{}},
          {id:'thinking',kind:'reasoning',text:'继续核对结果',created:2,seq:rows[0].seq,data:{}}
        ]};
        if(holdDetail){holdDetail=false;held=true;await new Promise(r=>release=r);}
      }
      await route.fulfill({json:result}).catch(()=>{});
    });
    await page.goto('http://127.0.0.1:'+server.address().port+'/#codex-tasks');
    await page.getByText('继续核对结果',{exact:true}).waitFor();
    const status=page.locator('#cx-window-meta .cx-task-status'),banner=page.locator('#cx-message');
    failDetail=true;
    await page.getByText('进度暂时读取失败',{exact:true}).waitFor({timeout:4000});
    assert.equal(await banner.getAttribute('data-source'),'sync');
    // Status-list success alone does not claim that detail reading has recovered.
    await page.waitForTimeout(1600);assert.equal(await banner.innerText(),'进度暂时读取失败');
    failDetail=false;rows[0].seq++;
    await page.waitForFunction(()=>document.querySelector('#cx-message').textContent==='',{timeout:4000});
    assert.equal(await page.locator('#cx-connection').getAttribute('data-state'),'ok');
    assert.equal(await status.getAttribute('data-status'),'running');
    assert.equal(await page.getByText('已发生的错误记录',{exact:true}).count(),1);
    // Runtime error can recover through thinking only, while the other window stays red.
    rows[0].error='当前暂时错误';rows[0].seq++;
    await page.waitForFunction(()=>document.querySelector('#cx-window-meta .cx-task-status').dataset.status==='error');
    rows[0].error='';rows[0].seq++;
    await page.waitForFunction(()=>document.querySelector('#cx-window-meta .cx-task-status').dataset.status==='running');
    const other=page.locator('#cx-notice-list [data-window-id="other"]');
    if(await other.count())assert.equal(await other.getAttribute('data-status'),'error');
    else assert((await page.locator('#cx-other-errors').innerText()).includes('另一个真实错误'));
    // A failed action survives successful automatic reads and a subsequent read failure/recovery.
    await page.locator('#cx-stop').click();await page.getByText('停止请求失败，请核对任务',{exact:true}).waitFor();
    const before=reads;await page.waitForTimeout(1200);assert(reads>before);assert.equal(await banner.innerText(),'停止请求失败，请核对任务');
    failDetail=true;const failures=detailFailures;
    while(detailFailures===failures)await page.waitForTimeout(50);
    assert.equal(await banner.innerText(),'停止请求失败，请核对任务');
    failDetail=false;await page.waitForTimeout(1200);assert.equal(await banner.innerText(),'停止请求失败，请核对任务');
    await page.locator('#cx-refresh').click();await page.waitForFunction(()=>document.querySelector('#cx-message').textContent==='');
    // A delayed old detail response cannot overwrite a newer healthy list response.
    rows[0].error='older error';rows[0].seq++;holdDetail=true;
    while(!held)await page.waitForTimeout(50);
    rows[0].error='';rows[0].seq++;
    await page.evaluate(()=>window.dispatchEvent(new Event('online')));
    await page.waitForFunction(()=>document.querySelector('#cx-window-meta .cx-task-status').dataset.status==='running');
    release();await page.waitForTimeout(150);assert.equal(await status.getAttribute('data-status'),'running');
    assert.deepEqual(posts,['/codex/threads/run/stop']);assert.deepEqual(errors,[]);
    console.log(width+': automatic read recovery, retained history, action-error isolation, current status, other-window error, stale response PASS');
    await context.close();
  }}finally{await browser.close();server.close();}
})().catch(e=>{console.error(e);server.close();process.exitCode=1;});
