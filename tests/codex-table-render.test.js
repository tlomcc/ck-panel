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
const table = '核查结果如下：\n\n| 来源 | 归属 | 分类 |\n|:---|:---:|---:|\n| ipinfo | 洛杉矶，NTT America（AS2914） | 免费接口不提供分类 |\n| a\\|b | 只有两格 |\n\n以上是全部结果。';
const wide = '| ' + Array.from({length:9}, (_, i) => '第' + (i + 1) + '列标题').join(' | ') + ' |\n|' + '---|'.repeat(9) + '\n| ' + Array.from({length:9}, (_, i) => '内容' + i).join(' | ') + ' |';
const items = [
  {id:'user',kind:'userMessage',text:'| 甲 | 乙 |\n|---|---|\n| 1 | 2 |',data:{},created:1},
  {id:'table',kind:'agentMessage',text:table,data:{},created:2},
  {id:'fence',kind:'agentMessage',text:'示例：\n```\n| 甲 | 乙 |\n|---|---|\n| 1 | 2 |\n```',data:{},created:3},
  {id:'rule',kind:'agentMessage',text:'甲 | 乙\n---\n不是表格',data:{},created:4},
  {id:'wide',kind:'agentMessage',text:wide,data:{},created:5},
  {id:'ask',kind:'agentMessage',text:'| 方案 | 说明 |\n|---|---|\n| 甲 | 快 |\n\n选哪个方案？\n1. 方案甲\n2. 方案乙',data:{},created:6}
];
(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const browser = await chromium.launch({args:['--no-sandbox','--disable-dev-shm-usage']});
  try {
    for (const width of [390, 1280]) {
      const context = await browser.newContext({viewport:{width,height:900}, serviceWorkers:'block'});
      await context.addInitScript(() => { localStorage.setItem('ck_codex_access','test'); localStorage.setItem('ck_codex_endpoint','https://codex.test/codex'); });
      const page = await context.newPage(), errors = [];
      page.on('pageerror', e => errors.push(e.message));
      const w = {id:'window-one',title:'测试窗口',profile:'p',thread_id:'native',status:'completed',updated:1,seq:1};
      await page.route('https://codex.test/codex/**', async route => {
        const url = new URL(route.request().url()); let result = {};
        if (url.pathname.endsWith('/config')) result = {profiles:[{id:'p',name:'测试接口',model:'model-a',base_url:'https://test/v1',effort:'high',has_key:true}],default_profile:'p',workspace:'/workspace'};
        else if (url.pathname.endsWith('/threads')) result = {windows:[w]};
        else if (url.pathname.includes('/threads/')) result = {window:w,items,cursor:1};
        await route.fulfill({json:result});
      });
      await page.goto('http://127.0.0.1:' + server.address().port + '/#codex-tasks');
      await page.locator('[data-item-id=ask]').waitFor();
      const item = id => page.locator('[data-item-id=' + id + ']');
      // A reply table is a real table between the untouched text around it.
      assert.deepEqual(await item('table').locator('.cx-text').allTextContents(), ['核查结果如下：', '以上是全部结果。']);
      assert.deepEqual(await item('table').locator('th').allTextContents(), ['来源', '归属', '分类']);
      assert.deepEqual(await item('table').locator('tbody tr').evaluateAll(rows => rows.map(r => [...r.cells].map(c => c.textContent))),
        [['ipinfo', '洛杉矶，NTT America（AS2914）', '免费接口不提供分类'], ['a|b', '只有两格', '']]);
      assert.deepEqual(await item('table').locator('th').evaluateAll(cells => cells.map(c => getComputedStyle(c).textAlign)), ['left', 'center', 'right']);
      assert(!(await item('table').innerText()).includes('---'));
      // Only replies are converted; code blocks, rules and your own messages stay as written.
      assert.equal(await page.evaluate(() => document.querySelectorAll('.cx-table').length), 3);
      for (const id of ['user', 'fence', 'rule']) assert.equal(await item(id).locator('table').count(), 0);
      assert.equal(await item('user').locator('.cx-text').textContent(), items[0].text);
      assert.equal(await item('fence').locator('.cx-text').textContent(), items[2].text);
      assert.equal(await item('rule').locator('.cx-text').textContent(), items[3].text);
      assert.equal(await item('ask').locator('table').count(), 1);
      assert.equal(await item('ask').locator('.cx-text-question .cx-choice-row').count(), 2);
      for (const dark of [false, true]) {
        await page.evaluate(d => document.body.classList.toggle('dark', d), dark);
        const layout = await page.evaluate(() => {
          const feed = document.getElementById('cx-feed'), box = feed.getBoundingClientRect();
          const wraps = [...feed.querySelectorAll('.cx-table-wrap')].map(e => { const r = e.getBoundingClientRect(); return {inside:r.left >= box.left && r.right <= box.right, scrolls:e.scrollWidth > e.clientWidth + 1}; });
          const head = getComputedStyle(feed.querySelector('.cx-table th')), cell = getComputedStyle(feed.querySelector('.cx-table td'));
          return {wraps, feedFits:feed.scrollWidth <= feed.clientWidth, pageFits:document.documentElement.scrollWidth <= innerWidth, head:head.backgroundColor, text:head.color, line:cell.borderBottomColor,
            columns:[...feed.querySelector('.cx-table').rows[0].cells].map(c => Math.round(c.getBoundingClientRect().width))};
        });
        assert(layout.wraps.every(wrap => wrap.inside) && layout.feedFits && layout.pageFits, JSON.stringify(layout));
        assert.equal(layout.wraps[0].scrolls, false);
        if (width < 640) assert.equal(layout.wraps[1].scrolls, true);
        assert.notEqual(layout.head, 'rgba(0, 0, 0, 0)');assert.notEqual(layout.head, layout.text);
        console.log(JSON.stringify({width, dark, columns:layout.columns, head:layout.head, text:layout.text, line:layout.line}));
      }
      if (process.env.CK_TABLE_SHOT) await item('table').screenshot({path:process.env.CK_TABLE_SHOT + '-' + width + '.png'});
      assert.deepEqual(errors, []);
      await context.close();
    }
    console.log('codex table render ok');
  } finally { await browser.close(); server.close(); }
})().catch(error => { console.error(error); process.exit(1); });
