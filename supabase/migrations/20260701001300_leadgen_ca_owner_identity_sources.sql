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
        'planned',
        'source_specific_configuration',
        false,
        1500,
        '{"states":["CA"],"industries":["plumbers","electricians","hvac_contractors","roofers","landscapers","painters","remodellers","lighting_contractors","flooring_contractors","general_contractors"]}'::jsonb,
        '{"priority":"high","owner_identity_focus":true,"reason":"Free CSLB source, but a safe form adapter/parser is not wired yet."}'::jsonb
    ),
    (
        'state_license.ca.bar_auto_repair',
        'California BAR auto-repair registrations',
        'licensing',
        3,
        2,
        0,
        2,
        'public_html',
        'free',
        'planned',
        'source_specific_configuration',
        false,
        1500,
        '{"states":["CA"],"industries":["auto_repair"]}'::jsonb,
        '{"priority":"high","owner_identity_focus":true,"reason":"Targeted CA auto-repair source; adapter/parser not wired yet."}'::jsonb
    ),
    (
        'state_license.ca.pest_control',
        'California Structural Pest Control Board',
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
        '{"states":["CA"],"industries":["pest_control"]}'::jsonb,
        '{"priority":"high","owner_identity_focus":true,"reason":"Targeted CA pest-control source; adapter/parser not wired yet."}'::jsonb
    ),
    (
        'registry.ca.bizfile',
        'California Bizfile officers',
        'registries',
        2,
        2,
        0,
        2,
        'public_html',
        'free',
        'planned',
        'source_specific_configuration',
        false,
        1500,
        '{"states":["CA"],"industries":["plumbers","electricians","hvac_contractors","roofers","landscapers","cleaning_companies","painters","remodellers","pest_control","lighting_contractors","flooring_contractors","general_contractors","waste_disposal","auto_repair"]}'::jsonb,
        '{"priority":"medium","owner_identity_focus":true,"reason":"Targeted CA entity registry source; adapter/parser not wired yet."}'::jsonb
    ),
    (
        'registry.ca.los_angeles_fbn',
        'Los Angeles County fictitious business names',
        'registries',
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
        '{"states":["CA"],"counties":["Los Angeles"],"industries":["plumbers","electricians","hvac_contractors","roofers","landscapers","cleaning_companies","painters","remodellers","pest_control","lighting_contractors","flooring_contractors","general_contractors","waste_disposal","auto_repair"]}'::jsonb,
        '{"priority":"high","owner_identity_focus":true,"reason":"Targeted LA County DBA/FBN source; adapter/parser not wired yet."}'::jsonb
    ),
    (
        'regulated.ca.calrecycle_waste',
        'California CalRecycle waste hauler records',
        'regulated',
        2,
        2,
        0,
        2,
        'public_api_or_html',
        'free',
        'planned',
        'source_specific_configuration',
        false,
        1500,
        '{"states":["CA"],"industries":["waste_disposal"]}'::jsonb,
        '{"priority":"medium","owner_identity_focus":true,"reason":"Targeted CA waste-disposal source; adapter/parser not wired yet."}'::jsonb
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
    ('state_license.ca.cslb', 'plumbers', array['C-36'], 'California CSLB plumbing contractor class', '{"seed":"ca_owner_identity_sources","board":"cslb","state":"CA"}'::jsonb),
    ('state_license.ca.cslb', 'electricians', array['C-10'], 'California CSLB electrical contractor class', '{"seed":"ca_owner_identity_sources","board":"cslb","state":"CA"}'::jsonb),
    ('state_license.ca.cslb', 'hvac_contractors', array['C-20'], 'California CSLB warm-air HVAC contractor class', '{"seed":"ca_owner_identity_sources","board":"cslb","state":"CA"}'::jsonb),
    ('state_license.ca.cslb', 'roofers', array['C-39'], 'California CSLB roofing contractor class', '{"seed":"ca_owner_identity_sources","board":"cslb","state":"CA"}'::jsonb),
    ('state_license.ca.cslb', 'landscapers', array['C-27'], 'California CSLB landscaping contractor class', '{"seed":"ca_owner_identity_sources","board":"cslb","state":"CA"}'::jsonb),
    ('state_license.ca.cslb', 'painters', array['C-33'], 'California CSLB painting contractor class', '{"seed":"ca_owner_identity_sources","board":"cslb","state":"CA"}'::jsonb),
    ('state_license.ca.cslb', 'remodellers', array['B'], 'California CSLB general building contractor class', '{"seed":"ca_owner_identity_sources","board":"cslb","state":"CA"}'::jsonb),
    ('state_license.ca.cslb', 'lighting_contractors', array['C-10','C-7'], 'California CSLB electrical/low-voltage contractor classes', '{"seed":"ca_owner_identity_sources","board":"cslb","state":"CA"}'::jsonb),
    ('state_license.ca.cslb', 'flooring_contractors', array['C-15'], 'California CSLB flooring contractor class', '{"seed":"ca_owner_identity_sources","board":"cslb","state":"CA"}'::jsonb),
    ('state_license.ca.cslb', 'general_contractors', array['B'], 'California CSLB general building contractor class', '{"seed":"ca_owner_identity_sources","board":"cslb","state":"CA"}'::jsonb),
    ('state_license.ca.bar_auto_repair', 'auto_repair', array['automotive_repair_dealer','bar_license'], 'California BAR auto-repair registrations', '{"seed":"ca_owner_identity_sources","board":"ca_bar","state":"CA"}'::jsonb),
    ('state_license.ca.pest_control', 'pest_control', array['structural_pest_control_company','operator'], 'California Structural Pest Control Board records', '{"seed":"ca_owner_identity_sources","board":"ca_spcb","state":"CA"}'::jsonb),
    ('regulated.ca.calrecycle_waste', 'waste_disposal', array['waste_hauler','recycler','facility_operator'], 'California CalRecycle waste records', '{"seed":"ca_owner_identity_sources","agency":"calrecycle","state":"CA"}'::jsonb)
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
    jsonb_build_object('seed', 'ca_owner_identity_sources', 'state', 'CA', 'mapping_mode', 'registry_or_local_permit')
from (values
    ('registry.ca.bizfile'),
    ('registry.ca.los_angeles_fbn'),
    ('permits.ca.los_angeles')
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
    jsonb_build_object('seed', 'ca_owner_identity_sources', 'state', 'CA', 'mapping_mode', 'statewide_source')
from (values
    ('state_license.ca.cslb'),
    ('state_license.ca.bar_auto_repair'),
    ('state_license.ca.pest_control'),
    ('registry.ca.bizfile'),
    ('regulated.ca.calrecycle_waste')
) as source(source_key)
cross join public.leadgen_icp_locations location
where location.enabled = true
and location.country = 'US'
and location.region = 'CA'
on conflict (source_key, icp_location_value)
do update set native_values = excluded.native_values,
    enabled = true,
    metadata = public.leadgen_source_location_mappings.metadata || excluded.metadata,
    updated_at = now();

insert into public.leadgen_source_location_mappings (source_key, icp_location_value, native_values, metadata)
values
    ('registry.ca.los_angeles_fbn', 'los_angeles_ca', array['Los Angeles County'], '{"seed":"ca_owner_identity_sources","county":"Los Angeles","state":"CA"}'::jsonb),
    ('permits.ca.los_angeles', 'los_angeles_ca', array['Los Angeles'], '{"seed":"ca_owner_identity_sources","city":"Los Angeles","state":"CA"}'::jsonb)
on conflict (source_key, icp_location_value)
do update set native_values = excluded.native_values,
    enabled = true,
    metadata = public.leadgen_source_location_mappings.metadata || excluded.metadata,
    updated_at = now();

with capabilities(source_key, stage_key, priority, metadata) as (
    values
        ('state_license.ca.cslb', 'owner_identity', 36, '{"reason":"cslb_license_personnel"}'::jsonb),
        ('state_license.ca.bar_auto_repair', 'owner_identity', 48, '{"reason":"bar_repair_registration_contact"}'::jsonb),
        ('state_license.ca.pest_control', 'owner_identity', 46, '{"reason":"pest_license_operator"}'::jsonb),
        ('registry.ca.bizfile', 'owner_identity', 50, '{"reason":"entity_officer_or_registered_agent"}'::jsonb),
        ('registry.ca.los_angeles_fbn', 'owner_identity', 54, '{"reason":"fictitious_business_name_registrant"}'::jsonb),
        ('regulated.ca.calrecycle_waste', 'owner_identity', 70, '{"reason":"waste_hauler_or_facility_contact"}'::jsonb),
        ('permits.ca.los_angeles', 'owner_identity', 58, '{"reason":"permit_principal_or_contractor"}'::jsonb)
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
    'state_license.ca.cslb',
    'state_license.ca.bar_auto_repair',
    'state_license.ca.pest_control',
    'registry.ca.bizfile',
    'registry.ca.los_angeles_fbn',
    'regulated.ca.calrecycle_waste',
    'permits.ca.los_angeles'
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
    'state_license.ca.cslb',
    'state_license.ca.bar_auto_repair',
    'state_license.ca.pest_control',
    'registry.ca.bizfile',
    'registry.ca.los_angeles_fbn',
    'regulated.ca.calrecycle_waste',
    'permits.ca.los_angeles'
);

insert into public.leadgen_source_health (source_key, status, metadata)
values
    ('state_license.ca.cslb', 'unknown', '{"seeded_by":"20260701001300_leadgen_ca_owner_identity_sources","needs_adapter":true}'::jsonb),
    ('state_license.ca.bar_auto_repair', 'unknown', '{"seeded_by":"20260701001300_leadgen_ca_owner_identity_sources","needs_adapter":true}'::jsonb),
    ('state_license.ca.pest_control', 'unknown', '{"seeded_by":"20260701001300_leadgen_ca_owner_identity_sources","needs_adapter":true}'::jsonb),
    ('registry.ca.bizfile', 'unknown', '{"seeded_by":"20260701001300_leadgen_ca_owner_identity_sources","needs_adapter":true}'::jsonb),
    ('registry.ca.los_angeles_fbn', 'unknown', '{"seeded_by":"20260701001300_leadgen_ca_owner_identity_sources","needs_adapter":true}'::jsonb),
    ('regulated.ca.calrecycle_waste', 'unknown', '{"seeded_by":"20260701001300_leadgen_ca_owner_identity_sources","needs_adapter":true}'::jsonb),
    ('permits.ca.los_angeles', 'unknown', '{"seeded_by":"20260701001300_leadgen_ca_owner_identity_sources"}'::jsonb)
on conflict (source_key) do update set
    status = excluded.status,
    metadata = public.leadgen_source_health.metadata || excluded.metadata,
    updated_at = now();

with default_sources(source_key) as (
    values ('permits.ca.los_angeles')
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
