const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),vm=require('vm'),path=require('path');
const source=fs.readFileSync(path.join(__dirname,'../backend-route.js'),'utf8');
function fixture(saved){
 const storage=new Map(saved?[['ckBackendRouteV1',JSON.stringify(saved)]]:[]),els={};
 for(const id of ['ck-backend-status','ck-backend-save','ck-backend-mode','ck-execution-mode','ck-vps-gateway','ck-vps-mcp','chat-input'])els[id]={value:'',textContent:''};
 els['ck-backend-mode'].value='vps';els['ck-vps-gateway'].value='https://tlomcc.cc.cd:18443/gateway';els['ck-vps-mcp'].value='https://tlomcc.cc.cd:18443/mcp';
 const ctx={URL,AbortController,setTimeout,clearTimeout,setInterval:()=>0,clearInterval,document:{addEventListener(){},getElementById:id=>els[id]},localStorage:{getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)},sessionStorage:{setItem(){}},location:{hostname:'test',reload(){ctx.reloaded=true}},storedPanelKey:()=> 'test-key',panelAppStarted:true,chatSessionsReady:true,chatSaveConfig(){},chatSaveLocalMessages(){},async chatSaveSessionsToIndexedDb(){ctx.saved=true}};
 ctx.window=ctx;vm.createContext(ctx);vm.runInContext(source,ctx);
 ctx.fetch=async url=>({ok:true,json:async()=>url.endsWith('/health')?{status:'ok',migration_read_only:false}:url.endsWith('/config')?{config_status:{ok:true},providers:{test:{}}}:{result:{tools:[{name:'test'}]}}});
 return {ctx,storage,els};
}
test('legacy default and invalid stored route recover to Alibaba',()=>{
 assert.equal(fixture().ctx.CKBackendRoute.current.mode,'aliyun');
 assert.equal(fixture({mode:'vps',gateway:'http://public.test',mcp:'bad'}).ctx.CKBackendRoute.current.mode,'aliyun');
});
test('URL rejects public HTTP and credentials; permits HTTPS ports and loopback',()=>{
 const api=fixture().ctx.CKBackendRoute;
 for(const u of ['http://x.test','https://user:pass@x.test','https://x.test?key=secret','https://x.test/#secret'])assert.throws(()=>api.normalize(u));
 assert.equal(api.normalize('https://tlomcc.cc.cd:18443/gateway/'),'https://tlomcc.cc.cd:18443/gateway');
 assert.equal(api.normalize('http://127.0.0.1:19080/mcp'),'http://127.0.0.1:19080/mcp');
});
test('successful switch persists sessions and leaves all other storage intact',async()=>{
 const {ctx,storage}=fixture();storage.set('ckChatConfig','original');storage.set('chat-history','original');
 await ctx.ckSaveBackendRoute();assert.equal(ctx.saved,true);assert.equal(ctx.reloaded,true);
 assert.equal(JSON.parse(storage.get('ckBackendRouteV1')).mode,'vps');assert.equal(storage.get('ckChatConfig'),'original');assert.equal(storage.get('chat-history'),'original');
});
test('failed connection, readonly server, or failed persistence never switch',async()=>{
 for(const kind of ['network','readonly','storage']){
  const {ctx,storage}=fixture();
  if(kind==='network')ctx.fetch=async()=>{throw Error('offline')};
  if(kind==='readonly')ctx.fetch=async()=>({ok:true,json:async()=>({status:'ok',migration_read_only:true})});
  if(kind==='storage')ctx.chatSaveSessionsToIndexedDb=async()=>{ctx.chatIndexedDbFailed=true};
  await ctx.ckSaveBackendRoute();assert.equal(ctx.reloaded,undefined,kind);assert.equal(storage.has('ckBackendRouteV1'),false,kind);
 }
});
test('busy before or during asynchronous probe blocks switching',async()=>{
 for(const mid of [false,true]){
  const {ctx,storage}=fixture();if(mid){const f=ctx.fetch;ctx.fetch=async u=>{ctx.chatSending=true;return f(u)}}else ctx.chatSending=true;
  await ctx.ckSaveBackendRoute();assert.equal(ctx.reloaded,undefined);assert.equal(storage.has('ckBackendRouteV1'),false);
 }
});

test('Claude Code selection requires live capability and persists only the explicit route',async()=>{
 const {ctx,els,storage}=fixture();els['ck-execution-mode'].value='claude_code_api';
 await ctx.ckSaveBackendRoute();assert.equal(ctx.reloaded,undefined);assert.equal(storage.has('ckBackendRouteV1'),false);
 const original=ctx.fetch;ctx.fetch=async url=>url.endsWith('/health')?{ok:true,json:async()=>({status:'ok',claude_code_api:true})}:original(url);
 await ctx.ckSaveBackendRoute();assert.equal(ctx.reloaded,undefined,'old adapted route must not pass the native capability check');
 ctx.fetch=async url=>url.endsWith('/health')?{ok:true,json:async()=>({status:'ok',claude_code_api:true,claude_code_native:true})}:original(url);
 await ctx.ckSaveBackendRoute();assert.equal(ctx.reloaded,true);assert.equal(JSON.parse(storage.get('ckBackendRouteV1')).execution,'claude_code_api');
 assert.equal(ctx.CKBackendRoute.parse({mode:'aliyun',execution:'claude_code_api'}).execution,undefined);
});


test('subscription requires login, persists independent model and never falls back to API',async()=>{
 const {ctx,els,storage}=fixture();els['ck-execution-mode'].value='claude_code_subscription';
 els['ck-subscription-model']={value:'opus'};
 const original=ctx.fetch;let ready=false;
 ctx.fetch=async url=>url.endsWith('/ck/subscription/status')?{ok:true,json:async()=>({ready,message:'订阅未登录'})}:original(url);
 await ctx.ckSaveBackendRoute();assert.equal(ctx.reloaded,undefined);assert.equal(storage.has('ckBackendRouteV1'),false);
 assert.match(els['ck-backend-status'].textContent,/订阅未登录/);
 ready=true;await ctx.ckSaveBackendRoute();
 const saved=JSON.parse(storage.get('ckBackendRouteV1'));assert.equal(saved.execution,'claude_code_subscription');assert.equal(saved.subscriptionModel,'opus');
 const next=fixture(saved).ctx.CKBackendRoute;assert.equal(next.isSubscription(),true);assert.equal(next.subscriptionRoute().upstreamKey,'');assert.equal(next.subscriptionRoute().model,'opus');
 assert.equal(next.subscriptionRoute().apiBase,'');
 assert.throws(()=>next.parse({...saved,execution:'not-a-route'}));
});
