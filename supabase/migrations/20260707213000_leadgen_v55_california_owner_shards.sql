-- Lead Gen v5.5 California contractor owner-identity pass.
-- Makes California poll-time owner discovery stable by using CSLB plus compact external CA owner shards.

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
        'state_license.ca.cslb',
        'California CSLB contractor licenses',
        'licensing',
        3,
        3,
        0,
        2,
        'public_html',
        'free',
        'active',
        'candidate_investigation',
        true,
        900,
        '{"states":["CA"],"industries":["all_enabled"],"source_scope":"statewide_contractor_licensing"}'::jsonb,
        '{}'::jsonb
    ),
    (
        'registry.ca.los_angeles_fbn',
        'Los Angeles County fictitious business names',
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
        80,
        '{"states":["CA"],"counties":["Los Angeles"],"industries":["all_enabled"],"source_scope":"county_fictitious_business_names"}'::jsonb,
        '{}'::jsonb
    ),
    (
        'registry.ca.san_francisco_business_locations',
        'San Francisco registered businesses',
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
        80,
        '{"states":["CA"],"counties":["San Francisco"],"cities":["San Francisco","Oakland","San Jose"],"industries":["all_enabled"],"source_scope":"bay_area_registered_business_locations"}'::jsonb,
        '{}'::jsonb
    ),
    (
        'regulated.ca.calrecycle_waste',
        'California CalRecycle waste hauler records',
        'regulated',
        3,
        1,
        0,
        2,
        'public_bulk_download_shards',
        'free',
        'active',
        'candidate_investigation',
        true,
        80,
        '{"states":["CA"],"industries":["waste_disposal"],"source_scope":"statewide_waste_records"}'::jsonb,
        '{}'::jsonb
    ),
    (
        'registry.ca.bizfile',
        'California Bizfile officers',
        'registries',
        2,
        2,
        0,
        2,
        'public_bulk_or_api_needed',
        'free',
        'planned',
        'source_specific_configuration',
        false,
        1500,
        '{"states":["CA"]}'::jsonb,
        '{}'::jsonb
    )
on conflict (source_key) do nothing;

update public.leadgen_source_catalog
set implementation_status = 'active',
    run_stage = 'candidate_investigation',
    enabled = true,
    access_method = 'public_html',
    free_status = 'free',
    source_points = 3,
    owner_identity_points = 3,
    owner_phone_points = 0,
    business_support_points = 2,
    rate_limit_ms = 900,
    coverage = '{"states":["CA"],"industries":["all_enabled"],"source_scope":"statewide_contractor_licensing"}'::jsonb,
    metadata = (
        coalesce(metadata, '{}'::jsonb)
        - 'needs_adapter'
        - 'blocked_by'
        - 'reason'
    ) || '{
        "adapter":"cslb_license_search",
        "source_url":"https://www.cslb.ca.gov/onlineservices/checklicenseII/checklicense.aspx",
        "provenance_url":"https://www.cslb.ca.gov/onlineservices/checklicenseII/checklicense.aspx",
        "claim_profile":"california_cslb_contractor_license",
        "identity_claim_kind":"owner_identity",
        "person_role":"qualifying_individual",
        "query_limit":8,
        "search_term_limit":8,
        "owner_identity_points_on_match":3,
        "owner_phone_points_on_match":0,
        "business_support_points_on_match":2,
        "source_role":"direct_owner_identity",
        "pass":"owner_identity_v5_5_california_owner_shards",
        "phone_note":"CSLB exposes business phone plus qualifying individual where present; the phone is counted as business-phone support unless a direct owner phone source later confirms it.",
        "field_map":{
            "business_name":["business_name","contractor_name"],
            "contractor_name":["contractor_name"],
            "owner_name":["owner_name"],
            "phone":["phone"],
            "address":["street"],
            "city":["city"],
            "state":["state"],
            "postcode":["postcode"],
            "record_id":["license_number"],
            "status":["status"],
            "record_type":["record_type","classifications"],
            "additional_match_name":["entity"]
        }
    }'::jsonb,
    updated_at = now()
