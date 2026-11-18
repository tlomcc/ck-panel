// Task-center redesign: one-line status bar, failed-step reasons, folded step groups,
// folded schedule list, usage inside the overflow menu and the short labels used on narrow screens.
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
const RAW = 'Quota exploded <img src=x onerror="window.__xss=1"> for provider';
const widths = (process.env.CX_WIDTHS || '390,768,1280').split(',').map(Number);

(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({executablePath: process.env.CHROME_PATH || undefined, args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu']});
  try {
    const coveredAll = [];
    for (const width of widths) {
      const context = await browser.newContext({viewport: {width, height: 900}, serviceWorkers: 'block'});
      await context.addInitScript(() => {
        localStorage.setItem('ck_codex_access', 'fixture-access');
        localStorage.setItem('ck_task_engine', 'claude');
        localStorage.setItem('ck_claude_endpoint', 'https://claude.test/claude-tasks');
      });
      const page = await context.newPage(), errors = [], posts = [];
      page.on('pageerror', e => errors.push(e.message));
      const profile = '75c76315-eb66-4fa0-ab6d-f0d2b9ef344e', wid = 'redesign-fixture';
      const config = {profiles: [{id: profile, name: 'Any', model: 'claude-opus-5-5[1m]', base_url: 'https://provider.test/v1', effort: 'high', has_key: true}],
        default_profile: profile, workspace: '/workspace', shared_providers: true, steer_mode: 'after_response'};
      const turnCreated = Date.now() / 1000;
      let window = {id: wid, title: '改版验证', profile, status: 'idle', updated: 1, seq: 1, usage: JSON.stringify({total: {totalTokens: 98765432}})}, items = [], schedules = [];
      const put = item => { window.seq++; window.updated = Date.now() / 1000; items = items.filter(i => i.id !== item.id).concat({...item, seq: window.seq}); };
      const status = (state, text, data = {}) => put({id: 'cc-status:fixture-turn', kind: 'warning', text, data: {state, ...data}, created: turnCreated});
      const tool = (id, kind, data, order) => put({id, kind, data, text: 'DO_NOT_SHOW_TOOL_BODY', created: turnCreated + order / 100});
      await page.route('**/*', async route => {
        const request = route.request(), url = new URL(request.url());
        if (url.hostname === '127.0.0.1') return route.continue();
        if (url.hostname !== 'claude.test') return route.abort();
        const endpoint = url.pathname.replace('/claude-tasks', '');
        let result;
        if (endpoint === '/config') result = config;
        else if (endpoint === '/threads') result = {windows: [window]};
        else if (endpoint === '/threads/' + wid + '/send') {
          posts.push(request.postDataJSON());
          window = {...window, status: 'running', turn_id: 'fixture-turn'};
          put({id: 'user:fixture', kind: 'userMessage', text: posts[0].text, data: {}, created: turnCreated - 1});
          status('starting', '任务已收到，正在国内 VPS 启动 Claude Code。');
          result = window;
        } else if (endpoint === '/threads/' + wid) {
          const after = Number(url.searchParams.get('after') || 0);
          result = {window, cursor: window.seq, items: items.filter(i => i.seq > after), schedules};
        } else return route.fulfill({status: 404, json: {error: 'Unexpected fixture endpoint'}});
        await route.fulfill({json: result});
      });
      const at = label => width + 'px ' + label;
      // Visible controls stay inside the viewport and never cover one another.
      async function layout(label, selectors) {
        const r = await page.evaluate(list => ({w: innerWidth, h: innerHeight, sw: document.documentElement.scrollWidth, boxes: list.map(s => {
          const e = document.querySelector(s); if (!e) return null;
          const b = e.getBoundingClientRect(), style = getComputedStyle(e);
          return b.width && b.height && style.visibility !== 'hidden' ? {s, l: b.left, t: b.top, r: b.right, b: b.bottom} : null;
        }).filter(Boolean)}), selectors);
        assert(r.sw <= r.w, at(label) + ': page must not scroll sideways');
        r.boxes.forEach(a => assert(a.l >= -.5 && a.t >= -.5 && a.r <= r.w + .5 && a.b <= r.h + .5, at(label) + ': outside viewport ' + JSON.stringify(a)));
        r.boxes.forEach((a, i) => r.boxes.slice(i + 1).forEach(b => assert(Math.min(a.r, b.r) - Math.max(a.l, b.l) <= 1 || Math.min(a.b, b.b) - Math.max(a.t, b.t) <= 1, at(label) + ': ' + a.s + ' overlaps ' + b.s + ' ' + JSON.stringify([a, b]))));
        return r.boxes.map(b => b.s);
      }
      // A control the user is about to press must be the top element at its own centre.
      async function reachable(label, selector) {
        const r = await page.evaluate(s => { const e = document.querySelector(s), b = e.getBoundingClientRect(), h = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
          const name = n => n ? n.tagName.toLowerCase() + (n.id ? '#' + n.id : '') + (typeof n.className === 'string' && n.className ? '.' + n.className.trim().split(/\s+/).join('.') : '') : 'nothing';
          return {ok: !!h && (e === h || e.contains(h)), box: [b.left, b.top, b.right, b.bottom].map(Math.round), top: name(h), parent: name(h && h.parentElement), within: name(h && h.parentElement && h.parentElement.closest('[id]')), cover: h ? (c => [c.left, c.top, c.right, c.bottom].map(Math.round))((h.parentElement || h).getBoundingClientRect()) : null, view: [innerWidth, innerHeight]}; }, selector);
        if (!r.ok) covered.push(at(label) + ': ' + selector + ' is covered ' + JSON.stringify(r));
        return r.ok;
      }
      // Covered controls are reported together at the end so the remaining behaviour is still exercised.
      const covered = [], press = async (label, selector) => await reachable(label, selector) ? page.locator(selector).click() : page.locator(selector).evaluate(e => e.click());
      const controls = ['#cx-exit', '#cx-window-toggle', '#cx-window-title', '.cx-window-menu > summary', '.cx-task-notice', '#cx-live-progress .cx-live-progress-head', '.cx-schedules-summary', '#cx-schedule-summary', '#cx-input', '#cx-send'];

      await page.goto('http://127.0.0.1:' + server.address().port + '/#claude-tasks');
      await page.locator('#cx-send:not([disabled])').waitFor();
      const hint = page.locator('#cx-compose-hint'), notice = page.locator('.cx-task-notice[data-window-id="' + wid + '"]');
      const bar = page.locator('#cx-live-progress'), head = bar.locator('.cx-live-progress-head'), more = page.locator('#cx-live-progress-more');

      // 5. Idle labels, and usage inside the overflow menu.
      await notice.waitFor({state: 'attached'});
      assert.equal(await notice.getAttribute('data-short'), '空闲');
      assert.equal(await notice.getAttribute('data-timed'), null);
      assert.equal(await hint.getAttribute('data-kind'), 'idle');
      const usage = page.locator('#cx-usage'), menu = page.locator('.cx-window-menu');
      await page.waitForFunction(() => document.getElementById('cx-usage').textContent === '98,765,432 tokens');
      assert(await usage.evaluate(e => !e.hidden && !!e.closest('.cx-window-menu .cx-window-actions') && !e.nextElementSibling), at('usage is the last entry of the overflow menu'));
      assert.equal(await usage.isVisible(), false, at('usage stays out of the header until the menu opens'));
      await menu.locator('summary').click();
      await usage.waitFor();
      await layout('usage in menu', ['#cx-usage']);
      await page.keyboard.press('Escape');
      assert.equal(await menu.evaluate(e => e.open), false);
      assert(await page.locator('#cx-send').isVisible(), at('Escape closes the menu first'));
      assert((await layout('idle', controls)).includes('#cx-send'));

      // 1. Status bar: one line, press for details, outside press or Escape closes, polling keeps it open.
      await page.locator('#cx-input').fill('改版交互验证任务');
      await page.locator('#cx-send').click();
      await head.waitFor();
      assert.equal(posts.length, 1);
      tool('s1', 'tool', {name: 'Read', status: 'completed', input: {file_path: '/workspace/a.css'}, output: 'DO_NOT_SHOW_TOOL_BODY'}, 1);
      tool('s2', 'tool', {name: 'Read', status: 'failed', input: {file_path: '/workspace/missing.css'}, output: '<tool_use_error>File does not exist. Did you mean b.css?</tool_use_error>\nDO_NOT_SHOW_TOOL_BODY'}, 2);
      tool('s3', 'tool', {name: 'Grep', status: 'failed', input: {pattern: 'x'}, output: '\n' + RAW + '\nDO_NOT_SHOW_TOOL_BODY'}, 3);
      tool('s4', 'commandExecution', {status: 'failed', command: 'false', output: 'DO_NOT_SHOW_TOOL_BODY'}, 4);
      status('working', 'Claude Code 正在执行工具：Read。', {elapsed_seconds: 30});
      await bar.getByText('正在执行工具', {exact: true}).waitFor();
      await page.locator('[data-item-id=s4] .cx-step-reason').waitFor();
      assert.equal(await head.getAttribute('aria-expanded'), 'false');
      assert.equal(await bar.getAttribute('data-open'), null);
      assert.equal(await more.isVisible(), false, at('details are closed by default'));
      const barBox = await bar.boundingBox(), parts = await head.evaluate(e => Array.from(e.children).map(c => c.getBoundingClientRect()).filter(b => b.width).map(b => [b.top, b.bottom]));
      assert(barBox.height <= 40, at('status bar is at most 40px high, got ' + barBox.height));
      assert(parts.length >= 3 && parts.every(p => p[0] < parts[0][1] && p[1] > parts[0][0]), at('status bar keeps phase, step and time on one line'));
      assert.equal(await hint.getAttribute('data-kind'), 'running');
      assert.equal(await notice.getAttribute('data-short'), '运行');
      assert((await layout('running', controls)).includes('#cx-live-progress .cx-live-progress-head'));
      await head.evaluate(e => { e.keptAcrossPolls = true; });
      await head.click();
      await more.waitFor();
      assert.equal(await bar.getAttribute('data-open'), 'true');
      assert.equal(await head.getAttribute('aria-expanded'), 'true');
      const labels = await more.locator('.cx-live-progress-row > span').allTextContents();
      ['阶段', '本轮已用时', '最近工具回传', '状态说明', '连接状态'].forEach(label => assert(labels.includes(label), at('details list ' + label)));
      await layout('details open', ['#cx-live-progress-more', '#cx-input', '#cx-send']);
      status('working', 'Claude Code 正在执行工具：Grep。', {elapsed_seconds: 65});
      await page.waitForFunction(() => document.querySelector('#cx-live-progress time').textContent === '1 分 5 秒');
      assert.equal(await bar.getAttribute('data-open'), 'true', at('a poll keeps the details open'));
      assert(await more.isVisible() && (await more.innerText()).includes('1 分 5 秒'));
      assert(await head.evaluate(e => e.keptAcrossPolls === true), at('a poll reuses the status bar node'));
      await page.locator('#cx-window-title').click();
      assert.equal(await bar.getAttribute('data-open'), null, at('a press outside closes the details'));
      assert.equal(await more.isVisible(), false);
      assert.equal(await head.getAttribute('aria-expanded'), 'false');
      await head.click();
      await more.waitFor();
      await page.keyboard.press('Escape');
      assert.equal(await more.isVisible(), false, at('Escape closes the details first'));
      assert.equal(await bar.getAttribute('data-open'), null);
      assert(await page.locator('#cx-send').isVisible() && await page.evaluate(() => document.body.classList.contains('cx-open')), at('Escape with open details keeps the task center'));
      await head.click();
      await more.waitFor();
      await head.click();
      assert.equal(await more.isVisible(), false, at('a second press closes the details'));

      // 2. Failed steps explain themselves in plain text.
      const reason = id => page.locator('[data-item-id=' + id + '] .cx-step-reason');
      assert.equal(await reason('s1').count(), 0);
      assert.equal(await reason('s2').textContent(), '文件不存在');
      assert.equal(await reason('s3').textContent(), RAW, at('an unmapped reason is shown as received'));
      assert.equal(await reason('s3').locator('*').count(), 0);
      assert.equal(await page.evaluate(() => window.__xss), undefined);
      assert.equal(await reason('s4').textContent(), '命令输出不在这里显示');
      assert.equal(await page.locator('[data-item-id=s2] .cx-step-state').textContent(), '这一步报错');
      for (const id of ['s2', 's3', 's4']) assert(await reason(id).isVisible(), at('reason of ' + id + ' is visible'));
      assert(!(await page.locator('#cx-feed').innerText()).includes('DO_NOT_SHOW_TOOL_BODY'));

      // 4. Scheduled tasks: one summary line by default, beside the running status bar.
      const soon = Date.now() / 1000 + 3600;
      schedules = [{id: 't1', request_id: 'r1', window_id: wid, state: 'scheduled', scheduled_for: soon, created: turnCreated, text: '定时任务一', profile}, {id: 't2', request_id: 'r2', window_id: wid, state: 'scheduled', scheduled_for: soon + 60, created: turnCreated, text: '定时任务二', profile}];
      window = {...window, scheduled_count: 2};
      status('working', 'Claude Code 正在执行工具：Grep。', {elapsed_seconds: 70});
      const planned = page.locator('#cx-schedules'), plannedSummary = planned.locator('h4 > button.cx-schedules-summary'), plannedList = page.locator('#cx-schedules-list');
      await plannedSummary.waitFor();
      assert.equal(await plannedSummary.textContent(), '2 个定时任务 · 北京时间');
      assert.equal(await plannedSummary.getAttribute('aria-expanded'), 'false');
      assert.equal(await planned.getAttribute('data-open'), null);
      assert.equal(await plannedList.isVisible(), false, at('scheduled tasks are folded by default'));
      await page.waitForFunction(id => document.querySelector('.cx-task-notice[data-window-id="' + id + '"]')?.dataset.timed === 'true', wid);
      assert.equal(await notice.getAttribute('data-short'), '运行');
      assert(await head.isVisible(), at('status bar and schedule summary show together'));
      assert((await layout('schedules folded', controls)).includes('.cx-schedules-summary'));
      await plannedSummary.click();
      await plannedList.waitFor();
      assert.equal(await plannedList.locator('details.cx-scheduled').count(), 2);
      assert.equal(await planned.getAttribute('data-open'), 'true');
      assert.equal(await plannedSummary.getAttribute('aria-expanded'), 'true');
      await layout('schedules open', ['#cx-schedules-list', '#cx-input', '#cx-send']);
      status('working', 'Claude Code 正在执行工具：Grep。', {elapsed_seconds: 75});
      await page.waitForFunction(() => document.querySelector('#cx-live-progress time').textContent === '1 分 15 秒');
      assert(await plannedList.isVisible(), at('a poll keeps the schedule list open'));
      await plannedSummary.click();
      assert.equal(await plannedList.isVisible(), false);
      await press('schedule button while running with two schedules', '#cx-schedule-summary');
      await page.locator('#cx-schedule-time').fill('2090-06-15T13:45');
      assert.equal(await hint.getAttribute('data-kind'), 'timed');
      await page.locator('#cx-schedule-time').fill('');
      await press('schedule button with its panel open', '#cx-schedule-summary');
      assert.equal(await page.locator('#cx-schedule-options').getAttribute('open'), null);
      assert.equal(await hint.getAttribute('data-kind'), 'running');


      // 3. Step groups: open while running, folded once finished, the reader's choice then stands.
      const group = page.locator('#cx-feed > section.cx-steps'), summary = group.locator('.cx-steps-summary'), shown = () => group.locator('.cx-item-tool-progress:visible').count();
      assert.equal(await group.count(), 1);
      assert.equal(await group.getAttribute('data-open'), 'true');
      assert.equal(await summary.isVisible(), false, at('a running group shows no summary'));
      assert.equal(await shown(), 4);
      window = {...window, status: 'completed'};
      put({id: 'final', kind: 'agentMessage', text: '全部完成', data: {phase: 'final_answer'}, created: turnCreated + 1});
      await page.locator('[data-item-id=final].cx-item-final').waitFor();
      await summary.waitFor();
      assert.equal(await summary.textContent(), '过程记录 · 4 步 · 3 步报错');
      assert.equal(await group.getAttribute('data-failed'), '3');
      assert.equal(await group.getAttribute('data-open'), null);
      assert.equal(await summary.getAttribute('aria-expanded'), 'false');
      assert.equal(await shown(), 0, at('a finished group of four folds'));
      assert.equal(await bar.isVisible(), false);
      assert.equal(await notice.getAttribute('data-short'), '完成');
      assert.equal(await notice.getAttribute('data-timed'), 'true');
      assert.equal(await hint.getAttribute('data-kind'), 'idle');
      await summary.click();
      assert.equal(await shown(), 4);
      assert.equal(await group.getAttribute('data-open'), 'true');
      assert.equal(await summary.getAttribute('aria-expanded'), 'true');
      put({id: 'later', kind: 'agentMessage', text: '后续补充', data: {}, created: turnCreated + 2});
      await page.locator('[data-item-id=later]').waitFor();
      assert.equal(await shown(), 4, at('an opened group is not folded again by a poll'));
      await summary.click();
      assert.equal(await shown(), 0);

      // 5. Waiting for an answer leaves a short feed: every navigation key stays inside it, never clipped.
      window = {...window, status: 'waiting', turn_id: 'fixture-turn'};
      status('waiting_answer', '等待你回复。', {elapsed_seconds: 62});
      put({id: 'q-cc', kind: 'request', text: '', created: turnCreated + 3, data: {id: 'q-q-cc', method: 'item/tool/requestUserInput', params: {questions: [
        {id: 'scope', question: '这次改动要应用到哪些范围？请选择或直接填写。', options: [{label: '仅本次', description: '只处理当前窗口涉及的文件'}, {label: '全部窗口', description: '同时更新其余窗口'}, {label: '先不处理'}]},
        {id: 'when', question: '希望什么时候执行？', options: [{label: '立即执行'}, {label: '今晚 23:00 之后'}]}]}}});
      await page.locator('#cx-pending form.cx-question').waitFor();
      const settle = () => page.evaluate(() => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(done, 30)))));
      const navState = () => page.evaluate(() => {
        const nav = document.getElementById('cx-user-nav'), f = document.getElementById('cx-feed').getBoundingClientRect();
        return {hidden: nav.hidden, tight: nav.classList.contains('cx-user-nav-tight'), feed: [f.left, f.top, f.right, f.bottom].map(Math.round), height: Math.round(f.height),
          keys: Array.from(nav.querySelectorAll('button')).filter(b => !b.hidden).map(b => { const r = b.getBoundingClientRect(); return {id: b.id, box: [r.left, r.top, r.right, r.bottom].map(Math.round),
            inside: r.left >= f.left - .5 && r.top >= f.top - .5 && r.right <= f.right + .5 && r.bottom <= f.bottom + .5, hit: b.contains(document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2))}; })};
      });
      await settle();
      const tall = await navState(), heights = [];
      for (const target of [340, 290, 260, 235, 210, 185, 150, 110]) {
        await page.setViewportSize({width, height: Math.max(320, Math.round(900 - (tall.height - target)))});
        await settle();
        const state = await navState();
        heights.push(state.height);
        assert.equal(state.hidden, false, at('navigation shows while waiting for an answer'));
        assert.deepEqual(state.keys.map(k => k.id), ['cx-feed-top', 'cx-user-prev', 'cx-user-next', 'cx-feed-bottom']);
        state.keys.forEach(k => assert(k.inside && k.hit, at('navigation key ' + k.id + ' must stay inside a ' + state.height + 'px feed') + ' ' + JSON.stringify(state)));
        if (state.height >= 320) assert.equal(state.tight, false, at('a feed tall enough keeps the navigation as a column') + ' ' + JSON.stringify(state));
      }
      assert(heights.some(h => h >= 180 && h <= 260), at('the short-feed samples must include 180-260px') + ' ' + JSON.stringify(heights));
      await page.setViewportSize({width, height: 900});
      await settle();

      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      coveredAll.push(...covered);
      assert.deepEqual(errors, []);
      console.log(JSON.stringify({width, ok: !covered.length, checks: ['status bar one line and at most 40px', 'details open, outside press, Escape, poll', 'failed step reasons as text', 'step group folds once and respects the reader', 'schedule list folded by default', 'navigation keys inside a short feed', 'usage in overflow menu', 'short labels and hint kind', 'controls inside viewport without overlap']}));
      await context.close();
    }
    // Reported after every width has run, so one covered control does not hide the other widths.
    assert.equal(coveredAll.length, 0, 'controls covered by another element:\n' + coveredAll.join('\n'));
  } finally { await browser.close(); server.close(); }
})().catch(error => { console.error(error); server.close(); process.exitCode = 1; });
