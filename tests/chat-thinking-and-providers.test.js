const assert=require('assert');
const fs=require('fs');

const root=require('path').resolve(__dirname,'..');
const source=fs.readFileSync(require('path').join(root,'script.js'),'utf8');
const html=fs.readFileSync(require('path').join(root,'index.html'),'utf8');
const css=fs.readFileSync(require('path').join(root,'chat.css'),'utf8');

function functionSource(name){
  const start=source.indexOf(`function ${name}(`);
  assert(start>=0,`missing function ${name}`);
  const brace=source.indexOf('{',start);
  let depth=0;
  for(let i=brace;i<source.length;i++){
    if(source[i]==='{')depth++;
    if(source[i]==='}'&&--depth===0)return source.slice(start,i+1);
  }
  throw new Error(`unterminated function ${name}`);
}

const row=functionSource('chatRenderMessageRow');
const parts=functionSource('chatRenderAssistantParts');
const provider=functionSource('providerCardHtml');
const normalize=functionSource('normalizeProvider');
const readCard=functionSource('readProvCard');
const options=functionSource('providerOptionsHtml');
const library=functionSource('renderProviderLibrary');

assert(!/<button[^>]+data-subtab="rolling"/.test(html),'rolling API tab must be removed');
assert(/chat-scroll-jumps/.test(html),'quick scroll controls must remain available');
assert(parts.includes("class=\"chat-thinking\""),'assistant thinking block must render independently');
assert(!parts.includes('chat-bubble'),'assistant parts must not create a nested chat bubble');
assert(row.includes("var inner=assistantParts?(assistantParts.toolTrace+assistantParts.body):esc(m.text||'');"),
  'assistant bubble content must exclude thinking');
assert(row.includes("(role==='assistant'?recall+thinking:'')+bubble+"),
  'thinking must be placed beside recall and before the assistant bubble');
assert(/--ck-aux-block-max-width:min\(700px,82%\)/.test(css),'shared auxiliary block width is missing');
assert(/\.chat-recall,body\.chat-active \.chat-thinking\{[\s\S]*?max-width:var\(--ck-aux-block-max-width\)/.test(css),'thinking and recall must share geometry');

assert(provider.includes('prov-note-input'),'provider note editor is missing');
assert(provider.includes('prov-category-input'),'provider category editor is missing');
assert(provider.includes('p.note||\'\''),'provider note must render from saved data');
assert(provider.includes('p.category||\'\''),'provider category must render from saved data');
assert(provider.includes('<datalist'),'provider categories need reusable datalist choices');
assert(provider.includes('prov-category-chips'),'provider categories need clickable chips');
assert(provider.includes('note.split'),'provider note preview must use the first line');
assert(provider.includes('note.match'),'provider note dates need a badge');
assert(normalize.includes("note:String(p.note||'').trim()"),'provider note must be normalized for saving');
assert(normalize.includes("category:String(p.category||'').trim()"),'provider category must be normalized for saving');
assert(readCard.includes("category:v('.prov-category-input')"),'provider category must be read from the editor');
assert(readCard.includes("note:v('.prov-note-input')"),'provider note must be read from the editor');
assert(library.includes('prov-category'),'categorized providers need a folder section');
assert(library.includes("||'未归类'"),'provider library needs an explicit uncategorized section');
assert(options.includes('<optgroup'),'provider selects must use native category groups');
assert(!source.includes('toggleCategorizedProviderOptions'),'obsolete category expansion button must be removed');

console.log('chat thinking and provider tests: OK');
