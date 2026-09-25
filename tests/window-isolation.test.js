'use strict';

const assert=require('assert');
const fs=require('fs');
const path=require('path');
const vm=require('vm');

const root=path.resolve(__dirname,'..');
const source=fs.readFileSync(path.join(root,'script.js'),'utf8');
const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
const css=fs.readFileSync(path.join(root,'chat.css'),'utf8');

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

function testWindowApiRoute(){
  const providers=[
    {id:'p-window',name:'Window API',url:'https://window.example/v1',key:'secret',model:'model-a',api_type:'openai',cache_strategy:'native_5m'},
  ];
  const main={ok:true,provider:{id:'p-main'},providerName:'Main API',providerHost:'main.example',apiBase:'https://main.example/v1',upstreamKey:'main-key',model:'main-model',apiType:'claude',source:'api_config_main_io'};
  let session={apiProviderId:'p-window',apiModel:'model-b'};
  const context=load({
    console,
    apiProvidersLoaded:true,
    chatMainRouteConfig:()=>main,
    chatSessionForRoute:()=>session,
    findLibraryProvider:id=>providers.find(provider=>provider.id===id)||null,
    providerDisplayName:provider=>provider.name,
    providerHost:url=>new URL(url).host,
    providerNormalizeApiType:value=>value,
  },['chatWindowApiRouteConfig']);

  let route=context.chatWindowApiRouteConfig({});
  assert.strictEqual(route.source,'chat_window_api');
  assert.strictEqual(route.apiBase,'https://window.example/v1');
  assert.strictEqual(route.model,'model-b');
  assert.strictEqual(route.ok,true);

  session={};
  assert.strictEqual(context.chatWindowApiRouteConfig({}),main,'an unassigned window must follow the main route');
  session={apiProviderId:'deleted-provider'};
  assert.strictEqual(context.chatWindowApiRouteConfig({}),main,'a deleted provider must fall back to the main route');
}

function testWindowApiDisablesGlobalPolling(){
  const context=load({console,chatPollingView:()=>({enabled:true})},['chatPollingEnabledForConfig']);
  assert.strictEqual(context.chatPollingEnabledForConfig({chatApiSource:'chat_window_api'}),false);
  assert.strictEqual(context.chatPollingEnabledForConfig({chatApiSource:'api_config_main_io'}),true);
  assert.strictEqual((source.match(/chat_polling_enabled:chatPollingEnabledForConfig\(cfg\)/g)||[]).length,2,
    'history cleanup and trim sync must use the same window polling scope');
  assert.ok(source.includes('body.chat_polling_enabled=chatPollingEnabledForConfig(cfg)'),
    'normal chat requests must stay on the selected window API');
}

function testRouteMetadata(){
  const context=load({
    console,
    GRAPH_API_BASE:'https://gateway.example',
    API_BASE:'https://memory.example',
    chatDefaultConfig:()=>({}),
    chatMainRouteConfig:()=>({ok:false}),
    providerNormalizeApiType:value=>value,
    providerCacheStrategy:provider=>provider.cache_strategy||'',
  },['chatApplyMainRouteToConfig']);
  const route={
    ok:true,
    provider:{id:'p-window',cache_strategy:'native_5m'},
    providerName:'Window API',providerHost:'window.example',
    apiBase:'https://window.example/v1',upstreamKey:'key',model:'model-b',apiType:'openai',source:'chat_window_api',
  };
  const cfg=context.chatApplyMainRouteToConfig({},route);
  assert.strictEqual(cfg.chatApiSource,'chat_window_api');
  assert.strictEqual(cfg.mainRouteProviderId,'p-window');
  assert.strictEqual(cfg.mainRouteCacheStrategy,'native_5m');
}

function testWindowTrimOverride(){
  const context=load({
    console,
    CHAT_AUTO_TRIM_DEFAULT_KEEP_ROUNDS:200,
    CHAT_AUTO_TRIM_DEFAULT_ROUND_LIMIT:1000,
    chatPositiveIntOrDefault:(value,fallback)=>{
      const parsed=Math.floor(Number(value));
      return Number.isFinite(parsed)&&parsed>0?parsed:fallback;
    },
  },['chatNormalizeAutoTrimConfig','chatAutoTrimConfigFrom','chatWindowTrimConfigFromSession']);

  const defaults={autoTrimEnabled:true,autoTrimKeepRounds:200,autoTrimRoundLimitEnabled:false,autoTrimRoundLimit:1000};
  assert.strictEqual(context.chatAutoTrimConfigFrom(defaults).keep,200);
  const override=context.chatWindowTrimConfigFromSession({
    trimOverrideEnabled:true,
    trimConfig:{enabled:false,keep:35,roundLimitEnabled:true,roundLimit:90,prefixSilent:true},
  });
  assert.strictEqual(override.keep,35);
  assert.strictEqual(override.roundLimit,90);
  assert.strictEqual(override.enabled,false);
  assert.strictEqual(override.prefixSilent,true);
  assert.strictEqual(context.chatAutoTrimConfigFrom({...defaults,windowTrimOverride:true,windowTrimConfig:override}).keep,35);
  assert.strictEqual(context.chatWindowTrimConfigFromSession({trimOverrideEnabled:false}),null);
}

function testDailyDigestInheritance(){
  const kept=[{id:'today',text:'summary'},{id:'previous',text:'older summary',nested:{value:1}}];
  const context=load({
    console,
    CHAT_NEW_SESSION_DIGEST_SOURCE_TITLE:'小克',
    chatLoadConfig:()=>({newSessionDigestSyncEnabled:true}),
    chatDailyDigestDayKey:()=> '2026-09-20',
    chatDailyDigestEntries:(session,day,cfg)=>day==='2026-09-20'?session.dailyDigests:[],
  },['chatNewSessionDailyDigests']);

  let result=context.chatNewSessionDailyDigests({newSessionDigestSyncEnabled:true},{title:'小克',dailyDigests:kept});
  assert.strictEqual(result.length,2);
  result[1].nested.value=2;
  assert.strictEqual(kept[1].nested.value,1);
  assert.notStrictEqual(result[0],kept[0],'the new window must receive a copy, not share the source object');
  assert.strictEqual(context.chatNewSessionDailyDigests({newSessionDigestSyncEnabled:false},{title:'小克',dailyDigests:kept}).length,0);
  assert.strictEqual(context.chatNewSessionDailyDigests({newSessionDigestSyncEnabled:true},{title:'Other',dailyDigests:kept}).length,0);
}

function testWiring(){
  assert.ok(html.includes('id="chat-window-api-editor"'));
  assert.ok(html.includes('id="chat-new-session-digest-sync"'));
  assert.ok(html.includes('id="chat-window-trim-override"'));
  assert.strictEqual((source.match(/apiProviderId:String\(s\.apiProviderId\|\|''\)\.trim\(\)/g)||[]).length,2,
    'window API selection must survive normalization and persisted-session compaction');
  assert.strictEqual((source.match(/trimOverrideEnabled:s\.trimOverrideEnabled===true/g)||[]).length,2,
    'window trim selection must survive normalization and persisted-session compaction');
  assert.ok(extractFunction('loadApiProviders').includes('chatRenderWindowApi()'),
    'the window picker must refresh when the provider library finishes loading');
  assert.ok(/\.chat-window-api-row\{/.test(css),'the window provider picker needs an explicit stable layout');
}

testWindowApiRoute();
testWindowApiDisablesGlobalPolling();
testRouteMetadata();
testWindowTrimOverride();
testDailyDigestInheritance();
testWiring();
console.log('window isolation tests: OK');
