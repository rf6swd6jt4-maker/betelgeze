-- Repair the original Gantt write RPC, normalize legacy test schedules, and
-- enforce the same hierarchy/dependency rules at the database boundary.

create or replace function public.work_item_effective_schedule(p_work_item_id uuid)
returns table(start_date date, end_date date)
language sql
stable
set search_path = public
as $$
    with recursive subtree as (
        select item.id, item.parent_work_item_id, item.planned_start_date, item.due_date, 0 as depth
        from public.work_items as item
        where item.id = p_work_item_id
        union all
        select child.id, child.parent_work_item_id, child.planned_start_date, child.due_date, parent.depth + 1
        from public.work_items as child
        join subtree as parent on child.parent_work_item_id = parent.id
    ), root as (
        select item.planned_start_date, item.due_date
        from public.work_items as item
        where item.id = p_work_item_id
    )
    select
        case
            when root.planned_start_date is not null then root.planned_start_date
            else min(subtree.planned_start_date) filter (where subtree.depth > 0)
        end as start_date,
        case
            when root.planned_start_date is not null then coalesce(root.due_date, root.planned_start_date)
            else max(coalesce(subtree.due_date, subtree.planned_start_date)) filter (where subtree.depth > 0)
        end as end_date
    from root
    cross join subtree
    group by root.planned_start_date, root.due_date;
$$;

-- Normalize impossible ranges before considering hierarchy and dependencies.
update public.work_items as item
set due_date = item.planned_start_date,
    due_time = case
        when item.planned_start_time is not null then item.planned_start_time
        else item.due_time
    end
where item.planned_start_date is not null
  and (
      item.due_date < item.planned_start_date
      or (
          item.due_date = item.planned_start_date
          and item.planned_start_time is not null
          and item.due_time is not null
          and item.due_time < item.planned_start_time
      )
  );

-- Converge the legacy graph to a legal plan. Explicit ancestors are widened
-- around every scheduled descendant. Conflicting finish-to-start dependants
-- (and their whole subtrees) are shifted forward without changing durations.
do $$
declare
    repair_pass integer;
    widened_count integer;
    dependent_id uuid;
    prerequisite_end date;
    dependent_start date;
    time_conflict boolean;
    shift_days integer;
    changed_this_pass boolean;
