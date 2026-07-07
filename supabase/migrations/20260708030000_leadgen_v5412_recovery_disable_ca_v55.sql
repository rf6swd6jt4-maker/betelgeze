-- Lead Gen v5.4.12 recovery.
-- Keep historical poll/lead data, but stop future runs from using the failed v5.5 California shard experiment.

update public.leadgen_source_catalog
set implementation_status = 'experimental',
    run_stage = 'source_specific_configuration',
    enabled = false,
    metadata = (coalesce(metadata, '{}'::jsonb)
        - 'shard_base_url_env'
        - 'shard_version'
        - 'shard_prefix_length'
        - 'shard_source_path'
    ) || '{
        "disabled_by":"leadgen_v5_4_12_recovery",
        "reason":"Lead Gen v5.5 California San Diego owner shards were retired during the v5.4.12 recovery because they did not provide reliable statewide owner identity.",
        "replacement_policy":"Do not schedule this source until California is redesigned from the v5.4.12 baseline."
    }'::jsonb,
    updated_at = now()
where source_key = 'registry.ca.san_diego_business_tax';

update public.leadgen_source_stage_capabilities
set enabled = false,
    metadata = coalesce(metadata, '{}'::jsonb) || '{
        "disabled_by":"leadgen_v5_4_12_recovery",
        "reason":"Retired failed v5.5 California San Diego shard source."
    }'::jsonb,
    updated_at = now()
where source_key = 'registry.ca.san_diego_business_tax';

update public.leadgen_source_industry_mappings
set enabled = false,
    metadata = coalesce(metadata, '{}'::jsonb) || '{"disabled_by":"leadgen_v5_4_12_recovery"}'::jsonb,
    updated_at = now()
where source_key = 'registry.ca.san_diego_business_tax';

update public.leadgen_source_location_mappings
set enabled = false,
    metadata = coalesce(metadata, '{}'::jsonb) || '{"disabled_by":"leadgen_v5_4_12_recovery"}'::jsonb,
    updated_at = now()
where source_key = 'registry.ca.san_diego_business_tax';

insert into public.leadgen_source_health (source_key, status, last_error, metadata)
select
    'registry.ca.san_diego_business_tax',
    'blocked',
    'Disabled by Lead Gen v5.4.12 recovery; v5.5 San Diego owner shards were not reliable enough for production scheduling.',
    '{"disabled_by":"leadgen_v5_4_12_recovery"}'::jsonb
where exists (
    select 1 from public.leadgen_source_catalog where source_key = 'registry.ca.san_diego_business_tax'
)
on conflict (source_key) do update set
    status = excluded.status,
    last_error = excluded.last_error,
    metadata = coalesce(public.leadgen_source_health.metadata, '{}'::jsonb) || excluded.metadata,
    updated_at = now();

update public.leadgen_source_catalog
set implementation_status = 'active',
    run_stage = 'candidate_investigation',
    enabled = true,
    access_method = 'public_html',
    rate_limit_ms = 1700,
    metadata = (coalesce(metadata, '{}'::jsonb)
        - 'shard_base_url_env'
        - 'shard_version'
        - 'shard_prefix_length'
        - 'shard_source_path'
        - 'poll_safety'
        - 'blocked_by'
        - 'reason'
    ) || '{
        "adapter":"cslb_license_search",
        "restored_by":"leadgen_v5_4_12_recovery",
        "source_url":"https://www.cslb.ca.gov/onlineservices/checklicenseII/checklicense.aspx",
        "provenance_url":"https://www.cslb.ca.gov/onlineservices/checklicenseII/checklicense.aspx",
        "claim_profile":"california_cslb_contractor_license",
        "identity_claim_kind":"owner_identity",
        "person_role":"qualifying_individual"
    }'::jsonb,
    updated_at = now()
where source_key = 'state_license.ca.cslb';

