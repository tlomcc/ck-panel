const { chromium } = require('playwright');
const fs = require('fs'), path = require('path'), http = require('http'), assert = require('assert');
const root = path.resolve(__dirname, '..');
const server = http.createServer((req, res) => {
  const name = new URL(req.url, 'http://localhost').pathname.slice(1) || 'index.html';
  const file = path.resolve(root, name);
  if (!file.startsWith(root + '/') || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404); return res.end(); }
  res.setHeader('Content-Type', name.endsWith('.js') ? 'text/javascript' : name.endsWith('.css') ? 'text/css' : name.endsWith('.json') ? 'application/json' : 'text/html');
  res.end(fs.readFileSync(file));
});
(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const browser = await chromium.launch({args:['--no-sandbox']});
  try {
    for (const width of [390, 1280]) {
      const context = await browser.newContext({viewport:{width,height:900}, serviceWorkers:'block'});
      await context.addInitScript(() => { localStorage.setItem('ck_codex_access','test'); localStorage.setItem('ck_codex_endpoint','https://codex.test/codex'); });
      const page = await context.newPage();
      const w = {id:'window-one',title:'测试窗口',profile:'p',thread_id:'native',status:'completed',updated:1};
      let seq=1, kind='request';
      const items = () => [
        {id:'text',kind:'agentMessage',text:'完整文字内容。'.repeat(1500),data:{},created:1},
        {id:'cmd',kind:'commandExecution',text:'RAW_OUTPUT',data:{command:'PRIVATE_COMMAND',status:'running'},created:2},
        {id:'file',kind:'fileChange',text:'PRIVATE_DIFF',data:{changes:[{path:'PRIVATE_PATH'}]},created:3},
        {id:'diff',kind:'diff',text:'PRIVATE_PATCH',data:{},created:4},
        {id:'tool',kind:'mcpToolCall',text:'RAW_TOOL_PAYLOAD',data:{},created:5},
        {id:'q',kind,seq,text:'',data:{id:'q1',method:'item/tool/requestUserInput',params:{questions:[{id:'q',question:'请选择执行范围',options:[{label:'仅本次'}]}]}},created:6}
      ];
      await page.route('https://codex.test/codex/**', async route => {
        const url=new URL(route.request().url()); let result={};
        if(url.pathname.endsWith('/config'))result={profiles:[{id:'p',name:'测试接口',model:'model-a',base_url:'https://test/v1',effort:'high',has_key:true}],default_profile:'p',workspace:'/workspace'};
        else if(url.pathname.endsWith('/threads'))result={windows:[w]};
        else if(url.pathname.endsWith('/models'))result={models:['model-a','model-b','model-c']};
        else if(url.pathname.endsWith('/answer')){kind='resolved';seq++;}
        else if(url.pathname.includes('/threads/'))result={window:w,items:items(),cursor:seq++};
        await route.fulfill({json:result});
      });
      await page.goto('http://127.0.0.1:'+server.address().port+'/#codex-tasks');
      await page.locator('.cx-item-agentMessage').waitFor();
      assert.equal(await page.locator('.cx-item-agentMessage .cx-text').textContent(),'完整文字内容。'.repeat(1500));
      for(const text of ['PRIVATE_COMMAND','PRIVATE_PATH','PRIVATE_DIFF','PRIVATE_PATCH','RAW_TOOL_PAYLOAD','RAW_OUTPUT'])assert(!(await page.locator('#cx-feed').innerText()).includes(text));
      assert.equal(await page.locator('.cx-detail summary').first().textContent(),'执行命令');
      assert.equal(await page.locator('.cx-detail[open]').count(),0);
      await page.locator('#cx-refresh').click();
      await page.waitForTimeout(300);
      assert.equal(await page.locator('.cx-detail[open]').count(),0);
      await page.locator('.cx-question[role=alert]').waitFor();
      await page.waitForFunction(()=>{const e=document.querySelector('.cx-question');return e&&getComputedStyle(e).borderLeftWidth==='6px';});
      await page.getByRole('button',{name:'仅本次',exact:true}).click();
      assert.equal(await page.locator('.cx-question textarea').inputValue(),'仅本次');
      await page.getByRole('button',{name:'回复并继续',exact:true}).click();
      await page.locator('.cx-question').waitFor({state:'detached'});
      await page.locator('.cx-compose-bar .ck-select-button').click();
      await page.locator('dialog.cx-picker[open]').waitFor();
      assert(await page.locator('dialog.cx-picker').evaluate(e=>e.matches(':modal')));
      await page.locator('dialog.cx-picker').getByRole('button',{name:'测试接口 · model-a',exact:true}).click();
      await page.locator('#cx-tab-api').click();
      await page.locator('.cx-profile-grid .ck-select-button').click();
      await page.locator('dialog.cx-picker').getByRole('button',{name:'中',exact:true}).click();
      await page.waitForFunction(()=>document.querySelector('[name=effort]').value==='medium');
      await page.getByRole('button',{name:'选择模型',exact:true}).click();
      await page.locator('dialog.cx-picker[open]').waitFor();
      await page.locator('dialog.cx-picker input').fill('model-b');
      await page.locator('dialog.cx-picker').getByRole('button',{name:'model-b',exact:true}).click();
      await page.waitForFunction(()=>document.querySelector('[name=model]').value==='model-b');
      await page.getByRole('button',{name:'选择模型',exact:true}).click();
      await page.keyboard.press('Escape');
      await page.locator('dialog[open]').waitFor({state:'detached'});
      assert(await page.locator('.cx-overlay').isVisible());
      assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
      console.log('Codex UI '+width+': text, folding, questions, selectors, model search, Escape PASS');
      await context.close();
    }
  } finally { await browser.close(); server.close(); }
})().catch(e=>{console.error(e);server.close();process.exitCode=1;});
