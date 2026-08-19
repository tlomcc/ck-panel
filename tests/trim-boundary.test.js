const assert=require('assert');
const fs=require('fs');
const vm=require('vm');
// 用真实的轮次分组/裁剪实现，避免桩把"是否按完整轮次裁剪"这件事测虚了
const historyTools=require('../chat-history.js');

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

function load(context,names){
  vm.createContext(context);
  names.forEach(name=>vm.runInContext(extractFunction(name),context));
  return context;
}

// ---------------------------------------------------------------------------
// 措辞偏好重试队列：截断不再等待偏好提取成功，没审阅到的内容必须独立留存
// ---------------------------------------------------------------------------
function testSpeechQueueNormalization(){
  const context=load({console,CHAT_SPEECH_QUEUE_MAX_ROWS:3,CHAT_SPEECH_QUEUE_MAX_CHARS:100000},
    ['chatSpeechPreferenceNormalizeQueue']);

  const rows=context.chatSpeechPreferenceNormalizeQueue([
    {message_id:'a',text:'第一条',ts:10},
    {message_id:'a',text:'重复的同一条',ts:11},
    {message_id:'b',text:'   ',ts:12},
    {message_id:'c',text:'第三条',ts:13},
    {message_id:'d',text:'第四条',ts:14},
    {message_id:'e',text:'超出条数上限',ts:15}
  ]);
  assert.strictEqual(rows.map(r=>r.message_id).join(','),'a,c,d','按 message_id 去重并按条数封顶');
  assert.strictEqual(rows[0].text,'第一条','保留首次出现的内容');
  assert.strictEqual(rows[0].role,'user');

  const capped=load({console,CHAT_SPEECH_QUEUE_MAX_ROWS:500,CHAT_SPEECH_QUEUE_MAX_CHARS:400},
    ['chatSpeechPreferenceNormalizeQueue']).chatSpeechPreferenceNormalizeQueue([
      {message_id:'x',text:'x'.repeat(300),ts:1},
      {message_id:'y',text:'y'.repeat(300),ts:2}
    ]);
  assert.strictEqual(capped.length,1,'超过字符上限后停止收集');

  const empty=context.chatSpeechPreferenceNormalizeQueue(null);
  assert.strictEqual(empty.length,0,'非数组输入返回空队列');
}

function testPrepareBatchConsumesQueueFirst(){
  const context=load({
    console,
    CHAT_SPEECH_QUEUE_MAX_ROWS:200,
    CHAT_SPEECH_QUEUE_MAX_CHARS:40000,
    chatSpeechPreferenceMessageId:(message,index)=>String(message.messageId||('m'+index))
  },['chatSpeechPreferenceNormalizeQueue','chatSpeechPreferencePrepareBatch']);

  const batch=context.chatSpeechPreferencePrepareBatch(
    [{role:'user',messageId:'new1',text:'新消息',ts:100}],
    [{message_id:'old1',text:'上次没审阅完的',ts:1}]
  );
  assert.strictEqual(batch.messages.map(m=>m.message_id).join(','),'old1,new1','旧队列优先，不会被新消息一直挤后面');
  assert.strictEqual(batch.complete,true);
  assert.strictEqual(batch.leftoverRows.length,0);

  const deduped=context.chatSpeechPreferencePrepareBatch(
    [{role:'user',messageId:'same',text:'正文',ts:5}],
    [{message_id:'same',text:'队列里的同一条',ts:5}]
  );
  assert.strictEqual(deduped.messages.length,1,'同一条消息不会因为在队列里又被重复发送');
  assert.strictEqual(deduped.messages[0].text,'队列里的同一条');
}

