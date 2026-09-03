// 网关分步耗时要在"前端可见的调试信息"里出现（2026-08-26 用户要求第 3 条）。
// 网关那边把汇总串放在 debug 事件（白名单事件，能进 /ck/debug 事后查）和 done 事件里，
// 面板这边要把它渲染成人能读的一段，而且落在调试台的「计时」主题下。
const assert=require('assert');
const fs=require('fs');
const path=require('path');
const vm=require('vm');

const root=path.resolve(__dirname,'..');
const source=fs.readFileSync(path.join(root,'script.js'),'utf8');

function matchBlock(startIndex,open,close){
  const from=source.indexOf(open,startIndex);
  assert(from>=0,'missing opening '+open);
  let depth=0;
  for(let i=from;i<source.length;i++){
    if(source[i]===open)depth++;
    else if(source[i]===close&&--depth===0)return source.slice(startIndex,i+1);
  }
  throw new Error('unterminated block');
}
function extractFunction(name){
  const start=source.indexOf('function '+name+'(');
  assert(start>=0,'missing function '+name);
  return matchBlock(start,'{','}');
}
function extractObject(name){
  const start=source.indexOf('var '+name+'={');
  assert(start>=0,'missing object '+name);
  return matchBlock(start,'{','}')+';';
}

const ctx={console,Number,String,Object};
vm.createContext(ctx);
vm.runInContext(extractObject('CHAT_TIMING_STAGE_LABELS'),ctx);
vm.runInContext('var CHAT_TIMING_STAGE_ORDER=Object.keys(CHAT_TIMING_STAGE_LABELS);',ctx);
vm.runInContext(extractFunction('chatFormatTimingSummary'),ctx);
vm.runInContext(extractFunction('chatDebugRecordTopic'),ctx);

const SUMMARY='[timing] rewrite=1230ms | search=2100ms | filter=850ms | prompt=200ms | '+
  'upstream_first=4400ms | upstream_total=9600ms | total=18380ms';
const STAGES={
  request_received_to_start_processing_ms:12,
  intent_rewrite_ms:1230,
  vector_search_ms:2100,
  recall_refine_ms:850,
  memory_recall_total_ms:4300,
  message_assembly_ms:200,
  upstream_ttft_ms:4400,
  upstream_full_response_ms:9600,
  post_response_persist_ms:90,
  end_to_end_total_ms:18380,
};

function testSummaryRendering(){
  const text=ctx.chatFormatTimingSummary({debug_id:'d1',timing_summary:SUMMARY,timing_stages:STAGES});
  assert(text.indexOf('⏱ 网关分步耗时')===0,'开头要一眼看出这是耗时');
  assert(text.includes('请求编号 d1'));
  assert(text.includes('总耗时 18380ms'),'总耗时放在第一行');
  assert(text.includes('意图改写：1230ms'),'每一步都要有中文名和毫秒数');
  assert(text.includes('向量检索：2100ms'));
  assert(text.includes('过滤/排序/精筛：850ms'));
  assert(text.includes('拼接 prompt：200ms'));
  assert(text.includes('上游首个数据块：4400ms'));
  assert(text.includes('上游完整响应：9600ms'));
  assert(text.includes('回复落盘：90ms'));
  assert(text.includes(SUMMARY),'网关那条原始汇总串要原样保留，方便直接贴出来');
  // 顺序必须是流程发生的顺序，不是对象键的随机顺序
  assert(text.indexOf('意图改写')<text.indexOf('向量检索'));
  assert(text.indexOf('向量检索')<text.indexOf('过滤/排序/精筛'));
  assert(text.indexOf('拼接 prompt')<text.indexOf('上游首个数据块'));
  // 0 的步骤不占地方
  assert(!text.includes('加载 MCP 工具'),'没走到的步骤不要写出来');
}

function testUnknownKeysAndFailures(){
  const text=ctx.chatFormatTimingSummary({
    timing_stages:{end_to_end_total_ms:100,brand_new_stage_ms:7},
    timing_status:'upstream_error',timing_error:'upstream failed',
  });
  assert(text.includes('brand_new_stage_ms：7ms'),'网关新加的步骤要原样显示，不能吞掉');
  assert(text.includes('状态 upstream_error'),'失败的请求也要能看到耗时和状态');
  assert(text.includes('upstream failed'));
  assert(ctx.chatFormatTimingSummary({}).indexOf('⏱')===0,'空数据不许抛异常');
  assert(ctx.chatFormatTimingSummary(null).indexOf('⏱')===0);
}

function testTopicIsTiming(){
  assert.strictEqual('timing',ctx.chatDebugRecordTopic({event:'debug',data:{timing_summary:SUMMARY}},''),
    '分步耗时要归到「计时」主题下，不能掉进 other');
  assert.strictEqual('timing',ctx.chatDebugRecordTopic({event:'debug',data:{timing_stages:STAGES}},''));
}

function testWiring(){
  const line=extractFunction('chatFormatDebug');
  assert(line.includes('chatFormatTimingSummary(data)'),'debug 事件里带 timing 就走专用格式化');
  assert(line.indexOf('data.timing_summary||data.timing_stages')<line.indexOf('data.latency_probe&&'),
    'timing 分支要排在首字链路那条之前，否则永远走不到');
  assert(!line.includes("data.timing_summary?('\\n　'+String(data.timing_summary))"),
    '请求完成那条不许再跟一串 timing（2026-09-03 用户明确要求删掉）');
  assert(extractFunction('chatDebugLine').includes('chatFormatDebug(record.event,record.data)'),
    '调试台每一行都走 chatFormatDebug');
  const safe=extractFunction('chatDebugSafeData');
  assert(!safe.includes('timing_summary:data.timing_summary'),
    'done 记录既然不显示汇总串，就不用再存一份');
  // 键名要和网关一一对应
  const labels=Object.keys(ctx.CHAT_TIMING_STAGE_LABELS);
  ['intent_rewrite_ms','vector_search_ms','recall_refine_ms','message_assembly_ms',
   'upstream_ttft_ms','upstream_full_response_ms','end_to_end_total_ms',
   'mcp_tools_load_ms','speech_preferences_ms','history_prepare_ms','tool_execution_ms',
   'post_response_persist_ms','canonical_injection_ms','upstream_discarded_attempts_ms']
    .forEach(key=>assert(labels.indexOf(key)>=0,'少了一步的中文名：'+key));
}

testSummaryRendering();
testUnknownKeysAndFailures();
testTopicIsTiming();
testWiring();

console.log('gateway timing display tests: OK');
