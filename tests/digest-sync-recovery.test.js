const {chromium}=require('playwright');
const fs=require('fs'),path=require('path'),http=require('http'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');
const server=http.createServer((req,res)=>{
 const name=new URL(req.url,'http://local').pathname.slice(1)||'index.html',file=path.resolve(root,name);
 if(!file.startsWith(root+'/')||!fs.existsSync(file)){res.writeHead(404);return res.end()}
 let data=fs.readFileSync(file);
 if(name==='index.html')data=Buffer.from(data.toString().replace(/<script src="(?:pwa|script-extra)\.js[^>]+><\/script>/g,''));
 if(name==='script.js')data=Buffer.from(data.toString().replace(/^init\(\);\s*$/m,''));
 res.setHeader('Content-Type',name.endsWith('.js')?'text/javascript':name.endsWith('.css')?'text/css':name.endsWith('.svg')?'image/svg+xml':name.endsWith('.png')?'image/png':'text/html');res.end(data);
});
(async()=>{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const browser=await chromium.launch({args:['--no-sandbox','--disable-dev-shm-usage']});
 try{for(const width of [320,390,1280]){
  const page=await browser.newPage({viewport:{width,height:900}}),errors=[];
  await page.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
  page.on('pageerror',e=>errors.push(e.message));
  await page.exposeFunction('__clickDigestSync',async kind=>{
   const button=page.locator('.mm-digest-result [data-mm-digest-action="sync"]').first();
   await button.scrollIntoViewIfNeeded();
   if(process.env.CK_BROWSER_OUTPUT){fs.mkdirSync(process.env.CK_BROWSER_OUTPUT,{recursive:true});await page.screenshot({path:path.join(process.env.CK_BROWSER_OUTPUT,'partial-ready-'+width+'-'+kind+'.png')});}
   await button.click();
  });
  await page.goto('http://127.0.0.1:'+server.address().port);
  await page.waitForFunction(()=>typeof chatDigestFinishManualTrim==='function');
  const results=await page.evaluate(fs.readFileSync(path.join(__dirname,'fixtures/immediate-trim.js'),'utf8'));
  assert(results.some(r=>r.lostUploadRecovered&&r.readBeforeResend));
  assert(results.some(r=>r.blockedSavedRecovery&&r.originalRunOnly&&r.newerRoundPreserved&&r.noModelRequest));assert.deepEqual(errors,[]);
  assert.equal(results.filter(r=>r.partialStatusSync).length,3);
  assert(results.some(r=>r.partialStatusSync&&r.sourceGroups===650&&r.cutRounds===325));
  if(process.env.CK_BROWSER_OUTPUT){fs.mkdirSync(process.env.CK_BROWSER_OUTPUT,{recursive:true});await page.screenshot({path:path.join(process.env.CK_BROWSER_OUTPUT,'partial-sync-'+width+'.png')});fs.writeFileSync(path.join(process.env.CK_BROWSER_OUTPUT,'results-'+width+'.json'),JSON.stringify(results,null,2));}
  console.log(width+': '+results.length+' browser scenarios PASS, including failed-upload recovery, cancellation, active replies and next-message injection');
  await page.close();
 }}finally{await browser.close();server.close()}
})().catch(e=>{console.error(e);server.close();process.exitCode=1});
