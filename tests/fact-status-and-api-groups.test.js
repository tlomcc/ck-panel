// 覆盖这一轮的四处改动：每日状态只剩 Fact、总览去掉小档案、API 配置新增截断总结组、
// 以及供应商/功能页表单不再溢出（后者只能验样式表，纯字符串断言）。
const assert=require('assert');
const fs=require('fs');
const path=require('path');
const vm=require('vm');

const root=path.join(__dirname,'..');
const source=fs.readFileSync(path.join(root,'script.js'),'utf8');
const styleCss=fs.readFileSync(path.join(root,'style.css'),'utf8');
const indexHtml=fs.readFileSync(path.join(root,'index.html'),'utf8');

function matchBlock(startIndex,open,close){
  const from=source.indexOf(open,startIndex);
  assert(from>=0,'missing opening '+open);
  let depth=0;
  for(let i=from;i<source.length;i++){
    if(source[i]===open)depth++;
    else if(source[i]===close&&--depth===0)return source.slice(startIndex,i+1);
  }
  throw new Error('unterminated block from '+startIndex);
}
function extractFunction(name){
  const start=source.indexOf('function '+name+'(');
  assert(start>=0,'missing function '+name);
  return matchBlock(start,'{','}');
}
function extractArray(name){
  const start=source.indexOf('var '+name+'=[');
  assert(start>=0,'missing array '+name);
  return matchBlock(start,'[',']')+';';
}

function makeDom(){
  const byId={};
  function el(){
    return {className:'',innerHTML:'',textContent:'',attrs:{},
      getAttribute(k){return (k in this.attrs)?this.attrs[k]:null},
      setAttribute(k,v){this.attrs[k]=String(v)},
      querySelector(){return null},querySelectorAll(){return []}};
  }
  return {byId,el,getElementById:id=>byId[id]||null};
}

