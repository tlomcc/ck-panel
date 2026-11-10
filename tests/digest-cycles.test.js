const {test}=require('node:test');
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const history=require('../chat-history.js');
const plain=value=>JSON.parse(JSON.stringify(value));
function setup(){
  const cfg={panelKey:'fixture',gatewayUrl:'https://fixture.invalid',digestCycleCount:3,dailyDigestEnabled:true,digestCurrentModel:true};
  const session={id:'cycle-fixture',dailyDigests:[],messages:[],transportMessages:[]},nodes={};let saves=0;
  const ctx={console,Date,setTimeout,clearTimeout,setInterval,clearInterval,AbortController,CKChatHistory:history,
    chatSessions:[session],chatMessages:session.messages,chatCurrentSession:()=>session,chatLoadConfig:()=>cfg,
    chatSaveSessions:()=>saves++,chatSaveConfigObject:()=>{},chatNightlyScope:()=> 'fixture-scope',
    chatSetFieldChecked:()=>{},chatSetFieldValue:(id,v)=>{if(nodes[id])nodes[id].value=String(v)},
    chatFieldChecked:(id,v)=>v,chatDebug:()=>{},toast:()=>{},chatNightlySettingsPriority:()=>{},chatScheduleNightlySync:()=>{},
    chatSplitThinkingText:text=>({text}),document:{getElementById:id=>nodes[id]||null},
    chatNightlyStatus:{},chatPendingMessages:()=>[],chatRenderNightlyStatus:()=>{},chatSending:false};
  vm.createContext(ctx);
  for(const name of ['chat-digest.js','chat-digest-activation.js'])vm.runInContext(fs.readFileSync(require.resolve('../'+name),'utf8'),ctx);
  return {cfg,session,ctx,nodes,saves:()=>saves};
}
function first(x){
  const text='【原来的注入标题】\n第一份详细的全部内容。\n';
  x.session.dailyDigests=[{id:'old-day',dayKey:'2026-11-06',text:'旧存档',covered:['old-source']}];
  x.session.digestActivePack={scope:'fixture-scope',config:'old-config',text,at:Date.now()};
  assert.equal(x.ctx.chatDigestMigrateCycles(x.session,x.cfg),true);return text;
}
function advance(x,n){
  const rows=x.session.dailyDigests,last=rows.filter(r=>r.kind==='cycle'&&r.active!==false).at(-1);
  if(last&&x.cfg.digestCycleCount>1)last.brief={source:x.ctx.chatDigestStamp(last.text),text:'简版'+last.sequence};
  x.session.digestReadyTrims=[{id:'cy-'+n,kind:'cycle',sequence:n,keys:['source-'+n],text:'详细'+n,startTs:1,endTs:2}];
  x.ctx.chatDigestPlanSources=()=>[{key:'source-'+n}];
  const result=x.ctx.chatDigestPreparedTrim(x.session,x.cfg,{canonicalTransport:false});
  assert.ok(result);x.session.dailyDigests=result.entries;x.session.digestActivePack=result.activePack;x.session.digestReadyTrims=[];
  return result;
}
test('first injection is imported once with exact bytes and its original archive',()=>{
  const x=setup(),text=first(x);
  assert.equal(x.ctx.chatDailyDigestPack(x.cfg,x.session),text);
  assert.equal(x.ctx.chatDailyDigestBuildPack(x.cfg,x.session),text);
  assert.equal(x.session.dailyDigests[0].text,'旧存档');assert.equal(x.session.dailyDigests[0].active,false);
  const imported=x.session.dailyDigests.at(-1);assert.equal(imported.sequence,1);assert.equal(imported.text,text);
  assert.equal(x.ctx.chatDigestMigrateCycles(x.session,x.cfg),false);assert.equal(x.session.dailyDigests.length,2);
});
test('an unfinished neighboring summary or unacknowledged cut cannot be imported',()=>{
  for(const field of ['digestManualTrim','digestModelRun','digestLastSync']){
    const x=setup();x.session.digestActivePack={scope:'fixture-scope',text:'尚未切换'};
    x.session[field]=field==='digestLastSync'?{status:'pending'}:{id:'running'};
    assert.equal(x.ctx.chatDigestMigrateCycles(x.session,x.cfg),false);assert.equal(x.session.dailyDigests.length,0);
  }
  const x=setup();x.session.digestActivePack={scope:'another-connection',text:'别的连接'};
  assert.equal(x.ctx.chatDigestMigrateCycles(x.session,x.cfg),false);
});
test('Z=3 rotates 1,2,3 into 2,3,4 without resending old detailed versions',()=>{
  const x=setup();first(x);advance(x,2);advance(x,3);
  let pack=x.ctx.chatDailyDigestPack(x.cfg,x.session);
  assert.match(pack,/简版1/);assert.match(pack,/简版2/);assert.match(pack,/详细3/);
  const before=x.session.dailyDigests.find(r=>r.sequence===2).brief.text;
  advance(x,4);pack=x.ctx.chatDailyDigestPack(x.cfg,x.session);
  assert.doesNotMatch(pack,/简版1|详细2|详细3/);assert.match(pack,/简版2/);assert.match(pack,/简版3/);assert.match(pack,/详细4/);
  assert.equal(x.session.dailyDigests.find(r=>r.sequence===2).brief.text,before);
  assert.equal(x.session.dailyDigests.find(r=>r.sequence===1).active,false);
  assert.match(x.session.dailyDigests.find(r=>r.sequence===1).text,/第一份详细/);
});
test('Z settings save does not generate summaries or rewrite the active prefix',()=>{
  const x=setup(),text=first(x);let requests=0;x.ctx.fetch=()=>{requests++;throw Error('no requests expected')};
  x.nodes['chat-digest-cycle-count']={value:'5'};
  x.ctx.chatSaveDailyDigestSetting(false);
  assert.equal(x.cfg.digestCycleCount,5);assert.equal(requests,0);assert.equal(x.session.digestActivePack.text,text);
  for(const value of ['0','101','1.5','']){x.nodes['chat-digest-cycle-count'].value=value;assert.equal(x.ctx.chatDigestValidateSettings(false),null)}
});
test('Z=1 keeps only the newest injection; increasing Z accumulates future cycles',()=>{
  const x=setup();first(x);advance(x,2);x.cfg.digestCycleCount=1;advance(x,3);
  assert.equal(x.ctx.chatDailyDigestEntries(x.session,null,x.cfg).length,1);
  assert.doesNotMatch(x.session.digestActivePack.text,/简版|详细2/);
  x.cfg.digestCycleCount=3;advance(x,4);
  assert.deepEqual(plain(x.ctx.chatDailyDigestEntries(x.session,null,x.cfg).map(r=>r.sequence)),[3,4]);
});
test('a missing previous brief blocks a cut and retains all source history',()=>{
  const x=setup();first(x);x.session.digestReadyTrims=[{id:'cy-2',kind:'cycle',sequence:2,keys:['g'],text:'新总结',startTs:1,endTs:2}];
  x.ctx.chatDigestPlanSources=()=>[{key:'g'}];const before=plain(x.session);
  assert.equal(x.ctx.chatDigestPreparedTrim(x.session,x.cfg,{canonicalTransport:false}),null);
  assert.deepEqual(plain(x.session),before);
});
test('new cycles cannot trim until normal-chat memory has a confirmed keep or save receipt',()=>{
 const x=setup();x.cfg.digestCycleCount=1;
 x.ctx.chatDigestPlanSources=()=>[{key:'g'}];
 const trim={id:'cy-2',kind:'cycle',sequence:2,keys:['g'],text:'新总结',startTs:1,endTs:2,memory_required:true};
 x.session.digestReadyTrims=[trim];const before=plain(x.session);
 assert.equal(x.ctx.chatDigestPreparedTrim(x.session,x.cfg,{canonicalTransport:false}),null);
 assert.deepEqual(plain(x.session),before);
 trim.memory={decided:true,decision:'update',model:'claude-opus-4-6',confirmed_at:123};
 assert.equal(x.ctx.chatDigestPreparedTrim(x.session,x.cfg,{canonicalTransport:false}),null);
 trim.memory.saved=true;assert.ok(x.ctx.chatDigestPreparedTrim(x.session,x.cfg,{canonicalTransport:false}));
 trim.memory={decided:true,decision:'keep',model:'claude-opus-4-6',confirmed_at:123};
 assert.ok(x.ctx.chatDigestPreparedTrim(x.session,x.cfg,{canonicalTransport:false}));
});
test('hidden full memory copies are excluded from source matching, signed blocks survive cleanup',()=>{
  const x=setup(),block={type:'thinking',thinking:'private fixture',signature:'fixture-signature'};
  const messages=[{role:'user',content:[{type:'text',text:'你好'},{type:'text',text:'<ck_active_memory_current>暂停</ck_active_memory_current>'}]},
    {role:'assistant',content:[block,{type:'text',text:'你好呀'},{type:'text',text:'<ck_active_memory_event>旧完整记忆</ck_active_memory_event>'}]}];
  assert.deepEqual(plain(x.ctx.chatDigestTransportRows(messages)),[{role:'user',text:'你好'},{role:'assistant',text:'你好呀'}]);
  const clean=x.ctx.chatDigestCompactMemoryHistory(messages);assert.deepEqual(plain(clean[1].content[0]),block);
  assert.match(JSON.stringify(messages),/旧完整记忆/);assert.doesNotMatch(JSON.stringify(clean),/旧完整记忆|ck_active_memory_current/);
});
