-- Staff panel people list: per-member counts of what each person currently holds. Additive and read-only.
-- Measured on production 2026-11-14 (7 members, 117 open owned tasks): 1.1 ms execution, index scans only
-- (work_queue_open_owner_idx, service_instances_relationship_stage_idx, work_item_assignees_pkey), 396 shared buffers.
-- Work grows with the workspace's open tasks; it runs only when an owner or admin opens the Staff panel.
create function public.workspace_member_workload(p_workspace uuid, p_actor uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
    if not exists (select 1 from public.workspace_memberships m join public.workspaces w on w.id = m.workspace_id and w.status = 'active'
                   where m.workspace_id = p_workspace and m.user_id = p_actor and m.role in ('owner', 'admin')) then
        raise exception 'Owner or admin required.';
    end if;
    return (
        with members as (select m.user_id, m.role, m.created_at from public.workspace_memberships m where m.workspace_id = p_workspace),
        active_clients as (
            select r.id, r.fulfilment_manager_user_id from public.relationships r
            where r.workspace_id = p_workspace and r.status <> 'archived' and r.lifecycle_phase <> 'completed_lost'
        ),
        active_instances as (
            select i.id, i.assignee_user_id from public.relationship_service_instances i
            join active_clients c on c.id = i.relationship_id
            where i.workspace_id = p_workspace and i.disposition = 'active' and i.stage in ('onboarding', 'setup', 'maintenance')
        ),
        open_work as (
            select w.id, w.execution_owner_id from public.work_items w
            where w.workspace_id = p_workspace and w.status not in ('done', 'canceled') and w.metadata->>'archived_at' is null
        ),
        counts as (
            select fulfilment_manager_user_id as user_id, 'clients' as kind from active_clients where fulfilment_manager_user_id is not null
            union all
            select assignee_user_id, 'services' from active_instances where assignee_user_id is not null
            union all
            select q.user_id, 'queues' from public.service_queue_members q join active_instances i on i.id = q.instance_id
            where q.workspace_id = p_workspace
            union all
            select execution_owner_id, 'tasks' from open_work where execution_owner_id is not null
            union all
            select a.user_id, 'tasks' from public.work_item_assignees a join open_work w on w.id = a.work_item_id
            where a.workspace_id = p_workspace and w.execution_owner_id is distinct from a.user_id
        )
        select coalesce(jsonb_agg(jsonb_build_object(
                   'userId', x.user_id, 'role', x.role, 'joinedAt', x.created_at,
                   'clients', x.clients, 'services', x.services, 'queues', x.queues, 'tasks', x.tasks)
                   order by x.created_at, x.user_id), '[]'::jsonb)
        from (
            select m.user_id, m.role, m.created_at,
                   count(c.kind) filter (where c.kind = 'clients') as clients,
                   count(c.kind) filter (where c.kind = 'services') as services,
                   count(c.kind) filter (where c.kind = 'queues') as queues,
                   count(c.kind) filter (where c.kind = 'tasks') as tasks
            from members m left join counts c on c.user_id = m.user_id
            group by m.user_id, m.role, m.created_at
        ) x
    );
end $$;

revoke all on function public.workspace_member_workload(uuid, uuid) from public, anon, authenticated;
grant execute on function public.workspace_member_workload(uuid, uuid) to service_role;
