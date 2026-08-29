// 等待期间右上角那行必须动起来。网关本来就在发 meta/memory/delta 事件，
// 以前面板只把它们记进调试日志，界面从「正在请求网关」到「正在渲染回复」之间
// 十几二十秒一个字都不变，用户的原话是「完全无变化的干等就很难受」。
// 位置在标题栏右上角；中间那句「对方正在输入...」必须保持原样、一个字不加。
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'script.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const wechat = fs.readFileSync(path.join(root, 'wechat.css'), 'utf8');

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
const progressEl = { textContent: '', attrs: { hidden: '' } };
progressEl.setAttribute = function (k, v) { progressEl.attrs[k] = v; };
progressEl.removeAttribute = function (k) { delete progressEl.attrs[k]; };
const timers = { live: 0 };
const ctx = {
  console, Number, String, Object, Math,
  Date: { now: () => fakeNow },
  document: {
    getElementById: (id) => (id === 'chat-status' ? statusEl
      : id === 'chat-head-progress' ? progressEl : null),
  },
  setInterval: () => { timers.live++; return 42; },
  clearInterval: () => { timers.live--; },
};
vm.createContext(ctx);
vm.runInContext('var chatStreamProgress=null;var chatStreamProgressTimer=0;', ctx);
[
  'chatStreamProgressStart', 'chatStreamProgressSet', 'chatStreamProgressStop',
  'chatStreamProgressText', 'chatStreamProgressRender', 'chatSetStatus',
].forEach(function (name) {
  vm.runInContext(extractFunction(name), ctx);
});

function shown() {
  return Object.prototype.hasOwnProperty.call(progressEl.attrs, 'hidden')
    ? '' : progressEl.textContent;
}

function testMarkupAndStyleExist() {
  assert(/id="chat-head-progress"/.test(html), 'index.html 必须有右上角那个进度元素');
  const headActions = /<div class="chat-head-actions">([\s\S]*?)<\/div>/.exec(html);
  assert(headActions && headActions[1].includes('chat-head-progress'),
    '进度元素要挂在右上角的 chat-head-actions 里');
  assert(/id="chat-head-progress"[^>]*hidden/.test(html), '默认必须是 hidden，空着不占位');
  assert(/#chat-head-progress\{[\s\S]*?position:absolute/.test(wechat),
    '必须绝对定位：chat-head-actions 在聊天页是两列网格，第三个子元素会被挤到第二行');
  assert(/#chat-head-progress\[hidden\]\{[^}]*display:none/.test(wechat),
    'hidden 时必须真的不显示');
}

function testStatusLineIsUntouched() {
  vm.runInContext('chatSetStatus("")', ctx);
  assert(statusEl.innerHTML.includes('在线'), '不在等待时还是「在线」');
  vm.runInContext('chatSetStatus("正在请求网关...")', ctx);
  assert.strictEqual(statusEl.innerHTML, '对方正在输入...',
    '中间这句必须一个字不加：进度只许出现在右上角');
}

function testStagesAndElapsedSecondsShowUp() {
  assert.strictEqual(shown(), '', '还没开始跟踪时右上角是空的');
  vm.runInContext('chatStreamProgressStart()', ctx);
  assert.strictEqual(shown(), '连接中 0s');

  fakeNow += 3000;
  vm.runInContext('chatStreamProgressRender()', ctx);
  assert.strictEqual(shown(), '连接中 3s', '秒数要跟着走，长等待才看得出还在跑');

  vm.runInContext('chatStreamProgressSet("翻记忆")', ctx);
  assert.strictEqual(shown(), '翻记忆 3s');

  fakeNow += 5000;
  vm.runInContext('chatStreamProgressSet("记忆 143 字 · 思考")', ctx);
  assert.strictEqual(shown(), '记忆 143 字 · 思考 8s');

  fakeNow += 4000;
  vm.runInContext('chatStreamProgressSet("正在写")', ctx);
  assert.strictEqual(shown(), '正在写 12s');

  // 阶段没变就不该白重画
  vm.runInContext('chatStreamProgressSet("正在写")', ctx);
  assert.strictEqual(shown(), '正在写 12s');
}

function testStopClearsTimerAndHides() {
  assert.strictEqual(timers.live, 1, '跟踪期间应当正好有一个定时器');
  vm.runInContext('chatStreamProgressStop()', ctx);
  assert.strictEqual(timers.live, 0, '停下来必须把定时器清掉，不能泄漏');
  assert.strictEqual(shown(), '', '停下来之后右上角要收起来');
  vm.runInContext('chatSetStatus("正在渲染回复...")', ctx);
  assert(statusEl.innerHTML.includes('在线'), '「正在渲染回复」不算等待，回到「在线」');
}

function testStageTextIsNotHtml() {
  vm.runInContext('chatStreamProgressStart()', ctx);
  vm.runInContext('chatStreamProgressSet("<img src=x onerror=alert(1)>")', ctx);
  // 用 textContent 写入，标签只会被当成字面文字，不会变成节点。工具名是外部数据。
  assert.strictEqual(progressEl.textContent, '<img src=x onerror=alert(1)> 0s');
  vm.runInContext('chatStreamProgressStop()', ctx);
  assert.strictEqual(timers.live, 0);
}

testMarkupAndStyleExist();
testStatusLineIsUntouched();
testStagesAndElapsedSecondsShowUp();
testStopClearsTimerAndHides();
testStageTextIsNotHtml();
console.log('stream progress status: OK');
