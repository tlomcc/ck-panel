'use strict';
// 选供应商：按文件夹分层的两级选择器（2026-08-24 用户要求）。
//
// 背景：v209 之前用的是原生 <select> + <optgroup>。optgroup 分了组但**不能折叠**，
// 25 个供应商点开还是一次全铺出来，用户原话「还是会出来一串，翻找很麻烦」。
// 所以改成两级：先点文件夹，再点里面的供应商。
//
// 关键不变量：
// 1. 「未分类」是只在选择时出现的虚拟文件夹，恒定排在最后；供应商维护页刻意不显示它
//    （用户明确要求），所以这条只能长在选择器里，不能长回 renderProviderLibrary。
// 2. 只有一个文件夹时直接跳到第二级，不让用户白点一下。
// 3. 已经选过的，进来就打开它所在的文件夹。
// 4. 值放在隐藏 input 上且 class 不变，readAssignmentRow / onAssignProviderChange 一行不改。
const assert=require('assert');
const fs=require('fs');
const vm=require('vm');

const root=require('path').resolve(__dirname,'..');
const source=fs.readFileSync(require('path').join(root,'script.js'),'utf8');
const css=fs.readFileSync(require('path').join(root,'style.css'),'utf8');

function extractFunction(name){
  let start=source.indexOf(`function ${name}(`);
  assert(start>=0,`missing function ${name}`);
  if(source.slice(Math.max(0,start-6),start)==='async ')start-=6;
  const brace=source.indexOf('{',start);
  let depth=0;
  for(let index=brace;index<source.length;index++){
    if(source[index]==='{')depth++;
    if(source[index]==='}'&&--depth===0)return source.slice(start,index+1);
  }
  throw new Error(`unterminated function ${name}`);
}
function extractVar(name){
  const start=source.indexOf(`\nvar ${name}=`);
  assert(start>=0,`missing var ${name}`);
  return source.slice(start+1,source.indexOf('\n',start+1));
}

const P=[
  {id:'p1',name:'甲站',url:'https://a.example.com/v1',model:'claude-opus-5',category:'常用'},
  {id:'p2',name:'乙站',url:'https://b.example.com/v1',model:'',category:'常用'},
  {id:'p3',name:'丙站',url:'https://c.example.com/v1',model:'',category:'备用'},
  {id:'p4',name:'丁站',url:'https://d.example.com/v1',model:'',category:''},
];

