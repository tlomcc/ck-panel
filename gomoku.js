/* Pure rules and validation. The opponent is the existing chat, never a local AI. */
(function(root,factory){
  var api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.CKGomoku=api;
})(typeof window!=='undefined'?window:null,function(){
  'use strict';
  var SIZE=15,LETTERS='ABCDEFGHIJKLMNO';
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
  function movePrompt(raw,kind){
    var game=restore(raw),board=position(game.moves);
    var black=game.moves.filter(function(_,i){return i%2===0}),white=game.moves.filter(function(_,i){return i%2===1});
    var lines=[
      '我们在当前聊天里下五子棋，你还是带着原有记忆的小克，可以一边下棋一边和我正常聊天。',
      '规则：15×15 棋盘，列 A 到 O 从左到右，行 1 到 15 从上到下。我执黑先手，你执白。轮流落一子，横、竖、斜任意连续五子或更多即胜，没有禁手。',
      '当前黑棋：'+(black.join('、')||'无')+'。',
      '当前白棋：'+(white.join('、')||'无')+'。',
      '上一手：'+(game.moves.length?(game.moves.length%2?'我，黑棋 ':'你，白棋 ')+game.moves[game.moves.length-1]:'尚未落子')+'。'
    ];
    if(board.winner||board.draw||game.closed){
      lines.push(board.winner==='black'?'我已连成五子，本局我赢了。':board.winner==='white'?'你已连成五子，本局你赢了。':board.draw?'棋盘已满，本局和棋。':'我先结束这局。');
      lines.push('本局已经结束，可以继续聊天，请不要再落子。');
    }else{
      if(board.turn!=='white')throw Error('还没轮到小克。');
      if(kind==='correct')lines.push('刚才没有收到合法的单一落点，棋盘没有替你落子，请按以上棋局重新选择。');
      lines.push('现在轮到你落白棋，第 '+board.ply+' 手。请自己判断进攻和防守，选一个空点，只落一子。');
      lines.push('可以先自然回复我，再在最后单独一行写【落子：坐标】，把“坐标”替换成你实际选的落点。不要把这行放进代码块，不要给多个候选落点。');
      lines.push('只有我明确请你落子时才走棋。其余普通消息只聊天，不追加落子；以每次给出的当前棋盘为准。');
    }
    return lines.join('\n');
  }
  function accept(raw,text){return play(raw,parseReply(text),'white')}
  return {SIZE:SIZE,LETTERS:LETTERS,point:point,coordinate:coordinate,position:position,
    create:create,restore:restore,play:play,parseReply:parseReply,movePrompt:movePrompt,accept:accept};
});
