insert into public.leadgen_source_industry_mappings (source_key, icp_industry_value, native_values, native_label, metadata)
values
    ('sam_gov', 'roofers', array['238160'], 'SAM.gov NAICS: Roofing Contractors', '{"seed":"sam_naics_v2","mapping_mode":"primary_naics"}'::jsonb),
    ('sam_gov', 'remodellers', array['236118','236115','236116','236220'], 'SAM.gov NAICS: Residential Remodelers / Builders / Commercial Building', '{"seed":"sam_naics_v2","mapping_mode":"primary_naics"}'::jsonb),
    ('sam_gov', 'plumbers', array['238220'], 'SAM.gov NAICS: Plumbing, Heating, and Air-Conditioning Contractors', '{"seed":"sam_naics_v2","mapping_mode":"primary_naics"}'::jsonb),
    ('sam_gov', 'hvac_contractors', array['238220'], 'SAM.gov NAICS: Plumbing, Heating, and Air-Conditioning Contractors', '{"seed":"sam_naics_v2","mapping_mode":"primary_naics"}'::jsonb),
    ('sam_gov', 'electricians', array['238210'], 'SAM.gov NAICS: Electrical Contractors and Other Wiring Installation Contractors', '{"seed":"sam_naics_v2","mapping_mode":"primary_naics"}'::jsonb),
    ('sam_gov', 'landscapers', array['561730'], 'SAM.gov NAICS: Landscaping Services', '{"seed":"sam_naics_v2","mapping_mode":"primary_naics"}'::jsonb),
    ('sam_gov', 'painters', array['238320'], 'SAM.gov NAICS: Painting and Wall Covering Contractors', '{"seed":"sam_naics_v2","mapping_mode":"primary_naics"}'::jsonb),
    ('sam_gov', 'pool_builders', array['238990','561790'], 'SAM.gov NAICS: Other Specialty Trade Contractors / Other Services to Buildings', '{"seed":"sam_naics_v2","mapping_mode":"primary_naics"}'::jsonb),
    ('sam_gov', 'general_contractors', array['236115','236116','236220'], 'SAM.gov NAICS: Residential and Commercial Building Construction', '{"seed":"sam_naics_v2","mapping_mode":"primary_naics"}'::jsonb),
    ('sam_gov', 'flooring_contractors', array['238330'], 'SAM.gov NAICS: Flooring Contractors', '{"seed":"sam_naics_v2","mapping_mode":"primary_naics"}'::jsonb),
    ('sam_gov', 'fencing_contractors', array['238990'], 'SAM.gov NAICS: Other Specialty Trade Contractors', '{"seed":"sam_naics_v2","mapping_mode":"primary_naics"}'::jsonb),
    ('sam_gov', 'tree_services', array['561730'], 'SAM.gov NAICS: Landscaping Services', '{"seed":"sam_naics_v2","mapping_mode":"primary_naics"}'::jsonb),
    ('sam_gov', 'solar_installers', array['238210','221114'], 'SAM.gov NAICS: Electrical Contractors / Solar Electric Power Generation', '{"seed":"sam_naics_v2","mapping_mode":"primary_naics"}'::jsonb),
    ('sam_gov', 'restoration_companies', array['562910','236118'], 'SAM.gov NAICS: Remediation Services / Residential Remodelers', '{"seed":"sam_naics_v2","mapping_mode":"primary_naics"}'::jsonb),
    ('sam_gov', 'water_well_services', array['237110'], 'SAM.gov NAICS: Water and Sewer Line and Related Structures Construction', '{"seed":"sam_naics_v2","mapping_mode":"primary_naics"}'::jsonb)
on conflict (source_key, icp_industry_value)
do update set
    native_values = excluded.native_values,
    native_label = excluded.native_label,
    enabled = true,
    metadata = public.leadgen_source_industry_mappings.metadata || excluded.metadata,
    updated_at = now();
