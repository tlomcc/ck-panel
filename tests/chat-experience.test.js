const fs=require('fs'),path=require('path'),http=require('http'),assert=require('assert');
const {spawn}=require('child_process');
const root=path.resolve(__dirname,'..'),out=path.resolve(__dirname,'../../0-工作间/v239-browser-regression');
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
  const portFile=path.join(profile,'DevToolsActivePort');for(let i=0;i<100&&!fs.existsSync(portFile);i++)await pause(50);
  const port=fs.readFileSync(portFile,'utf8').split('\n')[0];
  const targets=await(await fetch('http://127.0.0.1:'+port+'/json/list')).json();
  socket=new WebSocket(targets.find(x=>x.type==='page').webSocketDebuggerUrl);
  await new Promise((r,j)=>{socket.onopen=r;socket.onerror=j});let id=0;const pending=new Map();
  socket.onmessage=e=>{const x=JSON.parse(e.data),p=pending.get(x.id);if(p){pending.delete(x.id);x.error?p.reject(x.error):p.resolve(x.result)}};
  const send=(method,params={})=>new Promise((resolve,reject)=>{const i=++id;pending.set(i,{resolve,reject});socket.send(JSON.stringify({id:i,method,params}))});
  const evaluate=async expression=>{const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw new Error(r.exceptionDetails.exception?.description||JSON.stringify(r.exceptionDetails));return r.result.value};
  const shot=async name=>{const x=await send('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(out,name+'.png'),Buffer.from(x.data,'base64'))};
  await send('Page.enable');
  for(const [width,dark] of [[390,false],[1280,false],[390,true]]){
    await send('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:width<600});
    await send('Page.navigate',{url:base+'/index.html'});
    for(let i=0;i<100;i++){if(await evaluate(`typeof chatRenderMessages==='function'&&typeof CKChatHistory==='object'`))break;await pause(40)}
    await evaluate(`document.body.classList.toggle('dark',${dark})`);await shot(width+'-'+dark+'-startup');
    const result=await evaluate(`(async()=>{
      const check=(ok,msg)=>{if(!ok)throw new Error(msg)},tick=()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
      window.fetch=async()=>{throw new Error('Offline fixture')};localStorage.clear();
      apiProvidersLoaded=true;chatInitialized=false;chatSessionsReady=true;
      document.getElementById('loading-wrap').classList.add('done');
      document.querySelectorAll('.panel-tab').forEach(el=>el.classList.toggle('active',el.id==='tab-chat'));
      chatActiveSessionId='fixture';chatMessages=[];const now=Date.now();
      for(let i=0;i<120;i++)chatMessages.push({role:'user',text:'问题 第'+i+'轮',turnId:'t'+i,ts:now-360000+i*2000,cacheState:i%2?'full':'sent'}, {role:'assistant',text:'第'+i+'轮的回答，保留每一次对话。',thinking:'认真想一想。',turnId:'t'+i,ts:now-359999+i*2000}, {role:'assistant',text:'这是一条分条回复。',turnId:'t'+i,ts:now-359998+i*2000});
      chatSessions=[{id:'fixture',title:'小克',messages:chatMessages,transportMessages:[],dailyDigests:[]}];
      let cfg=chatLoadConfig();cfg.sessionId='fixture';cfg.thinkingMode='native';chatSaveConfigObject(cfg);chatWriteForm(cfg);chatRenderMessages();await tick();
      let rows=()=>[...document.querySelectorAll('#chat-messages>.chat-msg-row')],box=chatMessagesBox();
      check(rows().length===150,'50 rounds expected, got '+rows().length);check(+rows()[0].dataset.chatIndex===210,'Wrong latest range');
      let anchor=rows()[0];box.scrollTop=anchor.offsetTop-box.offsetTop;await tick();const before=anchor.getBoundingClientRect().top;
      chatHistoryLoad('before');await tick();check(rows().length===300,'Lazy prepend missing');check(Math.abs(anchor.getBoundingClientRect().top-before)<3,'Prepend jumped');
      chatJumpToEdge('top');await tick();check(rows().length===150&&+rows()[0].dataset.chatIndex===0&&box.scrollTop<3,'Top jump failed');
      chatJumpToEdge('bottom');await tick();check(rows().length===150&&box.scrollHeight-box.scrollTop-box.clientHeight<3,'Bottom jump failed');
      chatToggleSearch(true);document.getElementById('chat-search-input').value='问题 第4轮';chatSearchMessages();await tick();
      let match=box.querySelector('[data-chat-index="12"]');check(match&&match.getBoundingClientRect().top>=box.getBoundingClientRect().top&&match.getBoundingClientRect().bottom<=box.getBoundingClientRect().bottom,'Search failed to locate unloaded history');check(rows().length<=150,'Search rendered all history');
      chatToggleSearch(false);chatJumpToEdge('bottom');await tick();
      chatSetActionMode('low');check(!box.querySelector('.chat-msg-tools,.chat-action-buddy'),'Low mode leaked actions');
      chatSetActionMode('medium');check(!box.querySelector('.chat-msg-tools')&&box.querySelector('.chat-action-buddy'),'Medium defaults wrong');
      chatToggleTurnActions(358);check(box.querySelectorAll('.chat-msg-tools').length===3,'Must expand just one full turn');
      chatMessages.push({role:'user',text:'下一轮',turnId:'new-turn',ts:now},{role:'assistant',text:'新回答',turnId:'new-turn',ts:now+1});chatRenderMessages();await tick();
      check(!box.querySelector('.chat-msg-tools'),'Old actions must collapse on next turn');
      chatSetActionMode('high');check(box.querySelectorAll('.chat-msg-tools').length===rows().length,'High mode must show all actions');check(!box.querySelector('.chat-action-buddy'),'Buddy leaked in high mode');
      chatSetActionMode('medium');
      chatOpenSettingTab('display');check(document.querySelector('[data-action-mode="medium"]').getAttribute('aria-checked')==='true','Mode UI not restored');
      chatOpenSettingTab('debug');check(!document.querySelector('.chat-debug-controls').open,'Debug defaults expanded');check(document.querySelectorAll('#chat-side-debug details').length===1,'Nested debug collapse');check(document.querySelector('#chat-side-debug .chat-theme-toggle'),'Theme not in debug');
      document.getElementById('chat-debug-version').click();check(!document.getElementById('panel-version-notes').hidden,'Version notes not open');check(document.querySelectorAll('#panel-version-notes li').length===8,'Notes not current version');document.getElementById('chat-debug-version').click();check(document.getElementById('panel-version-notes').hidden,'Version notes toggle failed');document.getElementById('chat-debug-version').click();box.click();check(document.getElementById('panel-version-notes').hidden,'Outside click failed');
      chatToggleSettings(false);chatFolders=[{id:'f',name:'我的分组'}];chatSessions[0].folderId='f';chatSessions[0].updated=now;chatSessionSearch='小克';chatToggleSessions(true);chatRenderSessions();await tick();
      const preview=document.querySelector('.chat-session-preview').getBoundingClientRect(),folder=document.querySelector('.chat-session-folder-label').getBoundingClientRect();check(folder.top>=preview.bottom-1,'Folder overlaps preview');chatToggleSessions(false);
      check(document.documentElement.scrollWidth<=innerWidth+1,'Horizontal overflow');
      chatToggleSearch(true);document.getElementById('chat-search-input').value='问题 第4轮';chatSearchMessages();
      chatSessions.push({id:'second',title:'另一个窗口',messages:[],transportMessages:[]});chatSelectSession('second');
      check(document.getElementById('chat-search').hidden&&chatSearchHits.length===0&&!document.getElementById('chat-search-input').value,'Search leaked across windows');
      chatSelectSession('fixture');await tick();
      return {rounds:120,rendered:rows().length,history:'50-round pages, anchor, edges and search passed',actions:'three modes and next-turn collapse passed',layout:'debug, version popover and folder overlap passed'};
    })()`);
    console.log(width+' '+dark,JSON.stringify(result));await pause(400);await shot(width+'-'+dark+'-chat');
    await evaluate(`chatOpenSettingTab('display')`);await pause(250);await shot(width+'-'+dark+'-display');
    await evaluate(`chatOpenSettingTab('debug')`);await pause(200);await shot(width+'-'+dark+'-debug');
    if(!dark){
      const provider=await evaluate(`(async()=>{
        chatToggleSettings(false);document.body.classList.remove('chat-active');document.querySelectorAll('.panel-tab').forEach(el=>el.classList.toggle('active',el.id==='tab-api'));
        currentApiTab='providers';apiProviders={};apiProviderLibrarySlot().providers=Array.from({length:10},(_,i)=>({id:'p'+i,name:'供应商 '+i,url:'https://example.invalid/v1',key:'fixture-only',model:'model-a',models:['model-a']}));renderApiConfig();
        document.querySelectorAll('.prov-card').forEach(el=>el.classList.add('expanded'));
        let button=document.querySelectorAll('[onclick="fetchProviderModels(this)"]')[5];button.scrollIntoView({block:'center'});await new Promise(r=>setTimeout(r,300));const before=button.getBoundingClientRect().top;
        fetchModelsForProvider=async()=>['model-a','model-b','model-c'];persistAndReload=async()=>true;
        fetchProviderModels(button);await new Promise(r=>setTimeout(r,400));button=document.querySelectorAll('[onclick="fetchProviderModels(this)"]')[5];
        const delta=button.getBoundingClientRect().top-before;if(Math.abs(delta)>3)throw new Error('Provider scroll jumped '+delta);
        if(document.querySelectorAll('.prov-card.expanded').length!==10)throw new Error('Expanded provider state lost');
        return {providerScrollDelta:delta};
      })()`);console.log(width,provider);await shot(width+'-providers');
    }
  }
  await send('Browser.close');
 }finally{socket?.close();browser.kill();server.close()}
})().catch(e=>{console.error(e);process.exitCode=1;server.close()});