where source_key = 'state_license.ca.cslb';

with source_updates(source_key, label, family, source_path, claim_profile, identity_claim_kind, person_role, points, support_points, priority, coverage, provenance_url, source_url, field_map) as (
    values
        (
            'registry.ca.los_angeles_fbn',
            'Los Angeles County fictitious business names',
            'registries',
            'los_angeles_fbn',
            'los_angeles_county_fictitious_business_name_shards',
            'owner_identity',
            'registered_fbn_owner',
            3,
            2,
            38,
            '{"states":["CA"],"counties":["Los Angeles"],"industries":["all_enabled"],"source_scope":"county_fictitious_business_names"}'::jsonb,
            'https://public.gis.lacounty.gov/portal/apps/sites/#/opendata/items/2401223c34864b7b9e5884b6229a1d3c',
            'https://services.arcgis.com/RmCCgQtiZLDCtblq/arcgis/rest/services/Fictitious_Business_Name/FeatureServer/0',
            '{"business_name":["business_name"],"owner_name":["owner_name","person_name"],"person_name":["person_name"],"address":["address"],"city":["city"],"state":["state"],"postcode":["postcode"],"record_id":["record_id"],"status":["status"],"record_type":["record_type"],"additional_match_name":["raw_payload"]}'::jsonb
        ),
        (
            'registry.ca.san_francisco_business_locations',
            'San Francisco registered businesses',
            'registries',
            'san_francisco_business_locations',
            'san_francisco_registered_business_owner_shards',
            'owner_identity',
            'business_owner',
            3,
            2,
            40,
            '{"states":["CA"],"counties":["San Francisco"],"cities":["San Francisco","Oakland","San Jose"],"industries":["all_enabled"],"source_scope":"bay_area_registered_business_locations"}'::jsonb,
            'https://data.sfgov.org/Economy-and-Community/Registered-Business-Locations-San-Francisco/g8m3-pdis',
            'https://data.sfgov.org/resource/g8m3-pdis.json',
            '{"business_name":["business_name"],"owner_name":["owner_name","person_name"],"person_name":["person_name"],"address":["address"],"city":["city"],"state":["state"],"postcode":["postcode"],"record_id":["record_id"],"status":["status"],"record_type":["record_type"],"additional_match_name":["raw_payload"]}'::jsonb
        ),
        (
            'regulated.ca.calrecycle_waste',
            'California CalRecycle waste hauler records',
            'regulated',
            'calrecycle_waste',
            'california_calrecycle_swis_facility_shards',
            'owner_identity',
            'facility_point_of_contact',
            1,
            2,
            70,
            '{"states":["CA"],"industries":["waste_disposal"],"source_scope":"statewide_waste_records"}'::jsonb,
            'https://calrecycle.ca.gov/',
            'https://services3.arcgis.com/6CawrotsIAWp4yUX/ArcGIS/rest/services/CalRecycle_Solid_Waste_Facilities/FeatureServer/0',
            '{"business_name":["business_name"],"owner_name":["owner_name","person_name"],"person_name":["person_name"],"address":["address"],"city":["city"],"state":["state"],"postcode":["postcode"],"record_id":["record_id"],"status":["status"],"record_type":["record_type"],"additional_match_name":["raw_payload"]}'::jsonb
        )
)
update public.leadgen_source_catalog source
set label = source_updates.label,
    family = source_updates.family,
    source_points = 3,
    owner_identity_points = source_updates.points,
    owner_phone_points = 0,
    business_support_points = source_updates.support_points,
    access_method = 'public_bulk_download_shards',
    free_status = 'free',
    implementation_status = 'active',
    run_stage = 'candidate_investigation',
    enabled = true,
    rate_limit_ms = 80,
    coverage = source_updates.coverage,
    metadata = (
        coalesce(source.metadata, '{}'::jsonb)
        - 'adapter'
        - 'poll_safety'
        - 'service_url'
        - 'domain'
        - 'dataset_id'
        - 'where_clause'
        - 'search_fields'
        - 'needs_adapter'
        - 'blocked_by'
        - 'reason'
    ) || jsonb_build_object(
        'adapter', 'california_owner_shard_lookup',
        'poll_safety', 'external_shard_lookup',
        'shard_base_url_env', 'CA_OWNER_SHARD_BASE_URL',
        'shard_version', 'v1',
        'shard_prefix_length', 3,
        'shard_source_path', source_updates.source_path,
        'source_url', source_updates.source_url,
        'provenance_url', source_updates.provenance_url,
        'claim_profile', source_updates.claim_profile,
        'identity_claim_kind', source_updates.identity_claim_kind,
        'person_role', source_updates.person_role,
        'query_limit', 20,
        'search_term_limit', 8,
        'owner_identity_points_on_match', source_updates.points,
        'owner_phone_points_on_match', 0,
        'business_support_points_on_match', source_updates.support_points,
        'source_role', 'direct_owner_identity',
        'pass', 'owner_identity_v5_5_california_owner_shards',
        'field_map', source_updates.field_map
    ),
    updated_at = now()
