// Real DOM checks: destinations, scope, saving and mobile overflow.
const fs=require('fs'),path=require('path'),assert=require('assert');
const {spawn}=require('child_process');
const root=path.resolve(__dirname,'..');

// Exercise the production request boundary for every mode and effort.
const vm=require('vm');
const script=fs.readFileSync(path.join(root,'script.js'),'utf8');
const normalize=script.slice(script.indexOf('function chatNormalizeThinkingEffort('),script.indexOf('\n}',script.indexOf('function chatNormalizeThinkingEffort('))+2);
const boundary=script.slice(script.indexOf("  if(thinkingMode!=='off')body.thinking_mode=thinkingMode;"),script.indexOf('  // 轮询只发开关和配置修订。'));
for(const mode of ['off','compat','native','adaptive'])for(const effort of ['low','medium','high','max']){
 const ctx={body:{},cfg:{thinkingEffort:effort},thinkingMode:mode,thinkingBudgetTokens:8192,chatActiveThinkingPrompt:()=> 'shared prompt'};
 vm.runInNewContext(normalize+'\n'+boundary,ctx);
 assert.equal(ctx.body.thinking_effort,mode==='adaptive'?effort:undefined);
 assert.equal(ctx.body.thinking_budget_tokens,mode==='native'?8192:undefined);
 assert.equal(ctx.body.native_thinking_enabled,['native','adaptive'].includes(mode)?true:undefined);
 assert.equal(ctx.body.thinking_mode,mode==='off'?undefined:mode);
}

