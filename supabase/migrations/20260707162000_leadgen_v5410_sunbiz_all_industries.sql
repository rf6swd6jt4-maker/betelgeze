-- Lead Gen v5.4.10 Sunbiz coverage fix.
-- Sunbiz is a statewide registry source, so it must run for every enabled Florida ICP industry.

update public.leadgen_source_catalog
set coverage = '{"states":["FL"],"industries":["all_enabled"]}'::jsonb,
    metadata = coalesce(metadata, '{}'::jsonb) || '{"pass":"owner_identity_v5_4_10_sunbiz_all_industries","coverage_mode":"florida_all_enabled_industries"}'::jsonb,
    updated_at = now()
where source_key in ('registry.fl.sunbiz', 'registry.fl.fictitious_names');

insert into public.leadgen_source_industry_mappings (source_key, icp_industry_value, native_values, native_label, metadata, enabled)
select source.source_key,
    industry.value,
    array[industry.value],
    industry.label,
    jsonb_build_object(
        'seed', 'leadgen_v5_4_10_sunbiz_all_industries',
        'state', 'FL',
        'mapping_mode', 'statewide_registry_all_enabled_industries'
    ),
    true
from (values
    ('registry.fl.sunbiz'),
    ('registry.fl.fictitious_names')
) as source(source_key)
cross join public.leadgen_icp_industries industry
where industry.enabled = true
on conflict (source_key, icp_industry_value)
do update set native_values = excluded.native_values,
    native_label = excluded.native_label,
    enabled = true,
    metadata = coalesce(public.leadgen_source_industry_mappings.metadata, '{}'::jsonb) || excluded.metadata,
    updated_at = now();

insert into public.leadgen_source_location_mappings (source_key, icp_location_value, native_values, metadata, enabled)
select source.source_key,
    location.value,
    array[coalesce(location.locality, location.region, location.value)],
    jsonb_build_object(
        'seed', 'leadgen_v5_4_10_sunbiz_all_industries',
        'state', 'FL',
        'mapping_mode', 'statewide_registry_all_florida_locations'
    ),
    true
from (values
    ('registry.fl.sunbiz'),
    ('registry.fl.fictitious_names')
) as source(source_key)
cross join public.leadgen_icp_locations location
where location.enabled = true
and location.country = 'US'
and upper(location.region) = 'FL'
on conflict (source_key, icp_location_value)
do update set native_values = excluded.native_values,
    enabled = true,
    metadata = coalesce(public.leadgen_source_location_mappings.metadata, '{}'::jsonb) || excluded.metadata,
    updated_at = now();

insert into public.leadgen_source_health (source_key, status, last_error, metadata)
values
    (
        'registry.fl.sunbiz',
        'unknown',
        null,
        '{"adapter_seeded_by":"20260707162000_leadgen_v5410_sunbiz_all_industries","coverage_mode":"florida_all_enabled_industries"}'::jsonb
    ),
    (
        'registry.fl.fictitious_names',
        'unknown',
        null,
        '{"adapter_seeded_by":"20260707162000_leadgen_v5410_sunbiz_all_industries","coverage_mode":"florida_all_enabled_industries"}'::jsonb
    )
on conflict (source_key) do update set
    status = excluded.status,
    last_error = excluded.last_error,
    metadata = coalesce(public.leadgen_source_health.metadata, '{}'::jsonb) || excluded.metadata,
    updated_at = now();
