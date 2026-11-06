const {chromium}=require(process.env.CK_PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http'),os=require('node:os');
const root=path.resolve(__dirname,'..'),out=process.env.CK_GAME_TEST_OUTPUT||fs.mkdtempSync(path.join(os.tmpdir(),'ck-game-window-'));
fs.mkdirSync(out,{recursive:true});
const server=http.createServer((req,res)=>{
  const name=decodeURIComponent(new URL(req.url,'http://localhost').pathname).slice(1)||'index.html',file=path.resolve(root,name);
  if(!file.startsWith(root+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile()){res.writeHead(404);return res.end()}
  let body=fs.readFileSync(file);
  if(name==='index.html')body=Buffer.from(body.toString().replace('</head>','<script src="/tests/fixtures/games-boot.js"></script><script src="/tests/fixtures/game-window-boot.js"></script></head>').replace(/<script src="pwa\.js[^>]+><\/script>/g,''));
  res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json'}[path.extname(file)]||'application/octet-stream')+'; charset=utf-8');
  res.setHeader('Content-Security-Policy',"connect-src 'self'; img-src 'self' data: blob:; font-src 'self' data:; frame-src 'none'; worker-src 'none'");res.end(body);
});
let browser,base,activePage;const cases=[];
async function boot(width=390){
  const context=await browser.newContext({viewport:{width,height:width===768?1024:900},locale:'zh-CN',serviceWorkers:'block'});
  await context.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
  const page=activePage=await context.newPage();await page.goto(base+'/#games');
  await page.waitForFunction(()=>chatSessionsReady&&document.querySelectorAll('.games-point').length===225);
  return {context,page};
}
async function start(page){await page.click('#games-new');await page.waitForFunction(()=>chatCurrentSession().gameWindow&&chatCurrentSession().gameWindow.wakeConfigured)}
async function idle(page){await page.waitForFunction(()=>!chatSending&&!chatRecoverInFlightBusy);await page.waitForTimeout(100)}
async function plan(page,value){await page.evaluate(v=>__fixturePlans.push(v),value)}
async function play(page,c,reply){if(reply)await plan(page,{reply});await page.click('[data-coordinate="'+c+'"]');await page.click('#games-play');await page.waitForFunction(()=>chatCurrentSession().gomoku&&!chatCurrentSession().gomoku.pending&&!chatSending);await idle(page)}
async function calls(page){return page.evaluate(()=>__fixtureRequests.filter(r=>r.path.endsWith('/ck/chat')&&r.method==='POST').map(r=>r.body))}
async function finish(page,summary='本局两手后先休息，下次继续。',reply='好，下次继续。'){
  await plan(page,{reply:summary});await plan(page,{reply});
  await page.click('#games-end');await page.getByRole('button',{name:'结束本局',exact:true}).last().click();
  await page.waitForFunction(()=>chatSessions.some(s=>s.gameWindow&&s.gameWindow.reports.some(r=>r.state==='delivered')),{},{timeout:20000});
  await idle(page);
}
async function run(name,fn){if(process.env.CK_GAME_TEST_FILTER&&!new RegExp(process.env.CK_GAME_TEST_FILTER).test(name))return;await fn();cases.push(name);console.log('PASS '+name)}
(async()=>{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));base='http://127.0.0.1:'+server.address().port;
  browser=await chromium.launch({headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
  for(const width of [1440,768,390])await run('isolated context, model, thinking and both wakes at '+width,async()=>{
    const {context,page}=await boot(width);try{
      const original=await page.evaluate(()=>({messages:chatMessages,transport:chatCurrentSession().transportMessages,cacheGeneration:chatCurrentSession().cacheGeneration}));
      await page.evaluate(()=>document.getElementById('chat-input').value='主窗口未发送的草稿');await start(page);
      await page.fill('#games-input','这次只聊本局的事。');await play(page,'H8','嗯，陪着你。\n【落子：I9】');
      const req=(await calls(page))[0];
      assert.equal(req.model,'claude-opus-4-6');assert.equal(req.thinking_mode,'adaptive');assert.equal(req.thinking_effort,'medium');assert.equal(req.thinking_prompt,'保留小克原来的思考词。');
      assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('ckChatConfigV2')).thinkingEffort),'high');
      assert.equal(req.recall,false);assert.equal(req.use_mcp,false);assert.equal(req.worldbook_pack,'');assert.equal(req.daily_digest_pack,'');assert.equal(req.game_context.parent_session_id,'ck-gomoku-fixture');
      assert.ok(!JSON.stringify(req).includes('茉莉花茶'));assert.equal(req.execution_backend,'claude_code_subscription');assert.equal(req.prompt_cache_ttl,'1h');assert.equal(req.chat_polling_enabled,false);
      assert.equal(await page.evaluate(()=>CKBackendRoute.current.subscriptionModel),'claude-opus-4-6');
      const states=await page.evaluate(()=>({p:chatWakeState['ck-gomoku-fixture'],g:chatWakeState[chatActiveSessionId]}));
      assert.equal(states.p.enabled,true);assert.equal(states.g.enabled,true);assert.equal(states.g.interval_seconds,3000);assert.equal(states.g.idle_shutdown_enabled,true);assert.equal(states.g.idle_shutdown_minutes,180);
      const sid=await page.evaluate(()=>chatActiveSessionId);
      await page.fill('#games-input','游戏里还没发送的草稿');
      await page.getByRole('button',{name:'返回 CK 聊天',exact:true}).click();
      assert.equal(await page.evaluate(()=>currentPanelTab),'chat');
      assert.equal(await page.evaluate(()=>chatActiveSessionId),sid);assert.equal(await page.inputValue('#chat-input'),'主窗口未发送的草稿');
      assert.ok((await page.textContent('#chat-messages')).includes('这次只聊本局的事。'));
      assert.ok((await page.textContent('#chat-messages')).includes('嗯，陪着你。'));
      assert.deepEqual(await page.evaluate(()=>{const main=chatSessions.find(s=>s.id==='ck-gomoku-fixture');return {messages:main.messages,transport:main.transportMessages,cacheGeneration:main.cacheGeneration}}),original);
      await page.click('#chat-game-return');await page.waitForFunction(()=>currentPanelTab==='games');
      assert.equal(await page.evaluate(()=>chatActiveSessionId),sid);
      assert.equal(await page.inputValue('#games-input'),'游戏里还没发送的草稿');
      assert.equal(await page.evaluate(()=>chatCurrentSession().gomoku.moves.length),2);
      assert.equal((await calls(page)).length,1);
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
      await page.screenshot({path:path.join(out,'game-'+width+'.png'),fullPage:true});
      assert.deepEqual(await page.evaluate(()=>__fixtureErrors),[]);
    }finally{await context.close()}
  });
  await run('saved Sonnet game upgrades to Opus without replay or changing its board and wake choice',async()=>{
    const {context,page}=await boot();try{
      await start(page);await play(page,'H8','保留这局。\n【落子：I9】');
      await page.evaluate(async()=>{await chatWakeRequest({enabled:false},chatActiveSessionId)});
      const previous=await page.evaluate(()=>({id:chatActiveSessionId,board:chatCurrentSession().gomoku,
        prompts:chatCurrentSession().gameWindow.prompts,reports:chatCurrentSession().gameWindow.reports,
        mainModel:CKBackendRoute.current.subscriptionModel,main:chatSessions.find(s=>s.id==='ck-gomoku-fixture').messages}));
      await page.evaluate(()=>{chatCurrentSession().gameWindow.model='claude-sonnet-5-5';chatCurrentSession().gameWindow.prompts.thinkingEffort='high';chatSaveSessions();return chatSaveSessionsToIndexedDb.pending});
      await page.reload();
      await page.waitForFunction(()=>chatSessionsReady&&chatCurrentSession().gameWindow&&chatCurrentSession().gameWindow.model==='claude-opus-4-6');
      assert.equal((await calls(page)).length,0);
      const restored=await page.evaluate(()=>({id:chatActiveSessionId,board:chatCurrentSession().gomoku,
        prompts:chatCurrentSession().gameWindow.prompts,reports:chatCurrentSession().gameWindow.reports,
        mainModel:CKBackendRoute.current.subscriptionModel,main:chatSessions.find(s=>s.id==='ck-gomoku-fixture').messages}));
      assert.deepEqual(restored,previous);
      assert.equal(await page.evaluate(()=>__fixtureWakeStates[chatActiveSessionId].enabled),false);
      assert.ok((await page.textContent('#games-window-info')).includes('Opus 4.6'));
      await play(page,'G8','继续这局。\n【落子：J9】');
      const req=(await calls(page)).at(-1);
      assert.equal(req.model,'claude-opus-4-6');assert.equal(req.session_id,previous.id);
      assert.equal(req.game_context.game_id,previous.board.id);assert.equal(req.thinking_mode,'adaptive');assert.equal(req.thinking_effort,'medium');
      assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('ckChatConfigV2')).thinkingEffort),'high');
      assert.equal(await page.evaluate(()=>__fixtureWakeStates[chatActiveSessionId].enabled),false);
      assert.deepEqual(await page.evaluate(()=>__fixtureErrors),[]);
    }finally{await context.close()}
  });
  for(const event of ['visibility','pageshow'])await run('games foreground '+event+' resumes the original move immediately',async()=>{
    const {context,page}=await boot();try{
      await start(page);
      await plan(page,{reply:'回来啦，这步下在这里。\n【落子：I9】',partial:'回来啦',delay:60000,durableReceipt:true});
      await page.click('[data-coordinate="H8"]');await page.click('#games-play');
      await page.waitForFunction(()=>chatSending&&chatActiveRequest&&chatActiveRequest.responseReceived);
      await page.evaluate(kind=>{
        if(kind==='visibility'){
          Object.defineProperty(document,'hidden',{configurable:true,get:()=>true});document.dispatchEvent(new Event('visibilitychange'));
          Object.defineProperty(document,'hidden',{configurable:true,get:()=>false});document.dispatchEvent(new Event('visibilitychange'));
        }else{
          window.dispatchEvent(new PageTransitionEvent('pagehide',{persisted:true}));
          window.dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true}));
        }
      },event);
      await page.waitForFunction(()=>chatCurrentSession().gomoku.moves.length===2&&!chatSending&&!chatRecoverInFlightBusy,{},{timeout:3500});
      assert.deepEqual(await page.evaluate(()=>chatCurrentSession().gomoku.moves),['H8','I9']);
      assert.equal((await calls(page)).length,1);
      assert.ok(await page.evaluate(()=>__fixtureRequests.some(r=>r.path.endsWith('/ck/chat/last'))));
      assert.equal(await page.evaluate(()=>currentPanelTab),'games');
      await page.evaluate(()=>{document.dispatchEvent(new Event('visibilitychange'));window.dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true}))});
      await page.waitForTimeout(150);
      assert.equal((await calls(page)).length,1);assert.equal(await page.evaluate(()=>chatCurrentSession().gomoku.moves.length),2);
      assert.deepEqual(await page.evaluate(()=>__fixtureErrors),[]);
    }finally{await context.close()}
  });
  await run('a foreground game keeps recovering its original turn after returning to game chat',async()=>{
    const {context,page}=await boot();try{
      await start(page);
      await plan(page,{reply:'思考完成，继续下这一步。\n【落子：I9】',partial:'思考',delay:60000,durableReceipt:true,receiptReadyDelay:4500});
      await page.click('[data-coordinate="H8"]');await page.click('#games-play');
      await page.waitForFunction(()=>chatSending&&chatActiveRequest&&chatActiveRequest.responseReceived);
      await page.evaluate(()=>{
        Object.defineProperty(document,'hidden',{configurable:true,get:()=>true});document.dispatchEvent(new Event('visibilitychange'));
        Object.defineProperty(document,'hidden',{configurable:true,get:()=>false});document.dispatchEvent(new Event('visibilitychange'));
      });
      await page.waitForFunction(()=>!chatSending&&chatMessages.some(m=>m.ckGame&&m.inFlight));
      await page.waitForFunction(()=>document.getElementById('games-conversation').textContent.includes('正在补收'));
      assert.deepEqual(await page.evaluate(()=>chatCurrentSession().gomoku.moves),['H8']);
      assert.equal(await page.locator('#games-ask').textContent(),'补收这步');
      await page.click('#games-ask');
      assert.equal((await calls(page)).length,1);
      const sid=await page.evaluate(()=>chatActiveSessionId);
      await page.getByRole('button',{name:'返回 CK 聊天',exact:true}).click();
      assert.equal(await page.evaluate(()=>currentPanelTab),'chat');
      assert.equal(await page.evaluate(()=>chatActiveSessionId),sid);
      await page.waitForFunction(()=>chatCurrentSession().gomoku.moves.length===2&&!chatRecoverInFlightBusy,{},{timeout:12000});
      assert.deepEqual(await page.evaluate(()=>chatCurrentSession().gomoku.moves),['H8','I9']);
      assert.ok((await page.textContent('#chat-messages')).includes('思考完成，继续下这一步。'));
      await page.click('#chat-game-return');await page.waitForFunction(()=>currentPanelTab==='games');
      assert.equal(await page.locator('.games-point.is-black,.games-point.is-white').count(),2);
      assert.equal((await calls(page)).length,1);assert.deepEqual(await page.evaluate(()=>__fixtureErrors),[]);
    }finally{await context.close()}
  });
  await run('the game recovery button reads the original reply without resending the move',async()=>{
    const {context,page}=await boot();try{
      await start(page);
      await plan(page,{reply:'补收原来这一步。\n【落子：I9】',partial:'补收',delay:60000,durableReceipt:true});
      await page.click('[data-coordinate="H8"]');await page.click('#games-play');
      await page.waitForFunction(()=>chatSending&&chatActiveRequest&&chatActiveRequest.responseReceived);
      assert.equal(await page.locator('#games-ask').textContent(),'补收这步');await page.click('#games-ask');
      await page.waitForFunction(()=>chatCurrentSession().gomoku.moves.length===2&&!chatSending&&!chatRecoverInFlightBusy,{},{timeout:3500});
      assert.equal((await calls(page)).length,1);assert.deepEqual(await page.evaluate(()=>__fixtureErrors),[]);
    }finally{await context.close()}
  });
  for(const kind of ['stopped','error'])await run('foreground recovery preserves an explicitly '+kind+' move without automatic retry',async()=>{
    const {context,page}=await boot();try{
      await start(page);
      await plan(page,{reply:'这条不应自动落子。\n【落子：I9】',partial:'这条',delay:60000,durableReceipt:true});
      await page.click('[data-coordinate="H8"]');await page.click('#games-play');
      await page.waitForFunction(()=>chatSending&&chatActiveRequest&&chatActiveRequest.responseReceived);
      await page.evaluate(kind=>{
        if(kind==='stopped')chatStopMessage();
        else{
          const turn=chatActiveRequest.turnId;
          sessionStorage.setItem('__gomoku_receipt_'+turn,JSON.stringify({ok:true,found:false,pending:false,state:'error',turn_id:turn,error:'模拟的生成失败'}));
        }
        window.dispatchEvent(new PageTransitionEvent('pagehide',{persisted:true}));
        window.dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true}));
      },kind);
      await page.waitForFunction(kind=>!chatSending&&!chatRecoverInFlightBusy&&chatMessages.some(m=>m.ckGame&&(kind==='stopped'?m.role==='pending_user':m.sendFailed)),kind);
      await page.evaluate(()=>{document.dispatchEvent(new Event('visibilitychange'));window.dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true}))});
      await page.waitForTimeout(500);
      assert.deepEqual(await page.evaluate(()=>chatCurrentSession().gomoku.moves),['H8']);
      assert.equal((await calls(page)).length,1);assert.equal(await page.locator('#games-ask').textContent(),'重试这步');
      assert.deepEqual(await page.evaluate(()=>__fixtureErrors),[]);
    }finally{await context.close()}
  });
  await run('game writes summary and main receives it exactly once',async()=>{
    const {context,page}=await boot();try{
      await start(page);await play(page,'H8','好。\n【落子：I9】');
      await page.evaluate(()=>document.getElementById('chat-input').value='主窗口草稿保留');
      await plan(page,{reply:'本局下了两手后先休息。我们约好明天接着下。'});
      await plan(page,{reply:'记着啦，明天接着陪你。'});
      await page.click('#games-end');await page.getByRole('button',{name:'结束本局',exact:true}).last().click();
      await page.waitForFunction(()=>chatSessions.some(s=>s.gameWindow&&s.gameWindow.reports.some(r=>r.state==='delivered')),{},{timeout:20000});
      const req=await calls(page);assert.equal(req.length,3);assert.equal(req[1].model,'claude-opus-4-6');assert.equal(req[2].model,'claude-opus-4-6');assert.equal(req[2].session_id,'ck-gomoku-fixture');
      assert.equal(req[1].thinking_effort,'medium');assert.equal(req[2].thinking_effort,'high');
      assert.ok(req[2].text.includes('本局下了两手后先休息。我们约好明天接着下。'));assert.ok(req[2].transport_messages);assert.equal(req[2].game_context,undefined);
      assert.equal(await page.inputValue('#chat-input'),'主窗口草稿保留');
      await page.evaluate(()=>{CKGameWindow.update();CKGameWindow.update();chatSaveSessions()});await page.waitForTimeout(1200);assert.equal((await calls(page)).length,3);
      assert.deepEqual(await page.evaluate(()=>__fixtureErrors),[]);
    }finally{await context.close()}
  });
  await run('next game reuses the window and wake but excludes earlier games',async()=>{
    const {context,page}=await boot();try{
      await start(page);const sid=await page.evaluate(()=>chatActiveSessionId);
      await page.fill('#games-input','第一局专有暗号：纸飞机');await play(page,'H8','记下这一局。\n【落子：I9】');
      await finish(page,'第一局说过纸飞机。');
      const wakeCount=await page.evaluate(()=>__fixtureRequests.filter(r=>r.method==='POST'&&r.path.endsWith('/wake')).length);
      await start(page);assert.equal(await page.evaluate(()=>chatActiveSessionId),sid);
      await play(page,'G8','新的这一局。\n【落子：H8】');
      const req=(await calls(page)).at(-1);assert.ok(!JSON.stringify(req).includes('纸飞机'));
      assert.equal(await page.evaluate(()=>chatSessions.filter(s=>s.gameWindow).length),1);
      assert.ok(await page.evaluate(()=>chatMessages.some(m=>(m.text||'').includes('纸飞机'))));
      assert.equal(await page.evaluate(()=>__fixtureRequests.filter(r=>r.method==='POST'&&r.path.endsWith('/wake')).length),wakeCount);
      assert.ok(req.game_context.game_id!== (await calls(page))[0].game_context.game_id);
      assert.deepEqual(await page.evaluate(()=>__fixtureErrors),[]);
    }finally{await context.close()}
  });
  await run('returning to game chat while streaming and refreshing preserves the original move receipt',async()=>{
    const {context,page}=await boot();try{
      await start(page);const sid=await page.evaluate(()=>chatActiveSessionId);
      await plan(page,{reply:'补收这一步。\n【落子：I9】',partial:'补收',delay:9000,durableReceipt:true});
      await page.click('[data-coordinate="H8"]');await page.click('#games-play');
      await page.waitForFunction(()=>chatSending&&chatMessages.some(m=>m.inFlight));
      await page.getByRole('button',{name:'返回 CK 聊天',exact:true}).click();
      assert.equal(await page.evaluate(()=>currentPanelTab),'chat');
      assert.equal(await page.evaluate(()=>chatActiveSessionId),sid);
      assert.equal(await page.evaluate(()=>chatSending),true);assert.equal((await calls(page)).length,1);
      await page.click('#chat-game-return');await page.waitForFunction(()=>currentPanelTab==='games');
      assert.equal(await page.evaluate(()=>chatSending),true);
      await page.evaluate(()=>chatSaveSessionsToIndexedDb.pending);
      await page.reload();await page.waitForFunction(()=>chatSessionsReady&&chatCurrentSession().gomoku.moves.length===2&&!chatSending&&!chatRecoverInFlightBusy);
      assert.equal(await page.evaluate(()=>chatActiveSessionId),sid);assert.equal((await calls(page)).length,0);
      await play(page,'G8','继续。\n【落子：J9】');assert.equal((await calls(page)).length,1);
      assert.ok(!JSON.stringify((await calls(page))[0]).includes('茉莉花茶'));assert.deepEqual(await page.evaluate(()=>__fixtureErrors),[]);
    }finally{await context.close()}
  });
  await run('failed summary never reaches main and requires explicit retry',async()=>{
    const {context,page}=await boot();try{
      await start(page);await play(page,'H8','好。\n【落子：I9】');await plan(page,{failure:true});
      await page.click('#games-end');await page.getByRole('button',{name:'结束本局',exact:true}).last().click();
      await page.waitForFunction(()=>chatCurrentSession().gameWindow.reports[0].state==='failed');
      await page.waitForTimeout(1400);assert.equal((await calls(page)).length,2);
      assert.equal(await page.evaluate(()=>chatSessions.find(s=>s.id==='ck-gomoku-fixture').messages.some(m=>m.ckGameSummary)),false);
      await plan(page,{reply:'手动重试后得到的完整总结。'});await plan(page,{reply:'我收到了。'});
      await page.click('#games-sync-retry');await page.waitForFunction(()=>chatSessions.some(s=>s.gameWindow&&s.gameWindow.reports[0].state==='delivered'));
      const req=await calls(page);assert.equal(req.length,4);assert.ok(req[3].text.includes('手动重试后得到的完整总结。'));
      assert.deepEqual(await page.evaluate(()=>__fixtureErrors),[]);
    }finally{await context.close()}
  });
  await run('failed delivery retries only the existing summary',async()=>{
    const {context,page}=await boot();try{
      await start(page);await play(page,'H8','好。\n【落子：I9】');
      await plan(page,{reply:'不重新生成的原总结。'});await plan(page,{failure:true});
      await page.click('#games-end');await page.getByRole('button',{name:'结束本局',exact:true}).last().click();
      await page.waitForFunction(()=>chatSessions.some(s=>s.gameWindow&&s.gameWindow.reports[0].state==='failed'));
      assert.equal((await calls(page)).length,3);await page.waitForTimeout(1200);assert.equal((await calls(page)).length,3);
      await plan(page,{reply:'这次收到了。'});await page.click('#games-sync-retry');
      await page.waitForFunction(()=>chatSessions.some(s=>s.gameWindow&&s.gameWindow.reports[0].state==='delivered'));
      const req=await calls(page);assert.equal(req.length,4);assert.equal(req[3].model,'claude-opus-4-6');assert.equal(req[2].text,req[3].text);
      assert.deepEqual(await page.evaluate(()=>__fixtureErrors),[]);
    }finally{await context.close()}
  });
  await run('summary receipt recovers across reload without regenerating',async()=>{
    const {context,page}=await boot();try{
      await start(page);await play(page,'H8','好。\n【落子：I9】');
      await plan(page,{reply:'刷新后从原回执取回的完整总结。',partial:'刷新后',delay:9000,durableReceipt:true});
      await page.click('#games-end');await page.getByRole('button',{name:'结束本局',exact:true}).last().click();
      await page.waitForFunction(()=>chatSending&&chatMessages.some(m=>m.ckGameSummary&&m.inFlight));await page.evaluate(()=>chatSaveSessionsToIndexedDb.pending);
      await page.reload();await page.waitForFunction(()=>chatSessionsReady&&chatSessions.some(s=>s.gameWindow&&s.gameWindow.reports[0].state==='delivered'));
      const req=await calls(page);assert.equal(req.length,1);assert.equal(req[0].session_id,'ck-gomoku-fixture');assert.ok(req[0].text.includes('刷新后从原回执取回的完整总结。'));
      await page.evaluate(()=>chatSaveSessionsToIndexedDb.pending);await page.reload();await page.waitForFunction(()=>chatSessionsReady);await page.waitForTimeout(1500);
      assert.equal((await calls(page)).length,0);assert.deepEqual(await page.evaluate(()=>__fixtureErrors),[]);
    }finally{await context.close()}
  });
  await run('main pending messages wait safely and are never included in automated delivery',async()=>{
    const {context,page}=await boot();try{
      await start(page);await play(page,'H8','好。\n【落子：I9】');
      await page.evaluate(()=>{chatSessions.find(s=>s.id==='ck-gomoku-fixture').messages.push({role:'pending_user',text:'等待我手动发送',pendingId:'fixture-pending',ts:Date.now()});chatSaveSessions()});
      await plan(page,{reply:'本局总结完整。'});await plan(page,{reply:'收到本局总结。'});
      await page.click('#games-end');await page.getByRole('button',{name:'结束本局',exact:true}).last().click();
      await page.waitForFunction(()=>chatCurrentSession().gameWindow.reports[0].state==='ready');await page.waitForTimeout(1500);
      assert.equal((await calls(page)).length,2);
      await page.evaluate(()=>{const main=chatSessions.find(s=>s.id==='ck-gomoku-fixture');main.messages=main.messages.filter(m=>m.pendingId!=='fixture-pending');chatSaveSessions();CKGameWindow.update()});
      await page.waitForFunction(()=>chatSessions.some(s=>s.gameWindow&&s.gameWindow.reports[0].state==='delivered'));
      assert.ok(!(await calls(page))[2].text.includes('等待我手动发送'));assert.deepEqual(await page.evaluate(()=>__fixtureErrors),[]);
    }finally{await context.close()}
  });
  await run('both optional takebacks remain available in the independent window',async()=>{
    const {context,page}=await boot();try{
      await start(page);await play(page,'H8','好。\n【落子：I9】');
      await play(page,'G8','我想换一下。\n【悔棋：J9】');
      assert.deepEqual(await page.evaluate(()=>chatCurrentSession().gomoku.moves),['H8','J9']);
      await plan(page,{reply:'你重新下吧。'});await page.click('#games-undo');await idle(page);
      assert.deepEqual(await page.evaluate(()=>chatCurrentSession().gomoku.moves),[]);
      const req=await calls(page);assert.equal(req.length,3);assert.ok(req.every(r=>r.model==='claude-opus-4-6'&&r.game_context));
      assert.equal(await page.evaluate(()=>chatSessions.find(s=>s.id==='ck-gomoku-fixture').messages.length),4);
      assert.deepEqual(await page.evaluate(()=>__fixtureErrors),[]);
    }finally{await context.close()}
  });
  await run('unverified egress blocks game requests with no fallback',async()=>{
    const {context,page}=await boot();try{
      await start(page);await page.evaluate(()=>__fixtureSubscriptionReady=false);
      await page.click('[data-coordinate="H8"]');await page.click('#games-play');await idle(page);
      assert.equal((await calls(page)).length,0);assert.equal(await page.evaluate(()=>CKBackendRoute.current.execution),'claude_code_subscription');
      assert.equal(await page.evaluate(()=>chatCurrentSession().gomoku.moves.length),1);assert.ok(await page.evaluate(()=>chatMessages.some(m=>m.sendFailed)));
      assert.deepEqual(await page.evaluate(()=>__fixtureErrors),[]);
    }finally{await context.close()}
  });
  await run('wake disable decisions survive render, reload and reuse',async()=>{
    const {context,page}=await boot();try{
      await start(page);await page.evaluate(()=>chatWakeRequest({enabled:false},chatActiveSessionId));
      await page.evaluate(()=>{CKGameWindow.update();CKGameWindow.update();chatSaveSessions()});await page.waitForTimeout(1100);
      assert.equal(await page.evaluate(()=>chatWakeState[chatActiveSessionId].enabled),false);
      await page.evaluate(()=>chatSaveSessionsToIndexedDb.pending);await page.reload();await page.waitForFunction(()=>chatSessionsReady&&chatCurrentSession().gameWindow);
      await start(page);await page.evaluate(()=>chatWakeRefresh());assert.equal(await page.evaluate(()=>chatWakeState[chatActiveSessionId].enabled),false);
      assert.equal(await page.evaluate(()=>__fixtureRequests.filter(r=>r.method==='POST'&&r.path.endsWith('/wake')&&r.body.enabled).length),0);
      assert.deepEqual(await page.evaluate(()=>__fixtureErrors),[]);
    }finally{await context.close()}
  });
  await run('new game first delivers the previous result then starts automatically',async()=>{
    const {context,page}=await boot();try{
      await start(page);await play(page,'H8','好。\n【落子：I9】');const old=await page.evaluate(()=>({sid:chatActiveSessionId,id:chatCurrentSession().gomoku.id}));
      await plan(page,{reply:'上一局下了两手，现在准备换一局。'});await plan(page,{reply:'好，换一局。'});
      await page.click('#games-new');await page.getByRole('button',{name:'开新局',exact:true}).click();
      await page.waitForFunction(id=>chatCurrentSession().gameWindow&&chatCurrentSession().gomoku.id!==id&&chatCurrentSession().gomoku.moves.length===0,old.id);
      assert.equal(await page.evaluate(()=>chatActiveSessionId),old.sid);assert.equal((await calls(page)).length,3);
      assert.equal(await page.evaluate(()=>chatCurrentSession().gameWindow.reports[0].state),'delivered');
      assert.equal(await page.locator('#games-sync-status').isVisible(),false);assert.deepEqual(await page.evaluate(()=>__fixtureErrors),[]);
    }finally{await context.close()}
  });
  await run('main delivery keeps the game board and newly typed game draft in place',async()=>{
    const {context,page}=await boot();try{
      await start(page);await play(page,'H8','好。\n【落子：I9】');const sid=await page.evaluate(()=>chatActiveSessionId);
      await plan(page,{reply:'本局总结。'});await plan(page,{reply:'我已经收到这局的总结。',partial:'我已经',delay:2500});
      await page.click('#games-end');await page.getByRole('button',{name:'结束本局',exact:true}).last().click();
      await page.waitForFunction(()=>chatActiveSessionId==='ck-gomoku-fixture'&&chatSending);
      assert.equal(await page.locator('.games-point.is-black,.games-point.is-white').count(),2);
      await page.fill('#games-input','同步时写下的游戏草稿');await page.locator('#games-input').press('Enter');
      assert.equal(await page.locator('#games-play').isDisabled(),true);
      await page.waitForFunction(sid=>chatActiveSessionId===sid&&!chatSending,sid);
      assert.equal(await page.inputValue('#games-input'),'同步时写下的游戏草稿');assert.equal((await calls(page)).length,3);
      assert.equal(await page.evaluate(()=>chatSessions.find(s=>s.id==='ck-gomoku-fixture').messages.some(m=>m.text==='同步时写下的游戏草稿')),false);
      assert.deepEqual(await page.evaluate(()=>__fixtureErrors),[]);
    }finally{await context.close()}
  });
  await run('a natural win is summarized once and can still be taken back',async()=>{
    const {context,page}=await boot();try{
      await start(page);await page.evaluate(()=>{chatCurrentSession().gomoku.moves=['A1','B1','A2','C1','A3','D1','H8','E1'];chatSaveSessions();CKGames.onChatUpdate()});
      await plan(page,{reply:'这局先到这里。\n【落子：F1】'});await plan(page,{reply:'本局小克白棋连成五子，共十手。'});await plan(page,{reply:'记住这一局啦。'});
      await page.click('[data-coordinate="J8"]');await page.click('#games-play');
      await page.waitForFunction(()=>chatSessions.some(s=>s.gameWindow&&s.gameWindow.reports.some(r=>r.state==='delivered')));
      assert.equal((await calls(page)).length,3);assert.equal(await page.locator('#games-turn').textContent(),'小克赢了');
      await plan(page,{reply:'可以，你重新下。'});await page.click('#games-undo');await idle(page);
      assert.equal(await page.evaluate(()=>chatCurrentSession().gomoku.moves.length),8);assert.equal(await page.locator('#games-turn').textContent(),'轮到你，执黑');
      await page.waitForTimeout(1200);assert.equal((await calls(page)).length,4);assert.deepEqual(await page.evaluate(()=>__fixtureErrors),[]);
    }finally{await context.close()}
  });
  await run('legacy ongoing games retain their original window until the next game',async()=>{
    const {context,page}=await boot();try{
      await page.evaluate(()=>{chatCurrentSession().gomoku=CKGomoku.create('g-legacy-fixture',Date.now());chatSaveSessions();CKGames.onChatUpdate()});
      await play(page,'H8','继续这局。\n【落子：I9】');
      const req=(await calls(page))[0];assert.equal(req.session_id,'ck-gomoku-fixture');assert.equal(req.model,'claude-opus-4-6');assert.equal(req.game_context,undefined);
      assert.ok(JSON.stringify(req.transport_messages).includes('茉莉花茶'));assert.equal(await page.evaluate(()=>chatSessions.filter(s=>s.gameWindow).length),0);
      assert.deepEqual(await page.evaluate(()=>__fixtureErrors),[]);
    }finally{await context.close()}
  });
  fs.writeFileSync(path.join(out,'results.json'),JSON.stringify({passed:cases.length,cases,real_model_requests:0},null,2));
})().catch(async error=>{
  console.error(error.stack||error);if(activePage&&!activePage.isClosed()){fs.writeFileSync(path.join(out,'failure.json'),JSON.stringify(await activePage.evaluate(()=>({errors:__fixtureErrors,current:chatActiveSessionId,sending:chatSending,sessions:chatSessions,notice:document.getElementById('games-notice').textContent})),null,2));await activePage.screenshot({path:path.join(out,'failure.png')}).catch(()=>{})}process.exitCode=1;
}).finally(async()=>{if(browser)await browser.close().catch(()=>{});await new Promise(resolve=>server.close(resolve))});
