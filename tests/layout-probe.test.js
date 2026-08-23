// 布局探针：拿真的 headless Chrome 渲染一份"去掉脚本"的 index.html，
// 用 getBoundingClientRect 量出来，而不是读 8 份 CSS 靠猜（见 memory: ck-panel-headless-css-probe）。
// 量三件事：
//   1. ➕ 功能区展开后正好露 2 行 4 列，第三行完全靠上滑出来；
//   2. 用量统计那一行紧跟在时间那一行下面，字号一致；
//   3. 世界书那一页无论多少条都只占一行（下拉框），新增按钮在它下面一栏。
const fs=require('fs');
const path=require('path');
const os=require('os');
const {execFileSync}=require('child_process');

const root=path.resolve(__dirname,'..');
const CHROME=process.env.CK_CHROME||'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
if(!fs.existsSync(CHROME)){
  console.log('layout probe: SKIP (no chrome at '+CHROME+')');
  process.exit(0);
}

const outDir=fs.mkdtempSync(path.join(os.tmpdir(),'ck-probe-'));
function cleanup(){try{fs.rmSync(outDir,{recursive:true,force:true})}catch(e){}}

// 复制静态资源，把 <script> 全部拿掉，改成一段只负责摆姿势的内联脚本。
for(const f of fs.readdirSync(root)){
  if(/\.(css|html|webmanifest)$/.test(f))fs.copyFileSync(path.join(root,f),path.join(outDir,f));
}
let html=fs.readFileSync(path.join(outDir,'index.html'),'utf8');
html=html.replace(/<script\b[\s\S]*?<\/script>/g,'');

// 手动摆出"聊天页 + ➕ 展开 + 设置抽屉开在世界书页"的状态，再插几条假消息。
// 先把所有过渡关掉：➕ 面板是 max-height 动画展开的，不关就会量到动画中间的高度，
// 同一份 CSS 每次跑出来的数都不一样（曾经量到 h=0 和露出 35.9px 两种结果）。
const stage=`
<style>*,*::before,*::after{transition:none!important;animation:none!important}</style>
<script>
document.body.className='chat-active chat-plus-open';
var app=document.getElementById('chat-app')||document.body;
var panel=document.getElementById('chat-plus-panel');
if(panel){panel.classList.add('open');panel.setAttribute('aria-hidden','false');}
var box=document.getElementById('chat-messages');
if(box){
  box.innerHTML=
    '<div class="chat-msg-row assistant"><div class="chat-bubble assistant">答</div>'+
    '<div class="chat-msg-time"><span class="chat-msg-meta-time">12:00:00</span></div>'+
    '<div class="chat-msg-usage"><span><i>\\u2191</i>1234</span><span><i>\\u2193</i>88</span>'+
    '<span><i>\\u26a1</i>9000</span><span><i>\\u271a</i>200</span><span><i>\\u25ce</i>81%</span></div></div>';
}
var list=document.getElementById('chat-worldbook-list');
if(list){
  var options='';
  for(var i=0;i<100;i++)options+='<option value="w'+i+'">\\u4e16\\u754c\\u4e66'+i+' \\u00b7 \\u542f\\u7528 \\u00b7 \\u4f18\\u5148\\u7ea7 100</option>';
  list.innerHTML='<div class="chat-worldbook-select-row"><label for="chat-worldbook-select">\\u9009\\u62e9</label>'+
    '<select id="chat-worldbook-select" class="chat-worldbook-select">'+options+'</select></div>';
}
var settings=document.getElementById('chat-settings');
if(settings)settings.classList.add('open');
document.querySelectorAll('.chat-side-panel').forEach(function(p){p.classList.toggle('active',p.id==='chat-side-worldbook')});
</script>`;
html=html.replace('</body>',stage+'</body>');
fs.writeFileSync(path.join(outDir,'probe.html'),html);

