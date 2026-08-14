const assert=require('assert');
const fs=require('fs');
const vm=require('vm');

const source=fs.readFileSync(require.resolve('../script.js'),'utf8');

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

const RULES_FNS=[
  'rulesNewKey','rulesRowHtml','rulesAutoGrow','rulesBindResize','rulesRenumber','rulesMarkDirty','rulesCollect',
  'rulesDraftRules','rulesTimeText','rulesErrorText','renderRulesPage','chatRenderSpeechPreferences'
];

// 极简 DOM：只要能建元素、查 class、读 value 就够验证这几个纯渲染函数。
function makeDom(){
  const byId={};
  function el(tag){
    const node={
      tagName:String(tag||'div').toUpperCase(),
      className:'',innerHTML:'',textContent:'',value:'',attrs:{},children:[],
      getAttribute(k){return (k in this.attrs)?this.attrs[k]:null},
      setAttribute(k,v){this.attrs[k]=String(v)},
      querySelector(){return null},
      querySelectorAll(){return []}
    };
    return node;
  }
  return {byId,el,getElementById:id=>byId[id]||null};
}

function rulesContext(){
  const dom=makeDom();
  const collected=[];
  const context={
    console,
    rulesPageState:{data:null,loading:false,busy:false,dirty:false},
    RULES_DEFAULT_CATEGORY:'other',
    RULES_DEFAULT_PRIORITY:'strong',
    rulesRowSeq:0,
    rulesResizeBound:false,
    Date,
    chatSpeechConsoleState:{data:null},
    esc:s=>String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'),
    escAttr:s=>String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'),
    document:{
      getElementById:dom.getElementById,
      querySelectorAll:sel=>(collected.length&&sel.indexOf('.rules-row')>=0?collected:[])
    }
  };
  vm.createContext(context);
  RULES_FNS.forEach(name=>vm.runInContext(extractFunction(name),context));
  context.__dom=dom;
  context.__rows=collected;
  return context;
}

function bodyNode(){
  return {innerHTML:'',querySelector:()=>null,querySelectorAll:()=>[]};
}

// ---------------------------------------------------------------------------
// 用户明确要求：每条规则下面的「类别 / 强度」两个下拉框全部删掉
// ---------------------------------------------------------------------------
function testRowHasNoSelects(){
  const context=rulesContext();
  const html=context.rulesRowHtml({key:'a',instruction:'不要叫我宝宝',category:'addressing',priority:'hard'});
  assert.strictEqual(html.indexOf('<select'),-1,'规则行不允许再出现任何下拉框');
  assert.strictEqual(html.indexOf('rules-row-category'),-1);
  assert.strictEqual(html.indexOf('rules-row-priority'),-1);
  assert.ok(html.indexOf('rules-row-text')>=0,'正文输入框仍然要在');
  assert.ok(html.indexOf('rules-row-del')>=0,'删除按钮仍然要在');
}

// 类别和强度是后端字段，页面不展示但必须原样带回，否则一次保存就把老规则的强度抹平
function testHiddenFieldsSurviveOnTheRow(){
  const context=rulesContext();
  const html=context.rulesRowHtml({key:'a',instruction:'x',category:'addressing',priority:'hard'});
  assert.ok(html.indexOf('data-rule-category="addressing"')>=0,'类别要藏在 data-* 里带回去');
  assert.ok(html.indexOf('data-rule-priority="hard"')>=0,'强度要藏在 data-* 里带回去');
  const fresh=context.rulesRowHtml({});
  assert.ok(fresh.indexOf('data-rule-category="other"')>=0,'新行用默认类别');
  assert.ok(fresh.indexOf('data-rule-priority="strong"')>=0,'新行用默认强度');
}

function testRowCarriesNumberSlot(){
  const context=rulesContext();
  assert.ok(context.rulesRowHtml({}).indexOf('rules-row-index')>=0,'每行要有编号位');
}

function testNewRowsGetUniqueKeys(){
  const context=rulesContext();
  const keys=new Set();
  for(let i=0;i<50;i++)keys.add(context.rulesNewKey());
  assert.strictEqual(keys.size,50,'连续新增的行不能撞 key，否则后端会报 rule keys must be unique');
}