function testQueueCommitSemantics(){
  const context=load({console,CHAT_SPEECH_QUEUE_MAX_ROWS:200,CHAT_SPEECH_QUEUE_MAX_CHARS:40000},
    ['chatSpeechPreferenceNormalizeQueue','chatSpeechPreferenceQueueCommit']);

  const failed={speechPreferenceRetryQueue:[]};
  context.chatSpeechPreferenceQueueCommit(failed,{ok:false,retryRows:[{message_id:'a',text:'待重试',ts:1}]});
  assert.strictEqual(failed.speechPreferenceRetryQueue.length,1,'prepare 失败时把内容排队等下次');

  const done={speechPreferenceRetryQueue:[{message_id:'a',text:'旧的',ts:1}]};
  context.chatSpeechPreferenceQueueCommit(done,{ok:true,reviewComplete:true});
  assert.strictEqual(done.speechPreferenceRetryQueue.length,0,'完整成功后清空队列');

  const partial={speechPreferenceRetryQueue:[{message_id:'a',text:'旧的',ts:1}]};
  context.chatSpeechPreferenceQueueCommit(partial,{ok:true,reviewComplete:false});
  assert.strictEqual(partial.speechPreferenceRetryQueue.length,1,'只审阅了一部分时不能清空队列');
}

// ---------------------------------------------------------------------------
// 截断提交不再被措辞偏好绑住
// ---------------------------------------------------------------------------
function commitContext(session){
  const context={
    console,
    chatMessages:[],
    chatEditingIndex:-1,
    CHAT_MAX_TRANSPORT_MESSAGES:400,
    CHAT_SPEECH_QUEUE_MAX_ROWS:200,
    CHAT_SPEECH_QUEUE_MAX_CHARS:40000,
    chatCurrentSession:()=>session,
    chatLimitArray:(list,max)=>(list||[]).slice(-max),
    chatResetSessionAnchorFromMessages:()=>{},
    chatSaveSessions:()=>{},
    chatRenderSessions:()=>{},
    chatRenderTrimState:()=>{}
  };
  return load(context,['chatSpeechPreferenceNormalizeQueue','chatSpeechPreferenceQueueCommit','chatCommitAutoTrimPlan']);
}

function testTrimCommitsWhenPrepareFails(){
  const session={messages:[],transportMessages:[{role:'user'},{role:'assistant'}],speechPreferenceRetryQueue:[]};
  const context=commitContext(session);
  const plan={
    trimmed:true,canonicalTransport:true,cacheBoundary:true,trigger:'cache_1h',
    keptMessages:[{role:'user',text:'保留'}],deferred:[],
    keptTransportMessages:[{role:'user'}],
    droppedMessages:[],
    droppedTransportMessages:[session.transportMessages[1]],
    before:10,after:4,dropped:6,historyBefore:10,historyAfter:4,keep:4,
    transportBefore:10,transportAfter:4,localBefore:10,localAfter:4,
    requiredPreferenceThroughTs:9999,forceCacheRebuild:true
  };

  const result=context.chatCommitAutoTrimPlan({},plan,{
    ok:false,reviewComplete:false,reviewedThroughTs:0,
    retryRows:[{message_id:'a',text:'没审阅到的原话',ts:1}]
  });

  assert.strictEqual(result.trimmed,true,'偏好提取失败时历史仍然要被截断');
  assert.strictEqual(result.dropped,6,'截断数量按计划提交');
  assert.strictEqual(result.historyAfter,4);
  assert.strictEqual(result.trimDeferredForSpeechReview,false,'不再存在"因偏好未审阅而推迟截断"的状态');
  assert.strictEqual(session.transportMessages.length,1,'canonical transport 同步裁剪');
  assert.strictEqual(session.cacheRebuildPending,true,'边界后标记重建缓存');
  assert.strictEqual(session.speechPreferenceRetryQueue.length,1,'未审阅内容转入重试队列，不随历史一起丢失');
}

