// Real DOM checks: destinations, scope, saving and mobile overflow.
const fs=require('fs'),path=require('path'),assert=require('assert');
const {spawn}=require('child_process');
const root=path.resolve(__dirname,'..');
const out=path.resolve(root,'../0-工作间/20260923-cleanup-browser');
const chrome=process.env.CK_CHROME||'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
if(!fs.existsSync(chrome)){console.log('settings browser: SKIP (Chrome unavailable)');process.exit(0)}
fs.mkdirSync(out,{recursive:true});
for(const name of fs.readdirSync(root))if(name.endsWith('.css'))fs.copyFileSync(path.join(root,name),path.join(out,name));
fs.writeFileSync(path.join(out,'runtime.js'),fs.readFileSync(path.join(root,'script.js'),'utf8').replace(/^init\(\);\s*$/m,''));
let base=fs.readFileSync(path.join(root,'index.html'),'utf8').replace(/<script\b[\s\S]*?<\/script>/g,'');
const probe=String.raw`
window.addEventListener('load',function(){
try{
  const check=(ok,msg)=>{if(!ok)throw new Error(msg)};
  localStorage.clear(); window.fetch=async()=>{throw new Error('Offline browser test')};
  apiProvidersLoaded=true;chatInitialized=false;
  chatSessions=[{id:'window-a',title:'测试窗口 A',messages:[],transportMessages:[]},{id:'window-b',title:'测试窗口 B',messages:[],transportMessages:[]}];
  chatActiveSessionId='window-a';
  let cfg=chatLoadConfig();cfg.sessionId='window-a';cfg.autoTrimKeepRounds=60;
  chatSaveConfigObject(cfg);chatWriteForm(chatLoadConfig());
  chatRenderMessages({force:true});
  document.body.className='chat-active'+(TEST_DARK?' dark':'');
  document.getElementById('loading-wrap').remove();
  document.querySelectorAll('.panel-tab').forEach(el=>el.classList.toggle('active',el.id==='tab-chat'));
  document.getElementById('chat-settings').classList.add('open');
  check(window.innerWidth===TEST_WIDTH,'Mobile viewport was not emulated');
  const allIds=[...document.querySelectorAll('[id]')].map(el=>el.id);
  check(allIds.length===new Set(allIds).size,'Duplicate DOM IDs');
  const destinations={model:'chat-system',thinking:'chat-thinking-mode',worldbook:'chat-worldbook-content',
    gateway:'chat-window-api-editor',billing:'chat-cost-defaults',tools:'chat-use-mcp',memory:'chat-recall-enabled',time:'chat-time-injection-every-rounds',
    cache:'chat-cache-strategy',history:'chat-retain-current-time-history',cleanup:'chat-auto-clean-enabled',digest:'chat-daily-digest-pack',
    session:'chat-session-id',trim:'chat-window-trim-override',debug:'chat-debug'};
  const geometry=[];
  for(const [key,field] of Object.entries(destinations)){
    const nav=document.getElementById('chat-settings-nav');nav.value=key;nav.dispatchEvent(new Event('change'));
    const active=document.querySelectorAll('.chat-side-panel.active');
    check(active.length===1&&active[0].id==='chat-side-'+key,'Wrong destination '+key);
    check(active[0].contains(document.getElementById(field)),'Misfiled control '+field);
    check(document.getElementById('chat-settings-title').textContent===chatSettingTitle(key),'Wrong title '+key);
    check(getComputedStyle(active[0]).display==='flex','Hidden destination '+key);
    check(active[0].scrollWidth<=active[0].clientWidth+2,'Horizontal overflow '+key);
    geometry.push({key,height:active[0].clientHeight,scroll:active[0].scrollHeight});
  }
  check(document.querySelectorAll('#chat-plus-grid>button').length===19,'Missing tray buttons');
  for(const key of ['model','thinking','worldbook','digest','memory']){
    chatOpenSettingTab(key);
    check(document.getElementById(destinations[key]==='chat-thinking-mode'?'chat-thinking-prompt':key==='memory'?'chat-memory-pack':destinations[key]).getBoundingClientRect().height>=300,'Text editor too small '+key);
  }
  document.getElementById('chat-system').value='完整提示词\n'+('编辑正文，不应截断。\n'.repeat(100));
  const systemDraft=document.getElementById('chat-system').value;
  chatSaveConfig(true);chatWriteForm(chatLoadConfig());
  check(document.getElementById('chat-system').value===systemDraft,'Long prompt save lost text');
  check([...document.querySelectorAll('.chat-setting-help')].every(x=>!x.open),'Explanations must start collapsed');
  chatOpenSettingTab('trim');
  check(document.getElementById('chat-trim-default-section').hidden,'Defaults should be separate');
  check(document.getElementById('chat-window-trim-fields').hidden,'Inherited controls must be collapsed');
  document.getElementById('chat-window-trim-override').click();
  check(!document.getElementById('chat-window-trim-fields').hidden,'Override did not expand');
  document.getElementById('chat-window-trim-keep').value='17';
  document.getElementById('chat-window-trim-keep').dispatchEvent(new Event('change'));
  check(chatSessions[0].trimConfig.keep===17&&chatSessions[0].trimOverrideEnabled,'Window override not saved');
  check(!chatSessions[1].trimOverrideEnabled,'Override leaked to another window');
  document.querySelector('[data-trim-view="default"]').click();
  check(document.getElementById('chat-trim-window-section').hidden,'Window and default forms overlap');
  document.getElementById('chat-auto-trim-keep').value='80';
  document.querySelector('#chat-trim-default-section .chat-wide-btn').click();
  cfg=chatLoadConfig();
  check(cfg.autoTrimKeepRounds===80&&chatSessions[0].trimConfig.keep===17,'Default save overwrote window scope');
  chatSelectTrimScope('window');document.getElementById('chat-window-trim-override').click();
  check(chatAutoTrimConfigFrom(chatLoadConfig()).keep===80,'Disable override did not inherit defaults');
  check(document.getElementById('chat-window-trim-fields').hidden,'Disabled override still expanded');
  chatOpenSettingTab('time');
  document.getElementById('chat-time-injection-every-rounds').value='7';
  document.getElementById('chat-time-injection-every-rounds').dispatchEvent(new Event('change'));
  check(chatLoadConfig().timeInjectionEveryRounds===7,'Time save failed');
  chatOpenSettingTab('digest');
  document.getElementById('chat-daily-digest-retention-days').value='3';
  document.getElementById('chat-daily-digest-retention-days').dispatchEvent(new Event('change'));
  check(chatLoadConfig().dailyDigestRetentionDays===3,'Digest save failed after move');
  chatWriteForm(chatLoadConfig());
  check(document.getElementById('chat-time-injection-every-rounds').value==='7','Saved time not restored');
  check(document.getElementById('chat-daily-digest-retention-days').value==='3','Saved retention not restored');
  if(TEST_DESTINATION.indexOf('daily-')===0){
    chatToggleSettings(false);
    document.body.classList.remove('chat-active');
    document.querySelectorAll('.panel-tab').forEach(el=>el.classList.toggle('active',el.id==='tab-status'));
    const blocked=TEST_DESTINATION==='daily-blocked';
    const fixture={today:'2026-09-23',now:'2026-09-23 20:00',fact_daily:{
      status:blocked?'blocked':'running',target_date:'2026-09-22',last_success_date:'2026-09-21',
      stage:'audit',stage_label:'质量审核',stage_position:3,stage_total:7,
      provider_name:'示例供应商',provider_host:'api.example.com',model:'模型 A',
      attempt:12,retry_rounds:3,retry_limit:8,running_seconds:3620,last_checkpoint_at:'2026-09-23 00:12:30',
      last_error:blocked?'HTTP 429：请求过于频繁。请稍后补跑。':'',
      stats:{candidates:128,audited:96,verified:84,final_facts:72,segments:18},
      api_stats:{http_calls:48,http_ok:46,http_failed:2,input_tokens:123000,output_tokens:16000,seconds_total:186,
        by_purpose:{提取候选:{calls:38,ok:36,failed:2,seconds:160}},by_error:{限流:2},
        recent:[{at:'2026-09-23T00:12:30',purpose:'审核',ok:true,seconds:4}]}
    }};
    renderDailyStatus(fixture);
    const statusBody=document.getElementById('daily-status-body');
    check(statusBody.querySelectorAll('details[open]').length===0,'Diagnostics must start collapsed');
    const api=statusBody.querySelector('[data-daily-detail="api"]');api.open=true;
    renderDailyStatus(fixture);
    check(statusBody.querySelector('[data-daily-detail="api"]').open,'Auto refresh closed an open section');
    statusBody.querySelector('[data-daily-detail="api"]').open=false;
    check(statusBody.scrollWidth<=statusBody.clientWidth+2,'Daily status horizontal overflow');
    check(!!statusBody.querySelector('#daily-fact-retry')===blocked,'Retry visibility incorrect');
  }else chatOpenSettingTab(TEST_DESTINATION);
  closeToast();
  if(TEST_DESTINATION==='trim')chatSelectTrimScope(TEST_DARK?'default':'window');
  document.querySelectorAll('*').forEach(el=>{el.style.setProperty('transition','none','important');el.style.setProperty('animation','none','important')});
  document.getElementById('settings-result').textContent='SETTINGS_OK '+JSON.stringify(geometry);
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
for(const [width,dark,destination] of [[390,false,'trim'],[390,true,'trim'],[1280,false,'time'],[390,false,'digest'],[390,false,'daily-running'],[390,true,'daily-blocked'],[1280,false,'daily-running']]){
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
  console.log('settings browser: '+tag+' PASS (15 destinations, scopes, persistence, overflow)');
}
await send('Browser.close');
}finally{if(socket)socket.close();browser.kill()}
}
main().catch(error=>{console.error(error);process.exitCode=1});
