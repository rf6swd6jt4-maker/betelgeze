// Replays the complete migration history in memory, then executes the reviewed rollback suite.
// Never reads environment credentials or connects to Supabase. See command operations guide.
import { PGlite, repositoryRoot as root, loadPGliteExtension } from './pglite-fixture.mjs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
const pgcrypto=loadPGliteExtension('pgcrypto');
const pg_trgm=loadPGliteExtension('pg_trgm');
import { readFile, readdir, writeFile } from 'node:fs/promises';
const validationFile=process.argv[2] ?? join(tmpdir(),'be-performance-rollout-validation.sql');
const db=new PGlite({extensions:{pgcrypto,pg_trgm}});
let current='fixture setup';
try {
await db.exec(`
create publication supabase_realtime;
create role service_role bypassrls; create role authenticated; create role anon; create role supabase_auth_admin;
create schema auth; create schema extensions; create schema vault;
create extension pgcrypto with schema extensions;
create table auth.users(id uuid primary key default gen_random_uuid(),email text,raw_user_meta_data jsonb default '{}',raw_app_meta_data jsonb default '{}',created_at timestamptz default now(), updated_at timestamptz default now(),last_sign_in_at timestamptz, banned_until timestamptz,is_anonymous boolean default false);
create function auth.uid() returns uuid language sql stable as $$ select (nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid $$;
create function auth.role() returns text language sql stable as $$ select nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'role' $$;
create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb $$;
-- Only platform adapter: Supabase Vault extension is not bundled in PGlite.
create table vault.secrets(id uuid primary key default gen_random_uuid(),secret text,name text,description text);
create view vault.decrypted_secrets as select id,secret,secret as decrypted_secret,name,description from vault.secrets;
create function vault.create_secret(secret text,name text default null,description text default null) returns uuid language sql as $$ insert into vault.secrets(secret,name,description) values($1,$2,$3) returning id $$;
grant usage on schema public,auth to service_role,authenticated,anon;
alter default privileges in schema public grant all on tables to service_role;
alter default privileges in schema public grant all on sequences to service_role;
grant all on all tables in schema auth to service_role;
`);
let count=0;
for (const file of (await readdir(`${root}/supabase/migrations`)).filter(f=>f.endsWith('.sql')).sort()) {
 current=file;
 if(file==='20260629114500_connected_enrichment_sources.sql') await db.exec("insert into public.leadgen_icp_industries(value,label,category) values('excavation_contractors','Excavation contractors','home_services') on conflict do nothing");
 const sql=(await readFile(`${root}/supabase/migrations/${file}`,'utf8')).replace('create extension if not exists supabase_vault with schema vault;','-- Platform Vault fixture is pre-created.');
 await db.exec(sql);
 count++;
 if(file==='20260909120000_restore_participant_communication_keys.sql') await db.exec("alter view vault.decrypted_secrets rename column secret to legacy_secret_unavailable");
}
console.log(JSON.stringify({passed:count,migrations:'entire repository',limitations:['Synthetic Auth/JWT/Vault platform adapters; actual application schema, permission helpers, triggers and pgcrypto','Historical ICP seed and legacy Vault-view alias supplied only to replay old migrations; legacy alias removed after repair']}));
const hashes=(await db.query("select n.nspname||'.'||p.proname as name, md5(p.prosrc) as hash from pg_proc p join pg_namespace n on n.oid=p.pronamespace where (n.nspname='public' and p.proname in ('workspace_user_can_manage_appointment_setting','appointment_setting_service_is_available','workspace_user_can_access_relationship','workspace_role_for_user','submit_appointment_setting_appointment','validate_appointment_setting_appointment_configuration','guard_relationship_delivery_team','sync_relationship_delivery_team')) or (n.nspname='communications_secure' and p.proname in ('encrypt_client_message','get_or_create_content_key')) order by 1")).rows;
await writeFile(join(tmpdir(),'be-performance-expected-function-hashes.json'),JSON.stringify(hashes,null,2));
current='performance rollback validation';
const checks=await db.exec(await readFile(validationFile,'utf8'));
console.log(JSON.stringify(checks.flatMap(result=>result.rows)));
console.log(JSON.stringify((await db.query("select count(*)::integer as remaining_fixture_users from auth.users where email like 'performance-rollback-%@example.invalid'")).rows));
} catch(error) { console.error(JSON.stringify({file:current,code:error.code,message:error.message,detail:error.detail,where:error.where,position:error.position})); process.exitCode=1 }
await db.close();