from source_updates
where source.source_key = source_updates.source_key;

update public.leadgen_source_catalog
set implementation_status = 'planned',
    enabled = false,
    access_method = 'public_bulk_or_api_needed',
    rate_limit_ms = 1500,
    metadata = (
        coalesce(metadata, '{}'::jsonb)
        - 'adapter'
        - 'search_url'
        - 'poll_safe_html'
        - 'fragile_polling_disabled_by'
    ) || '{
        "adapter":"california_external_lookup_required",
        "poll_safety":"stable_endpoint_required",
        "blocked_by":"bizfile_incapsula_challenge",
        "reason":"California Bizfile remains catalogued, but v5.5 removes it from poll-time execution until a stable bulk/API path exists.",
        "pass":"owner_identity_v5_5_california_owner_shards"
    }'::jsonb,
    updated_at = now()
where source_key = 'registry.ca.bizfile';

insert into public.leadgen_source_industry_mappings (source_key, icp_industry_value, native_values, native_label, metadata)
select
    'state_license.ca.cslb',
    industry.value,
    array['CSLB','qualifying_individual','contractor_license'],
    'California CSLB contractor licensing',
    jsonb_build_object(
        'seed', 'leadgen_v5_5_california_owner_shards',
        'state', 'CA',
        'mapping_mode', 'statewide_contractor_owner_identity',
        'pass', 'owner_identity_v5_5_california_owner_shards'
    )
from public.leadgen_icp_industries industry
where industry.enabled = true
and industry.value in (
    'bathroom_remodelling',
    'concrete_contractors',
    'deck_builders',
    'electricians',
    'excavation_contractors',
    'fencing_contractors',
    'flooring_contractors',
    'garage_door_companies',
    'general_contractors',
    'hardscaping_contractors',
    'home_builders',
    'hvac_contractors',
    'insulation_contractors',
    'kitchen_remodelling',
    'landscapers',
    'lighting_contractors',
    'masonry_contractors',
    'painters',
    'patio_contractors',
    'paving_contractors',
    'plumbers',
    'pool_builders',
    'remodellers',
    'restoration_companies',
    'roofers',
    'siding_contractors',
    'solar_installers',
    'tree_services',
    'water_damage_restoration',
    'water_well_services',
    'window_and_door_contractors'
)
on conflict (source_key, icp_industry_value)
do update set native_values = (
        select array_agg(distinct value order by value)
        from unnest(public.leadgen_source_industry_mappings.native_values || excluded.native_values) as merged(value)
    ),
    native_label = excluded.native_label,
    enabled = true,
    metadata = coalesce(public.leadgen_source_industry_mappings.metadata, '{}'::jsonb) || excluded.metadata,
    updated_at = now();

