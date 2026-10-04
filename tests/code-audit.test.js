const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('fs'),path=require('path'),vm=require('vm');
const root=path.resolve(__dirname,'..');
const source=fs.readFileSync(path.join(root,'script.js'),'utf8').replace(/\r\n/g,'\n');
function extract(name){
  let start=source.indexOf('function '+name+'(');
  assert(start>=0,name);
  if(source.slice(start-6,start)==='async ')start-=6;
  let depth=0;
  for(let i=source.indexOf('{',start);i<source.length;i++){
    if(source[i]==='{')depth++;
    if(source[i]==='}'&&--depth===0)return source.slice(start,i+1);
  }
  throw Error('Unclosed function '+name);
}
function load(context,names){vm.createContext(context);for(const name of names)vm.runInContext(extract(name),context);return context;}
const noop=()=>{};
const clone=x=>JSON.parse(JSON.stringify(x));

test('zero and negative retention safely remove whole local and tool turns',()=>{
  const h=require('../chat-history.js');
  const messages=[{role:'user',text:'question',content:'question'},
    {role:'assistant',text:'answer',content:[{type:'tool_use',id:'t',name:'tool',input:{}}]},
    {role:'user',content:[{type:'tool_result',tool_use_id:'t',content:'result'}]},
    {role:'assistant',text:'final',content:'final'}];
  for(const method of ['trimLocalTurns','trimTransportTurns'])for(const keep of [0,-1]){
    const result=h[method](messages,keep);
    assert.deepEqual(result.keptMessages,[]);
    assert.deepEqual(result.droppedMessages,messages);
    assert.deepEqual(h[method]([],keep).keptMessages,[]);
  }
});

test('worldbook refresh preserves concurrent edits and account changes; migration failures surface',async()=>{
  let cfg={panelKey:'one',worldbooks:[{id:'book',name:'original'}]},resolveFetch,saved=0;
  const c=load({chatLoadConfig:()=>clone(cfg),chatNormalizeWorldbooks:x=>x||[],
    chatWorldbooksEndpoint:x=>'/books?key='+x.panelKey,
    panelDataFetch:()=>new Promise(r=>resolveFetch=r),
    chatSaveConfigObject:x=>{cfg=x;saved++},chatRenderWorldbooks:noop,chatUpdateRuntime:noop,toast:noop,
    chatSaveWorldbooksRemote:async()=>false},['chatLoadWorldbooksRemote']);
  const response=books=>({ok:true,json:async()=>({ok:true,worldbooks:books})});
  let pending=c.chatLoadWorldbooksRemote(true);cfg.worldbooks[0].name='edited';resolveFetch(response([{id:'book',name:'old remote'}]));
  assert.equal(await pending,false);assert.equal(cfg.worldbooks[0].name,'edited');assert.equal(saved,0);
  pending=c.chatLoadWorldbooksRemote(true);cfg.panelKey='two';resolveFetch(response([]));assert.equal(await pending,false);assert.equal(saved,0);
  pending=c.chatLoadWorldbooksRemote(true);resolveFetch(response([]));assert.equal(await pending,false,'failed upload must not report migration success');
  pending=c.chatLoadWorldbooksRemote(true);resolveFetch({ok:true,json:async()=>({})});assert.equal(await pending,false);assert.equal(saved,0);
  pending=c.chatLoadWorldbooksRemote(true);resolveFetch(response([{id:'book',name:'new remote'}]));assert.equal(await pending,true);assert.equal(cfg.worldbooks[0].name,'new remote');
});

test('SSE callback exceptions propagate exactly once; text fallback remains supported',()=>{
  const c=load({},['chatParseSse']);let calls=0;
  assert.throws(()=>c.chatParseSse('event: delta\ndata: {"text":"hello"}\n\n',()=>{calls++;throw Error('render failure')}),/render failure/);
  assert.equal(calls,1);
  const events=[];c.chatParseSse('event: delta\ndata: plain text\n\n',(...args)=>events.push(args));
  assert.deepEqual(events,[['delta','plain text']]);
});

