-- Client-facing required actions and deliberately coarse service progress.
-- These records are independent of staff assignments and internal work-item
-- regeneration so a staffing change cannot reset a client's visible progress.
begin;

create table public.client_portal_actions (
    id uuid primary key default gen_random_uuid(),
    workspace_id uuid not null,
    relationship_id uuid not null,
    source_key text,
    title text not null check (length(btrim(title)) between 1 and 240),
    status text not null default 'open' check (status in ('open', 'completed')),
    sort_order integer not null default 0,
    created_by uuid references auth.users(id) on delete set null,
    completed_by uuid references auth.users(id) on delete set null,
    completed_at timestamptz,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    foreign key (workspace_id, relationship_id) references public.relationships(workspace_id, id) on delete cascade,
    unique (workspace_id, relationship_id, id),
    check ((status = 'completed') = (completed_at is not null))
);
create unique index client_portal_actions_source_unique
on public.client_portal_actions(workspace_id, relationship_id, source_key)
where source_key is not null;
create index client_portal_actions_list_idx
on public.client_portal_actions(workspace_id, relationship_id, status, sort_order, created_at, id);

create table public.client_portal_service_progress (
    id uuid primary key default gen_random_uuid(),
    workspace_id uuid not null,
    relationship_id uuid not null,
    source_key text not null,
    service_revision_id uuid,
    service_name text not null check (length(btrim(service_name)) between 1 and 200),
    status text not null default 'preparing' check (status in ('preparing', 'in_progress', 'in_review', 'live', 'complete')),
    updated_by uuid references auth.users(id) on delete set null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    foreign key (workspace_id, relationship_id) references public.relationships(workspace_id, id) on delete cascade,
    foreign key (workspace_id, service_revision_id) references public.onboarding_service_revisions(workspace_id, id),
    unique (workspace_id, relationship_id, source_key),
    unique (workspace_id, relationship_id, id)
);
create index client_portal_service_progress_list_idx
on public.client_portal_service_progress(workspace_id, relationship_id, created_at, id);

alter table public.client_portal_actions enable row level security;
alter table public.client_portal_service_progress enable row level security;
revoke all on public.client_portal_actions, public.client_portal_service_progress from public, anon, authenticated;
grant all on public.client_portal_actions, public.client_portal_service_progress to service_role;

create or replace function public.seed_client_portal_fulfilment(
    p_workspace_id uuid,
    p_relationship_id uuid,
    p_onboarding_session_id uuid
) returns void
language plpgsql security definer set search_path = public as $$
begin
    insert into public.client_portal_actions (
        workspace_id, relationship_id, source_key, title, status, sort_order
    ) values (
        p_workspace_id, p_relationship_id, 'portal-access-confirmation',
        'Message your team to confirm you received access to your portal', 'open', 0
    ) on conflict (workspace_id, relationship_id, source_key) where source_key is not null do nothing;

    -- Prefer durable service instances: repeated purchases remain separate even
    -- when they use the same service revision.
    insert into public.client_portal_service_progress (
        workspace_id, relationship_id, source_key, service_revision_id, service_name
    )
    select distinct on (instance.id)
        instance.workspace_id,
        instance.relationship_id,
        'service-instance:' || instance.id::text,
        instance.service_revision_id,
        coalesce(nullif(btrim(revision.definition->>'name'), ''), nullif(btrim(instance.service_key), ''), 'Service')
    from public.service_instance_sessions enrollment
    join public.relationship_service_instances instance
      on instance.workspace_id = enrollment.workspace_id and instance.id = enrollment.instance_id
    left join public.onboarding_service_revisions revision
      on revision.workspace_id = instance.workspace_id and revision.id = instance.service_revision_id
    where enrollment.workspace_id = p_workspace_id
      and enrollment.relationship_id = p_relationship_id
      and enrollment.session_id = p_onboarding_session_id
      and instance.disposition <> 'cancelled'
    order by instance.id
    on conflict (workspace_id, relationship_id, source_key) do nothing;

    -- Older completed sessions may predate service instances. Their frozen
    -- revision still gives the portal a stable, truthful service identity.
    insert into public.client_portal_service_progress (
        workspace_id, relationship_id, source_key, service_revision_id, service_name
    )
    select distinct on (module.source_service_revision_id)
        module.workspace_id,
        p_relationship_id,
        'service-revision:' || module.source_service_revision_id::text,
        module.source_service_revision_id,
        coalesce(nullif(btrim(revision.definition->>'name'), ''), nullif(btrim(module.title), ''), 'Service')
    from public.relationship_onboarding_session_modules module
    join public.onboarding_service_revisions revision
      on revision.workspace_id = module.workspace_id and revision.id = module.source_service_revision_id
    where module.workspace_id = p_workspace_id
      and module.session_id = p_onboarding_session_id
      and module.source_service_revision_id is not null
      and not exists (
          select 1 from public.client_portal_service_progress progress
          where progress.workspace_id = p_workspace_id
            and progress.relationship_id = p_relationship_id
            and progress.service_revision_id = module.source_service_revision_id
      )
    order by module.source_service_revision_id, module.sort_order
    on conflict (workspace_id, relationship_id, source_key) do nothing;
