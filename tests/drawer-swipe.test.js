const fs=require('fs'),path=require('path'),http=require('http'),assert=require('assert');
const {spawn}=require('child_process');
const root=path.resolve(__dirname,'..'),out=path.resolve(__dirname,'../../0-工作间/v265-settings-merge/drawer');
fs.mkdirSync(out,{recursive:true});
const chrome='C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const pause=ms=>new Promise(r=>setTimeout(r,ms));
const server=http.createServer((req,res)=>{
  const name=decodeURIComponent(new URL(req.url,'http://localhost').pathname).replace(/^\//,'')||'index.html';
  const file=path.resolve(root,name);if(!file.startsWith(root+path.sep)){res.writeHead(403);return res.end()}
  if(!fs.existsSync(file)){res.writeHead(404);return res.end()}
  let data=fs.readFileSync(file);
  if(name==='index.html')data=Buffer.from(data.toString().replace(/<script src="(?:pwa|script-extra)\.js[^>]+><\/script>/g,''));
  if(name==='script.js')data=Buffer.from(data.toString().replace(/^init\(\);\s*$/m,''));
  res.setHeader('Content-Type',name.endsWith('.js')?'text/javascript':name.endsWith('.css')?'text/css':name.endsWith('.svg')?'image/svg+xml':name.endsWith('.png')?'image/png':'text/html');res.end(data);
});
(async()=>{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const base='http://127.0.0.1:'+server.address().port;
 const profile=path.join(out,'profile-'+Date.now());
 const browser=spawn(chrome,['--headless=new','--disable-gpu','--no-sandbox','--hide-scrollbars','--no-first-run','--no-default-browser-check','--remote-debugging-port=0','--user-data-dir='+profile,'about:blank'],{stdio:'ignore',windowsHide:true});
 let socket;
 try{
  const portFile=path.join(profile,'DevToolsActivePort');let port;
  for(let i=0;i<150;i++){try{port=fs.readFileSync(portFile,'utf8').split('\n')[0];if(port)break}catch(e){if(!['ENOENT','EBUSY','EPERM'].includes(e.code))throw e}await pause(50)}
  if(!port)throw Error('Chrome debugging port unavailable');
  const targets=await(await fetch('http://127.0.0.1:'+port+'/json/list')).json();
  socket=new WebSocket(targets.find(x=>x.type==='page').webSocketDebuggerUrl);
  await new Promise((r,j)=>{socket.onopen=r;socket.onerror=j});let id=0;const pending=new Map();
  socket.onmessage=e=>{const x=JSON.parse(e.data),p=pending.get(x.id);if(p){pending.delete(x.id);x.error?p.reject(x.error):p.resolve(x.result)}};
  const send=(method,params={})=>new Promise((resolve,reject)=>{const i=++id;pending.set(i,{resolve,reject});socket.send(JSON.stringify({id:i,method,params}))});
  const evaluate=async expression=>{const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw new Error(r.exceptionDetails.exception?.description||JSON.stringify(r.exceptionDetails));return r.result.value};
  const shot=async name=>{const x=await send('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(out,name+'.png'),Buffer.from(x.data,'base64'))};
  await send('Page.enable');

  await send('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:2});
  const touch=async(type,x,y)=>send('Input.dispatchTouchEvent',{type,touchPoints:x===undefined?[]:[{x,y,id:1,radiusX:2,radiusY:2}]});
  const state=()=>evaluate('drawerState()');
  const settle=()=>pause(240);
  for(const [width,dark,fallback] of [[320,false,false],[390,false,false],[1280,true,false],[390,true,true]]){
    await send('Emulation.setDeviceMetricsOverride',{width,height:850,deviceScaleFactor:1,mobile:width<600});
    await send('Page.navigate',{url:base+'/index.html'});
    for(let i=0;i<100;i++){if(await evaluate(`typeof chatRenderMessages==='function'&&typeof CKChatHistory==='object'`))break;await pause(40)}
    await evaluate(`document.body.classList.toggle('dark',${dark})`);
    if(fallback)await evaluate('window.PointerEvent=undefined');
    await evaluate(fs.readFileSync(path.join(__dirname,'fixtures/drawer-swipe.js'),'utf8'));await settle();
    const initial=await state(),x=initial.left+initial.width-40,y=310;
    // Real touch input must move the drawer before the finger is released.
    await touch('touchStart',x,y);await pause(40);await touch('touchMove',x-65,y+2);await pause(40);
    const during=await state();assert(during.open&&Math.abs(during.left-(initial.left-65))<3,'Drawer does not follow finger: '+JSON.stringify(during));
    assert(during.opacity<1&&during.opacity>0,'Mask did not fade with drag');
    await shot(width+'-'+dark+'-dragging');
    await touch('touchMove',x-140,y);await touch('touchEnd');await settle();
    let result=await state();assert(!result.open&&result.inert&&result.hidden==='true'&&!result.transform,'Dismiss did not clean up');
    // Reopen, then hold a short drag: it must bounce back, not accidentally choose a session.
    await evaluate('chatToggleSessions(true)');await settle();
    await touch('touchStart',x,y);await pause(60);await touch('touchMove',x-25,y);await pause(160);await touch('touchEnd');await settle();
    result=await state();assert(result.open&&Math.abs(result.left-initial.left)<1,'Short drag did not rebound');
    assert(await evaluate("chatActiveSessionId==='drawer-0'"),'Dragging selected a session');
    // A brief, fast left flick dismisses; a rightward gesture leaves it open.
    await touch('touchStart',x,120);await touch('touchMove',x-12,120);await pause(20);await touch('touchMove',x-80,120);await touch('touchEnd');await settle();
    assert(!(await state()).open,'Quick left flick did not dismiss '+JSON.stringify(await state()));
    await evaluate('chatToggleSessions(true)');await settle();
    await touch('touchStart',x-110,120);await touch('touchMove',x-30,120);await touch('touchEnd');await settle();
    assert((await state()).open&&!(await state()).transform,'Rightward gesture dismissed drawer');
    // Vertical movement must retain native list scrolling.
    await touch('touchStart',x,600);await touch('touchMove',x-2,545);await touch('touchMove',x-3,440);await touch('touchEnd');await settle();
    result=await state();assert(result.open&&result.scroll>0&&Math.abs(result.left-initial.left)<1,'List scroll interfered with drawer');
    // Cancellation restores the drawer, including after a closing-distance drag.
    await touch('touchStart',x,120);await touch('touchMove',x-140,120);await touch('touchCancel');await settle();
    result=await state();assert(result.open&&!result.transform,'Cancelled touch closed or stranded drawer');
    // Search text editing never starts a drawer drag.
    const input=await evaluate("(()=>{const r=document.getElementById('chat-session-search').getBoundingClientRect();return {x:r.x+r.width-30,y:r.y+r.height/2}})()");
    await touch('touchStart',input.x,input.y);await touch('touchMove',input.x-100,input.y);await touch('touchEnd');await settle();
    assert((await state()).open&&!(await state()).transform,'Search editing moved drawer');
    await evaluate('document.activeElement.blur()');
    // External close/reopen during a drag must not let stale pointer events close a fresh drawer.
    await touch('touchStart',x,120);await touch('touchMove',x-90,120);
    await evaluate('chatToggleSessions(false);chatToggleSessions(true)');await touch('touchEnd');await settle();
    assert((await state()).open&&!(await state()).transform,'Stale gesture closed reopened drawer');
    await pause(420);
    await evaluate("document.querySelector('.chat-session-more').click()");
    assert(await evaluate("document.getElementById('ckActionModal').classList.contains('show')"),'Session action tap stopped working');
    await evaluate('ckDialogCancel()');
    await shot(width+'-'+dark+'-restored');
    // Tap search, then real blank space at the bottom of a short list.
    await touch('touchStart',input.x,input.y);await touch('touchEnd');await settle();
    assert((await state()).open,'Search tap dismissed drawer');
    await evaluate('document.activeElement.blur();chatSessions=chatSessions.slice(0,1);chatRenderSessions()');
    const blank=await evaluate("(()=>{const r=document.getElementById('chat-session-list').getBoundingClientRect();const x=r.x+r.width/2,y=r.bottom-30;return {x,y,blank:document.elementFromPoint(x,y).id==='chat-session-list'}})()");
    assert(blank.blank,'Fixture must tap actual blank list space');
    await touch('touchStart',blank.x,blank.y);await touch('touchEnd');await settle();
    assert(!(await state()).open&&(await state()).inert,'Blank list tap did not dismiss');
    await evaluate('chatToggleSessions(true)');await settle();
    await send('Input.dispatchMouseEvent',{type:'mousePressed',x:blank.x,y:blank.y,button:'left',clickCount:1});
    await send('Input.dispatchMouseEvent',{type:'mouseReleased',x:blank.x,y:blank.y,button:'left',clickCount:1});await settle();
    assert(!(await state()).open,'Blank list mouse click did not dismiss');
    console.log(JSON.stringify({width,dark,fallback,tracking:true,dismiss:true,rebound:true,flick:true,verticalScroll:true,cancel:true,search:true,reopen:true,menu:true,blankTap:true,blankMouse:true}));
  }

  await Promise.race([send('Browser.close'),pause(500)]);
 }finally{socket?.close();browser.kill();server.close()}
})().catch(e=>{console.error(e);process.exitCode=1;server.close()});
