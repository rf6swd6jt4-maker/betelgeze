update public.leadgen_source_catalog
set implementation_status = 'active',
    run_stage = 'candidate_investigation',
    enabled = true,
    access_method = 'public_html',
    rate_limit_ms = 1800,
    metadata = (coalesce(metadata, '{}'::jsonb) - 'needs_adapter' - 'blocked_by' - 'reason') || '{
        "adapter":"guarded_html_search",
        "search_url":"https://azroc.my.site.com/AZRoc/s/contractor-search?search={query}",
        "provenance_url":"https://azroc.my.site.com/AZRoc/s/contractor-search",
        "claim_profile":"arizona_roc_contractor_license",
        "identity_claim_kind":"owner_identity",
        "person_role":"qualifying_party_or_license_principal",
        "query_limit":10,
        "owner_identity_points_on_match":2,
        "owner_phone_points_on_match":0,
        "business_support_points_on_match":2,
        "default_record_type":"Arizona ROC contractor license",
        "phone_note":"Arizona ROC may expose qualifier/principal rows, but the public Salesforce site can hide rows behind app endpoints. The adapter fails explicitly when rows are not parseable.",
        "field_map":{
            "business_name":["business_name"],
            "owner_name":["owner_name"],
            "phone":["phone"],
            "record_id":["record_id"],
            "status":["status"],
            "record_type":["record_type"],
            "additional_match_name":["raw_cells"]
        }
    }'::jsonb,
    updated_at = now()
where source_key = 'state_license.az.roc';

update public.leadgen_source_catalog
set implementation_status = 'active',
    run_stage = 'candidate_investigation',
    enabled = true,
    access_method = 'public_html',
    rate_limit_ms = 1800,
    metadata = (coalesce(metadata, '{}'::jsonb) - 'needs_adapter' - 'blocked_by' - 'reason') || '{
        "adapter":"guarded_html_search",
        "search_url":"http://opm.azda.gov/PCBusSearch.php?name={query}",
        "provenance_url":"http://opm.azda.gov/PCBusSearch.php",
        "claim_profile":"arizona_pest_management_business_license",
        "identity_claim_kind":"owner_identity",
        "person_role":"qualifying_party_or_license_contact",
        "query_limit":10,
        "owner_identity_points_on_match":2,
        "owner_phone_points_on_match":0,
        "business_support_points_on_match":2,
        "default_record_type":"Arizona pest-management business license",
        "phone_note":"Arizona pest-management business search is public, but may return a Cloudflare challenge from server infrastructure. The adapter records that as a failed task.",
        "field_map":{
            "business_name":["business_name"],
            "owner_name":["owner_name"],
            "phone":["phone"],
            "record_id":["record_id"],
            "status":["status"],
            "record_type":["record_type"],
            "additional_match_name":["raw_cells"]
        }
    }'::jsonb,
    updated_at = now()
where source_key = 'state_license.az.pest_management';

update public.leadgen_source_catalog
set implementation_status = 'active',
    run_stage = 'candidate_investigation',
    enabled = true,
    access_method = 'public_html',
    rate_limit_ms = 1800,
    metadata = (coalesce(metadata, '{}'::jsonb) - 'needs_adapter' - 'blocked_by' - 'reason') || '{
        "adapter":"guarded_html_search",
        "search_url":"https://efiling.azcc.gov/public-records?search={query}",
        "provenance_url":"https://efiling.azcc.gov/public-records",
        "claim_profile":"arizona_corporation_commission_entity_record",
        "identity_claim_kind":"officer_identity",
        "person_role":"statutory_agent_officer_or_member",
        "query_limit":10,
        "owner_identity_points_on_match":2,
        "owner_phone_points_on_match":0,
        "business_support_points_on_match":2,
        "default_record_type":"Arizona Corporation Commission entity record",
        "phone_note":"ACC public records can expose statutory agents/officers, but the portal may require recaptcha or app calls. The adapter fails explicitly rather than claiming success without rows.",
        "field_map":{
            "business_name":["business_name"],
            "owner_name":["owner_name"],
            "phone":["phone"],
            "record_id":["record_id"],
            "status":["status"],
            "record_type":["record_type"],
            "additional_match_name":["raw_cells"]
        }
    }'::jsonb,
    updated_at = now()
where source_key = 'registry.az.corp_commission';

update public.leadgen_source_catalog
set implementation_status = 'active',
    run_stage = 'candidate_investigation',
    enabled = true,
    access_method = 'public_csv',
    rate_limit_ms = 900,
    metadata = (coalesce(metadata, '{}'::jsonb) - 'needs_adapter' - 'blocked_by' - 'reason') || '{
        "adapter":"phoenix_issued_permit_csv",
        "source_url":"https://apps-secure.phoenix.gov/PDD/Search/IssuedPermit",
        "provenance_url":"https://apps-secure.phoenix.gov/PDD/Search/IssuedPermit",
        "claim_profile":"phoenix_issued_permit_contractors",
        "identity_claim_kind":"owner_identity",
        "person_role":"sole_proprietor_contractor_name_when_person_like",
        "permit_type":"PERS",
        "query_limit":10,
        "owner_identity_points_on_match":1,
        "owner_phone_points_on_match":0,
        "business_support_points_on_match":3,
        "phone_note":"Phoenix permits expose contractor business phones. Permit property-owner names are stored only as match context and are not counted as lead-owner identities.",
        "field_map":{
            "business_name":["business_name","Contractor"],
            "contractor_name":["contractor_name","Contractor"],
            "owner_name":["owner_name"],
            "phone":["phone","Cont Phone"],
            "address":["street","Address"],
            "city":["city"],
            "state":["state"],
            "postcode":["postcode"],
            "record_id":["permit_number","Number"],
            "status":["status","Status"],
            "record_type":["record_type","Type","Struct Class","Use"],
            "additional_match_name":["additional_match_name","Contractor"]
        }
    }'::jsonb,
    updated_at = now()
where source_key = 'permits.az.phoenix';

insert into public.leadgen_source_health (source_key, status, last_error, metadata)
values
    ('state_license.az.roc', 'unknown', null, '{"adapter_seeded_by":"20260701012300_leadgen_az_pollable_owner_adapters"}'::jsonb),
    ('state_license.az.pest_management', 'unknown', null, '{"adapter_seeded_by":"20260701012300_leadgen_az_pollable_owner_adapters"}'::jsonb),
    ('registry.az.corp_commission', 'unknown', null, '{"adapter_seeded_by":"20260701012300_leadgen_az_pollable_owner_adapters"}'::jsonb),
    ('permits.az.phoenix', 'unknown', null, '{"adapter_seeded_by":"20260701012300_leadgen_az_pollable_owner_adapters"}'::jsonb)
on conflict (source_key) do update set
    status = excluded.status,
    last_error = excluded.last_error,
    metadata = (coalesce(public.leadgen_source_health.metadata, '{}'::jsonb) - 'needs_adapter' - 'blocked_by') || excluded.metadata,
    updated_at = now();

with default_sources(source_key) as (
    values
        ('state_license.az.roc'),
        ('state_license.az.pest_management'),
        ('registry.az.corp_commission'),
        ('permits.az.phoenix')
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
