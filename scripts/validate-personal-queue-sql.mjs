import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { PGlite } from './pglite-fixture.mjs'
const db = new PGlite()
const id = n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`
const w=id(1),u=id(2),other=id(3),admin=id(4),client=id(5),instance=id(6),service=id(7)
const query=async(sql,args=[]) => (await db.query(sql,args)).rows
const one=async(sql,args=[]) => (await query(sql,args))[0]
const read=async(user=u,offset=0)=>(await one('select read_personal_work_queue($1,$2,$3) q',[w,user,offset])).q
const command=async(n,action,user=u,version)=>{
 const v=version??(await one('select updated_at from work_items where id=$1',[id(n)])).updated_at
 return one('select personal_queue_command($1,$2,$3,$4,$5) q',[w,user,id(n),action,v])
}
let checks=0;const pass=s=>console.log(`PASS ${++checks}: ${s}`)
try {
await db.exec(`
create role anon; create role authenticated; create role service_role bypassrls;
create table workspaces(id uuid primary key);
create table workspace_memberships(workspace_id uuid,user_id uuid,role text,primary key(workspace_id,user_id));
create table relationships(id uuid primary key,workspace_id uuid,primary_person_name text,business_name text,notes_summary text,status text default 'active');
create table onboarding_service_revisions(id uuid primary key,workspace_id uuid,name text);
create table relationship_service_instances(id uuid primary key,workspace_id uuid,relationship_id uuid,service_id uuid,service_revision_id uuid,service_key text,assignee_user_id uuid,disposition text default 'active',stage text default 'setup');
create table relationship_services(workspace_id uuid,relationship_id uuid,service_id uuid,assignee_user_id uuid);
create table work_items(id uuid primary key,workspace_id uuid,execution_owner_id uuid,title text default 'Work',description text,instructions text,status text default 'todo',metadata jsonb default '{}',completion_mode text default 'manual',workflow_role text default 'task',workflow_action text,native_kind text,kind text default 'manual',sort_order integer default 0,parent_work_item_id uuid,visibility text default 'workspace',area text default 'client_work',service_id uuid,due_date date,due_time time,planned_start_date date,planned_start_time time,priority_override integer,actual_start_at timestamptz,actual_start_has_time boolean default false,actual_completed_at timestamptz,actual_completed_has_time boolean default false,created_at timestamptz default now(),updated_at timestamptz default now());
create table work_item_assignees(workspace_id uuid,work_item_id uuid,user_id uuid);
create table work_item_dependencies(workspace_id uuid,work_item_id uuid,depends_on_work_item_id uuid);
create table work_item_relationships(workspace_id uuid,work_item_id uuid,relationship_id uuid);
create table service_instance_work_items(workspace_id uuid,work_item_id uuid,instance_id uuid);
create function workspace_user_can_access_relationship(w uuid,r uuid,u uuid) returns boolean language sql as $$ select exists(select 1 from workspace_memberships where workspace_id=w and user_id=u) $$;
create function workspace_user_can_access_work_item(w uuid,i uuid,u uuid) returns boolean language sql as $$ select exists(select 1 from workspace_memberships m join work_items t on t.workspace_id=m.workspace_id where m.workspace_id=w and m.user_id=u and t.id=i and (m.role in ('owner','admin') or (t.visibility='workspace' and t.area<>'admin'))) $$;
`)
await db.exec(await readFile(new URL('../supabase/migrations/20260711194500_work_item_actual_time_presence.sql',import.meta.url),'utf8'))
await db.exec('create trigger status_transition before update on work_items for each row execute function apply_work_item_status_transition()')
await db.exec(await readFile(new URL('../supabase/migrations/20260915120000_personal_work_queue.sql',import.meta.url),'utf8'))
await db.query('insert into workspaces values($1)',[w]);
for (const [user,role] of [[u,'staff'],[other,'staff'],[admin,'admin']]) await db.query('insert into workspace_memberships values($1,$2,$3)',[w,user,role])
await db.query('insert into relationships(id,workspace_id,primary_person_name) values($1,$2,$3)',[client,w,'Client'])
await db.query('insert into relationship_service_instances(id,workspace_id,relationship_id,service_id,service_key,assignee_user_id) values($1,$2,$3,$4,$5,$6)',[instance,w,client,service,'ads',u])
for(let n=10;n<16;n++) {
 await db.query('insert into work_items(id,workspace_id,title,service_id) values($1,$2,$3,$4)',[id(n),w,`Task ${n}`,service])
 await db.query('insert into work_item_relationships values($1,$2,$3)',[w,id(n),client])
 await db.query('insert into service_instance_work_items values($1,$2,$3)',[w,id(n),instance])
}
await db.query('update work_items set execution_owner_id=$1 where id=$2',[other,id(11)])
await db.query('insert into work_item_assignees values($1,$2,$3)',[w,id(12),other])
assert.equal((await read()).total,4);assert.equal((await read(other)).total,2);assert.equal((await read(admin)).total,0);pass('Ownership restricts staff and admins, explicit assignment wins over service fallback')
await db.query("update work_items set area='admin',visibility='admins_only',execution_owner_id=$1 where id=$2",[admin,id(15)])
assert.equal((await read()).total,3);assert.equal((await read(admin)).total,1);pass('Private Admin work stays in its owner queue')
await db.query('insert into work_item_dependencies values($1,$2,$3)',[w,id(13),id(10)])
assert.equal((await read()).items.find(x=>x.id===id(13)).blocked,true)
await assert.rejects(()=>command(13,'start'),/prerequisites/)
await command(10,'start');const started=(await read()).items.find(x=>x.id===id(10)).actual_start_at
await assert.rejects(()=>command(14,'start'),/Pause your current/)
await command(10,'pause');await command(10,'start');assert.equal((await read()).items.find(x=>x.id===id(10)).actual_start_at,started)
await command(10,'complete');assert.equal((await read()).items.find(x=>x.id===id(13)).blocked,false);pass('Dependencies, single active task and start-time preservation are enforced')
await assert.rejects(()=>command(13,'complete'),/Start this work/)
await assert.rejects(()=>command(13,'start',other),/not available/)
await assert.rejects(()=>command(13,'start',u,'2000-01-01T00:00:00Z'),/changed/)
await db.query("update relationship_service_instances set disposition='paused' where id=$1",[instance]);await assert.rejects(()=>command(13,'start'),/not active/);assert.equal((await read()).ready,0)
await db.query("update relationship_service_instances set disposition='active' where id=$1",[instance]);pass('Completion, stale writes, wrong users and paused services fail closed')
const job=(await query("select * from claim_queue_assessment('gpt-5.4-mini','v1',500)"))[0];assert.ok(job)
await db.query("update work_items set instructions='Changed during assessment' where id=$1",[job.work_item_id])
const assessment={impact:75,urgency:40,effort_minutes:30,confidence:80,reason:'Unlocks setup',uncertainty:''}
assert.equal((await one('select finish_queue_assessment($1,$2,$3,$4) ok',[job.work_item_id,job.lease_token,'old-hash',assessment])).ok,true)
const stale=await one('select * from work_queue_assessments where work_item_id=$1',[job.work_item_id]);assert.equal(stale.status,'queued');assert.equal(stale.assessment,null);pass('Concurrent edits reject old assessment publication and requeue')
const ctx=(await one('select queue_assessment_context($1,$2) c',[w,id(13)])).c;assert.ok(ctx.prerequisites.length)
await db.query("update relationships set notes_summary='New requirement' where id=$1",[client]);assert.equal((await one('select queue_assessment_context($1,$2) c',[w,id(13)])).c.relationships[0].notes,'New requirement');pass('Context includes prerequisites and changed client facts')
await db.query('insert into relationships(id,workspace_id,primary_person_name,notes_summary) values($1,$2,$3,$4)',[id(80),w,'Other client','Private other client facts'])
await db.query('insert into work_items(id,workspace_id,title,service_id) values($1,$2,$3,$4)',[id(81),w,'Other client deliverable',service])
await db.query('insert into work_item_relationships values($1,$2,$3)',[w,id(81),id(80)])
await db.query('insert into work_item_dependencies values($1,$2,$3)',[w,id(81),id(13)])
assert.equal((await one('select queue_assessment_context($1,$2) c',[w,id(13)])).c.downstream.length,0)
await db.query('insert into work_item_relationships values($1,$2,$3)',[w,id(13),id(80)])
assert.equal((await one('select queue_assessment_context($1,$2) c',[w,id(13)])).c.relationships.length,0)
pass('Different-client context and multi-client notes are excluded from shared assessments')
const before=await one('select count(*)::int n from work_queue_ai_usage');await read();await read();assert.equal((await one('select count(*)::int n from work_queue_ai_usage')).n,before.n);pass('Queue reads never enqueue paid calls')
await db.exec('set role authenticated');await assert.rejects(()=>read(),/permission denied/);await assert.rejects(()=>query('select * from work_queue_assessments'),/permission denied/);await db.exec('reset role');pass('Actor-taking RPCs and cached context are not exposed to ordinary roles')
for(let n=30;n<65;n++) await db.query('insert into work_items(id,workspace_id,execution_owner_id,title) values($1,$2,$3,$4)',[id(n),w,u,`Extra ${n}`])
const first=await read();assert.equal(first.items.length,31);assert.equal(first.hasMore,true)
const next=await read(u,30);assert.notEqual(first.items[0].id,next.items[0].id);pass('Pagination selects globally ranked candidates')
// Execute the scheduler against fixture Vault/network services; never send a real request.
await db.exec(`create schema vault;create schema net;create schema cron;
create table vault.secrets(id uuid default gen_random_uuid(),name text,secret text);
create view vault.decrypted_secrets as select id,name,secret decrypted_secret from vault.secrets;
create table sop_work_scheduler(id boolean primary key,worker_url text);
insert into sop_work_scheduler values(true,'https://app.betelgeze.com/api/cron/sop-work');
insert into vault.secrets(name,secret) values('sop_work_cron_secret','fixture-only-auth-token');
create table cron.jobs(name text,schedule text,command text);
create function cron.schedule(n text,s text,c text) returns bigint language plpgsql as $$begin insert into cron.jobs values(n,s,c);return 1;end$$;
create table net.calls(id bigint generated always as identity,url text,headers jsonb,body jsonb);
create function net.http_post(url text,headers jsonb,body jsonb,timeout_milliseconds integer) returns bigint language plpgsql as $$declare i bigint;begin insert into net.calls(url,headers,body) values(url,headers,body) returning id into i;return i;end$$;`)
await db.exec(await readFile(new URL('../supabase/migrations/20260915121000_personal_work_queue_scheduler.sql',import.meta.url),'utf8'))
assert.equal((await one('select dispatch_pending_work_queue() id')).id,null)
await db.exec('update work_queue_scheduler set enabled=true')
assert.ok((await one('select dispatch_pending_work_queue() id')).id)
assert.equal((await one('select dispatch_pending_work_queue() id')).id,null)
assert.equal((await one('select url from net.calls')).url,'https://app.betelgeze.com/api/cron/work-queue')
assert.equal((await one('select headers from net.calls')).headers.Authorization,'Bearer fixture-only-auth-token')
assert.equal((await one('select command from cron.jobs')).command,'select public.dispatch_pending_work_queue();')
await db.exec("update work_queue_assessments set status='ready';update work_queue_completion_followups set completed_at=now();update work_queue_scheduler set last_dispatched_at=null")
assert.equal((await one('select dispatch_pending_work_queue() id')).id,null)
pass('Scheduler stays inert until enabled, skips idle work, throttles dispatch and keeps secrets out of cron text')
// Representative growth, read-only execution plan. Timing is fixture-only.
await db.exec(`insert into work_items(id,workspace_id,execution_owner_id,title) select gen_random_uuid(),'${w}','${u}','Growth '||n from generate_series(1,1000) n; analyze;`)
const plan=await query('explain (analyze, buffers) select read_personal_work_queue($1,$2,0)',[w,u]);console.log(plan.map(x=>x['QUERY PLAN']).join('\n'))
console.log(`${checks} SQL checks passed`)
} finally { await db.close() }
