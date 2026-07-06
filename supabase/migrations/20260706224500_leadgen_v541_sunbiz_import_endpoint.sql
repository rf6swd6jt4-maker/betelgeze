-- Lead Gen v5.4.1 Sunbiz owner-index import flow.
-- Documents the protected manual import endpoint used to populate the v5.4 Sunbiz owner index.

update public.leadgen_source_catalog
set metadata = coalesce(metadata, '{}'::jsonb) || '{
        "import_endpoint":"/api/leadgen/sunbiz/import",
        "import_secret_env":"LEADGEN_SUNBIZ_IMPORT_SECRET",
        "import_upload_note":"Upload extracted official fixed-width .txt files. Use mode=replace for full quarterly files and mode=append for daily files.",
        "pass":"owner_identity_v5_4_1_sunbiz_import_endpoint"
    }'::jsonb,
    updated_at = now()
where source_key in ('registry.fl.sunbiz', 'registry.fl.fictitious_names');

insert into public.leadgen_source_health (source_key, status, last_error, metadata)
values
    ('registry.fl.sunbiz', 'unknown', null, '{"import_endpoint_seeded_by":"20260706224500_leadgen_v541_sunbiz_import_endpoint","pass":"owner_identity_v5_4_1_sunbiz_import_endpoint"}'::jsonb),
    ('registry.fl.fictitious_names', 'unknown', null, '{"import_endpoint_seeded_by":"20260706224500_leadgen_v541_sunbiz_import_endpoint","pass":"owner_identity_v5_4_1_sunbiz_import_endpoint"}'::jsonb)
on conflict (source_key) do update set
    metadata = coalesce(public.leadgen_source_health.metadata, '{}'::jsonb) || excluded.metadata,
    updated_at = now();
