import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { PGlite, repositoryRoot, loadPGliteExtension } from './pglite-fixture.mjs'

const db = new PGlite({ extensions: { pgcrypto: loadPGliteExtension('pgcrypto') } })
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const w = id(1), r = id(2), r2 = id(3), seller = id(4), manager = id(5), team = id(6), conversation = id(7)
const query = async (sql, params = []) => (await db.query(sql, params)).rows
const one = async (sql, params = []) => (await query(sql, params))[0]
let stage = 'setup'
try {
    await db.exec(`
        create role anon; create role authenticated; create role service_role bypassrls;
        create schema extensions; create schema cron;
        create extension pgcrypto with schema extensions;
        create function cron.schedule(text,text,text) returns bigint language sql as $$select 1::bigint$$;
        create table public.workspaces(id uuid primary key, status text, slug text);
        create table public.relationships(id uuid primary key,workspace_id uuid not null references public.workspaces(id),status text not null default 'active',primary_person_name text,
            primary_phone text,client_id uuid,seller_user_id uuid,fulfilment_manager_user_id uuid,unique(workspace_id,id));
        create table public.client_messages(id uuid primary key default gen_random_uuid(),workspace_id uuid,relationship_id uuid,provider text,direction text,
            status text,created_at timestamptz default now(),sender_kind text,raw_payload jsonb,automation_kind text);
        create table public.communication_message_deliveries(id uuid primary key default gen_random_uuid(),workspace_id uuid,relationship_id uuid,client_message_id uuid,provider text,status text);
        create table public.relationship_onboarding_sessions(id uuid primary key,workspace_id uuid,relationship_id uuid,status text,source_sale_id uuid,is_test boolean,
            created_at timestamptz default now(),updated_at timestamptz default now(),completed_at timestamptz);
        create table public.client_portal_sessions(id uuid primary key default gen_random_uuid(),workspace_id uuid,relationship_id uuid,onboarding_session_id uuid,
            session_token text,status text default 'active',token_revoked_at timestamptz,last_accessed_at timestamptz,updated_at timestamptz default now(),
            unique(workspace_id,relationship_id));
        create table public.onboarding_delivery_outbox(id uuid primary key default gen_random_uuid(),workspace_id uuid,relationship_id uuid,session_id uuid,
            portal_session_id uuid,correlation_id uuid,kind text,destination text,payload jsonb,idempotency_key text,status text default 'queued',
            unique(workspace_id,idempotency_key));
        create table public.workspace_teams(id uuid primary key,workspace_id uuid,relationship_id uuid,kind text,archived_at timestamptz);
        create table public.workspace_native_conversations(id uuid primary key,workspace_id uuid,team_id uuid,kind text,archived_at timestamptz,is_system boolean default false);
        create table public.workspace_native_messages(id uuid primary key default gen_random_uuid(),workspace_id uuid,conversation_id uuid,sender_user_id uuid,body text,created_at timestamptz default now());
        create function public.record_workspace_admin_activity(p_workspace_id uuid,p_area text,p_event text,p_title text,p_entity_type text default null,
            p_entity_id text default null,p_actor_kind text default null,p_correlation_id uuid default null,p_idempotency_key text default null,p_metadata jsonb default '{}')
            returns void language sql as $$select$$;
        insert into public.workspaces values ('${w}','active','scaylup');
        insert into public.relationships(id,workspace_id,primary_person_name,primary_phone,seller_user_id,fulfilment_manager_user_id)
            values ('${r}','${w}','Client One','+353850000001','${seller}','${manager}'),('${r2}','${w}','Client Two','+353850000002','${seller}','${manager}');
        insert into public.workspace_teams values ('${team}','${w}','${r}','relationship',null);
        insert into public.workspace_native_conversations values ('${conversation}','${w}','${team}','team',null,false);
    `)
    for (const filename of [
        '20260919080000_whatsapp_window_state.sql',
        '20260919081000_portal_handoff_once.sql',
        '20260919082000_whatsapp_window_warnings.sql',
        '20260919083000_relationship_engagement.sql',
    ]) {
        stage = filename
        await db.exec(await readFile(`${repositoryRoot}/supabase/migrations/${filename}`, 'utf8'))
    }
    stage = 'window and opt-out'
    const inboundAt = new Date(Date.now() - 23.5 * 60 * 60 * 1000).toISOString()
    await query('select public.record_relationship_whatsapp_inbound($1,$2,$3,$4)', [w,r,inboundAt,'Hello'])
    assert.equal(new Date((await one('select last_whatsapp_inbound_at as inbound from relationships where id=$1',[r])).inbound).getTime(),new Date(inboundAt).getTime())
    await query('select public.record_relationship_whatsapp_inbound($1,$2,$3,$4)', [w,r,new Date().toISOString(),'STOP'])
    await assert.rejects(query("insert into communication_message_deliveries(workspace_id,relationship_id,provider,status) values($1,$2,'meta_whatsapp','sending')",[w,r]), /opted out/u)
    await query('select public.record_relationship_whatsapp_inbound($1,$2,$3,$4)', [w,r,new Date().toISOString(),'CONFIRM'])
    assert.equal((await one('select whatsapp_opted_out_at from relationships where id=$1',[r])).whatsapp_opted_out_at, null)
    const expiredAt = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString()
    await query('update relationships set last_whatsapp_inbound_at=$1 where id=$2',[expiredAt,r])
    const first = await one("insert into client_messages(workspace_id,relationship_id,provider,direction,status,automation_kind,raw_payload) values($1,$2,'meta_whatsapp','outbound','sending','whatsapp_reconfirmation','{}') returning raw_payload",[w,r])
    assert.equal(new Date(first.raw_payload.window_key).getTime(),new Date(expiredAt).getTime())
    await assert.rejects(query("insert into client_messages(workspace_id,relationship_id,provider,direction,status,automation_kind,raw_payload) values($1,$2,'meta_whatsapp','outbound','sending','whatsapp_reconfirmation','{}')",[w,r]), /duplicate/u)

    stage = 'warning deduplication'
    await query('update relationships set last_whatsapp_inbound_at=$1 where id=$2',[inboundAt,r])
    await query('insert into client_messages(workspace_id,relationship_id,provider,direction,status,sender_kind,created_at) values($1,$2,$3,$4,$5,$6,$7)',[w,r,'meta_whatsapp','outbound','sent','staff',new Date(Date.now()-25*60*60*1000).toISOString()])
    assert.equal((await one('select public.enqueue_whatsapp_window_warnings() as count')).count,1)
    assert.equal((await one('select public.enqueue_whatsapp_window_warnings() as count')).count,0)
    assert.equal((await one('select system_notice_kind from workspace_native_messages where sender_user_id is null')).system_notice_kind,'whatsapp_window_warning')
    const nextInboundAt = new Date(Date.now() - 23.1 * 60 * 60 * 1000).toISOString()
    await query('update relationships set last_whatsapp_inbound_at=$1 where id=$2',[nextInboundAt,r])
    const staffReply = await one("insert into client_messages(workspace_id,relationship_id,provider,direction,status,sender_kind,created_at) values($1,$2,'omnichannel','outbound','sent','staff',now()) returning id",[w,r])
    await query("insert into communication_message_deliveries(workspace_id,relationship_id,client_message_id,provider,status) values($1,$2,$3,'meta_whatsapp','sent')",[w,r,staffReply.id])
    assert.equal((await one('select public.enqueue_whatsapp_window_warnings() as count')).count,0)

    stage = 'portal handoff'
    const previousSession = id(10), nextSession = id(11), portal = id(12)
    const token = 'a'.repeat(64)
    await db.exec(`insert into relationship_onboarding_sessions(id,workspace_id,relationship_id,status) values ('${previousSession}','${w}','${r}','completed'),('${nextSession}','${w}','${r}','active');
        insert into client_portal_sessions(id,workspace_id,relationship_id,onboarding_session_id,session_token) values ('${portal}','${w}','${r}','${previousSession}','${token}');
        insert into onboarding_delivery_outbox(workspace_id,relationship_id,session_id,portal_session_id,kind,status,idempotency_key)
            values ('${w}','${r}','${previousSession}','${portal}','client_portal_link','sent','old-link');
        create trigger provision_client_portal_after_onboarding after update of status on relationship_onboarding_sessions
            for each row execute function public.provision_client_portal_after_onboarding();`)
    await query("update relationship_onboarding_sessions set status='completed' where id=$1",[nextSession])
    assert.equal((await one('select session_token from client_portal_sessions where id=$1',[portal])).session_token,token)
    assert.equal((await one("select count(*)::integer as count from onboarding_delivery_outbox where relationship_id=$1",[r])).count,1)
    const newSession = id(13)
    await query("insert into relationship_onboarding_sessions(id,workspace_id,relationship_id,status) values($1,$2,$3,'active')",[newSession,w,r2])
    await query("update relationship_onboarding_sessions set status='completed' where id=$1",[newSession])
    assert.equal((await one("select count(*)::integer as count from onboarding_delivery_outbox where relationship_id=$1 and kind='client_portal_link'",[r2])).count,1)

    stage = 'engagement'
    await query('select public.record_client_portal_access($1,$2)',[w,portal])
    const engagement = (await one('select public.read_relationship_engagement($1,$2) as summary',[w,r])).summary
    assert.equal(engagement.portalVisitCount,1)
    assert.equal(engagement.recentClientWhatsAppMessages,0)
    console.log('PASS: four migrations, window/opt-out, reconfirmation deduplication, actionable warning, portal reuse, engagement')
} catch (error) {
    console.error(JSON.stringify({stage,code:error.code,message:error.message,detail:error.detail,where:error.where}))
    process.exitCode=1
} finally {
    await db.close()
}
