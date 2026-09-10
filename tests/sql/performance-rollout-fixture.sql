-- Executed inside the outer rollback-only validation transaction as postgres.
-- Everything below is synthetic and linked to this one temporary identity row.
create temporary table performance_rollout_fixture (
 workspace_id uuid, owner_id uuid, setter_id uuid, outsider_id uuid,
 relationship_id uuid, service_id uuid, revision_id uuid
) on commit drop;
alter table performance_rollout_fixture enable row level security;
revoke all on pg_temp.performance_rollout_fixture from public,anon,authenticated,service_role;
-- This session-local table contains only generated fixture IDs. Readers need
-- those IDs after SET LOCAL ROLE; no row is visible through an application API.
create policy performance_rollout_fixture_session_read
on pg_temp.performance_rollout_fixture for select to authenticated,service_role
using (true);
insert into performance_rollout_fixture values(gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid());
grant select on performance_rollout_fixture to service_role,authenticated;
do $$
declare f record; u uuid;
begin
 if not (select relrowsecurity from pg_class where oid='pg_temp.performance_rollout_fixture'::regclass)
 or has_table_privilege('anon','pg_temp.performance_rollout_fixture','select')
 or has_table_privilege('authenticated','pg_temp.performance_rollout_fixture','insert')
 or has_table_privilege('authenticated','pg_temp.performance_rollout_fixture','update')
 or has_table_privilege('authenticated','pg_temp.performance_rollout_fixture','delete') then raise exception 'Temporary fixture access must remain RLS-protected and read-only'; end if;
 select * into strict f from performance_rollout_fixture;
 foreach u in array array[f.owner_id,f.setter_id,f.outsider_id] loop
  insert into auth.users(id,email,raw_user_meta_data,raw_app_meta_data)
  values(u,'performance-rollback-'||u::text||'@example.invalid',jsonb_build_object('username','qa-'||left(replace(u::text,'-',''),24)),'{}');
 end loop;
 insert into public.workspaces(id,name,slug) values(f.workspace_id,'Performance rollback fixture','qa-'||replace(f.workspace_id::text,'-',''));
 insert into public.workspace_memberships(workspace_id,user_id,role)
 values(f.workspace_id,f.owner_id,'owner'),(f.workspace_id,f.setter_id,'staff'),(f.workspace_id,f.outsider_id,'staff');
 insert into public.onboarding_services(id,workspace_id,internal_code,created_by)
 values(f.service_id,f.workspace_id,'performance-rollback-appointment',f.owner_id);
 insert into public.onboarding_service_revisions(id,workspace_id,service_id,revision_number,name,default_price_cents,definition,created_by,is_test)
 values(f.revision_id,f.workspace_id,f.service_id,1,'Performance rollback appointment',0,'{"templateId":"appointment-setting"}',f.owner_id,true);
 insert into public.workspace_member_service_access(workspace_id,user_id,service_id)
 values(f.workspace_id,f.setter_id,f.service_id),(f.workspace_id,f.outsider_id,f.service_id) on conflict do nothing;
 insert into public.workspace_service_capabilities(workspace_id,service_id,capability)
 values(f.workspace_id,f.service_id,'appointment_setting.manage') on conflict do nothing;
 insert into public.relationships(id,workspace_id,primary_person_name,business_name,lifecycle_phase,status,seller_user_id,fulfilment_manager_user_id,source_metadata)
 values(f.relationship_id,f.workspace_id,'Performance fixture','Rollback only','retention','active',f.owner_id,f.owner_id,'{"is_test":true,"fixture":"performance-rollout"}');
 insert into public.relationship_services(workspace_id,relationship_id,service_key,service_id,service_revision_id,assignee_user_id)
 values(f.workspace_id,f.relationship_id,'performance-rollback-appointment',f.service_id,f.revision_id,f.setter_id);
 insert into public.relationship_appointment_setting_configs(workspace_id,relationship_id,service_id,mediums,requested_fields)
 values(f.workspace_id,f.relationship_id,f.service_id,array['phone'],'[{"key":"phone","required":true}]');
 -- Exercise the real locked-team rename/synchronization triggers in later edits.
 update public.relationships set pos_started_at=now(),team_locked_at=now(),business_name=business_name where id=f.relationship_id;
 if not exists(select 1 from public.workspace_teams where workspace_id=f.workspace_id and relationship_id=f.relationship_id) then raise exception 'Synthetic delivery team was not created'; end if;
end $$;
