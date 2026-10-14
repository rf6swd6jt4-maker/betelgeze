import assert from 'node:assert/strict'
import {PGlite} from '../pglite-fixture.mjs'
import {fixtureSql,migration,seed,id} from './fixture.mjs'
const samples=25,sql=await fixtureSql()
const stats=x=>{x.sort((a,b)=>a-b);return {median:x[Math.floor(x.length/2)],p95:x[Math.ceil(x.length*.95)-1],min:x[0],max:x.at(-1)}}
for(const growth of [0,1000]){
 const a=new PGlite(),b=new PGlite()
 try{
  for(const db of [a,b]){
   await db.exec(sql);const {w,alice,instance,service,client}=await seed(db)
   if(growth){
    await db.query("insert into work_items(id,workspace_id,service_id,execution_owner_id,title) select md5('growth-'||n)::uuid,$1,$2,$3,'Growth' from generate_series(1,$4) n",[w,service,alice,growth])
    await db.query('insert into work_item_relationships select workspace_id,id,$1 from work_items where title=$2',[client,'Growth'])
    await db.query('insert into service_instance_work_items select workspace_id,id,$1 from work_items where title=$2',[instance,'Growth'])
   }
   await db.exec('analyze')
  }
  await b.exec(await migration())
  const run=async(db,user)=>{const t=performance.now();const r=(await db.query('select read_personal_work_queue($1,$2) r',[id(1),user])).rows[0].r;return {ms:performance.now()-t,r}}
  for(const [label,user,share] of [['unchanged single assignee',id(2),false],['unassigned staff',id(5),false],['admin without assignments',id(4),false],['shared service primary',id(2),true],['unassigned staff with sharing enabled',id(5),false]]){
   if(share)await b.query('select save_service_queue_roster($1,$2,$3,$4,$5,0,$6)',[id(1),id(10),id(11),id(4),id(100),[id(3)]])
   for(let n=0;n<5;n++){await run(a,user);await run(b,user)}
   const old=[],candidate=[]
   for(let n=0;n<samples;n++){let before,after;if(n%2){after=await run(b,user);before=await run(a,user)}else{before=await run(a,user);after=await run(b,user)}old.push(before.ms);candidate.push(after.ms);assert.equal(before.r.total,after.r.total);assert.deepEqual(before.r.items.map(x=>x.id),after.r.items.map(x=>x.id))}
   console.log(JSON.stringify({label,rows:growth+7,samples,old:stats(old),candidate:stats(candidate)}))
   if(share){await b.exec('begin');try{const primary=await run(b,id(2)),member=await run(b,id(3));assert.deepEqual(primary.r.items,member.r.items)}finally{await b.exec('rollback')}}
  }
 }finally{await a.close();await b.close()}
}
// Unchanged commands/writes in a fresh, non-shared workspace. Roll back each
// sample so no accumulating activity/feedback/history changes the comparison.
const a=new PGlite(),b=new PGlite()
try{
 for(const db of [a,b]){await db.exec(sql);await seed(db)}await b.exec(await migration())
 const run=async(db,action)=>{
  await db.exec('begin');try{
   const version=(await db.query('select updated_at from work_items where id=$1',[id(20)])).rows[0].updated_at
   if(action==='pause')await db.query('select personal_queue_command($1,$2,$3,$4,$5)',[id(1),id(2),id(20),'start',version])
   const v=(await db.query('select updated_at from work_items where id=$1',[id(20)])).rows[0].updated_at,t=performance.now()
   if(action==='title edit')await db.query('update work_items set title=$2 where id=$1',[id(20),'Edited task'])
   else await db.query('select personal_queue_command($1,$2,$3,$4,$5)',[id(1),id(2),id(20),action,v])
   return performance.now()-t
  }finally{await db.exec('rollback')}
 }
 for(const label of ['start','pause','title edit']){
  for(let n=0;n<5;n++){await run(a,label);await run(b,label)}const old=[],candidate=[]
  for(let n=0;n<samples;n++){if(n%2){candidate.push(await run(b,label));old.push(await run(a,label))}else{old.push(await run(a,label));candidate.push(await run(b,label))}}
  console.log(JSON.stringify({label:'unchanged '+label,rows:7,samples,old:stats(old),candidate:stats(candidate)}))
 }
}finally{await a.close();await b.close()}
