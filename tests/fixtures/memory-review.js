(async()=>{
 const check=(v,m)=>{if(!v)throw Error(m)},pause=ms=>new Promise(r=>setTimeout(r,ms));
 const wait=async f=>{for(let i=0;i<150;i++){if(f())return;await pause(20)}throw Error('Timed out waiting for review UI')};
 const $=id=>document.getElementById(id),click=s=>{let n=document.querySelector(s);check(n&&!n.disabled,'Unavailable '+s);n.click()};
 const input=(selector,value)=>{let n=document.querySelector(selector);n.value=value;n.dispatchEvent(new Event('input',{bubbles:true}))};
 panelAuthKey='fixture-key';localStorage.setItem(API_KEY_STORAGE,panelAuthKey);panelAppStarted=false;document.getElementById('loading-wrap').classList.add('done');
 const facts=[{fact_id:'f1',text:'看房后决定六月搬家。 <img src=x onerror="window.bad=1">',time:'2026-06-01'},{fact_id:'f2',text:'六月搬家，签订租房合同。',time:'2026-06-03'}];
 const proposal=n=>({id:'proposal_'+n,title:'六月搬家',status:'pending',target_topic_id:'',fact_ids:['f1','f2'],reason:'看房与签约可能是同一次搬家。',uncertainties:['需要核对地址'],evidence:[{fact_id:'f1',quote:'看房后决定六月搬家。'}],materials:facts});
 let store={ok:true,revision:1,topics:[],organizer:{settings:{enabled:true,daily_calls:30,batch_size:8},pending:[proposal(1),proposal(2)],pending_count:2,operations:[],decisions:[],progress:{checked:8,total:100},usage:{date:'2026-10-02',calls:1},last_run:{status:'ok'}}};
 let fail=false,conflict=false;const requests=[];
 const response=(data,status=200)=>({ok:status<400,status,json:async()=>JSON.parse(JSON.stringify(data))});
 window.fetch=async(url,init={})=>{
  const u=new URL(url);u.pathname=u.pathname.replace(/^\/gateway(?=\/)/,'');
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
    if(body.decision==='approve')store.topics.push({id:'topic_approved',title:body.title,materials:facts,aliases:[],note:''});
   }else if(body.action==='organizer_settings')store.organizer.settings=body.settings;
   else if(body.action==='organizer_start'){store.organizer.settings.enabled=true;store.organizer.running=true;store.organizer.trigger='requested';store.organizer.last_run={status:'running'}}
   else if(body.action==='organizer_pause'){store.organizer.settings.enabled=false;store.organizer.running=false;delete store.organizer.trigger;store.organizer.last_run={status:'paused'}}
   store.revision++;
  }
  return response(store);
 };
 navTo('topics');await wait(()=>$('mw-organizer').textContent.includes('2 项待审批'));
 check(document.querySelectorAll('[data-proposal]').length===2,'Cards missing');
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
 check(document.querySelectorAll('.mw-topic-link').length===1,'Approved theme not refreshed');
 check(!window.bad,'Opinion HTML executed');
 // Leave an example for desktop/mobile visual review.
 store.organizer.pending=[proposal(3)];store.organizer.pending_count=1;
 click('[data-mr="refresh"]');await wait(()=>document.querySelector('[data-proposal="proposal_3"]'));
 return {immediateStart:true,pause:true,opinionSurvivesPause:true,optionalOpinion:true,opinionSurvivesTabsAndFailures:true,retryReceipt:true,conflictRefresh:true,approval:true,recheck:true,escaped:true};
})()
