-- Lead Gen v5.5.2 California stable owner-source routing.
-- Retires live CSLB form polling and makes stable external CA owner shards the California backbone.

update public.leadgen_source_catalog
set implementation_status = 'planned',
    run_stage = 'source_specific_configuration',
    enabled = false,
    access_method = 'public_bulk_or_api_needed',
    rate_limit_ms = 1500,
    metadata = (
        coalesce(metadata, '{}'::jsonb)
        - 'adapter'
        - 'poll_safe_html'
        - 'source_url'
        - 'claim_profile'
        - 'identity_claim_kind'
        - 'person_role'
    ) || '{
        "adapter":"california_external_lookup_required",
        "poll_safety":"stable_external_lookup_required",
        "blocked_by":"cslb_live_form_challenge",
        "reason":"The official CSLB live public form can return anti-bot, app-shell, captcha, or geo-block challenges from serverless runtimes. v5.5.2 keeps CSLB catalogued but does not run it in polls until an external/bulk lookup exists.",
        "pass":"owner_identity_v5_5_2_california_stable_owner_sources"
    }'::jsonb,
    updated_at = now()
where source_key = 'state_license.ca.cslb';

with stable_sources(source_key, source_path, claim_profile, person_role, points, support_points, priority, provenance_url, source_url, field_map) as (
    values
        (
            'registry.ca.los_angeles_fbn',
            'los_angeles_fbn',
            'los_angeles_county_fictitious_business_name_shards',
            'registered_fbn_owner',
            3,
            2,
            34,
            'https://public.gis.lacounty.gov/portal/apps/sites/#/opendata/items/2401223c34864b7b9e5884b6229a1d3c',
            'https://services.arcgis.com/RmCCgQtiZLDCtblq/arcgis/rest/services/Fictitious_Business_Name/FeatureServer/0',
            '{"business_name":["business_name"],"owner_name":["owner_name","person_name"],"person_name":["person_name"],"address":["address"],"city":["city"],"state":["state"],"postcode":["postcode"],"record_id":["record_id"],"status":["status"],"record_type":["record_type"]}'::jsonb
        ),
        (
            'registry.ca.san_francisco_business_locations',
            'san_francisco_business_locations',
            'san_francisco_registered_business_owner_shards',
            'business_owner',
            3,
            2,
            36,
            'https://data.sfgov.org/Economy-and-Community/Registered-Business-Locations-San-Francisco/g8m3-pdis',
            'https://data.sfgov.org/resource/g8m3-pdis.json',
            '{"business_name":["business_name"],"owner_name":["owner_name","person_name"],"person_name":["person_name"],"address":["address"],"city":["city"],"state":["state"],"postcode":["postcode"],"record_id":["record_id"],"status":["status"],"record_type":["record_type"]}'::jsonb
        )
)
update public.leadgen_source_catalog source
set source_points = 3,
    owner_identity_points = stable_sources.points,
    owner_phone_points = 0,
    business_support_points = stable_sources.support_points,
    access_method = 'public_bulk_download_shards',
    free_status = 'free',
    implementation_status = 'active',
    run_stage = 'candidate_investigation',
    enabled = true,
    rate_limit_ms = 40,
    coverage = '{"states":["CA"],"industries":["all_enabled"],"source_scope":"statewide_california_external_owner_shards"}'::jsonb,
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
        'shard_source_path', stable_sources.source_path,
        'source_url', stable_sources.source_url,
        'provenance_url', stable_sources.provenance_url,
        'claim_profile', stable_sources.claim_profile,
        'identity_claim_kind', 'owner_identity',
        'person_role', stable_sources.person_role,
        'query_limit', 24,
        'search_term_limit', 8,
        'max_rows_to_match', 120,
        'owner_identity_points_on_match', stable_sources.points,
        'owner_phone_points_on_match', 0,
        'business_support_points_on_match', stable_sources.support_points,
        'source_role', 'direct_owner_identity',
        'statewide_fanout', true,
        'require_address_or_locality_match', true,
        'minimum_locality_address_score', 0.34,
        'pass', 'owner_identity_v5_5_2_california_stable_owner_sources',
        'field_map', stable_sources.field_map
    ),
    updated_at = now()
from stable_sources
where source.source_key = stable_sources.source_key;

update public.leadgen_source_catalog
set coverage = '{"states":["CA"],"industries":["waste_disposal"],"source_scope":"statewide_waste_records"}'::jsonb,
    metadata = coalesce(metadata, '{}'::jsonb) || '{
        "pass":"owner_identity_v5_5_2_california_stable_owner_sources",
        "require_address_or_locality_match":true,
        "minimum_locality_address_score":0.34
    }'::jsonb,
    updated_at = now()
where source_key = 'regulated.ca.calrecycle_waste';

