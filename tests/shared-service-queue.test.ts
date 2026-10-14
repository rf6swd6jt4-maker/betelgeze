import test from 'node:test'
import assert from 'node:assert/strict'
import {isServiceRosterRequest,isQueueCommandRequest} from '../lib/shared-service-queue.ts'
const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`
test('roster requests reject malformed, duplicate and unbounded assignments',()=>{
 const valid={instanceId:id(1),version:0,members:[id(2)],requestId:id(3)}
 assert.equal(isServiceRosterRequest(valid),true)
 for(const value of [null,[],{...valid,version:-1},{...valid,version:1.5},{...valid,members:[id(2),id(2)]},{...valid,members:Array.from({length:20},(_,n)=>id(n+10))},{...valid,instanceId:'other-client'},{...valid,requestId:null}])assert.equal(isServiceRosterRequest(value),false)
})
test('work recovery requires the exact supported action, task, version and request identity',()=>{
 const valid={id:id(1),action:'complete',version:'2026-10-14T12:00:00.123456Z',requestId:id(2)}
 assert.equal(isQueueCommandRequest(valid),true)
 for(const value of [null,{...valid,id:'x'},{...valid,requestId:null},{...valid,action:'delete'},{...valid,version:'invalid'}])assert.equal(isQueueCommandRequest(value),false)
})
