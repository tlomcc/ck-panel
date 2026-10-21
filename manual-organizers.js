/* Explicit subscription organizers; reading status never starts a run. */
(function(){
  var state={},busy={},timers={},identity={},errors={};
  function node(kind,suffix){return document.getElementById('manual-'+kind+'-'+suffix)}
  function cfgKey(kind){return kind==='fact'?'factManualModel':'eventManualModel'}
  function principal(){return GRAPH_API_BASE+'|'+storedPanelKey()}
  function render(kind){
    var data=state[kind],value=kind==='events'?data&&data.control:data,run=value&&value.model_run||{};
    var mode=node(kind,'mode');if(!mode)return;
    mode.checked=!!(value&&value.manual_model);mode.disabled=!!busy[kind]||!value;
    var input=node(kind,'model'),cfg=chatLoadConfig();
    if(input&&document.activeElement!==input)input.value=typeof cfg[cfgKey(kind)]==='string'?cfg[cfgKey(kind)]:(run.model||'sonnet');
    var active=['queued','running'].includes(run.state);
    node(kind,'run').disabled=!!busy[kind]||!value||!value.manual_model||active;
    node(kind,'stop').disabled=!!busy[kind]||!active;
    var names={queued:'已排队，等待本机工作进程',running:'正在整理',succeeded:'本次整理完成',cancelled:'已手动停止，进度保留',blocked:'已停止，等待手动处理'};
    var lines=[value&&value.manual_model?'订阅仅手动；5 小时剩余额度低于 50% 或无法确认时停止。':'原自动模式；开启上方开关后改为订阅仅手动。'];
    if(run.id)lines.push((names[run.state]||run.state)+(run.day?' · '+run.day:'')+(run.model?' · '+run.model:''));
    if(run.state==='succeeded'&&kind==='events'&&run.groups===0)lines.push('没有可处理的新增材料；受限、失败和旧资料仍保留待人工复核。');
    if(run.stage)lines.push('已保存阶段：'+run.stage);
    if(run.quota&&typeof run.quota.remaining_percent==='number')lines.push('最近确认 5 小时剩余 '+run.quota.remaining_percent+'%');
    if(run.error)lines.push(run.error);
    if(errors[kind])lines.push(errors[kind]);
    node(kind,'status').textContent=lines.join('\n');
  }
  async function request(kind,body){
    var who=principal(),path=kind==='fact'?'/ck/fact-control':'/ck/event-automation';
    var controller=new AbortController(),timer=setTimeout(function(){controller.abort()},12000);
    try{
      var response=await panelDataFetch(function(){if(principal()!==who)throw Error('连接已变化');return GRAPH_API_BASE+path},
        Object.assign({cache:'no-store',signal:controller.signal},body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{}),{label:'手动订阅整理'});
      var data=await response.json();if(!response.ok||data.ok===false)throw Error(data.error||'读取未完成');
      if(principal()!==who)return false;
      state[kind]=data;identity[kind]=who;if(body)errors[kind]='';render(kind);return true;
    }catch(error){if(principal()===who){errors[kind]=(body?'操作状态尚未确认，请先刷新查看；不会自动重新启动。':'状态读取未完成。')+' '+error.message;render(kind)}return false;}
    finally{clearTimeout(timer)}
  }
  window.ckManualOrganizerRefresh=async function(kind){
    if(!node(kind,'mode')||busy[kind])return;
    if(identity[kind]!==principal()){state[kind]=null;errors[kind]='';render(kind)}
    await request(kind);clearTimeout(timers[kind]);
    if(currentPanelTab==='status'&&ckStatusTab===kind)timers[kind]=setTimeout(function(){ckManualOrganizerRefresh(kind)},3000);
  };
  window.ckManualOrganizerSave=function(kind,value){var cfg=chatLoadConfig();cfg[cfgKey(kind)]=String(value).trim();chatSaveConfigObject(cfg)};
  window.ckManualOrganizerAction=async function(kind,action){
    if(busy[kind])return false;
    var body={action:action},model=node(kind,'model').value.trim();
    if(action==='model_mode')body.enabled=node(kind,'mode').checked;
    if(action==='run_model'){
      if(!/^(sonnet|opus|haiku|claude-[a-zA-Z0-9._-]{1,100})$/.test(model)){toast('请填官方完整 Claude 模型 ID，或 sonnet、opus、haiku');return false;}
      body.id='manual-'+kind+'-'+Date.now()+'-'+Math.random().toString(36).slice(2,10);body.model=model;
      if(kind==='fact'){body.day=node(kind,'day').value;if(!/^\d{4}-\d{2}-\d{2}$/.test(body.day)){toast('请选择要整理的一个日期');return false;}}
      ckManualOrganizerSave(kind,model);
    }
    busy[kind]=true;render(kind);
    try{return await request(kind,body)}finally{busy[kind]=false;render(kind);ckManualOrganizerRefresh(kind);if(typeof ckOrganizingEnter==='function')ckOrganizingEnter()}
  };
  ['fact','events'].forEach(function(kind){
    var day=node(kind,'day');if(day){var now=Date.now()+8*3600000;day.max=new Date(now).toISOString().slice(0,10);day.value=new Date(now-86400000).toISOString().slice(0,10)}
    render(kind);
  });
})();
