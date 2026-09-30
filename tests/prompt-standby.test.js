const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),vm=require('vm');
const source=fs.readFileSync(require.resolve('../script.js'),'utf8');
function extract(name){let start=source.indexOf('function '+name+'(');assert.ok(start>=0,name);if(source.slice(start-6,start)==='async ')start-=6;return source.slice(start,source.indexOf('\n}',start)+2)}
function setup(){
 let now=1800000000000,stored={system:'原提示词',systemPromptStandby:'完整新提示词'},fail=false;
 const nodes={'chat-system':{value:stored.system},'chat-system-standby':{value:stored.systemPromptStandby},'chat-system-standby-status':{textContent:'',dataset:{}},'chat-thinking-prompt':{value:''},'chat-thinking-standby':{value:''},'chat-thinking-standby-status':{textContent:'',dataset:{}}};
 const ctx={Date:class extends Date{static now(){return now}},Math,String,Number,JSON,Array,chatSessions:[],chatSessionsReady:true,chatSending:false,chatTrimBusy:false,chatTrimTransaction:null,CHAT_CONFIG_KEY:'config',
 document:{getElementById:id=>nodes[id]},chatLoadConfig:()=>({...stored}),chatSaveConfigObject:cfg=>{if(!fail)stored={...cfg}},localStorage:{getItem:()=>JSON.stringify(stored)},
 chatPromptDraftDirty:{system:false,thinking:false},chatSetFieldValue:(id,value)=>{nodes[id].value=value},toast:()=>{},ckConfirmDialog:async()=>true,
 chatIsRealMessage:m=>['user','assistant'].includes(m.role),chatCacheActivityReference:s=>({timestamp:Math.max(s.cacheLastReadAt||0,s.cacheFullCreatedAt||0)}),findLibraryProvider:()=>null,providerCacheStrategy:()=>'',chatCacheNoticeStrategy:()=> 'single_5m'};
 vm.createContext(ctx);
 ['chatSystemPromptCacheTtl','chatSystemPromptCacheWait','chatPromptFields','chatRenderPromptCounts','chatRenderPromptStandby','chatRenderSystemPromptStandby','chatPromptStandbyEdited','chatSystemPromptStandbyEdited','chatThinkingPromptStandbyEdited','chatStorePrompt','chatSavePromptStandby','chatSyncPromptNow','chatMaybeSyncPrompt','chatMaybeSyncSystemPrompt','chatThinkingPromptValue'].forEach(n=>vm.runInContext(extract(n),ctx));
 vm.runInContext(source.match(/function chatActiveThinkingPrompt[^\n]+/)[0],ctx);
 return {ctx,nodes,get saved(){return stored},now:()=>now,advance:ms=>now+=ms,fail:()=>fail=true};
}
test('5m expiry promotes the whole draft once, keeps it, and leaves the enable switch alone',()=>{
 const x=setup();x.ctx.chatSessions=[{messages:[{role:'assistant',ts:x.now()}]}];
 assert.equal(x.ctx.chatMaybeSyncSystemPrompt(),false);assert.equal(x.saved.system,'原提示词');
 x.advance(300000);assert.equal(x.ctx.chatMaybeSyncSystemPrompt(),true);assert.equal(x.saved.system,'完整新提示词');assert.equal(x.saved.systemPromptStandby,'完整新提示词');assert.equal(x.nodes['chat-system'].value,x.saved.system);
 assert.match(x.nodes['chat-system-standby-status'].textContent,/同步成功/);const stamp=x.saved.systemPromptStandbySyncedAt;x.advance(15000);assert.equal(x.ctx.chatMaybeSyncSystemPrompt(),false);assert.equal(x.saved.systemPromptStandbySyncedAt,stamp);
});
test('cache reads extend waiting and all windows must expire',()=>{
 const x=setup();x.ctx.chatSessions=[{systemPromptCacheStrategy:'single_5m',cacheLastReadAt:x.now()},{systemPromptCacheStrategy:'native_tiered',cacheFullCreatedAt:x.now()}];
 x.advance(300001);assert.equal(x.ctx.chatMaybeSyncSystemPrompt(),false);x.ctx.chatSessions[1].cacheLastReadAt=x.now();x.advance(3300000);assert.equal(x.ctx.chatMaybeSyncSystemPrompt(),false);x.advance(300000);assert.equal(x.ctx.chatMaybeSyncSystemPrompt(),true);
});
test('automatic prefix caching waits 24h, and switching to a shorter policy cannot shorten an earlier lifetime',()=>{
 const x=setup();const end=x.now()+86400000;x.ctx.chatSessions=[{systemPromptCacheStrategy:'prefix_24h',systemPromptCacheRequestedAt:x.now(),systemPromptCacheUntil:end}];
 x.advance(3600000);x.ctx.chatSessions[0].systemPromptCacheStrategy='single_5m';assert.equal(x.ctx.chatMaybeSyncSystemPrompt(),false);x.advance(82800000);assert.equal(x.ctx.chatMaybeSyncSystemPrompt(),true);
});
test('unsaved text and an ongoing request are never overwritten',()=>{
 const x=setup();x.nodes['chat-system-standby'].value='正在编辑';assert.equal(x.ctx.chatMaybeSyncSystemPrompt(),false);assert.equal(x.nodes['chat-system-standby'].value,'正在编辑');x.nodes['chat-system-standby'].value=x.saved.systemPromptStandby;
 x.ctx.chatSending=true;assert.equal(x.ctx.chatMaybeSyncSystemPrompt(),false);assert.equal(x.ctx.chatMaybeSyncSystemPrompt({beforeRequest:true}),true);
});
test('manual synchronization confirms, saves unsaved drafts immediately, and can clear a formal prompt',async()=>{
 const x=setup();x.ctx.chatSessions=[{systemPromptCacheStrategy:'prefix_24h',cacheLastReadAt:x.now()}];
 x.nodes['chat-thinking-standby'].value='新思考 🐈';x.ctx.chatThinkingPromptStandbyEdited();
 x.ctx.ckConfirmDialog=async()=>false;assert.equal(await x.ctx.chatSyncPromptNow('thinking'),false);assert.equal(x.saved.thinkingPrompt,undefined);
 x.ctx.ckConfirmDialog=async()=>true;assert.equal(await x.ctx.chatSyncPromptNow('thinking'),true);assert.equal(x.saved.thinkingPrompt,'新思考 🐈');assert.equal(x.saved.fakeThinkingPrompt,x.saved.thinkingPrompt);
 assert.equal(x.saved.thinkingPromptStandby,x.saved.thinkingPrompt);assert.equal(x.ctx.chatPromptDraftDirty.thinking,false);
 x.nodes['chat-thinking-standby'].value='';assert.equal(await x.ctx.chatSyncPromptNow('thinking'),true);assert.equal(x.saved.thinkingPrompt,'');
});
test('thinking standby follows the same deferred promotion as system prompts',()=>{
 const x=setup();x.ctx.chatSessions=[{cacheLastReadAt:x.now()}];x.nodes['chat-thinking-standby'].value='等待中的思考';
 assert.equal(x.ctx.chatSavePromptStandby('thinking'),true);assert.equal(x.saved.thinkingPrompt,undefined);
 x.advance(300001);assert.equal(x.ctx.chatMaybeSyncSystemPrompt(),true);assert.equal(x.saved.thinkingPrompt,'等待中的思考');
});
test('storage failure reports unsuccessful promotion and retains the main text',()=>{
 const x=setup();x.fail();assert.equal(x.ctx.chatMaybeSyncSystemPrompt(),false);assert.equal(x.saved.system,'原提示词');assert.equal(x.nodes['chat-system'].value,'原提示词');assert.match(x.nodes['chat-system-standby-status'].textContent,/未成功/);
});
test('disabled or empty thinking prompt never resurrects a legacy alias',()=>{
 const x=setup();assert.equal(x.ctx.chatActiveThinkingPrompt({thinkingPrompt:'',fakeThinkingPrompt:'旧内容'}),'');assert.equal(x.ctx.chatActiveThinkingPrompt({thinkingPrompt:'自己的提示词',thinkingPromptEnabled:false}),'');assert.equal(x.ctx.chatActiveThinkingPrompt({thinkingPrompt:'自己的提示词',thinkingPromptEnabled:true}),'自己的提示词');assert.equal(x.ctx.chatThinkingPromptValue({fakeThinkingPrompt:'旧版自定义'}),'旧版自定义');
});
