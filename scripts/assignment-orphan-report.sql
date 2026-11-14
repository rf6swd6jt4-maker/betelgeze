-- Read-only report: assignments that still point at someone who is no longer a member of that workspace.
-- Decision 4 in docs/assignment-offboarding-design.md: run this before any offboarding migration.
--
-- Changes nothing: the whole report runs in a READ ONLY transaction that is rolled back.
-- For relationship_services, record_id is the relationship and service_key names the row.
-- Returns record ids and user ids only (no names, emails or message content), capped at 500 rows;
-- kind_total_in_workspace gives the full count per workspace and kind even when the list is capped.
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/assignment-orphan-report.sql
--
-- "Active client" means relationships.status <> 'archived' and lifecycle_phase <> 'completed_lost'.
-- "Active service instance" means disposition <> 'cancelled' and stage in onboarding, setup or maintenance.
-- "Open work" means status not in done/canceled and not archived (metadata.archived_at is null).
-- seller_history_kept rows are informational: sellers are deliberately left in place (decision 1).

begin transaction read only;
set local statement_timeout = '30s';

with active_clients as (
    select workspace_id, id, fulfilment_manager_user_id, seller_user_id
    from public.relationships
    where status <> 'archived' and lifecycle_phase <> 'completed_lost'
),
active_instances as (
    select i.workspace_id, i.id, i.assignee_user_id, i.manager_user_id
    from public.relationship_service_instances i
    join active_clients r on r.workspace_id = i.workspace_id and r.id = i.relationship_id
    where i.disposition <> 'cancelled' and i.stage in ('onboarding', 'setup', 'maintenance')
),
open_work as (
    select workspace_id, id, execution_owner_id
    from public.work_items
    where status not in ('done', 'canceled') and metadata->>'archived_at' is null
),
found as (
    select 'client_manager' as kind, workspace_id, 'relationships' as record_table, id as record_id, null::text as service_key, fulfilment_manager_user_id as user_id
    from active_clients where fulfilment_manager_user_id is not null
    union all
    select 'legacy_service_assignee', s.workspace_id, 'relationship_services', s.relationship_id, s.service_key, s.assignee_user_id
    from public.relationship_services s
    join active_clients r on r.workspace_id = s.workspace_id and r.id = s.relationship_id
    where s.assignee_user_id is not null
    union all
    select 'service_instance_assignee', workspace_id, 'relationship_service_instances', id, null, assignee_user_id
    from active_instances where assignee_user_id is not null
    union all
    select 'service_instance_manager', workspace_id, 'relationship_service_instances', id, null, manager_user_id
    from active_instances where manager_user_id is not null
    union all
    select 'work_owner', workspace_id, 'work_items', id, null, execution_owner_id
    from open_work where execution_owner_id is not null
    union all
    select 'work_collaborator', a.workspace_id, 'work_item_assignees', a.work_item_id, null, a.user_id
    from public.work_item_assignees a
    join open_work w on w.workspace_id = a.workspace_id and w.id = a.work_item_id
    union all
    select 'seller_history_kept', workspace_id, 'relationships', id, null, seller_user_id
    from active_clients where seller_user_id is not null
)
select
    f.kind,
    f.workspace_id,
    f.record_table,
    f.record_id,
    f.service_key,
    f.user_id as former_member_user_id,
    count(*) over (partition by f.workspace_id, f.kind) as kind_total_in_workspace
from found f
where not exists (
    select 1 from public.workspace_memberships m
    where m.workspace_id = f.workspace_id and m.user_id = f.user_id
)
order by f.workspace_id, f.kind, f.record_id, f.service_key
limit 500;

rollback;
