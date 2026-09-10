-- Additional full-schema assertions: actual permission helpers, constraints,
-- locked relationship team triggers, encrypted message trigger and lease scope.
set local role service_role;
do $$
declare f record; a public.appointment_setting_appointments%rowtype;
 original_version timestamptz; first_result jsonb; request_id uuid:=gen_random_uuid();
 payload jsonb := '{"primaryPersonName":"Full schema fixture","businessName":"Full schema team name","primaryContactRole":"Owner","primaryPhone":"5551234567","whatsappPhone":"5551234567","communicationPrimaryProvider":"meta_whatsapp","communicationDeliveryMode":"mirror","primaryEmail":"fixture@example.invalid","description":"Synthetic"}';
 r public.relationships%rowtype; x jsonb;
 first_job uuid; second_job uuid; lease public.appointment_notification_outbox%rowtype;
begin
 select * into strict f from pg_temp.performance_rollout_fixture;
 if not public.workspace_user_can_manage_appointment_setting(f.workspace_id,f.relationship_id,f.service_id,f.setter_id)
 or public.workspace_user_can_manage_appointment_setting(f.workspace_id,f.relationship_id,f.service_id,f.outsider_id) then raise exception 'Appointment permissions did not distinguish allocation from eligibility'; end if;
 insert into public.appointment_setting_appointments(workspace_id,relationship_id,service_id,created_by,updated_by)
 values(f.workspace_id,f.relationship_id,f.service_id,f.setter_id,f.setter_id) returning * into a;
 original_version:=a.updated_at;
 first_result:=public.save_appointment_setting_draft_command(f.workspace_id,f.relationship_id,f.service_id,a.id,f.setter_id,a.updated_at,request_id,repeat('d',64),'{"contact_name":"Assigned staff draft"}');
 begin
  perform public.save_appointment_setting_draft_command(f.workspace_id,f.relationship_id,f.service_id,a.id,f.outsider_id,original_version,request_id,repeat('d',64),'{}');
  raise exception 'Unassigned eligible staff obtained a draft receipt';
 exception when insufficient_privilege then null; end;
 begin
  perform public.save_appointment_setting_draft_command(f.workspace_id,f.relationship_id,f.service_id,a.id,f.setter_id,(first_result->>'version')::timestamptz,gen_random_uuid(),repeat('e',64),'{"details":[]}');
  raise exception 'Actual appointment JSON constraint did not reject an array';
 exception when check_violation then null; end;
 select * into strict r from public.relationships where id=f.relationship_id;
 begin
  perform public.save_relationship_background_command(f.workspace_id,f.relationship_id,f.setter_id,r.updated_at,gen_random_uuid(),repeat('f',64),payload);
  raise exception 'An assigned setter edited a locked relationship background';
 exception when insufficient_privilege then null; end;
 x:=public.save_relationship_background_command(f.workspace_id,f.relationship_id,f.owner_id,r.updated_at,gen_random_uuid(),repeat('f',64),payload);
 if x->>'ok'<>'true' or not exists(select 1 from public.workspace_teams where workspace_id=f.workspace_id and relationship_id=f.relationship_id and name='Team: Full schema team name') then raise exception 'Relationship command failed the real locked delivery-team rename trigger'; end if;
 update public.workspaces set status='suspended' where id=f.workspace_id;
 begin
  perform public.save_appointment_setting_draft_command(f.workspace_id,f.relationship_id,f.service_id,a.id,f.setter_id,original_version,request_id,repeat('d',64),'{}');
  raise exception 'Suspended workspace obtained a draft replay';
 exception when insufficient_privilege then null; end;
 begin
  perform public.save_relationship_background_command(f.workspace_id,f.relationship_id,f.owner_id,(x->>'version')::timestamptz,gen_random_uuid(),repeat('f',64),payload);
  raise exception 'Suspended workspace accepted relationship background';
 exception when insufficient_privilege then null; end;
 update public.workspaces set status='active' where id=f.workspace_id;
 -- Two jobs are both synthetic. Targeted claim must never sweep another job.
 for i in 1..2 loop
  insert into public.appointment_setting_appointments(workspace_id,relationship_id,service_id,contact_name,phone,appointment_date,appointment_time,appointment_timezone)
  values(f.workspace_id,f.relationship_id,f.service_id,'Synthetic notification','5005550006','2030-01-15','14:30','UTC') returning * into a;
  x:=public.submit_appointment_setting_appointment_queued(f.workspace_id,f.relationship_id,f.service_id,a.id,f.owner_id,a.updated_at,null,'client_portal','portal:fixture','Synthetic encrypted notification');
  if not exists(select 1 from public.client_messages where id=(x->>'message_id')::uuid and body is null and body_ciphertext is not null and body_key_id is not null and raw_payload_ciphertext is not null) then raise exception 'Queued message bypassed actual encryption trigger'; end if;
  if i=1 then first_job:=(x->>'outbox_id')::uuid; else second_job:=(x->>'outbox_id')::uuid; end if;
 end loop;
 select * into strict lease from public.claim_appointment_notification_outbox(1,first_job);
 perform public.begin_appointment_notification_dispatch(first_job,lease.lease_token);
 update public.appointment_notification_outbox set lease_expires_at=now()-interval '1 second' where id=first_job;
 perform public.claim_appointment_notification_outbox(1,second_job);
 if (select status from public.appointment_notification_outbox where id=first_job)<>'dispatched' then raise exception 'A targeted claim swept an unrelated expired job'; end if;
 perform public.claim_appointment_notification_outbox(1,first_job);
 if (select status from public.appointment_notification_outbox where id=first_job)<>'uncertain' then raise exception 'Targeted claim did not expose its own uncertain dispatch'; end if;
end $$;
reset role;
-- Validate decryption only through the existing participant-authorized RPC.
select set_config('request.jwt.claims',jsonb_build_object('sub',owner_id,'role','authenticated','aal','aal2')::text,true) is not null as synthetic_session_set from performance_rollout_fixture;
set local role authenticated;
do $$
declare f record; decrypted_count integer;
begin
 select * into strict f from pg_temp.performance_rollout_fixture;
 select count(*) into decrypted_count from public.communication_client_messages(f.workspace_id,f.relationship_id,1000) where body='Synthetic encrypted notification';
 if decrypted_count<>2 then raise exception 'Actual encrypted RPC did not round-trip both synthetic notification bodies'; end if;
end $$;
reset role;
