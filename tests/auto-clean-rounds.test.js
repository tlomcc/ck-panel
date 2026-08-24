'use strict';
// 每 N 轮自动清理召回与图片（2026-08-24 用户要求：轮数自己维护、可开可关）。
//
// 关键不变量（改动前先看这里）：
// 1. 自动清理和自动截断是两件事：截断丢整轮历史，这个只摘掉图片和召回块，轮次留着。
//    所以轮数只做上下限约束，不跟「保留轮数」联动。
// 2. 手动清理和自动清理必须共用 chatCleanHistoryCore：网关侧是同一个幂等接口，
//    两条路各写一份本地剥离逻辑就会出现"手动清干净、自动清一半"。
// 3. 判定基线 autoCleanLastRound 存在会话上，且必须进两个持久化白名单，
//    否则刷新页面基线归零，会在同一个会话里反复清。
// 4. 截断会把轮数拉小，基线比当前轮大时要回退到 0，否则自动清理被永远推迟。
const assert=require('assert');
const fs=require('fs');
const vm=require('vm');

const root=require('path').resolve(__dirname,'..');
const source=fs.readFileSync(require('path').join(root,'script.js'),'utf8');
const html=fs.readFileSync(require('path').join(root,'index.html'),'utf8');

function extractFunction(name){
  let start=source.indexOf(`function ${name}(`);
  assert(start>=0,`missing function ${name}`);
  if(source.slice(Math.max(0,start-6),start)==='async ')start-=6;
  const brace=source.indexOf('{',start);
  let depth=0;
  for(let index=brace;index<source.length;index++){
    if(source[index]==='{')depth++;
    if(source[index]==='}'&&--depth===0)return source.slice(start,index+1);
  }
  throw new Error(`unterminated function ${name}`);
}

function testNormalize(){
  const ctx={console,CHAT_AUTO_CLEAN_DEFAULT_ROUNDS:100,CHAT_AUTO_CLEAN_MIN_ROUNDS:5,CHAT_AUTO_CLEAN_MAX_ROUNDS:5000};
  vm.createContext(ctx);
  ['chatPositiveIntOrDefault','chatNormalizeAutoCleanConfig','chatAutoCleanConfigFrom']
    .forEach(name=>vm.runInContext(extractFunction(name),ctx));

  const d=ctx.chatNormalizeAutoCleanConfig({});
  assert.strictEqual(d.enabled,false,'默认必须是关的：这是会删可见内容的动作，不能默认打开');
  assert.strictEqual(d.rounds,100,'默认 100 轮（用户原话）');

  assert.strictEqual(ctx.chatNormalizeAutoCleanConfig({enabled:true,rounds:1}).rounds,5,'低于下限抬到 5');
  assert.strictEqual(ctx.chatNormalizeAutoCleanConfig({enabled:true,rounds:99999}).rounds,5000,'高于上限压到 5000');
  assert.strictEqual(ctx.chatNormalizeAutoCleanConfig({rounds:'250'}).rounds,250,'字符串数字要认');
  assert.strictEqual(ctx.chatNormalizeAutoCleanConfig({rounds:''}).rounds,100,'空值回落默认');
  assert.strictEqual(ctx.chatNormalizeAutoCleanConfig({rounds:0}).rounds,100,'0 不是"每 0 轮"，回落默认');
  assert.strictEqual(ctx.chatNormalizeAutoCleanConfig({every_rounds:30}).rounds,30,'蛇形别名要认');
  assert.strictEqual(ctx.chatNormalizeAutoCleanConfig({enabled:'true'}).enabled,true);
  assert.strictEqual(ctx.chatNormalizeAutoCleanConfig({enabled:1}).enabled,false,'只认显式 true，别把随便一个真值当开启');

  assert.strictEqual(ctx.chatAutoCleanConfigFrom({autoCleanEnabled:true,autoCleanRounds:60}).rounds,60);
  assert.strictEqual(ctx.chatAutoCleanConfigFrom({}).enabled,false);
}

