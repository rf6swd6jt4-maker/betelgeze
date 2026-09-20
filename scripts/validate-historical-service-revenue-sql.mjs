import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { PGlite, repositoryRoot } from './pglite-fixture.mjs'
const db = new PGlite()
const w='00000000-0000-4000-8000-000000000001', r='00000000-0000-4000-8000-000000000002'
const u='00000000-0000-4000-8000-000000000003', i='00000000-0000-4000-8000-000000000004'
const v='00000000-0000-4000-8000-000000000005', sale='00000000-0000-4000-8000-000000000006'
try {
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create table auth.users(id uuid primary key); insert into auth.users values('${u}');
    create table workspaces(id uuid primary key); insert into workspaces values('${w}');
    create table relationships(id uuid primary key, workspace_id uuid, status text); insert into relationships values('${r}','${w}','active');
    create table onboarding_service_revisions(id uuid primary key,workspace_id uuid,currency text); insert into onboarding_service_revisions values('${v}','${w}','EUR');
    create table relationship_service_instances(id uuid primary key,workspace_id uuid,relationship_id uuid,service_revision_id uuid,origin text,stage text,disposition text,
      unique(workspace_id,relationship_id,id));
    insert into relationship_service_instances values('${i}','${w}','${r}','${v}','already_onboarded','completed','active');
    create table service_instance_sale_items(instance_id uuid primary key);
    create table client_sales(id uuid primary key,workspace_id uuid,relationship_id uuid,currency text,total_amount integer,status text,stripe_invoice_status text,raw_payload jsonb,deleted_at timestamptz,initial_payment_received_at timestamptz);
    create table stripe_events(id text,workspace_id uuid,event_type text,raw_payload jsonb, primary key(workspace_id,id));
    create function can_manage_relationship_service(w uuid,r uuid,u uuid,o text) returns boolean language sql as $$ select u='${u}'::uuid $$;
    create function add_completed_relationship_service(w uuid,r uuid,u uuid,q uuid,s uuid,v uuid,a uuid,sl uuid,m uuid) returns jsonb language sql as $$ select jsonb_build_object('id','${i}'::text,'generation',false) $$;
    set check_function_bodies=off;`)
  const migration=await readFile(`${repositoryRoot}/supabase/migrations/20260920120000_historical_service_revenue.sql`,'utf8')
  await db.exec(migration)
  await db.exec(migration) // Dashboard application must be safe to replay through migration tooling.
  const q1='00000000-0000-4000-8000-000000000007',q2='00000000-0000-4000-8000-000000000008'
  const value=async(sql,args)=>(await db.query(sql,args)).rows[0]
  assert.equal((await value('select set_completed_service_revenue($1,$2,$3,$4,$5,0,12500) version',[w,r,i,u,q1])).version,1)
  assert.equal((await value('select set_completed_service_revenue($1,$2,$3,$4,$5,0,12500) version',[w,r,i,u,q1])).version,1)
  await assert.rejects(db.query('select set_completed_service_revenue($1,$2,$3,$4,$5,0,13000)',[w,r,i,u,q2]),/changed/)
  await value('select set_completed_service_revenue($1,$2,$3,$4,$5,1,13000)',[w,r,i,u,q2])
  assert.equal((await value('select amount_cents from relationship_recorded_revenue($1,$2)',[w,r])).amount_cents,13000)
  await db.query(`insert into client_sales(id,workspace_id,relationship_id,currency,total_amount,status,raw_payload,initial_payment_received_at) values($1,$2,$3,'EUR',30000,'paid','{"livemode":true}',now())`,[sale,w,r])
  assert.equal((await value('select amount_cents from relationship_recorded_revenue($1,$2)',[w,r])).amount_cents,43000)
  const invoice={livemode:true,data:{object:{id:'in_1',metadata:{client_sale_id:sale},currency:'eur',amount_paid:29000}}}
  await db.query('insert into stripe_events values($1,$2,$3,$4)', ['evt1',w,'invoice.paid',invoice])
  await db.query('insert into stripe_events values($1,$2,$3,$4)', ['evt2',w,'invoice.payment_succeeded',invoice])
  assert.equal((await value('select amount_cents from relationship_recorded_revenue($1,$2)',[w,r])).amount_cents,42000)
  await db.exec(`alter table relationship_service_instances add column assignee_user_id uuid, add column version integer not null default 1;
    create table service_instance_stage_events(id uuid primary key default gen_random_uuid(),workspace_id uuid,instance_id uuid,request_id uuid);
    create function change_relationship_service_with_sop(w uuid,r uuid,i uuid,u uuid,q uuid,v integer,s text,d text,a uuid,reason text,g boolean)
      returns jsonb language plpgsql as $$ begin
        if exists(select 1 from service_instance_stage_events where instance_id=i and request_id=q) then return jsonb_build_object('id',i,'generation',false); end if;
        update relationship_service_instances set assignee_user_id=a, version=version+1 where id=i and version=v;
        if not found then raise exception 'Service instance changed'; end if;
        insert into service_instance_stage_events(workspace_id,instance_id,request_id) values(w,i,q);
        return jsonb_build_object('id',i,'generation',false);
      end $$;`)
  const editMigration=await readFile(`${repositoryRoot}/supabase/migrations/20260920143000_edit_completed_service_cash_collected.sql`,'utf8')
  await db.exec(editMigration)
  await db.exec(editMigration)
  const q3='00000000-0000-4000-8000-000000000009', q4='00000000-0000-4000-8000-000000000010'
  await value('select edit_completed_relationship_service_with_cash($1,$2,$3,$4,$5,1,\'completed\',null,\'\',2,14000)',[w,r,i,u,q3])
  assert.equal((await value('select amount_cents from relationship_recorded_revenue($1,$2)',[w,r])).amount_cents,43000)
  await assert.rejects(db.query('select edit_completed_relationship_service_with_cash($1,$2,$3,$4,$5,1,\'completed\',$6,\'Reassigned\',2,15000)',[w,r,i,u,q4,v]),/changed/)
  assert.equal((await value('select version from relationship_service_instances where id=$1',[i])).version,1)
  await value('select edit_completed_relationship_service_with_cash($1,$2,$3,$4,$5,1,\'completed\',$6,\'Reassigned\',3,15000)',[w,r,i,u,q4,v])
  assert.equal((await value('select version from relationship_service_instances where id=$1',[i])).version,2)
  await value('select edit_completed_relationship_service_with_cash($1,$2,$3,$4,$5,1,\'completed\',$6,\'Reassigned\',3,15000)',[w,r,i,u,q4,v])
  assert.equal((await value('select amount_cents from relationship_recorded_revenue($1,$2)',[w,r])).amount_cents,44000)
  console.log('PASS historical amount, replay, conflict, aggregate, combined edit rollback')
} finally { await db.close() }
