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
        'permits.tx.dallas',
        'Dallas active contractor registrations',
        'permits',
        3,
        0,
        0,
        3,
        'public_api',
        'free',
        'active',
        'candidate_investigation',
        true,
        900,
        '{"states":["TX"],"cities":["Dallas"]}'::jsonb,
        '{
            "adapter":"socrata_public_records",
            "domain":"www.dallasopendata.com",
            "dataset_id":"jhgk-eg9m",
            "dataset_name":"Active Contractors",
            "provenance_url":"https://www.dallasopendata.com/d/jhgk-eg9m",
            "claim_profile":"city_contractor_registration",
            "person_role":"registered_contractor",
            "query_limit":15,
            "owner_identity_points_on_match":0,
            "owner_phone_points_on_match":0,
            "business_support_points_on_match":3,
            "default_address":{"city":"Dallas","state":"TX"},
            "phone_note":"The dataset has contractor phone numbers, but does not prove the phone belongs personally to an owner.",
            "field_map":{
                "business_name":["contractor"],
                "contractor_name":["contractor"],
                "phone":["phone"],
                "address":["address"],
                "record_type":["registration_type"],
                "additional_match_name":["city_state"]
            }
        }'::jsonb
    ),
    (
        'permits.tx.austin',
        'Austin active ROW contractor licences',
        'permits',
        3,
        0,
        0,
        2,
        'public_api',
        'free',
        'active',
        'candidate_investigation',
        true,
        900,
        '{"states":["TX"],"cities":["Austin"]}'::jsonb,
        '{
            "adapter":"socrata_public_records",
            "domain":"datahub.austintexas.gov",
            "dataset_id":"8d92-wsiw",
            "dataset_name":"Active Right of Way Contractor License Holders",
            "provenance_url":"https://datahub.austintexas.gov/d/8d92-wsiw",
            "claim_profile":"city_contractor_license_activity",
            "person_role":"licensed_right_of_way_contractor",
            "query_limit":15,
            "owner_identity_points_on_match":0,
            "owner_phone_points_on_match":0,
            "business_support_points_on_match":2,
            "default_address":{"city":"Austin","state":"TX"},
            "phone_note":"No phone field is exposed; use as activity/support evidence only.",
            "field_map":{
                "business_name":["contractor_name"],
                "contractor_name":["contractor_name"],
                "record_id":["license_number"],
                "status":["expiration_date"],
                "record_type":["license_number"]
            }
        }'::jsonb
    ),
    (
        'permits.fl.orlando',
        'Orlando permit applications',
        'permits',
        3,
        2,
        2,
        3,
        'public_api',
        'free',
        'active',
        'candidate_investigation',
        true,
        900,
        '{"states":["FL"],"cities":["Orlando"]}'::jsonb,
        '{
            "adapter":"socrata_public_records",
            "domain":"data.cityoforlando.net",
            "dataset_id":"ryhf-m453",
            "dataset_name":"Permit Applications",
            "provenance_url":"https://data.cityoforlando.net/d/ryhf-m453",
            "claim_profile":"city_permit_contractor_contact",
            "person_role":"permit_contractor_or_qualifier",
            "query_limit":15,
            "owner_identity_points_on_match":2,
            "owner_phone_points_on_match":2,
            "business_support_points_on_match":3,
            "default_address":{"city":"Orlando","state":"FL"},
            "phone_note":"Contractor phone can be present, but it is treated as permit contact evidence unless another source proves ownership.",
            "field_map":{
                "business_name":["contractor_name","private_provider_company_name"],
                "contractor_name":["contractor"],
                "owner_name":["private_provider_qualifier_name"],
                "phone":["contractor_phone_number"],
                "address":["contractor_address","permit_address"],
                "record_id":["permit_number"],
                "status":["application_status"],
                "record_type":["application_type","worktype"],
                "geopoint":["geocoded_column"],
                "additional_match_name":["project_name","property_owner_name","parcel_owner_name"]
            }
        }'::jsonb
    ),
    (
        'permits.ca.los_angeles',
        'Los Angeles permits since 2018',
        'permits',
        3,
        3,
        0,
        3,
        'public_api',
        'free',
        'active',
        'candidate_investigation',
        true,
        900,
        '{"states":["CA"],"cities":["Los Angeles"]}'::jsonb,
        '{
            "adapter":"socrata_public_records",
            "domain":"data.lacity.org",
            "dataset_id":"g6eu-kwix",
            "dataset_name":"Permits Since 2018",
            "provenance_url":"https://data.lacity.org/d/g6eu-kwix",
            "claim_profile":"permit_license_principal",
            "person_role":"license_principal",
            "query_limit":15,
            "owner_identity_points_on_match":3,
            "owner_phone_points_on_match":0,
            "business_support_points_on_match":3,
            "default_address":{"city":"Los Angeles","state":"CA"},
            "phone_note":"This dataset exposes contractor business and principal names, but no phone field.",
            "field_map":{
                "business_name":["contractors_business_name","applicant_business_name"],
                "contractor_name":["contractors_business_name"],
                "record_id":["pcis_permit","reference_old_permit"],
                "status":["latest_status"],
                "record_type":["permit_type","permit_sub_type","permit_category"],
                "address":["contractor_address"],
                "city":["contractor_city"],
                "state":["contractor_state"],
                "postcode":["zip_code"],
                "geopoint":["location_1"],
                "additional_match_name":["work_description"]
            }
        }'::jsonb
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
        '{"states":["FL"],"cities":["Orlando"]}'::jsonb,
        '{
            "adapter":"socrata_public_records",
            "domain":"data.cityoforlando.net",
            "dataset_id":"7388-4re5",
            "dataset_name":"Business Tax Receipts",
            "provenance_url":"https://data.cityoforlando.net/d/7388-4re5",
            "claim_profile":"city_business_tax_owner_phone",
            "identity_claim_kind":"owner_identity",
            "person_role":"business_owner",
            "query_limit":15,
            "owner_identity_points_on_match":3,
            "owner_phone_points_on_match":3,
            "business_support_points_on_match":3,
            "default_address":{"city":"Orlando","state":"FL"},
            "phone_note":"The same official row exposes Business Owner Name and Phone, so this can qualify an owner-phone lead.",
            "field_map":{
                "business_name":["business_name"],
                "owner_name":["business_owner_name"],
                "phone":["phone"],
                "address":["business_address","business_mailing_address"],
                "record_id":["case_number"],
                "status":["license_status"],
                "record_type":["license_type","license_category"],
                "geopoint":["geocoded_column"],
                "additional_match_name":["business_email"]
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
    metadata = metadata || '{"batch_3_4_status":"blocked_or_unverified","reason":"No stable free public API/feed was verified for automated polling yet. Betelgeze keeps the source catalogued but will skip it rather than pretending it works."}'::jsonb,
    updated_at = now()
where source_key in (
    'permits.tx.fort_worth',
    'permits.tx.houston',
    'permits.tx.san_antonio',
    'permits.fl.miami_dade',
    'permits.fl.tampa',
    'permits.fl.jacksonville',
    'permits.nc.charlotte',
    'permits.nc.raleigh',
    'permits.az.phoenix',
    'permits.co.denver',
    'permits.ga.atlanta',
    'permits.tn.nashville'
);

update public.leadgen_source_catalog
set implementation_status = 'blocked',
    enabled = false,
    metadata = metadata || '{"batch_3_4_status":"blocked_or_unverified","reason":"The public registry search/download path was not safely pullable by the worker without login, payment, bot challenge, or manual SFTP/browser steps."}'::jsonb,
    updated_at = now()
where source_key in (
    'registry.tx.sos',
    'registry.fl.sunbiz',
    'registry.ca.bizfile',
    'registry.nc.sos',
    'registry.co.sos',
    'registry.az.corp_commission',
    'registry.ga.sos',
    'registry.tn.sos',
    'registry.dba.county',
    'registry.ucc',
    'registry.liens',
    'registry.county_recorder'
);

insert into public.leadgen_source_health (source_key, status, metadata)
select source_key,
    case
        when implementation_status = 'active' then 'unknown'
        when implementation_status = 'blocked' then 'blocked'
        else 'unknown'
    end,
    jsonb_build_object('seeded_by', '20260628213000_leadgen_batches_3_4_public_records')
from public.leadgen_source_catalog
where source_key in (
    'permits.tx.dallas',
    'permits.tx.austin',
    'permits.fl.orlando',
    'permits.ca.los_angeles',
    'registry.fl.orlando_btr'
)
on conflict (source_key) do update set
    status = excluded.status,
    metadata = public.leadgen_source_health.metadata || excluded.metadata,
    updated_at = now();

insert into public.leadgen_source_health (source_key, status, last_error, metadata)
select source_key,
    'blocked',
    metadata->>'reason',
    jsonb_build_object('seeded_by', '20260628213000_leadgen_batches_3_4_public_records')
from public.leadgen_source_catalog
where implementation_status = 'blocked'
  and source_key in (
    'permits.tx.fort_worth',
    'permits.tx.houston',
    'permits.tx.san_antonio',
    'permits.fl.miami_dade',
    'permits.fl.tampa',
    'permits.fl.jacksonville',
    'permits.nc.charlotte',
    'permits.nc.raleigh',
    'permits.az.phoenix',
    'permits.co.denver',
    'permits.ga.atlanta',
    'permits.tn.nashville',
    'registry.tx.sos',
    'registry.fl.sunbiz',
    'registry.ca.bizfile',
    'registry.nc.sos',
    'registry.co.sos',
    'registry.az.corp_commission',
    'registry.ga.sos',
    'registry.tn.sos',
    'registry.dba.county',
    'registry.ucc',
    'registry.liens',
    'registry.county_recorder'
)
on conflict (source_key) do update set
    status = 'blocked',
    last_error = excluded.last_error,
    metadata = public.leadgen_source_health.metadata || excluded.metadata,
    updated_at = now();
