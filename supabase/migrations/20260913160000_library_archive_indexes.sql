-- Keep active Library reads bounded as archived test history accumulates.
begin;
create index if not exists work_items_active_library_idx on public.work_items(workspace_id,updated_at desc) where visibility='workspace' and metadata->>'archived_at' is null;
create index if not exists assets_active_library_idx on public.assets(workspace_id,updated_at desc) where metadata->>'archived_at' is null;
commit;
