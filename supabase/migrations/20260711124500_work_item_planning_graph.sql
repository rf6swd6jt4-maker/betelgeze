alter table public.work_items
add column if not exists parent_work_item_id uuid references public.work_items(id) on delete set null;

create table if not exists public.work_item_dependencies (
    work_item_id uuid not null references public.work_items(id) on delete cascade,
    depends_on_work_item_id uuid not null references public.work_items(id) on delete cascade,
    workspace_id uuid not null references public.workspaces(id) on delete cascade,
    dependency_type text not null default 'finish_to_start' check (dependency_type in ('finish_to_start')),
    source text not null default 'manual' check (source in ('manual', 'parent_auto')),
    created_by uuid references auth.users(id) on delete set null,
    created_at timestamptz not null default now(),
    primary key (work_item_id, depends_on_work_item_id),
    check (work_item_id <> depends_on_work_item_id)
);

create table if not exists public.work_item_assignees (
    work_item_id uuid not null references public.work_items(id) on delete cascade,
    user_id uuid not null references auth.users(id) on delete cascade,
    workspace_id uuid not null references public.workspaces(id) on delete cascade,
    assigned_by uuid references auth.users(id) on delete set null,
    assigned_at timestamptz not null default now(),
    primary key (work_item_id, user_id)
);

create index if not exists work_items_parent_idx on public.work_items(workspace_id, parent_work_item_id);
create index if not exists work_item_dependencies_prerequisite_idx on public.work_item_dependencies(workspace_id, depends_on_work_item_id);
create index if not exists work_item_assignees_user_idx on public.work_item_assignees(workspace_id, user_id);

create or replace function public.validate_work_item_parent()
returns trigger
language plpgsql
set search_path = public
as $$
declare parent_workspace_id uuid;
begin
    if new.parent_work_item_id is null then return new; end if;
    if new.parent_work_item_id = new.id then raise exception 'A work item cannot be its own parent'; end if;

    select workspace_id into parent_workspace_id from public.work_items where id = new.parent_work_item_id;
    if parent_workspace_id is null or parent_workspace_id <> new.workspace_id then
        raise exception 'Parent work item must belong to the same workspace';
    end if;

    if exists (
        with recursive descendants as (
            select id from public.work_items where parent_work_item_id = new.id
            union all
            select child.id from public.work_items child join descendants d on child.parent_work_item_id = d.id
        )
        select 1 from descendants where id = new.parent_work_item_id
    ) then raise exception 'Work item nesting cannot contain a cycle'; end if;
    return new;
end;
$$;

drop trigger if exists validate_work_item_parent on public.work_items;
create trigger validate_work_item_parent
before insert or update of parent_work_item_id, workspace_id on public.work_items
for each row execute function public.validate_work_item_parent();

create or replace function public.validate_work_item_dependency()
returns trigger
language plpgsql
set search_path = public
as $$
declare dependent_workspace_id uuid;
declare prerequisite_workspace_id uuid;
declare dependent_status text;
declare prerequisite_status text;
begin
    select workspace_id, status into dependent_workspace_id, dependent_status from public.work_items where id = new.work_item_id;
    select workspace_id, status into prerequisite_workspace_id, prerequisite_status from public.work_items where id = new.depends_on_work_item_id;
    if dependent_workspace_id is null or prerequisite_workspace_id is null
       or dependent_workspace_id <> new.workspace_id or prerequisite_workspace_id <> new.workspace_id then
        raise exception 'Dependencies must link work items in the same workspace';
    end if;

    if exists (
        with recursive prerequisites as (
            select depends_on_work_item_id from public.work_item_dependencies where work_item_id = new.depends_on_work_item_id
            union
            select edge.depends_on_work_item_id
            from public.work_item_dependencies edge
            join prerequisites p on edge.work_item_id = p.depends_on_work_item_id
        )
        select 1 from prerequisites where depends_on_work_item_id = new.work_item_id
    ) then raise exception 'Work item dependencies cannot contain a cycle'; end if;
    if dependent_status = 'doing' and prerequisite_status <> 'done' then
        raise exception 'An in-progress work item cannot gain an unfinished dependency';
    end if;
    return new;
end;
$$;

drop trigger if exists validate_work_item_dependency on public.work_item_dependencies;
create trigger validate_work_item_dependency
before insert or update on public.work_item_dependencies
for each row execute function public.validate_work_item_dependency();

create or replace function public.validate_work_item_assignee()
returns trigger
language plpgsql
set search_path = public
as $$
begin
    if not exists (select 1 from public.work_items where id = new.work_item_id and workspace_id = new.workspace_id) then
        raise exception 'Work item must belong to the assignee workspace';
    end if;
    if not exists (select 1 from public.workspace_memberships where workspace_id = new.workspace_id and user_id = new.user_id) then
        raise exception 'Assignee must be a workspace member';
    end if;
    return new;
end;
$$;

drop trigger if exists validate_work_item_assignee on public.work_item_assignees;
create trigger validate_work_item_assignee
before insert or update on public.work_item_assignees
for each row execute function public.validate_work_item_assignee();

create or replace function public.apply_work_item_status_transition()
returns trigger
language plpgsql
set search_path = public
as $$
begin
    if new.status = 'doing' and old.status is distinct from 'doing' and exists (
        select 1
        from public.work_item_dependencies edge
        join public.work_items prerequisite on prerequisite.id = edge.depends_on_work_item_id
        where edge.work_item_id = new.id and prerequisite.status <> 'done'
    ) then raise exception 'This work item is waiting for unfinished dependencies'; end if;

    if new.status = 'doing' and new.actual_start_at is null then new.actual_start_at := now(); end if;
    if new.status = 'done' and new.actual_completed_at is null then new.actual_completed_at := now(); end if;
    if new.status <> 'done' and old.status = 'done' then new.actual_completed_at := null; end if;
    return new;
end;
$$;

drop trigger if exists apply_work_item_status_transition on public.work_items;
create trigger apply_work_item_status_transition
before update of status on public.work_items
for each row execute function public.apply_work_item_status_transition();

alter table public.work_item_dependencies enable row level security;
alter table public.work_item_assignees enable row level security;

create policy "workspace members can read work item dependencies" on public.work_item_dependencies
for select using (public.is_workspace_member(workspace_id));
create policy "workspace admins can manage work item dependencies" on public.work_item_dependencies
for all using (public.is_workspace_member(workspace_id, array['owner','admin']))
with check (public.is_workspace_member(workspace_id, array['owner','admin']));

create policy "workspace members can read work item assignees" on public.work_item_assignees
for select using (public.is_workspace_member(workspace_id));
create policy "workspace admins can manage work item assignees" on public.work_item_assignees
for all using (public.is_workspace_member(workspace_id, array['owner','admin']))
with check (public.is_workspace_member(workspace_id, array['owner','admin']));
