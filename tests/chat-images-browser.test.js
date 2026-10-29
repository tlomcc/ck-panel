const fs=require('fs'),path=require('path'),http=require('http'),assert=require('assert');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'..'),out=process.env.CK_IMAGE_TEST_OUT||fs.mkdtempSync(path.join(require('os').tmpdir(),'ck-image-browser-'));
fs.mkdirSync(out,{recursive:true});
const source=fs.readFileSync(path.join(root,'script.js'),'utf8');
const constants=source.split('\n').filter(s=>/^var CHAT_IMAGE_|^var chatImageSeq=/.test(s)).join('\n');
const helpers=constants+'\n'+source.slice(source.indexOf('function chatImageId(){'),source.indexOf('function chatCloneImageListForVersion('))+
  source.slice(source.indexOf('function chatImageContentBlock('),source.indexOf('function chatMessageContentParts('))+
  source.slice(source.indexOf('function chatReadFileAsDataUrl('),source.indexOf('function chatIndexedDbSupported('));
const server=http.createServer((req,res)=>{res.setHeader('Content-Type','text/html');res.end('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><input id="chat-image-input" type="file" accept="image/*" multiple><div id="drafts"></div>')});
(async()=>{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const browser=await chromium.launch({args:['--no-sandbox','--disable-dev-shm-usage']});
 try{
  const page=await browser.newPage({viewport:{width:390,height:850},serviceWorkers:'block'}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
  await page.goto('http://127.0.0.1:'+server.address().port);
  await page.addScriptTag({content:helpers+[
    "var chatSending=false,chatImageEncodingCount=0,chatEditingIndex=-1,chatEditingImages=[],chatDraftImages=[];",
    "var chatActiveSessionId='fixture',chatAttachmentSessionEpoch=0,notices=[];",
    "function toast(value){notices.push(value)}",
    "function chatSetStatus(){}",
    "function chatTogglePlus(){}",
    "function chatRenderEditImages(){}",
    "function chatRenderDraftImages(){var box=document.getElementById('drafts');box.replaceChildren();chatDraftImages.forEach(function(file){var img=document.createElement('img');img.src=file.dataUrl;img.style.maxWidth='100%';box.appendChild(img)})}"
  ].join('\n')});
  const results=await page.evaluate(async()=>{
   const rows=[],check=(ok,message)=>{if(!ok)throw Error(message)};
   const run=async(name,fn)=>{try{await fn();rows.push({name,ok:true})}catch(e){rows.push({name,ok:false,error:e.message})}};
   const canvas=document.createElement('canvas');canvas.width=640;canvas.height=480;
   const ctx=canvas.getContext('2d');ctx.fillStyle='#326382';ctx.fillRect(0,0,640,480);ctx.fillStyle='#fff';ctx.font='32px sans-serif';ctx.fillText('CK image check',60,120);
   const blobs={};for(const mime of ['image/png','image/jpeg','image/webp'])blobs[mime]=await new Promise(r=>canvas.toBlob(r,mime));
   const png=new File([blobs['image/png']],'check.png',{type:'image/png'});
   async function decoded(file){
     const result=await chatEncodeImageFile(file),block=chatImageContentBlock(result);
     check(block&&block.type==='image_url','attachment missing from outgoing content');
     check(block.image_url.url===result.dataUrl,'outgoing image changed');
     const img=new Image();await new Promise((r,j)=>{img.onload=r;img.onerror=()=>j(Error('outgoing image cannot decode'));img.src=block.image_url.url});
     check(img.width===result.width&&img.height===result.height,'dimensions differ');
     check(result.dataUrl.length<=CHAT_IMAGE_MAX_DATA_URL_CHARS,'payload too large');
     return result;
   }
   for(const mime of Object.keys(blobs))for(const declared of [mime,'','application/octet-stream']){
     await run(mime+' / '+(declared||'missing MIME'),async()=>{
       const result=await decoded(new File([blobs[mime]],'picker-image',{type:declared}));
       check(result.mime==='image/jpeg'&&result.width===640&&result.height===480,'unexpected encoded result');
     });
   }
   await run('wrong GIF label uses actual PNG bytes',async()=>check((await decoded(new File([blobs['image/png']],'wrong.gif',{type:'image/gif'}))).mime==='image/jpeg','wrong raw format was retained'));
   await run('valid GIF keeps original animation bytes',async()=>{
     const raw=Uint8Array.from(atob('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'),c=>c.charCodeAt(0));
     const result=await decoded(new File([raw],'animation.gif',{type:''}));
     check(result.mime==='image/gif','GIF was flattened');check(atob(result.dataUrl.split(',')[1]).length===raw.length,'GIF bytes changed');
   });
   await run('direct file decode works when data URLs fail',async()=>{
     const old=chatReadFileAsDataUrl;chatReadFileAsDataUrl=async()=>{throw Error('fixture data URL failure')};
     try{await decoded(png)}finally{chatReadFileAsDataUrl=old}
   });
   await run('bitmap fallback decodes and releases pixels',async()=>{
     const old=chatLoadImageFromDataUrl,native=createImageBitmap;let closed=0;
     chatLoadImageFromDataUrl=async url=>{if(url.startsWith('blob:'))throw Error('fixture blob URL failure');return old(url)};
     window.createImageBitmap=async(...args)=>{const bitmap=await native(...args),close=bitmap.close.bind(bitmap);bitmap.close=()=>{closed++;close()};return bitmap};
     try{await decoded(png);check(closed===1,'bitmap was not released')}finally{chatLoadImageFromDataUrl=old;window.createImageBitmap=native}
   });
   await run('data URL fallback when other decoders fail',async()=>{
     const old=chatLoadImageFromDataUrl,native=createImageBitmap;
     chatLoadImageFromDataUrl=async url=>{if(url.startsWith('blob:'))throw Error('fixture blob URL failure');return old(url)};
     window.createImageBitmap=async()=>{throw Error('fixture bitmap failure')};
     try{await decoded(png)}finally{chatLoadImageFromDataUrl=old;window.createImageBitmap=native}
   });
   await run('damaged image and invalid GIF never become attachments',async()=>{
     for(const mime of ['image/png','image/gif']){
       let error;try{await chatEncodeImageFile(new File(['not an image'],'broken',{type:mime}))}catch(e){error=e}
       check(error&&/JPEG|PNG/.test(error.message),'damaged image was accepted or has no recovery hint');
     }
   });
   await run('unsupported HEIC explains how to resend',async()=>{
     const raw=new Uint8Array(40);raw.set([0,0,0,40]);raw.set(Array.from('ftypheic',c=>c.charCodeAt(0)),4);
     let error;try{await chatEncodeImageFile(new File([raw],'photo.heic',{type:'image/jpeg'}))}catch(e){error=e}
     check(error&&/HEIC\/HEIF/.test(error.message)&&/JPEG/.test(error.message),'missing format-specific hint');
   });
   await run('size limits and empty files remain enforced',async()=>{
     for(const file of [new File([],'empty.png',{type:'image/png'}),new File([new Uint8Array(CHAT_IMAGE_MAX_SOURCE_BYTES+1)],'large.png',{type:'image/png'})]){
       let rejected=false;try{await chatEncodeImageFile(file)}catch(e){rejected=true}check(rejected,'invalid size accepted');
     }
   });
   await run('large image shrinks with aspect ratio intact',async()=>{
     const big=document.createElement('canvas');big.width=3200;big.height=2400;big.getContext('2d').fillRect(0,0,3200,2400);
     const blob=await new Promise(r=>big.toBlob(r,'image/jpeg'));
     const result=await decoded(new File([blob],'large-photo.jpg',{type:'image/jpeg'}));
     check(result.width===2048&&result.height===1536,'wrong scaled dimensions');
   });
   await run('canvas failure cannot send an empty data URL',async()=>{
     const old=chatCanvasEncodeLoadedImage;chatCanvasEncodeLoadedImage=()=>({dataUrl:'data:,',width:1,height:1});
     try{let rejected=false;try{await chatEncodeImageFile(png)}catch(e){rejected=true}check(rejected,'empty image accepted')}finally{chatCanvasEncodeLoadedImage=old}
   });
   await run('picker keeps file handle until decoding completes',async()=>{
     const input=document.getElementById('chat-image-input'),transfer=new DataTransfer();transfer.items.add(png);input.files=transfer.files;
     const old=chatReadImageMime;let retained=false;chatReadImageMime=async file=>{retained=input.value!=='';return old(file)};
     chatDraftImages=[];
     try{await chatOnImageFilesSelected({target:input});check(retained,'picker reset before reading');check(input.value==='','picker not reset');check(chatDraftImages.length===1,'image missing');check(chatImageEncodingCount===0,'encoding counter leaked')}finally{chatReadImageMime=old}
   });
   await run('switching session while decoding never leaks attachment',async()=>{
     const input=document.getElementById('chat-image-input'),transfer=new DataTransfer();transfer.items.add(png);input.files=transfer.files;
     const old=chatEncodeImageFile,result=await old(png);let release;
     chatEncodeImageFile=()=>new Promise(r=>release=r);chatDraftImages=[];
     try{const pending=chatOnImageFilesSelected({target:input});chatActiveSessionId='other';release(result);await pending;check(chatDraftImages.length===0,'attachment crossed session');check(chatImageEncodingCount===0,'encoding counter leaked')}finally{chatEncodeImageFile=old;chatActiveSessionId='fixture'}
   });
   await run('later picker selection is not cleared by earlier work',async()=>{
     const input=document.getElementById('chat-image-input'),first=new DataTransfer();first.items.add(png);input.files=first.files;
     const old=chatEncodeImageFile,result=await old(png);let release;
     chatEncodeImageFile=()=>new Promise(r=>release=r);chatDraftImages=[];
     try{const pending=chatOnImageFilesSelected({target:input});const later=new DataTransfer();later.items.add(new File([blobs['image/jpeg']],'later.jpg',{type:'image/jpeg'}));input.files=later.files;release(result);await pending;check(input.files[0].name==='later.jpg','newer selection was cleared')}finally{chatEncodeImageFile=old;input.value=''}
   });
   return rows;
  });
  await page.screenshot({path:path.join(out,'image-preview-390.png'),fullPage:true});
  const result={checks:results,passed:results.filter(x=>x.ok).length,total:results.length,page_errors:errors,engine:'chromium',official_requests:0};
  fs.writeFileSync(path.join(out,'image-browser-verification.json'),JSON.stringify(result,null,2));
  console.log(JSON.stringify(result));assert.deepEqual(errors,[]);assert(results.every(x=>x.ok),'image checks failed');
 }finally{await browser.close();server.close()}
})().catch(e=>{console.error(e);server.close();process.exitCode=1});
