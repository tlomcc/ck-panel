(async()=>{
 const check=(ok,msg)=>{if(!ok)throw Error(msg)};
 localStorage.clear();window.fetch=async()=>{throw Error('Offline notebook fixture')};
 apiProvidersLoaded=true;chatInitialized=false;chatSessionsReady=true;
 document.getElementById('loading-wrap').classList.add('done');
 apiProviders={};apiProviderLibrarySlot().providers=[
  {id:'mint',name:'薄荷小站',category:'日常聊天',url:'https://mint.example/v1',key:'fixture',model:'模型 A',models:['模型 A','模型 B'],note:'日常陪伴，慢慢聊。'},
  {id:'cloud',name:'云朵邮局',category:'工作学习',url:'https://cloud.example/v1',key:'fixture',model:'模型 C',models:['模型 C'],note:'阅读与写作'}];
 const now=Date.now();
 chatMessages=[{role:'user',text:'今天窗台的小植物又长出了一片新叶子。',turnId:'one',ts:now-60000,cacheState:'full',cacheRead:5000,cacheInputTotal:5500,cacheRatio:91},{role:'assistant',text:'那我们把这件小事记下来吧。🌱\n\n等下次再看，它就又长大一点了。',turnId:'one',ts:now-59000}];
 chatSessions=[{id:'notebook',title:'薄荷小站 · 模型 A',messages:chatMessages,transportMessages:[],updated:now}];chatActiveSessionId='notebook';
 let cfg=chatLoadConfig();cfg.sessionId='notebook';cfg.worldbooks=[{id:'leaf',name:'我们的日常',priority:100,enabled:true,content:'认真听彼此说话，也收藏生活里微小的快乐。\n\n窗台上有一盆正在长新叶子的植物。'}];
 chatSaveConfigObject(cfg);chatWriteForm(cfg);chatRenderMessages({force:true});chatRenderSessions();
 const ids=[...document.querySelectorAll('[id]')].map(e=>e.id);check(ids.length===new Set(ids).size,'Duplicate IDs');
 const panels=[...document.querySelectorAll('.chat-side-panel')];
 const geometry=[];
 for(const panel of panels){
  const key=panel.id.replace('chat-side-','');chatOpenSettingTab(key);
  check(panel.classList.contains('active'),'Destination inactive: '+key);
  check(panel.scrollWidth<=panel.clientWidth+2,'Panel overflow: '+key+' '+panel.scrollWidth+'/'+panel.clientWidth);
  check(panel.querySelector(key==='worldbook'?'.chat-worldbook-intro':'.ck-notebook-heading'),'Missing chapter: '+key);
  const heading=panel.querySelector(key==='worldbook'?'.chat-worldbook-intro':'.ck-notebook-heading');
  check(heading.getBoundingClientRect().width<=panel.clientWidth,'Heading overflow: '+key);
  geometry.push({key,width:panel.clientWidth});
 }
 chatOpenSettingTab('billing');chatRenderTickLegend();
 const states=['full','partial','created','below_minimum','miss','sent'];
 const probe=document.createElement('div');probe.innerHTML=states.map(cacheState=>chatCacheTickHtml({cacheState})).join('');document.body.append(probe);
 const colors=states.map((state,index)=>{
  const message=probe.children[index],legend=document.querySelector('.chat-tick-legend .chat-cache-tick.'+state);
  const color=getComputedStyle(message).color;
  check(legend&&getComputedStyle(legend).color===color,'Legend/message mismatch: '+state);
  check(message.querySelector('svg').getAttribute('viewBox')===(index<2?'0 0 18 14':'0 0 15 14'),'Single/double tick shape: '+state);
  check(message.getAttribute('aria-label').includes(index<2?'双对号':'单对号'),'Missing non-color description: '+state);
  return color;
 });
 check(new Set(colors).size===6,'Cache colors are not distinct');probe.remove();
 // The legend remains visible even when polling hides message ticks.
 document.body.classList.add('chat-hide-tick');check(getComputedStyle(document.querySelector('.chat-tick-legend .chat-cache-tick')).display!=='none','Hidden legend');document.body.classList.remove('chat-hide-tick');
 window.notebookShow=async function(destination){
  closeToast();chatToggleSearch(false);chatToggleSettings(false);chatToggleSessions(false);closeSidebar();
  const isPage=['overview','facts','status','providers','main','polling','api-memory','recall'].includes(destination);
  document.body.classList.toggle('chat-active',!isPage);
  document.querySelectorAll('.panel-tab').forEach(e=>e.classList.toggle('active',e.id==='tab-'+(isPage?(['overview','facts','status'].includes(destination)?destination:'apiconfig'):'chat')));
  document.getElementById('sub-tabs').style.display=isPage&&!['overview','facts','status'].includes(destination)?'flex':'none';
  if(!isPage&&destination!=='chat'&&destination!=='drawer')chatOpenSettingTab(destination);
  if(destination==='drawer')chatToggleSessions(true);
  if(destination==='billing'){
   document.querySelector('.chat-tick-legend-card').open=true;
   document.querySelector('.chat-tick-legend-card').scrollIntoView({block:'start'});
  }
  if(isPage&&!['overview','facts','status'].includes(destination)){currentApiTab=destination==='api-memory'?'memory':destination;renderApiConfig()}
  if(destination==='overview'||destination==='facts'){
   const facts={counts:{active:128,total:130,expired:2,vector_ok:126,vector_missing:2,recalled:42,recall_count_total:186},facets:{categories:[{value:'生活日常',count:48},{value:'偏好',count:32}],people:[{value:'小克',count:26}]},updated:'2026-09-27 14:30',pagination:{total:2,has_more:false},items:[{id:'plant',text:'窗台的小植物长出了一片新叶子。',category:'生活日常',time:'2026-09-27',status:'active',recall_count:2},{id:'quiet',text:'喜欢慢慢聊天，把日常的小事情收藏起来。',category:'偏好',time:'2026-09-26',status:'active',recall_count:8}]};
   if(destination==='overview')renderArchiveFactOverview(facts);
   else{factLibraryItems=facts.items;renderFactLibrary(facts);document.getElementById('facts-status').textContent='已读取当前事实库。'}
  }
  if(destination==='status')renderDailyStatus({today:'2026-09-27',now:'2026-09-27 14:30',fact_daily:{status:'running',target_date:'2026-09-26',stage:'audit',stage_label:'质量审核',stage_position:3,stage_total:7,provider_name:'薄荷小站',model:'模型 A',stats:{candidates:128,audited:96,verified:84,final_facts:72,segments:18},api_stats:{http_calls:48,http_ok:46,http_failed:2,input_tokens:123000,output_tokens:16000,seconds_total:186}}});
  await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
  const target=document.querySelector('.panel-tab.active');
  const overflow=[...target.querySelectorAll('*')].filter(e=>e.getBoundingClientRect().right>target.getBoundingClientRect().right+2).map(e=>e.className).slice(0,8);
  check(target.scrollWidth<=target.clientWidth+2,'Page overflow: '+destination+' '+target.scrollWidth+'/'+target.clientWidth+' '+JSON.stringify(overflow));
  document.querySelectorAll('*').forEach(e=>{e.style.setProperty('transition','none','important');e.style.setProperty('animation','none','important')});
  return {destination,width:innerWidth};
 };
 await notebookShow('model');
 return {destinations:geometry,colors};
})()
