const assert=require('assert');
const fs=require('fs');

const source=fs.readFileSync(require.resolve('../script.js'),'utf8');
const html=fs.readFileSync(require.resolve('../index.html'),'utf8');
const css=fs.readFileSync(require.resolve('../chat.css'),'utf8');

assert(/function chatAttachScrollJumpControls\(/.test(source),'quick scroll controls must attach during chat initialization');
assert(/function chatMarkScrollJumpManualIntent\(/.test(source),'quick scroll controls must require manual scroll intent');
assert(/CHAT_SCROLL_JUMP_VISIBLE_MS=1500/.test(source),'quick scroll controls must hide after 1.5 seconds');
assert(/id="chat-scroll-jumps"/.test(html),'quick scroll controls must be present in the chat view');
assert(/chat-scroll-jumps\.show[\s\S]*?opacity:\.2/.test(css),'quick scroll controls must use the requested 80% transparency');
assert(/chat-new-message-tip/.test(html),'new-message hint remains available for unread replies');

console.log('chat scroll jump tests: OK');
