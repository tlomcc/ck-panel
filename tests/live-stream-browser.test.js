const fs=require('fs'),path=require('path'),http=require('http'),assert=require('assert');
const {spawn}=require('child_process');
const root=path.resolve(__dirname,'..'),out=path.resolve(__dirname,'../../0-工作间/v260-live-stream-browser');
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
  for(const [width,dark] of [[320,false],[390,false],[1280,false],[390,true],[1280,true]]){
    await send('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:width<600});
    await send('Page.navigate',{url:base+'/index.html'});
    for(let i=0;i<100;i++){if(await evaluate(`typeof chatRenderMessages==='function'&&typeof CKChatHistory==='object'`))break;await pause(40)}
    await evaluate(`document.body.classList.toggle('dark',${dark})`);await shot(width+'-'+dark+'-startup');
    await evaluate('window.__streamSource='+JSON.stringify(fs.readFileSync(path.join(root,'script.js'),'utf8')));
    const result=await evaluate(fs.readFileSync(path.join(__dirname,'fixtures/live-stream.js'),'utf8'));
    console.log(width+' '+dark,JSON.stringify(result));
    await pause(400);
    await shot(width+'-'+dark+'-stream');
  }

  // Chrome may close the socket before acknowledging Browser.close.
  await Promise.race([send('Browser.close'),pause(500)]);
 }finally{socket?.close();browser.kill();server.close()}
})().catch(e=>{console.error(e);process.exitCode=1;server.close()});
