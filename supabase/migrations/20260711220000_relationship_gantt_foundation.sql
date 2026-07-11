alter table public.work_item_relationships
add column if not exists link_source text not null default 'explicit'
    check (link_source in ('explicit', 'inherited')),
add column if not exists inherited_from_work_item_id uuid references public.work_items(id) on delete cascade;

update public.work_item_relationships
set link_source = 'explicit', inherited_from_work_item_id = null
where link_source is null;

alter table public.work_item_relationships
drop constraint if exists work_item_relationships_inheritance_source_check;
alter table public.work_item_relationships
add constraint work_item_relationships_inheritance_source_check check (
    (link_source = 'explicit' and inherited_from_work_item_id is null)
    or (link_source = 'inherited' and inherited_from_work_item_id is not null)
);

create index if not exists work_item_relationships_inheritance_idx
on public.work_item_relationships(inherited_from_work_item_id, relationship_id)
where link_source = 'inherited';

create or replace function public.propagate_work_item_relationship_insert()
returns trigger
language plpgsql
set search_path = public
as $$
begin
    insert into public.work_item_relationships (
        work_item_id, relationship_id, workspace_id, link_source, inherited_from_work_item_id
    )
    select child.id, new.relationship_id, new.workspace_id, 'inherited', new.work_item_id
    from public.work_items child
    where child.parent_work_item_id = new.work_item_id
    on conflict (work_item_id, relationship_id) do nothing;
    return new;
end;
$$;

create or replace function public.propagate_work_item_relationship_delete()
returns trigger
language plpgsql
set search_path = public
as $$
begin
    delete from public.work_item_relationships
    where relationship_id = old.relationship_id
      and inherited_from_work_item_id = old.work_item_id
      and link_source = 'inherited';
    return old;
end;
$$;

drop trigger if exists propagate_work_item_relationship_insert on public.work_item_relationships;
create trigger propagate_work_item_relationship_insert
after insert on public.work_item_relationships
for each row execute function public.propagate_work_item_relationship_insert();

drop trigger if exists propagate_work_item_relationship_delete on public.work_item_relationships;
create trigger propagate_work_item_relationship_delete
after delete on public.work_item_relationships
for each row execute function public.propagate_work_item_relationship_delete();

create or replace function public.sync_reparented_work_item()
returns trigger
language plpgsql
set search_path = public
as $$
declare inherited_phase text;
begin
    if old.parent_work_item_id is not distinct from new.parent_work_item_id then return new; end if;

    delete from public.work_item_relationships
    where work_item_id = new.id and link_source = 'inherited';

    if new.parent_work_item_id is not null then
        insert into public.work_item_relationships (
            work_item_id, relationship_id, workspace_id, link_source, inherited_from_work_item_id
        )
        select new.id, link.relationship_id, new.workspace_id, 'inherited', new.parent_work_item_id
        from public.work_item_relationships link
        where link.work_item_id = new.parent_work_item_id
        on conflict (work_item_id, relationship_id) do nothing;

        with recursive ancestors as (
            select parent.id, parent.parent_work_item_id, parent.lifecycle_phase
            from public.work_items parent where parent.id = new.parent_work_item_id
            union all
            select parent.id, parent.parent_work_item_id, parent.lifecycle_phase
            from public.work_items parent join ancestors child on parent.id = child.parent_work_item_id
        )
        select lifecycle_phase into inherited_phase
        from ancestors where parent_work_item_id is null limit 1;

        if inherited_phase is not null then
            with recursive subtree as (
                select new.id as id
                union all
                select child.id from public.work_items child join subtree parent on child.parent_work_item_id = parent.id
            )
            update public.work_items set lifecycle_phase = inherited_phase
            where id in (select id from subtree);
        end if;
    elsif (select count(*) from public.work_item_relationships where work_item_id = new.id) > 1 then
        raise exception 'A root work item cannot be shared across relationships';
    end if;
    return new;
end;
$$;

drop trigger if exists sync_reparented_work_item on public.work_items;
create trigger sync_reparented_work_item
after update of parent_work_item_id on public.work_items
for each row execute function public.sync_reparented_work_item();

create or replace function public.validate_gantt_relationship_link()
returns trigger
language plpgsql
set search_path = public
as $$
declare parent_id uuid;
begin
    select parent_work_item_id into parent_id from public.work_items where id = new.work_item_id;
    if parent_id is null and exists (
        select 1 from public.work_item_relationships existing
        where existing.work_item_id = new.work_item_id
          and existing.relationship_id <> new.relationship_id
    ) then raise exception 'A root work item cannot be shared across relationships'; end if;
    return new;
end;
$$;

drop trigger if exists validate_gantt_relationship_link on public.work_item_relationships;
create trigger validate_gantt_relationship_link
before insert or update on public.work_item_relationships
for each row execute function public.validate_gantt_relationship_link();

with recursive work_item_roots as (
    select id, lifecycle_phase as root_phase
    from public.work_items where parent_work_item_id is null
    union all
    select child.id, parent.root_phase
    from public.work_items child
    join work_item_roots parent on child.parent_work_item_id = parent.id
)
update public.work_items item
set lifecycle_phase = root.root_phase
from work_item_roots root
where item.id = root.id and item.lifecycle_phase <> root.root_phase;

insert into public.work_item_relationships (
    work_item_id, relationship_id, workspace_id, link_source, inherited_from_work_item_id
)
select child.id, parent_link.relationship_id, child.workspace_id, 'inherited', child.parent_work_item_id
from public.work_items child
join public.work_item_relationships parent_link on parent_link.work_item_id = child.parent_work_item_id
where child.parent_work_item_id is not null
on conflict (work_item_id, relationship_id) do nothing;

