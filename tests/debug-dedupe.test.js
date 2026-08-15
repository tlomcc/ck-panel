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
vm.runInNewContext(script.slice(start,end)+'\nthis.api={chatDebugNormalizeRecords,chatDebugFactRecallSignature,chatDebugPrune};',sandbox);

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

console.log('debug dedupe tests: OK');
