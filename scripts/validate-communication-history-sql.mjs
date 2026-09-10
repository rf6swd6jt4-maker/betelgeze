// Isolated synthetic PostgreSQL fixtures; no credentials or live database access.
import { PGlite, repositoryRoot as root } from './pglite-fixture.mjs';
import { readFile } from 'node:fs/promises';
const db = new PGlite();
await db.exec(`
create role service_role; create role authenticated; create role anon;
create schema auth;
create function auth.uid() returns uuid language sql stable as $$ select (nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid $$;
create function auth.role() returns text language sql stable as $$ select nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'role' $$;
create function current_session_is_aal2() returns boolean language sql stable as $$ select nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'aal'='aal2' $$;
create table workspace_memberships(workspace_id uuid,user_id uuid);
create table relationships(id uuid primary key,workspace_id uuid,seller_user_id uuid,source_metadata jsonb,status text,team_locked_at timestamptz,created_at timestamptz default now());
create table client_messages(id uuid primary key default gen_random_uuid(),workspace_id uuid,relationship_id uuid,direction text,provider text,body text,status text,sender_kind text,raw_payload jsonb,created_at timestamptz);
create table workspace_native_conversations(id uuid primary key,workspace_id uuid,kind text,team_id uuid,is_system boolean,created_at timestamptz default now());
create table workspace_native_conversation_participants(conversation_id uuid,user_id uuid);
create table workspace_team_members(team_id uuid,user_id uuid);
create table workspace_native_messages(id uuid primary key default gen_random_uuid(),workspace_id uuid,conversation_id uuid,sender_user_id uuid,body text,created_at timestamptz);
create table workspace_native_conversation_visibility(workspace_id uuid,conversation_id uuid,user_id uuid,cleared_at timestamptz,primary key(conversation_id,user_id));
create function client_conversation_can_access(w uuid,r uuid,u uuid) returns boolean language sql stable as $$ select exists(select 1 from public.relationships where workspace_id=w and id=r and seller_user_id=u) $$;
create function is_workspace_member(w uuid) returns boolean language sql stable as $$ select exists(select 1 from public.workspace_memberships where workspace_id=w and user_id=auth.uid()) $$;
create function native_conversation_can_read(c uuid,u uuid) returns boolean language sql stable as $$ select exists(select 1 from public.workspace_native_conversation_participants where conversation_id=c and user_id=u) $$;
-- Intentional fixture adapters: cryptography and Vault are checked by the
-- production-compatible SQL suite in staging, not emulated here.
create function communication_client_message(w uuid,m uuid) returns setof client_messages language sql stable as $$ select * from public.client_messages where workspace_id=w and id=m and public.client_conversation_can_access(w,relationship_id,auth.uid()) and public.current_session_is_aal2() $$;
create function communication_native_message(w uuid,m uuid) returns setof workspace_native_messages language sql stable as $$ select * from public.workspace_native_messages where workspace_id=w and id=m and public.native_conversation_can_read(conversation_id,auth.uid()) and public.current_session_is_aal2() $$;
insert into workspace_memberships values('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002');
insert into relationships values('00000000-0000-4000-8000-000000000003','00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002','{"is_test":true}','active',now(),now());
insert into workspace_native_conversations values('00000000-0000-4000-8000-000000000004','00000000-0000-4000-8000-000000000001','direct',null,false,now());
insert into workspace_native_conversation_participants values('00000000-0000-4000-8000-000000000004','00000000-0000-4000-8000-000000000002');
`);
await db.exec(await readFile(`${root}/supabase/migrations/20260910200000_communication_history_pages.sql`,'utf8'));
const result=await db.exec(await readFile(`${root}/tests/sql/communication-history-pages.sql`,'utf8'));
console.log(JSON.stringify({migration:'applied in isolated PGlite',result:result.flatMap(r=>r.rows),limitation:'Auth fixtures and single-message adapters are stubs; real Vault/RLS integration remains staging QA'}));
await db.close();
