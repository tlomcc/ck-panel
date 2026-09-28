(async()=>{
 const check=(condition,message)=>{if(!condition)throw Error(message)};
 const wait=()=>new Promise(r=>setTimeout(r,45));
 await notebookShow('chat');chatSetActionMode('medium');await wait();
 const head=document.querySelector('.chat-head').getBoundingClientRect();
 const title=document.querySelector('.chat-title-center').getBoundingClientRect();
 const headerButtons=[...document.querySelectorAll('.chat-head-actions button')].filter(b=>!b.hidden).map(b=>b.getBoundingClientRect());
 check(headerButtons.length===4,'Medium header must contain four controls');
 check(headerButtons.every(r=>r.bottom<=head.bottom+1&&Math.abs(r.top-headerButtons[0].top)<1),'Header buttons wrapped');
 check(title.right<=headerButtons[0].left+1,'Header title overlaps actions');
 const select=document.getElementById('chat-cache-strategy');
 await notebookShow('cache');ckSyncSelects();await wait();
 const button=select.nextElementSibling;
 check(button.classList.contains('ck-select-button'),'Missing select proxy');
 check(button.textContent.includes(select.options[select.selectedIndex].textContent),'Initial selection label');
 let changes=0;select.addEventListener('change',()=>changes++);
 button.click();await wait();
 check(document.getElementById('ckActionModal').classList.contains('show'),'Picker not open');
 check(button.getAttribute('aria-expanded')==='true','Expanded state');
 const choices=[...document.querySelectorAll('#ck-action-choices button')];
 check(choices.length===select.options.length,'Picker changed available options');
 const different=choices.find(c=>c.dataset.value!==String(select.selectedIndex));
 const expected=select.options[Number(different.dataset.value)].value;different.click();await wait();
 check(select.value===expected&&changes===1,'Selection must fire change exactly once');
 button.click();await wait();ckDialogCancel();await wait();check(changes===1,'Cancel changed a value');
 // Dynamic inventory: old manual/default models must never join a newly fetched list.
 await notebookShow('providers');
 const provider=apiProviderLibrarySlot().providers[0];provider.model='使用过的旧模型';provider.models=['new-only','next-model'];renderApiConfig();await wait();
 const card=[...document.querySelectorAll('.prov-card')].find(c=>c.dataset.id===provider.id);card.classList.add('expanded');
 const model=card.querySelector('.prov-model-select');
 check([...model.options].map(x=>x.value).join('|')==='|new-only|next-model','Historical/default model leaked into options');
 model.innerHTML=modelOptionsHtml([],provider.model);await wait();check(model.options.length===1,'Empty response retained old models');
 model.innerHTML=modelOptionsHtml(Array.from({length:25},(_,i)=>'测试模型-'+i+'-较长的名称'),provider.model);await wait();
 model.nextElementSibling.click();await wait();
 const search=document.getElementById('ck-choice-search');check(!search.hidden,'Long lists need search');
 search.value='测试模型-24-';search.dispatchEvent(new Event('input',{bubbles:true}));
 check(document.querySelectorAll('#ck-action-choices button:not([hidden])').length===1,'Search filter');
 search.value='';search.dispatchEvent(new Event('input',{bubbles:true}));
 window.choiceScreenshotReady=true;
 // Keep the choice dialog open for a screenshot; diagnostics follow separately.
 window.showDiagnosticsProbe=async function(){
   ckDialogCancel();await notebookShow('debug');
   const panel=document.getElementById('chat-side-debug');
   const probe=document.createElement('div');probe.id='diagnostics-probe';probe.innerHTML='<div class="chat-debug-sheet">'+chatDiagHtmlTable('缓存诊断',[{area:'缓存',item:'策略 / TTL',token:'原生稳定 1h / 分层兜底与当前用户尾部断点',note:'system → assistant → user；'+ '0123456789abcdef'.repeat(8)},{area:'实际用量',item:'缓存读取',token:'1234567890123456789',note:'长数字与长说明都应独立换行，不与相邻列重叠。'}])+'</div>';
   panel.append(probe);probe.scrollIntoView();await wait();
   const cells=[...probe.querySelectorAll('td')];
   for(const cell of cells){
     check(cell.scrollWidth<=cell.clientWidth+2,'Cell text overflow: '+cell.textContent);
     check(parseFloat(getComputedStyle(cell).lineHeight)>=16,'Cell line height too tight');
   }
   check(probe.scrollWidth<=panel.clientWidth+2,'Diagnostic table overflow');
   return {cells:cells.length,width:innerWidth};
 };
 return {enhanced:document.querySelectorAll('.ck-select-button').length,selectionChanges:changes,modelOptions:model.options.length};
})()
