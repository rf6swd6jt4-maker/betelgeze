// Actual migration and RPC bodies, synthetic clients and Vault only. No network.
import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { PGlite, repositoryRoot } from './pglite-fixture.mjs'
const db = new PGlite()
const uuid = n => `00000000-0000-4000-8000-${String(n).padStart(12,'0')}`
const w=uuid(1), owner=uuid(2), staff=uuid(3), outsider=uuid(4), client=uuid(10), appointment=uuid(11)
const sql = name => readFile(`${repositoryRoot}/supabase/migrations/${name}`, 'utf8')
const one = async (query,args=[]) => (await db.query(query,args)).rows[0]
try {
 await db.exec(`
 create role anon; create role authenticated; create role service_role;
 create schema auth; create schema vault;
 create function auth.uid() returns uuid language sql as $$ select null::uuid $$;
 create function auth.role() returns text language sql as $$ select current_setting('request.jwt.claim.role',true) $$;
 select set_config('request.jwt.claim.role','service_role',false);
 create table workspaces(id uuid primary key,status text);
 create table workspace_memberships(workspace_id uuid,user_id uuid,role text,primary key(workspace_id,user_id));
 create table relationships(id uuid primary key,workspace_id uuid,status text,lifecycle_phase text,primary_person_name text,business_name text,source_metadata jsonb);
 create index relationships_workspace_idx on relationships(workspace_id);
 create table onboarding_service_revisions(workspace_id uuid,id uuid,service_id uuid,definition jsonb,primary key(workspace_id,id));
 create table relationship_services(workspace_id uuid,relationship_id uuid,service_id uuid,service_revision_id uuid,assignee_user_id uuid);
 create index relationship_services_relationship_idx on relationship_services(workspace_id,relationship_id);
 create table relationship_service_instances(workspace_id uuid,id uuid,relationship_id uuid,service_id uuid,service_revision_id uuid,assignee_user_id uuid,stage text,disposition text,import_id uuid,primary key(workspace_id,id));
 create index service_instances_relationship_stage_idx on relationship_service_instances(workspace_id,relationship_id,stage,id);
 create index service_instances_active_assignee_idx on relationship_service_instances(workspace_id,assignee_user_id,stage,id) where disposition='active' and stage in ('negotiating','awaiting_payment','onboarding','setup','maintenance');
 create table workspace_member_service_access(workspace_id uuid,user_id uuid,service_id uuid,primary key(workspace_id,user_id,service_id));
 create table appointment_setting_setup_assignees(workspace_id uuid,relationship_id uuid,user_id uuid,primary key(workspace_id,relationship_id,user_id));
 create index appointment_setup_user_idx on appointment_setting_setup_assignees(workspace_id,user_id,relationship_id);
 create function workspace_role_for_user(w uuid,u uuid) returns text language sql stable security definer as $$ select role from workspace_memberships where workspace_id=w and user_id=u $$;
 create table client_portal_sessions(id uuid default gen_random_uuid(),session_token text unique,workspace_id uuid,relationship_id uuid,onboarding_session_id uuid,status text,token_revoked_at timestamptz);
 create table relationship_onboarding_sessions(id uuid primary key,workspace_id uuid,status text);
 create table relationship_onboarding_session_blocks(workspace_id uuid,session_id uuid,kind text);
 create index blocks_session_idx on relationship_onboarding_session_blocks(workspace_id,session_id);
 create table client_portal_actions(id uuid,workspace_id uuid,relationship_id uuid,title text,status text,completed_at timestamptz,updated_at timestamptz,sort_order integer,created_at timestamptz);
 create table client_portal_service_progress(id uuid,workspace_id uuid,relationship_id uuid,service_name text,status text,updated_at timestamptz,created_at timestamptz);
 create table vault.secrets(id uuid primary key default gen_random_uuid(),secret text,name text);
 create view vault.decrypted_secrets as select id,secret as decrypted_secret from vault.secrets;
 create function vault.create_secret(new_secret text,new_name text) returns uuid language sql as $$ insert into vault.secrets(secret,name) values(new_secret,new_name) returning id $$;
 create function vault.update_secret(secret_id uuid,new_secret text) returns void language sql as $$ update vault.secrets set secret=new_secret where id=secret_id $$;
 insert into workspaces values('${w}','active'),('${uuid(90)}','active');
 insert into workspace_memberships values('${w}','${owner}','owner'),('${w}','${staff}','staff'),('${uuid(90)}','${outsider}','owner');
 insert into relationships values('${client}','${w}','active','potential_client','Free client',null,'{}'),('${appointment}','${w}','active','retention','Paid client',null,'{}');
 insert into onboarding_service_revisions values('${w}','${uuid(20)}','${uuid(21)}','{"templateId":"appointment-setting"}');
 insert into relationship_service_instances values('${w}','${uuid(22)}','${appointment}','${uuid(21)}','${uuid(20)}','${staff}','setup','active',null);
 insert into relationship_service_instances values('${w}','${uuid(23)}','${client}','${uuid(24)}','${uuid(25)}','${staff}','onboarding','active',null);
 insert into workspace_member_service_access values('${w}','${staff}','${uuid(21)}');
 insert into relationship_onboarding_sessions values('${uuid(30)}','${w}','active');
 insert into client_portal_sessions(session_token,workspace_id,relationship_id,onboarding_session_id,status) values('free','${w}','${client}','${uuid(30)}','active'),('paid','${w}','${appointment}','${uuid(30)}','active'),('legacy','${w}','${client}',null,'active');
 grant usage on schema public,auth to service_role;
 grant select on all tables in schema public to service_role;
 `)
 for(const file of ['20260912030000_client_portal_ghl.sql','20260912040000_release_client_portal_ghl.sql','20260912050000_client_portal_ghl_calendar.sql','20260912060000_client_portal_ghl_owner_calendar.sql','20260912070000_client_portal_ghl_contact_titles.sql','20260912080000_client_portal_ghl_title_snapshot_identity.sql']) await db.exec(await sql(file))
 await db.exec(`alter table client_portal_secure.ghl_connections add column connected_by uuid,add column account_type text default 'client_account',add column ready_at timestamptz,add column updated_at timestamptz default now();`)
 await db.exec(await sql('20260922191500_fix_client_connections_list.sql'))
 const transfer=await sql('20261005220000_service_assignee_transfer.sql')
 await db.exec(transfer.slice(transfer.indexOf('create function public.current_appointment_service_assignments('),transfer.indexOf('create or replace function public.appointment_setting_service_is_available(')))
 await db.exec(transfer.slice(transfer.indexOf('create function public.service_assignee_can_setup_client('),transfer.indexOf('create function public.read_assigned_appointment_services(')))
 await db.exec(transfer.slice(transfer.indexOf('-- Preserve the existing list projection'),transfer.indexOf('create table public.service_assignee_transfer_receipts')))
 await db.exec(await sql('20261009170000_client_connection_calendar_controls.sql'))
 const portal=await sql('20260922100000_client_portal_fulfilment.sql')
 await db.exec(portal.slice(portal.indexOf('create or replace function public.client_portal_overview('),portal.indexOf('-- Extend the current handoff transaction')))
 if(process.env.BE_FREE_GHL_BASELINE) {
  const baseline=JSON.parse(await readFile(process.env.BE_FREE_GHL_BASELINE,'utf8'))
  for(const fn of baseline.functions)await db.exec(fn.definition)
 }
 for(const name of ['manage_client_ghl_connection','manage_client_ghl_connection_v2','client_portal_overview']) {
  const definition=(await one('select pg_get_functiondef(oid) definition from pg_proc where proname=$1',[name])).definition
  await db.exec(definition.replace(`FUNCTION public.${name}(`,`FUNCTION public.baseline_${name}(`).replaceAll('public.manage_client_ghl_connection(', 'public.baseline_manage_client_ghl_connection('))
 }
 const manage=async(action,{actor=owner,id=client,revision=null,op=uuid(50),credential=null}={})=>(await one('select public.manage_client_ghl_connection_v2($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) result',[w,actor,action,id,op,'client_account','syntheticlocation123',credential,'Fixture',{contacts:1,opportunities:1,open:1,won:0,lost:0},'permissions',revision,'calendar123456789','Fixture Calendar'])).result
 await db.exec(await sql('20261012210000_free_client_ghl_connections.sql'))
 const baseline=(await one("select pg_get_functiondef(oid) definition from pg_proc where proname='manage_client_ghl_connection_v2'")).definition
 await db.exec(baseline.replace('FUNCTION public.manage_client_ghl_connection_v2(', 'FUNCTION public.retirement_baseline_v2('))
 await db.exec(await sql('20261013010000_client_connection_retirement.sql'))
 const read=async({actor=owner,id=null,cursor=null}={})=>(await one('select public.read_client_ghl_connections($1,$2,$3,$4,$5,$6) result',[w,actor,id,!!cursor,cursor?.before??null,cursor?.id??null])).result
 await manage('begin_connect');assert.equal((await manage('finish',{credential:'synthetic-token-long-enough'})).connected,true)
 const revision=(await manage('list')).find(x=>x.relationshipId===client).revision
 const secret=(await one('select vault_secret_id id from client_portal_secure.ghl_connections where relationship_id=$1',[client])).id
 await db.exec(`update relationships set status='archived' where id='${client}'`)
 let page=await read();assert.equal(page.accounts.find(x=>x.relationshipId===client).archived,true)
 assert.equal((await read({actor:outsider})).failure,'access')
 assert.equal((await read({actor:staff})).accounts.some(x=>x.relationshipId===client),false)
 assert.equal((await manage('remove',{actor:staff,revision})).failure,'access')
 assert.equal((await manage('remove',{revision:uuid(999)})).failure,'changed')
 await manage('begin_connect',{id:appointment,op:uuid(51)})
 assert.equal((await manage('finish',{id:appointment,op:uuid(51),credential:'synthetic-token-long-enough'})).failure,'duplicate_archived')
 const receipt=await manage('remove',{revision});assert.equal(receipt.removed,true);assert.equal(receipt.retired.historyId,revision);assert.equal(receipt.retired.locationId,'syntheticlocation123')
 assert.equal((await one('select count(*)::int n from vault.secrets where id=$1',[secret])).n,0)
 assert.equal((await one('select count(*)::int n from client_portal_secure.ghl_connections where relationship_id=$1',[client])).n,0)
 assert.equal((await one('select status from relationships where id=$1',[client])).status,'archived')
 assert.equal((await one('select count(*)::int n from client_portal_sessions')).n,3)
 page=await read();assert.equal(page.history.length,1);assert.equal(page.history[0].historyId,revision)
 assert.equal(JSON.stringify(page.history).includes('synthetic-token'),false)
 assert.equal(page.history[0].locationId,'syntheticlocation123')
 assert.equal((await manage('remove',{revision})).removed,true)
 assert.equal((await read({actor:staff})).history.length,0)
 assert.equal((await manage('finish',{id:appointment,op:uuid(51),credential:'synthetic-token-long-enough'})).connected,true,'Released location can be connected to a new relationship')
 await db.exec(`update relationships set status='active' where id='${client}'`)
 await manage('begin_connect',{op:uuid(52)})
 assert.equal((await manage('finish',{op:uuid(52),credential:'synthetic-token-long-enough'})).failure,'duplicate','Restoring a relationship cannot reclaim the location')
 await manage('fail',{op:uuid(52)})
 // Stale retry after a new connection cannot delete that new connection.
 const appointmentRevision=(await manage('list',{id:appointment}))[0].revision
 assert.equal((await manage('remove',{id:appointment,revision:appointmentRevision})).removed,true)
 await db.exec(`update client_portal_secure.ghl_connections set attempted_at=null where relationship_id='${client}'`)
 await manage('begin_connect',{op:uuid(53)});await manage('finish',{op:uuid(53),credential:'synthetic-token-long-enough'})
 assert.equal((await manage('remove',{revision})).removed,true)
 assert.equal((await manage('list'))[0].connected,true)
 assert.equal((await one('select count(*)::int n from client_portal_secure.ghl_connection_history')).n,2)
 for(const role of ['anon','authenticated','service_role']) {
  assert.equal((await one("select has_table_privilege($1,'client_portal_secure.ghl_connection_history','SELECT') ok",[role])).ok,false)
  assert.equal((await one("select has_function_privilege($1,'public.retire_client_ghl_connection(uuid,uuid,uuid,uuid)','EXECUTE') ok",[role])).ok,role==='service_role')
 }
 // 20,000 history records, bounded 50-row keyset pages, no credential reads.
 await db.exec(`insert into client_portal_secure.ghl_connection_history(id,workspace_id,relationship_id,retired_by,retired_at,snapshot)
 select md5('history-'||i)::uuid,'${w}','${client}','${owner}',now()-i*interval '1 second',jsonb_build_object('relationshipId','${client}','clientName','History') from generate_series(1,20000) i;
 insert into relationships(id,workspace_id,status,lifecycle_phase,primary_person_name,source_metadata)
 select md5('growth-'||i)::uuid,'${w}','active','retention','Growth '||i,'{}' from generate_series(1,500) i;
 analyze;`)
 page=await read();assert.equal(page.history.length,50);assert.ok(page.nextCursor)
 const next=await read({cursor:page.nextCursor});assert.equal(next.accounts.length,0);assert.equal(next.history.length,50)
 assert.equal(next.history.some(x=>page.history.some(y=>x.historyId===y.historyId)),false)
 const scoped=await read({id:appointment});assert.equal(scoped.history.length,1)
 const samples={baseline:[],candidate:[],history:[],staffBaseline:[],staffCandidate:[],scopedBaseline:[],scopedCandidate:[]}
 for(let i=0;i<60;i++)for(const kind of (i%2?Object.keys(samples).reverse():Object.keys(samples))) {
  const query=kind==='staffBaseline'?`select public.retirement_baseline_v2('${w}','${staff}','list')`:kind==='staffCandidate'?`select public.read_client_ghl_connections('${w}','${staff}')`:kind==='scopedBaseline'?`select public.retirement_baseline_v2('${w}','${owner}','list','${client}')`:kind==='scopedCandidate'?`select public.read_client_ghl_connections('${w}','${owner}','${client}')`:kind==='baseline'?`select public.retirement_baseline_v2('${w}','${owner}','list')`:kind==='candidate'?`select public.read_client_ghl_connections('${w}','${owner}')`:`select public.read_client_ghl_connections('${w}','${owner}',null,true,'${page.nextCursor.before}','${page.nextCursor.id}')`
  const plan=(await db.query('explain (analyze,format json) '+query)).rows[0]['QUERY PLAN'][0]
  if(i>=10)samples[kind].push(plan['Execution Time'])
 }
 const timings=Object.fromEntries(Object.entries(samples).map(([k,v])=>{v.sort((a,b)=>a-b);return [k,{median:v[Math.floor(v.length/2)],p95:v[Math.floor(v.length*.95)]}]}))
 const functions=(await db.query("select proname,md5(prosrc) body_md5,prosecdef,proconfig,to_jsonb(proacl) acl from pg_proc where proname in ('read_client_ghl_connections','retire_client_ghl_connection','manage_client_ghl_connection','manage_client_ghl_connection_v2') order by proname")).rows
 await writeFile(process.env.BE_RETIREMENT_REPORT??'/tmp/ghl-retirement-sql.json',JSON.stringify({timings,functions},null,2))
 console.log(JSON.stringify({passed:true,timings,historyRows:20002},null,2))
} finally {await db.close()}
