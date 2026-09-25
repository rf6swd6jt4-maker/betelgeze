-- Align the one-query workspace shell with the service-scoped onboarding panel gate.
-- Session and module visibility remains checked by the onboarding read RPCs.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

create or replace function public.workspace_shell_bootstrap(p_workspace_slug text,p_user_id uuid)
returns jsonb language sql stable security definer set search_path=public as $$
with shell_context as (
 select workspace.id workspace_id,workspace.name workspace_name,workspace.slug workspace_slug,workspace.logo_path,membership.role,profile.username,profile.avatar_path
 from public.workspaces workspace join public.workspace_memberships membership on membership.workspace_id=workspace.id and membership.user_id=p_user_id
 left join public.user_profiles profile on profile.user_id=p_user_id where workspace.slug=p_workspace_slug and workspace.status='active' limit 1
),allowed_services as (
 select distinct service_id from(
  select access.service_id from public.workspace_member_service_access access join shell_context context on context.workspace_id=access.workspace_id where access.user_id=p_user_id
  union all select allocation.service_id from public.relationship_services allocation join shell_context context on context.workspace_id=allocation.workspace_id where allocation.assignee_user_id=p_user_id and allocation.service_id is not null
 ) service_access
)
select jsonb_build_object('workspace_id',context.workspace_id,'workspace_name',context.workspace_name,'workspace_slug',context.workspace_slug,'logo_path',context.logo_path,'role',context.role,'username',coalesce(context.username,'account'),'avatar_path',context.avatar_path,
'allowed_service_ids',case when context.role in('owner','admin') then '[]'::jsonb else coalesce((select jsonb_agg(service_id order by service_id) from allowed_services),'[]'::jsonb) end,
'capabilities',case when context.role in('owner','admin') then to_jsonb(array['relationships.view','onboarding.manage','fulfilment.manage','appointment_setting.manage','client_connections.manage','communications.manage','library.manage','onboarding_builder.manage','leadgen.manage','admin.manage','settings.manage']::text[])
else coalesce((select jsonb_agg(capability order by display_order) from(
 select 'fulfilment.manage'::text capability,1 display_order union all select 'communications.manage',2
 union all select 'relationships.view',3 where public.workspace_user_has_capability(context.workspace_id,'relationships.view',p_user_id)
 union all select 'appointment_setting.manage',4 where public.workspace_user_has_capability(context.workspace_id,'appointment_setting.manage',p_user_id)
 union all select 'client_connections.manage',5 where exists(select 1 from public.appointment_setting_setup_assignees assignment where assignment.workspace_id=context.workspace_id and assignment.user_id=p_user_id)
 union all select 'onboarding.manage',6 where exists(
  select 1 from public.workspace_member_service_access access
  join public.workspace_service_capabilities permission
    on permission.workspace_id=access.workspace_id and permission.service_id=access.service_id
  where access.workspace_id=context.workspace_id and access.user_id=p_user_id
    and permission.capability='onboarding.manage'
 )
) staff_capabilities),'[]'::jsonb) end,'service_access_schema_ready',true) from shell_context context
$$;
revoke all on function public.workspace_shell_bootstrap(text,uuid) from public,anon,authenticated;
grant execute on function public.workspace_shell_bootstrap(text,uuid) to service_role;

notify pgrst,'reload schema';
commit;
