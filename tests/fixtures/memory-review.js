(async()=>{
 const check=(v,m)=>{if(!v)throw Error(m)},pause=ms=>new Promise(r=>setTimeout(r,ms));
 const wait=async f=>{for(let i=0;i<150;i++){if(f())return;await pause(20)}throw Error('Timed out waiting for review UI')};
 const $=id=>document.getElementById(id),click=s=>{let n=document.querySelector(s);check(n&&!n.disabled,'Unavailable '+s);n.click()};
 const input=(selector,value)=>{let n=document.querySelector(selector);n.value=value;n.dispatchEvent(new Event('input',{bubbles:true}))};
 panelAuthKey='fixture-key';localStorage.setItem(API_KEY_STORAGE,panelAuthKey);panelAppStarted=false;document.getElementById('loading-wrap').classList.add('done');
 const facts=[{fact_id:'f1',text:'看房后决定六月搬家。 <img src=x onerror="window.bad=1">',time:'2026-06-01'},{fact_id:'f2',text:'六月搬家，签订租房合同。',time:'2026-06-03'}];
 const proposal=n=>({id:'proposal_'+n,title:'六月搬家',status:'pending',target_topic_id:'',fact_ids:['f1','f2'],reason:'看房与签约可能是同一次搬家。',uncertainties:['需要核对地址'],evidence:[{fact_id:'f1',quote:'看房后决定六月搬家。'}],materials:facts});
 facts.forEach(f=>f.status='active');
 let store={ok:true,revision:1,topics:[],organizer:{settings:{enabled:true,daily_calls:30,batch_size:8},pending:[proposal(1),proposal(2)],pending_count:2,operations:[],decisions:[],progress:{checked:8,total:100},usage:{date:'2026-10-02',calls:1},last_run:{status:'ok'}}};
 let fail=false,conflict=false;const requests=[];
 const response=(data,status=200)=>({ok:status<400,status,json:async()=>JSON.parse(JSON.stringify(data))});
 window.fetch=async(url,init={})=>{
  const u=new URL(url);u.pathname=u.pathname.replace(/^\/gateway(?=\/)/,'');
  if(u.pathname==='/ck/maintenance/status')return response({ok:true,overview:store.organizer,topic_count:store.topics.length,summaries:{total:store.topics.length,ready:0},history:{items:[],next_cursor:null}});
  if(u.pathname==='/ck/fact-daily/status')return response({ok:true});
  if(u.pathname!='/ck/memory-topics')throw Error('Unexpected '+u.pathname);
  if(init.body){const body=JSON.parse(init.body);requests.push(body);
   if(fail){fail=false;return response({ok:false,error:'合成保存失败'},503)}
   if(conflict){conflict=false;store.revision++;return response({ok:false,error:'目录有并发更新'},409)}
   check(body.expected_revision===store.revision,'Bad revision');
   if(body.action==='organizer_review'){
    const p=store.organizer.pending.find(p=>p.id===body.proposal_id);
    store.organizer.decisions.unshift({...p,decision:body.decision,opinion:body.opinion,at:'2026-10-02'});
    store.organizer.pending=store.organizer.pending.filter(p=>p.id!==body.proposal_id);
    store.organizer.pending_count=store.organizer.pending.length;
    if(body.decision==='approve'){
     const target=store.topics.find(t=>t.id===body.target_topic_id);
     if(target){if(body.rename_to)target.title=body.rename_to;if(p.kind==='group')target.group_title=p.group_title;else if(p.kind!=='rename')target.materials.push(...p.materials)}
     else store.topics.push({id:'topic_approved',title:body.title,materials:facts.slice(),aliases:[],note:''});
    }
   }else if(body.action==='organizer_settings')store.organizer.settings=body.settings;
   else if(body.action==='organizer_start'){store.organizer.settings.enabled=true;store.organizer.running=true;store.organizer.trigger='requested';store.organizer.last_run={status:'running'}}
   else if(body.action==='organizer_pause'){store.organizer.settings.enabled=false;store.organizer.running=false;delete store.organizer.trigger;store.organizer.last_run={status:'paused'}}
   store.revision++;
  }
  return response(store);
 };
 navTo('topics');await wait(()=>$('mw-organizer').textContent.includes('2 项待审批'));navTo('status');ckSelectStatusTab('topics');$('ck-topic-controls').open=true;await pause(30);
 check(document.querySelectorAll('[data-proposal]').length===2,'Cards missing');
 check($('mw-organizer').textContent.includes('待加入材料（尚未加入目标主题）'),'Candidate membership ambiguous');
 check(document.querySelector('.mr-materials input').getClientRects().length>0,'Candidates hidden');
 check(!window.bad&&!document.querySelector('#mw-organizer img'),'Fact HTML executed');
 const selector='[data-proposal="proposal_1"] ';
 input(selector+'[data-mr-field="opinion"]','这是六月那次，请把七月的材料分开。');
 click('[data-mr="pause"]');await wait(()=>!store.organizer.settings.enabled&&!document.querySelector('[data-mr="start"]').disabled);
 check(document.querySelector(selector+'textarea').value.includes('七月'),'Pause lost opinion');
 click('[data-mr="start"]');await wait(()=>store.organizer.running&&document.querySelector('[data-mr="start"]').disabled);
 check(!document.querySelector('[data-mr="pause"]').disabled,'Running state must allow pause');
 click('[data-mr="pause"]');await wait(()=>!store.organizer.running&&!document.querySelector('[data-mr="start"]').disabled);
 click('[data-mr="tab-opinions"]');click('[data-mr="tab-pending"]');
 check(document.querySelector(selector+'textarea').value.includes('七月'),'Tab lost opinion');
 fail=true;click(selector+'[data-mr="recheck"]');await wait(()=>$('mw-organizer').textContent.includes('合成保存失败'));
 const failed=JSON.stringify(requests.at(-1));
 check(document.querySelector(selector+'textarea').value.includes('七月'),'Failure lost opinion');
 click(selector+'[data-mr="recheck"]');await wait(()=>!document.querySelector(selector.trim()));
 check(JSON.stringify(requests.at(-1))===failed,'Retry lost idempotency receipt');
 check(store.topics.length===0,'Recheck prematurely approved materials');
 click('[data-mr="tab-opinions"]');check($('mw-organizer').textContent.includes('七月'),'Saved opinion not visible');
 click('[data-mr="tab-pending"]');
 const second='[data-proposal="proposal_2"] ';
 input(second+'[data-mr-field="opinion"]','<script>window.bad=2</script>需要核对地址');
 conflict=true;click(second+'[data-mr="approve"]');await wait(()=>$('mw-organizer').textContent.includes('并发更新'));
 check(document.querySelector(second+'textarea').value.includes('核对地址'),'Conflict lost opinion');
 input(second+'[data-mr-field="opinion"]','');
 click(second+'[data-mr="approve"]');await wait(()=>store.topics.length===1&&document.querySelectorAll('[data-proposal]').length===0);
 check(requests.at(-1).opinion==='','Opinion must be optional');
 check(requests.at(-1).fact_ids.length===2,'Batch approval lost members');
 check(document.querySelectorAll('.mw-group-card').length===1,'Approved theme not refreshed');
 check(!window.bad,'Opinion HTML executed');
 // Settings remain editable across refreshes, failures and concurrent worker writes.
 document.querySelector('.mr-settings').open=true;
 input('#mr-daily','500');input('#mr-batch','10');
 click('[data-mr="refresh"]');await wait(()=>$('mw-organizer').textContent.includes('已刷新'));
 check($('mr-daily').value==='500'&&$('mr-batch').value==='10','Refresh lost settings draft');
 check(document.querySelector('.mr-settings').open,'Refresh closed settings');
 fail=true;click('[data-mr="settings"]');await wait(()=>$('mw-organizer').textContent.includes('设置未保存成功'));
 check($('mr-daily').value==='500'&&$('mr-batch').value==='10','Failure lost settings');
 conflict=true;click('[data-mr="settings"]');await wait(()=>$('mw-organizer').textContent.includes('并发更新'));
 check($('mr-daily').value==='500'&&$('mr-batch').value==='10','Conflict lost settings');
 click('[data-mr="settings"]');await wait(()=>$('mw-organizer').textContent.includes('设置已保存：每日最多 500 次，每批 10 份'));
 check(store.organizer.settings.daily_calls===500&&store.organizer.settings.batch_size===10,'Settings payload wrong');
 click('[data-mr="refresh"]');await wait(()=>$('mw-organizer').textContent.includes('已刷新'));
 check($('mr-daily').value==='500'&&$('mr-batch').value==='10','Saved settings did not persist');
 const count=requests.length;input('#mr-daily','1001');click('[data-mr="settings"]');
 check(requests.length===count&&$('mw-organizer').textContent.includes('设置未保存：'),'Invalid settings submitted');
 input('#mr-daily','500');click('[data-mr="settings"]');await wait(()=>$('mw-organizer').textContent.includes('设置已保存：'));
 // Existing-topic names can be changed with new materials or separately, without re-approval of members.
 const existing=store.topics[0];
 store.organizer.pending=[{...proposal(3),target_topic_id:existing.id,fact_ids:['f3'],materials:[{fact_id:'f3',text:'六月搬家，搬运家具到新家。',time:'2026-06-05',status:'active'}]}];store.organizer.pending_count=1;
 click('[data-mr="refresh"]');await wait(()=>document.querySelector('[data-proposal="proposal_3"]'));
 check(document.querySelector('[data-proposal="proposal_3"] [data-mr="approve"]').textContent==='加入所选材料','Approval action unclear');
 check(document.querySelectorAll('.mr-materials input').length===1,'Existing members offered for approval');
 check(document.querySelector('.mr-reference').textContent.includes('无需审批'),'Existing evidence not separated');
 input('[data-proposal="proposal_3"] [data-mr-field="rename_to"]','从看房签约到入住新家');
 check(document.querySelector('[data-proposal="proposal_3"] [data-mr="approve"]').textContent==='加入材料并更新名称','Combined rename action unclear');
 click('[data-proposal="proposal_3"] [data-mr="approve"]');await wait(()=>!document.querySelector('[data-proposal="proposal_3"]'));
 check(existing.title==='从看房签约到入住新家'&&existing.materials.length===3,'Append and rename not applied');
 store.organizer.pending=[{...proposal(4),kind:'rename',target_topic_id:existing.id,rename_to:'居住变化与搬家经历',materials:[],reference_materials:facts}];store.organizer.pending_count=1;
 click('[data-mr="refresh"]');await wait(()=>document.querySelector('[data-proposal="proposal_4"]'));
 check(document.querySelectorAll('.mr-materials input').length===0,'Rename offered existing materials as membership choices');
 check(document.querySelector('[data-proposal="proposal_4"]').textContent.includes('本次只调整名称'),'Rename purpose unclear');
 check(!document.querySelector('[data-proposal="proposal_4"] [data-mr-field="target"]'),'Rename allowed unrelated target mutation');
 input('[data-proposal="proposal_4"] [data-mr-field="rename_to"]','');
 const beforeEmpty=requests.length;click('[data-proposal="proposal_4"] [data-mr="approve"]');
 check(requests.length===beforeEmpty,'Empty rename submitted');
 input('[data-proposal="proposal_4"] [data-mr-field="rename_to"]','<img src=x onerror="window.bad=3">居住变化');
 click('[data-mr="tab-opinions"]');click('[data-mr="tab-pending"]');
 check(!window.bad,'Rename escaped incorrectly');
 input('[data-proposal="proposal_4"] [data-mr-field="rename_to"]','从寻找住处到安顿新家的经历');
 conflict=true;click('[data-proposal="proposal_4"] [data-mr="approve"]');await wait(()=>$('mw-organizer').textContent.includes('并发更新'));
 check(document.querySelector('[data-proposal="proposal_4"] [data-mr-field="rename_to"]').value==='从寻找住处到安顿新家的经历','Conflict lost new name');
 click('[data-proposal="proposal_4"] [data-mr="approve"]');await wait(()=>!document.querySelector('[data-proposal="proposal_4"]'));
 check(existing.title==='从寻找住处到安顿新家的经历'&&existing.materials.length===3,'Rename-only changed membership');
 store.organizer.pending=[{...proposal(6),kind:'group',target_topic_id:existing.id,group_title:'居住与生活',materials:[],reference_materials:facts}];store.organizer.pending_count=1;
 click('[data-mr="refresh"]');await wait(()=>document.querySelector('[data-proposal="proposal_6"]'));
 check(!document.querySelector('[data-proposal="proposal_6"] .mr-materials'),'Grouping reapproves existing facts');
 check(!document.querySelector('[data-proposal="proposal_6"] [data-mr-field="rename_to"]'),'Grouping asks to rename child');
 check(document.querySelector('[data-proposal="proposal_6"]').textContent.includes('居住与生活'),'Parent destination missing');
 click('[data-proposal="proposal_6"] [data-mr="approve"]');await wait(()=>!document.querySelector('[data-proposal="proposal_6"]'));
 check(existing.group_title==='居住与生活'&&existing.materials.length===3,'Grouping changed membership');
 // Leave the rename-only example visible for desktop/mobile screenshots.
 store.organizer.pending=[{...proposal(5),kind:'rename',target_topic_id:existing.id,rename_to:'从看房签约到在新家安顿的完整经历',materials:[],reference_materials:facts}];store.organizer.pending_count=1;
 click('[data-mr="refresh"]');await wait(()=>document.querySelector('[data-proposal="proposal_5"]'));
 return {settings500and10:true,settingsSurviveRefreshFailureAndConflict:true,immediateStart:true,pause:true,opinionSurvivesPause:true,optionalOpinion:true,opinionSurvivesTabsAndFailures:true,retryReceipt:true,conflictRefresh:true,approval:true,recheck:true,escaped:true};
})()