// ---------------------------------------------------------------------------
// 收集：空行跳过、隐藏字段回填、key 不重复
// ---------------------------------------------------------------------------
function fakeRow(key,text,category,priority){
  const attrs={'data-rule-key':key,'data-rule-category':category||'other','data-rule-priority':priority||'strong'};
  return {
    getAttribute:k=>(k in attrs?attrs[k]:null),
    querySelector:sel=>(sel==='.rules-row-text'?{value:text}:null)
  };
}

function testCollectSkipsEmptyRowsAndKeepsHiddenFields(){
  const context=rulesContext();
  context.__rows.push(
    fakeRow('a','不要叫我宝宝','addressing','hard'),
    fakeRow('b','   '),
    fakeRow('c','回复要分段','format','strong')
  );
  const out=context.rulesCollect();
  assert.strictEqual(out.length,2,'只填了内容的行才提交');
  assert.strictEqual(out[0].key,'a');
  assert.strictEqual(out[0].category,'addressing');
  assert.strictEqual(out[0].priority,'hard');
  assert.strictEqual(out[1].instruction,'回复要分段');
}

function testCollectDeduplicatesKeys(){
  const context=rulesContext();
  context.__rows.push(fakeRow('same','第一条'),fakeRow('same','第二条'));
  const out=context.rulesCollect();
  assert.strictEqual(out.length,2);
  assert.notStrictEqual(out[0].key,out[1].key,'重复 key 必须改掉，否则后端整批拒绝');
}

