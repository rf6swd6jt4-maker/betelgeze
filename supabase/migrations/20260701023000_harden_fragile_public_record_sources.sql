with source_updates(source_key, implementation_status, run_stage, access_method, health_status, reason, metadata_patch) as (
    values
        (
            'registry.fl.sunbiz',
            'planned',
            'bulk_refresh',
            'public_bulk_download',
            'bulk_refresh_required',
            'Sunbiz has free daily and quarterly data downloads, but the live search page is Cloudflare-guarded. Refresh and index the official files before poll-time activation.',
            '{
                "poll_safety":"bulk_refresh_required",
                "fragile_polling_disabled_by":"20260701023000_harden_fragile_public_record_sources",
                "bulk_download_url":"https://dos.fl.gov/sunbiz/other-services/data-downloads/",
                "daily_data_url":"https://dos.fl.gov/sunbiz/other-services/data-downloads/daily-data/",
                "quarterly_data_url":"https://dos.fl.gov/sunbiz/other-services/data-downloads/quarterly-data/",
                "dataset_note":"Use daily or quarterly corporate and fictitious-name files from the official Sunbiz download service; do not fan out against the Cloudflare-guarded search page."
            }'::jsonb
        ),
        (
            'state_license.fl.fdacs_pest',
            'planned',
            'source_specific_configuration',
            'public_endpoint_needed',
            'needs_endpoint',
            'FDACS pest search is a public HTML path that can time out or challenge poll infrastructure. Add a stable endpoint, data extract, or source-specific parser before activation.',
            '{"poll_safety":"stable_endpoint_required","fragile_polling_disabled_by":"20260701023000_harden_fragile_public_record_sources","guarded_surface":"fdacs_public_html"}'::jsonb
        ),
        (
            'state_license.fl.fdacs_auto_repair',
            'planned',
            'source_specific_configuration',
            'public_endpoint_needed',
            'needs_endpoint',
            'FDACS motor-vehicle-repair search is not stable enough as generic HTML for poll fan-out. Add a stable endpoint, data extract, or source-specific parser before activation.',
            '{"poll_safety":"stable_endpoint_required","fragile_polling_disabled_by":"20260701023000_harden_fragile_public_record_sources","guarded_surface":"fdacs_public_html"}'::jsonb
        ),
        (
            'registry.fl.miami_dade_lbt',
            'planned',
            'source_specific_configuration',
            'public_endpoint_needed',
            'needs_endpoint',
            'Miami-Dade local business tax search currently returns a Cloudflare challenge to automated polling. Add a stable endpoint or export before activation.',
            '{"poll_safety":"stable_endpoint_required","fragile_polling_disabled_by":"20260701023000_harden_fragile_public_record_sources","guarded_surface":"cloudflare_county_tax"}'::jsonb
        ),
        (
            'registry.fl.tampa_btr',
            'planned',
            'source_specific_configuration',
            'public_endpoint_needed',
            'needs_endpoint',
            'Tampa business-tax search can return edge Access Denied responses to poll infrastructure. Add a stable endpoint or export before activation.',
            '{"poll_safety":"stable_endpoint_required","fragile_polling_disabled_by":"20260701023000_harden_fragile_public_record_sources","guarded_surface":"akamai_access_denied"}'::jsonb
        ),
        (
            'registry.fl.jacksonville_btr',
            'planned',
            'source_specific_configuration',
            'public_endpoint_needed',
            'needs_endpoint',
            'Jacksonville/Duval business-tax search should not run through generic guarded HTML. Add a stable endpoint or export before activation.',
            '{"poll_safety":"stable_endpoint_required","fragile_polling_disabled_by":"20260701023000_harden_fragile_public_record_sources","guarded_surface":"county_tax_html"}'::jsonb
        ),
        (
            'registry.ca.bizfile',
            'planned',
            'source_specific_configuration',
            'public_endpoint_needed',
            'needs_endpoint',
            'California Bizfile public search can return challenge-protected HTML. Add a verified endpoint or bulk data path before poll-time activation.',
            '{"poll_safety":"stable_endpoint_required","fragile_polling_disabled_by":"20260701023000_harden_fragile_public_record_sources","guarded_surface":"bizfile_challenge_html"}'::jsonb
        ),
        (
            'state_license.az.roc',
            'planned',
            'source_specific_configuration',
            'public_endpoint_needed',
            'needs_endpoint',
            'Arizona ROC public search returns a Salesforce app shell rather than server-rendered record rows. Add a verified source-specific endpoint before activation.',
            '{"poll_safety":"source_specific_endpoint_required","fragile_polling_disabled_by":"20260701023000_harden_fragile_public_record_sources","guarded_surface":"salesforce_app_shell"}'::jsonb
        ),
        (
            'state_license.az.pest_management',
            'planned',
            'source_specific_configuration',
            'public_endpoint_needed',
            'needs_endpoint',
            'Arizona pest-management public HTML search can challenge automated polling. Add a stable endpoint, export, or source-specific parser before activation.',
            '{"poll_safety":"stable_endpoint_required","fragile_polling_disabled_by":"20260701023000_harden_fragile_public_record_sources","guarded_surface":"guarded_public_html"}'::jsonb
        ),
        (
            'registry.az.corp_commission',
            'planned',
            'source_specific_configuration',
            'public_endpoint_needed',
            'needs_endpoint',
            'Arizona Corporation Commission portal is an app shell with recaptcha assets. Add a verified endpoint or dataset path before poll-time activation.',
            '{"poll_safety":"stable_endpoint_required","fragile_polling_disabled_by":"20260701023000_harden_fragile_public_record_sources","guarded_surface":"recaptcha_app_shell"}'::jsonb
        )
)
update public.leadgen_source_catalog source
set implementation_status = source_updates.implementation_status,
    run_stage = source_updates.run_stage,
    enabled = false,
    access_method = source_updates.access_method,
    metadata = (
        coalesce(source.metadata, '{}'::jsonb)
        - 'adapter'
        - 'search_url'
        - 'claim_profile'
        - 'identity_claim_kind'
        - 'person_role'
        - 'query_limit'
        - 'field_map'
        - 'default_record_type'
        - 'owner_identity_points_on_match'
        - 'owner_phone_points_on_match'
        - 'business_support_points_on_match'
        - 'phone_note'
    ) || source_updates.metadata_patch || jsonb_build_object('reason', source_updates.reason),
    updated_at = now()
