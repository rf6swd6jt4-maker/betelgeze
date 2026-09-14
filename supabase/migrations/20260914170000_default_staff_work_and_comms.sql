-- Staff navigation is derived from responsibility, not editable panel grants.
-- Record access remains participant-, assignment-, and relationship-scoped.
begin;

create or replace function public.workspace_user_has_capability(
    p_workspace_id uuid,
    p_capability text,
    p_user_id uuid default auth.uid()
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
    select case
        when public.workspace_role_for_user(p_workspace_id, p_user_id) is null then false
        when public.workspace_role_for_user(p_workspace_id, p_user_id) in ('owner', 'admin') then true
        when p_capability in ('fulfilment.manage', 'communications.manage') then true
        when p_capability = 'relationships.view' then exists (
            select 1
            from public.workspace_operational_roles operational
            where operational.workspace_id = p_workspace_id
              and operational.user_id = p_user_id
              and (operational.can_sell or operational.can_manage)
        ) or exists (
            select 1
            from public.relationships relationship
            where relationship.workspace_id = p_workspace_id
              and (relationship.seller_user_id = p_user_id or relationship.fulfilment_manager_user_id = p_user_id)
        )
        when p_capability = 'appointment_setting.manage' then exists (
            select 1
            from public.onboarding_services service
            join public.onboarding_service_revisions revision
              on revision.workspace_id = service.workspace_id
             and revision.service_id = service.id
            where service.workspace_id = p_workspace_id
              and service.state <> 'archived'
              and coalesce(revision.definition->>'templateId', revision.definition->>'template_id') = 'appointment-setting'
              and (
                  exists (
                      select 1
                      from public.workspace_member_service_access access
                      where access.workspace_id = service.workspace_id
                        and access.service_id = service.id
                        and access.user_id = p_user_id
                  )
                  or exists (
                      select 1
                      from public.relationship_services allocation
                      where allocation.workspace_id = service.workspace_id
                        and allocation.service_id = service.id
                        and allocation.assignee_user_id = p_user_id
                  )
              )
        )
        else false
    end
$$;

revoke all on function public.workspace_user_has_capability(uuid, text, uuid) from public, anon;
grant execute on function public.workspace_user_has_capability(uuid, text, uuid) to authenticated, service_role;

create or replace function public.workspace_shell_bootstrap(
    p_workspace_slug text,
    p_user_id uuid
)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
    with shell_context as (
        select
            workspace.id as workspace_id,
            workspace.name as workspace_name,
            workspace.slug as workspace_slug,
            workspace.logo_path,
            membership.role,
            profile.username,
            profile.avatar_path
        from public.workspaces workspace
        join public.workspace_memberships membership
          on membership.workspace_id = workspace.id
         and membership.user_id = p_user_id
        left join public.user_profiles profile on profile.user_id = p_user_id
        where workspace.slug = p_workspace_slug
          and workspace.status = 'active'
        limit 1
    ), allowed_services as (
        select distinct service_id
        from (
            select access.service_id
            from public.workspace_member_service_access access
            join shell_context context on context.workspace_id = access.workspace_id
            where access.user_id = p_user_id
            union all
            select allocation.service_id
            from public.relationship_services allocation
            join shell_context context on context.workspace_id = allocation.workspace_id
            where allocation.assignee_user_id = p_user_id
              and allocation.service_id is not null
        ) service_access
    )
    select jsonb_build_object(
        'workspace_id', context.workspace_id,
        'workspace_name', context.workspace_name,
        'workspace_slug', context.workspace_slug,
        'logo_path', context.logo_path,
        'role', context.role,
        'username', coalesce(context.username, 'account'),
        'avatar_path', context.avatar_path,
        'allowed_service_ids', case
            when context.role in ('owner', 'admin') then '[]'::jsonb
            else coalesce((select jsonb_agg(service_id order by service_id) from allowed_services), '[]'::jsonb)
        end,
        'capabilities', case
            when context.role in ('owner', 'admin') then to_jsonb(case when exists (
                select 1
                from public.onboarding_services service
                join public.onboarding_service_revisions revision
                  on revision.workspace_id = service.workspace_id
                 and revision.service_id = service.id
                where service.workspace_id = context.workspace_id
                  and service.state <> 'archived'
                  and coalesce(revision.definition->>'templateId', revision.definition->>'template_id') = 'appointment-setting'
            ) then array[
                'relationships.view', 'onboarding.manage', 'fulfilment.manage',
                'appointment_setting.manage', 'communications.manage', 'library.manage',
                'onboarding_builder.manage', 'leadgen.manage', 'admin.manage', 'settings.manage'
            ]::text[] else array[
                'relationships.view', 'onboarding.manage', 'fulfilment.manage',
                'communications.manage', 'library.manage', 'onboarding_builder.manage',
                'leadgen.manage', 'admin.manage', 'settings.manage'
            ]::text[] end)
            else coalesce((
                select jsonb_agg(capability order by display_order)
                from (
                    select 'fulfilment.manage'::text as capability, 1 as display_order
                    union all select 'communications.manage', 2
                    union all select 'relationships.view', 3 where public.workspace_user_has_capability(context.workspace_id, 'relationships.view', p_user_id)
                    union all select 'appointment_setting.manage', 4 where public.workspace_user_has_capability(context.workspace_id, 'appointment_setting.manage', p_user_id)
                ) staff_capabilities
            ), '[]'::jsonb)
        end,
        'service_access_schema_ready', true
    )
    from shell_context context
$$;

revoke all on function public.workspace_shell_bootstrap(text, uuid) from public, anon, authenticated;
grant execute on function public.workspace_shell_bootstrap(text, uuid) to service_role;

commit;
