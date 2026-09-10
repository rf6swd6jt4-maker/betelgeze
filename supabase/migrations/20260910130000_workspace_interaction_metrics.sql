-- Separate explicit user-interaction boundaries from legacy fetch/header activity.
-- Append-only measurements have no business payload, URL, token or actor identifier.
create table if not exists public.workspace_interaction_metrics (
    id bigint generated always as identity primary key,
    workspace_id uuid not null references public.workspaces(id) on delete cascade,
    sample_id uuid not null,
    operation text not null,
    command_name text not null default 'unknown',
    route_section text not null,
    deployment_sha text,
    measurement jsonb not null,
    created_at timestamptz not null default now(),
    unique (workspace_id, sample_id),
    check (jsonb_typeof(measurement) = 'object')
);

create index if not exists workspace_interaction_metrics_workspace_created_idx
    on public.workspace_interaction_metrics(workspace_id, created_at desc);

alter table public.workspace_interaction_metrics enable row level security;
revoke all on table public.workspace_interaction_metrics from public, anon, authenticated;
grant select, insert, update, delete on table public.workspace_interaction_metrics to service_role;
grant usage, select on sequence public.workspace_interaction_metrics_id_seq to service_role;
