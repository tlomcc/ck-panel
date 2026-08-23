// 重新生成 = 给这一轮回复加一个版本，而不是把旧答案删掉。
//
// 需求（用户 2026-08-23）：点完重新生成，助手那条不该消失，应该像双击改自己发出去的
// 消息那样出现两个三角翻页；并且"不能影响缓存，网关要以页面显示的最新内容为准"。
// 后半句在物理上只能做到这一步：改了助手正文，从那条往后的上游字节前缀必然变，
// 缓存只能重建那一段；能保证的是**发出去的历史永远等于屏幕上显示的**（不能显示 A
// 却把 B 发给模型），以及前面那段前缀保持逐字一致，只重算尾巴。
// 所以这里把两件事都测死：版本不丢 + 切版本必须让隐藏 transport 作废。
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

const FNS=[
  'chatCloneReplyMessages','chatAssistantGroupRange','chatNormalizeReplyVariant',
  'chatStoredReplyVariants','chatReplyVariantFromMessages','chatReplyVariantInfo',
  'chatCollectReplyVariants','chatTrimReplyVariants','chatAssistantVariantSignature',
  'chatReplyVariantNavHtml','chatSwitchReplyVariant'
];

function makeContext(messages){
  const calls={invalidated:0,saved:0,rendered:0};
  const context={
    console,Date,JSON,Array,Math,Number,String,Object,
    chatMessages:messages,
    chatSending:false,
    chatEditingIndex:-1,
    CHAT_REPLY_VARIANT_MAX:6,
    esc:v=>String(v),
    chatCancelEdit(){},
    chatInvalidateTransportForEdit(){calls.invalidated++;},
    chatSaveLocalMessages(){calls.saved++;},
    chatRenderMessages(){calls.rendered++;}
  };
  vm.createContext(context);
  FNS.forEach(name=>vm.runInContext(extractFunction(name),context));
  return {context,calls};
}

function assistant(text,ts,extra){
  return Object.assign({role:'assistant',text:text,ts:ts,turnId:'t-1'},extra||{});
}

// ── 一组回复的边界要按"连续的 assistant"算，分条拆成几条也算同一组 ──────────
function testGroupRange(){
  const messages=[
    {role:'user',text:'问',ts:1},
    assistant('答一',2),assistant('答二',3),
    {role:'user',text:'再问',ts:4},
    assistant('答三',5)
  ];
  const {context}=makeContext(messages);
  assert.deepEqual(context.chatAssistantGroupRange(1),{start:1,end:2});
  assert.deepEqual(context.chatAssistantGroupRange(2),{start:1,end:2},'组内任意一条都要解析到同一组');
  assert.deepEqual(context.chatAssistantGroupRange(4),{start:4,end:4});
  assert.strictEqual(context.chatAssistantGroupRange(0),null,'用户消息没有回复组');
}

// ── 没有版本记录时，先把当前这一组现造成第一版 ─────────────────────────────
function testCollectSeedsTheFirstVariant(){
  const messages=[{role:'user',text:'问',ts:1},assistant('旧答案 A',2),assistant('旧答案 B',3)];
  const {context}=makeContext(messages);
  const variants=context.chatCollectReplyVariants(context.chatAssistantGroupRange(1));
  assert.strictEqual(variants.length,1);
  assert.strictEqual(variants[0].messages.length,2,'分条拆出来的两条要一起进同一个版本');
  assert.strictEqual(variants[0].messages[0].text,'旧答案 A');
  // 快照必须是深拷贝：之后改 chatMessages 不能污染已存的版本
  messages[1].text='被改过了';
  assert.strictEqual(variants[0].messages[0].text,'旧答案 A','版本快照必须是深拷贝');
}

