alter table public.work_items
add column if not exists planned_start_time time,
add column if not exists due_time time;