from source_updates
where source.source_key = source_updates.source_key;

with fragile_sources(source_key) as (
    values
        ('registry.fl.sunbiz'),
        ('state_license.fl.fdacs_pest'),
        ('state_license.fl.fdacs_auto_repair'),
        ('registry.fl.miami_dade_lbt'),
        ('registry.fl.tampa_btr'),
        ('registry.fl.jacksonville_btr'),
        ('registry.ca.bizfile'),
        ('state_license.az.roc'),
        ('state_license.az.pest_management'),
        ('registry.az.corp_commission')
)
update public.leadgen_source_stage_capabilities capabilities
set enabled = false,
    metadata = coalesce(capabilities.metadata, '{}'::jsonb) || '{
        "disabled_by":"20260701023000_harden_fragile_public_record_sources",
        "reason":"Removed from poll fan-out because the only adapter path was guarded generic HTML or an app shell."
    }'::jsonb,
    updated_at = now()
from fragile_sources
where capabilities.source_key = fragile_sources.source_key
and capabilities.stage_key in ('business_validation', 'owner_identity', 'owner_phone');

with fragile_sources(source_key) as (
    values
        ('registry.fl.sunbiz'),
        ('state_license.fl.fdacs_pest'),
        ('state_license.fl.fdacs_auto_repair'),
        ('registry.fl.miami_dade_lbt'),
        ('registry.fl.tampa_btr'),
        ('registry.fl.jacksonville_btr'),
        ('registry.ca.bizfile'),
        ('state_license.az.roc'),
        ('state_license.az.pest_management'),
        ('registry.az.corp_commission')
)
update public.leadgen_source_catalog source
set stage_capabilities = coalesce((
        select jsonb_agg(jsonb_build_object('stage_key', stage_key, 'priority', priority) order by priority, stage_key)
        from public.leadgen_source_stage_capabilities capabilities
        where capabilities.source_key = source.source_key
        and capabilities.enabled = true
    ), '[]'::jsonb),
    updated_at = now()
from fragile_sources
where source.source_key = fragile_sources.source_key;

