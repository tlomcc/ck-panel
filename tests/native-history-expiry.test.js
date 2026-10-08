const {test}=require('node:test');
const assert=require('node:assert/strict'),fs=require('fs'),vm=require('vm');
const source=fs.readFileSync(require.resolve('../script.js'),'utf8');
function extract(name){let start=source.indexOf('function '+name+'(');assert.ok(start>=0,name);return source.slice(start,source.indexOf('\n}',start)+2)}
function setup(){
 const now=Date.now(),session={id:'expiry',cacheFullCreatedAt:now-7200000,cacheLastReadAt:now-3600000,
  messages:[{role:'user',text:'原问题',ts:now-7200000},{role:'assistant',text:'正文',thinking:'旧思维链',ts:now-7200000,
   replyVariants:[{messages:[{role:'assistant',text:'另一版正文',thinking:'另一版思维链'}]}]}],
  transportMessages:[{role:'user',content:'问题'},{role:'assistant',_ck_image_turn:true,content:[{type:'thinking',thinking:'旧思维链',signature:'fixture'},{type:'redacted_thinking',data:'fixture'},{type:'text',text:'正文'},{type:'tool_use',id:'tool',name:'read',input:{}}]}]};
 const saves=[],ctx={Date,chatMessages:session.messages,chatCurrentSession:()=>session,CHAT_HISTORY_TOOLS:require('../chat-history.js'),chatSaveSessions:()=>saves.push(JSON.parse(JSON.stringify(session)))};
 vm.createContext(ctx);['chatCacheActivityReference','chatExpireNativeThinking'].forEach(n=>vm.runInContext(extract(n),ctx));
 return {now,session,ctx,saves};
}
test('1h expiry removes native thinking and signatures, keeps text tools and variants',()=>{
 const x=setup();assert.equal(x.ctx.chatExpireNativeThinking(x.session,x.now),true);
 assert.equal(x.session.messages[1].text,'正文');assert.equal(x.session.messages[1].thinking,undefined);
 assert.equal(x.session.messages[1].replyVariants[0].messages[0].text,'另一版正文');
 assert.equal(x.session.messages[1].replyVariants[0].messages[0].thinking,undefined);
 assert.deepEqual(Array.from(x.session.transportMessages[1].content,b=>b.type),['text','tool_use']);
 assert.equal(x.saves.length,1);assert.equal(x.ctx.chatExpireNativeThinking(x.session,x.now),false);
 const restored=JSON.parse(JSON.stringify(x.session));assert.ok(!JSON.stringify(restored).includes('signature'));
 assert.equal(restored.nativeThinkingCleanedAt,x.now);
});
test('latest cache read renews the hour and an active reply is preserved',()=>{
 const x=setup();x.session.cacheLastReadAt=x.now-3599999;
 assert.equal(x.ctx.chatExpireNativeThinking(x.session,x.now),false);
 x.session.cacheLastReadAt=x.now-3600000;x.session.messages[0].inFlight=true;
 assert.equal(x.ctx.chatExpireNativeThinking(x.session,x.now),false);
 delete x.session.messages[0].inFlight;
 assert.equal(x.ctx.chatExpireNativeThinking(x.session,x.now),true);
});
test('a newly staged pending message does not postpone cleanup of an expired prefix',()=>{
 const x=setup();x.ctx.chatMessages.push({role:'pending_user',text:'新问题',ts:x.now});
 assert.equal(x.ctx.chatExpireNativeThinking(x.session,x.now),true);
 assert.equal(x.ctx.chatMessages.at(-1).text,'新问题');
});
test('replaying a receipt neither ages the session backwards nor counts the same creation twice',()=>{
 const x=setup();x.session.updated=x.now;x.session.cacheFullCreatedAt=x.now-5000;x.session.cacheGeneration=4;
 x.session.cacheLastReadAt=x.now-1000;x.ctx.chatLoadConfig=()=>({});x.ctx.chatRenderTrimState=()=>{};
 vm.runInContext(extract('chatCaptureCacheLifecycle'),x.ctx);
 x.ctx.chatCaptureCacheLifecycle({cache_read_input_tokens:21000},x.session,x.now-100000);
 assert.equal(x.session.cacheLastReadAt,x.now-1000);assert.equal(x.session.updated,x.now);
 x.ctx.chatCaptureCacheLifecycle({cache_creation_input_tokens:21000},x.session,x.now-5000);
 assert.equal(x.session.cacheGeneration,4);
 x.ctx.chatCaptureCacheLifecycle({cache_creation_input_tokens:21000},x.session,x.now+1000);
 assert.equal(x.session.cacheGeneration,5);assert.equal(x.session.cacheFullCreatedAt,x.now+1000);
});
