begin;

-- Service revisions are immutable published snapshots. Reordering therefore
-- appends a reviewed successor for every service instead of patching history.
create or replace function public.reorder_onboarding_services(
    p_workspace_id uuid,
    p_actor_user_id uuid,
    p_service_ids uuid[]
) returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
    v_service_count integer;
    v_service record;
    v_definition jsonb;
    v_revision_id uuid;
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

    -- Serialize order changes with service edits. A concurrent insert or edit
    -- must finish before the complete-list check and revision append proceed.
    perform 1
    from public.onboarding_services
    where workspace_id = p_workspace_id
    order by id
    for update;

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

    for v_service in
        select requested.ordinality::integer as requested_position, revision.*
        from unnest(p_service_ids) with ordinality as requested(service_id, ordinality)
        left join lateral (
            select current_revision.*
            from public.onboarding_service_revisions current_revision
            where current_revision.workspace_id = p_workspace_id
              and current_revision.service_id = requested.service_id
            order by current_revision.revision_number desc
            limit 1
        ) revision on true
        order by requested.ordinality
    loop
        if v_service.id is null then
            raise exception 'Every service must have a current revision before it can be reordered';
        end if;

        v_definition := coalesce(v_service.definition, '{}'::jsonb) || jsonb_build_object(
            'name', v_service.name,
            'description', v_service.description,
            'defaultPriceCents', v_service.default_price_cents,
            'currency', v_service.currency,
            'defaultAssigneeUserId', v_service.default_assignee_user_id,
            'isTest', v_service.is_test,
            'displayPriority', v_service_count - v_service.requested_position + 1,
            'moduleIds', coalesce((
                select jsonb_agg(assignment.module_id order by assignment.sort_order)
                from public.onboarding_service_revision_modules assignment
                where assignment.workspace_id = p_workspace_id
                  and assignment.service_revision_id = v_service.id
            ), '[]'::jsonb)
        );

        insert into public.onboarding_service_revisions (
            workspace_id,
            service_id,
            revision_number,
            name,
            description,
            default_price_cents,
            currency,
            default_assignee_user_id,
            is_test,
            display_priority,
            fulfilment_definition_revision_id,
            definition,
            created_by
        ) values (
            p_workspace_id,
            v_service.service_id,
            v_service.revision_number + 1,
            v_service.name,
            v_service.description,
            v_service.default_price_cents,
            v_service.currency,
            v_service.default_assignee_user_id,
            v_service.is_test,
            v_service_count - v_service.requested_position + 1,
            v_service.fulfilment_definition_revision_id,
            v_definition,
            p_actor_user_id
        ) returning id into v_revision_id;

        insert into public.onboarding_service_revision_modules (
            workspace_id,
            service_revision_id,
            module_id,
            sort_order
        )
        select
            p_workspace_id,
            v_revision_id,
            assignment.module_id,
            assignment.sort_order
        from public.onboarding_service_revision_modules assignment
        where assignment.workspace_id = p_workspace_id
          and assignment.service_revision_id = v_service.id;
    end loop;

    perform public.record_workspace_admin_activity(
        p_workspace_id,
        'services',
        'services.order.changed',
        'Service onboarding order changed',
        p_entity_type => 'onboarding_service_order',
        p_entity_id => p_workspace_id::text,
        p_actor_user_id => p_actor_user_id,
        p_actor_kind => 'staff',
        p_metadata => jsonb_build_object('service_count', v_service_count, 'save_path', 'immutable_revision_append')
    );

    return jsonb_build_object('service_count', v_service_count);
end;
$$;

revoke all on function public.reorder_onboarding_services(uuid, uuid, uuid[]) from public, anon, authenticated;
grant execute on function public.reorder_onboarding_services(uuid, uuid, uuid[]) to service_role;

commit;
