const assert=require('assert');
const fs=require('fs');
const path=require('path');

const root=path.resolve(__dirname,'..');
const source=fs.readFileSync(path.join(root,'script.js'),'utf8');
const chatCss=fs.readFileSync(path.join(root,'chat.css'),'utf8');

function functionSource(name){
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

const format=functionSource('chatFormatDebug');
const metaBranch=format.slice(format.indexOf("if(ev==='meta')"),format.indexOf("if(ev==='memory')"));
const cacheBranch=format.slice(format.indexOf('🧊 缓存诊断')-1500,format.indexOf('🧊 缓存诊断')+900);

// 只留一条缓存诊断：缓存相关字段全部归到 🧊 缓存诊断，请求信息只讲请求结构。
assert(!metaBranch.includes('缓存策略'),'request info must not carry a second cache report');
assert(!metaBranch.includes('缓存重建边界'),'cache rebuild boundary belongs to the cache diagnosis');
assert(!metaBranch.includes('空闲：'),'idle seconds belong to the cache diagnosis');
assert(!metaBranch.includes('清旧历史'),'stripped history stats belong to the cache diagnosis');
assert(!metaBranch.includes('记忆召回：'),'recall state belongs to the cache diagnosis');
assert(metaBranch.includes('历史来源')&&metaBranch.includes('注入：世界书'),'request info must keep the request structure');
assert(cacheBranch.includes('重建边界')&&cacheBranch.includes('空闲：')&&cacheBranch.includes('清旧历史'),'the single cache diagnosis must absorb the moved fields');
assert(cacheBranch.includes('路径：'),'the cache diagnosis must state the Fact recall path');
assert((format.match(/缓存诊断/g)||[]).length===1,'only one cache diagnosis title may exist');
assert(source.includes('【已保存的设置】'),'the saved-config banner must stop looking like a second diagnosis');

// Fact 统计和缓存诊断来自同一个事件，早期实现里 Fact 统计会把缓存诊断整条吃掉。
assert(source.includes('function chatFormatFactStatsLine'),'Fact stats need their own line builder');
const debugBranch=format.slice(format.indexOf("if(ev==='debug'){"));
assert(debugBranch.indexOf('cache_anchors')<debugBranch.indexOf('fact_stats_queued'),'the cache diagnosis must be evaluated before Fact stats');
assert(debugBranch.includes("if(data.fact_stats_queued)cacheDiag+='\\n'+chatFormatFactStatsLine(data)"),'a record carrying both must render both');

// 按主题归类：同类相邻，Fact 相关挨着，三条计时挨着。
const topics=source.slice(source.indexOf('var CHAT_DEBUG_TOPICS='),source.indexOf('function chatDebugTopicLabel'));
['request','cache','recall','timing','usage','trim','error','other'].forEach(function(key){
  assert(topics.includes("key:'"+key+"'"),'missing debug topic '+key);
});
const topic=functionSource('chatDebugRecordTopic');
assert(topic.includes("if(ev==='latency')return 'timing'"),'first-byte latency records belong to the timing group');
assert(topic.includes("data.latency_probe)return 'timing'"),'gateway first-byte probe belongs to the timing group');
assert(topic.includes("data.fact_stats_queued||data.recall_error||data.recall_query"),'Fact stats and recall diagnostics must sit in one group');
assert(topic.includes("if(ev==='intent_rewrite'||ev==='memory')return 'recall'"),'intent rewrite must sit next to the Fact recall block');
const grouped=functionSource('chatDebugGroupedIndexes');
assert(grouped.includes('chatDebugTopicRank'),'records must be ordered by topic');
assert(grouped.includes('a.order-b.order'),'ordering inside one topic must stay chronological');
assert(functionSource('chatDebugRoundOpener').includes("record.event==='meta'"),'each request must start a new group');
const render=functionSource('chatRenderDebugRecords');
assert(render.includes('chatDebugGroupedIndexes'),'the debug panel must render grouped records');
assert(render.includes('chat-debug-topic'),'topic headings must be rendered');
assert(render.includes('chatDebugRecords[item.index],item.index'),'copy buttons must keep pointing at the original record index');
assert(chatCss.includes('.chat-debug-topic'),'topic headings need styling');

// 原来落进「🔎 调试信息｜{原始 JSON}」的事件现在有中文标题，才能被正确归类。
['🗣 措辞偏好提取','✂️ 截断同步网关','⚠️ 空闲自动截断失败','⏳ 截断总结等待'].forEach(function(title){
  assert(format.includes(title),'missing debug title '+title);
});

// 缓存指纹是排查"为什么不命中"的唯一仪表。旧版只报一个 status，而且那个 status
// 本身不可信；现在网关会给出和上一轮逐段对齐的相同前缀、首个变化位置、上一轮哪些
// 断点还落在相同前缀里 —— 这三项必须显示出来，否则修了网关也看不到。
const fingerprint=format.slice(format.indexOf('function fingerprintZh'),format.indexOf("if(ev==='meta')"));
assert(fingerprint.includes('common_prefix_bytes'),'相同前缀字节数必须显示');
assert(fingerprint.includes('common_prefix_segments'),'相同前缀段数必须显示');
assert(fingerprint.includes('first_change_label'),'首个变化的位置必须显示');
assert(fingerprint.includes('reusable_breakpoints'),'上一轮还能读到哪些断点必须显示');
assert(fingerprint.includes('上一轮断点全部作废'),'一个断点都读不到时要说清本轮必然整段重建');
assert(!fingerprint.includes("'前缀一致'"),'旧的「前缀一致」文案会被误当成证据，必须换掉');
assert(fingerprint.includes('哈希不含断点标记'),'哈希语义变了（剥掉 cache_control），要在面板上写明');

console.log('debug panel layout tests: OK');
