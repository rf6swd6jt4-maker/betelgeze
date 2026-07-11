alter table public.work_items
add column if not exists actual_start_has_time boolean not null default false,
add column if not exists actual_completed_has_time boolean not null default false;

update public.work_items
set actual_start_has_time = true
where actual_start_at is not null;

update public.work_items
set actual_completed_has_time = true
where actual_completed_at is not null;

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

    if new.status = 'doing' and new.actual_start_at is null then
        new.actual_start_at := now();
        new.actual_start_has_time := true;
    end if;
    if new.status = 'done' and new.actual_completed_at is null then
        new.actual_completed_at := now();
        new.actual_completed_has_time := true;
    end if;
    if new.status <> 'done' and old.status = 'done' then
        new.actual_completed_at := null;
        new.actual_completed_has_time := false;
    end if;
    return new;
end;
$$;
