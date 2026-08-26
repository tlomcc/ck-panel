// 2026-08-26 用户报的两件事：
//   1. 打开思考链时「有时候没有被包裹」——独白直接铺在正文气泡里。
//   2. 复制第一条消息会把思考链一起复制走。
// 前者的真因是 chatSplitThinkingText 的两个启发式阈值（闭合标签必须在 200 字符内、
// 且不足全文一半）和「开标签没闭合就只删标记」；后者的真因是分条时思考链被当成字符串
// 前缀塞进 parts[0]，复制按钮直接读 m.text。
const assert=require('assert');
const fs=require('fs');
const vm=require('vm');
const path=require('path');

const root=path.resolve(__dirname,'..');
const source=fs.readFileSync(path.join(root,'script.js'),'utf8');
const css=fs.readFileSync(path.join(root,'chat.css'),'utf8');

function extractFunction(name){
  const start=source.indexOf(`function ${name}(`);
  assert(start>=0,`missing function ${name}`);
  const brace=source.indexOf('{',start);
  let depth=0;
  for(let i=brace;i<source.length;i++){
    if(source[i]==='{')depth++;
    if(source[i]==='}'&&--depth===0)return source.slice(start,i+1);
  }
  throw new Error(`unterminated function ${name}`);
}
function extractVar(name){
  const re=new RegExp(`^var ${name}=.*?;$`,'m');
  const hit=source.match(re);
  assert(hit,`missing var ${name}`);
  return hit[0];
}

const ctx={console};
vm.createContext(ctx);
['CHAT_THINKING_TAG_NAME','CHAT_THINKING_OPEN_SRC','CHAT_THINKING_CLOSE_SRC',
 'CHAT_THINKING_TAG_RE','CHAT_THINKING_OPEN_RE','CHAT_THINKING_CLOSE_RE',
 'CHAT_THINKING_CLOSE_SPLIT_RE','CHAT_THINKING_OPEN_TO_END_RE','CHAT_THINKING_TAG_CLEAN_RE']
  .forEach(name=>vm.runInContext(extractVar(name),ctx));
['chatLooksLikePartialThinkingTag','chatSplitThinkingText','chatMessageCopyText','chatMessageThinkingText',
 'chatSplitOutsideCodeBlocks','chatHasUnclosedCodeBlock','chatNaturalUnits','chatJoinNaturalUnits',
 'chatSplitAssistantReplies']
  .forEach(name=>vm.runInContext(extractFunction(name),ctx));

const cut=(text,opts)=>ctx.chatSplitThinkingText(text,opts);

// ---------------------------------------------------------------------------
// 正常成对标签：老行为不能变
// ---------------------------------------------------------------------------
function testPairedStillWorks(){
  const r=cut('<ck_thinking>先想一下</ck_thinking>你好呀');
  assert.strictEqual(r.thinking,'先想一下');
  assert.strictEqual(r.text,'你好呀');
  assert.strictEqual(r.unclosed,false);

  const two=cut('<think>甲</think>正文一<think>乙</think>正文二');
  assert.strictEqual(two.thinking,'甲\n\n乙','多段思考链按顺序拼起来');
  assert.strictEqual(two.text,'正文一\n正文二');
}

// ---------------------------------------------------------------------------
// 问题1 主因：只剩闭合标签时，长思考链也必须被包裹
// ---------------------------------------------------------------------------
function testBareCloseTagAlwaysWrapped(){
  const long='我先捋一下用户到底在问什么，'.repeat(30);  // 远超旧的 200 字符阈值
  const r=cut(long+'</ck_thinking>\n结论是这样的。');
  assert.strictEqual(r.text,'结论是这样的。','闭合标签之前整段都归思考链，不许漏进正文');
  assert.strictEqual(r.thinking,long.trim());
  assert(r.thinking.length>200,'这条用例的意义就是超过旧阈值');

  // 思考链比正文长（旧的 closeAt*2<=length 会判失败）
  const heavy=cut('啊'.repeat(300)+'</think>好。');
  assert.strictEqual(heavy.text,'好。','思考链占大头时同样要折叠');
  assert.strictEqual(heavy.thinking,'啊'.repeat(300));

  // 整段都是思考链、没有正文
  const only=cut('只顾着想没给答案</ck_thinking>');
  assert.strictEqual(only.text,'');
  assert.strictEqual(only.thinking,'只顾着想没给答案');
}

