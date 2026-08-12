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

console.log('fact recall mode tests: OK');
