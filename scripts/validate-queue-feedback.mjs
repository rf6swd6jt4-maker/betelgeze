import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {PGlite} from './pglite-fixture.mjs'
const db=new PGlite(),id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`,w=id(1),u=id(2),admin=id(3),other=id(4),client=id(5),team=id(6),conv=id(7)
const sql=async(s,p=[])=>(await db.query(s,p)).rows,one=async(s,p=[])=>(await sql(s,p))[0]
const base=await readFile(new URL('./validate-personal-queue-sql.mjs',import.meta.url),'utf8')
await db.exec(base.split('await db.exec(`')[1].split('`)')[0])
await db.exec(`alter table workspaces add column slug text default 'test';alter table relationships add column fulfilment_manager_user_id uuid;
create table workspace_teams(id uuid primary key,workspace_id uuid,name text,kind text,relationship_id uuid,archived_at timestamptz);
create table workspace_native_conversations(id uuid primary key,workspace_id uuid,team_id uuid,kind text,archived_at timestamptz);
create table workspace_native_messages(id uuid primary key default gen_random_uuid(),workspace_id uuid,conversation_id uuid,sender_user_id uuid,client_request_id uuid unique,body text,created_at timestamptz default now());`)
for(const file of ['20260711194500_work_item_actual_time_presence.sql','20260915120000_personal_work_queue.sql'])await db.exec(await readFile(new URL('../supabase/migrations/'+file,import.meta.url),'utf8'))
await db.exec('create trigger status_transition before update on work_items for each row execute function apply_work_item_status_transition()')
let migration=await readFile(new URL('../supabase/migrations/20260915150000_work_queue_feedback.sql',import.meta.url),'utf8');const a=migration.indexOf('create or replace function public.dispatch_pending_work_queue'),b=migration.indexOf('do $$declare f record;',a);migration=migration.slice(0,a)+migration.slice(b)
await db.exec(migration)
await sql('insert into workspaces(id) values($1)',[w]);for(const [user,role]of [[u,'staff'],[admin,'admin'],[other,'staff']])await sql('insert into workspace_memberships values($1,$2,$3)',[w,user,role])
await sql('insert into relationships(id,workspace_id,fulfilment_manager_user_id) values($1,$2,$3)',[client,w,admin]);await sql("insert into workspace_teams values($1,$2,'Team: Test','relationship',$3,null)",[team,w,client]);await sql("insert into workspace_native_conversations values($1,$2,$3,'team',null)",[conv,w,team]);
for(let n=10;n<15;n++){await sql("insert into work_items(id,workspace_id,execution_owner_id,title,instructions) values($1,$2,$3,$4,'Original procedure')",[id(n),w,u,`Work ${n}`]);await sql('insert into work_item_relationships values($1,$2,$3)',[w,id(n),client])}
const version=async n=>(await one('select updated_at from work_items where id=$1',[id(n)])).updated_at
const cmd=async(n,action)=>one('select personal_queue_command($1,$2,$3,$4,$5) q',[w,u,id(n),action,await version(n)])
const dispute=async(n,reason='Missing client information',request=id(n+100),user=u)=>one('select submit_queue_dispute($1,$2,$3,$4,$5,$6,$7) q',[w,user,id(n),await version(n),request,reason,'Need a source'])
await assert.rejects(dispute(10,'Other',id(90),other));await cmd(10,'start');await sql("update work_queue_effort_runs set active_since=now()-interval '10 minutes' where work_item_id=$1",[id(10)]);const d=(await dispute(10)).q
assert.equal((await one('select status from work_items where id=$1',[id(10)])).status,'blocked');assert.equal((await one('select count(*) n from workspace_native_messages')).n,1);await dispute(10);assert.equal((await one('select count(*) n from workspace_native_messages')).n,1)
assert.equal((await one('select active_since from work_queue_effort_runs where work_item_id=$1',[id(10)])).active_since,null)
await assert.rejects(cmd(10,'start'));await cmd(11,'start');await cmd(11,'pause');await assert.rejects(one('select resolve_queue_dispute($1,$2,$3,$4,true)',[w,other,d.id,'Corrected source']))
await one('select resolve_queue_dispute($1,$2,$3,$4,true)',[w,admin,d.id,'Client facts supplied']);await cmd(10,'start');await cmd(10,'complete');assert.equal((await one('select valid_sample from work_queue_effort_runs where work_item_id=$1',[id(10)])).valid_sample,false)
console.log('PASS: durable dispute, duplicate recovery, internal message, authorization, pause and alternate work, resolution')
for(let n=12;n<15;n++){const d=(await dispute(n,'Too brief')).q;assert.equal((await one('select status from work_items where id=$1',[id(n)])).status,'todo');await one('select resolve_queue_dispute($1,$2,$3,$4,true)',[w,admin,d.id,'Include a little more explanation'])}
assert.equal((await one('select verbosity from work_queue_preferences where user_id=$1',[u])).verbosity,1)
console.log('PASS: presentation feedback does not block; adaptation waits for three approved votes')
const job=(await sql("select * from claim_queue_feedback_job('schedule')"))[0];await one('select queue_schedule_context($1,$2)',[w,u]);await one('select publish_queue_schedule($1,$2,$3)',[job.id,job.lease_token,JSON.stringify([{id:id(11),effort_minutes:30,horizon:'today',anchor_day:'2026-09-15',target_day:'2026-09-15',conflict:false,reason:'Routine'}])]);const q=(await one('select read_personal_work_queue($1,$2) q',[w,u])).q;assert.equal(q.items.find(x=>x.id===id(11)).priority_band,1)
await one("select queue_feedback_enqueue($1,'schedule',$2)",[w,u]);assert.equal((await one('select publish_queue_schedule($1,$2,$3) ok',[job.id,job.lease_token,'[]'])).ok,false)
console.log('PASS: saved qualitative horizons and stale schedule publication guard')
const ai=(await sql("select * from claim_queue_feedback_job('dispute',500)"))[0];assert.ok(ai);await sql("update work_queue_feedback_jobs set lease_until=now()-interval '1 minute' where id=$1",[ai.id]);await sql("select * from claim_queue_feedback_job('dispute',500)");assert.equal((await one('select count(*) n from work_queue_ai_usage where id=$1',[ai.lease_token])).n,1)
await db.exec('set role authenticated');await assert.rejects(sql('select * from work_queue_disputes'));await assert.rejects(sql('select read_queue_feedback($1,$2)',[w,u]));await db.exec('reset role')
console.log('PASS: uncertain provider requests do not repeat; ordinary roles cannot read private feedback')
// Repeated calibrated outcomes move the multiplier only one small step.
for(let n=0;n<5;n++)await sql("insert into work_queue_effort_runs(workspace_id,work_item_id,user_id,bucket,source_fingerprint,base_minutes,active_seconds,completed_at) values($1,$2,$3,'sample','x',60,7200,now())",[w,id(11),u]);
await sql('select calibrate_queue_effort($1,$2)',[w,u]);assert.equal(Number((await one("select factor from work_queue_calibration where bucket='sample'")).factor),1.05);await sql('select calibrate_queue_effort($1,$2)',[w,u]);assert.equal(Number((await one("select factor from work_queue_calibration where bucket='sample'")).factor),1.05);
console.log('PASS: five samples make one bounded calibration update, replay makes none')
await db.exec(`create index fixture_queue_relationship on work_item_relationships(workspace_id,work_item_id);create index fixture_queue_links on service_instance_work_items(workspace_id,work_item_id);`)
await sql("insert into work_items(id,workspace_id,execution_owner_id,title) select md5('feedback-growth-'||g)::uuid,$1,$2,'Growth item' from generate_series(1,1000) g",[w,u]);
const plan=await sql('explain(analyze,buffers) select read_personal_work_queue($1,$2)',[w,u]);console.log(plan.map(x=>x['QUERY PLAN']).join('\n'));
await db.close()
