update public.leadgen_source_catalog
set implementation_status = 'active',
    run_stage = 'candidate_investigation',
    enabled = true,
    access_method = 'public_csv',
    rate_limit_ms = 900,
    metadata = (coalesce(metadata, '{}'::jsonb) - 'needs_adapter' - 'blocked_by' - 'reason') || '{
        "adapter":"texas_agriculture_spcs_csv",
        "source_urls":[
            "https://texasagriculture.gov/Portals/0/Reports/PIR/spcs_commercial_business.csv",
            "https://texasagriculture.gov/Portals/0/Reports/PIR/spcs_noncommercial_business.csv"
        ],
        "provenance_url":"https://texasagriculture.gov/Regulatory-Programs/Pesticides/Structural-Pest-Control-Service/Structural-Pest-Control-Reports-Current-Licenses",
        "claim_profile":"texas_agriculture_structural_pest_license",
        "identity_claim_kind":"owner_identity",
        "person_role":"responsible_applicator_or_operator",
        "query_limit":15,
        "owner_identity_points_on_match":3,
        "owner_phone_points_on_match":0,
        "business_support_points_on_match":2,
        "phone_note":"TDA business CSV exposes responsible applicator/operator names, but no direct owner phone field.",
        "field_map":{
            "business_name":["business_name","legal_business_name","LEGAL_BUSINESS_NAME","DBA"],
            "owner_name":["owner_name","RESPONSIBLE_APPLICATOR","OPERATOR"],
            "address":[],
            "city":[],
            "state":["state"],
            "postcode":[],
            "record_id":["license_number","TPCL","ACCOUNT"],
            "status":["status","LICENSE_EXPIRED"],
            "record_type":["record_type","ACCOUNT_TYPE"],
            "additional_match_name":["applicator_name","operator_name","COUNTY"]
        }
    }'::jsonb,
    updated_at = now()
where source_key = 'state_license.tx.tda_pest';

update public.leadgen_source_catalog
set implementation_status = 'active',
    run_stage = 'candidate_investigation',
    enabled = true,
    access_method = 'public_html',
    rate_limit_ms = 1100,
    metadata = (coalesce(metadata, '{}'::jsonb) - 'needs_adapter' - 'blocked_by' - 'reason') || '{
        "adapter":"tceq_central_registry",
        "source_url":"https://www15.tceq.texas.gov/crpub/index.cfm?fuseaction=regent.RNSearch",
        "provenance_url":"https://www15.tceq.texas.gov/crpub/",
        "claim_profile":"texas_tceq_regulated_entity_affiliation",
        "identity_claim_kind":"owner_identity",
        "person_role":"regulated_entity_affiliated_customer",
        "query_limit":5,
        "owner_identity_points_on_match":1,
        "owner_phone_points_on_match":0,
        "business_support_points_on_match":2,
        "phone_note":"TCEQ Central Registry exposes regulated entity and affiliated customer roles, but no direct owner phone field.",
        "field_map":{
            "business_name":["business_name","regulated_entity_name"],
            "owner_name":["owner_name"],
            "address":["street"],
            "city":["city"],
            "state":["state"],
            "postcode":["postcode"],
            "record_id":["record_id","rn_number","cn_number"],
            "status":["status"],
            "record_type":["record_type","customer_role"],
            "additional_match_name":["affiliated_customer_name"]
        }
    }'::jsonb,
    updated_at = now()
where source_key = 'regulated.tx.tceq_waste';

update public.leadgen_source_health
set status = 'unknown',
    last_error = null,
    metadata = (coalesce(metadata, '{}'::jsonb) - 'needs_adapter' - 'blocked_by') || '{"adapter_seeded_by":"20260701012000_leadgen_tx_pollable_owner_adapters"}'::jsonb,
    updated_at = now()
where source_key in ('state_license.tx.tda_pest', 'regulated.tx.tceq_waste');

with default_sources(source_key) as (
    values ('state_license.tx.tda_pest'), ('regulated.tx.tceq_waste')
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
