const assert=require('assert');
const fs=require('fs');
const vm=require('vm');

const source=fs.readFileSync(require.resolve('../script.js'),'utf8');

function extractFunction(name){
  const start=source.indexOf(`function ${name}(`);
  assert(start>=0,`missing function ${name}`);
  const brace=source.indexOf('{',start);
  let depth=0;
  for(let index=brace;index<source.length;index++){
    if(source[index]==='{')depth++;
    if(source[index]==='}'&&--depth===0)return source.slice(start,index+1);
  }
  throw new Error(`unterminated function ${name}`);
}

function response(status){return {status,ok:status>=200&&status<300}}

async function testPanelDataFetch(){
  const context={console,fetch:null,verifyPanelKey:null,cleared:[],authCalls:[],runCalls:0};
  context.ensurePanelAuthenticated=opts=>{
    context.authCalls.push(opts||{});
    return Promise.resolve(opts&&opts.forcePrompt?'replacement-key':'verified-key');
  };
  context.urlWithPanelKey=(url,key)=>url+'?key='+key;
  context.clearPanelAuthentication=key=>context.cleared.push(key);
  vm.createContext(context);
  vm.runInContext(extractFunction('panelDataFetch'),context);

  context.fetch=()=>{context.runCalls++;return Promise.resolve(response(403))};
  context.verifyPanelKey=()=>Promise.resolve(true);
  let result=await context.panelDataFetch('https://gateway.test/provider-models');
  assert.strictEqual(result.status,403,'supplier 403 must remain a business response');
  assert.deepStrictEqual(context.cleared,[],'supplier 403 must not clear the CK key');
  assert.strictEqual(context.authCalls.length,1,'supplier 403 must not prompt again');

  context.cleared=[];context.authCalls=[];context.runCalls=0;
  context.fetch=()=>Promise.resolve(response(context.runCalls++===0?403:200));
  context.verifyPanelKey=key=>Promise.resolve(key==='replacement-key');
  result=await context.panelDataFetch('https://gateway.test/config');
  assert.strictEqual(result.status,200,'a confirmed-invalid CK key must retry with the replacement');
  assert.deepStrictEqual(context.cleared,['verified-key']);
  assert.strictEqual(context.authCalls.length,2);
  assert.strictEqual(context.authCalls[1].forcePrompt,true);

  context.cleared=[];context.authCalls=[];context.runCalls=0;
  context.fetch=()=>Promise.resolve(response(403));
  context.verifyPanelKey=()=>Promise.reject(new Error('network unavailable'));
  result=await context.panelDataFetch('https://gateway.test/provider-models');
  assert.strictEqual(result.status,403);
  assert.deepStrictEqual(context.cleared,[],'an unavailable recheck must preserve the current key');
  assert.strictEqual(context.authCalls.length,1);
}

function testMemoryAuthenticationSurvivesStorageFailure(){
  const context={
    console,
    panelAuthKey:'',
    saveRequestedApiKey:()=>false,
    setPanelAuthLocked(){},
    resumePanelDataTimers(){},
    readStoredPanelKey:()=>''
  };
  vm.createContext(context);
  vm.runInContext([
    extractFunction('isPanelAuthenticated'),
    extractFunction('saveVerifiedPanelKey')
  ].join('\n'),context);
  assert.strictEqual(context.saveVerifiedPanelKey('verified-key'),false);
  assert.strictEqual(context.panelAuthKey,'verified-key');
  assert.strictEqual(context.isPanelAuthenticated(),true,'verified in-memory auth must survive localStorage failure');
}

function testTrimConfigAndSystemPrompt(){
  const context={console,CHAT_AUTO_TRIM_DEFAULT_KEEP_ROUNDS:200};
  vm.createContext(context);
  vm.runInContext([
    extractFunction('chatPositiveIntOrDefault'),
    extractFunction('chatNormalizeAutoTrimConfig'),
    extractFunction('chatComposeSystemPrompt')
  ].join('\n'),context);
  assert.strictEqual(context.chatNormalizeAutoTrimConfig({keep:120}).keep,120,'120 rounds must remain configurable');
  assert.strictEqual(context.chatNormalizeAutoTrimConfig({keep:1}).keep,1,'one round must remain configurable');
  assert.strictEqual(context.chatNormalizeAutoTrimConfig({keep:9999}).keep,9999,'large round counts must remain configurable');
  assert.strictEqual(context.chatNormalizeAutoTrimConfig({keep:0}).keep,200,'zero must fall back to the default');
  assert.strictEqual(context.chatNormalizeAutoTrimConfig({keep:'invalid'}).keep,200,'invalid values must fall back to the default');
  assert.strictEqual(context.chatComposeSystemPrompt({system:''}),'','empty custom system prompt must stay empty');
  assert.strictEqual(context.chatComposeSystemPrompt({system:'只按我填写的内容'}),'只按我填写的内容','custom system prompt must pass through unchanged');
}

// 聊天抽屉的措辞偏好是纯预览：只显示条数和规则正文，
// 不得出现版本号、diff、发布按钮或其他管理控件。管理入口在独立的规则管理页。
function testSpeechPreferenceStatusRendering(){
  const elements={
    'chat-speech-meta':{textContent:''},
    'chat-speech-preview':{innerHTML:''},
    'chat-speech-status':{textContent:''}
  };
  const context={
    console,
    chatSpeechConsoleState:{data:null,loading:false,saving:false,editorSnapshot:''},
    document:{getElementById:id=>elements[id]||null},
    esc:value=>String(value)
  };
  vm.createContext(context);
  vm.runInContext(extractFunction('chatRenderSpeechPreferences'),context);

  context.chatRenderSpeechPreferences({
    rules:[{key:'tone',instruction:'保持清晰'},{key:'addr',instruction:'不要叫我宝宝'}],
    current_revision:'r7-test',previous_revision:'r6-test',
    updated_at:'2026-08-10T23:45:54+08:00',
    last_activation_at:'2026-08-11T00:10:00+08:00',
    pending_count:0,source:'github',diff:{}
  },false);
  assert.strictEqual(elements['chat-speech-meta'].textContent,'条数：2','预览只显示条数');
  assert(elements['chat-speech-preview'].innerHTML.includes('保持清晰'),'必须显示规则正文');
  assert(elements['chat-speech-preview'].innerHTML.includes('不要叫我宝宝'),'必须显示全部规则正文');
  const rendered=elements['chat-speech-meta'].textContent+elements['chat-speech-preview'].innerHTML;
  assert(!rendered.includes('r7-test'),'预览不得出现版本号');
  assert(!rendered.includes('r6-test'),'预览不得出现上一版版本号');
  assert(!rendered.includes('待激活'),'预览不得出现待激活等管理信息');

  context.chatRenderSpeechPreferences({rules:[],enabled:false,source:'github'},false);
  assert.strictEqual(elements['chat-speech-meta'].textContent,'条数：0（已停用）','停用状态要能看出来');
  assert(elements['chat-speech-preview'].innerHTML.includes('暂无生效规则'));
}

const prepareTimeoutMatch=source.match(/var CHAT_SPEECH_PREFERENCE_PREPARE_TIMEOUT_MS=(\d+);/);
assert(prepareTimeoutMatch,'missing speech preference prepare timeout');
assert(Number(prepareTimeoutMatch[1])>60000,'frontend timeout must exceed the default backend prepare budget');
testMemoryAuthenticationSurvivesStorageFailure();
testTrimConfigAndSystemPrompt();
testSpeechPreferenceStatusRendering();
testPanelDataFetch().then(()=>console.log('panel auth tests: OK')).catch(error=>{
  console.error(error);
  process.exit(1);
});
