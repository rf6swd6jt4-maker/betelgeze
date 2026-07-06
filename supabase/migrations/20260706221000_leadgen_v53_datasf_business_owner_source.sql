-- Lead Gen v5.3 owner-identity source pass.
-- Adds DataSF registered business locations as a pollable Bay Area owner-name source.

insert into public.leadgen_source_catalog (
    source_key,
    label,
    family,
    source_points,
    owner_identity_points,
    owner_phone_points,
    business_support_points,
    access_method,
    free_status,
    implementation_status,
    run_stage,
    enabled,
    rate_limit_ms,
    coverage,
    metadata
) values (
    'registry.ca.san_francisco_business_locations',
    'San Francisco registered businesses',
    'registries',
    3,
    3,
    0,
    2,
    'public_api',
    'free',
    'active',
    'candidate_investigation',
    true,
    900,
    '{"states":["CA"],"cities":["San Francisco","Oakland","San Jose"]}'::jsonb,
    '{
        "adapter":"socrata_public_records",
        "domain":"data.sfgov.org",
        "dataset_id":"g8m3-pdis",
        "source_url":"https://data.sfgov.org/Economy-and-Community/Registered-Business-Locations-San-Francisco/g8m3-pdis",
        "provenance_url":"https://data.sfgov.org/Economy-and-Community/Registered-Business-Locations-San-Francisco/g8m3-pdis",
        "claim_profile":"san_francisco_registered_business_owner",
        "identity_claim_kind":"owner_identity",
        "person_role":"business_owner",
        "query_limit":12,
        "search_term_limit":4,
        "where_clause":"dba_end_date IS NULL AND location_end_date IS NULL",
        "owner_identity_points_on_match":3,
        "owner_phone_points_on_match":0,
        "business_support_points_on_match":2,
        "source_role":"direct_owner_identity",
        "pass":"owner_identity_v5_3_third_source_pass",
        "active_row_note":"Filters out rows with DBA or location end dates before matching owner identities.",
        "field_map":{
            "business_name":["dba_name"],
            "dba_name":["dba_name"],
            "owner_name":["ownership_name"],
            "address":["full_business_address"],
            "city":["city"],
            "state":["state"],
            "postcode":["business_zip"],
            "record_id":["uniqueid","certificate_number","ttxid"],
            "geopoint":["location"],
            "additional_match_name":["ownership_name"]
        }
    }'::jsonb
)
on conflict (source_key) do update set
    label = excluded.label,
    family = excluded.family,
    source_points = excluded.source_points,
    owner_identity_points = excluded.owner_identity_points,
    owner_phone_points = excluded.owner_phone_points,
    business_support_points = excluded.business_support_points,
    access_method = excluded.access_method,
    free_status = excluded.free_status,
    implementation_status = excluded.implementation_status,
    run_stage = excluded.run_stage,
    enabled = excluded.enabled,
    rate_limit_ms = excluded.rate_limit_ms,
    coverage = excluded.coverage,
    metadata = coalesce(public.leadgen_source_catalog.metadata, '{}'::jsonb) || excluded.metadata,
    updated_at = now();

insert into public.leadgen_source_industry_mappings (source_key, icp_industry_value, native_values, native_label, metadata)
select
    'registry.ca.san_francisco_business_locations',
    industry.value,
    array['registered_business','ownership_name','dba_name'],
    'DataSF registered business ownership names',
    jsonb_build_object(
        'seed', 'leadgen_v5_3_datasf_business_owner_source',
        'mapping_mode', 'bay_area_registered_business_owner_identity',
        'pass', 'owner_identity_v5_3_third_source_pass'
    )
from public.leadgen_icp_industries industry
where industry.enabled = true
on conflict (source_key, icp_industry_value)
do update set native_values = (
        select array_agg(distinct value order by value)
        from unnest(public.leadgen_source_industry_mappings.native_values || excluded.native_values) as merged(value)
    ),
    native_label = excluded.native_label,
    enabled = true,
    metadata = coalesce(public.leadgen_source_industry_mappings.metadata, '{}'::jsonb) || excluded.metadata,
    updated_at = now();

insert into public.leadgen_source_location_mappings (source_key, icp_location_value, native_values, metadata)
values (
    'registry.ca.san_francisco_business_locations',
    'bay_area_ca',
    array['San Francisco','Oakland','San Jose'],
    '{"seed":"leadgen_v5_3_datasf_business_owner_source","state":"CA","cities":["San Francisco","Oakland","San Jose"],"mapping_mode":"bay_area_registered_business_owner_identity","pass":"owner_identity_v5_3_third_source_pass"}'::jsonb
)
on conflict (source_key, icp_location_value)
do update set native_values = excluded.native_values,
    enabled = true,
    metadata = coalesce(public.leadgen_source_location_mappings.metadata, '{}'::jsonb) || excluded.metadata,
    updated_at = now();

insert into public.leadgen_source_stage_capabilities (source_key, stage_key, priority, metadata, enabled)
values (
    'registry.ca.san_francisco_business_locations',
    'owner_identity',
    52,
    '{"reason":"datasf_registered_business_ownership_name","pass":"owner_identity_v5_3_third_source_pass"}'::jsonb,
    true
)
on conflict (source_key, stage_key)
do update set enabled = true,
    priority = excluded.priority,
    metadata = coalesce(public.leadgen_source_stage_capabilities.metadata, '{}'::jsonb) || excluded.metadata,
    updated_at = now();

update public.leadgen_source_catalog source
set stage_capabilities = coalesce(capabilities.stage_capabilities, '[]'::jsonb),
    updated_at = now()
from (
    select source_key,
        jsonb_agg(jsonb_build_object('stage_key', stage_key, 'priority', priority) order by priority, stage_key) as stage_capabilities
    from public.leadgen_source_stage_capabilities
    where enabled = true
    group by source_key
) capabilities
where source.source_key = capabilities.source_key
and source.source_key = 'registry.ca.san_francisco_business_locations';

insert into public.leadgen_source_health (source_key, status, last_error, metadata)
values (
    'registry.ca.san_francisco_business_locations',
    'unknown',
    null,
    '{"adapter_seeded_by":"20260706221000_leadgen_v53_datasf_business_owner_source","pass":"owner_identity_v5_3_third_source_pass"}'::jsonb
)
on conflict (source_key) do update set
    status = excluded.status,
    last_error = excluded.last_error,
    metadata = coalesce(public.leadgen_source_health.metadata, '{}'::jsonb) || excluded.metadata,
    updated_at = now();

with default_sources(source_key) as (
    values ('registry.ca.san_francisco_business_locations')
),
expanded_settings as (
    select settings.workspace_id, jsonb_array_elements_text(settings.enabled_sources) as source_key
    from public.leadgen_workspace_settings settings
    union
    select settings.workspace_id, default_sources.source_key
    from public.leadgen_workspace_settings settings
    cross join default_sources
),
aggregated_settings as (
    select workspace_id, jsonb_agg(source_key order by source_key) as enabled_sources
    from (
        select distinct workspace_id, source_key
        from expanded_settings
        where source_key is not null and source_key <> ''
    ) deduped_settings
    group by workspace_id
)
update public.leadgen_workspace_settings settings
set enabled_sources = aggregated_settings.enabled_sources,
    updated_at = now()
from aggregated_settings
where settings.workspace_id = aggregated_settings.workspace_id;