function testTrimCommitsWhenReviewIncomplete(){
  const session={messages:[],transportMessages:[],speechPreferenceRetryQueue:[]};
  const context=commitContext(session);
  // reviewedThroughTs 远小于 requiredPreferenceThroughTs：旧实现会因此拒绝截断
  const result=context.chatCommitAutoTrimPlan({},{
    trimmed:true,canonicalTransport:false,cacheBoundary:true,trigger:'manual_trim',manual:true,
    keptMessages:[],deferred:[],keptTransportMessages:[],
    before:8,after:3,dropped:5,historyBefore:8,historyAfter:3,keep:3,
    requiredPreferenceThroughTs:99999
  },{ok:true,reviewComplete:false,reviewedThroughTs:1,activationId:'act-1',eventId:'evt-1'});

  assert.strictEqual(result.trimmed,true,'只审阅了一部分也要提交截断');
  assert.strictEqual(result.dropped,5);
  assert.strictEqual(session.speechPreferencePendingActivationId,'act-1','成功的 activation 仍然记录');
}

function testTrimCommitPreservesMessagesAppendedAfterPlanning(){
  const dropped={role:'user',text:'旧消息'};
  const kept={role:'assistant',text:'保留消息'};
  const appended={role:'pending_user',text:'准备期间新发的消息'};
  const transportDropped={role:'user',text:'旧 transport'};
  const transportKept={role:'assistant',text:'保留 transport'};
  const transportAppended={role:'user',text:'新 transport'};
  const session={messages:[dropped,kept,appended],transportMessages:[transportDropped,transportKept,transportAppended],speechPreferenceRetryQueue:[]};
  const context=commitContext(session);
  context.chatMessages=session.messages;
  context.chatCommitAutoTrimPlan({}, {
    trimmed:true,canonicalTransport:true,cacheBoundary:true,trigger:'cache_1h',
    droppedMessages:[dropped],droppedTransportMessages:[transportDropped],
    before:2,after:1,dropped:1,historyBefore:2,historyAfter:1,keep:1
  },{ok:true,reviewComplete:true});
  assert.deepStrictEqual(context.chatMessages,[kept,appended],'提交只能扣除计划删除项，不能覆盖准备期间的新消息');
  assert.deepStrictEqual(session.transportMessages,[transportKept,transportAppended],'transport 也必须保留计划后新增内容');
}

// ---------------------------------------------------------------------------
// 1h 边界对全部缓存策略一致生效
// ---------------------------------------------------------------------------
function planContext(cacheStrategy,session,messages){
  const context={
    console,
    chatMessages:messages,
    chatEditingIndex:-1,
    CHAT_AUTO_TRIM_IDLE_MS:60*60*1000,
    CHAT_HISTORY_TOOLS:historyTools,
    chatPendingMessages:()=>[],
    chatCurrentSession:()=>session,
    chatLoadConfig:()=>({cacheStrategy}),
    chatAutoTrimConfigFrom:()=>({enabled:true,keep:2}),
    chatAutoTrimRoundCount:list=>(list||[]).filter(m=>m&&m.role==='user').length,
    chatTransportRoundCount:list=>(list||[]).filter(m=>m&&m.role==='user').length,
    chatIsRealMessage:m=>!!(m&&(m.role==='user'||m.role==='assistant')),
    chatHasCacheNoticeAfter:()=>false,
    chatCacheActivityReference:(s,fallback)=>({
      timestamp:Number(s&&s.cacheLastReadAt)||Number(fallback)||0,
      source:'cache_read'
    })
  };
  return load(context,['chatPlanAutoTrimForPendingBatch']);
}

function staleRounds(count,ts){
  const out=[];
  for(let i=1;i<=count;i++){
    out.push({role:'user',text:'问 '+i,ts:ts,turnId:'t'+i});
    out.push({role:'assistant',text:'答 '+i,ts:ts,turnId:'t'+i});
  }
  return out;
}