insert into public.leadgen_source_industry_mappings (source_key, icp_industry_value, native_values, native_label, metadata)
select
    source.source_key,
    industry.value,
    array['business_name','owner_name','person_name'],
    source.native_label,
    jsonb_build_object(
        'seed', 'leadgen_v5_5_california_owner_shards',
        'state', 'CA',
        'mapping_mode', source.mapping_mode,
        'pass', 'owner_identity_v5_5_california_owner_shards'
    )
from (values
    ('registry.ca.los_angeles_fbn', 'California county FBN owner names', 'county_fbn_owner_identity'),
    ('registry.ca.san_francisco_business_locations', 'DataSF registered business ownership names', 'bay_area_registered_business_owner_identity')
) as source(source_key, native_label, mapping_mode)
cross join public.leadgen_icp_industries industry
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
select
    'state_license.ca.cslb',
    location.value,
    array['CA'],
    jsonb_build_object(
        'seed', 'leadgen_v5_5_california_owner_shards',
        'state', 'CA',
        'mapping_mode', 'statewide_contractor_owner_identity',
        'pass', 'owner_identity_v5_5_california_owner_shards'
    )
from public.leadgen_icp_locations location
where location.enabled = true
and location.country = 'US'
and location.region = 'CA'
on conflict (source_key, icp_location_value)
do update set native_values = excluded.native_values,
    enabled = true,
    metadata = coalesce(public.leadgen_source_location_mappings.metadata, '{}'::jsonb) || excluded.metadata,
    updated_at = now();

insert into public.leadgen_source_location_mappings (source_key, icp_location_value, native_values, metadata)
values
    ('registry.ca.los_angeles_fbn', 'los_angeles_ca', array['Los Angeles County'], '{"seed":"leadgen_v5_5_california_owner_shards","state":"CA","county":"Los Angeles","mapping_mode":"county_fbn_owner_identity","pass":"owner_identity_v5_5_california_owner_shards"}'::jsonb),
    ('registry.ca.san_francisco_business_locations', 'bay_area_ca', array['San Francisco','Oakland','San Jose'], '{"seed":"leadgen_v5_5_california_owner_shards","state":"CA","cities":["San Francisco","Oakland","San Jose"],"mapping_mode":"bay_area_registered_business_owner_identity","pass":"owner_identity_v5_5_california_owner_shards"}'::jsonb)
on conflict (source_key, icp_location_value)
do update set native_values = excluded.native_values,
    enabled = true,
    metadata = coalesce(public.leadgen_source_location_mappings.metadata, '{}'::jsonb) || excluded.metadata,
    updated_at = now();

insert into public.leadgen_source_location_mappings (source_key, icp_location_value, native_values, metadata)
select
    'regulated.ca.calrecycle_waste',
    location.value,
    array['CA'],
    jsonb_build_object(
        'seed', 'leadgen_v5_5_california_owner_shards',
        'state', 'CA',
        'mapping_mode', 'statewide_waste_record_identity',
        'pass', 'owner_identity_v5_5_california_owner_shards'
    )
from public.leadgen_icp_locations location
where location.enabled = true
and location.country = 'US'
and location.region = 'CA'
on conflict (source_key, icp_location_value)
do update set native_values = excluded.native_values,
    enabled = true,
    metadata = coalesce(public.leadgen_source_location_mappings.metadata, '{}'::jsonb) || excluded.metadata,
    updated_at = now();

with capabilities(source_key, priority, reason) as (
    values
        ('state_license.ca.cslb', 34, 'cslb_qualifying_individual_statewide_contractor_source'),
        ('registry.ca.los_angeles_fbn', 38, 'la_county_fbn_external_owner_shards'),
        ('registry.ca.san_francisco_business_locations', 40, 'datasf_registered_business_external_owner_shards'),
        ('regulated.ca.calrecycle_waste', 70, 'calrecycle_external_contact_shards')
)
insert into public.leadgen_source_stage_capabilities (source_key, stage_key, priority, metadata, enabled)
select source_key,
    'owner_identity',
    priority,
    jsonb_build_object('reason', reason, 'pass', 'owner_identity_v5_5_california_owner_shards'),
    true