end;
$$;
revoke all on function public.seed_client_portal_fulfilment(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.seed_client_portal_fulfilment(uuid, uuid, uuid) to service_role;

create or replace function public.client_portal_overview(p_token text, p_workspace_id uuid)
returns jsonb
language plpgsql security invoker set search_path = public as $$
declare
    portal public.client_portal_sessions%rowtype;
    appointment_medium_count integer := 0;
    appointment_fields_count integer := 0;
    onboarding_status text;
begin
    if current_user <> 'service_role' then return null; end if;
    select * into portal from public.client_portal_sessions
    where workspace_id = p_workspace_id and session_token = lower(p_token)
      and status = 'active' and token_revoked_at is null;
    if portal.id is null then return null; end if;

    if portal.onboarding_session_id is not null then
        select session.status,
               count(*) filter (where block.kind = 'appointment_medium'),
               count(*) filter (where block.kind = 'appointment_fields')
          into onboarding_status, appointment_medium_count, appointment_fields_count
        from public.relationship_onboarding_sessions session
        left join public.relationship_onboarding_session_blocks block
          on block.workspace_id = session.workspace_id and block.session_id = session.id
        where session.workspace_id = portal.workspace_id and session.id = portal.onboarding_session_id
        group by session.status;
    end if;

    return jsonb_build_object(
        'hasFulfilment', (portal.onboarding_session_id is not null and onboarding_status = 'completed')
            or exists (select 1 from public.client_portal_actions action where action.workspace_id = portal.workspace_id and action.relationship_id = portal.relationship_id)
            or exists (select 1 from public.client_portal_service_progress progress where progress.workspace_id = portal.workspace_id and progress.relationship_id = portal.relationship_id),
        'leadMode', case
            when portal.onboarding_session_id is null then 'ghl'
            when appointment_medium_count > 0 and appointment_fields_count > 0 then 'appointments'
            else 'empty'
        end,
        'actions', coalesce((
            select jsonb_agg(jsonb_build_object(
                'id', action.id, 'title', action.title, 'status', action.status,
                'completedAt', action.completed_at, 'updatedAt', action.updated_at
            ) order by (action.status = 'completed'), action.sort_order, action.created_at, action.id)
            from (select * from public.client_portal_actions
                  where workspace_id = portal.workspace_id and relationship_id = portal.relationship_id
                  order by (status = 'completed'), sort_order, created_at, id limit 50) action
        ), '[]'::jsonb),
        'progress', coalesce((
            select jsonb_agg(jsonb_build_object(
                'id', progress.id, 'serviceName', progress.service_name,
                'status', progress.status, 'updatedAt', progress.updated_at
            ) order by progress.created_at, progress.id)
            from (select * from public.client_portal_service_progress
                  where workspace_id = portal.workspace_id and relationship_id = portal.relationship_id
                  order by created_at, id limit 50) progress
        ), '[]'::jsonb)
    );
end;
$$;
revoke all on function public.client_portal_overview(text, uuid) from public, anon, authenticated;
grant execute on function public.client_portal_overview(text, uuid) to service_role;

-- Extend the current handoff transaction without changing its link deduplication
-- or durable outbox semantics.
create or replace function public.provision_client_portal_after_onboarding()
returns trigger
language plpgsql security invoker
set search_path = public, extensions
as $$
declare
    portal_session public.client_portal_sessions%rowtype;
    previous_portal public.client_portal_sessions%rowtype;
    relationship_record public.relationships%rowtype;
    delivery_outbox_id uuid;
    already_sent boolean := false;
begin
    if new.status <> 'completed' or old.status = 'completed' then return new; end if;

    select * into previous_portal from public.client_portal_sessions
    where workspace_id = new.workspace_id and relationship_id = new.relationship_id for update;
    if previous_portal.id is not null and previous_portal.status = 'active' and previous_portal.token_revoked_at is null then
        select exists (select 1 from public.onboarding_delivery_outbox delivery
            where delivery.workspace_id = new.workspace_id and delivery.portal_session_id = previous_portal.id
              and delivery.kind = 'client_portal_link' and delivery.status = 'sent') into already_sent;
    end if;

    insert into public.client_portal_sessions (workspace_id, relationship_id, onboarding_session_id, session_token)
    values (new.workspace_id, new.relationship_id, new.id, encode(extensions.gen_random_bytes(32), 'hex'))
    on conflict (workspace_id, relationship_id) do update set
        onboarding_session_id = excluded.onboarding_session_id,
        session_token = case when public.client_portal_sessions.status = 'revoked' then excluded.session_token else public.client_portal_sessions.session_token end,
        status = 'active', token_revoked_at = null, updated_at = now()
    returning * into portal_session;

    perform public.seed_client_portal_fulfilment(new.workspace_id, new.relationship_id, new.id);
    if already_sent then return new; end if;

    select * into relationship_record from public.relationships
    where workspace_id = new.workspace_id and id = new.relationship_id;
    insert into public.onboarding_delivery_outbox (
        workspace_id, relationship_id, session_id, portal_session_id,
        correlation_id, kind, destination, payload, idempotency_key
    ) values (
        new.workspace_id, new.relationship_id, new.id, portal_session.id,
        coalesce(new.source_sale_id, new.id), 'client_portal_link',
        coalesce(nullif(trim(relationship_record.primary_phone), ''), 'relationship:' || new.relationship_id::text),
        jsonb_build_object('client_id', relationship_record.client_id, 'message', 'Your client portal is ready.'),
        'client-portal-link:' || new.id::text
    ) on conflict (workspace_id, idempotency_key) do nothing returning id into delivery_outbox_id;

    if delivery_outbox_id is not null then
        perform public.record_workspace_admin_activity(
            new.workspace_id, 'communications', 'client_portal.link.queued', 'Client portal link queued for delivery',
            p_entity_type => 'client_portal_session', p_entity_id => portal_session.id::text,
            p_actor_kind => 'automation', p_correlation_id => coalesce(new.source_sale_id, new.id),
            p_idempotency_key => 'client_portal.link.queued:' || delivery_outbox_id::text,
            p_metadata => jsonb_build_object('outbox_id', delivery_outbox_id, 'relationship_id', new.relationship_id,
                'onboarding_session_id', new.id, 'portal_session_id', portal_session.id)
        );
    end if;
    return new;
end;
$$;

-- Test clients with an already completed onboarding session are immediately
-- useful for QA. Legacy/no-onboarding portals (including Bruce) are untouched.
select public.seed_client_portal_fulfilment(session.workspace_id, session.relationship_id, session.id)
from public.relationship_onboarding_sessions session
join public.client_portal_sessions portal
  on portal.workspace_id = session.workspace_id and portal.relationship_id = session.relationship_id
 and portal.onboarding_session_id = session.id
join public.relationships relationship
  on relationship.workspace_id = session.workspace_id and relationship.id = session.relationship_id
where session.status = 'completed' and session.archived_at is null
  and portal.status = 'active' and portal.token_revoked_at is null
  and relationship.source_metadata->>'is_test' = 'true';

notify pgrst, 'reload schema';
commit;
