(async()=>{
 const check=(ok,msg)=>{if(!ok)throw Error(msg)},pause=ms=>new Promise(r=>setTimeout(r,ms));
 const box=chatMessagesBox();chatAttachMessagesScroll();chatAttachScrollJumpControls();
 chatMessages=Array.from({length:32},(_,i)=>({role:i%2?'assistant':'user',text:'第 '+i+' 条\n'+('检查阅读位置，接收消息时可以自由上翻。'.repeat(5)),turnId:'scroll-'+Math.floor(i/2),ts:Date.now()+i}));
 chatActiveSessionId='scroll-follow';chatSessions=[{id:chatActiveSessionId,messages:chatMessages,transportMessages:[]}];
 chatHistoryReset();chatRenderMessages();await pause(80);
 const source=window.__streamSource.replace(/\r\n/g,'\n');
 const start=source.indexOf('  var streamRenderRaf=0,streamRenderDirty=false,streamRenderStopped=false;');
 const end=source.indexOf('\n  try{\n    var requestSignal=',start);
 const factory=new Function('cfg','out','requestTurnId','latencyTrace',`
   var assistantText='',nativeThinkingText='',toolEvents=[],firstReplyTs=Date.now();
   ${source.slice(start,end)}
   return {text(v){assistantText+=v;trackThinking();scheduleStreamRender()},stop:stopStreamRender,raw(){return assistantText}};
 `);
 const out=chatAddBubble('assistant','',false),stream=factory({sessionId:chatActiveSessionId,splitAssistantReplies:false},out,'scroll-live',{});
 stream.text('正在回复\n');await pause(100);
 check(box.scrollHeight-box.scrollTop-box.clientHeight<=2,'initial stream did not follow');
 const wheel=delta=>box.dispatchEvent(new WheelEvent('wheel',{deltaY:delta,bubbles:true}));
 // Reproduce the 100px capture zone, including a stale frame already queued.
 chatScrollMessagesBottom(true);wheel(-24);box.scrollTop-=24;const first=box.scrollTop;
 stream.text('继续输出\n'.repeat(30));await pause(220);
 check(Math.abs(box.scrollTop-first)<=2,'upward wheel was pulled back near bottom');
 await pause(1250);stream.text('过了旧的手势超时仍继续输出\n');await pause(100);
 check(Math.abs(box.scrollTop-first)<=2,'follow pause expired while reading');
 check(!document.getElementById('chat-new-message-tip').hidden,'new reply hint missing');
 // Follow may resume only after manually reaching the actual bottom.
 wheel(100);box.scrollTop=box.scrollHeight;await pause(80);
 check(!chatMessagesFollowPaused,'manual return to bottom did not resume');
 stream.text('回到底部以后跟随\n'.repeat(10));await pause(500);
 check(box.scrollHeight-box.scrollTop-box.clientHeight<=2,'resumed stream lost bottom');
 // Touch up through history: the finger moves down before the scroll event arrives.
 const touch=(type,y)=>{const e=new Event(type);Object.defineProperty(e,'touches',{value:[{clientY:y}]});box.dispatchEvent(e)};
 chatScrollMessagesBottom(true);touch('touchstart',100);touch('touchmove',130);box.scrollTop-=30;const touchTop=box.scrollTop;
 stream.text('触摸上翻期间的消息\n'.repeat(5));await pause(170);
 check(Math.abs(box.scrollTop-touchTop)<=2,'touch was pulled back');touch('touchend',130);
 chatJumpToLatest();await pause(80);
 check(box.scrollHeight-box.scrollTop-box.clientHeight<=2&&!chatMessagesFollowPaused,'latest button did not resume');
 // A keyboard gesture must cancel the queued follow before its default scroll.
 box.dispatchEvent(new KeyboardEvent('keydown',{key:'PageUp',bubbles:true}));box.scrollTop-=40;const keyboardTop=box.scrollTop;
 stream.text('键盘上翻期间的消息\n');await pause(130);
 check(Math.abs(box.scrollTop-keyboardTop)<=2,'keyboard was pulled back');
 chatJumpToLatest();await pause(80);
 box.dispatchEvent(new PointerEvent('pointerdown',{pointerType:'mouse',button:0,clientX:box.getBoundingClientRect().right-1,bubbles:true}));box.scrollTop-=22;const dragTop=box.scrollTop;
 stream.text('拖动滚动条期间的消息\n');await pause(160);
 check(Math.abs(box.scrollTop-dragTop)<=2,'scrollbar drag was pulled back');
 window.dispatchEvent(new PointerEvent('pointerup',{pointerType:'mouse'}));
 stream.stop();
 // Completion must preserve position even when only 20px from the bottom.
 chatJumpToLatest();await pause(80);wheel(-20);box.scrollTop-=20;await pause(40);const beforeDone=box.scrollTop;
 await chatAppendAssistantReplies(stream.raw(),null,[],{splitAssistantReplies:false,turnId:'scroll-live',alreadyShownCount:1});await pause(80);
 check(Math.abs(box.scrollTop-beforeDone)<=2,'completion moved reader: '+JSON.stringify({beforeDone,after:box.scrollTop,gap:box.scrollHeight-box.clientHeight-box.scrollTop}));
 check(!chatShouldFollowMessages(),'completion reset the manual pause');
 chatJumpToLatest();await pause(80);
 // Plain incoming rows and background rerenders obey the same pause.
 wheel(-20);box.scrollTop-=20;await pause(40);const incomingTop=box.scrollTop;
 const late=chatAddBubble('assistant','一条后到的消息',false);await pause(80);
 check(Math.abs(box.scrollTop-incomingTop)<=2,'incoming bubble forced bottom');late.parentNode.remove();
 chatRenderMessages({respectUserScroll:true,newMessage:true});await pause(80);
 check(Math.abs(box.scrollTop-incomingTop)<=2,'rerender recaptured the bottom zone');
 chatJumpToLatest();await pause(80);
 return {wheel:true,touch:true,keyboard:true,scrollbar:true,queuedFrameCancelled:true,pauseSurvivesTimeout:true,manualResume:true,completion:true,incoming:true};
})()