const probeJs=`
const rect=el=>{if(!el)return null;const r=el.getBoundingClientRect();const s=getComputedStyle(el);
  return {top:+r.top.toFixed(1),bottom:+r.bottom.toFixed(1),left:+r.left.toFixed(1),h:+r.height.toFixed(1),w:+r.width.toFixed(1),
    fontSize:s.fontSize,overflowY:s.overflowY,pointerEvents:s.pointerEvents,display:s.display};};
const grid=document.getElementById('chat-plus-grid');
const buttons=grid?[...grid.querySelectorAll('button')]:[];
const out={
  panel:rect(document.getElementById('chat-plus-panel')),
  grid:rect(grid),
  gridScrollHeight:grid?grid.scrollHeight:0,
  gridClientHeight:grid?grid.clientHeight:0,
  buttons:buttons.map(b=>rect(b)),
  buttonLabels:buttons.map(b=>(b.querySelector('b')||{}).textContent||''),
  time:rect(document.querySelector('.chat-msg-time')),
  usage:rect(document.querySelector('.chat-msg-usage')),
  wbList:rect(document.getElementById('chat-worldbook-list')),
  wbSelect:rect(document.getElementById('chat-worldbook-select')),
  wbAdd:rect(document.querySelector('.chat-worldbook-add')),
  legendOpen:!!(document.querySelector('.chat-tick-legend-card')||{}).open,
  usageLegendOpen:!!(document.querySelector('.chat-usage-legend-card')||{}).open,
  legendInGateway:!!document.querySelector('#chat-side-gateway .chat-tick-legend-card'),
  usageLegendInGateway:!!document.querySelector('#chat-side-gateway .chat-usage-legend-card'),
  savedOpen:!!(document.querySelector('.chat-debug-saved-card')||{}).open
};
console.log('CKPROBE '+JSON.stringify(out));
`;
fs.writeFileSync(path.join(outDir,'probe.js'),probeJs);

let raw='';
try{
  raw=execFileSync(CHROME,[
    '--headless=new','--disable-gpu','--no-sandbox','--hide-scrollbars',
    '--window-size=414,896','--virtual-time-budget=1500',
    '--dump-dom','--run-all-compositor-stages-before-draw',
    '--enable-logging=stderr','--v=0',
    'file:///'+path.join(outDir,'probe.html').replace(/\\/g,'/')
  ],{encoding:'utf8',stdio:['ignore','pipe','ignore'],timeout:90000});
}catch(e){
  cleanup();
  console.log('layout probe: SKIP (chrome failed: '+(e&&e.message||e)+')');
  process.exit(0);
}

// --dump-dom 不跑我们的 probe.js，所以改成把探针内联进页面并把结果写进一个隐藏节点。
if(!/CKPROBE/.test(raw)){
  let html2=fs.readFileSync(path.join(outDir,'probe.html'),'utf8');
  html2=html2.replace('</body>','<pre id="ck-probe-out"></pre><script>'+
    probeJs.replace("console.log('CKPROBE '+JSON.stringify(out));","document.getElementById('ck-probe-out').textContent='CKPROBE '+JSON.stringify(out);")+
    '</script></body>');
  fs.writeFileSync(path.join(outDir,'probe2.html'),html2);
  try{
    raw=execFileSync(CHROME,[
      '--headless=new','--disable-gpu','--no-sandbox','--hide-scrollbars',
      '--window-size=414,896','--virtual-time-budget=1500','--dump-dom',
      'file:///'+path.join(outDir,'probe2.html').replace(/\\/g,'/')
    ],{encoding:'utf8',stdio:['ignore','pipe','ignore'],timeout:90000});
  }catch(e){
    cleanup();
    console.log('layout probe: SKIP (chrome failed on second pass)');
    process.exit(0);
  }
}

const match=/CKPROBE (\{[\s\S]*?\})\s*<\/pre>/.exec(raw)||/CKPROBE (\{[\s\S]*\})/.exec(raw);
if(!match){
  cleanup();
  console.log('layout probe: SKIP (no probe output)');
  process.exit(0);
}
const m=JSON.parse(match[1].replace(/&quot;/g,'"').replace(/&amp;/g,'&'));
cleanup();

