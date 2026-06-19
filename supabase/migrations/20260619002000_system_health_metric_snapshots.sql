create table if not exists public.system_health_metric_snapshots (
    id uuid primary key default gen_random_uuid(),
    metric_id text not null,
    provider text not null,
    metric_name text not null,
    numeric_value double precision not null,
    numeric_limit double precision,
    status text not null,
    captured_at timestamptz not null default now()
);

create index if not exists system_health_metric_snapshots_metric_captured_idx
    on public.system_health_metric_snapshots (metric_id, captured_at desc);

create or replace function public.trim_system_health_metric_snapshots()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    delete from public.system_health_metric_snapshots
    where metric_id = new.metric_id
      and id in (
          select id
          from public.system_health_metric_snapshots
          where metric_id = new.metric_id
          order by captured_at desc, id desc
          offset 5
      );

    return new;
end;
$$;

drop trigger if exists system_health_metric_snapshots_trim on public.system_health_metric_snapshots;
create trigger system_health_metric_snapshots_trim
after insert on public.system_health_metric_snapshots
for each row execute function public.trim_system_health_metric_snapshots();
