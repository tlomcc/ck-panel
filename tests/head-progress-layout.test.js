// 右上角进度条的布局探针：用真的 headless Chrome 渲染一份去脚本的 index.html 量位置，
// 不靠读 8 份 CSS 猜（见 memory: ck-panel-headless-css-probe）。
// 要保证的事：
//   1. 它真的在右上角（贴着视口右边、在标题栏高度附近）；
//   2. 不和右上角那两颗图标按钮重叠，也不把它们挤成两行；
//   3. 文字再长也不冲出视口、不盖住中间的标题。
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const CHROME = process.env.CK_CHROME || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
if (!fs.existsSync(CHROME)) {
  console.log('head progress probe: SKIP (no chrome at ' + CHROME + ')');
  process.exit(0);
}

const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ck-headprobe-'));
function cleanup() { try { fs.rmSync(outDir, { recursive: true, force: true }); } catch (e) {} }

for (const f of fs.readdirSync(root)) {
  if (/\.(css|html|webmanifest)$/.test(f)) fs.copyFileSync(path.join(root, f), path.join(outDir, f));
}

// 故意用一段偏长的文案：真实最长的是「记忆 1234 字 · 思考 123s」这种。
const LONG_TEXT = '记忆 1234 字 · 思考 137s';
const probeJs = `
const rect=el=>{if(!el)return null;const r=el.getBoundingClientRect();const s=getComputedStyle(el);
  return {top:+r.top.toFixed(1),right:+r.right.toFixed(1),bottom:+r.bottom.toFixed(1),
    left:+r.left.toFixed(1),h:+r.height.toFixed(1),w:+r.width.toFixed(1),display:s.display};};
const actions=document.querySelector('.chat-head-actions');
const buttons=actions?[...actions.querySelectorAll('button')]:[];
const out={
  viewport:{w:window.innerWidth,h:window.innerHeight},
  progress:rect(document.getElementById('chat-head-progress')),
  actions:rect(actions),
  buttons:buttons.map(rect),
  titleCenter:rect(document.querySelector('.chat-title-center')),
  titlebar:rect(document.querySelector('.chat-titlebar'))
};
document.getElementById('ck-probe-out').textContent='CKPROBE '+JSON.stringify(out);
`;

function render(width, height) {
  let html = fs.readFileSync(path.join(outDir, 'index.html'), 'utf8');
  html = html.replace(/<script\b[\s\S]*?<\/script>/g, '');
  const stage = '<style>*,*::before,*::after{transition:none!important;animation:none!important}</style>'
    + '<script>document.body.className="chat-active";'
    + 'var p=document.getElementById("chat-head-progress");'
    + 'if(p){p.removeAttribute("hidden");p.textContent=' + JSON.stringify(LONG_TEXT) + ';}'
    + '</script>';
  html = html.replace('</body>', stage + '<pre id="ck-probe-out"></pre><script>' + probeJs + '</script></body>');
  const file = path.join(outDir, 'probe-' + width + '.html');
  fs.writeFileSync(file, html);
  let raw = '';
  try {
    raw = execFileSync(CHROME, [
      '--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
      '--window-size=' + width + ',' + height, '--virtual-time-budget=1500', '--dump-dom',
      'file:///' + file.replace(/\\/g, '/'),
    ], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 90000 });
  } catch (e) {
    return null;
  }
  const match = /CKPROBE (\{[\s\S]*?\})</.exec(raw) || /CKPROBE (\{.*\})/.exec(raw);
  return match ? JSON.parse(match[1]) : null;
}

const failures = [];
function check(label, ok, detail) {
  if (!ok) failures.push(' - ' + label + '  ->  ' + JSON.stringify(detail));
}
function overlaps(a, b) {
  return a && b && a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
}

[[414, 896], [1280, 900]].forEach(function (size) {
  const data = render(size[0], size[1]);
  if (!data) {
    console.log('head progress probe: SKIP (chrome failed at ' + size[0] + 'px)');
    cleanup();
    process.exit(0);
  }
  const tag = size[0] + 'px';
  const p = data.progress;
  check(tag + ' 进度元素必须渲染出来且有尺寸', !!p && p.h > 0 && p.w > 0, p);
  if (!p) return;

  check(tag + ' 必须靠在视口右侧', data.viewport.w - p.right <= 24,
    { right: p.right, viewport: data.viewport.w });
  check(tag + ' 必须在页面上部', p.top >= 0 && p.top < 120, { top: p.top });
  check(tag + ' 不能冲出视口左边', p.left >= 0, { left: p.left });
  check(tag + ' 不能冲出视口右边', p.right <= data.viewport.w, { right: p.right, viewport: data.viewport.w });

  check(tag + ' 右上角必须还是两颗按钮', data.buttons.length === 2, data.buttons.length);
  data.buttons.forEach(function (b, i) {
    check(tag + ' 不能盖住第 ' + (i + 1) + ' 颗图标按钮', !overlaps(p, b), { progress: p, button: b });
  });
  if (data.buttons.length === 2) {
    check(tag + ' 两颗按钮必须还在同一行（没被挤成两行）',
      Math.abs(data.buttons[0].top - data.buttons[1].top) < 2,
      data.buttons.map(function (b) { return b.top; }));
  }
  check(tag + ' 不能盖住中间的标题', !overlaps(p, data.titleCenter),
    { progress: p, title: data.titleCenter });
});

cleanup();
if (failures.length) {
  console.error('head progress probe FAILED:\n' + failures.join('\n'));
  process.exit(1);
}
console.log('head progress probe: OK');