const esc=s=>String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
const escAttr=s=>esc(s).replace(/"/g,'&quot;');

/* ---- 1. 每日状态：只渲染 Fact，小档案痕迹必须全部消失 ---- */
function dailyStatusContext(){
  const dom=makeDom();
  ['daily-status-body','status-sub'].forEach(id=>{dom.byId[id]=dom.el()});
  const context={console,Date,Number,Math,String,esc,escAttr,
    document:{getElementById:dom.getElementById}};
  vm.createContext(context);
  ['dailyFactStatusLabel','dsText','dsDuration','renderDailyFactStatus','renderDailyStatus']
    .forEach(name=>vm.runInContext(extractFunction(name),context));
  return {context,dom};
}

(function dailyStatusRendersFactOnly(){
  const {context,dom}=dailyStatusContext();
  context.renderDailyStatus({
    today:'2026-08-22',yesterday:'2026-08-21',now:'2026-08-22 14:00',
    // 网关仍然返回 entity，但面板必须完全不看它了。
    entity:{nodes:42,relations:17,yesterday_done:true,today_done:true,updated:'2026-08-22',recent_processed:['2026-08-20']},
    fact_daily:{
      status:'running',target_date:'2026-08-21',stage:'audit',stage_position:3,stage_total:7,
      attempt:2,running_seconds:3725,source_sha_short:'abc123def456',source_state:'stable',
      provider_name:'NC',provider_host:'api.example.com',model:'gemini-3.1-pro',
      last_checkpoint_at:'2026-08-22 13:58',base_generation_short:'gen-aaa',
      published_generation_short:'gen-bbb',commit_sha_short:'ffee11',
      last_success_date:'2026-08-21',enabled:true,
      stats:{candidates:31,audited:20,verified:14,final_facts:9}
    }
  });
  const html=dom.byId['daily-status-body'].innerHTML;
  assert(html.includes('ds-fact ds-fact-running'),'缺少 fact 状态区');
  assert(html.includes('Fact 提取 · 2026-08-21'),'标题没带目标日期');
  assert(html.includes('width:43%'),'进度条比例算错：3/7 应为 43%');
  assert(html.includes('3 / 7 阶段')&&html.includes('audit'),'阶段行不完整');
  ['31','20','14','9'].forEach(n=>assert(html.includes('<b>'+n+'</b>'),'指标 '+n+' 没渲染'));
  assert(html.includes('第 2 次 · 1 小时 2 分'),'尝试/用时格式不对');
  assert(html.includes('abc123def456 · stable'),'来源快照缺失');
  assert(html.includes('NC · api.example.com · gemini-3.1-pro'),'当前 API 缺失');
  assert(html.includes('gen-aaa → gen-bbb')&&html.includes('ffee11'),'generation / commit 缺失');
  ['小档案','关系','档案整理','ds-tile','ds-grid','ds-stat','ds-meta-row','42','17']
    .forEach(dead=>assert(!html.includes(dead),'每日状态仍残留小档案内容：'+dead));
  assert.strictEqual(dom.byId['status-sub'].textContent,'更新于 2026-08-22 14:00');
})();

(function dailyStatusSurfacesStaleAndDisabled(){
  const {context,dom}=dailyStatusContext();
  context.renderDailyStatus({today:'2026-08-22',yesterday:'2026-08-21',
    fact_daily:{status:'blocked',target_date:'2026-08-18',last_success_date:'2026-08-15',
      enabled:false,last_error:'HTTP 429',last_error_code:'rate_limited',next_retry_at:'2026-08-22 15:00'}});
  const html=dom.byId['daily-status-body'].innerHTML;
  assert(html.includes('Fact 已 7 天没有成功提取'),'陈旧告警文案/天数不对');
  assert(html.includes('每日 Fact 任务当前是关闭状态'),'enabled=false 没提示');
  assert(html.includes('id="daily-fact-retry"')&&html.includes('补跑 2026-08-18'),'blocked 应该给补跑按钮');
  assert(html.includes('最近错误（rate_limited）')&&html.includes('下次重试 2026-08-22 15:00'),'错误块信息不全');
  assert(!html.includes('小档案'),'陈旧告警仍写着小档案');
})();

(function retryOnlyForRecoverableStates(){
  const {context,dom}=dailyStatusContext();
  context.renderDailyStatus({today:'2026-08-22',fact_daily:{status:'published',target_date:'2026-08-21',last_success_date:'2026-08-21'}});
  assert(!dom.byId['daily-status-body'].innerHTML.includes('daily-fact-retry'),'已发布不该出现补跑按钮');
})();

/* ---- 2. 总览：不再读 graph 的小档案字段 ---- */
(function overviewIsFactOnly(){
  const dom=makeDom();
  const ids=['archive-spine-facts','archive-spine-vectors','archive-spine-vectors-note',
    'archive-overview-indexed','archive-overview-updated','archive-overview-status','archive-health-grid'];
  ids.forEach(id=>{dom.byId[id]=dom.el()});
  const rendered=[];
  const context={console,Math,Number,String,esc,escAttr,
    numOr:(v,d)=>{const n=Number(v);return isFinite(n)?n:d},
    archiveOverviewRenderFields:()=>rendered.push('fields'),
    archiveOverviewRenderFacts:()=>rendered.push('facts'),
    document:{getElementById:dom.getElementById}};
  vm.createContext(context);
  ['archiveOverviewSetText','archiveOverviewPercent','archiveOverviewLast','archiveOverviewRenderHealth','renderArchiveFactOverview']
    .forEach(name=>vm.runInContext(extractFunction(name),context));

  const graph={top_nodes:[{key:'a',type:'person',has_vector:false}],counts:{nodes:99,relations:88},
    processed_days:['2026-08-20'],indexed_days:['2026-08-21']};
  const facts={updated:'2026-08-22',counts:{total:60,active:50,expired:10,vector_ok:47,vector_missing:3},stale_vector_count:1,
    items:[],facets:{categories:[]}};
  context.renderArchiveFactOverview(graph,facts);

  assert.strictEqual(String(dom.byId['archive-spine-facts'].textContent),'50');
  assert.strictEqual(String(dom.byId['archive-spine-vectors'].textContent),'94%');
  assert.strictEqual(String(dom.byId['archive-overview-indexed'].textContent),'向量化：2026-08-21');
  const status=String(dom.byId['archive-overview-status'].textContent);
  assert(status.includes('已读取 50 条 Active facts'),'总览状态文案不对：'+status);
  assert(status.includes('其中 4 项向量需要检查'),'待检查项数算错：'+status);
  ['小档案','关系','99','88'].forEach(dead=>assert(!status.includes(dead),'总览状态仍提到 '+dead));
  const health=dom.byId['archive-health-grid'].innerHTML;
  assert(!health.includes('档案向量覆盖'),'健康卡仍有档案向量覆盖');
  assert(health.includes('Fact 向量覆盖')&&health.includes('47/50'),'Fact 向量覆盖卡不对');
  assert(health.includes('已过期 Fact')&&health.includes('<b>10</b>'),'过期 Fact 卡不对');
  assert(!health.includes('openArchiveType'),'健康卡还在往信息网跳');
  assert.deepStrictEqual(rendered,['fields','facts']);
})();

/* ---- 3. API 配置：记忆页新增截断总结组 ---- */
(function chatDigestGroupExists(){
  const context={};
  vm.createContext(context);
  vm.runInContext(extractArray('API_TABS'),context);
  vm.runInContext(extractFunction('allApiGroups'),context);
  const memory=context.API_TABS.filter(t=>t.key==='memory')[0];
  assert(memory,'找不到记忆 tab');
  const keys=memory.groups.map(g=>g.key).join(',');
  assert.strictEqual(keys,'mem_profile,fact_extract,speech_preference_extract,chat_digest');
  const group=memory.groups[3];
  assert.strictEqual(group.label,'截断总结');
  assert(group.info.includes('言语要求提取'),'说明里要写清没配时会回落到哪一组');
  assert(context.allApiGroups().some(g=>g.key==='chat_digest'),'allApiGroups 里没有 chat_digest');
  // 网关 chat_digest.py 用的组名必须和面板这里一致，否则永远走回落链路。
  const gateway=path.join(root,'..','ck-gateway-code','chat_digest.py');
  if(fs.existsSync(gateway)){
    const py=fs.readFileSync(gateway,'utf8');
    assert(py.includes("CHAT_DIGEST_MODEL_GROUP = 'chat_digest'"),'网关组名和面板对不上');
  }
})();

/* ---- 4. 表单宽度：功能页的模型选择框和供应商备注框不能再溢出 ---- */
(function formWidthsAreConstrained(){
  const selectRule=/\.prov-model-select,\s*\.assign-model-select\{[^}]*\}/.exec(styleCss);
  assert(selectRule,'.assign-model-select 没有和 .prov-model-select 共用宽度样式');
  assert(/width:100%/.test(selectRule[0])&&/min-width:0/.test(selectRule[0]),'模型选择框缺少宽度约束');
  const textareaRule=/\.prov-row input,\s*\.prov-row textarea\{[^}]*\}/.exec(styleCss);
  assert(textareaRule,'.prov-row textarea 没有跟 input 共用宽度样式（备注框会退回默认 cols 宽度）');
  assert(/width:100%/.test(textareaRule[0]),'备注框缺少 width:100%');
  assert(/\.prov-model-picker\{[^}]*grid-template-columns:minmax\(0,1fr\)/.test(styleCss),'.prov-model-picker 缺少 minmax(0,1fr) 约束');
  assert(!/\.ds-tile\b/.test(styleCss),'style.css 里仍有已删除的 .ds-tile 规则');
  assert(!/\.archive-spine-track/.test(styleCss),'style.css 里仍有已删除的 .archive-spine-track 规则');
})();

/* ---- 5. index.html：信息网入口下线、总览不再有小档案面板 ---- */
(function navAndOverviewMarkup(){
  const nav=/<button class="side-nav-item[^"]*" data-tab="graph"[^>]*>/.exec(indexHtml);
  assert(nav,'找不到 graph 导航项');
  assert(/hidden/.test(nav[0])&&/legacy-nav-entry/.test(nav[0]),'信息网入口没有按遗留项隐藏：'+nav[0]);
  assert(indexHtml.includes('id="tab-graph"'),'实体详情落地页不能删，事实库还要跳进去');
  ['archive-type-list','archive-recent-entities','archive-overview-consolidated',
   'archive-spine-profiles','archive-spine-relations','查看信息网','最近更新的小档案','档案分布']
    .forEach(dead=>assert(!indexHtml.includes(dead),'总览仍残留：'+dead));
  assert(indexHtml.includes('id="day-num"'),'day-num 被 script.js:758 无判空引用，不能删');
  assert(indexHtml.includes('id="archive-spine-facts"')&&indexHtml.includes('id="archive-spine-vectors"'),'总览 spine 缺 fact/向量节点');
})();

console.log('fact-status-and-api-groups: all assertions passed');
