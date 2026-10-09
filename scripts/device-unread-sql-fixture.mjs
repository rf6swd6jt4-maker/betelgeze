import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
const root = fileURLToPath(new URL('../', import.meta.url))
const sql = name => readFile(`${root}/supabase/migrations/${name}`, 'utf8')
const definition = (source, name) => {
    const start = source.search(new RegExp(`create (?:or replace )?function public\\.${name}\\(`))
    assert.ok(start >= 0, name)
    return source.slice(start, source.indexOf('$$;', start) + 3)
}
export const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const [w, me, client, native, other, deviceA, deviceB, sessionA, sessionB, newDevice, newSession] = Array.from({ length: 11 }, (_, i) => id(i + 1))
export const deviceUnreadIds = { w, me, client, native, other, deviceA, deviceB, sessionA, sessionB, newDevice, newSession }
export const deviceUnreadMigration = () => sql('20261009120000_device_communications_unread.sql')
// Execute in a FRESH isolated database. Known A/B are seeded before cutover;
// newDevice/newSession are deliberately absent until the caller observes them.
export async function deviceUnreadFixtureSql({ includeDeviceMigration = true } = {}) {
    const statements = []
    statements.push(`
        create role authenticated; create role anon; create role service_role; create schema auth;
        create function auth.uid() returns uuid language sql stable as $$ select (nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid $$;
        create function auth.jwt() returns jsonb language sql stable as $$ select nullif(current_setting('request.jwt.claims',true),'')::jsonb $$;
        create function auth.role() returns text language sql stable as $$ select auth.jwt()->>'role' $$;
        create table auth.users(id uuid primary key);
        create table auth.sessions(id uuid primary key,user_id uuid not null references auth.users(id),not_after timestamptz);
        create table workspaces(id uuid primary key);
        create table user_profiles(user_id uuid primary key,mfa_reenrollment_required boolean default false);
        create table workspace_memberships(workspace_id uuid,user_id uuid,role text,primary key(workspace_id,user_id));
        create table relationships(id uuid primary key,workspace_id uuid,seller_user_id uuid,fulfilment_manager_user_id uuid,status text,unique(workspace_id,id));
        create table relationship_client_chat_members(workspace_id uuid,relationship_id uuid,user_id uuid,primary key(relationship_id,user_id));
        create table workspace_native_conversations(id uuid primary key,workspace_id uuid,kind text,team_id uuid,unique(workspace_id,id));
        create table workspace_native_conversation_participants(conversation_id uuid,user_id uuid,primary key(conversation_id,user_id));
        create table workspace_team_members(team_id uuid,user_id uuid,primary key(team_id,user_id));
        create table workspace_native_conversation_visibility(conversation_id uuid,user_id uuid,cleared_at timestamptz,primary key(conversation_id,user_id));
        create table client_messages(id uuid primary key,workspace_id uuid,relationship_id uuid,direction text,created_at timestamptz);
        create table workspace_native_messages(id uuid primary key,workspace_id uuid,conversation_id uuid,sender_user_id uuid,created_at timestamptz,unique(workspace_id,id));
        create table communication_read_cursors(workspace_id uuid,relationship_id uuid,user_id uuid,last_read_message_id uuid references client_messages(id) on delete set null,last_read_at timestamptz,primary key(workspace_id,relationship_id,user_id));
        create table workspace_native_read_cursors(workspace_id uuid,conversation_id uuid,user_id uuid,last_read_message_id uuid references workspace_native_messages(id) on delete set null,last_read_at timestamptz,primary key(conversation_id,user_id));
        create table account_session_devices(session_id uuid primary key references auth.sessions(id) on delete cascade,user_id uuid not null,device_id uuid not null);
        create index account_session_devices_user_device_idx on account_session_devices(user_id,device_id);
        create table web_push_subscriptions(user_id uuid,device_id uuid not null);
        create table chat_push_device_owners(user_id uuid,device_id uuid primary key);
        create index communication_read_cursors_relationship_idx on communication_read_cursors(workspace_id,relationship_id,last_read_at desc);
        create index client_messages_workspace_created_idx on client_messages(workspace_id,created_at desc);
        create index client_messages_relationship_id_idx on client_messages(relationship_id,created_at desc);
        create index workspace_native_messages_conversation_created_idx on workspace_native_messages(conversation_id,created_at desc);
        insert into auth.users values('${me}'),('${other}'); insert into workspaces values('${w}'),('${id(99)}');
        insert into auth.sessions values('${sessionA}','${me}',null),('${sessionB}','${me}',null);
        insert into account_session_devices values('${sessionA}','${me}','${deviceA}'),('${sessionB}','${me}','${deviceB}');
        insert into web_push_subscriptions values('${me}','${id(12)}'); insert into chat_push_device_owners values('${me}','${id(13)}');
        insert into workspace_memberships values('${w}','${me}','staff');
        insert into relationships values('${client}','${w}','${me}',null,'active'),('${id(30)}','${w}',null,null,'active');
        insert into workspace_native_conversations values('${native}','${w}','direct',null),('${id(40)}','${w}','direct',null);
        insert into workspace_native_conversation_participants values('${native}','${me}');
        insert into client_messages select '${id(100)}'::uuid,'${w}','${client}','inbound','2026-10-09 10:00:00.123456+00';
        insert into workspace_native_messages values('${id(200)}','${w}','${native}','${other}','2026-10-09 10:00:00.123456+00');
        -- Legacy wall-clock read times must normalize to the real message position.
        insert into communication_read_cursors values('${w}','${client}','${me}','${id(100)}','2026-10-09 12:00:00');
        insert into workspace_native_read_cursors values('${w}','${native}','${me}','${id(200)}','2026-10-09 12:00:00');
    `)
    const authSql = await sql('20260821120000_account_system_v2.sql')
    for (const name of ['current_session_is_aal2', 'is_workspace_member']) statements.push(definition(authSql, name))
    statements.push(definition(await sql('20260821150000_encrypted_communications.sql'), 'native_conversation_can_read'))
    statements.push(definition(await sql('20260909100000_client_delivery_teams.sql'), 'client_conversation_can_access'))
    statements.push(await sql('20260917140000_communications_unread_state.sql'))
    statements.push(`create function public.communication_native_messages_bounded(w uuid,c uuid,n integer) returns setof public.workspace_native_messages language sql stable as $$ select * from public.workspace_native_messages where workspace_id=w and conversation_id=c order by created_at desc,id desc limit n $$;`)
    statements.push(await sql('20260911010000_native_communications_inbox.sql'))
    statements.push(await sql('20260925120000_preserve_chat_read_positions.sql'))
    if (includeDeviceMigration) statements.push(await deviceUnreadMigration())
    return statements.join('\n')
}
