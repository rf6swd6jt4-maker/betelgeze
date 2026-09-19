-- Keep engagement work bounded to one relationship and the latest 5,000 messages.
-- Daily portal counts are written during the existing access RPC, off the staff detail path.
create table if not exists public.client_portal_visit_days (
    workspace_id uuid not null,
    portal_session_id uuid not null,
    visit_date date not null,
    visits integer not null default 0,
    primary key (portal_session_id, visit_date),
    foreign key (workspace_id, portal_session_id) references public.client_portal_sessions(workspace_id, id) on delete cascade
);
create index if not exists client_portal_visit_days_workspace_session on public.client_portal_visit_days(workspace_id, portal_session_id, visit_date desc);
alter table public.client_portal_visit_days enable row level security;
revoke all on public.client_portal_visit_days from public, anon, authenticated;
grant select, insert, update on public.client_portal_visit_days to service_role;

create or replace function public.record_client_portal_access(p_workspace_id uuid, p_portal_session_id uuid)
returns void language plpgsql security invoker set search_path = public as $$
begin
    update public.client_portal_sessions
    set first_accessed_at = coalesce(first_accessed_at, now()),
        last_accessed_at = now(), access_count = access_count + 1
    where workspace_id = p_workspace_id and id = p_portal_session_id
      and status = 'active' and token_revoked_at is null;
    if found then
        insert into public.client_portal_visit_days (workspace_id, portal_session_id, visit_date, visits)
        values (p_workspace_id, p_portal_session_id, current_date, 1)
        on conflict (portal_session_id, visit_date) do update set visits = public.client_portal_visit_days.visits + 1;
    end if;
end;
$$;

create index if not exists client_messages_engagement_recent
    on public.client_messages(workspace_id, relationship_id, created_at desc)
    where direction in ('inbound', 'outbound');

create index if not exists client_messages_engagement_inbound
    on public.client_messages(workspace_id, relationship_id, created_at desc)
    where direction = 'inbound';
create index if not exists client_messages_engagement_staff
    on public.client_messages(workspace_id, relationship_id, created_at desc)
    where direction = 'outbound' and sender_kind = 'staff';

create or replace function public.read_relationship_engagement(
    p_workspace_id uuid, p_relationship_id uuid
) returns jsonb
language sql stable security invoker set search_path = public as $$
    with relation as (
        select r.id, r.workspace_id, r.last_whatsapp_inbound_at
        from public.relationships r where r.workspace_id = p_workspace_id and r.id = p_relationship_id
    ), portal as (
        select p.id, p.first_accessed_at, p.last_accessed_at, p.access_count
        from public.client_portal_sessions p join relation r on r.workspace_id = p.workspace_id and r.id = p.relationship_id
    ), messages as (
        select m.direction, m.sender_kind, m.created_at, m.provider
        from public.client_messages m join relation r on r.workspace_id = m.workspace_id and r.id = m.relationship_id
        where m.direction in ('inbound', 'outbound') and m.created_at >= now() - interval '30 days'
        order by m.created_at desc limit 5000
    ), days as (
        select (current_date - n)::date as day from generate_series(13, 0, -1) n
    ), latest as (
        select
            (select count(*) from messages where direction = 'inbound') as inbound_count,
            (select count(*) from messages where direction = 'outbound') as outbound_count,
            (select count(*) from messages) as sampled_count
    )
    select jsonb_build_object(
        'lastClientWhatsAppAt', r.last_whatsapp_inbound_at,
        'lastClientMessageAt', (select m.created_at from public.client_messages m where m.workspace_id = r.workspace_id and m.relationship_id = r.id and m.direction = 'inbound' order by m.created_at desc limit 1),
        'lastStaffReplyAt', (select m.created_at from public.client_messages m where m.workspace_id = r.workspace_id and m.relationship_id = r.id and m.direction = 'outbound' and m.sender_kind = 'staff' order by m.created_at desc limit 1),
        'portalFirstVisitAt', p.first_accessed_at,
        'portalLastVisitAt', p.last_accessed_at,
        'portalVisitCount', coalesce(p.access_count, 0),
        'clientMessages30d', l.inbound_count,
        'ourMessages30d', l.outbound_count,
        'messageSampleLimited', l.sampled_count >= 5000,
        'trends', (select jsonb_agg(jsonb_build_object(
            'day', d.day,
            'client', (select count(*) from messages m where m.direction = 'inbound' and m.created_at::date = d.day),
            'ours', (select count(*) from messages m where m.direction = 'outbound' and m.created_at::date = d.day),
            'visits', coalesce((select v.visits from public.client_portal_visit_days v where v.portal_session_id = p.id and v.visit_date = d.day), 0)
        ) order by d.day) from days d),
        'onboardingStatus', s.status,
        'onboardingLastActivityAt', s.updated_at,
        'onboardingCompletedAt', s.completed_at
    )
    from relation r
    cross join latest l
    left join portal p on true
    left join lateral (
        select status, updated_at, completed_at from public.relationship_onboarding_sessions s
        where s.workspace_id = r.workspace_id and s.relationship_id = r.id
        order by s.created_at desc limit 1
    ) s on true;
$$;
revoke all on function public.read_relationship_engagement(uuid, uuid) from public, anon, authenticated;
grant execute on function public.read_relationship_engagement(uuid, uuid) to service_role;
