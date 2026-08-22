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
  'rulesPublishedMap','rulesRefreshFooter','rulesUpdateRowFlags','rulesDiffText','rulesStatusHintText','rulesFilter',
  'rulesUpdateMetrics','rulesDraftRules','rulesUsePublishedDraft','rulesTimeText','rulesErrorText','renderRulesPage','chatRenderSpeechPreferences'
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
    rulesPageState:{data:null,loading:false,busy:false,dirty:false,diff:null},
    RULES_DEFAULT_CATEGORY:'other',
    RULES_DEFAULT_PRIORITY:'strong',
    rulesRowSeq:0,
    rulesFilterText:'',
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
  assert.ok(html.indexOf('rules-row-menu')>=0,'规则操作菜单仍然要在');
  assert.strictEqual(html.indexOf('maxlength='),-1,'规则输入不得保留旧字数硬限制');
}

// 用户明确选定的排序方式：↑↓ 常显在行上（手机一定点得到），跨很远的移动放进 ⋮ 菜单
function testMoveButtonsAreAlwaysVisible(){
  const context=rulesContext();
  const html=context.rulesRowHtml({key:'a',instruction:'x'});
  assert.ok(html.indexOf('rules-row-move')>=0,'每行要有常显的排序按钮');
  assert.ok(html.indexOf('rulesMoveRow(this,-1)')>=0);
  assert.ok(html.indexOf('rulesMoveRow(this,1)')>=0);
  assert.ok(html.indexOf('rules-row-move')<html.indexOf('<details'),'排序按钮不能再收进 ⋮ 菜单里');
  assert.ok(html.indexOf('rulesMoveRowEdge(this,-1)')>=0,'菜单里要有「移到最前」');
  assert.ok(html.indexOf('rulesMoveRowEdge(this,1)')>=0,'菜单里要有「移到最后」');
  assert.ok(html.indexOf('rulesDuplicateRow(this)')>=0,'菜单里要能复制一条');
  assert.ok(html.indexOf('rulesDeleteRow(this)')>=0,'删除仍然在菜单里，避免误触');
  assert.ok(html.indexOf('rules-row-flag')>=0,'每行要留差异标记位');
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
  const flag={textContent:'',hidden:false,className:''};
  const index={textContent:''};
  const textNode={value:text,style:{height:''},scrollHeight:60};
  return {
    hidden:false,
    __flag:flag,
    __index:index,
    getAttribute:k=>(k in attrs?attrs[k]:null),
    querySelector(sel){
      if(sel==='.rules-row-text')return textNode;
      if(sel==='.rules-row-flag')return flag;
      if(sel==='.rules-row-index')return index;
      return null;
    }
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
// 差异标记：发布之前就要能看出这一次会改动什么
// ---------------------------------------------------------------------------
function testRowFlagsShowWhatPublishWillChange(){
  const context=rulesContext();
  context.rulesPageState.data={rule_count:2,rules:[{key:'a',instruction:'甲'},{key:'b',instruction:'乙'}]};
  context.__rows.push(fakeRow('a','甲'),fakeRow('b','乙改过了'),fakeRow('c','新的一条'));
  const diff=context.rulesUpdateRowFlags();
  assert.strictEqual(diff.added,1);
  assert.strictEqual(diff.changed,1);
  assert.strictEqual(diff.removed,0);
  assert.strictEqual(context.__rows[0].__flag.textContent,'','没变的规则不加标记');
  assert.strictEqual(context.__rows[0].__flag.hidden,true);
  assert.strictEqual(context.__rows[1].__flag.textContent,'改过');
  assert.strictEqual(context.__rows[1].__flag.className,'rules-row-flag edit');
  assert.strictEqual(context.__rows[2].__flag.textContent,'新增');
  assert.strictEqual(context.__rows[2].__flag.className,'rules-row-flag add');
  assert.strictEqual(context.rulesDiffText(),'新增 1 条 · 改动 1 条');
}

function testDeletedRulesAreCounted(){
  const context=rulesContext();
  context.rulesPageState.data={rules:[{key:'a',instruction:'甲'},{key:'b',instruction:'乙'}]};
  context.__rows.push(fakeRow('a','甲'));
  assert.strictEqual(context.rulesUpdateRowFlags().removed,1,'草稿里删掉几条也要算出来，发布前必须告诉用户');
  assert.ok(context.rulesDiffText().indexOf('删除 1 条')>=0);
}

// 新增了一行还没填字，不该被当成"有改动"报警
function testEmptyRowIsNotAChange(){
  const context=rulesContext();
  context.rulesPageState.data={rules:[]};
  context.__rows.push(fakeRow('a','   '));
  const diff=context.rulesUpdateRowFlags();
  assert.strictEqual(diff.added,0);
  assert.strictEqual(diff.changed,0);
  assert.strictEqual(diff.removed,0);
  assert.strictEqual(context.rulesDiffText(),'');
}

function testStatusHintSaysWhatIsUnsaved(){
  const context=rulesContext();
  assert.strictEqual(context.rulesStatusHintText(),'','没改动时底部不要挂着提示');
  context.rulesPageState.busy=true;
  assert.strictEqual(context.rulesStatusHintText(),'处理中…');
  context.rulesPageState.busy=false;
  context.rulesPageState.dirty=true;
  context.rulesPageState.diff={added:2,changed:0,removed:1};
  assert.strictEqual(context.rulesStatusHintText(),'还没保存：新增 2 条 · 删除 1 条');
  context.rulesPageState.diff={added:0,changed:0,removed:0};
  assert.strictEqual(context.rulesStatusHintText(),'有改动还没保存','算不出差异时也要给个兜底文案');
}

// ---------------------------------------------------------------------------
// 搜索：只是把行藏起来，DOM 里一条都不能少，否则保存会把没命中的规则弄丢
// ---------------------------------------------------------------------------
function testFilterHidesRowsWithoutLosingThem(){
  const context=rulesContext();
  const table={attrs:{},setAttribute(k,v){this.attrs[k]=String(v)}};
  const hint={textContent:''};
  context.__dom.byId['rules-table']=table;
  context.__dom.byId['rules-filter-hint']=hint;
  context.__rows.push(fakeRow('a','不要叫我宝宝'),fakeRow('b','回复要分段'));
  assert.strictEqual(context.rulesFilter('分段'),1);
  assert.strictEqual(context.__rows[0].hidden,true);
  assert.strictEqual(context.__rows[1].hidden,false);
  assert.strictEqual(table.attrs['data-filtering'],'1','搜索时要把排序按钮收起来');
  assert.ok(hint.textContent.indexOf('命中 1 / 2')>=0);
  assert.strictEqual(context.rulesCollect().length,2,'搜索绝不能让没命中的规则从提交里消失');
  assert.strictEqual(context.rulesFilter('不存在的词'),0);
  assert.strictEqual(hint.textContent,'没有匹配的规则');
  context.rulesFilter('');
  assert.strictEqual(context.__rows[0].hidden,false);
  assert.strictEqual(table.attrs['data-filtering'],'0');
  assert.strictEqual(hint.textContent,'');
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
  assert.strictEqual(short.style.height,'44px','短内容不低于最小高度');
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
  ['rulesPublish()','rulesSaveDraft()','rulesToggleEnabled()','loadRulesPage(true)','rulesAddRow()','rulesReload()']
    .forEach(fn=>assert.ok(html.indexOf(fn)>=0,'缺少按钮：'+fn));
  assert.strictEqual((html.match(/class="rules-row"/g)||[]).length,2,'两条规则渲染两行');
  assert.ok(html.indexOf('rules-add-row')>=0,'列表底部要有"新增一条规则"');
  assert.ok(html.indexOf('rules-more')>=0,'停用和重新读取要收进更多菜单');
  assert.ok(html.indexOf('rules-metrics')>=0,'底部要显示规则成本软提示');
  assert.strictEqual((html.match(/rules-statbar/g)||[]).length,1,'状态收成一行状态条');
  assert.strictEqual(html.indexOf('rules-overview'),-1,'旧的三宫格状态卡已经撤掉');
  assert.ok(html.indexOf('rules-diff-chip')>=0,'状态条上要留"待发布"提示位');
  assert.ok(html.indexOf('rules-toolbar')>=0,'列表上方要有工具条');
  assert.ok(html.indexOf('rulesFilter(this.value)')>=0,'两条以上规则要给搜索框');
  assert.strictEqual(html.indexOf('r0'),-1,'页面不显示版本号');
}

function testStaleDraftWarningAndRebase(){
  const context=rulesContext();
  const body=bodyNode();
  context.__dom.byId['rules-page-body']=body;
  context.rulesPageState.data={enabled:true,draft_stale:true,rule_count:2,rules:[{key:'a',instruction:'甲'},{key:'b',instruction:'乙'}],draft:{rules:[{key:'a',instruction:'旧草稿'}]}};
  context.renderRulesPage();
  assert.ok(body.innerHTML.indexOf('rules-stale')>=0,'旧草稿必须显示醒目提示');
  assert.ok(body.innerHTML.indexOf('rulesUsePublishedDraft()')>=0,'必须能用生效规则覆盖草稿');
  context.rulesUsePublishedDraft();
  assert.strictEqual(context.rulesPageState.data.draft.rules.length,2);
  assert.strictEqual(context.rulesPageState.data.draft_stale,false);
  assert.strictEqual(context.rulesPageState.dirty,true);
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
  assert.strictEqual(body.innerHTML.indexOf('rules-search'),-1,'一条都没有的时候不摆搜索框');
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
testMoveButtonsAreAlwaysVisible();
testHiddenFieldsSurviveOnTheRow();
testRowCarriesNumberSlot();
testNewRowsGetUniqueKeys();
testCollectSkipsEmptyRowsAndKeepsHiddenFields();
testCollectDeduplicatesKeys();
testRowFlagsShowWhatPublishWillChange();
testDeletedRulesAreCounted();
testEmptyRowIsNotAChange();
testStatusHintSaysWhatIsUnsaved();
testFilterHidesRowsWithoutLosingThem();
testPreviewIsNumbered();
testPreviewMarksDisabled();
testPreviewEmptyState();
testErrorTextIsHumanReadable();
testTimeTextIsTrimmed();
testTextareaGrowsWithContent();
testPageRender();
testStaleDraftWarningAndRebase();
testPageRenderDisabledNotice();
testPageRenderEmptyState();
testBusyDisablesButtons();

console.log('rules page tests: OK');
