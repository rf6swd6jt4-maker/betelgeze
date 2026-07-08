-- Lead Gen v5.5.0 Arizona owner-identity groundwork.
-- Adds external ACC and Secretary of State trade-name shards as the statewide AZ owner backbone.

with source_updates(
    source_key,
    label,
    source_path,
    claim_profile,
    identity_claim_kind,
    person_role,
    priority,
    reason,
    source_url,
    provenance_url
) as (
    values
        (
            'registry.az.corp_commission',
            'Arizona Corporation Commission entity officers',
            'corp_commission',
            'arizona_acc_external_owner_shards',
            'officer_identity',
            'officer_member_manager_or_statutory_agent',
            34,
            'az_acc_external_shard_officer_member_manager_or_agent',
            'https://efiling.azcc.gov/public-records',
            'https://arizonabusinesscenter.azcc.gov/EntitySearch/Index'
        ),
        (
            'registry.az.trade_names',
            'Arizona Secretary of State trade names',
            'trade_names',
            'arizona_trade_name_external_owner_shards',
            'owner_identity',
            'trade_name_registrant',
            35,
            'az_sos_trade_name_external_shard_registrant',
            'https://apps.azsos.gov/apps/tntp/index.html',
            'https://apps.azsos.gov/apps/tntp/index.html'
        )
)
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
select source_updates.source_key,
    source_updates.label,
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
    '{"states":["AZ"],"industries":["all_enabled"]}'::jsonb,
    jsonb_build_object(
        'adapter', 'az_owner_shard_lookup',
        'poll_safety', 'external_shard_lookup',
        'shard_base_url_env', 'AZ_OWNER_SHARD_BASE_URL',
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
        'max_rows_to_match', 120,
        'owner_identity_points_on_match', 3,
        'registered_agent_owner_identity_points_on_match', case when source_updates.source_key = 'registry.az.corp_commission' then 1 else 3 end,
        'owner_phone_points_on_match', 0,
        'business_support_points_on_match', 2,
        'source_role', 'direct_owner_identity',
        'pass', 'owner_identity_v5_5_0_arizona_owner_shards',
        'field_map', jsonb_build_object(
            'business_name', jsonb_build_array('business_name', 'legal_name', 'trade_name'),
            'owner_name', jsonb_build_array('owner_name', 'person_name', 'registrant_name', 'principal_name', 'member_name', 'manager_name', 'officer_name', 'registered_agent_name', 'statutory_agent_name'),
            'person_name', jsonb_build_array('person_name'),
            'city', jsonb_build_array('city'),
            'state', jsonb_build_array('state'),
            'postcode', jsonb_build_array('postcode'),
            'record_id', jsonb_build_array('record_id'),
            'status', jsonb_build_array('status'),
            'record_type', jsonb_build_array('record_type'),
            'additional_match_name', jsonb_build_array('raw_payload', 'legal_name', 'trade_name')
        )
    )
from source_updates
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
    metadata = (
        coalesce(public.leadgen_source_catalog.metadata, '{}'::jsonb)
        - 'adapter'
        - 'poll_safety'
        - 'poll_safe_html'
        - 'search_url'
        - 'blocked_by'
        - 'fragile_polling_disabled_by'
        - 'reason'
    ) || excluded.metadata,
    updated_at = now();

update public.leadgen_source_catalog
set implementation_status = 'planned',
    enabled = false,
    metadata = (coalesce(metadata, '{}'::jsonb) - 'poll_safe_html') || jsonb_build_object(
        'adapter', 'guarded_html_search',
        'poll_safety', 'stable_endpoint_required',
        'disabled_by', '20260708190000_leadgen_v550_arizona_owner_shards',
        'source_role', 'future_arizona_booster'
    ),
    updated_at = now()
where source_key in ('state_license.az.roc', 'state_license.az.pest_management');

with capabilities(source_key, priority, reason) as (
    values
        ('registry.az.corp_commission', 34, 'az_acc_external_shard_officer_member_manager_or_agent'),
        ('registry.az.trade_names', 35, 'az_sos_trade_name_external_shard_registrant')
)
insert into public.leadgen_source_stage_capabilities (source_key, stage_key, priority, metadata, enabled)
select source_key,
    'owner_identity',
    priority,
    jsonb_build_object('reason', reason, 'pass', 'owner_identity_v5_5_0_arizona_owner_shards'),
    true
from capabilities
on conflict (source_key, stage_key)
do update set enabled = true,
    priority = excluded.priority,
    metadata = coalesce(public.leadgen_source_stage_capabilities.metadata, '{}'::jsonb) || excluded.metadata,
    updated_at = now();

