// Isolated synthetic PostgreSQL fixtures; no credentials or live database access.
import { PGlite, repositoryRoot as root } from './pglite-fixture.mjs';
import { readFile } from 'node:fs/promises';
const db = new PGlite();
await db.exec(`
create role service_role bypassrls;
create role authenticated;
create role anon;
create schema auth;
create table auth.users(id uuid primary key);
create table workspaces(id uuid primary key);
create table workspace_memberships(workspace_id uuid, user_id uuid, role text);
create table relationships(workspace_id uuid, id uuid, status text, lifecycle_phase text, primary key(workspace_id,id));
create table relationship_services(workspace_id uuid, relationship_id uuid, service_id uuid);
create function appointment_setting_service_is_available(w uuid, r uuid, s uuid) returns boolean language sql stable as $$ select exists(select 1 from relationship_services where workspace_id=w and relationship_id=r and service_id=s) $$;
create function workspace_user_can_manage_appointment_setting(w uuid, r uuid, s uuid, u uuid) returns boolean language sql stable as $$ select appointment_setting_service_is_available(w,r,s) and exists(select 1 from workspace_memberships where workspace_id=w and user_id=u and role='owner') $$;
create table appointment_setting_appointments (
 id uuid primary key default gen_random_uuid(), workspace_id uuid references workspaces(id), relationship_id uuid, service_id uuid,
 contact_name text, phone text, appointment_at timestamptz, appointment_date date, appointment_time time, appointment_timezone text default 'UTC',
 meeting_medium text default 'phone', meeting_link text, details jsonb not null default '{}', workflow_status text default 'draft',
 submitted_at timestamptz, submitted_by uuid, submission_message_id uuid, created_by uuid, updated_by uuid,
 created_at timestamptz default now(), updated_at timestamptz default now(),
 check (workflow_status in ('draft','submitted')), check (meeting_medium in ('phone','zoom','google_meet')),
 foreign key(workspace_id,relationship_id) references relationships(workspace_id,id)
);
grant usage on schema public,auth to service_role;
grant all on all tables in schema public,auth to service_role;
insert into workspaces values('00000000-0000-0000-0000-000000000001');
insert into auth.users values('00000000-0000-0000-0000-000000000002');
insert into workspace_memberships values('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000002','owner');
insert into relationships values('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000003','active','retention');
insert into relationship_services values('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000004');
`);
await db.exec(await readFile(`${root}/supabase/migrations/20260910150000_appointment_draft_command_receipts.sql`,'utf8'));
const result = await db.exec(await readFile(`${root}/tests/sql/appointment-draft-command.sql`,'utf8'));
console.log(JSON.stringify({migration:'applied in isolated PGlite fixture',test: result.at(-1).rows}));
await db.exec(`alter table relationships add column client_id uuid;
create table client_messages(id uuid primary key default gen_random_uuid(), workspace_id uuid,relationship_id uuid,client_id uuid,communication_channel_id uuid,direction text,provider text,to_address text,body text,status text,sender_kind text,automation_kind text,automation_label text,client_request_id uuid,raw_payload jsonb,error text);
grant all on client_messages to service_role;`);
const latest = await readFile(`${root}/supabase/migrations/20260909230000_retention_creator_portal_handoff.sql`,'utf8');
await db.exec(latest.slice(latest.indexOf('create or replace function public.submit_appointment_setting_appointment('), latest.lastIndexOf('commit;')));
await db.exec(await readFile(`${root}/supabase/migrations/20260910210000_appointment_notification_outbox.sql`,'utf8'));
const outboxResult = await db.exec(await readFile(`${root}/tests/sql/appointment-notification-outbox.sql`,'utf8'));
console.log(JSON.stringify({migration:'applied in isolated PGlite fixture',test:outboxResult.at(-1).rows}));
await db.exec(`alter table relationships add column primary_person_name text default 'Fixture original', add column business_name text, add column primary_contact_role text, add column primary_phone text, add column whatsapp_phone text, add column communication_primary_provider text default 'meta_whatsapp', add column communication_delivery_mode text default 'mirror', add column primary_email text, add column notes_summary text, add column updated_at timestamptz default now(), add column seller_user_id uuid, add column fulfilment_manager_user_id uuid, add column pos_started_at timestamptz;
create function workspace_role_for_user(w uuid,u uuid) returns text language sql stable as $$ select role from workspace_memberships where workspace_id=w and user_id=u $$;
create function workspace_user_can_access_relationship(w uuid,r uuid,u uuid) returns boolean language sql stable as $$ select exists(select 1 from relationships rel join workspace_memberships m on m.workspace_id=rel.workspace_id where rel.workspace_id=w and rel.id=r and m.user_id=u) $$;`);
await db.exec(await readFile(`${root}/supabase/migrations/20260910220000_relationship_background_command_receipts.sql`,'utf8'));
const background = await db.exec(await readFile(`${root}/tests/sql/relationship-background-command.sql`,'utf8'));
console.log(JSON.stringify({migration:'applied in isolated PGlite fixture',test:background.at(-1).rows}));
await db.close();
