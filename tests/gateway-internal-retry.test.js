const assert=require('assert');
const fs=require('fs');
const path=require('path');

const source=fs.readFileSync(path.resolve(__dirname,'..','script.js'),'utf8');
const html=fs.readFileSync(path.resolve(__dirname,'..','index.html'),'utf8');
const version=JSON.parse(fs.readFileSync(path.resolve(__dirname,'..','version.json'),'utf8'));
const sw=fs.readFileSync(path.resolve(__dirname,'..','sw.js'),'utf8');

assert(html.includes('id="chat-gateway-internal-retry-enabled"'),'retry switch is missing');
assert(html.includes('id="chat-gateway-internal-retry-max"'),'retry limit input is missing');
assert(source.includes('gatewayInternalRetryEnabled:false'),'retry switch default must be off');
assert(source.includes('gatewayInternalRetryMax:1'),'retry limit default is missing');
assert(source.includes('gateway_internal_retry_enabled:cfg.gatewayInternalRetryEnabled===true'),'retry switch is not sent');
assert(source.includes('gateway_internal_retry_max:Math.max(0,Math.min(5'),'retry limit is not clamped before sending');
assert(source.includes("chatSetFieldChecked('chat-gateway-internal-retry-enabled'"),'retry switch is not restored to the form');
assert(source.includes("chatSetFieldValue('chat-gateway-internal-retry-max'"),'retry limit is not restored to the form');
assert(/^chat-v238-/.test(version.version),'version.json was not bumped');
assert(sw.includes('ck-panel-shell-v251-'),'service worker cache generation was not bumped');
assert(sw.includes(version.version),'service worker assets use the current panel version');
console.log('gateway internal retry panel tests: OK');
