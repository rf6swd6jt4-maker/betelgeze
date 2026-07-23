-- A pre-created lifecycle stage must not retain its ghost-creation timestamp
-- once its prerequisite stage completes. Restore the exact finish-to-start
-- hand-off for any still-open affected stage (notably onboarding review).
update public.work_items as successor
set actual_start_at = predecessor.actual_completed_at,
    actual_start_has_time = true,
    updated_at = now()
from public.work_item_dependencies as edge
join public.work_items as predecessor
  on predecessor.id = edge.depends_on_work_item_id
where successor.id = edge.work_item_id
  and successor.workspace_id = edge.workspace_id
  and successor.workflow_role = 'lifecycle_stage'
  and successor.status not in ('done', 'canceled')
  and predecessor.workflow_role = 'lifecycle_stage'
  and predecessor.actual_completed_at is not null
  and (
      successor.actual_start_at is null
      or successor.actual_start_at < predecessor.actual_completed_at
  );

set constraints all immediate;
