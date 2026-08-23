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

// ── 调试记录页 / 设置页的排版（2026-08-23 用户要求）───────────────────────
// 1. 计费标准整块搬去「设置」，只剩一个总闸；调试记录页不再填任何单价。
// 2. 「√ 的颜色代表什么」和「用量符号是什么意思」两块说明都长在设置页的计费开关那块，
//    默认折叠；调试记录页不再重复放一份。
// 3. 「已保存的设置」默认折叠——展开着太占地方。
const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
const debugPanel=html.slice(html.indexOf('id="chat-side-debug"'));
['chat-cost-input-price','chat-cost-output-price','chat-cost-cache-read-price',
 'chat-cost-cache-create-5m-price','chat-cost-cache-create-1h-price','chat-cost-multiplier',
 'chat-cost-currency','chat-cost-mode'].forEach(function(id){
  assert(!html.includes('id="'+id+'"'),'单价输入框必须全部撤掉，价格改在供应商库里按供应商维护：'+id);
});
assert(!debugPanel.includes('计费标准'),'计费标准整块必须搬去设置页');
const gateway=html.slice(html.indexOf('id="chat-side-gateway"'),html.indexOf('id="chat-side-worldbook"'));
assert(/id="chat-billing-enabled"/.test(gateway),'计费总闸必须落在设置页');
assert(/id="chat-usage-stats-enabled"/.test(gateway),'用量统计开关必须落在设置页');
assert(!/id="chat-full-window-context"/.test(html),'同窗口全量上下文是死开关，必须删掉');
assert(!source.includes('fullWindowContext'),'同窗口全量上下文的配置字段也要一起清掉');

// 两块说明都在设置页，紧跟自己解释的那个开关，而且默认折叠。
assert(/<details[^>]*chat-tick-legend-card[\s\S]*?id="chat-tick-legend"/.test(gateway),'√ 颜色说明必须是设置页里的可折叠块');
assert(!/chat-tick-legend-card[^>]*\sopen[\s>]/.test(gateway),'√ 颜色说明默认折叠');
assert(/<details[^>]*chat-usage-legend-card[\s\S]*?id="chat-usage-legend"/.test(gateway),'用量符号说明必须是设置页里的可折叠块');
assert(!/chat-usage-legend-card[^>]*\sopen[\s>]/.test(gateway),'用量符号说明默认折叠');
assert(gateway.indexOf('id="chat-billing-enabled"')<gateway.indexOf('chat-tick-legend-card'),'√ 说明跟在计费开关下面');
assert(gateway.indexOf('chat-tick-legend-card')<gateway.indexOf('id="chat-usage-stats-enabled"'),'√ 说明在用量统计开关之前');
assert(gateway.indexOf('id="chat-usage-stats-enabled"')<gateway.indexOf('chat-usage-legend-card'),'符号说明跟在用量统计开关下面');
assert(!debugPanel.includes('chat-tick-legend-card'),'调试记录页不再重复放一份 √ 说明');
assert(/<details[^>]*chat-debug-saved-card[\s\S]*?id="chat-debug-cache-mode"/.test(debugPanel),'已保存的设置必须包在可折叠块里');
assert(!/chat-debug-saved-card[^>]*\sopen[\s>]/.test(debugPanel),'已保存的设置默认折叠');
assert(debugPanel.indexOf('chat-debug-saved-card')<debugPanel.indexOf('id="chat-debug"'),'已保存的设置仍在调试记录之上');
assert(source.includes('function chatRenderTickLegend'),'说明内容要用真勾号现造，别在 HTML 里另抄一份 SVG');
assert(functionSource('chatRenderTickLegend').includes('chatCacheTickHtml'),'图例必须复用 chatCacheTickHtml，保证颜色和消息上完全一致');
const legendRows=source.slice(source.indexOf('var CHAT_TICK_LEGEND_ROWS='),source.indexOf('function chatRenderTickLegend'));
['full','partial','created','below_minimum','miss','sent'].forEach(function(state){
  assert(legendRows.includes("'"+state+"'"),'√ 说明漏了状态 '+state);
});
// 打开「设置」那一页时两块说明都要现渲染，否则用户看到的永远是"读取中"。
const switchTab=functionSource('chatSwitchSideTab');
assert(/tab==='gateway'[\s\S]{0,160}chatRenderTickLegend\(\)/.test(switchTab),'切到设置页要渲染 √ 说明');
assert(/tab==='gateway'[\s\S]{0,160}chatRenderUsageLegend\(\)/.test(switchTab),'切到设置页要渲染符号说明');

// ── 聊天面板的价格文案：直接给数字，不写"按单价 / 估算" ────────────────────
const costLabel=functionSource('chatAssistantCostLabel');
assert(!costLabel.includes('按单价')&&!costLabel.includes('估算 '),'价格前面不许再加"按单价/估算"前缀');
assert(costLabel.includes('chatCostAmountText'),'价格本身还是要显示');

// ── 用量统计那一行：符号代替文字，跟日期同字号 ─────────────────────────────
// 符号只在 CHAT_USAGE_SYMBOL_ROWS 里定义一次，消息行和设置页那块说明共用同一份，
// 免得改了一处、另一处还是旧符号。
const symbolRows=source.slice(source.indexOf('var CHAT_USAGE_SYMBOL_ROWS='),source.indexOf('function chatUsageTokenText'));
['↑','↓','⚡','✚','◎'].forEach(function(symbol){
  assert(symbolRows.includes("'"+symbol+"'"),'用量统计缺符号 '+symbol);
});
['输入','输出','缓存命中','缓存创建','命中率'].forEach(function(word){
  assert(symbolRows.includes(word),'每个符号都要有一句人话解释：'+word);
});
const usage=functionSource('chatAssistantUsageHtml');
assert(usage.includes('chatUsageStatsEnabled()'),'没开用量统计就不许输出这一行');
assert(usage.includes('CHAT_USAGE_SYMBOL_ROWS'),'消息行必须复用那份符号常量，不许再抄一遍');
assert(functionSource('chatRenderUsageLegend').includes('CHAT_USAGE_SYMBOL_ROWS'),'说明也必须复用同一份符号常量');
assert(/chat-msg-usage/.test(usage),'用量行要有自己的 class');
assert(/font-size:10\.5px/.test(chatCss.slice(chatCss.indexOf('.chat-msg-usage{'),chatCss.indexOf('.chat-msg-usage{')+700)),
  '用量行字号必须和日期那一行一致（10.5px）');
assert(functionSource('chatAttachAssistantCost').includes('msg.tkRead=cost.read'),
  'token 数必须落盘，否则刷新一次页面就算不出命中率了');
assert(functionSource('chatRenderMessageRow').includes('+time+usage+'),'用量行要紧跟在时间那一行下面');

console.log('debug panel layout tests: OK');
