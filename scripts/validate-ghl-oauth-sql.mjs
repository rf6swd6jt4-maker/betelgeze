// Actual migration and RPC bodies, synthetic clients and Vault only. No network.
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createGhlFixture, repositoryRoot } from './ghl-sql-fixture.mjs'
const db = await createGhlFixture()
const uuid = n => `00000000-0000-4000-8000-${String(n).padStart(12,'0')}`
const w=uuid(1), owner=uuid(2), staff=uuid(3), outsider=uuid(4), client=uuid(10), appointment=uuid(11)
const sql = name => readFile(`${repositoryRoot}/supabase/migrations/${name}`, 'utf8')
const one = async (query,args=[]) => (await db.query(query,args)).rows[0]
try {
 await db.exec(`
 create role anon; create role authenticated; create role service_role;
 create schema auth; create schema vault; create schema extensions; create extension pgcrypto with schema extensions; create table auth.users(id uuid primary key);
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
 await db.exec(`alter table workspaces add column slug text; update workspaces set slug='fixture'; insert into auth.users values('${owner}'),('${staff}'),('${outsider}');`)
 await db.exec(await sql('20261012210000_free_client_ghl_connections.sql'))
 await db.exec(await sql('20261013010000_client_connection_retirement.sql'))
 await db.exec(await sql('20261020120000_ghl_oauth_connections.sql'))
 const rpc=async(action,input={})=>(await one('select public.ghl_oauth_connection($1,$2::jsonb) result',[action,JSON.stringify(input)])).result
 const state='a'.repeat(64), browser='b'.repeat(64), config='c'.repeat(64)
 const keys={stateHash:state,browserHash:browser,configHash:config,userId:owner}
 const prepare={...keys,workspaceId:w,workspaceSlug:'fixture',relationshipId:client,expectedRevision:null}
 assert.equal((await rpc('prepare',{...prepare,userId:outsider})).failure,'access')
 assert.equal((await rpc('prepare',{...prepare,expectedRevision:uuid(999)})).failure,'changed')
 assert.equal((await rpc('prepare',prepare)).accepted,true)
 assert.equal((await rpc('prepare',prepare)).failure,'busy')
 assert.equal((await rpc('read',{...keys,browserHash:'d'.repeat(64)})).failure,'expired')
 assert.equal((await rpc('read',{...keys,configHash:'d'.repeat(64)})).failure,'expired')
 assert.equal((await rpc('transition',{...keys,from:'authorizing',to:'exchanging',userId:outsider})).failure,'access')
 const transition=async(from,to,extra={})=>rpc('transition',{...keys,from,to,...extra})
 if(db.connect) {
  const a=await db.connect(),b=await db.connect()
  const transitionOn=c=>c.query('select public.ghl_oauth_connection($1,$2::jsonb) result',['transition',JSON.stringify({...keys,from:'authorizing',to:'exchanging'})])
  await a.query('begin');assert.equal((await transitionOn(a)).rows[0].result.accepted,true)
  const waiting=transitionOn(b);waiting.catch(()=>{})
  await db.waitLock(b);await a.query('commit')
  assert.equal((await waiting).rows[0].result.failure,'phase')
  console.log('PASS native PostgreSQL: competing OAuth callbacks wait and only one redeems the code')
 } else assert.equal((await transition('authorizing','exchanging')).accepted,true)
 assert.equal((await transition('authorizing','exchanging')).failure,'phase')
 await transition('exchanging','ready',{credential:'synthetic-encrypted-grant',choices:[{id:'syntheticlocation123',name:'Fixture'}]})
 await transition('ready','selecting',{locationId:'syntheticlocation123'})
 await transition('selecting','selected',{credential:'synthetic-encrypted-location-grant'})
 await transition('selected','connecting')
 const connect={...keys,appId:'fixture-app',companyId:'fixture-company',locationId:'syntheticlocation123',accessToken:'synthetic-token-long-enough',credential:'synthetic-encrypted-rotating-grant',expiresAt:new Date(Date.now()+86400000).toISOString(),accountType:'client_account',locationName:'Fixture',metrics:{contacts:1,opportunities:1,open:1,won:0,lost:0},calendarId:'calendar123456789',calendarName:'Calendar'}
 assert.equal((await rpc('connect',connect)).connected,true)
 assert.equal((await rpc('connect',connect)).connected,true)
 let connection=await one('select * from client_portal_secure.ghl_connections where relationship_id=$1',[client])
 const revision=connection.calendar_revision
 const done=await rpc('read',keys)
 assert.equal(done.credential_encrypted,null);assert.deepEqual(done.choices,[])
 assert.equal((await rpc('claim_refresh',{appId:'fixture-app'})).items.length,0)
 await db.exec("update client_portal_secure.ghl_oauth_credentials set expires_at=now()+interval '1 hour'")
 assert.equal((await rpc('claim_refresh',{appId:'other-app'})).items.length,0)
 if(db.connect) {
  const a=await db.connect(),b=await db.connect()
  const claimOn=c=>c.query('select public.ghl_oauth_connection($1,$2::jsonb) result',['claim_refresh',JSON.stringify({appId:'fixture-app',limit:1})])
  await a.query('begin');assert.equal((await claimOn(a)).rows[0].result.items.length,1)
  assert.equal((await claimOn(b)).rows[0].result.items.length,0)
  await a.query('rollback')
  console.log('PASS native PostgreSQL: concurrent renewal skips a token leased by another worker')
 }
 let claimed=(await rpc('claim_refresh',{appId:'fixture-app',limit:1})).items[0]
 assert(claimed.lease_token)
 assert.equal((await rpc('claim_refresh',{appId:'fixture-app',limit:1})).items.length,0)
 const finish={relationshipId:client,leaseToken:claimed.lease_token,locationId:'syntheticlocation123',accessToken:'synthetic-refreshed-token-long-enough',credential:'synthetic-new-encrypted-grant',expiresAt:new Date(Date.now()+86400000).toISOString(),outcome:'success'}
 assert.equal((await rpc('finish_refresh',{...finish,leaseToken:uuid(999)})).failure,'lease')
 assert.equal((await rpc('finish_refresh',finish)).accepted,true)
 connection=await one('select * from client_portal_secure.ghl_connections where relationship_id=$1',[client])
 assert.equal(connection.calendar_revision,revision,'Token refresh must preserve calendar revision')
 assert.equal((await one('select decrypted_secret from vault.decrypted_secrets where id=$1',[connection.vault_secret_id])).decrypted_secret,finish.accessToken)
 // A replaced PIT must never be overwritten by a later OAuth refresh.
 await db.exec("update client_portal_secure.ghl_oauth_credentials set expires_at=now()+interval '1 hour'")
 claimed=(await rpc('claim_refresh',{appId:'fixture-app',limit:1})).items[0]
 await db.query('select vault.update_secret($1,$2)',[connection.vault_secret_id,'synthetic-manual-replacement-token'])
 assert.equal((await rpc('finish_refresh',{...finish,leaseToken:claimed.lease_token})).failure,'changed')
 assert.equal((await one('select decrypted_secret from vault.decrypted_secrets where id=$1',[connection.vault_secret_id])).decrypted_secret,'synthetic-manual-replacement-token')
 // Expired single-use leases are quarantined, never redeemed again.
 await db.exec("update client_portal_secure.ghl_oauth_credentials set lease_until=now()-interval '1 second'")
 assert.equal((await rpc('claim_refresh',{appId:'fixture-app',limit:1})).items.length,0)
 assert.equal((await one('select status from client_portal_secure.ghl_oauth_credentials')).status,'reconnect_required')
 // Access revocation is checked again even with the correct browser cookie.
 await db.exec(`delete from workspace_memberships where user_id='${owner}'`)
 assert.equal((await rpc('read',keys)).failure,'access')
 for(const role of ['anon','authenticated','service_role']) {
  for(const table of ['ghl_oauth_attempts','ghl_oauth_credentials']) for(const privilege of ['SELECT','INSERT','UPDATE','DELETE']) assert.equal((await one('select has_table_privilege($1,$2,$3) ok',[role,'client_portal_secure.'+table,privilege])).ok,false)
  assert.equal((await one("select has_function_privilege($1,'public.ghl_oauth_connection(text,jsonb)','EXECUTE') ok",[role])).ok,role==='service_role')
 }
 console.log('GHL OAuth SQL: access, state, duplicate callback, connect, renewal, replacement, lease uncertainty and grants passed')
} finally {await db.close()}
