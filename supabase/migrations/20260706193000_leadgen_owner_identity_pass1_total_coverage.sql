-- Pass 1 owner-identity coverage contract.
-- The settings selector currently exposes every enabled ICP industry and the v1 location set.
-- This migration guarantees every enabled industry/location combo has at least one non-crawler
-- owner-identity source mapped to it, and makes the guarded public-record adapters explicit.

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
) values
    (
        'registry.fl.fictitious_names',
        'Florida Sunbiz fictitious names',
        'registries',
        3,
        3,
        0,
        2,
        'public_html',
        'free',
        'active',
        'candidate_investigation',
        true,
        1600,
        '{"states":["FL"],"industries":["all_enabled"]}'::jsonb,
        '{
            "adapter":"guarded_html_search",
            "poll_safe_html":true,
            "source_url":"https://search.sunbiz.org/Inquiry/CorporationSearch/ByName",
            "search_url":"https://search.sunbiz.org/Inquiry/CorporationSearch/SearchResults/FictitiousName/{query}/Page1",
            "provenance_url":"https://search.sunbiz.org/Inquiry/CorporationSearch/ByName",
            "claim_profile":"florida_sunbiz_fictitious_name_search",
            "identity_claim_kind":"owner_identity",
            "person_role":"fictitious_name_owner_or_registrant",
            "query_limit":10,
            "owner_identity_points_on_match":3,
            "owner_phone_points_on_match":0,
            "business_support_points_on_match":2,
            "default_record_type":"Florida Sunbiz fictitious name record",
            "phone_note":"Sunbiz fictitious-name records can expose registrants or owners, but no direct owner phone field is counted.",
            "source_role":"direct_owner_identity",
            "pass":"owner_identity_pass1_total_coverage",
            "field_map":{
                "business_name":["business_name"],
                "owner_name":["owner_name"],
                "phone":["phone"],
                "record_id":["record_id"],
                "status":["status"],
                "record_type":["record_type"],
                "additional_match_name":["raw_cells"]
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

update public.leadgen_source_catalog
set implementation_status = 'active',
    run_stage = 'candidate_investigation',
    enabled = true,
    metadata = coalesce(metadata, '{}'::jsonb) || '{"poll_safe_html":true,"pass":"owner_identity_pass1_total_coverage"}'::jsonb,
    updated_at = now()
where source_key in (
    'registry.fl.sunbiz',
    'state_license.fl.fdacs_pest',
    'state_license.fl.fdacs_auto_repair',
    'registry.fl.miami_dade_lbt',
    'registry.fl.tampa_btr',
    'registry.fl.jacksonville_btr',
    'registry.ca.bizfile',
    'state_license.az.roc',
    'state_license.az.pest_management',
    'registry.az.corp_commission'
);

with enabled_industries as (
    select value, label, category
    from public.leadgen_icp_industries
    where enabled = true
),
broad_owner_sources(source_key, state_code, native_label) as (
    values
        ('registry.tx.comptroller', 'TX', 'Texas Comptroller entity/officer search'),
        ('registry.fl.sunbiz', 'FL', 'Florida Sunbiz entity/officer search'),
        ('registry.fl.fictitious_names', 'FL', 'Florida Sunbiz fictitious-name registrants'),
        ('registry.ca.bizfile', 'CA', 'California Bizfile entity search'),
        ('registry.az.corp_commission', 'AZ', 'Arizona Corporation Commission entity search')
)
insert into public.leadgen_source_industry_mappings (source_key, icp_industry_value, native_values, native_label, metadata)
select source.source_key,
    industry.value,
    array[industry.value, lower(regexp_replace(industry.label, '[^a-zA-Z0-9]+', '_', 'g'))],
    source.native_label,
    jsonb_build_object(
        'seed', 'owner_identity_pass1_total_coverage',
        'state', source.state_code,
        'category', industry.category,
        'mapping_mode', 'broad_state_owner_registry'
    )
from broad_owner_sources source
cross join enabled_industries industry
on conflict (source_key, icp_industry_value)
do update set native_values = (
        select array_agg(distinct value order by value)
        from unnest(public.leadgen_source_industry_mappings.native_values || excluded.native_values) as merged(value)
    ),
    native_label = excluded.native_label,
    enabled = true,
    metadata = coalesce(public.leadgen_source_industry_mappings.metadata, '{}'::jsonb) || excluded.metadata,
    updated_at = now();

with state_sources(source_key, state_code) as (
    values
        ('registry.tx.comptroller', 'TX'),
        ('registry.fl.sunbiz', 'FL'),
        ('registry.fl.fictitious_names', 'FL'),
        ('registry.ca.bizfile', 'CA'),
        ('registry.az.corp_commission', 'AZ')
),
target_locations as (
    select value, label, country, region, locality, location_kind
    from public.leadgen_icp_locations
    where enabled = true
    and country = 'US'
    and region in ('TX', 'FL', 'CA', 'AZ')
)
insert into public.leadgen_source_location_mappings (source_key, icp_location_value, native_values, metadata)
select source.source_key,
    location.value,
    array[coalesce(location.locality, location.region, location.value)],
    jsonb_build_object(
        'seed', 'owner_identity_pass1_total_coverage',
        'state', source.state_code,
        'region', location.region,
        'locality', location.locality,
        'location_kind', location.location_kind,
        'mapping_mode', 'broad_state_owner_registry'
    )
from state_sources source
join target_locations location on location.region = source.state_code
on conflict (source_key, icp_location_value)
do update set native_values = excluded.native_values,
    enabled = true,
    metadata = coalesce(public.leadgen_source_location_mappings.metadata, '{}'::jsonb) || excluded.metadata,
    updated_at = now();

with capabilities(source_key, stage_key, priority, metadata) as (
    values
        ('registry.tx.comptroller', 'owner_identity', 38, '{"reason":"state_entity_officer_or_registered_agent","pass":"owner_identity_pass1_total_coverage"}'::jsonb),
        ('registry.fl.sunbiz', 'owner_identity', 40, '{"reason":"state_entity_officer_or_registered_agent","pass":"owner_identity_pass1_total_coverage"}'::jsonb),
        ('registry.fl.fictitious_names', 'owner_identity', 41, '{"reason":"state_fictitious_name_registrant","pass":"owner_identity_pass1_total_coverage"}'::jsonb),
        ('state_license.fl.fdacs_pest', 'owner_identity', 46, '{"reason":"pest_license_principal","pass":"owner_identity_pass1_total_coverage"}'::jsonb),
        ('state_license.fl.fdacs_auto_repair', 'owner_identity', 48, '{"reason":"motor_vehicle_repair_registrant","pass":"owner_identity_pass1_total_coverage"}'::jsonb),
        ('registry.fl.miami_dade_lbt', 'owner_identity', 58, '{"reason":"local_business_tax_owner","pass":"owner_identity_pass1_total_coverage"}'::jsonb),
        ('registry.fl.tampa_btr', 'owner_identity', 60, '{"reason":"local_business_tax_owner","pass":"owner_identity_pass1_total_coverage"}'::jsonb),
        ('registry.fl.jacksonville_btr', 'owner_identity', 62, '{"reason":"local_business_tax_owner","pass":"owner_identity_pass1_total_coverage"}'::jsonb),
        ('registry.ca.bizfile', 'owner_identity', 50, '{"reason":"state_entity_officer_or_registered_agent","pass":"owner_identity_pass1_total_coverage"}'::jsonb),
        ('state_license.az.roc', 'owner_identity', 38, '{"reason":"roc_qualifying_party","pass":"owner_identity_pass1_total_coverage"}'::jsonb),
        ('state_license.az.pest_management', 'owner_identity', 48, '{"reason":"pest_license_qualifying_party","pass":"owner_identity_pass1_total_coverage"}'::jsonb),
        ('registry.az.corp_commission', 'owner_identity', 44, '{"reason":"state_entity_officer_or_statutory_agent","pass":"owner_identity_pass1_total_coverage"}'::jsonb)
)
insert into public.leadgen_source_stage_capabilities (source_key, stage_key, priority, metadata, enabled)
select capabilities.source_key, capabilities.stage_key, capabilities.priority, capabilities.metadata, true
from capabilities
join public.leadgen_source_catalog source on source.source_key = capabilities.source_key
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
and source.source_key in (
    'registry.tx.comptroller',
    'registry.fl.sunbiz',
    'registry.fl.fictitious_names',
    'state_license.fl.fdacs_pest',
    'state_license.fl.fdacs_auto_repair',
    'registry.fl.miami_dade_lbt',
    'registry.fl.tampa_btr',
    'registry.fl.jacksonville_btr',
    'registry.ca.bizfile',
    'state_license.az.roc',
    'state_license.az.pest_management',
    'registry.az.corp_commission'
);

insert into public.leadgen_source_health (source_key, status, last_error, metadata)
values
    ('registry.fl.sunbiz', 'unknown', null, '{"adapter_seeded_by":"20260706193000_leadgen_owner_identity_pass1_total_coverage"}'::jsonb),
    ('registry.fl.fictitious_names', 'unknown', null, '{"adapter_seeded_by":"20260706193000_leadgen_owner_identity_pass1_total_coverage"}'::jsonb),
    ('state_license.fl.fdacs_pest', 'unknown', null, '{"adapter_seeded_by":"20260706193000_leadgen_owner_identity_pass1_total_coverage"}'::jsonb),
    ('state_license.fl.fdacs_auto_repair', 'unknown', null, '{"adapter_seeded_by":"20260706193000_leadgen_owner_identity_pass1_total_coverage"}'::jsonb),
    ('registry.fl.miami_dade_lbt', 'unknown', null, '{"adapter_seeded_by":"20260706193000_leadgen_owner_identity_pass1_total_coverage"}'::jsonb),
    ('registry.fl.tampa_btr', 'unknown', null, '{"adapter_seeded_by":"20260706193000_leadgen_owner_identity_pass1_total_coverage"}'::jsonb),
    ('registry.fl.jacksonville_btr', 'unknown', null, '{"adapter_seeded_by":"20260706193000_leadgen_owner_identity_pass1_total_coverage"}'::jsonb),
    ('registry.ca.bizfile', 'unknown', null, '{"adapter_seeded_by":"20260706193000_leadgen_owner_identity_pass1_total_coverage"}'::jsonb),
    ('state_license.az.roc', 'unknown', null, '{"adapter_seeded_by":"20260706193000_leadgen_owner_identity_pass1_total_coverage"}'::jsonb),
    ('state_license.az.pest_management', 'unknown', null, '{"adapter_seeded_by":"20260706193000_leadgen_owner_identity_pass1_total_coverage"}'::jsonb),
    ('registry.az.corp_commission', 'unknown', null, '{"adapter_seeded_by":"20260706193000_leadgen_owner_identity_pass1_total_coverage"}'::jsonb)
on conflict (source_key) do update set
    status = excluded.status,
    last_error = excluded.last_error,
    metadata = coalesce(public.leadgen_source_health.metadata, '{}'::jsonb) || excluded.metadata,
    updated_at = now();

with default_sources(source_key) as (
    values
        ('registry.tx.comptroller'),
        ('registry.fl.sunbiz'),
        ('registry.fl.fictitious_names'),
        ('registry.ca.bizfile'),
        ('registry.az.corp_commission')
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