// ---------------------------------------------------------------------------
// 问题1 次因：开标签没闭合（被截断/模型忘了收尾）
// ---------------------------------------------------------------------------
function testUnclosedOpenTagIsCaptured(){
  const r=cut('<ck_thinking>想到一半就被截断了');
  assert.strictEqual(r.text,'','开标签之后的内容不许原样铺在气泡里');
  assert.strictEqual(r.thinking,'想到一半就被截断了');
  assert.strictEqual(r.unclosed,true,'要标出来，渲染时好默认展开');

  const withHead=cut('先说一句\n<think>然后开始想，但没收尾');
  assert.strictEqual(withHead.text,'先说一句','开标签之前的正文要保留');
  assert.strictEqual(withHead.thinking,'然后开始想，但没收尾');

  // 总结那条路径要求「不闭合就整段丢掉、也不收集」
  const digest=cut('<ck_thinking>半截思考',{suppressThinking:true,hideUnclosedThinking:true});
  assert.strictEqual(digest.text,'');
  assert.strictEqual(digest.thinking,'');
  const digest2=cut('<ck_thinking>思考</ck_thinking>正文',{suppressThinking:true,hideUnclosedThinking:true});
  assert.strictEqual(digest2.text,'正文','成对标签在总结路径下只保留正文');
  assert.strictEqual(digest2.thinking,'');
}

// ---------------------------------------------------------------------------
// 标签写法要跟网关 _ck_strip_pseudo_thinking_text 一样宽容
// ---------------------------------------------------------------------------
function testTagVariants(){
  assert.strictEqual(cut('< ck_thinking >想</ ck_thinking >正文').text,'正文','标签里带空格也要认');
  assert.strictEqual(cut('< ck_thinking >想</ ck_thinking >正文').thinking,'想');
  assert.strictEqual(cut('<reasoning>想</reasoning>正文').thinking,'想','reasoning 也是常见写法');
  assert.strictEqual(cut('<thought>想</thought>正文').thinking,'想');
  assert.strictEqual(cut('<ck_thinking type="x">想</ck_thinking>正文').thinking,'想','带属性的开标签');
  assert.strictEqual(cut('普通回复，没有任何标签').text,'普通回复，没有任何标签');
  assert.strictEqual(cut('普通回复，没有任何标签').thinking,'');
}

// ---------------------------------------------------------------------------
// 问题1 第二件事：复制第一条只能拿到第一条
// ---------------------------------------------------------------------------
function testCopyIsIndependent(){
  // 分条时思考链就是这样挂在第一条上的（chatSplitAssistantReplies）
  const parts=[...ctx.chatSplitAssistantReplies('<ck_thinking>先想一下</ck_thinking>第一句\n第二句',true)];
  assert(parts[0].indexOf('<ck_thinking>')===0,'先确认第一条真的带着思考链前缀');

  const first={role:'assistant',text:parts[0]};
  assert.strictEqual(ctx.chatMessageCopyText(first),'第一句','复制第一条只给第一条的正文');
  assert.strictEqual(ctx.chatMessageThinkingText(first),'先想一下','思考链自己那颗按钮才复制思考链');

  const second={role:'assistant',text:parts[1]};
  assert.strictEqual(ctx.chatMessageCopyText(second),'第二句');
  assert.strictEqual(ctx.chatMessageThinkingText(second),'');

  const plain={role:'assistant',text:'没有思考链的回复'};
  assert.strictEqual(ctx.chatMessageCopyText(plain),'没有思考链的回复','没有思考链就原样复制');

  const user={role:'user',text:'我说的话'};
  assert.strictEqual(ctx.chatMessageCopyText(user),'我说的话');

  assert.strictEqual(ctx.chatMessageCopyText(null),'');
  assert.strictEqual(ctx.chatMessageThinkingText(null),'');
}

// ---------------------------------------------------------------------------
// 接线：复制按钮走的是剥过思考链的取值，思考链块自己带复制按钮
// ---------------------------------------------------------------------------
function testWiring(){
  assert(source.includes("if(a==='copy'&&chatMessages[i])chatCopyText(chatMessageCopyText(chatMessages[i]));"),
    '消息复制必须走 chatMessageCopyText，不能再直接读 m.text');
  const parts=extractFunction('chatRenderAssistantParts');
  assert(/class="chat-thinking/.test(parts),'思考链块要独立渲染');
  assert(parts.includes('chat-thinking-copy'),'思考链块要有自己的复制按钮');
  assert(parts.includes('思考（未闭合）'),'未闭合时要在标题上说明');
  assert(parts.includes("'chat-thinking open'"),'未闭合又没正文时默认展开，别让用户以为回复丢了');
  assert(!parts.includes('chat-bubble'),'assistant parts 不许再造一层气泡');
  assert(source.includes(".closest('.chat-thinking-copy')"),'思考链复制按钮要接上点击');
  assert(/\.chat-thinking-copy\{/.test(css),'思考链复制按钮要有样式');
  assert(/\.chat-thinking-actions\{/.test(css),'思考链操作行要有样式');
}

testPairedStillWorks();
testBareCloseTagAlwaysWrapped();
testUnclosedOpenTagIsCaptured();
testTagVariants();
testCopyIsIndependent();
testWiring();

console.log('thinking wrap and copy tests: OK');
