(function () {
  'use strict';
  var root, config, windows = [], selected = '', cursor = 0, items = new Map(), tab = 'tasks';
  var timer = 0, loading = false, generation = 0, previousFocus, formDirty = false, busy = false, messageTimer = 0, questionIndex = -1;
  var refreshController = null, windowCache = new Map(), statusTimer = 0, statusController = null, statusPending = null, confirmedAt = new Map(), windowListSignature = '', viewportFrame = 0, pageScroll = 0;
  var endpoint = localStorage.getItem('ck_codex_endpoint') || 'https://tlomcc.cc.cd:18443/codex';
  var access = '', accessReady;
  var draftOwner = '', schedules = [];
  var userJump = null;
  function loadAccess(){if(!accessReady)accessReady=CKCodexStorage.load().then(function(value){access=value;}).catch(function(){message('无法读取加密连接密钥，请重新填写。',true);});return accessReady;}
  var labels = {idle:'等待任务',opening:'正在创建',queued:'排队中',starting:'正在启动',running:'正常运行',waiting:'等待你回复',completed:'已完成',interrupted:'已停止',failed:'运行异常',closed:'已关闭'};
  var $ = function (id) { return document.getElementById('cx-'+id); };
  function node(tag, cls, text) { var n=document.createElement(tag); if(cls)n.className=cls; if(text!==undefined)n.textContent=text; return n; }
  function button(text, fn, cls) { var b=node('button','btn btn-sm '+(cls||'btn-outline'),text); b.type='button'; b.onclick=fn; return b; }
  function uid() { return crypto.randomUUID ? crypto.randomUUID() : 'cx-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2); }
  function current() { return windows.find(function(w){return w.id===selected;}); }
  function opened() { return root && !root.hidden; }
  function message(text, bad, source) { clearTimeout(messageTimer);$('message').textContent=text||''; $('message').dataset.source=source||'';$('message').classList.toggle('cx-error',!!bad);if(text&&!bad)messageTimer=setTimeout(function(){$('message').textContent='';},4000); }
  function stamp(ts) { return new Date(ts*1000).toLocaleString('zh-CN',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'}); }
  function draftKey(id) { return 'ck_codex_draft_'+id; }
  function saveDraft(){
    if(!selected||draftOwner!==selected)return;
    try{
      localStorage.setItem(draftKey(selected),$('input').value);
      localStorage.setItem(draftKey(selected)+'_time',$('schedule-time').value);
      $('draft-status').textContent=$('input').value||$('schedule-time').value?'草稿已自动保存':'';
    }catch(_){$('draft-status').textContent='草稿保存失败，请保留此页面并复制内容。';}
  }
  function restoreDraft(id){
    draftOwner=id;
    $('input').value=id?localStorage.getItem(draftKey(id))||'':'';
    $('schedule-time').value=id?localStorage.getItem(draftKey(id)+'_time')||'':'';
    $('draft-status').textContent=$('input').value||$('schedule-time').value?'已恢复草稿':'';
    resizeInput();
  }
  function removeDraft(id){
    localStorage.removeItem(draftKey(id));localStorage.removeItem(draftKey(id)+'_time');
    localStorage.removeItem('ck_codex_pending_'+id);sessionStorage.removeItem('ck_codex_pending_'+id);
  }
  function scheduleStamp(ts){return new Date(ts*1000).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false});}
  async function cancelSchedule(s){
    if(!selected||busy)return;
    var id=selected;busy=true;renderToolbar();
    try{
      try{await request('/threads/'+id+'/cancel-schedule',{request_id:s.request_id});}
      catch(e){
        // A lost response can still mean the server cancelled it. Only restore after confirmation.
        if(e.status)throw e;
        var snapshot=await request('/threads/'+id);
        if(!(snapshot.schedules||[]).some(function(row){return row.request_id===s.request_id&&row.state==='cancelled';}))throw e;
      }
      cancelRefresh();
      var active=selected===id&&draftOwner===id;
      var draft=active?$('input').value:localStorage.getItem(draftKey(id))||'';
      var restored=draft&&draft.trim()!==s.text?draft+'\n\n'+s.text:draft||s.text;
      // Do not reuse a cancelled schedule's id when its original submit response was lost.
      [localStorage,sessionStorage].forEach(function(storage){
        var key='ck_codex_pending_'+id,pending;try{pending=JSON.parse(storage.getItem(key)||'null');}catch(_){}
        if(pending&&pending.request_id===s.request_id)storage.removeItem(key);
      });
      if(active){
        $('input').value=restored;
        saveDraft();resizeInput();
        schedules=schedules.filter(function(row){return row.request_id!==s.request_id;});renderSchedules();
        if(opened()&&tab==='tasks')$('input').focus();
      }else localStorage.setItem(draftKey(id),restored);
      var cached=windowCache.get(id);if(cached)cached.schedules=cached.schedules.filter(function(row){return row.request_id!==s.request_id;});
      message(draft?'定时任务已取消，内容已追加到原窗口草稿':'定时任务已取消，内容已放回输入框');
      refreshStatus(true);await refresh(false);
    }catch(e){message(e.message,true);}finally{busy=false;renderToolbar();}
  }
  function renderSchedules(){
    var visible=schedules.filter(function(s){return s.state==='scheduled';});
    var list=$('schedules');list.replaceChildren();list.hidden=!visible.length;
    if(!visible.length)return;
    list.append(node('h4','','定时任务 · 北京时间'));
    visible.forEach(function(s){
      var row=node('details','cx-scheduled'),summary=node('summary');
      var status=s.scheduled_for<=Date.now()/1000?'到点，等待窗口空闲':'待执行';
      summary.append(node('span','',scheduleStamp(s.scheduled_for)),node('strong','',status));row.append(summary,node('p','cx-text',s.text));
      var provider=config.profiles.find(function(p){return p.id===s.profile;});if(provider)row.append(node('small','cx-muted','供应商：'+provider.name+' · 执行时使用该供应商的最新配置'));
      row.append(button('取消定时任务',function(){cancelSchedule(s);}));
      list.append(row);
    });
  }
  function status(w){return w.status==='failed'?'failed':w.error?'error':w.status;}
  function statusLabel(w){return status(w)==='error'?(w.status==='interrupted'?'执行中断':w.status==='queued'?'出错待重试':'运行出错'):(labels[w.status]||w.status);}
  function seenKey(id){return 'ck_codex_seen_'+encodeURIComponent(endpoint)+'_'+id;}
  function completionVersion(w){return String(w.seq||w.updated||0);}
  function completionSeen(w){try{return localStorage.getItem(seenKey(w.id))===completionVersion(w);}catch(_){return false;}}
  function archivedWindow(w){return w.status==='closed';}
  function markCompletionSeen(snapshot){
    var w=current();
    // A list poll, cached feed, failed read, or background settings page is not a view.
    if(!opened()||document.hidden||tab!=='tasks'||!w||w.id!==snapshot.id||w.status!=='completed'||w.error||snapshot.status!=='completed'||completionVersion(w)!==completionVersion(snapshot))return;
    try{localStorage.setItem(seenKey(w.id),completionVersion(snapshot));}catch(_){}
  }
  async function openTaskNotice(id){
    if(!opened()){
      // Choose before opening: never acknowledge the previously selected window incidentally.
      restoreWindow(id);localStorage.setItem('ck_codex_selected',id);
      await window.ckOpenCodex('tasks');
    }else await select(id);
  }
  function renderTaskNotices(){
    var rail=$('task-notices');if(!rail)return;
    var inside=opened();
    $('notice-tools').hidden=!inside||!config;$('tab-tasks').hidden=tab==='tasks';
    var active=windows.filter(function(w){return !archivedWindow(w);}).sort(function(a,b){return (a.created||0)-(b.created||0)||a.id.localeCompare(b.id);});
    rail.hidden=!inside||!access||!active.length;
    var list=$('notice-list'),signature=JSON.stringify([inside,tab,selected,active.map(function(w){return [w.id,w.title,windowState(w),w.error,w.scheduled_count,completionSeen(w)];})]);
    if(list.dataset.signature===signature)return;
    list.dataset.signature=signature;
    var prior=new Map(Array.from(list.children).map(function(b){return [b.dataset.windowId,b];}));
    active.forEach(function(w,index){
      var b=prior.get(w.id);prior.delete(w.id);
      if(!b){b=button('',function(){openTaskNotice(w.id);},'cx-task-notice');b.dataset.windowId=w.id;b.append(node('strong'),node('span'));}
      var stale=windowState(w)==='状态待同步',bad=stale||['failed','error'].includes(status(w));
      var label=stale?'连接异常 · 待同步':w.status==='completed'&&!completionSeen(w)?'已完成 · 未查看':statusLabel(w);
      if(w.scheduled_count)label+=' · '+w.scheduled_count+' 个定时任务';
      b.dataset.status=stale?'unknown':status(w);b.dataset.tone=bad?'error':'ok';
      b.classList.toggle('active',inside&&tab==='tasks'&&w.id===selected);
      b.querySelector('strong').textContent=w.title;b.querySelector('span').textContent=label;
      b.title=w.title+' · '+label+(w.error?'：'+w.error:'');b.setAttribute('aria-label',b.title+'，点击查看');
      if(list.children[index]!==b)list.insertBefore(b,list.children[index]||null);
    });
    prior.forEach(function(b){
      if(inside&&document.activeElement===b){$('window-title').tabIndex=-1;$('window-title').focus({preventScroll:true});}
      b.remove();
    });
  }
  function sidebarClose(){closeSidebar();}
  function dismiss(target){
    root.querySelectorAll('details[open]').forEach(function(el){if(!target||!el.contains(target))el.open=false;});
    if(!target||(!$('window-sidebar').contains(target)&&!$('window-toggle').contains(target)))sidebarClose();
  }
  function dismissDialog(dlg){
    var downOutside=false;
    function outside(e){var r=dlg.getBoundingClientRect();return e.target===dlg&&(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom);}
    dlg.addEventListener('pointerdown',function(e){downOutside=outside(e);});
    dlg.addEventListener('pointerup',function(e){if(downOutside&&outside(e))dlg.close();downOutside=false;});
  }
  function feedback(b,text,state){
    if(!b)return;
    var saved=b.feedbackState||(b.feedbackState={button:b,label:b.textContent});b=saved.button;
    clearTimeout(saved.timer);if(!b.dataset.label)b.dataset.label=saved.label;
    b.textContent=text;b.dataset.feedback=state;b.setAttribute('aria-busy',String(state==='busy'));b.disabled=state==='busy';
    if(state!=='busy')saved.timer=setTimeout(function(){var live=saved.button;live.textContent=saved.label;delete live.dataset.feedback;live.removeAttribute('aria-busy');},2200);
  }
  function copyButton(text,label){var b=button('复制',function(){copy(text,b);},'cx-copy');if(label)b.setAttribute('aria-label',label);return b;}
  function chooseDialog(title, choices, opts){
    return new Promise(function(resolve){
      var dlg=node('dialog','cx-dialog cx-picker'),heading=node('h3','',title),list=node('div','cx-picker-list'),answer=null;
      heading.id='cx-picker-title';dlg.setAttribute('aria-labelledby',heading.id);dlg.append(heading);
      if(opts&&opts.message)dlg.append(node('p','',opts.message));
      if(opts&&opts.searchable){
        var search=node('input');search.type='search';search.placeholder='搜索模型或选项';search.setAttribute('aria-label','搜索选项');dlg.append(search);
        search.oninput=function(){var q=search.value.trim().toLowerCase();Array.from(list.children).forEach(function(b){b.hidden=!b.textContent.toLowerCase().includes(q);});};
      }
      choices.forEach(function(c){
        var row=node('div','cx-choice-row'),b=button(c.label,function(){answer=c.value;dlg.close();},'cx-picker-option');b.disabled=!!c.disabled;b.classList.toggle('active',!!c.active);
        if(c.hint)b.append(node('small','',c.hint));row.append(b,copyButton([c.label,c.hint].filter(Boolean).join('\n'),'复制选项：'+c.label));list.append(row);
      });
      if(!choices.length)list.append(node('p','cx-muted','没有可选择的模型，可以直接填写模型名称。'));
      dlg.append(list,button('取消',function(){dlg.close();}));root.append(dlg);
      dlg.addEventListener('close',function(){dlg.remove();resolve(answer);},{once:true});
      dismissDialog(dlg);dlg.showModal();var first=list.querySelector('button.active:not(:disabled)')||list.querySelector('button:not(:disabled)');if(first)first.focus();
    });
  }
  window.ckCodexChooseDialog=chooseDialog;
  function taskDialog(title,text,value){
    return new Promise(function(resolve){
      var dlg=node('dialog','cx-dialog'),form=node('form'),heading=node('h3','',title),p=node('p','',text),actions=node('div','cx-dialog-actions');
      heading.id='cx-dialog-title';dlg.setAttribute('aria-labelledby',heading.id);form.append(heading,p);
      var input;if(value!==undefined){input=node('input');input.value=value;input.required=true;input.maxLength=100;input.setAttribute('aria-label',title);form.append(input);}
      var cancel=button('取消',function(){dlg.close();}),confirm=node('button','btn btn-blue btn-sm',input?'保存':'删除窗口');confirm.type='submit';
      actions.append(cancel,confirm);form.append(actions);dlg.append(form);root.append(dlg);
      form.onsubmit=function(e){e.preventDefault();if(input&&!input.value.trim())return;dlg.returnValue='confirmed';dlg.close();};
      dlg.addEventListener('close',function(){var answer=dlg.returnValue==='confirmed'?(input?input.value.trim():true):null;dlg.remove();resolve(answer);},{once:true});
      dismissDialog(dlg);dlg.showModal();if(input){input.focus();input.select();}else cancel.focus();
    });
  }
  async function request(path, body, signal) {
    var controller=new AbortController(), timeout=setTimeout(function(){controller.abort();},body?55000:15000);
    function cancel(){controller.abort();}
    if(signal){if(signal.aborted)cancel();else signal.addEventListener('abort',cancel,{once:true});}
    try {
      var response=await fetch(endpoint+path,{method:body?'POST':'GET',headers:{'Authorization':'Bearer '+access,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined,cache:'no-store',signal:controller.signal});
      var value=await response.json().catch(function(){return {};});
      if(!response.ok){var error=Error(value.error||'无法连接 Codex 服务');error.status=response.status;throw error;}
      return value;
    } catch(e) {
      if(signal&&signal.aborted)throw e;
      if(e.name==='AbortError'&&!body)throw Error('读取暂时超时，已显示的记录会保留，稍后自动补收。');
      if(e.name==='AbortError')throw Error('连接超时。任务可能已在服务器执行，请刷新核对；再次发送会沿用原请求编号。');
      if(e instanceof TypeError)throw Error('暂时无法连接美国 VPS；恢复网络后点击刷新，服务器任务继续运行。');
      throw e;
    } finally { clearTimeout(timeout);if(signal)signal.removeEventListener('abort',cancel); }
  }
  function make() {
    if(root)return;
    root=node('div','cx-overlay');root.id='cx-root';root.hidden=true;
    root.innerHTML='<section class="cx-shell" role="dialog" aria-modal="true" aria-labelledby="cx-title">'+
      '<header class="cx-head"><button type="button" id="cx-window-toggle" class="btn btn-outline btn-sm cx-window-toggle" aria-expanded="false" aria-controls="cx-window-sidebar">菜单</button><div id="cx-page-heading" class="cx-brand"><h2 id="cx-title">Codex</h2></div><div id="cx-window-toolbar" class="cx-window-toolbar"><div class="cx-window-heading"><h3 id="cx-window-title">选择或新建任务窗口</h3><p id="cx-window-meta"></p></div></div><details class="cx-window-menu"><summary aria-label="窗口操作">···</summary><div class="cx-window-actions"><button id="cx-refresh" type="button" class="btn btn-outline btn-sm" aria-label="刷新当前页面">刷新</button><button type="button" id="cx-rename" class="btn btn-outline btn-sm">改名</button><button type="button" id="cx-close-window" class="btn btn-outline btn-sm">关闭窗口</button><button type="button" id="cx-delete-window" class="btn btn-outline btn-sm">删除</button></div></details><span id="cx-connection" class="cx-badge">尚未连接</span><button id="cx-exit" type="button" class="btn btn-outline btn-sm">返回 CK</button></header>'+
      '<p id="cx-message" class="cx-message" role="status" aria-live="polite"></p><div id="cx-body" class="cx-body"><button id="cx-sidebar-backdrop" class="cx-sidebar-backdrop" type="button" aria-label="收起 Codex 菜单" tabindex="-1"></button>'+
      '<aside id="cx-window-sidebar" class="cx-sidebar"><div class="cx-sidebar-brand"><span aria-hidden="true">&gt;_</span> Codex<small id="cx-status-sync" class="cx-status-sync" role="status">同步中</small></div><nav class="cx-navigation cx-navigation-top" aria-label="Codex 设置"><button id="cx-tab-api" type="button">API 配置</button><button id="cx-tab-info" type="button">工作资料</button></nav><div id="cx-task-list" class="cx-task-list"><div class="cx-sidebar-head"><h3>已关闭</h3></div><input id="cx-search" class="cx-search" type="search" placeholder="查找窗口" aria-label="查找任务窗口"><div id="cx-windows" class="cx-window-list"></div></div></aside>'+
      '<form id="cx-login" class="cx-login" hidden><h3>连接你的 Codex</h3><p>使用「VPS 管理 → Codex 任务中心 → 查看访问密钥」里的专用密钥。只需在这台设备填写一次。</p><label>服务地址<input id="cx-endpoint" type="url" required autocomplete="off"></label><label>Codex 访问密钥<input id="cx-access" type="password" required autocomplete="off"></label><button class="btn btn-blue" type="submit">连接</button><small>这是任务中心的访问密钥。模型 API 密钥在连接后单独配置。</small></form>'+
      '<div id="cx-tasks" class="cx-workspace" hidden><main class="cx-main">'+
      '<div id="cx-feed-area" class="cx-feed-area"><div id="cx-feed" class="cx-feed" aria-label="Codex 任务记录"><div class="cx-empty"><span aria-hidden="true">&gt;_</span><h3>从一个任务开始</h3><p>新窗口会创建独立的 Codex 会话。执行进展、命令输出和修改结果都会留在这里。</p></div></div><nav id="cx-user-nav" class="cx-user-nav" aria-label="用户消息跳转" hidden><button id="cx-user-prev" type="button" aria-label="上一条用户消息" title="上一条用户消息" aria-controls="cx-feed">↑</button><span id="cx-user-position" role="status" aria-live="polite">用户</span><button id="cx-user-next" type="button" aria-label="下一条用户消息" title="下一条用户消息" aria-controls="cx-feed">↓</button></nav></div>'+
      '<section id="cx-schedules" class="cx-schedules" aria-label="定时任务" hidden></section><div id="cx-pending" class="cx-pending" role="region" aria-label="需要你回复的问题" aria-live="polite"></div><form id="cx-compose" class="cx-compose"><label class="cx-visually-hidden" for="cx-input">任务或补充指令</label><textarea id="cx-input" rows="1" aria-describedby="cx-compose-hint" placeholder="输入任务，或在执行中补充指令…"></textarea><div class="cx-compose-bar"><div class="cx-compose-settings"><label><span class="cx-visually-hidden">供应商</span><select id="cx-profile" aria-label="供应商与模型"></select></label><span id="cx-effort" class="cx-effort"></span></div><div class="cx-compose-meta"><details id="cx-schedule-options" class="cx-schedule-options"><summary id="cx-schedule-summary" title="安排一次性定时任务">定时</summary><div class="cx-schedule-bar"><label for="cx-schedule-time">执行时间（北京时间）</label><input id="cx-schedule-time" type="datetime-local" step="60" aria-label="执行时间（北京时间，可不选）"><button id="cx-schedule-clear" type="button" class="btn btn-outline btn-sm" hidden>清除时间</button><small id="cx-draft-status" role="status"></small></div></details><span id="cx-usage"></span></div><div class="cx-compose-actions"><span class="cx-stop-slot"><button type="button" id="cx-stop" class="btn btn-outline btn-sm" hidden>停止任务</button></span><button type="submit" id="cx-send" class="btn btn-blue btn-sm">开始执行</button></div></div><small id="cx-compose-hint">关闭页面不影响执行。不同窗口可以同时执行任务。</small></form></main></div>'+
      '<section id="cx-api" class="cx-api" hidden><div class="cx-section-heading"><div><h3>Codex API 配置</h3><p>每个供应商单独保存，下次任务生效。密钥加密保存，无需设置密码。</p></div><button id="cx-add-profile" type="button" class="btn btn-outline btn-sm">添加供应商</button></div><div id="cx-profiles"></div><p id="cx-api-state" class="cx-muted" role="status"></p></section>'+
      '<section id="cx-info" class="cx-info" hidden><h3>工作资料与维护</h3><div id="cx-info-content"></div><button id="cx-reconnect" type="button" class="btn btn-outline btn-sm">任务中心连接设置</button></section>'+
      '</div></section>';
    document.body.append(root);
    var rail=node('section','cx-task-notices');rail.id='cx-task-notices';rail.setAttribute('aria-label','Codex 任务窗口');
    rail.innerHTML='<div id="cx-notice-tools" class="cx-notice-tools"><button id="cx-tab-tasks" type="button" class="btn btn-sm btn-outline">任务</button><button id="cx-new" type="button" class="btn btn-sm btn-outline" aria-label="新窗口" title="新窗口">＋</button></div><div id="cx-notice-list" class="cx-notice-list"></div>';
    $('body').prepend(rail);
    root.querySelector('.cx-head').insertBefore($('notice-tools'),$('page-heading'));
    $('exit').onclick=close;
    ['tasks','api','info'].forEach(function(name){$('tab-'+name).onclick=function(){showTab(name);closeSidebar();};});
    $('refresh').onclick=async function(){var b=$('refresh');feedback(b,'刷新中…','busy');var ok=await refresh(true);feedback(b,ok===undefined?'刷新':ok?'已刷新':'刷新失败',ok===false?'error':'ok');if(ok===true)message('已刷新');};
    $('new').onclick=createWindow;
    $('window-toggle').onclick=function(){var open=$('body').classList.toggle('cx-sidebar-open');$('window-toggle').setAttribute('aria-expanded',String(open));};
    $('sidebar-backdrop').onclick=closeSidebar;
    $('search').oninput=renderWindows;
    $('rename').onclick=function(){renameWindow();};
    $('close-window').onclick=function(){var w=current();if(w)act(w.status==='closed'?'reopen':'close');};
    $('delete-window').onclick=deleteWindow;
    $('stop').onclick=function(){act('stop');};
    $('compose').onsubmit=function(e){e.preventDefault();send();};
    $('input').oninput=function(){saveDraft();resizeInput();};
    $('schedule-time').oninput=function(){saveDraft();renderToolbar();};
    $('schedule-clear').onclick=function(){$('schedule-time').value='';saveDraft();renderToolbar();};
    $('input').onkeydown=function(e){if(!e.isComposing&&e.key==='Enter'&&(e.ctrlKey||e.metaKey)){e.preventDefault();send();}};
    $('profile').onchange=function(){act('profile',{profile:$('profile').value});};
    $('login').onsubmit=async function(e){
      e.preventDefault();var url=$('endpoint').value.trim().replace(/\/+$/,'');
      try{var parsed=new URL(url);if(parsed.protocol!=='https:'||parsed.username||parsed.password||parsed.search||parsed.hash)throw Error();}catch(_){message('请填写不含密码和查询参数的 HTTPS 服务地址',true);return;}
      endpoint=url;access=$('access').value.trim();
      localStorage.setItem('ck_codex_endpoint',endpoint);
      try{config=await request('/config');await CKCodexStorage.save(access);$('access').value='';showTab(tab);await refresh(true);}catch(error){message(error.message,true);}
    };
    $('reconnect').onclick=function(){$('login').hidden=false;$('info').hidden=true;$('endpoint').value=endpoint;$('access').focus();};
    $('add-profile').onclick=function(){var row=addProfile({id:uid(),name:'新供应商',base_url:'https://',model:'',effort:'high'},true);row.dataset.dirty='true';formDirty=true;row.scrollIntoView({block:'nearest'});row.querySelector('[name=name]').focus();};
    var notice=button('',jumpToWaiting,'cx-question-notice');notice.id='cx-question-notice';notice.hidden=true;$('message').after(notice);
    var jump=node('div','cx-question-nav');jump.id='cx-question-nav';jump.hidden=true;
    jump.append(node('span'),button('上一处',function(){jumpQuestion(-1);}),button('回到提问',function(){jumpQuestion(0);}),button('下一处',function(){jumpQuestion(1);}));$('feed-area').after(jump);
    $('user-prev').onclick=function(){jumpUserMessage(-1);};
    $('user-next').onclick=function(){jumpUserMessage(1);};
    $('feed').addEventListener('scroll',renderUserNavigation,{passive:true});
    root.addEventListener('pointerdown',function(e){if(!e.target.closest('dialog'))dismiss(e.target);});
    root.addEventListener('click',function(e){if(e.target.closest('.cx-window-actions button'))root.querySelector('.cx-window-menu').open=false;});
    root.addEventListener('keydown',function(e){
      e.stopPropagation(); // CK gateway authentication remains pending behind this independent view.
      if(root.querySelector('dialog[open]'))return;
      if(e.key==='Escape'){e.preventDefault();if(root.querySelector('details[open]')||$('body').classList.contains('cx-sidebar-open'))dismiss();else close();}
      if(e.key==='Tab'){
        var nodes=Array.from(root.querySelectorAll('button,input,select,textarea,a,summary')).filter(function(n){return !n.disabled&&n.getClientRects().length;});
        if(!nodes.length)return;var first=nodes[0],last=nodes[nodes.length-1];
        if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}
      }
    });
  }
  function closeSidebar(){$('body').classList.remove('cx-sidebar-open');$('window-toggle').setAttribute('aria-expanded','false');}
  function resizeInput(){var input=$('input');input.style.height='auto';input.style.height=Math.min(160,(root.clientHeight||window.innerHeight)*.22,input.scrollHeight)+'px';}
  function cancelRefresh(){generation++;clearTimeout(timer);if(refreshController)refreshController.abort();refreshController=null;loading=false;}
  function layoutViewport(){
    viewportFrame=0;if(!opened())return;
    var vv=window.visualViewport,feed=$('feed'),atBottom=feed.scrollHeight-feed.scrollTop-feed.clientHeight<100;
    root.style.setProperty('--cx-viewport-height',Math.max(1,Math.floor(vv?vv.height:window.innerHeight))+'px');
    root.style.setProperty('--cx-viewport-top',Math.max(0,Math.floor(vv?vv.offsetTop:0))+'px');
    resizeInput();if(atBottom)feed.scrollTop=feed.scrollHeight;
  }
  function queueViewport(){if(!viewportFrame)viewportFrame=requestAnimationFrame(layoutViewport);}
  function close(){saveDraft();dismiss();rememberWindow();cancelRefresh();cancelStatus();root.hidden=true;document.body.classList.remove('cx-open');document.documentElement.classList.remove('cx-open');renderQuestionNotice();if(access&&!document.hidden)statusTimer=setTimeout(function(){refreshStatus(false);},4000);window.scrollTo(0,pageScroll);if(previousFocus&&previousFocus.isConnected)previousFocus.focus({preventScroll:true});}

  function showTab(name){
    tab=['tasks','api','info'].includes(name)?name:'tasks';name=tab;root.dataset.page=name;
    $('title').textContent={tasks:'Codex 任务',api:'Codex API 配置',info:'Codex 工作资料'}[name];
    $('page-heading').hidden=!!config&&name==='tasks';$('window-toolbar').hidden=!config||name!=='tasks';$('task-list').hidden=!config;
    ['rename','close-window','delete-window'].forEach(function(n){$(n).hidden=!config||name!=='tasks';});
    root.querySelector('.cx-window-menu summary').setAttribute('aria-label',config&&name==='tasks'?'窗口操作':'页面操作');
    ['tasks','api','info'].forEach(function(n){$(n).hidden=!config||n!==name;$('tab-'+n).classList.toggle('active',n===name);$('tab-'+n).setAttribute('aria-current',n===name?'page':'false');});
    $('login').hidden=!!config;renderTaskNotices();
    if(!config){$('endpoint').value=endpoint;return;}
    if(name==='api'&&!formDirty)renderApi();
    if(name==='info')renderInfo();
  }
  function windowState(w){
    if(Date.now()-(confirmedAt.get(w.id)||0)>5000)return '状态待同步';
    return statusLabel(w);
  }
  function renderWindows(){
    renderTaskNotices();
    var query=$('search').value.trim().toLowerCase(),list=$('windows');
    var signature=JSON.stringify([query,selected,windows.map(function(w){return [w.id,w.title,windowState(w),w.status,stamp(w.updated),w.scheduled_count,archivedWindow(w)];})]);
    if(signature===windowListSignature)return;windowListSignature=signature;list.replaceChildren();
    windows.filter(function(w){return archivedWindow(w)&&(!query||w.title.toLowerCase().includes(query));}).forEach(function(w){
      var b=node('button','cx-window'+(w.id===selected?' active':''));b.type='button';b.dataset.status=windowState(w)==='状态待同步'?'unknown':status(w);b.title='上次服务器状态：'+(labels[w.status]||w.status);
      b.append(node('strong','',w.title),node('span','',windowState(w)+(w.scheduled_count?' · '+w.scheduled_count+' 个定时任务':'')),node('small','',stamp(w.updated)));
      b.onclick=function(){select(w.id);};list.append(b);
    });
    if(!list.childElementCount)list.append(node('p','cx-muted',query?'没有匹配的窗口':'关闭的窗口会收在这里。'));
  }
  function renderToolbar(){
    if(!config)return;
    var w=current(), running=w&&['queued','starting','running','waiting'].includes(w.status);
    var timed=!!$('schedule-time').value;
    $('schedule-summary').textContent=timed?'已定时':'定时';$('schedule-options').classList.toggle('cx-has-time',timed);
    $('window-title').textContent=w?w.title:'选择或新建任务窗口';
    $('window-meta').replaceChildren();if(w){var state=node('span','cx-task-status',windowState(w));state.dataset.status=windowState(w)==='状态待同步'?'unknown':status(w);$('window-meta').append(document.createTextNode('Codex · '),state);}else $('window-meta').textContent='每个窗口都有自己的任务记录';
    ['rename','close-window','delete-window'].forEach(function(n){$(n).disabled=!w||busy;});
    $('close-window').textContent=w&&w.status==='closed'?'重新打开':'关闭窗口';
    $('stop').hidden=!running;$('stop').disabled=busy;
    $('input').disabled=!w||w.status==='closed';
    $('send').disabled=!w||busy||(timed?['closed','opening']:['closed','queued','starting','waiting','opening']).includes(w.status);
    $('send').textContent=timed?'定时发送':w&&w.status==='running'?'补充指令':'开始执行';
    $('schedule-time').disabled=!w||w.status==='closed';$('schedule-clear').hidden=!timed;
    $('profile').disabled=!w||running||busy;
    var chosen=w?w.profile:config.default_profile;
    if($('profile').dataset.items!==JSON.stringify(config.profiles)){
      $('profile').replaceChildren();config.profiles.forEach(function(p){var opt=node('option','',p.name+' · '+p.model);opt.value=p.id;$('profile').append(opt);});$('profile').dataset.items=JSON.stringify(config.profiles);
    }
    $('profile').value=chosen;
    var profile=config.profiles.find(function(p){return p.id===chosen;});$('effort').textContent=profile?profile.effort:'';
    var usage={};try{usage=JSON.parse(w&&w.usage||'{}');}catch(_){}
    var total=usage.total||{};$('usage').textContent=total.totalTokens?Number(total.totalTokens).toLocaleString()+' tokens':'';
    renderTaskNotices();
    $('compose-hint').textContent=timed?'按北京时间执行，退出页面仍有效；窗口忙碌时等待空闲。':w&&w.status==='closed'?'窗口已关闭，记录保留。点击「重新打开」继续。':w&&w.status==='queued'?'任务已提交，正在启动。':w&&w.status==='running'?'正在服务器执行。可以补充指令，或选择时间安排下一任务。':'不选时间即刻执行。Ctrl / ⌘ + Enter 发送；关闭页面不影响执行。';
  }
  async function copy(text,b){
    feedback(b,'复制中…','busy');
    try{await navigator.clipboard.writeText(text);feedback(b,'已复制','ok');message('已复制');}
    catch(_){feedback(b,'复制失败','error');message('复制失败，请选中文字手动复制',true);}
  }
  function card(item){
    if(['request','resolved'].includes(item.kind)&&item.data.method)return questionCard(item);
    var titles={userMessage:'你的任务',agentMessage:item.data.phase==='final_answer'?'完成回复':'Codex',reasoning:'思考摘要',commandExecution:'执行命令',fileChange:'修改文件',diff:'本轮改动',plan:'执行计划',warning:'运行提示',error:'运行出错',resolved:'已处理',contextCompaction:'已整理上下文'};
    var el=node('article','cx-item cx-item-'+item.kind);el.dataset.itemId=item.id;
    if(!['userMessage','agentMessage','plan','reasoning','warning','error','contextCompaction'].includes(item.kind)){
      var details=node('details','cx-detail'), summary=node('summary');
      summary.textContent=titles[item.kind]||'执行命令';
      var content=[item.data.command,item.text].filter(Boolean).join('\n\n');
      details.append(summary,copyButton(content,'复制'+summary.textContent),node('pre','',content||'正在执行…'));el.append(details);
    }else{
      var head=node('header','cx-item-head');head.append(node('strong','',titles[item.kind]),node('time','',stamp(item.created)));
      if(item.text)head.append(copyButton(item.text));
      el.append(head);
      if(item.kind==='agentMessage'&&item.text)appendAssistantText(el,item.text);
      else el.append(node('div','cx-text',item.text|| (item.kind==='contextCompaction'?'Codex 已压缩当前上下文，继续任务。':'正在处理…')));
    }
    return el;
  }
  function questionText(item){var p=item.data.params||{};return (p.questions||[]).map(function(q){return q.question;}).join('\n')||p.reason||p.command||'请核对这次操作';}
  function questionCard(item){
    var el=node('article','cx-item cx-item-question');el.dataset.itemId=item.id;el.tabIndex=-1;
    var head=node('header','cx-item-head');head.append(node('strong','',item.kind==='request'?'Codex 提问 · 待回复':'Codex 提问 · 已结束'),node('time','',stamp(item.created)),copyButton(questionText(item),'复制提问'));
    el.append(head);var questions=(item.data.params||{}).questions||[];
    if(!questions.length)el.append(node('div','cx-text',questionText(item)));
    questions.forEach(function(q){var group=node('div','cx-question-group');group.append(node('div','cx-text',q.question));(q.options||[]).forEach(function(opt){var row=node('div','cx-choice-row');row.append(node('span','cx-option-text',[opt.label,opt.description].filter(Boolean).join(' · ')),copyButton([opt.label,opt.description].filter(Boolean).join('\n'),'复制历史选项：'+opt.label));group.append(row);});el.append(group);});
    if(item.kind==='request')el.append(button('前往回复',function(){focusQuestion(item.id);},'cx-reply-jump'));
    return el;
  }
  function appendAssistantText(el,text){
    var lines=text.split('\n'),start=0,fence='';
    var option=/^\s{0,3}(?:[-*+•]|\d+[.)、]|[A-Da-d][.)、]|[（(]\d+[）)])\s+(.+)$/;
    for(var i=0;i<lines.length;i++){
      var marker=/^\s{0,3}(`{3,}|~{3,})/.exec(lines[i]);
      if(marker){if(!fence)fence=marker[1][0];else if(marker[1][0]===fence)fence='';continue;}
      // Recognize explicit choice questions, leaving ordinary lists, quotes and code untouched.
      if(fence||/^\s*(?:>|[-*+]\s|\d+[.)、]\s)/.test(lines[i])||!/[?？][\s*_”」』"）)]*$/.test(lines[i]))continue;
      var options=[],j=i+1,end=j;
      while(j<lines.length){
        if(!lines[j].trim()){j++;continue;}
        var match=option.exec(lines[j]);
        if(match){options.push(match[1]);end=++j;continue;}
        if(options.length&&/^\s{2,}\S/.test(lines[j])&&!/^\s*(?:>|`{3,}|~{3,})/.test(lines[j])){options[options.length-1]+='\n'+lines[j].trim();end=++j;continue;}
        break;
      }
      if(options.length<2)continue;
      if(i>start)el.append(node('div','cx-text',lines.slice(start,i).join('\n')));
      var box=node('section','cx-text-question');box.tabIndex=-1;box.setAttribute('aria-label','Codex 提问');
      box.append(node('strong','cx-text-question-label','Codex 提问'),node('div','cx-text',lines[i]));
      options.forEach(function(text){var row=node('div','cx-choice-row');row.append(node('span','cx-option-text',text),copyButton(text,'复制选项：'+text));box.append(row);});
      el.append(box);el.classList.add('cx-item-text-question');start=end;i=end-1;
    }
    if(start<lines.length)el.append(node('div','cx-text',lines.slice(start).join('\n')));
  }
  function questionItems(){return Array.from($('feed').querySelectorAll('.cx-item-question,.cx-item-text-question')).map(function(el){return items.get(el.dataset.itemId);}).filter(Boolean);}
  function userMessages(){return Array.from($('feed').querySelectorAll('.cx-item-userMessage'));}
  function activeUserMessage(){
    return userJump&&Math.abs($('feed').scrollTop-userJump.scroll)<2?userMessages().find(function(el){return el.dataset.itemId===userJump.id;}):null;
  }
  function userMessageTarget(direction,messages,anchor){
    if(anchor)return messages[messages.indexOf(anchor)+direction];
    var top=$('feed').getBoundingClientRect().top+parseFloat(getComputedStyle($('feed')).paddingTop);
    return direction<0?messages.slice().reverse().find(function(el){return el.getBoundingClientRect().top<=top+2;}):messages.find(function(el){return el.getBoundingClientRect().top>=top-2;});
  }
  function positionUserMessage(el){
    var feed=$('feed');
    // Set the position immediately so repeated taps advance even when the last message cannot reach the top.
    feed.scrollTop+=el.getBoundingClientRect().top-feed.getBoundingClientRect().top-parseFloat(getComputedStyle(feed).paddingTop);
    userJump={id:el.dataset.itemId,scroll:feed.scrollTop};
  }
  function renderUserNavigation(){
    var messages=userMessages(),anchor=activeUserMessage();if(!anchor)userJump=null;
    $('user-nav').hidden=!messages.length;
    $('user-prev').disabled=!userMessageTarget(-1,messages,anchor);
    $('user-next').disabled=!userMessageTarget(1,messages,anchor);
    messages.forEach(function(el){el.classList.toggle('cx-user-highlight',el===anchor);});
    var label=anchor?(messages.indexOf(anchor)+1)+' / '+messages.length:'用户';
    if($('user-position').textContent!==label)$('user-position').textContent=label;
    $('user-position').setAttribute('aria-label',anchor?'第 '+(messages.indexOf(anchor)+1)+' 条，共 '+messages.length+' 条用户消息':'共 '+messages.length+' 条用户消息');
  }
  function jumpUserMessage(direction){
    var messages=userMessages(),target=userMessageTarget(direction,messages,activeUserMessage());
    if(target)positionUserMessage(target);
    renderUserNavigation();
  }
  function focusQuestion(id){var box=Array.from($('pending').children).find(function(n){return n.dataset.itemId===id;});if(box){box.scrollIntoView({block:'nearest'});(box.querySelector('textarea,button')||box).focus({preventScroll:true});}}
  function jumpQuestion(direction){
    var questions=questionItems();if(!questions.length)return;
    if(!direction){questionIndex=questions.findIndex(function(i){return i.kind==='request';});if(questionIndex<0)questionIndex=questions.length-1;}
    else questionIndex=(questionIndex+direction+questions.length)%questions.length;
    var id=questions[questionIndex].id,el=Array.from($('feed').children).find(function(n){return n.dataset.itemId===id;});
    userJump=null;
    if(el){var target=el.querySelector('.cx-text-question')||el;target.scrollIntoView({block:'start'});target.focus({preventScroll:true});target.classList.add('cx-question-highlight');setTimeout(function(){target.classList.remove('cx-question-highlight');},1800);}
    renderUserNavigation();
    $('question-nav').querySelector('span').textContent='提问 '+(questionIndex+1)+' / '+questions.length;
  }
  function renderQuestionNotice(){
    renderTaskNotices();
    var waiting=windows.filter(function(w){return w.status==='waiting';}),count=waiting.length;
    var b=$('question-notice');b.hidden=!count;b.textContent='Codex · '+count+' 个窗口待回复 · 回到提问';
  }
  async function jumpToWaiting(){
    var w=windows.find(function(w){return w.id===selected&&w.status==='waiting';})||windows.find(function(w){return w.status==='waiting';});if(!w)return;
    await openTaskNotice(w.id);
    jumpQuestion(0);var q=questionItems().find(function(i){return i.kind==='request';});if(q)focusQuestion(q.id);
  }
  function renderFeed(changed, reset){
    var feed=$('feed'),nearEnd=feed.scrollHeight-feed.scrollTop-feed.clientHeight<100,anchor=activeUserMessage();
    if(reset){feed.replaceChildren();userJump=null;anchor=null;}
    var existing=new Map(Array.from(feed.children).map(function(el){return [el.dataset.itemId,el];}));
    changed.forEach(function(item){
      var previous=items.get(item.id);if(item.kind==='resolved'&&!item.data.method&&previous&&previous.data.method)item=Object.assign({},item,{data:previous.data});
      items.set(item.id,item);
      if(item.kind==='resolved'&&!item.data.method)return;
      var old=existing.get(item.id);
      if(old&&previous&&previous.kind===item.kind&&previous.text===item.text&&JSON.stringify(previous.data)===JSON.stringify(item.data))return;
      var el=card(item);
      if(old){
        var openedDetail=old.querySelector('details[open]');if(openedDetail&&el.querySelector('details'))el.querySelector('details').open=true;
        var copies=el.querySelectorAll('.cx-copy');old.querySelectorAll('.cx-copy').forEach(function(b,i){if(b.dataset.feedback&&copies[i]){var next=copies[i];next.feedbackState=b.feedbackState;b.feedbackState.button=next;next.textContent=b.textContent;next.dataset.feedback=b.dataset.feedback;next.disabled=b.disabled;next.setAttribute('aria-busy',b.getAttribute('aria-busy'));}});
        old.replaceWith(el);
      }else feed.append(el);
    });
    if(!feed.childElementCount){var empty=node('div','cx-empty');empty.append(node('span','','>_'),node('h3','','窗口已准备好'),node('p','','输入任务后，Codex 会在美国 VPS 上开始执行。'));feed.append(empty);}
    if(changed.length&&feed.querySelector('.cx-empty')&&feed.childElementCount>1)feed.querySelector('.cx-empty').remove();
    renderPending();
    var questions=questionItems();$('question-nav').hidden=!questions.length;
    if(questions.length){questionIndex=Math.min(questionIndex,questions.length-1);$('question-nav').querySelector('span').textContent=questions.length+' 处提问';}
    $('user-nav').hidden=!userMessages().length;
    if(anchor){var target=userMessages().find(function(el){return el.dataset.itemId===anchor.dataset.itemId;});if(target)positionUserMessage(target);}
    else if(nearEnd||reset)feed.scrollTop=feed.scrollHeight;
    renderUserNavigation();
  }
  function renderPending(){
    var pending=$('pending');var live=Array.from(items.values()).filter(function(item){return item.kind==='request';});
    var signature=JSON.stringify(live.map(function(i){return [i.id,i.seq];}));if(pending.dataset.signature===signature)return;
    var drafts=new Map();pending.querySelectorAll('form').forEach(function(form){var values={};form.querySelectorAll('textarea').forEach(function(input){values[input.name]=input.value;});drafts.set(form.dataset.itemId,values);});
    pending.dataset.signature=signature;pending.replaceChildren();
    live.forEach(function(item){
      var event=item.data, box=node('form','cx-question');box.dataset.itemId=item.id;box.setAttribute('role','alert');box.append(node('h4','','需要你回复 · Codex 正在等待'));
      if(event.method==='item/tool/requestUserInput'){
        (event.params.questions||[]).forEach(function(q){
          var group=node('div','cx-question-group'),label=node('label','',q.question),input=node('textarea');input.name=q.id;input.rows=2;input.required=true;input.value=(drafts.get(item.id)||{})[q.id]||'';label.append(input);group.append(label);box.append(group);
          (q.options||[]).forEach(function(opt){var row=node('div','cx-choice-row'),choose=button(opt.label,function(){input.value=opt.label;group.querySelectorAll('[aria-pressed]').forEach(function(b){b.setAttribute('aria-pressed','false');});choose.setAttribute('aria-pressed','true');input.focus({preventScroll:true});},'cx-answer-option');choose.setAttribute('aria-pressed','false');if(opt.description)choose.append(node('small','',opt.description));row.append(choose,copyButton([opt.label,opt.description].filter(Boolean).join('\n'),'复制选项：'+opt.label));group.append(row);});
        });
        var submit=node('button','btn btn-blue btn-sm','回复并继续');submit.type='submit';box.append(submit);
        box.onsubmit=function(e){e.preventDefault();var answers={};box.querySelectorAll('textarea').forEach(function(n){answers[n.name]=n.value;});act('answer',{request_id:String(event.id),answers:answers});};
      }else if(['item/commandExecution/requestApproval','item/fileChange/requestApproval'].includes(event.method)){
        box.append(node('p','cx-text',event.params.reason||event.params.command||'请核对这次操作'));
        ['accept','decline','cancel'].forEach(function(d,i){var label=['允许这次操作','不允许','停止任务'][i],row=node('div','cx-choice-row');row.append(button(label,function(){act('answer',{request_id:String(event.id),decision:d});}),copyButton(label,'复制选项：'+label));box.append(row);});
      }else{box.append(node('p','cx-text','收到暂不支持的交互请求：'+event.method+'。可停止任务后调整指令。'),button('停止任务',function(){act('stop');}));}
      pending.append(box);
    });
  }
  function rememberWindow(){
    if(!selected||!cursor)return;
    var feed=$('feed');windowCache.delete(selected);
    windowCache.set(selected,{cursor:cursor,items:items,nodes:Array.from(feed.childNodes),pending:Array.from($('pending').childNodes),signature:$('pending').dataset.signature,questionIndex:questionIndex,scroll:feed.scrollTop,userJump:activeUserMessage()?userJump:null,schedules:schedules});
    // Keep the most recent windows in this page only; never persist task output.
    while(windowCache.size>8)windowCache.delete(windowCache.keys().next().value);
  }
  function restoreWindow(id){
    var cached=windowCache.get(id),feed=$('feed');selected=id;cursor=cached?cached.cursor:0;items=cached?cached.items:new Map();userJump=cached?cached.userJump:null;
    feed.replaceChildren();$('pending').replaceChildren();delete $('pending').dataset.signature;
    if(cached){cached.nodes.forEach(function(n){feed.append(n);});cached.pending.forEach(function(n){$('pending').append(n);});if(cached.signature)$('pending').dataset.signature=cached.signature;feed.scrollTop=cached.scroll;}
    else if(id){var loadingNote=node('div','cx-empty');loadingNote.append(node('p','','正在读取窗口记录…'));feed.append(loadingNote);}
    restoreDraft(id);schedules=cached?cached.schedules:[];renderSchedules();$('schedule-options').open=false;questionIndex=cached?cached.questionIndex:-1;var questions=questionItems();$('question-nav').hidden=!questions.length;if(questions.length)$('question-nav').querySelector('span').textContent=questions.length+' 处提问';
    renderUserNavigation();
  }
  async function select(id){
    showTab('tasks');closeSidebar();if(id===selected){refresh(false);return;}
    saveDraft();
    rememberWindow();cancelRefresh();restoreWindow(id);message('');localStorage.setItem('ck_codex_selected',id);
    renderWindows();renderToolbar();await refresh(false);
  }
  function cancelStatus(){clearTimeout(statusTimer);if(statusController)statusController.abort();statusController=null;statusPending=null;}
  function newerWindow(old,next){return old&&Number(old.seq||0)>Number(next.seq||0)?old:Object.assign({},old,next);}
  function refreshStatus(force){
    if(!root||!access)return Promise.resolve();
    if(force)cancelStatus();else if(statusController)return statusPending;
    clearTimeout(statusTimer);var controller=new AbortController();statusController=controller;
    var staleTimer=setTimeout(function(){if(statusController===controller){$('status-sync').textContent='状态待同步';renderWindows();renderToolbar();}},5000);
    statusPending=(async function(){
      try{
        var response=await request('/threads',null,controller.signal);if(statusController!==controller||controller.signal.aborted)return;
        var hadCurrent=!!current(),prior=selected,now=Date.now(),old=new Map(windows.map(function(w){return [w.id,w];}));
        windows=response.windows.map(function(w){confirmedAt.set(w.id,now);return newerWindow(old.get(w.id),w);});renderQuestionNotice();renderTaskNotices();
        if(!opened())return;
        windowCache.forEach(function(_,wid){if(!windows.some(function(w){return w.id===wid;})){windowCache.delete(wid);confirmedAt.delete(wid);}});
        if(selected&&!current()){removeDraft(selected);windowCache.delete(selected);restoreWindow('');}
        else if(!hadCurrent&&selected)restoreWindow(selected);
        if(!selected&&windows.length){restoreWindow(windows[0].id);localStorage.setItem('ck_codex_selected',selected);}
        $('status-sync').textContent='实时状态';$('status-sync').title='最近同步 '+new Date(now).toLocaleTimeString('zh-CN');
        renderWindows();renderToolbar();
        if(hadCurrent&&prior!==selected){cancelRefresh();queueMicrotask(function(){refresh(false);});}
      }catch(e){
        if(statusController!==controller||controller.signal.aborted)return;
        confirmedAt.clear();$('status-sync').textContent='状态待同步';renderWindows();renderToolbar();
        if(e.status===401){config=null;windowCache.clear();showTab(tab);}
      }finally{
        clearTimeout(staleTimer);
        if(statusController===controller){statusController=null;statusPending=null;if(access&&!document.hidden)statusTimer=setTimeout(function(){refreshStatus(false);},opened()?1500:4000);}
      }
    })();return statusPending;
  }
  async function refresh(full){
    if(!opened()||(loading&&!full))return;
    if(full)cancelRefresh();loading=true;clearTimeout(timer);
    var controller=new AbortController();refreshController=controller;var token=generation,id=selected;
    function valid(){return token===generation&&refreshController===controller&&!controller.signal.aborted;}
    async function readWindow(wid){
      var snapshot=await request('/threads/'+wid+'?after='+cursor,null,controller.signal);if(!valid()||wid!==selected)return;
      var reset=cursor===0;cursor=snapshot.cursor;confirmedAt.set(wid,Date.now());windows=windows.map(function(w){return w.id===wid?newerWindow(w,snapshot.window):w;});renderFeed(snapshot.items,reset);
      markCompletionSeen(snapshot.window);
      var next=snapshot.schedules||[];if(JSON.stringify(schedules)!==JSON.stringify(next)){schedules=next;renderSchedules();}renderToolbar();renderWindows();renderQuestionNotice();
      $('connection').textContent='已连接';$('connection').dataset.state='ok';
      if($('message').dataset.source==='sync')message('');
    }
    try{
      if(!access){showTab(tab);return;}
      if(!config||full){var nextConfig=await request('/config',null,controller.signal);if(!valid())return;config=nextConfig;showTab(tab);}
      var known=!!current();
      // Sidebar status polling has its own request and timer. Neither stream waits for the other.
      if(known){if(full||(!statusController&&!statusTimer))refreshStatus(full);await readWindow(id);}
      else{await refreshStatus(full);if(valid()&&selected)await readWindow(selected);}
      if(!valid())return;
      if(full)message('');return true;
    }catch(e){
      if(!valid())return;
      // Read recovery must not erase an unresolved send/save/action failure.
      if(!$('message').classList.contains('cx-error')||$('message').dataset.source==='sync')message(e.message,true,'sync');
      $('connection').textContent='连接待恢复';$('connection').dataset.state='error';
      if(e.status===401){config=null;windowCache.clear();cancelStatus();showTab(tab);}return false;
    }finally{
      if(refreshController===controller){controller.abort();refreshController=null;loading=false;
        if(opened()&&!document.hidden){var w=current();timer=setTimeout(function(){refresh(false);},w&&['queued','running','starting','waiting'].includes(w.status)?900:4000);}}
    }
  }
  async function createWindow(){
    if(busy)return;busy=true;$('new').disabled=true;message('正在创建 Codex 会话…');
    var key=sessionStorage.getItem('ck_codex_create')||uid();sessionStorage.setItem('ck_codex_create',key);
    var next=windows.reduce(function(n,w){var match=/^任务\s*(\d+)$/.exec(w.title);return match?Math.max(n,Number(match[1])):n;},0)+1;
    try{var w=await request('/threads',{request_id:key,title:'任务'+next,auto_title:true,profile:config.default_profile});sessionStorage.removeItem('ck_codex_create');windows.unshift(w);await select(w.id);message('新窗口已创建');}
    catch(e){message(e.message,true);}finally{busy=false;$('new').disabled=false;renderToolbar();}
  }
  async function renameWindow(){var w=current();if(!w)return;var title=await taskDialog('窗口名称','为这个任务取一个便于查找的名称。',w.title);if(title)act('rename',{title:title});}
  async function deleteWindow(){
    var w=current();if(!w)return;
    if(await taskDialog('删除 Codex 窗口','删除「'+w.title+'」？当前任务会停止，定时任务会取消，草稿、CK 记录与对应 Codex 会话会一起删除。已修改的项目文件保留。'))act('delete');
  }
  async function act(name,body){
    if(!selected||busy)return;busy=true;renderToolbar();var id=selected;
    try{await request('/threads/'+id+'/'+name,body||{});if(name==='delete'){cancelStatus();cancelRefresh();windows=windows.filter(function(w){return w.id!==id;});localStorage.removeItem(seenKey(id));removeDraft(id);windowCache.delete(id);confirmedAt.delete(id);localStorage.removeItem('ck_codex_selected');if(selected===id)restoreWindow('');renderWindows();renderToolbar();}message({stop:'当前任务已停止，待执行的定时任务保留',close:'窗口已关闭，定时任务已取消，草稿与记录保留',reopen:'窗口已重新打开',delete:'窗口、草稿与 Codex 会话已删除',rename:'名称已更新',profile:'已切换接口',answer:'已回复','cancel-schedule':'定时任务已取消'}[name]||'已完成');cancelRefresh();await refreshStatus(true);await refresh(false);}
    catch(e){message(e.message,true);}finally{busy=false;renderToolbar();}
  }
  async function send(){
    var w=current(),raw=$('input').value,text=raw.trim(),when=$('schedule-time').value;if(!w||!text||busy)return;
    if(!$('schedule-time').reportValidity())return;
    var mode=when?'schedule':w.status==='running'?'steer':'send',key='ck_codex_pending_'+w.id,pending,due;
    saveDraft();
    try{pending=JSON.parse(localStorage.getItem(key)||sessionStorage.getItem(key)||'null');}catch(_){}
    var same=pending&&pending.text===text&&(pending.when||'')===when;
    if(when){
      due=Date.parse(when+':00+08:00')/1000;
      if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(when)||!Number.isFinite(due)||(!same&&due<=Date.now()/1000)){message('请选择未来的执行时间（北京时间）',true);return;}
      if(!config.scheduling){message('定时服务正在等待空闲启用，请稍后刷新。草稿已保留。',true);return;}
    }
    if(!same)pending={text:text,when:when,mode:mode,request_id:uid()};
    mode=pending.mode;
    try{localStorage.setItem(key,JSON.stringify(pending));}catch(_){message('无法保存发送编号，请恢复浏览器存储后再发送。草稿仍在输入框中。',true);return;}
    busy=true;renderToolbar();
    try{await request('/threads/'+w.id+'/'+mode,{text:text,request_id:pending.request_id,scheduled_for:due});sessionStorage.removeItem(key);localStorage.removeItem(key);
      if(selected===w.id){if($('input').value===raw&&$('schedule-time').value===when){$('input').value='';$('schedule-time').value='';saveDraft();resizeInput();}}
      else if(localStorage.getItem(draftKey(w.id))===raw&&(localStorage.getItem(draftKey(w.id)+'_time')||'')===when)removeDraft(w.id);
      message(mode==='schedule'?'已安排 '+scheduleStamp(due)+'（北京时间）执行':mode==='steer'?'补充指令已发送':'任务已提交到服务器');cancelRefresh();refreshStatus(true);await refresh(false);}
    catch(e){message(e.message,true);}finally{busy=false;renderToolbar();}
  }
  function field(label,type,value,name){var wrap=node('label','',label), input=node(type==='select'?'select':'input');if(type!=='select')input.type=type;input.name=name;input.value=value||'';input.autocomplete='off';wrap.append(input);return wrap;}
  function updateDirty(){formDirty=Array.from($('profiles').children).some(function(r){return r.dataset.dirty==='true';});}
  function addProfile(p, expanded){
    var row=node('details','cx-profile-card');row.dataset.id=p.id;row.open=!!expanded;
    var summary=node('summary','cx-profile-summary'),heading=node('div'),title=node('strong','',p.name||'新供应商'),subtitle=node('span','cx-profile-subtitle'),badge=node('span','cx-profile-badge');
    function header(){title.textContent=p.name||'新供应商';subtitle.textContent=(p.model||'尚未配置模型')+' · '+(p.effort||'high');badge.textContent=(p.id===config.default_profile?'默认 · ':'')+(p.has_key?'密钥已保存':'待配置');}
    header();heading.append(title,subtitle);summary.append(heading,badge);row.append(summary);
    var form=node('form','cx-profile-form'),grid=node('div','cx-profile-grid');
    [['供应商名称','text',p.name,'name'],['API 地址','url',p.base_url,'base_url'],['模型','text',p.model,'model'],['API 密钥','password','','api_key']].forEach(function(f){
      var el=field.apply(null,f),input=el.querySelector('input');
      if(f[3]!=='api_key')input.required=true;
      else {input.placeholder=p.has_key?'已加密保存，留空保留':'填写此供应商的 API 密钥';input.autocomplete='new-password';}
      if(f[3]==='model'){input.autocapitalize='off';input.spellcheck=false;var pick=button('选择模型',function(){pickModel(false);});pick.classList.add('cx-pick-model');el.append(pick);}
      if(f[3]==='base_url')input.placeholder='https://api.example.com/v1';grid.append(el);
    });
    var effort=field('推理强度','select','','effort');
    (config.efforts||['none','minimal','low','medium','high','xhigh','max','ultra']).forEach(function(value){var opt=node('option','',value);opt.value=value;effort.querySelector('select').append(opt);});
    effort.querySelector('select').value=p.effort||'high';grid.append(effort);form.append(grid,node('p','cx-muted','推理强度使用官方名称，实际可用档位由所选模型与供应商决定。'));
    var footer=node('div','cx-profile-footer'),def=node('label','cx-check'),check=node('input');check.type='checkbox';check.checked=p.id===config.default_profile;check.name='make_default';def.append(check,document.createTextNode('新窗口默认使用'));footer.append(def);
    var modelNotice=node('p','cx-profile-state'),state=node('p','cx-profile-state');state.setAttribute('role','status');modelNotice.setAttribute('role','status');
    var modelCache=null,modelLoading=false,saving=false;
    async function pickModel(reload){
      if(modelLoading)return;modelLoading=true;var notice='';modelNotice.textContent='正在读取模型列表…';
      try{
        var base=form.querySelector('[name=base_url]').value.trim().replace(/\/+$/,''),key=form.querySelector('[name=api_key]').value.trim(),input=form.querySelector('[name=model]');
        var signature=base+'|'+key;
        if(!modelCache||reload||modelCache.signature!==signature){
          try{var result=await request('/models',{profile:p.id,base_url:base,api_key:key,model:input.value,refresh:!!reload});modelCache={signature:signature,models:result.models,warning:result.warning||''};}
          catch(error){notice=error.message+' 仍可手动填写模型。';}
        }
        notice=notice||(modelCache&&modelCache.warning)||'';modelNotice.textContent=notice||'模型列表已读取';modelNotice.classList.toggle('cx-error',!!notice);
        var names=Array.from(new Set([input.value].concat(modelCache&&modelCache.signature===signature?modelCache.models:[]).filter(Boolean)));
        var chosen=await chooseDialog('选择模型',names.map(function(m){return {value:m,label:m,active:m===input.value};}),{searchable:true,message:notice});
        if(chosen!==null){input.value=chosen;input.dispatchEvent(new Event('input',{bubbles:true}));}
      }finally{modelLoading=false;}
    }
    var refreshModels=button('刷新模型',async function(){feedback(refreshModels,'读取中…','busy');try{await pickModel(true);feedback(refreshModels,modelCache&&!modelCache.warning?'已刷新':'读取完成',modelCache&&!modelCache.warning?'ok':'error');}catch(_){feedback(refreshModels,'刷新失败','error');}});footer.append(refreshModels);
    var remove=button('删除供应商',async function(){
      if(saving)return;
      if(!config.profiles.some(function(saved){return saved.id===p.id;})){row.remove();updateDirty();return;}
      if(windows.some(function(w){return w.profile===p.id;})){state.textContent='仍有窗口使用此供应商，请先切换这些窗口的供应商。';return;}
      if(!await taskDialog('删除供应商','删除「'+p.name+'」的 API 配置？已存在的任务记录保留。'))return;
      saving=true;save.disabled=true;remove.disabled=true;
      try{config=await request('/profiles/delete',{profile:{id:p.id},expected_revision:p.revision||null});row.remove();updateDirty();renderToolbar();syncDefaults();message('供应商已删除');}
      catch(e){state.textContent=e.message;state.classList.add('cx-error');}
      finally{saving=false;save.disabled=false;remove.disabled=false;}
    });footer.append(remove);
    var save=node('button','btn btn-blue btn-sm','保存供应商');save.type='submit';footer.append(save);form.append(modelNotice,footer,state);row.append(form);
    form.oninput=function(){row.dataset.dirty='true';formDirty=true;state.textContent='有未保存的修改';state.classList.remove('cx-error');};
    form.onsubmit=async function(e){
      e.preventDefault();if(saving||!form.reportValidity())return;saving=true;save.disabled=true;remove.disabled=true;
      var raw={id:p.id};form.querySelectorAll('input:not([type=checkbox]),select').forEach(function(n){raw[n.name]=n.value;});
      // Freeze just this card; other suppliers keep their unsaved edits.
      var controls=Array.from(form.querySelectorAll('input,select,button'));controls.forEach(function(n){n.disabled=true;});
      try{
        config=await request('/profiles/save',{profile:raw,expected_revision:p.revision||null,make_default:check.checked});
        p=config.profiles.find(function(v){return v.id===p.id;});form.querySelector('[name=api_key]').value='';form.querySelector('[name=api_key]').placeholder='已加密保存，留空保留';modelCache=null;
        row.dataset.dirty='false';updateDirty();header();syncDefaults();renderToolbar();state.textContent='已保存 · 下次任务生效';state.classList.remove('cx-error');
      }catch(error){state.textContent=error.message;state.classList.add('cx-error');}
      finally{saving=false;controls.forEach(function(n){n.disabled=false;});}
    };
    if(p.id===(config.any_retry_profile||'75c76315-eb66-4fa0-ab6d-f0d2b9ef344e')){
      var retryBox=node('div','cx-any-retry'),retryState=node('p','cx-muted');retryState.setAttribute('role','status');
      var retryButton=button('',async function(){
        retryButton.disabled=true;retryState.textContent='正在保存…';
        try{
          config=await request('/profiles/any-retry',{enabled:config.any_auto_retry!==true});
          syncRetry();retryState.textContent=config.any_auto_retry?'已开启；仅对未完成任务生效，不会重跑历史失败。':'已关闭；待重试已取消，正在执行的请求完成后不再重试。';
        }catch(error){retryState.textContent=error.message;}
        finally{retryButton.disabled=!config.any_retry_switch;}
      });
      retryButton.classList.add('cx-any-retry-toggle');retryButton.setAttribute('role','switch');
      function syncRetry(){var enabled=config.any_auto_retry===true;retryButton.textContent='自动重试：'+(enabled?'开启':'关闭');retryButton.setAttribute('aria-checked',String(enabled));retryButton.disabled=!config.any_retry_switch;}
      syncRetry();retryState.textContent=config.any_retry_switch?'适用于所有 any 窗口，默认关闭。开启后，过载失败随机等 1～10 秒继续；关闭立即取消待重试。':'后端更新中，开关暂不可用，请稍后刷新。';
      retryBox.append(retryButton,retryState);row.insertBefore(retryBox,form);
    }
    row.syncDefault=function(){if(row.dataset.dirty!=='true')check.checked=p.id===config.default_profile;header();};
    $('profiles').append(row);return row;
  }
  function syncDefaults(){Array.from($('profiles').children).forEach(function(row){if(row.syncDefault)row.syncDefault();});}
  function renderApi(){var openIds=Array.from($('profiles').querySelectorAll('details[open]')).map(function(r){return r.dataset.id;});$('profiles').replaceChildren();config.profiles.forEach(function(p){addProfile(p,openIds.includes(p.id));});$('api-state').textContent='密钥仅用于对应供应商，保存后不在页面回显。';}
  function renderInfo(){
    var target=$('info-content');target.replaceChildren();
    var entries=[['工作目录',config.workspace],['入口说明',config.workspace+'/README.md'],['长期知识',config.workspace+'/knowledge/INDEX.md'],['CLI 版本',config.cli_version||'已安装'],['备份方式','在哪里执行，在哪里备份。每个任务一个单元，只留受影响内容；可恢复的 Git commit / release 只记录引用。']];
    entries.forEach(function(pair){var p=node('p');p.append(node('strong','',pair[0]+'：'),node('code','',pair[1]));target.append(p);});
    var servers=node('div','cx-server-list');(config.servers||[]).forEach(function(s){var row=node('article','cx-server');row.append(node('h4','',s.name),node('p','',s.address||''),node('p','cx-muted',s.status||''));servers.append(row);});target.append(servers);
    target.append(node('p','cx-muted','关闭窗口会停止任务并保留会话；删除窗口会同步删除会话。浏览器关闭或息屏不停止任务。服务重启后会明确标记中断，避免重复执行已经完成的操作。'));
  }
  window.ckOpenCodex=async function(name){make();if(!opened()){previousFocus=document.activeElement;pageScroll=window.scrollY;}root.hidden=false;document.body.classList.add('cx-open');document.documentElement.classList.add('cx-open');layoutViewport();selected=selected||localStorage.getItem('ck_codex_selected')||'';if(draftOwner!==selected)restoreDraft(selected);showTab(name||'tasks');renderQuestionNotice();$('exit').focus({preventScroll:true});await loadAccess();if(opened())await refresh(true);};
  document.addEventListener('visibilitychange',function(){if(document.hidden){if(root)saveDraft();cancelRefresh();cancelStatus();}else if(root&&access){refreshStatus(true);if(opened()){queueViewport();refresh(false);}}});
  window.addEventListener('storage',function(e){if(root&&e.key&&e.key.startsWith('ck_codex_seen_'))renderWindows();});
  window.addEventListener('pagehide',function(){if(root)saveDraft();});
  window.addEventListener('resize',queueViewport);
  if(window.visualViewport){window.visualViewport.addEventListener('resize',queueViewport);window.visualViewport.addEventListener('scroll',queueViewport);}
  window.addEventListener('online',function(){if(root&&access){refreshStatus(true);if(opened())refresh(false);}});
  function openLinkedTab(){var match=location.hash.match(/^#codex(?:-(tasks|api|info))?$/);if(match)window.ckOpenCodex(match[1]||'tasks');else if(!root){make();loadAccess().then(function(){if(access&&!opened())refreshStatus(false);});}}
  window.addEventListener('hashchange',openLinkedTab);
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',openLinkedTab,{once:true});else openLinkedTab();
})();
