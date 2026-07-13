-- The canonical onboarding submission path upserts by this exact conflict
-- target.  The older partial index cannot be inferred by PostgreSQL's
-- `ON CONFLICT (workspace_id, native_kind, native_key)` clause.
--
-- A normal unique index still permits any number of legacy rows with null
-- native values, while making canonical form and upload assets upsertable.
create unique index if not exists assets_workspace_native_key_unique
on public.assets(workspace_id, native_kind, native_key);
