/* Display-only history windows. Stored messages and transport stay complete. */
var CHAT_HISTORY_PAGE_ROUNDS=50;
var chatHistoryView={session:'',messages:null,first:null,last:null,start:0,end:0,follow:true};
var chatActionModeCache='';
var chatActionOpenTurn='';
var chatActionLastTurn='';
var chatSearchHits=[];
var chatSearchPosition=-1;
function chatHistoryGroups(){return CKChatHistory.localTurnGroups(chatMessages)}
function chatHistoryReset(edge){
  var groups=chatHistoryGroups(),first=edge==='top'?0:Math.max(0,groups.length-CHAT_HISTORY_PAGE_ROUNDS);
  chatHistoryView={session:chatActiveSessionId,messages:chatMessages,first:chatMessages[0],last:chatMessages[chatMessages.length-1],start:first?groups[first].startIndex:0,end:edge==='top'&&groups.length>CHAT_HISTORY_PAGE_ROUNDS?groups[CHAT_HISTORY_PAGE_ROUNDS].startIndex:chatMessages.length,follow:edge!=='top'};
}
function chatHistoryRange(){
  var v=chatHistoryView;
  if(v.session!==chatActiveSessionId||v.messages!==chatMessages||v.first!==chatMessages[0])chatHistoryReset();
  v=chatHistoryView;
  if(v.follow)v.end=chatMessages.length;
  v.end=Math.min(v.end,chatMessages.length);
  return v;
}
function chatHistoryLoad(direction){
  var box=chatMessagesBox(),v=chatHistoryRange();
  if(!box||(direction==='before'?v.start<=0:v.end>=chatMessages.length))return;
  var anchor=Array.from(box.querySelectorAll('.chat-msg-row[data-chat-index]')).find(function(row){return row.getBoundingClientRect().bottom>box.getBoundingClientRect().top+2});
  var index=anchor&&anchor.getAttribute('data-chat-index'),offset=anchor&&anchor.getBoundingClientRect().top;
  var groups=chatHistoryGroups();
  if(direction==='before'){
    var gi=groups.findIndex(function(g){return g.startIndex>=v.start});
    v.start=groups[Math.max(0,gi-CHAT_HISTORY_PAGE_ROUNDS)]?.startIndex||0;
  }else{
    var next=groups.findIndex(function(g){return g.startIndex>=v.end});
    v.end=next>=0&&groups[next+CHAT_HISTORY_PAGE_ROUNDS]?groups[next+CHAT_HISTORY_PAGE_ROUNDS].startIndex:chatMessages.length;
    v.follow=v.end===chatMessages.length;
  }
  chatRenderMessages({respectUserScroll:true,preservePosition:true});
  var restored=index!==null&&box.querySelector('[data-chat-index="'+index+'"]');
  if(restored)box.scrollTop+=restored.getBoundingClientRect().top-offset;
}
function chatHistorySentinels(box){
  box.querySelectorAll('.chat-history-more').forEach(function(el){el.remove()});
  var v=chatHistoryView;
  if(v.start>0)box.insertAdjacentHTML('afterbegin','<button class="chat-history-more" type="button" onclick="chatHistoryLoad(\'before\')">↑ 更早的消息</button>');
  if(v.end<chatMessages.length)box.insertAdjacentHTML('beforeend','<button class="chat-history-more" type="button" onclick="chatHistoryLoad(\'after\')">↓ 后续消息</button>');
}
function chatLocateMessage(index){
  if(!chatMessages[index])return;
  var groups=chatHistoryGroups(),group=groups.findIndex(function(g){return index>=g.startIndex&&index<g.endIndex});
  var first=Math.max(0,group-20),last=Math.min(groups.length,first+CHAT_HISTORY_PAGE_ROUNDS);
  chatHistoryReset();
  chatHistoryView.start=groups[first]?.startIndex||0;
  chatHistoryView.end=groups[last]?.startIndex||chatMessages.length;
  chatHistoryView.follow=chatHistoryView.end===chatMessages.length;
  chatRenderMessages({respectUserScroll:true,preservePosition:true});
  requestAnimationFrame(function(){
    var row=chatMessagesBox().querySelector('[data-chat-index="'+index+'"]');
    if(row){row.scrollIntoView({block:'center',behavior:'auto'});row.classList.add('chat-search-match');setTimeout(function(){row.classList.remove('chat-search-match')},2400)}
  });
}
function chatToggleSearch(force){
  var box=document.getElementById('chat-search');if(!box)return;
  var open=typeof force==='boolean'?force:box.hidden;
  box.hidden=!open;
  document.getElementById('chat-search-toggle').setAttribute('aria-expanded',String(open));
  if(open){document.getElementById('chat-search-input').focus({preventScroll:true});chatSearchMessages()}
}
function chatSearchMessages(){
  var query=document.getElementById('chat-search-input').value.trim().toLocaleLowerCase();
  chatSearchHits=[];chatSearchPosition=-1;
  if(query)chatMessages.forEach(function(m,i){if((m.role==='user'||m.role==='assistant')&&chatMessageCopyText(m).toLocaleLowerCase().includes(query))chatSearchHits.push(i)});
  chatSearchPosition=chatSearchHits.length-1;
  chatUpdateSearchResult();
}
function chatUpdateSearchResult(){
  var count=document.getElementById('chat-search-count');
  count.textContent=chatSearchHits.length?(chatSearchPosition+1)+' / '+chatSearchHits.length:'无匹配';
  document.querySelectorAll('[data-chat-search-step]').forEach(function(b){b.disabled=chatSearchHits.length===0});
  if(chatSearchPosition>=0)chatLocateMessage(chatSearchHits[chatSearchPosition]);
}
function chatSearchStep(step){if(!chatSearchHits.length)return;chatSearchPosition=(chatSearchPosition+step+chatSearchHits.length)%chatSearchHits.length;chatUpdateSearchResult()}
function chatActionMode(){
  if(!chatActionModeCache){try{chatActionModeCache=localStorage.getItem('ck_chat_action_mode')||'medium'}catch(e){chatActionModeCache='medium'}}
  return ['low','medium','high'].includes(chatActionModeCache)?chatActionModeCache:'medium';
}
function chatSetActionMode(mode){
  if(!['low','medium','high'].includes(mode))return;
  chatActionModeCache=mode;chatActionOpenTurn='';
  try{localStorage.setItem('ck_chat_action_mode',mode)}catch(e){}
  chatSyncActionControls();chatRenderMessages({respectUserScroll:true,preservePosition:true});
}
function chatSyncActionControls(){
  var mode=chatActionMode();
  document.querySelectorAll('[data-action-mode]').forEach(function(b){b.setAttribute('aria-checked',String(b.dataset.actionMode===mode))});
  var label=document.getElementById('chat-action-mode-hint');if(label)label.textContent=({low:'低档 · 隐藏复制和重新生成',medium:'中档 · 点小伙伴，展开本轮操作',high:'高档 · 始终显示操作按钮'})[mode];
}
function chatActionTurnKey(index){
  var m=chatMessages[index];if(!m)return '';
  if(m.turnId||m.turn_id)return String(m.turnId||m.turn_id);
  var i=index;while(i>0&&chatMessages[i].role!=='user'&&chatMessages[i].role!=='pending_user')i--;
  return String(chatMessages[i]?.ts||i);
}
function chatActionSyncTurn(){
  var key=chatActionTurnKey(chatMessages.length-1);
  if(key!==chatActionLastTurn){chatActionLastTurn=key;chatActionOpenTurn=''}
}
function chatToggleTurnActions(index){
  var key=chatActionTurnKey(index);chatActionOpenTurn=chatActionOpenTurn===key?'':key;
  chatRenderMessages({respectUserScroll:true,preservePosition:true});
}
function chatActionBuddy(index){
  var expanded=chatActionOpenTurn===chatActionTurnKey(index);
  return '<button class="chat-action-buddy" type="button" onclick="chatToggleTurnActions('+index+')" aria-label="'+(expanded?'收起':'展开')+'本轮操作" aria-expanded="'+expanded+'" title="本轮操作"><svg viewBox="0 0 28 24" aria-hidden="true"><path d="M5 8 4 3l6 3a13 13 0 0 1 8 0l6-3-1 5c4 9-1 13-9 13S1 17 5 8Z"/><path d="M9 12v1m10-1v1m-7 3q2 2 4 0"/></svg></button>';
}
function chatCloseVersionNotes(){var el=document.getElementById('panel-version-notes');if(el)el.hidden=true;document.querySelectorAll('[data-version-notes]').forEach(function(b){b.setAttribute('aria-expanded','false')})}
function chatToggleVersionNotes(event){
  event.stopPropagation();var box=document.getElementById('panel-version-notes');
  if(!box.hidden){chatCloseVersionNotes();return}
  var notes=window.CK_PANEL_RELEASE_NOTES||[];
  box.innerHTML='<b>'+esc(CK_PANEL_VERSION.match(/v\d+/)?.[0]||CK_PANEL_VERSION)+' · 本次更新</b><ul>'+notes.map(function(n){return '<li>'+esc(n)+'</li>'}).join('')+'</ul>';
  box.hidden=false;event.currentTarget.setAttribute('aria-expanded','true');
}
document.addEventListener('click',function(e){if(!e.target.closest('#panel-version-notes,[data-version-notes]'))chatCloseVersionNotes()});
document.addEventListener('keydown',function(e){if(e.key==='Escape'){chatCloseVersionNotes();chatToggleSearch(false)}});
