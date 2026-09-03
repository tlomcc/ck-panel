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

const functionNames=[
  'chatDefaultCostPricing',
  'chatNormalizeCostMode',
  'chatNumberOrDefault',
  'chatNormalizeCostPricing',
  'chatUsagePayload',
  'chatObjectPathValue',
  'chatUsageValue',
  'chatUsageNumber',
  'chatUsageCacheRead',
  'chatUsageCacheCreate',
  'chatUsageCacheCreate5m',
  'chatUsageCacheCreate1h',
  'chatUsageInputTotal',
  'chatUsageInputBillable',
  'chatUsageBillingObject',
  'chatUsageBillingAmount',
  'chatUsageBillingProvider',
  'chatUsageBillingCurrency',
  'chatUsageBillingStatus',
  'chatUsageExplicitBillingAmount',
  'chatUsageHasTokenFields',
  'chatUsageHasBillingMeta',
  'chatUsageCost',
  'chatApiPricingToCostPricing',
  'chatApiPricingKey',
  'chatApiPricingLookup',
  'chatNormalizeCostDefaultEntry',
  'chatNormalizeCostDefaults',
  'chatCostDefaults',
  'chatCostDefaultMatch',
  'chatCostDefaultForUsage',
  'chatPricingForUsage',
  'chatNormalizeCacheStrategy',
  'chatCacheStrategyMeta'
];

const context={console};
vm.createContext(context);
vm.runInContext('var CHAT_COST_DEFAULT_MAX_ROWS=20;',context);
vm.runInContext(functionNames.map(extractFunction).join('\n'),context);
// 单价现在按"这一轮是谁答的"取。默认没有任何一条 API 维护过价格，
// 于是全部落回 chatCurrentCostPricing()，也就是下面这些老断言原本测的那条路。
context.chatPollingView=()=>({enabled:false,pricing:null});
// 默认价格表（设置页维护）默认是空的，落回面板出厂单价。
context.chatDisplayToggles=()=>({billing:true,usage:false,recallBox:true,costDefaults:[]});

const defaults=context.chatNormalizeCostPricing({});
assert.strictEqual(defaults.outputPerMTokens,25);
assert.strictEqual(defaults.cacheCreate5mPerMTokens,6.25);
assert.strictEqual(defaults.cacheCreate1hPerMTokens,10);
assert.strictEqual(defaults.ttlCreatePricingConfigured,true);

const legacy=context.chatNormalizeCostPricing({
  outputPerMTokens:0,
  cacheCreatePerMTokens:7
});
assert.strictEqual(legacy.outputPerMTokens,0,'an explicit zero output price must be preserved');
assert.strictEqual(legacy.cacheCreate5mPerMTokens,7);
assert.strictEqual(legacy.cacheCreate1hPerMTokens,7);
assert.strictEqual(legacy.cacheCreateLegacyPerMTokens,7);
assert.strictEqual(legacy.ttlCreatePricingConfigured,false);

const split=context.chatNormalizeCostPricing({
  cacheCreatePerMTokens:7,
  cacheCreate5mPerMTokens:6,
  cacheCreate1hPerMTokens:11
});
assert.strictEqual(split.cacheCreate5mPerMTokens,6);
assert.strictEqual(split.cacheCreate1hPerMTokens,11);
assert.strictEqual(split.ttlCreatePricingConfigured,true);

const pricing=context.chatNormalizeCostPricing({
  mode:'auto',
  currency:'$',
  inputPerMTokens:5,
  outputPerMTokens:25,
  cacheReadPerMTokens:.5,
  cacheCreate5mPerMTokens:6.25,
  cacheCreate1hPerMTokens:10,
  cacheCreateLegacyPerMTokens:6.25,
  multiplier:.2
});
context.chatCurrentCostPricing=()=>pricing;
const usage={
  input_tokens:200,
  input_tokens_total:6000,
  cache_read_input_tokens:5000,
  cache_creation_input_tokens:800,
  cache_creation_5m_input_tokens:300,
  cache_creation_1h_input_tokens:500,
  output_tokens:80
};
const cost=context.chatUsageCost(usage);
assert.strictEqual(cost.create5m,300);
assert.strictEqual(cost.create1h,500);
assert.strictEqual(cost.legacyCreate,0);
assert(Math.abs(cost.raw-.012375)<1e-12);
assert(Math.abs(cost.total-.002475)<1e-12);

