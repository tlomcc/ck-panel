const {test}=require('node:test');
const assert=require('node:assert/strict'),fs=require('fs'),vm=require('vm');
const history=require('../chat-history.js');
const source=fs.readFileSync(require.resolve('../script.js'),'utf8');
function setup(){
  const ctx={CHAT_HISTORY_TOOLS:history,chatSessionsReady:true,chatIndexedDbFailed:false,
    chatIndexedDbSupported:()=>true,chatTimeLabel:()=> '今天'};
  vm.createContext(ctx);
  for(const name of ['chatAutoTrimRoundCount','chatConversationRoundCount','chatTransportRoundCount','chatSessionMeta']){
    const start=source.indexOf('function '+name+'(');
    vm.runInContext(source.slice(start,source.indexOf('\n}',start)+2),ctx);
  }
  return ctx;
}
const turn=id=>[
  {role:'user',text:'第一条',turnId:id},{role:'user',text:'第二条',turnId:id},
  {role:'assistant',text:'分条回复一',turnId:id},{role:'assistant',text:'分条回复二',turnId:id}
];
const rebuilt=messages=>messages.map(m=>({role:m.role,content:m.text}));
const meta=(ctx,messages,transportMessages=[])=>ctx.chatSessionMeta({messages,transportMessages});

test('sidebar counts a send batch once before and after edited history is rebuilt',()=>{
  const ctx=setup(),messages=[...turn('a'),...turn('b')];
  assert.equal(meta(ctx,messages),'2 轮');
  assert.equal(meta(ctx,messages,rebuilt(messages)),'2 轮');
  assert.equal(history.transportTurnGroups(rebuilt(messages)).length,4,'fixture must reproduce transport inflation');
});
test('queued and failed messages never count, with or without transport history',()=>{
  const ctx=setup(),pending={role:'pending_user',text:'待发送',turnId:'p'};
  const failed={role:'user',text:'失败',sendFailed:true,turnId:'f'};
  assert.equal(meta(ctx,[pending,failed]),'新会话');
  const messages=[...turn('a'),pending,failed];
  assert.equal(meta(ctx,messages),'1 轮');
  assert.equal(meta(ctx,messages,rebuilt(turn('a'))),'1 轮');
});
test('sending, stopping, retrying and completing update the same batch without lag or duplication',()=>{
  const ctx=setup(),messages=turn('a'),transport=[{role:'user',content:'old'},{role:'assistant',content:'old reply'}];
  const current={role:'pending_user',text:'new',turnId:'b'};
  messages.push(current);assert.equal(meta(ctx,messages,transport),'1 轮');
  current.role='user';current.inFlight=true;assert.equal(meta(ctx,messages,transport),'2 轮');
  current.role='pending_user';delete current.inFlight;assert.equal(meta(ctx,messages,transport),'1 轮');
  current.role='user';current.sendFailed=true;assert.equal(meta(ctx,messages,transport),'1 轮');
  delete current.sendFailed;messages.push({role:'assistant',text:'done',turnId:'b'});
  assert.equal(meta(ctx,messages,rebuilt(messages)),'2 轮');
});
test('legacy batches, image-only messages, notices and tool continuations stay distinct',()=>{
  const ctx=setup(),legacy=turn('a').map(({turnId,...m})=>m);
  const messages=[{role:'assistant',text:'欢迎'},...legacy,{role:'system',text:'系统提示'},
    {role:'user',images:[{dataUrl:'data:image/png;base64,AA=='}],turnId:'image'},
    {role:'assistant',text:'看到了',turnId:'image'},{role:'user',text:'  '}];
  const transport=[...rebuilt(legacy),{role:'assistant',content:[{type:'tool_use',id:'x'}]},
    {role:'user',content:[{type:'tool_result',tool_use_id:'x',content:'ok'}]}];
  assert.equal(meta(ctx,messages,transport),'2 轮');
  assert.equal(meta(ctx,[{role:'assistant',text:'欢迎'}]),'新会话');
});
test('regeneration and version changes never add a round; deletion and trim reduce retained rounds',()=>{
  const ctx=setup(),messages=[...turn('a'),...turn('b'),...turn('c')];
  assert.equal(meta(ctx,messages,rebuilt(messages)),'3 轮');
  const kept=history.trimLocalTurns(messages,2).keptMessages;
  assert.equal(meta(ctx,kept,rebuilt(kept)),'2 轮');
  const regenerated=kept.slice(0,2);regenerated.push({role:'assistant',text:'新回复',turnId:'b',replyVariants:[{messages:turn('b')}]});
  assert.equal(meta(ctx,regenerated,rebuilt(regenerated)),'1 轮');
  const snapshot=JSON.stringify({messages,transportMessages:rebuilt(messages)});
  const stored=JSON.parse(snapshot);ctx.chatSessionMeta(stored);
  assert.equal(JSON.stringify(stored),snapshot,'counting must be read-only');
});
test('partial localStorage history is not presented as the full count while IndexedDB loads',()=>{
  const ctx=setup();ctx.chatSessionsReady=false;
  assert.equal(meta(ctx,turn('a'),rebuilt(turn('a'))),'加载中');
  ctx.chatSessionsReady=true;
  assert.equal(ctx.chatSessionMeta({messages:[...turn('a'),...turn('b')],updated:1}),'2 轮 · 今天');
  ctx.chatSessionsReady=false;ctx.chatIndexedDbFailed=true;
  assert.equal(meta(ctx,turn('a')),'1 轮');
  ctx.chatIndexedDbFailed=false;ctx.chatIndexedDbSupported=()=>false;
  assert.equal(meta(ctx,turn('a')),'1 轮');
});