function pickerContext(answers){
  const asked=[];
  const context={
    console,
    providerLibraryList:()=>P.slice(),
    findLibraryProvider:id=>P.find(p=>p.id===id)||null,
    providerHost:url=>String(url||'').replace(/^https?:\/\//,'').split('/')[0],
    providerDisplayName:p=>(p&&p.name)||'未命名供应商',
    ckChooseDialog:(title,choices)=>{
      asked.push({title,choices:choices.map(c=>({value:c.value,label:c.label,hint:c.hint,active:!!c.active}))});
      return Promise.resolve(answers.shift());
    },
  };
  vm.createContext(context);
  ['var:PROVIDER_PICKER_LOOSE_LABEL'].forEach(n=>vm.runInContext(extractVar(n.slice(4)),context));
  ['providerCategoryLabel','providerPickerGroups','providerPickerFolder','providerPickerChoose']
    .forEach(n=>vm.runInContext(extractFunction(n),context));
  context.__asked=asked;
  return context;
}

function testGrouping(){
  const ctx=pickerContext([]);
  const groups=ctx.providerPickerGroups(P);
  assert.strictEqual(groups.map(g=>g.name).join('|'),'备用|常用|未分类',
    '有名字的文件夹按中文排序，「未分类」恒定在最后');
  assert.strictEqual(groups[2].providers.map(p=>p.id).join('|'),'p4','没归类的都进「未分类」');
  assert.strictEqual(ctx.providerPickerGroups(P.filter(p=>p.category)).length,2,
    '一个没归类的都没有时，就不该凭空造出「未分类」');
  assert.strictEqual(ctx.providerCategoryLabel({category:''}),'未分类');
  assert.strictEqual(ctx.providerCategoryLabel({category:' 常用 '}),'常用','归类名前后空格要吃掉');
  assert.strictEqual(ctx.providerPickerFolder(groups,'不存在').length,0,'找不到的文件夹返回空，不抛错');
}

async function testTwoStepFlow(){
  // 先点「常用」，再点乙站。
  const ctx=pickerContext(['folder:常用','id:p2']);
  const picked=await ctx.providerPickerChoose(P,'',{title:'选择供应商 · 主链路',allowEmpty:true});
  assert.strictEqual(picked,'p2');
  const asked=ctx.__asked;
  assert.strictEqual(asked.length,2,'两级就是两步，不该多问一次');
  assert.strictEqual(asked[0].title,'选择供应商 · 主链路');
  assert.strictEqual(asked[0].choices.map(c=>c.value).join('|'),'folder:备用|folder:常用|folder:未分类|all|none',
    '第一层只有文件夹 + 全部 + 不选择，没有任何供应商');
  assert.ok(/2 个/.test(asked[0].choices[1].hint),'文件夹上要写清里面有几个');
  assert.strictEqual(asked[1].title,'📁 常用');
  assert.strictEqual(asked[1].choices.map(c=>c.value).join('|'),'back|id:p1|id:p2|none',
    '第二层是这个文件夹里的供应商，外加返回和不选择');
  assert.ok(/a\.example\.com/.test(asked[1].choices[1].hint),'供应商行要带 host，好认');
  assert.ok(/claude-opus-5/.test(asked[1].choices[1].hint),'有默认模型就一起写出来');
}

async function testOpensCurrentFolderAndCanGoBack(){
  // 当前选的是丙站（备用）：进来直接开「备用」，返回上一层再选未分类里的丁站。
  const ctx=pickerContext(['back','folder:未分类','id:p4']);
  const picked=await ctx.providerPickerChoose(P,'p3',{});
  assert.strictEqual(picked,'p4');
  const asked=ctx.__asked;
  assert.strictEqual(asked[0].title,'📁 备用','已经选过的，进来就打开它所在的文件夹');
  assert.ok(asked[0].choices.some(c=>c.value==='id:p3'&&c.active),'当前选择要高亮');
  assert.strictEqual(asked[1].title,'选择供应商','返回后回到文件夹那一层');
  assert.ok(asked[1].choices.some(c=>c.value==='folder:备用'&&c.active),
    '文件夹那一层要标出当前选择在哪个文件夹');
  assert.strictEqual(asked[2].title,'📁 未分类');
}

async function testSingleFolderSkipsFirstStep(){
  const only=P.filter(p=>p.category==='常用');
  const ctx=pickerContext(['id:p1']);
  const picked=await ctx.providerPickerChoose(only,'',{});
  assert.strictEqual(picked,'p1');
  assert.strictEqual(ctx.__asked.length,1,'只有一个文件夹时不问"选哪个文件夹"');
  assert.ok(!ctx.__asked[0].choices.some(c=>c.value==='back'),'没有第一层就不该有返回按钮');
}

async function testFlatFallbackAndCancel(){
  // 「全部」：平铺，并且每行带上自己的文件夹名。
  let ctx=pickerContext(['all','id:p3']);
  assert.strictEqual(await ctx.providerPickerChoose(P,'',{}),'p3');
  assert.strictEqual(ctx.__asked[1].title,'全部供应商');
  assert.strictEqual(ctx.__asked[1].choices.filter(c=>c.value.indexOf('id:')===0).length,4,'平铺要列全');
  assert.ok(/备用/.test(ctx.__asked[1].choices.find(c=>c.value==='id:p3').hint),
    '平铺时每行要写自己属于哪个文件夹');

  // 取消（Esc / 点取消）→ null，调用方原样不动。
  ctx=pickerContext([null]);
  assert.strictEqual(await ctx.providerPickerChoose(P,'p1',{}),null);

  // 「不选择」→ 空字符串，和 null 必须区分开：一个是清空，一个是没动。
  ctx=pickerContext(['none']);
  assert.strictEqual(await ctx.providerPickerChoose(P,'p1',{allowEmpty:true}),'');
  // 没开 allowEmpty 就不该出现「不选择」。
  ctx=pickerContext([null]);
  await ctx.providerPickerChoose(P,'p1',{});
  assert.ok(!ctx.__asked[0].choices.some(c=>c.value==='none'),'没开 allowEmpty 时不许给清空入口');
}

// headless 探针抓到过的真问题：第二层收到一个认不出的值时，老代码会 pick.slice(3)
// 得到 'der:未分类' 这种垃圾并当成 provider id 存下去，界面变成"点这里选供应商"。
async function testUnknownAnswersAreIgnored(){
  let ctx=pickerContext(['folder:常用','这是什么','id:p1']);
  assert.strictEqual(await ctx.providerPickerChoose(P,'',{}),'p1','认不出的值只重画这一层，不当成选择');
  assert.strictEqual(ctx.__asked.length,3,'重画一次，不静默返回垃圾');
  assert.strictEqual(ctx.__asked[2].title,'📁 常用','重画的还是同一层');

  ctx=pickerContext(['id:p1','folder:常用','id:p2']);
  assert.strictEqual(await ctx.providerPickerChoose(P,'',{}),'p2',
    '第一层收到 id: 开头的值同样不认，不能跳过文件夹那一步');
}

function testWiring(){
  const assign=extractFunction('assignmentCardHtml');
  assert.ok(/providerPickerHtml\(slot\.current,\{scope:'assign',valueClass:'assign-provider',allowEmpty:true/.test(assign),
    '功能组（主链路/记忆/召回/总结…）都走同一个选择器，值仍然挂在 .assign-provider 上');
  assert.ok(!/<select class="assign-provider"/.test(source),'原来那个原生下拉要撤掉');

  const read=extractFunction('readAssignmentRow');
  assert.ok(/v\('\.assign-provider'\)/.test(read),'读值的老代码不该被改动');
  const change=extractFunction('onAssignProviderChange');
  assert.ok(/sel\.closest\('\.api-assign-card'\)/.test(change)&&/findLibraryProvider\(sel\.value\)/.test(change),
    '联动模型列表的老代码同样不该被改动（隐藏 input 也有 .value 和 .closest）');

  const polling=extractFunction('renderApiPolling');
  assert.ok(/providerPickerHtml\('',\{scope:'polling_add'/.test(polling),'轮询「加入轮询」也换成选择器');
  const add=extractFunction('addApiPollingProvider');
  assert.ok(/\.provider-pick-value/.test(add),'加入轮询要从选择器的隐藏 input 取值');

  const open=extractFunction('openProviderPicker');
  assert.ok(/scope==='polling_add'\?apiPollingAddable\(\):providerLibraryList\(\)/.test(open),
    '轮询只列还没进队列的，否则点了只会弹"已经在队列里了"');
  assert.ok(/if\(picked===null\|\|picked===undefined\)return/.test(open),
    '取消必须什么都不改：这里把 null（取消）和 \'\'（清空）分开处理');
  assert.ok(/if\(scope==='assign'\)onAssignProviderChange\(valueEl\)/.test(open),
    '选完要触发功能组那套联动');

  // 供应商维护页仍然不许出现「未分类」这个假文件夹（用户明确要求）。
  assert.ok(!extractFunction('renderProviderLibrary').includes('未分类'),
    '供应商页只显示真实文件夹 + 散着的未归类卡片，不造假文件夹');

  assert.ok(/\.provider-pick-value\{display:none!important\}/.test(css),'隐藏 input 必须真的不占位');
  assert.ok(/\.provider-pick-btn\{/.test(css),'选择器按钮要有样式，不能是裸 button');

  // 点进文件夹后那一层：名称和 host·model 原来挤在同一行，长名字被挤成 clientWidth=0
  // （headless 探针量到的原话「名称被挡住了」）。现在必须是上下两行、名称更大。
  const wechat=fs.readFileSync(require('path').join(root,'wechat.css'),'utf8');
  const rowRule=/\.ck-action-dialog \.ck-action-choice\{([^}]*)\}/.exec(wechat);
  assert.ok(rowRule,'选择弹层每一行的规则必须还在');
  assert.ok(/flex-direction:column!important/.test(rowRule[1]),
    '每一行必须竖排：横排时长名字会被 host·model 挤没');
  const labelRule=/\.ck-action-dialog \.ck-action-choice-label\{([^}]*)\}/.exec(wechat);
  assert.ok(labelRule,'名称那一行的规则必须还在');
  const labelSize=/font-size:([\d.]+)px/.exec(labelRule[1]);
  assert.ok(labelSize&&parseFloat(labelSize[1])>=15,'名称字号要比正文大（用户要求「字大一点显眼一点」）');
  assert.ok(/white-space:normal!important/.test(labelRule[1]),'名称允许折行，绝不能再被截断');
  const hintRule=/\.ck-action-dialog \.ck-action-choice small\{([^}]*)\}/.exec(wechat);
  assert.ok(hintRule,'副信息那一小行的规则必须还在');
  const hintSize=/font-size:([\d.]+)px/.exec(hintRule[1]);
  assert.ok(hintSize&&parseFloat(hintSize[1])<parseFloat(labelSize[1]),'副信息要比名称小');
  assert.ok(/font-weight:400!important/.test(hintRule[1]),
    '副信息不跟着 .active 变粗，否则「不用那么显眼」就落空了');
}

testGrouping();
testWiring();
Promise.resolve()
  .then(testTwoStepFlow)
  .then(testOpensCurrentFolderAndCanGoBack)
  .then(testSingleFolderSkipsFirstStep)
  .then(testFlatFallbackAndCancel)
  .then(testUnknownAnswersAreIgnored)
  .then(()=>console.log('provider picker tests: OK'),error=>{console.error(error);process.exit(1)});
