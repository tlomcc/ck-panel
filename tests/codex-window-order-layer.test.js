const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {spawn} = require('child_process');
const {chromium} = require('playwright');
const {startPreview} = require('./helpers/codex-window-fixture');

const root = path.resolve(__dirname, '..');
const phase = process.env.CX_UI_PHASE || 'after';
const out = process.env.CX_TEST_OUT || path.join(root, '.taste-skill', phase);
fs.mkdirSync(out, {recursive: true});
const order = page => page.locator('#cx-notice-list > .cx-task-notice').evaluateAll(rows => rows.map(row => row.dataset.windowId));
const sync = async page => { await page.evaluate(() => window.dispatchEvent(new Event('online'))); await page.waitForTimeout(180); };
const user = page => page.locator('#cx-feed > .cx-item-userMessage').first();
async function doubleClickVisibleText(locator, touch = false) {
  const text = locator.locator('.cx-text').first(), box = await text.boundingBox();
  const options = {position: {x: box.width - 8, y: Math.min(14, box.height / 2)}};
  // Separate deliberate double taps so Chrome does not group them into a triple/quadruple tap.
  if (touch) { await locator.page().waitForTimeout(600); await text.tap(options); await locator.page().waitForTimeout(75); await text.tap(options); }
  else await text.dblclick(options);
}
async function overlappingHit(page, selector) {
  return page.evaluate(selector => {
    const message = document.querySelector(selector), a = message.getBoundingClientRect();
    for (const row of document.querySelectorAll('#cx-notice-list > .cx-task-notice')) {
      const b = row.getBoundingClientRect(), x = Math.max(a.left, b.left) + 8, y = Math.max(a.top, b.top) + 8;
      if (x < Math.min(a.right, b.right) - 2 && y < Math.min(a.bottom, b.bottom) - 2) {
        const hit = document.elementFromPoint(x, y);
        return {overlap: true, message: message.contains(hit), window: row.contains(hit)};
      }
    }
    return {overlap: false};
  }, selector);
}

