(function(root){
  'use strict';
  var timer=0,busy=false,wakeBusy=false,gameModel='claude-opus-4-6';
  var promptFields=['system','systemPromptEnabled','thinkingPrompt','fakeThinkingPrompt','thinkingPromptEnabled',
    'thinkingMode','thinkingBudgetTokens','thinkingEffort','fakeThinking','thinkingInjectionPosition'];
  function current(){return root.chatSessions&&root.chatSessions.find(function(s){return s.id===root.chatActiveSessionId})}
  function rows(s){return s===current()?root.chatMessages:s.messages||[]}
  function profile(s){return s&&s.gameWindow&&s.gameWindow.version===1?s.gameWindow:null}
  function parent(s){var p=profile(s);return p?(root.chatSessions||[]).find(function(x){return x.id===p.parentId}):s}
  function gameFor(s){return profile(s)?s:(root.chatSessions||[]).find(function(x){var p=profile(x);return p&&s&&p.parentId===s.id})}
  function save(s){root.chatSaveSessions({sessionIds:[s.id]})}
  function applyModel(s){
    var p=profile(s);
    if(p&&p.model!==gameModel){p.model=gameModel;save(s)}
    return p;
  }
  function uid(){return root.crypto&&root.crypto.randomUUID?root.crypto.randomUUID():Date.now().toString(36)+'-'+Math.random().toString(36).slice(2)}
  function routeStamp(){var cfg=root.chatLoadConfig();return root.chatEndpoint(cfg)+'|'+((root.CKBackendRoute&&root.CKBackendRoute.current.execution)||'direct_api')}
  function idle(){return !root.chatSending&&!root.chatRecoverInFlightBusy&&!root.chatTrimBusy&&!root.chatTrimTransaction&&!root.chatDeleteDigestBusy&&!root.ckBackendSwitchBusy&&!(root.chatEditingIndex>=0)}
  function safe(s,own){return !s.replyDraft&&!rows(s).some(function(m){return m!==own&&(m.inFlight||m.role==='pending_user'||m.sendFailed)})}
  function select(s){
    if(!s||!idle())return false;
    if(s!==current())root.chatSelectSession(s.id);
    return current()===s;
  }
  function pendingReports(s){var p=profile(s);return p?(p.reports||[]).filter(function(r){return r.state!=='delivered'&&r.state!=='superseded'}):[]}
  async function ensureWake(s){
    var p=profile(s),main=parent(s);if(!p||p.wakeConfigured||wakeBusy)return;
    if(!main)throw Error('原主窗口已不存在，请先保留或导出本局总结。');
    wakeBusy=true;
    try{
      var cfg=root.chatLoadConfig(),mainState=await root.chatWakeRequest(null,main.id,cfg);
      if(!mainState)throw Error('唤醒连接已变化，请重试。');
      // One-time initialization only. Later manual/idle/quota decisions remain authoritative.
      if(mainState.enabled!==true&&mainState.status!=='auto_off')mainState=await root.chatWakeRequest({enabled:true},main.id,cfg);
      var gameState=await root.chatWakeRequest(null,s.id,cfg);
      if(!gameState)throw Error('无法确认游戏窗口唤醒。');
      var changes={enabled:true,idle_shutdown_enabled:mainState.idle_shutdown_enabled===true,idle_shutdown_minutes:mainState.idle_shutdown_minutes||30};
      if(root.chatWakeSubscription())changes.interval_seconds=3000;
      else if(mainState.interval_seconds)changes.interval_seconds=mainState.interval_seconds;
      var result=await root.chatWakeRequest(changes,s.id,cfg);
      if(!result||result.enabled!==true)throw Error('游戏窗口唤醒未开启。');
      p.wakeConfigured=true;p.wakeError='';save(s);
    }catch(error){p.wakeError='唤醒未配置完成，请点击重试。';save(s);throw error}
    finally{wakeBusy=false;render()}
  }
  async function begin(s,game){
    var main=parent(s);if(!main)throw Error('原主窗口已不存在。');
    if(!idle())throw Error('等当前回复或处理完成后再开新局。');
    var existing=gameFor(main);
    if(existing&&pendingReports(existing).length)throw Error('上一局总结还未同步，请先完成或处理失败记录。');
    if(existing&&!safe(existing))throw Error('游戏窗口还有未完成消息，请先处理。');
    var cfg=root.chatLoadConfig(),snapshot={};
    promptFields.forEach(function(k){if(cfg[k]!==undefined)snapshot[k]=cfg[k]});
    if(!existing){
      existing=root.chatNormalizeSession({id:'ck-game-'+uid(),title:(main.title||'小克')+' · 五子棋',messages:[],created:Date.now(),updated:Date.now(),
        gameWindow:{version:1,parentId:main.id,model:gameModel,reports:[]}});
      root.chatSessions.unshift(existing);
    }
    var p=profile(existing);p.model=gameModel;p.prompts=snapshot;p.route=routeStamp();p.gameId=game.id;p.startedAt=Date.now();delete p.nextGame;delete p.nextGameError;
    existing.gomoku=game;
    existing.messages.push({role:'game_boundary',gameId:game.id,ts:p.startedAt});
    // Visible records remain in this reusable window; only this game's transport is active.
    existing.transportMessages=[];existing.transportUpdated=0;existing.firstUserText='';existing.firstUserTs=0;
    existing.cacheGeneration=(Number(existing.cacheGeneration)||0)+1;
    ['cacheFullCreatedAt','cacheFullCreateTokens','cacheLastReadAt','cacheLastReadTokens','systemPromptCacheUntil'].forEach(function(k){existing[k]=0});
    save(existing);
    if(!select(existing))throw Error('窗口正在处理，请稍后打开游戏。');
    try{await ensureWake(existing)}catch(error){root.toast('棋局已创建；游戏唤醒未配置完成，请点“重试唤醒”。',5000)}
    return existing;
  }
  function config(cfg,s){
    var p=applyModel(s);if(!p)return cfg;
    return Object.assign({},cfg,p.prompts||{},{model:gameModel,recall:false,useMcp:false,
      dailyDigestEnabled:false,autoTrimEnabled:false,autoTrimRoundLimitEnabled:false,autoCleanEnabled:false,
      ncContextInjection:false,minimalTimeEnabled:false,backendSwitchNotification:false,worldbooks:[]});
  }
  function contextRows(s,list){
    var p=profile(s);list=list||rows(s);if(!p)return list;
    var index=-1;list.forEach(function(m,i){if(m.role==='game_boundary'&&m.gameId===p.gameId)index=i});
    return index>=0?list.slice(index+1):list.filter(function(m){return Number(m.ts)>=p.startedAt});
  }
  function body(value,s){
    var p=applyModel(s);if(!p)return value;
    value.game_context={version:1,kind:'gomoku',game_id:p.gameId,parent_session_id:p.parentId};
    value.model=gameModel;value.worldbook_pack='';value.daily_digest_pack='';value.memory_pack='';
    value.recall=false;value.use_mcp=false;value.nc_context_injection=false;value.minimal_time_enabled=false;
    value.backend_switch_notification=false;value.chat_polling_enabled=false;delete value.digest_queue;delete value.mcp_url;
    return value;
  }
  function beforeSend(s){var p=profile(s);if(p&&p.route!==routeStamp())throw Error('游戏窗口的连接已切换，请恢复开局时的连接后继续。')}
  function ended(s){var g=s.gomoku;if(!g)return false;var b=root.CKGomoku.position(g.moves);return !!(g.closed||b.winner||b.draw)}
  function reportId(g){return g.id+'-r'+(g.revision||0)+'-p'+g.moves.length}
  function observe(s){
    var p=profile(s),g=s.gomoku;if(!p||!g)return;
    var rid=reportId(g),changed=false;
    (p.reports||[]).forEach(function(r){
      if(r.gameId===g.id&&r.id!==rid&&r.state!=='delivered'&&r.state!=='superseded'&&!r.summaryMessage){r.state='superseded';changed=true}
    });
    if(ended(s)&&g.moves.length&&!g.pending&&!(p.reports||[]).some(function(r){return r.id===rid})){
      var board=root.CKGomoku.position(g.moves);
      p.reports.push({id:rid,gameId:g.id,revision:g.revision||0,moves:g.moves.slice(),result:board.winner==='black'?'用户获胜':board.winner==='white'?'小克获胜':board.draw?'和棋':'手动结束',state:'queued',created:Date.now()});
      changed=true;
    }
    if(changed)save(s);
  }
  function speech(m){var text=String(m.text||'');return typeof root.chatSplitThinkingText==='function'?root.chatSplitThinkingText(text,{hideUnclosedThinking:true}).text||'':text}
  function response(s,message){
    if(message.inFlight||s.replyDraft&&s.replyDraft.turn_id===message.turnId)return {waiting:true};
    if(message.sendFailed||message.stopped)return {error:'请求未完成，请检查后手动重试。'};
    if(message.role==='pending_user')return {unsent:true};
    var replies=rows(s).filter(function(m){return m.role==='assistant'&&m.turnId===message.turnId});
    if(!replies.length||replies.some(function(m){return m.failed||m.error||m.stopped}))return {error:'尚未取得完整回复，请在完整聊天中补收或处理。'};
    var text=replies.map(speech).join('\n').trim();
    return text?{text:text}:{error:'完整回复没有总结正文，请检查后手动处理。'};
  }
  function findMessage(s,ident){return rows(s).find(function(m){return m.ckGameSummary&&m.ckGameSummary.id===ident})}
  function addMessage(s,r,kind,text){
    var ident=r.id+'-'+kind,m=findMessage(s,ident);if(m)return m;
    m={role:'pending_user',text:text,ts:Date.now(),turnId:'turn-game-'+ident,pendingId:root.chatPendingMessageId(),ckGameSummary:{id:ident,gameId:r.gameId,kind:kind,autoText:text,gameSessionId:r.gameSessionId}};
    rows(s).push(m);s.messages=rows(s);save(s);return m;
  }
  async function send(s,m){
    beforeSend(s);
    if(!idle()||!safe(s,m)||!select(s))return false;
    root.chatEnsurePendingMessageId(m);
    root.chatRenderMessages({respectUserScroll:true});
    await root.chatSubmitPendingMessages({inputSnapshot:true,extraText:'',draftImages:[],draftFiles:[],pendingIds:[m.pendingId],gameAutomation:true});
    return true;
  }
  async function step(s,r){
    var main=parent(s),p=profile(s);if(!main){r.state='failed';r.error='原主窗口已不存在，本局记录已保留。';save(s);return}
    beforeSend(s);
    r.gameSessionId=s.id;
    var stage=r.summaryText?'delivery':'summary',target=stage==='summary'?s:main,field=stage+'Message';
    var interrupted=r[field]&&findMessage(target,r[field]);
    if(interrupted&&interrupted.inFlight&&idle()){
      var viewed=current();
      if(select(target))try{await root.chatRecoverInterruptedTurns({silent:true})}finally{if(viewed&&idle())select(viewed)}
    }
    if(!idle()||!safe(target,r[field]&&findMessage(target,r[field])))return;
    var m=r[field]&&findMessage(target,r[field]);
    if(r[field]&&!m){r.state='failed';r.error='对应消息已被移除，请检查记录；系统不会重新生成。';save(s);return}
    if(m&&m.text!==m.ckGameSummary.autoText){r.state='failed';r.error='对应系统消息已被编辑，请在完整聊天中核对后处理。';save(s);return}
    if(!m){
      if(stage==='summary'){
        if(!ended(s)||reportId(s.gomoku)!==r.id){r.state='superseded';save(s);return}
        m=addMessage(s,r,'summary','【系统通知：五子棋本局结束】\n结果：'+r.result+'；共 '+r.moves.length+' 手。\n棋谱：'+r.moves.join('、')+'。\n请由你给主窗口的小克写一份本局总结，保留结果、我们聊到的事情、语气和待续话题。只根据本局内容，不虚构主窗口记忆。用平常的语气简洁写，建议 200～400 字，必要时可更长；不要输出思考过程或落子指令。系统会把你的完整总结原文自动发送给主窗口。');
      }else{
        m=addMessage(main,r,'delivery','【系统通知：游戏窗口小克的本局总结】\n'+r.summaryText+'\n【系统通知结束】\n这是同一场五子棋结束后的完整总结。若本局有悔棋后的旧结果，以本次为准。请承接本局经历和未完话题，简短回应即可。');
      }
      r[field]=m.ckGameSummary.id;r.state=stage==='summary'?'summarizing':'delivering';r.error='';save(s);
    }
    var outcome=response(target,m);
    if(outcome.unsent){
      var returnTo=current();
      try{await send(target,m)}finally{
        // The input draft is never submitted by automation. Return to the viewed window.
        if(returnTo&&current()===target&&idle()&&(root.chatSessions||[]).indexOf(returnTo)>=0)select(returnTo);
      }
      outcome=response(target,m);
    }
    if(outcome.waiting||outcome.unsent)return;
    if(outcome.error){r.state='failed';r.error=outcome.error;save(s);return}
    if(stage==='summary'){r.summaryText=outcome.text;r.state='ready';r.summaryTurnId=m.turnId}
    else{r.state='delivered';r.deliveryTurnId=m.turnId;r.deliveredAt=Date.now()}
    save(s);
  }
  async function pump(){
    timer=0;if(busy||!root.chatSessionsReady)return;
    busy=true;
    try{
      var sessions=(root.chatSessions||[]).filter(profile);
      for(var s of sessions){
        observe(s);
        for(var r of pendingReports(s)){
          if(r.state==='failed'){
            var target=r.summaryText?parent(s):s,ident=r.summaryText?r.deliveryMessage:r.summaryMessage,m=target&&ident&&findMessage(target,ident);
            if(!m||m.text!==m.ckGameSummary.autoText||profile(s).route!==routeStamp()||!response(target,m).text)continue;
            // A user may have recovered/retried the original turn in full chat.
            r.state=r.summaryText?'delivering':'summarizing';r.error='';save(s);
          }
          if(!idle())return;
          try{await step(s,r)}catch(error){r.state='failed';r.error=error.message||'总结同步未完成，请检查后重试。';save(s)}
          if(r.state==='ready')schedule(50);
        }
        var p=profile(s);
        if(p.nextGame&&!p.nextGameError&&!pendingReports(s).length&&idle()&&safe(s)){
          try{beforeSend(s);await begin(s,p.nextGame);if(root.CKGames)root.CKGames.onChatUpdate()}
          catch(error){p.nextGameError=error.message;save(s)}
        }
      }
    }finally{busy=false;render()}
  }
  function schedule(delay){if(!timer)timer=setTimeout(pump,delay===undefined?250:delay)}
  function update(){if(!root.chatSessionsReady)return;(root.chatSessions||[]).forEach(function(s){applyModel(s);observe(s)});schedule();render()}
  async function retry(){
    var s=gameFor(current()),r=s&&pendingReports(s).find(function(x){return x.state==='failed'});if(!r||!idle())return;
    var target=r.summaryText?parent(s):s,ident=r.summaryText?r.deliveryMessage:r.summaryMessage,m=target&&ident&&findMessage(target,ident);
    if(m&&m.sendFailed){
      r.state=r.summaryText?'delivering':'summarizing';r.error='';save(s);
      busy=true;var previous=current();
      try{await send(target,m)}finally{if(previous&&idle())select(previous);busy=false;schedule()}
    }else if(!ident){r.state=r.summaryText?'ready':'queued';r.error='';save(s);schedule()}
    else{root.toast('请先在完整聊天中补收或处理原消息，系统不会重放已有请求。',5000)}
    render();
  }
  function messageView(m){
    var meta=m&&m.ckGameSummary;if(!meta||m.text!==meta.autoText)return null;
    return {text:'',automatic:true,notice:meta.kind==='summary'?'正在整理本局总结':m.sendFailed?'本局总结发送未完成':m.inFlight||m.role==='pending_user'?'正在发送本局总结':'已发送本局总结'};
  }
  function render(){
    var s=gameFor(current()),p=profile(s),info=document.getElementById('games-window-info'),wake=document.getElementById('games-wake-status'),status=document.getElementById('games-sync-status'),retryButton=document.getElementById('games-sync-retry'),wakeButton=document.getElementById('games-wake-retry');
    if(info)info.textContent=p?'独立游戏窗口 · Opus 4.6':'新的一局会使用独立游戏窗口 · Opus 4.6';
    if(wake){
      var state=s&&root.chatWakeState&&root.chatWakeState[s.id],main=parent(s),mainState=main&&root.chatWakeState&&root.chatWakeState[main.id];
      wake.hidden=!p;
      wake.textContent=p?(p.wakeError||('主窗口唤醒'+(mainState?mainState.enabled?'已开':'已关':'待确认')+' · 游戏唤醒'+(state?state.enabled?'已开':'已关':'待确认')+(state&&state.enabled?' '+root.chatWakeCountdown(state):''))):'';
    }
    if(wakeButton){wakeButton.hidden=!p||!p.wakeError;wakeButton.disabled=wakeBusy}
    var reports=(p&&p.reports||[]).filter(function(r){return r.gameId===p.gameId}),r=reports[reports.length-1];
    if(status){status.hidden=!r||r.state==='superseded';status.textContent=p&&p.nextGameError||(!r?'':r.state==='delivered'?'本局总结已发送给主窗口，小克已完整回复。':r.state==='failed'?r.error:r.state==='summarizing'?'小克正在整理本局总结…':r.state==='delivering'?'正在把总结发送给主窗口…':'本局总结待同步，当前请求完成后继续。')}
    if(retryButton){retryButton.hidden=!r||r.state!=='failed';retryButton.disabled=!idle()||busy}
  }
  root.CKGameWindow={profile:profile,parent:parent,gameFor:gameFor,begin:begin,select:select,config:config,contextRows:contextRows,body:body,beforeSend:beforeSend,update:update,render:render,retry:retry,messageView:messageView,
    retryWake:function(){var s=gameFor(current());if(s)ensureWake(s).catch(function(){render()})},pendingReports:pendingReports};
  setInterval(function(){if(root.chatSessionsReady){if(!busy&&idle())schedule();if(root.currentPanelTab==='games'){render();if(typeof root.chatWakeRefresh==='function'&&Date.now()-root.chatWakeLastFetch>=10000)root.chatWakeRefresh()}}},1000);
  document.addEventListener('visibilitychange',function(){if(!document.hidden)update()});
})(window);