context.chatCurrentCostPricing=()=>legacy;
const legacyCost=context.chatUsageCost({
  input_tokens:0,
  cache_creation_input_tokens:800,
  output_tokens:0
});
assert.strictEqual(legacyCost.legacyCreate,800);
assert(Math.abs(legacyCost.createCost-.0056)<1e-12);
assert(legacyCost.reason.includes('创建 TTL 分项缺失'));

context.chatCurrentCostPricing=()=>pricing;
const authoritative=context.chatUsageCost(Object.assign({},usage,{
  billing:{status:'authoritative',amount:.123,currency:'USD',source:'upstream'}
}));
assert.strictEqual(authoritative.status,'known');
assert.strictEqual(authoritative.total,.123,'authoritative upstream billing must win');

// —— 每条 API 自己维护的单价：谁答的就按谁的价算 ——
// 轮询页给"乙"维护了一份贵得多的价格，网关回的 provider_name 就是"乙"。
context.chatPollingView=()=>({
  enabled:true,
  pricing:{'乙':{currency:'$',input:50,output:250,cache_create:60,cache_read:5,multiplier:1}}
});
const perApi=context.chatUsageCost(Object.assign({},usage,{provider_name:'乙'}));
assert.strictEqual(perApi.status,'calculated');
assert.strictEqual(perApi.pricing.inputPerMTokens,50,'必须用这条 API 自己维护的输入价');
assert.strictEqual(perApi.pricing.cacheCreate5mPerMTokens,60,'缓存创建只填一个价，5m/1h 套同一个数');
assert.strictEqual(perApi.pricing.cacheCreate1hPerMTokens,60);
assert.strictEqual(perApi.pricing.multiplier,1);
assert(perApi.total>context.chatUsageCost(usage).total,'维护过的贵价必须真的把总价算高');
// 名字对不上（没维护过这条）就落回面板默认价，绝不能变成 0 或者不显示。
const unmaintained=context.chatUsageCost(Object.assign({},usage,{provider_name:'丙'}));
assert.strictEqual(unmaintained.pricing.inputPerMTokens,pricing.inputPerMTokens);
assert.strictEqual(unmaintained.status,'calculated');
// 供应商 ID 也是一路可用的键：改名以后老价格还能对上。
context.chatPollingView=()=>({enabled:true,pricing:{'p-9':{input:0,output:0,cache_create:0,cache_read:0,multiplier:1}}});
const byId=context.chatUsageCost(Object.assign({},usage,{provider_id:'p-9'}));
assert.strictEqual(byId.total,0,'单价全填 0 就该算出 0');

// —— ID 必须比名字优先 ——
// 同一个站点挂两条（不同号、不同倍率）时显示名可能重复、provider_url 还会顶上来当"名字"，
// 靠名字必然认错人，算出来就是另一条的倍率。这是 2026-09-03「倍率乱套」那个 bug。
context.chatPollingView=()=>({enabled:true,pricing:{
  '甲':{currency:'¥',input:5,output:25,cache_create:6.25,cache_read:.5,multiplier:1},
  'p-2':{currency:'¥',input:5,output:25,cache_create:6.25,cache_read:.5,multiplier:.1}
}});
const idWins=context.chatUsageCost(Object.assign({},usage,{provider_name:'甲',provider_id:'p-2'}));
assert.strictEqual(idWins.pricing.multiplier,.1,'provider_id 命中时必须压过 provider_name');