function streamContext(){
  const c=load({TextDecoder,Date,console,latencyTrace:{},requestState:{},assistantText:'',nativeThinkingText:'',toolEvents:[],
    markFirstReplyTs:noop,recordFirstDeltaLatency:noop,chatStreamProgressSet:noop,chatDebug:noop,
    chatApplyPollingLiveState:noop,chatStoreSessionRecall:noop,chatPollingLiveState:null,
    chatCurrentSession:()=>({}),chatScheduleSessionSave:noop,timeReminderContext:{round:1},chatSetStatus:noop,cfg:{},responseUserTs:1,requestTurnId:'turn',recallInfo:null,
    CHAT_PLATFORM_EXIT_ERROR:'Function process exited',chatUpsertToolEvent:(old,data)=>old.concat(data),scheduleStreamRender:noop,
    trackThinking:noop,finishThinking:noop,chatStreamProgressStop:noop,
    streamFinalMetadata:false,streamMetadataReceivedAt:0,streamForceText:false},
    ['chatParseSse','chatContainsPlatformExitError','chatCreateRequestFailure','chatMarkNetworkFailure']);
  const marker='},async function(resp,attemptState){';
  const start=source.indexOf(marker)+2,end=source.indexOf('\n    });\n    if(requestState&&requestState.stopped)return;',start);
  assert(start>1&&end>start);
  vm.runInContext('consume=('+source.slice(start,end+6)+')',c);
  return c;
}
function responseFor(events){
  let read=false,cancelled=0,released=0;
  const reader={read:async()=>read?{done:true}:(read=true,{done:false,value:new TextEncoder().encode(events)}),
    cancel:async()=>cancelled++,releaseLock:()=>released++};
  return {body:{getReader:()=>reader},counts:()=>({cancelled,released})};
}
test('stream EOF without completion fails, cancels the reader and never retries started output',async()=>{
  for(const data of ['event: meta\ndata: {}\n\n','event: delta\ndata: {"text":"partial"}\n\n']){
    const c=streamContext(),resp=responseFor(data),state={receivedValidContent:false};
    await assert.rejects(c.consume(resp,state),/提前中断/);
    assert.equal(state.receivedValidContent,true);assert.deepEqual(resp.counts(),{cancelled:1,released:1});
  }
});
test('complete SSE succeeds, empty completion fails, buffered SSE is parsed as events',async()=>{
  const data='event: delta\ndata: {"text":"answer"}\n\nevent: done\ndata: {}\n\n';
  let c=streamContext(),resp=responseFor(data);await c.consume(resp,{});assert.equal(c.assistantText,'answer');assert.equal(resp.counts().released,1);
  c=streamContext();await assert.rejects(c.consume(responseFor('event: done\ndata: {}\n\n'),{}),/空回复/);
  c=streamContext();await c.consume({body:null,headers:new Headers({'Content-Type':'text/event-stream'}),text:async()=>data},{});assert.equal(c.assistantText,'answer');
});

test('forced update leaves ancestor and sibling apps and their caches intact',async()=>{
  const removed=[],deleted=[];
  const c=load({URL,window:{location:{pathname:'/ck-panel/index.html'},caches:{}},navigator:{serviceWorker:{getRegistrations:async()=>
    ['/','/ck-panel/','/ck-panel/child/','/another/'].map(scope=>({scope:'https://example.test'+scope,unregister:async()=>removed.push(scope)}))}},
    caches:{keys:async()=>['ck-panel-shell-old','another-ck-panel-cache','other'],delete:async key=>deleted.push(key)}},['ckPanelClearUpdateCaches']);
  await c.ckPanelClearUpdateCaches();assert.deepEqual(removed,['/ck-panel/']);assert.deepEqual(deleted,['ck-panel-shell-old']);
});

test('service worker preserves other caches, last good page and successful responses under quota failure',async()=>{
  const handlers={},deleted=[],writes=[];let failPut=false,network=async()=>new Response('bad',{status:503});
  const cache={match:async()=>new Response('last good page',{headers:{'Content-Type':'text/html'}}),put:async(...args)=>{if(failPut)throw Error('quota');writes.push(args)}};
  const c={URL,Response,self:{location:{origin:'https://example.test',href:'https://example.test/ck-panel/sw.js'},
    addEventListener:(ev,fn)=>handlers[ev]=fn,clients:{claim:async()=>{}},skipWaiting:async()=>{}},
    caches:{open:async()=>cache,keys:async()=>['other-app','ck-panel-shell-old'],delete:async k=>deleted.push(k)},fetch:(...args)=>network(...args)};
  vm.runInNewContext(fs.readFileSync(path.join(root,'sw.js'),'utf8'),c);
  let lifetime;handlers.activate({waitUntil:p=>lifetime=p});await lifetime;assert.deepEqual(deleted,['ck-panel-shell-old']);
  const request={method:'GET',url:'https://example.test/ck-panel/',mode:'navigate'};
  let promise;handlers.fetch({request,respondWith:p=>promise=p});assert.equal(await(await promise).text(),'last good page');assert.equal(writes.length,0);
  failPut=true;network=async()=>new Response('fresh page',{headers:{'Content-Type':'text/html'}});
  handlers.fetch({request,respondWith:p=>promise=p});assert.equal(await(await promise).text(),'fresh page');
  handlers.fetch({request:{...request,url:'https://example.test/other-app/'},respondWith:()=>assert.fail('other app intercepted')});
  cache.match=async()=>undefined;network=async()=>{throw Error('offline')};handlers.fetch({request,respondWith:p=>promise=p});assert.equal((await promise).type,'error');
});
