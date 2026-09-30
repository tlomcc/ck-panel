const {test}=require('node:test');
const assert=require('node:assert/strict'),fs=require('fs'),vm=require('vm');
const source=fs.readFileSync(require.resolve('../chat-digest.js'),'utf8');
const history=require('../chat-history.js');
const plain=value=>JSON.parse(JSON.stringify(value));
const stamp=(day,time='12:00')=>new Date(day+'T'+time+':00').getTime();
function setup(){
  let now=stamp('2026-09-30'),reply;
  const cfg={panelKey:'fixture',gatewayUrl:'https://fixture.invalid',dailyDigestEnabled:true,dailyDigestRetentionDays:3,dailyDigestDetailDays:1,dailyDigestRollupDays:2};
  const session={id:'s',messages:[],dailyDigests:[]},calls=[],nodes={};
  const ctx={console,AbortController,setTimeout,clearTimeout,setInterval,clearInterval,
    Date:class extends Date{constructor(...args){super(...(args.length?args:[now]))}static now(){return now}},
    CKChatHistory:history,CHAT_DAILY_DIGEST_TIMEOUT_MS:1000,CHAT_NEW_SESSION_DIGEST_SOURCE_TITLE:'小克',
    chatSessions:[session],chatSessionsReady:true,chatMessages:session.messages,
    chatLoadConfig:()=>cfg,chatCurrentSession:()=>session,chatSaveSessions:()=>{},chatDebug:()=>{},toast:()=>{},
    chatSetFieldValue:(id,value)=>{if(nodes[id])nodes[id].value=String(value)},chatSetFieldChecked:()=>{},chatFieldChecked:()=>true,
    chatSplitThinkingText:text=>({text:text.replace(/<thinking>[\s\S]*?<\/thinking>/g,'')}),
    document:{getElementById:id=>nodes[id]||null},
    fetch:async(url,options)=>{const body=JSON.parse(options.body);calls.push(body);return {ok:true,json:async()=>reply?reply(body):{ok:true,prepared:true,merge_with_previous:!!body.previous?.length,text:body.mode==='rolling_summary'?'合并：'+body.summaries.map(r=>r.text).join('；'):(body.previous?.[0]?.text||'')+'新日记'+body.day_key}}}
  };
  vm.createContext(ctx);vm.runInContext(source,ctx);
  return {ctx,cfg,session,calls,nodes,advance:days=>now+=days*86400000,reply:value=>reply=value,
    entry:(day,text)=>({dayKey:day,text,startTs:stamp(day),endTs:stamp(day)}),
    turn:(day,id,start,end)=>[{role:'user',text:'问题 '+id,turnId:id,ts:stamp(day,start||'10:00')},{role:'assistant',text:'答复 '+id,turnId:id,ts:stamp(day,end||'10:01')}],
    run:messages=>ctx.chatDailyDigestRequest(cfg,{sessionId:'s',messages,trigger:'manual_trim'}),
    commit:prepared=>{assert.ok(prepared);session.dailyDigests=prepared.entries;session.digestRollup=prepared.rollup;}
  };
}
test('n excludes today; x and y select adjacent natural-day windows with exact headers',()=>{
  const x=setup();x.session.dailyDigests=[26,27,28,29,30].map(day=>x.entry('2026-09-'+day,'日期'+day));
  assert.deepEqual(plain(x.ctx.chatDailyDigestEntries(x.session).map(r=>r.dayKey)),['2026-09-27','2026-09-28','2026-09-29','2026-09-30']);
  const source=x.ctx.chatDigestRollupSource(x.cfg,x.session);
  x.session.digestRollup={start:source.range.start,end:source.range.end,text:'两天大总结',source:source.stamp};
  assert.equal(x.ctx.chatDailyDigestPack(x.cfg,x.session),'【2026-09-27-2026-09-28】\n两天大总结\n\n【2026-09-29】\n日期29\n\n【2026-09-30】\n日期30');
  x.cfg.dailyDigestRetentionDays=5;x.cfg.dailyDigestDetailDays=2;x.cfg.dailyDigestRollupDays=1;
  assert.equal(x.ctx.chatDigestRollupSource(x.cfg,x.session).range.start,'2026-09-27');
  x.cfg.dailyDigestEnabled=false;assert.equal(x.ctx.chatDailyDigestPack(x.cfg,x.session),'');
});
test('legacy cross-midnight summaries merge into the ending date without losing text or coverage',()=>{
  const x=setup(),rows=x.ctx.chatDailyDigestNormalize([
    x.entry('2026-09-29','昨天'),{startTs:stamp('2026-09-29','23:50'),endTs:stamp('2026-09-30','00:10'),text:'跨日'},
    {...x.entry('2026-09-30','今天'),covered:['turn-a']}
  ]);
  assert.equal(rows.length,2);assert.equal(rows[1].dayKey,'2026-09-30');assert.match(rows[1].text,/跨日[\s\S]*今天/);
  assert.deepEqual(plain(rows[1].covered),['turn-a']);assert.equal(x.ctx.chatDailyDigestBlockText(rows[1]).split('\n')[0],'【2026-09-30】');
  assert.deepEqual(plain(x.ctx.chatDailyDigestNormalize(rows)),plain(rows));
});
test('x/y zero, gaps, year boundaries and long retained records are not silently capped',()=>{
  const x=setup();assert.equal(x.ctx.chatDigestShiftDay('2028-03-01',-1),'2028-02-29');assert.equal(x.ctx.chatDigestShiftDay('2026-01-01',-1),'2025-12-31');
  x.cfg.dailyDigestRetentionDays=100;x.cfg.dailyDigestDetailDays=100;x.cfg.dailyDigestRollupDays=0;
  x.session.dailyDigests=Array.from({length:101},(_,i)=>x.entry(x.ctx.chatDigestShiftDay('2026-09-30',-i),'正文'.repeat(600)));
  const pack=x.ctx.chatDailyDigestPack(x.cfg,x.session);assert.equal((pack.match(/^【/gm)||[]).length,101);assert.ok(pack.length>100000);
  x.cfg.dailyDigestDetailDays=0;assert.equal((x.ctx.chatDailyDigestPack(x.cfg,x.session).match(/^【/gm)||[]).length,1);
  x.cfg.dailyDigestRetentionDays=3;x.cfg.dailyDigestDetailDays=1;x.cfg.dailyDigestRollupDays=2;x.session.dailyDigests=[x.entry('2026-09-26','太旧'),x.entry('2026-09-28','有记录')];
  assert.equal(x.ctx.chatDailyDigestPack(x.cfg,x.session),'【2026-09-27-2026-09-28】\n有记录');
});
test('preparation groups by complete turn end date, strips thinking, and reuses saved coverage',async()=>{
  const x=setup();x.cfg.dailyDigestRollupDays=0;
  const raw=[...x.turn('2026-09-29','a'),{role:'user',text:'晚上',turnId:'night',ts:stamp('2026-09-29','23:50')},{role:'assistant',text:'<thinking>秘密思考</thinking>今晨',turnId:'night',ts:stamp('2026-09-30','00:10')}];
  const result=await x.run(raw);assert.ok(result);assert.equal(x.calls.length,2);assert.equal(x.session.dailyDigests.length,0,'prepare must not mutate storage');
  assert.deepEqual(x.calls.map(b=>b.day_key),['2026-09-29','2026-09-30']);assert.ok(!JSON.stringify(x.calls).includes('秘密思考'));
  assert.equal(result.entries.length,2);x.commit(result);const count=x.calls.length;await x.run(raw);assert.equal(x.calls.length,count,'same turns must not be summarized twice');
  const next=await x.run(x.turn('2026-09-30','next'));assert.equal(next.entries.length,2);assert.equal(x.calls.at(-1).previous[0].text,result.entries[1].text);
});
test('rolling big summary consumes the y source box only, never raw chat or x/today summaries',async()=>{
  const x=setup();x.session.dailyDigests=[27,28,29,30].map(d=>x.entry('2026-09-'+d,'source-'+d));
  const result=await x.run([]);assert.ok(result);assert.equal(x.calls.length,1);const call=x.calls[0];
  assert.equal(call.mode,'rolling_summary');assert.equal(call.messages,undefined);assert.deepEqual(call.summaries.map(r=>r.day_key),['2026-09-27','2026-09-28']);
  x.commit(result);await x.run([]);assert.equal(x.calls.length,1,'unchanged range should use the stored rollup');
  x.advance(1);const next=await x.run([]);assert.equal(x.calls.length,2);assert.equal(next.rollup.start,'2026-09-28');assert.equal(next.rollup.end,'2026-09-29');
});
test('midnight maintenance completes unsummarized days, leaves today for its own box, and survives reload',async()=>{
  const x=setup();x.cfg.dailyDigestRollupDays=0;x.session.messages.push(...x.turn('2026-09-29','yesterday'),...x.turn('2026-09-30','today'));
  assert.equal(await x.ctx.chatRefreshRollingDigest(x.cfg),true);assert.equal(x.calls.length,1);assert.equal(x.calls[0].day_key,'2026-09-29');
  x.session.dailyDigests=plain(x.session.dailyDigests);x.advance(1);assert.equal(await x.ctx.chatRefreshRollingDigest(x.cfg),true);
  assert.equal(x.calls.length,2);assert.equal(x.calls[1].day_key,'2026-09-30');assert.equal(x.session.messages.length,4,'maintenance never truncates conversation');
  assert.equal(await x.ctx.chatRefreshRollingDigest(x.cfg),true);assert.equal(x.calls.length,2);
});
test('API failure, invalid output, key changes and concurrent edits cannot commit partial updates',async()=>{
  for(const behavior of ['failure','incomplete','key','edit']){
    const x=setup();x.cfg.dailyDigestRollupDays=0;x.session.dailyDigests=[x.entry('2026-09-30','原文')];
    x.reply(()=>{if(behavior==='key')x.cfg.panelKey='changed';if(behavior==='edit')x.session.dailyDigests[0].text='用户编辑';return behavior==='failure'?{ok:false,error:'unavailable'}:{prepared:true,text:'新正文',salvaged:behavior==='incomplete'};});
    const prepared=await x.run(x.turn('2026-09-30','new'));
    assert.equal(x.session.dailyDigests[0].text,behavior==='edit'?'用户编辑':'原文');
    if(behavior==='edit')assert.equal(x.ctx.chatDigestPreparedStillValid(x.session,prepared),false);else assert.equal(prepared,null,behavior);
  }
});
test('timeouts settle even when an adapter ignores abort; no late data is committed',async()=>{
  const x=setup();x.ctx.CHAT_DAILY_DIGEST_TIMEOUT_MS=10;x.ctx.fetch=()=>new Promise(()=>{});
  const result=await x.run(x.turn('2026-09-30','timeout'));assert.equal(result,null);assert.equal(x.session.dailyDigests.length,0);
});
test('large original messages are split without dropping any text',async()=>{
  const x=setup();x.cfg.dailyDigestRollupDays=0;x.reply(()=>({prepared:true,text:'总结',merge_with_previous:true}));
  const raw=x.turn('2026-09-30','long');raw[0].text='长'.repeat(140000);
  assert.ok(await x.run(raw));assert.ok(x.calls.length>=3);
  assert.equal(x.calls.flatMap(c=>c.messages).filter(m=>m.role==='user').map(m=>m.text).join(''),raw[0].text);
  for(const c of x.calls)assert.ok(c.messages.reduce((n,m)=>n+m.text.length+64,0)<=50000);
});
test('strict date parsing rejects wrong format, duplicate days and dates outside the rolling window',()=>{
  const x=setup(),parse=s=>x.ctx.chatDigestParseDays(s,'2026-09-27','2026-09-29');
  assert.equal(parse('【2026-09-27】\n一\n\n【2026-09-29】\n二').entries.length,2);
  for(const raw of ['无日期正文','【2026-9-27】\n一','【2026-09-30】\n今天','【2026-09-27】\n一\n【2026-09-27】\n二','【2026-09-27 12:00】\n旧表头'])assert.ok(parse(raw).error,raw);
});
test('stale big summary never uses wrong dates; source passages survive until retry',()=>{
  const x=setup();x.session.dailyDigests=[x.entry('2026-09-27','甲'),x.entry('2026-09-28','乙')];
  x.session.digestRollup={start:'2026-09-26',end:'2026-09-27',text:'旧范围',source:'old'};
  assert.equal(x.ctx.chatDailyDigestPack(x.cfg,x.session),'【2026-09-27-2026-09-28】\n甲\n\n乙');
});
test('clearing a saved summary does not recreate the same covered turns on the next trim',async()=>{
  const x=setup();x.cfg.dailyDigestRollupDays=0;const messages=x.turn('2026-09-30','covered');
  x.commit(await x.run(messages));x.cfg.dailyDigestEnabled=false;
  x.nodes['chat-digest-today']={value:''};assert.equal(x.ctx.chatSaveDigestEditor('today'),true);
  assert.equal(x.session.dailyDigests.length,0);assert.equal(x.session.digestOmittedCovered.length,1);
  x.cfg.dailyDigestEnabled=true;const count=x.calls.length;const prepared=await x.run(messages);
  assert.equal(prepared.entries.length,0);assert.equal(x.calls.length,count);
  assert.ok((await x.run(x.turn('2026-09-30','new'))).entries.length===1,'new content should still be summarized');
});