with source_health_updates(source_key, status, last_error, metadata_patch) as (
    values
        ('registry.fl.sunbiz', 'bulk_refresh_required', 'Official Sunbiz data downloads must be refreshed/indexed before this source can run in polls.', '{"disabled_by":"20260701023000_harden_fragile_public_record_sources"}'::jsonb),
        ('state_license.fl.fdacs_pest', 'needs_endpoint', 'Stable FDACS pest endpoint or extract is required before poll-time activation.', '{"disabled_by":"20260701023000_harden_fragile_public_record_sources"}'::jsonb),
        ('state_license.fl.fdacs_auto_repair', 'needs_endpoint', 'Stable FDACS motor-vehicle-repair endpoint or extract is required before poll-time activation.', '{"disabled_by":"20260701023000_harden_fragile_public_record_sources"}'::jsonb),
        ('registry.fl.miami_dade_lbt', 'needs_endpoint', 'Cloudflare challenge observed on the public county-tax search path.', '{"disabled_by":"20260701023000_harden_fragile_public_record_sources","guarded_surface":"cloudflare"}'::jsonb),
        ('registry.fl.tampa_btr', 'needs_endpoint', 'Edge Access Denied observed on the public Tampa BTR search path.', '{"disabled_by":"20260701023000_harden_fragile_public_record_sources","guarded_surface":"akamai"}'::jsonb),
        ('registry.fl.jacksonville_btr', 'needs_endpoint', 'Stable Jacksonville/Duval BTR endpoint or export is required before poll-time activation.', '{"disabled_by":"20260701023000_harden_fragile_public_record_sources"}'::jsonb),
        ('registry.ca.bizfile', 'needs_endpoint', 'Stable California Bizfile endpoint or bulk data path is required before poll-time activation.', '{"disabled_by":"20260701023000_harden_fragile_public_record_sources"}'::jsonb),
        ('state_license.az.roc', 'needs_endpoint', 'Salesforce app shell observed; source-specific endpoint is required before poll-time activation.', '{"disabled_by":"20260701023000_harden_fragile_public_record_sources","guarded_surface":"salesforce_app_shell"}'::jsonb),
        ('state_license.az.pest_management', 'needs_endpoint', 'Stable Arizona pest-management endpoint or extract is required before poll-time activation.', '{"disabled_by":"20260701023000_harden_fragile_public_record_sources"}'::jsonb),
        ('registry.az.corp_commission', 'needs_endpoint', 'ACC portal app shell and recaptcha assets observed; stable endpoint or dataset is required before poll-time activation.', '{"disabled_by":"20260701023000_harden_fragile_public_record_sources","guarded_surface":"recaptcha_app_shell"}'::jsonb)
)
insert into public.leadgen_source_health (source_key, status, last_error, metadata)
select source_key, status, last_error, metadata_patch
from source_health_updates
on conflict (source_key) do update set
    status = excluded.status,
    last_error = excluded.last_error,
    metadata = coalesce(public.leadgen_source_health.metadata, '{}'::jsonb) || excluded.metadata,
    updated_at = now();

with fragile_sources(source_key) as (
    values
        ('registry.fl.sunbiz'),
        ('state_license.fl.fdacs_pest'),
        ('state_license.fl.fdacs_auto_repair'),
        ('registry.fl.miami_dade_lbt'),
        ('registry.fl.tampa_btr'),
        ('registry.fl.jacksonville_btr'),
        ('registry.ca.bizfile'),
        ('state_license.az.roc'),
        ('state_license.az.pest_management'),
        ('registry.az.corp_commission')
),
cleaned_settings as (
    select settings.workspace_id,
        coalesce(jsonb_agg(enabled_source.source_key order by enabled_source.source_key) filter (where enabled_source.source_key is not null), '[]'::jsonb) as enabled_sources
    from public.leadgen_workspace_settings settings
    left join lateral (
        select distinct enabled_value.source_key
        from jsonb_array_elements_text(coalesce(settings.enabled_sources, '[]'::jsonb)) as enabled_value(source_key)
        where not exists (
            select 1
            from fragile_sources
            where fragile_sources.source_key = enabled_value.source_key
        )
    ) enabled_source on true
    group by settings.workspace_id
)
update public.leadgen_workspace_settings settings
set enabled_sources = cleaned_settings.enabled_sources,
    updated_at = now()
from cleaned_settings
where settings.workspace_id = cleaned_settings.workspace_id;
