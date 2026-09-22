-- New sales are represented by relationship_service_instances. Appointment
-- onboarding must resolve the service enrolled in this session before falling
-- back to the legacy relationship_services table.

do $$
declare
    v_definition text;
    v_updated text;
    v_old_lookup text := $lookup$
    select relationship_service.service_id into v_service_id
    from public.relationship_services relationship_service
    join public.onboarding_service_revisions revision on revision.workspace_id = relationship_service.workspace_id and revision.id = relationship_service.service_revision_id
    where relationship_service.workspace_id = v_block.workspace_id
      and relationship_service.relationship_id = v_session.relationship_id
      and coalesce(revision.definition->>'templateId', revision.definition->>'template_id') = 'appointment-setting'
    order by relationship_service.created_at
    limit 1;$lookup$;
    v_new_lookup text := $lookup$
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
    limit 1;$lookup$;
begin
    select pg_get_functiondef('public.configure_appointment_setting_onboarding_block(text,uuid,jsonb)'::regprocedure)
    into v_definition;
    v_updated := replace(v_definition, v_old_lookup, v_new_lookup);
    if v_updated = v_definition then
        raise exception 'Expected legacy Appointment service lookup was not found';
    end if;
    execute v_updated;
end;
$$;
