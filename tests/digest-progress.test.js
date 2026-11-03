const test=require('node:test'),assert=require('node:assert/strict');
const {view}=require('../digest-progress.js');
const now=1800000000000;
function fixture(){return {local:{digestModelRun:{id:'manual-new'}},remote:{status:'running',observed_at:now/1000,model_run:{id:'manual-new',state:'running',route:{execution:'claude_code_subscription',model:'sonnet'}},progress:{run_id:'manual-new',phase:'review',started_at:now/1000-100,phase_started_at:now/1000-20,batch_started_at:now/1000-20,batch_index:2,completed_batches:1,planned_batches:3,plan_estimated:true,measured_batches:1,measured_seconds:60}},sync:{prepare:true}}}
function make(f,options={}){return view(f.local,f.remote,f.sync,{now,receivedAt:now,...options})}
test('shows real review phase, batches and a bounded estimate from completed work',()=>{
 const v=make(fixture());assert.equal(v.stage,'Claude 正在复核总结');assert.equal(v.elapsed,'1 分 40 秒');assert.match(v.batch,/第 2 批/);assert.match(v.batch,/已完成 1 批/);assert.match(v.eta,/约 /);assert(Math.abs(v.percent-100/3)<1e-9);assert.equal(v.step,1);
});
test('first batch has no made-up countdown and saved summaries are not a completed cut',()=>{
 const f=fixture();f.remote.progress.measured_batches=0;assert.match(make(f).eta,/暂未形成估算/);
 f.remote.model_run.state='succeeded';f.remote.progress.phase='saved';assert.match(make(f).stage,/等待本机接收/);assert.notEqual(make(f).eta,'已完成');
 f.sync={ready:true,status:'等待当前回复',prepare:true};assert.equal(make(f).stage,'等待当前回复结束');
});
test('quota, manual review, cancellation and errors never keep counting down',()=>{
 for(const state of ['blocked','cancelled','paused','retry']){
  const f=fixture();f.remote.model_run.state=state;f.remote.progress.finished_at=now/1000-50;f.remote.last_error='原文保留';
  const v=make(f,{now:now+50000});assert.equal(v.eta,'连接恢复后重新估算');
  const fresh=make(f,{now:now+50000,receivedAt:now+50000});assert.equal(fresh.elapsed,'50 秒');assert.equal(fresh.eta,'暂停期间不估算');assert.equal(fresh.running,false);
 }
});
test('new local run rejects old success, timing and old errors',()=>{
 const f=fixture();f.remote.model_run.id='manual-old';f.remote.model_run.state='blocked';f.remote.last_error='old failure';
 const v=make(f);assert.equal(v.stage,'正在提交手动任务');assert.equal(v.elapsed,'—');assert.equal(v.batch,'');assert.doesNotMatch(v.detail,/old failure/);
});
test('stale and failed refreshes freeze the snapshot and suspend ETA',()=>{
 const f=fixture();const first=make(f,{now:now+31000});const later=make(f,{now:now+90000});
 assert.equal(first.elapsed,later.elapsed);assert.match(first.stage,/上次状态/);assert.equal(first.eta,'连接恢复后重新估算');
 assert.equal(make(f,{refreshFailed:true}).eta,'连接恢复后重新估算');
});
test('estimated range expires into honest waiting and never a false zero',()=>{
 const f=fixture();f.remote.progress.batch_started_at=now/1000-1000;
 assert.equal(make(f).eta,'已超出本轮估算，仍在处理');
});
test('actual synchronization completes the final step and freezes elapsed time',()=>{
 const f=fixture();f.remote.model_run.state='succeeded';f.remote.progress.phase='saved';f.remote.progress.finished_at=now/1000-10;
 f.sync={status:'同步完成',prepare:false};const v=make(f);assert.equal(v.stage,'截断并同步完成');assert.equal(v.eta,'已完成');assert.equal(v.step,4);assert.equal(v.elapsed,'1 分 30 秒');
});
test('server observation handles skewed device clocks; reused work is identified',()=>{
 const f=fixture();f.remote.progress.reused_batches=1;f.remote.progress.measured_batches=0;
 const v=make(f,{now:now+600000,receivedAt:now+600000});assert.equal(v.elapsed,'1 分 40 秒');assert.match(v.batch,/复用 1 批/);assert.match(v.eta,/暂未形成估算/);
});
