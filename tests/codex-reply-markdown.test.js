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
const table = '核查结果如下：\n\n| 来源 | 归属 | 分类 |\n|:---|:---:|---:|\n| `ipinfo` | **洛杉矶**，NTT America（AS2914） | 免费接口不提供分类 |\n| a\\|b | 只有两格 |\n\n以上是全部结果。';
const wide = '| ' + Array.from({length:9}, (_, i) => '第' + (i + 1) + '列标题').join(' | ') + ' |\n|' + '---|'.repeat(9) + '\n| ' + Array.from({length:9}, (_, i) => '内容' + i).join(' | ') + ' |';
const prose = '## 核查结论\n\n出口 **正常**，文件 `sw.js` 已更新，~~旧版~~作废，详见 [说明](https://example.com/a)。\n第二行紧跟上一行。\n\n- 第一项\n- 第二项 `code`\n\n3. 第三步\n4. 第四步\n\n> 引用内容\n\n<img src=x onerror="window.injected=1"> <b>原样</b>';
const code = 'const a = "<b>" && 1 | 2;\n  **不加粗**';
const items = [
  {id:'user',kind:'userMessage',text:'## 标题\n| 甲 | 乙 |\n|---|---|\n| **1** | 2 |',data:{},created:1},
  {id:'table',kind:'agentMessage',text:table,data:{},created:2},
  {id:'fence',kind:'agentMessage',text:'示例：\n```js\n' + code + '\n```\n```\n| 甲 | 乙 |\n|---|---|\n| 1 | 2 |\n```',data:{},created:3},
  {id:'rule',kind:'agentMessage',text:'甲 | 乙\n---\n不是表格\n\n---\n\n结尾',data:{},created:4},
  {id:'wide',kind:'agentMessage',text:wide,data:{},created:5},
  {id:'ask',kind:'agentMessage',text:'| 方案 | 说明 |\n|---|---|\n| 甲 | 快 |\n\n选哪个 **方案**？\n1. 方案 `甲`\n2. 方案乙',data:{},created:6},
  {id:'prose',kind:'agentMessage',text:prose,data:{},created:7},
  {id:'warn',kind:'warning',text:'**提示** `原样`',data:{},created:8}
];
(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const browser = await chromium.launch({args:['--no-sandbox','--disable-dev-shm-usage']});
  try {
    for (const width of [390, 1280]) {
      const context = await browser.newContext({viewport:{width,height:900}, serviceWorkers:'block'});
      await context.addInitScript(() => { localStorage.setItem('ck_codex_access','test'); localStorage.setItem('ck_codex_endpoint','https://codex.test/codex'); window.copied = []; Object.defineProperty(navigator, 'clipboard', {value:{writeText:async text => { window.copied.push(text); }}}); });
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
      await page.locator('[data-item-id=warn]').waitFor();
      const item = id => page.locator('[data-item-id=' + id + ']');
      const texts = (id, selector) => item(id).locator(selector).allTextContents();
      // A reply table is a real table between the text around it, with inline marks rendered in its cells.
      assert.deepEqual(await texts('table', '.cx-text'), ['核查结果如下：', '以上是全部结果。']);
      assert.deepEqual(await texts('table', 'th'), ['来源', '归属', '分类']);
      assert.deepEqual(await item('table').locator('tbody tr').evaluateAll(rows => rows.map(r => [...r.cells].map(c => c.textContent))),
        [['ipinfo', '洛杉矶，NTT America（AS2914）', '免费接口不提供分类'], ['a|b', '只有两格', '']]);
      assert.deepEqual(await item('table').locator('th').evaluateAll(cells => cells.map(c => getComputedStyle(c).textAlign)), ['left', 'center', 'right']);
      assert.deepEqual([await texts('table', 'td code'), await texts('table', 'td strong')], [['ipinfo'], ['洛杉矶']]);
      assert(!(await item('table').innerText()).includes('---'));
      assert.equal(await page.locator('.cx-table').count(), 3);
      // Headings, emphasis, code, lists, quotes and links are rendered; markup in the text is shown, never run.
      assert.deepEqual([await texts('prose', 'h2'), await texts('prose', 'p strong'), await texts('prose', 'p code'), await texts('prose', 'del')], [['核查结论'], ['正常'], ['sw.js'], ['旧版']]);
      assert.deepEqual([await texts('prose', 'ul li'), await texts('prose', 'ol li'), await texts('prose', 'blockquote')], [['第一项', '第二项 code'], ['第三步', '第四步'], ['引用内容']]);
      assert.equal(await item('prose').locator('ol').getAttribute('start'), '3');
      assert.deepEqual(await item('prose').locator('a').evaluateAll(links => links.map(a => [a.textContent, a.href, a.target, a.rel])), [['说明', 'https://example.com/a', '_blank', 'noopener noreferrer']]);
      assert.equal(await item('prose').locator('p').first().locator('br').count(), 1);
      assert.deepEqual([await item('prose').locator('.cx-text').locator('img,b').count(), await page.evaluate(() => window.injected)], [0, undefined]);
      assert((await item('prose').innerText()).includes('<img src=x onerror="window.injected=1"> <b>原样</b>'));
      for (const mark of ['##', '**', '`', '~~', '](']) assert(!(await item('prose').locator('h2,p:not(:last-child),ul,ol,blockquote').allInnerTexts()).join('').includes(mark), mark);
      const style = await item('prose').evaluate(el => { const css = s => getComputedStyle(el.querySelector(s)); return {heading:parseFloat(css('h2').fontSize) > parseFloat(css('p').fontSize), bold:+css('p strong').fontWeight >= 600, bullet:css('ul').listStyleType, number:css('ol').listStyleType, code:css('p code').backgroundColor}; });
      assert.deepEqual([style.heading, style.bold, style.bullet, style.number], [true, true, 'disc', 'decimal']);assert.notEqual(style.code, 'rgba(0, 0, 0, 0)');
      // Code blocks keep their text exactly and copy it; nothing inside is converted.
      assert.deepEqual(await texts('fence', '.cb pre code'), [code, '| 甲 | 乙 |\n|---|---|\n| 1 | 2 |']);
      assert.deepEqual([await texts('fence', '.cb-lang'), await item('fence').locator('.cx-text').locator('table,strong').count()], [['js', 'code'], 0]);
      await item('fence').locator('.cb .cx-copy').first().click();await page.waitForFunction(() => window.copied.length === 1);
      assert.equal(await page.evaluate(() => window.copied[0]), code);
      await item('prose').locator('.cx-item-head .cx-copy').click();await page.waitForFunction(() => window.copied.length === 2);
      assert.equal(await page.evaluate(() => window.copied[1]), prose);
      // A dash line under text is not a table; on its own it is a divider. Your own messages and notices stay as written.
      assert.deepEqual([await item('rule').locator('table').count(), await item('rule').locator('hr').count(), await texts('rule', 'p')], [0, 1, ['甲 | 乙---不是表格', '结尾']]);
      assert.equal(await item('user').locator('.cx-text').textContent(), items[0].text);
      assert.equal(await item('warn').locator('.cx-text').textContent(), items[7].text);
      assert.equal(await item('user').locator('.cx-text').locator('table,h2,strong').count() + await item('warn').locator('.cx-text').locator('strong,code').count(), 0);
      // Choice questions keep their box, with inline marks rendered and the original option text copied.
      assert.equal(await item('ask').locator('table').count(), 1);
      assert.deepEqual([await texts('ask', '.cx-text-question .cx-text strong'), await texts('ask', '.cx-option-text'), await texts('ask', '.cx-option-text code')], [['方案'], ['方案 甲', '方案乙'], ['甲']]);
      await item('ask').locator('.cx-choice-row .cx-copy').first().click();await page.waitForFunction(() => window.copied.length === 3);
      assert.equal(await page.evaluate(() => window.copied[2]), '方案 `甲`');
      for (const dark of [false, true]) {
        await page.evaluate(d => document.body.classList.toggle('dark', d), dark);
        const layout = await page.evaluate(() => {
          const feed = document.getElementById('cx-feed'), box = feed.getBoundingClientRect();
          const inside = s => [...feed.querySelectorAll(s)].every(e => { const r = e.getBoundingClientRect(); return r.left >= box.left && r.right <= box.right; });
          const wraps = [...feed.querySelectorAll('.cx-table-wrap')].map(e => e.scrollWidth > e.clientWidth + 1);
          const head = getComputedStyle(feed.querySelector('.cx-table th')), block = getComputedStyle(feed.querySelector('.cb'));
          return {inside:inside('.cx-table-wrap,.cb,.cx-text,.cx-md h2,.cx-md li'), wraps, feedFits:feed.scrollWidth <= feed.clientWidth, pageFits:document.documentElement.scrollWidth <= innerWidth, head:head.backgroundColor, text:head.color, block:block.borderTopColor,
            columns:[...feed.querySelector('.cx-table').rows[0].cells].map(c => Math.round(c.getBoundingClientRect().width))};
        });
        assert(layout.inside && layout.feedFits && layout.pageFits, JSON.stringify(layout));
        assert.equal(layout.wraps[0], false);
        if (width < 640) assert.equal(layout.wraps[1], true);
        assert.notEqual(layout.head, 'rgba(0, 0, 0, 0)');assert.notEqual(layout.head, layout.text);
        console.log(JSON.stringify({width, dark, columns:layout.columns, head:layout.head, text:layout.text, block:layout.block}));
      }
      assert.deepEqual(errors, []);
      await context.close();
    }
    console.log('codex reply markdown ok');
  } finally { await browser.close(); server.close(); }
})().catch(error => { console.error(error); process.exit(1); });