update public.leadgen_source_stage_capabilities
set enabled = false,
    metadata = coalesce(metadata, '{}'::jsonb) || '{"disabled_by":"20260708190000_leadgen_v550_arizona_owner_shards","reason":"guarded_html_until_stable_endpoint"}'::jsonb,
    updated_at = now()
where source_key in ('state_license.az.roc', 'state_license.az.pest_management')
and stage_key = 'owner_identity';

update public.leadgen_source_catalog source
set stage_capabilities = coalesce((
        select jsonb_agg(jsonb_build_object('stage_key', stage_key, 'priority', priority) order by priority, stage_key)
        from public.leadgen_source_stage_capabilities capabilities
        where capabilities.source_key = source.source_key
        and capabilities.enabled = true
    ), '[]'::jsonb),
    updated_at = now()
where source.source_key in (
    'registry.az.corp_commission',
    'registry.az.trade_names',
    'state_license.az.roc',
    'state_license.az.pest_management'
);

insert into public.leadgen_source_health (source_key, status, last_error, metadata)
values
    (
        'registry.az.corp_commission',
        'unknown',
        null,
        '{"adapter_seeded_by":"20260708190000_leadgen_v550_arizona_owner_shards","requires_env":"AZ_OWNER_SHARD_BASE_URL","lookup_mode":"external_shards"}'::jsonb
    ),
    (
        'registry.az.trade_names',
        'unknown',
        null,
        '{"adapter_seeded_by":"20260708190000_leadgen_v550_arizona_owner_shards","requires_env":"AZ_OWNER_SHARD_BASE_URL","lookup_mode":"external_shards"}'::jsonb
    ),
    (
        'state_license.az.roc',
        'needs_endpoint',
        'Arizona ROC remains disabled until a stable endpoint, official export, or shard input replaces guarded HTML polling.',
        '{"disabled_by":"20260708190000_leadgen_v550_arizona_owner_shards","future_release":"v5.5.2"}'::jsonb
    ),
    (
        'state_license.az.pest_management',
        'needs_endpoint',
        'Arizona pest-management records remain disabled until a stable endpoint, official export, or shard input replaces guarded HTML polling.',
        '{"disabled_by":"20260708190000_leadgen_v550_arizona_owner_shards","future_release":"v5.5.4"}'::jsonb
    )
on conflict (source_key) do update set
    status = excluded.status,
    last_error = excluded.last_error,
    metadata = coalesce(public.leadgen_source_health.metadata, '{}'::jsonb) || excluded.metadata,
    updated_at = now();

with owner_sources(source_key, native_label) as (
    values
        ('registry.az.corp_commission', 'Arizona Corporation Commission entity officers'),
        ('registry.az.trade_names', 'Arizona Secretary of State trade-name registrants')
),
enabled_industries as (
    select value, label, category
    from public.leadgen_icp_industries
    where enabled = true
)
insert into public.leadgen_source_industry_mappings (source_key, icp_industry_value, native_values, native_label, metadata)
select source.source_key,
    industry.value,
    array[industry.value, lower(regexp_replace(industry.label, '[^a-zA-Z0-9]+', '_', 'g'))],
    source.native_label,
    jsonb_build_object(
        'seed', 'leadgen_v550_arizona_owner_shards',
        'state', 'AZ',
        'category', industry.category,
        'mapping_mode', 'statewide_owner_index'
    )
from owner_sources source
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

with owner_sources(source_key) as (
    values
        ('registry.az.corp_commission'),
        ('registry.az.trade_names')
),
target_locations as (
    select value, label, country, region, locality, location_kind
    from public.leadgen_icp_locations
    where enabled = true
    and country = 'US'
    and region = 'AZ'
)
insert into public.leadgen_source_location_mappings (source_key, icp_location_value, native_values, metadata)
select source.source_key,
    location.value,
    array[coalesce(location.locality, location.region, location.value)],
    jsonb_build_object(
        'seed', 'leadgen_v550_arizona_owner_shards',
        'state', 'AZ',
        'region', location.region,
        'locality', location.locality,
        'location_kind', location.location_kind,
        'mapping_mode', 'statewide_owner_index'
    )
from owner_sources source
cross join target_locations location
on conflict (source_key, icp_location_value)
do update set native_values = excluded.native_values,
    enabled = true,
    metadata = coalesce(public.leadgen_source_location_mappings.metadata, '{}'::jsonb) || excluded.metadata,
    updated_at = now();

with default_sources(source_key) as (
    values
        ('registry.az.corp_commission'),
        ('registry.az.trade_names')
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
