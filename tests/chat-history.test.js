const assert=require('assert');
const history=require('../chat-history.js');

function visibleTurn(id){
  return [
    {role:'user',text:id+'-a',turnId:id},
    {role:'user',text:id+'-b',turnId:id},
    {role:'assistant',text:id+'-reply-a',turnId:id},
    {role:'assistant',text:id+'-reply-b',turnId:id}
  ];
}

const local=[];
for(let index=1;index<=300;index++)local.push(...visibleTurn('turn-'+index));
const localTrim=history.trimLocalTurns(local,200);
assert.strictEqual(localTrim.before,300);
assert.strictEqual(localTrim.dropped,100);
assert.strictEqual(localTrim.after,200);
assert.strictEqual(localTrim.keptMessages[0].turnId,'turn-101');
assert.strictEqual(localTrim.keptMessages[0].text,'turn-101-a');

const legacy=[];
for(let index=1;index<=201;index++){
  legacy.push({role:'user',text:index+'-a'});
  legacy.push({role:'user',text:index+'-b'});
  legacy.push({role:'assistant',text:index+'-reply-a'});
  legacy.push({role:'assistant',text:index+'-reply-b'});
}
const legacyTrim=history.trimLocalTurns(legacy,200);
assert.strictEqual(legacyTrim.before,201);
assert.strictEqual(legacyTrim.dropped,1);
assert.strictEqual(legacyTrim.keptMessages[0].text,'2-a');

const transport=[];
for(let index=1;index<=250;index++){
  transport.push({role:'user',content:[{type:'text',text:'request-'+index}]});
  transport.push({role:'assistant',content:[{type:'tool_use',id:'tool-'+index}]});
  transport.push({role:'user',content:[{type:'tool_result',tool_use_id:'tool-'+index,content:'ok'}]});
  transport.push({role:'assistant',content:[{type:'text',text:'reply-'+index}]});
}
const transportTrim=history.trimTransportTurns(transport,200);
assert.strictEqual(transportTrim.before,250);
assert.strictEqual(transportTrim.dropped,50);
assert.strictEqual(transportTrim.keptMessages[0].content[0].text,'request-51');
assert.strictEqual(transportTrim.keptMessages[1].content[0].type,'tool_use');

assert.strictEqual(history.cacheLifecycle({
  input_tokens_total:29121,
  cache_read_input_tokens:944,
  cache_creation_input_tokens:28177
}).fullCreate,true);
assert.strictEqual(history.cacheLifecycle({
  input_tokens_total:17122,
  cache_read_input_tokens:447,
  cache_creation_input_tokens:16675
}).fullCreate,true);
assert.strictEqual(history.cacheLifecycle({
  input_tokens_total:17512,
  cache_read_input_tokens:14409,
  cache_creation_input_tokens:33
}).fullCreate,false);

console.log('chat-history tests: OK');
