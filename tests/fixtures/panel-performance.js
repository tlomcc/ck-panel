(async()=>{
 const check=(value,message)=>{if(!value)throw Error(message)},pause=ms=>new Promise(r=>setTimeout(r,ms));
 document.getElementById('loading-wrap').classList.add('done');
 document.body.classList.add('chat-active');
 document.querySelectorAll('.panel-tab').forEach(e=>e.classList.toggle('active',e.id==='tab-chat'));
 currentPanelTab='chat';chatActiveSessionId='performance';
 chatMessages=Array.from({length:240},(_,i)=>({role:i%2?'assistant':'user',text:'合成消息 '+i+'\n'+('测试滚动与输入。'.repeat(30)),turnId:'performance-'+Math.floor(i/2),ts:Date.now()+i}));
 chatSessions=[{id:chatActiveSessionId,title:'交互验证',messages:chatMessages,transportMessages:[]}];
 const cfg=chatLoadConfig();cfg.sessionId=chatActiveSessionId;chatSaveConfigObject(cfg);
 chatHistoryReset();chatRenderMessages();chatAttachMessagesScroll();chatAttachScrollJumpControls();chatLayoutCompose();await pause(80);
 const snapshot=JSON.stringify(chatMessages),box=chatMessagesBox();
 box.scrollTop=80;chatPauseMessagesFollow();
 const anchor=Array.from(box.querySelectorAll('[data-chat-index]')).find(row=>row.getBoundingClientRect().bottom>box.getBoundingClientRect().top+2);
 const index=anchor.dataset.chatIndex,offset=anchor.getBoundingClientRect().top;
 chatHistoryLoad('before');await pause(80);
 check(Math.abs(box.querySelector('[data-chat-index="'+index+'"]').getBoundingClientRect().top-offset)<3,'Older history moved the reading anchor');
 let indices=Array.from(box.querySelectorAll('[data-chat-index]'),row=>Number(row.dataset.chatIndex));
 check(indices.every((n,i)=>!i||n>indices[i-1]),'Batch insertion changed message order');
 check(JSON.stringify(chatMessages)===snapshot,'Display changed stored messages');
 const retained=box.querySelector('[data-chat-index="'+index+'"]');chatRenderMessages({respectUserScroll:true,preservePosition:true});
 check(box.querySelector('[data-chat-index="'+index+'"]')===retained,'Unchanged history DOM was replaced');
 const input=document.getElementById('chat-input'),samples=['','一行文字','中文换行测试'.repeat(25),'one\ntwo\nthree\nfour\nfive','短句','https://example.invalid/'+('long'.repeat(100)),'\t空格   与\n换行\n',''];
 for(const value of samples){
   input.value=value;window.legacyAutosizeInput(input);
   const expected={height:input.style.height,overflow:input.style.overflowY};
   input.style.height='34px';chatAutosizeInput(input);
   check(input.style.height===expected.height&&input.style.overflowY===expected.overflow,'Autosize mismatch: '+JSON.stringify({width:innerWidth,length:value.length,expected,actual:[input.style.height,input.style.overflowY]}));
 }
 input.value='正常输入';chatAutosizeInput(input);input.focus();
 check(document.activeElement===input,'Measurement stole focus');
 const hint=document.getElementById('chat-new-message-tip'),compose=document.querySelector('.chat-compose');
 chatLayoutCompose();
 check(parseFloat(hint.style.getPropertyValue('--ck-chat-compose-height'))===Math.ceil(compose.getBoundingClientRect().height),'New-message hint lost composer height');
 const measured=chatInputMeasure;check(measured.tabIndex===-1&&measured.getAttribute('aria-hidden')==='true','Measurement became interactive');
 check(document.documentElement.scrollWidth<=innerWidth,'Measurement introduced horizontal overflow');
 const field=document.createElement('fieldset');field.innerHTML='<label>动态选择<select><option value="a">第一项</option><option value="b">第二项</option></select></label>';
 document.body.appendChild(field);await pause(40);
 const select=field.querySelector('select'),button=select.nextElementSibling;
 check(button.classList.contains('ck-select-button')&&button.textContent.includes('第一项'),'Dynamic select not initialized');
 const desc=Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'selectedIndex');let reads=0;
 Object.defineProperty(select,'selectedIndex',{configurable:true,get(){reads++;return desc.get.call(this)},set(value){desc.set.call(this,value)}});
 const probe=document.createElement('div');document.body.appendChild(probe);await pause(40);reads=0;
 for(let i=0;i<12;i++){probe.textContent='流式更新 '+i;await pause(2)}
 check(reads===0,'Unrelated text updates rescanned selects');
 select.options[0].firstChild.data='更名';await pause(30);check(button.textContent.includes('更名'),'Option text mutation not synchronized');
 select.value='b';document.body.click();await pause(30);check(button.textContent.includes('第二项'),'Programmatic selection not synchronized on click');
 field.disabled=true;await pause(30);check(button.disabled,'Disabled fieldset not respected');
 field.disabled=false;select.hidden=true;await pause(30);check(!button.disabled&&button.hidden,'Hidden select not respected');
 select.hidden=false;select.innerHTML='<optgroup label="组"><option>新选项</option></optgroup>';await pause(30);check(button.textContent.includes('新选项'),'Replacement options not synchronized');
 field.remove();probe.remove();await pause(30);check(!button.isConnected,'Removed control left a proxy');
 return {width:innerWidth,autosizeCases:samples.length,orderedRows:indices.length,anchorPreserved:true,unchangedRowsRetained:true,unrelatedSelectReads:0,dynamicSelects:true,storedMessagesUnchanged:true};
})()
