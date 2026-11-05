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
      await page.locator('#games-input').fill('  这一步陪我聊聊，茶已经泡好了。\n你喜欢喝什么？  ');
      await page.locator('[data-coordinate="H8"]').click();await page.click('#games-play');await moves(page,2);await idle(page);
      const first=(await calls(page))[0].body;
      assert.equal((await calls(page)).length,1,'the stone and speech use one request');
      assert.ok(first.text.endsWith('\n\n这一步陪我聊聊，茶已经泡好了。\n你喜欢喝什么？'));
      assert.equal(await page.locator('#games-input').inputValue(),'');
      assert.equal(await page.locator('#games-conversation .games-message.from-user').filter({hasText:'这一步陪我聊聊'}).count(),1);
      assert.equal(await page.locator('#games-conversation .ck-game-event').filter({hasText:'你落子 H8'}).count(),1);
      assert.deepEqual(await page.evaluate(()=>chatMessages.filter(m=>m.ckGame||m.ckGameSpeech).map(m=>m.turnId)),[first.turn_id,first.turn_id]);
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
      assert.equal(await page.locator('#chat-messages .chat-bubble.user').filter({hasText:'这一步陪我聊聊'}).count(),1);
      assert.ok(!(await page.locator('#chat-messages .chat-bubble.user').allTextContents()).some(t=>t.includes('当前黑棋')));
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
      await page.click('#games-new');await page.locator('#games-input').fill('连接好了再一起下棋聊天。');await page.evaluate(()=>__fixtureSubscriptionReady=false);await play(page,'H8');await idle(page);
      assert.equal((await calls(page)).length,0);assert.equal(await page.evaluate(()=>chatCurrentSession().gomoku.moves.length),1);
      assert.equal(await page.evaluate(()=>chatMessages.filter(m=>m.sendFailed).length),2,'both submitted records are retained');
      assert.equal(await page.evaluate(()=>CKBackendRoute.current.execution),'claude_code_subscription');
      await page.locator('#ck-backend-dialog [onclick="ckCloseBackendRoute()"] ').first().click();
      await page.evaluate(()=>__fixtureSubscriptionReady=true);await page.click('#games-ask');await moves(page,2);await idle(page);
      assert.equal((await calls(page)).length,1);assert.ok((await calls(page))[0].body.text.endsWith('\n\n连接好了再一起下棋聊天。'));await noErrors(page);
    }finally{await context.close()}
  });
  await run('interrupted stream reconciles the existing receipt without replay',async()=>{
    const {context,page}=await boot();try{
      await page.click('#games-new');await page.locator('#games-input').fill('断线前这句话也要保留。');await plan(page,{reply:'这步想好了。\n【落子：I9】',partial:'这步',disconnect:true});await play(page,'H8');await moves(page,2);await idle(page);
      assert.equal((await calls(page)).length,1);assert.equal(await page.evaluate(()=>chatCurrentSession().gomoku.pending),null);await noErrors(page);
      assert.equal(await page.evaluate(()=>chatMessages.filter(m=>m.ckGameSpeech&&m.text==='断线前这句话也要保留。').length),1);
    }finally{await context.close()}
  });
  await run('reload during a turn restores the board and receives the saved reply without another model call',async()=>{
    const {context,page}=await boot();try{
      await page.click('#games-new');await page.locator('#games-input').fill('先下一子，等你回我。');await plan(page,{reply:'我接着你的这一手。\n【落子：I9】',partial:'我接着',delay:9000,durableReceipt:true});await play(page,'H8');
      await page.waitForFunction(()=>chatSending&&chatMessages.some(m=>m.inFlight));await page.evaluate(()=>chatSaveSessionsToIndexedDb.pending);await page.reload();await loaded(page);await moves(page,2);await idle(page);
      assert.equal((await calls(page)).length,0);assert.equal(await page.evaluate(()=>chatCurrentSession().cacheGeneration),7);await noErrors(page);
      assert.equal(await page.locator('#games-conversation .games-message.from-user').filter({hasText:'先下一子，等你回我。'}).count(),1);
    }finally{await context.close()}
  });
  await run('a won board rejects later move markers and preserves the result',async()=>{
    const {context,page}=await boot();try{
      await page.click('#games-new');await page.evaluate(()=>{chatCurrentSession().gomoku.moves=['D8','A1','E8','C1','F8','E1','G8','G1'];chatSaveSessions();CKGames.onChatUpdate()});
      await page.locator('#games-input').fill('这局下完我们再聊一会儿。');
      await plan(page,{reply:'你连成五子了！\n【落子：I9】'});await play(page,'H8');await idle(page);
      assert.equal(await page.locator('#games-turn').textContent(),'你赢了');assert.equal(await page.evaluate(()=>chatCurrentSession().gomoku.moves.length),9);assert.equal(await page.locator('#games-ask').isVisible(),false);
      assert.match((await calls(page))[0].body.text,/本局黑棋获胜/);assert.ok((await calls(page))[0].body.text.endsWith('\n\n这局下完我们再聊一会儿。'));await noErrors(page);
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
  await run('rapid play and send clicks share one snapshot and preserve later typing',async()=>{
    const {context,page}=await boot();try{
      await page.click('#games-new');await page.locator('[data-coordinate="H8"]').click();
      await page.evaluate(()=>{
        const original=chatEnsureSessionsReady;let release;
        chatEnsureSessionsReady=()=>new Promise(resolve=>{release=()=>{chatEnsureSessionsReady=original;resolve(chatSessions)}});
        const input=document.getElementById('games-input'),button=document.getElementById('games-play');
        input.value='这一步只发这一句话';button.click();button.click();document.getElementById('games-say').click();
        input.value='后来继续写的新草稿';release();
      });
      await moves(page,2);await idle(page);const sent=await calls(page);assert.equal(sent.length,1);
      assert.ok(sent[0].body.text.endsWith('\n\n这一步只发这一句话'));assert.ok(!sent[0].body.text.includes('新草稿'));
      assert.equal(await page.locator('#games-input').inputValue(),'后来继续写的新草稿');
      await pickWindow(page,'另一个窗口');assert.equal(await page.locator('#games-input').inputValue(),'');
      await pickWindow(page,'小克');assert.equal(await page.locator('#games-input').inputValue(),'后来继续写的新草稿');await noErrors(page);
    }finally{await context.close()}
  });
  await run('a window change before combined submission preserves the original draft and board',async()=>{
    const {context,page}=await boot();try{
      await page.click('#games-new');await page.locator('[data-coordinate="H8"]').click();
      await page.evaluate(()=>{
        const original=chatEnsureSessionsReady;let release;
        chatEnsureSessionsReady=()=>new Promise(resolve=>{release=()=>{chatEnsureSessionsReady=original;resolve(chatSessions)}});
        document.getElementById('games-input').value='这句话和棋步属于原窗口';document.getElementById('games-play').click();
        chatSelectSession('ck-gomoku-other');CKGames.onChatUpdate();release();
      });
      await page.waitForFunction(()=>document.getElementById('games-notice').textContent.includes('窗口已切换'));
      await page.waitForFunction(()=>document.getElementById('games-session').value==='ck-gomoku-other');
      assert.equal((await calls(page)).length,0);assert.equal(await page.evaluate(()=>chatSessions.find(s=>s.id==='ck-gomoku-fixture').gomoku.moves.length),0);
      await pickWindow(page,'小克');assert.equal(await page.locator('#games-input').inputValue(),'这句话和棋步属于原窗口');await noErrors(page);
    }finally{await context.close()}
  });
  await run('whitespace stays a draft and play does not create an empty speech record',async()=>{
    const {context,page}=await boot();try{
      await page.click('#games-new');await page.locator('#games-input').fill('  \n  ');await play(page,'H8');await moves(page,2);await idle(page);
      assert.equal((await calls(page)).length,1);assert.equal(await page.evaluate(()=>chatMessages.filter(m=>m.ckGameSpeech).length),0);
      assert.equal(await page.locator('#games-input').inputValue(),'  \n  ');await noErrors(page);
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
      await page.click('#games-new');await page.locator('#games-input').fill('失败也要保留这句话。');await plan(page,{failure:true});await play(page,'H8');await idle(page);
      assert.equal((await calls(page)).length,1);assert.equal(await page.evaluate(()=>chatCurrentSession().gomoku.moves.length),1);
      const original=(await calls(page))[0].body.text;assert.equal(await page.evaluate(()=>chatMessages.filter(m=>m.sendFailed).length),2);
      await page.evaluate(()=>chatSaveSessionsToIndexedDb.pending);await page.reload();await loaded(page);await idle(page);
      assert.equal((await calls(page)).length,0);await page.locator('#games-input').fill('这段新草稿还不发送');
      await page.click('#games-ask');await moves(page,2);await idle(page);assert.equal((await calls(page)).length,1);
      assert.equal((await calls(page))[0].body.text,original);assert.equal(await page.locator('#games-input').inputValue(),'这段新草稿还不发送');
      assert.equal(await page.evaluate(()=>chatMessages.filter(m=>m.ckGameSpeech).length),1);await noErrors(page);
    }finally{await context.close()}
  });
  await run('retrying a combined move cannot sweep in unrelated pending messages',async()=>{
    const {context,page}=await boot();try{
      await page.click('#games-new');await page.locator('#games-input').fill('这句随棋步发送');await plan(page,{failure:true});await play(page,'H8');await idle(page);
      await page.evaluate(()=>{chatMessages.push({role:'pending_user',text:'完整聊天里另外暂存的消息',pendingId:chatPendingMessageId(),ts:Date.now()});chatSaveLocalMessages()});
      await page.locator('#games-input').fill('输入框里继续保留');await page.click('#games-ask');
      await page.waitForFunction(()=>document.getElementById('games-notice').textContent.includes('还有待发或失败消息'));
      assert.equal((await calls(page)).length,1);assert.equal(await page.locator('#games-input').inputValue(),'输入框里继续保留');
      assert.equal(await page.evaluate(()=>chatCurrentSession().gomoku.moves.length),1);await noErrors(page);
    }finally{await context.close()}
  });
  await run('rules are sent once; subsequent moves remain incremental after chat and reload',async()=>{
    const {context,page}=await boot();try{
      await page.click('#games-new');await page.locator('#games-input').fill('第一步和你聊聊。');await play(page,'H8');await moves(page,2);await idle(page);
      const first=(await calls(page))[0].body;assert.match(first.text,/规则：15×15/);
      await say(page,'我还在喝茶。','慢慢喝，我等你。');await idle(page);
      await page.evaluate(()=>chatSaveSessionsToIndexedDb.pending);await page.reload();await loaded(page);
      await page.locator('#games-input').fill('第二步接着聊。');await plan(page,{reply:'那我接在这里。\n【落子：J9】'});await play(page,'G8');await moves(page,4);await idle(page);
      const second=(await calls(page))[0].body;
      assert.equal(second.text,'第 3 手：黑棋 G8。请落白棋。\n\n第二步接着聊。');assert.equal(second.system,first.system);assert.equal(second.client_cache_generation,first.client_cache_generation);
      assert.equal(second.prompt_cache_ttl,'1h');assert.equal(second.execution_backend,'claude_code_subscription');assert.ok(!second.cache_rebuild_boundary);
      assert.ok(second.transport_messages.some(m=>m.role==='user'&&m.content.some(p=>p.text===first.text)),'the old rules stay byte-for-byte in history');
      const events=await page.locator('#games-conversation .ck-game-event').allTextContents();
      for(const text of ['你落子 H8','小克落子 I9','你落子 G8','小克落子 J9'])assert.ok(events.some(e=>e.includes(text)),text);
      const talk=await page.locator('#games-conversation .games-message').allTextContents();
      assert.ok(talk.some(t=>t.includes('我还在喝茶。')));assert.ok(talk.some(t=>t.includes('那我接在这里。')));assert.ok(talk.every(t=>!t.includes('【落子')&&!t.includes('当前黑棋')&&!t.includes('请落白棋')));
      await page.evaluate(()=>{navTo('chat');chatRenderMessages({force:true})});
      assert.equal(await page.locator('#chat-messages .chat-bubble.user').count(),5,'the three typed messages and two old messages have bubbles');
      assert.ok(!(await page.locator('#chat-messages .chat-bubble').allTextContents()).some(t=>/【落子|当前黑棋|请落白棋/.test(t)));
      assert.equal(await page.locator('#chat-messages .ck-game-event').count(),4);await noErrors(page);
    }finally{await context.close()}
  });
  await run('missing middle moves resync the board without repeating rules',async()=>{
    const {context,page}=await boot();try{
      await page.click('#games-new');await play(page,'H8');await moves(page,2);await idle(page);
      await plan(page,{reply:'【落子：J9】'});await play(page,'G8');await moves(page,4);await idle(page);
      await page.evaluate(()=>{const s=chatCurrentSession();s.transportMessages=s.transportMessages.filter(m=>!m.content.some(p=>p.text==='第 3 手：黑棋 G8。请落白棋。'));chatSaveSessions()});
      await plan(page,{reply:'【落子：K9】'});await play(page,'F8');await moves(page,6);await idle(page);
      const text=(await calls(page)).at(-1).body.text;assert.match(text,/当前黑棋：H8、G8、F8/);assert.match(text,/当前白棋：I9、J9/);assert.doesNotMatch(text,/规则|代码块/);await noErrors(page);
    }finally{await context.close()}
  });
  await run('combined moves stay incremental when only visible window history is available',async()=>{
    const {context,page}=await boot();try{
      await page.click('#games-new');await page.locator('#games-input').fill('这步先聊。');await play(page,'H8');await moves(page,2);await idle(page);
      await page.evaluate(()=>{const s=chatCurrentSession();s.transportMessages=[];s.transportUpdated=0;chatSaveSessions()});
      await page.locator('#games-input').fill('这步继续聊。');await plan(page,{reply:'【落子：J9】'});await play(page,'G8');await moves(page,4);await idle(page);
      assert.equal((await calls(page)).at(-1).body.text,'第 3 手：黑棋 G8。请落白棋。\n\n这步继续聊。');await noErrors(page);
    }finally{await context.close()}
  });
  await run('a trim during send preparation restores rules and board in the actual submitted request',async()=>{
    const {context,page}=await boot();try{
      await page.click('#games-new');await play(page,'H8');await moves(page,2);await idle(page);
      await say(page,'这杯茶很好喝。','那就慢慢喝。');await idle(page);
      await page.evaluate(()=>{
        const original=chatApplyAutoTrimForPendingBatch;
        chatApplyAutoTrimForPendingBatch=async function(cfg,pending,request){
          chatApplyAutoTrimForPendingBatch=original;const result=await original(cfg,pending,request),s=chatCurrentSession();
          s.transportMessages=s.transportMessages.slice(-2);chatMessages=chatMessages.slice(-2-pending.length);s.messages=chatMessages;return {...result,trimmed:true};
        };
      });
      await page.locator('#games-input').fill('准备期间裁剪也要带上我这句话。');await plan(page,{reply:'继续这盘，我落这里。\n【落子：J9】'});await play(page,'G8');await moves(page,4);await idle(page);
      const text=(await calls(page)).at(-1).body.text;assert.match(text,/继续这局/);assert.match(text,/规则：15×15/);assert.match(text,/当前黑棋：H8、G8/);assert.match(text,/当前白棋：I9/);
      assert.ok(text.endsWith('\n\n准备期间裁剪也要带上我这句话。'));
      assert.equal(await page.evaluate(()=>chatCurrentSession().gomoku.error),'');await noErrors(page);
    }finally{await context.close()}
  });
  await run('move-only replies and streaming command fragments never appear as speech bubbles',async()=>{
    const {context,page}=await boot();try{
      await page.click('#games-new');await plan(page,{reply:'【落子：I9】',partial:'【落子：',delay:1300});await play(page,'H8');
      await page.waitForFunction(()=>chatSending);await page.waitForTimeout(220);
      assert.ok(!(await page.locator('#games-conversation .games-message').allTextContents()).some(t=>t.includes('【')));
      await page.evaluate(()=>navTo('chat'));await page.waitForTimeout(180);
      assert.ok(!(await page.locator('#chat-messages .chat-bubble').allTextContents()).some(t=>t.includes('【')));
      await moves(page,2);await idle(page);await page.evaluate(()=>chatRenderMessages({force:true}));
      assert.equal(await page.locator('#chat-messages .chat-bubble.assistant').count(),2,'only the old actual speech remains');
      assert.equal(await page.locator('#chat-messages .ck-game-event').filter({hasText:'小克落子 I9'}).count(),1);await noErrors(page);
    }finally{await context.close()}
  });
  await run('legacy ongoing boards use events without rewriting messages and continue with a delta',async()=>{
    const {context,page}=await boot();try{
      await page.evaluate(()=>{
        const text='我们在当前聊天里下五子棋，你还是带着原有记忆的小克，可以一边下棋一边和我正常聊天。\n规则：15×15 棋盘，列 A 到 O 从左到右，行 1 到 15 从上到下。我执黑先手，你执白。轮流落一子，横、竖、斜任意连续五子或更多即胜，没有禁手。\n当前黑棋：H6、I6。\n当前白棋：H8。\n上一手：我，黑棋 I6。\n现在轮到你落白棋，第 4 手。\n可以先自然回复我，再在最后单独一行写【落子：坐标】。';
        const s=chatCurrentSession(),user={role:'user',text,turnId:'legacy-game',ts:Date.now()-2000,ckGame:{gameId:'g-legacy-ui',requestId:'r-legacy',caption:'我落黑棋 I6。'}},reply={role:'assistant',text:'我堵你。\n【落子：J6】',turnId:'legacy-game',ts:Date.now()-1000};
        s.gomoku={version:1,id:'g-legacy-ui',created:1,moves:['H6','H8','I6','J6']};chatMessages.push(user,reply);s.messages=chatMessages;
        s.transportMessages.push(...[user,reply].map(m=>({role:m.role,content:[{type:'text',text:m.text}]})));window.__legacyRaw=text;chatSaveSessions();CKGames.onChatUpdate();
      });
      await moves(page,4);await page.waitForTimeout(100);
      assert.equal(await page.locator('#games-conversation .ck-game-event').filter({hasText:'你落子 I6'}).count(),1);
      assert.equal(await page.locator('#games-conversation .ck-game-event').filter({hasText:'小克落子 J6'}).count(),1);
      await plan(page,{reply:'【落子：G8】'});await play(page,'G6');await moves(page,6);await idle(page);
      assert.equal((await calls(page))[0].body.text,'第 5 手：黑棋 G6。请落白棋。');
      assert.equal(await page.evaluate(()=>chatMessages.find(m=>m.role==='user'&&m.turnId==='legacy-game').text===__legacyRaw),true);await noErrors(page);
    }finally{await context.close()}
  });
  await run('corrections are system events and ordinary typed coordinates remain speech',async()=>{
    const {context,page}=await boot();try{
      await page.click('#games-new');await plan(page,{reply:'【落子：H8】'});await play(page,'H8');await idle(page);
      await plan(page,{reply:'【落子：I9】'});await page.click('#games-ask');await moves(page,2);await idle(page);
      const correction=(await calls(page)).at(-1).body.text;assert.match(correction,/未生效/);assert.doesNotMatch(correction,/规则|代码块/);
      assert.equal(await page.locator('#games-conversation .ck-game-event').filter({hasText:'请小克重新落子'}).count(),1);
      await say(page,'我只是举例：【落子：J10】','知道啦，这是你举的例子。');await idle(page);
      assert.ok((await page.locator('#games-conversation .games-message.from-user').allTextContents()).some(t=>t.includes('我只是举例：【落子：J10】')));
      assert.equal(await page.evaluate(()=>chatCurrentSession().gomoku.moves.length),2);await noErrors(page);
    }finally{await context.close()}
  });
  fs.writeFileSync(path.join(out,'browser-verification.json'),JSON.stringify({passed:true,syntheticData:true,externalRequestsBlocked:true,realChatSender:true,cases},null,2));
  console.log('PASS '+cases.length+' browser scenarios');
})().catch(error=>{console.error(error);process.exitCode=1}).finally(async()=>{if(browser)await browser.close();server.close()});
