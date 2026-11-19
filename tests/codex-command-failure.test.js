// A failed command step says how it ended: timeout, refused SSH connection or exit code.
// A plain non-zero exit code is marked and counted apart from real faults; what the command printed is never shown or kept.
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
const BODY = 'DO_NOT_SHOW_TOOL_BODY', HOST = '192.0.2.1', REFUSED = 'ssh: connect to host ' + HOST + ' port 22: Connection refused';
const SOFT_1 = '常见于没搜到内容或文件不存在，不一定是故障', UNKNOWN = '命令输出不在这里显示';
// [output of the command tool, kept reason, state shown, reason line shown, counted as a plain non-zero exit]
const cases = [
  ['Exit code 1', 'exit:1', '退出码 1', SOFT_1, true],
  ['Exit code 2\nls: cannot access ' + BODY, 'exit:2', '退出码 2', '常见于要看的文件不存在，或命令用法有误', true],
  ['Exit code 3\n' + BODY, 'exit:3', '退出码 3', '命令返回了非零状态，含义由命令自己定义', true],
  ['Exit code 124\n' + BODY, 'exit:124', '退出码 124', '常见于命令自设的限时到了', true],
  // A marker quoted further down, or not at the start of a line, is part of the output and decides nothing.
  ['Exit code 1\n' + BODY + '\nCommand timed out after 2m 0s', 'exit:1', '退出码 1', SOFT_1, true],
  ['Exit code 1\nnote: ' + REFUSED, 'exit:1', '退出码 1', SOFT_1, true],
  ['Exit code 143\nCommand timed out after 2m 0s\n' + BODY, 'timeout:2m 0s', '超时', '超过 2 分钟的等待上限，命令被中止', false],
  ['Command timed out after 10m 0s', 'timeout:10m 0s', '超时', '超过 10 分钟的等待上限，命令被中止', false],
  ['Exit code 143\nCommand timed out after 1h 0m 30s', 'timeout:1h 0m 30s', '超时', '超过 1 小时 30 秒的等待上限，命令被中止', false],
  ['Exit code 143\nCommand timed out after 45s', 'timeout:45s', '超时', '超过 45 秒的等待上限，命令被中止', false],
  ['Exit code 143\nCommand timed out after 1.5s', 'timeout:1.5s', '超时', '超过等待上限，命令被中止', false],
  ['Exit code 255\n' + BODY + '\n' + REFUSED, 'ssh:connection refused', 'SSH 被拒', 'SSH 连接被拒绝，远端命令没有执行', false],
  ['Exit code 255\n' + REFUSED + '\r\n' + BODY, 'ssh:connection refused', 'SSH 被拒', 'SSH 连接被拒绝，远端命令没有执行', false],
  ['Exit code 255\nssh: connect to host ' + HOST + ' port 22: Connection timed out', 'ssh:connection timed out', 'SSH 连不上', 'SSH 连接没有建立，远端命令没有执行', false],
  ['Exit code 126\n' + BODY, 'exit:126', '退出码 126', '命令没有执行权限', false],
  ['Exit code 127\nbash: line 1: ' + BODY + ': command not found', 'exit:127', '退出码 127', '命令不存在', false],
  ['Exit code 137\n' + BODY, 'exit:137', '退出码 137', '进程被强制结束', false],
  ['Exit code 143\n' + BODY, 'exit:143', '退出码 143', '进程被终止', false],
  ['Exit code 200\n' + BODY, 'exit:200', '退出码 200', '进程异常终止', false],
  ['Exit code 255\n' + BODY, 'exit:255', '退出码 255', '常见于 SSH 连接或远端命令出错', false],
  [BODY, '', '这一步报错', UNKNOWN, false],
  ['Exit code 1 ' + BODY, '', '这一步报错', UNKNOWN, false],
  ['Exit code 0\n' + BODY, '', '这一步报错', UNKNOWN, false],
  ['', '', '这一步报错', UNKNOWN, false],
  [undefined, '', '这一步报错', UNKNOWN, false],
  [{text: 'Exit code 1'}, '', '这一步报错', UNKNOWN, false]
];

