const assert=require('assert');
const fs=require('fs');
const vm=require('vm');

const source=fs.readFileSync(require.resolve('../script.js'),'utf8');
const css=fs.readFileSync(require.resolve('../chat.css'),'utf8');

assert(/var CHAT_SCROLL_JUMP_VISIBLE_MS=1500;/.test(source),'production auto-hide delay must be 1.5 seconds');
assert(/\.chat-scroll-jumps\.show\{[\s\S]{0,180}opacity:\.2!important/.test(css),'visible controls must be 80% transparent');

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

const functionNames=[
  'chatScrollJumpControls',
  'chatUpdateScrollJumpState',
  'chatHideScrollJumps',
  'chatScheduleScrollJumpHide',
  'chatRevealScrollJumps',
  'chatMarkScrollJumpManualIntent',
  'chatHasScrollJumpManualIntent',
  'chatBeginScrollJumpPointer',
  'chatContinueScrollJumpPointer',
  'chatEndScrollJumpPointer',
  'chatJumpToEdge',
  'chatAttachScrollJumpControls',
  'chatHandleMessagesScroll'
];

const classes=new Set();
const attributes={};
const boxListeners={};
const windowListeners={};
const documentListeners={};
const topButton={disabled:false,blur(){this.blurred=true}};
const bottomButton={disabled:false,blur(){this.blurred=true}};
const controls={
  __ckAttached:false,
  classList:{add:value=>classes.add(value),remove:value=>classes.delete(value)},
  setAttribute(name,value){attributes[name]=value},
  querySelector:selector=>selector.includes('top')?topButton:bottomButton,
  contains:()=>false,
  addEventListener(){}
};
const box={
  scrollTop:400,
  scrollHeight:1000,
  clientHeight:200,
  addEventListener(type,listener){boxListeners[type]=listener},
  scrollTo({top}){this.scrollTop=top}
};

const context={
  console,
  setTimeout,
  clearTimeout,
  Date,
  Math,
  CHAT_SCROLL_JUMP_VISIBLE_MS:40,
  CHAT_SCROLL_JUMP_INTENT_MS:80,
  chatScrollJumpTimer:null,
  chatScrollJumpManualUntil:0,
  chatScrollJumpPointerActive:false,
  chatScrollJumpPointerX:0,
  chatScrollJumpPointerY:0,
  chatMessagesBox:()=>box,
  chatIsMessagesNearBottom:()=>false,
  chatSetNewMessageHint(){},
  ckPrefersReducedMotion:()=>true,
  document:{
    activeElement:null,
    body:{classList:{contains:value=>value==='chat-active'}},
    getElementById:id=>id==='chat-scroll-jumps'?controls:null,
    addEventListener(type,listener){documentListeners[type]=listener}
  },
  window:{addEventListener(type,listener){windowListeners[type]=listener}}
};

vm.createContext(context);
vm.runInContext(functionNames.map(extractFunction).join('\n'),context);

(async()=>{
  context.chatAttachScrollJumpControls();
  assert.deepStrictEqual(Object.keys(boxListeners).sort(),['pointerdown','touchmove','wheel']);
  assert.deepStrictEqual(Object.keys(windowListeners).sort(),['pointercancel','pointermove','pointerup']);
  assert.deepStrictEqual(Object.keys(documentListeners),[]);

  context.chatHandleMessagesScroll();
  assert(!classes.has('show'),'programmatic scroll must stay hidden');

  boxListeners.wheel();
  context.chatHandleMessagesScroll();
  assert(classes.has('show'),'manual wheel scroll must reveal controls');
  assert.strictEqual(attributes['aria-hidden'],'false');
  await new Promise(resolve=>setTimeout(resolve,70));
  assert(!classes.has('show'),'controls must auto-hide');

  context.chatScrollJumpManualUntil=0;
  boxListeners.pointerdown({button:0,clientX:20,clientY:20});
  windowListeners.pointermove({clientX:21,clientY:21});
  context.chatHandleMessagesScroll();
  assert(!classes.has('show'),'a tap-sized pointer move must stay hidden');
  windowListeners.pointermove({clientX:21,clientY:28});
  context.chatHandleMessagesScroll();
  assert(classes.has('show'),'a dragged scrollbar must reveal controls');
  windowListeners.pointerup();

  context.chatJumpToEdge('top',{preventDefault(){},currentTarget:topButton});
  assert.strictEqual(box.scrollTop,0);
  context.chatJumpToEdge('bottom',{preventDefault(){},currentTarget:bottomButton});
  assert.strictEqual(box.scrollTop,1000);

  const initBody=source.slice(source.indexOf('function chatInit()'),source.indexOf('function chatParseSse',source.indexOf('function chatInit()')));
  assert(!/chatAttachScrollJumpControls\(\);\s*chatRevealScrollJumps\(\);/.test(initBody),'chat init must not reveal controls');
  console.log('chat scroll jump tests: OK');
})().catch(error=>{
  console.error(error);
  process.exit(1);
});
