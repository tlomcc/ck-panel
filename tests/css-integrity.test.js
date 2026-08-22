const assert=require('assert');
const fs=require('fs');
const path=require('path');

const root=path.resolve(__dirname,'..');
const files=['tokens.css','style.css','polish.css','chat.css','wechat.css','visual-overrides.css','shell.css','components.css'];
const raw={};
files.forEach(function(f){raw[f]=fs.readFileSync(path.join(root,f),'utf8')});

// ── 没关上的注释会把后面的规则整段吃掉（v203 的 `/* Larger{` 吃掉了 84 行）─────
files.forEach(function(f){
  const comments=raw[f].match(/\/\*[\s\S]*?\*\//g)||[];
  comments.forEach(function(comment){
    assert(!comment.includes('{'),
      f+' 有一处注释吞掉了规则（说明 */ 漏了）："'+comment.slice(0,60).replace(/\s+/g,' ')+'"');
  });
  const open=(raw[f].match(/\{/g)||[]).length,close=(raw[f].match(/\}/g)||[]).length;
  assert.strictEqual(open,close,f+' 花括号不配对：'+open+' 个 { vs '+close+' 个 }');
});

// 去掉注释后才算“活着的规则”
const live={};
files.forEach(function(f){live[f]=raw[f].replace(/\/\*[\s\S]*?\*\//g,'')});
const allLive=files.map(function(f){return live[f]}).join('\n');

// ── Fact 详情底部弹层：JS 还在用这套 eg-detail 外壳，规则必须是活的 ──────────
assert(/\.eg-detail-sheet\{[^}]*position:fixed/.test(live['style.css']),'弹层外壳必须是 fixed，否则会掉进正常文档流挂在页面底部');
assert(/\.eg-detail-sheet\{[^}]*display:none/.test(live['style.css']),'弹层默认必须隐藏，否则输入框下面会露出一条空白和关闭 ×');
['.eg-detail-sheet.show','.eg-detail-mask','.eg-detail-panel','.eg-detail-close','.eg-detail-body','body.eg-sheet-open','@keyframes egSheetUp'].forEach(function(sel){
  assert(allLive.includes(sel),'Fact 详情弹层缺少活的规则：'+sel);
});
const script=fs.readFileSync(path.join(root,'script.js'),'utf8');
assert(script.includes("classList.add('show')")&&script.includes('eg-detail-sheet'),'openFactDetail 仍然靠 .show 打开弹层');

// ── 关系网/小档案页 v203 已删，它的 eg-* 死规则不要再复活 ──────────────────
// （style.css 里还剩几条 body.dark .entity-stats 这类旧首页遗留，属于另一批清理，不在本条断言范围内）
['.entity-fact','.eg-chip','.eg-badge-','.eg-statbar','.eg-card','.eg-fact-chip','.eg-search-clear'].forEach(function(dead){
  assert(!allLive.includes(dead),'已删页面的死 CSS 又回来了：'+dead);
});

console.log('css integrity tests: OK');
