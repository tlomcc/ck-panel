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
const options=functionSource('providerPickerHtml');
const library=functionSource('renderProviderLibrary');

assert(!/<button[^>]+data-subtab="rolling"/.test(html),'rolling API tab must be removed');
assert(/chat-scroll-jumps/.test(html),'quick scroll controls must remain available');
// 2026-08-26 起思考链块可能带 open（未闭合又没正文时默认展开），class 不再是死字符串。
assert(/class="chat-thinking/.test(parts)||parts.includes("'chat-thinking'"),'assistant thinking block must render independently');
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
assert(library.includes('prov-loose'),'uncategorized providers must render outside every folder');
assert(!library.includes('未归类'),'uncategorized providers must not get a fake folder section');
assert(library.includes('renameProviderCategory'),'provider folders need a rename entry');
const renameCategory=functionSource('renameProviderCategory');
assert(renameCategory.includes('ckPromptDialog'),'folder rename must ask for the new name');
assert(renameCategory.includes('persistAndReload'),'folder rename must be saved to the gateway');
assert(renameCategory.includes("p.category=next"),'folder rename must move every provider in that folder');
// 2026-08-24 起选择供应商不再用原生 <select>+<optgroup>（optgroup 不能折叠，25 个照样一次铺完），
// 换成先点文件夹再点供应商的两级选择器；详见 tests/provider-picker.test.js。
assert(options.includes('provider-pick-value'),'选择器的值要放在隐藏 input 上，读值的老代码才不用改');
assert(options.includes('openProviderPicker(this)'),'按钮要能打开两级选择器');
assert(!source.includes('providerOptionsHtml'),'原生 optgroup 版本已经被两级选择器取代，别留着两套');
assert(!source.includes('api-polling-add-select'),'轮询那个平铺下拉也要一起换掉，它是唯一没分组的一个');
assert(!source.includes('toggleCategorizedProviderOptions'),'obsolete category expansion button must be removed');

// ── 加供应商时顺手维护费用和缓存策略（2026-08-23 用户要求）─────────────────
// 两个都是可选的：不填也能保存，价格落回面板默认价、策略跟随聊天面板。
assert(provider.includes('providerCacheStrategyHtml(p)'),'供应商卡片要有缓存策略下拉');
assert(provider.includes('providerPriceHtml(p)'),'供应商卡片要有费用维护块');
assert(provider.indexOf('providerCacheStrategyHtml(p)')<provider.indexOf('prov-save'),'两块都要在「保存供应商」上面');
assert(normalize.includes('cache_strategy:providerNormalizeCacheStrategy(p.cache_strategy||p.cacheStrategy)'),
  '缓存策略要在 normalizeProvider 里归一（含驼峰别名）');
assert(normalize.includes('pricing:providerNormalizePricing(p.pricing)'),'单价要在 normalizeProvider 里归一');
assert(readCard.includes("providerNormalizeCacheStrategy(v('.prov-cache-strategy'))"),'缓存策略要从表单读回来');
assert(readCard.includes('pricing:readProvCardPricing(card,old)'),'单价要从表单读回来');
const saveProv=functionSource('saveProvider');
assert(saveProv.includes('p.cache_strategy=d.cache_strategy')&&saveProv.includes('p.pricing=d.pricing'),
  '保存供应商必须把这两项写回去');
const fetchModels=functionSource('fetchProviderModels');
assert(fetchModels.includes('p.cache_strategy=d.cache_strategy')&&fetchModels.includes('p.pricing=d.pricing'),
  '拉取模型也会整份写回供应商，不带上这两项就会把刚填的价格和策略抹掉');
assert(functionSource('addProvider').includes("cache_strategy:'',pricing:null"),
  '新建的供应商默认两项都不填');
// 老配置搬家：v208 把这两项存在轮询 order 上，加载时要接过来，只补不覆盖。
const adopt=functionSource('providerAdoptLegacyPollingFields');
assert(adopt.includes('providerNormalizeCacheStrategy(p.cache_strategy)')&&adopt.includes('providerNormalizePricing(p.pricing)'),
  '搬家只在供应商自己没维护过时才接管老值');
assert(functionSource('normalizeApiProviders').includes('providerAdoptLegacyPollingFields()'),
  '加载配置时要跑一次搬家');
// 单链路：主链路供应商自己维护了策略就按它走，没维护才跟随聊天面板。
const effective=functionSource('chatEffectiveCacheStrategy');
assert(effective.includes('mainRouteCacheStrategy'),'单链路要认主链路供应商那份策略');
assert(effective.includes('chatPollingView().enabled===true'),'轮询开着时要发聊天面板那个全局策略，让网关按候选覆盖');
assert(functionSource('chatApplyMainRouteToConfig').includes('providerCacheStrategy(route.provider)'),
  '主链路解析时把供应商那份策略带出来');
assert(source.includes('chatCacheStrategyMeta(chatEffectiveCacheStrategy(cfg))'),
  '发请求时算的必须是生效策略，否则 TTL 和旧召回保留时长会跟策略不一致');
assert(functionSource('chatRenderCacheStrategyState').includes('主链路供应商自带策略'),
  '被供应商那份覆盖时界面必须写出来，不能让用户以为面板的选择坏了');

console.log('chat thinking and provider tests: OK');