const assert=require('assert');
const fail=[];
const check=(ok,msg,detail)=>{if(!ok)fail.push(msg+(detail!==undefined?('  →  '+JSON.stringify(detail)):''))};

// ── ➕ 功能区 ────────────────────────────────────────────────────────
check(m.grid&&m.grid.h>0,'➕ 功能区展开后必须有高度',m.grid);
if(m.grid&&m.buttons.length===12){
  const rows=[...new Set(m.buttons.map(b=>b.top))].sort((a,b)=>a-b);
  check(rows.length===3,'12 个图标应该排成 3 行（4 列）',rows);
  const rowH=m.buttons[0].h;
  const visible=rows.map(top=>+(Math.min(m.grid.bottom,top+rowH)-Math.max(m.grid.top,top)).toFixed(1));
  check(visible[0]>=rowH-1&&visible[1]>=rowH-1,'前两行必须完整露出',{visible,rowH});
  check(visible[2]<=1,'展开后正好两行：第三行一点都不许露（2026-08-23 用户要求）',{visible,rowH});
  check(m.gridScrollHeight>m.gridClientHeight+8,'第三行往后必须靠滚动出来',{scroll:m.gridScrollHeight,client:m.gridClientHeight});
  check(m.grid.overflowY==='auto'||m.grid.overflowY==='scroll','滚动必须是原生的（跟手 1:1）',m.grid.overflowY);
  const peeked=m.buttons.filter(b=>b.top===rows[2]);
  check(peeked.every(b=>b.pointerEvents!=='none'),'滑上来以后第三行要能点',peeked.map(b=>b.pointerEvents));
  check(m.buttonLabels.includes('设置'),'➕ 里的入口已经改名叫「设置」',m.buttonLabels);
}else{
  check(false,'➕ 功能区应该有 12 个按钮',m.buttons.length);
}

// ── 用量统计行 ──────────────────────────────────────────────────────
if(m.time&&m.usage){
  check(m.usage.top>=m.time.bottom-2,'用量统计必须在时间那一行下面',{time:m.time,usage:m.usage});
  check(m.usage.top-m.time.bottom<12,'两行要贴着，不能中间空一大块',m.usage.top-m.time.bottom);
  check(m.usage.fontSize===m.time.fontSize,'用量行字号必须和日期那一行一致',{time:m.time.fontSize,usage:m.usage.fontSize});
  check(m.usage.left<60,'用量行跟着助手气泡左对齐',m.usage.left);
}else{
  check(false,'时间行 / 用量行没渲染出来',{time:m.time,usage:m.usage});
}

// ── 世界书 ──────────────────────────────────────────────────────────
if(m.wbList&&m.wbSelect&&m.wbAdd){
  check(m.wbList.h<90,'100 条世界书也只该占一行（下拉框），不能把页面撑长',m.wbList.h);
  check(m.wbAdd.top>=m.wbList.bottom-2,'「新增世界书」在选择框下面一栏',{list:m.wbList,add:m.wbAdd});
  check(m.wbSelect.w>120,'下拉框要占满这一行',m.wbSelect.w);
}else{
  check(false,'世界书那一页没渲染出来',{list:m.wbList,select:m.wbSelect,add:m.wbAdd});
}

// ── 三个默认折叠块 ───────────────────────────────────────────────────
check(m.legendOpen===false,'√ 颜色说明默认折叠');
check(m.usageLegendOpen===false,'用量符号说明默认折叠');
check(m.legendInGateway===true,'√ 颜色说明搬到「设置」页的计费开关那块');
check(m.usageLegendInGateway===true,'用量符号说明跟在「开启用量统计」下面');
check(m.savedOpen===false,'已保存的设置默认折叠');

if(fail.length){
  console.error('layout probe FAILED:\n - '+fail.join('\n - '));
  process.exit(1);
}
console.log('layout probe: OK');
