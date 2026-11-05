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
test('regular updates contain only the new black move and the request for white',()=>{
  const text=G.movePrompt(game(['H6','H8','I6']),{mode:'delta'});
  assert.equal(text,'第 3 手：黑棋 I6。请落白棋。');assert.ok(text.length<35);
  assert.doesNotMatch(text,/规则|H6|H8|当前黑棋|【落子/);
});
test('a board correction resends position without repeating known rules',()=>{
  const text=G.movePrompt(game(['H6','H8','I6']),{mode:'sync',correct:true});
  assert.match(text,/当前黑棋：H6、I6/);assert.match(text,/当前白棋：H8/);assert.match(text,/未生效/);
  assert.doesNotMatch(text,/规则|15×15|代码块/);
});
test('game setup keeps ordinary conversation primary and makes move commentary optional',()=>{
  const text=G.movePrompt(game(['H8']));
  assert.match(text,/正常回应我说的内容/);assert.match(text,/不主动报坐标、数连子、提醒攻防/);
  assert.match(text,/只有我主动问棋局或明确聊棋时才分析/);assert.match(text,/只有系统落子通知，可以只给落子标记/);
  assert.equal(text.split('聊天约定：').length-1,1);
  assert.match(text,/最后单独一行写【落子：坐标】/);
});
function transcript(){
  const value=game(['H8','I9','G8','J9','F8']);
  const first={role:'user',text:G.movePrompt(game(['H8'])),turnId:'first',ckGame:{gameId:value.id}};
  const nextText=G.movePrompt(game(['H8','I9','G8']),{mode:'delta'});
  const next={role:'user',text:nextText,turnId:'next',ckGame:{gameId:value.id,ply:3,coordinate:'G8',mode:'delta',autoText:nextText}};
  const messages=[first,{role:'assistant',text:'喝茶也可以。\n【落子：I9】',turnId:'first'},next,{role:'assistant',text:'【落子：J9】',turnId:'next'}];
  const context=messages.map(m=>({role:m.role,content:[{type:'text',text:m.text}]}));
  return {value,messages,context};
}
test('an older game receives the conversation preference once without resending rules or the board',()=>{
  const t=transcript();t.messages[0].text=t.messages[0].text.split('\n').filter(line=>!line.startsWith('聊天约定：')).join('\n');
  const context=t.messages.map(m=>({role:m.role,text:m.text}));
  const known=G.contextState(t.value,t.messages,context);
  assert.deepEqual(known,{rules:true,ply:4,chatStyle:false,undoRules:true});
  const prompt=G.movePrompt(t.value,{mode:'delta',remindChatStyle:!known.chatStyle});
  assert.match(prompt,/聊天约定/);assert.match(prompt,/第 5 手：黑棋 F8/);assert.doesNotMatch(prompt,/规则：|当前黑棋|当前白棋/);
  const message={role:'user',text:prompt,turnId:'upgraded',ckGame:{gameId:t.value.id,mode:'delta',ply:5,coordinate:'F8',autoText:prompt}};
  t.messages.push(message,{role:'assistant',text:'【落子：K9】',turnId:'upgraded'});
  context.push(...t.messages.slice(-2).map(m=>({role:m.role,text:m.text})));
  const next=game(['H8','I9','G8','J9','F8','K9','E8']),after=G.contextState(next,t.messages,context);
  assert.deepEqual(after,{rules:true,ply:6,chatStyle:true,undoRules:true});
  assert.equal(G.movePrompt(next,{mode:'delta',remindChatStyle:!after.chatStyle}),'第 7 手：黑棋 E8。请落白棋。');
  assert.equal(G.contextState(next,t.messages,context.slice(0,-2)).chatStyle,false,'removed instructions are not treated as remembered');
});
test('unsubmitted or failed preferences do not count as instructions in model history',()=>{
  const t=transcript();t.messages[0].inFlight=true;
  assert.equal(G.contextState(t.value,t.messages,t.context).chatStyle,false);
  delete t.messages[0].inFlight;t.messages[0].sendFailed=true;
  assert.equal(G.contextState(t.value,t.messages,t.context).chatStyle,false);
});
test('only the full game sequence present in outgoing history permits a delta',()=>{
  const t=transcript();assert.deepEqual(G.contextState(t.value,t.messages,t.context),{rules:true,ply:4,chatStyle:true,undoRules:true});
  assert.deepEqual(G.contextState(t.value,t.messages,t.context.filter((_,i)=>i!==2)),{rules:true,ply:2,chatStyle:true,undoRules:true});
  assert.deepEqual(G.contextState(t.value,t.messages,t.context.slice(2)),{rules:false,ply:0,chatStyle:false,undoRules:false});
  assert.deepEqual(G.contextState(t.value,t.messages,[]),{rules:false,ply:0,chatStyle:false,undoRules:false});
});
test('speech sent with a move preserves delta context when history has separate user records',()=>{
  const t=transcript();t.messages[0].ckGame.requestId='r-first';t.messages[2].ckGame.requestId='r-next';
  const spoken=(turnId,requestId,text)=>({role:'user',text,turnId,ckGameSpeech:{gameId:t.value.id,requestId}});
  t.messages.splice(1,0,spoken('first','r-first','先聊一句。'));
  t.messages.splice(4,0,spoken('next','r-next','接着聊一句。'));
  const context=t.messages.map(m=>({role:m.role,text:m.text}));
  assert.deepEqual(G.contextState(t.value,t.messages,context),{rules:true,ply:4,chatStyle:true,undoRules:true});
  t.messages[1].ckGameSpeech.requestId='r-another';
  assert.deepEqual(G.contextState(t.value,t.messages,context),{rules:true,ply:1,chatStyle:true,undoRules:true});
  t.messages[1].ckGameSpeech.requestId='r-first';t.messages[1].turnId='unrelated';
  assert.deepEqual(G.contextState(t.value,t.messages,context),{rules:true,ply:1,chatStyle:true,undoRules:true});
});
test('failed, unsent or edited messages cannot establish remembered game state',()=>{
  const t=transcript();t.messages[0].sendFailed=true;assert.equal(G.contextState(t.value,t.messages,t.context).rules,false);
  delete t.messages[0].sendFailed;t.messages[0].role='pending_user';assert.equal(G.contextState(t.value,t.messages,t.context).rules,false);
  t.messages[0].role='user';t.messages[2].ckGame.autoText='a different original';assert.equal(G.contextState(t.value,t.messages,t.context).ply,2);
});
test('another game in the same chat cannot substitute for this game',()=>{
  const t=transcript();const other={...t.value,id:'g-other'};
  assert.deepEqual(G.contextState(other,t.messages,t.context),{rules:false,ply:0,chatStyle:false,undoRules:false});
});
test('legacy full-board prompts and lowercase white moves keep ongoing games incremental',()=>{
  const t=transcript();t.messages[2].text=G.movePrompt(game(['H8','I9','G8']));t.messages[2].ckGame={gameId:t.value.id};
  t.messages[3].text='我接着下。\n【落子：j9】';
  const context=t.messages.slice(2).map(m=>({role:m.role,content:[{type:'text',text:'\n'+m.text}]}));
  assert.deepEqual(G.contextState(t.value,t.messages,context),{rules:true,ply:4,chatStyle:true,undoRules:true});
});
test('move display removes protocol lines and streaming fragments, keeping real speech and examples',()=>{
  assert.equal(G.stripMove('你连了两个，我堵一下。\n【落子：J6】'),'你连了两个，我堵一下。');
  for(const text of ['【','【落','【落子','【落子：','【落子：J'])assert.equal(G.stripMove('我想好了。\n'+text,true),'我想好了。');
  assert.equal(G.stripMove('【落子：J6】'),'');
  for(const text of ['我觉得 J6 可以。','> 【落子：J6】','```\n【落子：J6】\n```'])assert.equal(G.stripMove(text),text);
});