function testConfigPlumbing(){
  // 少接一处，用户存的设置就会在别的入口保存时被抹回默认值。
  assert.ok(/autoCleanEnabled:false,\s*\n\s*autoCleanRounds:CHAT_AUTO_CLEAN_DEFAULT_ROUNDS/.test(source),
    'chatDefaultConfig 要有默认值');
  const load=extractFunction('chatLoadConfig');
  assert.ok(/chatAutoCleanConfigFrom\(cfg\)/.test(load),'chatLoadConfig 要归一');
  const save=extractFunction('chatSaveConfigObject');
  assert.ok(/chatAutoCleanConfigFrom\(cfg\)/.test(save),'chatSaveConfigObject 也要归一，否则别的入口保存会丢');
  const read=extractFunction('chatReadForm');
  assert.ok(/chat-auto-clean-enabled/.test(read)&&/chat-auto-clean-rounds/.test(read),'表单要读回来');
  assert.ok(/autoCleanEnabled:cleanCfg\.enabled/.test(read)&&/autoCleanRounds:cleanCfg\.rounds/.test(read));
  const write=extractFunction('chatWriteForm');
  assert.ok(/chatSetFieldChecked\('chat-auto-clean-enabled'/.test(write)&&
    /chatSetFieldValue\('chat-auto-clean-rounds'/.test(write),'表单要回填');
  assert.ok(/chatRenderAutoCleanState\(cfg\)/.test(write),'状态行要在写表单时算一次');
}

function testPersistedBaseline(){
  const normalize=extractFunction('chatNormalizeSession');
  const storage=extractFunction('chatSessionStorageData');
  assert.ok(/autoCleanLastRound:Number\(s\.autoCleanLastRound\|\|0\)\|\|0/.test(normalize),
    '基线要在 chatNormalizeSession 里归一');
  assert.ok(/autoCleanLastRound:s\.autoCleanLastRound\|\|0/.test(storage),
    '基线必须进 chatSessionStorageData，不然刷新后归零、会在同一个会话里反复清');
}

function testSharedCore(){
  const core=extractFunction('chatCleanHistoryCore');
  assert.ok(/chatCleanEndpoint\(cfg\)/.test(core),'核心走既有的 /ck/clean-history 幂等接口');
  assert.ok(/chatStripLocalHistoryMediaAndRecall\(stripTarget\)/.test(core),'本地剥离也在核心里');
  assert.ok(!/toast\(/.test(core),'核心不许自己弹通知：手动和自动的提示文案不一样');
  assert.ok(!/chatShowCleanHistoryConfirm/.test(core),'确认框不属于核心，自动清理不能弹确认');

  const manual=extractFunction('chatCleanHistory');
  assert.ok(/chatShowCleanHistoryConfirm\(\)/.test(manual),'手动清理仍然要先确认');
  assert.ok(/chatCleanHistoryCore\(cfg\)/.test(manual),'手动清理必须走同一个核心');
  assert.ok(/chatAutoCleanMarkDone\(result\.sessionId\)/.test(manual),
    '手动清完要把基线对齐到当前轮，否则下一次检查会立刻再自动清一遍');

  const auto=extractFunction('chatMaybeAutoCleanByRounds');
  assert.ok(/chatCleanHistoryCore\(cfg\)/.test(auto),'自动清理必须走同一个核心');
}

function testRunnerGuards(){
  const auto=extractFunction('chatMaybeAutoCleanByRounds');
  assert.ok(/chatAutoCleanBusy\|\|chatSending\|\|chatIdleTrimBusy/.test(auto),
    '发请求中、截断中都不能插一脚清理');
  assert.ok(/currentPanelTab!=='chat'/.test(auto),'不在聊天页不做重活');
  assert.ok(/chatEditingIndex>=0/.test(auto),'用户正在编辑消息时不动历史');
  assert.ok(/opts\.forceCheck!==true&&now-chatAutoCleanLastCheckAt<30000/.test(auto),'要有 30 秒节流');
  assert.ok(/if\(!clean\.enabled\)return/.test(auto),'关着就什么都不做');
  assert.ok(/String\(cfg\.panelKey\|\|''\)\.trim\(\)/.test(auto),'没有面板 Key 时别去打接口');
  assert.ok(/chatPendingMessages\(\)\.length/.test(auto),'有待发送内容时不清');
  assert.ok(/if\(last>count\)last=0/.test(auto),'截断把轮数拉回去以后基线要回退，否则永远清不了');
  assert.ok(/if\(count-last<clean\.rounds\)return/.test(auto),'判定是"距上次清理又过了 N 轮"');
  assert.ok(/chatAutoCleanMarkDone\(result\.sessionId,count\)/.test(auto),'清完要落基线');
  assert.ok(/toast\(/.test(auto),'图片会当场消失，必须出声，不能静默');
  assert.ok(/chatDebug\('auto_clean'/.test(auto),'成功失败都要留调试记录');
  assert.ok(/finally\{\s*\n?\s*chatAutoCleanBusy=false;/.test(auto),'busy 标记必须在 finally 里放开');

  // 只挂既有定时器，不新开一个。
  assert.ok(/chatMaybeAutoTrimAtIdleBoundary\(\);\s*\n\s*\/\/[^\n]*\n\s*chatMaybeAutoCleanByRounds\(\);/.test(source),
    '复用 15 秒定时器，不新开 setInterval');
  assert.ok(/chatMaybeAutoCleanByRounds\(\{forceCheck:true\}\)/.test(source),
    '回复落定要立刻复核一次，不必等 15 秒');
  assert.ok(source.indexOf("chatMaybeAutoTrimAtIdleBoundary({forceCheck:true})")<
    source.indexOf("chatMaybeAutoCleanByRounds({forceCheck:true})"),
    '清理排在截断之后：先让截断决定这一轮剩多少历史');
}

function testStateLineAndHtml(){
  assert.ok(/id="chat-auto-clean-enabled"[^>]*onchange="chatSaveAutoCleanSetting\(true\)"/.test(html),'开关要即时保存');
  assert.ok(/id="chat-auto-clean-rounds"[^>]*min="5"[^>]*max="5000"/.test(html),'轮数输入框的上下限要和归一一致');
  assert.ok(/id="chat-auto-clean-state"/.test(html),'要有一行说明现在到第几轮、还差几轮');
  assert.ok(/onclick="chatSaveAutoCleanSetting\(\)">保存清理设置</.test(html),'要有显式保存按钮');
  // 卡片长在「记忆与缓存」里，和召回、图片同一个语义家。
  const memoryStart=html.indexOf('id="chat-side-memory"');
  const memoryEnd=html.indexOf('id="chat-side-trim"');
  const card=html.indexOf('id="chat-auto-clean-enabled"');
  assert.ok(memoryStart>=0&&card>memoryStart&&card<memoryEnd,'自动清理卡片要放在「记忆与缓存」页里');

  const render=extractFunction('chatRenderAutoCleanState');
  assert.ok(/if\(last>count\)last=0/.test(render),'状态行的算法要和判定一致，不然显示和实际清理时机不符');
  assert.ok(/已关闭/.test(render)&&/已开启/.test(render),'开关两种状态都要写清楚');
  assert.ok(/if\(tab==='memory'\)\{[\s\S]*?chatRenderAutoCleanState\(memoryCfg\)/.test(source),
    '切到「记忆与缓存」要刷新状态行');
}

function testDebugRendering(){
  assert.ok(/if\(ev==='auto_clean'\)\{/.test(source),'调试记录要能认出这个事件');
  assert.ok(/ev==='auto_clean'\)return 'recall'/.test(source),'按轮清理归到「召回」分组');
}

testNormalize();
testConfigPlumbing();
testPersistedBaseline();
testSharedCore();
testRunnerGuards();
testStateLineAndHtml();
testDebugRendering();
console.log('auto clean rounds tests: OK');