update public.leadgen_source_catalog
set implementation_status = 'active',
    run_stage = 'candidate_investigation',
    enabled = true,
    access_method = 'public_html',
    rate_limit_ms = 1800,
    metadata = (coalesce(metadata, '{}'::jsonb)
        - 'shard_base_url_env'
        - 'shard_version'
        - 'shard_prefix_length'
        - 'shard_source_path'
        - 'poll_safety'
        - 'blocked_by'
        - 'reason'
    ) || '{
        "adapter":"guarded_html_search",
        "restored_by":"leadgen_v5_4_12_recovery",
        "search_url":"https://bizfileonline.sos.ca.gov/search/business?SearchCriteria.SearchValue={query}",
        "provenance_url":"https://bizfileonline.sos.ca.gov/search/business",
        "claim_profile":"california_bizfile_entity_search",
        "identity_claim_kind":"officer_identity",
        "person_role":"officer_manager_or_registered_agent"
    }'::jsonb,
    updated_at = now()
where source_key = 'registry.ca.bizfile';

update public.leadgen_source_catalog
set implementation_status = 'active',
    run_stage = 'candidate_investigation',
    enabled = true,
    access_method = 'public_api',
    rate_limit_ms = 900,
    metadata = (coalesce(metadata, '{}'::jsonb)
        - 'shard_base_url_env'
        - 'shard_version'
        - 'shard_prefix_length'
        - 'shard_source_path'
        - 'poll_safety'
        - 'blocked_by'
        - 'reason'
    ) || jsonb_build_object(
        'restored_by', 'leadgen_v5_4_12_recovery',
        'poll_safety', 'direct_public_api',
        'requires_env', null
    ),
    updated_at = now()
where source_key in (
    'registry.ca.los_angeles_fbn',
    'registry.ca.san_francisco_business_locations',
    'regulated.ca.calrecycle_waste'
);

update public.leadgen_source_stage_capabilities
set enabled = true,
    metadata = coalesce(metadata, '{}'::jsonb) || '{"restored_by":"leadgen_v5_4_12_recovery"}'::jsonb,
    updated_at = now()
where source_key in (
    'state_license.ca.cslb',
    'registry.ca.bizfile',
    'registry.ca.los_angeles_fbn',
    'registry.ca.san_francisco_business_locations',
    'regulated.ca.calrecycle_waste'
);

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
    'registry.ca.bizfile',
    'registry.ca.los_angeles_fbn',
    'registry.ca.san_francisco_business_locations',
    'regulated.ca.calrecycle_waste',
    'registry.ca.san_diego_business_tax'
);

update public.leadgen_source_health
set status = 'unknown',
    last_error = null,
    metadata = (coalesce(metadata, '{}'::jsonb)
        - 'requires_env'
        - 'lookup_mode'
        - 'match_policy'
    ) || '{"restored_by":"leadgen_v5_4_12_recovery"}'::jsonb,
    updated_at = now()
where source_key in (
    'state_license.ca.cslb',
    'registry.ca.bizfile',
    'registry.ca.los_angeles_fbn',
    'registry.ca.san_francisco_business_locations',
    'regulated.ca.calrecycle_waste'
);

with restored_defaults(source_key) as (
    values
        ('state_license.ca.cslb'),
        ('registry.ca.bizfile'),
        ('registry.ca.los_angeles_fbn'),
        ('regulated.ca.calrecycle_waste')
),
expanded_settings as (
    select settings.workspace_id, jsonb_array_elements_text(settings.enabled_sources) as source_key
    from public.leadgen_workspace_settings settings
    where settings.enabled_sources is not null
    union
    select settings.workspace_id, restored_defaults.source_key
    from public.leadgen_workspace_settings settings
    cross join restored_defaults
),
aggregated_settings as (
    select workspace_id, jsonb_agg(source_key order by source_key) as enabled_sources
    from (
        select distinct workspace_id, source_key
        from expanded_settings
        where source_key is not null
        and source_key <> ''
        and source_key <> 'registry.ca.san_diego_business_tax'
    ) deduped_settings
    group by workspace_id
)
update public.leadgen_workspace_settings settings
set enabled_sources = aggregated_settings.enabled_sources,
    updated_at = now()
from aggregated_settings
where settings.workspace_id = aggregated_settings.workspace_id;
