const {chromium}=require('playwright');
const fs=require('fs'),path=require('path'),http=require('http'),assert=require('node:assert/strict');
const root=path.resolve(process.env.CK_QUOTA_TEST_ROOT||path.join(__dirname,'..'));
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
  const views=[];
  for(const mode of ['last-known','unavailable','expired']){
   views.push(await page.evaluate(mode=>window.__subscriptionPreview(mode),mode));
   await page.screenshot({path:path.join(out,'quota-'+width+'-'+dark+'-'+mode+'.png')});
  }
  await page.evaluate(()=>window.__subscriptionPreview('last-known'));
  await page.locator('#ck-sub-close').click();
  const inline=page.locator('#ck-sub-inline');
  await inline.scrollIntoViewIfNeeded();
  const inlineState=await inline.evaluate(el=>({tag:el.tagName,tabIndex:el.tabIndex,handler:el.hasAttribute('onclick')||!!el.onclick,popup:el.hasAttribute('aria-haspopup'),cursor:getComputedStyle(el).cursor,tooltip:el.title===el.textContent&&!el.title.includes('点击')}));
  assert.deepEqual(inlineState,{tag:'DIV',tabIndex:-1,handler:false,popup:false,cursor:'default',tooltip:true},'inline quota is display only');
  await inline.click();
  assert.equal(await page.evaluate(()=>document.getElementById('ck-sub-dialog').classList.contains('show')||document.activeElement===document.getElementById('ck-sub-inline')),false,'clicking the inline quota neither opens details nor takes focus');
  const inlineGeometry=await inline.evaluate(el=>({left:el.getBoundingClientRect().left,right:el.getBoundingClientRect().right,scroll:el.scrollWidth,client:el.clientWidth}));
  assert(inlineGeometry.left>=0&&inlineGeometry.right<=width&&inlineGeometry.scroll<=inlineGeometry.client+1,'inline quota fits the viewport');
  await page.locator('.chat-compose').screenshot({path:path.join(out,'quota-inline-'+width+'-'+dark+'.png')});
  assert.deepEqual(errors,[]);
  results.push({width,dark,...result,views,inlineGeometry});console.log(width+' '+dark+': subscription quota browser checks PASS');
  await page.close();
 }
 fs.writeFileSync(path.join(out,'results.json'),JSON.stringify(results,null,2));
 }finally{await browser.close();server.close()}
})().catch(e=>{console.error(e);server.close();process.exitCode=1});
