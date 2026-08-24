'use strict';
// 当日截断总结：有效期、跨零点归属、合并、注入包与面板接线。
//
// 关键不变量（改动前先看这里）：
// 1. 条目归属的自然日按"被总结内容最后一条消息"的日期算，不是按写入时间算。
// 2. 写入新条目时按新条目的 dayKey 作废其它日期的全部条目 —— 这就是"跨零点那次截断
//    保留下来并开始新的一天"的实现方式。
// 3. 注入包超限时只丢最旧的整条，不做半条截断。
// 4. 助手正文里的伪思考链不进总结输入。
// 5. 单条上限对齐网关的防写飞边界（8000）。网关按被截断内容的体量自适应决定写多少字、
//    且不做硬切；面板这里要是还按 1400 切，等于把一整天重新压回 1400 字。
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
    CHAT_DAILY_DIGEST_ENTRY_MAX_CHARS:8000,
    CHAT_DAILY_DIGEST_MAX_PACK_CHARS:24000,
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

  const long=ctx.chatDailyDigestNormalize([{text:'甲'.repeat(50000),endTs:at(2026,8,22,1,0)}]);
  assert.strictEqual(long[0].text.length,8000,'单条正文按上限截断');

  // 真实常量必须跟网关的防写飞边界对齐，别再退回 1400。
  assert.ok(/var CHAT_DAILY_DIGEST_ENTRY_MAX_CHARS=8000;/.test(source),
    '单条上限要对齐网关 CHAT_DIGEST_GUARD_CHARS=8000，否则网关不切面板照样切');
  assert.ok(/var CHAT_DAILY_DIGEST_MAX_PACK_CHARS=24000;/.test(source),'注入包上限要跟着放宽');
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
  // 面板位置：紧跟在「本轮召回内容」下面，和它一样是裸 label + textarea。
  // 2026-08-24 起这一个不再 readonly：用户要能二次总结（见 testEditWiring）。
  const recall=html.indexOf('id="chat-memory-pack"');
  const digest=html.indexOf('id="chat-daily-digest-pack"');
  const actions=html.indexOf('onclick="chatClearLocalMessages()"');
  assert.ok(recall>=0&&digest>recall&&digest<actions,'当日截断总结必须排在本轮召回内容下面');
  assert.ok(/<label>当日截断总结<textarea id="chat-daily-digest-pack"[^>]*oninput="chatDailyDigestMarkEdited\(\)"/.test(html),
    '结构必须和本轮召回内容对齐：裸 label + textarea，并且要接上编辑标记');
  assert.ok(!/<textarea id="chat-daily-digest-pack"[^>]*readonly/.test(html),
    '总结正文要可编辑，readonly 必须撤掉');
  assert.ok(/<textarea id="chat-memory-pack"[^>]*readonly/.test(html),
    '本轮召回内容仍然是只读的，别顺手一起改掉');

  // 注入位置不可选：位置固定在系统缓存断点之前，选择器必须已经撤掉。
  assert.ok(html.indexOf('id="chat-daily-digest-injection-position"')<0,
    '注入位置选择器必须撤掉，位置固定不可选');
  assert.ok(/注入位置固定在系统缓存断点之前/.test(html),'卡片上要写清位置固定在哪里');
  assert.ok(/不做固定字数硬切/.test(html),'卡片要说明总结长度是按体量自适应的，不是固定字数');

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
  // 合并时网关要按"旧总结有多长、覆盖了多少轮"算字数预算，rounds 必须一起送。
  assert.ok(/rounds:Number\(row\.rounds\|\|0\)\|\|0/.test(request),
    'previous 里要带 rounds，否则几十轮的旧总结会被当成一条短总结重写，越合并越薄');

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

