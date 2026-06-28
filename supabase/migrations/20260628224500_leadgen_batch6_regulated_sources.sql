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
        'safety.osha',
        'OSHA establishment search',
        'safety',
        1,
        0,
        0,
        1,
        'public_html',
        'free',
        'active',
        'candidate_investigation',
        true,
        1200,
        '{"countries":["US"]}'::jsonb,
        '{
            "adapter":"osha_establishment_search",
            "provenance_url":"https://www.osha.gov/ords/imis/establishment.html",
            "claim_profile":"osha_establishment_activity",
            "query_limit":20,
            "owner_identity_points_on_match":0,
            "owner_phone_points_on_match":0,
            "business_support_points_on_match":1,
            "phone_note":"OSHA establishment search is activity/safety support only. It does not expose owner phone evidence.",
            "field_map":{
                "business_name":["establishment_name"],
                "record_id":["inspection_ids"],
                "status":["status"],
                "record_type":["inspection_count"],
                "state":["state"]
            }
        }'::jsonb
    ),
    (
        'transport.fmcsa_safer',
        'FMCSA SAFER company snapshot',
        'transport',
        3,
        0,
        0,
        3,
        'public_html',
        'free',
        'active',
        'candidate_investigation',
        true,
        1500,
        '{"countries":["US"],"industries":["moving_companies","trucking_companies","freight_forwarders","hauling_services","dumpster_rental","excavation_contractors"]}'::jsonb,
        '{
            "adapter":"fmcsa_safer_snapshot",
            "provenance_url":"https://safer.fmcsa.dot.gov/CompanySnapshot.aspx",
            "claim_profile":"fmcsa_carrier_registration",
            "person_role":"carrier_legal_name",
            "query_limit":3,
            "owner_identity_points_on_match":0,
            "owner_phone_points_on_match":0,
            "business_support_points_on_match":3,
            "phone_note":"SAFER exposes official carrier business phone/contact data. It is not treated as direct owner-phone proof unless later corroborated.",
            "field_map":{
                "business_name":["dba_name","legal_name"],
                "contractor_name":["legal_name"],
                "phone":["phone"],
                "address":["physical_address","street"],
                "city":["city"],
                "state":["state"],
                "postcode":["postcode"],
                "record_id":["usdot_number"],
                "status":["status"],
                "record_type":["entity_type","operating_authority_status"]
            }
        }'::jsonb
    ),
    (
        'regulated.epa_echo',
        'EPA ECHO regulated facilities',
        'regulated',
        1,
        0,
        0,
        1,
        'public_api',
        'free',
        'active',
        'candidate_investigation',
        true,
        1200,
        '{"countries":["US"],"industries":["environmental_contractors","demolition_contractors","excavation_contractors","septic_well_services","water_well_services","restoration_companies","industrial_cleaning","waste_management"]}'::jsonb,
        '{
            "adapter":"epa_echo_cwa_facility_info",
            "provenance_url":"https://echo.epa.gov/tools/web-services/facility-search-water",
            "claim_profile":"epa_echo_regulated_facility",
            "query_limit":10,
            "owner_identity_points_on_match":0,
            "owner_phone_points_on_match":0,
            "business_support_points_on_match":1,
            "phone_note":"EPA ECHO is compliance/activity support. It does not expose direct owner phone evidence in this adapter.",
            "field_map":{
                "business_name":["facility_name"],
                "address":["street"],
                "city":["city"],
                "state":["state"],
                "postcode":["postcode"],
                "record_id":["permit_number","source_id"],
                "status":["status"],
                "record_type":["statute"],
                "geopoint":[],
                "additional_match_name":["source_id"]
            }
        }'::jsonb
    ),
    (
        'regulated.nppes',
        'NPPES NPI Registry',
        'regulated',
        3,
        3,
        3,
        2,
        'public_api',
        'free',
        'active',
        'candidate_investigation',
        true,
        800,
        '{"countries":["US"],"industries":["healthcare_providers","medical_clinics","dental_practices","therapy_practices"]}'::jsonb,
        '{
            "adapter":"nppes_registry",
            "provenance_url":"https://npiregistry.cms.hhs.gov/",
            "claim_profile":"nppes_authorized_official_phone",
            "identity_claim_kind":"owner_identity",
            "person_role":"authorized_official",
            "query_limit":10,
            "owner_identity_points_on_match":3,
            "owner_phone_points_on_match":3,
            "business_support_points_on_match":2,
            "phone_note":"NPPES exposes organization records with authorized official name and phone. This is active only for healthcare ICPs.",
            "field_map":{
                "business_name":["organization_name"],
                "owner_name":["authorized_official_name"],
                "phone":["authorized_official_phone","phone"],
                "address":["street"],
                "city":["city"],
                "state":["state"],
                "postcode":["postcode"],
                "record_id":["npi"],
                "status":["status"],
                "record_type":["taxonomy"],
                "additional_match_name":["taxonomy","authorized_official_title"]
            }
        }'::jsonb
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

update public.leadgen_source_catalog
set implementation_status = 'blocked',
    enabled = false,
    metadata = metadata || '{"batch_6_status":"blocked_or_not_poll_safe","reason":"The public path was not safe for normal per-candidate polling. Kept catalogued but skipped until a pullable feed or refresh worker exists."}'::jsonb,
    updated_at = now()
where source_key in (
    'transport.fmcsa_insurance',
    'regulated.state_environmental_permits'
);

update public.leadgen_source_catalog
set implementation_status = 'planned',
    enabled = false,
    metadata = metadata || '{
        "batch_6_status":"bulk_refresh_required",
        "reason":"MSHA publishes free official ZIP datasets, but they must be downloaded and indexed by a scheduled refresh worker rather than scanned inside every poll.",
        "source_urls":[
            "https://arlweb.msha.gov/OpenGovernmentData/DataSets/ContractorProdYearly.zip",
            "https://arlweb.msha.gov/OpenGovernmentData/DataSets/ControllerOperatorHistory.zip",
            "https://arlweb.msha.gov/OpenGovernmentData/DataSets/Mines.zip",
            "https://arlweb.msha.gov/OpenGovernmentData/DataSets/AddressofRecord.zip"
        ]
    }'::jsonb,
    updated_at = now()
where source_key = 'regulated.msha';

insert into public.leadgen_source_health (source_key, status, metadata)
select source_key,
    'unknown',
    jsonb_build_object('seeded_by', '20260628224500_leadgen_batch6_regulated_sources')
from public.leadgen_source_catalog
where source_key in (
    'safety.osha',
    'transport.fmcsa_safer',
    'regulated.epa_echo',
    'regulated.nppes'
)
on conflict (source_key) do update set
    status = excluded.status,
    metadata = public.leadgen_source_health.metadata || excluded.metadata,
    updated_at = now();

insert into public.leadgen_source_health (source_key, status, last_error, metadata)
select source_key,
    case when source_key = 'regulated.msha' then 'unknown' else 'blocked' end,
    case
        when source_key = 'regulated.msha' then 'Bulk refresh worker required before poll-time use.'
        else metadata->>'reason'
    end,
    jsonb_build_object('seeded_by', '20260628224500_leadgen_batch6_regulated_sources')
from public.leadgen_source_catalog
where source_key in (
    'transport.fmcsa_insurance',
    'regulated.msha',
    'regulated.state_environmental_permits'
)
on conflict (source_key) do update set
    status = excluded.status,
    last_error = excluded.last_error,
    metadata = public.leadgen_source_health.metadata || excluded.metadata,
    updated_at = now();
