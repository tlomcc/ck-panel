/* Additional isolated fixtures for the short game window. Never reaches a model. */
var fixtureRoute=JSON.parse(localStorage.getItem('ckBackendRouteV1'));
fixtureRoute.subscriptionModel='claude-opus-4-6';localStorage.setItem('ckBackendRouteV1',JSON.stringify(fixtureRoute));
var fixtureConfig=JSON.parse(localStorage.getItem('ckChatConfigV2'));
Object.assign(fixtureConfig,{thinkingPrompt:'保留小克原来的思考词。',thinkingPromptEnabled:true,thinkingMode:'adaptive',thinkingEffort:'medium',fakeThinking:false});
localStorage.setItem('ckChatConfigV2',JSON.stringify(fixtureConfig));
window.__fixtureWakeStates=JSON.parse(sessionStorage.getItem('__fixtureWakeStates')||'{}');
var fixtureBaseFetch=window.fetch;
window.fetch=async function(input,options){
  var url=new URL(typeof input==='string'?input:input.url,location.href),opts=options||{};
  if(url.pathname.endsWith('/wake')){
    var body=opts.body?JSON.parse(opts.body):null,sid=body?body.session_id:url.searchParams.get('session_id');
    __fixtureRequests.push({path:url.pathname,method:opts.method||'GET',body:body,origin:url.origin});
    var s=__fixtureWakeStates[sid]||{ok:true,enabled:!sid.startsWith('ck-game-'),status:sid.startsWith('ck-game-')?'off':'scheduled',mode:'1h',interval_seconds:3000,idle_shutdown_enabled:true,idle_shutdown_minutes:180,next_at:Date.now()/1000+3000};
    if(body){Object.assign(s,body);delete s.key;s.status=s.enabled?'waiting_chat':'off';__fixtureWakeStates[sid]=s;sessionStorage.setItem('__fixtureWakeStates',JSON.stringify(__fixtureWakeStates))}
    return fixtureJson(s);
  }
  return fixtureBaseFetch(input,options);
};
