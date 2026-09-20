'use strict';

const assert=require('assert');
const fs=require('fs');
const vm=require('vm');

const source=fs.readFileSync(require.resolve('../script.js'),'utf8');
const html=fs.readFileSync(require.resolve('../index.html'),'utf8');

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

function load(context,names){
  vm.createContext(context);
  names.forEach(name=>vm.runInContext(extractFunction(name),context));
  return context;
}

function testProviderTypeNormalization(){
  const context=load({console},['providerNormalizeApiType']);
  assert.strictEqual(context.providerNormalizeApiType('claude','https://openai.example/v1'),'claude');
  assert.strictEqual(context.providerNormalizeApiType('openai','https://nowcoding.ai/v1'),'openai');
  assert.strictEqual(context.providerNormalizeApiType('', 'https://nowcoding.ai/v1'),'claude');
  assert.strictEqual(context.providerNormalizeApiType('', 'https://provider.example/v1'),'openai');
}

function testNativeCacheRestoresClaudeTransport(){
  const context=load({console},['chatNormalizeCacheStrategy','chatRequestUpstreamFormat']);
  assert.strictEqual(
    context.chatRequestUpstreamFormat({mainRouteApiType:'openai'},'native_5m'),
    'anthropic',
    'native 5m must retain the pre-interface Claude transport'
  );
  assert.strictEqual(
    context.chatRequestUpstreamFormat({mainRouteApiType:'openai'},'native_stable'),
    'anthropic',
    'native 1h must retain the pre-interface Claude transport'
  );
  assert.strictEqual(
    context.chatRequestUpstreamFormat({mainRouteApiType:'openai'},'single_5m'),
    'openai',
    'ordinary strategies should still honor an OpenAI provider'
  );
  assert.strictEqual(
    context.chatRequestUpstreamFormat({mainRouteApiType:'claude'},'single_5m'),
    'anthropic',
    'ordinary strategies should still honor a Claude provider'
  );
}

function testCacheNoticeUsesProviderStrategy(){
  const context=load({
    console,
    chatPollingView:()=>({enabled:false}),
    chatLoadConfig:()=>({mainRouteCacheStrategy:'native_stable',cacheStrategy:'single_5m'}),
  },[
    'chatNormalizeCacheStrategy','providerNormalizeCacheStrategy','providerNormalizeApiType','chatPollingEnabledForConfig',
    'chatCacheStrategyMeta','chatCacheNoticeStrategy','chatCacheExpiryInfo',
  ]);
  let info=context.chatCacheExpiryInfo();
  assert.strictEqual(info.ttlMs,60*60*1000);
  assert.ok(info.text.includes('1h'),'provider native strategy should show the 1h notice');

  context.chatLoadConfig=()=>({mainRouteCacheStrategy:'single_5m',cacheStrategy:'native_stable'});
  info=context.chatCacheExpiryInfo();
  assert.strictEqual(info.ttlMs,5*60*1000);
  assert.ok(info.text.includes('5min'),'provider 5min strategy should show the 5min notice');
}

function testPollingNoticeUsesActiveProvider(){
  const context=load({
    console,
    chatPollingView:()=>({enabled:true}),
    chatPollingLiveState:{provider_id:'p1',cache_strategy:''},
    apiPollingStatusState:{data:{}},
    findLibraryProvider:id=>id==='p1'?{cache_strategy:'native_5m'}:null,
    chatLoadConfig:()=>({cacheStrategy:'native_stable'}),
  },[
    'chatNormalizeCacheStrategy','providerNormalizeCacheStrategy','chatCacheStrategyMeta','chatPollingEnabledForConfig',
    'providerCacheStrategy','chatCacheNoticeStrategy','chatCacheExpiryInfo',
  ]);
  const info=context.chatCacheExpiryInfo();
  assert.strictEqual(info.ttlMs,5*60*1000);
}

function testTrimDoesNotSyncSpeechPreferences(){
  const apply=extractFunction('chatApplyAutoTrimForPendingBatch');
  const manual=extractFunction('chatManualTrimNow');
  const queueCommit=extractFunction('chatSpeechPreferenceQueueCommit');
  assert(/opts&&opts\.skipSpeech===true/.test(apply),'trim must have an explicit skip-speech path');
  assert(/skipSpeech:skipSpeech/.test(apply),'skip-speech commits must carry their mode');
  assert(/skipSpeech:true/.test(manual),'the manual button must only truncate');
  assert(!/chatPrepareSpeechPreferencesForTrim/.test(manual),'manual truncation must not prepare preferences');
  assert(/prepared&&prepared\.skipSpeech===true\)return/.test(queueCommit),'skip-speech must preserve the retry queue');
  assert(!source.includes('chatManualSyncSpeechPreferences'),'the removed sync-only action must stay removed');
  assert(html.includes('>只截断</button>'),'the truncation action must be labelled only truncate');
}

testProviderTypeNormalization();
testNativeCacheRestoresClaudeTransport();
testCacheNoticeUsesProviderStrategy();
testPollingNoticeUsesActiveProvider();
testTrimDoesNotSyncSpeechPreferences();
console.log('provider-api-cache-trim tests passed');
