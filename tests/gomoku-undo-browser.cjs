/* Synthetic replies use the real game controls and chat submission path. */
const assert=require('node:assert/strict'),path=require('node:path');
module.exports=async function({run,boot,loaded,idle,plan,moves,play,say,calls,pickWindow,noErrors,out}){
  async function pair(page){await page.click('#games-new');await play(page,'H8');await moves(page,2);await idle(page)}
  async function four(page){await pair(page);await plan(page,{reply:'继续陪你。\n【落子：J9】'});await play(page,'G8');await moves(page,4);await idle(page)}
  async function undo(page){await plan(page,{reply:'好呀，你重新选。'});await page.click('#games-undo');await idle(page)}
  async function board(page){return page.evaluate(()=>chatCurrentSession().gomoku)}
  async function otherWindow(page){return page.evaluate(()=>{const s=chatSessions.find(s=>s.id==='ck-gomoku-other');return {id:s.id,messages:s.messages,transport:s.transportMessages,game:s.gomoku,generation:s.cacheGeneration,wake:s.wakeEnabled}})}
  for(const width of [1440,768,390])await run('undo by the user preserves the conversation, drafts and round order at '+width,async()=>{
    const {context,page}=await boot(width);try{
      assert.equal(await page.locator('#games-undo').isDisabled(),true);await four(page);
      const before=await page.evaluate(()=>({messages:chatMessages,transport:chatCurrentSession().transportMessages,
        system:chatComposeSystemPrompt(chatLoadConfig()),generation:chatCurrentSession().cacheGeneration,
        wake:chatCurrentSession().wakeEnabled}));
      before.other=await otherWindow(page);
      await page.locator('#games-input').fill('这句话留着，等重新落子再说。');await page.locator('[data-coordinate="F8"]').click();
      await plan(page,{reply:'好呀，你重新选。'});await page.locator('#games-undo').focus();await page.keyboard.press('Enter');await idle(page);
      assert.deepEqual((await board(page)).moves,['H8','I9']);assert.equal((await board(page)).revision,1);
      assert.equal(await page.locator('#games-turn').textContent(),'轮到你，执黑');
      assert.equal(await page.locator('#games-move-count').textContent(),'已落 2 手');
      assert.equal(await page.locator('[data-coordinate="F8"]').getAttribute('aria-selected'),'false');
      assert.equal(await page.locator('#games-input').inputValue(),'这句话留着，等重新落子再说。');
      const sent=await calls(page);assert.equal(sent.length,3);const request=sent.at(-1).body;
      assert.match(request.text,/我已悔棋/);assert.match(request.text,/当前黑棋：H8。/);assert.match(request.text,/当前白棋：I9。/);
      assert.doesNotMatch(request.text,/规则：|悔棋约定：|G8|J9|这句话留着/);
      assert.deepEqual(request.transport_messages,before.transport);assert.equal(request.system,before.system);
      assert.equal(request.client_cache_generation,before.generation);assert.equal(request.prompt_cache_ttl,'1h');
      assert.equal(request.execution_backend,'claude_code_subscription');assert.ok(!request.cache_rebuild_boundary);
      assert.deepEqual(await page.evaluate(n=>chatMessages.slice(0,n),before.messages.length),before.messages);
      assert.deepEqual(await otherWindow(page),before.other);
      assert.equal(await page.evaluate(()=>chatCurrentSession().wakeEnabled),before.wake);
      await page.screenshot({path:path.join(out,'undo-user-'+width+'.png'),fullPage:true});
      await page.locator('.games-rules summary').click();assert.match(await page.locator('#games-undo-help').textContent(),/双方都可选择悔棋/);
      await page.screenshot({path:path.join(out,'undo-rules-'+width+'.png'),fullPage:true});await page.locator('.games-rules summary').click();
      if(width===390){await page.evaluate(()=>document.body.classList.add('dark'));await page.screenshot({path:path.join(out,'undo-user-dark.png'),fullPage:true});await page.evaluate(()=>document.body.classList.remove('dark'))}
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
      await page.evaluate(()=>{navTo('chat');chatRenderMessages({force:true})});
      const notice=page.locator('#chat-messages .ck-game-event').filter({hasText:'你悔棋'});assert.equal(await notice.count(),1);
      assert.match(await notice.textContent(),/撤回黑棋 G8、白棋 J9/);
      assert.ok(!(await page.locator('#chat-messages .chat-bubble').allTextContents()).some(text=>/我已悔棋|悔棋约定/.test(text)));
      await notice.click();await loaded(page);await undo(page);assert.deepEqual((await board(page)).moves,[]);assert.equal((await board(page)).revision,2);
      assert.equal(await page.locator('#games-undo').isDisabled(),true);assert.equal(await page.locator('#chat-game-return').getAttribute('hidden'),'');
      await page.evaluate(()=>chatSaveSessionsToIndexedDb.pending);await page.reload();await loaded(page);
      assert.deepEqual((await board(page)).moves,[]);assert.equal((await board(page)).revision,2);assert.equal((await calls(page)).length,0);
      await play(page,'H8');await moves(page,2);await idle(page);
      assert.equal((await calls(page))[0].body.text,'第 1 手：黑棋 H8。请落白棋。');await noErrors(page);
    }finally{await context.close().catch(()=>{})}
  });
  await run('undo is optional for white, atomic after streaming and followed by a single board sync',async()=>{
    const {context,page}=await boot();try{
      await four(page);assert.equal((await board(page)).revision,0,'normal replies never cause an automatic undo');
      await plan(page,{reply:'这一步我想换一下。\n【悔棋：K9】',partial:'这一步我想换一下。\n【悔棋：',delay:1500});await play(page,'F8');
      await page.waitForFunction(()=>chatSending);await page.waitForTimeout(200);
      assert.equal((await board(page)).moves.length,5);assert.equal((await board(page)).revision,0);
      assert.doesNotMatch(await page.locator('#games-conversation').textContent(),/【悔/);
      await idle(page);assert.deepEqual((await board(page)).moves,['H8','I9','G8','K9']);assert.equal((await board(page)).revision,1);
      assert.equal((await calls(page)).length,3);assert.match(await page.locator('#games-notice').textContent(),/小克悔棋/);
      assert.ok(await page.evaluate(()=>chatMessages.some(m=>m.role==='assistant'&&m.text.includes('【悔棋：K9】'))));
      await page.evaluate(()=>{navTo('chat');chatRenderMessages({force:true})});
      const notice=page.locator('#chat-messages .ck-game-event').filter({hasText:'小克悔棋'});assert.equal(await notice.count(),1);
      assert.match(await notice.textContent(),/撤回白棋 J9、黑棋 F8，改下 K9/);
      assert.ok(!(await page.locator('#chat-messages .chat-bubble').allTextContents()).some(text=>/【悔棋/.test(text)));
      await page.screenshot({path:path.join(out,'undo-white-event.png'),fullPage:true});await notice.click();await loaded(page);
      await page.evaluate(()=>chatSaveSessionsToIndexedDb.pending);await page.reload();await loaded(page);
      assert.equal((await calls(page)).length,0);assert.equal((await board(page)).revision,1);
      await plan(page,{reply:'【落子：L9】'});await play(page,'F8');await moves(page,6);await idle(page);
      let prompt=(await calls(page)).at(-1).body.text;assert.match(prompt,/当前黑棋：H8、G8、F8。/);assert.match(prompt,/当前白棋：I9、K9。/);
      assert.doesNotMatch(prompt,/规则：|悔棋约定：/);
      await plan(page,{reply:'【落子：M9】'});await play(page,'E8');await moves(page,8);await idle(page);
      assert.equal((await calls(page)).at(-1).body.text,'第 7 手：黑棋 E8。请落白棋。');await noErrors(page);
    }finally{await context.close().catch(()=>{})}
  });
  await run('invalid or ambiguous white undo never partially removes either stone',async()=>{
    const {context,page}=await boot();try{
      await pair(page);await plan(page,{reply:'【悔棋：H8】'});await play(page,'G8');await idle(page);
      assert.deepEqual((await board(page)).moves,['H8','I9','G8']);assert.equal((await board(page)).revision,0);
      assert.match((await board(page)).error,/已经有棋子/);assert.equal((await calls(page)).length,2);
      await plan(page,{reply:'【悔棋：J9】\n【落子：K9】'});await page.click('#games-ask');await idle(page);
      assert.deepEqual((await board(page)).moves,['H8','I9','G8']);assert.equal((await board(page)).revision,0);
      await plan(page,{reply:'【落子：J9】'});await page.click('#games-ask');await moves(page,4);await idle(page);
      assert.deepEqual((await board(page)).moves,['H8','I9','G8','J9']);await noErrors(page);
    }finally{await context.close().catch(()=>{})}
  });
  await run('undo of a lone black move is available after an invalid first white action',async()=>{
    const {context,page}=await boot();try{
      await page.click('#games-new');await plan(page,{reply:'【悔棋：I9】'});await play(page,'H8');await idle(page);
      assert.deepEqual((await board(page)).moves,['H8']);assert.match((await board(page)).error,/还没有/);
      await undo(page);assert.deepEqual((await board(page)).moves,[]);assert.equal((await board(page)).pending,null);assert.equal((await board(page)).error,'');
      assert.equal((await calls(page)).length,2);await noErrors(page);
    }finally{await context.close().catch(()=>{})}
  });
  await run('ordinary conversation and quoted undo examples cannot change the board',async()=>{
    const {context,page}=await boot();try{
      await pair(page);const before=await board(page);
      await say(page,'我们聊聊悔棋这个词。','只是聊这个词。\n【悔棋：J9】');await idle(page);assert.deepEqual(await board(page),before);
      assert.match(await page.locator('#games-conversation').textContent(),/【悔棋：J9】/,'ordinary speech is not a game command');
      await plan(page,{reply:'> 【悔棋：K9】\n这行只是例子。\n【落子：J9】'});await play(page,'G8');await moves(page,4);await idle(page);
      assert.equal((await board(page)).revision,0);await noErrors(page);
    }finally{await context.close().catch(()=>{})}
  });
  await run('undo blocks while replies recover or fail and preserves pending evidence',async()=>{
    const {context,page}=await boot();try{
      await page.click('#games-new');await plan(page,{reply:'【落子：I9】',delay:1400});await play(page,'H8');
      await page.waitForFunction(()=>chatSending);const pending=(await board(page)).pending.id;
      assert.equal(await page.locator('#games-undo').isDisabled(),true);
      await page.evaluate(()=>document.getElementById('games-undo').dispatchEvent(new Event('click')));await page.waitForTimeout(80);
      assert.equal((await board(page)).pending.id,pending);assert.equal((await calls(page)).length,1);await idle(page);
      for(const variable of ['chatRecoverInFlightBusy','chatTrimBusy']){
        await page.evaluate(variable=>{window[variable]=true;CKGames.onChatUpdate()},variable);
        await page.waitForFunction(()=>document.getElementById('games-undo').disabled);
        await page.evaluate(()=>document.getElementById('games-undo').dispatchEvent(new Event('click')));await page.waitForTimeout(30);
        assert.deepEqual((await board(page)).moves,['H8','I9']);assert.equal((await calls(page)).length,1);
        await page.evaluate(variable=>{window[variable]=false;CKGames.onChatUpdate()},variable);
      }
      await plan(page,{failure:true});await play(page,'G8');await idle(page);
      assert.equal(await page.locator('#games-undo').isDisabled(),true);assert.equal((await board(page)).moves.length,3);
      assert.equal(await page.evaluate(()=>chatMessages.filter(m=>m.sendFailed).length),1);assert.equal((await calls(page)).length,2);
      await plan(page,{reply:'【落子：J9】'});await page.click('#games-ask');await moves(page,4);await idle(page);
      assert.equal(await page.locator('#games-undo').isEnabled(),true);await noErrors(page);
    }finally{await context.close().catch(()=>{})}
  });
  await run('double undo clicks submit once and preserve text typed while preparing',async()=>{
    const {context,page}=await boot();try{
      await four(page);await plan(page,{reply:'好，重来这一步。'});
      await page.evaluate(()=>{
        const original=chatEnsureSessionsReady;let release;
        chatEnsureSessionsReady=()=>new Promise(resolve=>{release=()=>{chatEnsureSessionsReady=original;resolve(chatSessions)}});
        document.getElementById('games-undo').click();document.getElementById('games-undo').click();
        const input=document.getElementById('games-input');input.value='这段还没发';input.dispatchEvent(new Event('input'));
        document.getElementById('games-play').click();release();
      });
      await idle(page);assert.deepEqual((await board(page)).moves,['H8','I9']);assert.equal((await calls(page)).length,3);
      assert.equal(await page.locator('#games-input').inputValue(),'这段还没发');assert.doesNotMatch((await calls(page)).at(-1).body.text,/这段还没发/);await noErrors(page);
    }finally{await context.close().catch(()=>{})}
  });
  await run('a window switch during undo preparation cannot mutate either window',async()=>{
    const {context,page}=await boot();try{
      await pair(page);const before=await board(page);
      await page.evaluate(()=>{
        const original=chatEnsureSessionsReady;let release;
        chatEnsureSessionsReady=()=>new Promise(resolve=>{release=()=>{chatEnsureSessionsReady=original;resolve(chatSessions)}});
        document.getElementById('games-undo').click();chatSelectSession('ck-gomoku-other');CKGames.onChatUpdate();release();
      });
      await page.waitForFunction(()=>document.getElementById('games-notice').textContent.includes('窗口已切换'));
      assert.deepEqual(await page.evaluate(()=>chatSessions.find(s=>s.id==='ck-gomoku-fixture').gomoku),before);
      assert.equal((await calls(page)).length,1);assert.equal(await page.evaluate(()=>chatCurrentSession().gomoku),null);await noErrors(page);
    }finally{await context.close().catch(()=>{})}
  });
  await run('failed undo notification survives reload and manual retry without undoing twice',async()=>{
    const {context,page}=await boot();try{
      await four(page);await plan(page,{failure:true});await page.click('#games-undo');await idle(page);
      assert.deepEqual((await board(page)).moves,['H8','I9']);assert.equal((await board(page)).revision,1);
      const original=(await calls(page)).at(-1).body.text;
      assert.equal(await page.evaluate(()=>chatMessages.filter(m=>m.sendFailed&&m.ckGame.kind==='undo').length),1);
      await page.evaluate(()=>chatSaveSessionsToIndexedDb.pending);await page.reload();await loaded(page);await idle(page);
      assert.equal((await calls(page)).length,0);assert.equal(await page.locator('#games-undo').isDisabled(),true);
      await plan(page,{reply:'好，轮到你重新落。'});
      await page.evaluate(()=>{const message=chatMessages.find(m=>m.sendFailed&&m.ckGame&&m.ckGame.kind==='undo');
        return chatSubmitPendingMessages({inputSnapshot:true,extraText:'',draftImages:[],draftFiles:[],pendingIds:[message.pendingId]})});
      await idle(page);assert.equal((await calls(page)).length,1);assert.equal((await calls(page))[0].body.text,original);
      assert.deepEqual((await board(page)).moves,['H8','I9']);assert.equal((await board(page)).revision,1);await noErrors(page);
    }finally{await context.close().catch(()=>{})}
  });
  await run('old replies cannot restore stones after undo or contaminate an equal-length new turn',async()=>{
    const {context,page}=await boot();try{
      await four(page);const old=await page.evaluate(()=>chatMessages.filter(m=>m.role==='assistant').at(-1));await undo(page);
      await plan(page,{reply:'【落子：K9】',delay:1200});await play(page,'G8');await page.waitForFunction(()=>chatSending);
      await page.evaluate(old=>{chatMessages.push({...old,ts:Date.now()});CKGames.onChatUpdate()},old);await page.waitForTimeout(180);
      assert.deepEqual((await board(page)).moves,['H8','I9','G8']);assert.equal((await board(page)).revision,1);
      await idle(page);assert.deepEqual((await board(page)).moves,['H8','I9','G8','K9']);
      await page.evaluate(()=>{CKGames.onChatUpdate();CKGames.onChatUpdate()});await page.waitForTimeout(80);
      assert.equal((await board(page)).moves.length,4);assert.equal((await calls(page)).length,4);await noErrors(page);
    }finally{await context.close().catch(()=>{})}
  });
  await run('a missing undo notification forces a board sync even when the new first coordinate repeats',async()=>{
    const {context,page}=await boot();try{
      await pair(page);await undo(page);
      await page.evaluate(()=>{const s=chatCurrentSession();s.transportMessages=s.transportMessages.filter(m=>!m.content.some(p=>p.text&&p.text.includes('我已悔棋')));chatSaveSessions()});
      await play(page,'H8');await moves(page,2);await idle(page);
      const prompt=(await calls(page)).at(-1).body.text;
      assert.match(prompt,/核对当前棋盘/);assert.match(prompt,/当前黑棋：H8。/);assert.match(prompt,/当前白棋：无。/);
      assert.doesNotMatch(prompt,/规则：|悔棋约定：/);await noErrors(page);
    }finally{await context.close().catch(()=>{})}
  });
  await run('a disconnected white undo is recovered exactly once without another model request',async()=>{
    const {context,page}=await boot();try{
      await pair(page);await plan(page,{reply:'【悔棋：J9】',disconnect:true,durableReceipt:true});await play(page,'G8');await idle(page);
      await page.waitForFunction(()=>chatCurrentSession().gomoku.revision===1);
      assert.deepEqual((await board(page)).moves,['H8','J9']);assert.equal((await calls(page)).length,2);
      await page.evaluate(()=>chatSaveSessionsToIndexedDb.pending);await page.reload();await loaded(page);await idle(page);
      assert.equal((await board(page)).revision,1);assert.deepEqual((await board(page)).moves,['H8','J9']);assert.equal((await calls(page)).length,0);await noErrors(page);
    }finally{await context.close().catch(()=>{})}
  });
  await run('undo reopens a won board but an explicitly ended game cannot be reopened',async()=>{
    const {context,page}=await boot();try{
      await page.click('#games-new');await page.evaluate(()=>{chatCurrentSession().gomoku.moves=['D8','A1','E8','C1','F8','E1','G8','G1','H8'];chatSaveSessions();CKGames.onChatUpdate()});
      await page.waitForFunction(()=>document.getElementById('games-turn').textContent==='你赢了');
      assert.equal(await page.locator('#games-undo').isEnabled(),true);await undo(page);
      assert.equal((await board(page)).moves.length,8);assert.equal(await page.locator('#games-turn').textContent(),'轮到你，执黑');
      await page.evaluate(()=>{chatCurrentSession().gomoku.closed=true;chatSaveSessions();CKGames.onChatUpdate()});
      await page.waitForFunction(()=>document.getElementById('games-undo').disabled);assert.equal((await calls(page)).length,1);await noErrors(page);
    }finally{await context.close().catch(()=>{})}
  });
};
