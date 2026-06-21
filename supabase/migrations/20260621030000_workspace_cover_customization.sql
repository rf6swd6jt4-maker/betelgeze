alter table public.workspaces
add column if not exists logo_path text,
add column if not exists banner_height integer not null default 192 check (banner_height between 192 and 288),
add column if not exists banner_position integer not null default 50 check (banner_position between 0 and 100);