create or replace function public.apply_gantt_schedule_plan(
    p_workspace_id uuid,
    p_changes jsonb
)
returns table(work_item_id uuid, updated_at timestamptz)
language plpgsql
set search_path = public
as $$
declare change jsonb;
declare changed_id uuid;
declare changed_at timestamptz;
begin
    for change in select value from jsonb_array_elements(p_changes)
    loop
        update public.work_items
        set planned_start_date = nullif(change->>'planned_start_date', '')::date,
            planned_start_time = nullif(change->>'planned_start_time', '')::time,
            due_date = nullif(change->>'due_date', '')::date,
            due_time = nullif(change->>'due_time', '')::time
        where id = (change->>'id')::uuid
          and workspace_id = p_workspace_id
          and updated_at = (change->>'expected_updated_at')::timestamptz
        returning id, public.work_items.updated_at into changed_id, changed_at;

        if changed_id is null then raise exception 'stale:%', change->>'id'; end if;
        work_item_id := changed_id;
        updated_at := changed_at;
        return next;
        changed_id := null;
    end loop;
end;
$$;

create or replace function public.move_gantt_work_item(
    p_workspace_id uuid,
    p_work_item_id uuid,
    p_parent_work_item_id uuid,
    p_sort_order integer,
    p_expected_updated_at timestamptz
)
returns timestamptz
language plpgsql
set search_path = public
as $$
declare changed_at timestamptz;
declare old_parent_id uuid;
begin
    select parent_work_item_id into old_parent_id
    from public.work_items
    where id = p_work_item_id and workspace_id = p_workspace_id and updated_at = p_expected_updated_at;
    if not found then raise exception 'stale:%', p_work_item_id; end if;

    update public.work_items
    set parent_work_item_id = p_parent_work_item_id,
        sort_order = p_sort_order
    where id = p_work_item_id
      and workspace_id = p_workspace_id
      and updated_at = p_expected_updated_at
    returning updated_at into changed_at;
    if changed_at is null then raise exception 'stale:%', p_work_item_id; end if;

    if old_parent_id is distinct from p_parent_work_item_id then
        delete from public.work_item_dependencies
        where workspace_id = p_workspace_id and work_item_id = p_work_item_id and source = 'parent_auto';
        if p_parent_work_item_id is not null then
            insert into public.work_item_dependencies (
                workspace_id, work_item_id, depends_on_work_item_id, source
            ) values (p_workspace_id, p_work_item_id, p_parent_work_item_id, 'parent_auto');
        end if;
    end if;
    return changed_at;
end;
$$;

create or replace function public.create_relationship_gantt_item(
    p_workspace_id uuid,
    p_relationship_id uuid,
    p_title text,
    p_lifecycle_phase text,
    p_parent_work_item_id uuid,
    p_start_date date,
    p_due_date date,
    p_created_by uuid
)
returns uuid
language plpgsql
set search_path = public
as $$
declare new_id uuid;
begin
    insert into public.work_items (
        workspace_id, title, lifecycle_phase, status, priority, is_key_task,
        native_kind, parent_work_item_id, planned_start_date, due_date, created_by,
        metadata
    ) values (
        p_workspace_id, trim(p_title), p_lifecycle_phase, 'todo', 3, true,
        'manual_task', p_parent_work_item_id, p_start_date, p_due_date, p_created_by,
        jsonb_build_object('created_from', 'relationship_gantt')
    ) returning id into new_id;

    if p_parent_work_item_id is null then
        insert into public.work_item_relationships (
            work_item_id, relationship_id, workspace_id, link_source, inherited_from_work_item_id
        ) values (new_id, p_relationship_id, p_workspace_id, 'explicit', null);
    else
        insert into public.work_item_relationships (
            work_item_id, relationship_id, workspace_id, link_source, inherited_from_work_item_id
        )
        select new_id, link.relationship_id, p_workspace_id, 'inherited', p_parent_work_item_id
        from public.work_item_relationships link
        where link.work_item_id = p_parent_work_item_id
        on conflict (work_item_id, relationship_id) do nothing;

        insert into public.work_item_dependencies (
            workspace_id, work_item_id, depends_on_work_item_id, source, created_by
        ) values (p_workspace_id, new_id, p_parent_work_item_id, 'parent_auto', p_created_by);
    end if;
    return new_id;
end;
$$;

create or replace function public.set_work_item_explicit_relationships(
    p_workspace_id uuid,
    p_work_item_id uuid,
    p_relationship_ids uuid[]
)
returns void
language plpgsql
set search_path = public
as $$
begin
    if exists (
        select 1 from unnest(p_relationship_ids) requested(id)
        where not exists (
            select 1 from public.relationships relationship
            where relationship.id = requested.id and relationship.workspace_id = p_workspace_id
        )
    ) then raise exception 'Relationships must belong to this workspace'; end if;

    delete from public.work_item_relationships
    where workspace_id = p_workspace_id
      and work_item_id = p_work_item_id
      and link_source = 'explicit'
      and not (relationship_id = any(p_relationship_ids));

    insert into public.work_item_relationships (
        work_item_id, relationship_id, workspace_id, link_source, inherited_from_work_item_id
    )
    select p_work_item_id, requested.id, p_workspace_id, 'explicit', null
    from unnest(p_relationship_ids) requested(id)
    where not exists (
        select 1 from public.work_item_relationships existing
        where existing.work_item_id = p_work_item_id and existing.relationship_id = requested.id
    );
end;
$$;