// ── 只有一个版本时不出翻页；两个以上才出，并且停在两端时按钮 disabled ────────
function testNavOnlyShowsWithRealVariants(){
  const one=[{role:'user',text:'问',ts:1},assistant('答',2)];
  assert.strictEqual(makeContext(one).context.chatReplyVariantNavHtml(1),'','单版本不许出翻页');

  const variants=[{ts:2,messages:[assistant('第一版',2)]},{ts:9,messages:[assistant('第二版',9)]}];
  const two=[{role:'user',text:'问',ts:1},assistant('第二版',9,{replyVariants:variants,replyVariantIndex:1})];
  const nav=makeContext(two).context.chatReplyVariantNavHtml(1);
  assert.ok(nav.includes('2/2'),'要显示第几版/共几版');
  assert.ok(nav.includes('chat-reply-variant-btn'),'翻页按钮要有自己的 class，别和用户消息版本混用处理');
  assert.ok(/data-dir="-1"[^>]*>◂/.test(nav)&&/data-dir="1"[^>]*>▸/.test(nav),'两个三角方向要对');
  const parts=nav.split('data-dir="1"');
  assert.ok(parts[1].includes('disabled'),'已经在最后一版，"下一版"必须禁用');
  assert.ok(!parts[0].split('data-dir="-1"')[1].split('>')[0].includes('disabled'),'还能往前翻，"上一版"不许禁用');
}

// ── 翻页：整组换掉；时间戳和 turnId 沿用当前这一组 ───────────────────────
function testSwitchingReplacesTheWholeGroup(){
  const variants=[
    {ts:2,messages:[assistant('第一版',777,{turnId:'old-turn'})]},
    {ts:9,messages:[assistant('第二版 A',9),assistant('第二版 B',10)]}
  ];
  const messages=[
    {role:'user',text:'问',ts:1,turnId:'t-9'},
    assistant('第二版 A',9,{turnId:'t-9',replyVariants:variants,replyVariantIndex:1}),
    assistant('第二版 B',10,{turnId:'t-9'})
  ];
  const {context,calls}=makeContext(messages);
  context.chatSwitchReplyVariant(2,-1);

  assert.strictEqual(messages.length,2,'两条变一条：整组换掉，不是叠加');
  assert.strictEqual(messages[1].text,'第一版');
  assert.strictEqual(messages[1].replyVariantIndex,0);
  assert.strictEqual(messages[1].replyVariants.length,2,'版本列表必须跟着走，否则翻回去就没了');
  assert.strictEqual(messages[1].turnId,'t-9','turnId 必须沿用当前这一轮，不能带回旧的');
  assert.strictEqual(messages[1].ts,9,'时间戳沿用当前这一组，别让消息时间往回跳');
  assert.strictEqual(calls.invalidated,1,'切版本必须让隐藏 transport 作废：发出去的要等于显示的');
  assert.strictEqual(calls.saved,1);
  assert.strictEqual(calls.rendered,1);

  // 再翻回去，来回都要稳
  context.chatSwitchReplyVariant(1,1);
  assert.strictEqual(messages.length,3);
  assert.strictEqual(messages[1].text,'第二版 A');
  assert.strictEqual(messages[2].text,'第二版 B');
  assert.strictEqual(messages[1].replyVariantIndex,1);
}

function testSwitchingIsIgnoredWhenPointless(){
  const variants=[{ts:2,messages:[assistant('一',2)]},{ts:3,messages:[assistant('二',3)]}];
  const messages=[{role:'user',text:'问',ts:1},assistant('一',2,{replyVariants:variants,replyVariantIndex:0})];
  const {context,calls}=makeContext(messages);
  context.chatSwitchReplyVariant(1,-1);
  assert.strictEqual(calls.invalidated,0,'已经在第一版，再往前翻不许白白作废 transport');
  context.chatSending=true;
  context.chatSwitchReplyVariant(1,1);
  assert.strictEqual(calls.invalidated,0,'正在发送时不许切版本');
}

