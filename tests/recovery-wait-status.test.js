const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
function fixture(){
  const state={};
  const ctx={chatActiveSessionId:'fixture',Date,Math,Array,Number,String,chatRecoveryProgress:state,document:{getElementById(){return null}}};
  vm.createContext(ctx);vm.runInContext(fs.readFileSync(path.join(__dirname,'../chat-recovery.js'),'utf8'),ctx);
  return ctx;
}
test('memory waiting survives a reopened page and is not described as generating a zero character reply',()=>{
  const ctx=fixture(),reply={pending:true,state:'running',phase:'waiting_background',assistant_text:'',background_wait:{purpose:'memory',started_at:Date.now()/1000-180,waited_seconds:180}};
  const text=ctx.chatRecoveryStatus(reply,'fixture-turn',false);
  assert.match(text,/等待本次记忆调用结束/);assert.match(text,/你的消息尚未发送/);assert.match(text,/已等待 180秒/);
  assert.doesNotMatch(text,/仍在生成|正文 0 字/);
});
test('summary and wake queues have their actual waiting purpose',()=>{
  const ctx=fixture();
  for(const [purpose,name] of [['digest','总结'],['wake','缓存唤醒'],['background','后台']]){
    assert.match(ctx.chatRecoveryStatus({pending:true,phase:'waiting_background',background_wait:{purpose,waited_seconds:10}},purpose,false),new RegExp('等待本次'+name+'调用结束'));
  }
});
test('legacy zero output receipts report uncertainty while model output and finalization stay distinct',()=>{
  const ctx=fixture();
  assert.match(ctx.chatRecoveryStatus({pending:true,state:'running',assistant_text:''},'old',false),/尚未返回正文/);
  assert.doesNotMatch(ctx.chatRecoveryStatus({pending:true,state:'running',assistant_text:''},'old',false),/仍在生成/);
  assert.match(ctx.chatRecoveryStatus({pending:true,phase:'generating',assistant_text:'回复'},'model',false),/仍在生成.*2 字/);
  assert.match(ctx.chatRecoveryStatus({pending:true,state:'finalizing'},'done',false),/后台正在保存/);
});
test('the wait controls close when the recovered reply completes',()=>{
  const ctx=fixture(),box={hidden:true},note={textContent:''};
  ctx.document.getElementById=id=>id==='chat-wait-actions'?box:note;
  ctx.chatUpdateWaitActions('等待本次记忆调用结束');assert.equal(box.hidden,false);
  ctx.chatUpdateWaitActions('已补收完整回复');assert.equal(box.hidden,true);
});
