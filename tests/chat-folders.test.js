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

const move=source.slice(source.indexOf('async function chatMoveSession'),source.indexOf('function chatSetSessionSearch'));
assert(move.includes('ckChooseDialog'),'moving a conversation must offer a tappable folder list');
assert(!move.includes('编号'),'moving a conversation must not ask for a typed number');
assert(move.includes("value:'root'"),'the move picker must offer moving a conversation out of every folder');
assert(move.includes("value:'new'"),'the move picker must be able to create a folder on the spot');
const menu=source.slice(source.indexOf('async function chatFolderMenu'),source.indexOf('function chatToggleFolder'));
assert(menu.includes('ckChooseDialog'),'folder menu must be a tappable list');
assert(!menu.includes('输入 1'),'folder menu must not ask for a typed number');
assert(source.includes('chat-folder-empty'),'empty folders must explain how to move conversations in');
assert(/id="ck-action-choices"/.test(html),'the shared dialog needs a choice list container');
const choose=source.slice(source.indexOf('function ckDialogChoose'),source.indexOf('function ckDialogSubmit'));
assert(choose.includes('ckCloseDialog'),'choice buttons must resolve the shared dialog');
assert(source.includes("function ckDialogEmptyValue(mode){return (mode==='prompt'||mode==='choose')?null:false}"),'cancelling a choice dialog must resolve null, not false');

console.log('chat folder tests: OK');
