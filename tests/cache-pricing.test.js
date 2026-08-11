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
  'chatNormalizeCacheStrategy',
  'chatCacheStrategyMeta'
];

const context={console};
vm.createContext(context);
vm.runInContext(functionNames.map(extractFunction).join('\n'),context);

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

assert.strictEqual(context.chatNormalizeCacheStrategy('cost_optimized'),'native_tiered');
const tiered=context.chatCacheStrategyMeta('native_tiered');
assert.strictEqual(tiered.ttl,'mixed');
assert.strictEqual(tiered.requestTtl,'1h');
assert.strictEqual(tiered.retentionSeconds,3600);
assert(/if\(cacheStrategy==='native_stable'\|\|cacheStrategy==='native_tiered'\)body\.upstream_format='anthropic';/.test(source));

console.log('cache pricing tests: OK');
