const {test}=require('node:test');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../script.js'),'utf8');
const code=source.slice(source.indexOf('function chatSubscriptionFailureInfo('),source.indexOf('function chatShortSession('));
const ctx={esc:value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))};
vm.createContext(ctx);vm.runInContext(code,ctx);
const cfg={chatApiSource:'claude_subscription'};

test('legacy generic 502 stays unknown and never claims an account ban',()=>{
 const error=Error('Upstream HTTP 502 POST https://api.anthropic.com/v1/messages: Claude Code 返回了上游 API 错误');
 const info=ctx.chatSubscriptionFailureInfo(error,cfg);
 assert.equal(info.code,'subscription_unknown');
 assert.match(info.message,/消息已保留/);assert.doesNotMatch(info.message,/封|API Key|https:|502/);
 assert.equal(ctx.chatFriendlyError(error,cfg),info.message);
});
test('real authentication, quota and egress failures remain distinct from service load',()=>{
 for(const [code,word] of [['subscription_auth','登录'],['subscription_denied','权限'],
  ['subscription_limit','额度'],['subscription_egress','固定出口'],['subscription_billing','付款']]){
  const info=ctx.chatSubscriptionFailureInfo({code,message:'HTTP 529'});
  assert.equal(info.code,code);assert.match(info.message,new RegExp(word));assert.equal(info.action,'subscription');
 }
 assert.equal(ctx.chatSubscriptionFailureInfo({code:'subscription_temporary'}).action,'retry');
});
test('old bridge account and gate text takes precedence over its synthetic 502',()=>{
 for(const [text,code] of [['Claude Code 鉴权失败','subscription_auth'],['订阅出口未通过固定 IP 检查','subscription_egress'],
  ['Claude Code 上游限流或额度不足','subscription_limit'],['Claude Code 正在处理其他消息','subscription_busy']]){
  assert.equal(ctx.chatSubscriptionFailureInfo(Error('Upstream HTTP 502: '+text),cfg).code,code);
 }
});
test('API route error behavior is unchanged',()=>{
 const error=Error('Upstream HTTP 401 POST https://api.vendor.invalid/v1/messages');
 assert.equal(ctx.chatSubscriptionFailureInfo(error,{chatApiSource:'provider'}),null);
 assert.match(ctx.chatFriendlyError(error),/API Key 无效/);
 assert.match(ctx.chatFriendlyError(Error('Insufficient account balance')),/余额不足/);
});
test('only the safe error code is saved; messages and attachments stay untouched',()=>{
 const messages=[{role:'user',text:'保留正文',images:[{id:'image1'}],sendFailed:true}];
 const original=JSON.stringify(messages);
 ctx.chatMarkSubscriptionFailure(messages,{code:'subscription_temporary',message:'PRIVATE_ECHO'},cfg);
 assert.equal(messages[0].sendFailureCode,'subscription_temporary');
 assert.doesNotMatch(JSON.stringify(messages),/PRIVATE_ECHO/);
 delete messages[0].sendFailureCode;assert.equal(JSON.stringify(messages),original);
 ctx.chatMarkSubscriptionFailure(messages,{code:'subscription_auth'},cfg);
 ctx.chatMarkSubscriptionFailure(messages,Error('plain API error'),{chatApiSource:'provider'});
 assert.equal(messages[0].sendFailureCode,undefined);
});
test('subscription failure stays inline with an accessible local action',()=>{
 const html=ctx.chatSendFailureHtml({sendFailureCode:'subscription_temporary'},2);
 assert.match(html,/role="status"/);assert.match(html,/data-act="retry" data-i="2"/);
 assert.doesNotMatch(html,/请求失败|HTTP|https:|alert/);
 const auth=ctx.chatSendFailureHtml({sendFailureCode:'subscription_auth'},3);
 assert.match(auth,/data-act="subscription"/);assert.match(auth,/查看订阅状态/);
 const api=ctx.chatSendFailureHtml({},4);assert.match(api,/发送失败 · 点击重试/);
});
