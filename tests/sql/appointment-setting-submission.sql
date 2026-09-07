-- Run against a database with the Appointment Setting migration and at least
-- one eligible Retention relationship. Nothing persists or sends externally.
begin;
set local role service_role;

do $$
declare
    config public.relationship_appointment_setting_configs%rowtype;
    scope record;
    appointment public.appointment_setting_appointments%rowtype;
    actor uuid;
    field jsonb;
    v_details jsonb := '{}'::jsonb;
    first_result jsonb;
    repeated_result jsonb;
    affected integer;
begin
    if has_function_privilege('authenticated', 'public.submit_appointment_setting_appointment(uuid,uuid,uuid,uuid,uuid,timestamptz,uuid,text,text,text)', 'execute')
       or has_function_privilege('anon', 'public.submit_appointment_setting_appointment(uuid,uuid,uuid,uuid,uuid,timestamptz,uuid,text,text,text)', 'execute') then
        raise exception 'Submission RPC must remain service-role only';
    end if;
    select rs.workspace_id,rs.relationship_id,rs.service_id into strict scope
    from public.relationship_services rs
    join public.relationships r on r.workspace_id=rs.workspace_id and r.id=rs.relationship_id
    where r.lifecycle_phase='retention' and r.status<>'archived'
      and public.appointment_setting_service_is_available(rs.workspace_id,rs.relationship_id,rs.service_id)
    limit 1;
    insert into public.relationship_appointment_setting_configs(workspace_id,relationship_id,service_id)
    values(scope.workspace_id,scope.relationship_id,scope.service_id) on conflict do nothing;
    select c.* into strict config from public.relationship_appointment_setting_configs c
    where c.workspace_id=scope.workspace_id and c.relationship_id=scope.relationship_id and c.service_id=scope.service_id;
    select user_id into strict actor from public.workspace_memberships
    where workspace_id=config.workspace_id and role='owner' limit 1;

    insert into public.appointment_setting_appointments(workspace_id,relationship_id,service_id,meeting_medium,appointment_timezone,created_by,updated_by)
    values(config.workspace_id,config.relationship_id,config.service_id,config.mediums[1],'America/Chicago',actor,actor)
    returning * into appointment;
    if appointment.workflow_status <> 'draft' or appointment.contact_name is not null then
        raise exception 'Incomplete draft creation failed';
    end if;
    begin
        perform public.submit_appointment_setting_appointment(config.workspace_id,config.relationship_id,config.service_id,appointment.id,actor,appointment.updated_at,null,'twilio_sms','+15005550006','Rollback-only QA');
        raise exception 'Incomplete draft was submitted';
    exception when check_violation then null;
    end;
    if exists(select 1 from public.client_messages where client_request_id=appointment.id) then
        raise exception 'Invalid submission left a notification behind';
    end if;

    for field in select value from jsonb_array_elements(config.requested_fields) loop
        if field->>'key' <> 'phone' then
            v_details := v_details || jsonb_build_object(field->>'key', case when field->>'key'='email' then 'qa@example.invalid' else 'Rollback-only QA' end);
        end if;
    end loop;
    update public.appointment_setting_appointments
    set contact_name='Rollback-only QA', phone='(500) 555-0006', appointment_date='2030-01-15', appointment_time='14:30',
        meeting_link=case when meeting_medium='phone' then null else 'https://example.invalid/qa' end,
        details=v_details
    where id=appointment.id returning * into appointment;

    begin
        perform public.submit_appointment_setting_appointment(config.workspace_id,config.relationship_id,config.service_id,appointment.id,actor,appointment.updated_at - interval '1 second',null,'twilio_sms','+15005550006','Rollback-only QA');
        raise exception 'A stale version was accepted';
    exception when serialization_failure then null;
    end;
    begin
        perform public.submit_appointment_setting_appointment(config.workspace_id,config.relationship_id,config.service_id,appointment.id,gen_random_uuid(),appointment.updated_at,null,'twilio_sms','+15005550006','Rollback-only QA');
        raise exception 'An unauthorized actor was accepted';
    exception when insufficient_privilege then null;
    end;
    begin
        update public.appointment_setting_appointments set appointment_date='2030-03-10',appointment_time='02:30' where id=appointment.id;
        perform public.submit_appointment_setting_appointment(config.workspace_id,config.relationship_id,config.service_id,appointment.id,actor,appointment.updated_at,null,'twilio_sms','+15005550006','Rollback-only QA');
        raise exception 'A nonexistent daylight-saving time was accepted';
    exception when check_violation then null;
    end;

    first_result := public.submit_appointment_setting_appointment(config.workspace_id,config.relationship_id,config.service_id,appointment.id,actor,appointment.updated_at,null,'twilio_sms','+15005550006','Rollback-only QA');
    repeated_result := public.submit_appointment_setting_appointment(config.workspace_id,config.relationship_id,config.service_id,appointment.id,actor,appointment.updated_at,null,'twilio_sms','+15005550006','Rollback-only QA');
    if (first_result->>'already_submitted')::boolean or not (repeated_result->>'already_submitted')::boolean
       or first_result->>'message_id' <> repeated_result->>'message_id'
       or first_result->'appointment'->>'workflow_status' <> 'submitted'
       or (first_result->'appointment'->>'appointment_at')::timestamptz <> '2030-01-15 20:30:00+00'::timestamptz then
        raise exception 'Submission idempotency or timezone conversion failed';
    end if;
    if (select count(*) from public.client_messages where client_request_id=appointment.id) <> 1 then
        raise exception 'Expected exactly one notification';
    end if;
    if not exists(select 1 from public.client_messages where client_request_id=appointment.id and body_ciphertext is not null and automation_kind='appointment_submitted') then
        raise exception 'Notification must use encrypted Communications storage';
    end if;
    update public.appointment_setting_appointments set contact_name='Must not change' where id=appointment.id and workflow_status='draft';
    get diagnostics affected = row_count;
    if affected <> 0 then raise exception 'Submitted appointment was editable through the draft path'; end if;
    delete from public.appointment_setting_appointments where id=appointment.id and workflow_status='draft';
    get diagnostics affected = row_count;
    if affected <> 0 then raise exception 'Submitted appointment was deletable through the draft path'; end if;
end;
$$;

rollback;
select true as appointment_submission_checks_passed_and_rolled_back;
