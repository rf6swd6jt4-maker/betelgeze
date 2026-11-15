-- Needs attention: one bounded, read-only summary of team-wide items nobody may be acting on. Owners and admins only.
-- Kinds (decided 2026-11-15): services with no assignee; clients whose latest message is inbound and older than 24 hours;
-- onboarding with no session or onboarding-task change for 5 days; open disputes on open tasks; open tasks past their due
-- date; open tasks still owned by someone who left the workspace. At most 5 examples per kind, plus each kind's total.
--
-- Measured on production 2026-11-15: 62 ms with a full work_items scan for the onboarding lookup; 1.6 ms with the
-- partial index below (rehearsed in a rolled-back transaction). Remaining scans are the workspace's 7 memberships.
-- Message reads only use direction and created_at; no read cursor, unread count, receipt or alert path is touched.

create index if not exists work_items_onboarding_session_idx
    on public.work_items (workspace_id, (metadata->>'session_id'))
    where native_kind = 'onboarding_step';

create function public.workspace_needs_attention(p_workspace uuid, p_actor uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
    if not exists (select 1 from public.workspace_memberships m join public.workspaces w on w.id = m.workspace_id and w.status = 'active'
                   where m.workspace_id = p_workspace and m.user_id = p_actor and m.role in ('owner', 'admin')) then
        raise exception 'Owner or admin required.';
    end if;
    return (
        with active_clients as (
            select r.id, coalesce(r.business_name, r.primary_person_name) as client
            from public.relationships r
            where r.workspace_id = p_workspace and r.status <> 'archived' and r.lifecycle_phase <> 'completed_lost'
        ),
        members as (select user_id from public.workspace_memberships where workspace_id = p_workspace),
        open_work as (
            select w.* from public.work_items w
            where w.workspace_id = p_workspace and w.status not in ('done', 'canceled') and w.metadata->>'archived_at' is null
        ),
        items as (
            select 'unassigned_service' as kind, i.updated_at as since, c.id as relationship_id, c.client, coalesce(v.name, i.service_key) as title, i.id as record_id
            from public.relationship_service_instances i
            join active_clients c on c.id = i.relationship_id
            left join public.onboarding_service_revisions v on v.workspace_id = i.workspace_id and v.id = i.service_revision_id
            where i.workspace_id = p_workspace and i.disposition = 'active' and i.stage in ('onboarding', 'setup', 'maintenance') and i.assignee_user_id is null
            union all
            select 'waiting_on_reply', m.created_at, c.id, c.client, 'Client message waiting for a reply', c.id
            from active_clients c
            cross join lateral (
                select x.created_at, x.direction from public.client_messages x
                where x.relationship_id = c.id order by x.created_at desc limit 1
            ) m
            where m.direction = 'inbound' and m.created_at < now() - interval '24 hours'
            union all
            select 'stalled_onboarding', greatest(s.updated_at, coalesce(p.last_progress, s.updated_at)), c.id, c.client, 'Onboarding has not moved', s.id
            from public.relationship_onboarding_sessions s
            join active_clients c on c.id = s.relationship_id
            left join lateral (
                select max(w.updated_at) as last_progress from public.work_items w
                where w.workspace_id = p_workspace and w.native_kind = 'onboarding_step' and w.metadata->>'session_id' = s.id::text
            ) p on true
            where s.workspace_id = p_workspace and s.status = 'active'
              and greatest(s.updated_at, coalesce(p.last_progress, s.updated_at)) < now() - interval '5 days'
            union all
            select 'disputed_task', d.created_at, d.relationship_id, c.client, w.title, w.id
            from public.work_queue_disputes d
            join open_work w on w.id = d.work_item_id
            left join active_clients c on c.id = d.relationship_id
            where d.workspace_id = p_workspace and d.status = 'open'
            union all
            select 'overdue_task', w.due_date::timestamptz, wr.relationship_id, c.client, w.title, w.id
            from open_work w
            left join lateral (select x.relationship_id from public.work_item_relationships x where x.work_item_id = w.id order by x.relationship_id limit 1) wr on true
            left join active_clients c on c.id = wr.relationship_id
            where w.due_date < current_date and coalesce(w.workflow_role, '') not in ('service_group', 'lifecycle_stage')
            union all
            select 'removed_member_work', w.updated_at, null, null, w.title, w.id
            from open_work w
            where w.execution_owner_id is not null and not exists (select 1 from members m where m.user_id = w.execution_owner_id)
        ),
        ranked as (
            select *, row_number() over (partition by kind order by since, record_id) as position, count(*) over (partition by kind) as total
            from items
        )
        select coalesce(jsonb_agg(jsonb_build_object('kind', k.kind, 'total', k.total, 'items', k.examples) order by k.kind), '[]'::jsonb)
        from (
            select kind, max(total) as total,
                   jsonb_agg(jsonb_build_object('since', since, 'relationshipId', relationship_id, 'client', client, 'title', title, 'recordId', record_id) order by position) as examples
            from ranked where position <= 5 group by kind
        ) k
    );
end $$;

revoke all on function public.workspace_needs_attention(uuid, uuid) from public, anon, authenticated;
grant execute on function public.workspace_needs_attention(uuid, uuid) to service_role;
