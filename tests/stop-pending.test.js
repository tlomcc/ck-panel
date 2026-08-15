const assert=require('assert');
const fs=require('fs');
const vm=require('vm');

const source=fs.readFileSync(require.resolve('../script.js'),'utf8');

function extractFunction(name){
  const start=source.indexOf(`function ${name}(`);
  assert(start>=0,`missing function ${name}`);
  const brace=source.indexOf('{',start);
  let depth=0;
  for(let index=brace;index<source.length;index++){
    if(source[index]==='{')depth++;
    if(source[index]==='}'&&--depth===0)return source.slice(start,index+1);
  }
  throw new Error(`unterminated function ${name}`);
}

function makeContext(messages){
  const session={transportMessages:[{role:'user',content:'request mutation'}],transportUpdated:999};
  const calls={save:0,render:0,pendingBar:0,status:[],removed:0};
  const context={
    console,
    Date,
    CHAT_MAX_TRANSPORT_MESSAGES:200,
    chatMessages:messages,
    chatEnsurePendingMessageId(message){
      if(!message.pendingId)message.pendingId='pending-test';
      return message.pendingId;
    },
    chatMarkMessageFresh(message){message.freshForTest=true;},
    chatCurrentSession(){return session;},
    chatLimitArray(list,max){return list.slice(-max);},
    chatSaveLocalMessages(){calls.save++;},
    chatRenderMessages(options){calls.render++;calls.renderOptions=options;},
    chatRenderPendingBar(){calls.pendingBar++;},
    chatSetStatus(status){calls.status.push(status);}
  };
  vm.createContext(context);
  vm.runInContext(extractFunction('chatFinalizeStoppedRequest'),context);
  return {context,session,calls};
}

function testStopBeforeRequestStarts(){
  const pending={role:'pending_user',text:'刚发送的消息',ts:100};
  const messages=[pending];
  const {context,calls}=makeContext(messages);
  const request={
    pendingMessages:[pending],
    submitTs:200,
    out:{parentNode:{remove(){calls.removed++;}}}
  };

  assert.strictEqual(context.chatFinalizeStoppedRequest(request),true);
  assert.strictEqual(messages.length,1,'停止不得新增助手气泡');
  assert.strictEqual(messages[0],pending,'原用户消息必须留在原位');
  assert.strictEqual(pending.role,'pending_user','消息必须保持待发送');
  assert.strictEqual(pending.pendingId,'pending-test','待发送消息必须有 pendingId');
  assert.strictEqual(calls.removed,1,'流式占位气泡必须移除');
  assert.deepStrictEqual(calls.status,['已停止']);
}

function testStopAfterRequestStarts(){
  const previousAssistant={role:'assistant',text:'此前的正常回复',ts:50};
  const sending={
    role:'user',text:'正在发送的消息',ts:300,pendingId:'old-pending',
    regenerateRequest:true,regenerateCutoff:1,sendFailed:true,failedAt:301,
    cacheHit:true,cacheRead:10,cacheCreate:20,cacheState:'read',
    cacheInputTotal:30,cacheRatio:0.5
  };
  const messages=[previousAssistant,sending];
  const {context,session,calls}=makeContext(messages);
  const transportSnapshot={messages:[{role:'assistant',content:'stable history'}],updated:123};
  const request={
    pendingMessages:[sending],submitTs:400,transportSnapshot,
    stopSnapshot(){throw new Error('停止时不得再保存部分助手回复');},
    out:{parentNode:{remove(){calls.removed++;}}}
  };

  assert.strictEqual(context.chatFinalizeStoppedRequest(request),true);
  assert.deepStrictEqual(messages,[previousAssistant,sending],'停止不得插入部分回复或“已停止”气泡');
  assert.strictEqual(sending.role,'pending_user','已转成 user 的在途消息必须改回待发送');
  assert.strictEqual(sending.ts,400);
  assert.strictEqual(sending.cacheHit,false);
  ['regenerateRequest','regenerateCutoff','sendFailed','failedAt','cacheRead','cacheCreate',
   'cacheState','cacheInputTotal','cacheRatio'].forEach(key=>{
    assert.strictEqual(Object.prototype.hasOwnProperty.call(sending,key),false,`${key} 必须清除`);
  });
  assert.strictEqual(sending.freshForTest,true);
  assert.deepStrictEqual(session.transportMessages,transportSnapshot.messages,'transport 历史必须回滚');
  assert.strictEqual(session.transportUpdated,123);
  assert.strictEqual(calls.save,1);
  assert.strictEqual(calls.render,1);
  assert.strictEqual(calls.pendingBar,1);
  assert.strictEqual(calls.removed,1);
  assert.strictEqual(request.out,null);

  assert.strictEqual(context.chatFinalizeStoppedRequest(request),false,'重复收尾必须幂等');
  assert.strictEqual(messages.length,2,'重复收尾也不得产生助手气泡');
  assert.strictEqual(calls.save,1,'重复收尾不得再次保存');
}

function testStoppedBubbleCodeIsGone(){
  const finalize=extractFunction('chatFinalizeStoppedRequest');
  assert(!finalize.includes('（已停止）'),'停止收尾里不得再构造“已停止”文案');
  assert(!finalize.includes('chatInsertMessagesBeforePending'),'停止收尾里不得插入助手消息');
  assert(!finalize.includes('stopSnapshot'),'停止收尾里不得读取部分回复快照');
}

testStopBeforeRequestStarts();
testStopAfterRequestStarts();
testStoppedBubbleCodeIsGone();
console.log('stop-pending tests passed');
