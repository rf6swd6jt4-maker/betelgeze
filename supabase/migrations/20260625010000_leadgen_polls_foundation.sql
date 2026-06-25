create table if not exists public.leadgen_workspace_settings (
    workspace_id uuid primary key references public.workspaces(id) on delete cascade,
    poll_interval_hours integer not null default 168 check (poll_interval_hours between 1 and 2160),
    automatic_polls_enabled boolean not null default false,
    geography text,
    icp_notes text,
    enabled_sources jsonb not null default '[]'::jsonb,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create table if not exists public.leadgen_polls (
    id uuid primary key default gen_random_uuid(),
    workspace_id uuid not null references public.workspaces(id) on delete cascade,
    requested_by uuid references auth.users(id) on delete set null,
    status text not null default 'queued' check (status in ('queued', 'running', 'completed', 'failed', 'cancelled')),
    trigger text not null default 'manual' check (trigger in ('manual', 'scheduled')),
    source_count integer not null default 0,
    candidate_count integer not null default 0,
    normalised_count integer not null default 0,
    deduped_count integer not null default 0,
    enriched_count integer not null default 0,
    qualified_count integer not null default 0,
    error text,
    started_at timestamptz,
    completed_at timestamptz,
    created_at timestamptz not null default now()
);

create index if not exists leadgen_polls_workspace_created_idx
on public.leadgen_polls (workspace_id, created_at desc);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
    new.updated_at = now();
    return new;
end;
$$;

drop trigger if exists leadgen_workspace_settings_updated_at on public.leadgen_workspace_settings;

create trigger leadgen_workspace_settings_updated_at
before update on public.leadgen_workspace_settings
for each row execute function public.set_updated_at();
