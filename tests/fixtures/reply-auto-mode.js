(async()=>{
 const check=(ok,message)=>{if(!ok)throw Error(message)};
 const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
 const until=async(test,message)=>{for(let i=0;i<250;i++){if(test())return;await pause(20)}throw Error(message)};
 const source=window.__streamSource.replace(/\r\n/g,'\n');
 const start=source.indexOf('  var streamRenderRaf=0,streamRenderDirty=false,streamRenderStopped=false;');
 const end=source.indexOf('  // CK_STREAM_END:',start);
 check(start>0&&end>start,'Missing production stream handler');
 const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
 const execute=new AsyncFunction('cfg','out','requestState',`
  var assistantText='',nativeThinkingText='',toolEvents=[],firstReplyTs=0,requestTurnId='auto-mode-turn',latencyTrace={},
      responseUserTs=Date.now(),userMessageIndexes=[0],requestBodyText='{}',recallInfo=null,requestUsage=null,requestCompleted=false,
      carriedReplyOwners=[],carriedReplyVariants=[],timeReminderContext={round:1},digestSync=null;
  function recordFirstDeltaLatency(){} function markFirstReplyTs(){return firstReplyTs||(firstReplyTs=Date.now())}
  ${source.slice(start,end)}
  return requestCompleted;
 `);
 const original={fetch:window.fetch,load:chatLoadConfig,delivery:chatReadDelivery,
  trim:chatMaybeAutoTrimAtIdleBoundary,clean:chatMaybeAutoClean,sync:chatScheduleNightlySync,recovery:chatScheduleRecovery};
 const short='甲'.repeat(74)+'，。！？；：“”「」（）……—\n'+'乙'.repeat(75)+'！';
 const finalText=short+'丙丁';
 const results=[];
 let requests=0,receipts=0;
 const visible=()=>Array.from(document.querySelectorAll('.chat-ephemeral-row .chat-bubble.assistant'))
  .filter(el=>!el.closest('.chat-msg-row').hidden&&!el.classList.contains('streaming-empty'));
 function proseLayout(bubble,text,phase){
  const p=bubble.querySelector('.chat-md > p');
  check(p&&p.innerText.replace(/\n+/g,'\n')===text,phase+': visible source newline was lost');
  const walk=document.createTreeWalker(p,NodeFilter.SHOW_TEXT),nodes=[];
  while(walk.nextNode())if(walk.currentNode.textContent)nodes.push(walk.currentNode);
  const before=document.createRange(),after=document.createRange();
  before.selectNodeContents(nodes[0]);after.selectNodeContents(nodes[1]);
  const previous=Array.from(before.getClientRects()).pop(),next=after.getClientRects()[0];
  check(next.top-previous.bottom>=parseFloat(getComputedStyle(p).fontSize)*.8,
   phase+': original prose lines lost their visible paragraph spacing');
 }
 const rich=[
  '第一行保留**重点文字**。',
  '第二行保留原来的换行，也让阅读有清楚的停顿。',
  '',
  '这是一段较长的回复，用来核对自动模式合并以后是否仍然保留小克的排版。正文达到一百五十字时，界面只需要合并消息气泡，标题、列表、空行和代码都应继续按原来的结构显示。',
  '',
  '### 原来的列表',
  '1. 保留第一项的编号与**加粗**。',
  '2. 保留第二项的编号与顺序。',
  '',
  '- 保留第一个要点。',
  '- 保留第二个要点。',
  '',
  '> 引用第一行。',
  '> 引用第二行。',
  '',
  '行内代码是 `mode = "auto"`，代码内容不应该丢失。',
  '',
  '```js',
  'const mode = "auto";',
  'const limit = 150;',
  '```',
  '',
  '最后一段也完整保留。'
 ].join('\n');
 function richLayout(bubble,phase){
  const md=bubble.querySelector('.chat-md');
  check(md&&md.querySelector('h3')?.textContent==='原来的列表',phase+': heading lost');
  check(md.querySelectorAll('strong').length===2,phase+': bold text lost');
  check(md.querySelectorAll('ol > li').length===2&&md.querySelectorAll('ul > li').length===2,phase+': list structure lost');
  check(md.querySelector('blockquote')?.innerText.includes('引用第一行。\n引用第二行。'),phase+': quoted line breaks lost');
  check(md.querySelector('p > code')?.textContent==='mode = "auto"',phase+': inline code lost');
  check(md.querySelector('.cb code')?.textContent==='const mode = "auto";\nconst limit = 150;',phase+': fenced code changed');
  const paragraphs=md.querySelectorAll(':scope > p');
  check(paragraphs.length===4,phase+': blank paragraphs lost');
  check(paragraphs[0].innerText.includes('重点文字。\n'),phase+': first source newline lost');
  const firstBox=paragraphs[0].getBoundingClientRect(),nextBox=paragraphs[1].getBoundingClientRect();
  const paragraphGap=nextBox.top-firstBox.bottom;
  check(paragraphGap>=12,phase+': blank paragraph gap collapsed: '+JSON.stringify({paragraphGap,first:firstBox.toJSON(),next:nextBox.toJSON(),margin:getComputedStyle(paragraphs[0]).margin}));
  check(paragraphs[3].textContent==='最后一段也完整保留。',phase+': final paragraph lost');
  check(md.scrollWidth<=md.clientWidth+2,phase+': reply overflow');
 }
 function reset(mode){
  chatFlushAssistantRevealQueue({render:false});
  chatMessages=[{role:'user',text:'合成测试：核对回复显示。',turnId:'auto-mode-turn',ts:Date.now(),inFlight:true,inFlightTurnId:'auto-mode-turn'}];
  chatSessions=[{id:'auto-mode-session',messages:chatMessages,transportMessages:[],updated:Date.now()}];
  chatActiveSessionId='auto-mode-session';chatSessionsReady=true;chatEditingIndex=-1;
  const cfg={...original.load(),sessionId:chatActiveSessionId,splitAssistantReplies:mode,recall:false,autoTrimEnabled:false,autoCleanEnabled:false};
  chatLoadConfig=()=>cfg;
  chatRenderMessages({force:true,removeEphemeral:true});chatTogglePlus(false);
  return cfg;
 }
 try{
  chatMaybeAutoTrimAtIdleBoundary=()=>{};chatMaybeAutoClean=()=>{};chatScheduleNightlySync=()=>{};chatScheduleRecovery=()=>{};
  for(const mode of [true,'auto',false]){
   const cfg=reset(mode);let controller;
   window.fetch=async(url,options={})=>{
    if(options.method!=='POST')return original.fetch(url,options);
    requests++;
    return new Response(new ReadableStream({start(c){controller=c}}),{headers:{'Content-Type':'text/event-stream'}});
   };
   const send=(event,value)=>controller.enqueue(new TextEncoder().encode('event: '+event+'\ndata: '+JSON.stringify(value)+'\n\n'));
   const request=chatBeginSendingUi();request.pendingMessages=[];chatStreamProgressStart();
   const running=execute(cfg,chatAddBubble('assistant','',false),request);
   await until(()=>controller,'No synthetic response stream');
   send('thinking',{text:'想'.repeat(500)});
   send('delta',{text:short});
   await until(()=>visible().map(x=>x.textContent).join('').replace(/\s/g,'')===short.replace(/\s/g,''),'149-character text missing');
   check(visible().length===(mode===false?1:2),'149 characters split incorrectly: '+mode);
   if(mode===false)proseLayout(visible()[0],short,'149 characters');
   const first=visible()[0];
   send('delta',{text:'丙'});
   await until(()=>visible().map(x=>x.textContent).join('').replace(/\s/g,'')===(short+'丙').replace(/\s/g,''),'150-character text missing');
   check(visible().length===(mode===true?2:1),'150 characters did not select the right mode: '+mode);
   check(visible()[0]===first,'Merging replaced the first bubble');
   if(mode!==true)proseLayout(first,short+'丙','150 characters');
   send('delta',{text:'丁'});
   await until(()=>visible().map(x=>x.textContent).join('').replace(/\s/g,'')===finalText.replace(/\s/g,''),'151-character text missing');
   send('done',{});
   check(await running,'Completion did not finish');
   const replies=chatMessages.filter(m=>m.role==='assistant');
   check(replies.length===(mode===true?2:1),'Completed reply lost the selected mode: '+mode);
   check(replies.map(m=>m.text).join('\n')===finalText,'Completion changed or duplicated text');
   check(replies[0].thinking==='想'.repeat(500),'Native thinking was lost');
   check(!document.querySelector('.chat-ephemeral-row'),'Preview bubbles survived completion');
   check(!chatAssistantRevealQueue?.hidden.size,'Merged text was hidden again');
   if(mode!==true)proseLayout(document.querySelector('.chat-bubble.assistant'),finalText,'completion');
   results.push({mode,stream149:true,stream150:true,stream151:true,complete:true,originalText:true,thinkingPreserved:true});
  }
  // A short completed answer must still split after long tagged/native thinking.
  {
   const cfg=reset('auto');
   window.fetch=async()=>{
    requests++;
    const payload='event: delta\ndata: '+JSON.stringify({text:'<think>'+'想'.repeat(500)+'</think>'+short})+'\n\nevent: done\ndata: {}\n\n';
    return new Response(payload,{headers:{'Content-Type':'text/event-stream'}});
   };
   const request=chatBeginSendingUi();request.pendingMessages=[];chatStreamProgressStart();
   check(await execute(cfg,chatAddBubble('assistant','',false),request),'Short response failed');
   chatFlushAssistantRevealQueue();
   check(chatMessages.filter(m=>m.role==='assistant').length===2,'Thinking pushed short body over the threshold');
   check(chatMessages[1].text.includes('想'.repeat(500)),'Tagged thinking was lost');
   results.push({mode:'auto',shortComplete:true,taggedThinkingExcluded:true});
  }
  for(const mode of ['auto',false]){
   const cfg=reset(mode);let controller;
   check(!chatShouldSplitAssistantReply(rich,'auto'),'Rich fixture is below the auto threshold');
   window.fetch=async(url,options={})=>{
    if(options.method!=='POST')return original.fetch(url,options);
    requests++;
    return new Response(new ReadableStream({start(c){controller=c}}),{headers:{'Content-Type':'text/event-stream'}});
   };
   const send=(event,value)=>controller.enqueue(new TextEncoder().encode('event: '+event+'\ndata: '+JSON.stringify(value)+'\n\n'));
   const request=chatBeginSendingUi();request.pendingMessages=[];chatStreamProgressStart();
   const running=execute(cfg,chatAddBubble('assistant','',false),request);
   await until(()=>controller,'No formatted response stream');
   const prefix=rich.indexOf('\n\n');
   send('delta',{text:rich.slice(0,prefix)});
   await until(()=>visible().length===(mode==='auto'?2:1),'Formatted prefix not displayed');
   const first=visible()[0];
   send('delta',{text:rich.slice(prefix)});
   await until(()=>visible().length===1&&visible()[0].innerText.includes('最后一段也完整保留。'),'Formatted stream not merged');
   check(visible()[0]===first,'Formatted merge replaced the first bubble');
   richLayout(first,'formatted stream');
   send('done',{});check(await running,'Formatted completion failed');
   const replies=chatMessages.filter(m=>m.role==='assistant');
   check(replies.length===1&&replies[0].text===rich,'Formatted completion changed the original response');
   richLayout(document.querySelector('.chat-bubble.assistant'),'formatted completion');
   check(chatMessageCopyText(replies[0])===rich,'Copy changed original formatting');
   results.push({mode,formattedStream:true,formattedCompletion:true,copyOriginal:true});
  }
  for(const [text,count] of [[short,2],[short+'丙',1],[rich,1]]){
   reset('auto');
   const postsBefore=requests;
   chatReadDelivery=async()=>{receipts++;return {found:true,turn_id:'auto-mode-turn',turn_matched:true,assistant_text:text,assistant_thinking:'恢复的思考',created_at:Math.floor(Date.now()/1000),tools:[]}};
   await chatRecoverInterruptedTurns({silent:true});
   await chatRecoverInterruptedTurns({silent:true});
   const replies=chatMessages.filter(m=>m.role==='assistant');
   check(replies.length===count,'Recovered reply discarded auto mode');
   check(replies.map(m=>m.text).join('\n')===text,'Recovery lost or duplicated text');
   check(requests===postsBefore,'Recovery resent the request');
   check(replies[0].thinking==='恢复的思考','Recovered thinking lost');
   if(text===rich)richLayout(document.querySelector('.chat-bubble.assistant'),'formatted recovery');
   else if(count===1)proseLayout(document.querySelector('.chat-bubble.assistant'),text,'recovery');
   results.push({mode:'auto',recoveryCount:count,noReplay:true,originalText:true});
  }
  check(requests===6&&receipts===3,'Unexpected chat request or repeated receipt');
  check(document.getElementById('chat-messages').scrollWidth<=document.getElementById('chat-messages').clientWidth+2,'Chat overflows horizontally');
  return {results,requests,receipts};
 }finally{
  window.fetch=original.fetch;chatLoadConfig=original.load;chatReadDelivery=original.delivery;
  chatMaybeAutoTrimAtIdleBoundary=original.trim;chatMaybeAutoClean=original.clean;
  chatScheduleNightlySync=original.sync;chatScheduleRecovery=original.recovery;
  chatFlushAssistantRevealQueue({render:false});
 }
})()