// ── 渲染 key 必须包含版本信息，否则两版正文恰好一样时页码不刷新 ──────────────
function testRenderKeySeesVariantState(){
  const variants=[{ts:2,messages:[assistant('同样的话',2)]},{ts:3,messages:[assistant('同样的话',3)]}];
  const messages=[{role:'user',text:'问',ts:1},assistant('同样的话',3,{replyVariants:variants,replyVariantIndex:1})];
  const {context}=makeContext(messages);
  assert.strictEqual(context.chatAssistantVariantSignature(messages[1],1),'2:1');
  messages[1].replyVariantIndex=0;
  assert.strictEqual(context.chatAssistantVariantSignature(messages[1],1),'2:0');
  assert.strictEqual(context.chatAssistantVariantSignature(messages[0],0),'','用户消息不参与回复版本签名');
  assert.ok(/chatAssistantVariantSignature\(m,i\)/.test(extractFunction('chatMessageRenderKey')),
    'chatMessageRenderKey 必须带上回复版本签名');
}

function testVariantsAreCapped(){
  const {context}=makeContext([]);
  const many=[];
  for(let i=0;i<9;i++)many.push({ts:i,messages:[assistant('第'+i+'版',i)]});
  const trimmed=context.chatTrimReplyVariants(many);
  assert.strictEqual(trimmed.length,6,'版本要有上限，不然会把本地存储撑爆');
  assert.strictEqual(trimmed[5].messages[0].text,'第8版','留下的必须是最新的几版');
}

// ── 重新生成本身：旧答案摘出 chatMessages（不能当历史发给模型），但要带在 pending 上 ──
function testRegenerateCarriesInsteadOfDeleting(){
  const regen=extractFunction('chatRegenerateFromUser');
  assert.ok(/chatCollectReplyVariants\(chatAssistantGroupRange\(i\+1\)\)/.test(regen),
    '重新生成前必须把这一轮已有的回复整组收成版本');
  assert.ok(/replyVariantsCarry=chatTrimReplyVariants/.test(regen),'旧版本要挂在 pending 用户消息上带走');
  assert.ok(/chatMessages=chatMessages\.slice\(0,i\+1\)/.test(regen),
    '旧答案仍然要从 chatMessages 摘掉：这一轮要重发，不能把上一版当历史再发一次');
  assert.ok(!/else delete chatMessages\[i\]\.replyVariantsCarry/.test(regen),
    '收不到新的时不许删已存的：上次被停/失败时答案已经摘掉了，再删就彻底丢了');

  const append=extractFunction('chatAppendAssistantReplies');
  assert.ok(/opts\.replyVariants/.test(append),'新回复落地时要接过带来的旧版本');
  assert.ok(/messages\[0\]\.replyVariants=all/.test(append),'版本列表挂在这一组的第一条上');
  assert.ok(/messages\[0\]\.replyVariantIndex=all\.length-1/.test(append),'落地后默认停在最新那一版');
  assert.ok(/if\(all\.length>1\)/.test(append),'只有一版时不许挂，否则会白出一个 1/1 翻页');

  // 交给发送流程的那一段：pending 上的字段要等回复真的落地才清
  assert.ok(/carriedReplyOwners\.forEach\(function\(m\)\{delete m\.replyVariantsCarry\}\)/.test(source),
    '回复落地后才清 pending 上的临时字段');
  const promote=source.slice(source.indexOf('var carriedReplyVariants=[]'),source.indexOf('userMessageIndexes.push(i)'));
  assert.ok(!/delete m\.replyVariantsCarry/.test(promote),
    '提升 pending→user 时不许顺手删掉：这次发送可能被停止，字段还得留着');
}

testGroupRange();
testCollectSeedsTheFirstVariant();
testNavOnlyShowsWithRealVariants();
testSwitchingReplacesTheWholeGroup();
testSwitchingIsIgnoredWhenPointless();
testRenderKeySeesVariantState();
testVariantsAreCapped();
testRegenerateCarriesInsteadOfDeleting();

console.log('reply variant tests: OK');
