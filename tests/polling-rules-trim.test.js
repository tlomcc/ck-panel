const assert=require('assert');
const fs=require('fs');
const vm=require('vm');

const source=fs.readFileSync(require.resolve('../script.js'),'utf8');
const html=fs.readFileSync(require.resolve('../index.html'),'utf8');
const css=fs.readFileSync(require.resolve('../style.css'),'utf8');

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

const context={console,window:{CK_PANEL_VERSION:'test'},document:{querySelectorAll(){return []}},Date,Math,JSON,Object,Array,String,Number,Set,Promise};
vm.createContext(context);
vm.runInContext(`
var apiProviders={provider_library:{providers:[]},chat_polling:{}};
var API_PROVIDER_LIBRARY_KEY='provider_library';
var apiProvIdSeq=0;
${extractFunction('newProvId')}
${extractFunction('cleanModelList')}
${extractFunction('apiProviderLibrarySlot')}
${extractFunction('normalizeProvider')}
${extractFunction('providerLibraryList')}
${extractFunction('apiPollingConfig')}
${extractFunction('apiPollingAvailableItems')}
${extractFunction('providerFingerprint')}
${extractFunction('apiPollingRevision')}
${extractFunction('chatPollingDisplayConfig')}
${extractFunction('chatShouldShowMessageStatus')}
${extractFunction('chatShouldShowBillingPrice')}
`,context);

context.apiProviders={
  provider_library:{providers:[
    {id:'a',name:'A',url:'https://a.example/v1',key:'key-a',model:'model-a',models:[]},
    {id:'b',name:'B',url:'https://b.example/v1',key:'key-b',model:'model-b',models:[]}
  ]},
  chat_polling:{enabled:true,order:[{provider_id:'a',model:'model-a'},{provider_id:'b',model:'model-b'}],show_message_status:false,show_billing_price:true}
};
const items=context.apiPollingAvailableItems();
assert.deepStrictEqual(Array.from(items,x=>x.provider_id),['a','b']);
assert.strictEqual(context.chatShouldShowMessageStatus(),false);
assert.strictEqual(context.chatShouldShowBillingPrice(),true);
const revision=context.apiPollingRevision();
context.apiProviders.provider_library.providers[0].key='key-a-new';
assert.notStrictEqual(context.apiPollingRevision(),revision,'provider credential changes must revise polling config');
context.apiProviders.chat_polling.enabled=false;
assert.strictEqual(context.chatShouldShowMessageStatus(),true);
assert.strictEqual(context.chatShouldShowBillingPrice(),true);

assert(/chat_polling_enabled/.test(source),'chat request must send polling switch');
assert(/delete body\.upstream_key/.test(source),'polling request must remove upstream key');
assert(/var trimCommitted=!!plan\.trimmed/.test(source),'trim must not depend on speech review');
assert(/speechPreferenceRetryMessages/.test(source),'trimmed preference evidence needs an independent retry queue');
assert(/\/ck\/truncate-history/.test(source),'online trim must sync gateway history');
assert(/data-subtab="polling"/.test(html),'polling tab missing');
assert(/data-tab="rules"/.test(html),'rules navigation missing');
assert(!/id="chat-speech-rules"/.test(html),'chat drawer must not contain rule editor');
assert(/\.api-polling-row/.test(css),'polling styles missing');
assert(/\.rules-table-row textarea/.test(css),'editable rules table styles missing');

console.log('polling, rules and trim tests: OK');
