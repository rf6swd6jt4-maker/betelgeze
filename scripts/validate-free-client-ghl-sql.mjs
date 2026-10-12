// Actual migration and RPC bodies, synthetic clients and Vault only. No network.
import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { PGlite, repositoryRoot } from './pglite-fixture.mjs'
const db = new PGlite()
const uuid = n => `00000000-0000-4000-8000-${String(n).padStart(12,'0')}`
const w=uuid(1), owner=uuid(2), staff=uuid(3), outsider=uuid(4), client=uuid(10), appointment=uuid(11)
const sql = name => readFile(`${repositoryRoot}/supabase/migrations/${name}`, 'utf8')
const one = async (query,args=[]) => (await db.query(query,args)).rows[0]
const observations=[]
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
 const overview=async(token='free')=>{await db.exec('set role service_role');try{return (await one('select public.client_portal_overview($1,$2) result',[token,w])).result}finally{await db.exec('reset role')}}
 assert.equal((await manage('credentials')).failure,'access')
 assert.equal((await overview()).leadMode,'empty')
 await db.exec(await sql('20261012210000_free_client_ghl_connections.sql'))
 assert.deepEqual((await manage('list',{id:null})).map(x=>x.relationshipId).sort(),[client,appointment].sort())
 assert.equal((await manage('credentials')).privateToken,null)
 for(const actor of [staff,outsider])for(const action of ['credentials','begin_connect','remove'])assert.equal((await manage(action,{actor})).failure,'access')
 assert.deepEqual((await manage('list',{actor:staff,id:null})).map(x=>x.relationshipId),[appointment])
 assert.equal((await manage('credentials',{actor:staff,id:appointment})).privateToken,null)
 assert.equal((await overview('legacy')).leadMode,'empty','No onboarding session alone must not enable GHL')
 await manage('begin_connect');await manage('finish',{credential:'synthetic-token-long-enough'})
 const saved=(await manage('list'))[0]
 assert.equal(saved.connected,true);assert.equal(saved.calendarId,'calendar123456789')
 assert.equal((await overview()).leadMode,'ghl')
 await db.exec(`update relationship_service_instances set stage='completed' where id='${uuid(23)}'`)
 assert.equal((await manage('credentials',{revision:saved.revision})).privateToken,'synthetic-token-long-enough','Existing connections remain manageable after service completion')
 assert.equal((await overview()).leadMode,'ghl')
 await db.exec(`update relationship_service_instances set stage='onboarding' where id='${uuid(23)}'`)
 await db.exec(`insert into relationship_onboarding_session_blocks values('${w}','${uuid(30)}','appointment_medium'),('${w}','${uuid(30)}','appointment_fields');`)
 assert.equal((await overview()).leadMode,'ghl','Connection overrides legacy appointment blocks')
 assert.equal((await overview('paid')).leadMode,'appointments','Unconnected native history remains accessible')
 assert.equal((await manage('remove',{revision:uuid(99)})).failure,'changed')
 await manage('remove',{revision:saved.revision});assert.equal((await overview()).leadMode,'appointments')
 await db.exec('delete from relationship_onboarding_session_blocks')
 assert.equal((await overview()).leadMode,'empty')
 await db.exec(`update client_portal_sessions set token_revoked_at=now() where session_token='free'`)
 assert.equal(await overview(),null)
 await db.exec(`update client_portal_sessions set token_revoked_at=null; update relationships set status='archived' where id='${client}'`)
 assert.equal((await manage('credentials')).failure,'access')
 await db.exec(`update relationships set status='active',lifecycle_phase='potential_client' where id='${client}'; update relationship_service_instances set stage='negotiating' where id='${uuid(23)}'`)
 assert.equal((await manage('credentials')).failure,'access')
 await db.exec(`update relationships set lifecycle_phase='retention' where id='${client}'; update workspaces set status='inactive' where id='${w}'`)
 assert.equal((await manage('credentials')).failure,'access')
 await db.exec(`update workspaces set status='active';`)
 for(const role of ['anon','authenticated','service_role']) {
  assert.equal((await one("select has_function_privilege($1,'public.client_portal_overview(text,uuid)','EXECUTE') ok",[role])).ok,role==='service_role')
  assert.equal((await one("select has_table_privilege($1,'client_portal_secure.ghl_connections','SELECT') ok",[role])).ok,false)
 }
 await db.exec("select set_config('request.jwt.claim.role','authenticated',false)")
 assert.equal(await overview(),null)
 await db.exec("select set_config('request.jwt.claim.role','service_role',false)")
 assert.equal(await overview('invalid'),null)
 // Growth comparison: same 500 eligible paid clients, plus free client behavior above.
 await db.exec(`insert into relationships select ('00000000-0000-4000-8000-'||lpad((1000+n)::text,12,'0'))::uuid,'${w}','active','retention','Synthetic '||n,null,'{}'::jsonb from generate_series(1,500) n;
 insert into relationship_services select '${w}',id,'${uuid(21)}','${uuid(20)}','${staff}' from relationships where primary_person_name like 'Synthetic%'; analyze;`)
 for(const cohort of ['legacy','service_instances']) {
 if(cohort==='service_instances')await db.exec(`update relationships set lifecycle_phase='potential_client'; insert into relationship_service_instances select workspace_id,relationship_id,relationship_id,service_id,service_revision_id,assignee_user_id,'setup','active',null from relationship_services; delete from relationship_services; analyze;`)
 for(const [label,query,args] of [
  ['owner list',"select public.NAME($1,$2,'list')",[w,owner]],
  ['staff list',"select public.NAME($1,$2,'list')",[w,staff]],
  ['target credentials',"select public.NAME($1,$2,'credentials',$3)",[w,owner,appointment]],
  ['portal overview',"select public.NAME($1,$2)",['paid',w]]
 ]) {
  const name=label==='portal overview'?'client_portal_overview':label.includes('list')?'manage_client_ghl_connection':'manage_client_ghl_connection_v2'
  if(label==='portal overview')await db.exec('set role service_role')
  const values={baseline:[],candidate:[]}
  for(let round=0;round<35;round++)for(const variant of (round%2?['candidate','baseline']:['baseline','candidate'])) {
   const result=await one('explain (analyze,format json) '+query.replace('NAME',variant==='baseline'?'baseline_'+name:name),args)
   if(round>=5)values[variant].push(result['QUERY PLAN'][0]['Execution Time'])
  }
  if(label==='portal overview')await db.exec('reset role')
  const percentile=(a,p)=>[...a].sort((x,y)=>x-y)[Math.floor((a.length-1)*p)]
  observations.push({cohort,action:label,samples:30,baselineMedianMs:percentile(values.baseline,.5),candidateMedianMs:percentile(values.candidate,.5),baselineP95Ms:percentile(values.baseline,.95),candidateP95Ms:percentile(values.candidate,.95)})
 }
 }
 await db.exec(`update relationship_service_instances set stage='onboarding' where id='${uuid(23)}'`)
 await db.exec(`insert into relationships select ('00000000-0000-4000-8000-'||lpad((2000+n)::text,12,'0'))::uuid,'${w}','active','onboarding','Additional '||n,null,'{}'::jsonb from generate_series(1,501) n;`)
 assert.equal((await manage('list',{id:null})).failure,'list_limit')
 assert.equal((await manage('list')).length,1,'Exact client access remains available above list bound')
 assert.equal((await manage('credentials')).privateToken,null)
 const functions=(await db.query("select proname,md5(prosrc) body_md5,prosecdef security_definer,proconfig config from pg_proc where proname in ('manage_client_ghl_connection','manage_client_ghl_connection_v2','client_portal_overview') order by proname")).rows
 console.log(JSON.stringify({passed:true,engine:'isolated PGlite PostgreSQL',productionCalls:0,observations},null,2))
 if(process.env.BE_FREE_GHL_EVIDENCE)await writeFile(process.env.BE_FREE_GHL_EVIDENCE,JSON.stringify({passed:true,observations,functions},null,2))
} finally {await db.close()}
