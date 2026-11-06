const {chromium}=require(process.env.CK_PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http'),os=require('node:os');
const root=path.resolve(process.env.CK_RECOVERY_PANEL_ROOT||path.join(__dirname,'..'));
const out=process.env.CK_RECOVERY_TEST_OUTPUT||fs.mkdtempSync(path.join(os.tmpdir(),'ck-recovery-'));
fs.mkdirSync(out,{recursive:true});
const server=http.createServer((req,res)=>{
  const name=decodeURIComponent(new URL(req.url,'http://localhost').pathname).slice(1)||'index.html',file=path.resolve(root,name);
  if(!file.startsWith(root+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile()){res.writeHead(404);return res.end()}
  let body=fs.readFileSync(file);
  if(name==='index.html')body=Buffer.from(body.toString().replace('</head>','<script src="/tests/fixtures/games-boot.js"></script></head>').replace(/<script src="pwa\.js[^>]+><\/script>/g,''));
  res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json'}[path.extname(file)]||'application/octet-stream')+'; charset=utf-8');
  res.setHeader('Content-Security-Policy',"connect-src 'self'; img-src 'self' data: blob:; font-src 'self' data:; frame-src 'none'; worker-src 'none'");res.end(body);
});
let browser,base;const results=[];
async function boot(){
  const context=await browser.newContext({viewport:{width:390,height:844},locale:'zh-CN',serviceWorkers:'block'});
  await context.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
  const page=await context.newPage();await page.goto(base+'/#chat');
  await page.waitForFunction(()=>chatSessionsReady&&chatInitialized);
  return {context,page};
}
async function run(name,fn){
  try{const evidence=await fn();results.push({name,passed:true,evidence});console.log('PASS '+name)}
  catch(error){results.push({name,passed:false,error:String(error)});throw error}
}
(async()=>{
  try{
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));base='http://127.0.0.1:'+server.address().port;
    browser=await chromium.launch({headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
    await run('foreground reply keeps receiving a fragmented 2 MB history without recovery or replay',async()=>{
      const {context,page}=await boot();try{
        await page.evaluate(()=>{
          const originalFetch=fetch,originalStatus=chatSetStatus;
          window.__recoveryCase={posts:0,receipts:0,aborts:0,statuses:[],bytes:0,started:0};
          chatSetStatus=function(text){__recoveryCase.statuses.push(String(text));return originalStatus(text)};
          window.fetch=async function(input,options){
            const url=new URL(typeof input==='string'?input:input.url,location.href),opts=options||{};
            if(url.pathname.endsWith('/ck/chat/last')){__recoveryCase.receipts++;return fixtureJson(__recoveryCase.receipt)}
            if(!url.pathname.endsWith('/ck/chat')||opts.method!=='POST')return originalFetch(input,options);
            __recoveryCase.posts++;__recoveryCase.started=Date.now();
            const body=JSON.parse(opts.body),reply='回复已经生成，历史正在正常分块传输。';
            const transport=[{role:'user',content:'合成历史🙂'.repeat(150000)},
              {role:'assistant',content:[{type:'thinking',thinking:'保留完整思考',signature:'synthetic-signature+/=='},{type:'text',text:reply}]}];
            __recoveryCase.transport=transport;
            __recoveryCase.receipt={ok:true,found:true,pending:false,state:'complete',turn_matched:true,turn_id:body.turn_id,created_at:Date.now()/1000,assistant_text:reply,assistant_thinking:'',transport_messages:transport};
            const encoder=new TextEncoder(),encode=(event,data)=>encoder.encode('event: '+event+'\ndata: '+JSON.stringify(data)+'\n\n');
            const raw=encode('transport',{messages:transport});__recoveryCase.bytes=raw.byteLength;
            let closed=false,timer=0,offset=0;
            return new Response(new ReadableStream({start(controller){
              if(opts.signal)opts.signal.addEventListener('abort',()=>{if(!closed){__recoveryCase.aborts++;closed=true;clearTimeout(timer);controller.error(new DOMException('Aborted','AbortError'))}});
              controller.enqueue(encode('delta',{text:reply}));controller.enqueue(encode('reply_complete',{usage:{output_tokens:20}}));
              function next(){
                if(closed)return;
                if(offset<raw.length){controller.enqueue(raw.slice(offset,offset+131072));offset+=131072;timer=setTimeout(next,600)}
                else{controller.enqueue(encode('done',{usage:{output_tokens:20}}));closed=true;controller.close()}
              }
              next();
            },cancel(){closed=true;clearTimeout(timer)}}),{headers:{'Content-Type':'text/event-stream'}});
          };
        });
        await page.fill('#chat-input','检查前台正常分块传输');await page.click('#chat-send-btn');
        await page.waitForFunction(()=>__recoveryCase.posts===1);
        await page.waitForFunction(()=>!chatSending&&!chatRecoverInFlightBusy&&!chatInterruptedInFlightMessages().length,{},{timeout:20000});
        const evidence=await page.evaluate(()=>({posts:__recoveryCase.posts,receipts:__recoveryCase.receipts,aborts:__recoveryCase.aborts,
          recoveryStatuses:__recoveryCase.statuses.filter(s=>/补收|连接恢复/.test(s)),bytes:__recoveryCase.bytes,elapsed:Date.now()-__recoveryCase.started,
          contextExact:JSON.stringify(chatCurrentSession().transportMessages)===JSON.stringify(__recoveryCase.transport),
          replies:chatMessages.filter(m=>m.role==='assistant'&&m.text==='回复已经生成，历史正在正常分块传输。').length,
          foreground:!document.hidden,progressHidden:document.getElementById('chat-head-progress').hidden,errors:__fixtureErrors}));
        fs.writeFileSync(path.join(out,'foreground-evidence.json'),JSON.stringify(evidence,null,2));
        assert.equal(evidence.posts,1);assert.equal(evidence.aborts,0,JSON.stringify(evidence));assert.equal(evidence.receipts,0);
        assert(evidence.elapsed>8000,'the transfer must outlast the recovery threshold');
        assert.deepEqual(evidence.recoveryStatuses,[]);assert(evidence.contextExact);assert.equal(evidence.replies,1);
        assert(evidence.foreground&&evidence.progressHidden);assert.deepEqual(evidence.errors,[]);
        await page.screenshot({path:path.join(out,'foreground-complete.png')});return evidence;
      }finally{await context.close()}
    });
    for(const fixture of ['stream-recovery','stream-completion'])await run(fixture+' retains its protocol guarantees',async()=>{
      const {context,page}=await boot();try{
        await page.evaluate(source=>window.__streamSource=source,fs.readFileSync(path.join(root,'script.js'),'utf8'));
        const result=await page.evaluate(fs.readFileSync(path.join(root,'tests/fixtures',fixture+'.js'),'utf8'));
        assert.deepEqual(await page.evaluate(()=>__fixtureErrors),[]);return result;
      }finally{await context.close()}
    });
  }finally{
    fs.writeFileSync(path.join(out,'results.json'),JSON.stringify(results,null,2));
    if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));
  }
})().catch(error=>{console.error(error);process.exitCode=1});