from capabilities
on conflict (source_key, stage_key)
do update set enabled = true,
    priority = excluded.priority,
    metadata = coalesce(public.leadgen_source_stage_capabilities.metadata, '{}'::jsonb) || excluded.metadata,
    updated_at = now();

update public.leadgen_source_stage_capabilities
set enabled = false,
    metadata = coalesce(metadata, '{}'::jsonb) || '{"disabled_by":"leadgen_v5_5_california_owner_shards","reason":"Bizfile public HTML is not stable enough for poll-time execution."}'::jsonb,
    updated_at = now()
where source_key = 'registry.ca.bizfile'
and stage_key in ('business_validation', 'owner_identity', 'owner_phone', 'phone_validation');

update public.leadgen_source_catalog source
set stage_capabilities = coalesce((
        select jsonb_agg(jsonb_build_object('stage_key', stage_key, 'priority', priority) order by priority, stage_key)
        from public.leadgen_source_stage_capabilities capabilities
        where capabilities.source_key = source.source_key
        and capabilities.enabled = true
    ), '[]'::jsonb),
    updated_at = now()
where source.source_key in (
    'state_license.ca.cslb',
    'registry.ca.los_angeles_fbn',
    'registry.ca.san_francisco_business_locations',
    'regulated.ca.calrecycle_waste',
    'registry.ca.bizfile'
);

insert into public.leadgen_source_health (source_key, status, last_error, metadata)
values
    (
        'state_license.ca.cslb',
        'unknown',
        null,
        '{"adapter_seeded_by":"20260707213000_leadgen_v55_california_owner_shards","lookup_mode":"official_public_form"}'::jsonb
    ),
    (
        'registry.ca.los_angeles_fbn',
        'unknown',
        null,
        '{"adapter_seeded_by":"20260707213000_leadgen_v55_california_owner_shards","requires_env":"CA_OWNER_SHARD_BASE_URL","lookup_mode":"external_shards"}'::jsonb
    ),
    (
        'registry.ca.san_francisco_business_locations',
        'unknown',
        null,
        '{"adapter_seeded_by":"20260707213000_leadgen_v55_california_owner_shards","requires_env":"CA_OWNER_SHARD_BASE_URL","lookup_mode":"external_shards"}'::jsonb
    ),
    (
        'regulated.ca.calrecycle_waste',
        'unknown',
        null,
        '{"adapter_seeded_by":"20260707213000_leadgen_v55_california_owner_shards","requires_env":"CA_OWNER_SHARD_BASE_URL","lookup_mode":"external_shards"}'::jsonb
    ),
    (
        'registry.ca.bizfile',
        'blocked',
        'California Bizfile public HTML is challenge-prone; v5.5 keeps it catalogued but disables poll-time execution until a stable bulk/API path exists.',
        '{"adapter_seeded_by":"20260707213000_leadgen_v55_california_owner_shards","lookup_mode":"stable_endpoint_required"}'::jsonb
    )
on conflict (source_key) do update set
    status = excluded.status,
    last_error = excluded.last_error,
    metadata = coalesce(public.leadgen_source_health.metadata, '{}'::jsonb) || excluded.metadata,
    updated_at = now();

with default_sources(source_key) as (
    values
        ('state_license.ca.cslb'),
        ('registry.ca.los_angeles_fbn'),
        ('registry.ca.san_francisco_business_locations'),
        ('regulated.ca.calrecycle_waste')
),
expanded_settings as (
    select settings.workspace_id, jsonb_array_elements_text(settings.enabled_sources) as source_key
    from public.leadgen_workspace_settings settings
    where settings.enabled_sources is not null
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
        where source_key is not null
        and source_key <> ''
        and source_key <> 'registry.ca.bizfile'
    ) deduped_settings
    group by workspace_id
)
update public.leadgen_workspace_settings settings
set enabled_sources = aggregated_settings.enabled_sources,
    updated_at = now()
from aggregated_settings
where settings.workspace_id = aggregated_settings.workspace_id;
