/* Read-only view of durable digest progress. No timers, requests or chat writes. */
(function(root){
  'use strict';
  function number(value){return Number.isFinite(Number(value))?Math.max(0,Number(value)):0}
  function duration(seconds){
    var n=Math.floor(number(seconds)),h=Math.floor(n/3600),m=Math.floor(n%3600/60),s=n%60;
    return (h?h+' 小时 ':'')+(m?m+' 分 ':'')+s+' 秒';
  }
  function rough(seconds){
    seconds=number(seconds);
    if(seconds<60)return Math.max(10,Math.ceil(seconds/10)*10)+' 秒';
    if(seconds<3600)return Math.ceil(seconds/60)+' 分钟';
    return (Math.ceil(seconds/360)/10)+' 小时';
  }
  var phases={preparing:'准备本批材料',checking:'核对执行条件',draft:'Claude 正在生成总结',
    review:'Claude 正在复核总结',rewrite:'Claude 正在修订总结',validating:'校验本批结果',
    reusing:'复用已保存的结果',batch_saved:'本批已保存',saved:'总结已保存'};
  function view(local,remote,sync,options){
    local=local||{};remote=remote||{};sync=sync||{};options=options||{};
    var now=options.now==null?Date.now():options.now,received=options.receivedAt||now;
    var stale=!!options.refreshFailed||now-received>30000;
    var serverNow=number(remote.observed_at)||received/1000;
    if(!stale)serverNow+=Math.max(0,now-received)/1000;
    var run=remote.model_run||{},p=remote.progress||{},req=local.digestManualTrim||{},localRun=local.digestModelRun||{};
    // A newly submitted run must never inherit an older run's result or timer.
    var awaiting=!!(localRun.id&&run.id!==localRun.id);
    if(awaiting){run={state:'queued'};p={};}
    if(p.run_id&&run.id&&p.run_id!==run.id)p={};
    var state=run.state||remote.status||'',phase=p.phase||'',running=state==='running',queued=state==='queued';
    var stopped=['blocked','retry','paused','cancelled','manual_only'].includes(state)||(!awaiting&&remote.enabled===false);
    var started=number(p.started_at),finished=number(p.finished_at);
    var waitingAt=number(run.requested_at)||number(req.requestedAt)/1000;
    var complete=sync.status==='同步完成'&&!sync.prepare&&!running&&!queued;
    var v={title:'截断进度',stage:'尚未开始',detail:'手动开始后，这里会显示执行阶段和等待时间。',
      step:-1,tone:'neutral',running:running||queued,stale:stale,elapsed:'—',elapsedLabel:'已用时',
      eta:'开始后估算',etaNote:'',batch:'',percent:null,model:'',phase:phase};
    var labels=['准备材料','总结与记忆维护','确认保存','截断同步'];v.steps=labels;
    var execution=run.route&&run.route.execution;
    v.model=awaiting?(localRun.label||'所选整理模型'):
      [execution==='claude_code_subscription'?'Claude 订阅':execution?'当前聊天线路':'',run.route&&run.route.model].filter(Boolean).join(' · ');
    var memoryPending=!!p.memory_pending||remote.stage==='cycle_memory';
    if(memoryPending&&run.memory_route)v.model='小克正常聊天模型 · '+run.memory_route.model;
    if(complete){v.stage='截断并同步完成';v.step=4;v.tone='success';v.detail=sync.note||'下一条消息使用当前总结。';v.eta='已完成';v.elapsedLabel='本次用时';}
    else if(stopped&&!sync.ready){
      v.stage=remote.enabled===false?'总结已暂停':sync.tone==='attention'?sync.status:
        state==='retry'?'等待后台重试':['cancelled','manual_only'].includes(state)?'已停止':'等待手动处理';
      v.detail=remote.last_error||sync.note||'原文与已保存的进度仍保留。';
      v.tone='attention';v.running=false;v.eta='暂停期间不估算';v.elapsedLabel='停止前用时';
      v.step=phase==='saved'?2:phase?1:0;
      var wait=remote.quota_wait||{};
      if(wait.state==='waiting_reset'&&wait.run_id===run.id&&remote.enabled!==false){
        v.stage='等待额度刷新后自动继续';v.eta='等待官方刷新确认';
        v.detail=memoryPending?'总结已保留，等待小克维护记忆；完成前不截断。':'原文与成功批次已保留，刷新确认后从断点继续。';
        if(wait.reset_at)v.detail+=' 官方预计刷新：'+new Date(wait.reset_at*1000).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false})+'（北京时间）。';
      }
    }else if(sync.ready||state==='succeeded'||phase==='saved'){
      v.step=3;v.stage=sync.status==='等待当前回复'?'等待当前回复结束':sync.ready?'总结就绪，等待截断同步':'总结已保存，等待本机接收';
      v.detail=sync.note||'总结准备完成后才会截断原对话。';v.eta=sync.status==='等待当前回复'?'当前回复结束后继续':'等待本机完成同步';v.elapsedLabel='总结用时';v.running=false;
    }else if(running){
      v.step=1;v.tone='live';v.stage=phases[phase]||'正在整理总结';
      if(phase==='preparing'&&!p.batch_index){v.step=0;v.stage='正在准备材料';}
      if(execution&&execution!=='claude_code_subscription')v.stage=v.stage.replace('Claude','模型');
      v.detail=remote.stage==='cycle_final'?'正在核对本次总结与上一份简版；主动记忆由小克单独维护。':'正在整理本次选中的新增对话。';
      if(memoryPending){v.stage=phase==='review'?'小克正在复核记忆':'小克正在维护记忆';v.detail='使用正常聊天模型；记忆确认完成并保存后，才允许截断。';}
      if(p.day)v.detail+=' 处理日期 '+p.day+'。';
      v.eta='首批计时中，暂未形成估算';
      v.etaNote='每次模型请求最多等待 '+(execution==='claude_code_subscription'?'6':'3')+' 分钟；整批还包含复核。';
    }else if(queued||sync.prepare||localRun.id){
      v.step=0;v.stage=awaiting?'正在提交手动任务':'等待后台开始';v.detail='后台确认开始后会显示生成和复核进度。';v.eta='开始处理后估算';v.elapsedLabel='已等待';
    }
    var elapsedStart=stopped&&!finished?0:started||waitingAt;
    if(elapsedStart){
      var end=finished||serverNow;
      v.elapsed=duration(Math.max(0,end-elapsedStart));
    }
    var done=number(p.completed_batches),total=number(p.planned_batches),reused=number(p.reused_batches);
    if(total||p.batch_index||done||(!awaiting&&remote.checkpoint_batches)){
      v.batch=(running&&p.batch_index?'正在处理第 '+number(p.batch_index)+' 批 · ':'')+'已完成 '+done+' 批';
      if(total)v.batch+=' / '+(p.plan_estimated?'计划约 ':'共 ')+total+' 批';
      if(reused)v.batch+='（复用 '+reused+' 批）';
      if(!done&&number(remote.checkpoint_batches))v.batch+='；已有 '+number(remote.checkpoint_batches)+' 批成功断点';
      if(total)v.percent=Math.min(100,done/total*100);
    }
    var samples=number(p.measured_batches),spent=number(p.measured_seconds);
    if(running&&samples&&spent&&total>done){
      var average=spent/samples,remaining=total-done;
      var inBatch=p.batch_started_at?Math.max(0,serverNow-number(p.batch_started_at)):0;
      var low=average*remaining*.65-inBatch,high=average*remaining*1.8-inBatch;
      if(high<=0){v.eta='已超出本轮估算，仍在处理';v.etaNote='等待下一批完成后更新，未将等待超时当作成功。';}
      else{var a=rough(Math.max(10,low)),b=rough(Math.max(10,high));v.eta='约 '+a+(a===b?'':'–'+b);v.etaNote='按本次已完成 '+samples+' 批耗时估算；新增批次或复核会延长。';}
    }else if(running&&total&&done>=total){v.eta=memoryPending?'等待记忆维护完成':'批次已完成，等待最终保存';v.etaNote='记忆未完成或保存失败时，不会截断。';}
    if(stale){v.stage='上次状态：'+v.stage;v.tone='attention';v.eta='连接恢复后重新估算';v.etaNote='状态更新中断，保留最后一次读到的进度。';v.running=false;}
    return v;
  }
  root.CKDigestProgress={view:view,duration:duration};
  if(typeof module==='object'&&module.exports)module.exports=root.CKDigestProgress;
})(typeof window!=='undefined'?window:globalThis);
