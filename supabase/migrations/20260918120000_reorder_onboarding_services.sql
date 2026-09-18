begin;

create or replace function public.reorder_onboarding_services(
    p_workspace_id uuid,
    p_actor_user_id uuid,
    p_service_ids uuid[]
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_service_count integer;
    v_updated_count integer;
begin
    perform public.require_onboarding_admin_actor(p_workspace_id, p_actor_user_id);

    if p_service_ids is null or cardinality(p_service_ids) = 0 then
        raise exception 'Choose a valid service order';
    end if;
    if cardinality(p_service_ids) <> (
        select count(distinct requested.service_id)
        from unnest(p_service_ids) as requested(service_id)
    ) then
        raise exception 'Choose each service exactly once';
    end if;

    select count(*) into v_service_count
    from public.onboarding_services
    where workspace_id = p_workspace_id;

    if v_service_count <> cardinality(p_service_ids)
       or exists (
           select 1
           from unnest(p_service_ids) as requested(service_id)
           left join public.onboarding_services service
             on service.workspace_id = p_workspace_id and service.id = requested.service_id
           where service.id is null
       ) then
        raise exception 'The service list changed. Refresh and try again';
    end if;

    perform 1
    from public.onboarding_services
    where workspace_id = p_workspace_id
    order by id
    for update;

    with requested_order as (
        select service_id, ordinality::integer
        from unnest(p_service_ids) with ordinality as requested(service_id, ordinality)
    ), current_revisions as (
        select distinct on (revision.service_id)
            revision.id,
            revision.service_id
        from public.onboarding_service_revisions revision
        join requested_order requested on requested.service_id = revision.service_id
        where revision.workspace_id = p_workspace_id
        order by revision.service_id, revision.revision_number desc
    )
    update public.onboarding_service_revisions revision
    set display_priority = v_service_count - requested.ordinality + 1,
        definition = jsonb_set(
            coalesce(revision.definition, '{}'::jsonb),
            '{displayPriority}',
            to_jsonb(v_service_count - requested.ordinality + 1),
            true
        )
    from requested_order requested
    join current_revisions current on current.service_id = requested.service_id
    where revision.id = current.id
      and revision.workspace_id = p_workspace_id;

    get diagnostics v_updated_count = row_count;
    if v_updated_count <> v_service_count then
        raise exception 'Every service must have a current revision before it can be reordered';
    end if;

    perform public.record_workspace_admin_activity(
        p_workspace_id,
        'services',
        'services.order.changed',
        'Service onboarding order changed',
        p_entity_type => 'onboarding_service_order',
        p_entity_id => p_workspace_id::text,
        p_actor_user_id => p_actor_user_id,
        p_actor_kind => 'staff',
        p_metadata => jsonb_build_object('service_count', v_service_count)
    );

    return jsonb_build_object('service_count', v_service_count);
end;
$$;

revoke all on function public.reorder_onboarding_services(uuid, uuid, uuid[]) from public, anon, authenticated;
grant execute on function public.reorder_onboarding_services(uuid, uuid, uuid[]) to service_role;

commit;
