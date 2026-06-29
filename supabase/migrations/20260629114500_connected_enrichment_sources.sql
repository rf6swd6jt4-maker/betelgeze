-- Expose only genuinely runnable enrichment sources in workspace settings.
-- These adapters already execute through public-records-worker; this migration gives
-- them ICP mappings so the settings UI can distinguish enabled vs not mapped.

update public.leadgen_source_catalog
set implementation_status = 'active',
    run_stage = 'candidate_investigation',
    enabled = true,
    access_method = case
        when source_key = 'transport.fmcsa_safer' then 'public_html'
        when source_key = 'regulated.nppes' then 'public_api'
        else access_method
    end,
    free_status = 'free',
    metadata = metadata || case
        when source_key = 'transport.fmcsa_safer' then '{"settings_exposed":true,"connected_enrichment_batch":"20260629114500","owner_phone_note":"Official carrier phone support only; not treated as direct owner-phone proof without corroborating principal evidence."}'::jsonb
        when source_key = 'regulated.nppes' then '{"settings_exposed":true,"connected_enrichment_batch":"20260629114500","owner_phone_note":"Organization records can expose authorized official name and phone for healthcare ICPs."}'::jsonb
        else '{}'::jsonb
    end,
    updated_at = now()
where source_key in ('transport.fmcsa_safer', 'regulated.nppes');

insert into public.leadgen_icp_industries (value, label, category, metadata)
values
    ('moving_companies', 'Moving Companies', 'transport', '{"seed":"connected_enrichment_sources","source":"fmcsa_safer"}'::jsonb),
    ('trucking_companies', 'Trucking Companies', 'transport', '{"seed":"connected_enrichment_sources","source":"fmcsa_safer"}'::jsonb),
    ('freight_forwarders', 'Freight Forwarders', 'transport', '{"seed":"connected_enrichment_sources","source":"fmcsa_safer"}'::jsonb),
    ('hauling_services', 'Hauling Services', 'transport', '{"seed":"connected_enrichment_sources","source":"fmcsa_safer"}'::jsonb),
    ('dumpster_rental', 'Dumpster Rental', 'home_services', '{"seed":"connected_enrichment_sources","source":"fmcsa_safer"}'::jsonb),
    ('healthcare_providers', 'Healthcare Providers', 'healthcare', '{"seed":"connected_enrichment_sources","source":"nppes"}'::jsonb),
    ('medical_clinics', 'Medical Clinics', 'healthcare', '{"seed":"connected_enrichment_sources","source":"nppes"}'::jsonb),
    ('dental_practices', 'Dental Practices', 'healthcare', '{"seed":"connected_enrichment_sources","source":"nppes"}'::jsonb),
    ('therapy_practices', 'Therapy Practices', 'healthcare', '{"seed":"connected_enrichment_sources","source":"nppes"}'::jsonb)
on conflict (value)
do update set label = excluded.label,
    category = excluded.category,
    enabled = true,
    metadata = public.leadgen_icp_industries.metadata || excluded.metadata,
    updated_at = now();

insert into public.leadgen_source_industry_mappings (source_key, icp_industry_value, native_values, native_label, metadata)
values
    ('transport.fmcsa_safer', 'moving_companies', array['carrier','motor_carrier','moving'], 'FMCSA carrier snapshot', '{"adapter":"fmcsa_safer_snapshot"}'::jsonb),
    ('transport.fmcsa_safer', 'trucking_companies', array['carrier','motor_carrier','trucking'], 'FMCSA carrier snapshot', '{"adapter":"fmcsa_safer_snapshot"}'::jsonb),
    ('transport.fmcsa_safer', 'freight_forwarders', array['freight_forwarder','broker','carrier'], 'FMCSA carrier snapshot', '{"adapter":"fmcsa_safer_snapshot"}'::jsonb),
    ('transport.fmcsa_safer', 'hauling_services', array['carrier','hauling'], 'FMCSA carrier snapshot', '{"adapter":"fmcsa_safer_snapshot"}'::jsonb),
    ('transport.fmcsa_safer', 'dumpster_rental', array['carrier','hauling','waste'], 'FMCSA carrier snapshot', '{"adapter":"fmcsa_safer_snapshot","note":"Only applies when the candidate appears to operate regulated carrier equipment."}'::jsonb),
    ('transport.fmcsa_safer', 'excavation_contractors', array['carrier','hauling','excavation'], 'FMCSA carrier snapshot', '{"adapter":"fmcsa_safer_snapshot","note":"Support evidence for excavation contractors with carrier registrations."}'::jsonb),
    ('regulated.nppes', 'healthcare_providers', array['organization_provider'], 'NPPES organization provider records', '{"adapter":"nppes_registry"}'::jsonb),
    ('regulated.nppes', 'medical_clinics', array['organization_provider','clinic'], 'NPPES organization provider records', '{"adapter":"nppes_registry"}'::jsonb),
    ('regulated.nppes', 'dental_practices', array['organization_provider','dentist'], 'NPPES organization provider records', '{"adapter":"nppes_registry"}'::jsonb),
    ('regulated.nppes', 'therapy_practices', array['organization_provider','therapy'], 'NPPES organization provider records', '{"adapter":"nppes_registry"}'::jsonb)
on conflict (source_key, icp_industry_value)
do update set native_values = excluded.native_values,
    native_label = excluded.native_label,
    enabled = true,
    metadata = public.leadgen_source_industry_mappings.metadata || excluded.metadata,
    updated_at = now();

insert into public.leadgen_source_location_mappings (source_key, icp_location_value, native_values, metadata)
select source.source_key,
    location.value,
    array[coalesce(location.region, location.country, location.value)],
    jsonb_build_object('adapter', case when source.source_key = 'transport.fmcsa_safer' then 'fmcsa_safer_snapshot' else 'nppes_registry' end, 'country', location.country, 'region', location.region)
from (values ('transport.fmcsa_safer'), ('regulated.nppes')) as source(source_key)
cross join public.leadgen_icp_locations location
where location.enabled = true
and location.country = 'US'
on conflict (source_key, icp_location_value)
do update set native_values = excluded.native_values,
    enabled = true,
    metadata = public.leadgen_source_location_mappings.metadata || excluded.metadata,
    updated_at = now();

insert into public.leadgen_source_health (source_key, status, metadata)
values
    ('transport.fmcsa_safer', 'unknown', '{"settings_exposed":true,"seeded_by":"20260629114500_connected_enrichment_sources"}'::jsonb),
    ('regulated.nppes', 'unknown', '{"settings_exposed":true,"seeded_by":"20260629114500_connected_enrichment_sources"}'::jsonb)
on conflict (source_key)
do update set status = excluded.status,
    metadata = public.leadgen_source_health.metadata || excluded.metadata,
    updated_at = now();
