-- Lifecycle parents begin on a real date but remain open until their workflow
-- completes. Existing active parents created by v1 used a same-day placeholder
-- due date, so remove only that placeholder for the relationship's live stage.
update public.work_items as stage
set due_date = null,
    due_time = null,
    updated_at = now()
from public.relationships as relationship
join public.work_item_relationships as link
    on link.workspace_id = relationship.workspace_id
   and link.relationship_id = relationship.id
where stage.workspace_id = relationship.workspace_id
  and link.work_item_id = stage.id
  and stage.workflow_role = 'lifecycle_stage'
  and stage.lifecycle_phase = relationship.lifecycle_phase
  and stage.status not in ('done', 'canceled')
  and stage.planned_start_date is not null
  and stage.due_date = stage.planned_start_date;

-- Canonical onboarding steps created before start-only scheduling had no dates,
-- which put them in the Gantt's Unscheduled section. They start with their
-- active onboarding session, but intentionally have no estimated finish date.
update public.work_items as step
set planned_start_date = coalesce(parent.planned_start_date, session.created_at::date),
    planned_start_time = null,
    due_date = null,
    due_time = null,
    updated_at = now()
from public.relationship_onboarding_sessions as session
join public.work_items as parent
    on parent.workspace_id = session.workspace_id
where step.workspace_id = session.workspace_id
  and parent.id = step.parent_work_item_id
  and step.native_kind = 'onboarding_step'
  and step.native_key like session.id::text || ':%'
  and step.planned_start_date is null;
