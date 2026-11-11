const {chromium}=require('playwright');
const fs=require('fs'),path=require('path'),http=require('http'),os=require('os'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');
const out=process.env.CK_TEST_OUTPUT||path.join(os.tmpdir(),'ck-topic-removal-check');
fs.mkdirSync(out,{recursive:true});
const server=http.createServer((req,res)=>{
  const name=decodeURIComponent(new URL(req.url,'http://local').pathname).replace(/^\//,'')||'index.html';
  const file=path.resolve(root,name);
  if(!file.startsWith(root+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile()){res.writeHead(404);return res.end();}
  let data=fs.readFileSync(file);
  if(name==='index.html')data=Buffer.from(data.toString().replace(/<script src="(?:pwa|script-extra)\.js[^>]+><\/script>/g,''));
  if(name==='script.js')data=Buffer.from(data.toString().replace(/^init\(\);\s*$/m,''));
  res.setHeader('Content-Type',name.endsWith('.js')?'text/javascript':name.endsWith('.css')?'text/css':name.endsWith('.svg')?'image/svg+xml':name.endsWith('.png')?'image/png':name.endsWith('.json')?'application/json':'text/html');
  res.end(data);
});

async function fixture(){
  panelAuthKey='synthetic-test-key';localStorage.setItem(API_KEY_STORAGE,panelAuthKey);panelAppStarted=false;
  document.getElementById('loading-wrap').classList.add('done');
  apiProvidersLoaded=true;
  apiProviders={provider_library:{providers:[{id:'test-provider',name:'测试供应商',url:'https://synthetic.invalid/v1',key:'fixture',model:'model-test',models:['model-test']}]},recall_rewrite:{current:'test-provider',model:'model-test'},recall_vector:{current:'test-provider',model:'model-test'}};
  const event={id:'event-1',title:'旅行安排 <img src=x onerror="window.injected=1">',topic_ids:['shared-evidence-1'],earliest_date:'2026-11-01',latest_date:'2026-11-02',beats:[{text:'原定出发，后来取消。',fact_ids:['fact-1']}],injection:'[相关记忆：旅行]\n原定出发，后来取消。'};
  window.fixtureCalls=[];window.fixtureFact=null;
  window.openFactDetail=id=>{window.fixtureFact=id;};
  window.loadDailyStatus=()=>{document.getElementById('daily-status-body').textContent='Fact 整理 · 已暂停 · 7251 条事实保留';};
  window.startDailyStatusRealtime=()=>{};window.stopDailyStatusRealtime=()=>{};
  chatSessions=[];chatSessionsReady=true;
  window.fetch=async(url,options={})=>{
    const u=new URL(String(url),location.href),body=options.body?JSON.parse(options.body):null;
    const p=u.pathname.replace(/^\/gateway(?=\/)/,'');
    fixtureCalls.push({path:p,query:u.search,body});
    let data;
    if(p==='/ck/event-memories')data={ok:true,events:Array.from({length:31},(_,i)=>({...event,id:'event-'+i,title:i===0?event.title:'合成事件 '+i})),git:{status:'synced'},status:{manual_pending_scopes:1}};
    else if(p==='/ck/event-automation')data={ok:true,control:{enabled:false},progress:{scope_count:342,ready_scopes:341,events:2589,automatic_pending_scopes:0,manual_pending_scopes:1},preload:{ready:true,events:2511},git:{status:'synced'},failures:[{id:'protected-event',scope:'待人工处理的事件',blocked:true,phase:'audit',attempts:30,reason:'含受限材料，已保留待人工处理'}],history:[],settings:{daily_calls:120,max_attempts:3},usage:{calls:0},observed_at:Date.now()/1000};
    else if(p==='/ck/fact-control')data={ok:true,enabled:false,revision:3};
    else if(p==='/ck/maintenance/status'&&u.searchParams.get('section')==='digest')data={ok:true,sessions:[],history:{items:[],next_cursor:null}};
    else if(p==='/ck/recall-experiment')data={ok:true,path:body.path,simulation:true,injected:false,statistics_recorded:false,elapsed_seconds:.1,items:[{fact_id:'fact-1',situation:'原始事实保留'}],text:'合成召回证据 <script>window.injected=2</script>',warnings:[],diag:{candidate_preview:[{fact_id:'fact-1',selected:true,content_preview:'原始事实保留'}],topic_recall:{events:body.path==='c'?[event]:[],menus:[]}}};
    else throw Error('Unexpected request '+p+u.search);
    return {ok:true,status:200,json:async()=>JSON.parse(JSON.stringify(data))};
  };
}

(async()=>{
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const base='http://127.0.0.1:'+server.address().port;
  const browser=await chromium.launch({args:['--no-sandbox','--disable-dev-shm-usage']});
  const checks=[];
  try{
    for(const width of [320,390,1280]){
      const context=await browser.newContext({viewport:{width,height:900},serviceWorkers:'block'});
      await context.route('**/*',route=>route.request().url().startsWith(base+'/')?route.continue():route.abort());
      const page=await context.newPage(),errors=[];
      page.on('pageerror',e=>errors.push(e.message));
      await page.goto(base+'/index.html');
      await page.waitForFunction(()=>typeof memoryWorkbenchEnter==='function');
      await page.evaluate(fixture);
      assert.equal(await page.locator('#ck-status-tab-topics,#ck-status-topics,#mw-organizer,[data-tab="topics"]').count(),0);
      assert.equal(await page.locator('#ck-status-tab-fact,#ck-status-tab-events').count(),2);
      await page.evaluate(()=>navTo('events'));
      await page.waitForFunction(()=>document.querySelector('#mw-event-count')?.textContent==='显示 30 / 31 条');
      await page.locator('#mw-event-more').click();
      assert.equal(await page.locator('#mw-event-count').textContent(),'显示 31 / 31 条');
      await page.locator('#mw-event-search').fill('旅行安排');
      assert.equal(await page.locator('#mw-event-count').textContent(),'显示 1 / 1 条');
      await page.locator('#mw-event-cards [data-mw="fact"]').click();
      assert.equal(await page.evaluate(()=>fixtureFact),'fact-1');
      assert.equal(await page.evaluate(()=>window.injected),undefined);
      assert.equal(await page.evaluate(()=>fixtureCalls.filter(c=>c.body).length),0);
      await page.screenshot({path:path.join(out,'events-'+width+'.png')});
      await page.evaluate(()=>{navTo('status');ckSelectStatusTab('events');});
      await page.waitForFunction(()=>document.querySelector('#ck-event-monitor')?.textContent.includes('待人工处理的事件')).catch(async e=>{console.log(await page.evaluate(()=>({tab:currentPanelTab,status:ckStatusTab,message:document.querySelector('#ck-event-monitor').textContent,calls:fixtureCalls})));await page.screenshot({path:path.join(out,'failure.png')});throw e;});
      await page.waitForFunction(()=>document.querySelector('#ck-organizing-toggle').getAttribute('aria-checked')==='false'&&!document.querySelector('#ck-organizing-toggle').disabled);
      assert.equal(await page.locator('#ck-organizing-title').textContent(),'事件整理');
      await page.screenshot({path:path.join(out,'event-status-'+width+'.png')});
      await page.evaluate(()=>ckSelectStatusTab('fact'));
      await page.waitForFunction(()=>document.querySelector('#ck-organizing-title').textContent==='Fact 整理');
      assert((await page.locator('#daily-status-body').textContent()).includes('7251'));
      await page.evaluate(()=>{navTo('recall-lab');document.getElementById('mw-lab-query').value='旅行后来怎么样';document.getElementById('mw-lab-mode').value='all';});
      await page.locator('#mw-lab-run').click();
      await page.waitForFunction(()=>document.querySelector('#mw-lab-status').textContent.includes('实验完成'));
      assert((await page.locator('#mw-comparison').textContent()).includes('B · 宽松'));
      assert((await page.locator('#mw-comparison').textContent()).includes('C · 事件脉络'));
      assert((await page.locator('#mw-comparison').textContent()).includes('1 个事件'));
      assert.deepEqual(await page.evaluate(()=>fixtureCalls.filter(c=>c.path==='/ck/recall-experiment').map(c=>c.body.path)),['a','b','c']);
      await page.screenshot({path:path.join(out,'recall-'+width+'.png')});
      assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
      assert.equal(await page.evaluate(()=>fixtureCalls.some(c=>c.path==='/ck/memory-topics'||c.query.includes('section=topics'))),false);
      assert.equal(await page.evaluate(()=>window.injected),undefined);
      assert.deepEqual(errors,[]);
      checks.push({width,event_reader:true,fact_source:true,event_status:true,fact_status:true,recall_abc:true,retired_requests:0,page_errors:errors.length});
      await context.close();
    }
    fs.writeFileSync(path.join(out,'result.json'),JSON.stringify({checks,real_model_requests:0},null,2));
    console.log(JSON.stringify({checks,real_model_requests:0}));
  }finally{await browser.close();server.close();}
})().catch(e=>{console.error(e);server.close();process.exitCode=1;});
