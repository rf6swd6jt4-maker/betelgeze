update public.leadgen_source_catalog
set implementation_status = 'active',
    run_stage = 'candidate_investigation',
    enabled = true,
    updated_at = now()
where source_key in (
    'website',
    'safety.osha',
    'procurement.usaspending',
    'web.rdap_whois',
    'web.certificate_transparency'
);

with capabilities(source_key, stage_key, priority, metadata) as (
    values
        ('website', 'business_validation', 50, '{"reason":"website_presence"}'::jsonb),
        ('website', 'owner_identity', 50, '{"reason":"about_team_or_json_ld_owner"}'::jsonb),
        ('website', 'owner_phone', 50, '{"reason":"owner_near_phone_evidence"}'::jsonb),
        ('safety.osha', 'business_validation', 85, '{"reason":"establishment_activity"}'::jsonb),
        ('procurement.usaspending', 'business_validation', 85, '{"reason":"award_activity"}'::jsonb),
        ('web.rdap_whois', 'business_validation', 90, '{"reason":"domain_registration_support"}'::jsonb),
        ('web.certificate_transparency', 'business_validation', 95, '{"reason":"domain_certificate_support"}'::jsonb)
)
insert into public.leadgen_source_stage_capabilities (source_key, stage_key, priority, metadata, enabled)
select capabilities.source_key, capabilities.stage_key, capabilities.priority, capabilities.metadata, true
from capabilities
join public.leadgen_source_catalog source on source.source_key = capabilities.source_key
on conflict (source_key, stage_key)
do update set enabled = true,
    priority = excluded.priority,
    metadata = public.leadgen_source_stage_capabilities.metadata || excluded.metadata,
    updated_at = now();

insert into public.leadgen_source_industry_mappings (source_key, icp_industry_value, native_values, native_label, metadata)
select source.source_key,
    industry.value,
    array[industry.value],
    industry.label,
    jsonb_build_object('seed', 'leadgen_broad_validation_sources_and_stage_gates', 'category', industry.category, 'mapping_mode', 'broad_candidate_support')
from (values
    ('safety.osha'),
    ('procurement.usaspending'),
    ('web.rdap_whois'),
    ('web.certificate_transparency')
) as source(source_key)
cross join public.leadgen_icp_industries industry
where industry.enabled = true
on conflict (source_key, icp_industry_value)
do update set native_values = excluded.native_values,
    native_label = excluded.native_label,
    enabled = true,
    metadata = public.leadgen_source_industry_mappings.metadata || excluded.metadata,
    updated_at = now();

insert into public.leadgen_source_location_mappings (source_key, icp_location_value, native_values, metadata)
select source.source_key,
    location.value,
    array[coalesce(location.region, location.country, location.value)],
    jsonb_build_object('seed', 'leadgen_broad_validation_sources_and_stage_gates', 'country', location.country, 'region', location.region, 'locality', location.locality, 'mapping_mode', 'broad_candidate_support')
from (values
    ('safety.osha'),
    ('procurement.usaspending'),
    ('web.rdap_whois'),
    ('web.certificate_transparency')
) as source(source_key)
cross join public.leadgen_icp_locations location
where location.enabled = true
and location.country = 'US'
on conflict (source_key, icp_location_value)
do update set native_values = excluded.native_values,
    enabled = true,
    metadata = public.leadgen_source_location_mappings.metadata || excluded.metadata,
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
    'website',
    'safety.osha',
    'procurement.usaspending',
    'web.rdap_whois',
    'web.certificate_transparency'
);

insert into public.leadgen_source_health (source_key, status, metadata)
select source_key,
    'unknown',
    '{"seeded_by":"20260630231500_leadgen_broad_validation_sources_and_stage_gates"}'::jsonb
from public.leadgen_source_catalog
where source_key in (
    'website',
    'safety.osha',
    'procurement.usaspending',
    'web.rdap_whois',
    'web.certificate_transparency'
)
on conflict (source_key) do update set
    status = excluded.status,
    metadata = public.leadgen_source_health.metadata || excluded.metadata,
    updated_at = now();

with default_sources(source_key) as (
    values
        ('website'),
        ('phone.basic_format_validation'),
        ('safety.osha'),
        ('procurement.usaspending'),
        ('web.rdap_whois'),
        ('web.certificate_transparency')
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
    select workspace_id,
        jsonb_agg(source_key order by source_key) as enabled_sources
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
