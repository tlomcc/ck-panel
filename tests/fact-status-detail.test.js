// Fact 进程面板"详细详细再详细"（2026-08-26 用户要求）。
//
// 背景：用户看到面板写「尝试 12 次」，而 API 那边有 48 条调用记录，两个数完全对不上——
// 因为 attempt 数的是租约切片（每片最多 5 分钟），一片里可以打很多次 API（分批、拆批、
// 单次调用内部还会重试最多 3 次）。而真正的根因（API 欠费）面板上一个字都没写。
//
// 现在面板要能看到：真实 HTTP 调用次数 / 成功 / 失败 / 按用途 / 按错误 / 最近调用流水，
// 加上重试预算、无进展计数、全部 stats、以及欠费专用横幅。
const assert=require('assert');
const fs=require('fs');
const path=require('path');
const vm=require('vm');

const root=path.resolve(__dirname,'..');
const source=fs.readFileSync(path.join(root,'script.js'),'utf8');
const styleCss=fs.readFileSync(path.join(root,'style.css'),'utf8');

function matchBlock(startIndex,open,close){
  const from=source.indexOf(open,startIndex);
  assert(from>=0,'missing opening '+open);
  let depth=0;
  for(let i=from;i<source.length;i++){
    if(source[i]===open)depth++;
    else if(source[i]===close&&--depth===0)return source.slice(startIndex,i+1);
  }
  throw new Error('unterminated block');
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

const esc=s=>String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
const escAttr=s=>esc(s).replace(/"/g,'&quot;');

const ctx={console,Date,Number,Math,String,esc,escAttr,document:{getElementById:()=>null}};
vm.createContext(ctx);
['dailyFactStatusLabel','dailyFactStageLabel','dsText','dsDuration','dsNum','dsSeconds',
 'dailyFactApiStatsHtml','renderDailyFactStatus']
  .forEach(name=>vm.runInContext(extractFunction(name),ctx));
vm.runInContext(extractArray('DAILY_FACT_STAT_LABELS'),ctx);

const BILLING='HTTP 402（余额不足/欠费）';

function factJob(overrides){
  return Object.assign({
    status:'running',target_date:'2026-08-25',stage:'extract',stage_position:2,stage_total:7,
    attempt:12,retry_rounds:3,retry_limit:8,stalled_slices:0,stalled_limit:12,
    checkpoint_revision:41,running_seconds:600,created_at:'2026-08-25T00:03:00+08:00',
    provider_name:'NC',provider_host:'api.example.com',model:'gemini-3.1-pro',
    stats:{segments:9,candidates:31,audited:20,verified:14,final_facts:0,self_heal_runs:2},
    api_stats:{
      http_calls:48,http_ok:36,http_failed:12,seconds_total:123.456,
      input_tokens:120000,output_tokens:8000,
      by_purpose:{
        '语义分段':{calls:6,ok:6,failed:0,seconds:20.5},
        '提取候选':{calls:42,ok:30,failed:12,seconds:102.956},
      },
      by_error:{[BILLING]:12},
      last_error_type:BILLING,
      recent:[
        {at:'2026-08-25T00:10:00+08:00',purpose:'提取候选',ok:false,seconds:0.4,http_status:402,error_type:BILLING},
        {at:'2026-08-25T00:09:00+08:00',purpose:'提取候选',ok:true,seconds:8.2,http_status:200,error_type:''},
      ],
      billing_hits:12,
    },
  },overrides||{});
}

// ---------------------------------------------------------------------------
// API 调用统计：次数/成功/失败/用途/错误/流水都要露出来
// ---------------------------------------------------------------------------
function testApiStatsRendered(){
  const html=ctx.renderDailyFactStatus(factJob());
  assert(html.includes('共 48 次 · 成功 36 · 失败 12'),'API 总次数和成功失败必须写出来');
  assert(html.includes('累计 123.5s')||html.includes('累计 123.46s'),'累计耗时要写出来');
  assert(html.includes('令牌 入120000/出8000'),'令牌统计要写出来');
  assert(html.includes('按用途'),'要有按用途的分布');
  assert(html.includes('提取候选 42 次（成功 30/失败 12'),'按用途要写清成功失败');
  assert(html.indexOf('提取候选 42')<html.indexOf('语义分段 6'),'按用途要按次数从多到少');
  assert(html.includes('按错误'),'要有按错误的分布');
  assert(html.includes(esc(BILLING)+' × 12'),'错误类型和次数都要写');
  assert(html.includes('最近 2 次调用（新→旧）'),'要有最近调用流水');
  assert(html.includes('❌')&&html.includes('✅'),'流水里成功失败要一眼看得出');
  assert(html.includes('2026-08-25 00:10:00'),'流水要带时间');
}

// ---------------------------------------------------------------------------
// 「尝试 N 次」的含义要写清楚，并且把两个上限一起摊开
// ---------------------------------------------------------------------------
function testSchedulingCountersAreUnambiguous(){
  const html=ctx.renderDailyFactStatus(factJob());
  assert(html.includes('调度切片 / 用时'),'不能再只写「尝试」');
  assert(html.includes('第 12 片（每片最多 5 分钟）'),'要说明一片是什么');
  assert(html.includes('连续重试')&&html.includes('3 / 8 次'),'重试预算要看得到');
  assert(html.includes('连续无进展')&&html.includes('0 / 12 片'),'无进展计数要看得到');
  assert(html.includes('第 41 版'),'断点版本要看得到');
  assert(!/尝试 \/ 用时/.test(html),'旧的模糊文案不要留着');
}

// ---------------------------------------------------------------------------
// 欠费：单独的横幅，而且要说清"充值后点补跑"
// ---------------------------------------------------------------------------
function testBillingBanner(){
  const html=ctx.renderDailyFactStatus(factJob({
    status:'blocked',billing_blocked:true,
    last_error_code:'DAILY_API_BILLING',last_error:'上游 API 报余额不足/欠费，已停止重试',
  }));
  assert(html.includes('ds-fact-banner-bad'),'要有醒目的横幅');
  assert(html.includes('余额不足'),'要直接说是钱的问题');
  assert(html.includes('补跑'),'blocked 状态要给补跑按钮');
  assert(html.includes('不会再无限重试'),'要说明已经不会再从凌晨刷到早上了');

  const exhausted=ctx.renderDailyFactStatus(factJob({status:'blocked',retry_exhausted:true}));
  assert(exhausted.includes('连续重试都失败'),'重试耗尽也要有横幅');

  const stalled=ctx.renderDailyFactStatus(factJob({status:'blocked',is_stalled:true}));
  assert(stalled.includes('没有任何进展'),'原地打转也要有横幅');

  const healthy=ctx.renderDailyFactStatus(factJob());
  assert(!healthy.includes('ds-fact-banner'),'正常跑的时候不要凭空冒横幅');
}

// ---------------------------------------------------------------------------
// 阶段中文名 + 全部计数
// ---------------------------------------------------------------------------
function testStageAndAllCounters(){
  const html=ctx.renderDailyFactStatus(factJob());
  assert(html.includes('提取候选（extract）'),'阶段要给中文名，原始键名也保留');
  assert(html.includes('全部计数'),'18 个 stats 要能看到，不只 4 个');
  assert(html.includes('断点自愈 2'),'自愈次数是排查卡死的关键，必须露出来');
  assert(html.includes('分段 9'));
  // 网关直接给了中文名时优先用它
  assert(ctx.dailyFactStageLabel({stage:'merge',stage_label:'合并入库'}).indexOf('合并入库')===0);
  assert(ctx.dailyFactStageLabel({stage:'weird_new_stage'})==='weird_new_stage','认不出就原样显示，不要报错');
  assert(ctx.dailyFactStageLabel({})==='尚未进入任何阶段');
}

// ---------------------------------------------------------------------------
// 没有数据时不能崩，也不要显示一堆 0
// ---------------------------------------------------------------------------
function testEmptyState(){
  const html=ctx.renderDailyFactStatus({status:'not_created',target_date:'2026-08-25'});
  assert(html.includes('还没有调用过 API'),'没调用过就直接说没调用过');
  assert(!html.includes('按错误'),'没有错误就不要空占一行');
  assert(html.includes('未触发'));
  assert(ctx.renderDailyFactStatus().length>0,'完全没有参数也不许抛异常');
  assert.strictEqual(ctx.dsSeconds(0),'0s');
  assert.strictEqual(ctx.dsSeconds(1.234),'1.23s');
  assert.strictEqual(ctx.dsSeconds(65),'65.0s');
  assert.strictEqual(ctx.dsSeconds(6000),'100min');
  assert.strictEqual(ctx.dsNum(undefined),'0');
}

// ---------------------------------------------------------------------------
// 说明文案要跟着改：触发条件已经不是"发第一条消息"了
// ---------------------------------------------------------------------------
function testNoteText(){
  const note=extractFunction('renderDailyStatus');
  assert(note.includes('定时器自己触发'),'触发条件改了，说明文案必须跟着改');
  assert(!note.includes('在第二天首次聊天时触发'),'旧文案已经不成立了');
  assert(note.includes('和 API 调用次数不是一回事'),'要把用户那个疑问直接写在界面上');
}

// ---------------------------------------------------------------------------
// 样式：新块必须有活着的规则，否则界面会糊成一片
// ---------------------------------------------------------------------------
function testStyles(){
  ['.ds-fact-banner{','.ds-fact-banner-bad{','.ds-fact-sub{','.ds-fact-tags{','.ds-fact-log{']
    .forEach(sel=>assert(styleCss.includes(sel),'缺少样式：'+sel));
  assert(styleCss.includes('body.dark .ds-fact-log{'),'暗色也要给规则');
}

testApiStatsRendered();
testSchedulingCountersAreUnambiguous();
testBillingBanner();
testStageAndAllCounters();
testEmptyState();
testNoteText();
testStyles();

console.log('fact status detail tests: OK');
