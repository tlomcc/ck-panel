// 气泡里的「等待 Ns」必须是发送到最后一句真正进入 DOM 的总时间，不再是首字耗时。
const assert=require('assert');
const fs=require('fs');
const vm=require('vm');

const source=fs.readFileSync(require.resolve('../script.js'),'utf8');

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

function testFinalizeUsesLastRenderedTime(){
  const message={role:'assistant',text:'最后一句',userSentTs:1000,firstReplyTs:1800,waitPending:true};
  const timeEl={outerHTML:''};
  const row={querySelector(selector){return selector==='.chat-msg-time'?timeEl:null}};
  const box={querySelector(){return row}};
  const context={
    Date:{now:()=>6100},
    chatMessages:[message],
    chatIsAssistantRevealPending:()=>false,
    chatIsMessageGroupLast:()=>true,
    chatMessageTimingHtml:m=>'WAIT='+m.waitMs,
    chatSaveLocalMessagesDeferred(){context.saved=(context.saved||0)+1}
  };
  vm.createContext(context);
  vm.runInContext(extractFunction('chatFinalizeRenderedAssistantWaits'),context);
  assert.strictEqual(context.chatFinalizeRenderedAssistantWaits(box),true);
  assert.strictEqual(message.waitMs,5100,'必须用最后一句进入 DOM 的 6100 减发送时间 1000');
  assert.strictEqual(message.renderCompletedTs,6100);
  assert.strictEqual(message.waitPending,undefined);
  assert.strictEqual(timeEl.outerHTML,'WAIT=5100','时间定格后只刷新最后一句的时间行');
  assert.strictEqual(context.saved,1,'新口径要持久化，刷新后不能变回首字时间');
}

function testHiddenLastSentenceKeepsWaiting(){
  const message={role:'assistant',text:'还没显示',userSentTs:1000,waitPending:true};
  const context={
    Date:{now:()=>9000},
    chatMessages:[message],
    chatIsAssistantRevealPending:()=>true,
    chatRenderMessageRow(){throw new Error('hidden row must not render')},
    chatSaveLocalMessagesDeferred(){throw new Error('hidden row must not save')}
  };
  vm.createContext(context);
  vm.runInContext(extractFunction('chatFinalizeRenderedAssistantWaits'),context);
  assert.strictEqual(context.chatFinalizeRenderedAssistantWaits({querySelector(){return null}}),false);
  assert.strictEqual(message.waitPending,true,'分条最后一句没出现前不能提前定格');
  assert.strictEqual(message.waitMs,undefined);
}

function testWiring(){
  const append=extractFunction('chatAppendAssistantReplies');
  assert(append.includes('msg.waitPending=true'),'最后一条回复落地前只标等待中');
  assert(!append.includes('msg.waitMs=Math.max(0,firstReplyTs-userSentTs)'),
    '不能再把首字时间写成气泡等待时间');
  const render=extractFunction('chatRenderMessages');
  assert(render.includes('chatFinalizeRenderedAssistantWaits(box)'),
    '每次分条气泡插入 DOM 后都要检查最后一句是否已完成');
  const firstReply=source.slice(source.indexOf('function markFirstReplyTs()'),source.indexOf('// 回复收完整后再统一分段'));
  assert(!firstReply.includes('chatUpdateStreamingTiming'),
    '首字到达时不能再提前显示旧口径等待时间');
}

testFinalizeUsesLastRenderedTime();
testHiddenLastSentenceKeepsWaiting();
testWiring();

console.log('assistant total wait tests: OK');
