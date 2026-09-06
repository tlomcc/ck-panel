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
assert(/<div class="chat-recall-mode-label">召回模式<\/div>/.test(html),'recall mode label missing');
assert(/factRecallMode:'a'/.test(script),'config default must be A');
assert(/fact_recall_mode:chatNormalizeFactRecallMode\(cfg\.factRecallMode\)/.test(script),'gateway field missing');
assert(/RECALL_MODE:chatNormalizeFactRecallMode\(cfg\.factRecallMode\)/.test(script),'RECALL_MODE alias missing');
assert(/function chatNormalizeFactRecallMode\(value\)/.test(script),'mode normalizer missing');
assert(/id="chat-recall-recent-rounds"[^>]+value="10"/.test(html),'recent recall window control missing');
assert(/recallRecentRounds:10/.test(script),'recent recall window default must be 10');
assert(/recall_recent_rounds:chatNormalizeRecallRecentRounds\(cfg\.recallRecentRounds\)/.test(script),'recent recall window must be sent to gateway');
assert(/Math\.max\(0,Math\.min\(100,number\)\)/.test(script),'recent recall window must be clamped to 0-100');
assert(/id="chat-quick-recall-toggle"[^>]*onclick="chatQuickToggleRecall\(\)"/.test(html),'chat header must have a Fact recall quick toggle');
assert(/id="chat-quick-fact-toggle"[^>]*onclick="chatQuickToggleFactMode\(\)"/.test(html),'chat header must have a Fact B quick toggle');
assert(/function chatRenderQuickRecallControls\(cfg\)/.test(script),'quick recall controls need a shared renderer');
assert(/chatRenderQuickRecallControls\(cfg\)/.test(script.slice(script.indexOf('function chatRenderRecallState('),script.indexOf('function chatRenderNcContextState('))),
  'recall state refresh must update header quick controls');
assert(/function chatQuickToggleRecall\(\)/.test(script)&&/chatSetRecallEnabled\(cfg\.recall===false,true\)/.test(script),
  'Fact quick toggle must use the existing recall save path');
assert(/function chatQuickToggleFactMode\(\)/.test(script)&&/chatSetFactRecallMode\(cfg\.factRecallMode==='b'\?'a':'b',true\)/.test(script),
  'Fact B quick toggle must use the existing mode save path');
assert(/\.chat-quick-toggle/.test(fs.readFileSync(path.join(root,'chat.css'),'utf8')),'quick controls need compact chat header styling');

console.log('fact recall mode tests: OK');