// ---------------------------------------------------------------------------
// 聊天抽屉预览：上面写"共 N 条"，下面每条要有 1/2/3 编号
// ---------------------------------------------------------------------------
function testPreviewIsNumbered(){
  const context=rulesContext();
  const meta={textContent:''},preview={innerHTML:''},status={textContent:''};
  context.__dom.byId['chat-speech-meta']=meta;
  context.__dom.byId['chat-speech-preview']=preview;
  context.__dom.byId['chat-speech-status']=status;
  context.chatRenderSpeechPreferences({
    rules:[{instruction:'第一条'},{instruction:'第二条'},{instruction:'第三条'}],
    source:'github'
  });
  assert.strictEqual(meta.textContent,'共 3 条');
  const nums=preview.innerHTML.match(/chat-speech-num">(\d+)</g)||[];
  assert.strictEqual(nums.length,3,'三条规则要有三个编号');
  assert.ok(preview.innerHTML.indexOf('chat-speech-num">1<')>=0);
  assert.ok(preview.innerHTML.indexOf('chat-speech-num">3<')>=0);
  assert.ok(preview.innerHTML.indexOf('第二条')>=0);
}

function testPreviewMarksDisabled(){
  const context=rulesContext();
  const meta={textContent:''};
  context.__dom.byId['chat-speech-meta']=meta;
  context.__dom.byId['chat-speech-preview']={innerHTML:''};
  context.chatRenderSpeechPreferences({rules:[{instruction:'x'}],enabled:false});
  assert.ok(meta.textContent.indexOf('已停用')>=0,'停用状态要在条数旁边说清楚');
}

function testPreviewEmptyState(){
  const context=rulesContext();
  const preview={innerHTML:''};
  context.__dom.byId['chat-speech-meta']={textContent:''};
  context.__dom.byId['chat-speech-preview']=preview;
  context.chatRenderSpeechPreferences({rules:[]});
  assert.ok(preview.innerHTML.indexOf('chat-speech-empty')>=0);
}

// ---------------------------------------------------------------------------
// 报错要说人话：跨域/断网时 fetch 抛的是 "Failed to fetch"
// ---------------------------------------------------------------------------
function testErrorTextIsHumanReadable(){
  const context=rulesContext();
  assert.ok(context.rulesErrorText(new Error('Failed to fetch')).indexOf('连不上 CK 网关')>=0);
  assert.ok(context.rulesErrorText(new Error('Load failed')).indexOf('连不上 CK 网关')>=0);
  assert.strictEqual(context.rulesErrorText(new Error('too many rules')),'too many rules','服务端的真实原因要原样保留');
  assert.strictEqual(context.rulesErrorText(''),'请稍后重试');
}

function testTimeTextIsTrimmed(){
  const context=rulesContext();
  assert.strictEqual(context.rulesTimeText('2026-08-13T19:08:49+08:00'),'2026-08-13 19:08');
  assert.strictEqual(context.rulesTimeText(''),'未发布过');
}

// 规则常有两三行，固定高度会把后半句藏起来
function testTextareaGrowsWithContent(){
  const context=rulesContext();
  const el={style:{height:''},scrollHeight:132};
  context.rulesAutoGrow(el);
  assert.strictEqual(el.style.height,'132px','长内容要撑开输入框');
  const short={style:{height:''},scrollHeight:20};
  context.rulesAutoGrow(short);
  assert.strictEqual(short.style.height,'56px','短内容不低于最小高度');
  context.rulesAutoGrow(null);
  context.rulesAutoGrow({});
}

// ---------------------------------------------------------------------------
// 整页渲染：按钮齐全、没有下拉框、条数对得上
// ---------------------------------------------------------------------------
function testPageRender(){
  const context=rulesContext();
  const body=bodyNode();
  context.__dom.byId['rules-page-body']=body;
  context.rulesPageState.data={
    rule_count:2,
    updated_at:'2026-08-13T19:08:49+08:00',
    previous_updated_at:'2026-08-10T10:00:00+08:00',
    enabled:true,
    rules:[{key:'a',instruction:'甲'},{key:'b',instruction:'乙'}],
    draft:{rules:[{key:'a',instruction:'甲'},{key:'b',instruction:'乙'}],dirty:false}
  };
  context.renderRulesPage();
  const html=body.innerHTML;
  assert.strictEqual(html.indexOf('<select'),-1,'整页都不应该再出现下拉框');
  ['rulesPublish()','rulesSaveDraft()','rulesToggleEnabled()','loadRulesPage(true)','rulesAddRow()']
    .forEach(fn=>assert.ok(html.indexOf(fn)>=0,'缺少按钮：'+fn));
  assert.strictEqual((html.match(/class="rules-row"/g)||[]).length,2,'两条规则渲染两行');
  assert.ok(html.indexOf('rules-add-row')>=0,'列表底部要有"新增一条规则"');
  assert.strictEqual(html.indexOf('r0'),-1,'页面不显示版本号');
}

function testPageRenderDisabledNotice(){
  const context=rulesContext();
  const body=bodyNode();
  context.__dom.byId['rules-page-body']=body;
  context.rulesPageState.data={enabled:false,rule_count:1,rules:[{key:'a',instruction:'甲'}],draft:{rules:[{key:'a',instruction:'甲'}]}};
  context.renderRulesPage();
  assert.ok(body.innerHTML.indexOf('已停用')>=0);
  assert.ok(body.innerHTML.indexOf('重新启用规则')>=0);
}

function testPageRenderEmptyState(){
  const context=rulesContext();
  const body=bodyNode();
  context.__dom.byId['rules-page-body']=body;
  context.rulesPageState.data={enabled:true,rule_count:0,rules:[],draft:{rules:[]}};
  context.renderRulesPage();
  assert.ok(body.innerHTML.indexOf('rules-empty')>=0);
  assert.ok(body.innerHTML.indexOf('rules-add-row')>=0,'空状态也要能直接新增');
}

function testBusyDisablesButtons(){
  const context=rulesContext();
  const body=bodyNode();
  context.__dom.byId['rules-page-body']=body;
  context.rulesPageState.busy=true;
  context.rulesPageState.data={enabled:true,rule_count:0,rules:[],draft:{rules:[]}};
  context.renderRulesPage();
  assert.ok(body.innerHTML.indexOf('type="button" disabled')>=0,'请求进行中时按钮要禁用，避免重复提交');
  assert.ok(body.innerHTML.indexOf('处理中…')>=0);
}

testRowHasNoSelects();
testHiddenFieldsSurviveOnTheRow();
testRowCarriesNumberSlot();
testNewRowsGetUniqueKeys();
testCollectSkipsEmptyRowsAndKeepsHiddenFields();
testCollectDeduplicatesKeys();
testPreviewIsNumbered();
testPreviewMarksDisabled();
testPreviewEmptyState();
testErrorTextIsHumanReadable();
testTimeTextIsTrimmed();
testTextareaGrowsWithContent();
testPageRender();
testPageRenderDisabledNotice();
testPageRenderEmptyState();
testBusyDisablesButtons();

console.log('rules page tests: OK');
