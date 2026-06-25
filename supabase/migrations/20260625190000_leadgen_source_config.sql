alter table public.leadgen_workspace_settings
add column if not exists source_config jsonb not null default '{}'::jsonb;

alter table public.leadgen_polls
add column if not exists source_snapshot jsonb not null default '[]'::jsonb;
