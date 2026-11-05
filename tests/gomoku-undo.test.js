const test=require('node:test'),assert=require('node:assert/strict');
const G=require('../gomoku.js');
const game=moves=>G.restore({version:1,id:'g-undo',created:1,moves});
const transcript=messages=>messages.map(m=>({role:m.role,text:m.text}));
const event=(value,text,turnId,kind='move',mode='sync')=>({role:'user',text,turnId,ckGame:{
  gameId:value.id,revision:value.revision,kind,mode,ply:value.moves.length,coordinate:value.moves.at(-1)||'',autoText:text
}});

test('user takeback removes their last stone and the subsequent white stone without changing the old game',()=>{
  const old=game(['H8','I9','G8','J9']),copy=structuredClone(old),next=G.undo(old,'black');
  assert.deepEqual(next.moves,['H8','I9']);assert.equal(G.position(next.moves).turn,'black');
  assert.equal(next.id,old.id);assert.equal(next.created,old.created);assert.equal(next.revision,1);
  assert.deepEqual(old,copy);assert.deepEqual(G.restore(JSON.parse(JSON.stringify(next))),next);
  const again=G.undo(next,'black');assert.deepEqual(again.moves,[]);assert.equal(again.revision,2);
  assert.throws(()=>G.undo(again,'black'),/还没有/);
});
test('a lone human stone can be undone and any pending action is detached',()=>{
  const old=game(['H8']);old.pending={id:'r-old',ply:2,prompt:G.movePrompt(old),checkedTurn:'old'};old.error='旧错误';
  const next=G.undo(old,'black');assert.deepEqual(next.moves,[]);assert.equal(next.pending,null);assert.equal(next.error,'');
  assert.equal(old.pending.id,'r-old');
});
test('a normally finished game can be taken back but an explicitly closed game stays closed',()=>{
  const won=game(['D8','A1','E8','C1','F8','E1','G8','G1','H8']);
  assert.equal(G.position(won.moves).winner,'black');
  const next=G.undo(won,'black');assert.equal(G.position(next.moves).winner,'');assert.equal(next.moves.length,8);
  assert.throws(()=>G.undo({...won,closed:true},'black'),/本局已结束/);
  assert.throws(()=>G.undo(game([]),'white'),/还没有/);assert.throws(()=>G.undo(won,'other'),/无法识别/);
});
test('a full drawn board reopens with the right player and no winner',()=>{
  const black=[],white=[];for(let y=0;y<15;y++)for(let x=0;x<15;x++)((x+2*y)%4<2?black:white).push(G.coordinate(x,y));
  const drawn=game(black.flatMap((c,i)=>white[i]?[c,white[i]]:[c]));assert.equal(G.position(drawn.moves).draw,true);
  const next=G.undo(drawn,'black'),position=G.position(next.moves);
  assert.equal(next.moves.length,224);assert.equal(position.draw,false);assert.equal(position.winner,'');assert.equal(position.turn,'black');
});
test('white can choose a takeback and replacement in one completed action',()=>{
  const old=game(['H8','I9','G8']),copy=structuredClone(old);
  for(const coordinate of ['J9','I9','G8']){
    const next=G.accept(old,'这一手我想换个地方。\n【悔棋：'+coordinate+'】');
    assert.deepEqual(next.moves,['H8',coordinate]);assert.equal(next.revision,1);assert.equal(next.pending,null);
    assert.equal(G.position(next.moves).turn,'black');assert.deepEqual(old,copy);
  }
});
test('normal moves do not opt the opponent into takeback',()=>{
  const old=game(['H8','I9','G8']);const next=G.accept(old,'【落子：J9】');
  assert.deepEqual(next.moves,['H8','I9','G8','J9']);assert.equal(next.revision,0);
  assert.match(G.movePrompt(old),/可以自行选择悔棋/);assert.match(G.movePrompt(old),/也可以一直不用；不要求你使用/);
  assert.equal(G.movePrompt(old).split('悔棋约定：').length-1,1);
});
test('invalid white takebacks leave the complete original board and pending request unchanged',()=>{
  const old=game(['H8','I9','G8']);old.pending={id:'r-undo',ply:4,prompt:G.movePrompt(old),checkedTurn:''};
  const copy=structuredClone(old);
  for(const text of ['【悔棋：H8】','【悔棋：P1】','【悔棋】','【悔棋：J9】\n【落子：K9】','【悔棋：J9】\n【悔棋：K9】']){
    assert.throws(()=>G.accept(old,text));assert.deepEqual(old,copy);
  }
  assert.throws(()=>G.accept(game(['H8']),'【悔棋：I9】'),/还没有/);
  assert.throws(()=>G.accept(game(['H8','I9']),'【悔棋：J9】'),/还没轮到/);
});
test('white cannot reopen a finished or closed game with a takeback marker',()=>{
  const won=game(['D8','A1','E8','C1','F8','E1','G8','G1','H8']);
  assert.throws(()=>G.accept(won,'【悔棋：G9】'),/本局已结束/);
  assert.throws(()=>G.accept({...game(['H8','I9','G8']),closed:true},'【悔棋：G9】'),/本局已结束/);
});
test('takeback parsing ignores examples, code, quoted text and speculation',()=>{
  assert.deepEqual(G.parseAction('我换一步。\n【悔棋：j9】'),{kind:'undo',coordinate:'J9'});
  for(const text of ['我想悔棋改下 J9','> 【悔棋：J9】','```\n【悔棋：J9】\n```','~~~\n【悔棋：J9】','    【悔棋：J9】','<pre>\n【悔棋：J9】</pre>'])assert.throws(()=>G.parseAction(text));
  assert.throws(()=>G.parseReply('【悔棋：J9】'));
  assert.deepEqual(G.parseAction('> 【悔棋：J9】\n【落子：K9】'),{kind:'move',coordinate:'K9'});
});
test('takeback protocol is removed only from game reply display and includes streaming fragments',()=>{
  assert.equal(G.stripMove('换个位置继续聊。\n【悔棋：J9】'),'换个位置继续聊。');
  for(const partial of ['【','【悔','【悔棋','【悔棋：','【悔棋：J'])assert.equal(G.stripMove('再想一下。\n'+partial,true),'再想一下。');
  for(const text of ['普通聊天说悔棋。','> 【悔棋：J9】','```\n【悔棋：J9】\n```'])assert.equal(G.stripMove(text),text);
});
test('takeback notifications carry the real board, end with black to play and reuse existing rules',()=>{
  const next=G.undo(game(['H8','I9','G8','J9']),'black'),prompt=G.movePrompt(next,{mode:'sync',undo:true});
  assert.match(prompt,/我已悔棋/);assert.deepEqual(G.promptMoves(prompt),['H8','I9']);assert.match(prompt,/轮到我执黑重新落子/);
  assert.doesNotMatch(prompt,/请落白棋|规则：|悔棋约定：|聊天约定：/);
  assert.deepEqual(G.promptMoves(G.movePrompt(G.undo(next,'black'),{mode:'sync',undo:true})),[]);
});
test('old games learn the optional capability once and retain incremental moves',()=>{
  const first=game(['H8']),text=G.movePrompt(first).split('\n').filter(line=>!line.startsWith('悔棋约定：')).join('\n');
  const messages=[event(first,text,'first'),{role:'assistant',text:'【落子：I9】',turnId:'first'}],next=game(['H8','I9','G8']);
  let known=G.contextState(next,messages,transcript(messages));assert.equal(known.undoRules,false);assert.equal(known.ply,2);
  const update=G.movePrompt(next,{mode:'delta',remindUndoRules:!known.undoRules});
  assert.match(update,/悔棋约定：/);assert.doesNotMatch(update,/规则：|当前黑棋|当前白棋/);
  messages.push(event(next,update,'second','move','delta'),{role:'assistant',text:'【落子：J9】',turnId:'second'});
  known=G.contextState(game(['H8','I9','G8','J9','F8']),messages,transcript(messages));
  assert.equal(known.undoRules,true);assert.equal(known.ply,4);
  assert.equal(G.movePrompt(game(['H8','I9','G8','J9','F8']),{mode:'delta',remindUndoRules:!known.undoRules}),'第 5 手：黑棋 F8。请落白棋。');
});
test('obsolete branches cannot stand in for an empty board after undo, even if coordinates repeat',()=>{
  const first=game(['H8']),messages=[event(first,G.movePrompt(first),'first'),{role:'assistant',text:'【落子：I9】',turnId:'first'}];
  const empty=G.undo(game(['H8','I9']),'black'),next=G.play(empty,'H8','black');
  let known=G.contextState(next,messages,transcript(messages));assert.equal(known.rules,true);assert.equal(known.ply,-1);
  const notice=event(empty,G.movePrompt(empty,{mode:'sync',undo:true}),'undo','undo');
  messages.push(notice,{role:'assistant',text:'好呀。',turnId:'undo'});
  known=G.contextState(next,messages,transcript(messages));assert.equal(known.ply,0);
  assert.equal(G.contextState(next,messages,transcript(messages).slice(0,2)).ply,-1,'a removed undo notice requires a board sync');
});
test('AI takebacks cause a new branch sync, then future turns can be incremental',()=>{
  const first=game(['H8']),third=game(['H8','I9','G8']);
  const messages=[event(first,G.movePrompt(first),'first'),{role:'assistant',text:'【落子：I9】',turnId:'first'},
    event(third,G.movePrompt(third,{mode:'delta'}),'undo','move','delta'),{role:'assistant',text:'【悔棋：J9】',turnId:'undo'}];
  const next=G.play(G.accept(third,'【悔棋：J9】'),'G8','black');
  let known=G.contextState(next,messages,transcript(messages));assert.equal(known.rules,true);assert.equal(known.ply,-1);
  messages.push(event(next,G.movePrompt(next,{mode:'sync'}),'new-branch'),{role:'assistant',text:'【落子：K9】',turnId:'new-branch'});
  const fifth=G.play(G.accept(next,'【落子：K9】'),'F8','black');known=G.contextState(fifth,messages,transcript(messages));
  assert.equal(known.ply,4);assert.equal(known.undoRules,true);
});
test('old storage gets an initial revision while corrupt revisions remain unreadable',()=>{
  assert.equal(game(['H8']).revision,0);
  for(const revision of [-1,1.5,'1',Number.MAX_SAFE_INTEGER+1])assert.throws(()=>G.restore({...game(['H8']),revision}),/悔棋记录/);
});
