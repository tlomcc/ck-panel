/* CK's single-choice controls keep their native form value and change handlers. */
(function(){
  'use strict';
  var controls=new Map(),queued=false;
  function label(select){
    if(select.matches('.prov-model-select,.assign-model-select'))return '选择模型';
    var owner=select.labels&&select.labels[0];
    var text=owner&&Array.from(owner.childNodes).filter(function(n){return n.nodeType===3}).map(function(n){return n.textContent}).join(' ').trim();
    return select.getAttribute('aria-label')||text||select.title||'选择一项';
  }
  function sync(){
    queued=false;
    controls.forEach(function(button,select){
      if(!select.isConnected){button.remove();controls.delete(select);return}
      var option=select.options[select.selectedIndex];
      var text=option?option.textContent:'请选择';
      if(button.firstChild.textContent!==text)button.firstChild.textContent=text;
      button.disabled=select.matches(':disabled');
      button.hidden=select.hidden||select.getAttribute('aria-hidden')==='true';
      button.setAttribute('aria-label',label(select)+'：'+text);
    });
    document.querySelectorAll('select:not([multiple]):not([data-ck-select])').forEach(function(select){
      if(select.size>1)return;
      var button=document.createElement('button');
      button.type='button';button.className='ck-select-button';
      button.innerHTML='<span></span><svg viewBox="0 0 20 20" aria-hidden="true"><path d="m6 8 4 4 4-4"/></svg>';
      button.setAttribute('aria-haspopup','dialog');
      button.setAttribute('aria-expanded','false');
      select.dataset.ckSelect='true';
      select.insertAdjacentElement('afterend',button);controls.set(select,button);
      button.addEventListener('click',function(){open(select,button)});
      button.addEventListener('keydown',function(e){if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();open(select,button)}});
      select.addEventListener('focus',function(){button.focus()});
      select.addEventListener('invalid',function(e){e.preventDefault();button.focus()});
      schedule();
    });
  }
  function schedule(){if(!queued){queued=true;queueMicrotask(sync)}}
  async function open(select,button){
    if(select.matches(':disabled')||!select.isConnected||button.getAttribute('aria-expanded')==='true')return;
    var options=Array.from(select.options);
    var choices=options.map(function(option,index){
      var group=option.parentElement;
      return {value:String(index),label:option.textContent,active:option.selected,
        hint:group.tagName==='OPTGROUP'?group.label:'',disabled:option.disabled||(group.tagName==='OPTGROUP'&&group.disabled),hidden:option.hidden};
    }).filter(function(choice){return !choice.hidden});
    button.setAttribute('aria-expanded','true');
    try{
      var selected=await ckChooseDialog(label(select),choices,{searchable:choices.length>8});
      if(selected===null||!select.isConnected||select.matches(':disabled'))return;
      var option=options[Number(selected)];
      if(!option||option.disabled||option.hidden||option.parentElement.disabled||!select.contains(option))return;
      var old=select.value;
      select.selectedIndex=Array.from(select.options).indexOf(option);
      if(select.value!==old){select.dispatchEvent(new Event('input',{bubbles:true}));select.dispatchEvent(new Event('change',{bubbles:true}))}
    }finally{button.setAttribute('aria-expanded','false');sync()}
  }
  document.addEventListener('change',schedule);
  document.addEventListener('reset',function(){setTimeout(sync,0)});
  new MutationObserver(function(records){
    if(records.some(function(record){return !record.target.closest?.('.ck-select-button')&&
      (record.target.tagName==='SELECT'||record.target.tagName==='OPTION'||record.type==='childList'||record.target.tagName==='FIELDSET')}))schedule();
  }).observe(document.documentElement,{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:['disabled','hidden','selected','value','label']});
  // Script assignments to .value do not emit DOM mutations. Refresh visible labels
  // after each user action; changing a select programmatically never emits change.
  document.addEventListener('click',schedule);
  window.ckSyncSelects=sync;
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',sync);else sync();
})();
