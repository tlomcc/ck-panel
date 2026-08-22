'use strict';
// 当日截断总结：有效期、跨零点归属、合并、注入包与面板接线。
//
// 关键不变量（改动前先看这里）：
// 1. 条目归属的自然日按"被总结内容最后一条消息"的日期算，不是按写入时间算。
// 2. 写入新条目时按新条目的 dayKey 作废其它日期的全部条目 —— 这就是"跨零点那次截断
//    保留下来并开始新的一天"的实现方式。
// 3. 注入包超限时只丢最旧的整条，不做半条截断。
// 4. 助手正文里的伪思考链不进总结输入。
const assert=require('assert');
const fs=require('fs');
const vm=require('vm');

const source=fs.readFileSync(require.resolve('../script.js'),'utf8');
const html=fs.readFileSync(require.resolve('../index.html'),'utf8');
const css=fs.readFileSync(require.resolve('../chat.css'),'utf8');

function extractFunction(name){
  let start=source.indexOf(`function ${name}(`);
  assert(start>=0,`missing function ${name}`);
  // async 函数要把 async 前缀一起带走，否则 vm 里跑不了里面的 await。
  if(source.slice(Math.max(0,start-6),start)==='async ')start-=6;
  const brace=source.indexOf('{',start);
  let depth=0;
  for(let index=brace;index<source.length;index++){
    if(source[index]==='{')depth++;
    if(source[index]==='}'&&--depth===0)return source.slice(start,index+1);
  }
  throw new Error(`unterminated function ${name}`);
}
function extractVar(name){
  const start=source.indexOf(`\nvar ${name}=`);
  assert(start>=0,`missing var ${name}`);
  const end=source.indexOf('\n',start+1);
  return source.slice(start+1,end);
}
function load(context,names){
  vm.createContext(context);
  names.forEach(name=>vm.runInContext(
    name.startsWith('var:')?extractVar(name.slice(4)):extractFunction(name),
    context,
  ));
  return context;
}

const DIGEST_CORE=[
  'chatDailyDigestPad2','chatDailyDigestDayKey','chatDailyDigestClock','chatDailyDigestRangeLabel',
  'chatDailyDigestNormalize','chatDailyDigestKeepDay','chatDailyDigestEntries','chatDailyDigestPrune',
  'chatDailyDigestBlockText','chatDailyDigestPack',
];

// 用本地时间构造，避免测试结果随机器时区漂移。
function at(y,m,d,h,min){return new Date(y,m-1,d,h,min,0,0).getTime()}

function coreContext(overrides){
  const context=Object.assign({
    console,
    CHAT_DAILY_DIGEST_MAX_ENTRIES:12,
    CHAT_DAILY_DIGEST_ENTRY_MAX_CHARS:1400,
    CHAT_DAILY_DIGEST_MAX_PACK_CHARS:16000,
    chatLoadConfig:()=>({dailyDigestEnabled:true}),
    chatCurrentSession:()=>({dailyDigests:[]}),
  },overrides||{});
  return load(context,DIGEST_CORE);
}

function testDayKeyAndClock(){
  const ctx=coreContext();
  assert.strictEqual(ctx.chatDailyDigestDayKey(at(2026,8,22,9,5)),'2026-08-22');
  assert.strictEqual(ctx.chatDailyDigestDayKey(0),'','没有时间戳就没有归属日');
  assert.strictEqual(ctx.chatDailyDigestClock(at(2026,8,22,9,5)),'09:05');
  assert.strictEqual(ctx.chatDailyDigestClock(0),'??:??');
}

function testRangeLabelMarksTheMidnightCrossing(){
  const ctx=coreContext();
  assert.strictEqual(
    ctx.chatDailyDigestRangeLabel({startTs:at(2026,8,22,14,3),endTs:at(2026,8,22,15,47)}),
    '14:03–15:47',
    '同一天只写时刻',
  );
  assert.strictEqual(
    ctx.chatDailyDigestRangeLabel({startTs:at(2026,8,21,23,50),endTs:at(2026,8,22,0,20)}),
    '08-21 23:50–00:20',
    '跨零点必须把起始那天的日期写出来',
  );
}

