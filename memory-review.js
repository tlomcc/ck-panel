/* Automatic topic decisions and optional, durable review opinions. */
(function(){
  'use strict';
  var active=null;
  function escape(value){return esc(String(value==null?'':value))}
  function attr(value){return escAttr(String(value==null?'':value))}
  function button(action,label,extra){return '<button type="button" class="btn btn-outline btn-sm" data-mr="'+action+'" '+(extra||'')+'>'+escape(label)+'</button>'}
  function copy(value){return JSON.parse(JSON.stringify(value))}
  function rid(){return 'review_'+(crypto.randomUUID?crypto.randomUUID():Date.now().toString(36)+Math.random().toString(36).slice(2))}
  window.memoryReviewMount=function(hooks){
    if(active&&active.dispose)active.dispose();
    var root=document.getElementById('mw-organizer');
    // This host lives on Status and survives rebuilding the topic page.
    // Replace it on remount so an old principal cannot retain event handlers.
    var cleanRoot=root.cloneNode(false);root.replaceWith(cleanRoot);root=cleanRoot;
    var refreshTimer=null;
    var state={data:null,topics:[],tab:'pending',drafts:{},settingsDraft:null,settingsOpen:false,busy:false,request:null,message:''};
    var instance={update:update,hasDraft:function(){return !!state.settingsDraft||Object.keys(state.drafts).length>0},dispose:function(){clearTimeout(refreshTimer)}};
    active=instance;
    function initialDraft(p){return {opinion:p.opinion||'',target:p.target_topic_id||'',title:p.title,rename_to:p.rename_to||'',ids:p.fact_ids.slice(),move:false}}
    function draft(p){return state.drafts[p.id]||(state.drafts[p.id]=initialDraft(p))}
    function status(text){state.message=text;var node=root.querySelector('[data-mr-status]');if(node)node.textContent=text}
    function card(p){
      var d=state.drafts[p.id]||initialDraft(p),grouping=p.kind==='group',renaming=p.kind==='rename'||grouping;
      var target=state.topics.find(function(t){return t.id===d.target});
      return '<article class="mr-proposal" data-proposal="'+attr(p.id)+'"><div class="mw-editor-head"><h3>'+(grouping?'这个小主题应归入哪个大主题？':renaming?'是否按意见调整主题名称？':d.target?'是否将这些材料加入主题？':'是否用这些材料新建主题？')+'</h3><span class="mr-badge">'+(p.status==='deferred'?'已暂缓':'待审批')+' · '+(grouping?'大主题归属':renaming?'调整名称':p.fact_ids.length+' 份待加入材料')+'</span></div>'+
        '<p><strong>'+(d.target?'目标主题：':'拟建主题：')+'</strong>'+escape(target?(target.group_title?target.group_title+' / ':'')+target.title:d.target?(p.target_title||p.title):d.title)+'</p>'+
        (d.target&&!grouping?'<label class="mr-rename"><strong>'+(renaming?'调整后的名称':'同时调整名称（留空则保留原名）')+'</strong><input data-mr-field="rename_to" maxlength="80" value="'+attr(d.rename_to)+'" placeholder="结合前后经历重新拟名"></label>':'')+
        (p.group_title?'<p><strong>所属大主题：</strong>'+escape(p.group_title)+'</p>':'')+'<p><strong>建议理由：</strong>'+escape(p.reason)+'</p>'+(p.stale?'<p class="mw-cost">材料或主题已有更新，建议保留意见后重新判断。</p>':'')+
        '<h4>需要你判断的疑点</h4>'+
        (p.uncertainties||[]).map(function(x){return '<p class="mr-doubt">'+escape(x)+'</p>'}).join('')+
        (renaming?'<p class="mw-note">'+(grouping?'本次只调整目录归属，已有材料无需重新审批。':'本次只调整名称，已有材料作为命名依据。')+'</p>':'<div class="mr-materials"><h4>待加入材料（尚未加入目标主题）</h4>'+(p.materials||[]).map(function(m){return '<label class="mr-material"><input type="checkbox" data-mr-field="pick" value="'+attr(m.fact_id)+'" '+(d.ids.indexOf(m.fact_id)>=0?'checked':'')+(m.missing?' disabled':'')+'><span><small>'+escape(m.time||'日期未记录')+'</small><span class="mr-fact-text">'+escape(m.text)+'</span>'+
          ((m.current_topics||[]).length?'<small>当前主题：'+escape(m.current_topics.map(function(id){var t=state.topics.find(function(x){return x.id===id});return t?t.title:'主题已变化'}).join('、'))+'</small>':'')+'</span></label>'+button('fact','查看原文与历史','data-id="'+attr(m.fact_id)+'"')}).join('')+
          '</div>')+(d.target?'<details class="mr-reference"><summary>目标主题已有材料（仅供对照，无需审批）</summary>'+((target?target.materials:p.target_materials)||[]).slice(0,5).map(function(m){return '<p><small>'+escape(m.time||'日期未记录')+'</small></p><blockquote>'+escape(m.text||'')+'</blockquote>'}).join('')+'</details>':'')+
        '<details><summary>模型引用依据</summary>'+(p.evidence||[]).map(function(e){return '<blockquote>'+escape(e.quote)+'</blockquote>'}).join('')+'</details>'+
        (renaming?'':'<details class="mr-adjust"><summary>调整目标或材料</summary><label>归入主题<select data-mr-field="target"><option value="" '+(!d.target?'selected':'')+'>新建主题</option>'+state.topics.map(function(t){return '<option value="'+attr(t.id)+'" '+(t.id===d.target?'selected':'')+'>'+escape((t.group_title?t.group_title+' / ':'')+t.title)+'</option>'}).join('')+'</select></label>'+
        (!d.target?'<label>新主题名称<input data-mr-field="title" maxlength="80" value="'+attr(d.title)+'"></label>':'')+'<label class="mw-check"><input type="checkbox" data-mr-field="move" '+(d.move?'checked':'')+'>同时从其他主题移出所选材料</label><p class="mw-note">在上方勾选本次要加入的材料；移出关系会被记住。</p></details>')+
        '<label for="opinion-'+attr(p.id)+'">处理意见（选填）</label><textarea id="opinion-'+attr(p.id)+'" data-mr-field="opinion" maxlength="2000" rows="3" placeholder="例如：可以加入，但请结合前因后果重拟主题名。保存意见并重新判断可先调整方案；同意时附带的意见也会安排后续整理。">'+escape(d.opinion)+'</textarea>'+
        '<div class="mw-toolbar">'+button('approve',grouping?'采用大主题归属':renaming?'采用新名称':d.target?(d.rename_to.trim()?'加入材料并更新名称':'加入所选材料'):'新建主题并加入')+button('recheck','保存意见并重新判断')+button('defer','暂缓')+button('reject',grouping?'不采用此归属':renaming?'不采用此名称':'不加入')+'</div></article>';
    }
    function render(){
      if(active!==instance||!root.isConnected)return;
      var o=state.data;if(!o){root.innerHTML='';return}
      var settings=Object.assign({},o.settings,state.settingsDraft||{}),details=root.querySelector('.mr-settings');
      if(details)state.settingsOpen=details.open;
      var progress=o.progress||{},usage=o.usage||{},last=o.last_run||{};
      var statusNames={ok:'本轮已完成',running:'正在整理',needs_model:'等待配置主题 API',retry:'稍后重试',changed:'将按最新意见重新判断',queued:'正在启动',paused:'已暂停',daily_limit:'今天的调用额度已用完',review_limit:'请先处理待审批方案',up_to_date:'当前材料已检查完毕'};
      var disabled=state.busy?' disabled':'';
      root.innerHTML='<section class="mw-card mr-organizer"><div class="mw-editor-head"><h3>自动整理</h3><span class="mr-badge">'+(o.settings.enabled?'已开启':'已暂停')+'</span></div>'+
        '<fieldset class="mr-run-controls"'+disabled+'><div class="mw-toolbar"><button type="button" class="btn btn-blue btn-sm" data-mr="start" '+(o.running||last.status==='queued'?'disabled':'')+'>'+(o.running?'正在整理…':last.status==='queued'?'正在启动…':'立即开始')+'</button>'+button('pause','暂停',!o.settings.enabled&&!o.running?'disabled':'')+'</div></fieldset>'+
        '<p>已检查 '+(progress.checked||0)+' / '+(progress.total||0)+' 份有效材料 · '+o.pending_count+' 项待审批</p>'+
        '<p class="mw-note">主题仅收录当前有效材料，排除过期和被替代的版本。明确的续接和目录归类自动完成；归属有歧义、需要改名或调整已确认关系时再审批。</p>'+
        '<p class="mw-note">'+escape(statusNames[last.status]||'等待下一轮整理')+(last.message?' · '+escape(last.message):'')+(usage.date?' · '+escape(usage.date)+' 已使用 '+usage.calls+' 次模型调用':'')+'</p>'+
        '<details class="mr-settings"'+(state.settingsOpen?' open':'')+'><summary>整理设置与调用预算</summary><fieldset'+disabled+'><label class="mw-check"><input id="mr-enabled" type="checkbox" '+(settings.enabled?'checked':'')+'>自动整理已有和新增材料</label><div class="mr-settings-grid"><label>每日模型调用上限（1–1000）<input id="mr-daily" type="number" min="1" max="1000" step="1" value="'+attr(settings.daily_calls)+'"></label><label>每批检查材料数（2–12）<input id="mr-batch" type="number" min="2" max="12" step="1" value="'+attr(settings.batch_size)+'"></label></div><p class="mw-note">使用主题 API 的模型，后台分批运行；不占用聊天生成。暂时找不到关联的材料会保留，等待新线索。</p><div class="mw-toolbar">'+button('settings','保存设置')+button('api','主题 API')+button('rescan','重新检查历史材料')+'</div></fieldset></details>'+
        '<div class="mw-toolbar mr-tabs" role="group" aria-label="整理记录">'+button('tab-pending','待审批 '+o.pending_count,'aria-pressed="'+(state.tab==='pending')+'"')+button('tab-automatic','自动处理记录','aria-pressed="'+(state.tab==='automatic')+'"')+button('tab-opinions','处理意见','aria-pressed="'+(state.tab==='opinions')+'"')+button('refresh','刷新进度')+'</div>'+
        '<p data-mr-status class="mw-note" role="status">'+escape(state.message||'意见可以留空；填写后会随处理结果保存，并供后续整理参考。')+'</p><fieldset class="mr-content"'+disabled+'>'+
        (state.tab==='pending'?(o.pending.length?o.pending.map(card).join(''):'<p class="mw-empty">暂无待审批方案。确定的归组会自动处理。</p>'):
         state.tab==='automatic'?(o.operations.filter(function(op){return op.origin==='automatic'}).map(function(op){return '<article class="mr-operation" data-operation="'+attr(op.id)+'"><h3>'+escape(op.title)+' · '+(op.kind==='group'?'归入大主题 '+op.group_title:op.created?'新建小主题':'追加材料')+'</h3><p>'+escape(op.reason)+'</p><small>'+escape(op.at)+' · '+op.fact_ids.length+' 份材料'+(op.status==='undone'?' · 已撤销':'')+'</small><details><summary>查看引用依据</summary>'+(op.evidence||[]).map(function(e){return '<blockquote>'+escape(e.quote)+'</blockquote>'}).join('')+'</details>'+(op.status==='applied'?'<label>撤销意见（选填）<textarea data-mr-undo-opinion maxlength="2000" rows="2" placeholder="写下原因，下次整理相关材料时会参考。"></textarea></label>'+button('undo','撤销这次自动处理'):'')+'</article>'}).join('')||'<p class="mw-empty">还没有自动处理记录。</p>'):
         (o.decisions.filter(function(d){return d.opinion}).map(function(d){var labels={approve:'同意',reject:'拒绝',defer:'暂缓',recheck:'重新判断',undo:'撤销'};return '<article class="mr-operation"><h3>'+escape(d.title||'主题整理')+' · '+escape(labels[d.decision]||d.decision)+'</h3><p class="mr-opinion">'+escape(d.opinion)+'</p><small>'+escape(d.at)+'</small></article>'}).join('')||'<p class="mw-empty">已填写的处理意见会保存在这里，后续整理相关材料时会先参考。</p>'))+'</fieldset></section>';
    }
    function update(data){
      if(active!==instance)return;
      state.data=data.organizer||null;state.topics=data.topics||[];
      if(state.data){var pending=new Set(state.data.pending.map(function(p){return p.id}));Object.keys(state.drafts).forEach(function(id){if(!pending.has(id))delete state.drafts[id]})}
      render();
      scheduleRefresh();
    }
    function scheduleRefresh(){
      clearTimeout(refreshTimer);
      if(active!==instance||!state.data||!state.data.settings.enabled)return;
      var delay=state.data.running||state.data.last_run&&state.data.last_run.status==='queued'?10000:30000;
      refreshTimer=setTimeout(async function(){
        if(active!==instance||!root.isConnected)return;
        var focused=document.activeElement;
        var editing=root.contains(focused)&&/^(INPUT|TEXTAREA|SELECT)$/.test(focused.tagName);
        var controls=root.closest('details'),pane=root.closest('[role="tabpanel"]');
        if(!state.busy&&hooks.canWrite()&&root.closest('.panel-tab').classList.contains('active')&&(!controls||controls.open)&&(!pane||!pane.hidden)&&document.visibilityState==='visible'&&
            !editing&&!instance.hasDraft())await refresh(true);
        scheduleRefresh();
      },delay);
    }
    root.addEventListener('input',function(e){
      var node=e.target;if(!state.data)return;
      var settingField={'mr-enabled':'enabled','mr-daily':'daily_calls','mr-batch':'batch_size'}[node.id];
      if(settingField){
        state.settingsDraft=state.settingsDraft||{};
        state.settingsDraft[settingField]=settingField==='enabled'?node.checked:node.value;
        state.request=null;status('设置已修改，点击“保存设置”后生效。');return;
      }
      var container=node.closest('[data-proposal]');if(!container)return;
      var p=state.data.pending.find(function(x){return x.id===container.dataset.proposal});if(!p)return;
      var d=draft(p),field=node.dataset.mrField;
      if(field==='pick')d.ids=Array.from(container.querySelectorAll('[data-mr-field="pick"]:checked')).map(function(n){return n.value});
      else if(field==='move')d.move=node.checked;else if(field)d[field]=node.value;
      state.request=null;
      if(field==='target'){d.rename_to='';render()}
      if(field==='rename_to'&&p.kind!=='rename'){var approve=container.querySelector('[data-mr="approve"]');if(approve)approve.textContent=d.rename_to.trim()?'加入材料并更新名称':'加入所选材料'}
    });
    async function submit(body,clearId){
      if(!hooks.canWrite()){status('请先保存或处理主题编辑区的草稿，再提交审批。');return}
      var unsigned=JSON.stringify(body);
      if(!state.request||state.request.unsigned!==unsigned)state.request={unsigned:unsigned,body:Object.assign({},body,{request_id:rid(),expected_revision:hooks.revision()})};
      state.busy=true;root.querySelectorAll('.mr-content,.mr-settings fieldset,.mr-run-controls').forEach(function(n){n.disabled=true});status('正在保存…');
      try{
        var data=await hooks.request(state.request.body);
        if(active!==instance)return;
        if(clearId)delete state.drafts[clearId];state.request=null;
        if(body.action==='organizer_settings')state.settingsDraft=null;
        state.message=body.action==='organizer_settings'?'设置已保存：每日最多 '+data.organizer.settings.daily_calls+' 次，每批 '+data.organizer.settings.batch_size+' 份。':body.action==='organizer_pause'?'已暂停，已完成的主题和处理意见保留。':body.action==='organizer_start'?
          (data.organizer.trigger==='requested'?'已请求立即开始，进度会自动更新。':data.organizer.trigger==='scheduled'?'已开启，后台会在下一次调度时开始。':data.organizer.running?'已有一轮正在整理。':data.organizer.last_run.message||'已提交开始请求。'):
          '已保存。后续整理会参考你的处理结果和意见。';
        hooks.apply(data);
      }catch(e){
        if(active!==instance)return;
        status(e.message+(body.action==='organizer_settings'?' 设置未保存成功，输入已保留。':' 意见和选择已保留。'));
        if(e.status===409){state.request=null;await refresh(true)}
      }finally{if(active===instance){state.busy=false;root.querySelectorAll('.mr-content,.mr-settings fieldset,.mr-run-controls').forEach(function(n){n.disabled=false})}}
    }
    async function refresh(preserveMessage){
      if(!hooks.canWrite()){status('请先保存主题编辑区的草稿。');return}
      try{var data=await hooks.read();if(active!==instance)return;if(!preserveMessage)state.message='已刷新，未提交的意见仍保留。';hooks.apply(data)}catch(e){if(active===instance)status(e.message)}
    }
    root.addEventListener('click',async function(e){
      var b=e.target.closest('[data-mr]');if(!b||b.disabled||state.busy)return;
      var action=b.dataset.mr;
      if(action==='fact'){openFactDetail(b.dataset.id);return}
      if(action==='api'){navTo('apiconfig');switchApiTab('topics');return}
      if(action.indexOf('tab-')===0){state.tab=action.slice(4);render();return}
      if(action==='refresh'){await refresh(false);return}
      if(action==='start'||action==='pause'){await submit({action:'organizer_'+action});return}
      if(action==='settings'){
        var inputs=[root.querySelector('#mr-daily'),root.querySelector('#mr-batch')];
        if(inputs.some(function(n){return !n.value||!n.checkValidity()})){status('设置未保存：每日调用需1–1000的整数，每批需2–12的整数。');return}
        await submit({action:'organizer_settings',settings:{enabled:root.querySelector('#mr-enabled').checked,daily_calls:Number(root.querySelector('#mr-daily').value),batch_size:Number(root.querySelector('#mr-batch').value)}});return;
      }
      if(action==='rescan'){
        if(await ckConfirmDialog('将按现有主题和处理意见，分批重新检查历史材料，仍受每日调用预算限制。',{title:'重新检查历史材料',confirmText:'加入检查队列'}))await submit({action:'organizer_recheck'});return;
      }
      if(action==='undo'){
        var op=b.closest('[data-operation]');
        await submit({action:'organizer_undo',operation_id:op.dataset.operation,opinion:op.querySelector('[data-mr-undo-opinion]').value});return;
      }
      var container=b.closest('[data-proposal]');if(!container)return;
      var p=state.data.pending.find(function(x){return x.id===container.dataset.proposal});if(!p)return;
      var d=draft(p),body={action:'organizer_review',proposal_id:p.id,decision:action,opinion:d.opinion};
      if(action==='approve'){
        if(p.kind==='rename'&&!d.rename_to.trim()){status('请填写新名称，或选择不采用此名称。');return}
        body.fact_ids=d.ids;body.target_topic_id=d.target;body.title=d.title;body.move=d.move;body.rename_to=d.rename_to;
      }
      await submit(body,p.id);
    });
    render();return instance;
  };
})();
