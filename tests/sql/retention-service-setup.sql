-- All fixtures, internal groups and confirmation records roll back. No provider calls.
begin;
select set_config('request.jwt.claim.role','service_role',true);
do $$
declare w uuid:=gen_random_uuid(); owner_id uuid:=gen_random_uuid(); setter uuid:=gen_random_uuid(); other_setter uuid:=gen_random_uuid();
 service_a uuid:=gen_random_uuid(); service_b uuid:=gen_random_uuid(); rev_a uuid:=gen_random_uuid(); rev_b uuid:=gen_random_uuid();
 rel uuid:=gen_random_uuid(); bad_rel uuid:=gen_random_uuid(); auto_rel uuid:=gen_random_uuid(); auto_result jsonb; details jsonb; selection jsonb; result jsonb; rejected boolean; team uuid; sale_snapshot jsonb;
begin
 insert into auth.users(id,email) values(owner_id,'retention-owner-'||owner_id||'@example.invalid'),(setter,'retention-setter-'||setter||'@example.invalid'),(other_setter,'retention-other-'||other_setter||'@example.invalid');
 insert into public.workspaces(id,name,slug) values(w,'Retention rollback QA','retention-'||w);
 insert into public.workspace_memberships(workspace_id,user_id,role) values(w,owner_id,'owner'),(w,setter,'staff'),(w,other_setter,'staff');
 insert into public.onboarding_services(id,workspace_id,internal_code) values(service_a,w,'appointment-qa'),(service_b,w,'ads-qa');
 insert into public.onboarding_service_revisions(id,workspace_id,service_id,revision_number,name,default_price_cents,definition)
 values(rev_a,w,service_a,1,'Appointment Setting',0,'{"templateId":"appointment-setting"}'),(rev_b,w,service_b,1,'Advertising',0,'{}');
 insert into public.workspace_service_capabilities(workspace_id,service_id,capability) values(w,service_a,'appointment_setting.manage') on conflict do nothing;
 perform public.set_service_delivery_users(w,owner_id,service_a,array[setter,other_setter]);
 perform public.set_service_delivery_users(w,owner_id,service_b,array[other_setter]);
 details:=jsonb_build_object('primary_person_name','Rollback client','business_name','Rollback company','fulfilment_manager_user_id',owner_id,'communication_primary_provider','meta_whatsapp','whatsapp_phone','+15005550006','confirmation_address','whatsapp:+15005550006','is_test',true,'portal_base_url','https://example.invalid');
 selection:=jsonb_build_object('service_id',service_a,'revision_id',rev_a,'assignee_user_id',setter,'appointment_configuration',jsonb_build_object('mediums',jsonb_build_array('phone','zoom'),'fields',jsonb_build_array(jsonb_build_object('key','phone','required',true),jsonb_build_object('key','notes','required',false))));
 rejected:=false;
 begin perform public.create_retention_relationship(w,setter,bad_rel,details,jsonb_build_array(selection)); exception when others then rejected:=true; end;
 assert rejected,'A non-seller created a retention relationship';
 rejected:=false;
 begin perform public.create_retention_relationship(w,owner_id,bad_rel,details,jsonb_build_array(selection-'appointment_configuration')); exception when others then rejected:=true; end;
 assert rejected and not exists(select 1 from public.relationships where id=bad_rel),'Missing configuration left a partial relationship';
 rejected:=false;
 begin perform public.create_retention_relationship(w,owner_id,bad_rel,details,jsonb_build_array(selection || jsonb_build_object('assignee_user_id',owner_id))); exception when others then rejected:=true; end;
 assert rejected and not exists(select 1 from public.relationships where id=bad_rel),'Ineligible assignee was accepted';
 rejected:=false;
 begin perform public.create_retention_relationship(w,owner_id,bad_rel,details,jsonb_build_array(selection,selection)); exception when others then rejected:=true; end;
 assert rejected and not exists(select 1 from public.relationships where id=bad_rel),'Duplicate services left a partial relationship';
 result:=public.create_retention_relationship(w,owner_id,rel,details,jsonb_build_array(selection));
 assert (result->>'relationship_id')::uuid=rel,'Creation returned the wrong relationship';
 assert public.create_retention_relationship(w,owner_id,rel,details,jsonb_build_array(selection))=result,'Creation replay changed the receipt';
 assert (select count(*) from public.client_portal_sessions where relationship_id=rel)=1,'Portal missing or duplicated';
 assert (select count(*) from public.workspace_native_messages where client_request_id=(result->>'sale_id')::uuid)=1,'Handoff missing or duplicated';
 assert exists(select 1 from public.workspace_native_messages where id=(result->>'handoff_message_id')::uuid and sender_user_id is null and body is null and body_ciphertext is not null),'Portal handoff was not encrypted from BE';
 assert (select count(*) from public.workspace_native_conversation_participants where conversation_id=(result->>'handoff_conversation_id')::uuid)=1,'Private handoff has extra recipients';
 assert exists(select 1 from public.workspace_native_conversation_participants where conversation_id=(result->>'handoff_conversation_id')::uuid and user_id=owner_id),'Handoff recipient is not the creator';
 assert not exists(select 1 from public.onboarding_delivery_outbox where relationship_id=rel),'Handoff queued an external message';
 assert exists(select 1 from public.client_sales where relationship_id=rel and consent_confirmed_at is null and status='manual_consent_pending'),'Portal creation falsely confirmed messaging';
 perform set_config('test.retention_owner',owner_id::text,true);
 perform set_config('test.retention_inbox',result->>'handoff_conversation_id',true);
 perform set_config('test.retention_message',result->>'handoff_message_id',true);
 assert not has_function_privilege('service_role','public.create_retention_relationship_details(uuid,uuid,uuid,jsonb,jsonb)','EXECUTE'),'Unwrapped creation primitive is exposed';
 assert (select count(*) from public.client_sales where relationship_id=rel)=1,'Creation replay duplicated confirmation';
 assert exists(select 1 from public.relationships where id=rel and lifecycle_phase='retention' and team_locked_at is not null and fulfilment_manager_user_id=owner_id),'Retention team was not initialized';
 assert exists(select 1 from public.relationship_appointment_setting_configs where relationship_id=rel and mediums=array['phone','zoom']::text[] and jsonb_array_length(requested_fields)=2),'Appointment configuration was not persisted';
 select id into team from public.workspace_teams where relationship_id=rel;
 assert team is not null and (select count(*) from public.workspace_team_members where team_id=team)=2,'Internal team was not created';
 assert exists(select 1 from public.workspace_native_conversations where team_id=team),'Internal Comms conversation was not created';
 assert public.client_conversation_can_access(w,rel,owner_id) and not public.client_conversation_can_access(w,rel,setter),'Client-facing chat participation was not isolated';
 assert public.workspace_user_can_manage_appointment_setting(w,rel,owner_id, setter)=false,'Unknown service was accepted';
 assert public.workspace_user_can_manage_appointment_setting(w,rel,service_a,setter),'Assigned setter was denied';
 assert not public.workspace_user_can_manage_appointment_setting(w,rel,service_a,other_setter),'Service eligibility leaked another client';
 -- Automatic handoff does not expose a portal or DM before the client confirms.
 auto_result:=public.create_retention_relationship(w,owner_id,auto_rel,details||'{"retention_handoff":"request_confirmation"}'::jsonb,jsonb_build_array(selection));
 assert not exists(select 1 from public.client_portal_sessions where relationship_id=auto_rel),'Automatic flow issued a portal before confirmation';
 assert not exists(select 1 from public.workspace_native_messages where client_request_id=(auto_result->>'sale_id')::uuid),'Automatic flow also sent a manual DM';
 assert not exists(select 1 from public.onboarding_delivery_outbox where relationship_id=auto_rel),'Automatic flow sent a link before confirmation';
 assert public.create_retention_relationship(w,owner_id,auto_rel,details,jsonb_build_array(selection))=auto_result,'Retry changed the automatic handoff choice';
 update public.client_sales set status='retention_confirmed',consent_confirmed_at=now() where id=(auto_result->>'sale_id')::uuid;
 update public.client_sales set status='retention_confirmed' where id=(auto_result->>'sale_id')::uuid;
 assert (select count(*) from public.client_portal_sessions where relationship_id=auto_rel)=1,'Confirmation did not create exactly one portal';
 assert (select count(*) from public.onboarding_delivery_outbox where relationship_id=auto_rel and kind='client_portal_link')=1,'Confirmation did not queue exactly one portal link';
 assert (select source_metadata->>'external_messaging_pending' from public.relationships where id=auto_rel)='false','Automatic confirmation did not activate messaging';
 assert public.create_retention_relationship(w,owner_id,auto_rel,details,jsonb_build_array(selection))=auto_result,'Confirmed retry changed the receipt';
 assert (select source_metadata->>'external_messaging_pending' from public.relationships where id=auto_rel)='false','Retry reset confirmed messaging';
 -- Eligibility removal must not break an already agreed client allocation.
 perform public.set_service_delivery_users(w,owner_id,service_a,array[other_setter]);
 assert public.workspace_user_can_manage_appointment_setting(w,rel,service_a,setter),'Pool change revoked a current allocation';
 insert into public.appointment_setting_appointments(workspace_id,relationship_id,service_id,workflow_status,appointment_timezone,meeting_medium,created_by)
 values(w,rel,service_a,'draft','Europe/Dublin','phone',setter);
 select to_jsonb(s) into sale_snapshot from public.client_sales s where id=(result->>'sale_id')::uuid;
 selection:=jsonb_build_object('service_id',service_b,'revision_id',rev_b,'assignee_user_id',other_setter);
 rejected:=false;
 begin perform public.add_retention_relationship_service(w,rel,setter,selection,'Try unauthorized upgrade'); exception when others then rejected:=true; end;
 assert rejected,'Staff appended a service';
 rejected:=false;
 begin insert into public.relationship_services(workspace_id,relationship_id,service_key,service_id,service_revision_id,assignee_user_id) values(w,rel,'ads-qa',service_b,rev_b,other_setter); exception when others then rejected:=true; end;
 assert rejected,'Direct insertion bypassed the sold-service guard';
 perform public.add_retention_relationship_service(w,rel,owner_id,selection,'Start advertising results');
 assert (select count(*) from public.relationship_services where relationship_id=rel)=2,'Future service was not appended';
 assert exists(select 1 from public.workspace_team_members where team_id=team and user_id=other_setter),'New delivery person missing from internal team';
 assert not public.client_conversation_can_access(w,rel,other_setter),'Service append added client chat access';
 assert exists(select 1 from public.appointment_setting_appointments where relationship_id=rel),'Service append changed appointment history';
 assert (select to_jsonb(s) from public.client_sales s where id=(result->>'sale_id')::uuid)=sale_snapshot,'Service append rewrote the confirmation/sales snapshot';
 assert exists(select 1 from public.relationship_team_events where relationship_id=rel and event_type='retention_service_added'),'Missing service-change audit';
 rejected:=false;
 begin perform public.add_retention_relationship_service(w,rel,owner_id,selection,'Duplicate'); exception when others then rejected:=true; end;
 assert rejected and (select count(*) from public.relationship_services where relationship_id=rel)=2,'Duplicate append changed services';
 assert not exists(select 1 from public.retention_service_insert_permits),'An insert permit escaped its operation';
 -- Later consent reuses the portal and never sends its link a second time.
 update public.client_sales set status='retention_confirmed',consent_confirmed_at=now() where id=(result->>'sale_id')::uuid;
 assert (select source_metadata->>'external_messaging_pending' from public.relationships where id=rel)='false','Consent did not activate messaging';
 assert (select count(*) from public.client_portal_sessions where relationship_id=rel)=1,'Consent replaced the portal';
 assert not exists(select 1 from public.onboarding_delivery_outbox where relationship_id=rel),'Consent resent a manually handed-off portal';
 assert not has_function_privilege('authenticated','public.create_retention_relationship(uuid,uuid,uuid,jsonb,jsonb)','EXECUTE'),'Authenticated caller can impersonate a creator';
 assert not has_function_privilege('authenticated','public.add_retention_relationship_service(uuid,uuid,uuid,jsonb,text)','EXECUTE'),'Authenticated caller can impersonate an admin';
 assert not has_function_privilege('service_role','public.insert_retention_service(uuid,uuid,jsonb)','EXECUTE'),'Internal primitive is exposed';
 perform set_config('test.retention_workspace',w::text,true);
 perform set_config('test.retention_setter',setter::text,true);
 perform set_config('test.retention_other',other_setter::text,true);
