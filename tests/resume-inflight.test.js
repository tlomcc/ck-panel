// 2026-08-26 用户报的：正在生成的时候不小心退出 CK（直接回到手机桌面），API 那边其实已经
// 响应完了，但面板收不到任何消息，底下的发送键还变成了绿色，点了却毫无反应。
//
// 真因（两个独立的坑）：
//   1. 手机把页面冻结/杀掉时 fetch 的 socket 断掉，catch/finally 一行都跑不到：
//      既不标 sendFailed、也不写任何本地状态。而消息在发出去那一刻就已经从
//      pending_user 提升成 user 了，于是回来后待发队列和失败队列**都是空的**。
//   2. chatSendMessage 那个 if 的五个条件全为假时函数直接落到尾部，没有 else：
//      按钮是正常的绿色（那就是「发送」的常态样式），点下去什么都不发生也没有提示。
//
// 现在：发出去的同一刻同步落盘 in_flight 标记 → 回来时先去网关 /ck/chat/last 补收 →
// 补不到就标成 sendFailed，让既有的「发送失败 · 点击重试」按钮亮起来、发送键也重新可用。
const assert=require('assert');
const fs=require('fs');
const path=require('path');
const vm=require('vm');

const root=path.resolve(__dirname,'..');
const source=fs.readFileSync(path.join(root,'script.js'),'utf8');

function extractFunction(name){
  const start=source.indexOf('function '+name+'(');
  assert(start>=0,'missing function '+name);
  const brace=source.indexOf('{',start);
  let depth=0;
  for(let i=brace;i<source.length;i++){
    if(source[i]==='{')depth++;
    if(source[i]==='}'&&--depth===0)return source.slice(start,i+1);
  }
  throw new Error('unterminated function '+name);
}

const ctx={console};
vm.createContext(ctx);
vm.runInContext('var chatMessages=[];',ctx);
vm.runInContext('function chatNormalizeImageList(list){return Array.isArray(list)?list:[]}',ctx);
['chatMessageImages','chatMessageHasContent','chatFailedUserMessages',
 'chatClearInFlightMarks','chatInterruptedInFlightMessages','chatMarkInterruptedAsFailed']
  .forEach(name=>vm.runInContext(extractFunction(name),ctx));

function setMessages(list){
  ctx.chatMessages.length=0;
  list.forEach(m=>ctx.chatMessages.push(m));
  return ctx.chatMessages;
}

// ---------------------------------------------------------------------------
// 认出"发出去了但没回复"的那一轮
// ---------------------------------------------------------------------------
function testDetectInterrupted(){
  setMessages([
    {role:'user',text:'第一句',inFlight:true},
    {role:'assistant',text:'答了'},
    {role:'user',text:'第二句',inFlight:true},
  ]);
  const hit=ctx.chatInterruptedInFlightMessages();
  assert.strictEqual(hit.length,1,'后面已经跟着回复的那一条不算被打断');
  assert.strictEqual(hit[0].text,'第二句');

  setMessages([{role:'user',text:'正常的一轮'},{role:'assistant',text:'答了'}]);
  assert.strictEqual(ctx.chatInterruptedInFlightMessages().length,0,'没有标记就没有被打断的轮次');

  setMessages([{role:'pending_user',text:'还没发出去',inFlight:true}]);
  assert.strictEqual(ctx.chatInterruptedInFlightMessages().length,0,'待发状态本来就能重发，不算');

  setMessages([{role:'user',text:'   ',inFlight:true}]);
  assert.strictEqual(ctx.chatInterruptedInFlightMessages().length,0,'空内容不算');
}