// ── 记忆块里的总结可编辑（2026-08-24 用户要求）───────────────────────────────
// 两条不变量：
// 1. 编辑期间自动渲染不许覆盖草稿，但新总结真的落地时要强制刷成存档。
// 2. 回写只认两种写法：保留【时段】按条替换，或整段不带【】合并成一条。
//    时段对不上就报错并原样保留，绝不猜。
function testEditWiring(){
  assert.ok(/onclick="chatSaveDailyDigestText\(\)">保存总结正文</.test(html),'要有保存正文的按钮');
  assert.ok(/onclick="chatResetDailyDigestText\(\)">放弃修改</.test(html),'要有放弃修改的出口');

  const render=extractFunction('chatRenderDailyDigest');
  assert.ok(/keepDraft=chatDailyDigestEditDirty&&opts\.force!==true/.test(render),
    '编辑期间不能覆盖草稿，除非调用方明确 force');
  assert.ok(/if\(!keepDraft\)chatSetFieldValue\('chat-daily-digest-pack'/.test(render),
    '只有非草稿状态才回写 textarea');
  assert.ok(/chatDailyDigestEditSessionId!==sessionId\)chatDailyDigestEditDirty=false/.test(render),
    '换会话时草稿要作废，不能把上一个会话的文字留在框里');
  assert.ok(/chatDailyDigestLastError/.test(render),'空框要说得出是不是生成失败导致的');

  const request=extractFunction('chatDailyDigestRequest');
  assert.ok(/chatRenderDailyDigest\(cfg,\{force:true\}\)/.test(request),
    '新总结落地以存档为准，必须强制刷掉草稿');
  assert.ok(/chatDailyDigestLastError=errorText/.test(request),'失败原因要留下来给记忆块显示');

  // 问题 1：刷新后那块是空的 —— 两个补渲染点。
  assert.ok(/if\(tab==='memory'\)\{[\s\S]*?chatRenderDailyDigest\(memoryCfg\)/.test(source),
    '切到「记忆与缓存」要现算一遍，不能只看上一次渲染的快照');
  const idb=extractFunction('chatStartIndexedDbSessionLoad');
  assert.ok(/chatRenderDailyDigest\(cfg\)/.test(idb),
    'IndexedDB 权威全量回填后必须重画总结，否则刷新页面那块一直是空的');
}

function editContext(){
  const context=Object.assign({console},{});
  return load(context,[
    'chatDailyDigestPad2','chatDailyDigestDayKey','chatDailyDigestClock','chatDailyDigestRangeLabel',
    'var:CHAT_DAILY_DIGEST_HEADER_RE',
    'chatDailyDigestEditedCopy','chatDailyDigestMergeEdit','chatDailyDigestParseEdit',
  ]);
}

function testEditParsing(){
  const ctx=editContext();
  const a={id:'a',startTs:at(2026,8,24,9,0),endTs:at(2026,8,24,9,30),dayKey:'2026-08-24',text:'甲原文',rounds:4};
  const b={id:'b',startTs:at(2026,8,24,11,0),endTs:at(2026,8,24,12,0),dayKey:'2026-08-24',text:'乙原文',rounds:6};

  // 1. 保留表头逐条替换：只有改过的那条打 edited 标记。
  // （断言一律用 join 比字符串：条目数组是在 vm realm 里造的，deepStrictEqual 过不了跨 realm 检查。）
  let parsed=ctx.chatDailyDigestParseEdit('【09:00–09:30】\n甲改写\n\n【11:00–12:00】\n乙原文',[a,b]);
  assert.strictEqual(parsed.mode,'blocks');
  assert.strictEqual(parsed.entries.map(r=>r.text).join('|'),'甲改写|乙原文');
  assert.strictEqual(parsed.entries[0].edited,true,'改过的要标记');
  assert.strictEqual(parsed.entries[1].edited,undefined,'没改的不要凭空打标记');
  assert.strictEqual(parsed.entries[0].id,'a','按条替换必须保住条目身份');
  assert.strictEqual(parsed.entries[0].rounds,4,'轮数等元数据不能被编辑抹掉');

  // 2. 正文清空 = 删掉这一条；整块删掉也一样。
  parsed=ctx.chatDailyDigestParseEdit('【09:00–09:30】\n\n【11:00–12:00】\n乙原文',[a,b]);
  assert.strictEqual(parsed.entries.map(r=>r.id).join('|'),'b','正文清空就是删这一条');
  parsed=ctx.chatDailyDigestParseEdit('【11:00–12:00】\n乙原文',[a,b]);
  assert.strictEqual(parsed.entries.map(r=>r.id).join('|'),'b','整块删掉的条目不再保留');

  // 3. 整段不带【】：合并成一条，时间范围取并集、轮数累加。
  parsed=ctx.chatDailyDigestParseEdit('我自己重写一遍：今天就干了两件事。',[a,b]);
  assert.strictEqual(parsed.mode,'merge');
  assert.strictEqual(parsed.entries.length,1);
  assert.strictEqual(parsed.entries[0].startTs,a.startTs,'起点取最早');
  assert.strictEqual(parsed.entries[0].endTs,b.endTs,'终点取最晚');
  assert.strictEqual(parsed.entries[0].rounds,10,'轮数累加，否则合并后网关会把它当短总结重写');
  assert.strictEqual(parsed.entries[0].mergedCount,1);
  assert.strictEqual(parsed.entries[0].edited,true);
  assert.strictEqual(parsed.entries[0].dayKey,'2026-08-24','归属日跟着最后一条，不能漂到别的自然日');

  // 4. 清空 = 今天不注入。
  assert.strictEqual(ctx.chatDailyDigestParseEdit('   \n\n  ',[a,b]).entries.length,0);

  // 5. 今天本来没有条目也能手写一条。
  parsed=ctx.chatDailyDigestParseEdit('手写的今日总结',[]);
  assert.strictEqual(parsed.entries.length,1);
  assert.strictEqual(parsed.entries[0].text,'手写的今日总结');
  assert.strictEqual(parsed.entries[0].trigger,'manual_edit');

  // 6. 表头对不上就报错，不猜、不丢数据。
  assert.ok(ctx.chatDailyDigestParseEdit('【08:00–08:30】\n乱写',[a,b]).error,'时段对不上必须报错');
  assert.ok(!ctx.chatDailyDigestParseEdit('【08:00–08:30】\n乱写',[a,b]).entries,'报错时不返回任何条目');
  assert.ok(ctx.chatDailyDigestParseEdit('先写一句\n【09:00–09:30】\n甲',[a,b]).error,
    '第一个表头上面还有内容时无法判断归属，要报错');
}

testDayKeyAndClock();
testRangeLabelMarksTheMidnightCrossing();
testNormalizeSortsCapsAndDerivesDayKey();
testExpiryDiscardsOtherDaysOnly();
testPackFormatAndBudget();
testRequestMessagesStripPseudoThinking();
testPanelWiring();
testWaitWiring();
testEditWiring();
testEditParsing();
testWaitBehaviour().then(()=>{
  console.log('daily digest tests: OK');
},error=>{
  console.error(error);
  process.exit(1);
});