insert into public.leadgen_source_industry_mappings (source_key, icp_industry_value, native_values, native_label, metadata, enabled)
select
    source.source_key,
    industry.value,
    array['business_name','owner_name','person_name','address_or_locality_required'],
    source.native_label,
    jsonb_build_object(
        'seed', 'leadgen_v5_5_2_california_stable_owner_sources',
        'state', 'CA',
        'mapping_mode', source.mapping_mode,
        'match_policy', 'address_or_locality_required',
        'pass', 'owner_identity_v5_5_2_california_stable_owner_sources'
    ),
    true
from (values
    ('registry.ca.los_angeles_fbn', 'California county FBN owner shards', 'california_fbn_external_owner_identity'),
    ('registry.ca.san_francisco_business_locations', 'California city registered-business owner shards', 'california_registered_business_external_owner_identity')
) as source(source_key, native_label, mapping_mode)
cross join public.leadgen_icp_industries industry
where industry.enabled = true
on conflict (source_key, icp_industry_value)
do update set native_values = excluded.native_values,
    native_label = excluded.native_label,
    enabled = true,
    metadata = coalesce(public.leadgen_source_industry_mappings.metadata, '{}'::jsonb) || excluded.metadata,
    updated_at = now();

insert into public.leadgen_source_location_mappings (source_key, icp_location_value, native_values, metadata, enabled)
select
    source.source_key,
    location.value,
    source.native_values,
    jsonb_build_object(
        'seed', 'leadgen_v5_5_2_california_stable_owner_sources',
        'state', 'CA',
        'mapping_mode', source.mapping_mode,
        'match_policy', 'address_or_locality_required',
        'pass', 'owner_identity_v5_5_2_california_stable_owner_sources'
    ),
    true
from (values
    ('registry.ca.los_angeles_fbn', array['CA','Los Angeles County FBN external shards'], 'california_fbn_external_owner_identity'),
    ('registry.ca.san_francisco_business_locations', array['CA','DataSF registered-business external shards'], 'california_registered_business_external_owner_identity')
) as source(source_key, native_values, mapping_mode)
cross join public.leadgen_icp_locations location
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
        ('registry.ca.los_angeles_fbn', 34, 'california_fbn_external_owner_shards_with_locality_policy'),
        ('registry.ca.san_francisco_business_locations', 36, 'california_registered_business_external_owner_shards_with_locality_policy'),
        ('regulated.ca.calrecycle_waste', 70, 'calrecycle_external_contact_shards')
)
insert into public.leadgen_source_stage_capabilities (source_key, stage_key, priority, metadata, enabled)
select source_key,
    'owner_identity',
    priority,
    jsonb_build_object('reason', reason, 'pass', 'owner_identity_v5_5_2_california_stable_owner_sources'),
    true
from capabilities
on conflict (source_key, stage_key)
do update set enabled = true,
    priority = excluded.priority,
    metadata = coalesce(public.leadgen_source_stage_capabilities.metadata, '{}'::jsonb) || excluded.metadata,
    updated_at = now();

update public.leadgen_source_stage_capabilities
set enabled = false,
    metadata = coalesce(metadata, '{}'::jsonb) || '{"disabled_by":"leadgen_v5_5_2_california_stable_owner_sources","reason":"Live CSLB form is challenge-prone; external/bulk lookup required before poll-time execution."}'::jsonb,
    updated_at = now()
where source_key = 'state_license.ca.cslb';

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
    'regulated.ca.calrecycle_waste'
);

insert into public.leadgen_source_health (source_key, status, last_error, metadata)
values
    (
        'state_license.ca.cslb',
        'blocked',
        'Live CSLB public form retired from poll execution in v5.5.2 because it can return anti-bot, captcha, app-shell, or geo-block challenges from serverless runtimes.',
        '{"adapter_seeded_by":"20260708003000_leadgen_v552_california_stable_owner_sources","lookup_mode":"stable_external_lookup_required"}'::jsonb
    ),
    (
        'registry.ca.los_angeles_fbn',
        'unknown',
        null,
        '{"adapter_seeded_by":"20260708003000_leadgen_v552_california_stable_owner_sources","requires_env":"CA_OWNER_SHARD_BASE_URL","lookup_mode":"external_shards","match_policy":"address_or_locality_required"}'::jsonb
    ),
    (
        'registry.ca.san_francisco_business_locations',
        'unknown',
        null,
        '{"adapter_seeded_by":"20260708003000_leadgen_v552_california_stable_owner_sources","requires_env":"CA_OWNER_SHARD_BASE_URL","lookup_mode":"external_shards","match_policy":"address_or_locality_required"}'::jsonb
    )
on conflict (source_key) do update set
    status = excluded.status,
    last_error = excluded.last_error,
    metadata = coalesce(public.leadgen_source_health.metadata, '{}'::jsonb) || excluded.metadata,
    updated_at = now();

with default_sources(source_key) as (
    values
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
        and source_key not in ('state_license.ca.cslb', 'registry.ca.bizfile')
    ) deduped_settings
    group by workspace_id
)
update public.leadgen_workspace_settings settings
set enabled_sources = aggregated_settings.enabled_sources,
    updated_at = now()
from aggregated_settings
where settings.workspace_id = aggregated_settings.workspace_id;
