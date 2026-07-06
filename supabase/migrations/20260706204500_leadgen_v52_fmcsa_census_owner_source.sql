-- Lead Gen v5.2 owner-identity source pass.
-- Adds a stable official DOT source that exposes carrier company-officer names.

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
    'transport.fmcsa_census',
    'FMCSA Company Census officers',
    'transport',
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
    '{"countries":["US"],"industries":["trucking_companies","moving_companies","freight_forwarders","hauling_services","dumpster_rental","waste_disposal"]}'::jsonb,
    '{
        "adapter":"fmcsa_company_census",
        "domain":"data.transportation.gov",
        "dataset_id":"az4n-8mr2",
        "source_url":"https://data.transportation.gov/Trucking-and-Motorcoaches/Company-Census-File/az4n-8mr2",
        "provenance_url":"https://data.transportation.gov/Trucking-and-Motorcoaches/Company-Census-File/az4n-8mr2",
        "claim_profile":"fmcsa_company_census_officer",
        "identity_claim_kind":"officer_identity",
        "person_role":"company_officer",
        "query_limit":12,
        "search_term_limit":4,
        "owner_identity_points_on_match":3,
        "owner_phone_points_on_match":0,
        "business_support_points_on_match":2,
        "phone_note":"FMCSA Company Census records can expose business phone/cell fields, but they are not counted as direct owner-phone evidence in v5.2.",
        "source_role":"direct_owner_identity",
        "pass":"owner_identity_v5_2_second_source_pass",
        "field_map":{
            "business_name":["business_name","legal_name","dba_name"],
            "owner_name":["owner_name","officer_name"],
            "phone":["phone"],
            "address":["street"],
            "city":["city"],
            "state":["state"],
            "postcode":["postcode"],
            "record_id":["dot_number","record_id"],
            "status":["status"],
            "record_type":["record_type","carrier_operation"],
            "additional_match_name":["carrier_operation"]
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

with target_industries(value, native_values, native_label) as (
    values
        ('trucking_companies', array['carrier','motor_carrier','trucking','company_officer'], 'FMCSA Company Census carrier officers'),
        ('moving_companies', array['carrier','motor_carrier','moving','household_goods','company_officer'], 'FMCSA Company Census carrier officers'),
        ('freight_forwarders', array['freight_forwarder','broker','carrier','company_officer'], 'FMCSA Company Census carrier officers'),
        ('hauling_services', array['carrier','hauling','company_officer'], 'FMCSA Company Census carrier officers'),
        ('dumpster_rental', array['carrier','hauling','waste','company_officer'], 'FMCSA Company Census carrier officers'),
        ('waste_disposal', array['carrier','waste','refuse','company_officer'], 'FMCSA Company Census carrier officers')
)
insert into public.leadgen_source_industry_mappings (source_key, icp_industry_value, native_values, native_label, metadata)
select
    'transport.fmcsa_census',
    industry.value,
    industry.native_values,
    industry.native_label,
    jsonb_build_object(
        'seed', 'leadgen_v5_2_fmcsa_census_owner_source',
        'mapping_mode', 'national_transport_owner_identity',
        'pass', 'owner_identity_v5_2_second_source_pass'
    )
from target_industries industry
join public.leadgen_icp_industries icp on icp.value = industry.value and icp.enabled = true
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
select
    'transport.fmcsa_census',
    location.value,
    array[coalesce(location.region, location.country, location.value)],
    jsonb_build_object(
        'seed', 'leadgen_v5_2_fmcsa_census_owner_source',
        'country', location.country,
        'region', location.region,
        'locality', location.locality,
        'location_kind', location.location_kind,
        'mapping_mode', 'national_transport_owner_identity',
        'pass', 'owner_identity_v5_2_second_source_pass'
    )
from public.leadgen_icp_locations location
where location.enabled = true
and location.country = 'US'
on conflict (source_key, icp_location_value)
do update set native_values = excluded.native_values,
    enabled = true,
    metadata = coalesce(public.leadgen_source_location_mappings.metadata, '{}'::jsonb) || excluded.metadata,
    updated_at = now();

insert into public.leadgen_source_stage_capabilities (source_key, stage_key, priority, metadata, enabled)
values (
    'transport.fmcsa_census',
    'owner_identity',
    34,
    '{"reason":"fmcsa_company_officer","pass":"owner_identity_v5_2_second_source_pass"}'::jsonb,
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
and source.source_key = 'transport.fmcsa_census';

insert into public.leadgen_source_health (source_key, status, last_error, metadata)
values (
    'transport.fmcsa_census',
    'unknown',
    null,
    '{"adapter_seeded_by":"20260706204500_leadgen_v52_fmcsa_census_owner_source","pass":"owner_identity_v5_2_second_source_pass"}'::jsonb
)
on conflict (source_key) do update set
    status = excluded.status,
    last_error = excluded.last_error,
    metadata = coalesce(public.leadgen_source_health.metadata, '{}'::jsonb) || excluded.metadata,
    updated_at = now();

with default_sources(source_key) as (
    values ('transport.fmcsa_census')
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
