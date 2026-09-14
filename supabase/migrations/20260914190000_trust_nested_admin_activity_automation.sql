-- SECURITY DEFINER workflows execute nested functions as their database owner
-- (`postgres` in production), even when PostgREST entered through service_role.
-- Treat only owner-executed, unattributed automation as trusted; user-attributed
-- events still require an owner/admin workspace membership.
create or replace function public.record_workspace_admin_activity(
    p_workspace_id uuid,
    p_category text,
    p_event_key text,
    p_summary text,
    p_level text default 'info',
    p_entity_type text default null,
    p_entity_id text default null,
    p_source_href text default null,
    p_actor_user_id uuid default null,
    p_actor_kind text default 'automation',
    p_metadata jsonb default '{}'::jsonb,
    p_diagnostics jsonb default '{}'::jsonb,
    p_occurred_at timestamptz default now(),
    p_correlation_id uuid default null,
    p_causation_event_id uuid default null,
    p_idempotency_key text default null,
    p_outcome text default 'succeeded',
    p_metric_classification text default 'audit',
    p_failure_fingerprint text default null,
    p_maintenance_work_item_id uuid default null,
    p_coalesce boolean default false
)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
    v_event_id uuid;
    v_correlation_id uuid := coalesce(p_correlation_id, gen_random_uuid());
    v_metadata jsonb := public.sanitize_admin_activity_json(coalesce(p_metadata, '{}'::jsonb));
    v_diagnostics jsonb := public.sanitize_admin_activity_json(coalesce(p_diagnostics, '{}'::jsonb));
    v_is_trusted_owner_automation boolean :=
        current_user = 'postgres'
        and p_actor_kind = 'automation'
        and p_actor_user_id is null;
begin
    if current_user <> 'service_role'
       and not v_is_trusted_owner_automation
       and not public.is_workspace_member(p_workspace_id, array['owner','admin']) then
        raise exception using errcode = '42501', message = 'Admin Activity may only be recorded by a workspace Admin or trusted automation';
    end if;
    if p_workspace_id is null then raise exception 'Activity workspace is required'; end if;
    if nullif(trim(p_event_key), '') is null then raise exception 'Activity event key is required'; end if;
    if nullif(trim(p_summary), '') is null then raise exception 'Activity summary is required'; end if;
    if p_causation_event_id is not null and not exists (
        select 1 from public.workspace_admin_activity
        where id = p_causation_event_id and workspace_id = p_workspace_id
    ) then raise exception 'Causation event must belong to the same workspace'; end if;
    if p_maintenance_work_item_id is not null and not exists (
        select 1 from public.work_items
        where id = p_maintenance_work_item_id and workspace_id = p_workspace_id
    ) then raise exception 'Maintenance work must belong to the same workspace'; end if;

    insert into public.workspace_admin_activity (
        workspace_id, category, level, event_key, summary, entity_type, entity_id,
        source_href, actor_user_id, actor_kind, metadata, diagnostics, occurred_at,
        correlation_id, causation_event_id, idempotency_key, outcome,
        metric_classification, failure_fingerprint, maintenance_work_item_id
    ) values (
        p_workspace_id, p_category, p_level, trim(p_event_key), trim(p_summary),
        nullif(trim(p_entity_type), ''), nullif(trim(p_entity_id), ''), p_source_href,
        p_actor_user_id, p_actor_kind, v_metadata, v_diagnostics,
        coalesce(p_occurred_at, now()), v_correlation_id, p_causation_event_id,
        nullif(trim(p_idempotency_key), ''), p_outcome, p_metric_classification,
        nullif(trim(p_failure_fingerprint), ''), p_maintenance_work_item_id
    )
    on conflict (workspace_id, idempotency_key)
    where idempotency_key is not null
    do update set
        summary = excluded.summary,
        level = excluded.level,
        metadata = public.workspace_admin_activity.metadata || excluded.metadata,
        diagnostics = public.workspace_admin_activity.diagnostics || excluded.diagnostics,
        outcome = excluded.outcome,
        occurred_at = excluded.occurred_at,
        maintenance_work_item_id = coalesce(excluded.maintenance_work_item_id, public.workspace_admin_activity.maintenance_work_item_id)
    where p_coalesce
    returning id into v_event_id;

    if v_event_id is null and nullif(trim(p_idempotency_key), '') is not null then
        select id into v_event_id
        from public.workspace_admin_activity
        where workspace_id = p_workspace_id and idempotency_key = trim(p_idempotency_key);
    end if;
    return v_event_id;
end;
$$;

revoke all on function public.record_workspace_admin_activity(uuid, text, text, text, text, text, text, text, uuid, text, jsonb, jsonb, timestamptz, uuid, uuid, text, text, text, text, uuid, boolean) from public, anon, authenticated;
grant execute on function public.record_workspace_admin_activity(uuid, text, text, text, text, text, text, text, uuid, text, jsonb, jsonb, timestamptz, uuid, uuid, text, text, text, text, uuid, boolean) to service_role;
