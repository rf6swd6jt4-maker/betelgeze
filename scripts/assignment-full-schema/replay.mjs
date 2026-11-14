// Replays the complete committed migration history in an in-memory PGlite database.
// No credentials, no Supabase connection, no provider calls. Synthetic platform adapters
// (Auth, JWT, Vault, pg_cron, pg_net, roles) mirror scripts/validate-performance-full-schema.mjs; every
// application table, function, policy and trigger comes from the real migration files.
import { readdir, readFile } from 'node:fs/promises'
import { PGlite, repositoryRoot as root, loadPGliteExtension } from '../pglite-fixture.mjs'

export async function replayFullSchema() {
    const pgcrypto = loadPGliteExtension('pgcrypto')
    const pg_trgm = loadPGliteExtension('pg_trgm')
    const db = new PGlite({ extensions: { pgcrypto, pg_trgm } })
    await db.exec(`
create publication supabase_realtime;
create role service_role bypassrls; create role authenticated; create role anon; create role supabase_auth_admin;
create schema auth; create schema extensions; create schema vault;
create extension pgcrypto with schema extensions;
create table auth.users(id uuid primary key default gen_random_uuid(),email text,raw_user_meta_data jsonb default '{}',raw_app_meta_data jsonb default '{}',created_at timestamptz default now(), updated_at timestamptz default now(),last_sign_in_at timestamptz, banned_until timestamptz,is_anonymous boolean default false);
create function auth.uid() returns uuid language sql stable as $$ select (nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid $$;
create function auth.role() returns text language sql stable as $$ select nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'role' $$;
create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb $$;
create table auth.sessions(id uuid primary key default gen_random_uuid(),user_id uuid references auth.users(id) on delete cascade,created_at timestamptz default now(),updated_at timestamptz default now(),not_after timestamptz,aal text,refreshed_at timestamptz,user_agent text,ip inet);
create schema cron; create schema net;
create table cron.jobs(jobid bigserial primary key,jobname text,schedule text,command text);
create function cron.schedule(job_name text,schedule text,command text) returns bigint language sql as $$ insert into cron.jobs(jobname,schedule,command) values($1,$2,$3) returning jobid $$;
create function cron.schedule(schedule text,command text) returns bigint language sql as $$ insert into cron.jobs(schedule,command) values($1,$2) returning jobid $$;
create function cron.unschedule(job_name text) returns boolean language sql as $$ delete from cron.jobs where jobname=$1 returning true $$;
create function cron.unschedule(job_id bigint) returns boolean language sql as $$ delete from cron.jobs where jobid=$1 returning true $$;
create function net.http_post(url text,body jsonb default '{}',params jsonb default '{}',headers jsonb default '{}',timeout_milliseconds integer default 5000) returns bigint language sql as $$ select 1::bigint $$;
create table vault.secrets(id uuid primary key default gen_random_uuid(),secret text,name text,description text);
create view vault.decrypted_secrets as select id,secret,secret as decrypted_secret,name,description from vault.secrets;
create function vault.create_secret(secret text,name text default null,description text default null) returns uuid language sql as $$ insert into vault.secrets(secret,name,description) values($1,$2,$3) returning id $$;
grant usage on schema public,auth to service_role,authenticated,anon;
alter default privileges in schema public grant all on tables to service_role;
alter default privileges in schema public grant all on sequences to service_role;
grant all on all tables in schema auth to service_role;
`)
    let applied = 0
    let current = 'fixture setup'
    try {
        for (const file of (await readdir(`${root}/supabase/migrations`)).filter(name => name.endsWith('.sql')).sort()) {
            current = file
            if (file === '20260629114500_connected_enrichment_sources.sql') {
                await db.exec("insert into public.leadgen_icp_industries(value,label,category) values('excavation_contractors','Excavation contractors','home_services') on conflict do nothing")
            }
            const sql = (await readFile(`${root}/supabase/migrations/${file}`, 'utf8'))
                .replace('create extension if not exists supabase_vault with schema vault;', '-- Platform Vault fixture is pre-created.')
                .replace('create extension if not exists pg_cron;', '-- pg_cron adapter is pre-created.')
                .replace('create extension if not exists pg_net;', '-- pg_net adapter is pre-created.')
            await db.exec(sql)
            applied++
            if (file === '20260909120000_restore_participant_communication_keys.sql') {
                await db.exec('alter view vault.decrypted_secrets rename column secret to legacy_secret_unavailable')
            }
        }
    } catch (error) {
        error.migration = current
        throw error
    }
    return { db, applied }
}