(async () => {
  const {server, url} = await startPreview(root);
  let browser;
  try {
    browser = await chromium.launch({args: ['--no-sandbox', '--disable-dev-shm-usage', '--renderer-process-limit=2']});
    for (const width of (process.env.CX_TEST_WIDTHS || '1440,768,390').split(',').map(Number)) {
      const context = await browser.newContext({viewport: {width, height: width === 390 ? 844 : 900}, hasTouch: width === 390, serviceWorkers: 'block'});
      const page = await context.newPage(), errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.goto(url);
      await page.waitForFunction(() => document.querySelectorAll('#cx-notice-list > .cx-task-notice').length === 10);
      await user(page).waitFor();
      await page.locator('#cx-feed').evaluate(feed => {feed.scrollTop = 0;});
      await page.screenshot({path: path.join(out, 'desktop-' + width + '.png')});
      if (phase === 'before') {
        console.log(width, 'baseline', await overlappingHit(page, '.cx-item-userMessage'));
        await context.close(); continue;
      }

      assert.deepEqual(await overlappingHit(page, '.cx-item-userMessage'), {overlap: true, message: false, window: true});
      await doubleClickVisibleText(user(page), width === 390);
      assert.equal(await page.locator('.cx-item-raised').count(), 1);
      assert.deepEqual(await overlappingHit(page, '.cx-item-userMessage'), {overlap: true, message: true, window: false});
      await page.evaluate(() => {__windowFixture.text += ' 增量内容已到达。'; __windowFixture.revision++;});
      await sync(page);
      await page.waitForFunction(() => document.querySelector('.cx-item-userMessage').textContent.includes('增量内容'));
      assert(await user(page).evaluate(e => e.classList.contains('cx-item-raised')));
      await user(page).locator('.cx-copy').click();
      assert(await page.evaluate(() => __windowFixture.copied.includes('增量内容')));
      assert.equal(await page.locator('.cx-item-raised').count(), 1);
      await doubleClickVisibleText(user(page), width === 390);
      assert.equal(await page.locator('.cx-item-raised').count(), 0);
      const answer = page.locator('#cx-feed > .cx-item-agentMessage').first();
      await doubleClickVisibleText(answer, width === 390);
      assert.equal(await page.locator('.cx-item-raised').count(), 1);
      await doubleClickVisibleText(user(page), width === 390);
      assert(await user(page).evaluate(e => e.classList.contains('cx-item-raised')));
      assert.equal(await page.locator('.cx-item-raised').count(), 1);
      await user(page).focus(); await user(page).press('Alt+Enter');
      assert.equal(await page.locator('.cx-item-raised').count(), 0);

      const titleBefore = await page.locator('#cx-window-title').textContent(), initial = await order(page);
      const first = page.locator('#cx-notice-list > .cx-task-notice').first();
      const a = await first.boundingBox(), b = await page.locator('#cx-notice-list > .cx-task-notice').nth(3).boundingBox();
      if (width === 390) {
        const cdp = await context.newCDPSession(page), x = a.x + a.width / 2, y = a.y + a.height / 2;
        await cdp.send('Input.dispatchTouchEvent', {type: 'touchStart', touchPoints: [{x, y}]});
        await page.waitForTimeout(240);
        for (let i = 1; i <= 12; i++) {
          await cdp.send('Input.dispatchTouchEvent', {type: 'touchMove', touchPoints: [{x, y: y + (b.y + b.height - 3 - y) * i / 12}]});
          await page.waitForTimeout(25);
        }
        await cdp.send('Input.dispatchTouchEvent', {type: 'touchEnd', touchPoints: []});
      } else {
        await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2); await page.mouse.down();
        await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2 + 8, {steps: 3});
        await page.mouse.move(b.x + b.width / 2, b.y + b.height - 3, {steps: 18}); await page.mouse.up();
      }
      await page.waitForTimeout(200);
      const moved = await order(page);
      assert.notDeepEqual(moved, initial, 'Pointer/touch drag must move the row');
      assert.deepEqual([...moved].sort(), [...initial].sort());
      assert.equal(await page.locator('#cx-window-title').textContent(), titleBefore, 'Sorting must not switch the task');
      await page.evaluate(() => __windowFixture.rows.codex.reverse()); await sync(page);
      assert.deepEqual(await order(page), moved, 'Server polling must not undo manual order');
      await page.reload(); await page.waitForFunction(() => document.querySelectorAll('#cx-notice-list > .cx-task-notice').length === 10);
      assert.deepEqual(await order(page), moved, 'Order must survive reload');
      assert.equal(await page.locator('.cx-item-raised').count(), 0, 'Messages start below windows after reload');
      const focused = page.locator('#cx-notice-list > .cx-task-notice').first();
      await focused.focus(); await focused.press('Alt+ArrowDown');
      const keyboardOrder = await order(page);
      assert.equal(keyboardOrder[1], moved[0]);
      await sync(page); assert.deepEqual(await order(page), keyboardOrder);
      await page.evaluate(() => location.hash = '#claude-tasks');
      await page.waitForFunction(() => document.querySelector('#cx-notice-list > .cx-task-notice')?.dataset.windowId === 'claude-0');
      assert.equal((await order(page))[0], 'claude-0', 'Engine orders remain independent');
      await page.evaluate(() => location.hash = '#codex-tasks');
      await page.waitForFunction(() => document.querySelector('#cx-notice-list > .cx-task-notice')?.dataset.windowId.startsWith('codex-'));
      assert.deepEqual(await order(page), keyboardOrder);
      if (width === 1440) {
        await page.evaluate(() => {
          __windowFixture.rows.codex.push({...__windowFixture.rows.codex[0], id: 'codex-new', title: '新增窗口', created: 1794449000});
          __windowFixture.revision++;
        });
        await sync(page);
        await page.waitForFunction(() => document.querySelectorAll('#cx-notice-list > .cx-task-notice').length === 11);
        assert.deepEqual(await order(page), keyboardOrder.concat('codex-new'), 'New windows append without moving existing ones');
        await page.evaluate(id => {const rows = __windowFixture.rows.codex; rows.splice(rows.findIndex(row => row.id === id), 1); __windowFixture.revision++;}, keyboardOrder[2]);
        await sync(page);
        await page.waitForFunction(() => document.querySelectorAll('#cx-notice-list > .cx-task-notice').length === 10);
        const remaining = keyboardOrder.filter((_, i) => i !== 2).concat('codex-new');
        assert.deepEqual(await order(page), remaining, 'Deleting a window preserves other positions');
        await page.evaluate(() => {
          const original = Storage.prototype.setItem;
          __windowFixture.restoreStorage = () => {Storage.prototype.setItem = original;};
          Storage.prototype.setItem = function(key, value) {if (key.includes('_window_order_')) throw new DOMException('Quota', 'QuotaExceededError'); return original.call(this, key, value);};
        });
        await page.locator('#cx-notice-list > .cx-task-notice').first().press('Alt+ArrowDown');
        const inMemory = await order(page);
        assert.equal(inMemory[1], remaining[0]);
        assert((await page.locator('#cx-message').textContent()).includes('浏览器未能保存'));
        await sync(page); assert.deepEqual(await order(page), inMemory, 'Storage failure still preserves this page order');
        await page.evaluate(() => __windowFixture.restoreStorage());
        await page.locator('#cx-notice-list > .cx-task-notice').nth(1).press('Alt+ArrowUp');
        assert.deepEqual(await order(page), remaining);
        assert.equal(await page.locator('#cx-message').textContent(), '', 'Saving again clears the previous storage warning');
      }
      await page.locator('#cx-feed').evaluate(feed => {feed.scrollTop = 0;});
      await page.screenshot({path: path.join(out, 'desktop-' + width + '.png')});
      await page.evaluate(() => document.body.classList.add('dark'));
      await page.screenshot({path: path.join(out, 'dark-' + width + '.png')});
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      assert.deepEqual(await page.evaluate(() => __windowFixture.posts), []);
      assert.deepEqual(errors, []);
      console.log(width + ': default layering, per-message toggle/touch, stream replacement, copy, keyboard, drag/touch, polling, reload, engine isolation PASS');
      await context.close();
    }
    await browser.close(); browser = null;
    if (process.env.CX_TASTE_INSPECT === '1') {
      const args = ['/var/lib/ck-codex/skills/taste-skill/scripts/inspect.mjs', '--app', url, '--out', path.join(out, 'inspect')];
      const status = await new Promise(resolve => {const proc = spawn(process.execPath, args, {cwd: root, stdio: 'inherit'}); proc.on('exit', resolve);});
      console.log('Taste inspector exit:', status);
    }
  } finally { if (browser) await browser.close(); server.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
