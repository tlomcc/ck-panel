// 等待期间标题栏那行必须动起来。网关本来就在发 meta/memory/delta 事件，
// 以前面板只把它们记进调试日志，界面从「正在请求网关」到「正在渲染回复」之间
// 十几二十秒一个字都不变，用户的原话是「完全无变化的干等就很难受」。
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'script.js'), 'utf8');

function matchBlock(startIndex, open, close) {
  const from = source.indexOf(open, startIndex);
  assert(from >= 0, 'missing opening ' + open);
  let depth = 0;
  for (let i = from; i < source.length; i++) {
    if (source[i] === open) depth++;
    else if (source[i] === close && --depth === 0) return source.slice(startIndex, i + 1);
  }
  throw new Error('unterminated block');
}
function extractFunction(name) {
  const start = source.indexOf('function ' + name + '(');
  assert(start >= 0, 'missing function ' + name);
  return matchBlock(start, '{', '}');
}

let fakeNow = 1000000;
const statusEl = { innerHTML: '' };
const timers = { live: 0 };
const ctx = {
  console, Number, String, Object, Math,
  Date: { now: () => fakeNow },
  document: { getElementById: (id) => (id === 'chat-status' ? statusEl : null) },
  setInterval: () => { timers.live++; return 42; },
  clearInterval: () => { timers.live--; },
};
vm.createContext(ctx);
vm.runInContext('var chatStreamProgress=null;var chatStreamProgressTimer=0;', ctx);
[
  'chatStreamProgressStart', 'chatStreamProgressSet', 'chatStreamProgressStop',
  'chatStreamProgressText', 'chatStreamProgressRender', 'chatSetStatus', 'chatEsc',
].forEach(function (name) {
  vm.runInContext(extractFunction(name), ctx);
});

function detail() {
  const match = /<span class="chat-status-detail">([\s\S]*?)<\/span>/.exec(statusEl.innerHTML);
  return match ? match[1] : '';
}

function testIdleStatusIsUnchanged() {
  vm.runInContext('chatSetStatus("")', ctx);
  assert(statusEl.innerHTML.includes('在线'), '不在等待时还是「在线」，这行没被改坏');
  assert(!statusEl.innerHTML.includes('chat-status-detail'), '不在等待时不该有进度尾巴');

  vm.runInContext('chatSetStatus("正在请求网关...")', ctx);
  assert(statusEl.innerHTML.includes('对方正在输入...'), '等待时仍然是「对方正在输入...」');
  assert.strictEqual(detail(), '', '还没开始跟踪时不显示任何阶段');
}

function testStagesAndElapsedSecondsShowUp() {
  vm.runInContext('chatStreamProgressStart()', ctx);
  assert(statusEl.innerHTML.includes('对方正在输入...'), '微信那句话必须保留');
  assert.strictEqual(detail(), '连接网关 0s');

  fakeNow += 3000;
  vm.runInContext('chatStreamProgressRender()', ctx);
  assert.strictEqual(detail(), '连接网关 3s', '秒数要跟着走，长等待才看得出还在跑');

  vm.runInContext('chatStreamProgressSet("网关已接收，正在翻记忆")', ctx);
  assert.strictEqual(detail(), '网关已接收，正在翻记忆 3s');

  fakeNow += 5000;
  vm.runInContext('chatStreamProgressSet("已翻到记忆 143 字，小克在想")', ctx);
  assert.strictEqual(detail(), '已翻到记忆 143 字，小克在想 8s');

  fakeNow += 4000;
  vm.runInContext('chatStreamProgressSet("小克正在写")', ctx);
  assert.strictEqual(detail(), '小克正在写 12s');
}

function testStopClearsTimerAndDetail() {
  assert.strictEqual(timers.live, 1, '跟踪期间应当正好有一个定时器');
  vm.runInContext('chatStreamProgressStop()', ctx);
  assert.strictEqual(timers.live, 0, '停下来必须把定时器清掉，不能泄漏');
  vm.runInContext('chatSetStatus("正在请求网关...")', ctx);
  assert.strictEqual(detail(), '', '停下来之后不再显示阶段');
  vm.runInContext('chatSetStatus("正在渲染回复...")', ctx);
  assert(statusEl.innerHTML.includes('在线'), '「正在渲染回复」不算等待，回到「在线」');
}

function testStageTextIsEscaped() {
  vm.runInContext('chatStreamProgressStart()', ctx);
  vm.runInContext('chatStreamProgressSet("<img src=x onerror=alert(1)>")', ctx);
  assert(!statusEl.innerHTML.includes('<img'), '阶段文字必须转义，工具名是外部数据');
  assert(statusEl.innerHTML.includes('&lt;img'), '应当以转义形式出现');
  vm.runInContext('chatStreamProgressStop()', ctx);
  assert.strictEqual(timers.live, 0);
}

testIdleStatusIsUnchanged();
testStagesAndElapsedSecondsShowUp();
testStopClearsTimerAndDetail();
testStageTextIsEscaped();
console.log('stream progress status: OK');
