const {test}=require('node:test');
const assert=require('node:assert/strict'),fs=require('fs'),vm=require('vm');
const source=fs.readFileSync(require.resolve('../chat-digest.js'),'utf8');
const history=require('../chat-history.js');
const plain=value=>JSON.parse(JSON.stringify(value));
const stamp=(day,time='12:00')=>new Date(day+'T'+time+':00+08:00').getTime();
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
    fetch:async(url,options)=>{const body=JSON.parse(options.body);calls.push(body);return {ok:true,json:async()=>reply?reply(body):{ok:true,prepared:true,merge_with_previous:!!body.previous?.length,text:body.mode==='compact_day'?body.tier+'摘要：'+body.text.slice(0,500):'新日记'+body.day_key}}}
  };
  vm.createContext(ctx);vm.runInContext(source,ctx);
  return {ctx,cfg,session,calls,nodes,advance:days=>now+=days*86400000,reply:value=>reply=value,
    entry:(day,text)=>({dayKey:day,text,startTs:stamp(day),endTs:stamp(day)}),
    turn:(day,id,start,end)=>[{role:'user',text:'问题 '+id,turnId:id,ts:stamp(day,start||'10:00')},{role:'assistant',text:'答复 '+id,turnId:id,ts:stamp(day,end||'10:01')}],
    run:messages=>ctx.chatDailyDigestRequest(cfg,{sessionId:'s',messages,trigger:'manual_trim'}),
    commit:prepared=>{assert.ok(prepared);session.dailyDigests=prepared.entries;session.digestRollup=prepared.rollup;}
  };
}

test('summary logs separate generation, checkpoints, reuse and final saved summaries',async()=>{
  const x=setup(),events=[];x.ctx.chatDebug=(event,data)=>events.push({event,data:plain(data)});
  x.cfg.dailyDigestRollupDays=0;
  const raw=x.turn('2026-09-30','private-content');
  const prepared=await x.run(raw);assert.ok(prepared);
  assert.deepEqual(events.filter(e=>e.event==='digest_batch').map(e=>e.data.phase),['started','generated','checkpoint']);
  assert.ok(!events.some(e=>e.event==='digest_result'&&e.data.ok),'prepare is not a committed summary');
  assert.ok(!JSON.stringify(events).includes('private-content'));assert.ok(!JSON.stringify(events).includes('fixture'));
  events.length=0;await x.run(raw);
  assert.equal(events.find(e=>e.event==='digest_batch').data.phase,'reused');
  x.session.messages.push(...raw);
  const count=x.calls.length;let synced=0;x.ctx.chatSyncNightlyDigest=async()=>{synced++;return true};
  await x.ctx.chatRefreshRollingDigest(x.cfg,{force:true,includeToday:true});
  assert.equal(synced,1);assert.equal(x.calls.length,count);assert.ok(!events.some(e=>e.event==='digest_result'&&e.data.phase==='saved'),'a queue synchronization is not a generated summary');
});

test('batch failures retain response diagnostics and local timeouts settle once',async()=>{
  const x=setup(),events=[];x.ctx.chatDebug=(event,data)=>events.push({event,data:plain(data)});
  x.ctx.fetch=async()=>({ok:false,status:503,json:async()=>({ok:false,error:'HTTP 403 token=secret-value',diagnostic:{request_id:'dg-test',provider:'test',model:'test-model',attempt_count:2,retry_count:1,attempts:[{number:1,http_status:403,duration_ms:5,max_tokens:16000,timeout_seconds:180}],error_code:'upstream_http_403'}})});
  assert.equal(await x.run(x.turn('2026-09-30','a')),null);
  const failure=events.find(e=>e.event==='digest_batch'&&e.data.phase==='failed').data;
  assert.equal(failure.http_status,503);assert.equal(failure.request_id,'dg-test');assert.equal(failure.attempt_count,2);
  assert.ok(!JSON.stringify(events).includes('secret-value'));assert.equal(x.session.dailyDigests.length,0);
  events.length=0;x.ctx.CHAT_DAILY_DIGEST_TIMEOUT_MS=5;x.ctx.fetch=()=>new Promise(()=>{});
  assert.equal(await x.run(x.turn('2026-09-30','b')),null);
  assert.equal(events.filter(e=>e.event==='digest_batch'&&e.data.phase==='failed').length,1);
  assert.equal(events.find(e=>e.event==='digest_batch'&&e.data.phase==='failed').data.error_code,'client_timeout');
});