end $$;
-- Exercise the actual table RLS policy with a staff JWT, not only its helper.
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('test.retention_other'),'role','authenticated','aal','aal2')::text,true);
set local role authenticated;
do $$ begin
 assert (select count(*) from public.communication_native_messages(current_setting('test.retention_workspace')::uuid,current_setting('test.retention_inbox')::uuid))=0,'Another staff member read the portal DM';
 assert (select count(*) from public.appointment_setting_appointments where workspace_id=current_setting('test.retention_workspace')::uuid)=0,'Unassigned staff read appointments via RLS';
end $$;
reset role;
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('test.retention_setter'),'role','authenticated','aal','aal2')::text,true);
set local role authenticated;
do $$ begin
 assert (select count(*) from public.appointment_setting_appointments where workspace_id=current_setting('test.retention_workspace')::uuid)=1,'Assigned staff cannot read their appointment via RLS';
end $$;
reset role;
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('test.retention_owner'),'role','authenticated','aal','aal2')::text,true);
set local role authenticated;
do $$ begin
 assert (select count(*) from public.communication_native_messages(current_setting('test.retention_workspace')::uuid,current_setting('test.retention_inbox')::uuid))=1,'Creator cannot read BE handoff';
 assert (select body like '%https://example.invalid/client-portal/session/%' from public.communication_native_message(current_setting('test.retention_workspace')::uuid,current_setting('test.retention_message')::uuid)),'Handoff did not decrypt to the portal link';
 assert not public.native_conversation_can_write(current_setting('test.retention_inbox')::uuid,auth.uid()),'User can impersonate BE or reply into its system inbox';
 declare rejected boolean:=false; begin
   begin perform public.delete_native_message_for_me(current_setting('test.retention_inbox')::uuid,current_setting('test.retention_message')::uuid); exception when others then rejected:=true; end;
   assert rejected,'Recipient deleted an immutable BE message';
 end;
end $$;
reset role;
rollback;
select true as retention_setup_access_and_upgrade_checks_passed;
