const {chromium}=require('playwright');
const fs=require('fs'),path=require('path'),http=require('http'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');
const out=process.env.CK_BROWSER_OUTPUT||fs.mkdtempSync(path.join(require('os').tmpdir(),'ck-subscription-quota-'));
fs.mkdirSync(out,{recursive:true});
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
 const results=[];
 try{for(const [width,dark] of [[320,false],[390,false],[1280,false],[390,true],[1280,true]]){
  const page=await browser.newPage({viewport:{width,height:900}}),errors=[];
  await page.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
  page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://127.0.0.1:'+server.address().port);
  await page.waitForFunction(()=>typeof chatRenderMessages==='function'&&typeof CKChatHistory==='object');
  await page.evaluate(d=>document.body.classList.toggle('dark',d),dark);
  const result=await page.evaluate(fs.readFileSync(path.join(__dirname,'fixtures/subscription.js'),'utf8'));
  assert.deepEqual(errors,[]);assert(result.replyRefresh&&result.accountRace&&result.policySaved);
  await page.screenshot({path:path.join(out,'quota-'+width+'-'+dark+'.png')});
  results.push({width,dark,...result});console.log(width+' '+dark+': subscription quota browser checks PASS');
  await page.close();
 }
 fs.writeFileSync(path.join(out,'results.json'),JSON.stringify(results,null,2));
 }finally{await browser.close();server.close()}
})().catch(e=>{console.error(e);server.close();process.exitCode=1});
