insert into public.leadgen_source_industry_mappings (source_key, icp_industry_value, native_values, native_label, metadata)
select source_key, value, array[value], label, jsonb_build_object('seed', 'worker_mapping_v1', 'mapping_mode', 'candidate_support')
from public.leadgen_icp_industries
cross join (values
    ('website'),
    ('opencorporates'),
    ('sam_gov')
) as sources(source_key)
where enabled = true
on conflict (source_key, icp_industry_value)
do update set
    native_values = excluded.native_values,
    native_label = excluded.native_label,
    enabled = true,
    metadata = public.leadgen_source_industry_mappings.metadata || excluded.metadata,
    updated_at = now();

insert into public.leadgen_source_location_mappings (source_key, icp_location_value, native_values, metadata)
select source_key, value, array[value], jsonb_build_object('seed', 'worker_mapping_v1', 'mapping_mode', 'candidate_support', 'location_kind', location_kind, 'region', region, 'locality', locality)
from public.leadgen_icp_locations
cross join (values
    ('website'),
    ('opencorporates'),
    ('sam_gov')
) as sources(source_key)
where enabled = true
on conflict (source_key, icp_location_value)
do update set
    native_values = excluded.native_values,
    enabled = true,
    metadata = public.leadgen_source_location_mappings.metadata || excluded.metadata,
    updated_at = now();

insert into public.leadgen_source_industry_mappings (source_key, icp_industry_value, native_values, native_label, metadata)
values
    ('overture', 'roofers', array['roofing_contractor','roofer'], 'Overture roofers', '{"seed":"worker_mapping_v1","mapping_mode":"overture_category_alias"}'::jsonb),
    ('overture', 'remodellers', array['general_contractor','home_improvement_contractor','remodeler'], 'Overture remodellers', '{"seed":"worker_mapping_v1","mapping_mode":"overture_category_alias"}'::jsonb),
    ('overture', 'plumbers', array['plumber','plumbing_service'], 'Overture plumbers', '{"seed":"worker_mapping_v1","mapping_mode":"overture_category_alias"}'::jsonb),
    ('overture', 'hvac_contractors', array['hvac_contractor','air_conditioning_contractor','heating_contractor'], 'Overture HVAC contractors', '{"seed":"worker_mapping_v1","mapping_mode":"overture_category_alias"}'::jsonb),
    ('overture', 'electricians', array['electrician','electrical_contractor'], 'Overture electricians', '{"seed":"worker_mapping_v1","mapping_mode":"overture_category_alias"}'::jsonb),
    ('overture', 'landscapers', array['landscaper','landscaping_service'], 'Overture landscapers', '{"seed":"worker_mapping_v1","mapping_mode":"overture_category_alias"}'::jsonb),
    ('overture', 'painters', array['painter','painting_contractor'], 'Overture painters', '{"seed":"worker_mapping_v1","mapping_mode":"overture_category_alias"}'::jsonb),
    ('overture', 'pool_builders', array['swimming_pool_contractor','pool_cleaning_service'], 'Overture pool builders', '{"seed":"worker_mapping_v1","mapping_mode":"overture_category_alias"}'::jsonb),
    ('overture', 'general_contractors', array['general_contractor','construction_company'], 'Overture general contractors', '{"seed":"worker_mapping_v1","mapping_mode":"overture_category_alias"}'::jsonb),
    ('overture', 'flooring_contractors', array['flooring_contractor','flooring_store'], 'Overture flooring contractors', '{"seed":"worker_mapping_v1","mapping_mode":"overture_category_alias"}'::jsonb),
    ('overture', 'fencing_contractors', array['fence_contractor','fence_supply_store'], 'Overture fencing contractors', '{"seed":"worker_mapping_v1","mapping_mode":"overture_category_alias"}'::jsonb),
    ('overture', 'tree_services', array['tree_service','arborist'], 'Overture tree services', '{"seed":"worker_mapping_v1","mapping_mode":"overture_category_alias"}'::jsonb),
    ('overture', 'solar_installers', array['solar_energy_contractor','solar_energy_company'], 'Overture solar installers', '{"seed":"worker_mapping_v1","mapping_mode":"overture_category_alias"}'::jsonb),
    ('overture', 'restoration_companies', array['water_damage_restoration_service','fire_damage_restoration_service'], 'Overture restoration companies', '{"seed":"worker_mapping_v1","mapping_mode":"overture_category_alias"}'::jsonb)
on conflict (source_key, icp_industry_value)
do update set
    native_values = excluded.native_values,
    native_label = excluded.native_label,
    enabled = true,
    metadata = public.leadgen_source_industry_mappings.metadata || excluded.metadata,
    updated_at = now();
