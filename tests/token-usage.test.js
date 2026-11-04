const test=require('node:test'),assert=require('node:assert/strict');
const usage=require('../token-usage.js');
function sample(calls,input,cache,date='2026-11-04'){
  const totals={...usage.empty(),calls,input_tokens:input,cache_read_tokens:cache,output_tokens:calls*5,input_known_calls:calls,output_known_calls:calls,cache_known_calls:calls,cache_rate_input_tokens:input,cache_rate_read_tokens:cache,cache_rate_calls:calls};
  return {ok:true,timezone:'Asia/Shanghai',tracking_since:Date.parse('2026-11-04T00:00:00+08:00')/1000,period:{mode:'month',month:'2026-11'},totals,daily:[{date,...totals}],breakdown:[{kind:'chat',...totals},{kind:'keepalive',...usage.empty()}]};
}
test('combined cache rate is weighted by input tokens',()=>{
  const value=usage.combine([{id:'us',data:sample(1,100,100)},{id:'cn',data:sample(9,900,0)}]);
  assert.equal(value.totals.calls,10);assert.equal(usage.metric(value.totals,'cache_rate'),'10.00%');assert.equal(value.daily[0].calls,10);
});
test('missing values stay distinct from reported zero and no history',()=>{
  const value={...usage.empty(),calls:2};
  assert.equal(usage.metric(value,'input_tokens'),'—');value.input_known_calls=2;
  assert.equal(usage.metric(value,'input_tokens'),'0');assert.equal(usage.metric(value,'calls',false),'—');
  assert.equal(usage.metric(usage.empty(),'input_tokens'),'0');assert.equal(usage.metric(usage.empty(),'cache_rate'),'—');
});
test('an unavailable server adds no invented zero record',()=>{
  const value=usage.combine([{id:'us',data:sample(3,300,100)},{id:'cn',error:'unavailable'}]);
  assert.equal(value.totals.calls,3);assert.equal(value.covered,true);
  assert.equal(usage.combine([{id:'cn',error:'unavailable'}]).covered,false);
});
test('daily rows are merged by day and ordered newest first',()=>{
  const value=usage.combine([{data:sample(1,100,20,'2026-11-03')},{data:sample(2,200,80,'2026-11-04')}]);
  assert.deepEqual(value.daily.map(d=>d.date),['2026-11-04','2026-11-03']);
  assert.equal(value.daily.reduce((n,d)=>n+d.input_tokens,0),value.totals.input_tokens);
});
test('keepalive calls are included once in the total and exposed separately',()=>{
  const data=sample(10,1000,900);data.breakdown[0].calls=7;data.breakdown[1].calls=3;
  const value=usage.combine([{data}]);assert.equal(value.totals.calls,10);assert.equal(value.keepalive,3);
});
test('invalid or incomplete payloads cannot look like a valid empty period',()=>{
  assert.equal(usage.valid({ok:true}),false);const data=sample(1,100,50);delete data.totals.output_tokens;
  assert.equal(usage.valid(data),false);const bad=sample(1,100,50);bad.totals.calls=-1;assert.equal(usage.valid(bad),false);
});
test('date boundaries are always in Shanghai regardless of device timezone',()=>{
  assert.equal(usage.day(new Date('2026-12-31T16:01:00Z')),'2027-01-01');
  assert.equal(usage.day(new Date('2026-10-31T15:59:00Z')),'2026-10-31');
});
