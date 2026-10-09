const assert=require('assert'),fs=require('fs'),vm=require('vm'),path=require('path');
const source=fs.readFileSync(path.join(__dirname,'../script.js'),'utf8');
function fn(name){let start=source.indexOf('function '+name+'('),a=source.indexOf('{',start),depth=0;assert(start>=0);for(let i=a;i<source.length;i++){if(source[i]==='{')depth++;else if(source[i]==='}'&&!--depth)return source.slice(start,i+1)}}
function ctx(extra={}){const c={Date,console,Number,Math,Promise,setTimeout,clearTimeout,...extra};vm.createContext(c);return c}
{
 const image={role:'user',text:'',images:[{dataUrl:'test'}],sendFailed:true};
 const pending={role:'pending_user',text:'next'};
 const c=ctx({chatMessages:[image,pending],chatActiveRequest:null,chatEditingIndex:-1,chatSaveLocalMessages(){},chatRenderMessages(){},chatRenderPendingBar(){},toast(){}});
 vm.runInContext(fn('chatCanDeleteUnsent')+'\n'+fn('chatDeletePendingMessage'),c);
 assert(c.chatDeletePendingMessage(0));assert.equal(c.chatMessages[0],pending);
 const active={role:'user',sendFailed:true,inFlight:true};assert.equal(c.chatCanDeleteUnsent(active),false);
}
{
 const failed={role:'user',turnId:'already-failed',inFlightTurnId:'already-failed'};
 const c=ctx({chatFailedUserMessages:()=>[failed]});vm.runInContext(fn('chatQueueFailedUserMessagesForRetry'),c);
 c.chatQueueFailedUserMessagesForRetry();assert.equal(failed.role,'pending_user');assert.equal(failed.turnId,undefined);
}
(async()=>{
 const pending={role:'pending_user',text:'keep me'};let released=false,shown=false;
 const request={pendingMessages:[pending],stopped:false,controller:{abort(){}}};
 const c=ctx({chatMessages:[pending],chatActiveRequest:request,chatInit(){throw Error('storage failure')},chatSaveLocalMessages(){},chatRenderMessages(){},toast(){shown=true},chatFriendlyError:e=>e.message,chatInterruptedInFlightMessages:()=>[],chatReleaseSendingUi(){released=true},chatStreamProgressStop(){}});
 vm.runInContext('async '+fn('chatSubmitPendingMessages'),c);
 await c.chatSubmitPendingMessages({requestState:request});
 assert(released&&shown);assert(pending.sendFailed);assert.equal(pending.text,'keep me');
 console.log('PASS failed image deletion, active protection, fresh retry identity, preparation failure recovery');
})().catch(e=>{console.error(e);process.exitCode=1});
