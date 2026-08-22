const fs=require('fs');
const vm=require('vm');

function assert(condition,message){
  if(!condition)throw new Error(message);
}

const root=require('path').resolve(__dirname,'..');
const script=fs.readFileSync(require('path').join(root,'script.js'),'utf8');
const start=script.indexOf('function chatDebugPrune');
const end=script.indexOf('function chatDebugLine',start);
assert(start>=0&&end>start,'debug dedupe helpers missing');
const sandbox={CHAT_DEBUG_TTL:24*60*60*1000,Date};
vm.runInNewContext(script.slice(start,end)+'\nthis.api={chatDebugNormalizeRecords,chatDebugFactRecallSignature,chatDebugPrune,chatDebugCacheDiagKey,chatDebugMergeCacheDiag};',sandbox);

const diag={
  total_seconds:4.253,
  counts:{vector_matched:104,keyword_matched:80},
  final_injected:{entity_facts:2}
};
const records=[
  {ts:100,event:'memory',data:{memory_chars:232,recall_diag:diag}},
  {ts:101,event:'debug',data:{memory_chars:232,recall_query:'还没到晚上呢哥哥就赶我走',recall_diag:{final_injected:{entity_facts:2},counts:{keyword_matched:80,vector_matched:104},total_seconds:4.253}}}
];
const normalized=sandbox.api.chatDebugNormalizeRecords(records);
assert(normalized.length===1,'same Fact diagnosis must render only once');
assert(normalized[0].event==='debug','the more complete debug record should win');
assert(sandbox.api.chatDebugFactRecallSignature(normalized[0]),'Fact diagnosis signature missing');
const persisted=sandbox.api.chatDebugPrune(records.map(function(record){return {...record,ts:Date.now()}}));
assert(persisted.length===1,'persisted duplicate Fact diagnosis must be pruned');

const other=sandbox.api.chatDebugNormalizeRecords(records.concat([
  {ts:102,event:'debug',data:{memory_chars:232,recall_query:'另一条查询',recall_diag:{...diag,total_seconds:4.254}}}
]));
assert(other.length===2,'different Fact diagnoses must remain separate');

// 同一次请求只能留一条缓存诊断：主诊断在前，轮询换策略时又会来一条只带锚点/指纹的。
const cacheRecords=[
  {ts:200,event:'debug',data:{debug_id:'d1',round:1,cache_anchors:['system'],cache_fingerprint:{request_hash:'aaa'},canonical_changes:[],cache_strategy:'single_5m',cache_rebuild_boundary:'round_limit',idle_seconds:12,recall_mode:'full',recall_mode_epoch:3,request_messages:20}},
  {ts:201,event:'debug',data:{debug_id:'d1',chat_polling_cache_strategy_switched:true,cache_strategy:'prefix_24h',cache_anchors:['messages'],cache_fingerprint:{request_hash:'bbb'}}}
];
const mergedCache=sandbox.api.chatDebugNormalizeRecords(cacheRecords);
assert(mergedCache.length===1,'one request must render exactly one cache diagnosis');
assert(mergedCache[0].data.cache_strategy==='prefix_24h','the newest cache strategy must win');
assert(mergedCache[0].data.cache_fingerprint.request_hash==='bbb','the newest fingerprint must win');
assert(mergedCache[0].data.cache_rebuild_boundary==='round_limit','fields missing from the later record must survive the merge');
assert(mergedCache[0].data.idle_seconds===12,'idle seconds must survive the merge');
assert(mergedCache[0].ts===201,'the merged record keeps the freshest timestamp');
const twoRequests=sandbox.api.chatDebugNormalizeRecords(cacheRecords.concat([
  {ts:300,event:'debug',data:{debug_id:'d2',cache_anchors:['system'],cache_fingerprint:{request_hash:'ccc'}}}
]));
assert(twoRequests.length===2,'different requests keep their own cache diagnosis');
assert(!sandbox.api.chatDebugCacheDiagKey({event:'debug',data:{cache_anchors:['system']}}),'without debug_id nothing may be merged blindly');
assert(!sandbox.api.chatDebugCacheDiagKey({event:'debug',data:{debug_id:'d3',cache_anchors:['system'],recall_diag:{total_seconds:1}}}),'Fact diagnosis records must stay on the Fact dedupe path');

console.log('debug dedupe tests: OK');
