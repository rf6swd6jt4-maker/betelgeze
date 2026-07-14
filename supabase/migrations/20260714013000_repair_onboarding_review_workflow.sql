-- Review children follow the same open-ended, start-dated presentation as
-- onboarding steps, so they appear in the scheduled Gantt section.
update public.work_items as review
set
    planned_start_date = coalesce(review.planned_start_date, parent.planned_start_date, review.created_at::date),
    due_date = null,
    updated_at = now()
from public.work_items as parent
where review.parent_work_item_id = parent.id
  and review.workflow_role = 'review'
  and parent.workflow_role = 'lifecycle_stage'
  and parent.lifecycle_phase = 'onboarding_review';

-- A failed precondition must not leave an all-required parent complete while
-- its review children are still outstanding.
update public.work_items as parent
set
    status = 'todo',
    actual_completed_at = null,
    updated_at = now()
where parent.workflow_role = 'lifecycle_stage'
  and parent.lifecycle_phase = 'onboarding_review'
  and parent.completion_mode = 'all_required_children'
  and parent.status = 'done'
  and exists (
      select 1
      from public.work_items as child
      where child.parent_work_item_id = parent.id
        and child.workflow_required
        and child.status not in ('done', 'canceled')
  );

-- Existing review work had no assignee when onboarding was initiated before a
-- fulfilment manager was chosen. Give unassigned review rows to the delivery
-- manager, or otherwise the person who started that onboarding session.
with review_owners as (
    select
        parent.workspace_id,
        parent.id as parent_id,
        coalesce(relationship.fulfilment_manager_user_id, session.created_by) as reviewer_id
    from public.work_items as parent
    join public.work_item_relationships as link
      on link.workspace_id = parent.workspace_id
     and link.work_item_id = parent.id
    join public.relationships as relationship
      on relationship.workspace_id = link.workspace_id
     and relationship.id = link.relationship_id
    left join lateral (
        select created_by
        from public.relationship_onboarding_sessions
        where workspace_id = link.workspace_id
          and relationship_id = link.relationship_id
        order by (status = 'completed') desc, created_at desc
        limit 1
    ) as session on true
    where parent.workflow_role = 'lifecycle_stage'
      and parent.lifecycle_phase = 'onboarding_review'
)
insert into public.work_item_assignees (workspace_id, work_item_id, user_id)
select owner.workspace_id, item.id, owner.reviewer_id
from review_owners as owner
join public.work_items as item
  on item.id = owner.parent_id
  or item.parent_work_item_id = owner.parent_id
where owner.reviewer_id is not null
  and not exists (
      select 1
      from public.work_item_assignees as assignment
      where assignment.workspace_id = owner.workspace_id
        and assignment.work_item_id = item.id
  )
on conflict (work_item_id, user_id) do nothing;
