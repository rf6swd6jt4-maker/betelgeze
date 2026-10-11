// Isolated diagnostic: compare only the new wrapper's raw metadata join.
import {readFile,writeFile} from 'node:fs/promises'
import {createHash} from 'node:crypto'
import {performance} from 'node:perf_hooks'
import assert from 'node:assert/strict'
import {createDeviceUnreadFixture} from './production-fixture.mjs'
const file='supabase/migrations/20261011120000_device_communications_progressive.sql'
const source=await readFile(file,'utf8')
const start=source.indexOf('create function public.communication_device_message_window(')
const current=source.slice(start,source.indexOf('end $$;',start)+7).replace('create function','create or replace function')
const old=current.replace('raw.workspace_id=p_workspace_id and raw.conversation_id=p_conversation_id and raw.id=m.id','raw.workspace_id=p_workspace_id and raw.id=m.id')
const candidate=old.replace('raw.workspace_id=p_workspace_id and raw.id=m.id','raw.workspace_id=p_workspace_id and raw.conversation_id=p_conversation_id and raw.id=m.id')
assert.notEqual(old,candidate)
const stats=values=>{const sorted=values.toSorted((a,b)=>a-b);return{samples:values.length,medianMs:sorted[Math.floor(sorted.length/2)],p95Ms:sorted[Math.ceil(sorted.length*.95)-1]}}
const f=await createDeviceUnreadFixture({chats:1000,backlog:100})
const report={startedAt:new Date().toISOString(),sourceHash:createHash('sha256').update(source).digest('hex'),chats:1000,nativeChats:500,nativeRows:50500,plans:{},actualRpc:{},equivalence:{},limits:['Synthetic Auth/session and Vault adapters; actual pgcrypto encrypted canonical decoder and candidate wrapper.','PGlite EXPLAIN and local RPC wall; excludes network, concurrent production load and WAL durability.','Diagnostic samples establish this predicate effect; full final30-sample benchmark remains separate.']}
try{
 const{db,ids:{w,deviceA},rpc}=f;const native=f.conversations.filter(x=>x.kind==='native'),conversation=native[0],ids20=native.slice(0,20).map(x=>x.id)
 await db.exec('analyze');await rpc('initialize_communication_device_scope',[w,f.ids.me,deviceA])
 const inner=extra=>`select coalesce(jsonb_agg(to_jsonb(m)||jsonb_build_object('edited_at',raw.edited_at) order by m.created_at desc,m.id desc),'[]'::jsonb) from public.communication_native_messages_bounded($1,$2,least(greatest($3,1),60)) m join public.workspace_native_messages raw on raw.workspace_id=$1 ${extra} and raw.id=m.id`
 for(const[arm,extra]of[['before',''],['after','and raw.conversation_id=$2']])for(const limit of[1,60])report.plans[`${arm}.limit${limit}`]=(await db.query(`explain(analyze,buffers,format json) ${inner(extra)}`,[w,conversation.id,limit])).rows[0]['QUERY PLAN'][0]
 const fullSearch=async()=>{let cursor=null;const pages=[];do{const page=await rpc('communication_device_preview_search',[w,deviceA,'native','encrypted latest',cursor]);pages.push(page);cursor=page.nextCursor}while(cursor);return pages}
 const operations=[['preview20',()=>rpc('communication_device_preview_batch',[w,deviceA,'native',ids20]),30],['history60',()=>rpc('communication_device_history',[w,deviceA,'native',conversation.id]),30],['allSearchPages',fullSearch,10]]
 const observations={before:{},after:{}};const outputs={before:{},after:{}}
 // Two alternated rounds avoid relying on a single cold-before/warm-after pass.
 for(let round=0;round<2;round++)for(const[arm,sql]of round===0?[['before',old],['after',candidate]]:[['after',candidate],['before',old]]){
  await db.exec(sql);console.log(JSON.stringify({phase:'diagnostic',round,arm}))
  for(const[name,operation,total]of operations){for(let i=-2;i<total/2;i++){const t=performance.now();const result=await operation();const ms=performance.now()-t;if(i>=0)(observations[arm][name]??=[]).push(ms);outputs[arm][name]=result}}
 }
 for(const[name]of operations){assert.deepEqual(outputs.before[name],outputs.after[name]);report.equivalence[name]=true;report.actualRpc[name]={before:stats(observations.before[name]),after:stats(observations.after[name])}}
 report.finishedAt=new Date().toISOString();await writeFile('/private/tmp/device-unread-native-window-plan.json',JSON.stringify(report,null,2));console.log(JSON.stringify({actualRpc:report.actualRpc,equivalence:report.equivalence,output:'/private/tmp/device-unread-native-window-plan.json'}))
}finally{await f.close()}