function extractFunction(source, name) {
  const start = source.indexOf('function ' + name + '(');
  assert(start >= 0, 'missing function ' + name);
  let depth = 0;
  for (let index = source.indexOf('{', start); index < source.length; index++) {
    if (source[index] === '{') depth++;
    if (source[index] === '}' && --depth === 0) return source.slice(start, index + 1);
  }
  throw new Error('unterminated function ' + name);
}
const source = fs.readFileSync(path.join(root, 'codex-tasks.js'), 'utf8');
const {commandReason, commandFailure} = new Function(extractFunction(source, 'commandReason') + extractFunction(source, 'commandFailure') + 'return {commandReason:commandReason,commandFailure:commandFailure};')();
for (const [output, kept, state, why, soft] of cases) {
  const label = JSON.stringify(output);
  assert.equal(commandReason(output), kept, 'kept reason of ' + label);
  // Only a short fixed-shape code is kept, so nothing the command printed can ride along.
  assert(/^(?:|exit:\d{1,3}|timeout:[0-9a-z. ]{1,24}|ssh:[a-z ]{1,40})$/.test(kept) && !kept.includes(HOST), 'shape of ' + kept);
  const ended = commandFailure(kept);
  assert.deepEqual([ended.state, ended.why, Boolean(ended.soft)], [state, why, soft], 'wording of ' + label);
}
// A reason this version does not know still reads as a plain failure.
assert.deepEqual(commandFailure('signal:9'), {state: '这一步报错', why: UNKNOWN});
assert.equal(commandFailure('ssh:no route to host').state, 'SSH 连不上');

// Steps of the two groups on the page: [id, output, state shown, reason line shown, plain non-zero exit]
const softSteps = [
  ['soft-1', cases[0][0], '退出码 1', SOFT_1],
  ['soft-2', cases[1][0], '退出码 2', cases[1][3]],
  ['soft-3', cases[2][0], '退出码 3', cases[2][3]],
  ['soft-quoted-timeout', cases[4][0], '退出码 1', SOFT_1],
  ['soft-quoted-ssh', cases[5][0], '退出码 1', SOFT_1]
];
const hardSteps = [
  ['hard-timeout', cases[6][0], '超时', cases[6][3]],
  ['hard-refused', cases[11][0], 'SSH 被拒', cases[11][3]],
  ['hard-unreachable', cases[13][0], 'SSH 连不上', cases[13][3]],
  ['hard-missing', cases[15][0], '退出码 127', '命令不存在'],
  ['hard-255', cases[19][0], '退出码 255', cases[19][3]],
  ['hard-unknown', BODY, '这一步报错', UNKNOWN]
];

