-- Lead Gen v5.4.9 Florida Sunbiz external shard lookup.
-- Replaces the oversized Supabase index with poll-time reads from compact public object-store shards.

with source_updates(source_key, label, source_path, claim_profile, identity_claim_kind, person_role, priority, reason) as (
    values
        (
            'registry.fl.sunbiz',
            'Florida Sunbiz officers',
            'sunbiz',
            'florida_sunbiz_external_officer_shards',
            'officer_identity',
            'officer_manager_or_registered_agent',
            32,
            'sunbiz_external_shard_officer_or_manager'
        ),
        (
            'registry.fl.fictitious_names',
            'Florida Sunbiz fictitious names',
            'fictitious_names',
            'florida_sunbiz_external_fictitious_name_shards',
            'owner_identity',
            'fictitious_name_owner_or_registrant',
            33,
            'sunbiz_external_shard_fictitious_name_owner'
        )
)
update public.leadgen_source_catalog source
set label = source_updates.label,
    family = 'registries',
    source_points = 3,
    owner_identity_points = 3,
    owner_phone_points = 0,
    business_support_points = 2,
    access_method = 'public_bulk_download_shards',
    free_status = 'free',
    implementation_status = 'active',
    run_stage = 'candidate_investigation',
    enabled = true,
    rate_limit_ms = 80,
    coverage = '{"states":["FL"],"industries":["all_enabled"]}'::jsonb,
    metadata = (
        coalesce(source.metadata, '{}'::jsonb)
        - 'adapter'
        - 'poll_safety'
        - 'search_url'
        - 'index_table'
        - 'retired_adapter'
        - 'retired_index_table'
        - 'retired_reason'
        - 'reason'
        - 'blocked_by'
        - 'fragile_polling_disabled_by'
    ) || jsonb_build_object(
        'adapter', 'sunbiz_shard_lookup',
        'poll_safety', 'external_shard_lookup',
        'shard_base_url_env', 'SUNBIZ_SHARD_BASE_URL',
        'shard_version', 'v1',
        'shard_prefix_length', 3,
        'shard_source_path', source_updates.source_path,
        'source_url', 'https://dos.fl.gov/sunbiz/other-services/data-downloads/',
        'daily_data_url', 'https://dos.fl.gov/sunbiz/other-services/data-downloads/daily-data/',
        'quarterly_data_url', 'https://dos.fl.gov/sunbiz/other-services/data-downloads/quarterly-data/',
        'claim_profile', source_updates.claim_profile,
        'identity_claim_kind', source_updates.identity_claim_kind,
        'person_role', source_updates.person_role,
        'query_limit', 20,
        'search_term_limit', 8,
        'owner_identity_points_on_match', 3,
        'owner_phone_points_on_match', 0,
        'business_support_points_on_match', 2,
        'source_role', 'direct_owner_identity',
        'pass', 'owner_identity_v5_4_9_sunbiz_external_shards',
        'field_map', jsonb_build_object(
            'business_name', jsonb_build_array('business_name'),
            'owner_name', jsonb_build_array('owner_name', 'person_name'),
            'person_name', jsonb_build_array('person_name'),
            'city', jsonb_build_array('city'),
            'state', jsonb_build_array('state'),
            'postcode', jsonb_build_array('postcode'),
            'record_id', jsonb_build_array('record_id'),
            'status', jsonb_build_array('status'),
            'record_type', jsonb_build_array('record_type'),
            'additional_match_name', jsonb_build_array('raw_payload')
        )
    ),
    updated_at = now()
from source_updates
where source.source_key = source_updates.source_key;

with capabilities(source_key, priority, reason) as (
    values
        ('registry.fl.sunbiz', 32, 'sunbiz_external_shard_officer_or_manager'),
        ('registry.fl.fictitious_names', 33, 'sunbiz_external_shard_fictitious_name_owner')
)
insert into public.leadgen_source_stage_capabilities (source_key, stage_key, priority, metadata, enabled)
select source_key,
    'owner_identity',
    priority,
    jsonb_build_object('reason', reason, 'pass', 'owner_identity_v5_4_9_sunbiz_external_shards'),
    true
from capabilities
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
where source.source_key in ('registry.fl.sunbiz', 'registry.fl.fictitious_names');

insert into public.leadgen_source_health (source_key, status, last_error, metadata)
values
    (
        'registry.fl.sunbiz',
        'unknown',
        null,
        '{"adapter_seeded_by":"20260707124500_leadgen_v549_sunbiz_external_shards","requires_env":"SUNBIZ_SHARD_BASE_URL","lookup_mode":"external_shards"}'::jsonb
    ),
    (
        'registry.fl.fictitious_names',
        'unknown',
        null,
        '{"adapter_seeded_by":"20260707124500_leadgen_v549_sunbiz_external_shards","requires_env":"SUNBIZ_SHARD_BASE_URL","lookup_mode":"external_shards"}'::jsonb
    )
on conflict (source_key) do update set
    status = excluded.status,
    last_error = excluded.last_error,
    metadata = coalesce(public.leadgen_source_health.metadata, '{}'::jsonb) || excluded.metadata,
    updated_at = now();

with default_sources(source_key) as (
    values
        ('registry.fl.sunbiz'),
        ('registry.fl.fictitious_names')
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
