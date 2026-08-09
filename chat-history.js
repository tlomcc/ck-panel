(function(root,factory){
  var api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.CKChatHistory=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  function roleOf(message){
    return String(message&&message.role||'').trim().toLowerCase();
  }

  function hasContent(message){
    if(!message||typeof message!=='object')return false;
    if(String(message.text||'').trim())return true;
    if(Array.isArray(message.images)&&message.images.length)return true;
    var content=message.content;
    if(typeof content==='string')return !!content.trim();
    if(Array.isArray(content))return content.length>0;
    return !!(content&&typeof content==='object');
  }

  function explicitTurnId(message){
    return String(message&&(
      message.turnId||message.turn_id||message.requestTurnId||message.request_turn_id
    )||'').trim();
  }

  function localTurnGroups(messages,options){
    messages=Array.isArray(messages)?messages:[];
    options=options||{};
    var excluded=options.excluded instanceof Set?options.excluded:null;
    var groups=[];
    var current=null;
    for(var index=0;index<messages.length;index++){
      var message=messages[index];
      if(excluded&&excluded.has(message))continue;
      var role=roleOf(message);
      if(role!=='user'&&role!=='pending_user'&&role!=='assistant')continue;
      if(!hasContent(message)||(role==='assistant'&&message.stopped===true))continue;
      var id=explicitTurnId(message);
      var startsNew=false;
      if(!current){
        startsNew=true;
      }else if(id){
        startsNew=current.explicitId!==id;
      }else if(current.explicitId){
        startsNew=role!=='assistant'||current.hasAssistant;
      }else if((role==='user'||role==='pending_user')&&current.hasAssistant){
        startsNew=true;
      }
      if(startsNew){
        current={
          id:id||('legacy-'+String(groups.length+1)),
          explicitId:id,
          startIndex:index,
          endIndex:index+1,
          userMessages:0,
          assistantMessages:0,
          hasAssistant:false
        };
        groups.push(current);
      }
      current.endIndex=index+1;
      if(role==='assistant'){
        current.assistantMessages++;
        current.hasAssistant=true;
      }else{
        current.userMessages++;
      }
    }
    return groups.filter(function(group){return group.userMessages>0});
  }

  function trimLocalTurns(messages,keep,options){
    messages=Array.isArray(messages)?messages:[];
    keep=Math.max(0,Math.floor(Number(keep)||0));
    var groups=localTurnGroups(messages,options);
    var drop=Math.max(0,groups.length-keep);
    var cutIndex=drop>0?groups[drop].startIndex:0;
    return {
      before:groups.length,
      after:groups.length-drop,
      dropped:drop,
      cutIndex:cutIndex,
      keptMessages:drop>0?messages.slice(cutIndex):messages.slice(),
      droppedMessages:drop>0?messages.slice(0,cutIndex):[],
      groups:groups
    };
  }

  function contentBlockType(block){
    return String(block&&block.type||'').trim().toLowerCase();
  }

  function isConversationUser(message){
    if(roleOf(message)!=='user'||!hasContent(message))return false;
    var content=message&&message.content;
    if(Array.isArray(content)&&content.length){
      var typed=content.filter(function(block){return block&&typeof block==='object'});
      if(typed.length&&typed.length===content.length&&typed.every(function(block){
        return contentBlockType(block)==='tool_result';
      }))return false;
    }
    return true;
  }

  function transportTurnGroups(messages){
    messages=Array.isArray(messages)?messages:[];
    var starts=[];
    for(var index=0;index<messages.length;index++){
      if(isConversationUser(messages[index]))starts.push(index);
    }
    return starts.map(function(start,index){
      return {startIndex:start,endIndex:index+1<starts.length?starts[index+1]:messages.length};
    });
  }

  function trimTransportTurns(messages,keep){
    messages=Array.isArray(messages)?messages:[];
    keep=Math.max(0,Math.floor(Number(keep)||0));
    var groups=transportTurnGroups(messages);
    var drop=Math.max(0,groups.length-keep);
    var cutIndex=drop>0?groups[drop].startIndex:0;
    return {
      before:groups.length,
      after:groups.length-drop,
      dropped:drop,
      cutIndex:cutIndex,
      keptMessages:drop>0?messages.slice(cutIndex):messages.slice(),
      droppedMessages:drop>0?messages.slice(0,cutIndex):[],
      groups:groups
    };
  }

  function usageNumber(usage,keys){
    usage=usage&&usage.usage&&typeof usage.usage==='object'?usage.usage:(usage||{});
    for(var index=0;index<keys.length;index++){
      var value=Number(usage[keys[index]]);
      if(isFinite(value)&&value>=0)return value;
    }
    return 0;
  }

  function cacheLifecycle(usage){
    var read=usageNumber(usage,['cache_read_input_tokens','cache_read_tokens','cacheReadInputTokens']);
    var create=usageNumber(usage,['cache_creation_input_tokens','cache_creation_tokens','cacheCreateInputTokens']);
    var total=usageNumber(usage,['input_tokens_total','total_input_tokens','inputTokensTotal']);
    var measured=Math.max(total,read+create);
    var ratio=measured>0?create/measured:0;
    var fullCreate=create>=1024&&ratio>=0.55&&(read===0||create>=read*1.25);
    return {read:read,create:create,total:total,createRatio:ratio,fullCreate:fullCreate};
  }

  return {
    localTurnGroups:localTurnGroups,
    trimLocalTurns:trimLocalTurns,
    isConversationUser:isConversationUser,
    transportTurnGroups:transportTurnGroups,
    trimTransportTurns:trimTransportTurns,
    cacheLifecycle:cacheLifecycle
  };
});
