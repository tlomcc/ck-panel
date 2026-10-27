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
test('a saved document is displayed as text, with Unicode counts and no HTML execution',async()=>{
  const {c,elements,data,response}=setup();c.fetch=async()=>response(data('我记得🙂 <img onerror=fixture>'));
  await c.ckActiveMemoryRefresh();
  assert.equal(elements.get('ck-active-memory-content').value,'我记得🙂 <img onerror=fixture>');
  assert.equal(elements.get('ck-active-memory-saved').textContent,'我记得🙂 <img onerror=fixture>');
  assert.equal(elements.get('ck-active-memory-count').textContent,Array.from('我记得🙂 <img onerror=fixture>').length+' / 5000 字');
  assert.equal(elements.get('ck-active-memory-save').disabled,true);
});
test('manual save sends one bounded revision and keeps edits made while saving',async()=>{
  const {c,elements,data,response,calls}=setup();c.fetch=async()=>response(data('旧记忆',1));await c.ckActiveMemoryRefresh();
  elements.get('ck-active-memory-content').value='本次提交的记忆';c.ckActiveMemoryInput();
  let release;c.fetch=(url,options)=>{calls.push({url,options});return new Promise(r=>release=()=>r(response(data('本次提交的记忆',2))))};
  const saving=c.ckActiveMemorySave();elements.get('ck-active-memory-content').value='保存期间继续编辑';c.ckActiveMemoryInput();release();await saving;
  assert.deepEqual(JSON.parse(calls[0].options.body),{action:'save',revision:1,content:'本次提交的记忆'});
  assert.equal(elements.get('ck-active-memory-content').value,'保存期间继续编辑');
  assert.equal(c.ckActiveMemoryData.content,'本次提交的记忆');assert.equal(c.ckActiveMemoryDraft().revision,2);
  assert.equal(elements.get('ck-active-memory-save').disabled,false);
  assert.match(elements.get('ck-active-memory-state').textContent,/下次聊天直接带入/);
});
test('another window update does not overwrite a dirty draft or allow a stale save',async()=>{
  const {c,elements,data,response}=setup();let latest=data('原记忆',1);c.fetch=async()=>response(latest);await c.ckActiveMemoryRefresh();
  elements.get('ck-active-memory-content').value='本地草稿';c.ckActiveMemoryInput();latest=data('小克已更新的记忆',2);await c.ckActiveMemoryRefresh();
  assert.equal(elements.get('ck-active-memory-content').value,'本地草稿');assert.equal(elements.get('ck-active-memory-save').disabled,true);
  assert.match(elements.get('ck-active-memory-state').textContent,/草稿已保留/);
  assert.equal(elements.get('ck-active-memory-saved').textContent,'小克已更新的记忆');
  c.ckActiveMemoryMerge();assert.equal(elements.get('ck-active-memory-content').value,'本地草稿');assert.equal(c.ckActiveMemoryDraft().revision,2);
});
test('a 409 rereads the saved document and preserves the rejected draft',async()=>{
  const {c,elements,data,response}=setup();c.fetch=async()=>response(data('原记忆',1));await c.ckActiveMemoryRefresh();
  elements.get('ck-active-memory-content').value='过时草稿';c.ckActiveMemoryInput();let post=0,get=0;
  c.fetch=async(_,options)=>{if(options.method==='POST'){post++;return response({ok:false,error:'版本已更新'},409)}get++;return response(data('另一窗口的新版',2))};
  assert.equal(await c.ckActiveMemorySave(),false);assert.equal(post,1);assert.equal(get,1);
  assert.equal(elements.get('ck-active-memory-content').value,'过时草稿');assert.equal(c.ckActiveMemoryData.content,'另一窗口的新版');
  assert.equal(elements.get('ck-active-memory-save').disabled,true);
});
test('switching principal never displays an old pending response or shares drafts',async()=>{
  const {c,cfg,elements,data,response}=setup();let resolve;
  c.fetch=()=>new Promise(r=>resolve=r);const old=c.ckActiveMemoryRefresh();cfg.panelKey='fixture-b';
  c.fetch=async()=>response(data('新身份的记忆',3));resolve(response(data('旧身份的记忆',2)));await old;await new Promise(r=>setImmediate(r));
  assert.equal(elements.get('ck-active-memory-content').value,'新身份的记忆');
  assert.equal(c.ckActiveMemoryPrincipal,cfg.url+'|fixture-b');
  assert(!elements.get('ck-active-memory-state').textContent.includes('旧身份'));
});
test('pause keeps the full document available, and offline data cannot be saved',async()=>{
  const {c,elements,data,response}=setup();c.fetch=async()=>response(data('暂停后仍然记得',2,{enabled:false}));await c.ckActiveMemoryRefresh();
  assert.equal(elements.get('ck-active-memory-content').value,'暂停后仍然记得');assert.match(elements.get('ck-active-memory-toggle').textContent,/恢复/);
  c.fetch=async()=>response(data('已知版本',2,{stale:true,writable:false}));await c.ckActiveMemoryRefresh();
  elements.get('ck-active-memory-content').value='离线草稿';c.ckActiveMemoryInput();
  assert.equal(elements.get('ck-active-memory-save').disabled,true);assert.equal(elements.get('ck-active-memory-toggle').disabled,true);
});
test('a failed save retains both the stored document and editable draft',async()=>{
  const {c,elements,data,response}=setup();c.fetch=async()=>response(data('成功旧版本',4));await c.ckActiveMemoryRefresh();
  elements.get('ck-active-memory-content').value='尚未保存的草稿';c.ckActiveMemoryInput();c.fetch=async()=>{throw Error('fixture unavailable')};
  assert.equal(await c.ckActiveMemorySave(),false);assert.equal(c.ckActiveMemoryData.content,'成功旧版本');
  assert.equal(elements.get('ck-active-memory-content').value,'尚未保存的草稿');assert.equal(c.ckActiveMemoryBusy,false);
});