begin
    for repair_pass in 1..1000 loop
        changed_this_pass := false;

        with recursive ancestry as (
            select child.id as descendant_id, child.parent_work_item_id as ancestor_id
            from public.work_items as child
            where child.parent_work_item_id is not null
            union all
            select ancestry.descendant_id, parent.parent_work_item_id
            from ancestry
            join public.work_items as parent on parent.id = ancestry.ancestor_id
            where parent.parent_work_item_id is not null
        ), descendant_bounds as (
            select
                ancestry.ancestor_id,
                min(descendant.planned_start_date) as earliest_start,
                max(coalesce(descendant.due_date, descendant.planned_start_date)) as latest_end
            from ancestry
            join public.work_items as descendant on descendant.id = ancestry.descendant_id
            where descendant.planned_start_date is not null
            group by ancestry.ancestor_id
        )
        update public.work_items as ancestor
        set planned_start_date = least(ancestor.planned_start_date, bounds.earliest_start),
            due_date = greatest(coalesce(ancestor.due_date, ancestor.planned_start_date), bounds.latest_end)
        from descendant_bounds as bounds
        where ancestor.id = bounds.ancestor_id
          and ancestor.planned_start_date is not null
          and (
              bounds.earliest_start < ancestor.planned_start_date
              or bounds.latest_end > coalesce(ancestor.due_date, ancestor.planned_start_date)
          );
        get diagnostics widened_count = row_count;
        if widened_count > 0 then changed_this_pass := true; end if;

        dependent_id := null;
        prerequisite_end := null;
        dependent_start := null;
        time_conflict := false;

        with recursive ancestry as (
            select child.id as descendant_id, child.parent_work_item_id as ancestor_id
            from public.work_items as child
            where child.parent_work_item_id is not null
            union all
            select ancestry.descendant_id, parent.parent_work_item_id
            from ancestry
            join public.work_items as parent on parent.id = ancestry.ancestor_id
            where parent.parent_work_item_id is not null
        )
        select
            edge.work_item_id,
            prerequisite_range.end_date,
            dependent_range.start_date,
            dependent_range.start_date = prerequisite_range.end_date
                and prerequisite.due_time is not null
                and dependent.planned_start_time is not null
                and dependent.planned_start_time < prerequisite.due_time
        into dependent_id, prerequisite_end, dependent_start, time_conflict
        from public.work_item_dependencies as edge
        join public.work_items as dependent on dependent.id = edge.work_item_id
        join public.work_items as prerequisite on prerequisite.id = edge.depends_on_work_item_id
        cross join lateral public.work_item_effective_schedule(edge.work_item_id) as dependent_range
        cross join lateral public.work_item_effective_schedule(edge.depends_on_work_item_id) as prerequisite_range
        left join ancestry
          on ancestry.descendant_id = edge.work_item_id
         and ancestry.ancestor_id = edge.depends_on_work_item_id
        where ancestry.ancestor_id is null
          and dependent_range.start_date is not null
          and prerequisite_range.end_date is not null
          and (
              dependent_range.start_date < prerequisite_range.end_date
              or (
                  dependent_range.start_date = prerequisite_range.end_date
                  and prerequisite.due_time is not null
                  and dependent.planned_start_time is not null
                  and dependent.planned_start_time < prerequisite.due_time
              )
          )
        order by prerequisite_range.end_date, edge.work_item_id
        limit 1;

        if dependent_id is not null then
            shift_days := case
                when dependent_start < prerequisite_end then prerequisite_end - dependent_start
                when time_conflict then 1
                else 0
            end;

            if shift_days > 0 then
                with recursive dependent_subtree as (
                    select item.id
                    from public.work_items as item
                    where item.id = dependent_id
                    union all
                    select child.id
                    from public.work_items as child
                    join dependent_subtree as parent on child.parent_work_item_id = parent.id
                )
                update public.work_items as item
                set planned_start_date = item.planned_start_date + shift_days,
                    due_date = case when item.due_date is null then null else item.due_date + shift_days end
                where item.id in (select subtree.id from dependent_subtree as subtree)
                  and item.planned_start_date is not null;
                changed_this_pass := true;
            end if;
        end if;

        if not changed_this_pass then exit; end if;
        if repair_pass = 1000 then
            raise exception 'Legacy Gantt schedule repair did not converge';
        end if;
    end loop;
end;
$$;

