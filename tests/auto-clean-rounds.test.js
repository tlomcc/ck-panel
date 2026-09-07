'use strict';
// 自动清理召回与图片：默认按缓存过期 5min / 1h，兼容旧版按轮数模式。
const assert=require('assert');
const fs=require('fs');
const vm=require('vm');

const root=require('path').resolve(__dirname,'..');
const source=fs.readFileSync(require('path').join(root,'script.js'),'utf8');
const html=fs.readFileSync(require('path').join(root,'index.html'),'utf8');

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

function testNormalize(){
  const ctx={console,CHAT_AUTO_CLEAN_DEFAULT_ROUNDS:100,CHAT_AUTO_CLEAN_MIN_ROUNDS:5,CHAT_AUTO_CLEAN_MAX_ROUNDS:5000};
  vm.createContext(ctx);
  ['chatPositiveIntOrDefault','chatNormalizeAutoCleanConfig','chatAutoCleanConfigFrom']
    .forEach(name=>vm.runInContext(extractFunction(name),ctx));

  const d=ctx.chatNormalizeAutoCleanConfig({});
  assert.strictEqual(d.enabled,false,'会删除可见内容的动作必须默认关闭');
  assert.strictEqual(d.mode,'cache_5m','新用户默认选择缓存过期 5min');
  assert.strictEqual(d.rounds,100,'兼容的按轮数默认值仍为 100');
  assert.strictEqual(ctx.chatNormalizeAutoCleanConfig({mode:'5min'}).mode,'cache_5m');
  assert.strictEqual(ctx.chatNormalizeAutoCleanConfig({mode:'1h'}).mode,'cache_1h');
  assert.strictEqual(ctx.chatNormalizeAutoCleanConfig({mode:'rounds',rounds:1}).rounds,5);
  assert.strictEqual(ctx.chatNormalizeAutoCleanConfig({mode:'rounds',rounds:99999}).rounds,5000);
  assert.strictEqual(ctx.chatNormalizeAutoCleanConfig({enabled:'true'}).enabled,true);
  assert.strictEqual(ctx.chatNormalizeAutoCleanConfig({enabled:1}).enabled,false);
  assert.strictEqual(ctx.chatAutoCleanConfigFrom({autoCleanEnabled:true,autoCleanMode:'cache_1h'}).mode,'cache_1h');
}

function testConfigPlumbing(){
  assert.ok(/autoCleanEnabled:false,\s*\n\s*autoCleanMode:'cache_5m',\s*\n\s*autoCleanRounds:CHAT_AUTO_CLEAN_DEFAULT_ROUNDS/.test(source));
  const load=extractFunction('chatLoadConfig');
  assert.ok(/hasOwnProperty\.call\(saved\|\|\{\},'autoCleanMode'\)/.test(load)&&/cfg\.autoCleanMode='rounds'/.test(load),
    '旧版按轮存档必须保持原行为');
  assert.ok(/cfg\.autoCleanMode=autoClean\.mode/.test(load));
  const save=extractFunction('chatSaveConfigObject');
  assert.ok(/cfg\.autoCleanMode=autoCleanSave\.mode/.test(save));
  const read=extractFunction('chatReadForm');
  assert.ok(/chat-auto-clean-mode/.test(read)&&/autoCleanMode:cleanCfg\.mode/.test(read));
  const write=extractFunction('chatWriteForm');
  assert.ok(/chatSetFieldValue\('chat-auto-clean-mode',cleanCfg\.mode\)/.test(write));
  assert.ok(/chatRenderAutoCleanControls\(cleanCfg\)/.test(write));
}

function testPersistedBaseline(){
  const normalize=extractFunction('chatNormalizeSession');
  const storage=extractFunction('chatSessionStorageData');
  assert.ok(/autoCleanLastRound:Number\(s\.autoCleanLastRound\|\|0\)\|\|0/.test(normalize));
  assert.ok(/autoCleanLastCacheActivityAt:Number\(s\.autoCleanLastCacheActivityAt\|\|0\)\|\|0/.test(normalize));
  assert.ok(/autoCleanLastCacheActivityAt:s\.autoCleanLastCacheActivityAt\|\|0/.test(storage));
}