// ---------------------------------------------------------------------------
// 补收成功就清标记，补不到就标成发送失败（这样发送键才重新有事可做）
// ---------------------------------------------------------------------------
function testClearAndFail(){
  const list=setMessages([
    {role:'user',text:'甲',inFlight:true,inFlightAt:1,inFlightTurnId:'t1'},
    {role:'user',text:'乙',inFlight:true,inFlightAt:2,inFlightTurnId:'t1'},
  ]);
  assert.strictEqual(ctx.chatClearInFlightMarks([0]),true);
  assert.strictEqual(list[0].inFlight,undefined);
  assert.strictEqual(list[0].inFlightAt,undefined);
  assert.strictEqual(list[0].inFlightTurnId,undefined);
  assert.strictEqual(list[1].inFlight,true,'只清指定的那几条');
  assert.strictEqual(ctx.chatClearInFlightMarks([0]),false,'已经清过就不再报改动');
  assert.strictEqual(ctx.chatClearInFlightMarks(null),false);

  const interrupted=ctx.chatInterruptedInFlightMessages();
  assert.strictEqual(interrupted.length,1);
  assert.strictEqual(ctx.chatMarkInterruptedAsFailed(interrupted),true);
  assert.strictEqual(list[1].inFlight,undefined,'标成失败时标记要一起清掉');
  assert.strictEqual(list[1].sendFailed,true);
  assert.ok(list[1].failedAt>0);
  // 这一条是关键：失败队列非空之后，发送键那个 if 才有东西可发
  assert.strictEqual(ctx.chatFailedUserMessages().length,1);
}

// ---------------------------------------------------------------------------
// 接线：标记要同步落盘，三条退出路径都要清，发送键不能再空转
// ---------------------------------------------------------------------------
function testWiring(){
  const submit=extractFunction('chatSubmitPendingMessages');
  assert(submit.includes('m.inFlight=true'),'提升成 user 的同一刻就要打 in_flight 标记');
  assert(submit.includes('m.inFlightTurnId=requestTurnId'),'要带上轮次 id，补收时好对账');
  assert(submit.includes('turn_id:requestTurnId'),'轮次 id 要发给网关');
  assert(submit.includes('chatClearInFlightMarks(userMessageIndexes)'),'成功落地要清标记');
  assert(submit.includes('delete chatMessages[idx].inFlight'),'失败分支也要清');
  // 同步保存：deferred 版本靠 requestIdleCallback，进程被杀时标记根本没落盘
  const tail=submit.slice(submit.indexOf('userMessageIndexes.forEach(chatUpdateMessageRowOnly)'));
  assert(tail.indexOf('chatSaveLocalMessages()')>=0,'in_flight 标记必须同步保存');
  assert(tail.slice(0,400).indexOf('chatSaveLocalMessagesDeferred')<0,
    '这里不能再用 deferred 保存，否则标记会跟着进程一起没');

  const stopped=extractFunction('chatFinalizeStoppedRequest');
  assert(stopped.includes('delete message.inFlight'),'手动停止也要清标记');

  const send=extractFunction('chatSendMessage');
  assert(send.includes('chatInterruptedInFlightMessages()'),'点发送时要能处理被打断的那一轮');
  assert(send.includes("toast('没有要发送的内容')"),'没东西可发时必须有提示，不能静默空转');

  const recover=extractFunction('chatRecoverInterruptedTurns');
  assert(recover.includes('/ck/chat/last'),'补收要走网关那个新接口');
  assert(recover.includes('turn_id='),'要带 turn_id 对账');
  assert(recover.includes('chatAppendAssistantReplies'),'补收到就当正常回复落地');
  assert(recover.includes('chatMarkInterruptedAsFailed'),'补不到要标成可重发');
  assert(recover.includes('transport_messages'),'顺手把隐藏历史接过来，下一轮上下文才不缺');
  assert(recover.includes('chatRecoverInFlightBusy'),'要有并发守卫');

  assert(source.includes("window.addEventListener('pageshow'"),'回到前台/前进后退都要检查一次');
  assert(/visibilitychange[\s\S]{0,400}chatRecoverInterruptedTurns/.test(source),
    '从后台切回来要检查一次——这正是用户退出 CK 又回来的那个场景');
  assert(/chatRenderDailyDigest\(cfg\);[\s\S]{0,200}chatRecoverInterruptedTurns/.test(source),
    'IndexedDB 权威全量回填之后也要检查一次（刷新页面那条路）');
  assert(source.includes('var chatRecoverInFlightBusy=false;'),'并发守卫要有声明');
}

testDetectInterrupted();
testClearAndFail();
testWiring();

console.log('resume in-flight tests: OK');
