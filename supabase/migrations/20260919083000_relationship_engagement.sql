-- Portal visits are engagement, unlike sending a template. Keep the count
-- atomic without another request on the client-facing page.
alter table public.client_portal_sessions
    add column if not exists first_accessed_at timestamptz,
    add column if not exists access_count bigint not null default 0;

update public.client_portal_sessions
set first_accessed_at = last_accessed_at,
    access_count = 1
where last_accessed_at is not null and first_accessed_at is null;

create index if not exists client_messages_staff_reply_recent
    on public.client_messages(workspace_id, relationship_id, created_at desc)
    where direction = 'outbound' and sender_kind = 'staff';

create or replace function public.record_client_portal_access(p_workspace_id uuid, p_portal_session_id uuid)
returns void language plpgsql security invoker set search_path = public as $$
begin
    update public.client_portal_sessions
    set first_accessed_at = coalesce(first_accessed_at, now()),
        last_accessed_at = now(), access_count = access_count + 1
    where workspace_id = p_workspace_id and id = p_portal_session_id
      and status = 'active' and token_revoked_at is null;
end;
$$;
revoke all on function public.record_client_portal_access(uuid, uuid) from public, anon, authenticated;
grant execute on function public.record_client_portal_access(uuid, uuid) to service_role;

-- A detail-only, indexed summary. The 30-day interaction count is capped at
-- 1,000 rows so unusually active clients cannot make the detail read unbounded.
create or replace function public.read_relationship_engagement(
    p_workspace_id uuid, p_relationship_id uuid
) returns jsonb
language sql stable security invoker set search_path = public as $$
    select jsonb_build_object(
        'lastClientWhatsAppAt', r.last_whatsapp_inbound_at,
        'recentClientWhatsAppMessages', (
            select count(*) from (
                select 1 from public.client_messages m
                where m.workspace_id = r.workspace_id and m.relationship_id = r.id
                  and m.provider = 'meta_whatsapp' and m.direction = 'inbound'
                  and m.created_at >= now() - interval '30 days'
                order by m.created_at desc limit 1000
            ) recent
        ),
        'lastStaffReplyAt', (
            select m.created_at from public.client_messages m
            where m.workspace_id = r.workspace_id and m.relationship_id = r.id
              and m.direction = 'outbound' and m.sender_kind = 'staff'
            order by m.created_at desc limit 1
        ),
        'portalFirstVisitAt', p.first_accessed_at,
        'portalLastVisitAt', p.last_accessed_at,
        'portalVisitCount', coalesce(p.access_count, 0),
        'onboardingStatus', s.status,
        'onboardingLastActivityAt', s.updated_at,
        'onboardingCompletedAt', s.completed_at
    )
    from public.relationships r
    left join public.client_portal_sessions p
      on p.workspace_id = r.workspace_id and p.relationship_id = r.id
    left join lateral (
        select status, updated_at, completed_at
        from public.relationship_onboarding_sessions s
        where s.workspace_id = r.workspace_id and s.relationship_id = r.id
        order by s.created_at desc limit 1
    ) s on true
    where r.workspace_id = p_workspace_id and r.id = p_relationship_id;
$$;
revoke all on function public.read_relationship_engagement(uuid, uuid) from public, anon, authenticated;
grant execute on function public.read_relationship_engagement(uuid, uuid) to service_role;
