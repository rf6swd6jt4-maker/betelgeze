alter table public.workspaces
add column if not exists leadgen_banner_path text,
add column if not exists leadgen_banner_height integer not null default 192 check (leadgen_banner_height between 192 and 288),
add column if not exists leadgen_banner_position integer not null default 50 check (leadgen_banner_position between 0 and 100);
