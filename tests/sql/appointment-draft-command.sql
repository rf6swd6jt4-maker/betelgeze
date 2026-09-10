-- Run in an isolated fixture database with the draft command migration. These
-- checks are rollback-only and never invoke a messaging provider.
begin;
set local role service_role;
do $$
declare
    scope record;
    actor uuid;
    appointment public.appointment_setting_appointments%rowtype;
    first_result jsonb;
    replay_result jsonb;
    request_id uuid := gen_random_uuid();
    request_hash text := repeat('a', 64);
    old_version timestamptz;
begin
    if has_table_privilege('authenticated', 'public.appointment_draft_command_receipts', 'select')
       or has_function_privilege('authenticated', 'public.save_appointment_setting_draft_command(uuid,uuid,uuid,uuid,uuid,timestamptz,uuid,text,jsonb)', 'execute')
       or has_function_privilege('anon', 'public.save_appointment_setting_draft_command(uuid,uuid,uuid,uuid,uuid,timestamptz,uuid,text,jsonb)', 'execute') then
        raise exception 'Draft command and receipts must remain service-role only';
    end if;
    select rs.workspace_id, rs.relationship_id, rs.service_id into strict scope
    from public.relationship_services rs
    join public.relationships r on r.workspace_id = rs.workspace_id and r.id = rs.relationship_id
    where r.lifecycle_phase = 'retention' and r.status <> 'archived'
      and public.appointment_setting_service_is_available(rs.workspace_id, rs.relationship_id, rs.service_id)
    limit 1;
    select user_id into strict actor from public.workspace_memberships where workspace_id = scope.workspace_id and role = 'owner' limit 1;
    insert into public.appointment_setting_appointments(workspace_id, relationship_id, service_id, meeting_medium, appointment_timezone, created_by, updated_by)
    values(scope.workspace_id, scope.relationship_id, scope.service_id, 'phone', 'UTC', actor, actor) returning * into appointment;
    old_version := appointment.updated_at;
    first_result := public.save_appointment_setting_draft_command(scope.workspace_id, scope.relationship_id, scope.service_id, appointment.id, actor, old_version, request_id, request_hash, '{"contact_name":"Fixture first edit"}');
    replay_result := public.save_appointment_setting_draft_command(scope.workspace_id, scope.relationship_id, scope.service_id, appointment.id, actor, old_version, request_id, request_hash, '{}');
    if (first_result->>'replayed')::boolean or not (replay_result->>'replayed')::boolean
       or first_result->>'version' <> replay_result->>'version'
       or (first_result->>'version')::timestamptz <= old_version
       or replay_result->'appointment'->>'contact_name' <> 'Fixture first edit' then
        raise exception 'Draft save/replay did not preserve one commit';
    end if;
    begin
        perform public.save_appointment_setting_draft_command(scope.workspace_id, scope.relationship_id, scope.service_id, appointment.id, actor, old_version, request_id, repeat('b', 64), '{"contact_name":"Hijacked request"}');
        raise exception 'A changed payload reused a command identity';
    exception when invalid_parameter_value then null;
    end;
    begin
        perform public.save_appointment_setting_draft_command(scope.workspace_id, scope.relationship_id, scope.service_id, appointment.id, actor, old_version, gen_random_uuid(), request_hash, '{"contact_name":"Stale edit"}');
        raise exception 'A stale edit was accepted';
    exception when serialization_failure then null;
    end;
    begin
        perform public.save_appointment_setting_draft_command(scope.workspace_id, scope.relationship_id, scope.service_id, appointment.id, gen_random_uuid(), old_version, request_id, request_hash, '{}');
        raise exception 'An unauthorized actor obtained a replay';
    exception when insufficient_privilege then null;
    end;
    begin
        perform public.save_appointment_setting_draft_command(scope.workspace_id, scope.relationship_id, scope.service_id, appointment.id, actor, (first_result->>'version')::timestamptz, gen_random_uuid(), request_hash, '{"workflow_status":"submitted"}');
        raise exception 'Draft save changed workflow';
    exception when invalid_parameter_value then null;
    end;
    update public.appointment_setting_appointments set contact_name = 'Concurrent later edit' where id = appointment.id;
    replay_result := public.save_appointment_setting_draft_command(scope.workspace_id, scope.relationship_id, scope.service_id, appointment.id, actor, old_version, request_id, request_hash, '{}');
    if replay_result->'appointment'->>'contact_name' <> 'Concurrent later edit'
       or replay_result->>'version' <> first_result->>'version'
       or (replay_result->'appointment'->>'updated_at')::timestamptz <= (replay_result->>'version')::timestamptz then
        raise exception 'Replay must return current data with the original committed version';
    end if;
    if (select count(*) from public.appointment_draft_command_receipts where appointment_id = appointment.id) <> 1 then raise exception 'Expected one durable receipt'; end if;
    delete from public.appointment_setting_appointments where id = appointment.id;
    if exists(select 1 from public.appointment_draft_command_receipts where appointment_id = appointment.id) then raise exception 'Removed appointment retained its receipt'; end if;
end;
$$;
rollback;
select true as appointment_draft_command_checks_passed_and_rolled_back;
