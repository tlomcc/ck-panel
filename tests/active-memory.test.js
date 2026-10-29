const {test}=require('node:test');
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(require.resolve('../active-memory.js'),'utf8');
const plain=value=>JSON.parse(JSON.stringify(value));
function setup(){
  const elements=new Map(),timers=new Map(),calls=[];let seq=0;
  const cfg={url:'https://fixture.invalid/ck/chat',panelKey:'fixture-a'};
  const c={console,AbortController,Date,Promise,Map,Array,Object,String,Number,JSON,
    currentPanelTab:'chat',chatLoadConfig:()=>cfg,chatEndpoint:v=>v.url,
    document:{getElementById(id){if(!elements.has(id))elements.set(id,{value:'',textContent:'',disabled:false,hidden:false});return elements.get(id)}},
    setTimeout(fn,ms){const id=++seq;timers.set(id,{fn,ms});return id},clearTimeout:id=>timers.delete(id),
    fetch:async(url,options)=>{calls.push({url,options});throw Error('missing fixture')}};
  vm.createContext(c);vm.runInContext(source,c);
  const data=(content='',revision=0,extra={})=>Object.assign({ok:true,content,revision,chars:Array.from(content).length,limit:5000,enabled:true,writable:true,stale:false,updated_at:0},extra);
  const response=(value,status=200)=>({ok:status>=200&&status<300,status,json:async()=>value});
  return {c,cfg,elements,calls,timers,data,response};
}
test('saved memory is selectable but readonly and HTML is inert',async()=>{
  const {c,elements,data,response}=setup();c.fetch=async()=>response(data('我记得🙂 <img onerror=fixture>'));
  await c.ckActiveMemoryRefresh();
  const box=elements.get('ck-active-memory-content');
  assert.equal(box.value,'我记得🙂 <img onerror=fixture>');
  assert.equal(box.readOnly,true);assert.equal(box.disabled,false);
  assert.equal(elements.get('ck-active-memory-count').textContent,Array.from(box.value).length+' / 5000 字');
  for(const name of ['save','merge','load']){assert.equal(elements.get('ck-active-memory-'+name).hidden,true);assert.equal(elements.get('ck-active-memory-'+name).disabled,true)}
});
test('manual save and forged save action make no network request',async()=>{
  const {c,elements,data,response}=setup();let requests=0;
  c.fetch=async()=>{requests++;return response(data('小克的原记忆',1))};await c.ckActiveMemoryRefresh();
  elements.get('ck-active-memory-content').value='手动内容';c.ckActiveMemoryInput();
  assert.equal(elements.get('ck-active-memory-content').value,'小克的原记忆');
  assert.equal(c.ckActiveMemorySave(),false);
  assert.equal(await c.ckActiveMemoryRefresh('save',{revision:1,content:'手动内容'}),false);
  assert.equal(requests,1);assert.equal(c.ckActiveMemoryData.content,'小克的原记忆');
});
test('a model update replaces the readonly view on refresh',async()=>{
  const {c,elements,data,response}=setup();let latest=data('原记忆',1);
  c.fetch=async()=>response(latest);await c.ckActiveMemoryRefresh();
  latest=data('小克更新后的记忆',2);await c.ckActiveMemoryRefresh();
  assert.equal(elements.get('ck-active-memory-content').value,latest.content);
  assert.equal(c.ckActiveMemoryData.revision,2);assert.equal(elements.get('ck-active-memory-content').readOnly,true);
});
test('pause sends only the control and revision, never editable content',async()=>{
  const {c,data,response,calls}=setup();c.fetch=async()=>response(data('重要记忆',1));await c.ckActiveMemoryRefresh();
  c.fetch=async(url,options)=>{calls.push({url,options});return response(data('重要记忆',2,{enabled:false}))};
  await c.ckActiveMemoryRefresh('pause',{revision:1,content:'意外内容',origin:'model'});
  assert.deepEqual(JSON.parse(calls[0].options.body),{action:'pause',revision:1});
  assert.equal(c.ckActiveMemoryData.content,'重要记忆');
});
test('a conflicting control rereads the latest model document without replay',async()=>{
  const {c,elements,data,response}=setup();c.fetch=async()=>response(data('原记忆',1));await c.ckActiveMemoryRefresh();
  let post=0,get=0;
  c.fetch=async(_,options)=>{if(options.method==='POST'){post++;return response({ok:false,error:'版本已更新'},409)}get++;return response(data('小克的新记忆',2))};
  assert.equal(await c.ckActiveMemoryToggle(),false);assert.equal(post,1);assert.equal(get,1);
  assert.equal(elements.get('ck-active-memory-content').value,'小克的新记忆');
});
test('switching principal never displays an old pending response',async()=>{
  const {c,cfg,elements,data,response}=setup();let resolve;
  c.fetch=()=>new Promise(r=>resolve=r);const old=c.ckActiveMemoryRefresh();cfg.panelKey='fixture-b';
  c.fetch=async()=>response(data('新身份的记忆',3));resolve(response(data('旧身份的记忆',2)));await old;await new Promise(r=>setImmediate(r));
  assert.equal(elements.get('ck-active-memory-content').value,'新身份的记忆');
  assert.equal(c.ckActiveMemoryPrincipal,cfg.url+'|fixture-b');
});
test('paused and offline memory stay readable with unavailable controls disabled',async()=>{
  const {c,elements,data,response}=setup();c.fetch=async()=>response(data('暂停后仍然记得',2,{enabled:false}));await c.ckActiveMemoryRefresh();
  assert.match(elements.get('ck-active-memory-toggle').textContent,/恢复/);
  c.fetch=async()=>response(data('已知版本',2,{stale:true,writable:false}));await c.ckActiveMemoryRefresh();
  assert.equal(elements.get('ck-active-memory-content').value,'已知版本');
  assert.equal(elements.get('ck-active-memory-toggle').disabled,true);
});
test('a failed refresh preserves saved memory and releases the request lock',async()=>{
  const {c,elements,data,response}=setup();c.fetch=async()=>response(data('成功旧版本',4));await c.ckActiveMemoryRefresh();
  c.fetch=async()=>{throw Error('fixture unavailable')};
  assert.equal(await c.ckActiveMemoryRefresh(),false);assert.equal(c.ckActiveMemoryData.content,'成功旧版本');
  assert.equal(elements.get('ck-active-memory-content').value,'成功旧版本');assert.equal(c.ckActiveMemoryBusy,false);
});
