(async()=>{
 const check=(v,m)=>{if(!v)throw Error(m)},pause=ms=>new Promise(r=>setTimeout(r,ms));
 const wait=async f=>{for(let i=0;i<100;i++){if(f())return;await pause(20)}throw Error('Timed out waiting for UI')};
 const $=id=>document.getElementById(id),click=selector=>{const node=document.querySelector(selector);check(node,'Missing '+selector);check(!node.disabled,'Disabled '+selector);node.click()};
 const input=(id,value)=>{$(id).value=value;$(id).dispatchEvent(new Event('input',{bubbles:true}))};
 panelAuthKey='fixture-key';localStorage.setItem(API_KEY_STORAGE,panelAuthKey);panelAppStarted=false;
 apiProvidersLoaded=true;apiProviders={provider_library:{providers:[{id:'test-provider',name:'试验供应商',url:'https://synthetic.invalid/v1',key:'fixture',model:'model-test',models:['model-test']}]} ,recall_rewrite:{current:'test-provider',model:'model-test'},recall_vector:{current:'test-provider',model:'model-test'}};
 $('loading-wrap').classList.add('done');
 const facts=Array.from({length:31},(_,i)=>({fact_id:'fact-'+i,text:i===0?'六月讨论旅行安排 <img src=x onerror="window.bad=1">':'合成旅行材料 '+i,time:'2026.06.'+String(i%28+1).padStart(2,'0'),status:'active',category:'旅行',source:{},history:[]}));
 let store={ok:true,revision:0,topics:[{id:'seed_topic',title:'旅行的前因后果',group_title:'旅行与生活',summary:'先计划旅行，后来落实出发 <script>window.bad=5</script>',note:'把时间和细节串起来',aliases:['出发'],recall_enabled:true,materials:facts.slice(),changed_count:0},{id:'friend_topic',title:'一次久别重逢',group_title:'朋友',summary:'重逢时的交谈和约定',note:'',aliases:[],recall_enabled:true,materials:facts.slice(0,2),changed_count:0}]},failSave=false,conflict=false,probeFailure=false,holdProbe=null;

 facts[2].text='出发之前反复讨论的安排。'.repeat(60);facts[0].time='2026.10.2';facts[1].time='2026.2.3';
 const calls=[],response=(data,status=200)=>({ok:status<400,status,json:async()=>JSON.parse(JSON.stringify(data))});
 window.fetch=async(url,init={})=>{
   const u=new URL(String(url)),body=init.body?JSON.parse(init.body):null;u.pathname=u.pathname.replace(/^\/gateway(?=\/)/,'');calls.push({path:u.pathname,query:u.search,body});
   if(u.pathname==='/ck/memory-topics'){
     if(init.method==='POST'){
       check(body.action!=='suggest','Removed material finder must not call models');
       if(failSave){failSave=false;return response({ok:false,error:'合成保存失败'},503)}
       if(conflict)return response({ok:false,error:'目录已有更新'},409);
       if(body.action==='delete')store.topics=store.topics.filter(t=>t.id!==body.id);
       else{const t={id:body.id,title:body.title,group_title:body.group_title,summary:body.summary_text===undefined?(store.topics.find(t=>t.id===body.id)||{}).summary||'摘要待整理':body.summary_text,note:body.note,aliases:body.aliases,recall_enabled:body.recall_enabled,materials:body.fact_ids.map(id=>facts.find(f=>f.fact_id===id)),changed_count:0};const at=store.topics.findIndex(x=>x.id===t.id);if(at<0)store.topics.unshift(t);else store.topics[at]=t}
       store.revision++;
     }
     store.topic_groups=store.topics.length?[{title:store.topics[0].group_title,summary:'旅行计划与后续经历 <script>window.bad=6</script>'}]:[];return response(store);
   }
   if(u.pathname==='/entity-facts'){const start=Number(u.searchParams.get('offset')||0),limit=Number(u.searchParams.get('limit')||100),items=facts.slice(start,start+limit);return response({ok:true,items,source:'standalone',generation:'fixture',counts:{},facets:{},pagination:{total:31,next_offset:start+items.length,has_more:start+items.length<31}})}
   if(u.pathname.startsWith('/entity-facts/'))return response({ok:true,item:facts.find(f=>f.fact_id===decodeURIComponent(u.pathname.split('/').pop())),generation:'fixture'});
   if(u.pathname==='/ck/recall-experiment'){
     if(holdProbe){const pending=holdProbe;holdProbe=null;await pending}
     if(probeFailure&&body.path==='b')return response({ok:false,error:'合成模型故障'},503);
     const items=body.path==='a'?[{fact_id:'fact-0',situation:'旅行安排'}]:[{fact_id:'fact-0',situation:'旅行安排'},{fact_id:'fact-1',situation:'补充材料'}];
     return response({ok:true,path:body.path,simulation:true,injected:false,statistics_recorded:false,elapsed_seconds:.4,items,text:'测试记忆 <script>window.bad=2</script>',warnings:[],diag:{candidate_preview:[{fact_id:'fact-0',selected:true,content_preview:facts[0].text,similarity:.8,score:.9}],filter_reasons:{low_score:1}}});
   }
   throw Error('Unexpected network request '+u.pathname);
 };

 navTo('topics');await wait(()=>$('mw-status').textContent.includes('目录已同步'));
 check(calls.length===1&&calls[0].path==='/ck/memory-topics','Opening topics must not call models');
 check(document.querySelectorAll('.mw-group-card').length===2,'Top page must show large topics');
 check(!document.querySelector('.mw-leaf-card'),'Small topics appeared on the top page');
 check(!$('mw-search-form')&&!$('mw-query')&&!document.querySelector('[data-mw="suggest"]'),'Material finder was not removed');
 input('mw-directory-query','不存在');check(document.querySelectorAll('.mw-group-card').length===0,'Directory filter failed');input('mw-directory-query','');
 async function openSeed(){
   if($('mw-title')){click('[data-mw="root"]');await wait(()=>!$('mw-title'));}
   click('[data-mw="group"][data-group="旅行与生活"]');await wait(()=>document.querySelector('[data-mw="select"][data-id="seed_topic"]'));
   check($('mw-breadcrumb').textContent.includes('旅行与生活'),'Breadcrumb missing');
   click('[data-mw="select"][data-id="seed_topic"]');await wait(()=>$('mw-title'));
 }
 await openSeed();check(document.querySelectorAll('#mw-materials .mw-material').length===30,'Initial material page must be bounded');
 check(document.querySelector('#mw-materials time').textContent==='2026.10.2','Recent-first date sorting failed');
 click('#mw-material-more');check(document.querySelectorAll('#mw-materials .mw-material').length===31,'Material pagination failed');
 $('mw-material-order').value='oldest';$('mw-material-order').dispatchEvent(new Event('change',{bubbles:true}));
 check(document.querySelector('#mw-materials time').textContent==='2026.2.3','Timeline sorted dates as text');
 input('mw-material-query','合成旅行材料 30');check(document.querySelectorAll('#mw-materials .mw-material').length===1,'Detail search failed');input('mw-material-query','');
 check(document.querySelector('.mw-long-material')&&!document.querySelector('.mw-long-material').open,'Long material should be folded');
 check(!window.bad&&!document.querySelector('#tab-topics img')&&!document.querySelector('#tab-topics script'),'Topic or Fact HTML was not escaped');
 $('mw-material-order').value='recent';$('mw-material-order').dispatchEvent(new Event('change',{bubbles:true}));
 click('#mw-materials [data-mw="fact"][data-id="fact-0"]');await wait(()=>$('eg-detail-body').textContent.includes('六月讨论'));closeEntityDetail();
 document.querySelector('.mw-edit-panel').open=true;
 input('mw-summary','我记下了她从计划出发到回程的经历。');input('mw-aliases','日本行程，东京行');
 failSave=true;click('#mw-save');await wait(()=>$('mw-status').textContent.includes('草稿已保留'));
 const failedBody=JSON.stringify(calls.filter(c=>c.body&&c.path==='/ck/memory-topics').at(-1).body);
 navTo('recall-lab');navTo('topics');check($('mw-summary').value.includes('回程'),'Navigation lost summary draft');
 click('#mw-save');await wait(()=>$('mw-status').textContent.includes('你的修改已生效'));
 check(failedBody===JSON.stringify(calls.filter(c=>c.body&&c.path==='/ck/memory-topics').at(-1).body),'Retry changed receipt');
 check(document.querySelector('.mw-reader-summary').textContent.includes('回程'),'Manual summary not shown');
 $('mw-enabled').click();await wait(()=>!store.topics.find(t=>t.id==='seed_topic').recall_enabled&&!$('mw-enabled').disabled);
 check($('mw-draft-status').textContent==='已保存','Switch did not give saved feedback');
 $('mw-enabled').click();await wait(()=>store.topics.find(t=>t.id==='seed_topic').recall_enabled&&!$('mw-enabled').disabled);
 input('mw-title','本机新草稿');conflict=true;click('#mw-save');await wait(()=>$('mw-status').textContent.includes('先复制草稿'));
 check($('mw-save').disabled&&$('mw-title').value==='本机新草稿','Conflict overwrote draft or allowed stale retry');
 click('[data-mw="reload"]');await wait(()=>ckDialogState.resolve);ckDialogSubmit();await wait(()=>$('mw-status').textContent.includes('目录已同步'));conflict=false;
 check($('mw-title').value==='旅行的前因后果','Reload did not restore latest');
 click('[data-mw="new"]');await wait(()=>$('mw-title')&&$('mw-title').value==='');
 check($('mw-save').disabled,'Empty title cannot save');input('mw-title','旅行手册 <script>window.bad=3</script>');input('mw-note','把出发前的计划与路上的小事放在一起。');input('mw-group','旅行与生活');
 click('#mw-save');await wait(()=>$('mw-status').textContent.includes('你的修改已生效'));
 check(store.topics.length===3&&!window.bad,'New topic failed or executed HTML');
 click('[data-mw="root"]');await wait(()=>document.querySelectorAll('.mw-group-card').length===2);
 await openSeed();
 const preLab=calls.filter(c=>c.path==='/ck/recall-experiment').length;
 navTo('recall-lab');input('mw-lab-query','旅行安排是什么？');
 check(calls.filter(c=>c.path==='/ck/recall-experiment').length===preLab,'Typing invoked a model');
 $('mw-lab-form').requestSubmit();await wait(()=>$('mw-lab-status').textContent.includes('共同选中'));
 check(calls.filter(c=>c.path==='/ck/recall-experiment').length===preLab+2,'Compare must run each path once');
 check($('mw-lab-status').textContent.includes('只有 B 1 条'),'Comparison sets incorrect');check(!window.bad&&!document.querySelector('#mw-comparison script'),'Unescaped result');
 probeFailure=true;$('mw-lab-form').requestSubmit();await wait(()=>$('mw-lab-status').textContent.includes('1 个方案未成功'));
 check($('mw-comparison').textContent.includes('合成模型故障')&&$('mw-comparison').textContent.includes('选中 1 条'),'Partial failure erased success');
 click('[data-mw="api"]');check(currentApiTab==='experiment','Provider page navigation failed');
 check(document.querySelector('[data-group="recall_rewrite"]')&&document.querySelector('[data-group="recall_vector"]'),'Existing provider pickers missing');
 check(document.getElementById('api-config-body').textContent.includes('修改后也会影响正常 Fact 召回'),'Shared config implication missing');

 navTo('topics');
 const themeSave=calls.filter(c=>c.body&&c.body.action==='save'&&c.body.id==='seed_topic').at(-1).body;
 check(themeSave.aliases.length===2&&themeSave.recall_enabled===true,'Alias/recall settings lost');
 click('[data-mw="topic-api"]');check(currentApiTab==='topics'&&document.querySelector('[data-group="topic_materials"]'),'Theme supplier selection missing');
 check(document.querySelector('[data-subtab="topics"].active'),'Theme API navigation missing');
 navTo('recall-lab');probeFailure=false;$('mw-lab-mode').value='all';$('mw-lab-form').requestSubmit();await wait(()=>$('mw-lab-status').textContent.includes('实验完成'));
 check($('mw-comparison').textContent.includes('C · 主题脉络'),'C comparison missing');
 check(calls.filter(c=>c.path==='/ck/recall-experiment').at(-1).body.path==='c','C request not sent');
 check(chatNormalizeFactRecallMode('c')==='c'&&chatFactRecallModeMeta('c').shortLabel==='C','C config normalized away');
 check(document.querySelector('input[name="chat-fact-recall-mode"][value="c"]'),'C chat selector missing');
 $('mw-lab-mode').value='both';
 // A delayed response from one Key must never populate another Key's page.
 probeFailure=false;navTo('recall-lab');
 let release;holdProbe=new Promise(r=>release=r);$('mw-lab-form').requestSubmit();
 await wait(()=>$('mw-lab-run').disabled);await pause(30);
 panelAuthKey='other-key';localStorage.setItem(API_KEY_STORAGE,panelAuthKey);navTo('recall-lab');release();await pause(40);
 check(!$('mw-comparison').textContent.trim()&&!$('mw-lab-query').value,'Delayed results leaked across Keys');
 panelAuthKey='fixture-key';localStorage.setItem(API_KEY_STORAGE,panelAuthKey);navTo('topics');await wait(()=>$('mw-status').textContent.includes('目录已同步'));
 await openSeed();
 // The shared auth helper may try a replacement Key: the write URL callback must refuse.
 input('mw-title','不应跨 Key 保存的草稿');const auth=ensurePanelAuthenticated,writes=calls.filter(c=>c.path==='/ck/memory-topics'&&c.body).length;
 ensurePanelAuthenticated=async()=> 'replacement-key';click('#mw-save');await wait(()=>$('mw-status').textContent.includes('Key 已变化'));ensurePanelAuthenticated=auth;
 check(calls.filter(c=>c.path==='/ck/memory-topics'&&c.body).length===writes,'Write replayed under another Key');
 click('[data-mw="reload"]');await wait(()=>ckDialogState.resolve);ckDialogSubmit();await wait(()=>$('mw-status').textContent.includes('目录已同步'));
 // Keep a resolved example for visual inspection.
 probeFailure=false;navTo('recall-lab');input('mw-lab-query','旅行安排是什么？');$('mw-lab-form').requestSubmit();await wait(()=>$('mw-lab-status').textContent.includes('共同选中'));
 window.mwFixture={calls,check,wait,showTopics:()=>navTo('topics'),showLab:()=>navTo('recall-lab'),root:async()=>{navTo('topics');click('[data-mw="root"]');await wait(()=>document.querySelector('.mw-group-card')&&!$('mw-topics-list').hidden)},children:async()=>{await mwFixture.root();click('[data-mw="group"][data-group="旅行与生活"]');await wait(()=>document.querySelector('.mw-leaf-card'))},detail:async()=>{await mwFixture.root();await openSeed()}};
 return {topics:'three-level directory/search/material paging/manual summary/switch/save retry/conflict/detail',lab:'manual only, A/B sets, partial failure, shared provider selectors',escaped:true,calls:calls.length};
})()
