insert into public.leadgen_source_industry_mappings (source_key, icp_industry_value, native_values, native_label, metadata)
values
    ('overture', 'roofers', array['roofing','ceiling_and_roofing_repair_and_service'], 'Overture: roofing', '{"seed":"overture_categories_v2","mapping_mode":"observed_overture_category"}'::jsonb),
    ('overture', 'remodellers', array['altering_and_remodeling_contractor','bathroom_remodeling','kitchen_remodeling','contractor','construction_services'], 'Overture: remodeling and contractors', '{"seed":"overture_categories_v2","mapping_mode":"observed_overture_category"}'::jsonb),
    ('overture', 'plumbers', array['plumbing'], 'Overture: plumbing', '{"seed":"overture_categories_v2","mapping_mode":"observed_overture_category"}'::jsonb),
    ('overture', 'hvac_contractors', array['contractor','construction_services'], 'Overture: contractor / construction services', '{"seed":"overture_categories_v2","mapping_mode":"observed_overture_category","note":"Overture has broad contractor categories; narrow HVAC with later website/licensing enrichment."}'::jsonb),
    ('overture', 'electricians', array['electrician'], 'Overture: electrician', '{"seed":"overture_categories_v2","mapping_mode":"observed_overture_category"}'::jsonb),
    ('overture', 'landscapers', array['landscaping','landscape_architect','indoor_landscaping'], 'Overture: landscaping', '{"seed":"overture_categories_v2","mapping_mode":"observed_overture_category"}'::jsonb),
    ('overture', 'painters', array['contractor','construction_services'], 'Overture: broad contractor support for painters', '{"seed":"overture_categories_v2","mapping_mode":"broad_overture_category","note":"Needs website/category enrichment to narrow painter matches."}'::jsonb),
    ('overture', 'pool_builders', array['contractor','construction_services'], 'Overture: broad contractor support for pool builders', '{"seed":"overture_categories_v2","mapping_mode":"broad_overture_category","note":"Needs website/category enrichment to narrow pool-builder matches."}'::jsonb),
    ('overture', 'general_contractors', array['contractor','building_contractor','construction_services','construction_management'], 'Overture: contractors and construction services', '{"seed":"overture_categories_v2","mapping_mode":"observed_overture_category"}'::jsonb),
    ('overture', 'flooring_contractors', array['flooring_contractors'], 'Overture: flooring contractors', '{"seed":"overture_categories_v2","mapping_mode":"observed_overture_category"}'::jsonb),
    ('overture', 'fencing_contractors', array['contractor','construction_services'], 'Overture: broad contractor support for fencing', '{"seed":"overture_categories_v2","mapping_mode":"broad_overture_category","note":"Needs website/category enrichment to narrow fencing matches."}'::jsonb),
    ('overture', 'tree_services', array['landscaping','logging_contractor'], 'Overture: landscaping / tree support', '{"seed":"overture_categories_v2","mapping_mode":"observed_overture_category"}'::jsonb),
    ('overture', 'solar_installers', array['electrician','contractor','construction_services'], 'Overture: electrician / contractor support for solar', '{"seed":"overture_categories_v2","mapping_mode":"broad_overture_category","note":"Needs website/category enrichment to narrow solar matches."}'::jsonb),
    ('overture', 'restoration_companies', array['contractor','construction_services'], 'Overture: broad contractor support for restoration', '{"seed":"overture_categories_v2","mapping_mode":"broad_overture_category","note":"Needs website/category enrichment to narrow restoration matches."}'::jsonb),
    ('overture', 'water_well_services', array['contractor','construction_services'], 'Overture: broad contractor support for water well services', '{"seed":"overture_categories_v2","mapping_mode":"broad_overture_category","note":"Needs licensing enrichment to narrow water-well matches."}'::jsonb)
on conflict (source_key, icp_industry_value)
do update set
    native_values = excluded.native_values,
    native_label = excluded.native_label,
    enabled = true,
    metadata = public.leadgen_source_industry_mappings.metadata || excluded.metadata,
    updated_at = now();
