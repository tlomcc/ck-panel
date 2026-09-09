const assert=require('assert');
const fs=require('fs');
const path=require('path');

const root=path.resolve(__dirname,'..');
const source=fs.readFileSync(path.join(root,'script.js'),'utf8');
const html=fs.readFileSync(path.join(root,'index.html'),'utf8');

assert(source.includes("thinkingMode:'off'"),'new users must keep thinking disabled');
assert(source.includes("if(thinkingMode!=='off')body.thinking_mode=thinkingMode"),
  'off mode must not add a new request field');
assert(source.includes("body.native_thinking_enabled=true"),
  'native mode must be explicit at the request boundary');
assert(source.includes('body.thinking_budget_tokens=thinkingBudgetTokens'),
  'native budget must be sent as a top-level request field');
assert(source.includes('thinking:nativeThinkingText'),
  'native thinking must be attached to the visible assistant message separately');
assert(source.includes('m.thinking'),
  'native thinking must participate in local rendering and cache invalidation');
assert(/id="chat-thinking-mode"/.test(html),'thinking mode control is missing');
assert(/id="chat-thinking-budget"/.test(html),'thinking budget control is missing');
assert(/value="off"/.test(html)&&/value="native"/.test(html)&&/value="compat"/.test(html),
  'the three thinking modes are missing');
assert(/id="chat-fake-thinking"/.test(html),'legacy compatibility switch must remain available');
assert(/id="chat-thinking-budget-unavailable"/.test(html)&&html.includes('不可用'),
  'native budget must show an unavailable state outside native mode');
assert(/id="chat-native-thinking-visible"/.test(html),
  'native thinking display switch is missing');
assert(source.includes("fake.disabled=mode==='native'"),
  'native mode must disable the compatibility thinking switch');
assert(source.includes("body.thinking_prompt=String(cfg.thinkingPrompt"),
  'native mode must send the shared thinking prompt separately');
assert(source.includes('chatShouldShowNativeThinking()'),
  'native thinking display must have a render gate');
assert(/chatRenderStreamingAssistantContent\(\s*assistantText,toolEvents,nativeThinkingText,false(?:,|\))/.test(source),
  'streaming native thinking must stay out of the temporary assistant bubble');

console.log('native thinking panel tests: OK');