(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({executablePath: process.env.CHROME_PATH || undefined, args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu']});
  try {
    for (const [width, dark] of [[320, false], [390, false], [1280, false], [390, true]]) {
      const context = await browser.newContext({viewport: {width, height: 900}, serviceWorkers: 'block'});
      await context.addInitScript(() => {
        localStorage.setItem('ck_codex_access', 'fixture-access');
        localStorage.setItem('ck_task_engine', 'claude');
        localStorage.setItem('ck_claude_endpoint', 'https://claude.test/claude-tasks');
      });
      const page = await context.newPage(), errors = [], posts = [];
      page.on('pageerror', e => errors.push(e.message));
      const profile = '75c76315-eb66-4fa0-ab6d-f0d2b9ef344e', wid = 'command-failure-fixture';
      const config = {profiles: [{id: profile, name: 'Any', model: 'claude-opus-5-5[1m]', base_url: 'https://provider.test/v1', effort: 'high', has_key: true}],
        default_profile: profile, workspace: '/workspace', shared_providers: true, steer_mode: 'after_response'};
      const turnCreated = Date.now() / 1000;
      let window = {id: wid, title: '命令报错验证', profile, status: 'idle', updated: 1, seq: 1}, items = [], order = 0;
      const put = item => { window.seq++; window.updated = Date.now() / 1000; items = items.filter(i => i.id !== item.id).concat({...item, seq: window.seq}); };
      const status = (state, text, data = {}) => put({id: 'cc-status:fixture-turn', kind: 'warning', text, data: {state, ...data}, created: turnCreated});
      const tool = (id, kind, data) => put({id, kind, data, text: BODY, created: turnCreated + ++order / 100});
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
          result = {window, cursor: window.seq, items: items.filter(i => i.seq > after), schedules: []};
        } else return route.fulfill({status: 404, json: {error: 'Unexpected fixture endpoint'}});
        await route.fulfill({json: result});
      });
      const at = label => width + 'px ' + (dark ? 'dark ' : '') + label;
      await page.goto('http://127.0.0.1:' + server.address().port + '/#claude-tasks');
      await page.locator('#cx-send:not([disabled])').waitFor();
      await page.evaluate(dark => document.body.classList.toggle('dark', dark), dark);
      await page.locator('#cx-input').fill('命令报错验证任务');
      await page.locator('#cx-send').click();
      await page.locator('[data-item-id="cc-status:fixture-turn"]').waitFor();

      const row = id => page.locator('[data-item-id="' + id + '"]'), detail = page.locator('#cx-live-progress .cx-live-progress-detail');
      const marker = id => row(id).evaluate(el => {
        const probe = document.createElement('i'), dot = getComputedStyle(el, '::before');
        probe.style.color = 'var(--cx-warn-ink)'; el.append(probe);
        const warn = getComputedStyle(probe).color; probe.remove();
        return {image: dot.backgroundImage, color: dot.backgroundColor, radius: dot.borderTopLeftRadius, warn};
      });
      // Each step runs, then fails. The row and the status bar both say how it ended; neither repeats the output.
      async function fail(id, output, state, why, soft) {
        tool(id, 'commandExecution', {status: 'running', command: BODY, aggregatedOutput: ''});
        status('working', 'Claude Code 正在执行工具：Bash。');
        await row(id).getByText('执行中', {exact: true}).waitFor();
        assert.equal(await row(id).locator('.cx-step-reason').count(), 0, at(id + ' has no reason while running'));
        tool(id, 'commandExecution', {status: 'failed', command: BODY, aggregatedOutput: output});
        status('requesting', '工具执行已结束，正在等待模型继续处理。');
        await row(id).getByText(state, {exact: true}).waitFor();
        assert.equal(await row(id).count(), 1);
        assert.equal(await row(id).locator('.cx-step-state').textContent(), state);
        assert.equal(await row(id).getAttribute('data-state'), 'failed');
        assert.equal(await row(id).locator('.cx-text').textContent(), '执行命令');
        const reason = row(id).locator('.cx-step-reason');
        assert.equal(await reason.textContent(), why, at('reason of ' + id));
        assert(await reason.isVisible() && await reason.evaluate(el => el.scrollHeight <= el.clientHeight + 1), at('reason of ' + id + ' is shown in full'));
        assert.equal(await row(id).getAttribute('data-nonzero'), soft ? 'true' : null, at('exit mark of ' + id));
        const dot = await marker(id);
        if (soft) assert(dot.image === 'none' && dot.color === dot.warn && dot.radius !== '0px', at(id + ' carries the round warning dot') + ' ' + JSON.stringify(dot));
        else assert(dot.image.includes('linear-gradient') && dot.radius === '0px', at(id + ' carries the failure cross') + ' ' + JSON.stringify(dot));
        await page.waitForFunction(text => document.querySelector('#cx-live-progress .cx-live-progress-detail')?.textContent === text, '执行命令 · ' + state);
        assert.equal(window.status, 'running', 'A failed step must not mark the whole task failed');
      }
      for (const step of softSteps) await fail(...step, true);
      const groups = page.locator('#cx-feed > section.cx-steps'), summary = index => groups.nth(index).locator('.cx-steps-summary');
      assert.equal(await groups.count(), 1);
      assert.equal(await summary(0).isVisible(), false, at('a running group shows no summary'));
      put({id: 'between', kind: 'agentMessage', text: '继续检查', data: {}, created: turnCreated + ++order / 100});
      await page.locator('[data-item-id=between]').waitFor();
      await summary(0).waitFor();
      // Plain non-zero exits alone leave the folded group unmarked.
      assert.equal(await summary(0).textContent(), '过程记录 · 5 步 · 5 步退出码非零');
      assert.equal(await groups.nth(0).getAttribute('data-failed'), null, at('non-zero exits alone do not mark the group as failed'));
      assert.equal(await summary(0).evaluate(el => getComputedStyle(el, '::before').content), 'none');
      assert.equal(await groups.nth(0).locator('.cx-item-tool-progress:visible').count(), 0);

      for (const step of hardSteps) await fail(...step, false);
      await fail('soft-late', 'Exit code 1', '退出码 1', SOFT_1, true);
      // Other kinds of step keep their wording: a general tool gives its own reason, a file change gives none of its body.
      tool('tool-failed', 'tool', {name: 'Read', status: 'failed', input: {file_path: '/workspace/missing.txt'}, output: 'File does not exist. ' + BODY});
      tool('file-failed', 'fileChange', {status: 'failed', changes: [{path: '/workspace/notes.md', diff: BODY}], aggregatedOutput: 'Exit code 1'});
      tool('command-done', 'commandExecution', {status: 'completed', command: BODY, aggregatedOutput: 'Exit code 1\n' + BODY});
      status('requesting', '工具执行已结束，正在等待模型继续处理。');
      await row('command-done').waitFor();
      assert.equal(await row('tool-failed').locator('.cx-step-state').textContent(), '这一步报错');
      assert.equal(await row('tool-failed').locator('.cx-step-reason').textContent(), '文件不存在');
      assert.equal(await row('file-failed').locator('.cx-step-state').textContent(), '这一步报错');
      assert.equal(await row('file-failed').locator('.cx-step-reason').textContent(), UNKNOWN);
      assert.equal(await row('command-done').locator('.cx-step-state').textContent(), '已完成');
      assert.equal(await row('command-done').locator('.cx-step-reason').count(), 0);
      for (const id of ['tool-failed', 'file-failed', 'command-done']) assert.equal(await row(id).getAttribute('data-nonzero'), null, at(id + ' is not a non-zero exit'));
      await page.waitForFunction(() => document.querySelector('#cx-live-progress .cx-live-progress-detail')?.textContent === '执行命令 · 已完成');
      assert.equal(await groups.count(), 2);
      assert.equal(await groups.nth(1).locator('.cx-item-tool-progress:visible').count(), 10, at('the running group shows every step'));
      const leaked = () => page.evaluate(words => words.filter(word => document.body.innerHTML.includes(word)), [BODY, HOST, 'Connection refused', 'Command timed out', 'Exit code']);
      assert.deepEqual(await leaked(), [], at('no command output in the page while running'));
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), at('no sideways scrolling while running'));
      if (process.env.CK_SCREENSHOT_DIR) {
        fs.mkdirSync(process.env.CK_SCREENSHOT_DIR, {recursive: true});
        await page.screenshot({path: path.join(process.env.CK_SCREENSHOT_DIR, 'command-failure-' + width + '-' + (dark ? 'dark' : 'light') + '.png')});
      }

      window = {...window, status: 'completed', turn_id: ''};
      put({id: 'final', kind: 'agentMessage', text: '全部完成', data: {phase: 'final_answer'}, created: turnCreated + ++order / 100});
      await page.locator('[data-item-id=final].cx-item-final').waitFor();
      await summary(1).waitFor();
      // Six failed commands, one failed tool and one failed file change are faults; the late exit code 1 is counted apart.
      assert.equal(await summary(1).textContent(), '过程记录 · 10 步 · 8 步报错 · 1 步退出码非零');
      assert.equal(await groups.nth(1).getAttribute('data-failed'), '8');
      assert.notEqual(await summary(1).evaluate(el => getComputedStyle(el, '::before').content), 'none', at('a group with real faults keeps its cross'));
      assert.equal(await groups.nth(1).locator('.cx-item-tool-progress:visible').count(), 0, at('the finished group folds'));
      for (const index of [0, 1]) assert(await summary(index).evaluate(el => el.scrollWidth <= el.clientWidth + 1 && el.scrollHeight <= el.clientHeight + 1), at('summary ' + index + ' is shown in full'));
      await page.locator('#cx-live-progress').waitFor({state: 'hidden'});
      if (process.env.CK_SCREENSHOT_DIR) await page.screenshot({path: path.join(process.env.CK_SCREENSHOT_DIR, 'command-failure-folded-' + width + '-' + (dark ? 'dark' : 'light') + '.png')});

      // A reload rebuilds every row from the stored steps with the same wording, marks and counts.
      await page.reload();
      await page.evaluate(dark => document.body.classList.toggle('dark', dark), dark);
      await page.locator('[data-item-id=final].cx-item-final').waitFor();
      assert.equal(await groups.count(), 2);
      assert.equal(await summary(0).textContent(), '过程记录 · 5 步 · 5 步退出码非零');
      assert.equal(await summary(1).textContent(), '过程记录 · 10 步 · 8 步报错 · 1 步退出码非零');
      assert.equal(await groups.nth(0).getAttribute('data-failed'), null);
      assert.equal(await groups.nth(1).getAttribute('data-failed'), '8');
      await summary(0).click();
      await summary(1).click();
      for (const [id, , state, why] of softSteps.concat(hardSteps)) {
        assert.equal(await row(id).locator('.cx-step-state').textContent(), state, at('state of ' + id + ' after reload'));
        assert.equal(await row(id).locator('.cx-step-reason').textContent(), why, at('reason of ' + id + ' after reload'));
        assert(await row(id).locator('.cx-step-reason').isVisible());
      }
      assert.equal(await page.locator('#cx-feed .cx-item-tool-progress[data-nonzero]').count(), 6);
      assert.deepEqual(await leaked(), [], at('no command output in the page after reload'));
      assert.equal(posts.length, 1, 'Reloading must never resend the task');
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), at('no sideways scrolling'));
      if (process.env.CK_SCREENSHOT_DIR) await page.screenshot({path: path.join(process.env.CK_SCREENSHOT_DIR, 'command-failure-open-' + width + '-' + (dark ? 'dark' : 'light') + '.png')});
      assert.deepEqual(errors, []);
      console.log(JSON.stringify({width, dark, ok: true, checks: ['state and reason per ending', 'non-zero exit marked apart from faults', 'status bar names the ending', 'summary counts faults and non-zero exits apart', 'other step kinds unchanged', 'no command output in the page', 'same result after reload'], realRequests: 0}));
      await context.close();
    }
  } finally { await browser.close(); server.close(); }
})().catch(error => { console.error(error); server.close(); process.exitCode = 1; });
