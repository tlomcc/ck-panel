/* Pure rules and validation. The opponent is the existing chat, never a local AI. */
(function(root,factory){
  var api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.CKGomoku=api;
})(typeof window!=='undefined'?window:null,function(){
  'use strict';
  var SIZE=15,LETTERS='ABCDEFGHIJKLMNO';
  var RULES='规则：15×15 棋盘，列 A 到 O 从左到右，行 1 到 15 从上到下。我执黑先手，你执白。轮流落一子，横、竖、斜任意连续五子或更多即胜，没有禁手。';
  function point(value){
    var name=String(value||'').trim().toUpperCase();
    if(!/^[A-O](?:[1-9]|1[0-5])$/.test(name))throw Error('落点应为 A1 到 O15。');
    return {name:name,x:LETTERS.indexOf(name[0]),y:Number(name.slice(1))-1};
  }
  function coordinate(x,y){return LETTERS[x]+String(y+1)}
  function position(moves){
    if(!Array.isArray(moves)||moves.length>SIZE*SIZE)throw Error('棋谱记录不完整。');
    var board=Array(SIZE*SIZE).fill(''),winner='',winning=[];
    moves.forEach(function(value,index){
      if(winner)throw Error('胜负已定后不能继续落子。');
      var p=point(value),offset=p.y*SIZE+p.x,player=index%2?'white':'black';
      if(board[offset])throw Error(p.name+' 已经有棋子。');
      board[offset]=player;
      [[1,0],[0,1],[1,1],[1,-1]].forEach(function(direction){
        var line=[p.name];
        [-1,1].forEach(function(sign){
          var x=p.x+direction[0]*sign,y=p.y+direction[1]*sign;
          while(x>=0&&x<SIZE&&y>=0&&y<SIZE&&board[y*SIZE+x]===player){
            line.push(coordinate(x,y));x+=direction[0]*sign;y+=direction[1]*sign;
          }
        });
        if(line.length>=5){winner=player;line.forEach(function(name){if(winning.indexOf(name)<0)winning.push(name)})}
      });
    });
    return {board:board,turn:moves.length%2?'white':'black',winner:winner,
      draw:!winner&&moves.length===SIZE*SIZE,winning:winning,ply:moves.length+1};
  }
  function restore(raw){
    if(raw==null)return null;
    if(typeof raw!=='object'||raw.version!==1||!/^g-[a-z0-9-]{1,100}$/.test(raw.id||''))throw Error('棋局版本或标识无法读取。');
    var moves=Array.isArray(raw.moves)?raw.moves.map(function(c){return point(c).name}):null;
    var board=position(moves),pending=null;
    if(raw.pending!=null){
      var p=raw.pending;
      if(typeof p!=='object'||!/^r-[a-z0-9-]{1,100}$/.test(p.id||'')||p.ply!==board.ply||board.turn!=='white'||board.winner||board.draw||raw.closed===true)throw Error('等待落子的记录与棋盘不一致。');
      if(typeof p.prompt!=='string'||p.prompt.length>16000)throw Error('落子消息记录无法读取。');
      pending={id:p.id,ply:p.ply,prompt:p.prompt,checkedTurn:String(p.checkedTurn||'').slice(0,200)};
    }
    return {version:1,id:raw.id,created:Number(raw.created)||0,moves:moves,
      closed:raw.closed===true,pending:pending,error:String(raw.error||'').slice(0,300)};
  }
  function create(id,now){return restore({version:1,id:id,created:now,moves:[]})}
  function play(raw,coordinateValue,player){
    var game=restore(raw),board=position(game.moves),p=point(coordinateValue);
    if(game.closed||board.winner||board.draw)throw Error('本局已结束。');
    if(board.turn!==player)throw Error(player==='black'?'还没轮到你。':'还没轮到小克。');
    if(board.board[p.y*SIZE+p.x])throw Error(p.name+' 已经有棋子。');
    game.moves.push(p.name);game.pending=null;game.error='';position(game.moves);
    return game;
  }
  function parseReply(text){
    // A completed, matching chat turn must supply exactly one standalone move.
    // Quoted examples, code blocks and speculative coordinates are not moves.
    var clean=String(text||'').replace(/<(?:pre|code)\b[^>]*>[\s\S]*?(?:<\/(?:pre|code)>|$)/gi,''),matches=[],fence='';
    clean.split(/\r?\n/).forEach(function(line){
      var delimiter=line.match(/^ {0,3}(`{3,}|~{3,})/);
      if(delimiter){if(!fence)fence=delimiter[1];else if(delimiter[1][0]===fence[0]&&delimiter[1].length>=fence.length)fence='';return}
      if(fence||/^(?: {4}|\t)/.test(line))return;
      var match=line.trim().match(/^【落子[：:]\s*([^】]+)】$/);
      if(match)matches.push(match[1]);
    });
    if(matches.length!==1)throw Error(matches.length?'小克给了多个落点，尚未落子。':'小克还没有给出明确落点。');
    return point(matches[0]).name;
  }
  function stripMove(text,streaming){
    var lines=String(text||'').split('\n'),fence='';
    return lines.filter(function(line,index){
      var delimiter=line.match(/^ {0,3}(`{3,}|~{3,})/);
      if(delimiter){if(!fence)fence=delimiter[1];else if(delimiter[1][0]===fence[0]&&delimiter[1].length>=fence.length)fence='';return true}
      if(fence||/^(?: {4}|\t)/.test(line))return true;
      if(/^【落子[：:][^】]*】$/.test(line.trim()))return false;
      return !(streaming&&index===lines.length-1&&/^【(?:落(?:子(?:[：:][^】]*)?)?)?$/.test(line.trim()));
    }).join('\n').trim();
  }
  function promptMoves(text){
    var black=String(text||'').match(/^当前黑棋：([^。\n]*)。/m),white=String(text||'').match(/^当前白棋：([^。\n]*)。/m);
    if(!black||!white)return null;
    try{
      black=black[1]==='无'?[]:black[1].split('、').map(function(c){return point(c).name});
      white=white[1]==='无'?[]:white[1].split('、').map(function(c){return point(c).name});
      if(black.length<white.length||black.length>white.length+1)return null;
      var moves=[];black.forEach(function(c,i){moves.push(c);if(white[i])moves.push(white[i])});position(moves);return moves;
    }catch(e){return null}
  }
  function contextState(raw,messages,context){
    // Only instructions actually present in the outgoing history count as known.
    var game=restore(raw),known=0,rules=false,cursor=0;
    var actual=(context||[]).map(function(m){
      var content=Array.isArray(m.content)?m.content.filter(function(p){return p&&p.type==='text'}).map(function(p){return p.text||''}).join('\n'):typeof m.content==='string'?m.content:'';
      return {role:m.role,text:String(m.text||content||'')};
    });
    (messages||[]).forEach(function(m){
      if(!m||m.role!=='user'||m.sendFailed||m.inFlight||!m.ckGame||m.ckGame.gameId!==game.id||!m.text)return;
      var index=-1;for(var i=cursor;i<actual.length;i++)if(actual[i].role==='user'&&actual[i].text.indexOf(m.text)>=0){index=i;break}
      if(index<0)return;
      cursor=index+1;if(m.text.indexOf(RULES)>=0&&m.text.indexOf('【落子：坐标】')>=0)rules=true;
      var snapshot=promptMoves(m.text),ply=m.ckGame.ply;
      if(snapshot&&snapshot.length&&snapshot.every(function(c,i){return c===game.moves[i]}))known=snapshot.length;
      else if(m.ckGame.mode==='delta'&&m.ckGame.autoText===m.text&&ply===known+1&&m.ckGame.coordinate===game.moves[ply-1])known=ply;
      else return;
      if(known>=game.moves.length||known%2===0||!m.turnId)return;
      var replies=(messages||[]).filter(function(r){return r&&r.role==='assistant'&&r.turnId===m.turnId&&!r.stopped});
      try{if(parseReply(replies.map(function(r){return r.text||''}).join('\n'))!==game.moves[known])return}catch(e){return}
      for(var j=cursor;j<actual.length;j++){
        if(actual[j].role==='user'&&actual[j].text.trim())break;
        if(actual[j].role!=='assistant')continue;
        try{if(parseReply(actual[j].text)===game.moves[known]){known++;cursor=j+1;break}}catch(e){}
      }
    });
    return {rules:rules,ply:known};
  }
  function movePrompt(raw,options){
    var game=restore(raw),board=position(game.moves),opts=typeof options==='string'?{correct:options==='correct'}:options||{};
    var ended=board.winner||board.draw||game.closed;
    if(ended){
      var result=board.winner==='black'?'黑棋连成五子，本局黑棋获胜。':board.winner==='white'?'白棋连成五子，本局白棋获胜。':board.draw?'棋盘已满，本局和棋。':'本局已结束。';
      return (game.moves.length&&!game.closed?'第 '+game.moves.length+' 手：'+(game.moves.length%2?'黑棋 ':'白棋 ')+game.moves[game.moves.length-1]+'。\n':'')+result+'可以继续聊天，请不要再落子。';
    }
    if(board.turn!=='white')throw Error('还没轮到小克。');
    if(opts.mode==='delta'&&!opts.correct)return '第 '+game.moves.length+' 手：黑棋 '+game.moves[game.moves.length-1]+'。请落白棋。';
    var black=game.moves.filter(function(_,i){return i%2===0}),white=game.moves.filter(function(_,i){return i%2===1});
    var lines=opts.mode==='sync'?['核对当前棋盘：']:[
      (game.moves.length===1?'新一局五子棋':'继续这局五子棋')+'，可以边下边聊。',RULES,
      '之后只通知新增落子，请接着棋谱走。只有明确请你落子时才走棋，普通消息只聊天。',
      '想说话时可以自然回复；最后单独一行写【落子：坐标】，替换为一个空点，不要放进代码块，不要给多个落点。落子通知是面板系统事件，不是双方说的话。'
    ];
    lines.push(
      '当前黑棋：'+(black.join('、')||'无')+'。',
      '当前白棋：'+(white.join('、')||'无')+'。');
    if(opts.correct)lines.push('刚才的落点未生效，请按这份棋盘重新选择。');
    lines.push('第 '+board.ply+' 手，请落白棋。');
    return lines.join('\n');
  }
  function accept(raw,text){return play(raw,parseReply(text),'white')}
  return {SIZE:SIZE,LETTERS:LETTERS,point:point,coordinate:coordinate,position:position,
    create:create,restore:restore,play:play,parseReply:parseReply,movePrompt:movePrompt,accept:accept,
    stripMove:stripMove,promptMoves:promptMoves,contextState:contextState};
});
