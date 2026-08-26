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

function extractVar(name){
  const re=new RegExp(`^var ${name}=.*?;$`,'m');
  const hit=source.match(re);
  assert(hit,`missing var ${name}`);
  return hit[0];
}

const context={console};
vm.createContext(context);
['CHAT_THINKING_TAG_NAME','CHAT_THINKING_OPEN_SRC','CHAT_THINKING_CLOSE_SRC',
 'CHAT_THINKING_TAG_RE','CHAT_THINKING_OPEN_RE','CHAT_THINKING_CLOSE_RE',
 'CHAT_THINKING_CLOSE_SPLIT_RE','CHAT_THINKING_OPEN_TO_END_RE','CHAT_THINKING_TAG_CLEAN_RE']
  .forEach(name=>vm.runInContext(extractVar(name),context));
['chatSplitThinkingText','chatLooksLikePartialThinkingTag','chatSplitOutsideCodeBlocks',
 'chatHasUnclosedCodeBlock','chatNaturalUnits','chatJoinNaturalUnits',
 'chatSplitAssistantReplies','chatStreamingAssistantPreviewText']
  .forEach(name=>vm.runInContext(extractFunction(name),context));

// vm 里造出来的数组原型和宿主不同，deepStrictEqual 会因为跨 realm 直接判不等，
// 所以统一摊回宿主数组再断言。
const split=(text,enabled)=>[...context.chatSplitAssistantReplies(text,enabled!==false)];

// ---------------------------------------------------------------------------
// 一个回车就是一条：条数只由小克的换行决定
// ---------------------------------------------------------------------------
function testOneNewlineOneBubble(){
  assert.deepStrictEqual(split('第一句\n第二句\n第三句'),['第一句','第二句','第三句'],
    '单个换行就要分条，不再看字数够不够');

  assert.deepStrictEqual(split('第一段\n\n第二段'),['第一段','第二段'],
    '空行和单换行一样，只算一个分隔');

  assert.deepStrictEqual(split('第一段\n\n\n\n第二段'),['第一段','第二段'],
    '连续空行不会多切出空条');

  assert.deepStrictEqual(split('好的'),['好的'],'没有换行就只有一条');
  assert.deepStrictEqual(split('  \n\n  '),[],'纯空白不产生任何气泡');
}

// ---------------------------------------------------------------------------
// 确定性：同一段文本必须永远切成同样的结果（旧版用 Math.random 决定条数）
// ---------------------------------------------------------------------------
function testDeterministic(){
  const long='第'+'一'.repeat(120)+'句。\n第'+'二'.repeat(200)+'句。\n第三句。\n第四句。';
  const first=split(long);
  for(let i=0;i<200;i++){
    assert.deepStrictEqual(split(long),first,'同一段回复每次都要切成完全一样的条数和内容');
  }
  assert.strictEqual(first.length,4,'四行就是四条，和长度无关');

  assert(!/Math\.random/.test(extractFunction('chatSplitAssistantReplies')),'分条逻辑里不许再出现随机数');
  assert(!/Math\.random/.test(extractFunction('chatNaturalUnits')),'切分单元里不许再出现随机数');
}

// ---------------------------------------------------------------------------
// 长度不再影响分条：长短文本用同样的规则
// ---------------------------------------------------------------------------
function testLengthDoesNotMatter(){
  assert.deepStrictEqual(split('嗯\n好'),['嗯','好'],'很短也照样按回车分');

  const oneLongLine='啊'.repeat(1200);
  assert.deepStrictEqual(split(oneLongLine),[oneLongLine],
    '没有回车的长文本保持一条，不再被句号或逗号硬切');

  const manyLines=Array.from({length:20},(_,i)=>'第'+(i+1)+'行').join('\n');
  assert.strictEqual(split(manyLines).length,20,'二十行就是二十条，没有条数上限');
}

// ---------------------------------------------------------------------------
// 内容不能被吞掉或粘连：拼回去必须还原
// ---------------------------------------------------------------------------
function testNoContentLossOrGluing(){
  const text='今天天气不错\n我们出去走走吧\n- 带伞\n- 带水\n最后一句';
  const parts=split(text);
  assert.deepStrictEqual(parts,['今天天气不错','我们出去走走吧','- 带伞','- 带水','最后一句']);
  assert.strictEqual(parts.join('\n'),text,'逐条拼回去要和原文一致');

  const listAndText='1. 第一步\n2. 第二步\n接着说点别的';
  assert.deepStrictEqual(split(listAndText),['1. 第一步','2. 第二步','接着说点别的'],
    '列表项和后面的正文不会被无分隔符粘成一长条');
}

// ---------------------------------------------------------------------------
// 代码块：闭合的整块走一条，未闭合的整段不分
// ---------------------------------------------------------------------------
function testCodeBlocks(){
  const withCode='先看这段代码\n```js\nconst a=1;\nconst b=2;\n```\n跑一下就知道了';
  const parts=split(withCode);
  assert.strictEqual(parts.length,3,'代码块整体算一条');
  assert.strictEqual(parts[0],'先看这段代码');
  assert.strictEqual(parts[1],'```js\nconst a=1;\nconst b=2;\n```','代码块内部的换行不许拆条');
  assert.strictEqual(parts[2],'跑一下就知道了');

  const unclosed='看这里\n```js\nconst a=1;';
  assert.deepStrictEqual(split(unclosed),[unclosed],'围栏没闭合时整段发一条，避免半截代码块');
}

// ---------------------------------------------------------------------------
// 开关与思考块
// ---------------------------------------------------------------------------
function testToggleAndThinking(){
  const text='第一句\n第二句';
  assert.deepStrictEqual(split(text,false),[text],'整段模式原样发一条');

  const thinking='<think>先想一下</think>第一句\n第二句';
  const parts=split(thinking);
  assert.strictEqual(parts.length,2,'思考块不产生额外气泡');
  assert(parts[0].indexOf('<ck_thinking>')===0,'思考内容挂在第一条上');
  assert(parts[0].indexOf('先想一下')>0);
  assert(parts[0].endsWith('第一句'));
  assert.strictEqual(parts[1],'第二句');

  const onlyThinking='<think>只有思考</think>';
  assert.deepStrictEqual(split(onlyThinking),[onlyThinking],'只有思考没正文时保持原文一条');
}

// ---------------------------------------------------------------------------
// 流式预览：先显示第一条，和最终第一个气泡一致
// ---------------------------------------------------------------------------
function testStreamingPreview(){
  const text='第一句话\n第二句话\n第三句话';
  assert.strictEqual(context.chatStreamingAssistantPreviewText(text),'第一句话',
    '流式阶段只预览第一条，和落定后的第一个气泡对得上');
  assert.strictEqual(context.chatStreamingAssistantPreviewText('还没换行的半句'),'还没换行的半句');
  assert.strictEqual(context.chatStreamingAssistantPreviewText(''),'');
  assert.strictEqual(context.chatStreamingAssistantPreviewText('第一句\n第二句').split('\n').length,1,
    '预览不会把后面的条数提前泄漏出来');
}

testOneNewlineOneBubble();
testDeterministic();
testLengthDoesNotMatter();
testNoContentLossOrGluing();
testCodeBlocks();
testToggleAndThinking();
testStreamingPreview();

console.log('reply-split tests: OK');
