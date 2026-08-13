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

const POLLING_FNS=[
  'apiPollingConfig','apiPollingWrite','apiPollingItemFor','apiPollingItems',
  'apiPollingAvailableItems','apiPollingRevision','providerFingerprint',
  'chatPollingViewInvalidate','chatPollingView',
  'chatShouldShowMessageStatus','chatShouldShowBillingPrice'
];

function pollingContext(apiProviders,extra){
  const store={};
  const context=Object.assign({
    console,
    API_POLLING_KEY:'chat_polling',
    CHAT_POLLING_VIEW_KEY:'ckChatPollingView',
    chatPollingViewCache:null,
    apiProviders:apiProviders,
    apiProvidersLoaded:true,
    providerLibraryList:()=>((apiProviders.provider_library||{}).providers||[]),
    providerHost:url=>String(url||'').replace(/^https?:\/\//,'').split('/')[0],
    providerDisplayName:p=>(p&&p.name)||'未命名供应商',
    localStorage:{
      getItem:k=>(k in store?store[k]:null),
      setItem:(k,v)=>{store[k]=String(v)},
      removeItem:k=>{delete store[k]}
    }
  },extra||{});
  vm.createContext(context);
  POLLING_FNS.forEach(name=>vm.runInContext(extractFunction(name),context));
  context.__store=store;
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
    enabled:true,show_message_status:true,show_billing_price:false,
    order:[{provider_id:'B',model:'m-b'}],config_revision:'rev1'
  });
  assert.strictEqual(providers.chat_polling.enabled,true,'显式写入才落到 apiProviders');
  assert.strictEqual(providers.chat_polling.order.length,1);
  assert.strictEqual(providers.chat_polling.order[0].provider_id,'B');
  assert.strictEqual(providers.chat_polling.config_revision,'rev1');
}

function testOrderingAndAvailability(){
  const providers=library();
  providers.chat_polling={enabled:true,order:[{provider_id:'B',model:'m-b'}]};
  const context=pollingContext(providers);
  const items=context.apiPollingItems();
  assert.strictEqual(items.map(x=>x.provider_id).join(','),'B,A,C','已排序的在前，未排序的按库顺序追加');
  assert.strictEqual(items[0].available,true);
  const unavailable=items.filter(x=>!x.available);
  assert.strictEqual(unavailable.length,1,'缺 Key 的供应商必须判为不可用');
  assert.strictEqual(unavailable[0].provider_id,'C');
  assert.strictEqual(unavailable[0].missing,'Key');
  assert.strictEqual(context.apiPollingAvailableItems().map(x=>x.provider_id).join(','),'B,A');
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
  assert.strictEqual(context.apiPollingItems().map(x=>x.provider_id).join(','),'B,A,C','库里不存在的引用被丢弃');
}

// ---------------------------------------------------------------------------
// 显示开关不能进 config_revision，否则勾一下复选框就把网关粘性游标重置了
// ---------------------------------------------------------------------------
function testDisplaySwitchesDoNotResetCursor(){
  const providers=library();
  providers.chat_polling={enabled:true,order:[{provider_id:'A',model:'m-a'}]};
  const context=pollingContext(providers);
  const base=context.apiPollingRevision();

  providers.chat_polling.show_message_status=true;
  providers.chat_polling.show_billing_price=true;
  assert.strictEqual(context.apiPollingRevision(),base,'两个显示开关不得改变 config_revision');

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
    {enabled:false,status:false,price:false,tick:true,cost:true,note:'轮询关闭：强制都显示'},
    {enabled:false,status:true,price:true,tick:true,cost:true,note:'轮询关闭：开关无效，仍然都显示'},
    {enabled:true,status:false,price:false,tick:false,cost:false,note:'轮询开启且都关：都隐藏'},
    {enabled:true,status:true,price:false,tick:true,cost:false,note:'只开状态开关'},
    {enabled:true,status:false,price:true,tick:false,cost:true,note:'只开价格开关'},
    {enabled:true,status:true,price:true,tick:true,cost:true,note:'两个都开'}
  ];
  cases.forEach(item=>{
    const providers=library();
    providers.chat_polling={
      enabled:item.enabled,
      show_message_status:item.status,
      show_billing_price:item.price,
      order:[{provider_id:'A',model:'m-a'}]
    };
    const context=pollingContext(providers);
    assert.strictEqual(context.chatShouldShowMessageStatus(),item.tick,item.note+'（√）');
    assert.strictEqual(context.chatShouldShowBillingPrice(),item.cost,item.note+'（价格）');
  });
}

function testChatDisplayFallsBackToLocalMirror(){
  const providers=library();
  providers.chat_polling={enabled:true,show_message_status:false,show_billing_price:true,order:[{provider_id:'A',model:'m-a'}]};
  const loaded=pollingContext(providers);
  loaded.chatPollingViewInvalidate();
  const view=loaded.chatPollingView();
  assert.strictEqual(view.enabled,true);

  // 模拟"API 配置还没读到"，但本地镜像里有上次保存的值
  const offline=pollingContext({},{apiProvidersLoaded:false});
  offline.__store.ckChatPollingView=JSON.stringify({enabled:true,showMessageStatus:false,showBillingPrice:true});
  offline.chatPollingViewCache=null;
  assert.strictEqual(offline.chatShouldShowMessageStatus(),false,'镜像生效：轮询开启且状态开关关闭时隐藏 √');
  assert.strictEqual(offline.chatShouldShowBillingPrice(),true,'镜像生效：价格开关开启时显示价格');

  // 镜像损坏时必须退回"全部显示"，不能让聊天页少东西
  const broken=pollingContext({},{apiProvidersLoaded:false});
  broken.__store.ckChatPollingView='{ 这不是 JSON';
  broken.chatPollingViewCache=null;
  assert.strictEqual(broken.chatShouldShowMessageStatus(),true,'镜像损坏时退回全部显示');
  assert.strictEqual(broken.chatShouldShowBillingPrice(),true,'镜像损坏时退回全部显示');
}

testConfigReadIsPure();
testWriteIsExplicit();
testOrderingAndAvailability();
testOrderDedupAndUnknownIds();
testDisplaySwitchesDoNotResetCursor();
testRevisionTracksProviderCredentials();
testChatDisplayDefaultsWhenConfigMissing();
testChatDisplayRulesUnderPolling();
testChatDisplayFallsBackToLocalMirror();

console.log('chat polling config tests: OK');
