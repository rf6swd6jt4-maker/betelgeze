-- Isolated database only. No provider calls occur; the transaction rolls back.
begin;
set local role service_role;
do $$
declare
    scope record; actor uuid; appointment public.appointment_setting_appointments%rowtype;
    receipt jsonb; replay jsonb; job public.appointment_notification_outbox%rowtype;
    reclaimed public.appointment_notification_outbox%rowtype; prior_token uuid;
begin
    if has_table_privilege('authenticated', 'public.appointment_notification_outbox', 'select')
       or has_function_privilege('authenticated', 'public.claim_appointment_notification_outbox(integer,uuid)', 'execute')
       or has_function_privilege('anon', 'public.begin_appointment_notification_dispatch(uuid,uuid)', 'execute') then
        raise exception 'Notification outbox is not private';
    end if;
    select rs.workspace_id, rs.relationship_id, rs.service_id into strict scope
    from public.relationship_services rs join public.relationships r on r.workspace_id=rs.workspace_id and r.id=rs.relationship_id
    where r.lifecycle_phase='retention' and r.status<>'archived' and public.appointment_setting_service_is_available(rs.workspace_id,rs.relationship_id,rs.service_id) limit 1;
    select user_id into strict actor from public.workspace_memberships where workspace_id=scope.workspace_id and role='owner' limit 1;
    insert into public.appointment_setting_appointments(workspace_id,relationship_id,service_id,contact_name,phone,appointment_date,appointment_time,appointment_timezone,meeting_medium,details,created_by,updated_by)
    values(scope.workspace_id,scope.relationship_id,scope.service_id,'Outbox fixture','(500) 555-0006','2030-01-15','14:30','UTC','phone','{}',actor,actor) returning * into appointment;
    receipt := public.submit_appointment_setting_appointment_queued(scope.workspace_id,scope.relationship_id,scope.service_id,appointment.id,actor,appointment.updated_at,null,'twilio_sms','+15005550006','Fixture only');
    replay := public.submit_appointment_setting_appointment_queued(scope.workspace_id,scope.relationship_id,scope.service_id,appointment.id,actor,appointment.updated_at,null,'twilio_sms','+15005550006','Fixture only');
    if receipt->>'outbox_id' is null or receipt->>'outbox_id' <> replay->>'outbox_id'
       or receipt->>'message_id' <> replay->>'message_id'
       or (select count(*) from public.appointment_notification_outbox where appointment_id=appointment.id) <> 1 then raise exception 'Submission must atomically enqueue exactly one notification'; end if;
    select * into strict job from public.claim_appointment_notification_outbox(1,(receipt->>'outbox_id')::uuid);
    if exists(select 1 from public.claim_appointment_notification_outbox(1,job.id)) then raise exception 'A second worker claimed a live lease'; end if;
    prior_token := job.lease_token;
    update public.appointment_notification_outbox set lease_expires_at=now()-interval '1 second' where id=job.id;
    select * into strict reclaimed from public.claim_appointment_notification_outbox(1,job.id);
    if reclaimed.lease_token=prior_token or public.begin_appointment_notification_dispatch(job.id,prior_token) then raise exception 'An expired preparation lease still owns dispatch'; end if;
    if not public.begin_appointment_notification_dispatch(job.id,reclaimed.lease_token) then raise exception 'Current lease could not begin dispatch'; end if;
    if public.begin_appointment_notification_dispatch(job.id,reclaimed.lease_token) then raise exception 'The same lease began dispatch twice'; end if;
    -- A lost dispatch response must become uncertain based on durable state.
    if not public.finish_appointment_notification_outbox(job.id,reclaimed.lease_token,null,'Fixture lost acknowledgement') then raise exception 'Unknown outcome could not be recorded'; end if;
    if (select status from public.appointment_notification_outbox where id=job.id)<>'uncertain'
       or (select status from public.client_messages where id=job.message_id)<>'send_uncertain'
       or exists(select 1 from public.claim_appointment_notification_outbox(1,job.id)) then raise exception 'Unknown dispatch became an automatic duplicate send'; end if;
    -- Simulate an interrupted worker without its catch/finally running.
    update public.appointment_notification_outbox set status='dispatched',lease_token=gen_random_uuid(),lease_expires_at=now()-interval '1 second' where id=job.id;
    update public.client_messages set status='sending' where id=job.message_id;
    perform public.claim_appointment_notification_outbox(1,job.id);
    if (select status from public.appointment_notification_outbox where id=job.id)<>'uncertain'
       or (select status from public.client_messages where id=job.message_id)<>'send_uncertain' then raise exception 'Expired dispatch was not exposed for review'; end if;
    -- Definite pre-dispatch failures remain manually retryable in Comms.
    update public.appointment_notification_outbox set status='queued',lease_token=null,lease_expires_at=null where id=job.id;
    select * into strict job from public.claim_appointment_notification_outbox(1,job.id);
    perform public.finish_appointment_notification_outbox(job.id,job.lease_token,null,'Fixture revoked destination');
    if (select status from public.client_messages where id=job.message_id)<>'send_failed' then raise exception 'Definite preparation failure is not actionable'; end if;
end;
$$;
rollback;
select true as appointment_notification_outbox_checks_passed_and_rolled_back;
