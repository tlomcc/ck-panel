const fs = require('fs');
const path = require('path');
const http = require('http');
const {execFileSync} = require('child_process');

// Only synthetic data. Every API request is intercepted before it leaves the page.
const bootstrap = `(() => {
  localStorage.setItem('ck_codex_access', 'fixture');
  localStorage.setItem('ck_codex_endpoint', 'https://codex.fixture/codex');
  localStorage.setItem('ck_claude_endpoint', 'https://claude.fixture/claude-tasks');
  if (!localStorage.getItem('ck_codex_selected')) localStorage.setItem('ck_codex_selected', 'codex-0');
  if (!localStorage.getItem('ck_claude_selected')) localStorage.setItem('ck_claude_selected', 'claude-0');
  const titles = ['当前维护', '总控窗口', '复核窗口', '资料一组', '资料二组', '资料三组', '资料四组', '进度汇报', '接续检查', '运行检查'];
  const rows = {};
  for (const engine of ['codex', 'claude']) rows[engine] = titles.map((title, i) => ({
    id: engine + '-' + i, title, status: 'running', profile: 'fixture', thread_id: engine + '-' + i,
    seq: 10, created: 1794448000 + i, updated: 1794448500, error: ''
  }));
  const fixture = window.__windowFixture = { rows, posts: [], text: '继续处理当前任务，保留已完成结果。', revision: 0 };
  const original = window.fetch.bind(window);
  window.fetch = async (input, init = {}) => {
    const url = new URL(typeof input === 'string' ? input : input.url, location.href);
    if (url.origin === location.origin) return original(input, init);
    if (!['codex.fixture', 'claude.fixture'].includes(url.hostname)) throw new TypeError('Fixture blocked external request');
    const engine = url.hostname.split('.')[0], list = rows[engine];
    if (init.method && init.method !== 'GET') fixture.posts.push(url.pathname);
    let value;
    if (url.pathname.endsWith('/config')) value = {
      profiles: [{id: 'fixture', name: '测试供应商', model: 'fixture', effort: 'high', base_url: 'https://model.fixture/v1', has_key: true}],
      default_profile: 'fixture', workspace: '/workspace', scheduling: true
    };
    else if (url.pathname.endsWith('/threads')) value = { windows: list.map(row => ({...row, seq: row.seq + fixture.revision})) };
    else {
      const id = url.pathname.split('/')[3], row = list.find(w => w.id === id);
      if (!row) return new Response(JSON.stringify({error: '窗口不存在'}), {status: 404});
      value = { window: {...row, seq: row.seq + fixture.revision}, cursor: row.seq + fixture.revision, schedules: [], items: [
        {id: 'user-' + id, kind: 'userMessage', text: fixture.text, created: 1794448500, data: {}},
        {id: 'answer-' + id, kind: 'agentMessage', text: '正在核对当前资料。已完成的发布记录会保留，后续只接续尚未完成的步骤。', created: 1794448501, data: {phase: 'commentary'}},
        {id: 'answer2-' + id, kind: 'agentMessage', text: '窗口状态已同步，可以继续查看记录或补充要求。', created: 1794448502, data: {phase: 'commentary'}}
      ]};
    }
    return new Response(JSON.stringify(value), {status: 200, headers: {'Content-Type': 'application/json'}});
  };
  Object.defineProperty(navigator, 'clipboard', {value: {writeText: async text => { fixture.copied = text; }}, configurable: true});
})();`;

async function startPreview(root) {
  const server = http.createServer((req, res) => {
    const pathname = new URL(req.url, 'http://fixture').pathname;
    const file = path.resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
    if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
      res.writeHead(404); return res.end();
    }
    let data = process.env.CX_UI_BASE_REF
      ? execFileSync('git', ['show', process.env.CX_UI_BASE_REF + ':' + path.relative(root, file)], {cwd: root})
      : fs.readFileSync(file);
    if (file.endsWith('/index.html')) data = Buffer.from(data.toString().replace('<head>', '<head><script>' + bootstrap + '</script>'));
    const type = ({'.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json'})[path.extname(file)] || 'text/html';
    res.writeHead(200, {'Content-Type': type, 'Cache-Control': 'no-store'});
    res.end(data);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return {server, url: 'http://127.0.0.1:' + server.address().port + '/#codex-tasks'};
}

module.exports = {startPreview};
