-- SOPs are ordinary document assets; no workflow, extraction or new permission grants.
-- Catalogue reads use a bounded keyset ordered by these exact columns.
create index if not exists assets_sop_catalogue_idx
on public.assets (workspace_id, created_at desc, id desc)
where native_kind = 'sop_document';
