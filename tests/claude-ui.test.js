const { chromium } = require('playwright');
const fs = require('fs'), path = require('path'), http = require('http'), assert = require('assert');
const root = path.resolve(__dirname, '..');
const out = process.env.CK_SCREENSHOT_DIR;
const server = http.createServer((req, res) => {
  const name = new URL(req.url, 'http://localhost').pathname.slice(1) || 'index.html';
  const file = path.resolve(root, name);
  if (!file.startsWith(root + '/') || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404); return res.end(); }
  res.setHeader('Content-Type', name.endsWith('.js') ? 'text/javascript' : name.endsWith('.css') ? 'text/css' : name.endsWith('.json') ? 'application/json' : 'text/html');
  res.end(fs.readFileSync(file));
});

(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  if (out) fs.mkdirSync(out, {recursive: true});
  const browser = await chromium.launch({args: ['--no-sandbox', '--disable-dev-shm-usage']});
  try {
    for (const width of [320, 390, 768, 1280]) {
      const context = await browser.newContext({viewport: {width, height: 900}, serviceWorkers: 'block'});
      await context.addInitScript(() => {
        localStorage.setItem('ck_codex_access', 'fixture-access');
        localStorage.setItem('ck_codex_endpoint', 'https://codex.test/codex');
        localStorage.setItem('ck_claude_endpoint', 'https://claude.test/claude-tasks');
      });
      const page = await context.newPage();
      const errors = [], writes = [];
      page.on('pageerror', e => errors.push(e.message));
      const pid = '75c76315-eb66-4fa0-ab6d-f0d2b9ef344e';
      const config = {
        codex: {profiles: [{id: pid, name: 'any', model: 'codex-original', base_url: 'https://provider.test/v1', effort: 'high', has_key: true, revision: 'cx1'}], default_profile: pid, workspace: '/workspace'},
        claude: {profiles: [{id: pid, name: 'any', model: 'claude-sonnet-4-5-20250929', base_url: 'https://provider.test/v1', effort: 'high', has_key: true, revision: 'cc1'}], default_profile: pid, workspace: '/workspace', shared_providers: true, steer_mode: 'after_response', efforts: ['low', 'medium', 'high', 'xhigh', 'max']}
      };
      const windows = Object.fromEntries(['codex', 'claude'].map(engine => [engine, {id: 'same-id', title: engine === 'claude' ? '国内任务' : '美国任务', profile: pid, thread_id: engine + '-native', status: 'completed', updated: 1, seq: 2}]));
      let holdSave = null, saveArrived = null, holdRead = null, readArrived = null;
      await page.route('**/*', async route => {
        const req = route.request(), url = new URL(req.url());
        if (url.hostname === '127.0.0.1') return route.continue();
        if (!['codex.test', 'claude.test'].includes(url.hostname)) return route.abort();
        const engine = url.hostname === 'claude.test' ? 'claude' : 'codex';
        const endpoint = url.pathname.replace(/^\/(codex|claude-tasks)/, '');
        let result = {};
        if (req.method() === 'POST') writes.push({engine, endpoint, body: req.postDataJSON()});
        if (endpoint === '/config') result = config[engine];
        else if (endpoint === '/threads') result = {windows: [windows[engine]]};
        else if (endpoint === '/models') result = {models: engine === 'claude' ? ['claude-opus-4-6', 'claude-sonnet-4-5-20250929'] : ['codex-original', 'codex-next']};
        else if (endpoint === '/profiles/save') {
          if (holdSave) { saveArrived(); await holdSave; holdSave = null; }
          const body = req.postDataJSON();
          config[engine].profiles[0] = {...config[engine].profiles[0], model: body.profile.model, effort: body.profile.effort, revision: 'saved'};
          result = config[engine];
        } else if (endpoint === '/threads/same-id') {
          if (engine === 'codex' && holdRead) { readArrived(); await holdRead; holdRead = null; }
          const text = engine === 'claude' ? '国内任务：原生工具执行完成，上下文已保留。' : '美国任务记录保持。';
          result = {window: windows[engine], cursor: windows[engine].seq, items: [{id: 'reply', seq: 2, kind: 'agentMessage', text, data: {phase: 'final_answer'}, created: 1}], schedules: []};
        }
        try { await route.fulfill({json: result}); } catch (_) { /* A cancelled old-engine read is expected. */ }
      });
      async function choose(engine) {
        await page.locator('#cx-engine').click();
        await page.locator('dialog.cx-picker[open]').getByRole('button', {name: engine === 'claude' ? 'Claude Code · 国内 VPS' : 'Codex · 美国 VPS', exact: true}).click();
        await page.waitForFunction(name => document.querySelector('#cx-engine').getAttribute('aria-label') === '执行引擎：' + name, engine === 'claude' ? 'Claude Code' : 'Codex');
      }
      async function tab(name) {
        if (width <= 640) await page.locator('#cx-window-toggle').click();
        await page.locator('#cx-tab-' + name).click();
      }
      async function profile() {
        const card = page.locator('.cx-profile-card').first();
        if (!await card.evaluate(e => e.open)) await card.locator('summary').click();
        return card;
      }
      await page.goto('http://127.0.0.1:' + server.address().port + '/#codex-tasks');
      await page.getByText('美国任务记录保持。', {exact: true}).waitFor();
      await page.locator('#cx-input').fill('美国草稿');
      await choose('claude');
      await page.getByText('国内任务：原生工具执行完成，上下文已保留。', {exact: true}).waitFor();
      assert.equal(await page.locator('#cx-input').inputValue(), '');
      await page.locator('#cx-input').fill('国内任务草稿');
      if (out) await page.screenshot({path: path.join(out, 'cc-task-' + width + '.png')});
      await choose('codex');
      assert.equal(await page.locator('#cx-input').inputValue(), '美国草稿');
      assert(!(await page.locator('#cx-feed').innerText()).includes('国内任务：'));
      await tab('api');
      let card = await profile();
      await card.locator('[name=model]').fill('codex-unsaved');
      await choose('claude');
      card = await profile();
      assert(await card.locator('[name=base_url]').evaluate(e => e.readOnly));
      assert(await card.locator('[name=api_key]').isHidden());
      assert.equal(await page.locator('.cx-any-retry').count(), 0);
      await card.getByRole('button', {name: '选择模型', exact: true}).click();
      await page.locator('dialog.cx-picker[open]').getByRole('button', {name: 'claude-opus-4-6', exact: true}).click();
      await page.waitForFunction(() => document.querySelector('.cx-profile-card [name=model]').value === 'claude-opus-4-6');
      assert.equal(await card.locator('[name=model]').inputValue(), 'claude-opus-4-6');
      await choose('codex');
      card = await profile();
      assert.equal(await card.locator('[name=model]').inputValue(), 'codex-unsaved');
      await choose('claude');
      card = await profile();
      assert.equal(await card.locator('[name=model]').inputValue(), 'claude-opus-4-6');
      await card.locator('.ck-select-button').waitFor({state: 'visible'});
      await card.locator('.ck-select-button').click();
      await page.locator('dialog.cx-picker[open]').getByRole('button', {name: 'medium', exact: true}).click();
      await page.waitForFunction(() => document.querySelector('.cx-profile-card [name=effort]').value === 'medium');
      let releaseSave;
      holdSave = new Promise(resolve => { releaseSave = resolve; });
      const arrived = new Promise(resolve => { saveArrived = resolve; });
      await card.getByRole('button', {name: '保存 Claude 模型', exact: true}).click();
      await arrived;
      assert(await page.locator('#cx-engine').isDisabled());
      releaseSave();
      await card.getByText('已保存 · 下次任务生效', {exact: true}).waitFor();
      assert.equal(config.codex.profiles[0].model, 'codex-original');
      assert.equal(config.claude.profiles[0].effort, 'medium');
      assert.equal(writes.filter(w => w.endpoint === '/profiles/save').length, 1);
      assert.equal(writes.find(w => w.endpoint === '/profiles/save').engine, 'claude');
      assert.equal(writes.find(w => w.endpoint === '/profiles/save').body.profile.api_key, '');
      if (out) await page.screenshot({path: path.join(out, 'cc-api-' + width + '.png')});
      await page.locator('#cx-add-profile').click();
      await page.waitForFunction(() => document.querySelector('#cx-engine').textContent.includes('Codex'));
      card = await profile();
      assert.equal(await card.locator('[name=model]').inputValue(), 'codex-unsaved');
      await tab('tasks');
      let releaseRead;
      holdRead = new Promise(resolve => { releaseRead = resolve; });
      const readPending = new Promise(resolve => { readArrived = resolve; });
      await page.locator('.cx-window-menu summary').click();
      await page.locator('#cx-refresh').click();
      await readPending;
      await choose('claude');
      releaseRead();
      await page.waitForTimeout(250);
      assert.equal(await page.locator('#cx-input').inputValue(), '国内任务草稿');
      assert((await page.locator('#cx-feed').innerText()).includes('国内任务：'));
      assert(!(await page.locator('#cx-feed').innerText()).includes('美国任务记录'));
      await page.locator('#cx-engine').click();
      if (out) await page.screenshot({path: path.join(out, 'cc-engine-' + width + '.png')});
      await page.keyboard.press('Escape');
      assert.equal(await page.locator('dialog[open]').count(), 0);
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      assert.deepEqual(errors, []);
      console.log(JSON.stringify({width, ok: true, checks: ['separate drafts and records', 'unsaved forms retained per engine', 'Claude model list and save', 'shared catalog remains unchanged', 'pending write blocks switch', 'late read cannot replace active engine', 'keyboard and layout'], realRequests: 0}));
      await context.close();
    }
  } finally { await browser.close(); server.close(); }
})().catch(error => {console.error(error); server.close(); process.exitCode = 1;});
