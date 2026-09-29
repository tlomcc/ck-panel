const {test}=require('node:test');
const assert=require('node:assert/strict'),fs=require('fs'),vm=require('vm');
const source=fs.readFileSync(require.resolve('../script.js'),'utf8');
const history=require('../chat-history.js');
function extract(name){const a=source.indexOf('function '+name+'(');return source.slice(a,source.indexOf('\n}',a)+2)}
const ctx={Set,CHAT_HISTORY_TOOLS:history};vm.createContext(ctx);
['chatAutoTrimRoundCount','chatTimeReminderContext'].forEach(name=>vm.runInContext(extract(name),ctx));
test('clock excludes pending, failed and maintenance activity; batched input is one turn',()=>{
 const pending=[{role:'pending_user',ts:9999},{role:'pending_user',ts:9999}];
 const messages=[{role:'user',text:'问',ts:100,turnId:'a'}, {role:'assistant',text:'答',ts:120,turnId:'a'},
 {role:'notice',ts:9000},{role:'user',text:'失败',sendFailed:true,ts:9001},...pending];
 const result=ctx.chatTimeReminderContext({transportUpdated:9999},messages,pending);
 assert.equal(result.lastActivityAt,120);assert.equal(result.round,2);
 assert.deepEqual(pending.map(m=>m.timeReminderRound),[2,2]);
});
test('persisted clock survives trim and reload; regeneration/retry reuses round',()=>{
 const session=JSON.parse(JSON.stringify({timeReminderRoundCount:9,lastChatActivityAt:1234,transportUpdated:9999}));
 let pending=[{role:'pending_user'}];let result=ctx.chatTimeReminderContext(session,[],pending);
 assert.equal(result.round,10);assert.equal(result.lastActivityAt,1234);
 pending=[{role:'pending_user',timeReminderRound:9}];result=ctx.chatTimeReminderContext(session,[],pending);
 assert.equal(result.round,9);
});
test('new conversation does not invent a prior chat time',()=>{
 const result=ctx.chatTimeReminderContext({transportUpdated:9999},[{role:'notice',ts:9000}],[{}]);
 assert.equal(result.round,1);assert.equal(result.lastActivityAt,0);
});
