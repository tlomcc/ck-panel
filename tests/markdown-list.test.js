'use strict';
// Markdown 有序列表的起始序号（2026-08-24 用户报的显示 bug）。
//
// 现象：助手回复里写 1. / 2. / 3.，用户开着「分条」时每一行都会单独成为一条消息、
// 单独走一次 chatRenderMarkdown，于是三条气泡全部显示成 1.。
// 根因不是 CSS，也不是分条逻辑：渲染器的有序列表分支只捕获正文、把作者写的序号扔掉，
// 输出的又是不带 start 的裸 <ol>，浏览器只能从 1 开始编号。
//
// 不变量：<ol> 的编号由源文本里的第一个数字决定；只有它不等于 1 时才写 start=，
// 避免给绝大多数正常列表凭空加属性。
const assert=require('assert');
const fs=require('fs');
const vm=require('vm');

const source=fs.readFileSync(require.resolve('../script.js'),'utf8');

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

const context={console};
vm.createContext(context);
['chatEsc','chatMdInline','chatCodeBlock','chatSplitRow','chatRenderMarkdown']
  .forEach(name=>vm.runInContext(extractFunction(name),context));
const md=context.chatRenderMarkdown;

function testFirstNumberDecidesTheStart(){
  assert.strictEqual(md('1. 第一步'),'<ol><li>第一步</li></ol>',
    '从 1 开始的列表不该被加上多余的 start');
  assert.strictEqual(md('2. 第二步'),'<ol start="2"><li>第二步</li></ol>',
    '单独一条 2. 必须带 start=2，否则分条后显示成 1.');
  assert.strictEqual(md('10. 第十步'),'<ol start="10"><li>第十步</li></ol>','两位数序号也要保留');
}

function testSplitRepliesKeepCountingUp(){
  // 分条模式下的真实形状：一行一条消息，各自渲染一次。
  const bubbles=['1. 先看日志','2. 再看配置','3. 最后重启'].map(md);
  assert.deepStrictEqual(bubbles,[
    '<ol><li>先看日志</li></ol>',
    '<ol start="2"><li>再看配置</li></ol>',
    '<ol start="3"><li>最后重启</li></ol>',
  ],'三条气泡的序号必须是 1/2/3，不能全是 1');
}

function testWholeReplyModeUnchanged(){
  assert.strictEqual(md('1. 甲\n2. 乙\n3. 丙'),
    '<ol><li>甲</li><li>乙</li><li>丙</li></ol>',
    '整段模式仍然合成一个 <ol>，行为不变');
  // 不是从 1 起头的整段列表同样要认起始序号。
  assert.strictEqual(md('4. 丁\n5. 戊'),'<ol start="4"><li>丁</li><li>戊</li></ol>');
}

function testUnorderedListIsUntouched(){
  assert.strictEqual(md('- 甲\n- 乙'),'<ul><li>甲</li><li>乙</li></ul>','无序列表不该出现 start');
  assert.strictEqual(md('* 甲'),'<ul><li>甲</li></ul>');
  assert.ok(md('- 甲').indexOf('start=')<0);
}

function testInlineMarkupSurvives(){
  assert.strictEqual(md('2. **加粗**的一步'),
    '<ol start="2"><li><strong>加粗</strong>的一步</li></ol>',
    '换了捕获组之后正文仍然要走行内渲染');
  // 序号后面带正文里自己的点号，不能被误切。
  assert.strictEqual(md('3. 版本 1.2.3 已发布'),
    '<ol start="3"><li>版本 1.2.3 已发布</li></ol>');
}

function testListStillEndsTheParagraph(){
  const html=md('先说一句\n2. 第二步');
  assert.ok(html.indexOf('<p>先说一句</p>')===0,'列表前面的段落照旧独立成 <p>');
  assert.ok(/<ol start="2">/.test(html),'紧跟其后的列表仍然认起始序号');
}

function testNoCssCounterHack(){
  // 修法必须是 <ol start>，不是 CSS counter：counter 方案没法表达"这一条从第几号开始"。
  const render=extractFunction('chatRenderMarkdown');
  assert.ok(/startAttr/.test(render),'有序列表必须显式算出 start 属性');
  assert.ok(/parseInt\(im\[1\],10\)/.test(render),'起始序号要从源文本第一项的数字取');
}

testFirstNumberDecidesTheStart();
testSplitRepliesKeepCountingUp();
testWholeReplyModeUnchanged();
testUnorderedListIsUntouched();
testInlineMarkupSurvives();
testListStillEndsTheParagraph();
testNoCssCounterHack();
console.log('markdown list tests: OK');