const out=path.resolve(root,'../0-工作间/v254-adaptive-browser');
const chrome=process.env.CK_CHROME||'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
if(!fs.existsSync(chrome)){console.log('settings browser: SKIP (Chrome unavailable)');process.exit(0)}
fs.mkdirSync(out,{recursive:true});
for(const name of fs.readdirSync(root))if(name.endsWith('.css'))fs.copyFileSync(path.join(root,name),path.join(out,name));
fs.writeFileSync(path.join(out,'runtime.js'),['chat-ui.js','chat-history.js','chat-digest.js','script.js'].map(name=>fs.readFileSync(path.join(root,name),'utf8').replace(/^init\(\);\s*$/m,'')).join('\n'));
let base=fs.readFileSync(path.join(root,'index.html'),'utf8').replace(/<script\b[\s\S]*?<\/script>/g,'');
const probe=String.raw`
window.addEventListener('load',function(){
try{
 const check=(ok,msg)=>{if(!ok)throw new Error(msg)};
 localStorage.clear();window.fetch=async()=>{throw new Error('Offline test')};
 apiProvidersLoaded=true;chatInitialized=false;
 chatSessions=[{id:'adaptive-test',title:'测试',messages:[],transportMessages:[]}];chatActiveSessionId='adaptive-test';
 let cfg=chatLoadConfig();cfg.sessionId='adaptive-test';chatSaveConfigObject(cfg);chatWriteForm(chatLoadConfig());
 document.body.className='chat-active'+(TEST_DARK?' dark':'');
 document.getElementById('loading-wrap').remove();
 document.querySelectorAll('.panel-tab').forEach(el=>el.classList.toggle('active',el.id==='tab-chat'));
 chatOpenSettingTab('thinking');
 const mode=document.getElementById('chat-thinking-mode'),effort=document.getElementById('chat-thinking-effort'),label=document.getElementById('chat-thinking-effort-label'),budget=document.getElementById('chat-thinking-budget');
 check(effort.disabled&&label.hidden,'off hides and disables effort');
 mode.value='adaptive';chatThinkingModeChanged('adaptive');
 check(!effort.disabled&&!label.hidden&&budget.disabled,'adaptive controls');
 check(effort.value==='high','default high');
 for(const value of ['low','medium','high','max']){
  effort.value=value;effort.dispatchEvent(new Event('change',{bubbles:true}));
  check(chatLoadConfig().thinkingEffort===value,'saved '+value);
  chatWriteForm(chatLoadConfig());check(effort.value===value,'reload '+value);
 }
 mode.value='native';chatThinkingModeChanged('native');check(effort.disabled&&label.hidden&&!budget.disabled,'native controls');
 mode.value='adaptive';chatThinkingModeChanged('adaptive');check(effort.value==='max','mode switching retains effort');
 cfg=chatLoadConfig();cfg.thinkingEffort='invalid';chatSaveConfigObject(cfg);chatWriteForm(chatLoadConfig());check(effort.value==='high','invalid effort normalization');
 closeToast();
 const rect=effort.getBoundingClientRect();check(rect.width>0&&rect.right<=TEST_WIDTH+1,'effort visible without overflow');
 document.getElementById('settings-result').textContent='SETTINGS_OK '+JSON.stringify({width:TEST_WIDTH,effort:effort.value});
}catch(error){document.getElementById('settings-result').textContent='SETTINGS_ERROR '+error.stack}
});`;
async function main(){
const profile=path.join(out,'cdp-'+Date.now());
const browser=spawn(chrome,['--headless=new','--disable-gpu','--no-sandbox','--hide-scrollbars','--no-first-run','--no-default-browser-check','--remote-debugging-port=0','--user-data-dir='+profile,'about:blank'],{stdio:'ignore',windowsHide:true});
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
let socket;
try{
  let portFile=path.join(profile,'DevToolsActivePort');
  for(let i=0;i<100&&!fs.existsSync(portFile);i++)await pause(50);
  const port=fs.readFileSync(portFile,'utf8').split('\n')[0];
  const targets=await (await fetch('http://127.0.0.1:'+port+'/json/list')).json();
  socket=new WebSocket(targets.find(x=>x.type==='page').webSocketDebuggerUrl);
  await new Promise((resolve,reject)=>{socket.onopen=resolve;socket.onerror=reject});
  let counter=0;const pending=new Map();
  socket.onmessage=e=>{const result=JSON.parse(e.data);const task=pending.get(result.id);if(task){pending.delete(result.id);result.error?task.reject(result.error):task.resolve(result.result)}};
  const send=(method,params={})=>new Promise((resolve,reject)=>{const id=++counter;pending.set(id,{resolve,reject});socket.send(JSON.stringify({id,method,params}))});
  await send('Page.enable');
for(const [width,dark,destination] of [[320,false,'thinking'],[390,true,'thinking'],[1280,false,'thinking']]){
  const tag=width+'-'+(dark?'dark':'light')+'-'+destination;
  const html=base.replace('</body>','<pre id="settings-result" hidden></pre><script src="runtime.js"></script><script>const TEST_WIDTH='+width+';const TEST_DARK='+dark+';const TEST_DESTINATION='+JSON.stringify(destination)+';'+probe+'</script></body>');
  const file=path.join(out,tag+'.html');fs.writeFileSync(file,html);
  await send('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:width<600});
  await send('Page.navigate',{url:'file:///'+file.replace(/\\/g,'/')});
  let result='';
  for(let i=0;i<100;i++){
    await pause(50);
    const value=await send('Runtime.evaluate',{expression:'document.getElementById("settings-result")?.textContent||""',returnByValue:true});
    result=value.result.value||'';if(result)break;
  }
  const screenshot=await send('Page.captureScreenshot',{format:'png'});
  fs.writeFileSync(path.join(out,tag+'.png'),Buffer.from(screenshot.data,'base64'));
  assert(result.startsWith('SETTINGS_OK'),tag+': '+(result||'No browser output'));
  fs.writeFileSync(path.join(out,tag+'-result.txt'),result);
  console.log('settings browser: '+tag+' PASS (adaptive effort, persistence, mode switching)');
}
await send('Browser.close');
}finally{if(socket)socket.close();browser.kill()}
}
main().catch(error=>{console.error(error);process.exitCode=1});
