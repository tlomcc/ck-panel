(function(root){
  'use strict';
  var fields=['calls','input_tokens','output_tokens','cache_read_tokens','input_known_calls','output_known_calls','cache_known_calls','output_partial_calls','cache_rate_input_tokens','cache_rate_read_tokens','cache_rate_calls','pending_calls','failed_calls','incomplete_calls'];
  function empty(){var value={};fields.forEach(function(k){value[k]=0});return value}
  function add(target,value){fields.forEach(function(k){target[k]+=value[k]||0});return target}
  function valid(data){
    return !!(data&&data.ok===true&&data.timezone==='Asia/Shanghai'&&Number.isFinite(data.tracking_since)&&data.tracking_since>0&&data.period&&Array.isArray(data.daily)&&Array.isArray(data.breakdown)&&[data.totals].concat(data.daily,data.breakdown).every(function(row){return row&&fields.every(function(k){return Number.isSafeInteger(row[k])&&row[k]>=0})}));
  }
  function combine(sources){
    var total=empty(),days={},keepalive=0,since=[],covered=false,pending=0;
    sources.forEach(function(source){
      var data=source.data;if(!valid(data))return;
      add(total,data.totals);since.push(data.tracking_since);covered=covered||data.daily.length>0;
      pending+=data.pending_updates||0;
      data.breakdown.forEach(function(row){if(row.kind==='keepalive')keepalive+=row.calls});
      data.daily.forEach(function(row){if(!days[row.date])days[row.date]=Object.assign({date:row.date},empty());add(days[row.date],row)});
    });
    return {totals:total,daily:Object.keys(days).sort().reverse().map(function(day){return days[day]}),keepalive:keepalive,covered:covered,trackingSince:since.length?Math.min.apply(null,since):null,pending:pending};
  }
  function count(value){return Number(value).toLocaleString('zh-CN')}
  function metric(row,key,covered){
    if(!row||covered===false)return '—';
    if(key==='cache_rate')return row.cache_rate_input_tokens>0?(row.cache_rate_read_tokens/row.cache_rate_input_tokens*100).toFixed(2)+'%':'—';
    var known={input_tokens:'input_known_calls',output_tokens:'output_known_calls',cache_read_tokens:'cache_known_calls'}[key];
    if(known&&row.calls>0&&!row[known])return '—';
    return count(row[key]||0);
  }
  function day(now){return new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(now||new Date())}
  if(typeof module==='object'&&module.exports){module.exports={fields:fields,empty:empty,add:add,valid:valid,combine:combine,metric:metric,day:day};return}
  var state={mode:'month',month:day().slice(0,7),sources:[],generation:0,controller:null,timer:0,busy:false,signature:'',updated:0};
  var names={us:'Claude 订阅',cn:'API 聊天'};
  var $=function(id){return document.getElementById(id)};
  function node(tag,cls,text){var el=document.createElement(tag);if(cls)el.className=cls;if(text!==undefined)el.textContent=text;return el}
  function stamp(at){return new Date(at*1000).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'})}
  function sourceKeepalive(data){var row=data.breakdown.find(function(item){return item.kind==='keepalive'});return row?row.calls:0}
  function tableRow(label,data,covered,detail){
    var row=node('tr'),heading=node('th','usage-identity');heading.scope='row';heading.append(node('span','',label));if(detail)heading.append(node('small','',detail));row.append(heading);
    ['calls','input_tokens','output_tokens','cache_read_tokens','cache_rate'].forEach(function(key){row.append(node('td','usage-num',metric(data,key,covered)))});return row;
  }
  function render(){
    if(!$('tab-token-usage'))return;
    var data=combine(state.sources),good=state.sources.filter(function(s){return valid(s.data)}),failed=state.sources.filter(function(s){return s.error}),row=data.totals;
    $('usage-refresh').disabled=state.busy;
    $('usage-updated').textContent=state.busy?'正在刷新…':state.updated?'更新于 '+stamp(state.updated):'尚未读取';
    document.querySelectorAll('[data-usage-mode]').forEach(function(button){var active=button.dataset.usageMode===state.mode;button.setAttribute('aria-selected',String(active));button.tabIndex=active?0:-1});
    var month=$('usage-month');month.value=state.month;month.max=day().slice(0,7);month.hidden=state.mode!=='month';
    if(data.trackingSince)month.min=day(new Date(data.trackingSince*1000)).slice(0,7);
    var period=good.length?good[0].data.period:null;
    $('usage-period').textContent=period?period.start_date+' — '+period.end_date+' · 北京时间':state.mode==='month'?state.month+' · 北京时间':'含今天的近 '+(state.mode==='30d'?'30':'7')+' 天 · 北京时间';
    ['calls','input_tokens','output_tokens','cache_read_tokens','cache_rate'].forEach(function(key){$('usage-'+key.replace(/_/g,'-')).textContent=good.length?metric(row,key,data.covered):'—'});
    $('usage-calls-note').textContent=good.length&&data.covered?'其中保活 '+count(data.keepalive)+' 次':'含保活、重试与工具续接';
    var notes=[];
    if(failed.length)notes.push(failed.map(function(s){return names[s.id]+'：'+s.error}).join('；')+(good.length?'。当前合计不完整。':''));
    if(good.length&&data.covered){
      var missing=row.incomplete_calls;
      if(missing)notes.push(count(missing)+' 次调用的部分用量尚未返回；这里只合计已返回的 token。');
      if(row.output_partial_calls)notes.push(count(row.output_partial_calls)+' 次输出仅返回部分用量，已按返回值计入。');
      if(row.pending_calls||data.pending)notes.push('有调用或后台记录正在完成，统计会自动更新。');
      if(!row.calls&&!state.busy)notes.push('这个时间范围内还没有调用。正常聊天和保活会自动计入。');
    }else if(good.length&&!state.busy)notes.push('该时间范围早于开始统计时间，没有历史用量。');
    if(!good.length&&!failed.length)notes.push('正在读取订阅与 API 的用量记录…');
    var status=$('usage-status');status.textContent=notes.join(' ');status.hidden=!notes.length;status.classList.toggle('has-error',failed.length>0);
    $('usage-summary').setAttribute('aria-busy',String(state.busy&&!good.length));
    $('usage-tracking').textContent=data.trackingSince?'自 '+stamp(data.trackingSince)+' 开始自动统计，数据永久保留。':'后台自动统计，数据永久保留。';
    var sourceBody=$('usage-source-rows');sourceBody.replaceChildren();
    ['us','cn'].forEach(function(id){var source=state.sources.find(function(s){return s.id===id}),value=source&&source.data,available=valid(value);sourceBody.append(tableRow(names[id],available?value.totals:null,available&&value.daily.length>0,available?'含保活 '+count(sourceKeepalive(value))+' 次':source&&source.error?'暂不可读':'读取中'))});
    var dailyBody=$('usage-daily-rows');dailyBody.replaceChildren();
    data.daily.forEach(function(item){dailyBody.append(tableRow(item.date,item,true,''))});
    if(!data.daily.length){var tr=node('tr'),td=node('td','usage-empty',good.length?'这个范围暂无统计记录。':'统计记录尚未加载。');td.colSpan=6;tr.append(td);dailyBody.append(tr)}
    $('usage-daily-count').textContent=data.daily.length?' · '+data.daily.length+' 天':'';
  }
  function stop(){clearTimeout(state.timer);state.timer=0;if(state.controller)state.controller.abort();state.controller=null;state.generation++;state.busy=false}
  async function refresh(){
    if(root.currentPanelTab!=='token-usage'||document.hidden)return;
    stop();var generation=state.generation,key=typeof storedPanelKey==='function'?storedPanelKey():'',signature=state.mode+'|'+state.month+'|'+key;
    if(signature!==state.signature){state.sources=[];state.updated=0;state.signature=signature}
    state.busy=true;state.controller=new AbortController();var active=state.controller;
    var timeout=setTimeout(function(){active.abort()},12000);render();
    var query='?mode='+encodeURIComponent(state.mode)+(state.mode==='month'?'&month='+encodeURIComponent(state.month):'');
    try{
      var results=await Promise.all(['us','cn'].map(async function(id){
        try{
          var origin=root.CKBackendRoute&&CKBackendRoute.servers[id];
          if(!origin||!key)throw Error('尚未登录');
          var response=await fetch(origin+'/gateway/ck/token-usage'+query,{cache:'no-store',headers:{'x-api-key':key},signal:active.signal});
          if(!response.ok)throw Error(response.status===401||response.status===403?'身份验证未通过':response.status===404?'统计尚未启用':'暂时无法读取');
          var data=await response.json();if(!valid(data)||data.region!==id||data.period.mode!==state.mode||(state.mode==='month'&&data.period.month!==state.month))throw Error('统计数据不完整');
          return {id:id,data:data};
        }catch(error){return {id:id,error:error.name==='AbortError'?'连接超时':error.message||'连接失败'}}
      }));
      if(generation!==state.generation||key!==(typeof storedPanelKey==='function'?storedPanelKey():''))return;
      state.sources=results;state.updated=results.some(function(s){return valid(s.data)})?Date.now()/1000:0;
    }finally{
      clearTimeout(timeout);
      if(generation===state.generation){state.busy=false;state.controller=null;render();if(root.currentPanelTab==='token-usage'&&!document.hidden)state.timer=setTimeout(refresh,30000)}
    }
  }
  root.ckTokenUsageEnter=function(){render();refresh()};
  root.ckTokenUsageLeave=stop;
  root.ckTokenUsageRefresh=refresh;
  document.addEventListener('click',function(event){var button=event.target.closest('[data-usage-mode]');if(!button)return;state.mode=button.dataset.usageMode;refresh()});
  document.addEventListener('change',function(event){if(event.target.id!=='usage-month')return;var value=event.target.value;if(!/^[0-9]{4}-(0[1-9]|1[0-2])$/.test(value)||value>day().slice(0,7)){render();return}state.month=value;refresh()});
  document.addEventListener('keydown',function(event){
    var button=event.target.closest('[data-usage-mode]');if(!button||!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;
    event.preventDefault();var modes=['month','30d','7d'],i=modes.indexOf(state.mode);i=event.key==='Home'?0:event.key==='End'?2:(i+(event.key==='ArrowRight'?1:2))%3;state.mode=modes[i];refresh();document.querySelector('[data-usage-mode="'+state.mode+'"]').focus();
  });
  document.addEventListener('visibilitychange',function(){if(root.currentPanelTab==='token-usage'){if(document.hidden)stop();else refresh()}});
  document.addEventListener('DOMContentLoaded',function(){if(root.currentPanelTab==='token-usage')root.ckTokenUsageEnter()});
})(typeof globalThis==='object'?globalThis:this);
