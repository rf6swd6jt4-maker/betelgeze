// Imported only by the isolated socket-cluster runner. Caller owns all clients.
import {performance} from 'node:perf_hooks'
import {fixtureSql,migration,seed,id} from './fixture.mjs'
export async function measureNative(admin,connect){
 await admin.query('create database queue_baseline');await admin.query('create database queue_candidate')
 const a=await connect('queue_baseline'),b=await connect('queue_candidate')
 for(const db of [a,b]){await db.query((await fixtureSql()).replace(/create role (anon|authenticated|service_role)[^;]*;/g,''));await seed(db)}await b.query(await migration())
 const stats=x=>{x.sort((a,b)=>a-b);return {median:x[50],p95:x[94],min:x[0],max:x.at(-1)}}
 const measure=async(label,run)=>{for(let n=0;n<20;n++){await run(a);await run(b)}const old=[],candidate=[];for(let n=0;n<100;n++){if(n%2){candidate.push(await run(b));old.push(await run(a))}else{old.push(await run(a));candidate.push(await run(b))}}console.log(JSON.stringify({label,samples:100,old:stats(old),candidate:stats(candidate)}))}
 const read=user=>async db=>{const t=performance.now();await db.query('select read_personal_work_queue($1,$2)',[id(1),user]);return performance.now()-t}
 for(const [label,user] of [['single assignee, 7',id(2)],['unassigned, 7',id(5)]])await measure(label,read(user))
 for(const action of ['start','pause'])await measure('unchanged '+action,async db=>{
  await db.query('begin');try{
   let v=(await db.query('select updated_at::text v from work_items where id=$1',[id(20)])).rows[0].v
   if(action==='pause'){await db.query('select personal_queue_command($1,$2,$3,$4,$5)',[id(1),id(2),id(20),'start',v]);v=(await db.query('select updated_at::text v from work_items where id=$1',[id(20)])).rows[0].v}
   const t=performance.now();await db.query('select personal_queue_command($1,$2,$3,$4,$5)',[id(1),id(2),id(20),action,v]);return performance.now()-t
  }finally{await db.query('rollback')}
 })
 if(process.env.BE_SHARED_PROFILE==='1')for(const [label,db] of [['baseline',a],['candidate',b]]){
  await db.query("set track_functions='all'");await db.query('begin')
  const v=(await db.query('select updated_at::text v from work_items where id=$1',[id(20)])).rows[0].v
  await db.query('select personal_queue_command($1,$2,$3,$4,$5)',[id(1),id(2),id(20),'start',v])
  const before=(await db.query('select funcid,funcname,calls,total_time,self_time from pg_stat_xact_user_functions')).rows
  const next=(await db.query('select updated_at::text v from work_items where id=$1',[id(20)])).rows[0].v
  await db.query('select personal_queue_command($1,$2,$3,$4,$5)',[id(1),id(2),id(20),'pause',next])
  const after=(await db.query('select funcid,funcname,calls,total_time,self_time from pg_stat_xact_user_functions')).rows
  console.log(JSON.stringify({profile:label,functions:after.map(x=>{const p=before.find(y=>y.funcid===x.funcid);return {name:x.funcname,calls:Number(x.calls)-Number(p?.calls??0),total:x.total_time-(p?.total_time??0),self:x.self_time-(p?.self_time??0)}}).filter(x=>x.calls)}));await db.query('rollback')
 }
 if(process.env.BE_SHARED_MEASURE_SMALL==='1')return
 for(const db of [a,b]){
  await db.query("insert into work_items(id,workspace_id,service_id,execution_owner_id,title) select md5('growth-'||n)::uuid,$1,$2,$3,'Growth' from generate_series(1,1000) n",[id(1),id(12),id(2)])
  await db.query("insert into work_item_relationships select workspace_id,id,$1 from work_items where title='Growth'",[id(10)])
  await db.query("insert into service_instance_work_items select workspace_id,id,$1 from work_items where title='Growth'",[id(11)]);await db.query('analyze')
 }
 await measure('single assignee, 1007',read(id(2)));await measure('unassigned, 1007',read(id(5)))
 await b.query('select save_service_queue_roster($1,$2,$3,$4,$5,0,$6)',[id(1),id(10),id(11),id(4),id(100),[id(3)]])
 await measure('shared primary, 1007',read(id(2)))
}
