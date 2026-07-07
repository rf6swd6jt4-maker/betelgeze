-- Lead Gen v5.5.5 California stabilization.
-- Adds San Diego Business Tax Certificate owner shards and keeps CSLB catalogued
-- but inactive until a stable non-form bulk/detail path is proven.

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
)
values (
    'registry.ca.san_diego_business_tax',
    'San Diego business tax certificates',
    'registries',
    3,
    3,
    0,
    2,
    'public_bulk_download_shards',
    'free',
    'active',
    'candidate_investigation',
    true,
    40,
    '{"states":["CA"],"cities":["San Diego"],"industries":["all_enabled"],"source_scope":"city_business_tax_certificate_external_owner_shards"}'::jsonb,
    '{
        "adapter":"california_owner_shard_lookup",
        "poll_safety":"external_shard_lookup",
        "shard_base_url_env":"CA_OWNER_SHARD_BASE_URL",
        "shard_version":"v1",
        "shard_prefix_length":3,
        "shard_source_path":"san_diego_business_tax",
        "source_url":"https://seshat.datasd.org/business_tax_certificates/sd_businesses_active_datasd.csv",
        "provenance_url":"https://data.sandiego.gov/datasets/business-tax-certificates/",
        "claim_profile":"san_diego_business_tax_certificate_owner_shards",
        "identity_claim_kind":"owner_identity",
        "person_role":"business_tax_certificate_owner",
        "query_limit":24,
        "search_term_limit":8,
        "max_rows_to_match":120,
        "owner_identity_points_on_match":3,
        "owner_phone_points_on_match":0,
        "business_support_points_on_match":2,
        "source_role":"direct_owner_identity",
        "statewide_fanout":true,
        "require_address_or_locality_match":true,
        "minimum_locality_address_score":0.34,
        "pass":"owner_identity_v5_5_5_california_san_diego_shards",
        "field_map":{
            "business_name":["business_name"],
            "owner_name":["owner_name","person_name"],
            "person_name":["person_name"],
            "address":["address"],
            "city":["city"],
            "state":["state"],
            "postcode":["postcode"],
            "record_id":["record_id"],
            "status":["status"],
            "record_type":["record_type"]
        }
    }'::jsonb
)
on conflict (source_key)
do update set
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

insert into public.leadgen_source_industry_mappings (source_key, icp_industry_value, native_values, native_label, metadata, enabled)
select
    'registry.ca.san_diego_business_tax',
    industry.value,
    array['business_name','owner_name','person_name','address_or_locality_required'],
    'San Diego business tax certificate owner shards',
    jsonb_build_object(
        'seed', 'leadgen_v5_5_5_ca_sandiego_shards_and_debug',
        'state', 'CA',
        'mapping_mode', 'california_city_business_tax_external_owner_identity',
        'match_policy', 'address_or_locality_required',
        'pass', 'owner_identity_v5_5_5_california_san_diego_shards'
    ),
    true
from public.leadgen_icp_industries industry
where industry.enabled = true
on conflict (source_key, icp_industry_value)
do update set native_values = excluded.native_values,
    native_label = excluded.native_label,
    enabled = true,
    metadata = coalesce(public.leadgen_source_industry_mappings.metadata, '{}'::jsonb) || excluded.metadata,
    updated_at = now();

insert into public.leadgen_source_location_mappings (source_key, icp_location_value, native_values, metadata, enabled)
select
    'registry.ca.san_diego_business_tax',
    location.value,
    array['CA','San Diego business tax certificate external shards'],
    jsonb_build_object(
        'seed', 'leadgen_v5_5_5_ca_sandiego_shards_and_debug',
        'state', 'CA',
        'mapping_mode', 'california_city_business_tax_external_owner_identity',
        'match_policy', 'address_or_locality_required',
        'pass', 'owner_identity_v5_5_5_california_san_diego_shards'
    ),
    true
from public.leadgen_icp_locations location
where location.enabled = true
and location.country = 'US'
and location.region = 'CA'
on conflict (source_key, icp_location_value)
do update set native_values = excluded.native_values,
    enabled = true,
    metadata = coalesce(public.leadgen_source_location_mappings.metadata, '{}'::jsonb) || excluded.metadata,
    updated_at = now();

insert into public.leadgen_source_stage_capabilities (source_key, stage_key, priority, metadata, enabled)
values (
    'registry.ca.san_diego_business_tax',
    'owner_identity',
    38,
    '{"reason":"san_diego_business_tax_certificate_external_owner_shards","pass":"owner_identity_v5_5_5_california_san_diego_shards"}'::jsonb,
    true
)
on conflict (source_key, stage_key)
do update set enabled = true,
    priority = excluded.priority,
    metadata = coalesce(public.leadgen_source_stage_capabilities.metadata, '{}'::jsonb) || excluded.metadata,
    updated_at = now();

update public.leadgen_source_catalog source
set stage_capabilities = coalesce((
        select jsonb_agg(jsonb_build_object('stage_key', stage_key, 'priority', priority) order by priority, stage_key)
        from public.leadgen_source_stage_capabilities capabilities
        where capabilities.source_key = source.source_key
        and capabilities.enabled = true
    ), '[]'::jsonb),
    updated_at = now()
where source.source_key = 'registry.ca.san_diego_business_tax';

insert into public.leadgen_source_health (source_key, status, last_error, metadata)
values (
    'registry.ca.san_diego_business_tax',
    'unknown',
    null,
    '{"adapter_seeded_by":"20260708014500_leadgen_v555_ca_sandiego_shards_and_debug","requires_env":"CA_OWNER_SHARD_BASE_URL","lookup_mode":"external_shards","match_policy":"address_or_locality_required"}'::jsonb
)
on conflict (source_key) do update set
    status = excluded.status,
    last_error = excluded.last_error,
    metadata = coalesce(public.leadgen_source_health.metadata, '{}'::jsonb) || excluded.metadata,
    updated_at = now();

with expanded_settings as (
    select settings.workspace_id, jsonb_array_elements_text(settings.enabled_sources) as source_key
    from public.leadgen_workspace_settings settings
    where settings.enabled_sources is not null
    union
    select settings.workspace_id, 'registry.ca.san_diego_business_tax'
    from public.leadgen_workspace_settings settings
),
aggregated_settings as (
    select workspace_id, jsonb_agg(source_key order by source_key) as enabled_sources
    from (
        select distinct workspace_id, source_key
        from expanded_settings
        where source_key is not null
        and source_key <> ''
    ) deduped_settings
    group by workspace_id
)
update public.leadgen_workspace_settings settings
set enabled_sources = aggregated_settings.enabled_sources,
    updated_at = now()
from aggregated_settings
where settings.workspace_id = aggregated_settings.workspace_id;
