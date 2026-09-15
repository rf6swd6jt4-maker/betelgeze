import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { PGlite } from './pglite-fixture.mjs'
const db=new PGlite(), id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`
const w=id(1),u=id(2),other=id(3),admin=id(4),client=id(5),instance=id(6),service=id(7)
const one=async(sql,args=[])=> (await db.query(sql,args)).rows[0]
const allowed=async(user=u)=>(await one('select workspace_user_can_access_work_item($1,$2,$3) ok',[w,id(10),user])).ok
const queue=async(user=u)=>(await one('select read_personal_work_queue($1,$2) q',[w,user])).q
const read=path=>readFile(new URL(path,import.meta.url),'utf8')
try{
 // Reuse table shapes, but replace the simplified access stub with the actual deployed policy.
 const base=await read('./validate-personal-queue-sql.mjs')
 const schema=base.split('await db.exec(`')[1].split('`)')[0].replace(/create function workspace_user_can_access_work_item[^\n]+\n/,'')
 await db.exec(schema)
 await db.exec(`create schema auth;create function auth.uid() returns uuid language sql as $$select null::uuid$$;
 alter table relationships add column seller_user_id uuid,add column fulfilment_manager_user_id uuid;
 alter table relationship_service_instances add column import_id uuid;
 create function workspace_user_can_access_session_step(uuid,uuid,uuid) returns boolean language sql as $$select false$$;
 create function workspace_user_fully_covers_relationship(uuid,uuid,uuid) returns boolean language sql as $$select false$$;
 create index fixture_work_relationship_scope on work_item_relationships(workspace_id,work_item_id,relationship_id);`)
 const prior=await read('../supabase/migrations/20260909100000_client_delivery_teams.sql')
 await db.exec(prior.slice(prior.indexOf('create or replace function public.workspace_user_can_access_work_item('),prior.indexOf('\ncreate function public.workspace_delivery_access_scope')))
 await db.exec(await read('../supabase/migrations/20260711194500_work_item_actual_time_presence.sql'))
 await db.exec('create trigger status_transition before update on work_items for each row execute function apply_work_item_status_transition()')
 await db.exec(await read('../supabase/migrations/20260915120000_personal_work_queue.sql'))
 await db.query('insert into workspaces values($1)',[w]);for(const [user,role] of [[u,'staff'],[other,'staff'],[admin,'admin']])await db.query('insert into workspace_memberships values($1,$2,$3)',[w,user,role])
 for(const r of [client,id(8)])await db.query('insert into relationships(id,workspace_id) values($1,$2)',[r,w])
 await db.query('insert into relationship_service_instances(id,workspace_id,relationship_id,service_id,assignee_user_id) values($1,$2,$3,$4,$5)',[instance,w,client,service,u])
 await db.query('insert into work_items(id,workspace_id,title,service_id) values($1,$2,$3,$4)',[id(10),w,'Assigned SOP task',service])
 await db.query('insert into work_item_relationships values($1,$2,$3)',[w,id(10),client])
 await db.query('insert into service_instance_work_items values($1,$2,$3)',[w,id(10),instance])
 assert.equal(await allowed(),false);assert.equal((await queue()).total,0)
 console.log('PASS: reproduces empty assigned-worker queue with the real prior access function')
 await db.exec(await read('../supabase/migrations/20260915130000_service_assignment_work_access.sql'))
 assert.equal(await allowed(),true);assert.equal((await queue()).ready,1);assert.equal(await allowed(other),false);assert.equal((await queue(admin)).total,0)
 console.log('PASS: current service assignee gains linked work; other workers and admin responsibility remain unchanged')
 let v=(await one('select updated_at from work_items where id=$1',[id(10)])).updated_at
 await db.query("select personal_queue_command($1,$2,$3,'start',$4)",[w,u,id(10),v]);assert.equal((await queue()).items[0].status,'doing')
 v=(await one('select updated_at from work_items where id=$1',[id(10)])).updated_at;await db.query("select personal_queue_command($1,$2,$3,'pause',$4)",[w,u,id(10),v])
 console.log('PASS: assigned worker can start and pause through the real queue command')
 await db.exec(`update work_items set visibility='admins_only',area='admin' where id='${id(10)}'`);assert.equal(await allowed(),false)
 await db.exec(`update work_items set visibility='workspace',area='client_work',service_id='${id(9)}' where id='${id(10)}'`);assert.equal(await allowed(),false)
 await db.query('update work_items set service_id=$1 where id=$2',[service,id(10)])
 await db.query('update work_item_relationships set relationship_id=$1 where work_item_id=$2',[id(8),id(10)]);assert.equal(await allowed(),false)
 await db.query('update work_item_relationships set relationship_id=$1 where work_item_id=$2',[client,id(10)])
 console.log('PASS: private Admin work, different services and mismatched clients stay inaccessible')
 await db.query('update relationship_service_instances set assignee_user_id=$1 where id=$2',[other,instance]);assert.equal(await allowed(),false);assert.equal(await allowed(other),true)
 await db.exec("update relationship_service_instances set disposition='cancelled'");assert.equal(await allowed(other),false)
 await db.exec(`update relationship_service_instances set disposition='active',import_id='${id(20)}'`);assert.equal(await allowed(other),false)
 await db.exec("update relationship_service_instances set import_id=null,disposition='paused'");assert.equal(await allowed(other),true);assert.equal((await queue(other)).ready,0)
 console.log('PASS: reassignment revokes the former worker; cancelled and staged imports cannot grant access; paused work is deferred')
 await db.exec("update relationship_service_instances set disposition='active'")
 await db.query('insert into relationship_services values($1,$2,$3,$4)',[w,client,service,u]);assert.equal(await allowed(),true)
 console.log('PASS: existing legacy service access remains valid')
 await db.exec(`insert into work_items(id,workspace_id,service_id,title) select gen_random_uuid(),'${w}','${service}','Growth '||n from generate_series(1,1000)n;
 insert into work_item_relationships select workspace_id,id,'${client}' from work_items where title like 'Growth %';
 insert into service_instance_work_items select workspace_id,id,'${instance}' from work_items where title like 'Growth %';analyze;`)
 const plan=await db.query('explain(analyze,buffers) select read_personal_work_queue($1,$2)',[w,other]);console.log(plan.rows.map(x=>x['QUERY PLAN']).join('\n'))
}finally{await db.close()}