test('explicit refresh synchronizes pending work without an immediate model call',async()=>{
  const x=setup();x.session.messages.push(...x.turn('2026-09-30','today'));let options;
  x.ctx.chatSyncNightlyDigest=async(cfg,value)=>{options=value;return true};
  assert.equal(await x.ctx.chatRefreshRollingDigest(x.cfg,{force:true,notify:true}),true);
  assert.equal(options.notify,true);assert.equal(x.calls.length,0);assert.equal(x.session.dailyDigests.length,0);assert.equal(x.session.messages.length,2);
});
test('batch failure diagnostics identify source messages without changing saved summaries',async()=>{
  for(const rollup of [false,true]){
    const x=setup(),events=[];x.ctx.chatDebug=(event,data)=>events.push({event,data});
    if(rollup){x.session.dailyDigests=[x.entry('2026-09-27','旧摘要')];x.session.dailyDigests[0].detail={source:x.ctx.chatDigestStamp('旧摘要'),text:'旧摘要'};}
    else x.session.messages.push(...x.turn('2026-09-29','yesterday'));
    x.reply(()=>({ok:false,error:'incomplete output'}));
    assert.equal(await x.run(x.session.messages),null);
    const failures=events.filter(e=>e.event==='digest_batch'&&e.data.phase==='failed');
    assert.equal(failures.length,1);assert.equal(failures[0].data.day_key,rollup?'2026-09-27':'2026-09-29');
    assert.equal(failures[0].data.input_messages,rollup?0:2);assert.equal(x.session.dailyDigests.length,rollup?1:0);
  }
});
test('old automatic rollups are recompressed once; hand edited rollups stay intact',async()=>{
  for(const edited of [false,true]){
    const x=setup();x.session.dailyDigests=[x.entry('2026-09-27','旧摘要')];
    const source=x.ctx.chatDigestRollupSource(x.cfg,x.session);
    x.session.digestRollup={start:source.range.start,end:source.range.end,text:'旧版大总结',source:source.legacyStamp,edited};
    x.commit(await x.run([]));
    assert.equal(x.calls.length,edited?1:2);
    x.commit(await x.run([]));
    assert.equal(x.calls.length,edited?1:2);
  }
});
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
  const result=await x.run(raw);assert.ok(result);assert.equal(x.calls.length,3);assert.equal(x.session.dailyDigests.length,0,'prepare must not mutate storage');
  assert.deepEqual(x.calls.filter(b=>b.mode==='daily_part').map(b=>b.day_key),['2026-09-29','2026-09-30']);assert.ok(!JSON.stringify(x.calls).includes('秘密思考'));
  assert.equal(result.entries.length,2);x.commit(result);const count=x.calls.length;await x.run(raw);assert.equal(x.calls.length,count,'same turns must not be summarized twice');
  const next=await x.run(x.turn('2026-09-30','next'));assert.equal(next.entries.length,2);assert.equal(x.calls.at(-1).previous,undefined);assert.ok(next.entries[1].text.startsWith(result.entries[1].text));
});
test('y is summarized per source day, and the same day is reused when the window moves',async()=>{
  const x=setup();x.session.dailyDigests=[27,28,29,30].map(d=>x.entry('2026-09-'+d,'source-'+d));
  const result=await x.run([]);assert.ok(result);
  const calls=x.calls.filter(c=>c.tier==='y');assert.equal(calls.length,2);
  assert.deepEqual(calls.map(c=>c.day_key),['2026-09-27','2026-09-28']);
  for(const c of calls){assert.equal(c.messages,undefined);assert.ok(!c.text.includes('source-29'));assert.ok(!c.text.includes('source-30'));}
  x.commit(result);const count=x.calls.length;await x.run([]);assert.equal(x.calls.length,count);
  x.advance(1);const next=await x.run([]);
  assert.equal(x.calls.filter(c=>c.tier==='y').length,3,'only the newly entering y day is generated');
  assert.equal(next.rollup.start,'2026-09-28');assert.equal(next.rollup.end,'2026-09-29');
});


