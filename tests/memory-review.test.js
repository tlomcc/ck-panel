const fs=require('fs'),path=require('path'),http=require('http'),assert=require('node:assert/strict');
const {spawn}=require('child_process');
const root=path.resolve(__dirname,'..'),out=path.resolve(root,'../0-工作间/v274-topic-feedback/browser');
fs.mkdirSync(out,{recursive:true});
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
 const base='http://127.0.0.1:'+server.address().port,profile=path.join(out,'profile-'+Date.now());
 const browser=spawn('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',['--headless=new','--disable-gpu','--no-sandbox','--hide-scrollbars','--no-first-run','--no-default-browser-check','--remote-debugging-port=0','--user-data-dir='+profile,'about:blank'],{stdio:'ignore',windowsHide:true});
 let socket;
 try{
  let port;
  for(let i=0;i<180;i++){try{port=fs.readFileSync(path.join(profile,'DevToolsActivePort'),'utf8').split('\n')[0];if(port)break}catch(e){if(!['ENOENT','EBUSY','EPERM'].includes(e.code))throw e}await pause(50)}
  if(!port)throw Error('Chrome debugging port unavailable');
  const targets=await(await fetch('http://127.0.0.1:'+port+'/json/list')).json();
  socket=new WebSocket(targets.find(x=>x.type==='page').webSocketDebuggerUrl);await new Promise((r,j)=>{socket.onopen=r;socket.onerror=j});
  let id=0;const pending=new Map();
  socket.onmessage=e=>{const x=JSON.parse(e.data),p=pending.get(x.id);if(p){pending.delete(x.id);x.error?p.reject(x.error):p.resolve(x.result)}};
  const send=(method,params={})=>new Promise((resolve,reject)=>{const i=++id;pending.set(i,{resolve,reject});socket.send(JSON.stringify({id:i,method,params}))});
  const evaluate=async expression=>{const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description||JSON.stringify(r.exceptionDetails));return r.result.value};
  const shot=async name=>{const x=await send('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(out,name+'.png'),Buffer.from(x.data,'base64'))};
  await send('Page.enable');
  await send('Network.enable');
  await send('Network.setBlockedURLs',{urls:['https://*','http://*.invalid/*']});
  for(const [width,dark] of [[320,false],[390,false],[1280,false],[390,true],[1280,true]]){
   await send('Emulation.setDeviceMetricsOverride',{width,height:950,deviceScaleFactor:1,mobile:width<600});
   await send('Page.navigate',{url:base+'/index.html'});
   for(let i=0;i<100;i++){if(await evaluate("typeof memoryWorkbenchEnter==='function'"))break;await pause(40)}
   await evaluate(`document.body.classList.toggle('dark',${dark})`);
   try{console.log(width,dark,await evaluate(fs.readFileSync(path.join(__dirname,'fixtures/memory-review.js'),'utf8')))}
   catch(e){await shot('failure-'+width+'-'+dark);throw e}
   for(const destination of ['topics']){
    await evaluate(destination==='topic-api'?"navTo('apiconfig');switchApiTab('topics')":destination==='recall'?"navTo('apiconfig');switchApiTab('recall')":`navTo('${destination}')`);
    await pause(80);
    const geometry=await evaluate(`({width:document.documentElement.clientWidth,scroll:document.documentElement.scrollWidth,duplicates:(()=>{const ids=[...document.querySelectorAll('[id]')].map(e=>e.id);return ids.length-new Set(ids).size})()})`);
    assert(geometry.scroll<=geometry.width+1,JSON.stringify({destination,width,...geometry}));assert.equal(geometry.duplicates,0);
    await shot(destination+'-'+width+'-'+dark);
    await evaluate("document.querySelector('[data-proposal]').scrollIntoView({block:'start'});document.querySelector('.mr-reference').open=true");
    await pause(80);
    await shot('approval-'+width+'-'+dark);
   }
  }
  await Promise.race([send('Browser.close'),pause(500)]);
 }finally{socket?.close();browser.kill();server.close();await pause(150)}
})().catch(e=>{console.error(e);process.exitCode=1;server.close()});
