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
        'state_license.tx.tdlr',
        'Texas TDLR licensing',
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
        1500,
        '{"states":["TX"],"industries":["hvac_contractors","electricians","lighting_contractors","water_well_services"]}'::jsonb,
        '{"adapter":"tdlr_license_search","board":"tdlr","owner_identity_focus":true,"owner_phone_note":"TDLR can expose a license phone, but v1 only enables it as owner-identity evidence."}'::jsonb
    ),
    (
        'state_license.tx.plumbing',
        'Texas plumbing examiners',
        'licensing',
        3,
        3,
        3,
        2,
        'public_csv',
        'free',
        'active',
        'candidate_investigation',
        true,
        1500,
        '{"states":["TX"],"industries":["plumbers"]}'::jsonb,
        '{"adapter":"tx_plumbing_rmp_csv","source_url":"https://tsbpe.texas.gov/download-csv/RMP/","owner_identity_focus":true,"phone_note":"The public RMP CSV can expose the responsible master plumber phone, but the source is listed under owner identity first."}'::jsonb
    ),
    (
        'registry.tx.comptroller',
        'Texas Comptroller franchise tax officers',
        'registries',
        3,
        2,
        0,
        2,
        'public_api',
        'free',
        'active',
        'candidate_investigation',
        true,
        900,
        '{"states":["TX"],"industries":["plumbers","electricians","hvac_contractors","roofers","landscapers","cleaning_companies","painters","remodellers","pest_control","lighting_contractors","flooring_contractors","general_contractors","waste_disposal","auto_repair"]}'::jsonb,
        '{
            "adapter":"texas_comptroller_franchise_tax",
            "source_url":"https://comptroller.texas.gov/taxes/franchise/account-status/search",
            "claim_profile":"texas_franchise_tax_officer",
            "identity_claim_kind":"officer_identity",
            "person_role":"registered_agent_or_pir_officer",
            "query_limit":5,
            "owner_identity_points_on_match":2,
            "owner_phone_points_on_match":0,
            "business_support_points_on_match":2,
            "phone_note":"The Comptroller endpoint exposes registered agent and PIR officer names, but no owner phone field.",
            "field_map":{
                "business_name":["name","dba_name"],
                "owner_name":["officer_name","registered_agent_name"],
                "address":["mailing_address_street","registered_office_address_street","officer_address_street"],
                "city":["mailing_address_city","registered_office_address_city","officer_address_city"],
                "state":["mailing_address_state","registered_office_address_state","officer_address_state"],
                "postcode":["mailing_address_zip","registered_office_address_zip","officer_address_zip"],
                "record_id":["record_id","taxpayer_id","sos_file_number"],
                "status":["sos_registration_status","right_to_transact_tx"],
                "record_type":["record_type","officer_title"],
                "additional_match_name":["dba_name","sos_file_number"]
            }
        }'::jsonb
    ),
    (
        'state_license.tx.tda_pest',
        'Texas Agriculture structural pest licenses',
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
        '{"states":["TX"],"industries":["pest_control","landscapers"]}'::jsonb,
        '{"priority":"high","owner_identity_focus":true,"reason":"Targeted TX pest-control source; adapter/parser not wired yet."}'::jsonb
    ),
    (
        'regulated.tx.tceq_waste',
        'Texas TCEQ regulated waste records',
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
        '{"states":["TX"],"industries":["waste_disposal","cleaning_companies"]}'::jsonb,
        '{"priority":"medium","owner_identity_focus":true,"reason":"Targeted TX waste/environmental source; adapter/parser not wired yet."}'::jsonb
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
    ('state_license.tx.tdlr', 'hvac_contractors', array['a_c_contractor','a_c_technician'], 'Texas TDLR A/C licensing', '{"seed":"tx_owner_identity_sources","board":"tdlr","state":"TX"}'::jsonb),
    ('state_license.tx.tdlr', 'electricians', array['electrical_contractor','master_electrician','journeyman_electrician','electrical_sign_contractor'], 'Texas TDLR electrical licensing', '{"seed":"tx_owner_identity_sources","board":"tdlr","state":"TX"}'::jsonb),
    ('state_license.tx.tdlr', 'lighting_contractors', array['electrical_contractor','electrical_sign_contractor','master_electrician'], 'Texas TDLR electrical/sign licensing', '{"seed":"tx_owner_identity_sources","board":"tdlr","state":"TX"}'::jsonb),
    ('state_license.tx.plumbing', 'plumbers', array['responsible_master_plumber'], 'Texas plumbing Responsible Master Plumber CSV', '{"seed":"tx_owner_identity_sources","board":"tsbpe","state":"TX"}'::jsonb),
    ('state_license.tx.tda_pest', 'pest_control', array['structural_pest_control_business','certified_applicator'], 'Texas Agriculture pest-control licensing', '{"seed":"tx_owner_identity_sources","board":"tx_tda","state":"TX"}'::jsonb),
    ('state_license.tx.tda_pest', 'landscapers', array['commercial_pesticide_applicator'], 'Texas Agriculture pesticide applicator licensing', '{"seed":"tx_owner_identity_sources","board":"tx_tda","state":"TX"}'::jsonb),
    ('regulated.tx.tceq_waste', 'waste_disposal', array['regulated_entity','waste_transporter','solid_waste_registration'], 'Texas TCEQ regulated waste records', '{"seed":"tx_owner_identity_sources","agency":"tceq","state":"TX"}'::jsonb),
    ('regulated.tx.tceq_waste', 'cleaning_companies', array['regulated_entity','industrial_cleaning'], 'Texas TCEQ regulated entity records', '{"seed":"tx_owner_identity_sources","agency":"tceq","state":"TX"}'::jsonb)
on conflict (source_key, icp_industry_value)
do update set native_values = excluded.native_values,
    native_label = excluded.native_label,
    enabled = true,
    metadata = public.leadgen_source_industry_mappings.metadata || excluded.metadata,
    updated_at = now();

insert into public.leadgen_source_industry_mappings (source_key, icp_industry_value, native_values, native_label, metadata)
select 'registry.tx.comptroller',
    industry.value,
    array[industry.value],
    industry.label,
    jsonb_build_object('seed', 'tx_owner_identity_sources', 'state', 'TX', 'mapping_mode', 'state_entity_registry')
from public.leadgen_icp_industries industry
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
    jsonb_build_object('seed', 'tx_owner_identity_sources', 'state', 'TX', 'mapping_mode', 'statewide_source')
from (values
    ('state_license.tx.plumbing'),
    ('registry.tx.comptroller'),
    ('state_license.tx.tda_pest'),
    ('regulated.tx.tceq_waste')
) as source(source_key)
cross join public.leadgen_icp_locations location
where location.enabled = true
and location.country = 'US'
and location.region = 'TX'
on conflict (source_key, icp_location_value)
do update set native_values = excluded.native_values,
    enabled = true,
    metadata = public.leadgen_source_location_mappings.metadata || excluded.metadata,
    updated_at = now();

insert into public.leadgen_source_location_mappings (source_key, icp_location_value, native_values, metadata)
select 'state_license.tx.tdlr',
    mapping.icp_location_value,
    mapping.native_values,
    mapping.metadata || '{"seed":"tx_owner_identity_sources","split_source":"state_license.tx.tdlr"}'::jsonb
from public.leadgen_source_location_mappings mapping
where mapping.source_key = 'state_licensing'
and mapping.enabled = true
and cardinality(mapping.native_values) > 0
on conflict (source_key, icp_location_value)
do update set native_values = excluded.native_values,
    enabled = true,
    metadata = public.leadgen_source_location_mappings.metadata || excluded.metadata,
    updated_at = now();

with capabilities(source_key, stage_key, priority, metadata) as (
    values
        ('state_license.tx.plumbing', 'owner_identity', 32, '{"reason":"responsible_master_plumber"}'::jsonb),
        ('state_license.tx.tdlr', 'owner_identity', 36, '{"reason":"license_principal"}'::jsonb),
        ('registry.tx.comptroller', 'owner_identity', 38, '{"reason":"registered_agent_or_pir_officer"}'::jsonb),
        ('state_license.tx.tda_pest', 'owner_identity', 44, '{"reason":"pest_license_principal"}'::jsonb),
        ('regulated.tx.tceq_waste', 'owner_identity', 72, '{"reason":"regulated_entity_contact"}'::jsonb)
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
    'state_license.tx.plumbing',
    'registry.tx.comptroller',
    'state_license.tx.tda_pest',
    'regulated.tx.tceq_waste'
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
    'state_license.tx.tdlr',
    'state_license.tx.plumbing',
    'registry.tx.comptroller',
    'state_license.tx.tda_pest',
    'regulated.tx.tceq_waste'
);

insert into public.leadgen_source_health (source_key, status, metadata)
values
    ('state_license.tx.tdlr', 'unknown', '{"seeded_by":"20260701001100_leadgen_tx_owner_identity_sources"}'::jsonb),
    ('state_license.tx.plumbing', 'unknown', '{"seeded_by":"20260701001100_leadgen_tx_owner_identity_sources"}'::jsonb),
    ('registry.tx.comptroller', 'unknown', '{"seeded_by":"20260701001100_leadgen_tx_owner_identity_sources"}'::jsonb),
    ('state_license.tx.tda_pest', 'unknown', '{"seeded_by":"20260701001100_leadgen_tx_owner_identity_sources","needs_adapter":true}'::jsonb),
    ('regulated.tx.tceq_waste', 'unknown', '{"seeded_by":"20260701001100_leadgen_tx_owner_identity_sources","needs_adapter":true}'::jsonb)
on conflict (source_key) do update set
    status = excluded.status,
    metadata = public.leadgen_source_health.metadata || excluded.metadata,
    updated_at = now();

with default_sources(source_key) as (
    values
        ('state_license.tx.plumbing'),
        ('registry.tx.comptroller')
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
