const assert=require('assert');
const fs=require('fs');
const vm=require('vm');

const source=fs.readFileSync(require.resolve('../script.js'),'utf8');
const css=fs.readFileSync(require.resolve('../chat.css'),'utf8');

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
  'apiPollingNormalizeStrategy','chatNormalizeCacheStrategy',
  'apiPollingConfig','apiPollingWrite','apiPollingItemFor','apiPollingItems',
  'apiPollingItemsFromOrder','apiPollingAvailableItems','apiPollingRevision','providerFingerprint',
  'apiPollingDraftReset','apiPollingDraftGet','apiPollingDraftItems','apiPollingDraftSync',
  'apiPollingCollectSwitches','apiPollingAddable','addApiPollingProvider','removeApiPolling',
  'setApiPollingModel','setApiPollingStrategy','moveApiPolling',
  'chatPollingViewInvalidate','chatPollingView',
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
    document:{getElementById:id=>(context.__dom&&context.__dom[id])||null},
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

  context.__dom['api-polling-add-select']={value:'B'};
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
  context.__dom['api-polling-add-select']={value:'不存在'};
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
    {enabled:false,tick:true,cost:true,note:'轮询关闭：显示状态和价格'},
    {enabled:true,tick:false,cost:false,note:'轮询开启：无条件隐藏状态和价格'}
  ];
  cases.forEach(item=>{
    const providers=library();
    providers.chat_polling={
      enabled:item.enabled,
      order:[{provider_id:'A',model:'m-a'}]
    };
    const context=pollingContext(providers);
    assert.strictEqual(context.chatShouldShowMessageStatus(),item.tick,item.note+'（√）');
    assert.strictEqual(context.chatShouldShowBillingPrice(),item.cost,item.note+'（价格）');
  });
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
// 每条候选各自绑缓存策略：空＝跟随聊天页，绑了就必须一路带到写入和 revision。
// ---------------------------------------------------------------------------
function testCacheStrategyDefaultsToFollowChatPage(){
  const providers=library();
  // 改造前保存的老配置没有 cache_strategy 字段，必须读成空（跟随聊天页），
  // 不能被兜底成 single_5m，否则老用户的全局策略会被静默改掉。
  providers.chat_polling={enabled:true,order:[{provider_id:'A',model:'m-a'}]};
  const context=pollingContext(providers);
  assert.strictEqual(context.apiPollingConfig().order[0].cache_strategy,'','老配置读出来必须是空＝跟随聊天页');
  assert.strictEqual(context.apiPollingItems()[0].cache_strategy,'','运行时候选也保持空');
}

function testCacheStrategyIsNormalizedAndCarried(){
  const providers=library();
  providers.chat_polling={enabled:true,order:[
    {provider_id:'A',model:'m-a',cache_strategy:'24H'},
    {provider_id:'B',model:'m-b',cacheStrategy:'native'},
    {provider_id:'C',model:'m-c',cache_strategy:'  '}
  ]};
  const context=pollingContext(providers);
  const order=context.apiPollingConfig().order;
  assert.strictEqual(order[0].cache_strategy,'prefix_24h','别名和大小写要归一');
  assert.strictEqual(order[1].cache_strategy,'native_stable','驼峰字段名也要认');
  assert.strictEqual(order[2].cache_strategy,'','纯空白等于没设置');
  assert.strictEqual(context.apiPollingItems()[0].cache_strategy,'prefix_24h','策略要带到运行时候选上');
}

function testWriteKeepsCacheStrategy(){
  const providers=library();
  const context=pollingContext(providers);
  context.apiPollingWrite({
    enabled:true,
    order:[{provider_id:'A',model:'m-a',cache_strategy:'assistant'},{provider_id:'B',model:'m-b'}],
    config_revision:'rev'
  });
  assert.strictEqual(providers.chat_polling.order[0].cache_strategy,'assistant_latest','写入要保留并归一策略');
  assert.strictEqual(providers.chat_polling.order[1].cache_strategy,'','没设的写成空，不许写成 single_5m');
}

function testSetStrategyStaysInDraft(){
  const providers=library();
  providers.chat_polling={enabled:true,order:[{provider_id:'A',model:'m-a'}]};
  const before=JSON.stringify(providers.chat_polling);
  const context=pollingContext(providers);
  context.setApiPollingStrategy(0,'native_tiered');
  assert.strictEqual(context.apiPollingDraftItems()[0].cache_strategy,'native_tiered','行内选策略生效');
  context.setApiPollingStrategy(0,'');
  assert.strictEqual(context.apiPollingDraftItems()[0].cache_strategy,'','可以改回跟随聊天页');
  assert.strictEqual(JSON.stringify(providers.chat_polling),before,'保存之前不得改动全局 apiProviders');
}

// 缓存策略必须进 config_revision：否则别的热实例不会重新拉配置，
// 用户改了策略，那些实例还在按旧策略打断点。
function testCacheStrategyEntersRevision(){
  const providers=library();
  providers.chat_polling={enabled:true,order:[{provider_id:'A',model:'m-a'}]};
  const context=pollingContext(providers);
  const base=context.apiPollingRevision();
  providers.chat_polling.order=[{provider_id:'A',model:'m-a',cache_strategy:'native_stable'}];
  assert.notStrictEqual(context.apiPollingRevision(),base,'绑定缓存策略必须改变 config_revision');
}

// 轮询下拉里的策略清单是手写常量，必须和 chatNormalizeCacheStrategy 的
// 正式输出集合一致。以后新增第 6 个策略时这条会立刻失败，
// 提醒把它补进下拉——否则新策略在轮询页永远选不到。
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
    '轮询策略下拉和 chatNormalizeCacheStrategy 的正式值对不上'
  );
}

function testPollingHasHardDomFallback(){
  const apply=extractFunction('chatApplyCacheTick');
  assert.ok(apply.includes('chatShouldShowMessageStatus()'),'incremental cache tick insertion needs the polling gate');
  assert.ok(/chat-polling-on \.chat-cache-tick/.test(css),'polling body class must hard-hide cache ticks');
  assert.ok(/chat-polling-on \.chat-msg-cost/.test(css),'polling body class must hard-hide prices');
  assert.ok(source.includes("classList.toggle('chat-polling-on'"),'runtime must synchronize the polling body class');
  assert.ok(!source.includes('api-polling-show-status'),'obsolete status checkbox must be removed');
  assert.ok(!source.includes('api-polling-show-price'),'obsolete price checkbox must be removed');
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
testWriteKeepsCacheStrategy();
testSetStrategyStaysInDraft();
testCacheStrategyEntersRevision();
testStrategyListCoversEveryCanonicalStrategy();
testChatDisplayDefaultsWhenConfigMissing();
testChatDisplayRulesUnderPolling();
testChatDisplayFallsBackToLocalMirror();
testPollingHasHardDomFallback();
testPollingLiveStatusText();
testPollingRuntimeWiring();

console.log('chat polling config tests: OK');
