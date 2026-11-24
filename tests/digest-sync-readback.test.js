const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
function setup(){
  const session={id:'sync-recovery'},cfg={scope:'us',stamp:'same'},nodes=new Map(),reads=[],cuts=[];
  let current=session,ready=false,reply=false;
  const ctx=vm.createContext({Map,Set,Promise,Date,Math,document:{getElementById(id){if(!nodes.has(id))nodes.set(id,{});return nodes.get(id)}}});
  for(const name of ['chat-digest-activation.js','chat-digest-schedule.js'])vm.runInContext(fs.readFileSync(path.join(__dirname,'..',name),'utf8'),ctx);
  Object.assign(ctx,{chatCurrentSession:()=>current,chatLoadConfig:()=>cfg,chatDigestActiveScope:c=>c.scope,chatDigestConfigStamp:c=>c.stamp,
    chatDigestReplyActive:()=>reply,chatTrimBusy:false,chatTrimTransaction:null,chatDigestPendingSync:()=>null,chatDigestImmediateReady:()=>ready,
    chatDigestSyncView:()=>({ready,retry:false,rounds:0,status:'等待取回',note:''}),chatSyncNightlyDigest:async(c,o)=>{reads.push(o);ready=true;return true},
    chatApplyAutoTrimForPendingBatch:async(...args)=>{cuts.push(args);return {cacheBoundary:true,trimmed:true,dropped:2}},
    chatSaveSessions(){},chatRenderDailyDigest(){},chatRenderMessages(){},chatScheduleNightlySync(){},toast(){}});
  return {ctx,session,cfg,nodes,reads,cuts,setReady:v=>ready=v,setReply:v=>reply=v,setCurrent:v=>current=v};
}
test('stale local readiness leaves the explicit readback button usable',()=>{
  const x=setup();x.ctx.chatRenderNightlyStatus();
  for(const id of ['chat-digest-sync-now','chat-trim-sync-now'])assert.equal(x.nodes.get(id).disabled,false);
  x.setReply(true);x.ctx.chatRenderNightlyStatus();assert.equal(x.nodes.get('chat-digest-sync-now').disabled,true);
});
test('explicit sync reads saved results without submitting another model run',async()=>{
  const x=setup();assert.equal(await x.ctx.chatDigestSyncNow(),true);assert.equal(x.reads.length,1);assert.equal(x.cuts.length,1);
  assert.equal(x.reads[0].readOnly,true);assert.equal(x.reads[0].force,true);assert.equal(x.reads[0].session,x.session);assert.equal(x.reads[0].modelRun,undefined);
});
test('apparently ready old manual runs still read the current server result',async()=>{
  const x=setup();x.setReady(true);x.session.digestModelRun={id:'old-manual',purpose:'trim'};
  assert.equal(await x.ctx.chatDigestSyncNow(),true);assert.equal(x.reads.length,1);
  assert.equal(x.reads[0].readOnly,true);assert.equal(x.reads[0].force,true);
});
test('automatic completion reuses the result just read by its caller',async()=>{
  const x=setup();x.setReady(true);x.session.digestModelRun={id:'same-finished-run',purpose:'trim'};
  assert.equal(await x.ctx.chatDigestSyncNow({automatic:true}),true);assert.equal(x.reads.length,0);
  assert.equal(x.cuts.length,1);
});
test('incomplete result cannot commit a cut',async()=>{
  const x=setup();x.ctx.chatSyncNightlyDigest=async()=>false;
  assert.equal(await x.ctx.chatDigestSyncNow(),false);assert.equal(x.cuts.length,0);
});
for(const changed of ['session','scope','config','reply'])test('a changed '+changed+' during readback prevents a cut',async()=>{
  const x=setup();x.ctx.chatSyncNightlyDigest=async()=>{x.setReady(true);if(changed==='session')x.setCurrent({id:'other'});if(changed==='scope')x.cfg.scope='other';if(changed==='config')x.cfg.stamp='other';if(changed==='reply')x.setReply(true);return true;};
  assert.equal(await x.ctx.chatDigestSyncNow(),false);assert.equal(x.cuts.length,0);
});
test('active reply is not interrupted by a sync click',async()=>{
  const x=setup();x.setReply(true);assert.equal(await x.ctx.chatDigestSyncNow(),false);assert.equal(x.reads.length,0);assert.equal(x.cuts.length,0);
});
test('an old pending history sync reads a completed different server run before uploading',async()=>{
  const x=setup(),pending={id:'old-sync',rounds:0,status:'pending'};
  x.session.digestLastSync=pending;x.session.digestManualTrim={keys:['old-source']};x.session.digestModelRun={id:'old-unconfirmed',startState:'unconfirmed'};
  x.ctx.chatDigestPendingSync=()=>x.session.digestLastSync.status==='pending'?pending:null;
  let uploads=0;x.ctx.chatSyncTrimmedHistoryToGateway=async()=>{uploads++;return true};
  x.ctx.chatSyncNightlyDigest=async(c,o)=>{
    x.reads.push(o);x.ctx.chatNightlyStatus[x.session.id]={snapshot:{server_trim:{id:'server-result'}}};
    x.session.digestServerTrim={id:'server-result'};x.session.digestLastSync={id:'server-result',scope:x.cfg.scope,rounds:412,status:'synced'};
    delete x.session.digestManualTrim;delete x.session.digestModelRun;return true;
  };
  assert.equal(await x.ctx.chatDigestSyncNow(),true);assert.equal(x.reads.length,1);
  assert.equal(x.reads[0].readOnly,true);assert.equal(x.reads[0].force,true);
  assert.equal(uploads,0);assert.equal(x.cuts.length,0);assert.equal(x.session.digestLastSync.rounds,412);
});
test('a failed receipt read cannot upload an old pending history snapshot',async()=>{
  const x=setup();x.ctx.chatDigestPendingSync=()=>({id:'old-sync',rounds:0,status:'pending'});
  let uploads=0;x.ctx.chatSyncTrimmedHistoryToGateway=async()=>{uploads++;return true};
  x.ctx.chatSyncNightlyDigest=async()=>false;
  assert.equal(await x.ctx.chatDigestSyncNow(),false);assert.equal(uploads,0);assert.equal(x.cuts.length,0);
});
