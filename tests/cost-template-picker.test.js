const assert=require('assert');
const fs=require('fs');
const path=require('path');
const vm=require('vm');

const source=fs.readFileSync(path.resolve(__dirname,'../script.js'),'utf8');

function extractFunction(name){
  const start=source.indexOf(`function ${name}(`);
  assert(start>=0,`missing function ${name}`);
  const brace=source.indexOf('{',start);
  let depth=0;
  for(let index=brace;index<source.length;index++){
    if(source[index]==='{')depth++;
    if(source[index]==='}'&&--depth===0)return source.slice(start,index+1);
  }
  throw new Error(`unterminated function ${name}`);
}

function escaped(value){
  return String(value).replace(/[&<>]/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;'})[char]);
}

function escapedAttr(value){
  return escaped(value).replace(/"/g,'&quot;');
}

function editorFor(entry){
  const model={value:String(entry.model||'')};
  const inputs={};
  ['currency','input','output','cache_create','cache_read','multiplier'].forEach(field=>{
    inputs[field]={
      value:String(entry[field]),
      getAttribute:name=>name==='data-price-field'?field:''
    };
  });
  return {
    model,
    inputs,
    querySelector:selector=>selector==='.chat-cost-default-model'?model:null,
    querySelectorAll:selector=>selector==='.chat-cost-default-input'?Object.values(inputs):[]
  };
}

const box={
  attrs:{},
  html:'',
  editor:null,
  setAttribute(name,value){this.attrs[name]=String(value)},
  getAttribute(name){return this.attrs[name]},
  querySelector(selector){return selector==='.chat-cost-default-editor'?this.editor:null}
};

const savedDefaults=[
  {model:'opus',currency:'¥',input:5,output:25,cache_create:6.25,cache_read:.5,multiplier:.2},
  {model:'sonnet',currency:'$',input:15,output:75,cache_create:18.75,cache_read:1.5,multiplier:1}
];

const context={
  console,
  document:{getElementById:id=>id==='chat-cost-defaults'?box:null},
  esc:escaped,
  escAttr:escapedAttr,
  chatDefaultCostPricing:()=>({
    currency:'¥',inputPerMTokens:3,outputPerMTokens:15,
    cacheCreate5mPerMTokens:3.75,cacheReadPerMTokens:.3,multiplier:1
  }),
  chatCostDefaults:()=>savedDefaults,
  chatRenderMessages:()=>{},
  toast:()=>{}
};
vm.createContext(context);
vm.runInContext(`
  var CHAT_COST_DEFAULT_FIELDS=[
    ['input','输入 / 1M'],['output','输出 / 1M'],
    ['cache_create','缓存创建 / 1M'],['cache_read','缓存命中 / 1M'],['multiplier','倍率']
  ];
  var CHAT_COST_DEFAULT_MAX_ROWS=20;
  var chatCostDefaultsDraft=null;
  var chatCostDefaultsSelectedIndex=0;
`,context);
[
  'chatNormalizeCostDefaultEntry','chatNormalizeCostDefaults','chatCostDefaultsDraftList',
  'chatCostDefaultsCaptureEditor','chatRenderCostDefaults','chatSelectCostDefault',
  'chatReadCostDefaults','chatSaveCostDefaults'
].forEach(name=>vm.runInContext(extractFunction(name),context));

Object.defineProperty(box,'innerHTML',{
  get(){return this.html},
  set(value){
    this.html=String(value);
    const list=context.chatCostDefaultsDraft;
    const index=context.chatCostDefaultsSelectedIndex;
    this.editor=Array.isArray(list)&&list[index]?editorFor(list[index]):null;
  }
});

context.chatSaveConfig=()=>({costPricingDefaults:context.chatReadCostDefaults(savedDefaults)});

context.chatRenderCostDefaults(savedDefaults);
assert.strictEqual(context.chatCostDefaultsSelectedIndex,0);
assert.strictEqual((box.html.match(/<div\b/g)||[]).length,(box.html.match(/<\/div>/g)||[]).length,
  '默认价格模板 HTML 的 div 必须完整闭合');

box.editor.model.value='opus-edited';
box.editor.inputs.output.value='99';
context.chatSelectCostDefault({value:'1'});
assert.strictEqual(context.chatCostDefaultsDraft[0].model,'opus-edited','切换模板前要保留模型关键字草稿');
assert.strictEqual(context.chatCostDefaultsDraft[0].output,99,'切换模板前要保留价格草稿');
assert.strictEqual(box.editor.inputs.output.value,'75','切换后要显示目标模板');

box.editor.inputs.multiplier.value='.75';
const saved=context.chatSaveCostDefaults();
assert.strictEqual(saved.costPricingDefaults.length,2,'保存时不能只保留当前模板');
assert.strictEqual(saved.costPricingDefaults[0].output,99,'保存时要包含切换前的草稿');
assert.strictEqual(saved.costPricingDefaults[1].multiplier,.75,'保存时要包含当前编辑器的修改');

context.chatSelectCostDefault({value:'0'});
assert.strictEqual(box.editor.model.value,'opus-edited','保存后切回模板要恢复已保存的模型关键字');
assert.strictEqual(box.editor.inputs.output.value,'99','保存后切回模板要恢复已保存的价格');

console.log('cost template picker tests: OK');
