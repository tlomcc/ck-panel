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
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({args: ['--no-sandbox', '--disable-dev-shm-usage']});
  try {
    for (const width of [320, 390, 1280]) {
      const context = await browser.newContext({viewport: {width, height: 900}, serviceWorkers: 'block'});
      await context.addInitScript(() => {
        localStorage.setItem('ck_codex_access', 'fixture-access');
        localStorage.setItem('ck_task_engine', 'claude');
        localStorage.setItem('ck_claude_endpoint', 'https://claude.test/claude-tasks');
      });
      const page = await context.newPage(), errors = [], posts = [];
      page.on('pageerror', e => errors.push(e.message));
      const profile = '75c76315-eb66-4fa0-ab6d-f0d2b9ef344e';
      const config = {profiles: [{id: profile, name: 'Any', model: 'claude-opus-5-5[1m]', base_url: 'https://provider.test/v1', effort: 'high', has_key: true}],
        default_profile: profile, workspace: '/workspace', shared_providers: true, steer_mode: 'after_response'};
      let window = {id: 'feedback-fixture', title: '反馈验证', profile, status: 'idle', updated: 1, seq: 1}, items = [];
      function status(state, text) {
        window.seq++; window.updated = Date.now() / 1000;
        const item = {id: 'cc-status:fixture-turn', kind: 'warning', text, data: {state}, seq: window.seq, created: 2};
        items = items.filter(i => i.id !== item.id).concat(item);
      }
      await page.route('**/*', async route => {
        const request = route.request(), url = new URL(request.url());
        if (url.hostname === '127.0.0.1') return route.continue();
        if (url.hostname !== 'claude.test') return route.abort();
        const endpoint = url.pathname.replace('/claude-tasks', '');
        let result;
        if (endpoint === '/config') result = config;
        else if (endpoint === '/threads') result = {windows: [window]};
        else if (endpoint === '/threads/feedback-fixture/send') {
          posts.push(request.postDataJSON());
          window = {...window, status: 'running', seq: window.seq + 1};
          items.push({id: 'user:fixture', kind: 'userMessage', text: posts[0].text, data: {}, seq: window.seq, created: 1});
          status('starting', '任务已收到，正在国内 VPS 启动 Claude Code。');
          result = window;
        } else if (endpoint === '/threads/feedback-fixture') {
          const after = Number(url.searchParams.get('after') || 0);
          result = {window, cursor: window.seq, items: items.filter(i => i.seq > after), schedules: []};
        } else return route.fulfill({status: 404, json: {error: 'Unexpected fixture endpoint'}});
        await route.fulfill({json: result});
      });
      await page.goto('http://127.0.0.1:' + server.address().port + '/#claude-tasks');
      await page.locator('#cx-send:not([disabled])').waitFor();
      await page.locator('#cx-input').fill('本地反馈验证任务');
      await page.locator('#cx-send').click();
      const card = page.locator('[data-item-id="cc-status:fixture-turn"]');
      await card.getByText('任务已收到，正在国内 VPS 启动 Claude Code。', {exact: true}).waitFor();
      assert.equal(posts.length, 1);
      status('retrying', '供应商返回 HTTP 429，Claude Code 正在按原版策略重试。\n第 1 / 10 次重试。\n约 30 秒后重试。');
      await page.waitForFunction(() => document.querySelector('[data-item-id="cc-status:fixture-turn"]')?.textContent.includes('第 1 / 10 次'));
      await page.waitForTimeout(4300); // The transient submit toast is gone; task feedback must remain.
      assert(await card.isVisible());
      assert((await card.innerText()).includes('HTTP 429'));
      assert.equal(await page.locator('#cx-feed .cx-item-agentMessage').count(), 0);
      status('retrying', '供应商返回 HTTP 429，正在等待重试结果。\n本次任务已用时 45 秒。');
      await page.waitForFunction(() => document.querySelector('[data-item-id="cc-status:fixture-turn"]')?.textContent.includes('45 秒'));
      assert.equal(await page.locator('[data-item-id="cc-status:fixture-turn"]').count(), 1);
      status('failed', '本次任务失败，具体报错见下方。');
      window = {...window, status: 'failed', error: '供应商返回 HTTP 429，本次任务未完成。', seq: window.seq + 1};
      items.push({id: 'error:fixture', kind: 'error', text: window.error, data: {}, seq: window.seq, created: 3});
      await page.locator('#cx-feed .cx-item-error').getByText(window.error, {exact: true}).waitFor();
      if (process.env.CK_SCREENSHOT_DIR) {
        fs.mkdirSync(process.env.CK_SCREENSHOT_DIR, {recursive: true});
        await page.screenshot({path: path.join(process.env.CK_SCREENSHOT_DIR, 'cc-feedback-' + width + '.png')});
      }
      await page.reload();
      await page.locator('#cx-feed .cx-item-error').getByText(window.error, {exact: true}).waitFor();
      assert.equal(posts.length, 1, 'Refreshing must never resend a failed task');
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      assert.deepEqual(errors, []);
      console.log(JSON.stringify({width, ok: true, checks: ['received status', 'retry error remains after submit toast', 'waiting updates one card', 'terminal error survives refresh', 'no task replay'], realRequests: 0}));
      await context.close();
    }
  } finally { await browser.close(); server.close(); }
})().catch(error => {console.error(error); server.close(); process.exitCode = 1;});