function testIdleBoundaryAppliesToEveryCacheStrategy(){
  const strategies=['single_5m','assistant_latest','native_stable','native_tiered','prefix_24h'];
  const stale=Date.now()-2*60*60*1000;
  strategies.forEach(strategy=>{
    const messages=staleRounds(5,stale);
    const session={transportMessages:[],cacheLastReadAt:stale};
    const context=planContext(strategy,session,messages);
    // idleCheck=true：页面在线定时器路径，没有待发送消息也要能到点截断
    const plan=context.chatPlanAutoTrimForPendingBatch({cacheStrategy:strategy},[],{trigger:'idle_1h',idleCheck:true});
    assert.strictEqual(plan.boundary,true,strategy+' 必须触发 1h 边界');
    assert.strictEqual(plan.cacheAgeBoundary,true,strategy+' 的 cacheAgeBoundary 必须为真');
    assert.strictEqual(plan.trimmed,true,strategy+' 超过保留轮数时必须裁剪');
    assert.strictEqual(plan.historyAfter,2,strategy+' 必须保留设定的轮数');
    assert.strictEqual(plan.dropped,3,strategy+' 必须裁掉多余的完整轮次');
  });
}

function testIdleBoundaryDoesNotFireEarly(){
  const fresh=Date.now()-5*60*1000;
  const session={transportMessages:[],cacheLastReadAt:fresh};
  const context=planContext('native_stable',session,staleRounds(5,fresh));
  const plan=context.chatPlanAutoTrimForPendingBatch({cacheStrategy:'native_stable'},[],{trigger:'idle_1h',idleCheck:true});
  assert.strictEqual(plan.boundary,false,'未满 1 小时不能误触发');
  assert.strictEqual(plan.trimmed,false);
}

function testEmptySessionDoesNotTrigger(){
  const session={transportMessages:[],cacheLastReadAt:0};
  const context=planContext('native_stable',session,[]);
  const plan=context.chatPlanAutoTrimForPendingBatch({cacheStrategy:'native_stable'},[],{trigger:'idle_1h',idleCheck:true});
  assert.strictEqual(plan.boundary,false,'空会话没有缓存活动时间，不能触发截断');
}

function testIdleCheckRequiredForUnsentBoundary(){
  const stale=Date.now()-2*60*60*1000;
  const session={transportMessages:[],cacheLastReadAt:stale};
  const context=planContext('native_stable',session,staleRounds(5,stale));
  // 没有待发送消息、也没有 idleCheck：属于纯粹的状态查询，不应该顺手改历史
  const plan=context.chatPlanAutoTrimForPendingBatch({cacheStrategy:'native_stable'},[],{});
  assert.strictEqual(plan.cacheAgeBoundary,false,'纯查询不得触发截断');
}

function testManualTrimIgnoresCacheAge(){
  const fresh=Date.now()-60*1000;
  const session={transportMessages:[],cacheLastReadAt:fresh};
  const context=planContext('prefix_24h',session,staleRounds(6,fresh));
  // 手动截断不看 1h 边界，点了就应该立刻按真实轮次裁剪
  const plan=context.chatPlanAutoTrimForPendingBatch({cacheStrategy:'prefix_24h'},[],{force:true,trigger:'manual_trim'});
  assert.strictEqual(plan.boundary,true,'手动截断必须直接成立');
  assert.strictEqual(plan.trimmed,true,'手动截断必须真的裁剪');
  assert.strictEqual(plan.historyAfter,2);
}

testSpeechQueueNormalization();
testPrepareBatchConsumesQueueFirst();
testQueueCommitSemantics();
testTrimCommitsWhenPrepareFails();
testTrimCommitsWhenReviewIncomplete();
testTrimCommitPreservesMessagesAppendedAfterPlanning();
testIdleBoundaryAppliesToEveryCacheStrategy();
testIdleBoundaryDoesNotFireEarly();
testEmptySessionDoesNotTrigger();
testIdleCheckRequiredForUnsentBoundary();
testManualTrimIgnoresCacheAge();

console.log('trim boundary tests: OK');
