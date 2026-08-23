const assert=require('assert');
const fs=require('fs');
const path=require('path');

const root=path.resolve(__dirname,'..');
const read=f=>fs.readFileSync(path.join(root,f),'utf8');
const html=read('index.html');
const source=read('script.js');
const css={
  chat:read('chat.css'),
  wechat:read('wechat.css'),
  visual:read('visual-overrides.css'),
  style:read('style.css'),
  polish:read('polish.css'),
  components:read('components.css'),
  shell:read('shell.css')
};
const allCss=Object.values(css).join('\n');

// ── ➕ 功能区：一页 2 行 4 列，其余上滑（原生滚动）出来；分页那套整体拆掉 ────
assert(/id="chat-plus-grid"/.test(html),'the plus tray must be a single grid');
assert(!/chat-plus-page/.test(html),'paged plus tray markup must be gone');
assert(!/chat-plus-dots|chat-plus-dot"/.test(html),'plus pager dots must be gone');
assert(!/chat-plus-arrow/.test(html),'plus pager arrows must be gone');
const trayButtons=(html.match(/<div class="chat-plus-grid"[\s\S]*?<\/div>/)||[''])[0];
assert((trayButtons.match(/<button/g)||[]).length===12,'all 12 plus entries must live in one grid');
['相册','拍摄','上传文件','提示词','设置','世界书','记忆','分条','截断','调试','清理','措辞偏好'].forEach(function(label){
  assert(trayButtons.includes('<b>'+label+'</b>'),'plus tray lost entry '+label);
});
['chatPlusRenderPager','chatPlusSetPage','chatPlusPrevPage','chatPlusNextPage','chatPlusHandleTouchStart','chatPlusPager'].forEach(function(name){
  assert(!source.includes(name),'dead pager code still present: '+name);
});
assert(/function chatInitPlusPager\(/.test(source),'plus tray still needs its tabIndex guard');
['chat-plus-arrow','chat-plus-dot','chat-plus-page'].forEach(function(cls){
  assert(!allCss.includes(cls),'dead plus CSS still present: '+cls);
});
assert(/\.chat-plus-grid\{[^}]*grid-auto-rows/.test(css.wechat.replace(/\s+/g,'')) ||
  /grid-auto-rows/.test(css.wechat),'rows must follow the entry count instead of a fixed 2×70px');
assert(!/grid-template-rows:repeat\(2,70px\)/.test(css.wechat),'the fixed second row (permanently half empty) must be gone');
// 只露 2 行必须靠"限高 + 网格自己能滚"实现，不许改行模板、不许回到 JS 分页。
// 2026-08-23 起第三行一点都不露（用户说露半行太高了）：peek 归零，公式里只留一个 gap。
const wechatFlat=css.wechat.replace(/\/\*[\s\S]*?\*\//g,'').replace(/\s+/g,'');
assert(/--ck-plus-view:calc\(var\(--ck-plus-row\)\*2\+var\(--ck-plus-gap\)\+var\(--ck-plus-peek\)\)/.test(wechatFlat),
  'the open tray must be exactly 2 rows tall: row*2 + one gap + peek');
assert(/--ck-plus-peek:0px/.test(wechatFlat),'peek must be 0 — no half-visible third row');
assert(!/--ck-plus-peek:(?!0px)/.test(wechatFlat),'no media query may re-introduce a peeked third row');
assert(/\.chat-plus-grid\{[^}]*max-height:var\(--ck-plus-view\)/.test(wechatFlat),'the grid itself must be the scroll container');
assert(/\.chat-plus-grid\{[^}]*overflow-y:auto/.test(wechatFlat),'scrolling must be native (finger-following), not JS-paged');
assert(!/pointer-events:none/.test((wechatFlat.match(/\.chat-plus-grid>button\{[^}]*\}/)||[''])[0]),
  'rows scrolled into view must stay clickable');
const iconSizes=[css.chat,css.wechat,css.visual].filter(function(text){
  const flat=text.replace(/\/\*[\s\S]*?\*\//g,'').replace(/\s+/g,'');
  const rules=flat.match(/\.chat-plus[^{}]*svg\{[^}]*\}/g)||[];
  return rules.some(function(rule){
    const body=rule.slice(rule.indexOf('{')+1,-1);
    return body.split(';').some(function(decl){return decl.startsWith('width:')});
  });
});
assert(iconSizes.length===1,'plus icon size must be defined in exactly one file, found '+iconSizes.length);

// ── .chat-side-tabs 是指向不存在元素的整套死代码 ───────────────────────
assert(!allCss.includes('chat-side-tabs'),'dead .chat-side-tabs styles must be gone');
assert(!source.includes('chat-side-tabs'),'dead .chat-side-tabs query must be gone');
assert(/id="chat-side-model"/.test(html)&&/id="chat-side-debug"/.test(html),'side panels themselves must stay');

// ── 抽屉统一节奏 ────────────────────────────────────────────────────
assert(/input\[readonly\]/.test(css.wechat),'readonly fields must look read-only');
assert(/\.chat-memory-card p\.chat-field-hint/.test(css.wechat),'hint text must render at one size everywhere');
assert(/#chat-thinking-prompt/.test(css.wechat),'the tallest textarea needs a height cap like its siblings');
assert(/\.chat-wide-btn,[\s\S]{0,200}\.chat-cache-save-btn/.test(css.wechat),'panel buttons must share one height');
assert(/\.chat-cache-mode-actions\{\s*grid-template-columns:auto/.test(css.wechat),'the save button column must size to its content');
assert(/\.chat-cache-save-status\{[^}]*min-height/.test(css.wechat),'a wrapping status line must not change the row height');
assert(/\.chat-trim-state\{[^}]*border-left/.test(css.wechat),'the state card must be told apart from description cards');
assert(/#chat-side-worldbook \.chat-worldbook-list\{[^}]*border-bottom/.test(css.wechat),'worldbook list and editor need a divider');
assert(/\.chat-speech-preview\{[^}]*max-height:none/.test(css.wechat),'the speech preview must not open a second scroll layer');
assert(!/border:1px solid rgba\(18,140,76,\.16\)/.test(css.chat),'dead .chat-recall-switch declarations must be gone');

// ── 面板内部顺序：说明卡紧贴它解释的控件；操作按钮分主次 ─────────────────
const trim=html.slice(html.indexOf('id="chat-side-trim"'),html.indexOf('id="chat-side-debug"'));
assert(trim.indexOf('轮数上限</b>')<trim.indexOf('chat-auto-trim-round-limit-enabled'),'the round-limit card must sit above its own controls');
assert(trim.indexOf('通知方式</b>')<trim.indexOf('chat-auto-trim-prefix-silent'),'the notification card must sit above its own switch');
assert((trim.match(/chat-wide-btn/g)||[]).length===1,'only one primary button per panel');
assert(/chat-manual-trim-btn[^>]*>/.test(trim)&&/btn-outline/.test(trim),'manual actions must be secondary buttons');
const worldbook=html.slice(html.indexOf('id="chat-side-worldbook"'),html.indexOf('id="chat-side-memory"'));
assert(/btn-red/.test(worldbook),'deleting a worldbook entry must read as destructive');
assert(worldbook.indexOf('当前这一条')<worldbook.indexOf('chat-worldbook-name'),'the editor needs a heading that separates it from the list');
// 世界书改成下拉选择：维护 100 条也只占一行，选择框一栏、新增一栏。
assert(/id="chat-worldbook-list"/.test(worldbook),'the picker container must stay (wechat.css targets it)');
assert(/chat-worldbook-add-btn[\s\S]*?新增世界书/.test(worldbook),'新增世界书 must sit in its own row under the picker');
assert(worldbook.indexOf('chat-worldbook-list')<worldbook.indexOf('chat-worldbook-add'),'选择框在上，新增在下');
const worldbookRender=source.slice(source.indexOf('function chatRenderWorldbooks('));
assert(/chat-worldbook-select[\s\S]{0,400}onchange="chatSelectWorldbook\(this\.value\)"/.test(worldbookRender),
  'the picker must be a <select> that still routes through chatSelectWorldbook (draft flush)');
assert(!/class="chat-worldbook-row /.test(worldbookRender),'the one-row-per-entry list must be gone');
const model=html.slice(html.indexOf('id="chat-side-model"'),html.indexOf('id="chat-side-speech"'));
assert(model.indexOf('伪思考链</b>')<model.indexOf('chat-fake-thinking'),'the switch needs its explanation above it, not a hint below a later field');

console.log('plus panel layout tests: OK');
