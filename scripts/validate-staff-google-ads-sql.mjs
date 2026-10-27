import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {createGhlFixture,repositoryRoot} from './ghl-sql-fixture.mjs'
const db=await createGhlFixture(),id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`
const ws=id(1),otherWs=id(2),owner=id(3),staff=id(4),stranger=id(5),rel=id(10),other=id(11),archived=id(12),session=id(20),block=id(21),attempt=id(30),next=id(31)
const manager='1234567890',customer='2345678901',second='3456789012'
const rows=async(sql,args=[]) => (await db.query(sql,args)).rows
const value=async(sql,args=[]) => (await rows(sql,args))[0].result
let assertions=0
const reject=async(promise,pattern)=>{await assert.rejects(promise,pattern);assertions++}
try {
 await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
 create table workspaces(id uuid primary key,status text,name text);
 create table workspace_memberships(workspace_id uuid,user_id uuid,role text,primary key(workspace_id,user_id));
 create table relationships(workspace_id uuid,id uuid primary key,status text,unique(workspace_id,id));
 create table relationship_onboarding_sessions(workspace_id uuid,id uuid primary key,relationship_id uuid,status text,unique(workspace_id,id));
 create table relationship_onboarding_session_blocks(workspace_id uuid,id uuid primary key,session_id uuid,unique(workspace_id,id));
 create table workspace_integrations(workspace_id uuid,provider text,enabled boolean,mode text,connected_account_id text,config_encrypted text,config_hint jsonb,primary key(workspace_id,provider));
 create table fixture_permissions(workspace_id uuid,user_id uuid,relationship_id uuid,primary key(workspace_id,user_id,relationship_id));
 create table onboarding_block_requirements(id uuid primary key,response jsonb);
 create function public.manage_client_ghl_connection_v2(p_workspace_id uuid,p_user_id uuid,p_action text,p_relationship_id uuid default null,p_operation_id uuid default null,p_account_type text default null,p_location_id text default null,p_private_token text default null,p_location_name text default null,p_metrics jsonb default null,p_error text default null,p_expected_revision uuid default null,p_calendar_id text default null,p_calendar_name text default null) returns jsonb language sql as $$select coalesce(jsonb_agg(jsonb_build_object('relationshipId',p.relationship_id)),'[]') from public.fixture_permissions p where p.workspace_id=p_workspace_id and p.user_id=p_user_id and p.relationship_id=p_relationship_id$$;
 create function public.begin_google_ads_portal(text,uuid,text,text,uuid) returns jsonb language sql as $$select '{}'::jsonb$$;
 insert into workspaces values('${ws}','active','Agency'),('${otherWs}','active','Other workspace');
 insert into workspace_memberships values('${ws}','${owner}','owner'),('${ws}','${staff}','staff');
 insert into relationships values('${ws}','${rel}','active'),('${ws}','${other}','active'),('${ws}','${archived}','archived');
 insert into workspace_integrations values('${ws}','google_ads',true,'connected','${manager}','encrypted-fixture','{"manager_name":"Agency"}');
 insert into relationship_onboarding_sessions values('${ws}','${session}','${rel}','complete');
 insert into relationship_onboarding_session_blocks values('${ws}','${block}','${session}');
 insert into onboarding_block_requirements values('${block}','{"accepted":true}');
 insert into fixture_permissions values('${ws}','${staff}','${rel}');`)
 const original=await readFile(`${repositoryRoot}/supabase/migrations/20260907010000_onboarding_google_ads_connections.sql`,'utf8')
 await db.exec(original.slice(original.indexOf('create table public.relationship_google_ads_connections'),original.indexOf('alter table public.relationship_google_ads_connections enable row level security')))
 await db.exec(`alter table relationship_google_ads_connections alter column onboarding_session_id drop not null;alter table relationship_google_ads_connections alter column source_session_block_id drop not null;
 create table relationship_google_ads_reports(connection_id uuid references relationship_google_ads_connections(id),report jsonb);
 grant usage on schema public to service_role;grant all on all tables in schema public to service_role;`)
 await db.exec(await readFile(`${repositoryRoot}/supabase/migrations/20261027180000_staff_google_ads_connections.sql`,'utf8'))
 for(const name of ['require_google_ads_staff_setup(uuid,uuid,uuid)','read_google_ads_staff(uuid,uuid,uuid,boolean)','begin_google_ads_staff(uuid,uuid,uuid,text,text,uuid,text)','finish_google_ads_staff(uuid,uuid,uuid,uuid,text,text,text,text,text,text,text)']) {
  const permissions=(await rows("select has_function_privilege('anon',$1,'execute') anon,has_function_privilege('authenticated',$1,'execute') authenticated,has_function_privilege('service_role',$1,'execute') service",[name]))[0]
  assert.deepEqual(permissions,{anon:false,authenticated:false,service:true});assertions++
 }
 await reject(value('select read_google_ads_staff($1,$2,$3,false) result',[ws,owner,rel]),/Trusted/)
 await db.exec('set role service_role')
 const read=(user=owner,relationship=rel,workspace=ws,credentials=false)=>value('select read_google_ads_staff($1,$2,$3,$4) result',[workspace,user,relationship,credentials])
 const begin=(user=owner,relationship=rel,acct=customer,op=attempt,cfg='encrypted-fixture')=>value('select begin_google_ads_staff($1,$2,$3,$4,$5,$6,$7) result',[ws,user,relationship,acct,manager,op,cfg])
 const finish=(user=owner,relationship=rel,acct=customer,op=attempt,cfg='encrypted-fixture',status='connected')=>value('select finish_google_ads_staff($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) result',[ws,user,relationship,op,acct,cfg,status,'Client','USD','America/Chicago',null])
 const old=async()=>db.exec("update relationship_google_ads_connections set updated_at=now()-interval '10 seconds'")
 const snapshot=async()=>({ reports:await rows('select * from relationship_google_ads_reports'),requirements:await rows('select * from onboarding_block_requirements'),sessions:await rows('select * from relationship_onboarding_sessions'),blocks:await rows('select * from relationship_onboarding_session_blocks') })
 assert.equal((await read()).connection,null);assert.equal((await read()).managerId,manager);assert.equal(JSON.stringify(await read()).includes('encrypted-fixture'),false)
 assert.equal((await read(owner,rel,ws,true)).integrationEncrypted,'encrypted-fixture');assertions+=4
 await reject(read(stranger),/access/);await reject(read(owner,archived),/access/);await reject(read(owner,rel,otherWs),/access/)
 await reject(begin(owner,rel,customer,attempt,'rotated'),/changed/)
 await reject(begin(owner,rel,manager),/10-digit/)
 await begin(staff)
 await reject(begin(staff),/already running/)
 await reject(finish(staff,rel,customer,next),/expired|replaced/)
 await reject(finish(staff,rel,second),/expired|replaced/)
 await reject(finish(staff,rel,customer,attempt,'rotated'),/changed/)
 await db.exec(`delete from fixture_permissions where user_id='${staff}'`)
 await reject(finish(staff),/access/)
 await db.exec(`insert into fixture_permissions values('${ws}','${staff}','${rel}')`)
 await db.exec(`update relationships set status='archived' where id='${rel}'`)
 await reject(finish(staff),/access/)
 await db.exec(`update relationships set status='active' where id='${rel}';delete from workspace_memberships where user_id='${staff}'`)
 await reject(finish(staff),/access/)
 await db.exec(`insert into workspace_memberships values('${ws}','${staff}','staff');update workspaces set status='paused' where id='${ws}'`)
 await reject(finish(staff),/access/)
 await db.exec(`update workspaces set status='active' where id='${ws}';update workspace_integrations set config_encrypted='rotated' where workspace_id='${ws}'`)
 await reject(finish(staff),/changed/)
 await db.exec(`update workspace_integrations set config_encrypted='encrypted-fixture' where workspace_id='${ws}'`)
 assert.equal((await finish(staff)).status,'connected');assert.equal((await read(staff)).connection.status,'connected');assertions+=2
 await reject(finish(staff),/expired|replaced/)
 await reject(begin(staff),/few seconds/)
 await reject(begin(owner,other),/another relationship/)
 await reject(begin(staff,other,second),/access/)
 const saved=(await rows('select * from relationship_google_ads_connections'))[0]
 assert.equal(saved.onboarding_session_id,null);assert.equal(saved.source_session_block_id,null);assertions+=2
 // Existing onboarding provenance, accepted responses and cached reports survive same-account staff retries.
 await db.exec(`update relationship_google_ads_connections set onboarding_session_id='${session}',source_session_block_id='${block}';insert into relationship_google_ads_reports values('${saved.id}','{"spend":42}');`)
 const preserved=await snapshot()
 await old()
 await reject(begin(owner,rel,second,next),/different Google Ads account/)
 assert.equal((await rows('select customer_id from relationship_google_ads_connections'))[0].customer_id,customer);assertions++
 await begin(staff,rel,customer,next)
 assert.equal((await finish(staff,rel,customer,next,'encrypted-fixture','pending')).status,'pending');assertions++
 assert.deepEqual(await snapshot(),preserved);assertions++
 const provenance=(await rows('select onboarding_session_id,source_session_block_id from relationship_google_ads_connections'))[0]
 assert.deepEqual(provenance,{onboarding_session_id:session,source_session_block_id:block});assertions++
 await old();await begin(staff,rel,customer,attempt)
 await db.exec("update relationship_google_ads_connections set attempt_started_at=now()-interval '3 minutes'")
 await reject(finish(staff),/expired|replaced/)
 await old();await begin(staff,rel,customer,next)
 assert.equal((await finish(staff,rel,customer,next,'encrypted-fixture','needs_attention')).status,'needs_attention');assertions++
 assert.deepEqual(await snapshot(),preserved);assertions++
 await db.exec('update workspace_integrations set enabled=false')
 const disabled=await read();assert.ok(disabled.error);assert.equal('integrationEncrypted' in await read(owner,rel,ws,true),false);assertions+=2
 // Native PostgreSQL proves authority is re-read after a real advisory-lock wait.
 if(db.connect){
  await db.exec(`update workspace_integrations set enabled=true;update relationship_google_ads_connections set updated_at=now()-interval '10 seconds',attempt_id=null;`)
  const blocker=await db.connect(),caller=await db.connect()
  await caller.query('set role service_role')
  const blockedResult=async(sql,args,revoke)=>{
   await blocker.query('begin')
   await blocker.query("select pg_advisory_xact_lock(hashtextextended($1,0))",[`${ws}:${rel}`])
   const pending=caller.query(sql,args).then(result=>({result}),error=>({error}))
   try{
    await db.waitLock(caller)
    await revoke()
   }finally{await blocker.query('commit')}
   const outcome=await pending
   assert.ok(outcome.error,'A revoked actor cannot complete after the lock wait')
   assert.equal(outcome.error.code,'42501');assertions+=2
  }
  await blockedResult('select begin_google_ads_staff($1,$2,$3,$4,$5,$6,$7)',[ws,staff,rel,customer,manager,attempt,'encrypted-fixture'],()=>db.exec(`delete from fixture_permissions where user_id='${staff}'`))
  assert.equal((await rows('select attempt_id from relationship_google_ads_connections'))[0].attempt_id,null);assertions++
  await db.exec(`insert into fixture_permissions values('${ws}','${staff}','${rel}')`)
  await begin(staff)
  await blockedResult('select finish_google_ads_staff($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',[ws,staff,rel,attempt,customer,'encrypted-fixture','connected','Client','USD','America/Chicago',null],()=>db.exec(`delete from workspace_memberships where user_id='${staff}'`))
  const uncommitted=(await rows('select attempt_id,status from relationship_google_ads_connections'))[0]
  assert.equal(uncommitted.attempt_id,attempt);assert.equal(uncommitted.status,'needs_attention');assertions+=2
 }
 console.log(`PASS: ${assertions} staff Google Ads SQL assertions; current authority, active relationship, configuration, leases, account uniqueness, no account replacement, and retained onboarding/report records.`)
} catch(error) {console.error(error.message,error.where??" ");process.exitCode=1} finally {await db.close()}
