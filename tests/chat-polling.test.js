const assert=require('assert');
const fs=require('fs');
const vm=require('vm');

const source=fs.readFileSync(require.resolve('../script.js'),'utf8');
const css=fs.readFileSync(require.resolve('../chat.css'),'utf8');
const styleCss=fs.readFileSync(require.resolve('../style.css'),'utf8');

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

const POLLING_FNS=[
  'providerNormalizeCacheStrategy','chatNormalizeCacheStrategy','providerCacheStrategy',
  'chatDefaultCostPricing','chatNormalizeCostMode','chatNumberOrDefault',
  'chatNormalizeCostPricing','chatCurrentCostPricing',
  'chatNormalizeCostDefaultEntry','chatNormalizeCostDefaults',
  'providerNormalizePricing','providerEffectivePricing',
  'chatApiPricingKey','providerPricingMirror',
  'chatDisplayToggleInvalidate','chatDisplayToggles','chatBillingEnabled','chatUsageStatsEnabled',
  'apiPollingConfig','apiPollingWrite','apiPollingSyncFromProviders',
  'apiPollingItemFor','apiPollingItems',
  'apiPollingItemsFromOrder','apiPollingAvailableItems','apiPollingRevision','providerFingerprint',
  'apiPollingDraftReset','apiPollingDraftGet','apiPollingDraftItems','apiPollingDraftSync',
  'apiPollingCollectSwitches','apiPollingAddable',
  'addApiPollingProvider','removeApiPolling',
  'setApiPollingModel','moveApiPolling',
  'chatPollingViewInvalidate','chatPollingView','chatApplyDisplayGateClasses',
  'chatShouldShowMessageStatus','chatShouldShowBillingPrice',
  'chatCacheStrategyMeta','apiPollingStatusText'
];

