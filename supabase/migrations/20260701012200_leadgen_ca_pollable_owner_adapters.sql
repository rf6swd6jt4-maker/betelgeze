update public.leadgen_source_catalog
set implementation_status = 'active',
    run_stage = 'candidate_investigation',
    enabled = true,
    access_method = 'public_html',
    rate_limit_ms = 1700,
    metadata = (coalesce(metadata, '{}'::jsonb) - 'needs_adapter' - 'blocked_by' - 'reason') || '{
        "adapter":"cslb_license_search",
        "source_url":"https://www.cslb.ca.gov/onlineservices/checklicenseII/checklicense.aspx",
        "provenance_url":"https://www.cslb.ca.gov/onlineservices/checklicenseII/checklicense.aspx",
        "claim_profile":"california_cslb_contractor_license",
        "identity_claim_kind":"owner_identity",
        "person_role":"qualifying_individual",
        "query_limit":5,
        "owner_identity_points_on_match":3,
        "owner_phone_points_on_match":0,
        "business_support_points_on_match":2,
        "phone_note":"CSLB exposes business phone plus qualifying individual where present; the phone is counted as business-phone support unless a direct owner phone source later confirms it.",
        "field_map":{
            "business_name":["business_name","contractor_name"],
            "contractor_name":["contractor_name"],
            "owner_name":["owner_name"],
            "phone":["phone"],
            "address":["street"],
            "city":["city"],
            "state":["state"],
            "postcode":["postcode"],
            "record_id":["license_number"],
            "status":["status"],
            "record_type":["record_type","classifications"],
            "additional_match_name":["entity"]
        }
    }'::jsonb,
    updated_at = now()
where source_key = 'state_license.ca.cslb';

update public.leadgen_source_catalog
set implementation_status = 'active',
    run_stage = 'candidate_investigation',
    enabled = true,
    access_method = 'public_api',
    rate_limit_ms = 1400,
    metadata = (coalesce(metadata, '{}'::jsonb) - 'needs_adapter' - 'blocked_by' - 'reason') || '{
        "adapter":"dca_search_api",
        "source_url":"https://search.dca.ca.gov/advanced?BD=21",
        "provenance_url":"https://search.dca.ca.gov/advanced?BD=21",
        "claim_profile":"california_bar_auto_repair_registration",
        "identity_claim_kind":"owner_identity",
        "person_role":"bar_licensee_or_registration_contact",
        "requires_env_vars":["DCA_SEARCH_APP_ID","DCA_SEARCH_APP_KEY"],
        "dca_client_code_ids":["21"],
        "query_limit":10,
        "owner_identity_points_on_match":2,
        "owner_phone_points_on_match":0,
        "business_support_points_on_match":2,
        "phone_note":"California DCA search requires free app credentials and does not count owner-phone evidence unless a person and phone are returned together.",
        "field_map":{
            "business_name":["business_name","name"],
            "owner_name":["owner_name"],
            "address":["street"],
            "city":["city"],
            "state":["state"],
            "postcode":["postcode"],
            "record_id":["license_number"],
            "status":["status"],
            "record_type":["record_type","license_type"],
            "additional_match_name":["license_type","board_code"]
        }
    }'::jsonb,
    updated_at = now()
where source_key = 'state_license.ca.bar_auto_repair';

update public.leadgen_source_catalog
set implementation_status = 'active',
    run_stage = 'candidate_investigation',
    enabled = true,
    access_method = 'public_api',
    rate_limit_ms = 1400,
    metadata = (coalesce(metadata, '{}'::jsonb) - 'needs_adapter' - 'blocked_by' - 'reason') || '{
        "adapter":"dca_search_api",
        "source_url":"https://search.dca.ca.gov/advanced?BD=800&TP=8002",
        "provenance_url":"https://search.dca.ca.gov/advanced?BD=800&TP=8002",
        "claim_profile":"california_structural_pest_control_license",
        "identity_claim_kind":"owner_identity",
        "person_role":"structural_pest_licensee_or_operator",
        "requires_env_vars":["DCA_SEARCH_APP_ID","DCA_SEARCH_APP_KEY"],
        "dca_client_code_ids":["800","8002"],
        "query_limit":10,
        "owner_identity_points_on_match":2,
        "owner_phone_points_on_match":0,
        "business_support_points_on_match":2,
        "phone_note":"California DCA search requires free app credentials and does not count owner-phone evidence unless a person and phone are returned together.",
        "field_map":{
            "business_name":["business_name","name"],
            "owner_name":["owner_name"],
            "address":["street"],
            "city":["city"],
            "state":["state"],
            "postcode":["postcode"],
            "record_id":["license_number"],
            "status":["status"],
            "record_type":["record_type","license_type"],
            "additional_match_name":["license_type","board_code"]
        }
    }'::jsonb,
    updated_at = now()
where source_key = 'state_license.ca.pest_control';

update public.leadgen_source_catalog
set implementation_status = 'active',
    run_stage = 'candidate_investigation',
    enabled = true,
    access_method = 'public_html',
    rate_limit_ms = 1800,
    metadata = (coalesce(metadata, '{}'::jsonb) - 'needs_adapter' - 'blocked_by' - 'reason') || '{
        "adapter":"guarded_html_search",
        "search_url":"https://bizfileonline.sos.ca.gov/search/business?SearchCriteria.SearchValue={query}",
        "provenance_url":"https://bizfileonline.sos.ca.gov/search/business",
        "claim_profile":"california_bizfile_entity_search",
        "identity_claim_kind":"officer_identity",
        "person_role":"officer_manager_or_registered_agent",
        "query_limit":10,
        "owner_identity_points_on_match":2,
        "owner_phone_points_on_match":0,
        "business_support_points_on_match":2,
        "default_record_type":"California Bizfile entity record",
        "phone_note":"Bizfile can expose entity people, but the public site may return an Incapsula challenge. The adapter records that as a failed task instead of a false success.",
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
where source_key = 'registry.ca.bizfile';

