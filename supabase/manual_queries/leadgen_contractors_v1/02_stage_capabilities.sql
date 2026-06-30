-- Leadgen contractor v1 stage capabilities.
-- Run after 01_source_catalog.sql.

with capabilities(source_key, stage_key, priority, metadata) as (
    values
        ('state_license.tx.plumbing', 'business_validation', 32, '{"reason":"current_responsible_master_plumber"}'::jsonb),
        ('state_license.tx.plumbing', 'owner_identity', 32, '{"reason":"responsible_master_plumber_name"}'::jsonb),
        ('state_license.tx.plumbing', 'owner_phone', 32, '{"reason":"responsible_master_plumber_phone"}'::jsonb),
        ('state_license.fl.dbpr', 'business_validation', 43, '{"reason":"active_construction_license"}'::jsonb),
        ('state_license.fl.dbpr', 'owner_identity', 43, '{"reason":"qualifier_or_licensee_name"}'::jsonb),
        ('state_license.fl.electrical', 'business_validation', 45, '{"reason":"active_electrical_license"}'::jsonb),
        ('state_license.fl.electrical', 'owner_identity', 45, '{"reason":"qualifier_or_licensee_name"}'::jsonb),
        ('state_license.nc.general_contractors', 'business_validation', 45, '{"reason":"active_general_contractor_license"}'::jsonb),
        ('state_license.nc.general_contractors', 'owner_identity', 45, '{"reason":"licensee_or_qualifier_name"}'::jsonb),
        ('state_license.nc.general_contractors', 'owner_phone', 45, '{"reason":"licensee_phone"}'::jsonb),
        ('permits.tx.dallas', 'business_validation', 70, '{"reason":"city_contractor_registration"}'::jsonb),
        ('permits.tx.austin', 'business_validation', 70, '{"reason":"city_contractor_license_activity"}'::jsonb),
        ('permits.fl.orlando', 'business_validation', 70, '{"reason":"permit_activity"}'::jsonb),
        ('permits.fl.orlando', 'owner_identity', 70, '{"reason":"permit_qualifier_or_contact"}'::jsonb),
        ('permits.fl.orlando', 'owner_phone', 70, '{"reason":"permit_contact_phone"}'::jsonb),
        ('registry.fl.orlando_btr', 'business_validation', 65, '{"reason":"business_tax_record"}'::jsonb),
        ('registry.fl.orlando_btr', 'owner_identity', 65, '{"reason":"business_owner_name"}'::jsonb),
        ('registry.fl.orlando_btr', 'owner_phone', 65, '{"reason":"business_owner_phone"}'::jsonb),
        ('permits.ca.los_angeles', 'business_validation', 70, '{"reason":"permit_activity"}'::jsonb),
        ('permits.ca.los_angeles', 'owner_identity', 70, '{"reason":"license_principal"}'::jsonb),
        ('regulated.epa_echo', 'business_validation', 85, '{"reason":"regulated_facility"}'::jsonb)
)
insert into public.leadgen_source_stage_capabilities (source_key, stage_key, priority, metadata)
select capabilities.source_key, capabilities.stage_key, capabilities.priority, capabilities.metadata
from capabilities
join public.leadgen_source_catalog source on source.source_key = capabilities.source_key
on conflict (source_key, stage_key)
do update set
    enabled = true,
    priority = excluded.priority,
    metadata = public.leadgen_source_stage_capabilities.metadata || excluded.metadata,
    updated_at = now();

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
where source.source_key = capabilities.source_key;
