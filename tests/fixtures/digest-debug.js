(async()=>{
 const check=(ok,message)=>{if(!ok)throw Error(message)};
 document.getElementById('loading-wrap').classList.add('done');
 document.getElementById('loading-wrap').remove();
 document.body.classList.add('chat-active');
 const settings=document.querySelector('.chat-settings');settings.classList.add('open');
 document.querySelectorAll('.chat-side-panel').forEach(n=>n.classList.remove('active'));
 const debug=document.getElementById('chat-side-debug');debug.classList.add('active');
 debug.closest('details')?.setAttribute('open','');
 const now=Date.now();
 const data={request_id:'dg-synthetic-test',session_id:'fixture',phase:'failed',ok:false,mode:'compact_day',tier:'y',day_key:'2026-10-03',trigger:'manual_trim',batch:2,batches:3,input_messages:8,input_chars:11200,output_chars:0,provider:'测试供应商',model:'测试模型',http_status:503,duration_ms:180123,client_duration_ms:180400,attempt_count:2,retry_count:1,error_code:'upstream_timeout',error:'等待供应商超时 <img src=x onerror="window.injected=1">',history_preserved:true,attempts:[{number:1,http_status:200,duration_ms:1500,max_tokens:16000,timeout_seconds:180,finish_reason:'length',usage:{prompt_tokens:8000,completion_tokens:16000}},{number:2,duration_ms:179800,max_tokens:32000,timeout_seconds:180,error:'等待总结供应商响应超时'}]};
 chatDebugRecords=[{ts:now,event:'digest_batch',data},
  {ts:now+1,event:'trim_result',data:{ok:false,before:230,after:230,trigger:'manual_trim',error:'总结失败',request_id:data.request_id}},
  {ts:now+2,event:'digest_batch',data:{...data,ok:true,phase:'generated',error:'',error_code:'',history_preserved:false,attempt_count:1,retry_count:0,attempts:data.attempts.slice(0,1),output_chars:900}},
  {ts:now+3,event:'trim_result',data:{ok:true,before:230,after:200,dropped:30,trigger:'manual_trim'}}];
 chatRenderDebugRecords();
 const rendered=document.getElementById('chat-debug-log')||debug;
 check(rendered.textContent.includes('服务器')||rendered.textContent.includes('生成成功'),'success must be visible');
 check(rendered.textContent.includes('上游 HTTP 200'),'attempt status must be visible');
 check(rendered.textContent.includes('原历史已保留'),'failed trim must state history retained');
 check(!window.injected&&!rendered.querySelector('img'),'error must render as text');
 check(chatDebugRecordTopic(chatDebugRecords[0],'')==='trim','new logs must appear in trim category');
 check(chatDebugRecordKind(chatDebugRecords[0],'')==='error','failure styling must survive refresh');
 const many=Array.from({length:700},(_,i)=>({ts:now+i,event:'usage',data:{}}));
 check(chatDebugPrune([chatDebugRecords[0],...many]).some(r=>r.event==='digest_batch'),'chat traffic must not immediately evict summary diagnostics');
 const oldFetch=window.fetch,oldLoad=chatLoadConfig,oldPanel=panelDataFetch;
 chatLoadConfig=()=>({panelKey:'fixture',sessionId:'fixture',gatewayUrl:'http://fixture.invalid'});
 let requestUrl='';panelDataFetch=async url=>{requestUrl=url;return {ok:true,json:async()=>({records:[{event:'digest_batch',ts_ms:now,debug_id:'server-one',data:{...data,request_id:'server-one'}}]})}};
 await chatRefreshGatewayDebug('trim');await chatRefreshGatewayDebug('trim');
 check(requestUrl.includes('topic=trim'),'summary button must use filtered server endpoint');
 check(chatDebugRecords.filter(r=>r.data?.phase==='server'&&r.data?.request_id==='server-one').length===1,'repeated refresh must not duplicate server record');
 panelDataFetch=oldPanel;chatLoadConfig=oldLoad;window.fetch=oldFetch;
 debug.querySelectorAll('details').forEach(n=>n.open=true);
 const box=debug.getBoundingClientRect();
 check(debug.scrollWidth<=debug.clientWidth+1,'summary logs overflow the debug panel');
 return {records:chatDebugRecords.length,panelWidth:box.width,viewport:innerWidth,escaped:!window.injected};
})()
