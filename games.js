(function(root){
  'use strict';
  var G=root.CKGomoku,visible=false,refreshTimer=0,updateTimer=0,selected='',selectedSession='',chatStamp='',drafts=Object.create(null),cells=[],sayBusy=false;
  function $(id){return document.getElementById(id)}
  function current(){return root.chatSessions&&root.chatSessions.find(function(s){return s.id===root.chatActiveSessionId})}
  function rows(session){return session.id===root.chatActiveSessionId?root.chatMessages:session.messages||[]}
  function id(prefix){return prefix+'-'+(root.crypto&&root.crypto.randomUUID?root.crypto.randomUUID():Date.now().toString(36)+'-'+Math.random().toString(36).slice(2))}
  function tell(message){if($('games-notice')){$('games-notice').textContent=message;$('games-notice').hidden=!message}}
  function save(session){root.chatSaveSessions({sessionIds:[session.id]})}
  function speech(message){
    var text=String(message&&message.text||'');
    if(message&&message.role==='assistant'&&typeof root.chatSplitThinkingText==='function')text=root.chatSplitThinkingText(text,{hideUnclosedThinking:true}).text||'';
    return text;
  }
  function pendingMessage(session,game){
    if(!game||!game.pending)return null;
    var matches=rows(session).filter(function(m){return m&&m.ckGame&&m.ckGame.gameId===game.id&&m.ckGame.requestId===game.pending.id});
    return matches.length===1?matches[0]:null;
  }
  function reconcile(session){
    var game;
    try{game=G.restore(session.gomoku)}catch(e){return false}
    if(!game||!game.pending)return false;
    var message=pendingMessage(session,game),pending=game.pending;
    if(!message||message.role!=='user'||message.inFlight||message.sendFailed||!message.turnId)return false;
    if(pending.checkedTurn===message.turnId)return false;
    if(session.replyDraft&&session.replyDraft.turn_id===message.turnId)return false;
    var replies=rows(session).filter(function(m){return m&&m.role==='assistant'&&m.turnId===message.turnId&&!m.stopped});
    if(!replies.length)return false;
    try{
      if(message.text!==pending.prompt)throw Error('这步消息已被编辑，请按当前棋盘重新请小克落子。');
      game=G.accept(game,replies.map(speech).join('\n'));
    }catch(error){game.error=error.message;game.pending.checkedTurn=String(message.turnId)}
    session.gomoku=game;
    return true;
  }
  function update(){
    updateTimer=0;
    if(!root.chatSessionsReady)return;
    var changed=[];
    (root.chatSessions||[]).forEach(function(session){if(reconcile(session))changed.push(session.id)});
    if(changed.length)root.chatSaveSessions({sessionIds:changed});
    if(visible)render();
  }
  function onChatUpdate(){if(!updateTimer)updateTimer=setTimeout(update,0)}
  async function ready(){
    root.chatInit();await root.chatEnsureSessionsReady();
    if(!G)throw Error('游戏组件尚未加载，请刷新 CK。');
    var session=current();if(!session)throw Error('请先选择一个聊天窗口。');
    return session;
  }
  async function actionReady(){
    var sessionId=root.chatActiveSessionId,session=await ready();
    if(sessionId&&sessionId!==session.id)throw Error('聊天窗口已切换，内容保留，请重新操作。');
    return session;
  }
  function guard(allowQueue,ignoreMessage){
    if(!root.chatSessionsReady)throw Error('聊天记录还在加载，请稍候。');
    if(root.ckBackendSwitchBusy||root.chatTrimBusy||root.chatTrimTransaction||root.chatDeleteDigestBusy)throw Error('当前窗口正在处理，请稍后再试。');
    if(root.chatEditingIndex>=0)throw Error('请先到聊天页保存或取消正在编辑的消息。');
    if(root.chatSending){
      var request=root.chatActiveRequest;
      if(allowQueue&&request&&!request.stopped&&!request.finished)return;
      throw Error('小克还在回复，可以先说话，等它说完再落子。');
    }
    if(root.chatRecoverInFlightBusy||root.chatInterruptedInFlightMessages().length)throw Error('上一条回复正在补收，棋盘会保留。');
    var outstanding=root.chatMessages.filter(function(m){return m&&m!==ignoreMessage&&(m.role==='pending_user'||m.role==='user'&&m.sendFailed)});
    if(outstanding.length)throw Error('还有待发或失败消息，请到完整聊天里处理后继续。');
  }
  function requestExisting(message){
    root.chatEnsurePendingMessageId(message);
    root.chatSaveLocalMessages();
    Promise.resolve(root.chatSubmitPendingMessages({inputSnapshot:true,extraText:'',draftImages:[],draftFiles:[],pendingIds:[message.pendingId]})).catch(function(){tell('消息未完成，请在完整聊天里查看。')}).finally(onChatUpdate);
    onChatUpdate();
  }
  function submit(text,metadata){
    var message={role:'pending_user',text:text,images:[],ts:Date.now(),pendingId:root.chatPendingMessageId()};
    if(metadata)message.ckGame=metadata;
    root.chatMessages.push(message);root.chatMarkMessageFresh(message);
    root.chatSaveLocalMessages();root.chatRenderMessages({respectUserScroll:true});
    if(root.chatSending){
      var request=root.chatActiveRequest;
      request.queuedPendingIds=Array.from(new Set((request.queuedPendingIds||[]).concat([message.pendingId])));
      if(request.checkpointReply)request.checkpointReply();
      tell('已排队，小克说完这条就接着回复你。');
    }else requestExisting(message);
    onChatUpdate();
    return message;
  }
  async function newGame(){
    try{
      var session=await actionReady();guard(false);
      if(session.gomoku){
        var old;try{old=G.restore(session.gomoku)}catch(e){}
        var position=old&&G.position(old.moves);
        if(!old||!old.closed&&!position.winner&&!position.draw&&old.moves.length){
          if(!await root.ckConfirmDialog('开新局会结束当前棋局，聊天记录会保留。',{title:'开始新的一局',confirmText:'开新局'}))return;
          if(session!==current())throw Error('聊天窗口已切换，请重新操作。');
          guard(false);
        }
      }
      session.gomoku=G.create(id('g'),Date.now());save(session);selected='';tell('');render();
    }catch(error){tell(error.message)}
  }
  async function play(){
    try{
      var session=await actionReady();guard(false);update();
      if(!selected)throw Error('先在棋盘上选一个位置。');
      var game=G.play(session.gomoku,selected,'black'),position=G.position(game.moves),requestId=id('r');
      var prompt=G.movePrompt(game),caption='我落黑棋 '+selected+'。';
      if(position.winner)caption+=' 我连成五子了。';
      if(position.draw)caption+=' 棋盘下满了，和棋。';
      if(!position.winner&&!position.draw)game.pending={id:requestId,ply:position.ply,prompt:prompt,checkedTurn:''};
      session.gomoku=game;selected='';tell('');
      submit(prompt,{gameId:game.id,requestId:requestId,caption:caption});render();
    }catch(error){tell(error.message)}
  }
  async function askMove(){
    try{
      var session=await actionReady();update();var game=G.restore(session.gomoku),message=pendingMessage(session,game);
      if(message&&(message.role==='pending_user'||message.sendFailed)){
        guard(false,message);tell('');requestExisting(message);return;
      }
      guard(false);var position=G.position(game.moves);
      if(game.closed||position.winner||position.draw||position.turn!=='white')throw Error('现在不需要小克落子。');
      var requestId=id('r'),prompt=G.movePrompt(game,'correct');
      game.pending={id:requestId,ply:position.ply,prompt:prompt,checkedTurn:''};game.error='';session.gomoku=game;tell('');
      submit(prompt,{gameId:game.id,requestId:requestId,caption:'请按当前棋盘落一颗白棋。'});render();
    }catch(error){tell(error.message)}
  }
  async function say(){
    var input=$('games-input'),snapshot=input&&input.value,text=snapshot&&snapshot.trim();if(!text||sayBusy)return;
    sayBusy=true;
    try{
      var session=await actionReady();guard(true);tell('');
      submit(text);if(input.value===snapshot)input.value='';drafts[session.id]=input.value;render();
    }catch(error){tell(error.message)}finally{sayBusy=false}
  }
  async function selectSession(){
    try{
      var next=$('games-session').value,session=await actionReady();
      if(root.chatSending||root.chatRecoverInFlightBusy||root.chatTrimBusy)throw Error('等当前回复或处理完成后再切换窗口。');
      if(!(root.chatSessions||[]).some(function(s){return s.id===next}))throw Error('这个聊天窗口已经不存在。');
      drafts[session.id]=$('games-input').value;
      root.chatSelectSession(next);selected='';chatStamp='';tell('');render();
    }catch(error){tell(error.message);render()}
  }
  async function endGame(){
    try{
      var session=await actionReady();guard(false);
      var original=session.gomoku;
      if(!original)return;
      if(!await root.ckConfirmDialog('结束这局五子棋，聊天可以继续，棋盘会保留。',{title:'结束本局',confirmText:'结束本局'}))return;
      if(session!==current()||session.gomoku!==original)throw Error('棋局有变化，请重新操作。');
      guard(false);var game=G.restore(original);game.closed=true;game.pending=null;game.error='';session.gomoku=game;selected='';tell('');
      submit(G.movePrompt(game),{gameId:game.id,requestId:id('r'),caption:'这局先到这里，我们继续聊。'});render();
    }catch(error){tell(error.message)}
  }
  function makeBoard(){
    var grid=$('games-board');if(!grid||cells.length)return;
    var ns='http://www.w3.org/2000/svg',svg=document.createElementNS(ns,'svg');
    svg.setAttribute('viewBox','0 0 480 480');svg.setAttribute('aria-hidden','true');svg.classList.add('games-grid-lines');
    var line=document.createElementNS(ns,'path'),path='';
    for(var i=0;i<15;i++){var n=16+i*32;path+='M16 '+n+'H464M'+n+' 16V464'}
    line.setAttribute('d',path);svg.appendChild(line);
    [[3,3],[11,3],[7,7],[3,11],[11,11]].forEach(function(p){var c=document.createElementNS(ns,'circle');c.setAttribute('cx',16+p[0]*32);c.setAttribute('cy',16+p[1]*32);c.setAttribute('r',3);svg.appendChild(c)});
    grid.appendChild(svg);
    var columns=$('games-columns'),rowLabels=$('games-rows');
    for(var y=0;y<15;y++){
      var row=document.createElement('div');row.className='games-board-row';row.setAttribute('role','row');
      var label=document.createElement('span');label.textContent=y+1;rowLabels.appendChild(label);
      var column=document.createElement('span');column.textContent=G.LETTERS[y];columns.appendChild(column);
      for(var x=0;x<15;x++){
        var cell=document.createElement('button'),name=G.coordinate(x,y);cell.type='button';cell.className='games-point';cell.dataset.coordinate=name;cell.setAttribute('role','gridcell');cell.tabIndex=name==='H8'?0:-1;
        cell.setAttribute('aria-label',name+'，空位');cell.innerHTML='<span class="games-stone" aria-hidden="true"></span>';
        row.appendChild(cell);cells.push(cell);
      }
      grid.appendChild(row);
    }
    grid.addEventListener('click',function(event){var cell=event.target.closest('[data-coordinate]');if(cell)selectPoint(cell.dataset.coordinate)});
    grid.addEventListener('keydown',function(event){
      var cell=event.target.closest('[data-coordinate]');if(!cell)return;
      var p=G.point(cell.dataset.coordinate),x=p.x,y=p.y;
      if(event.key==='ArrowLeft')x=Math.max(0,x-1);else if(event.key==='ArrowRight')x=Math.min(14,x+1);
      else if(event.key==='ArrowUp')y=Math.max(0,y-1);else if(event.key==='ArrowDown')y=Math.min(14,y+1);
      else if(event.key==='Home')x=0;else if(event.key==='End')x=14;else return;
      event.preventDefault();cells.forEach(function(c){c.tabIndex=-1});var next=cells[y*15+x];next.tabIndex=0;next.focus();
    });
  }
  function selectPoint(name){
    try{
      var session=current(),game=G.restore(session&&session.gomoku);if(!game)throw Error('点“开始对局”，你执黑先手。');
      var position=G.position(game.moves),p=G.point(name);
      if(game.closed||position.winner||position.draw)throw Error('本局结束了，可以开新局。');
      if(position.turn!=='black')throw Error('轮到小克了，你可以先和它聊聊。');
      if(position.board[p.y*15+p.x])throw Error(name+' 已经有棋子。');
      selected=name;tell('');renderBoard(game,position);
    }catch(error){tell(error.message)}
  }
  var boardStamp='',sessionStamp='';
  function renderBoard(game,position){
    position=position||G.position(game?game.moves:[]);
    var ended=!!(game&&(game.closed||position.winner||position.draw)),blackTurn=!!game&&!ended&&position.turn==='black';
    if(!blackTurn)selected='';
    var stamp=JSON.stringify([game&&game.id,game&&game.moves,selected,ended,root.chatSending]);
    if(boardStamp!==stamp){
      boardStamp=stamp;
      cells.forEach(function(cell,index){
        var player=position.board[index],name=cell.dataset.coordinate;
        cell.classList.toggle('is-black',player==='black');cell.classList.toggle('is-white',player==='white');
        cell.classList.toggle('is-selected',name===selected);cell.classList.toggle('is-last',!!game&&game.moves[game.moves.length-1]===name);
        cell.classList.toggle('is-winning',position.winning.indexOf(name)>=0);
        cell.setAttribute('aria-selected',name===selected?'true':'false');
        cell.setAttribute('aria-disabled',!blackTurn||!!player?'true':'false');
        cell.setAttribute('aria-label',name+'，'+(player==='black'?'黑棋':player==='white'?'白棋':'空位')+(name===selected?'，已选中':''));
      });
    }
    var status=!game?'你执黑，先落第一子':position.winner==='black'?'你赢了':position.winner==='white'?'小克赢了':position.draw?'和棋':game.closed?'本局已结束':position.turn==='black'?'轮到你，执黑':'轮到小克，执白';
    $('games-turn').textContent=status;
    $('games-move-count').textContent=game?'已落 '+game.moves.length+' 手':'15 × 15';
    $('games-last').textContent=game&&game.moves.length?'上一手：'+(game.moves.length%2?'你':'小克')+' '+game.moves[game.moves.length-1]:'连成五子就赢，没有禁手。';
    $('games-play').textContent=selected?'落子 '+selected:'选择落点';
    $('games-play').hidden=!game||ended||position.turn!=='black';
    $('games-play').disabled=!selected||!!root.chatSending;
    $('games-new').textContent=game?'新的一局':'开始对局';
    $('games-new').disabled=!!root.chatSending||!!root.chatRecoverInFlightBusy;
    $('games-end').hidden=!game||ended;
    $('games-end').disabled=!!root.chatSending;
    var message=game&&pendingMessage(current(),game),waiting=!!(message&&(message.inFlight||message.role==='pending_user'&&root.chatSending));
    $('games-ask').hidden=!game||ended||position.turn!=='white'||waiting||!!root.chatSending;
    $('games-ask').textContent=message&&(message.sendFailed||message.role==='pending_user')?'重试这步':'请小克落子';
    var error=game&&game.error||'';
    if(message&&message.sendFailed)error='落子请求未完成，棋盘已保留。';
    if(game&&game.pending&&!message)error='这步的聊天记录已移除，可按当前棋盘重新请小克落子。';
    $('games-move-error').textContent=error;$('games-move-error').hidden=!error;
  }
  function renderConversation(session){
    var all=rows(session).filter(function(m){return m&&['user','assistant','pending_user'].indexOf(m.role)>=0}),recent=all.slice(-30),draft=session.replyDraft;
    var live=draft&&String(draft.assistant_text||draft.text||'');
    var stamp=JSON.stringify([recent.map(function(m){return [m.role,m.text,m.ts,m.turnId,m.sendFailed,m.inFlight,m.ckGame&&m.ckGame.caption]}),live,draft&&draft.state,root.chatSending]);
    $('games-conversation-scope').textContent=all.length>30?'最近 30 条，完整记录在聊天里':'与当前窗口共用聊天记录';
    if(chatStamp===stamp)return;
    chatStamp=stamp;
    var log=$('games-conversation'),follow=log.scrollHeight-log.scrollTop-log.clientHeight<48,fragment=document.createDocumentFragment();
    function append(who,text,pending){
      var item=document.createElement('div');item.className='games-message'+(who==='你'?' from-user':'');
      var heading=document.createElement('span');heading.className='games-speaker';heading.textContent=who+(pending?' · '+pending:'');
      var body=document.createElement('p');body.textContent=text;item.append(heading,body);fragment.appendChild(item);
    }
    recent.forEach(function(m){
      var text=m.ckGame&&m.ckGame.caption||speech(m)||((m.images||[]).length?'[图片]':'');
      if(text)append(m.role==='assistant'?'小克':'你',text,m.sendFailed?'未发送成功':m.role==='pending_user'?'待发送':m.inFlight?'已发送':'');
    });
    if(live)append('小克',speech({role:'assistant',text:live}),draft.state==='error'?'收到的部分回复':'正在回复');
    else if(root.chatSending)append('小克','正在回复，可以继续发消息。','');
    if(!recent.length&&!live&&!root.chatSending){var empty=document.createElement('p');empty.className='games-chat-empty';empty.textContent='下一子，也可以先说句话。';fragment.appendChild(empty)}
    log.replaceChildren(fragment);
    if(follow)log.scrollTop=log.scrollHeight;
    $('games-say').textContent=root.chatSending?'排队发送':'发送';
  }
  function render(){
    if(!visible||!$('tab-games'))return;
    var session=current();if(!session)return;
    if(selectedSession!==session.id){
      if(selectedSession)drafts[selectedSession]=$('games-input').value;
      selectedSession=session.id;selected='';chatStamp='';boardStamp='';$('games-input').value=drafts[session.id]||'';
    }
    var stamp=JSON.stringify((root.chatSessions||[]).map(function(s){return [s.id,s.title]}));
    if(stamp!==sessionStamp){
      sessionStamp=stamp;var options=document.createDocumentFragment();
      root.chatSessions.forEach(function(s){var option=document.createElement('option');option.value=s.id;option.textContent=s.title||'未命名对话';options.appendChild(option)});
      $('games-session').replaceChildren(options);
    }
    $('games-session').value=session.id;$('games-session').disabled=!!root.chatSending;
    var game;try{game=G.restore(session.gomoku)}catch(error){tell(error.message+' 原记录已保留，可开新局。')}
    renderBoard(game);renderConversation(session);
  }
  function startTimer(){
    clearInterval(refreshTimer);refreshTimer=0;
    if(visible&&!document.hidden)refreshTimer=setInterval(function(){if(root.chatSending||root.chatRecoverInFlightBusy)update()},600);
  }
  async function enter(){
    visible=true;document.body.classList.add('games-active');
    try{await ready();if(!visible)return;makeBoard();update();startTimer()}catch(error){tell(error.message)}
  }
  function leave(){
    if(visible&&current())drafts[current().id]=$('games-input').value;
    visible=false;clearInterval(refreshTimer);refreshTimer=0;document.body.classList.remove('games-active');
  }
  function bind(){
    $('games-new').addEventListener('click',newGame);$('games-play').addEventListener('click',play);
    $('games-ask').addEventListener('click',askMove);$('games-end').addEventListener('click',endGame);
    $('games-session').addEventListener('change',selectSession);
    $('games-form').addEventListener('submit',function(event){event.preventDefault();say()});
    $('games-input').addEventListener('input',function(){if(current())drafts[current().id]=this.value});
    $('games-input').addEventListener('keydown',function(event){if(event.key==='Enter'&&!event.shiftKey&&!event.isComposing){event.preventDefault();say()}});
    $('games-fold').addEventListener('click',function(){var board=$('games-board-area'),closed=!board.hidden;board.hidden=closed;this.setAttribute('aria-expanded',String(!closed));this.textContent=closed?'展开棋盘':'收起棋盘'});
    document.addEventListener('visibilitychange',function(){startTimer();if(visible&&!document.hidden)onChatUpdate()});
    if(root.currentPanelTab==='games')enter();
  }
  root.CKGames={onChatUpdate:onChatUpdate,enter:enter,leave:leave};
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',bind);else bind();
})(window);
