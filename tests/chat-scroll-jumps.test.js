const assert=require('assert');
const fs=require('fs');

const source=fs.readFileSync(require.resolve('../script.js'),'utf8');
const html=fs.readFileSync(require.resolve('../index.html'),'utf8');
const css=fs.readFileSync(require.resolve('../chat.css'),'utf8');

assert(!/chat-scroll-jumps/.test(source),'quick scroll logic must be removed');
assert(!/chat-scroll-jumps/.test(html),'quick scroll controls must be removed from the chat view');
assert(!/chat-scroll-jumps/.test(css),'quick scroll styles must be removed');
assert(/chat-new-message-tip/.test(html),'new-message hint remains available for unread replies');

console.log('chat scroll jump tests: OK');
