(function () {
  'use strict';
  var root, config, windows = [], selected = '', cursor = 0, items = new Map(), tab = 'tasks';
  var timer = 0, loading = false, generation = 0, previousFocus, formDirty = false, busy = false;
  var endpoint = localStorage.getItem('ck_codex_endpoint') || 'https://tlomcc.cc.cd:18443/codex';
  var access = '', accessReady;
  var draftOwner = '', schedules = [];
  function loadAccess(){if(!accessReady)accessReady=CKCodexStorage.load().then(function(value){access=value;}).catch(function(){message('无法读取加密连接密钥，请重新填写。',true);});return accessReady;}
  var labels = {idle:'等待任务',opening:'正在创建',queued:'排队中',starting:'正在启动',running:'执行中',waiting:'等待你回复',completed:'已完成',interrupted:'已停止',failed:'需要检查',closed:'已关闭'};
  var $ = function (id) { return document.getElementById('cx-'+id); };
  function node(tag, cls, text) { var n=document.createElement(tag); if(cls)n.className=cls; if(text!==undefined)n.textContent=text; return n; }
  function button(text, fn, cls) { var b=node('button','btn btn-sm '+(cls||'btn-outline'),text); b.type='button'; b.onclick=fn; return b; }
  function uid() { return crypto.randomUUID ? crypto.randomUUID() : 'cx-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2); }
  function current() { return windows.find(function(w){return w.id===selected;}); }
  function opened() { return root && !root.hidden; }
  function message(text, bad) { $('message').textContent=text||''; $('message').classList.toggle('cx-error',!!bad); }
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
  function renderSchedules(){
    var list=$('schedules');list.replaceChildren();list.hidden=!schedules.length;
    if(!schedules.length)return;
    list.append(node('h4','','定时任务 · 北京时间'));
    schedules.forEach(function(s){
      var row=node('details','cx-scheduled'),summary=node('summary'),pending=s.state==='scheduled';
      var status=pending?(s.scheduled_for<=Date.now()/1000?'到点，等待窗口空闲':'待执行'):s.state==='cancelled'?'已取消':labels[s.state]||s.state;
      summary.append(node('span','',scheduleStamp(s.scheduled_for)),node('strong','',status));row.append(summary,node('p','cx-text',s.text));
      var provider=config.profiles.find(function(p){return p.id===s.profile;});if(provider)row.append(node('small','cx-muted','供应商：'+provider.name+' · 执行时使用该供应商的最新配置'));
      if(pending)row.append(button('取消定时任务',function(){act('cancel-schedule',{request_id:s.request_id});}));
      list.append(row);
    });
  }
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
        var b=button(c.label,function(){answer=c.value;dlg.close();},'cx-picker-option');b.disabled=!!c.disabled;b.classList.toggle('active',!!c.active);
        if(c.hint)b.append(node('small','',c.hint));list.append(b);
      });
      if(!choices.length)list.append(node('p','cx-muted','没有可选择的模型，可以直接填写模型名称。'));
      dlg.append(list,button('取消',function(){dlg.close();}));root.append(dlg);
      dlg.addEventListener('close',function(){dlg.remove();resolve(answer);},{once:true});
      dlg.showModal();var first=list.querySelector('button.active:not(:disabled)')||list.querySelector('button:not(:disabled)');if(first)first.focus();
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
      dlg.showModal();if(input){input.focus();input.select();}else cancel.focus();
    });
  }
  async function request(path, body) {
    var controller=new AbortController(), timeout=setTimeout(function(){controller.abort();},55000);
    try {
      var response=await fetch(endpoint+path,{method:body?'POST':'GET',headers:{'Authorization':'Bearer '+access,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined,cache:'no-store',signal:controller.signal});
      var value=await response.json().catch(function(){return {};});
      if(!response.ok){var error=Error(value.error||'无法连接 Codex 服务');error.status=response.status;throw error;}
      return value;
    } catch(e) {
      if(e.name==='AbortError')throw Error('连接超时。任务可能已在服务器执行，请刷新核对；再次发送会沿用原请求编号。');
      if(e instanceof TypeError)throw Error('暂时无法连接美国 VPS；恢复网络后点击刷新，服务器任务继续运行。');
      throw e;
    } finally { clearTimeout(timeout); }
  }
  function make() {
    if(root)return;
    root=node('div','cx-overlay');root.id='cx-root';root.hidden=true;
    root.innerHTML='<section class="cx-shell" role="dialog" aria-modal="true" aria-labelledby="cx-title">'+
      '<header class="cx-head"><div class="cx-brand"><span class="cx-symbol" aria-hidden="true">&gt;_</span><div><h2 id="cx-title">Codex</h2><p>美国 VPS · 任务执行</p></div></div><span id="cx-connection" class="cx-badge">尚未连接</span><button id="cx-exit" type="button" class="btn btn-outline btn-sm">返回 CK</button></header>'+
      '<nav class="cx-tabs" aria-label="Codex 板块"><button id="cx-tab-tasks" type="button">任务窗口</button><button id="cx-tab-api" type="button">Codex API 配置</button><button id="cx-tab-info" type="button">工作资料</button><button id="cx-refresh" type="button" class="cx-refresh">刷新</button></nav>'+
      '<p id="cx-message" class="cx-message" role="status" aria-live="polite"></p>'+
      '<form id="cx-login" class="cx-login" hidden><h3>连接你的 Codex</h3><p>使用「VPS 管理 → Codex 任务中心 → 查看访问密钥」里的专用密钥。只需在这台设备填写一次。</p><label>服务地址<input id="cx-endpoint" type="url" required autocomplete="off"></label><label>Codex 访问密钥<input id="cx-access" type="password" required autocomplete="off"></label><button class="btn btn-blue" type="submit">连接</button><small>这是任务中心的访问密钥。模型 API 密钥在连接后单独配置。</small></form>'+
      '<div id="cx-tasks" class="cx-workspace" hidden><aside id="cx-window-sidebar" class="cx-sidebar"><div class="cx-sidebar-head"><h3>任务窗口</h3><button type="button" id="cx-new" class="btn btn-blue btn-sm">＋ 新窗口</button></div><input id="cx-search" class="cx-search" type="search" placeholder="查找窗口" aria-label="查找任务窗口"><div id="cx-windows" class="cx-window-list"></div></aside>'+
      '<main class="cx-main"><div id="cx-window-toolbar" class="cx-window-toolbar"><button type="button" id="cx-window-toggle" class="btn btn-outline btn-sm cx-window-toggle" aria-expanded="false" aria-controls="cx-window-sidebar">窗口</button><div class="cx-window-heading"><h3 id="cx-window-title">选择或新建任务窗口</h3><p id="cx-window-meta"></p></div><details class="cx-window-menu"><summary aria-label="窗口操作">···</summary><div class="cx-window-actions"><button type="button" id="cx-rename" class="btn btn-outline btn-sm">改名</button><button type="button" id="cx-close-window" class="btn btn-outline btn-sm">关闭窗口</button><button type="button" id="cx-delete-window" class="btn btn-outline btn-sm">删除</button></div></details></div>'+
      '<div id="cx-feed" class="cx-feed" aria-label="Codex 任务记录"><div class="cx-empty"><span aria-hidden="true">&gt;_</span><h3>从一个任务开始</h3><p>新窗口会创建独立的 Codex 会话。执行进展、命令输出和修改结果都会留在这里。</p></div></div>'+
      '<section id="cx-schedules" class="cx-schedules" aria-label="定时任务" hidden></section><div id="cx-pending" class="cx-pending" role="region" aria-label="需要你回复的问题" aria-live="polite"></div><form id="cx-compose" class="cx-compose"><label class="cx-visually-hidden" for="cx-input">任务或补充指令</label><textarea id="cx-input" rows="2" placeholder="输入任务，或在执行中补充指令…"></textarea><div class="cx-schedule-bar"><label for="cx-schedule-time">执行时间 <span>（北京时间，可不选）</span></label><input id="cx-schedule-time" type="datetime-local" step="60" aria-label="执行时间（北京时间，可不选）"><button id="cx-schedule-clear" type="button" class="btn btn-outline btn-sm" hidden>清除时间</button><small id="cx-draft-status" role="status"></small></div><div class="cx-compose-bar"><label><span class="cx-visually-hidden">供应商</span><select id="cx-profile" aria-label="供应商与模型"></select></label><span id="cx-effort" class="cx-effort"></span><span id="cx-usage"></span><button type="button" id="cx-stop" class="btn btn-outline btn-sm" hidden>停止任务</button><button type="submit" id="cx-send" class="btn btn-blue btn-sm">开始执行</button></div><small id="cx-compose-hint">关闭页面不影响执行。不同窗口可以同时执行任务。</small></form></main></div>'+
      '<section id="cx-api" class="cx-api" hidden><div class="cx-section-heading"><div><h3>Codex API 配置</h3><p>每个供应商单独保存，下次任务生效。密钥加密保存，无需设置密码。</p></div><button id="cx-add-profile" type="button" class="btn btn-outline btn-sm">添加供应商</button></div><div id="cx-profiles"></div><p id="cx-api-state" class="cx-muted" role="status"></p></section>'+
      '<section id="cx-info" class="cx-info" hidden><h3>工作资料与维护</h3><div id="cx-info-content"></div><button id="cx-reconnect" type="button" class="btn btn-outline btn-sm">任务中心连接设置</button></section>'+
      '</section>';
    document.body.append(root);
    $('exit').onclick=close;
    ['tasks','api','info'].forEach(function(name){$('tab-'+name).onclick=function(){showTab(name);};});
    $('refresh').onclick=function(){refresh(true);};
    $('new').onclick=createWindow;
    $('window-toggle').onclick=function(){var open=$('tasks').classList.toggle('cx-sidebar-open');$('window-toggle').setAttribute('aria-expanded',String(open));};
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
    root.addEventListener('keydown',function(e){
      e.stopPropagation(); // CK gateway authentication remains pending behind this independent view.
      if(root.querySelector('dialog[open]'))return;
      if(e.key==='Escape'){e.preventDefault();close();}
      if(e.key==='Tab'){
        var nodes=Array.from(root.querySelectorAll('button,input,select,textarea,a,summary')).filter(function(n){return !n.disabled&&n.getClientRects().length;});
        if(!nodes.length)return;var first=nodes[0],last=nodes[nodes.length-1];
        if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}
      }
    });
  }
  function resizeInput(){var input=$('input');input.style.height='auto';input.style.height=Math.min(180,input.scrollHeight)+'px';}
  function close(){saveDraft();generation++;clearTimeout(timer);root.hidden=true;document.body.classList.remove('cx-open');if(previousFocus&&previousFocus.isConnected)previousFocus.focus();}
  function showTab(name){
    tab=name;['tasks','api','info'].forEach(function(n){$(n).hidden=!config||n!==name;$('tab-'+n).classList.toggle('active',n===name);$('tab-'+n).setAttribute('aria-current',n===name?'page':'false');});
    $('login').hidden=!!config;
    if(!config){$('endpoint').value=endpoint;return;}
    if(name==='api'&&!formDirty)renderApi();
    if(name==='info')renderInfo();
  }
  function renderWindows(){
    var query=$('search').value.trim().toLowerCase(), list=$('windows');list.replaceChildren();
    windows.filter(function(w){return !query||w.title.toLowerCase().includes(query);}).forEach(function(w){
      var b=node('button','cx-window'+(w.id===selected?' active':''));b.type='button';b.dataset.status=w.status;
      b.append(node('strong','',w.title),node('span','',(labels[w.status]||w.status)+(w.scheduled_count?' · '+w.scheduled_count+' 个定时任务':'')),node('small','',stamp(w.updated)));
      b.onclick=function(){select(w.id);};list.append(b);
    });
    if(!list.childElementCount)list.append(node('p','cx-muted',windows.length?'没有匹配的窗口':'还没有窗口，点击「新窗口」。'));
  }
  function renderToolbar(){
    if(!config)return;
    var w=current(), running=w&&['queued','starting','running','waiting'].includes(w.status);
    var timed=!!$('schedule-time').value;
    $('window-title').textContent=w?w.title:'选择或新建任务窗口';
    $('window-meta').textContent=w?(labels[w.status]||w.status)+' · '+(w.thread_id?'Codex '+w.thread_id.slice(0,8):'正在创建'):'每个窗口都有自己的任务记录';
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
    if(w&&w.error)message(w.error,true);
    $('compose-hint').textContent=timed?'按北京时间执行，退出页面仍有效；窗口忙碌时等待空闲。':w&&w.status==='closed'?'窗口已关闭，记录保留。点击「重新打开」继续。':w&&w.status==='queued'?'任务已提交，正在启动。':w&&w.status==='running'?'正在服务器执行。可以补充指令，或选择时间安排下一任务。':'不选时间即刻执行。Ctrl / ⌘ + Enter 发送；关闭页面不影响执行。';
  }
  function copy(text){navigator.clipboard.writeText(text).then(function(){message('已复制');}).catch(function(){message('复制失败，请选中文字手动复制',true);});}
  function card(item){
    var titles={userMessage:'你的任务',agentMessage:item.data.phase==='final_answer'?'完成回复':'Codex',reasoning:'思考摘要',commandExecution:'执行命令',fileChange:'修改文件',diff:'本轮改动',plan:'执行计划',warning:'运行提示',resolved:'已处理',contextCompaction:'已整理上下文'};
    var el=node('article','cx-item cx-item-'+item.kind);el.dataset.itemId=item.id;
    if(!['userMessage','agentMessage','plan','reasoning','warning','contextCompaction'].includes(item.kind)){
      var details=node('details','cx-detail'), summary=node('summary');
      summary.textContent=titles[item.kind]||'执行命令';
      details.append(summary,node('pre','',[item.data.command,item.text].filter(Boolean).join('\n\n')||'正在执行…'));el.append(details);
    }else{
      var head=node('header','cx-item-head');head.append(node('strong','',titles[item.kind]),node('time','',stamp(item.created)));
      if(item.text)head.append(button('复制',function(){copy(item.text);},'cx-copy'));
      el.append(head,node('div','cx-text',item.text|| (item.kind==='contextCompaction'?'Codex 已压缩当前上下文，继续任务。':'正在处理…')));
    }
    return el;
  }
  function renderFeed(changed, reset){
    var feed=$('feed'),nearEnd=feed.scrollHeight-feed.scrollTop-feed.clientHeight<100;
    if(reset)feed.replaceChildren();
    changed.forEach(function(item){
      items.set(item.id,item);
      if(item.kind==='request'||item.kind==='resolved')return;
      var old=Array.from(feed.children).find(function(n){return n.dataset.itemId===item.id;}), el=card(item);
      if(old){var openedDetail=old.querySelector('details[open]');if(openedDetail&&el.querySelector('details'))el.querySelector('details').open=true;old.replaceWith(el);}else feed.append(el);
    });
    if(!feed.childElementCount){var empty=node('div','cx-empty');empty.append(node('span','','>_'),node('h3','','窗口已准备好'),node('p','','输入任务后，Codex 会在美国 VPS 上开始执行。'));feed.append(empty);}
    if(changed.length&&feed.querySelector('.cx-empty')&&feed.childElementCount>1)feed.querySelector('.cx-empty').remove();
    if(nearEnd||reset)feed.scrollTop=feed.scrollHeight;
    renderPending();
  }
  function renderPending(){
    var pending=$('pending');var live=Array.from(items.values()).filter(function(item){return item.kind==='request';});
    var signature=JSON.stringify(live.map(function(i){return [i.id,i.seq];}));if(pending.dataset.signature===signature)return;
    pending.dataset.signature=signature;pending.replaceChildren();
    live.forEach(function(item){
      var event=item.data, box=node('form','cx-question');box.setAttribute('role','alert');box.append(node('h4','','需要你回复 · Codex 正在等待'));
      if(event.method==='item/tool/requestUserInput'){
        (event.params.questions||[]).forEach(function(q){
          var label=node('label','',q.question), input=node('textarea');input.name=q.id;input.rows=2;input.required=true;label.append(input);box.append(label);
          (q.options||[]).forEach(function(opt){box.append(button(opt.label,function(){input.value=opt.label;},'btn-outline'));});
        });
        var submit=node('button','btn btn-blue btn-sm','回复并继续');submit.type='submit';box.append(submit);
        box.onsubmit=function(e){e.preventDefault();var answers={};box.querySelectorAll('textarea').forEach(function(n){answers[n.name]=n.value;});act('answer',{request_id:String(event.id),answers:answers});};
      }else if(['item/commandExecution/requestApproval','item/fileChange/requestApproval'].includes(event.method)){
        box.append(node('p','cx-text',event.params.reason||event.params.command||'请核对这次操作'));
        ['accept','decline','cancel'].forEach(function(d,i){box.append(button(['允许这次操作','不允许','停止任务'][i],function(){act('answer',{request_id:String(event.id),decision:d});}));});
      }else{box.append(node('p','cx-text','收到暂不支持的交互请求：'+event.method+'。可停止任务后调整指令。'),button('停止任务',function(){act('stop');}));}
      pending.append(box);
    });
  }
  async function select(id){
    saveDraft();
    $('tasks').classList.remove('cx-sidebar-open');$('window-toggle').setAttribute('aria-expanded','false');
    selected=id;cursor=0;items.clear();$('feed').replaceChildren();$('pending').replaceChildren();delete $('pending').dataset.signature;
    restoreDraft(id);schedules=[];renderSchedules();localStorage.setItem('ck_codex_selected',id);generation++;
    renderWindows();renderToolbar();await refresh(false);
  }
  async function refresh(full){
    if(!opened()||loading)return;
    loading=true;clearTimeout(timer);var token=generation, id=selected;
    try{
      if(!access){showTab(tab);return;}
      if(!config||full){config=await request('/config');if(token!==generation)return;showTab(tab);}
      var response=await request('/threads');if(token!==generation)return;windows=response.windows;
      if(selected&&!windows.some(function(w){return w.id===selected;})){removeDraft(selected);selected='';cursor=0;items.clear();$('feed').replaceChildren();schedules=[];renderSchedules();restoreDraft('');}
      if(!selected&&windows.length){selected=windows[0].id;id=selected;cursor=0;items.clear();restoreDraft(id);localStorage.setItem('ck_codex_selected',id);}
      renderWindows();renderToolbar();$('connection').textContent='已连接';$('connection').dataset.state='ok';
      if(selected){id=selected;var snapshot=await request('/threads/'+id+'?after='+cursor);if(token!==generation||id!==selected)return;
        var reset=cursor===0;cursor=snapshot.cursor;windows=windows.map(function(w){return w.id===id?Object.assign({},w,snapshot.window):w;});renderFeed(snapshot.items,reset);
        var next=snapshot.schedules||[];if(JSON.stringify(schedules)!==JSON.stringify(next)){schedules=next;renderSchedules();}renderToolbar();}
      if(full&&!(current()&&current().error))message('已同步服务器状态');
    }catch(e){
      if(token!==generation)return;message(e.message,true);$('connection').textContent='连接待恢复';$('connection').dataset.state='error';
      if(e.status===401){config=null;showTab(tab);}
    }finally{
      loading=false;if(opened()&&!document.hidden){var w=current();timer=setTimeout(function(){refresh(false);},w&&['running','starting','waiting'].includes(w.status)?900:4000);}
    }
  }
  async function createWindow(){
    if(busy)return;busy=true;$('new').disabled=true;message('正在创建 Codex 会话…');
    var key=sessionStorage.getItem('ck_codex_create')||uid();sessionStorage.setItem('ck_codex_create',key);
    try{var w=await request('/threads',{request_id:key,title:'新任务',profile:config.default_profile});sessionStorage.removeItem('ck_codex_create');windows.unshift(w);await select(w.id);message('新窗口已创建');}
    catch(e){message(e.message,true);}finally{busy=false;$('new').disabled=false;renderToolbar();}
  }
  async function renameWindow(){var w=current();if(!w)return;var title=await taskDialog('窗口名称','为这个任务取一个便于查找的名称。',w.title);if(title)act('rename',{title:title});}
  async function deleteWindow(){
    var w=current();if(!w)return;
    if(await taskDialog('删除 Codex 窗口','删除「'+w.title+'」？当前任务会停止，定时任务会取消，草稿、CK 记录与对应 Codex 会话会一起删除。已修改的项目文件保留。'))act('delete');
  }
  async function act(name,body){
    if(!selected||busy)return;busy=true;renderToolbar();var id=selected;
    try{await request('/threads/'+id+'/'+name,body||{});if(name==='delete'){removeDraft(id);if(selected===id){selected='';cursor=0;items.clear();$('feed').replaceChildren();restoreDraft('');schedules=[];renderSchedules();}}message({stop:'当前任务已停止，待执行的定时任务保留',close:'窗口已关闭，定时任务已取消，草稿与记录保留',reopen:'窗口已重新打开',delete:'窗口、草稿与 Codex 会话已删除',rename:'名称已更新',profile:'已切换接口',answer:'已回复','cancel-schedule':'定时任务已取消'}[name]||'已完成');await refresh(false);}
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
      message(mode==='schedule'?'已安排 '+scheduleStamp(due)+'（北京时间）执行':mode==='steer'?'补充指令已发送':'任务已提交到服务器');await refresh(false);}
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
    footer.append(button('刷新模型',function(){pickModel(true);}));
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
  window.ckOpenCodex=async function(name){make();previousFocus=document.activeElement;root.hidden=false;document.body.classList.add('cx-open');selected=selected||localStorage.getItem('ck_codex_selected')||'';if(draftOwner!==selected)restoreDraft(selected);showTab(name||'tasks');$('exit').focus();await loadAccess();if(opened())refresh(true);};
  document.addEventListener('visibilitychange',function(){if(document.hidden){if(root)saveDraft();clearTimeout(timer);}else if(opened())refresh(false);});
  window.addEventListener('pagehide',function(){if(root)saveDraft();});
  window.addEventListener('online',function(){if(opened())refresh(false);});
  function openLinkedTab(){if(location.hash==='#codex-tasks'||location.hash==='#codex-api')window.ckOpenCodex(location.hash==='#codex-api'?'api':'tasks');}
  window.addEventListener('hashchange',openLinkedTab);
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',openLinkedTab,{once:true});else openLinkedTab();
})();
