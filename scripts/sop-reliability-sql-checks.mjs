import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { repositoryRoot } from './pglite-fixture.mjs'
export async function validateSopReliabilitySql({db,id,w,admin,staff,revision,fixture}) {
 const one=async(sql,args=[]) => (await db.query(sql,args)).rows[0]
 // The parent fixture isolates ordinary service creation; use versioned commands
 // with persisted stage events to verify rollback/publication boundaries.
 await db.exec(`alter table relationship_service_instances add column version integer default 1;
 alter table relationship_service_instances add column source_key text;
 create or replace function can_manage_relationship_service(uuid,uuid,uuid,text) returns boolean language sql as $$select exists(select 1 from workspace_memberships where workspace_id=$1 and user_id=$3 and role in ('owner','admin'))$$;
 create table reliability_stage_events(instance_id uuid,stage text);
 `)
 await db.exec(`alter table relationship_service_instances alter column id set default gen_random_uuid();
 alter table relationship_service_instances add column origin text default 'already_onboarded';
 alter table relationship_service_instances add column source_snapshot jsonb default '{}';
 alter table relationship_service_instances add column change_request_id uuid;
 alter table relationship_service_instances add column change_reason text;
 alter table relationship_service_instances add column changed_by uuid;
 create unique index reliability_service_source_key on relationship_service_instances(workspace_id,relationship_id,source_key);
 alter table onboarding_services add column internal_code text default 'ads';
 alter table onboarding_service_revisions add column if not exists service_id uuid;
 alter table onboarding_service_revisions add column if not exists revision_number integer default 1;
 update onboarding_service_revisions set service_id=id;
 create table service_instance_stage_events(id uuid default gen_random_uuid(),workspace_id uuid,instance_id uuid,request_id uuid,version integer,new_stage text,new_disposition text,new_assignee_user_id uuid,reason text,actor_user_id uuid);
 create function reliability_stage_event() returns trigger language plpgsql as $$begin
 insert into service_instance_stage_events(workspace_id,instance_id,request_id,version,new_stage,new_disposition,new_assignee_user_id,reason,actor_user_id)
 values(new.workspace_id,new.id,new.change_request_id,new.version,new.stage,new.disposition,new.assignee_user_id,new.change_reason,new.changed_by);
 if new.source_key is not null then insert into reliability_stage_events values(new.id,new.stage);end if; return new;end $$;
 create trigger reliability_stage_event after insert or update on relationship_service_instances for each row execute function reliability_stage_event();`)
 const commands=await readFile(`${repositoryRoot}/supabase/migrations/20260912130000_relationship_services_ui.sql`,'utf8')
 for(const name of ['create_service_instance','change_service_instance','add_relationship_service']){
  const at=commands.indexOf(`function public.${name}(`),start=commands.lastIndexOf('create ',at),end=commands.indexOf('end $$;',at)+7
  await db.exec(commands.slice(start,end).replace('create function','create or replace function'))
 }
 // A minimal readiness fixture retains the production transition statement;
 // the migration must replace it and keep repeated readiness events idempotent.
 const readiness=await readFile(`${repositoryRoot}/supabase/migrations/20260913150000_onboarding_session_readiness.sql`,'utf8')
 const begin=readiness.indexOf(" update public.relationship_service_instances i set stage='setup'"),end=readiness.indexOf(';',begin)+1
 await db.exec(`create function service_instance_onboarding_ready(uuid,uuid,uuid) returns boolean language sql as $$select true$$;
 create function refresh_service_onboarding_readiness(p_workspace_id uuid,p_session_id uuid) returns void language plpgsql as $$
 declare s record; sale record; wid uuid;
 begin select p_session_id id into s; select '${admin}'::uuid service_manager_user_id into sale;
 ${readiness.slice(begin,end)}
 end $$;`)
 await db.exec(await readFile(`${repositoryRoot}/supabase/migrations/20260915190000_sop_generation_reliability.sql`,'utf8'))
 const r=await fixture(9500), request=id(9501)
 const args=[w,r,admin,request,revision,revision,'already_onboarded','setup',staff,true]
 const add=async()=> (await one('select add_relationship_service_with_sop($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) value',args)).value
 const initial=(await one('select count(*)::int n from relationship_service_instances')).n
 const pending=await add(); assert.equal(pending.generation,true);assert.deepEqual(await add(),pending)
 assert.equal((await one('select count(*)::int n from relationship_service_instances')).n,initial)
 assert.equal((await one('select count(*)::int n from reliability_stage_events')).n,0)
 assert.equal((await one('select read_service_sop_progress($1,$2,$3,$4) value',[w,admin,r,pending.id])).value.status,'pending')
 await assert.rejects(db.query('select add_relationship_service_with_sop($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',[...args.slice(0,8),null,true]),/reused/)
 const run=(await one('select accept_sop_work_request($1,$2,100) id',[pending.id,'gpt-5.4-mini'])).id
 if(!run){const req=await one('select * from sop_work_requests where instance_id=$1',[pending.id]);await db.query('select queue_sop_work($1,$2,$3,$4,$5,$6,$7,$8,100)',[w,admin,id(9599),req.sop_id,req.asset_id,r,pending.id,'gpt-5.4-mini'])}
 assert.ok(run)
 const job=await one('select * from claim_sop_work($1)',[run]);await one('select prepare_sop_work($1,$2)',[run,job.lease_token])
 const source={summary:'Setup',applicability:[],warnings:[],missing_information:[],steps:Array.from({length:13},(_,i)=>({title:`Step ${i+1}`,instruction:'Confirm the supplied inputs.',condition:'',source_location:`Page ${i+1}`,source_quote:'Confirm the supplied inputs.',kind:'requirement',client_inputs:['Client input']}))}
 const task={title:'Confirm inputs',description:'Confirm supplied details.',instructions:'Check existing records and confirm the required inputs.',completion_requirements:['Required inputs are confirmed.'],task_type:'request_information',requested_inputs:source.steps.map((_,i)=>`${i+1}.1`),source_steps:source.steps.map((_,i)=>i+1),depends_on:[],blocked_reason:'',attachments:[]}
 const save=t=>db.query("update sop_work_runs set plan=$1,source_snapshot=$2,asset_candidates='[]',schema_version='sop-work-assets-v8' where id=$3",[{summary:'Setup',warnings:[],tasks:[t]},source,run])
 await save({...task,completion_requirements:[]})
 await assert.rejects(db.query('select publish_sop_work($1,$2)',[run,job.lease_token]),/completion/)
 assert.equal((await one('select count(*)::int n from relationship_service_instances')).n,initial)
 assert.equal((await one('select count(*)::int n from reliability_stage_events')).n,0)
 assert.equal((await one('select count(*)::int n from work_items where metadata->>\'sop_work_run_id\'=$1',[run])).n,0)
 await save(task)
 const published=(await one('select publish_sop_work($1,$2) ids',[run,job.lease_token])).ids
 assert.equal(published.length,1);assert.equal((await one('select count(*)::int n from relationship_service_instances')).n,initial+1)
 assert.deepEqual((await one('select publish_sop_work($1,$2) ids',[run,job.lease_token])).ids,published)
 assert.equal((await one('select read_service_sop_progress($1,$2,$3,$4) value',[w,admin,r,pending.id])).value.status,'published')
 assert.equal((await one('select count(*)::int n from reliability_stage_events')).n,1)
 // Existing service keeps its stage/version through failed generation, including
 // a later edit racing with publication.
 const existing=await fixture(9510)
 await db.query('delete from sop_work_requests where instance_id=$1',[existing])
 await db.query("update relationship_service_instances set stage='maintenance' where id=$1",[existing])
 const change=await one('select change_relationship_service_with_sop($1,$2,$3,$4,$5,1,\'setup\',\'active\',$6,\'Rebuild\',true) value',[w,existing,existing,admin,id(9511),staff])
 assert.equal(change.value.generation,true)
 assert.equal((await one('select stage from relationship_service_instances where id=$1',[existing])).stage,'maintenance')
 const secondRun=(await one('select accept_sop_work_request($1,$2,100) id',[existing,'gpt-5.4-mini'])).id
 const second=await one('select * from claim_sop_work($1)',[secondRun]);await one('select prepare_sop_work($1,$2)',[secondRun,second.lease_token])
 await db.query('update relationship_service_instances set version=2 where id=$1',[existing])
 await assert.rejects(db.query('select publish_sop_work($1,$2)',[secondRun,second.lease_token]),/changed/)
 assert.equal((await one('select stage from relationship_service_instances where id=$1',[existing])).stage,'maintenance')
 const automatic=await fixture(9520)
 await db.query('delete from sop_work_requests where instance_id=$1',[automatic])
 await db.query("update relationship_service_instances set stage='onboarding' where id=$1",[automatic])
 await db.query('insert into service_instance_sessions values($1,$2,$3)',[w,automatic,id(9521)])
 await db.query('select refresh_service_onboarding_readiness($1,$2)',[w,id(9521)])
 await db.query('select refresh_service_onboarding_readiness($1,$2)',[w,id(9521)])
 assert.equal((await one('select stage from relationship_service_instances where id=$1',[automatic])).stage,'onboarding')
 assert.equal((await one('select count(*)::int n from sop_service_intents where instance_id=$1',[automatic])).n,1)
 assert.equal((await one('select status from sop_work_requests where instance_id=$1',[automatic])).status,'pending')
 await db.exec('set role authenticated');await assert.rejects(db.query('select * from sop_service_intents'),/permission denied/);await assert.rejects(db.query('select sop_generation_instance($1,$2,$3)',[w,r,pending.id]),/permission denied/);await db.exec('reset role')
 console.log('PASS SOP reliability: staged adds/changes, command replay, 13-step publication, atomic rollback, version races and private intents')
}