function testNormalizeSortsCapsAndDerivesDayKey(){
  const ctx=coreContext();
  const rows=ctx.chatDailyDigestNormalize([
    {text:'晚',endTs:at(2026,8,22,20,0)},
    {text:'  ',endTs:at(2026,8,22,21,0)},
    {text:'早',end_ts:at(2026,8,22,8,0),start_ts:at(2026,8,22,7,0)},
    {text:'没有时间'},
  ]);
  assert.strictEqual(rows.map(r=>r.text).join('|'),'早|晚','按结束时间升序，空正文和无时间的丢掉');
  assert.strictEqual(rows[0].dayKey,'2026-08-22','dayKey 缺失时由 endTs 推出');
  assert.strictEqual(rows[0].startTs,at(2026,8,22,7,0));
  assert.strictEqual(rows[1].startTs,rows[1].endTs,'没给起始时间就退回结束时间');

  const many=[];
  for(let i=0;i<20;i++)many.push({text:'第'+i,endTs:at(2026,8,22,1,0)+i*60000});
  const capped=ctx.chatDailyDigestNormalize(many);
  assert.strictEqual(capped.length,12,'按条数上限保留最新的');
  assert.strictEqual(capped[capped.length-1].text,'第19');

  const long=ctx.chatDailyDigestNormalize([{text:'甲'.repeat(5000),endTs:at(2026,8,22,1,0)}]);
  assert.strictEqual(long[0].text.length,1400,'单条正文按上限截断');
}

// 这一组是需求里最容易写错的地方。
function testExpiryDiscardsOtherDaysOnly(){
  const ctx=coreContext();
  const yesterdayEarly={text:'前天 23:12 那一段',endTs:at(2026,8,21,23,49)};
  const crossMidnight={text:'23:50 到 00:20 那一段',startTs:at(2026,8,21,23,50),endTs:at(2026,8,22,0,20)};

  // 跨零点这条的归属日是 08-22，写入它时前一天的条目全部作废。
  assert.strictEqual(ctx.chatDailyDigestDayKey(crossMidnight.endTs),'2026-08-22');
  const session={dailyDigests:[yesterdayEarly,crossMidnight]};
  const pruned=ctx.chatDailyDigestPrune(session,'2026-08-22');
  assert.strictEqual(pruned.changed,true);
  assert.strictEqual(pruned.entries.map(r=>r.text).join('|'),'23:50 到 00:20 那一段',
    '跨零点那条保留，之前的全部丢弃');
  assert.strictEqual(session.dailyDigests.length,1,'作废必须就地生效');

  // 反过来：还在 08-21 当天时，那一天的条目仍然有效。
  const stillYesterday={dailyDigests:[yesterdayEarly]};
  assert.strictEqual(ctx.chatDailyDigestPrune(stillYesterday,'2026-08-21').entries.length,1);
  assert.strictEqual(ctx.chatDailyDigestPrune({dailyDigests:[yesterdayEarly]},'2026-08-22').entries.length,0,
    '换了一天，旧条目一条不留');
}

function testPackFormatAndBudget(){
  const entries=[
    {text:'第一段',startTs:at(2026,8,22,9,0),endTs:at(2026,8,22,9,30)},
    {text:'第二段',startTs:at(2026,8,22,10,0),endTs:at(2026,8,22,10,30)},
  ];
  const ctx=coreContext({
    chatCurrentSession:()=>({dailyDigests:entries}),
    chatDailyDigestEntries:null,
  });
  // chatDailyDigestEntries 依赖"今天"，测试直接给定 dayKey 走 keepDay。
  const todays=ctx.chatDailyDigestKeepDay(entries,'2026-08-22');
  assert.strictEqual(todays.length,2);
  assert.strictEqual(ctx.chatDailyDigestBlockText(todays[0]),'【09:00–09:30】\n第一段');

  const ctx2=coreContext({
    chatCurrentSession:()=>({dailyDigests:entries}),
  });
  ctx2.chatDailyDigestEntries=()=>ctx2.chatDailyDigestKeepDay(entries,'2026-08-22');
  const pack=ctx2.chatDailyDigestPack({dailyDigestEnabled:true});
  assert.ok(pack.indexOf('【09:00–09:30】')<pack.indexOf('【10:00–10:30】'),'注入包保持时间顺序');

  assert.strictEqual(ctx2.chatDailyDigestPack({dailyDigestEnabled:false}),'','关闭后不注入');

  ctx2.CHAT_DAILY_DIGEST_MAX_PACK_CHARS=20;
  const tight=ctx2.chatDailyDigestPack({dailyDigestEnabled:true});
  assert.ok(tight.indexOf('第一段')<0,'超预算先丢最旧的整条');
  assert.ok(tight.indexOf('第二段')>=0);
  assert.ok(tight.indexOf('【10:00–10:30】')===0,'剩下的仍然是完整条目，不是半条');
}

