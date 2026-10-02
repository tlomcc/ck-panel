(async()=>{
 const assert=(ok,msg)=>{if(!ok)throw Error(msg)};
 const pause=ms=>new Promise(r=>setTimeout(r,ms));
 localStorage.clear();window.fetch=async()=>{throw Error('isolated UI fixture')};
 document.getElementById('loading-wrap').classList.add('done');
 document.body.classList.add('chat-active');document.getElementById('tab-chat').classList.add('active');
 chatSessionsReady=true;apiProvidersLoaded=true;apiProviders={};
 const source=window.__streamSource.replace(/\r\n/g,'\n');
 const start=source.indexOf('  var streamRenderRaf=0,streamRenderDirty=false,streamRenderStopped=false;');
 const end=source.indexOf('\n  try{\n    var requestSignal=',start);
 assert(start>0&&end>start,'renderer closure not found');
 const factory=new Function('cfg','out','requestTurnId','latencyTrace',`
   var assistantText='',nativeThinkingText='',toolEvents=[],firstReplyTs=Date.now();
   ${source.slice(start,end)}
   return {text(v){assistantText+=v;trackThinking();scheduleStreamRender()},thinking(v){nativeThinkingText+=v;trackThinking();scheduleStreamRender()},stop:stopStreamRender,count(){return streamShownCount},raw(){return assistantText},duration(){return thinkingTiming().durationMs}};
 `);
 const results=[];
 for(const split of [false,true]){
  chatMessages=[{role:'user',text:'请回复',turnId:'live',ts:Date.now()}];
  chatSessions=[{id:'live-stream',messages:chatMessages,transportMessages:[],updated:Date.now()}];chatActiveSessionId='live-stream';
  chatRenderMessages({force:true,removeEphemeral:true});
  const out=chatAddBubble('assistant','',false),latency={panel_first_delta_ms:Date.now()};
  const cfg={sessionId:'live-stream',splitAssistantReplies:split,nativeThinkingVisible:true};
  const stream=factory(cfg,out,'live',latency);
  stream.thinking('先核对这条消息。');await pause(70);
  assert(document.querySelector('.chat-stream-aux .chat-thinking-body')?.textContent.includes('先核对'),'thinking missing before text');
  const thought=document.querySelector('.chat-stream-aux .chat-thinking');
  const labelBox=thought.querySelector('.chat-thinking-label').getBoundingClientRect();
  assert(labelBox.height<24,'thinking label wrapped while streaming');
  assert(!thought.classList.contains('open'),'thinking must start collapsed');
  assert(getComputedStyle(thought.querySelector('.chat-thinking-body')).display==='none','thinking content visible while folded');
  await pause(160);
  assert(/思考中.*0\.[12]/.test(thought.querySelector('.chat-thinking-label').textContent),'thinking timer did not advance');
  stream.thinking('继续核对。');await pause(40);
  assert(document.querySelector('.chat-stream-aux .chat-thinking')===thought,'thinking card replaced during streaming');
  assert(!out.textContent.includes('先核对'),'thinking leaked into text bubble');
  stream.text('第');await pause(70);
  assert(out.textContent==='第','first character withheld');
  assert(thought.querySelector('.chat-thinking-label').textContent.includes('已思考'),'timer did not stop for text');
  assert(latency.panel_first_rendered_char_ms&&!latency.panel_stream_done_ms,'first render waits for done');
  stream.text('一段\n第二段');await pause(400);
  let bubbles=[...document.querySelectorAll('.chat-ephemeral-row .chat-bubble.assistant')].filter(x=>!x.parentNode.hidden);
  assert(bubbles.length===(split?2:1),'wrong streaming bubble count');
  assert(bubbles.map(x=>x.textContent).join('').replace(/\s/g,'')==='第一段第二段','stream lost or duplicated text');
  stream.text('\n```js\nconst answer=42;');await pause(230);
  stream.text('\n```\n结束');await pause(400);
  const shown=stream.count();stream.stop();
  await chatAppendAssistantReplies(stream.raw(),null,[],{splitAssistantReplies:split,alreadyShownCount:shown,turnId:'live',thinking:'先核对这条消息。',thinkingDurationMs:stream.duration(),latency});
  assert(!document.querySelector('.chat-ephemeral-row'),'temporary rows survived completion');
  assert(chatMessages.filter(m=>m.role==='assistant').length===(split?4:1),'wrong persisted split count');
  assert(!chatAssistantRevealQueue?.hidden.size,'already visible text hidden again on completion');
  assert(chatMessages[1].thinking==='先核对这条消息。','thinking not persisted');
  assert(chatMessages[1].thinkingDurationMs>=200,'thinking duration not persisted');
  assert(!document.querySelector('.chat-thinking.open'),'completed thinking auto-expanded');
  results.push({split,firstCharacterBeforeDone:true,thinkingBeforeText:true,shown});
 }
 // Large upstream chunks spread over several frames with a bounded catch-up.
 chatRenderMessages({force:true,removeEphemeral:true});
 const burstOut=chatAddBubble('assistant','',false),burst=factory({sessionId:'live-stream',splitAssistantReplies:false},burstOut,'burst',{});
 burst.text('流'.repeat(240));await pause(25);
 assert(burstOut.textContent.length>0&&burstOut.textContent.length<240,'large chunk appeared all at once');
 const stableParagraph=burstOut.querySelector('p');await pause(160);
 assert(burstOut.textContent.length<240,'burst was dumped after a short deadline');
 await pause(950);
 assert(burstOut.textContent.length===240,'stream smoothing did not finish');
 assert(burstOut.querySelector('p')===stableParagraph,'stream replaced the Markdown paragraph');
 burst.stop();burstOut.parentNode.remove();
 // Stop must cancel pending segment reveals and prevent later deltas changing DOM.
 chatRenderMessages({force:true,removeEphemeral:true});
 const stoppedOut=chatAddBubble('assistant','',false),stopper=factory({sessionId:'live-stream',splitAssistantReplies:true},stoppedOut,'stopped',{});
 stopper.text('停止前');await pause(70);stopper.stop();stopper.text('停止后');await pause(200);
 assert(stoppedOut.textContent==='停止前','late text rendered after stop');stoppedOut.parentNode.remove();
 // The route choice stays in CK and uses the native selector, no nested popup.
 ckOpenBackendRoute();document.getElementById('ck-backend-mode').value='vps';ckBackendFieldsChanged();
 assert(!document.getElementById('ck-vps-fields').hidden,'VPS route fields hidden');
 assert(document.getElementById('ck-execution-mode').options.length===3,'execution routes missing');
 assert(document.getElementById('ck-backend-mode').options.length===1&&document.getElementById('ck-backend-mode').value==='vps','retired gateway remains selectable');ckCloseBackendRoute();
 const box=document.getElementById('chat-messages');assert(box.scrollWidth<=box.clientWidth+2,'message layout overflow');
 return {results,stop:true,routeSelector:true};
})()