create or replace function public.assert_work_item_schedule_legality(p_workspace_id uuid)
returns void
language plpgsql
set search_path = public
as $$
begin
    if exists (
        select 1
        from public.work_items as item
        where item.workspace_id = p_workspace_id
          and item.planned_start_date is not null
          and (
              item.due_date < item.planned_start_date
              or (
                  item.due_date = item.planned_start_date
                  and item.planned_start_time is not null
                  and item.due_time is not null
                  and item.due_time < item.planned_start_time
              )
          )
    ) then raise exception 'A work item schedule cannot end before it starts'; end if;

    if exists (
        with recursive ancestry as (
            select child.id as descendant_id, child.parent_work_item_id as ancestor_id
            from public.work_items as child
            where child.workspace_id = p_workspace_id
              and child.parent_work_item_id is not null
            union all
            select ancestry.descendant_id, parent.parent_work_item_id
            from ancestry
            join public.work_items as parent on parent.id = ancestry.ancestor_id
            where parent.parent_work_item_id is not null
        )
        select 1
        from ancestry
        join public.work_items as descendant on descendant.id = ancestry.descendant_id
        join public.work_items as ancestor on ancestor.id = ancestry.ancestor_id
        where descendant.planned_start_date is not null
          and ancestor.planned_start_date is not null
          and (
              descendant.planned_start_date < ancestor.planned_start_date
              or coalesce(descendant.due_date, descendant.planned_start_date)
                  > coalesce(ancestor.due_date, ancestor.planned_start_date)
          )
    ) then raise exception 'Child work must remain inside every explicitly scheduled ancestor'; end if;

    if exists (
        with recursive ancestry as (
            select child.id as descendant_id, child.parent_work_item_id as ancestor_id
            from public.work_items as child
            where child.workspace_id = p_workspace_id
              and child.parent_work_item_id is not null
            union all
            select ancestry.descendant_id, parent.parent_work_item_id
            from ancestry
            join public.work_items as parent on parent.id = ancestry.ancestor_id
            where parent.parent_work_item_id is not null
        )
        select 1
        from public.work_item_dependencies as edge
        join public.work_items as dependent on dependent.id = edge.work_item_id
        join public.work_items as prerequisite on prerequisite.id = edge.depends_on_work_item_id
        cross join lateral public.work_item_effective_schedule(edge.work_item_id) as dependent_range
        cross join lateral public.work_item_effective_schedule(edge.depends_on_work_item_id) as prerequisite_range
        left join ancestry
          on ancestry.descendant_id = edge.work_item_id
         and ancestry.ancestor_id = edge.depends_on_work_item_id
        where edge.workspace_id = p_workspace_id
          and ancestry.ancestor_id is null
          and dependent_range.start_date is not null
          and prerequisite_range.end_date is not null
          and (
              dependent_range.start_date < prerequisite_range.end_date
              or (
                  dependent_range.start_date = prerequisite_range.end_date
                  and prerequisite.due_time is not null
                  and dependent.planned_start_time is not null
                  and dependent.planned_start_time < prerequisite.due_time
              )
          )
    ) then raise exception 'Dependent work cannot begin before its prerequisite finishes'; end if;

    return;
end;
$$;

create or replace function public.validate_work_item_schedule_legality()
returns trigger
language plpgsql
set search_path = public
as $$
begin
    perform public.assert_work_item_schedule_legality(new.workspace_id);
    return new;
end;
$$;

-- Fail the migration instead of installing constraints over unrepaired data.
do $$
declare workspace record;
begin
    for workspace in select distinct item.workspace_id from public.work_items as item
    loop
        perform public.assert_work_item_schedule_legality(workspace.workspace_id);
    end loop;
end;
$$;

drop trigger if exists validate_work_item_schedule_legality on public.work_items;
create constraint trigger validate_work_item_schedule_legality
after insert or update of workspace_id, parent_work_item_id, planned_start_date, planned_start_time, due_date, due_time
on public.work_items
deferrable initially deferred
for each row execute function public.validate_work_item_schedule_legality();

drop trigger if exists validate_work_item_dependency_schedule_legality on public.work_item_dependencies;
create constraint trigger validate_work_item_dependency_schedule_legality
after insert or update of workspace_id, work_item_id, depends_on_work_item_id
on public.work_item_dependencies
deferrable initially deferred
for each row execute function public.validate_work_item_schedule_legality();

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
        update public.work_items as item
        set planned_start_date = nullif(change->>'planned_start_date', '')::date,
            planned_start_time = nullif(change->>'planned_start_time', '')::time,
            due_date = nullif(change->>'due_date', '')::date,
            due_time = nullif(change->>'due_time', '')::time
        where item.id = (change->>'id')::uuid
          and item.workspace_id = p_workspace_id
          and item.updated_at = (change->>'expected_updated_at')::timestamptz
        returning item.id, item.updated_at into changed_id, changed_at;

        if changed_id is null then raise exception 'stale:%', change->>'id'; end if;
        work_item_id := changed_id;
        updated_at := changed_at;
        return next;
        changed_id := null;
    end loop;
end;
$$;
