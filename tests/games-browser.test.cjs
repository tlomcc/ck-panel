/* Run with Playwright installed, or CK_PLAYWRIGHT_MODULE pointing to that package. */
const {chromium}=require(process.env.CK_PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http'),os=require('node:os');
const root=path.resolve(__dirname,'..'),out=process.env.CK_GAME_TEST_OUTPUT||fs.mkdtempSync(path.join(os.tmpdir(),'ck-gomoku-tests-'));
fs.mkdirSync(out,{recursive:true});
const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml','.png':'image/png'};
const server=http.createServer((req,res)=>{
  const name=decodeURIComponent(new URL(req.url,'http://localhost').pathname).slice(1)||'index.html',file=path.resolve(root,name);
  if(!file.startsWith(root+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile()){res.writeHead(404);return res.end()}
  let body=fs.readFileSync(file);
  if(name==='index.html')body=Buffer.from(body.toString().replace('</head>','<script src="/tests/fixtures/games-boot.js"></script></head>').replace(/<script src="pwa\.js[^>]+><\/script>/g,''));
  res.setHeader('Content-Type',(mime[path.extname(file)]||'application/octet-stream')+'; charset=utf-8');
  res.setHeader('Content-Security-Policy',"connect-src 'self'; img-src 'self' data: blob:; font-src 'self' data:; frame-src 'none'; worker-src 'none'");res.end(body);
});
let browser,base;const cases=[];
async function boot(width=390){
  const context=await browser.newContext({viewport:{width,height:width===768?1024:900},locale:'zh-CN',serviceWorkers:'block'});
  await context.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
  const page=await context.newPage();await page.goto(base+'/#games');await loaded(page);
  return {context,page};
}
async function loaded(page){await page.waitForFunction(()=>chatSessionsReady&&document.querySelectorAll('.games-point').length===225&&currentPanelTab==='games')}
async function idle(page){await page.waitForFunction(()=>!chatSending&&!chatRecoverInFlightBusy,{},{timeout:12000});await page.waitForTimeout(80)}
async function plan(page,value){await page.evaluate(value=>__fixturePlans.push(value),value)}
async function moves(page,n){await page.waitForFunction(n=>chatCurrentSession().gomoku&&chatCurrentSession().gomoku.moves.length===n,n,{timeout:14000})}
async function play(page,coordinate){await page.locator('[data-coordinate="'+coordinate+'"]').click();await page.locator('#games-play').click()}
async function say(page,text,reply){if(reply)await plan(page,{reply});await page.locator('#games-input').fill(text);await page.locator('#games-say').click()}
async function calls(page){return page.evaluate(()=>__fixtureRequests.filter(r=>r.path.endsWith('/ck/chat')&&r.method==='POST'))}
async function pickWindow(page,label){await page.locator('#games-session + .ck-select-button').click();await page.getByRole('button',{name:label,exact:true}).click()}
async function noErrors(page){assert.deepEqual(await page.evaluate(()=>__fixtureErrors),[])}
async function run(name,fn){await fn();cases.push(name);console.log('PASS '+name)}
(async()=>{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));base='http://127.0.0.1:'+server.address().port;
  browser=await chromium.launch({headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
  for(const width of [1440,768,390])await run('board, shared memory, ordinary speech, persistence and navigation at '+width,async()=>{
    const {context,page}=await boot(width);
    try{
      const before=await page.evaluate(()=>({session:chatActiveSessionId,history:chatCurrentSession().messages,transport:chatCurrentSession().transportMessages,system:chatComposeSystemPrompt(chatLoadConfig()),generation:chatCurrentSession().cacheGeneration,wake:chatCurrentSession().wakeEnabled,config:JSON.parse(localStorage.getItem(CHAT_CONFIG_KEY))}));
      await page.evaluate(()=>document.getElementById('chat-input').value='聊天页尚未发送的草稿');
      await page.click('#games-new');assert.equal((await calls(page)).length,0);
      await page.locator('[data-coordinate="H8"]').focus();await page.keyboard.press('ArrowRight');await page.keyboard.press('Enter');
      assert.equal(await page.locator('#games-play').textContent(),'落子 I8');assert.equal((await calls(page)).length,0);
      await page.locator('[data-coordinate="H8"]').click();await page.click('#games-play');await moves(page,2);await idle(page);
      const first=(await calls(page))[0].body;
      assert.equal(first.session_id,before.session);assert.deepEqual(first.transport_messages,before.transport);assert.equal(first.system,before.system);
      assert.equal(first.client_cache_generation,before.generation);assert.equal(first.prompt_cache_ttl,'1h');assert.equal(first.execution_backend,'claude_code_subscription');assert.equal(first.chat_polling_enabled,false);
      assert.ok(!('upstream_key' in first)&&!('api_base' in first));assert.ok(!first.cache_rebuild_boundary);
      assert.equal(await page.evaluate(()=>document.getElementById('chat-input').value),'聊天页尚未发送的草稿');
      assert.equal(await page.evaluate(()=>chatCurrentSession().wakeEnabled),true);
      assert.deepEqual(await page.evaluate(()=>chatCurrentSession().messages.slice(0,4)),before.history);
      const oldBoard=await page.evaluate(()=>chatCurrentSession().gomoku.moves);
      await say(page,'还记得我想喝什么茶吗？','记得，你想喝茉莉花茶。我们边下边聊。\n【落子：J10】');await idle(page);
      assert.deepEqual(await page.evaluate(()=>chatCurrentSession().gomoku.moves),oldBoard,'coordinates in ordinary chat must not make a move');
      const all=await calls(page);assert.equal(all.length,2);assert.equal(all[1].body.text,'还记得我想喝什么茶吗？');assert.equal(all[1].body.system,before.system);
      assert.deepEqual(all[1].body.transport_messages.slice(0,before.transport.length),before.transport);
      await pickWindow(page,'另一个窗口');await page.waitForFunction(()=>chatActiveSessionId==='ck-gomoku-other');assert.equal(await page.evaluate(()=>chatCurrentSession().gomoku),null);
      await pickWindow(page,'小克');await moves(page,2);
      await page.evaluate(()=>chatSaveSessionsToIndexedDb.pending);await page.reload();await loaded(page);await moves(page,2);
      assert.equal((await calls(page)).length,0,'refresh does not send a model request');
      assert.equal(await page.evaluate(()=>chatCurrentSession().cacheGeneration),before.generation);
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
      if(width===390){const box=await page.locator('#games-input').boundingBox();assert.ok(box.y+box.height<=900,'phone composer stays visible beside play');await page.click('#games-fold');assert.equal(await page.locator('#games-board-area').isVisible(),false);await page.click('#games-fold')}
      await page.screenshot({path:path.join(out,'games-'+width+'.png'),fullPage:true});
      await page.evaluate(()=>document.body.classList.add('dark'));await page.screenshot({path:path.join(out,'games-'+width+'-dark.png'),fullPage:true});
      await page.evaluate(()=>navTo('chat'));assert.equal(await page.evaluate(()=>currentPanelTab),'chat');assert.equal(await page.locator('#chat-input').count(),1);
      await page.evaluate(()=>{openSidebar();document.querySelector('[data-tab="games"]').click()});await loaded(page);await moves(page,2);await noErrors(page);
    }finally{await context.close()}
  });
  await run('speech queues during thinking and sees the completed prior turn',async()=>{
    const {context,page}=await boot();try{
      await page.click('#games-new');await plan(page,{reply:'我想想，这一手放在这里。\n【落子：I9】',partial:'我想想',delay:1700});await plan(page,{reply:'好呀，你去泡茶，我在这里等你。'});
      await play(page,'H8');await page.waitForFunction(()=>chatSending);await say(page,'我去泡茶，一会儿回来。');
      await page.waitForTimeout(200);assert.equal((await calls(page)).length,1);assert.equal(await page.evaluate(()=>chatCurrentSession().gomoku.moves.length),1);
      await page.waitForFunction(()=>__fixtureRequests.filter(r=>r.path.endsWith('/ck/chat')&&r.method==='POST').length===2);await idle(page);await moves(page,2);
      const sent=await calls(page);assert.equal(sent[1].body.text,'我去泡茶，一会儿回来。');assert.equal(sent[1].body.transport_messages.at(-1).content[0].text,'我想想，这一手放在这里。\n【落子：I9】');
      await noErrors(page);
    }finally{await context.close()}
  });
  await run('bad moves wait for explicit correction; ordinary replies and duplicate notifications cannot move',async()=>{
    const {context,page}=await boot();try{
      await page.click('#games-new');await plan(page,{reply:'我也落在 H8。\n【落子：H8】'});await play(page,'H8');await idle(page);
      await page.waitForFunction(()=>!!chatCurrentSession().gomoku.error);assert.equal(await page.evaluate(()=>chatCurrentSession().gomoku.moves.length),1);
      assert.equal((await calls(page)).length,1);await say(page,'先说说别的吧。','可以呀。\n【落子：I9】');await idle(page);assert.equal(await page.evaluate(()=>chatCurrentSession().gomoku.moves.length),1);
      await plan(page,{reply:'这次放在空位。\n【落子：I9】'});await page.click('#games-ask');await moves(page,2);await idle(page);
      await page.evaluate(()=>{for(let i=0;i<6;i++)CKGames.onChatUpdate()});await page.waitForTimeout(100);assert.equal(await page.evaluate(()=>chatCurrentSession().gomoku.moves.length),2);assert.equal((await calls(page)).length,3);
      await noErrors(page);
    }finally{await context.close()}
  });
  await run('unverified subscription connection blocks without fallback and retry keeps the same human move',async()=>{
    const {context,page}=await boot();try{
      await page.click('#games-new');await page.evaluate(()=>__fixtureSubscriptionReady=false);await play(page,'H8');await idle(page);
      assert.equal((await calls(page)).length,0);assert.equal(await page.evaluate(()=>chatCurrentSession().gomoku.moves.length),1);
      assert.equal(await page.evaluate(()=>CKBackendRoute.current.execution),'claude_code_subscription');
      await page.locator('#ck-backend-dialog [onclick="ckCloseBackendRoute()"] ').first().click();
      await page.evaluate(()=>__fixtureSubscriptionReady=true);await page.click('#games-ask');await moves(page,2);await idle(page);
      assert.equal((await calls(page)).length,1);await noErrors(page);
    }finally{await context.close()}
  });
  await run('interrupted stream reconciles the existing receipt without replay',async()=>{
    const {context,page}=await boot();try{
      await page.click('#games-new');await plan(page,{reply:'这步想好了。\n【落子：I9】',partial:'这步',disconnect:true});await play(page,'H8');await moves(page,2);await idle(page);
      assert.equal((await calls(page)).length,1);assert.equal(await page.evaluate(()=>chatCurrentSession().gomoku.pending),null);await noErrors(page);
    }finally{await context.close()}
  });
  await run('reload during a turn restores the board and receives the saved reply without another model call',async()=>{
    const {context,page}=await boot();try{
      await page.click('#games-new');await plan(page,{reply:'我接着你的这一手。\n【落子：I9】',partial:'我接着',delay:9000,durableReceipt:true});await play(page,'H8');
      await page.waitForFunction(()=>chatSending&&chatMessages.some(m=>m.inFlight));await page.evaluate(()=>chatSaveSessionsToIndexedDb.pending);await page.reload();await loaded(page);await moves(page,2);await idle(page);
      assert.equal((await calls(page)).length,0);assert.equal(await page.evaluate(()=>chatCurrentSession().cacheGeneration),7);await noErrors(page);
    }finally{await context.close()}
  });
  await run('a won board rejects later move markers and preserves the result',async()=>{
    const {context,page}=await boot();try{
      await page.click('#games-new');await page.evaluate(()=>{chatCurrentSession().gomoku.moves=['D8','A1','E8','C1','F8','E1','G8','G1'];chatSaveSessions();CKGames.onChatUpdate()});
      await plan(page,{reply:'你连成五子了！\n【落子：I9】'});await play(page,'H8');await idle(page);
      assert.equal(await page.locator('#games-turn').textContent(),'你赢了');assert.equal(await page.evaluate(()=>chatCurrentSession().gomoku.moves.length),9);assert.equal(await page.locator('#games-ask').isVisible(),false);
      assert.match((await calls(page))[0].body.text,/本局我赢了/);await noErrors(page);
    }finally{await context.close()}
  });
  await run('rapid sends stay single and text typed during preparation remains a draft',async()=>{
    const {context,page}=await boot();try{
      await plan(page,{reply:'听到了，我们慢慢聊。'});
      await page.evaluate(()=>{
        const original=chatEnsureSessionsReady;let release;
        chatEnsureSessionsReady=()=>new Promise(resolve=>{release=()=>{chatEnsureSessionsReady=original;resolve(chatSessions)}});
        const input=document.getElementById('games-input'),button=document.getElementById('games-say');
        input.value='这一条只发一次';button.click();button.click();input.value='后来继续写的新草稿';release();
      });
      await idle(page);assert.equal((await calls(page)).length,1);assert.equal(await page.locator('#games-input').inputValue(),'后来继续写的新草稿');await noErrors(page);
    }finally{await context.close()}
  });
  await run('a window change during preparation cannot send the old text into another memory',async()=>{
    const {context,page}=await boot();try{
      await page.evaluate(()=>{
        const original=chatEnsureSessionsReady;let release;
        chatEnsureSessionsReady=()=>new Promise(resolve=>{release=()=>{chatEnsureSessionsReady=original;resolve(chatSessions)}});
        document.getElementById('games-input').value='只应该给原窗口';document.getElementById('games-say').click();
        chatSelectSession('ck-gomoku-other');release();
      });
      await page.waitForFunction(()=>document.getElementById('games-notice').textContent.includes('窗口已切换'));assert.equal((await calls(page)).length,0);await noErrors(page);
    }finally{await context.close()}
  });
  await run('split replies still yield one move after all parts are complete',async()=>{
    const {context,page}=await boot();try{
      await page.evaluate(()=>{const cfg=chatLoadConfig();cfg.splitAssistantReplies=true;chatSaveConfigObject(cfg);chatWriteForm(cfg)});
      await page.click('#games-new');await plan(page,{reply:'我还记得你想喝的那杯茶。\n我们可以一边下棋一边聊天。\n【落子：I9】'});await play(page,'H8');await moves(page,2);await idle(page);
      const sent=(await calls(page))[0];assert.ok(await page.evaluate(turn=>chatMessages.filter(m=>m.role==='assistant'&&m.turnId===turn).length>1,sent.body.turn_id));
      assert.equal(await page.evaluate(()=>chatCurrentSession().gomoku.pending),null);await noErrors(page);
    }finally{await context.close()}
  });
  await run('failed streamed turn preserves the human stone and waits for a manual retry',async()=>{
    const {context,page}=await boot();try{
      await page.click('#games-new');await plan(page,{failure:true});await play(page,'H8');await idle(page);
      assert.equal((await calls(page)).length,1);assert.equal(await page.evaluate(()=>chatCurrentSession().gomoku.moves.length),1);
      await page.click('#games-ask');await moves(page,2);await idle(page);assert.equal((await calls(page)).length,2);await noErrors(page);
    }finally{await context.close()}
  });
  fs.writeFileSync(path.join(out,'browser-verification.json'),JSON.stringify({passed:true,syntheticData:true,externalRequestsBlocked:true,realChatSender:true,cases},null,2));
  console.log('PASS '+cases.length+' browser scenarios');
})().catch(error=>{console.error(error);process.exitCode=1}).finally(async()=>{if(browser)await browser.close();server.close()});