function testRequestMessagesStripPseudoThinking(){
  const context={console};
  load(context,[
    'var:CHAT_THINKING_TAG_NAME','var:CHAT_THINKING_TAG_RE','var:CHAT_THINKING_OPEN_RE',
    'var:CHAT_THINKING_OPEN_TO_END_RE','var:CHAT_THINKING_CLOSE_RE','var:CHAT_THINKING_CLOSE_SPLIT_RE',
    'var:CHAT_THINKING_TAG_CLEAN_RE',
    'chatLooksLikePartialThinkingTag','chatSplitThinkingText','chatDailyDigestRequestMessages',
  ]);
  const rows=context.chatDailyDigestRequestMessages([
    {role:'pending_user',text:'你先别急',ts:1},
    {role:'assistant',text:'<ck_thinking>他好像不太耐烦</ck_thinking>好，我慢点说。',ts:2},
    {role:'notice',text:'缓存已过期',ts:3},
    {role:'assistant',text:'被打断了',ts:4,stopped:true},
    {role:'assistant',text:'   ',ts:5},
    {role:'user',text:'这样就行',ts:6},
  ]);
  assert.strictEqual(rows.map(r=>r.role).join('|'),'user|assistant|user',
    'pending_user 归成 user；通知、被中断和空正文都不进总结');
  assert.strictEqual(rows[1].text,'好，我慢点说。','伪思考链不能混进总结输入');
  assert.strictEqual(rows[0].ts,1);
}

