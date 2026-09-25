const fs=require('fs');
const path=require('path');

function assert(condition,message){
  if(!condition)throw new Error(message);
}

const root=path.resolve(__dirname,'..');
const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
const script=fs.readFileSync(path.join(root,'script.js'),'utf8');

assert(/name="chat-fact-recall-mode" value="a" checked/.test(html),'A must be the checked default');
assert(/name="chat-fact-recall-mode" value="b"/.test(html),'B option missing');
assert(/A（严格）/.test(html),'A must be labeled strict');
assert(/<div class="chat-recall-mode-label">召回模式<\/div>/.test(html),'recall mode label missing');
assert(/factRecallMode:'a'/.test(script),'config default must be A');
assert(/fact_recall_mode:chatNormalizeFactRecallMode\(cfg\.factRecallMode\)/.test(script),'gateway field missing');
assert(/RECALL_MODE:chatNormalizeFactRecallMode\(cfg\.factRecallMode\)/.test(script),'RECALL_MODE alias missing');
assert(/function chatNormalizeFactRecallMode\(value\)/.test(script),'mode normalizer missing');
assert(/id="chat-recall-recent-rounds"[^>]+value="10"/.test(html),'recent recall window control missing');
assert(/recallRecentRounds:10/.test(script),'recent recall window default must be 10');
assert(/recall_recent_rounds:chatNormalizeRecallRecentRounds\(cfg\.recallRecentRounds\)/.test(script),'recent recall window must be sent to gateway');
assert(/Math\.max\(0,Math\.min\(100,number\)\)/.test(script),'recent recall window must be clamped to 0-100');
assert(/id="chat-quick-fact-toggle"[^>]*onclick="chatQuickToggleFactMode\(\)"/.test(html),'chat header must have a Fact B quick toggle');
assert(!/chat-quick-recall-toggle|chatQuickToggleRecall/.test(html+script),'the duplicate text recall toggle must be gone');
assert(/function chatRenderQuickRecallControls\(cfg\)/.test(script),'quick recall controls need a shared renderer');
assert(/chatRenderQuickRecallControls\(cfg\)/.test(script.slice(script.indexOf('function chatRenderRecallState('),script.indexOf('function chatRenderNcContextState('))),
  'recall state refresh must update header quick controls');
assert(/function chatQuickToggleFactMode\(\)/.test(script)&&/chatSetFactRecallModeField\('b'\)/.test(script)&&/chatSaveRecallSetting\(true\)/.test(script),
  'Fact B quick toggle must enable B or fully disable recall');
assert(/aria-label',factOn\?'关闭 Fact B 召回':'开启 Fact B 召回'/.test(script),
  'Fact B quick toggle needs explicit on/off labels');
assert(/\.chat-quick-fact-toggle/.test(fs.readFileSync(path.join(root,'chat-ui.css'),'utf8')),'quick controls need compact chat header styling');
assert(/chat-quick-fact-toggle/.test(html)&&!/fact-quick-cloud/.test(html),'quick control uses the compact recall icon');
assert(/小模型先判定/.test(script),'strict A description must explain the model gate');

console.log('fact recall mode tests: OK');
