const test=require('node:test'),assert=require('node:assert/strict');
const G=require('../gomoku.js');
function game(moves=[]){return G.restore({version:1,id:'g-rules',created:1,moves})}
function alternate(a,b){return a.flatMap((v,i)=>i<b.length?[v,b[i]]:[v])}
test('coordinates accept case but reject bounds and arbitrary markup',()=>{
  assert.deepEqual(G.point(' h8 '),{name:'H8',x:7,y:7});
  for(const value of ['A0','A16','P1','A01','H8 H9','<script>','',null])assert.throws(()=>G.point(value));
});
test('a move preserves the old board and enforces the next player',()=>{
  const old=game(),next=G.play(old,'H8','black');assert.deepEqual(old.moves,[]);assert.deepEqual(next.moves,['H8']);
  assert.throws(()=>G.play(next,'I8','black'),/还没轮到/);assert.throws(()=>G.play(next,'H8','white'),/已经有棋子/);
});
for(const [name,line] of Object.entries({horizontal:['D8','E8','F8','G8','H8'],vertical:['H4','H5','H6','H7','H8'],diagonal:['D4','E5','F6','G7','H8'],reverse:['D8','E7','F6','G5','H4']})){
  test(name+' five wins only after the last stone',()=>{
    const moves=alternate(line,['A15','C15','E15','G15']);
    assert.equal(G.position(moves.slice(0,-1)).winner,'');
    const won=G.position(moves);assert.equal(won.winner,'black');assert.equal(won.winning.length,5);
    assert.throws(()=>G.play(game(moves),'I15','white'),/本局已结束/);
  });
}
test('white can win without a second black move',()=>{
  const moves=alternate(['A1','C1','E1','G1','I1'],['E9','F9','G9','H9','I9']);assert.equal(G.position(moves).winner,'white');
});
test('six in a row by filling a gap is a freestyle win',()=>{
  const moves=alternate(['C8','D8','F8','G8','H8','E8'],['A15','C15','E15','G15','I15']);
  assert.equal(G.position(moves).winning.length,6);
});
test('a full 225 point board can be a real draw',()=>{
  const black=[],white=[];for(let y=0;y<15;y++)for(let x=0;x<15;x++)((x+2*y)%4<2?black:white).push(G.coordinate(x,y));
  assert.equal(black.length,113);assert.equal(white.length,112);
  const position=G.position(alternate(black,white));assert.equal(position.winner,'');assert.equal(position.draw,true);
});
test('corrupt storage does not quietly create a new game',()=>{
  for(const raw of [{}, {...game(),version:2},{...game(),moves:['H8','H8']},{...game(),moves:['P1']},{...game(),moves:null}])assert.throws(()=>G.restore(raw));
});
test('JSON persistence keeps board and exact pending request',()=>{
  const value=game(['H8']);value.pending={id:'r-pending',ply:2,prompt:G.movePrompt(value),checkedTurn:''};
  assert.deepEqual(G.restore(JSON.parse(JSON.stringify(value))),value);
  assert.throws(()=>G.restore({...value,pending:{...value.pending,ply:4}}),/不一致/);
});
test('only one explicit nonquoted move line is accepted',()=>{
  assert.equal(G.parseReply('当然记得我们聊的事。\n【落子：i9】'),'I9');
  for(const text of ['我在考虑 H8','> 【落子：H8】','```\n【落子：H8】\n```','```\n【落子：H8】','~~~\n【落子：H8】\n~~~','    【落子：H8】','<pre>\n【落子：H8】','【落子：H8】\n【落子：I9】','【落子：P1】','【落子：A0】'])assert.throws(()=>G.parseReply(text));
});
test('the model cannot place on occupied intersections or after a closed game',()=>{
  assert.throws(()=>G.accept(game(['H8']),'【落子：H8】'),/已经有棋子/);
  assert.throws(()=>G.accept({...game(['H8']),closed:true},'【落子：H9】'),/本局已结束/);
});
test('appending a valid white reply clears pending, never changes older moves',()=>{
  const pending=game(['H8']);pending.pending={id:'r-one',ply:2,prompt:G.movePrompt(pending),checkedTurn:''};
  const accepted=G.accept(pending,'好呀，我也想听你讲。\n【落子：I9】');
  assert.deepEqual(accepted.moves,['H8','I9']);assert.equal(accepted.pending,null);assert.deepEqual(pending.moves,['H8']);
});
test('move and result messages include the board and permit ordinary conversation',()=>{
  const prompt=G.movePrompt(game(['H8','I9','G8']));assert.match(prompt,/当前黑棋：H8、G8/);assert.match(prompt,/当前白棋：I9/);assert.match(prompt,/第 4 手/);assert.match(prompt,/普通消息只聊天/);
  const closed=G.movePrompt({...game(['H8','I9']),closed:true});assert.match(closed,/继续聊天/);assert.doesNotMatch(closed,/现在轮到你落白棋/);
});
