(async()=>{
 const check=(v,m)=>{if(!v)throw Error(m)},pause=ms=>new Promise(r=>setTimeout(r,ms));
 const wait=async f=>{for(let i=0;i<100;i++){if(f())return;await pause(20)}throw Error('Timed out waiting for UI')};
 const $=id=>document.getElementById(id),click=selector=>{const node=document.querySelector(selector);check(node,'Missing '+selector);check(!node.disabled,'Disabled '+selector);node.click()};
 const input=(id,value)=>{$(id).value=value;$(id).dispatchEvent(new Event('input',{bubbles:true}))};
 panelAuthKey='fixture-key';localStorage.setItem(API_KEY_STORAGE,panelAuthKey);panelAppStarted=false;
 apiProvidersLoaded=true;apiProviders={provider_library:{providers:[{id:'test-provider',name:'试验供应商',url:'https://synthetic.invalid/v1',key:'fixture',model:'model-test',models:['model-test']}]} ,recall_rewrite:{current:'test-provider',model:'model-test'},recall_vector:{current:'test-provider',model:'model-test'}};
 $('loading-wrap').classList.add('done');
 const facts=Array.from({length:31},(_,i)=>({fact_id:'fact-'+i,text:i===0?'六月讨论旅行安排 <img src=x onerror="window.bad=1">':'合成旅行材料 '+i,time:'2026.06.'+String(i%28+1).padStart(2,'0'),status:'active',category:'旅行',source:{},history:[]}));
 let store={ok:true,revision:0,topics:[]},failSave=false,conflict=false,probeFailure=false,holdProbe=null;

 facts[0].time='2026.10.2';facts[1].time='2026.2.3';
 const calls=[],response=(data,status=200)=>({ok:status<400,status,json:async()=>JSON.parse(JSON.stringify(data))});
 window.fetch=async(url,init={})=>{
   const u=new URL(String(url)),body=init.body?JSON.parse(init.body):null;u.pathname=u.pathname.replace(/^\/gateway(?=\/)/,'');calls.push({path:u.pathname,query:u.search,body});
   if(u.pathname==='/ck/memory-topics'){
     if(init.method==='POST'){
       if(body.action==='suggest')return response({ok:true,items:facts.filter(f=>!body.exclude_ids.includes(f.fact_id)).slice(0,3).map((f,i)=>({...f,stamp:'fixture-stamp',recommended:i<2})),scanned:5100,candidate_count:3,recommended_count:2,warnings:[]});
       if(failSave){failSave=false;return response({ok:false,error:'合成保存失败'},503)}
       if(conflict)return response({ok:false,error:'目录已有更新'},409);
       if(body.action==='delete')store.topics=store.topics.filter(t=>t.id!==body.id);
       else{const t={id:body.id,title:body.title,group_title:body.group_title,note:body.note,aliases:body.aliases,recall_enabled:body.recall_enabled,materials:body.fact_ids.map(id=>facts.find(f=>f.fact_id===id)),changed_count:0};const at=store.topics.findIndex(x=>x.id===t.id);if(at<0)store.topics.unshift(t);else store.topics[at]=t}
       store.revision++;
     }
     return response(store);
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
 click('[data-mw="new"]');await wait(()=>$('mw-title'));
 check($('mw-save').disabled,'Empty title cannot save');input('mw-title','旅行手册 <script>window.bad=3</script>');input('mw-note','把出发前的计划与路上的小事放在一起。');
 input('mw-group','旅行与生活 <script>window.bad=4</script>');
 input('mw-query','旅行');$('mw-search-form').requestSubmit();await wait(()=>document.querySelectorAll('.mw-search-result').length===30);
 check(calls.at(-1).query.includes('state=active'),'Topic search includes expired Facts');
 check(!$('mw-results').textContent.includes('已过期'),'Expired candidate visible');
 input('mw-query','尚未提交的新查询');click('#mw-more');await wait(()=>document.querySelectorAll('.mw-search-result').length===31);
 const searchCall=calls.filter(c=>c.path==='/entity-facts').at(-1);check(searchCall.query.includes('offset=30')&&searchCall.query.includes(encodeURIComponent('旅行')),'Paging changed query before a new search');
 click('[data-mw="add"][data-id="fact-0"]');check(document.querySelector('[data-mw="add"][data-id="fact-0"]').disabled,'Duplicate add allowed');
 failSave=true;click('#mw-save');await wait(()=>$('mw-status').textContent.includes('草稿已保留'));check($('mw-title').value.includes('旅行手册'),'Failed save lost draft');
 const failedBody=JSON.stringify(calls.filter(c=>c.body&&c.path==='/ck/memory-topics').at(-1).body);
 navTo('recall-lab');check($('mw-lab-form'),'Lab navigation missing');navTo('topics');check($('mw-title').value.includes('旅行手册'),'Navigation discarded draft');
 click('#mw-save');await wait(()=>$('mw-status').textContent==='主题已保存。');
 check(failedBody===JSON.stringify(calls.filter(c=>c.body&&c.path==='/ck/memory-topics').at(-1).body),'Retry changed receipt');
 check(document.querySelectorAll('.mw-topic-link').length===1,'Saved topic missing');check(!window.bad&&!document.querySelector('#tab-topics img'),'Unescaped topic or fact content');
 check(document.querySelector('.mw-topic-group summary').textContent.includes('旅行与生活'),'Parent missing');
 check($('mw-group').value===store.topics[0].group_title,'Parent not persisted');
 const parent=document.querySelector('.mw-topic-group');check(parent.open,'Selected child must expand parent');parent.open=false;check(!parent.open,'Parent cannot collapse');parent.open=true;
 click('#mw-materials [data-mw="fact"]');await wait(()=>$('eg-detail-body').textContent.includes('六月讨论'));closeEntityDetail();
 input('mw-title','本机新草稿');conflict=true;click('#mw-save');await wait(()=>$('mw-status').textContent.includes('载入最新'));check($('mw-save').disabled&&$('mw-title').value==='本机新草稿','Conflict overwrote draft or allowed stale retry');
 click('[data-mw="reload"]');await wait(()=>ckDialogState.resolve);ckDialogSubmit();await wait(()=>$('mw-status').textContent.includes('目录已同步'));conflict=false;
 check($('mw-title').value.includes('旅行手册'),'Reload did not restore latest');
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
 // Theme workflow reuses Facts, saves reviewed suggestions and offers C.
 navTo('topics');input('mw-aliases','日本行程，东京行');
 click('[data-mw="suggest"]');await wait(()=>$('mw-search-status').textContent.includes('检索 5100'));
 check(document.querySelectorAll('[data-mw-pick]:checked').length===2,'Suggested candidates must be reviewable');
 click('[data-mw="add-selected"]');check($('mw-material-count').textContent.includes('3 / 200'),'Bulk add failed');
 check(document.querySelector('#mw-materials time').textContent==='2026.2.3','Timeline sorted dates as plain text');
 click('#mw-save');await wait(()=>$('mw-status').textContent==='主题已保存。');
 const themeSave=calls.filter(c=>c.body&&c.body.action==='save').at(-1).body;
 check(themeSave.aliases.length===2&&themeSave.recall_enabled===true,'Alias/recall settings lost');
 click('[data-mw="topic-api"]');check(currentApiTab==='topics'&&document.querySelector('[data-group="topic_materials"]'),'Theme supplier selection missing');
 check(document.querySelector('[data-subtab="topics"].active'),'Theme API must also appear in API navigation');
 navTo('recall-lab');probeFailure=false;$('mw-lab-mode').value='all';$('mw-lab-form').requestSubmit();await wait(()=>$('mw-lab-status').textContent.includes('实验完成'));
 check($('mw-comparison').textContent.includes('C · 主题辅助'),'C comparison missing');
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
 // The shared auth helper may try a replacement Key: the write URL callback must refuse.
 input('mw-title','不应跨 Key 保存的草稿');const auth=ensurePanelAuthenticated,writes=calls.filter(c=>c.path==='/ck/memory-topics'&&c.body).length;
 ensurePanelAuthenticated=async()=> 'replacement-key';click('#mw-save');await wait(()=>$('mw-status').textContent.includes('Key 已变化'));ensurePanelAuthenticated=auth;
 check(calls.filter(c=>c.path==='/ck/memory-topics'&&c.body).length===writes,'Write replayed under another Key');
 click('[data-mw="reload"]');await wait(()=>ckDialogState.resolve);ckDialogSubmit();await wait(()=>$('mw-status').textContent.includes('目录已同步'));
 // Keep a resolved example for visual inspection.
 probeFailure=false;navTo('recall-lab');input('mw-lab-query','旅行安排是什么？');$('mw-lab-form').requestSubmit();await wait(()=>$('mw-lab-status').textContent.includes('共同选中'));
 window.mwFixture={calls,check,wait,showTopics:()=>navTo('topics'),showLab:()=>navTo('recall-lab')};
 return {topics:'create/search/paging/deduplicate/save retry/conflict/detail',lab:'manual only, A/B sets, partial failure, shared provider selectors',escaped:true,calls:calls.length};
})()