test('crossing midnight only queues work and retains today and yesterday original text',async()=>{
  const x=setup();x.session.messages.push(...x.turn('2026-09-29','yesterday'),...x.turn('2026-09-30','today'));
  const original=plain(x.session.messages),queued=[];
  x.ctx.chatSyncNightlyDigest=async(cfg,options)=>{queued.push(options.session.id);return true};
  Object.assign(x.ctx,{chatSending:false,chatTrimBusy:false,chatTrimTransaction:null});
  await x.ctx.chatMaybeRollDigestAtDayBoundary();x.advance(1);await x.ctx.chatMaybeRollDigestAtDayBoundary();
  assert.deepEqual(queued,['s','s']);assert.equal(x.calls.length,0);assert.deepEqual(plain(x.session.messages),original);assert.equal(x.session.dailyDigests.length,0);
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

test('completed batches survive failure and reload, while changed source batches are regenerated',async()=>{
  const x=setup();x.cfg.dailyDigestRollupDays=0;
  const raw=x.turn('2026-09-30','resume');raw[0].text='甲'.repeat(10000);raw[1].text='乙'.repeat(10000);
  let failed=false;x.reply(body=>{if(body.messages[0].role==='assistant'&&!failed){failed=true;return {ok:false,error:'timeout'}}return {prepared:true,text:body.messages[0].role+'完成'}});
  assert.equal(await x.run(raw),null);assert.equal(x.calls.length,2);assert.equal(x.session.dailyDigests.length,0);
  const y=setup();y.cfg.dailyDigestRollupDays=0;y.session.digestWork=plain(x.session.digestWork);
  const prepared=await y.run(raw);assert.ok(prepared);assert.equal(y.calls.length,1,'successful first batch survived reload');
  assert.equal(y.calls[0].messages[0].role,'assistant');assert.match(prepared.entries[0].text,/user完成/);
  raw[0].text='丙'.repeat(10000);const before=y.calls.length;assert.ok(await y.run(raw));assert.equal(y.calls.length,before+1,'only changed input invalidates its batch');
});

test('checkpoint namespace excludes edited summaries, changed keys and changed endpoints',async()=>{
  for(const change of ['summary','key','endpoint']){
    const x=setup();x.cfg.dailyDigestRollupDays=0;const raw=x.turn('2026-09-30','one');
    await x.run(raw);assert.equal(x.calls.length,1);
    if(change==='summary')x.session.dailyDigests=[x.entry('2026-09-30','手工修改')];
    if(change==='key')x.cfg.panelKey='another';if(change==='endpoint')x.cfg.gatewayUrl='https://other.invalid';
    await x.run(raw);assert.equal(x.calls.length,2,change);
  }
});

test('x and y have independent stored summaries and never overwrite the full daily source',async()=>{
  const x=setup();x.session.dailyDigests=[x.entry('2026-09-29','当天详细记录'.repeat(1000))];
  const original=x.session.dailyDigests[0].text;
  x.reply(body=>({prepared:true,text:body.tier==='x'?'近期摘要':'较早摘要'}));
  x.commit(await x.run([]));assert.equal(x.session.dailyDigests[0].text,original);
  assert.match(x.ctx.chatDailyDigestPack(x.cfg,x.session),/近期摘要/);assert.ok(!x.ctx.chatDailyDigestPack(x.cfg,x.session).includes(original));
  x.advance(1);x.commit(await x.run([]));assert.match(x.ctx.chatDailyDigestPack(x.cfg,x.session),/较早摘要/);
  assert.equal(x.session.dailyDigests[0].text,original);
});

test('unused archive days do not block a trim, and explicit y regeneration calls the model',async()=>{
  const x=setup();x.cfg.dailyDigestRetentionDays=10;x.session.dailyDigests=[x.entry('2026-09-22','备选旧记录'),x.entry('2026-09-28','需要压缩')];
  x.commit(await x.run([]));assert.ok(x.calls.every(c=>c.day_key==='2026-09-28'));
  const before=x.calls.length;
  assert.ok(await x.ctx.chatDailyDigestRequest(x.cfg,{sessionId:'s',messages:[],forceRollup:true}));
  assert.equal(x.calls.length,before+1);
});
