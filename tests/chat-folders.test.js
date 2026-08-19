const assert=require('assert');
const fs=require('fs');

const source=fs.readFileSync(require.resolve('../script.js'),'utf8');
const html=fs.readFileSync(require.resolve('../index.html'),'utf8');

assert(source.includes("var CHAT_FOLDERS_KEY='ckChatFoldersV1'"),'folder storage key missing');
assert(source.includes("folderId:String(s.folderId||'')"),'old sessions must normalize into the ungrouped folder');
assert(/function chatCreateFolder\(/.test(source),'folder create action missing');
assert(/function chatRenameFolder\(/.test(source),'folder rename action missing');
assert(/function chatToggleFolder\(/.test(source),'folder collapse action missing');
assert(/function chatMoveSession\(/.test(source),'conversation move action missing');
assert(/function chatDeleteFolder\(/.test(source),'folder delete action missing');
const deletion=source.slice(source.indexOf('async function chatDeleteFolder'),source.indexOf('async function chatFolderMenu'));
assert(deletion.includes("session.folderId=''"),'folder deletion must move sessions to ungrouped');
assert(!deletion.includes('chatDeletedSessionIds'),'folder deletion must never delete conversations');
assert(source.includes('if(chatSessionSearch)'),'search must flatten matching conversations');
assert(/id="chat-session-search"/.test(html),'session search field missing');
assert(/onclick="chatCreateFolder\(\)"/.test(html),'new folder button missing');

console.log('chat folder tests: OK');
