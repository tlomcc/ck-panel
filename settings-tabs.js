/* Settings keep the existing controls and their saved values in one drawer. */
var ckSettingsPage='interface';
function ckSettingsMount(){
  var root=document.getElementById('chat-side-display');if(!root||root.dataset.organized)return;
  root.dataset.organized='true';
  var pages=[['interface','界面'],['wake','唤醒'],['connection','API 连接'],['history','历史保留'],['time','时间'],['billing','计费'],['cleanup','清理'],['tools','工具']];
  var headings={'界面设置':'interface','唤醒服务':'wake','计费显示':'billing','历史保留':'history','时间提醒':'time'};
  var sections=Array.from(root.children).filter(function(n){return n.matches('section.chat-setting-group')});
  var nav=document.createElement('div');nav.className='ck-settings-tabs';nav.setAttribute('role','tablist');nav.setAttribute('aria-label','设置分类');
  root.querySelector('header').after(nav);
  pages.forEach(function(pair){
    var key=pair[0],button=document.createElement('button');button.type='button';button.id='ck-settings-tab-'+key;button.textContent=pair[1];
    button.setAttribute('role','tab');button.setAttribute('aria-controls','ck-settings-page-'+key);button.dataset.settingsTab=key;button.onclick=function(){ckSettingsSelect(key)};nav.appendChild(button);
    var pane=document.createElement('div');pane.id='ck-settings-page-'+key;pane.className='ck-settings-page';pane.setAttribute('role','tabpanel');pane.setAttribute('aria-labelledby',button.id);root.appendChild(pane);
  });
  sections.forEach(function(section){var title=(section.querySelector('h3')||{}).textContent||'',key=Object.keys(headings).find(function(name){return title.indexOf(name)>=0});document.getElementById('ck-settings-page-'+(headings[key]||'time')).appendChild(section)});
  [['gateway','connection'],['cleanup','cleanup']].forEach(function(pair){var old=document.getElementById('chat-side-'+pair[0]);if(!old)return;old.classList.remove('chat-side-panel','active');old.classList.add('ck-settings-merged');document.getElementById('ck-settings-page-'+pair[1]).appendChild(old)});
  var tools=document.getElementById('chat-tools-settings');if(tools)document.getElementById('ck-settings-page-tools').appendChild(tools);
  nav.addEventListener('keydown',function(e){if(!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;e.preventDefault();var index=pages.findIndex(function(p){return p[0]===ckSettingsPage});index=e.key==='Home'?0:e.key==='End'?pages.length-1:(index+(e.key==='ArrowLeft'?-1:1)+pages.length)%pages.length;ckSettingsSelect(pages[index][0]);document.getElementById('ck-settings-tab-'+ckSettingsPage).focus()});
  try{ckSettingsPage=localStorage.getItem('ck_settings_page')||'interface'}catch(e){}
  ckSettingsSelect(ckSettingsPage);
}
function ckSettingsSelect(page){
  ckSettingsMount();if(!document.getElementById('ck-settings-page-'+page))page='interface';ckSettingsPage=page;
  document.querySelectorAll('[data-settings-tab]').forEach(function(button){var active=button.dataset.settingsTab===page;button.setAttribute('aria-selected',String(active));button.tabIndex=active?0:-1;document.getElementById('ck-settings-page-'+button.dataset.settingsTab).hidden=!active});
  try{localStorage.setItem('ck_settings_page',page)}catch(e){}
  if(page==='wake'&&typeof chatWakeRefresh==='function')chatWakeRefresh();
}
ckSettingsMount();
