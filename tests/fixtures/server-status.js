(async()=>{
 const assert=(v,m)=>{if(!v)throw Error(m)},pause=ms=>new Promise(r=>setTimeout(r,ms));
 let calls=0;
 const old=window.fetch,oldAuth=storedPanelKey;
 storedPanelKey=()=> 'synthetic-panel-key';
 window.fetch=async(url,opts)=>{calls++;assert(opts.headers['x-api-key']==='synthetic-panel-key','missing panel auth header');
  return new Response(JSON.stringify(url.endsWith('/health')?{status:'ok'}:{platform:'vps',resource_metrics_available:true,updated_at:Date.now()/1000,cpu_percent:15.6,uptime_seconds:78*86400+9*3600,memory:{used:2.6*1073741824,total:3.5*1073741824,percent:73.3},disk:{used:30.7*1073741824,total:39*1073741824,percent:78.7},services:[{name:'CK 网关',state:'ok'},{name:'记忆服务',state:'ok'},{name:'Claude Code',state:'ok',active_sessions:1},{name:'SSH',state:'reachable'}]}),{headers:{'Content-Type':'application/json'}})};
 try{
  ckOpenServerStatus();await pause(70);
  const box=document.getElementById('ck-server-dialog');
  assert(box.textContent.includes('15.6%')&&box.textContent.includes('78天 9时'),'metrics not rendered');
  assert(box.querySelector('.ck-server-card').scrollWidth<=box.querySelector('.ck-server-card').clientWidth+1,'status card overflows');
  const screenshot=window.__captureStatus; // CDP harness captures this open state separately.
  document.querySelector('[data-mode=aliyun]').click();await pause(40);
  assert(!box.querySelector('progress'),'FC incorrectly shows host resource bars');
  document.querySelector('[data-mode=vps]').click();await pause(40);
  window.__closeStatusTest=()=>{document.getElementById('ck-server-close').click();window.fetch=old;storedPanelKey=oldAuth;};
  return {metrics:true,auth:true,fcDistinct:true,calls};
 }catch(e){window.fetch=old;storedPanelKey=oldAuth;throw e}
})()