// —— 默认价格（可维护多条，按模型关键字匹配）——
context.chatPollingView=()=>({enabled:false,pricing:null});
context.chatDisplayToggles=()=>({billing:true,usage:false,recallBox:true,costDefaults:[
  {model:'opus',currency:'¥',input:5,output:25,cache_create:6.25,cache_read:.5,multiplier:.2},
  {model:'sonnet',currency:'¥',input:3,output:15,cache_create:3.75,cache_read:.3,multiplier:.2},
  {model:'',currency:'$',input:15,output:75,cache_create:18.75,cache_read:1.5,multiplier:1}
]});
const opusCost=context.chatUsageCost(Object.assign({},usage,{model:'claude-opus-4-6'}));
assert.strictEqual(opusCost.pricing.inputPerMTokens,5,'模型名含 opus 要命中第 1 条');
assert.strictEqual(opusCost.pricing.multiplier,.2);
const sonnetCost=context.chatUsageCost(Object.assign({},usage,{model:'Claude-Sonnet-4-6'}));
assert.strictEqual(sonnetCost.pricing.inputPerMTokens,3,'匹配不分大小写');
const otherCost=context.chatUsageCost(Object.assign({},usage,{model:'glm-4.6'}));
assert.strictEqual(otherCost.pricing.inputPerMTokens,15,'谁都不匹配就用关键字留空那条兜底');
assert.strictEqual(otherCost.pricing.multiplier,1);
assert.strictEqual(otherCost.pricing.currency,'$','币种也跟着兜底那条走');
// 缓存创建只填一个价，5m/1h 套同一个数
assert.strictEqual(opusCost.pricing.cacheCreate5mPerMTokens,6.25);
assert.strictEqual(opusCost.pricing.cacheCreate1hPerMTokens,6.25);
// 供应商自己维护过价格时，默认价格表不许插队
context.chatPollingView=()=>({enabled:true,pricing:{'乙':{currency:'¥',input:50,output:250,cache_create:60,cache_read:5,multiplier:1}}});
const providerWins=context.chatUsageCost(Object.assign({},usage,{provider_name:'乙',model:'claude-opus-4-6'}));
assert.strictEqual(providerWins.pricing.inputPerMTokens,50,'供应商身上那份价永远优先于默认价格表');
// 一条默认价都没维护时落回面板出厂单价，绝不能算成 0
context.chatPollingView=()=>({enabled:false,pricing:null});
context.chatDisplayToggles=()=>({billing:true,usage:false,recallBox:true,costDefaults:[]});
assert.strictEqual(
  context.chatUsageCost(Object.assign({},usage,{model:'claude-opus-4-6'})).pricing.inputPerMTokens,
  pricing.inputPerMTokens
);
// 归一化：坏数据、非数组、超量都要挡住
// 数组是在 vm 里造的，跨 realm 过不了 deepStrictEqual，只比长度（见 memory: vm 沙箱测试要用 deepEqual）
assert.strictEqual(context.chatNormalizeCostDefaults(null).length,0);
assert.strictEqual(context.chatNormalizeCostDefaults('x').length,0);
assert.strictEqual(context.chatNormalizeCostDefaults(new Array(50).fill({})).length,20,'最多 20 条');
const messy=context.chatNormalizeCostDefaults([{model:'  Opus  ',input:'-3',output:'abc',multiplier:''}])[0];
assert.strictEqual(messy.model,'Opus','模型关键字只去两头空白，大小写留给匹配时处理');
assert.strictEqual(messy.input,pricing.inputPerMTokens,'负数按没填算');
assert.strictEqual(messy.output,pricing.outputPerMTokens,'填了非数字按没填算');
assert.strictEqual(messy.currency,'¥');
// 关键字留空那条放在第一位也照样只当兜底
assert.strictEqual(
  context.chatCostDefaultMatch([{model:''},{model:'opus'}],'claude-opus-4-6').model,
  'opus',
  '兜底那条不许抢走能精确命中的那条'
);
assert.strictEqual(context.chatCostDefaultMatch([{model:'opus'}],'glm-4.6'),null,'没有兜底条目就返回 null');
context.chatPollingView=()=>({enabled:false,pricing:null});

assert.strictEqual(context.chatNormalizeCacheStrategy('cost_optimized'),'native_tiered');const tiered=context.chatCacheStrategyMeta('native_tiered');
assert.strictEqual(tiered.ttl,'mixed');
assert.strictEqual(tiered.requestTtl,'1h');
assert.strictEqual(tiered.retentionSeconds,3600);
// 三个原生档都必须显式发 anthropic：/messages 形状是它们的定义前提
assert(/if\(cacheStrategy==='native_stable'\|\|cacheStrategy==='native_tiered'\|\|cacheStrategy==='native_5m'\)body\.upstream_format='anthropic';/.test(source));

// —— 原生5min：断点照 Claude Code 的尾部方案，TTL 全 5m ——
// 'native_5m' 以前是 native_stable 的别名，改造后必须归它自己。
['native_5m','native5m','NATIVE-5MIN','native_short','claude_code'].forEach(function(raw){
  assert.strictEqual(context.chatNormalizeCacheStrategy(raw),'native_5m',raw+' 应归一到 native_5m');
});
assert.strictEqual(context.chatNormalizeCacheStrategy('native'),'native_stable');
const native5m=context.chatCacheStrategyMeta('native_5m');
assert.strictEqual(native5m.ttl,'5m');
assert.strictEqual(native5m.ttlLabel,'5m');
assert.strictEqual(native5m.retentionSeconds,300,'5min 档的旧召回保留必须是 300s，不能跟着原生1h 用 3600');
assert.strictEqual(native5m.shortLabel,'原生5min');
// 缓存到期提示：原生5min 必须走 5 分钟那条，不能被 ttl==='1h' 的分支吃掉
assert(/if\(meta&&meta\.ttl==='1h'\)/.test(source));

console.log('cache pricing tests: OK');
