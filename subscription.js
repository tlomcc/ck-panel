(function(){
 'use strict';
 var dialog=null, timer=0, controller=null, generation=0, previousFocus=null, data=null, dirty=false, saving=false, notified='';
 var $=function(id){return document.getElementById(id)};
 var labels={five_hour:'5 小时额度',seven_day:'7 天额度',seven_day_opus:'Opus 周额度',seven_day_sonnet:'Sonnet 周额度',overage:'额外付费用量',unknown:'官方限额状态'};
 function node(tag,cls,text){var n=document.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=text;return n}
 function opened(){return dialog&&dialog.classList.contains('show')}
 function selected(){return typeof CKBackendRoute==='object'&&CKBackendRoute.isSubscription()}
 function model(){return CKBackendRoute.current.subscriptionModel||'sonnet'}
 function timeText(value){return typeof value==='number'&&isFinite(value)?new Date(value*1000).toLocaleString('zh-CN',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'}):'尚未提供'}
 function make(){
  if(dialog)return;
  dialog=node('div','modal-bg');dialog.id='ck-sub-dialog';dialog.setAttribute('aria-hidden','true');
  dialog.innerHTML='<section class="modal ck-sub-card" role="dialog" aria-modal="true" aria-labelledby="ck-sub-title">'+
   '<header class="ck-sub-heading"><div><span class="ck-sub-kicker">专属用量与保护</span><h3 id="ck-sub-title">Claude 订阅</h3></div><button type="button" class="btn btn-outline btn-sm" id="ck-sub-close">关闭</button></header>'+
   '<div class="ck-sub-summary"><div><strong id="ck-sub-state" role="status" aria-live="polite">正在读取订阅状态</strong><p id="ck-sub-detail">还没有订阅也可以先了解和设置用量保护。</p></div><button class="btn btn-outline btn-sm" type="button" id="ck-sub-refresh">刷新状态</button></div>'+
   '<p class="ck-sub-muted" id="ck-sub-renewal" role="status"></p>'+
   '<p class="ck-sub-error" id="ck-sub-error" role="alert" hidden></p>'+
   '<div class="ck-sub-route"><span id="ck-sub-route-label"></span><button class="btn btn-outline btn-sm" type="button" id="ck-sub-connect">连接设置</button><a href="https://claude.ai/settings/usage" target="_blank" rel="noopener noreferrer">官方用量 ↗</a></div>'+
   '<section aria-labelledby="ck-sub-quota-title"><h4 id="ck-sub-quota-title">官方额度</h4><div id="ck-sub-windows" class="ck-sub-windows"></div><p id="ck-sub-updated" class="ck-sub-muted">等待官方用量数据</p></section>'+
   '<form id="ck-sub-policy"><h4>用量保护</h4><p class="ck-sub-muted">设置保存在 VPS，关闭此板块后仍生效。达到暂停线后，CK 停止发起后续订阅请求。</p>'+
   '<fieldset id="ck-sub-fields" disabled><label class="ck-sub-check"><input id="ck-sub-enabled" type="checkbox" checked>启用百分比保护</label>'+
   '<div class="ck-sub-thresholds"><label>提醒<input id="ck-sub-warn" type="number" min="1" max="98" step="1" value="70" required><span>%</span></label><label>高用量提醒<input id="ck-sub-high" type="number" min="2" max="99" step="1" value="85" required><span>%</span></label><label>暂停请求<input id="ck-sub-stop" type="number" min="3" max="100" step="1" value="95" required><span>%</span></label></div>'+
   '<label class="ck-sub-check"><input id="ck-sub-paused" type="checkbox">手动暂停订阅请求</label></fieldset>'+
   '<div class="ck-sub-save"><button class="btn btn-blue btn-sm" id="ck-sub-save" type="submit" disabled>保存保护设置</button><span id="ck-sub-save-state" role="status" aria-live="polite">正在读取服务器设置</span></div></form>'+
   '<details class="ck-sub-help"><summary>首次授权与登录维护</summary><ol><li>按已确定的 iOS 礼品卡方案，在官方 App 完成订阅。</li><li>在 VPS 的订阅专用环境发起官方登录，用手机或 iPad 打开授权链接，登录同一个 Claude 账号。</li><li>若出现一次性登录码，直接粘回发起登录的终端，不填入 CK。</li><li>在连接设置选择「Claude Code · 订阅」，开始正常聊天。</li></ol><p>登录信息保存在 VPS，由官方客户端负责续签。无需额外的定时刷新程序。登录到期且无法刷新时，需重新完成官方授权。</p><p>刷新状态只检查本地登录和用量观测，不发送聊天。已登录不代表续签已验证，也不代表订阅会自动续费。</p></details>'+
   '<p class="ck-sub-footnote">百分比可能延迟或暂缺，一次请求也可能跨过暂停线。阈值用于预留额度，不代表账号安全线。辅助总结、向量与 Fact 继续使用各自 API；额外付费开关以官方设置为准。</p></section>';
  document.body.append(dialog);
  $('ck-sub-close').onclick=close; $('ck-sub-refresh').onclick=function(){refresh(false)};
  $('ck-sub-connect').onclick=function(){close();ckOpenBackendRoute()};
  dialog.onclick=function(e){if(e.target===dialog&&!saving)close()};
  $('ck-sub-policy').addEventListener('input',function(){dirty=true;$('ck-sub-save-state').textContent='有未保存的设置'});
  $('ck-sub-policy').onsubmit=function(e){e.preventDefault();save()};
  dialog.addEventListener('keydown',function(e){
   if(e.key==='Escape'&&!saving){e.preventDefault();close()}
   if(e.key==='Tab'){
    var items=Array.from(dialog.querySelectorAll('button,input,a,summary')).filter(function(n){return !n.matches(':disabled')&&n.getClientRects().length});
    var first=items[0],last=items[items.length-1];
    if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus()}
    else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus()}
   }
  });
 }
 function close(){if(saving)return;generation++;if(controller)controller.abort();controller=null;dialog.classList.remove('show');dialog.setAttribute('aria-hidden','true');if(previousFocus&&previousFocus.isConnected)previousFocus.focus();schedule()}
 function schedule(){clearTimeout(timer);if(!document.hidden&&(opened()||selected()))timer=setTimeout(function(){refresh(false)},opened()?15000:30000)}
 function quotaCard(key,w){
  var card=node('article','ck-sub-window'),valid=w&&!w.expired,pct=valid&&typeof w.used_percent==='number'&&isFinite(w.used_percent)?w.used_percent:null;
  card.append(node('span','ck-sub-window-label',labels[key]||'额度'));
  card.append(node('strong','ck-sub-number',pct===null?'—':Number(pct.toFixed(1))+'%'));
  if(pct!==null){var progress=node('progress');progress.max=100;progress.value=pct;progress.setAttribute('aria-label',(labels[key]||'额度')+' 已用 '+pct+'%');card.append(progress)}
  else card.append(node('div','ck-sub-empty-bar'));
  var status=!w?'等待官方数据':w.expired?'周期已结束，等待新数据':w.status==='rejected'?'官方已限额':w.stale?'上次观测 · 非实时':pct===null?'官方暂未提供百分比':'已用额度';
  if(w&&w.stale&&pct!==null&&status.indexOf('非实时')<0)status+=' · 上次观测，非实时';
  if(w&&w.applies===false)status+=' · 不影响所选模型';
  card.append(node('p','ck-sub-muted',status),node('p','ck-sub-reset',w&&w.resets_at?'重置：'+timeText(w.resets_at):'重置时间尚未提供'));
  if(pct!==null)card.append(node('p','ck-sub-muted','百分比观测：'+timeText(w.usage_observed_at||w.updated_at)));
  if(valid&&w.status==='rejected')card.dataset.level='paused';
  return card;
 }
 function render(value){
  data=value;var q=value.quota,auth=value.auth;
  if(!q||!q.policy||!Array.isArray(q.windows)||!auth)throw Error('服务器尚未返回完整订阅监控数据');
  var needsLogin=!auth.ready&&auth.state==='login_required';
  var state=!auth.ready?(needsLogin?'尚未登录订阅':auth.state==='unknown'?'登录状态待确认':'订阅环境需检查'):q.blocked?'订阅请求已暂停':q.level==='high'?'订阅用量偏高':q.level==='warning'?'订阅额度提醒':q.level==='normal'?'订阅已连接':'已登录 · 等待用量';
  var badge=$('ck-sub-nav-state');if(badge){badge.textContent=!auth.ready?(needsLogin?'未登录':'需检查'):q.blocked?'已暂停':q.level==='high'||q.level==='warning'?'留意额度':'';badge.dataset.level=q.level}
  if(selected()&&auth.ready&&['high','warning','paused'].includes(q.level)){
   var notice=q.level+':'+(q.reason||'');if(notified!==notice&&typeof toast==='function')toast('Claude 订阅：'+(q.reason||state));notified=notice;
  }else notified='';
  if(!dialog)return;
  $('ck-sub-state').textContent=state;$('ck-sub-state').dataset.level=q.level;
  $('ck-sub-detail').textContent=!auth.ready?(auth.message||'订阅后，在 VPS 的订阅专用环境完成官方授权。'):q.blocked?q.reason:!value.event_supported?'当前客户端组件未提供用量事件，需要更新后才能自动监控。':'接收官方用量观测，不按 token 估算剩余百分比。';
  $('ck-sub-renewal').textContent=auth.renewal?auth.renewal.message:'登录维护信息尚未提供，请更新服务器后检查。';
  $('ck-sub-route-label').textContent=(selected()?'当前聊天：Claude 订阅':'当前聊天未使用 Claude 订阅')+' · 保护状态按 '+(q.model||model())+' 显示';
  var body=$('ck-sub-windows');body.replaceChildren();
  var byKey={};q.windows.forEach(function(w){byKey[w.key]=w});
  ['five_hour','seven_day'].concat(Object.keys(byKey).filter(function(k){return k!=='five_hour'&&k!=='seven_day'})).forEach(function(key){body.append(quotaCard(key,byKey[key]))});
  $('ck-sub-updated').textContent=q.last_observed_at?'最近状态事件：'+timeText(q.last_observed_at)+' · 百分比更新时间见各额度卡片；刷新不会主动更新官方额度':'尚未收到官方用量，不表示已用 0%';
  if(!dirty){$('ck-sub-enabled').checked=q.policy.enabled;$('ck-sub-paused').checked=q.policy.paused;$('ck-sub-warn').value=q.policy.warn_percent;$('ck-sub-high').value=q.policy.high_percent;$('ck-sub-stop').value=q.policy.stop_percent;$('ck-sub-save-state').textContent='已读取服务器设置'}
  $('ck-sub-fields').disabled=saving||q.storage_error;$('ck-sub-save').disabled=saving||q.storage_error;
 }
 async function request(path,body,signal){
  var key=typeof storedPanelKey==='function'?storedPanelKey():'';
  if(!key)throw Error('请先登录 CK 面板，再读取订阅信息');
  var options={headers:{'x-api-key':key},cache:'no-store',signal:signal};
  if(body){options.method='POST';options.headers['Content-Type']='application/json';options.body=JSON.stringify(body)}
  var response=await fetch(CKBackendRoute.current.gateway+'/ck/subscription/'+path+'?model='+encodeURIComponent(model()),options);
  var value=await response.json().catch(function(){return {}});
  if(!response.ok)throw Error(response.status===404?'服务器尚未安装订阅信息板块，请先更新服务器。':response.status===403?'面板身份验证未通过，请重新登录。':value.error||'暂时无法连接订阅服务');
  return value;
 }
 async function refresh(isSave,policy){
  if(saving&&!isSave)return;
  clearTimeout(timer);if(controller)controller.abort();var token=++generation;controller=new AbortController();var active=controller,timeout=setTimeout(function(){active.abort()},22000);
  if(dialog){$('ck-sub-refresh').disabled=true;$('ck-sub-error').hidden=true}
  try{
   var value=await request(isSave?'policy':'monitor',policy,active.signal);if(token!==generation)return;
   if(isSave)dirty=false;
   render(value);
   if(dialog&&isSave)$('ck-sub-save-state').textContent='已保存，下次订阅请求起生效';
  }catch(e){
   if(token!==generation)return;
   if(dialog){$('ck-sub-error').hidden=false;$('ck-sub-error').textContent=e.name==='AbortError'?'连接超时；如果正在保存，请刷新核对设置。':e.message;$('ck-sub-state').textContent='暂未取得最新状态';$('ck-sub-renewal').textContent='登录维护状态暂未确认，请恢复连接后刷新。';$('ck-sub-fields').disabled=true;$('ck-sub-save').disabled=true;$('ck-sub-updated').textContent=data?'下方为上次观测，当前连接不可用。':'等待连接订阅服务';if(isSave)$('ck-sub-save-state').textContent='保存结果未确认，请刷新核对'}
   var badge=$('ck-sub-nav-state');if(badge)badge.textContent='状态未知';
  }finally{clearTimeout(timeout);if(token===generation){controller=null;if(dialog)$('ck-sub-refresh').disabled=false;schedule()}}
 }
 async function save(){
  if(saving)return;
  var p={enabled:$('ck-sub-enabled').checked,paused:$('ck-sub-paused').checked,warn_percent:Number($('ck-sub-warn').value),high_percent:Number($('ck-sub-high').value),stop_percent:Number($('ck-sub-stop').value)};
  if(![p.warn_percent,p.high_percent,p.stop_percent].every(Number.isInteger)||!(1<=p.warn_percent&&p.warn_percent<p.high_percent&&p.high_percent<p.stop_percent&&p.stop_percent<=100)){$('ck-sub-save-state').textContent='需满足：1 ≤ 提醒 < 高用量提醒 < 暂停 ≤ 100';return}
  saving=true;$('ck-sub-fields').disabled=true;$('ck-sub-save').disabled=true;$('ck-sub-close').disabled=true;$('ck-sub-connect').disabled=true;
  await refresh(true,p);saving=false;$('ck-sub-close').disabled=false;$('ck-sub-connect').disabled=false;
  if($('ck-sub-error').hidden){$('ck-sub-fields').disabled=!!data.quota.storage_error;$('ck-sub-save').disabled=!!data.quota.storage_error}
 }
 window.ckOpenSubscription=function(){make();previousFocus=document.activeElement;dialog.classList.add('show');dialog.setAttribute('aria-hidden','false');$('ck-sub-close').focus();refresh(false)};
 document.addEventListener('visibilitychange',function(){if(document.hidden){clearTimeout(timer);if(!saving){generation++;if(controller)controller.abort()}}else if(opened()||selected())refresh(false)});
 document.addEventListener('DOMContentLoaded',schedule);
})();
