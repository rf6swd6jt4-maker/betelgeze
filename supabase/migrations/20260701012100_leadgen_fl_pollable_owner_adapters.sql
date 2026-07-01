update public.leadgen_source_catalog
set implementation_status = 'active',
    run_stage = 'candidate_investigation',
    enabled = true,
    access_method = 'public_html',
    rate_limit_ms = 1600,
    metadata = (coalesce(metadata, '{}'::jsonb) - 'needs_adapter' - 'blocked_by' - 'reason') || '{
        "adapter":"guarded_html_search",
        "search_url":"https://search.sunbiz.org/Inquiry/CorporationSearch/SearchResults/EntityName/{query}/Page1",
        "provenance_url":"https://search.sunbiz.org/Inquiry/CorporationSearch/ByName",
        "claim_profile":"florida_sunbiz_entity_search",
        "identity_claim_kind":"officer_identity",
        "person_role":"officer_manager_or_registered_agent",
        "query_limit":10,
        "owner_identity_points_on_match":2,
        "owner_phone_points_on_match":0,
        "business_support_points_on_match":2,
        "default_record_type":"Florida Sunbiz entity record",
        "phone_note":"Sunbiz exposes entity people but no direct owner phone field. If Cloudflare challenges polling, the adapter records a failed task.",
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
where source_key = 'registry.fl.sunbiz';

update public.leadgen_source_catalog
set implementation_status = 'active',
    run_stage = 'candidate_investigation',
    enabled = true,
    access_method = 'public_html',
    rate_limit_ms = 1800,
    metadata = (coalesce(metadata, '{}'::jsonb) - 'needs_adapter' - 'blocked_by' - 'reason') || '{
        "adapter":"guarded_html_search",
        "search_url":"https://aessearch.fdacs.gov/companysearchr.asp?name={query}",
        "provenance_url":"https://aessearch.fdacs.gov/companysearchr.asp",
        "claim_profile":"florida_fdacs_pest_company_license",
        "identity_claim_kind":"owner_identity",
        "person_role":"pest_company_license_contact",
        "query_limit":10,
        "owner_identity_points_on_match":2,
        "owner_phone_points_on_match":0,
        "business_support_points_on_match":2,
        "default_record_type":"Florida FDACS pest-control company license",
        "phone_note":"FDACS pest search is public, but it can time out or challenge polling. The adapter fails tasks honestly when that happens.",
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
where source_key = 'state_license.fl.fdacs_pest';

update public.leadgen_source_catalog
set implementation_status = 'active',
    run_stage = 'candidate_investigation',
    enabled = true,
    access_method = 'public_html',
    rate_limit_ms = 1800,
    metadata = (coalesce(metadata, '{}'::jsonb) - 'needs_adapter' - 'blocked_by' - 'reason') || '{
        "adapter":"guarded_html_search",
        "search_url":"https://csapp.fdacs.gov/cspublicapp/businesssearch/businesssearch.aspx?search={query}",
        "provenance_url":"https://csapp.fdacs.gov/cspublicapp/businesssearch/businesssearch.aspx",
        "claim_profile":"florida_fdacs_motor_vehicle_repair_registration",
        "identity_claim_kind":"owner_identity",
        "person_role":"registered_repair_shop_contact",
        "query_limit":10,
        "owner_identity_points_on_match":2,
        "owner_phone_points_on_match":0,
        "business_support_points_on_match":2,
        "default_record_type":"Florida FDACS motor vehicle repair registration",
        "phone_note":"FDACS business search can expose registered business/contact rows, but no owner phone is counted unless a person and phone appear together.",
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
where source_key = 'state_license.fl.fdacs_auto_repair';

update public.leadgen_source_catalog
set implementation_status = 'active',
    run_stage = 'candidate_investigation',
    enabled = true,
    access_method = 'public_html',
    rate_limit_ms = 1600,
    metadata = (coalesce(metadata, '{}'::jsonb) - 'needs_adapter' - 'blocked_by' - 'reason') || '{
        "adapter":"guarded_html_search",
        "claim_profile":"florida_local_business_tax_receipt",
        "identity_claim_kind":"owner_identity",
        "person_role":"local_business_tax_owner_or_contact",
        "query_limit":10,
        "owner_identity_points_on_match":2,
        "owner_phone_points_on_match":0,
        "business_support_points_on_match":2,
        "default_record_type":"Florida local business tax receipt",
        "phone_note":"County/city BTR sites can expose owner/contact fields, but some protect public searches with Cloudflare or geo-blocks.",
        "field_map":{
            "business_name":["business_name"],
            "owner_name":["owner_name"],
            "phone":["phone"],
            "record_id":["record_id"],
            "status":["status"],
            "record_type":["record_type"],
            "additional_match_name":["raw_cells"]
        }
    }'::jsonb || case source_key
        when 'registry.fl.miami_dade_lbt' then '{"search_url":"https://miamidade.county-taxes.com/public/business_tax/search?search={query}","provenance_url":"https://miamidade.county-taxes.com/public/business_tax"}'::jsonb
        when 'registry.fl.tampa_btr' then '{"search_url":"https://apps.tampagov.net/Business_Tax_WebApp/Search.aspx?search={query}","provenance_url":"https://apps.tampagov.net/Business_Tax_WebApp/Search.aspx"}'::jsonb
        when 'registry.fl.jacksonville_btr' then '{"search_url":"https://www.county-taxes.net/fl-duval/business-tax?search={query}","provenance_url":"https://www.county-taxes.net/fl-duval/business-tax"}'::jsonb
        else '{}'::jsonb
    end,
    updated_at = now()
where source_key in ('registry.fl.miami_dade_lbt', 'registry.fl.tampa_btr', 'registry.fl.jacksonville_btr');

update public.leadgen_source_health
set status = 'unknown',
    last_error = null,
    metadata = (coalesce(metadata, '{}'::jsonb) - 'needs_adapter' - 'blocked_by') || '{"adapter_seeded_by":"20260701012100_leadgen_fl_pollable_owner_adapters"}'::jsonb,
    updated_at = now()
where source_key in (
    'registry.fl.sunbiz',
    'state_license.fl.fdacs_pest',
    'state_license.fl.fdacs_auto_repair',
    'registry.fl.miami_dade_lbt',
    'registry.fl.tampa_btr',
    'registry.fl.jacksonville_btr'
);

with default_sources(source_key) as (
    values
        ('registry.fl.sunbiz'),
        ('state_license.fl.fdacs_pest'),
        ('state_license.fl.fdacs_auto_repair'),
        ('registry.fl.miami_dade_lbt'),
        ('registry.fl.tampa_btr'),
        ('registry.fl.jacksonville_btr')
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
