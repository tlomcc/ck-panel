const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const history=require('../chat-history.js');
function setup(){
  const cfg={panelKey:'fixture',digestCycleCount:3,dailyDigestEnabled:true,digestCurrentModel:true,
    thinkingMode:'adaptive',thinkingEffort:'high'};
  const session={id:'memory-fixture',messages:[],transportMessages:[],dailyDigests:[]};
  const c={Date,Math,Map,Set,Promise,setTimeout,clearTimeout,setInterval,clearInterval,AbortController,
    CKChatHistory:history,CKBackendRoute:{current:{execution:'claude_code_subscription'}},
    chatWindowApiRouteConfig:()=>({ok:true,model:'claude-opus-4-6',providerName:'Claude 订阅'}),
    chatNormalizeThinkingMode:x=>x,chatNormalizeThinkingEffort:x=>x,chatLoadConfig:()=>cfg,
    chatSessions:[session],chatMessages:session.messages,chatCurrentSession:()=>session,
    chatNightlyScope:()=> 'fixture-scope',chatSplitThinkingText:text=>({text})};
  c.window=c;vm.createContext(c);
  for(const name of ['chat-digest.js','chat-digest-activation.js','chat-digest-schedule.js'])
    vm.runInContext(fs.readFileSync(require.resolve('../'+name),'utf8'),c);
  return {c,cfg,session};
}
function fill(x,n){
  for(let i=0;i<n;i++){
    x.session.transportMessages.push({role:'user',content:'question '+i},{role:'assistant',content:'answer '+i});
    x.session.messages.push({role:'user',text:'question '+i,ts:1794800000000+i*2},
      {role:'assistant',text:'answer '+i,ts:1794800000001+i*2});
  }
}
test('835 actual rounds retain their full evidence and explicit truncation boundary',()=>{
  const x=setup();fill(x,835);x.session.digestManualTrim={dropRounds:835};
  const before=JSON.stringify(x.session.transportMessages),packet=x.c.chatMemoryCadenceSnapshot(x.cfg,x.session,x.session.messages,'trim');
  assert.equal(packet.rounds.length,835);assert.equal(packet.selected_rounds,835);
  assert.equal(packet.route.model,'claude-opus-4-6');assert.equal(packet.route.output_config.effort,'high');
  assert.equal(JSON.stringify(x.session.transportMessages),before);
});
test('tool loops and split reply bubbles stay within one real human round',()=>{
  const x=setup();x.session.transportMessages=[{role:'user',content:'question'},
    {role:'assistant',content:[{type:'tool_use',name:'lookup',input:{query:'example'}},{type:'thinking',thinking:'private',signature:'signed'}]},
    {role:'user',content:[{type:'tool_result',content:'tool answer'}]},
    {role:'assistant',content:'first bubble'},{role:'assistant',content:'second bubble'},
    {role:'user',content:'pending question'}];
  const packet=x.c.chatMemoryCadenceSnapshot(x.cfg,x.session,[],'daily');
  assert.equal(packet.rounds.length,1);assert.equal(packet.selected_rounds,1);
  assert.match(JSON.stringify(packet.rounds),/工具结果/);assert.match(JSON.stringify(packet.rounds),/second bubble/);
  assert.doesNotMatch(JSON.stringify(packet.rounds),/private|signed|pending question/);
});
test('automatic cuts use the same actual retained-round boundary',()=>{
  const x=setup();fill(x,85);x.c.chatWindowTrimConfigFromSession=()=>({enabled:true,keep:50});
  const packet=x.c.chatMemoryCadenceSnapshot(x.cfg,x.session,x.session.messages);
  assert.equal(packet.rounds.length,85);assert.equal(packet.selected_rounds,35);
});
test('already-decided KEEP receipts allow a covered cut without a new memory save',()=>{
  const x=setup();
  x.c.chatDigestPlanSources=()=>[{key:'covered'}];
  x.session.digestReadyTrims=[{id:'cycle',kind:'cycle',sequence:1,keys:['covered'],text:'saved summary',
    memory_required:true,memory:{memory_first:true,prepared_at:1,decided:true,confirmed_at:2,
      model:'claude-opus-4-6',decision:'keep',already_decided:true,saved:false,unchanged:true}}];
  assert.ok(x.c.chatDigestPreparedTrim(x.session,x.cfg,{}));
  delete x.session.digestReadyTrims[0].memory.decided;
  assert.equal(x.c.chatDigestPreparedTrim(x.session,x.cfg,{}),null);
});
