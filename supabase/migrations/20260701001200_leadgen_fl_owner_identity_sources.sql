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
        'state_license.fl.dbpr',
        'Florida DBPR construction',
        'licensing',
        3,
        3,
        0,
        2,
        'public_csv',
        'free',
        'active',
        'candidate_investigation',
        true,
        2000,
        '{"states":["FL"],"industries":["general_contractors","home_builders","remodellers","roofers","hvac_contractors","plumbers","pool_builders","solar_installers"]}'::jsonb,
        '{"adapter":"dbpr_construction_csv","source_url":"https://www2.myfloridalicense.com/sto/file_download/extracts/CONSTRUCTIONLICENSE_1.csv","owner_identity_focus":true,"phone_note":"DBPR construction records usually prove the qualifier/person and business, but usually do not expose a phone field."}'::jsonb
    ),
    (
        'state_license.fl.electrical',
        'Florida DBPR electrical records',
        'licensing',
        3,
        3,
        0,
        2,
        'public_csv',
        'free',
        'active',
        'candidate_investigation',
        true,
        1500,
        '{"states":["FL"],"industries":["electricians","lighting_contractors","solar_installers","pool_builders","hvac_contractors","general_contractors"]}'::jsonb,
        '{"adapter":"dbpr_electrical_csv","source_url":"https://www2.myfloridalicense.com/sto/file_download/extracts/lic08el.csv","owner_identity_focus":true,"phone_note":"DBPR electrical records usually prove the licensee/person and business, but usually do not expose a phone field."}'::jsonb
    ),
    (
        'registry.fl.orlando_btr',
        'Orlando business tax receipts',
        'registries',
        3,
        3,
        3,
        3,
        'public_api',
        'free',
        'active',
        'candidate_investigation',
        true,
        900,
        '{"states":["FL"],"cities":["Orlando"],"industries":["plumbers","electricians","hvac_contractors","roofers","landscapers","cleaning_companies","painters","remodellers","pest_control","lighting_contractors","flooring_contractors","general_contractors","waste_disposal","auto_repair"]}'::jsonb,
        '{"adapter":"socrata_public_records","owner_identity_focus":true,"phone_note":"The same official row can expose Business Owner Name and Phone, but v1 lists it under owner identity first."}'::jsonb
    ),
    (
        'registry.fl.sunbiz',
        'Florida Sunbiz officers',
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
        '{"states":["FL"],"industries":["plumbers","electricians","hvac_contractors","roofers","landscapers","cleaning_companies","painters","remodellers","pest_control","lighting_contractors","flooring_contractors","general_contractors","waste_disposal","auto_repair"]}'::jsonb,
        '{"priority":"high","owner_identity_focus":true,"reason":"Free public source, but current public search is Cloudflare challenge-protected for automated polling."}'::jsonb
    ),
    (
        'state_license.fl.fdacs_pest',
        'Florida FDACS pest control licenses',
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
        '{"states":["FL"],"industries":["pest_control","landscapers"]}'::jsonb,
        '{"priority":"high","owner_identity_focus":true,"reason":"Targeted FL pest-control source; adapter/parser not wired yet."}'::jsonb
    ),
    (
        'state_license.fl.fdacs_auto_repair',
        'Florida FDACS motor vehicle repair registrations',
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
        '{"states":["FL"],"industries":["auto_repair"]}'::jsonb,
        '{"priority":"high","owner_identity_focus":true,"reason":"Targeted FL auto-repair source; adapter/parser not wired yet."}'::jsonb
    ),
    (
        'registry.fl.miami_dade_lbt',
        'Miami-Dade local business tax receipts',
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
        '{"states":["FL"],"counties":["Miami-Dade"],"industries":["plumbers","electricians","hvac_contractors","roofers","landscapers","cleaning_companies","painters","remodellers","pest_control","lighting_contractors","flooring_contractors","general_contractors","waste_disposal","auto_repair"]}'::jsonb,
        '{"priority":"medium","owner_identity_focus":true,"reason":"Targeted local BTR source; adapter/parser not wired yet."}'::jsonb
    ),
    (
        'registry.fl.tampa_btr',
        'Tampa business tax receipts',
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
        '{"states":["FL"],"cities":["Tampa"],"industries":["plumbers","electricians","hvac_contractors","roofers","landscapers","cleaning_companies","painters","remodellers","pest_control","lighting_contractors","flooring_contractors","general_contractors","waste_disposal","auto_repair"]}'::jsonb,
        '{"priority":"medium","owner_identity_focus":true,"reason":"Targeted local BTR source; adapter/parser not wired yet."}'::jsonb
    ),
    (
        'registry.fl.jacksonville_btr',
        'Jacksonville business tax receipts',
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
        '{"states":["FL"],"cities":["Jacksonville"],"industries":["plumbers","electricians","hvac_contractors","roofers","landscapers","cleaning_companies","painters","remodellers","pest_control","lighting_contractors","flooring_contractors","general_contractors","waste_disposal","auto_repair"]}'::jsonb,
        '{"priority":"medium","owner_identity_focus":true,"reason":"Targeted local BTR source; adapter/parser not wired yet."}'::jsonb
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
    ('state_license.fl.dbpr', 'general_contractors', array['CGC','CBC','CRC'], 'Florida DBPR general/residential contractor records', '{"seed":"fl_owner_identity_sources","board":"fl_dbpr_construction","state":"FL"}'::jsonb),
    ('state_license.fl.dbpr', 'remodellers', array['CGC','CBC','CRC'], 'Florida DBPR remodel contractor records', '{"seed":"fl_owner_identity_sources","board":"fl_dbpr_construction","state":"FL"}'::jsonb),
    ('state_license.fl.dbpr', 'roofers', array['CCC'], 'Florida DBPR roofing contractor records', '{"seed":"fl_owner_identity_sources","board":"fl_dbpr_construction","state":"FL"}'::jsonb),
    ('state_license.fl.dbpr', 'hvac_contractors', array['CAC','CMC'], 'Florida DBPR air-conditioning/mechanical contractor records', '{"seed":"fl_owner_identity_sources","board":"fl_dbpr_construction","state":"FL"}'::jsonb),
    ('state_license.fl.dbpr', 'plumbers', array['CFC'], 'Florida DBPR plumbing contractor records', '{"seed":"fl_owner_identity_sources","board":"fl_dbpr_construction","state":"FL"}'::jsonb),
    ('state_license.fl.electrical', 'electricians', array['electrical_contractor'], 'Florida DBPR electrical contractor records', '{"seed":"fl_owner_identity_sources","board":"fl_dbpr_electrical","state":"FL"}'::jsonb),
    ('state_license.fl.electrical', 'lighting_contractors', array['electrical_contractor','sign_specialty'], 'Florida DBPR lighting/electrical contractor records', '{"seed":"fl_owner_identity_sources","board":"fl_dbpr_electrical","state":"FL"}'::jsonb),
    ('state_license.fl.fdacs_pest', 'pest_control', array['pest_control_business','certified_operator'], 'Florida FDACS pest-control licensing', '{"seed":"fl_owner_identity_sources","board":"fl_fdacs","state":"FL"}'::jsonb),
    ('state_license.fl.fdacs_pest', 'landscapers', array['lawn_and_ornamental_pest_control'], 'Florida FDACS lawn/ornamental pest licensing', '{"seed":"fl_owner_identity_sources","board":"fl_fdacs","state":"FL"}'::jsonb),
    ('state_license.fl.fdacs_auto_repair', 'auto_repair', array['motor_vehicle_repair_registration'], 'Florida FDACS motor vehicle repair registration', '{"seed":"fl_owner_identity_sources","board":"fl_fdacs","state":"FL"}'::jsonb)
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
    jsonb_build_object('seed', 'fl_owner_identity_sources', 'state', 'FL', 'mapping_mode', 'registry_or_btr')
from (values
    ('registry.fl.sunbiz'),
    ('registry.fl.orlando_btr'),
    ('registry.fl.miami_dade_lbt'),
    ('registry.fl.tampa_btr'),
    ('registry.fl.jacksonville_btr')
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
    jsonb_build_object('seed', 'fl_owner_identity_sources', 'state', 'FL', 'mapping_mode', 'statewide_source')
from (values
    ('state_license.fl.dbpr'),
    ('state_license.fl.electrical'),
    ('registry.fl.sunbiz'),
    ('state_license.fl.fdacs_pest'),
    ('state_license.fl.fdacs_auto_repair')
) as source(source_key)
cross join public.leadgen_icp_locations location
where location.enabled = true
and location.country = 'US'
and location.region = 'FL'
on conflict (source_key, icp_location_value)
do update set native_values = excluded.native_values,
    enabled = true,
    metadata = public.leadgen_source_location_mappings.metadata || excluded.metadata,
    updated_at = now();

insert into public.leadgen_source_location_mappings (source_key, icp_location_value, native_values, metadata)
values
    ('registry.fl.orlando_btr', 'orlando_fl', array['Orlando'], '{"seed":"fl_owner_identity_sources","city":"Orlando","state":"FL"}'::jsonb),
    ('registry.fl.miami_dade_lbt', 'miami_fl', array['Miami-Dade'], '{"seed":"fl_owner_identity_sources","county":"Miami-Dade","state":"FL"}'::jsonb),
    ('registry.fl.tampa_btr', 'tampa_fl', array['Tampa'], '{"seed":"fl_owner_identity_sources","city":"Tampa","state":"FL"}'::jsonb),
    ('registry.fl.jacksonville_btr', 'jacksonville_fl', array['Jacksonville'], '{"seed":"fl_owner_identity_sources","city":"Jacksonville","state":"FL"}'::jsonb)
on conflict (source_key, icp_location_value)
do update set native_values = excluded.native_values,
    enabled = true,
    metadata = public.leadgen_source_location_mappings.metadata || excluded.metadata,
    updated_at = now();

with capabilities(source_key, stage_key, priority, metadata) as (
    values
        ('registry.fl.orlando_btr', 'owner_identity', 34, '{"reason":"business_tax_owner"}'::jsonb),
        ('state_license.fl.dbpr', 'owner_identity', 36, '{"reason":"dbpr_qualifier"}'::jsonb),
        ('state_license.fl.electrical', 'owner_identity', 40, '{"reason":"dbpr_licensee"}'::jsonb),
        ('registry.fl.sunbiz', 'owner_identity', 42, '{"reason":"sunbiz_officer_or_registered_agent"}'::jsonb),
        ('state_license.fl.fdacs_pest', 'owner_identity', 46, '{"reason":"pest_license_principal"}'::jsonb),
        ('state_license.fl.fdacs_auto_repair', 'owner_identity', 48, '{"reason":"motor_vehicle_repair_registrant"}'::jsonb),
        ('registry.fl.miami_dade_lbt', 'owner_identity', 58, '{"reason":"local_business_tax_owner"}'::jsonb),
        ('registry.fl.tampa_btr', 'owner_identity', 60, '{"reason":"local_business_tax_owner"}'::jsonb),
        ('registry.fl.jacksonville_btr', 'owner_identity', 62, '{"reason":"local_business_tax_owner"}'::jsonb)
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
    'state_license.fl.dbpr',
    'state_license.fl.electrical',
    'registry.fl.orlando_btr',
    'registry.fl.sunbiz',
    'state_license.fl.fdacs_pest',
    'state_license.fl.fdacs_auto_repair',
    'registry.fl.miami_dade_lbt',
    'registry.fl.tampa_btr',
    'registry.fl.jacksonville_btr'
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
    'state_license.fl.dbpr',
    'state_license.fl.electrical',
    'registry.fl.orlando_btr',
    'registry.fl.sunbiz',
    'state_license.fl.fdacs_pest',
    'state_license.fl.fdacs_auto_repair',
    'registry.fl.miami_dade_lbt',
    'registry.fl.tampa_btr',
    'registry.fl.jacksonville_btr'
);

insert into public.leadgen_source_health (source_key, status, last_error, metadata)
values
    ('state_license.fl.dbpr', 'unknown', null, '{"seeded_by":"20260701001200_leadgen_fl_owner_identity_sources"}'::jsonb),
    ('state_license.fl.electrical', 'unknown', null, '{"seeded_by":"20260701001200_leadgen_fl_owner_identity_sources"}'::jsonb),
    ('registry.fl.orlando_btr', 'unknown', null, '{"seeded_by":"20260701001200_leadgen_fl_owner_identity_sources"}'::jsonb),
    ('registry.fl.sunbiz', 'blocked', 'Free public source, but current public search is Cloudflare challenge-protected for automated polling.', '{"seeded_by":"20260701001200_leadgen_fl_owner_identity_sources","blocked_by":"cloudflare_challenge"}'::jsonb),
    ('state_license.fl.fdacs_pest', 'unknown', null, '{"seeded_by":"20260701001200_leadgen_fl_owner_identity_sources","needs_adapter":true}'::jsonb),
    ('state_license.fl.fdacs_auto_repair', 'unknown', null, '{"seeded_by":"20260701001200_leadgen_fl_owner_identity_sources","needs_adapter":true}'::jsonb),
    ('registry.fl.miami_dade_lbt', 'unknown', null, '{"seeded_by":"20260701001200_leadgen_fl_owner_identity_sources","needs_adapter":true}'::jsonb),
    ('registry.fl.tampa_btr', 'unknown', null, '{"seeded_by":"20260701001200_leadgen_fl_owner_identity_sources","needs_adapter":true}'::jsonb),
    ('registry.fl.jacksonville_btr', 'unknown', null, '{"seeded_by":"20260701001200_leadgen_fl_owner_identity_sources","needs_adapter":true}'::jsonb)
on conflict (source_key) do update set
    status = excluded.status,
    last_error = excluded.last_error,
    metadata = public.leadgen_source_health.metadata || excluded.metadata,
    updated_at = now();

with default_sources(source_key) as (
    values
        ('state_license.fl.dbpr'),
        ('state_license.fl.electrical'),
        ('registry.fl.orlando_btr')
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
