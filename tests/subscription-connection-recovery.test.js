const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),vm=require('vm');
const source=fs.readFileSync(require('path').join(__dirname,'../script.js'),'utf8');
function fixture(status){
 const calls={prompts:0,api:0,messages:[]},route={mode:'vps',gateway:'https://tlomcc.cc.cd:18443/gateway',execution:'claude_code_subscription'};
 const ctx={AbortController,setTimeout,clearTimeout,Promise,chatSyncPanelKeyToApiStorage(){},storedPanelKey(){return 'fixture';},window:{fetch(){}},
 CKBackendRoute:{current:route,isSubscription:()=>true,subscriptionStatus:status,subscriptionRoute:()=>({ok:true,source:'claude_subscription'})},
 chatSetStatus:s=>calls.messages.push(s),toast(){},ckOpenBackendRoute(){calls.prompts++;},loadApiProviders(){calls.api++;throw Error('must not use API');}};
 vm.createContext(ctx);vm.runInContext(source.slice(source.indexOf('function chatEnsureMainRouteReady('),source.indexOf('function chatLoadConfig(')),ctx);
 return {ctx,calls,route};
}
test('subscription timeout/network failures block sending without opening gateway switch or API fallback',async()=>{
 for(const error of [new DOMException('timeout','AbortError'),new TypeError('network'),new SyntaxError('truncated')]){
  const {ctx,calls,route}=fixture(async()=>{throw error;});const before=JSON.stringify(route);
  const result=await ctx.chatEnsureMainRouteReady();ctx.chatHandleMainRouteNotReady(result);
  assert.equal(result.ok,false);assert.equal(result.connectionError,true);assert.equal(calls.prompts,0);assert.equal(calls.api,0);assert.equal(JSON.stringify(route),before);
 }
});
test('confirmed login or egress failure remains blocked, and a later healthy read restores readiness',async()=>{
 let response={ready:false,message:'固定出口未验证'};const {ctx,calls}=fixture(async()=>response);
 let result=await ctx.chatEnsureMainRouteReady();ctx.chatHandleMainRouteNotReady(result);assert.equal(result.ok,false);assert.equal(calls.prompts,1);
 response={ready:true};result=await ctx.chatEnsureMainRouteReady();assert.equal(result.ok,true);assert.equal(calls.api,0);
});