function testPanelWiring(){
  // 面板位置：紧跟在「本轮召回内容」下面，并且和它一样是裸 label + readonly textarea。
  const recall=html.indexOf('id="chat-memory-pack"');
  const digest=html.indexOf('id="chat-daily-digest-pack"');
  const actions=html.indexOf('onclick="chatClearLocalMessages()"');
  assert.ok(recall>=0&&digest>recall&&digest<actions,'当日截断总结必须排在本轮召回内容下面');
  assert.ok(/<label>当日截断总结<textarea id="chat-daily-digest-pack"[^>]*readonly/.test(html),
    '结构必须和本轮召回内容对齐：裸 label + readonly textarea');

  // 注入位置不可选：位置固定在系统缓存断点之前，选择器必须已经撤掉。
  assert.ok(html.indexOf('id="chat-daily-digest-injection-position"')<0,
    '注入位置选择器必须撤掉，位置固定不可选');
  assert.ok(/注入位置固定在系统缓存断点之前/.test(html),'卡片上要写清位置固定在哪里');

  assert.ok(css.includes('#chat-daily-digest-pack{max-height:220px!important}')||
    /#chat-daily-digest-pack,\s*\n?body\.chat-active \.chat-settings #chat-memory-pack\{max-height:220px!important\}/.test(css),
    '总结框必须和召回框同一个高度上限');
  assert.ok(css.includes('.chat-cache-save-status.error'),'失败提示需要独立样式');

  // 配置、持久化、请求体三处都要接上，少一处功能就断。
  assert.ok(source.includes("dailyDigestEnabled:true"),'默认开启');
  assert.ok(!/dailyDigestInjectionPosition/.test(source),
    '注入位置已固定在网关侧，面板不该再存、读或发这个字段');
  assert.strictEqual((source.match(/dailyDigests:chatDailyDigestNormalize\(s\.dailyDigests\)/g)||[]).length,2,
    'chatNormalizeSession 和 chatSessionStorageData 都要带上 dailyDigests，否则刷新就丢');
  assert.ok(source.includes('daily_digest_pack:chatDailyDigestPack(cfg,currentSession)'),'请求体要带注入包');
  assert.ok(source.includes("return base+'/ck/chat-digest/prepare'"),'端点必须指向网关的无状态生成接口');

  // 成功静默、失败出声。
  const request=extractFunction('chatDailyDigestRequest');
  assert.ok(!/toast\(/.test(request.slice(0,request.indexOf('}catch('))),'成功路径不能弹通知');
  assert.ok(/toast\([^)]*当日截断总结失败/.test(request),'失败必须在面板通知');
  assert.ok(request.includes("chatDailyDigestPrune(session,dayKey)"),'写入前按新条目的自然日作废旧条目');
  assert.ok(request.includes("data.merge_with_previous===true"),'要处理网关给的合并决定');

  const schedule=extractFunction('chatDailyDigestScheduleForTrim');
  assert.ok(schedule.includes('chatDailyDigestChain'),'多次截断必须串行，否则合并判断看不到上一条');
  assert.ok(/return task/.test(schedule),'必须把本次总结的 promise 交出去，截断那一轮要等它');
  assert.ok(/chatDailyDigestChain=task/.test(schedule),'串行语义要保留：下一次截断排在这次后面');

  // 换会话/新会话/删会话之后，面板不能还挂着上一个会话的总结。
  assert.ok(extractFunction('chatWriteForm').includes('chatRenderDailyDigest(cfg)'),
    'chatSelectSession 走 chatWriteForm，必须在那里重渲染');
  assert.ok(extractFunction('chatNewSession').includes('chatRenderDailyDigest(cfg)'),
    '新会话必须清空总结显示');
  assert.ok(source.slice(source.indexOf('async function chatDeleteSession'),
    source.indexOf('function chatSelectSession')).includes('chatRenderDailyDigest(cfg)'),
    '删除会话后必须重渲染总结');
  // 异步落地时配置可能已经变了，必须重新读一次而不是用截断当时的快照。
  assert.ok(request.includes('cfg=chatLoadConfig();'),'落地前要重新读配置');
  assert.ok(request.includes('cfg.dailyDigestEnabled===false)return null'),'期间被关掉就不要再写入');
}

// 截断那一轮要先把总结等回来再发请求：否则本轮请求没有总结、下一轮才第一次带上它，
// 系统前缀连着变两次，整段缓存重建两次。等待必须有上限、失败不阻塞、能被停止打断。
function testWaitWiring(){
  const commit=extractFunction('chatCommitAutoTrimPlan');
  assert.ok(/var digestWait=trimCommitted\?chatDailyDigestScheduleForTrim\(cfg,plan\):null/.test(commit),
    '只有真的裁掉历史才生成总结；没截断的普通轮次不能多等一步');
  assert.ok(/digestWait:digestWait/.test(commit),'commit 要把 promise 交给调用方');

  const apply=source.slice(
    source.indexOf('async function chatApplyAutoTrimForPendingBatch'),
    source.indexOf('async function chatManualSyncSpeechPreferences'),
  );
  assert.strictEqual((apply.match(/chatAwaitTrimDigest\(/g)||[]).length,3,
    '三条提交路径（无可审阅内容 / 偏好失败 / 正常）都要等总结');
  assert.ok(apply.indexOf('chatAwaitTrimDigest(')<apply.length,'等待必须发生在 apply 里，也就是请求体组装之前');
  // 停止分支在等待之前就返回，不该多等。
  assert.ok(apply.indexOf('prepareStopped:true')<apply.indexOf('chatAwaitTrimDigest(chatCommitAutoTrimPlan(cfg,plan,prepared)'),
    '用户中止时直接返回，不进入等待');

  const wait=extractFunction('chatAwaitTrimDigest');
  assert.ok(/CHAT_DAILY_DIGEST_TRIM_WAIT_MS/.test(wait),'等待必须有上限');
  assert.ok(/requestState\)poll=setInterval/.test(wait),'等待期间要能被停止打断');
  assert.ok(/if\(timer\)clearTimeout\(timer\);\s*\n\s*if\(poll\)clearInterval\(poll\);/.test(wait),
    '定时器必须在 finally 里清掉');
  assert.ok(/var CHAT_DAILY_DIGEST_TRIM_WAIT_MS=45000;/.test(source),'面板上限 45 秒，短于网关最坏一分钟');
}

function waitContext(overrides){
  const context=Object.assign({
    console,setTimeout,clearTimeout,setInterval,clearInterval,
    CHAT_DAILY_DIGEST_TRIM_WAIT_MS:5000,
    chatDebug:()=>{},
    chatDailyDigestSetStatus:()=>{},
  },overrides||{});
  return load(context,['chatAwaitTrimDigest']);
}

async function testWaitBehaviour(){
  // 1. 总结按时回来：等到它，并且清掉"正在整理"那行字。
  const statuses=[];
  let ctx=waitContext({chatDailyDigestSetStatus:text=>statuses.push(text)});
  let result=await ctx.chatAwaitTrimDigest({digestWait:Promise.resolve({id:'dg-1'}),trigger:'round_limit',dropped:40},null);
  assert.strictEqual(result.digestWaited,'ok');
  assert.ok(/正在整理被截断的对话/.test(statuses[0]),'等待期间要有反馈');
  assert.strictEqual(statuses[statuses.length-1],'','成功后清掉等待提示，成功仍然静默');

  // 2. 没发生截断：一步都不多走，连状态行都不碰。
  let touched=0;
  ctx=waitContext({chatDailyDigestSetStatus:()=>{touched++}});
  result=await ctx.chatAwaitTrimDigest({digestWait:null},null);
  assert.strictEqual(result.digestWaited,undefined);
  assert.strictEqual(touched,0,'没有截断的普通轮次不该有任何等待痕迹');

  // 3. 超时：放弃等待、照常发送，不抛错。
  const timeoutStatuses=[];
  ctx=waitContext({
    CHAT_DAILY_DIGEST_TRIM_WAIT_MS:40,
    chatDailyDigestSetStatus:text=>timeoutStatuses.push(text),
  });
  result=await ctx.chatAwaitTrimDigest({digestWait:new Promise(()=>{})},null);
  assert.strictEqual(result.digestWaited,'timeout');
  assert.ok(/照常发送/.test(timeoutStatuses[timeoutStatuses.length-1]),'超时要说明本轮照常发送');

  // 4. 总结失败：不阻塞发送，也不覆盖失败提示（失败文案由 chatDailyDigestRequest 自己写）。
  const failStatuses=[];
  ctx=waitContext({chatDailyDigestSetStatus:text=>failStatuses.push(text)});
  result=await ctx.chatAwaitTrimDigest({digestWait:Promise.reject(new Error('boom'))},null);
  assert.strictEqual(result.digestWaited,'failed');
  assert.strictEqual(failStatuses.length,1,'失败分支不许再改状态行');

  // 5. 用户点停止：立刻退出等待。
  ctx=waitContext();
  const requestState={stopped:false};
  const pendingForever=ctx.chatAwaitTrimDigest({digestWait:new Promise(()=>{})},requestState);
  requestState.stopped=true;
  result=await pendingForever;
  assert.strictEqual(result.digestWaited,'stopped');
}

testDayKeyAndClock();
testRangeLabelMarksTheMidnightCrossing();
testNormalizeSortsCapsAndDerivesDayKey();
testExpiryDiscardsOtherDaysOnly();
testPackFormatAndBudget();
testRequestMessagesStripPseudoThinking();
testPanelWiring();
testWaitWiring();
testWaitBehaviour().then(()=>{
  console.log('daily digest tests: OK');
},error=>{
  console.error(error);
  process.exit(1);
});
