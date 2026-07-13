-- Native relationship workflow: lifecycle orchestration remains in the
-- application, while these fields make its intent queryable and durable.

alter table public.relationships
    add column if not exists seller_user_id uuid references auth.users(id) on delete set null,
    add column if not exists fulfilment_manager_user_id uuid references auth.users(id) on delete set null,
    add column if not exists project_timeframe_days integer;

alter table public.relationship_services
    add column if not exists price_cents integer,
    add column if not exists currency text not null default 'usd',
    add column if not exists assignee_user_id uuid references auth.users(id) on delete set null;

alter table public.work_items
    add column if not exists workflow_role text not null default 'task'
        check (workflow_role in ('task', 'lifecycle_stage', 'service_group', 'review', 'automation')),
    add column if not exists completion_mode text not null default 'manual'
        check (completion_mode in ('manual', 'all_required_children')),
    add column if not exists workflow_action text,
    add column if not exists workflow_required boolean not null default true;

alter table public.relationships
    drop constraint if exists relationships_lifecycle_phase_check;
update public.relationships set lifecycle_phase = 'onboarding_review' where lifecycle_phase = 'onboarding_complete';
alter table public.relationships
    add constraint relationships_lifecycle_phase_check
    check (lifecycle_phase in ('lead', 'nurturing', 'potential_client', 'invoiced', 'onboarding', 'onboarding_review', 'fulfilment', 'retention', 'completed_lost'));

alter table public.relationship_work_items
    drop constraint if exists relationship_work_items_lifecycle_phase_check;
update public.relationship_work_items set lifecycle_phase = 'onboarding_review' where lifecycle_phase = 'onboarding_complete';
alter table public.relationship_work_items
    add constraint relationship_work_items_lifecycle_phase_check
    check (lifecycle_phase in ('lead', 'nurturing', 'potential_client', 'invoiced', 'onboarding', 'onboarding_review', 'fulfilment', 'retention', 'completed_lost'));

alter table public.work_items
    drop constraint if exists work_items_lifecycle_phase_check;
update public.work_items set lifecycle_phase = 'onboarding_review' where lifecycle_phase = 'onboarding_complete';
alter table public.work_items
    add constraint work_items_lifecycle_phase_check
    check (lifecycle_phase in ('lead', 'nurturing', 'potential_client', 'invoiced', 'onboarding', 'onboarding_review', 'fulfilment', 'retention', 'completed_lost'));

create index if not exists work_items_workflow_parent_idx
on public.work_items(workspace_id, parent_work_item_id, workflow_role, status);

create index if not exists relationship_services_assignment_idx
on public.relationship_services(workspace_id, relationship_id, assignee_user_id);
