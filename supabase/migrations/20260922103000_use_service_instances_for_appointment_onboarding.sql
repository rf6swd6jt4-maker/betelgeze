-- New sales are represented by relationship_service_instances. Appointment
-- onboarding must resolve the service enrolled in this session before falling
-- back to the legacy relationship_services table.

create or replace function public.configure_appointment_setting_onboarding_block(
    p_token text,
    p_session_block_id uuid,
    p_configuration jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
    v_block public.relationship_onboarding_session_blocks%rowtype;
    v_session public.relationship_onboarding_sessions%rowtype;
    v_service_id uuid;
    v_item jsonb;
    v_key text;
    v_seen text[] := '{}'::text[];
    v_values text[] := '{}'::text[];
    v_requirement_kind text;
begin
    if current_user <> 'service_role' then raise exception using errcode = '42501', message = 'Trusted onboarding runtime required'; end if;
    select block.* into v_block
    from public.relationship_onboarding_session_blocks block
    join public.relationship_onboarding_sessions session on session.id = block.session_id and session.workspace_id = block.workspace_id
    where block.id = p_session_block_id and session.session_token = p_token and session.status = 'active'
    for update of block;
    if v_block.id is null or v_block.kind not in ('appointment_medium', 'appointment_fields') then raise exception using errcode = 'P0001', message = 'Appointment Setting onboarding block not found.'; end if;
    select session.* into v_session from public.relationship_onboarding_sessions session where session.workspace_id = v_block.workspace_id and session.id = v_block.session_id;
    if exists (select 1 from public.work_items item where item.workspace_id = v_block.workspace_id and item.native_kind = 'onboarding_step' and item.metadata->>'session_step_id' = v_block.session_step_id::text and item.status = 'done') then raise exception using errcode = 'P0001', message = 'Submitted steps are locked.'; end if;

    select candidate.service_id into v_service_id
    from (
        select instance.service_id, 0 as source_priority, instance.created_at
        from public.relationship_service_instances instance
        join public.service_instance_sessions enrollment
          on enrollment.workspace_id = instance.workspace_id
         and enrollment.relationship_id = instance.relationship_id
         and enrollment.instance_id = instance.id
         and enrollment.session_id = v_session.id
         and enrollment.enrollment = 'active'
        join public.onboarding_service_revisions revision
          on revision.workspace_id = instance.workspace_id
         and revision.id = instance.service_revision_id
        where instance.workspace_id = v_block.workspace_id
          and instance.relationship_id = v_session.relationship_id
          and instance.disposition = 'active'
          and coalesce(revision.definition->>'templateId', revision.definition->>'template_id') = 'appointment-setting'
        union all
        select instance.service_id, 1 as source_priority, instance.created_at
        from public.relationship_service_instances instance
        join public.onboarding_service_revisions revision
          on revision.workspace_id = instance.workspace_id
         and revision.id = instance.service_revision_id
        where instance.workspace_id = v_block.workspace_id
          and instance.relationship_id = v_session.relationship_id
          and instance.disposition = 'active'
          and instance.stage in ('onboarding', 'setup', 'maintenance', 'completed')
          and coalesce(revision.definition->>'templateId', revision.definition->>'template_id') = 'appointment-setting'
        union all
        select relationship_service.service_id, 2 as source_priority, relationship_service.created_at
        from public.relationship_services relationship_service
        join public.onboarding_service_revisions revision
          on revision.workspace_id = relationship_service.workspace_id
         and revision.id = relationship_service.service_revision_id
        where relationship_service.workspace_id = v_block.workspace_id
          and relationship_service.relationship_id = v_session.relationship_id
          and coalesce(revision.definition->>'templateId', revision.definition->>'template_id') = 'appointment-setting'
    ) candidate
    where candidate.service_id is not null
    order by candidate.source_priority, candidate.created_at
    limit 1;
    if v_service_id is null then raise exception using errcode = 'P0001', message = 'This relationship does not include Appointment Setting.'; end if;

    if v_block.kind = 'appointment_medium' then
        if jsonb_typeof(p_configuration->'mediums') <> 'array' or jsonb_array_length(p_configuration->'mediums') not between 1 and 3 then raise exception using errcode = '22023', message = 'Choose at least one appointment option.'; end if;
        for v_key in select value from jsonb_array_elements_text(p_configuration->'mediums') loop
            if v_key not in ('phone', 'google_meet', 'zoom') or not coalesce(v_block.definition->'options' ? v_key, false) or v_key = any(v_seen) then raise exception using errcode = '22023', message = 'Choose valid appointment options.'; end if;
            v_seen := array_append(v_seen, v_key); v_values := array_append(v_values, v_key);
        end loop;
        insert into public.relationship_appointment_setting_configs (workspace_id, relationship_id, service_id, mediums, source_medium_block_id)
        values (v_block.workspace_id, v_session.relationship_id, v_service_id, v_values, v_block.id)
        on conflict (workspace_id, relationship_id, service_id) do update set mediums = excluded.mediums, source_medium_block_id = excluded.source_medium_block_id;
        v_requirement_kind := 'appointment_medium_configured';
    else
        if jsonb_typeof(p_configuration->'fields') <> 'array' or jsonb_array_length(p_configuration->'fields') > jsonb_array_length(v_block.definition->'options') then raise exception using errcode = '22023', message = 'Choose fewer extra fields.'; end if;
        for v_item in select value from jsonb_array_elements(p_configuration->'fields') loop
            v_key := v_item->>'key';
            if jsonb_typeof(v_item) <> 'object' or v_key is null or v_key not in ('phone', 'email', 'service', 'address', 'notes') or not coalesce(v_block.definition->'options' ? v_key, false) or v_key = any(v_seen) or jsonb_typeof(v_item->'required') <> 'boolean' then raise exception using errcode = '22023', message = 'Choose valid appointment fields.'; end if;
            v_seen := array_append(v_seen, v_key);
        end loop;
        insert into public.relationship_appointment_setting_configs (workspace_id, relationship_id, service_id, requested_fields, source_fields_block_id)
        values (v_block.workspace_id, v_session.relationship_id, v_service_id, p_configuration->'fields', v_block.id)
        on conflict (workspace_id, relationship_id, service_id) do update set requested_fields = excluded.requested_fields, source_fields_block_id = excluded.source_fields_block_id;
        v_requirement_kind := 'appointment_fields_configured';
    end if;

    insert into public.onboarding_block_requirements (workspace_id, session_id, session_step_id, session_block_id, requirement_kind, response, satisfied_at)
    values (v_block.workspace_id, v_block.session_id, v_block.session_step_id, v_block.id, v_requirement_kind, p_configuration, now())
    on conflict (session_block_id) do update set requirement_kind = excluded.requirement_kind, response = excluded.response, satisfied_at = now();
    return jsonb_build_object('session_block_id', v_block.id, 'satisfied', true, 'response', p_configuration);
end;
$$;
