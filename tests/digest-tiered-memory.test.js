const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {view}=require('../digest-progress.js');
const plain=value=>JSON.parse(JSON.stringify(value));
function context(){
 const cfg={digestManualModel:'claude-opus-4-6',thinkingMode:'adaptive',thinkingEffort:'high'};
 const c={console,Date,Map,setTimeout,clearTimeout,setInterval,clearInterval,AbortController,
   CKBackendRoute:{current:{execution:'claude_code_subscription'}},chatLoadConfig:()=>cfg,
   chatSaveConfigObject:value=>Object.assign(cfg,value),
   chatWindowApiRouteConfig:()=>({ok:true,model:'claude-opus-4-6',providerName:'Claude 订阅'}),
   chatNormalizeThinkingMode:mode=>mode||'off',chatNormalizeThinkingBudget:value=>Number(value)||4096,
   chatNormalizeThinkingEffort:value=>value||'high'};
 c.window=c;vm.createContext(c);vm.runInContext(fs.readFileSync(require.resolve('../chat-digest-schedule.js'),'utf8'),c);
 return {c,cfg};
}
test('new summary selection migrates to Sonnet 5.5 with adaptive medium without changing chat',()=>{
 const {c,cfg}=context(),summary=plain(c.chatManualModelRoute(cfg,'digest').selected);
 assert.deepEqual(summary,{execution:'claude_code_subscription',model:'claude-sonnet-5-5',thinking:{type:'adaptive'},output_config:{effort:'medium'}});
 assert.equal(c.chatMemoryModelRoute(cfg).model,'claude-opus-4-6');
 c.chatSaveManualModel('digest','claude-haiku-4-5');assert.equal(c.chatManualModelValue(cfg,'digest'),'claude-haiku-4-5');
 assert.equal(c.chatMemoryModelRoute(cfg).model,'claude-opus-4-6');
});
test('memory captures the actual chat thinking settings independently',()=>{
 const {c,cfg}=context();
 assert.deepEqual(plain(c.chatMemoryModelRoute(cfg).output_config),{effort:'high'});
 cfg.thinkingMode='native';cfg.thinkingBudgetTokens=8192;
 const memory=plain(c.chatMemoryModelRoute(cfg));assert.deepEqual(memory.thinking,{type:'enabled',budget_tokens:8192});assert.equal(memory.output_config,undefined);
 assert.equal(c.chatManualModelRoute(cfg,'digest').selected.thinking.type,'adaptive');
 cfg.thinkingMode='off';assert.equal(c.chatMemoryModelRoute(cfg).thinking.type,'disabled');
});
test('unready chat route cannot silently use a summary model for memory',()=>{
 const {c,cfg}=context();c.chatWindowApiRouteConfig=()=>({ok:false,reason:'模型不可用'});
 assert.throws(()=>c.chatMemoryModelRoute(cfg),/模型不可用/);
});
test('quota wait uses the summary route and does not promise a memory prerequisite',()=>{
 const now=1794290000000,remote={observed_at:now/1000,status:'blocked',stage:'cycle_memory',enabled:true,
  model_run:{id:'same',state:'blocked',route:{execution:'claude_code_subscription',model:'claude-sonnet-5-5'},memory_route:{model:'claude-opus-4-6'}},
  quota_wait:{run_id:'same',state:'waiting_reset',reset_at:1794294000},progress:{memory_pending:true,completed_batches:4,planned_batches:4}};
 const v=view({digestModelRun:{id:'same'}},remote,{prepare:true},{now,receivedAt:now});
 assert.equal(v.stage,'等待额度刷新后自动继续');assert.equal(v.eta,'等待官方刷新确认');assert.match(v.detail,/从断点继续/);assert.doesNotMatch(v.detail,/先完成主动记忆/);assert.match(v.detail,/15:00/);
 assert.match(v.model,/claude-sonnet-5-5/);
});
test('completed summary batches wait for saving and show the six-minute request limit',()=>{
 const now=1794290000000,remote={observed_at:now/1000,status:'running',stage:'cycle_memory',
  model_run:{id:'same',state:'running',route:{execution:'claude_code_subscription',model:'claude-sonnet-5-5'},memory_route:{model:'claude-opus-4-6'}},
  progress:{phase:'review',memory_pending:true,completed_batches:4,planned_batches:4}};
 const v=view({digestModelRun:{id:'same'}},remote,{prepare:true},{now,receivedAt:now});
 assert.equal(v.stage,'Claude 正在复核总结');assert.equal(v.eta,'批次已完成，等待最终保存');assert.doesNotMatch(v.detail,/记忆/);
 remote.stage='cycle_part';remote.progress={phase:'draft',completed_batches:0,planned_batches:4};
 assert.match(view({},remote,{}, {now,receivedAt:now}).etaNote,/6 分钟/);
});
test('the visible stages only track summary batches even with old memory flags',()=>{
 const now=1794290000000,remote={observed_at:now/1000,status:'running',stage:'cycle_memory',
  model_run:{id:'same',state:'running',route:{execution:'claude_code_subscription',model:'claude-sonnet-5-5'},memory_route:{model:'claude-opus-4-6'}},
  progress:{phase:'review',memory_pending:true,completed_batches:0,planned_batches:5,memory_completed_batches:1,memory_planned_batches:3}};
 const v=view({digestModelRun:{id:'same'}},remote,{prepare:true},{now,receivedAt:now});
 assert.deepEqual(v.steps,['截断总结','保存结果','截断同步']);assert.equal(v.step,0);
 assert.doesNotMatch(v.batch,/主动记忆/);assert.match(v.batch,/已完成 0 批/);assert.match(v.batch,/共 5 批/);
 assert.doesNotMatch(v.detail,/记忆/);
});
test('a manual click starts the explicit summary workflow',async()=>{
 const {c,cfg}=context();cfg.digestCurrentModel=false;const calls=[];
 c.chatInit=()=>{};c.chatSaveConfig=()=>cfg;c.chatCurrentSession=()=>({id:'s'});
 c.chatStartCurrentModelDigest=async purpose=>{calls.push(purpose);return true};
 vm.runInContext(fs.readFileSync(require.resolve('../chat-digest-activation.js'),'utf8'),c);
 assert.equal(await c.chatRequestManualDigestTrim(),true);assert.deepEqual(calls,['trim']);
});
test('choosing the chat model for summaries is allowed without invoking memory',async()=>{
 const {c,cfg}=context();Object.assign(cfg,{digestCurrentModel:true,dailyDigestEnabled:true,
  digestModelPolicy:'sonnet55-adaptive-medium-v2',digestManualModel:'claude-opus-4-6'});
 const notices=[];c.toast=x=>notices.push(x);c.chatCurrentSession=()=>({id:'s'});c.chatDailyDigestPrune=()=>{};
 c.chatDigestMigrationPending=()=>false;c.chatDigestReplyActive=()=>false;c.chatTrimBusy=false;c.chatTrimTransaction=null;
 let syncCalls=0;c.chatNightlyStatus={};c.chatSyncNightlyDigest=async()=>{syncCalls++;return false};
 assert.equal(await c.chatStartCurrentModelDigest('trim'),false);assert.equal(syncCalls,1);assert.ok(notices.every(x=>!x.includes('另一个模型')));
 assert.equal(c.chatDigestSameModel({model:'opus'},{model:'claude-opus-4-6'}),true);
});
