import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { PGlite, repositoryRoot } from './pglite-fixture.mjs'
const db = new PGlite()
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12,'0')}`
const w=id(1), foreign=id(2), admin=id(3), staff=id(4), sop=id(5), asset=id(6), revision=id(7)
const one=async(sql,args=[]) => (await db.query(sql,args)).rows[0]
const source={summary:'Set up tracking',applicability:[],steps:[{title:'Access',instruction:'Confirm access.',condition:'',source_location:'Page 1',source_quote:'Confirm access.',kind:'requirement'}],missing_information:[],warnings:[]}
const plan={summary:'Client setup',warnings:[],tasks:[{title:'Confirm access',instruction:'Check the account.',source_steps:[1],depends_on:[],blocked_reason:''},{title:'Check tracking',instruction:'Verify tracking once access is confirmed.',source_steps:[1],depends_on:[1],blocked_reason:''}]}
let checks=0
const pass=label=>console.log(`PASS ${++checks}: ${label}`)
const fixture=async(n,test=true)=>{
    const r=id(n)
    await db.query(`insert into relationships(id,workspace_id,source_metadata,business_name,fulfilment_manager_user_id) values($1,$2,$3,'Test client',$4)`,[r,w,{is_test:test},admin])
    await db.query(`insert into relationship_service_instances(id,workspace_id,relationship_id,service_key,service_id,service_revision_id,assignee_user_id) values($1,$2,$1,'ads',$3,$3,$4)`,[r,w,revision,staff])
    return r
}
const queue=(r,run,actor=admin,workspace=w)=>one('select queue_sop_work($1,$2,$3,$4,$5,$6,$7,$8,100) id',[workspace,actor,run,sop,asset,r,r,'gpt-5.4-mini'])
const claim=run=>one('select * from claim_sop_work($1)',[run])
const prepare=job=>one('select prepare_sop_work($1,$2) packet',[job.id,job.lease_token])
const save=job=>db.query('update sop_work_runs set plan=$1,source_snapshot=$2 where id=$3',[plan,source,job.id])
try {
    await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create table auth.users(id uuid primary key);
    create function is_workspace_member(uuid,text[] default null) returns boolean language sql as $$ select true $$;
    create table workspaces(id uuid primary key,status text default 'active',slug text);
    create table workspace_memberships(workspace_id uuid,user_id uuid,role text,primary key(workspace_id,user_id));
    create table relationships(id uuid primary key,workspace_id uuid,status text default 'active',lifecycle_phase text default 'onboarding_review',source_metadata jsonb default '{}',business_name text,website_url text,industry_value text,location_value text,notes_summary text,fulfilment_manager_user_id uuid,created_at timestamptz default now(),updated_at timestamptz default now());
    create table onboarding_service_revisions(id uuid primary key,workspace_id uuid,name text);
    create table onboarding_services(id uuid primary key,workspace_id uuid,state text default 'active');
    create table relationship_service_instances(id uuid primary key,workspace_id uuid,relationship_id uuid,service_id uuid,service_revision_id uuid,service_key text,assignee_user_id uuid,manager_user_id uuid,stage text default 'setup',disposition text default 'active',import_id uuid);
    create table workspace_member_service_access(workspace_id uuid,user_id uuid,service_id uuid);
    create table service_instance_sessions(workspace_id uuid,instance_id uuid,session_id uuid);
    create table service_instance_work_items(workspace_id uuid,instance_id uuid,work_item_id uuid,primary key(instance_id,work_item_id));
    create table client_sales(id uuid primary key);
    create table client_sale_items(id uuid primary key);
    create table user_profiles(user_id uuid primary key,username text,display_name text);
    create function workspace_user_can_access_relationship(p_workspace_id uuid,p_relationship_id uuid,p_user_id uuid) returns boolean language sql as $$
      select exists(select 1 from relationships r join workspace_memberships m on m.workspace_id=r.workspace_id
        where r.workspace_id=p_workspace_id and r.id=p_relationship_id and m.user_id=p_user_id
          and (m.role in ('owner','admin') or r.fulfilment_manager_user_id=p_user_id
            or exists(select 1 from relationship_service_instances i where i.workspace_id=r.workspace_id and i.relationship_id=r.id and i.assignee_user_id=p_user_id))) $$;
    create function workspace_user_can_access_work_item(uuid,uuid,uuid) returns boolean language sql as $$ select true $$;
    create table relationship_services(workspace_id uuid,relationship_id uuid,service_key text,service_id uuid,service_revision_id uuid,assignee_user_id uuid,primary key(relationship_id,service_key));
    create table relationship_onboarding_sessions(id uuid primary key,workspace_id uuid,relationship_id uuid,status text,archived_at timestamptz,created_at timestamptz default now());
    create index session_relationship_idx on relationship_onboarding_sessions(relationship_id,created_at desc);
    create table assets(id uuid primary key,workspace_id uuid,title text,asset_kind text,source_kind text,native_kind text,native_id uuid,storage_path text,content_type text,file_size bigint,created_by uuid,metadata jsonb default '{}',created_at timestamptz default now(),updated_at timestamptz default now());
    create table work_items(id uuid primary key default gen_random_uuid(),workspace_id uuid,service_id uuid,title text,description text,lifecycle_phase text,status text default 'todo',workflow_role text default 'task',completion_mode text default 'manual',workflow_action text,native_kind text,native_key text,priority integer default 3,created_at timestamptz default now(),sort_order integer default 0,metadata jsonb default '{}',created_by uuid,actual_start_at timestamptz,actual_completed_at timestamptz,planned_start_date date,due_date date,planned_start_time time,due_time time,updated_at timestamptz default now());
    create unique index work_items_native_key_unique on work_items(workspace_id,native_kind,native_key) where native_kind is not null and native_key is not null;
    create table work_item_relationships(workspace_id uuid,relationship_id uuid,work_item_id uuid references work_items(id),primary key(work_item_id,relationship_id));
    create table asset_work_items(workspace_id uuid,asset_id uuid references assets(id),work_item_id uuid references work_items(id),primary key(asset_id,work_item_id));
    insert into auth.users values('${admin}'),('${staff}'); insert into workspaces(id) values('${w}'),('${foreign}');
    insert into workspace_memberships values('${w}','${admin}','admin'),('${w}','${staff}','staff');
    insert into onboarding_service_revisions values('${revision}','${w}','Google Ads');
    insert into onboarding_services values('${revision}','${w}','active');
    insert into workspace_member_service_access values('${w}','${staff}','${revision}');`)
    // Exercise actual parent, dependency, assignee and status triggers too.
    await db.exec(await readFile(`${repositoryRoot}/supabase/migrations/20260711124500_work_item_planning_graph.sql`,'utf8'))
    await db.exec(await readFile(`${repositoryRoot}/supabase/migrations/20260711220000_relationship_gantt_foundation.sql`,'utf8'))
    await db.exec(await readFile(`${repositoryRoot}/supabase/migrations/20260713090000_gantt_schedule_persistence_and_repair.sql`,'utf8'))
    await db.exec(await readFile(`${repositoryRoot}/supabase/migrations/20260914100000_sop_records_and_interpretation.sql`,'utf8'))
    const foundation=await readFile(`${repositoryRoot}/supabase/migrations/20260912120000_service_instance_foundation.sql`,'utf8')
    const linkGuard=foundation.slice(foundation.indexOf('create function public.guard_service_instance_link()'),foundation.indexOf('create trigger guard_service_instance_sale'))
    await db.exec(linkGuard)
    await db.exec('create trigger guard_service_instance_work before insert on service_instance_work_items for each row execute function guard_service_instance_link()')
    const timeline=await readFile(`${repositoryRoot}/supabase/migrations/20260912150000_relationship_service_timeline.sql`,'utf8')
    await db.exec(timeline.slice(timeline.indexOf('create function public.read_relationship_work_queue'),timeline.indexOf('revoke all on function')))
    await db.exec(await readFile(`${repositoryRoot}/supabase/migrations/20260914110000_sop_work_pilot.sql`,'utf8'))
    await db.query('select create_sop_record($1,$2,$3,$4,$5)',[w,admin,sop,'Ads SOP',''])
    await db.query('select attach_sop_upload($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',[w,admin,sop,asset,'Procedure.txt','text/plain',100,`${w}/sops/${sop}/assets/${asset}/${'a'.repeat(64)}/original`,'main',''])
    pass('actual SOP and pilot migrations apply alongside the existing work graph')
    const r=await fixture(20), run=id(30)
    await assert.rejects(queue(r,run,staff),/admins/)
    await assert.rejects(queue(r,run,admin,foreign),/admins/)
    await assert.rejects(queue(await fixture(40,false),id(45)),/test relationship/)
    await queue(r,run)
    assert.equal((await queue(r,id(31))).id,run)
    assert.equal((await one('select count(*)::int n from sop_work_attempts')).n,1)
    assert.equal((await one('select count(*)::int n from work_items')).n,1)
    pass('test-only authority, cross-workspace rejection, canonical replay and single budget reservation')
    const job=await claim(run)
    assert.equal(await claim(run),undefined)
    await assert.rejects(db.query('select prepare_sop_work($1,$2)',[run,id(999)]),/lease/)
    const packet=(await prepare(job)).packet
    assert.deepEqual(packet.onboarding,[])
    assert.equal(packet.session_id,null)
    assert.equal(packet.client.website_url,null)
    await db.query("update sop_interpretations set status='ready',result=$1,source_hash='hash' where id=$2",[source,job.interpretation_id])
    await save(job)
    await assert.rejects(db.query(`insert into work_items(workspace_id,title,lifecycle_phase,native_kind,native_key,parent_work_item_id) values($1,'Legacy task','fulfilment','relationship_workflow','legacy',$2)`,[w,job.group_work_item_id]),/owned by SOP/)
    await assert.rejects(db.query("update work_items set metadata='{}' where id=$1",[job.group_work_item_id]),/owned by SOP/)
    await assert.rejects(db.query("update work_items set status='done' where id=$1",[job.group_work_item_id]),/Wait for/)
    pass('exclusive leases, bounded saved evidence and racing legacy-generator protection')
    await db.query('update sop_work_runs set plan=$1 where id=$2',[{...plan,tasks:[plan.tasks[0],{...plan.tasks[1],depends_on:[2]}]},run])
    await assert.rejects(db.query('select publish_sop_work($1,$2)',[run,job.lease_token]),/dependency/)
    assert.equal((await one('select count(*)::int n from work_items')).n,1)
    await save(job)
    const published=(await one('select publish_sop_work($1,$2) ids',[run,job.lease_token])).ids
    assert.equal(published.length,2)
    assert.deepEqual((await one('select publish_sop_work($1,$2) ids',[run,job.lease_token])).ids,published)
    assert.equal((await one('select count(*)::int n from work_item_relationships where relationship_id=$1',[r])).n,3)
    assert.equal((await one('select user_id from work_item_assignees where work_item_id=$1',[published[0]])).user_id,staff)
    assert.equal((await one('select service_id from work_items where id=$1',[published[0]])).service_id,revision)
    assert.equal((await one('select count(*)::int n from asset_work_items where asset_id=$1',[asset])).n,2)
    await assert.rejects(db.query("update work_items set status='doing' where id=$1",[published[1]]),/unfinished dependencies/)
    assert.equal((await one('select lifecycle_phase from relationships where id=$1',[r])).lifecycle_phase,'onboarding_review')
    pass('atomic publication rollback, assigned Library work, dependency enforcement and duplicate-free acknowledgement replay')
    const changed=await fixture(50), changedRun=id(59)
    await queue(changed,changedRun)
    const changedJob=await claim(changedRun);await prepare(changedJob);await save(changedJob)
    await db.query("update relationships set business_name='Changed' where id=$1",[changed])
    await assert.rejects(db.query('select publish_sop_work($1,$2)',[changedRun,changedJob.lease_token]),/changed/)
    await db.query("update relationships set business_name='Test client' where id=$1",[changed])
    await db.query("delete from workspace_memberships where workspace_id=$1 and user_id=$2",[w,admin])
    await assert.rejects(prepare(changedJob),/admins/)
    await db.query("insert into workspace_memberships values($1,$2,'admin')",[w,admin])
    await db.query('update sops set archived_at=now() where id=$1',[sop])
    await assert.rejects(prepare(changedJob),/source/)
    await db.query('update sops set archived_at=null where id=$1',[sop])
    pass('changed client inputs, revoked requester and archived sources prevent publication')
    await db.query("update sop_work_runs set lease_until=now()-interval '1 second' where id=$1",[changedRun])
    assert.equal(await claim(changedRun),undefined)
    assert.equal((await one('select status from sop_work_runs where id=$1',[changedRun])).status,'failed')
    await db.query('select retry_sop_work($1,$2,$3,100)',[w,admin,changedRun])
    const retry=await claim(changedRun)
    assert.deepEqual(retry.plan,plan)
    assert.equal((await one('select publish_sop_work($1,$2) ids',[changedRun,retry.lease_token])).ids.length,2)
    pass('expired workers do not auto-retry paid calls; saved plans survive explicit publication recovery')
    await db.exec('set role authenticated')
    await assert.rejects(db.query('select * from sop_work_runs'),/permission/)
    await assert.rejects(db.query('select * from sop_ai_usage'),/permission/)
    await assert.rejects(db.query('select claim_sop_work(null)'),/permission/)
    await db.exec('reset role')
    assert.equal((await one("select prosecdef from pg_proc where oid='guard_sop_work_owner()'::regprocedure")).prosecdef,true)
    pass('browser roles cannot read private evidence/costs; trigger enforces ownership without needing private table access')
    await db.query('select set_sop_service_source($1,$2,$3,$4,$5)',[w,admin,revision,sop,asset])
    const automatic=await fixture(200)
    assert.equal((await one('select status from sop_work_requests where instance_id=$1',[automatic])).status,'pending')
    await db.query("update relationship_service_instances set stage='maintenance' where id=$1",[automatic])
    await db.query("update relationship_service_instances set stage='setup' where id=$1",[automatic])
    assert.equal((await one('select count(*)::int n from sop_work_requests where instance_id=$1',[automatic])).n,1)
    const accepted=(await one('select accept_sop_work_request($1,$2,100) id',[automatic,'gpt-5.4-mini'])).id
    assert(accepted)
    assert.equal((await one('select accept_sop_work_request($1,$2,100) id',[automatic,'gpt-5.4-mini'])).id,null)
    const automaticJob=await claim(accepted);await prepare(automaticJob);await save(automaticJob)
    const autoIds=(await one('select publish_sop_work($1,$2) ids',[accepted,automaticJob.lease_token])).ids
    const queuePage=(await one('select read_relationship_work_queue($1,$2,$3) data',[w,automatic,admin])).data
    assert.deepEqual(new Set(queuePage.items.map(i=>i.id)),new Set(autoIds))
    assert.equal(queuePage.generation[0].status,'published')
    assert.equal(queuePage.items.find(i=>i.id===autoIds[0]).queue_state,'Ready')
    assert.equal(queuePage.items.find(i=>i.id===autoIds[1]).queue_state,'Blocked')
    assert.equal((await one('select count(*)::int n from service_instance_work_items where instance_id=$1',[automatic])).n,3)
    pass('Setup transaction durably enqueues once; zero-context work reaches Library, service chart and dependency-aware queue')
    const unassigned=await fixture(210)
    await db.query('update relationship_service_instances set assignee_user_id=null where id=$1',[unassigned])
    const unassignedRun=(await one('select accept_sop_work_request($1,$2,100) id',[unassigned,'gpt-5.4-mini'])).id
    const unassignedJob=await claim(unassignedRun);await prepare(unassignedJob);await save(unassignedJob)
    const unassignedIds=(await one('select publish_sop_work($1,$2) ids',[unassignedRun,unassignedJob.lease_token])).ids
    assert.equal((await one('select count(*)::int n from work_item_assignees where work_item_id=any($1::uuid[])',[unassignedIds])).n,0)
    await fixture(220,false)
    assert.equal((await one('select count(*)::int n from sop_work_requests where instance_id=$1',[id(220)])).n,0)
    const disabled=await fixture(230)
    await db.query('select set_sop_service_source($1,$2,$3,$4,$5,false)',[w,admin,revision,sop,asset])
    assert.equal((await one('select accept_sop_work_request($1,$2,100) id',[disabled,'gpt-5.4-mini'])).id,null)
    assert.equal((await one('select status from sop_work_requests where instance_id=$1',[disabled])).status,'failed')
    pass('unassigned services still generate work; non-test clients are excluded; disabled source fails visibly before dispatch')
    // Network/Vault are fixture substitutes; execute the actual scheduler logic.
    await db.exec(`create schema vault; create schema net; create schema cron;
      create table vault.secrets(id uuid default gen_random_uuid(),name text,secret text);
      create view vault.decrypted_secrets as select id,name,secret decrypted_secret from vault.secrets;
      create function vault.create_secret(s text,n text,d text) returns uuid language plpgsql as $$declare i uuid;begin insert into vault.secrets(secret,name) values(s,n) returning id into i;return i;end$$;
      create function vault.update_secret(i uuid,s text) returns void language sql as $$update vault.secrets set secret=s where id=i$$;
      create table cron.jobs(name text primary key,schedule text,command text);
      create function cron.schedule(n text,s text,c text) returns bigint language plpgsql as $$begin insert into cron.jobs values(n,s,c);return 1;end$$;
      create table net.calls(id bigint generated always as identity,url text,headers jsonb,body jsonb);
      create function net.http_post(url text,headers jsonb,body jsonb,timeout_milliseconds integer) returns bigint language plpgsql as $$declare i bigint;begin insert into net.calls(url,headers,body) values(url,headers,body) returning id into i;return i;end$$;`)
    await db.exec((await readFile(`${repositoryRoot}/supabase/migrations/20260914111000_sop_work_scheduler.sql`,'utf8')).replace(/^create extension.*$/gm,''))
    const workerToken='fixture-only-worker-secret-1234567890'
    await db.query('select configure_sop_work_scheduler($1,$2,false)',['https://app.betelgeze.com/api/cron/sop-work',workerToken])
    assert.equal((await one('select dispatch_pending_sop_work() id')).id,null)
    await db.query('select configure_sop_work_scheduler($1,$2,true)',['https://app.betelgeze.com/api/cron/sop-work',workerToken])
    assert.equal((await one('select dispatch_pending_sop_work() id')).id,null)
    await db.query('select set_sop_service_source($1,$2,$3,$4,$5,true)',[w,admin,revision,sop,asset])
    await fixture(240)
    assert((await one('select dispatch_pending_sop_work() id')).id)
    assert.equal((await one('select dispatch_pending_sop_work() id')).id,null)
    assert.equal((await one('select headers from net.calls')).headers.Authorization,'Bearer '+workerToken)
    assert.equal((await one('select command from cron.jobs')).command,'select public.dispatch_pending_sop_work();')
    assert.equal((await one("select has_function_privilege('authenticated','configure_sop_work_scheduler(text,text,boolean)','execute') allowed")).allowed,false)
    pass('scheduler stays idle without work, authenticates wakeups, deduplicates dispatch and keeps credentials out of cron commands')
    // Fixture-only bulk seeding; the measured publication uses ALL real triggers.
    await db.exec('alter table work_items disable trigger user')
    await db.query(`insert into work_items(workspace_id,title,lifecycle_phase) select $1,'Existing work '||i,'fulfilment' from generate_series(1,5000) i`,[w])
    await db.exec('alter table work_items enable trigger user; analyze work_items')
    const growthRelationship=await fixture(70),growthRun=id(79)
    await queue(growthRelationship,growthRun)
    const growthJob=await claim(growthRun);await prepare(growthJob)
    const largePlan={summary:'Bounded growth fixture',warnings:[],tasks:Array.from({length:40},(_,i)=>({...plan.tasks[0],title:`Task ${i+1}`,depends_on:i?[i]:[]}))}
    await db.query('update sop_work_runs set plan=$1,source_snapshot=$2 where id=$3',[largePlan,source,growthRun])
    const publicationStart=performance.now()
    assert.equal((await one('select publish_sop_work($1,$2) ids',[growthRun,growthJob.lease_token])).ids.length,40)
    const publicationMs=performance.now()-publicationStart
    pass(`40-task publication with 5,000 existing work items and real Gantt triggers: ${publicationMs.toFixed(1)}ms fixture observation`)
    const ordinaryStart=performance.now()
    await db.exec(`begin;
      do $$ declare grp uuid; item uuid; previous uuid; begin
        insert into work_items(workspace_id,title,lifecycle_phase,native_kind,workflow_role) values('${w}','Ordinary service','fulfilment','relationship_workflow','service_group') returning id into grp;
        insert into work_item_relationships(workspace_id,relationship_id,work_item_id) values('${w}','${growthRelationship}',grp);
        for i in 1..40 loop
          insert into work_items(workspace_id,title,description,lifecycle_phase,native_kind,parent_work_item_id) values('${w}','Ordinary task '||i,'Check the account.','fulfilment','relationship_workflow',grp) returning id into item;
          insert into work_item_relationships(workspace_id,relationship_id,work_item_id) values('${w}','${growthRelationship}',item);
          insert into work_item_assignees(workspace_id,work_item_id,user_id) values('${w}',item,'${staff}');
          insert into asset_work_items(workspace_id,asset_id,work_item_id) values('${w}','${asset}',item);
          if previous is not null then insert into work_item_dependencies(workspace_id,work_item_id,depends_on_work_item_id) values('${w}',item,previous); end if;
          previous:=item;
        end loop;
      end $$;
      set constraints all immediate;
      rollback;`)
    const ordinaryPublicationMs=performance.now()-ordinaryStart
    pass(`comparable ordinary 40-task transaction: ${ordinaryPublicationMs.toFixed(1)}ms fixture observation; shared schedule validation dominates both`)
    // Representative source and relationship growth. No JSON answer bodies on navigation.
    await db.query(`insert into relationships(id,workspace_id,business_name,source_metadata,created_at) select gen_random_uuid(),$1,'Test '||i,'{"is_test":true}',now()-i*interval '1 second' from generate_series(1,30000) i`,[w])
    await db.query(`insert into assets(id,workspace_id,title,native_kind,metadata) select gen_random_uuid(),$1,'Form '||i,'onboarding_form_submission',jsonb_build_object('session_id',gen_random_uuid(),'response',jsonb_build_object('answer','fixture')) from generate_series(1,30000) i`,[w])
    await db.exec('analyze relationships; analyze assets; analyze sop_work_runs;')
    const relPlan=await one(`explain (analyze,format json) select id,business_name,created_at from relationships where workspace_id=$1 and source_metadata->>'is_test'='true' order by created_at desc,id desc limit 25`,[w])
    const evidencePlan=await one(`explain (analyze,format json) select metadata->'response' from assets where workspace_id=$1 and native_kind='onboarding_form_submission' and metadata->>'session_id'=$2 order by id limit 51`,[w,id(21)])
    assert.match(JSON.stringify(relPlan),/sop_work_test_relationships_idx/)
    assert.match(JSON.stringify(evidencePlan),/sop_work_submission_idx/)
    pass('30k relationship/source growth uses bounded indexed queries')
    // Upgrade in place from the deployed pilot; existing cost/source history survives.
    await db.exec('alter table onboarding_service_revisions add column service_id uuid; alter table onboarding_service_revisions add column revision_number integer default 1;')
    await db.query('update onboarding_service_revisions set service_id=id')
    await db.exec(await readFile(`${repositoryRoot}/supabase/migrations/20260914120000_sop_service_generation_flow.sql`,'utf8'))
    await db.exec(await readFile(`${repositoryRoot}/supabase/migrations/20260914121000_sop_progress_access.sql`,'utf8'))
    const fresh=await fixture(310)
    const before=(await one('select count(*)::int n from work_items')).n
    const freshRun=(await one('select accept_sop_work_request($1,$2,100) id',[fresh,'gpt-5.4-mini'])).id
    assert.equal((await one('select count(*)::int n from work_items')).n,before)
    const freshJob=await claim(freshRun)
    const generic=(await prepare(freshJob)).packet
    assert.deepEqual(Object.keys(generic).sort(),['mode','service'])
    assert.equal(generic.mode,'generic')
    assert.equal(freshJob.group_work_item_id,null)
    await db.query("update relationships set business_name='Not sent to AI',notes_summary='Private client strategy' where id=$1",[fresh])
    assert.deepEqual((await prepare(freshJob)).packet,generic)
    await db.query('update sop_work_runs set plan=$1,source_snapshot=$2,raw_output=$3 where id=$4',[{...plan,tasks:[{...plan.tasks[0],depends_on:[99]}]},source,'retained invalid graph',freshRun])
    await assert.rejects(db.query('select publish_sop_work($1,$2)',[freshRun,freshJob.lease_token]),/dependency/)
    assert.equal((await one('select count(*)::int n from work_items')).n,before)
    assert.equal((await one('select group_work_item_id from sop_work_runs where id=$1',[freshRun])).group_work_item_id,null)
    await db.query('update sop_work_runs set plan=null where id=$1',[freshRun])
    const validationProgress=(await one('select read_service_sop_progress($1,$2,$3,$4) value',[w,admin,fresh,fresh])).value
    assert.equal(validationProgress.progress,80)
    assert.equal((await one('select read_service_sop_progress($1,$2,$3,$4) value',[w,staff,fresh,fresh])).value.progress,80)
    await assert.rejects(db.query('select read_service_sop_progress($1,$2,$3,$4)',[w,id(999),fresh,fresh]),/Relationship access required/)
    await assert.rejects(db.query('select read_service_sop_progress($1,$2,$3,$4)',[foreign,admin,fresh,fresh]),/Relationship access required/)
    assert(!('cost' in validationProgress));assert(!('raw_output' in validationProgress))
    const dense={summary:'Generic setup',warnings:[],tasks:Array.from({length:15},(_,i)=>({...plan.tasks[0],title:`Step ${i+1}`,depends_on:i===14?Array.from({length:14},(_,n)=>n+1):[]}))}
    await db.query('update sop_work_runs set plan=$1 where id=$2',[dense,freshRun])
    const freshIds=(await one('select publish_sop_work($1,$2) ids',[freshRun,freshJob.lease_token])).ids
    assert.equal(freshIds.length,15)
    assert.equal((await one('select count(*)::int n from work_items')).n,before+16)
    assert.equal((await one('select read_service_sop_progress($1,$2,$3,$4) value',[w,admin,fresh,fresh])).value.progress,100)
    assert.deepEqual(new Set((await one('select read_relationship_work_queue($1,$2,$3) value',[w,fresh,admin])).value.items.map(i=>i.id)),new Set(freshIds))
    pass('generic upgrade retains rejected output, publishes no partial flow, accepts dense valid dependencies and reaches 100 only after atomic publication')
    await assert.rejects(db.query('select link_sop_service($1,$2,$3,$4,$5)',[w,staff,sop,revision,asset]),/admins/)
    await db.query('select link_sop_service($1,$2,$3,$4,$5,true)',[w,admin,sop,revision,asset])
    const unmapped=await fixture(330)
    assert.equal((await one('select count(*)::int n from sop_work_requests where instance_id=$1',[unmapped])).n,0)
    await assert.rejects(queue(unmapped,id(331)),/Link this service/)
    await db.query('select link_sop_service($1,$2,$3,$4,$5)',[w,admin,sop,revision,asset])
    const links=(await one('select read_sop_service_links($1,$2,$3) value',[w,admin,sop])).value
    assert.equal(links[0].service_id,revision);assert.equal(links[0].asset_name,'Procedure.txt')
    const relinked=await fixture(340)
    const relinkedRun=(await one('select accept_sop_work_request($1,$2,100) id',[relinked,'gpt-5.4-mini'])).id
    const relinkedJob=await claim(relinkedRun);await prepare(relinkedJob)
    await db.query('select link_sop_service($1,$2,$3,$4,$5,true)',[w,admin,sop,revision,asset])
    await assert.rejects(prepare(relinkedJob),/link changed/)
    pass('user-owned linking/unlinking controls generation; missing or revoked mapping cannot publish')
    // Upgrade existing generated bodies without altering ordinary work or losing paid plans.
    const legacyBody=(await one('select description from work_items where id=$1',[freshIds[0]])).description
    const manual=id(800)
    await db.query("insert into work_items(id,workspace_id,title,description) values($1,$2,'Manual work','Keep this description')",[manual,w])
    await db.exec(await readFile(`${repositoryRoot}/supabase/migrations/20260914130000_sop_work_item_content.sql`,'utf8'))
    const migrated=await one('select description,instructions,evidence from work_items where id=$1',[freshIds[0]])
    assert.equal(migrated.instructions,legacyBody.split('\n\nSOP source: ')[0])
    assert.match(migrated.evidence,/Page 1: Confirm access/)
    assert(!migrated.evidence.includes('\n'))
    assert.equal((await one('select description from work_items where id=$1',[manual])).description,'Keep this description')
    await assert.rejects(db.query("update work_items set evidence='Forged source' where id=$1",[freshIds[0]]),/read-only/)
    await db.query("update work_items set description='Short goal',instructions='Edited procedure' where id=$1",[freshIds[0]])
    assert.equal((await one('select evidence from work_items where id=$1',[freshIds[0]])).evidence,migrated.evidence)
    assert((await one("select save_work_item_text($1,$2,'instructions',$3,$4) version",[w,freshIds[0],'Long procedure '.repeat(2000),'Edited procedure'])).version)
    assert.equal((await one("select save_work_item_text($1,$2,'instructions','Stale overwrite','Edited procedure') version",[w,freshIds[0]])).version,null)
    assert.equal((await one("select save_work_item_text($1,$2,'description','Wrong workspace','Short goal') version",[foreign,freshIds[0]])).version,null)
    await assert.rejects(db.query("select save_work_item_text($1,$2,'evidence','Forged source',$3)",[w,freshIds[0],migrated.evidence]),/Invalid work item text/)
    await db.exec('set role authenticated')
    await assert.rejects(db.query("select save_work_item_text($1,$2,'description','Bypass','Short goal')",[w,freshIds[0]]),/permission denied/)
    await db.exec('reset role')
    pass('existing SOP bodies separate losslessly, ordinary descriptions survive and evidence rejects edits; long-body CAS and role boundaries hold')
    await db.query('select link_sop_service($1,$2,$3,$4,$5)',[w,admin,sop,revision,asset])
    const detailedRel=await fixture(810)
    const detailedRun=(await one('select accept_sop_work_request($1,$2,100) id',[detailedRel,'gpt-5.4-mini'])).id
    const detailedJob=await claim(detailedRun);await prepare(detailedJob)
    assert.equal((await one('select schema_version from sop_interpretations where id=$1',[detailedJob.interpretation_id])).schema_version,'sop-source-v2')
    const detailed={summary:'Account preparation',warnings:[],tasks:[{title:'Confirm account access',description:'Make the account available for setup.',instructions:'1. Check existing access.\n2. Request access from the client if needed.',completion_requirements:['The account opens with the required permissions.'],task_type:'request_information',requested_inputs:['1.1'],source_steps:[1],depends_on:[],blocked_reason:''}]}
    await db.query('update sop_work_runs set plan=$1,source_snapshot=$2 where id=$3',[detailed,source,detailedRun])
    const detailedIds=(await one('select publish_sop_work($1,$2) ids',[detailedRun,detailedJob.lease_token])).ids
    const detailedPublished=await one('select description,instructions,evidence,metadata from work_items where id=$1',[detailedIds[0]])
    assert.equal(detailedPublished.description,detailed.tasks[0].description)
    assert.equal(detailedPublished.instructions,detailed.tasks[0].instructions+'\n\nComplete when:\n- '+detailed.tasks[0].completion_requirements[0])
    assert(!detailedPublished.instructions.includes('SOP source:'))
    assert.match(detailedPublished.evidence,/Page 1: Confirm access/)
    assert.equal(detailedPublished.metadata.task_type,'request_information')
    assert.deepEqual((await one('select publish_sop_work($1,$2) ids',[detailedRun,detailedJob.lease_token])).ids,detailedIds)
    assert.equal((await one('select count(*)::int n from asset_work_items where work_item_id=$1',[detailedIds[0]])).n,1)
    pass('v2 source and v6 plan publish distinct content, completion checks, original asset and idempotent queue work')
    const invalidRel=await fixture(820)
    const invalidRun=(await one('select accept_sop_work_request($1,$2,100) id',[invalidRel,'gpt-5.4-mini'])).id
    const invalidJob=await claim(invalidRun);await prepare(invalidJob)
    await db.query('update sop_work_runs set plan=$1,source_snapshot=$2 where id=$3',[{...detailed,tasks:[{...detailed.tasks[0],completion_requirements:[]}]},source,invalidRun])
    await assert.rejects(db.query('select publish_sop_work($1,$2)',[invalidRun,invalidJob.lease_token]),/completion requirements/)
    assert.equal((await one('select count(*)::int n from service_instance_work_items where instance_id=$1',[invalidRel])).n,0)
    pass('missing completion checks leave zero partial work')
    await db.exec(await readFile(`${repositoryRoot}/supabase/migrations/20260914210000_sop_library_ui.sql`,'utf8'))
    const uiSop=id(980), uiAsset=id(981), uiService=id(982), secondAsset=id(983)
    await db.query('select create_sop_record($1,$2,$3,$4,$5)',[w,admin,uiSop,'UI procedure','Initial description'])
    await db.query('insert into onboarding_services(id,workspace_id) values($1,$2)',[uiService,w])
    await db.query('select attach_sop_upload($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',[w,admin,uiSop,uiAsset,'Only file.txt','text/plain',100,`${w}/sops/${uiSop}/assets/${uiAsset}/${'b'.repeat(64)}/original`,'reference',''])
    await db.query('select assign_sop_service($1,$2,$3,$4,false)',[w,admin,uiSop,uiService])
    assert.equal((await one('select asset_id from sop_service_sources where service_id=$1',[uiService])).asset_id,uiAsset)
    await assert.rejects(db.query('select assign_sop_service($1,$2,$3,$4,false)',[w,staff,uiSop,uiService]),/admins/)
    await assert.rejects(db.query('select assign_sop_service($1,$2,$3,$4,false)',[foreign,admin,uiSop,uiService]),/admins/)
    await db.query('select attach_sop_upload($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',[w,admin,uiSop,secondAsset,'Updated file.txt','text/plain',100,`${w}/sops/${uiSop}/assets/${secondAsset}/${'c'.repeat(64)}/original`,'reference',''])
    await db.query('select set_sop_main_asset($1,$2,$3,$4)',[w,admin,uiSop,secondAsset])
    assert.equal((await one('select asset_id from sop_service_sources where service_id=$1',[uiService])).asset_id,secondAsset)
    assert.equal((await one("select count(*)::int n from sop_assets where sop_id=$1 and role='main'",[uiSop])).n,1)
    await assert.rejects(db.query('select set_sop_main_asset($1,$2,$3,$4)',[w,admin,uiSop,asset]),/Choose a readable/)
    const replacementAsset=id(984)
    await db.query('select attach_sop_upload($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',[w,admin,uiSop,replacementAsset,'Replacement main.txt','text/plain',100,`${w}/sops/${uiSop}/assets/${replacementAsset}/${'d'.repeat(64)}/original`,'main',''])
    assert.equal((await one('select asset_id from sop_service_sources where service_id=$1',[uiService])).asset_id,replacementAsset)
    assert.equal((await one("select count(*)::int n from sop_assets where sop_id=$1 and role='main'",[uiSop])).n,1)
    await db.query('select assign_sop_service($1,$2,$3,$4,true)',[w,admin,uiSop,uiService])
    assert.equal((await one('select enabled from sop_service_sources where service_id=$1',[uiService])).enabled,false)
    pass('SOP-level assignment adopts a sole source, follows explicit main changes, preserves removal history and rejects foreign or staff writes')
    assert.ok((await one('select save_sop_text($1,$2,$3,$4,$5,$6) saved',[w,admin,uiSop,'title','Updated name','UI procedure'])).saved)
    assert.ok((await one('select save_sop_text($1,$2,$3,$4,$5,$6) saved',[w,admin,uiSop,'description','Updated description','Initial description'])).saved)
    assert.equal((await one('select save_sop_text($1,$2,$3,$4,$5,$6) saved',[w,admin,uiSop,'title','Overwrite','UI procedure'])).saved,null)
    await assert.rejects(db.query('select save_sop_text($1,$2,$3,$4,$5,$6)',[w,staff,uiSop,'title','Staff edit','Updated name']),/admins/)
    await assert.rejects(db.query('select save_sop_text($1,$2,$3,$4,$5,$6)',[w,admin,uiSop,'title','','Updated name']),/Check the SOP/)
    await db.query('update sops set archived_at=now() where id=$1',[uiSop])
    assert.equal((await one('select save_sop_text($1,$2,$3,$4,$5,$6) saved',[w,admin,uiSop,'title','Archived edit','Updated name'])).saved,null)
    pass('SOP field CAS allows independent autosaves and rejects stale, empty, staff and archived edits')
    await (await import('./sop-image-sql-checks.mjs')).validateSopImageSql({db,id,w,foreign,admin,staff,sop,revision,fixture})
    await (await import('./sop-reliability-sql-checks.mjs')).validateSopReliabilitySql({db,id,w,admin,staff,sop,revision,fixture})
    await (await import('./sop-evidence-title-sql-checks.mjs')).validateSopEvidenceTitles({db,id,w,admin,staff,sop,revision,fixture})
    await (await import('./relationship-context-assets-sql-checks.mjs')).validateRelationshipContextAssets({db,id,w,admin,staff,sop,revision,fixture})
    console.log(JSON.stringify({checks,publicationMs,ordinaryPublicationMs,relationshipPlan:relPlan,evidencePlan}))
} finally { await db.close() }