function testSharedCore(){
  const core=extractFunction('chatCleanHistoryCore');
  assert.ok(/chatCleanEndpoint\(cfg\)/.test(core));
  assert.ok(/chatStripLocalHistoryMediaAndRecall\(stripTarget\)/.test(core));
  assert.ok(!/toast\(/.test(core)&&!/chatShowCleanHistoryConfirm/.test(core));
  const manual=extractFunction('chatCleanHistory');
  assert.ok(/chatShowCleanHistoryConfirm\(\)/.test(manual));
  assert.ok(/chatCleanHistoryCore\(cfg\)/.test(manual));
  assert.ok(/chatAutoCleanMarkDone\(result\.sessionId\)/.test(manual));
  assert.ok(/chatCleanHistoryCore\(cfg\)/.test(extractFunction('chatMaybeAutoClean')));
}

function testRunnerGuards(){
  const auto=extractFunction('chatMaybeAutoClean');
  assert.ok(/chatAutoCleanBusy\|\|chatSending\|\|chatIdleTrimBusy/.test(auto));
  assert.ok(/currentPanelTab!=='chat'/.test(auto));
  assert.ok(/chatEditingIndex>=0/.test(auto));
  assert.ok(/opts\.forceCheck!==true&&now-chatAutoCleanLastCheckAt<30000/.test(auto));
  assert.ok(/if\(!clean\.enabled\)return/.test(auto));
  assert.ok(/chatPendingMessages\(\)\.length/.test(auto));
  assert.ok(/clean\.mode==='rounds'/.test(auto)&&/count-last<clean\.rounds/.test(auto));
  assert.ok(/clean\.mode==='cache_5m'\?5\*60\*1000:60\*60\*1000/.test(auto));
  assert.ok(/lastCacheActivity>=cacheReferenceTimestamp/.test(auto));
  assert.ok(/Date\.now\(\)-cacheReferenceTimestamp<cacheTtlMs/.test(auto));
  assert.ok(/chatAutoCleanMarkDone\(result\.sessionId,count,cacheReferenceTimestamp\)/.test(auto));
  assert.ok(/finally\{\s*\n?\s*chatAutoCleanBusy=false;/.test(auto));
  assert.ok(/chatMaybeAutoTrimAtIdleBoundary\(\);\s*\n\s*\/\/[^\n]*\n\s*chatMaybeAutoClean\(\);/.test(source));
  assert.ok(/chatMaybeAutoClean\(\{forceCheck:true\}\)/.test(source));
}

async function testExpiryBehavior(){
  let now=10*60*1000;
  const session={id:'s1',messages:[{role:'user',text:'hello',ts:now-4*60*1000}],cacheFullCreatedAt:now-4*60*1000};
  let cleanCalls=0;
  const ctx={
    console,
    CHAT_AUTO_CLEAN_DEFAULT_ROUNDS:100,
    CHAT_AUTO_CLEAN_MIN_ROUNDS:5,
    CHAT_AUTO_CLEAN_MAX_ROUNDS:5000,
    Date:{now:()=>now},
    currentPanelTab:'chat',chatAutoCleanBusy:false,chatSending:false,chatIdleTrimBusy:false,
    chatTrimBusy:false,chatEditingIndex:-1,chatAutoCleanLastCheckAt:0,
    chatMessages:session.messages,chatSessions:[session],
    chatLoadConfig:()=>({panelKey:'key',autoCleanEnabled:true,autoCleanMode:'cache_5m'}),
    chatCurrentSession:()=>session,chatCurrentConversationRoundCount:()=>1,
    chatPendingMessages:()=>[],chatMessageHasContent:m=>!!m.text,
    chatCacheActivityReference:(s,fallback)=>({timestamp:s.cacheFullCreatedAt||fallback,source:'full_create'}),
    chatCleanHistoryCore:async()=>{cleanCalls++;return {ok:true,sessionId:'s1',images:1,recalls:1}},
    chatRenderAutoCleanState:()=>{},chatDebug:()=>{},toast:()=>{},chatSaveSessions:()=>{}
  };
  vm.createContext(ctx);
  [
    'chatPositiveIntOrDefault','chatNormalizeAutoCleanConfig','chatAutoCleanConfigFrom',
    'chatAutoCleanSessionById','chatAutoCleanLastRound','chatAutoCleanLastCacheActivityAt',
    'chatAutoCleanCacheReference','chatAutoCleanMarkDone','chatMaybeAutoClean'
  ].forEach(name=>vm.runInContext(extractFunction(name),ctx));

  await ctx.chatMaybeAutoClean({forceCheck:true});
  assert.strictEqual(cleanCalls,0,'5min 未到不能清');
  now+=60*1000;
  await ctx.chatMaybeAutoClean({forceCheck:true});
  assert.strictEqual(cleanCalls,1,'5min 到点应清理');
  await ctx.chatMaybeAutoClean({forceCheck:true});
  assert.strictEqual(cleanCalls,1,'同一个过期缓存不能重复清');

  session.cacheFullCreatedAt=now;
  now+=5*60*1000;
  await ctx.chatMaybeAutoClean({forceCheck:true});
  assert.strictEqual(cleanCalls,2,'出现新缓存活动后，下一次过期可再次清理');

  session.cacheFullCreatedAt=now;
  ctx.chatLoadConfig=()=>({panelKey:'key',autoCleanEnabled:true,autoCleanMode:'cache_1h'});
  now+=59*60*1000;
  await ctx.chatMaybeAutoClean({forceCheck:true});
  assert.strictEqual(cleanCalls,2,'1h 模式在 59 分钟不能清');
  now+=60*1000;
  await ctx.chatMaybeAutoClean({forceCheck:true});
  assert.strictEqual(cleanCalls,3,'1h 模式到点应清理');
}

function testStateLineAndHtml(){
  assert.ok(/id="chat-auto-clean-enabled"[^>]*onchange="chatSaveAutoCleanSetting\(true\)"/.test(html));
  assert.ok(/id="chat-auto-clean-mode"[^>]*onchange="chatSaveAutoCleanSetting\(true\)"/.test(html));
  assert.ok(/value="cache_5m">缓存过期 5min</.test(html)&&/value="cache_1h">缓存过期 1h</.test(html));
  assert.ok(/id="chat-auto-clean-rounds-row"/.test(html));
  assert.ok(/id="chat-auto-clean-state"/.test(html));
  const memoryStart=html.indexOf('id="chat-side-memory"');
  const memoryEnd=html.indexOf('id="chat-side-trim"');
  const card=html.indexOf('id="chat-auto-clean-enabled"');
  assert.ok(memoryStart>=0&&card>memoryStart&&card<memoryEnd);
  const render=extractFunction('chatRenderAutoCleanState');
  assert.ok(/本轮缓存已清理/.test(render)&&/还差约/.test(render));
}

function testDebugRendering(){
  assert.ok(/if\(ev==='auto_clean'\)\{/.test(source));
  assert.ok(/ev==='auto_clean'\)return 'recall'/.test(source));
  assert.ok(/data\.mode==='cache_5m'/.test(source)&&/data\.mode==='cache_1h'/.test(source));
}

(async()=>{
  testNormalize();
  testConfigPlumbing();
  testPersistedBaseline();
  testSharedCore();
  testRunnerGuards();
  await testExpiryBehavior();
  testStateLineAndHtml();
  testDebugRendering();
  console.log('auto clean cache expiry tests: OK');
})().catch(error=>{console.error(error);process.exitCode=1});
