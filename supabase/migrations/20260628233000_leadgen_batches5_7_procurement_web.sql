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
        'procurement.usaspending',
        'USAspending federal awards',
        'procurement',
        2,
        0,
        0,
        2,
        'public_api',
        'free',
        'active',
        'candidate_investigation',
        true,
        900,
        '{"countries":["US"]}'::jsonb,
        '{
            "adapter":"usaspending_awards",
            "provenance_url":"https://api.usaspending.gov/docs/endpoints",
            "claim_profile":"federal_award_activity",
            "query_limit":10,
            "owner_identity_points_on_match":0,
            "owner_phone_points_on_match":0,
            "business_support_points_on_match":2,
            "phone_note":"USAspending proves award/vendor activity, but does not expose direct owner phone evidence.",
            "field_map":{
                "business_name":["recipient_name"],
                "record_id":["award_id"],
                "status":["start_date","end_date"],
                "record_type":["naics_code","naics_description"],
                "additional_match_name":["awarding_agency"]
            }
        }'::jsonb
    ),
    (
        'web.rdap_whois',
        'Domain RDAP / WHOIS',
        'web',
        1,
        0,
        0,
        1,
        'public_api',
        'free',
        'active',
        'candidate_investigation',
        true,
        800,
        '{"countries":["US"],"tlds":["com","net"]}'::jsonb,
        '{
            "adapter":"rdap_domain",
            "provenance_url":"https://rdap.verisign.com/",
            "claim_profile":"domain_registration_support",
            "query_limit":1,
            "owner_identity_points_on_match":0,
            "owner_phone_points_on_match":0,
            "business_support_points_on_match":1,
            "phone_note":"Modern RDAP is usually privacy-redacted. This adapter is domain existence/age support only.",
            "field_map":{
                "business_name":["candidate_display_name"],
                "record_id":["domain","rdap_handle"],
                "status":["status"],
                "record_type":["registrar"],
                "additional_match_name":["domain","registrar"]
            }
        }'::jsonb
    ),
    (
        'web.certificate_transparency',
        'Certificate transparency',
        'web',
        1,
        0,
        0,
        1,
        'public_api',
        'free',
        'active',
        'candidate_investigation',
        true,
        800,
        '{"countries":["US"]}'::jsonb,
        '{
            "adapter":"certificate_transparency",
            "provenance_url":"https://crt.sh/",
            "claim_profile":"domain_certificate_activity",
            "query_limit":5,
            "owner_identity_points_on_match":0,
            "owner_phone_points_on_match":0,
            "business_support_points_on_match":1,
            "phone_note":"Certificate transparency proves domain activity only. It does not prove owner identity or phone.",
            "field_map":{
                "business_name":["candidate_display_name"],
                "record_id":["certificate_id","domain"],
                "status":["not_after"],
                "record_type":["issuer_name","common_name"],
                "additional_match_name":["domain","common_name"]
            }
        }'::jsonb
    ),
    (
        'website',
        'Company website crawler',
        'web',
        2,
        2,
        2,
        1,
        'public_html',
        'free',
        'active',
        'candidate_investigation',
        true,
        500,
        '{"countries":["US"]}'::jsonb,
        '{"batch_7_status":"already_active","adapter":"website_crawler","phone_rule":"owner_phone_only_when_near_owner_evidence"}'::jsonb
    ),
    (
        'web.json_ld',
        'Website structured data / JSON-LD',
        'web',
        1,
        0,
        0,
        1,
        'public_html',
        'free',
        'active',
        'candidate_investigation',
        true,
        500,
        '{"countries":["US"]}'::jsonb,
        '{"batch_7_status":"already_active","adapter":"website"}'::jsonb
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
set implementation_status = 'validation_only',
    run_stage = 'validation',
    enabled = false,
    metadata = metadata || '{"batch_5_status":"validation_only","reason":"SAM.gov basic accounts are too quota-limited for bulk polling. Use only later for validating top-ranked finalists."}'::jsonb,
    updated_at = now()
where source_key = 'sam_gov';

update public.leadgen_source_catalog
set implementation_status = 'planned',
    run_stage = 'source_specific_configuration',
    enabled = false,
    metadata = metadata || '{"batch_5_status":"source_specific_configuration_required","reason":"This source family is real, but there is no universal free API. Add jurisdiction-specific public APIs, CSV feeds, or HTML parsers before poll-time activation."}'::jsonb,
    updated_at = now()
where source_key in (
    'procurement.state_awards',
    'procurement.local_vendor_lists',
    'procurement.school_vendor_lists',
    'procurement.bid_tabs',
    'procurement.planholders',
    'procurement.prequalified_contractors'
);

update public.leadgen_source_catalog
set implementation_status = 'blocked',
    run_stage = 'blocked',
    enabled = false,
    metadata = metadata || '{"batch_7_status":"blocked_or_not_compliant_for_polling","reason":"This source does not currently expose a stable free public API/feed suitable for compliant automated candidate investigation."}'::jsonb,
    updated_at = now()
where source_key in (
    'directory.bbb',
    'web.linkedin_public',
    'web.social_bios',
    'web.local_news',
    'web.press_releases'
);

update public.leadgen_source_catalog
set implementation_status = 'planned',
    run_stage = 'source_specific_configuration',
    enabled = false,
    metadata = metadata || '{"batch_7_status":"source_specific_configuration_required","reason":"This source family needs a curated list of public member/installer directory endpoints before it can run honestly in polls."}'::jsonb,
    updated_at = now()
where source_key in (
    'directory.chamber',
    'directory.trade_associations',
    'directory.manufacturer_installers'
);

update public.leadgen_source_catalog
set implementation_status = 'planned',
    run_stage = 'bulk_refresh',
    enabled = false,
    metadata = metadata || '{"batch_7_status":"bulk_refresh_required","reason":"This public dataset should be refreshed and indexed by a scheduled job, not queried synchronously for every candidate."}'::jsonb,
    updated_at = now()
where source_key in (
    'directory.foursquare_os_places',
    'directory.alltheplaces'
);

insert into public.leadgen_source_health (source_key, status, metadata)
select source_key,
    'unknown',
    jsonb_build_object('seeded_by', '20260628233000_leadgen_batches5_7_procurement_web')
from public.leadgen_source_catalog
where source_key in (
    'procurement.usaspending',
    'web.rdap_whois',
    'web.certificate_transparency',
    'website',
    'web.json_ld'
)
on conflict (source_key) do update set
    status = excluded.status,
    metadata = public.leadgen_source_health.metadata || excluded.metadata,
    updated_at = now();

insert into public.leadgen_source_health (source_key, status, last_error, metadata)
select source_key,
    case
        when implementation_status = 'blocked' then 'blocked'
        else 'unknown'
    end,
    metadata->>'reason',
    jsonb_build_object('seeded_by', '20260628233000_leadgen_batches5_7_procurement_web')
from public.leadgen_source_catalog
where source_key in (
    'sam_gov',
    'procurement.state_awards',
    'procurement.local_vendor_lists',
    'procurement.school_vendor_lists',
    'procurement.bid_tabs',
    'procurement.planholders',
    'procurement.prequalified_contractors',
    'directory.bbb',
    'directory.chamber',
    'directory.trade_associations',
    'directory.manufacturer_installers',
    'directory.foursquare_os_places',
    'directory.alltheplaces',
    'web.linkedin_public',
    'web.local_news',
    'web.press_releases',
    'web.social_bios'
)
on conflict (source_key) do update set
    status = excluded.status,
    last_error = excluded.last_error,
    metadata = public.leadgen_source_health.metadata || excluded.metadata,
    updated_at = now();