function pollingContext(apiProviders,extra){
  const store={};
  const toasts=[];
  const context=Object.assign({
    console,
    API_POLLING_KEY:'chat_polling',
    CHAT_POLLING_VIEW_KEY:'ckChatPollingView',
    CHAT_CONFIG_KEY:'ckChatConfigV2',
    CHAT_COST_DEFAULT_MAX_ROWS:20,
    chatDisplayToggleCache:null,
    chatPollingViewCache:null,
    apiPollingDraft:null,
    apiProviders:apiProviders,
    apiProvidersLoaded:true,
    providerLibraryList:()=>((apiProviders.provider_library||{}).providers||[]),
    findLibraryProvider:id=>((apiProviders.provider_library||{}).providers||[]).find(p=>String(p.id)===String(id))||null,
    providerHost:url=>String(url||'').replace(/^https?:\/\//,'').split('/')[0],
    providerDisplayName:p=>(p&&p.name)||'未命名供应商',
    renderApiConfig:()=>{},
    toast:msg=>{toasts.push(String(msg))},
    document:{
      getElementById:id=>(context.__dom&&context.__dom[id])||null,
      // 2026-08-24：「加入轮询」从原生 <select id=api-polling-add-select> 换成了两级选择器，
      // 值挂在 .api-polling-add 里的隐藏 input 上，所以这个桩要支持 querySelector。
      querySelector:sel=>(context.__dom&&context.__dom[sel])||null
    },
    localStorage:{
      getItem:k=>(k in store?store[k]:null),
      setItem:(k,v)=>{store[k]=String(v)},
      removeItem:k=>{delete store[k]}
    }
  },extra||{});
  vm.createContext(context);
  POLLING_FNS.forEach(name=>vm.runInContext(extractFunction(name),context));
  context.__store=store;
  context.__toasts=toasts;
  context.__dom=context.__dom||{};
  // 模拟两级选择器选中了某个供应商：值就在 .api-polling-add 里那个隐藏 input 上。
  context.__pick=id=>{context.__dom['.api-polling-add']={querySelector:()=>({value:id})}};
  return context;
}

function library(){
  return {
    provider_library:{providers:[
      {id:'A',name:'甲',url:'https://a.test/v1',key:'ka',model:'m-a'},
      {id:'B',name:'乙',url:'https://b.test/v1',key:'kb',model:'m-b'},
      {id:'C',name:'丙',url:'https://c.test/v1',key:'',model:'m-c'}
    ]}
  };
}

// ---------------------------------------------------------------------------
// 上一版最致命的问题：读配置的函数会顺手改全局 apiProviders，
// 结果"只是打开了一下页面"就把轮询字段混进下一次保存。
// ---------------------------------------------------------------------------
function testConfigReadIsPure(){
  const providers=library();
  const before=JSON.stringify(providers);
  const context=pollingContext(providers);

  context.apiPollingConfig();
  context.apiPollingItems();
  context.apiPollingAvailableItems();
  context.apiPollingRevision();
  context.chatPollingView();

  assert.strictEqual(JSON.stringify(providers),before,'读取轮询配置不得修改 apiProviders');
  assert.strictEqual('chat_polling' in providers,false,'读取不得凭空写出 chat_polling 字段');
}

function testWriteIsExplicit(){
  const providers=library();
  const context=pollingContext(providers);
  context.apiPollingWrite({
    enabled:true,primary_retry_enabled:true,primary_retry_interval:20,
    order:[{provider_id:'B',model:'m-b'}],config_revision:'rev1'
  });
  assert.strictEqual(providers.chat_polling.enabled,true,'显式写入才落到 apiProviders');
  assert.strictEqual(providers.chat_polling.order.length,1);
  assert.strictEqual(providers.chat_polling.order[0].provider_id,'B');
  assert.strictEqual(providers.chat_polling.config_revision,'rev1');
}

// ---------------------------------------------------------------------------
// 轮询队列由用户自己维护：只有明确加进 order 的供应商才参与轮询。
// 旧版会把供应商库里所有 API 自动追加到轮询页，用户完全没法只轮其中几个。
// ---------------------------------------------------------------------------
function testOrderingAndAvailability(){
  const providers=library();
  providers.chat_polling={enabled:true,order:[{provider_id:'B',model:'m-b'},{provider_id:'C',model:'m-c'}]};
  const context=pollingContext(providers);
  const items=context.apiPollingItems();
  assert.strictEqual(items.map(x=>x.provider_id).join(','),'B,C','只按用户排好的顺序，不追加没加进来的 A');
  assert.strictEqual(items[0].available,true);
  const unavailable=items.filter(x=>!x.available);
  assert.strictEqual(unavailable.length,1,'缺 Key 的供应商必须判为不可用');
  assert.strictEqual(unavailable[0].provider_id,'C');
  assert.strictEqual(unavailable[0].missing,'Key');
  assert.strictEqual(context.apiPollingAvailableItems().map(x=>x.provider_id).join(','),'B');
}

function testUnaddedProvidersNeverJoinPolling(){
  const providers=library();
  providers.chat_polling={enabled:true,order:[{provider_id:'A',model:'m-a'}]};
  const context=pollingContext(providers);
  assert.strictEqual(context.apiPollingItems().map(x=>x.provider_id).join(','),'A','没加进来的供应商一个都不能出现');
  assert.strictEqual(context.apiPollingItems().length,1);

  providers.chat_polling={enabled:false,order:[]};
  const empty=pollingContext(providers);
  assert.strictEqual(empty.apiPollingItems().length,0,'空队列就是空的，不能被供应商库填满');
}

function testOrderDedupAndUnknownIds(){
  const providers=library();
  providers.chat_polling={order:[
    {provider_id:'B',model:'m-b'},
    {provider_id:'B',model:'重复'},
    {provider_id:'不存在',model:'x'}
  ]};
  const context=pollingContext(providers);
  assert.strictEqual(context.apiPollingConfig().order.map(x=>x.provider_id).join(','),'B,不存在','读取阶段只去重');
  assert.strictEqual(context.apiPollingItems().map(x=>x.provider_id).join(','),'B','库里不存在的引用被丢弃，也不补别的');
}

// ---------------------------------------------------------------------------
// 添加 / 移除 / 换模型 / 排序：全部只改草稿，点保存前不碰全局配置
// ---------------------------------------------------------------------------
function testAddRemoveAndReorderStayInDraft(){
  const providers=library();
  providers.chat_polling={enabled:false,order:[{provider_id:'A',model:''}]};
  const before=JSON.stringify(providers.chat_polling);
  const context=pollingContext(providers);

  assert.strictEqual(context.apiPollingAddable().map(p=>p.id).join(','),'B,C','已在队列里的不能再次出现在待添加里');

  context.__pick('B');
  context.addApiPollingProvider();
  assert.strictEqual(context.apiPollingDraftItems().map(x=>x.provider_id).join(','),'A,B','新加的排在队尾');
  assert.strictEqual(context.apiPollingDraftItems()[1].model,'m-b','新加的默认跟随供应商默认模型，不用再填一遍');

  context.addApiPollingProvider();
  assert.strictEqual(context.apiPollingDraftItems().length,2,'同一个供应商不能重复加入');
  assert.ok(context.__toasts.some(x=>x.indexOf('已经在队列里')>=0),'重复添加要给出提示');

  context.moveApiPolling(1,-1);
  assert.strictEqual(context.apiPollingDraftItems().map(x=>x.provider_id).join(','),'B,A','上移生效');

  context.setApiPollingModel(0,'m-b-pro');
  assert.strictEqual(context.apiPollingDraftItems()[0].model,'m-b-pro','行内换模型生效');

  context.removeApiPolling(1);
  assert.strictEqual(context.apiPollingDraftItems().map(x=>x.provider_id).join(','),'B','移出生效');

  assert.strictEqual(JSON.stringify(providers.chat_polling),before,'保存之前不得改动全局 apiProviders');
}

function testDraftSyncDropsDeletedProviders(){
  const providers=library();
  providers.chat_polling={order:[{provider_id:'A',model:'m-a'},{provider_id:'已删除',model:'x'}]};
  const context=pollingContext(providers);
  const items=context.apiPollingDraftItems();
  context.apiPollingDraftSync(items);
  assert.strictEqual(context.apiPollingDraftGet().order.map(x=>x.provider_id).join(','),'A','供应商库里删掉的引用自动消失');
}

function testAddRejectsUnknownProvider(){
  const providers=library();
  providers.chat_polling={order:[]};
  const context=pollingContext(providers);
  context.__pick('不存在');
  context.addApiPollingProvider();
  assert.strictEqual(context.apiPollingDraftGet().order.length,0,'库里没有的供应商不能加进队列');
  assert.ok(context.__toasts.some(x=>x.indexOf('不在供应商库')>=0));
}

// ---------------------------------------------------------------------------
// 回主重试会改变游标行为，因此必须进入 config_revision。
// ---------------------------------------------------------------------------
function testPrimaryRetrySettingsResetCursor(){
  const providers=library();
  providers.chat_polling={enabled:true,order:[{provider_id:'A',model:'m-a'}]};
  const context=pollingContext(providers);
  const base=context.apiPollingRevision();

  providers.chat_polling.primary_retry_enabled=true;
  assert.notStrictEqual(context.apiPollingRevision(),base,'回主开关必须改变 config_revision');
  const retryRevision=context.apiPollingRevision();
  providers.chat_polling.primary_retry_interval=35;
  assert.notStrictEqual(context.apiPollingRevision(),retryRevision,'回主间隔必须改变 config_revision');

  providers.chat_polling.order=[{provider_id:'B',model:'m-b'},{provider_id:'A',model:'m-a'}];
  assert.notStrictEqual(context.apiPollingRevision(),base,'顺序变化必须改变 config_revision');
}

function testRevisionTracksProviderCredentials(){
  const providers=library();
  providers.chat_polling={enabled:true,order:[{provider_id:'A',model:'m-a'}]};
  const context=pollingContext(providers);
  const base=context.apiPollingRevision();
  providers.provider_library.providers[0].key='换了新的 key';
  assert.notStrictEqual(context.apiPollingRevision(),base,'供应商 Key 变化必须改变 config_revision');
}

// ---------------------------------------------------------------------------
// 聊天渲染绝不能依赖 API 配置是否加载成功
// ---------------------------------------------------------------------------
function testChatDisplayDefaultsWhenConfigMissing(){
  const context=pollingContext({},{apiProvidersLoaded:false});
  assert.strictEqual(context.chatShouldShowMessageStatus(),true,'配置没加载时必须照常显示 √');
  assert.strictEqual(context.chatShouldShowBillingPrice(),true,'配置没加载时必须照常显示价格');
}

function testChatDisplayRulesUnderPolling(){
  const cases=[
    {enabled:false,show:false,tick:true,cost:true,note:'轮询关闭：两样都照常显示'},
    {enabled:true,show:false,tick:false,cost:false,note:'轮询开启且没勾：两样都隐藏'},
    {enabled:true,show:true,tick:true,cost:true,note:'轮询开启且勾上：两样都显示'}
  ];
  cases.forEach(item=>{
    const providers=library();
    providers.chat_polling={
      enabled:item.enabled,
      show_message_status:item.show,
      show_billing_price:item.show,
      order:[{provider_id:'A',model:'m-a'}]
    };
    const context=pollingContext(providers);
    assert.strictEqual(context.chatShouldShowMessageStatus(),item.tick,item.note+'（√）');
    assert.strictEqual(context.chatShouldShowBillingPrice(),item.cost,item.note+'（价格）');
  });
}

// 计费总闸：设置页关掉以后，轮询那边勾了「显示价格」也不许显示。
// （两个开关每条消息渲染都要问一次，所以是带缓存的；改了配置必须走 invalidate。）
function testBillingMasterSwitchBeatsPolling(){
  const providers=library();
  providers.chat_polling={enabled:true,show_message_status:true,show_billing_price:true,order:[{provider_id:'A',model:'m-a'}]};
  const context=pollingContext(providers);
  assert.strictEqual(context.chatShouldShowBillingPrice(),true,'总闸默认开着');
  context.__store.ckChatConfigV2=JSON.stringify({billingEnabled:false});
  context.chatDisplayToggleInvalidate();
  assert.strictEqual(context.chatShouldShowBillingPrice(),false,'总闸关掉：轮询勾了也不显示价格');
  assert.strictEqual(context.chatShouldShowMessageStatus(),true,'总闸只管价格，不管 √');
  // 缓存必须真的生效：不 invalidate 就不该重新读 localStorage（否则每条消息都 parse 一遍大配置）
  context.__store.ckChatConfigV2=JSON.stringify({billingEnabled:true});
  assert.strictEqual(context.chatShouldShowBillingPrice(),false,'没 invalidate 前必须命中缓存');
  context.chatDisplayToggleInvalidate();
  assert.strictEqual(context.chatShouldShowBillingPrice(),true);
  assert.ok(extractFunction('chatSaveConfigObject').includes('chatDisplayToggleInvalidate()'),
    '写配置的唯一出口必须作废这份缓存');
  // 用量统计默认关，开了才算开
  assert.strictEqual(context.chatUsageStatsEnabled(),false,'用量统计默认关闭');
  context.__store.ckChatConfigV2=JSON.stringify({usageStatsEnabled:true});
  context.chatDisplayToggleInvalidate();
  assert.strictEqual(context.chatUsageStatsEnabled(),true);
  // 轮询整个关掉时总闸依然说了算
  const off=pollingContext(library());
  off.__store.ckChatConfigV2=JSON.stringify({billingEnabled:false});
  off.chatDisplayToggleInvalidate();
  assert.strictEqual(off.chatShouldShowBillingPrice(),false,'不开轮询也照样受总闸管');
  // 配置坏掉时必须退回"开着"，不能因为读不到配置就把价格全藏了
  const broken=pollingContext(library());
  broken.__store.ckChatConfigV2='{ 这不是 JSON';
  broken.chatDisplayToggleInvalidate();
  assert.strictEqual(broken.chatShouldShowBillingPrice(),true,'配置坏掉时总闸退回开启');
}

// 单价 2026-08-23 起长在供应商身上：镜像覆盖整个供应商库（不只是轮询队列里那几条），
// 而且绝不参与 config_revision——改个价把网关粘性游标重置掉就白丢当前可用的 API。
function testProviderPricingMirrorsAndStaysOutOfRevision(){
  const providers=library();
  const price={currency:'$',input:50,output:250,cache_create:60,cache_read:5,multiplier:1};
  providers.provider_library.providers[0].pricing=price;
  providers.chat_polling={enabled:true,order:[{provider_id:'A',model:'m-a'}]};
  const context=pollingContext(providers);
  // 注意用 deepEqual 而不是 deepStrictEqual：vm 里造的对象换了个 realm 的原型。
  assert.deepEqual(context.apiPollingItems()[0].pricing,price,'运行时候选要带上供应商那份价');
  const before=context.apiPollingRevision();
  providers.provider_library.providers[0].pricing=Object.assign({},price,{input:999});
  context.chatPollingViewInvalidate();
  assert.strictEqual(context.apiPollingRevision(),before,'改单价不许动 revision，否则网关粘性游标会被重置');

  const mirror=context.providerPricingMirror();
  assert.strictEqual(mirror['a'].input,999,'按供应商 ID 查得到');
  assert.strictEqual(mirror['甲'].input,999,'按显示名查得到（网关回的是 provider_name）');
  assert.strictEqual(mirror['b'],undefined,'没维护过的那条不进镜像，聊天页落回面板默认价');
  assert.strictEqual(context.providerNormalizePricing(null),null,'没维护过就是 null');

  // 关键：不在轮询队列里的供应商也要能算价（单链路那条就是这种情况）
  const single=library();
  single.provider_library.providers[1].pricing=price;
  const singleContext=pollingContext(single);
  assert.strictEqual(singleContext.providerPricingMirror()['乙'].output,250,
    '没进轮询队列的供应商也必须能算价');
}

// 价格编辑器长在供应商卡片里：默认折叠、预填当前生效价，输入框只标 field 不挂 onchange
// （挂了就会边打字边整页重渲染、光标乱跳），统一由 readProvCardPricing 从 DOM 读回。
function testProviderPriceEditorRendersAndCollects(){
  const providers=library();
  const context=pollingContext(providers,{
    esc:v=>String(v),
    escAttr:v=>String(v).replace(/"/g,'&quot;')
  });
  vm.runInContext('var PROVIDER_PRICE_FIELDS='+/var PROVIDER_PRICE_FIELDS=(\[[\s\S]*?\]);/.exec(source)[1]+';',context);
  vm.runInContext(extractFunction('providerPriceHtml'),context);
  vm.runInContext(extractFunction('readProvCardPricing'),context);

  const provider=providers.provider_library.providers[0];
  const html=context.providerPriceHtml(provider);
  ['currency','input','output','cache_create','cache_read','multiplier'].forEach(field=>{
    assert.ok(html.includes('data-price-field="'+field+'"'),'价格编辑器缺字段 '+field);
  });
  assert.ok(!/onchange=/.test(html),'价格输入框不许挂 onchange，否则打字时整页重渲染');
  assert.ok(html.includes('<details'),'价格默认折起来，别把供应商卡片撑长');
  assert.ok(!/<details[^>]*\sopen/.test(html),'默认是折叠的');
  assert.ok(html.includes('（默认价）'),'没维护过要写清楚现在用的是面板默认价');
  assert.ok(html.includes('缓存创建')&&html.includes('缓存命中')&&html.includes('倍率'),'四项加倍率都要有');

  // 只改一个格子，其余必须保持当前生效值，不能被清成 0
  const nodes=[{getAttribute:k=>({'data-price-field':'output'})[k],value:'99'}];
  const card={querySelectorAll:sel=>(sel==='.prov-price-input'?nodes:[])};
  const defaults=context.chatDefaultCostPricing();
  let saved=context.readProvCardPricing(card,provider);
  assert.strictEqual(saved.output,99,'改过的那一格要写进供应商');
  assert.strictEqual(saved.input,defaults.inputPerMTokens,'没碰过的格子必须保持原值，不许被清成 0');
  assert.strictEqual(saved.currency,defaults.currency);

  // 空值 / 负数一律忽略，保留原值
  provider.pricing=saved;
  nodes[0].value='';
  assert.strictEqual(context.readProvCardPricing(card,provider).output,99,'清空输入框不该把单价变成 0');
  nodes[0].value='-5';
  assert.strictEqual(context.readProvCardPricing(card,provider).output,99,'负数不接受');

  // 卡片上没有价格块时（理论上不会发生）不许把已维护的价格抹掉
  assert.deepEqual(context.readProvCardPricing({querySelectorAll:()=>[]},provider).output,99);

  // 预填的是"现在实际在用的那份价"，不是出厂值：用户只点一下保存不该让价格跳变。
  context.__store.ckChatConfigV2=JSON.stringify({costPricing:{inputPerMTokens:7,outputPerMTokens:77}});
  const custom=context.providerEffectivePricing(null);
  assert.strictEqual(custom.input,7,'预填要用面板当前单价');
  assert.strictEqual(custom.output,77);
}
function testDisplaySwitchesRoundTrip(){
  const providers=library();
  providers.chat_polling={enabled:true,show_message_status:true,show_billing_price:false,order:[{provider_id:'A',model:'m-a'}]};
  const context=pollingContext(providers);
  const cfg=context.apiPollingConfig();
  assert.strictEqual(cfg.show_message_status,true);
  assert.strictEqual(cfg.show_billing_price,false);
  const written=context.apiPollingWrite(cfg);
  assert.strictEqual(written.show_message_status,true);
  assert.strictEqual(written.show_billing_price,false);
  const view=context.chatPollingView();
  assert.strictEqual(view.showMessageStatus,true);
  assert.strictEqual(view.showBillingPrice,false);
  const revisionA=context.apiPollingRevision(cfg,context.apiPollingItems());
  providers.chat_polling.show_billing_price=true;
  context.chatPollingViewInvalidate();
  const revisionB=context.apiPollingRevision(context.apiPollingConfig(),context.apiPollingItems());
  assert.strictEqual(revisionA,revisionB,'勾显示开关不许动 revision');
}

function testChatDisplayFallsBackToLocalMirror(){
  const providers=library();
  providers.chat_polling={enabled:true,order:[{provider_id:'A',model:'m-a'}]};
  const loaded=pollingContext(providers);
  loaded.chatPollingViewInvalidate();
  const view=loaded.chatPollingView();
  assert.strictEqual(view.enabled,true);

  // 模拟"API 配置还没读到"，但本地镜像里有上次保存的值
  const offline=pollingContext({},{apiProvidersLoaded:false});
  offline.__store.ckChatPollingView=JSON.stringify({enabled:true});
  offline.chatPollingViewCache=null;
  assert.strictEqual(offline.chatShouldShowMessageStatus(),false,'镜像生效：轮询开启时隐藏 √');
  assert.strictEqual(offline.chatShouldShowBillingPrice(),false,'镜像生效：轮询开启时隐藏价格');

  // 镜像损坏时必须退回"全部显示"，不能让聊天页少东西
  const broken=pollingContext({},{apiProvidersLoaded:false});
  broken.__store.ckChatPollingView='{ 这不是 JSON';
  broken.chatPollingViewCache=null;
  assert.strictEqual(broken.chatShouldShowMessageStatus(),true,'镜像损坏时退回全部显示');
  assert.strictEqual(broken.chatShouldShowBillingPrice(),true,'镜像损坏时退回全部显示');
}

// ---------------------------------------------------------------------------
// 缓存策略 2026-08-23 起长在供应商身上：空＝跟随聊天页，设了就一路带到
// 运行时候选、写入的 order 镜像和 config_revision。
// ---------------------------------------------------------------------------
function testCacheStrategyDefaultsToFollowChatPage(){
  const providers=library();
  // 供应商没维护策略时必须读成空（跟随聊天页），不能被兜底成 single_5m，
  // 否则老用户的全局策略会被静默改掉。
  providers.chat_polling={enabled:true,order:[{provider_id:'A',model:'m-a'}]};
  const context=pollingContext(providers);
  assert.strictEqual(context.apiPollingItems()[0].cache_strategy,'','没维护过就是空＝跟随聊天页');
  assert.strictEqual(context.providerCacheStrategy(providers.provider_library.providers[0]),'');
}

function testCacheStrategyIsNormalizedAndCarried(){
  const providers=library();
  providers.provider_library.providers[0].cache_strategy='24H';
  providers.provider_library.providers[1].cacheStrategy='native';
  providers.provider_library.providers[2].cache_strategy='  ';
  providers.chat_polling={enabled:true,order:[
    {provider_id:'A',model:'m-a'},
    {provider_id:'B',model:'m-b'},
    {provider_id:'C',model:'m-c'}
  ]};
  const context=pollingContext(providers);
  const items=context.apiPollingItems();
  assert.strictEqual(items[0].cache_strategy,'prefix_24h','别名和大小写要归一');
  assert.strictEqual(items[2].cache_strategy,'','纯空白等于没设置');
  // normalizeProvider 认驼峰，providerCacheStrategy 只读正式字段——供应商库入口统一归一。
  assert.strictEqual(context.providerNormalizeCacheStrategy(providers.provider_library.providers[1].cacheStrategy),
    'native_stable','驼峰字段名在 normalizeProvider 那一层要认');
}

// order 里那份 cache_strategy 是派生镜像：写入时一律现从供应商身上取，
// 不信调用方传进来的旧值。网关读的还是这个字段，所以网关不用改。
function testWriteMirrorsStrategyFromProvider(){
  const providers=library();
  providers.provider_library.providers[0].cache_strategy='assistant_latest';
  const context=pollingContext(providers);
  context.apiPollingWrite({
    enabled:true,
    order:[{provider_id:'A',model:'m-a',cache_strategy:'prefix_24h'},{provider_id:'B',model:'m-b'}],
    config_revision:'rev'
  });
  assert.strictEqual(providers.chat_polling.order[0].cache_strategy,'assistant_latest',
    '写入取供应商那份，忽略调用方传的旧值');
  assert.strictEqual(providers.chat_polling.order[1].cache_strategy,'','没设的写成空，不许写成 single_5m');
  assert.strictEqual('pricing' in providers.chat_polling.order[0],false,'价格不再存进轮询配置');
}

// 草稿里只留"用哪个供应商、哪个模型"，策略和价格一律不复制一份，
// 否则又会出现两处都能改、改完猜哪边生效。
function testDraftKeepsOnlyProviderAndModel(){
  const providers=library();
  providers.provider_library.providers[0].cache_strategy='native_tiered';
  providers.chat_polling={enabled:true,order:[{provider_id:'A',model:'m-a'}]};
  const context=pollingContext(providers);
  const entry=context.apiPollingDraftGet().order[0];
  assert.deepEqual(Object.keys(entry).sort(),['model','provider_id'],'草稿只存供应商和模型');
  assert.strictEqual(context.apiPollingDraftItems()[0].cache_strategy,'native_tiered','运行时候选还是按供应商那份算');
  assert.strictEqual(source.includes('function setApiPollingStrategy'),false,'轮询页不再有改策略的入口');
}

// 缓存策略必须进 config_revision：否则别的热实例不会重新拉配置，
// 用户改了策略，那些实例还在按旧策略打断点。
function testCacheStrategyEntersRevision(){
  const providers=library();
  providers.chat_polling={enabled:true,order:[{provider_id:'A',model:'m-a'}]};
  const context=pollingContext(providers);
  const base=context.apiPollingRevision();
  providers.provider_library.providers[0].cache_strategy='native_stable';
  assert.notStrictEqual(context.apiPollingRevision(),base,'供应商绑了缓存策略必须改变 config_revision');
}

// 在供应商库里改完策略后，apiPollingSyncFromProviders() 负责刷新 order 镜像
// 并重算 config_revision。少了这一步，网关热实例永远看不到新策略。
function testSyncFromProvidersRefreshesMirrorAndRevision(){
  const providers=library();
  providers.chat_polling={enabled:true,order:[{provider_id:'A',model:'m-a'}],config_revision:'old'};
  const context=pollingContext(providers);
  providers.provider_library.providers[0].cache_strategy='prefix_24h';
  context.chatPollingViewInvalidate();
  const written=context.apiPollingSyncFromProviders();
  assert.strictEqual(written.order[0].cache_strategy,'prefix_24h','镜像要刷新成供应商那份');
  assert.notStrictEqual(written.config_revision,'old','config_revision 必须跟着变');
  assert.ok(extractFunction('saveProvider').includes('apiPollingSyncFromProviders()'),
    '保存供应商时必须调这个同步，否则改了策略网关不知道');
  // 没配过轮询的用户不该被凭空写出一个 chat_polling
  const clean=library();
  const cleanContext=pollingContext(clean);
  assert.strictEqual(cleanContext.apiPollingSyncFromProviders(),null);
  assert.strictEqual('chat_polling' in clean,false,'没配过轮询就什么都不写');
}

// 供应商表单里的策略下拉清单是手写常量，必须和 chatNormalizeCacheStrategy 的
// 正式输出集合一致。以后再新增策略时这条会立刻失败，
// 提醒把它补进下拉——否则新策略在供应商库里永远选不到。
function testStrategyListCoversEveryCanonicalStrategy(){
  const listed=/var API_POLLING_STRATEGY_VALUES=\[([^\]]*)\]/.exec(source);
  assert.ok(listed,'找不到 API_POLLING_STRATEGY_VALUES 常量');
  const values=listed[1].split(',').map(s=>s.trim().replace(/^'|'$/g,'')).filter(Boolean);
  const canonical=new Set();
  // 从归一函数里把所有 return '<正式值>' 抓出来
  for(const match of extractFunction('chatNormalizeCacheStrategy').matchAll(/return '([a-z0-9_]+)'/g)){
    canonical.add(match[1]);
  }
  assert.deepStrictEqual(
    values.slice().sort(),[...canonical].sort(),
    '供应商策略下拉和 chatNormalizeCacheStrategy 的正式值对不上'
  );
  assert.ok(extractFunction('providerCacheStrategyHtml').includes('API_POLLING_STRATEGY_VALUES'),
    '供应商表单必须用这份常量生成下拉');
  assert.ok(/option value=""/.test(extractFunction('providerCacheStrategyHtml')),
    '必须有"不选"这一项：缓存策略是可选的，不选也能保存');
  // 真跑一遍下拉渲染：全部策略 + 一个"不选"，选中项跟着供应商那份走。
  const context=pollingContext(library(),{esc:v=>String(v),escAttr:v=>String(v)});
  vm.runInContext('var API_POLLING_STRATEGY_VALUES='+listed[0].replace('var API_POLLING_STRATEGY_VALUES=','')+';',context);
  vm.runInContext(extractFunction('providerCacheStrategyHtml'),context);
  const empty=context.providerCacheStrategyHtml({});
  assert.strictEqual((empty.match(/<option/g)||[]).length,values.length+1,'下拉是"不选"加上全部策略');
  assert.ok(/value=""\s+selected/.test(empty),'没维护过时默认选中"不选"');
  const bound=context.providerCacheStrategyHtml({cache_strategy:'prefix_24h'});
  assert.ok(/value="prefix_24h" selected/.test(bound),'维护过就要回显选中');
}

function testPollingHasHardDomFallback(){
  const apply=extractFunction('chatApplyCacheTick');
  assert.ok(apply.includes('chatShouldShowMessageStatus()'),'incremental cache tick insertion needs the polling gate');
  // 兜底不再绑死"轮询开着"：√ 和价格各有自己的判断（轮询子开关 + 计费总闸），
  // JS 算完落成 chat-hide-tick / chat-hide-cost 两个 body 类，CSS 只照这两个类隐藏。
  assert.ok(/chat-hide-tick \.chat-cache-tick\{display:none/.test(css),'body class must hard-hide cache ticks');
  assert.ok(/chat-hide-cost \.chat-msg-cost\{display:none/.test(css),'body class must hard-hide prices');
  assert.ok(/chat-hide-tick \.chat-tick-legend \.chat-cache-tick\{display:inline-flex/.test(css),
    '说明卡里的图例勾号不能被"消息上不显示 √"一起藏掉');
  assert.ok(source.includes("classList.toggle('chat-polling-on'"),'runtime must synchronize the polling body class');
  assert.ok(source.includes("classList.toggle('chat-hide-tick'"),'runtime must synchronize the tick gate class');
  assert.ok(source.includes("classList.toggle('chat-hide-cost'"),'runtime must synchronize the cost gate class');
  assert.ok(source.includes('api-polling-show-status'),'轮询页必须有「显示 √」勾选框');
  assert.ok(source.includes('api-polling-show-price'),'轮询页必须有「显示价格」勾选框');
}

function testPollingLiveStatusText(){
  const context=pollingContext(library());
  const trying=context.apiPollingStatusText({
    state:'trying',active_provider_name:'乙',active_provider_index:1,
    attempt_number:2,attempt_total:3,primary_retry_enabled:true,
    remaining_to_primary:7,timeout_seconds:60,cache_strategy:'prefix_24h'
  });
  assert.ok(trying.includes('调用中 2 · 乙'),'实时状态要显示当前 API 序号和名称');
  assert.ok(trying.includes('本轮 2/3'),'实时状态要显示本轮尝试进度');
  assert.ok(trying.includes('距下次回主 7 轮'),'实时状态要显示回主倒计时');
  assert.ok(trying.includes('缓存 前缀'),'实时状态要显示候选缓存策略');
  assert.ok(trying.includes('单次上限 60s'),'实时状态要显示一分钟上限');
  assert.strictEqual(context.apiPollingStatusText({state:'exhausted'}),'全部失败');
  // 随机模式下"距下次回主"其实是"距下次重摇"，文案必须跟着换
  const rolling=context.apiPollingStatusText({
    state:'success',active_provider_name:'丙',active_provider_index:2,
    primary_retry_enabled:true,remaining_to_primary:59,
    random_mode:true,select_reason:'random_reroll'
  });
  assert.ok(rolling.includes('距下次重摇 59 轮'),'随机模式要显示重摇倒计时');
  assert.ok(rolling.includes('本轮重摇'),'重摇的那一轮要说出来');
  assert.ok(!rolling.includes('距下次回主'),'随机模式下不能再说"回主"');
  const expired=context.apiPollingStatusText({
    state:'success',active_provider_name:'甲',active_provider_index:0,
    select_reason:'cache_expired'
  });
  assert.ok(expired.includes('缓存过期已回主'),'过期回主要有明确说明');
  const expiredReroll=context.apiPollingStatusText({
    state:'success',active_provider_name:'乙',active_provider_index:1,
    random_mode:true,select_reason:'cache_expired_reroll'
  });
  assert.ok(expiredReroll.includes('缓存过期已重摇'),'随机模式下过期是重摇，不是回主');
  assert.ok(!expiredReroll.includes('缓存过期已回主'));
}

// ---------------------------------------------------------------------------
// 随机模式 + 缓存过期回主：两个开关都直接决定网关挑谁，必须能存下来、
// 必须进 config_revision（否则别的热实例不会重新拉配置，勾了也不生效）。
// ---------------------------------------------------------------------------
function testRandomAndExpiredSwitchesRoundTrip(){
  const providers=library();
  providers.chat_polling={enabled:true,order:[{provider_id:'A',model:'m-a'}]};
  const context=pollingContext(providers);
  // 老配置没这两个字段，必须都读成 false
  assert.strictEqual(context.apiPollingConfig().random_mode,false,'随机模式默认关');
  assert.strictEqual(context.apiPollingConfig().expired_return_primary,false,'过期回主默认关');

  const base=context.apiPollingRevision();
  providers.chat_polling.random_mode=true;
  context.chatPollingViewInvalidate();
  assert.strictEqual(context.apiPollingConfig().random_mode,true);
  assert.notStrictEqual(context.apiPollingRevision(),base,'随机模式必须改变 config_revision');
  const randomRevision=context.apiPollingRevision();
  providers.chat_polling.expired_return_primary=true;
  assert.notStrictEqual(context.apiPollingRevision(),randomRevision,'过期回主必须改变 config_revision');

  // 写入口要原样保留这两个开关
  const written=context.apiPollingWrite({
    enabled:true,random_mode:true,expired_return_primary:true,
    order:[{provider_id:'A',model:'m-a'}],config_revision:'r-new'
  });
  assert.strictEqual(written.random_mode,true);
  assert.strictEqual(written.expired_return_primary,true);
  // 供应商库改完策略后的同步不能把这两个开关丢掉
  const synced=context.apiPollingSyncFromProviders();
  assert.strictEqual(synced.random_mode,true,'同步镜像时不能丢掉随机模式');
  assert.strictEqual(synced.expired_return_primary,true,'同步镜像时不能丢掉过期回主');
}

function testRandomAndExpiredSwitchesCollectFromDom(){
  const providers=library();
  providers.chat_polling={enabled:true,order:[{provider_id:'A',model:'m-a'}]};
  const context=pollingContext(providers);
  context.__dom={
    'api-polling-enabled':{checked:true},
    'api-polling-primary-retry':{checked:true},
    'api-polling-primary-interval':{value:'60'},
    'api-polling-random':{checked:true},
    'api-polling-expired-primary':{checked:true}
  };
  const draft=context.apiPollingCollectSwitches();
  assert.strictEqual(draft.random_mode,true,'随机模式勾选要收进草稿');
  assert.strictEqual(draft.expired_return_primary,true,'过期回主勾选要收进草稿');
  assert.strictEqual(draft.primary_retry_interval,60,'随机模式下这个数字就是"用满多少轮重摇"');
}

// 「缓存过期就回主」在随机模式下改口径为「缓存过期就重摇」（2026-09-03 用户要求）：
// 两种模式都生效，勾选框不再禁用，也不再在保存时被强行写成 false。
function testExpiredPrimaryWorksInBothModes(){
  const save=extractFunction('saveApiPolling');
  assert.ok(!/expired_return_primary:draft\.random_mode\?false/.test(save),
    '随机模式下这个开关也生效了，保存时不能再抹成 false');
  assert.ok(/expired_return_primary:draft\.expired_return_primary/.test(save),
    '保存时要原样写用户勾的那个值');
  const toggle=extractFunction('apiPollingToggleControls');
  assert.ok(toggle.includes('expired.disabled=!draft.enabled'),'只有整个轮询关掉才禁用');
  assert.ok(!toggle.includes("expired.disabled=!draft.enabled||!!draft.random_mode"),
    '随机模式下不许再禁用这个勾选框');
  const render=extractFunction('renderApiPolling');
  assert.ok(render.includes('api-polling-random'),'轮询页必须有随机模式勾选框');
  assert.ok(render.includes('api-polling-expired-primary'),'轮询页必须有过期回主勾选框');
  assert.ok(render.includes('缓存过期就重摇')&&render.includes('缓存过期就回主'),
    '随机模式显示"缓存过期就重摇"，顺序模式还是"缓存过期就回主"');
  // 随机模式下「回主重试」整块要改口径：文案是重摇，不是回主
  assert.ok(render.includes('定期重摇')&&render.includes('次后重新摇一个'),
    '随机模式下回主重试要显示成"定期重摇 / 用满 N 轮重新摇"');
  assert.ok(/\.api-primary-retry\.random\.off::after/.test(styleCss),
    '随机模式下「未启用」那句提示语也要换成重摇口径');
  assert.ok(/\.api-polling-random/.test(styleCss),'随机模式那一块要有样式');
  assert.ok(/\.api-polling-expired/.test(styleCss),'过期回主那一块要有样式');
  assert.ok(!/\.api-polling-expired\.na/.test(styleCss),'".na 不适用"那套样式已经作废，别留死样式');
  // .random 必须排在 .off 之后，否则同特异度下"未启用"那句会压过重摇口径
  assert.ok(styleCss.indexOf('.api-polling-expired.random.off::after')>styleCss.indexOf('.api-polling-expired.off::after'),
    '.random 的提示语必须写在 .off 后面才能生效');
  // 随机模式一改要整页重渲染：文案和禁用状态都要跟着变
  assert.ok(render.includes('apiPollingToggleRandom()'),'随机模式勾选要走重渲染');
  assert.ok(extractFunction('apiPollingToggleRandom').includes('renderApiConfig()'));
  // 状态行要能说出这一轮是"过期重摇"
  assert.ok(extractFunction('apiPollingStatusText').includes('缓存过期已重摇'),
    '状态行要认识 cache_expired_reroll');
}

// 计费身份：请求体必须带上主链路的供应商 ID，网关会把"真的谁答的"盖回 usage。
// 只靠名字或地址反查，同一个站点挂两条（不同号、不同倍率）时必然认错人，
// 这就是 2026-09-03「用量统计的倍率和实际请求不符」那个 bug。
function testBillingIdentityTravelsWithTheRequest(){
  const body=source.slice(source.indexOf('var body={',source.indexOf('function chatSend')),
    source.indexOf('client_cache_full_created_at'));
  assert.ok(body.includes('provider_name:cfg.mainRouteProvider'),'请求体要带主链路供应商名');
  assert.ok(body.includes('provider_id:cfg.mainRouteProviderId'),'请求体还要带主链路供应商 ID');
  const apply=extractFunction('chatApplyMainRouteToConfig');
  assert.ok(apply.includes("cfg.mainRouteProviderId=String((route.provider&&route.provider.id)||'')"),
    'mainRouteProviderId 要从主链路供应商身上取');
  assert.ok(apply.includes("cfg.mainRouteProviderId=''"),'主链路没配好时要清空，不能留上一次的 ID');
  const lookup=extractFunction('chatApiPricingLookup');
  assert.ok(lookup.indexOf('provider_id')<lookup.indexOf('chatUsageBillingProvider'),
    'ID 必须排在名字前面：名字会重复，chatUsageBillingProvider 还会退化成 URL');
  assert.ok(extractFunction('chatEnrichUsageRoute').includes('cfg.mainRouteProviderId'),
    '网关没回 ID 时（老版本网关）用主链路那份补上');
}

function testPollingRuntimeWiring(){
  const streamHandler=source.slice(source.indexOf('function handleStreamEvent'),source.indexOf("if(ev==='delta')",source.indexOf('function handleStreamEvent')));
  assert.ok(streamHandler.indexOf("if(ev==='polling')")<streamHandler.indexOf('attemptState.receivedValidContent=true'),
    'polling 状态事件不能冒充正文，否则断线后不会重试');
  assert.ok(source.includes('},1000);'),'轮询页状态接口必须每秒兜底刷新');
  assert.ok(source.includes('data-provider-id="'),'每个队列行必须能按 provider id 实时着色');
  assert.ok(source.includes('每个候选 API 单次最多等待 60 秒'),'界面必须明确单 API 一分钟上限');
}

testConfigReadIsPure();
testWriteIsExplicit();
testOrderingAndAvailability();
testUnaddedProvidersNeverJoinPolling();
testOrderDedupAndUnknownIds();
testAddRemoveAndReorderStayInDraft();
testDraftSyncDropsDeletedProviders();
testAddRejectsUnknownProvider();
testPrimaryRetrySettingsResetCursor();
testRevisionTracksProviderCredentials();
testCacheStrategyDefaultsToFollowChatPage();
testCacheStrategyIsNormalizedAndCarried();
testWriteMirrorsStrategyFromProvider();
testDraftKeepsOnlyProviderAndModel();
testCacheStrategyEntersRevision();
testSyncFromProvidersRefreshesMirrorAndRevision();
testStrategyListCoversEveryCanonicalStrategy();
testChatDisplayDefaultsWhenConfigMissing();
testChatDisplayRulesUnderPolling();
testBillingMasterSwitchBeatsPolling();
testProviderPricingMirrorsAndStaysOutOfRevision();
testProviderPriceEditorRendersAndCollects();
testDisplaySwitchesRoundTrip();
testChatDisplayFallsBackToLocalMirror();
testPollingHasHardDomFallback();
testPollingLiveStatusText();
testRandomAndExpiredSwitchesRoundTrip();
testRandomAndExpiredSwitchesCollectFromDom();
testExpiredPrimaryWorksInBothModes();
testBillingIdentityTravelsWithTheRequest();
testPollingRuntimeWiring();

console.log('chat polling config tests: OK');
