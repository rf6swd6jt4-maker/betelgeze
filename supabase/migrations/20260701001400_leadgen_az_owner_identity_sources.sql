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
        'state_license.az.roc',
        'Arizona Registrar of Contractors',
        'licensing',
        3,
        3,
        0,
        2,
        'public_html',
        'free',
        'blocked',
        'source_specific_configuration',
        false,
        1500,
        '{"states":["AZ"],"industries":["plumbers","electricians","hvac_contractors","roofers","landscapers","painters","remodellers","lighting_contractors","flooring_contractors","general_contractors"]}'::jsonb,
        '{"priority":"high","owner_identity_focus":true,"reason":"Free public source, but current public search blocks automated polling."}'::jsonb
    ),
    (
        'registry.az.corp_commission',
        'Arizona Corporation Commission entity officers',
        'registries',
        3,
        3,
        0,
        2,
        'public_html',
        'free',
        'blocked',
        'source_specific_configuration',
        false,
        1500,
        '{"states":["AZ"],"industries":["plumbers","electricians","hvac_contractors","roofers","landscapers","cleaning_companies","painters","remodellers","pest_control","lighting_contractors","flooring_contractors","general_contractors","waste_disposal","auto_repair"]}'::jsonb,
        '{"priority":"high","owner_identity_focus":true,"reason":"Free public source, but current public search blocks automated polling."}'::jsonb
    ),
    (
        'state_license.az.pest_management',
        'Arizona pest management licenses',
        'licensing',
        3,
        3,
        0,
        2,
        'public_html',
        'free',
        'planned',
        'source_specific_configuration',
        false,
        1500,
        '{"states":["AZ"],"industries":["pest_control"]}'::jsonb,
        '{"priority":"medium","owner_identity_focus":true,"reason":"Targeted AZ pest-control source; adapter/parser not wired yet."}'::jsonb
    ),
    (
        'permits.az.phoenix',
        'Phoenix permits',
        'permits',
        3,
        2,
        0,
        3,
        'public_api_or_html',
        'free',
        'planned',
        'source_specific_configuration',
        false,
        1000,
        '{"states":["AZ"],"cities":["Phoenix"],"industries":["plumbers","electricians","hvac_contractors","roofers","landscapers","cleaning_companies","painters","remodellers","pest_control","lighting_contractors","flooring_contractors","general_contractors","waste_disposal","auto_repair"]}'::jsonb,
        '{"priority":"medium","owner_identity_focus":true,"reason":"Targeted Phoenix permit source; adapter/parser not wired yet."}'::jsonb
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
    metadata = public.leadgen_source_catalog.metadata || excluded.metadata,
    updated_at = now();

insert into public.leadgen_source_industry_mappings (source_key, icp_industry_value, native_values, native_label, metadata)
values
    ('state_license.az.roc', 'plumbers', array['plumbing'], 'Arizona ROC plumbing contractor records', '{"seed":"az_owner_identity_sources","board":"az_roc","state":"AZ"}'::jsonb),
    ('state_license.az.roc', 'electricians', array['electrical'], 'Arizona ROC electrical contractor records', '{"seed":"az_owner_identity_sources","board":"az_roc","state":"AZ"}'::jsonb),
    ('state_license.az.roc', 'hvac_contractors', array['air_conditioning','refrigeration'], 'Arizona ROC HVAC contractor records', '{"seed":"az_owner_identity_sources","board":"az_roc","state":"AZ"}'::jsonb),
    ('state_license.az.roc', 'roofers', array['roofing'], 'Arizona ROC roofing contractor records', '{"seed":"az_owner_identity_sources","board":"az_roc","state":"AZ"}'::jsonb),
    ('state_license.az.roc', 'landscapers', array['landscaping'], 'Arizona ROC landscaping contractor records', '{"seed":"az_owner_identity_sources","board":"az_roc","state":"AZ"}'::jsonb),
    ('state_license.az.roc', 'painters', array['painting'], 'Arizona ROC painting contractor records', '{"seed":"az_owner_identity_sources","board":"az_roc","state":"AZ"}'::jsonb),
    ('state_license.az.roc', 'remodellers', array['general_residential','remodeling'], 'Arizona ROC remodel contractor records', '{"seed":"az_owner_identity_sources","board":"az_roc","state":"AZ"}'::jsonb),
    ('state_license.az.roc', 'lighting_contractors', array['electrical','low_voltage'], 'Arizona ROC lighting/electrical contractor records', '{"seed":"az_owner_identity_sources","board":"az_roc","state":"AZ"}'::jsonb),
    ('state_license.az.roc', 'flooring_contractors', array['floor_covering'], 'Arizona ROC flooring contractor records', '{"seed":"az_owner_identity_sources","board":"az_roc","state":"AZ"}'::jsonb),
    ('state_license.az.roc', 'general_contractors', array['general_commercial','general_residential'], 'Arizona ROC general contractor records', '{"seed":"az_owner_identity_sources","board":"az_roc","state":"AZ"}'::jsonb),
    ('state_license.az.pest_management', 'pest_control', array['pest_management_business','qualifying_party'], 'Arizona pest management licensing', '{"seed":"az_owner_identity_sources","board":"az_pest_management","state":"AZ"}'::jsonb)
on conflict (source_key, icp_industry_value)
do update set native_values = excluded.native_values,
    native_label = excluded.native_label,
    enabled = true,
    metadata = public.leadgen_source_industry_mappings.metadata || excluded.metadata,
    updated_at = now();

insert into public.leadgen_source_industry_mappings (source_key, icp_industry_value, native_values, native_label, metadata)
select source.source_key,
    industry.value,
    array[industry.value],
    industry.label,
    jsonb_build_object('seed', 'az_owner_identity_sources', 'state', 'AZ', 'mapping_mode', 'registry_or_local_permit')
from (values
    ('registry.az.corp_commission'),
    ('permits.az.phoenix')
) as source(source_key)
cross join public.leadgen_icp_industries industry
where industry.value in (
    'plumbers',
    'electricians',
    'hvac_contractors',
    'roofers',
    'landscapers',
    'cleaning_companies',
    'painters',
    'remodellers',
    'pest_control',
    'lighting_contractors',
    'flooring_contractors',
    'general_contractors',
    'waste_disposal',
    'auto_repair'
)
on conflict (source_key, icp_industry_value)
do update set native_values = excluded.native_values,
    native_label = excluded.native_label,
    enabled = true,
    metadata = public.leadgen_source_industry_mappings.metadata || excluded.metadata,
    updated_at = now();

insert into public.leadgen_source_location_mappings (source_key, icp_location_value, native_values, metadata)
select source.source_key,
    location.value,
    array[coalesce(location.region, location.value)],
    jsonb_build_object('seed', 'az_owner_identity_sources', 'state', 'AZ', 'mapping_mode', 'statewide_source')
from (values
    ('state_license.az.roc'),
    ('registry.az.corp_commission'),
    ('state_license.az.pest_management')
) as source(source_key)
cross join public.leadgen_icp_locations location
where location.enabled = true
and location.country = 'US'
and location.region = 'AZ'
on conflict (source_key, icp_location_value)
do update set native_values = excluded.native_values,
    enabled = true,
    metadata = public.leadgen_source_location_mappings.metadata || excluded.metadata,
    updated_at = now();

insert into public.leadgen_source_location_mappings (source_key, icp_location_value, native_values, metadata)
values
    ('permits.az.phoenix', 'phoenix_az', array['Phoenix'], '{"seed":"az_owner_identity_sources","city":"Phoenix","state":"AZ"}'::jsonb)
on conflict (source_key, icp_location_value)
do update set native_values = excluded.native_values,
    enabled = true,
    metadata = public.leadgen_source_location_mappings.metadata || excluded.metadata,
    updated_at = now();

with capabilities(source_key, stage_key, priority, metadata) as (
    values
        ('state_license.az.roc', 'owner_identity', 38, '{"reason":"roc_qualifying_party"}'::jsonb),
        ('registry.az.corp_commission', 'owner_identity', 44, '{"reason":"entity_officer_or_statutory_agent"}'::jsonb),
        ('state_license.az.pest_management', 'owner_identity', 48, '{"reason":"pest_license_qualifying_party"}'::jsonb),
        ('permits.az.phoenix', 'owner_identity', 62, '{"reason":"permit_principal_or_contractor"}'::jsonb)
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

update public.leadgen_source_stage_capabilities
set enabled = false,
    updated_at = now()
where source_key in (
    'state_license.az.roc',
    'registry.az.corp_commission',
    'state_license.az.pest_management',
    'permits.az.phoenix'
)
and stage_key = 'business_validation';

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
    'state_license.az.roc',
    'registry.az.corp_commission',
    'state_license.az.pest_management',
    'permits.az.phoenix'
);

insert into public.leadgen_source_health (source_key, status, last_error, metadata)
values
    ('state_license.az.roc', 'blocked', 'Free public source, but current public search blocks automated polling.', '{"seeded_by":"20260701001400_leadgen_az_owner_identity_sources","blocked_by":"public_site_403"}'::jsonb),
    ('registry.az.corp_commission', 'blocked', 'Free public source, but current public search blocks automated polling.', '{"seeded_by":"20260701001400_leadgen_az_owner_identity_sources","blocked_by":"public_site_403"}'::jsonb),
    ('state_license.az.pest_management', 'unknown', null, '{"seeded_by":"20260701001400_leadgen_az_owner_identity_sources","needs_adapter":true}'::jsonb),
    ('permits.az.phoenix', 'unknown', null, '{"seeded_by":"20260701001400_leadgen_az_owner_identity_sources","needs_adapter":true}'::jsonb)
on conflict (source_key) do update set
    status = excluded.status,
    last_error = excluded.last_error,
    metadata = public.leadgen_source_health.metadata || excluded.metadata,
    updated_at = now();
