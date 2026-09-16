const assert=require('assert');
const fs=require('fs');
const path=require('path');

const root=path.resolve(__dirname,'..');
const source=fs.readFileSync(path.join(root,'script.js'),'utf8');
const html=fs.readFileSync(path.join(root,'index.html'),'utf8');

const fields=[
  'native-thinking-history',
  'pseudo-thinking-history',
  'recall-history',
  'current-time-history',
  'time-gap-history',
  'backend-switch-history'
];

assert(source.includes('timeInjectionEveryRounds:1'),'time injection interval must default to every round');
assert(source.includes('chatNormalizeTimeInjectionEveryRounds'),'time injection interval must be normalized');
assert(html.includes('id="chat-time-injection-every-rounds"'),'time injection interval control is missing');
assert(source.includes('time_injection_every_rounds:chatNormalizeTimeInjectionEveryRounds(cfg.timeInjectionEveryRounds)'),
  'time injection interval must be sent to the gateway');

for(const suffix of fields){
  assert(html.includes(`id="chat-retain-${suffix}"`),`missing history switch: ${suffix}`);
}
assert(source.includes('retainNativeThinkingHistory:true'),'native history default must stay enabled');
assert(source.includes('retainPseudoThinkingHistory:true'),'pseudo history default must stay enabled');
assert(source.includes('retainRecallHistory:true'),'recall history default must stay enabled');
assert(source.includes('retainCurrentTimeHistory:true'),'current time history default must stay enabled');
assert(source.includes('retainTimeGapHistory:true'),'time gap history default must stay enabled');
assert(source.includes('retainBackendSwitchHistory:true'),'backend history default must stay enabled');
for(const field of [
  'retain_native_thinking_history',
  'retain_pseudo_thinking_history',
  'retain_recall_history',
  'retain_current_time_history',
  'retain_time_gap_history',
  'retain_backend_switch_history'
]){
  assert(source.includes(`${field}:cfg.`),`request field is missing: ${field}`);
}

console.log('dynamic history retention panel tests: OK');