update public.leadgen_source_catalog
set implementation_status = 'active',
    run_stage = 'candidate_investigation',
    enabled = true,
    access_method = 'public_api',
    rate_limit_ms = 900,
    metadata = (coalesce(metadata, '{}'::jsonb) - 'needs_adapter' - 'blocked_by' - 'reason') || '{
        "adapter":"arcgis_feature_service",
        "service_url":"https://services.arcgis.com/RmCCgQtiZLDCtblq/arcgis/rest/services/Fictitious_Business_Name/FeatureServer/0",
        "provenance_url":"https://public.gis.lacounty.gov/portal/apps/sites/#/opendata/items/2401223c34864b7b9e5884b6229a1d3c",
        "claim_profile":"los_angeles_county_fictitious_business_name",
        "identity_claim_kind":"owner_identity",
        "person_role":"registered_fbn_owner",
        "search_fields":["BusinessName","RegisteredOwnerName"],
        "query_limit":15,
        "owner_identity_points_on_match":3,
        "owner_phone_points_on_match":0,
        "business_support_points_on_match":2,
        "phone_note":"LA County FBN records expose registered owner names, not direct owner phone numbers.",
        "field_map":{
            "business_name":["BusinessName"],
            "owner_name":["RegisteredOwnerName"],
            "address":["BusinessAddress"],
            "city":["BusinessCity"],
            "state":["BusinessState"],
            "postcode":["BusinessZipCode"],
            "record_id":["FilingNumber","OBJECTID"],
            "status":["FilingType"],
            "record_type":["BusinessType"],
            "additional_match_name":["RegisteredOwnerName"]
        }
    }'::jsonb,
    updated_at = now()
where source_key = 'registry.ca.los_angeles_fbn';

update public.leadgen_source_catalog
set implementation_status = 'active',
    run_stage = 'candidate_investigation',
    enabled = true,
    access_method = 'public_api',
    rate_limit_ms = 900,
    metadata = (coalesce(metadata, '{}'::jsonb) - 'needs_adapter' - 'blocked_by' - 'reason') || '{
        "adapter":"arcgis_feature_service",
        "service_url":"https://services3.arcgis.com/6CawrotsIAWp4yUX/ArcGIS/rest/services/CalRecycle_Solid_Waste_Facilities/FeatureServer/0",
        "provenance_url":"https://calrecycle.ca.gov/",
        "claim_profile":"california_calrecycle_swis_facility",
        "identity_claim_kind":"owner_identity",
        "person_role":"facility_point_of_contact",
        "search_fields":["Site_Name","Reporting_Agency_Legal_Name","Point_of_Contact"],
        "query_limit":15,
        "owner_identity_points_on_match":1,
        "owner_phone_points_on_match":0,
        "business_support_points_on_match":2,
        "phone_note":"CalRecycle records can expose facility contacts and agency names, but they are weaker owner-identity signals and do not include direct owner phones.",
        "field_map":{
            "business_name":["Site_Name","Reporting_Agency_Legal_Name"],
            "owner_name":["Point_of_Contact"],
            "address":["Street_Address"],
            "city":["City"],
            "state":["State"],
            "postcode":["ZIP_Code"],
            "record_id":["SWIS_Number","OBJECTID"],
            "status":["OperationalStatus"],
            "record_type":["Activity","Category","Facility_Type"],
            "geopoint":["geometry"],
            "additional_match_name":["Reporting_Agency_Legal_Name","Point_of_Contact"]
        }
    }'::jsonb,
    updated_at = now()
where source_key = 'regulated.ca.calrecycle_waste';

insert into public.leadgen_source_health (source_key, status, last_error, metadata)
values
    ('state_license.ca.cslb', 'unknown', null, '{"adapter_seeded_by":"20260701012200_leadgen_ca_pollable_owner_adapters"}'::jsonb),
    ('state_license.ca.bar_auto_repair', 'unknown', null, '{"adapter_seeded_by":"20260701012200_leadgen_ca_pollable_owner_adapters","requires_env_vars":["DCA_SEARCH_APP_ID","DCA_SEARCH_APP_KEY"]}'::jsonb),
    ('state_license.ca.pest_control', 'unknown', null, '{"adapter_seeded_by":"20260701012200_leadgen_ca_pollable_owner_adapters","requires_env_vars":["DCA_SEARCH_APP_ID","DCA_SEARCH_APP_KEY"]}'::jsonb),
    ('registry.ca.bizfile', 'unknown', null, '{"adapter_seeded_by":"20260701012200_leadgen_ca_pollable_owner_adapters"}'::jsonb),
    ('registry.ca.los_angeles_fbn', 'unknown', null, '{"adapter_seeded_by":"20260701012200_leadgen_ca_pollable_owner_adapters"}'::jsonb),
    ('regulated.ca.calrecycle_waste', 'unknown', null, '{"adapter_seeded_by":"20260701012200_leadgen_ca_pollable_owner_adapters"}'::jsonb)
on conflict (source_key) do update set
    status = excluded.status,
    last_error = excluded.last_error,
    metadata = (coalesce(public.leadgen_source_health.metadata, '{}'::jsonb) - 'needs_adapter' - 'blocked_by') || excluded.metadata,
    updated_at = now();

with default_sources(source_key) as (
    values
        ('state_license.ca.cslb'),
        ('registry.ca.bizfile'),
        ('registry.ca.los_angeles_fbn'),
        ('regulated.ca.calrecycle_waste')
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
