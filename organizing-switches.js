/* Durable organizing controls on the status page. */
(function(){
  'use strict';
  var names={fact:'Fact 整理',topics:'主题整理',events:'事件整理',records:'每日整理'};
  var state=null,sequence=0,timer=0,busy=false;
  function node(id){return document.getElementById(id)}
  function identity(section){return section==='records'?chatEndpoint(chatLoadConfig())+'|'+chatLoadConfig().panelKey:GRAPH_API_BASE+'|'+storedPanelKey()}
  function enabled(section,data){return section==='topics'?data.overview.settings.enabled:section==='events'?data.control.enabled:data.enabled}
  async function request(section,body){
    var principal=identity(section);
    var cfg=section==='records'?chatLoadConfig():null;
    var path=section==='fact'?'/ck/fact-control':section==='events'?'/ck/event-automation':body?'/ck/memory-topics':'/ck/maintenance/status?section=topics&refresh=1';
    var controller=new AbortController(),timeout=setTimeout(function(){controller.abort()},45000);
    var options={cache:'no-store',signal:controller.signal};
    if(body)Object.assign(options,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    try{
      var response=cfg?await fetch(chatEndpoint(cfg).replace(/\/chat$/,'/daily-records')+'?key='+encodeURIComponent(cfg.panelKey),options):await panelDataFetch(function(){if(identity(section)!==principal)throw new Error('连接已变化');return GRAPH_API_BASE+path},options,{label:'整理开关'});
      var data=await response.json();if(!response.ok||data.ok===false)throw new Error(data.error||'开关暂时无法读取');
      if(section==='topics'&&body)data={overview:{settings:data.organizer.settings},revision:data.revision};
      if(typeof enabled(section,data)!=='boolean')throw new Error('服务尚未返回开关状态');
      return data;
    }finally{clearTimeout(timeout)}
  }
  function render(message){
    var section=ckStatusTab,box=node('ck-organizing-control');if(!box)return;
    box.hidden=!names[section];if(box.hidden)return;
    node('ck-organizing-title').textContent=names[section];
    var button=node('ck-organizing-toggle'),valid=state&&state.section===section&&state.identity===identity(section);
    button.disabled=busy||!valid;button.setAttribute('aria-label',names[section]);
    button.setAttribute('aria-checked',String(!!(valid&&state.enabled)));
    node('ck-organizing-label').textContent=busy?'正在保存…':valid?(state.enabled?'已开启':'已关闭'):'读取中…';
    node('ck-organizing-note').textContent=message||(valid?(state.enabled?'按已有进度自动调用模型整理。':'已暂停调用模型；成果和进度保留，下次开启继续整理。'):'正在读取已保存的开关状态…');
  }
  function schedule(){clearTimeout(timer);timer=setTimeout(function(){if(currentPanelTab==='status'&&!document.hidden)refresh();else schedule()},15000)}
  async function refresh(){
    if(busy)return;var section=ckStatusTab;if(!names[section]){render();return}
    var id=identity(section),seq=++sequence;render();
    try{var data=await request(section);if(seq!==sequence||section!==ckStatusTab||id!==identity(section))return;state={section:section,identity:id,enabled:enabled(section,data),data:data};render()}
    catch(error){if(seq===sequence&&section===ckStatusTab&&id===identity(section)){state=null;render('读取未完成：'+(error.name==='AbortError'?'连接超时':error.message)+'。点击页面刷新重试。')}}
    finally{schedule()}
  }
  window.ckOrganizingEnter=function(){++sequence;clearTimeout(timer);state=null;render();refresh()};
  node('ck-organizing-toggle').addEventListener('click',async function(){
    if(busy||!state||state.section!==ckStatusTab||state.identity!==identity(ckStatusTab))return;
    var selected=state,section=selected.section,desired=!selected.enabled,id=selected.identity;++sequence;busy=true;render();
    var body=section==='fact'?{enabled:desired,revision:selected.data.revision}:section==='topics'?{action:desired?'organizer_start':'organizer_pause',expected_revision:selected.data.revision,request_id:crypto.randomUUID().replace(/-/g,'')}:{action:desired?'resume':'pause'};
    try{
      var data=await request(section,body);
      if(section!==ckStatusTab||id!==identity(section))return;
      state={section:section,identity:id,enabled:enabled(section,data),data:data};
      if(section==='records'&&typeof ckRecordsRefresh==='function')ckRecordsRefresh();
      else if(section==='fact')loadDailyStatus(false);else ckRefreshMaintenance(true);
    }catch(error){
      if(section===ckStatusTab&&id===identity(section)){state=null;render('保存未确认：'+(error.name==='AbortError'?'连接超时':error.message)+'。正在核对实际状态…')}
    }finally{busy=false;if(section===ckStatusTab&&id===identity(section))render();refresh()}
  });
  if(currentPanelTab==='status')window.ckOrganizingEnter();
})();
