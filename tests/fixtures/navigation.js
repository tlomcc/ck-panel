(async()=>{
 const check=(ok,message)=>{if(!ok)throw Error(message)},wait=()=>new Promise(r=>setTimeout(r,60));
 await notebookShow('model');
 const section=document.getElementById('chat-side-select');
 const choices=Array.from({length:12},(_,i)=>({value:String(i),label:'功能区 '+i,active:i===5}));
 let result=ckChooseDialog('功能区',choices,{searchable:true});await wait();
 check(document.activeElement.tagName==='BUTTON','Opening a searchable chooser must not focus a text input');
 check(document.activeElement.dataset.value==='5','Current choice should receive focus');
 const search=document.getElementById('ck-choice-search');search.focus();search.value='11';ckFilterChoices(search);
 check(document.activeElement===search,'Explicit search focus lost');
 check(document.querySelectorAll('#ck-action-choices .ck-action-choice:not([hidden])').length===1,'Search filter failed');
 document.querySelector('#ck-action-choices [data-value="11"]').click();check(await result==='11','Choice did not resolve');await wait();
 result=ckChooseDialog('快速搜索',choices,{searchable:true});search.focus();await wait();check(document.activeElement===search,'Delayed autofocus stole an explicit search tap');ckDialogCancel();await result;
 result=ckChooseDialog('关闭前的搜索',choices,{searchable:true});ckDialogCancel();await result;await wait();check(document.activeElement!==search,'Closed dialog received delayed focus');
 await notebookShow('main');
 const trigger=document.querySelector('.provider-pick-btn');trigger.focus();
 let picked;providerPickerChoose(providerLibraryList(),'',{}).then(value=>picked=value);await wait();
 const modal=document.getElementById('ckActionModal'),sheet=modal.querySelector('.ck-action-dialog');
 const rect=sheet.getBoundingClientRect(),pageY=scrollY;
 let hidden=false,escaped=false;
 const observer=new MutationObserver(records=>{for(const record of records)if(record.attributeName==='aria-hidden'&&modal.getAttribute('aria-hidden')==='true')hidden=true;else if(record.attributeName==='class'&&record.oldValue&&!record.oldValue.split(' ').includes('show'))hidden=true});
 observer.observe(modal,{attributes:true,attributeOldValue:true});
 const focus=e=>{if(!modal.contains(e.target))escaped=true};document.addEventListener('focusin',focus);
 for(let i=0;i<4;i++){
  const folders=[...document.querySelectorAll('#ck-action-choices [data-value^="folder:"]')];folders[i%folders.length].click();await wait();
  check(Math.abs(sheet.getBoundingClientRect().top-rect.top)<1&&Math.abs(sheet.getBoundingClientRect().height-rect.height)<1,'Folder navigation changed sheet geometry');
  document.querySelector('#ck-action-choices [data-value="back"]').click();await wait();
 }
 check(!hidden&&!escaped&&scrollY===pageY,'Provider navigation closed/reopened or moved underlying page');
 observer.disconnect();document.removeEventListener('focusin',focus);
 document.querySelector('#ck-action-choices [data-value="folder:工作学习"]').click();await wait();document.querySelector('#ck-action-choices [data-value="id:cloud"]').click();await wait();
 check(picked==='cloud'&&document.activeElement===trigger,'Final provider selection/focus return failed');
 await notebookShow('chat');
 let cfg=chatLoadConfig();cfg.nativeThinkingVisible=false;cfg.thinkingMode='native';cfg.retainImageTurnThinking=true;chatSaveConfigObject(cfg);chatWriteForm(cfg);
 check(chatLoadConfig().retainImageTurnThinking===true&&document.getElementById('chat-retain-image-turn-thinking').checked,'Image thinking switch did not persist');
 chatMessages[0].turnId='one';chatMessages[1].thinking='合成样例：观察新叶子的形状。';chatRenderMessages();
 const thought=document.getElementById('chat-current-thinking'),thoughtText=document.getElementById('chat-current-thinking-text');
 check(!thought.hidden&&thoughtText.textContent.includes('观察新叶子'),'Hidden-mode thought preview missing');
 check(!document.querySelector('#chat-messages .chat-native-thinking'),'Thought leaked into chat while hidden');
 chatRenderCurrentThinking({sessionId:chatActiveSessionId,turnId:'one',text:'流式思考样例'});check(thoughtText.textContent==='流式思考样例','Live preview not updated');
 chatRenderCurrentThinking({sessionId:'another-session',turnId:'one',text:'其他窗口内容'});check(!thoughtText.textContent.includes('其他窗口'),'Cross-session thinking leaked');
 chatRenderCurrentThinking({sessionId:chatActiveSessionId,turnId:'one',text:'流式思考样例'});
 chatMessages.push({role:'user',text:'下一轮',turnId:'two'});chatRenderMessages();check(!thoughtText.textContent.includes('样例'),'Previous-turn thinking leaked');
 chatThinkingPreviewLive=null;chatMessages.pop();
 document.getElementById('chat-native-thinking-visible').checked=true;chatSaveThinkingDisplay();check(thought.hidden,'Visible mode must hide preview');
 document.getElementById('chat-native-thinking-visible').checked=false;chatSaveThinkingDisplay();check(!thought.hidden,'Hidden mode must show preview');
 chatFolders=[{id:'daily',name:'日常 · 慢慢收藏',collapsed:false},{id:'work',name:'工作与灵感',collapsed:true}];
 const now=Date.now();chatSessions[0].folderId='daily';chatSessions[0].title='窗台上的小植物';chatSessions[0].updated=now;
 for(let i=0;i<5;i++)chatSessions.push({id:'sidebar-'+i,title:['周末散步，发现一家小店','整理思路，准备下一次分享','一个很长很长的对话标题，用来确认手机上也不会挤到操作按钮','晚安之前，聊聊今天','一起读书'][i],folderId:i<2?'daily':'',updated:now-(i+1)*86400000,messages:[{role:'assistant',text:'把想到的事情留在这里，下次接着聊。',thinking:'其他对话的思考'}],transportMessages:[]});
 chatToggleSessions(true);await wait();
 check(!['INPUT','TEXTAREA'].includes(document.activeElement.tagName),'Opening sidebar summoned keyboard');
 const drawer=document.querySelector('.chat-drawer');check(drawer.getBoundingClientRect().right<=innerWidth&&drawer.scrollWidth<=drawer.clientWidth+1,'Sidebar overflow');
 for(const item of document.querySelectorAll('.chat-session-item')){
  const title=item.querySelector('.chat-session-title').getBoundingClientRect(),preview=item.querySelector('.chat-session-preview').getBoundingClientRect(),meta=item.querySelector('.chat-session-meta').getBoundingClientRect();
  check(preview.top>=title.bottom-1&&meta.top>=preview.bottom-1,'Sidebar text collision');
 }
 document.querySelector('.chat-session-more').click();await wait();check(document.querySelector('#ck-action-choices [data-value="move"]')&&document.querySelector('#ck-action-choices [data-value="delete"]'),'Session operations missing');ckDialogCancel();await wait();
 chatSetSessionSearch('窗台');check(document.querySelectorAll('.chat-session-row').length===1,'Sidebar search failed');chatSetSessionSearch('');
 return {keyboard:'manual text focus only',provider:'stable sheet and focus across 8 transitions',sidebar:'mobile geometry, search, operations',thinking:'saved switch, current/live turn, conditional display'};
})()
