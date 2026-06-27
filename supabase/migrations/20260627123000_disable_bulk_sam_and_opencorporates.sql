update public.leadgen_workspace_settings
set enabled_sources = coalesce((
    select jsonb_agg(source_value)
    from jsonb_array_elements_text(enabled_sources) as source_values(source_value)
    where source_value not in ('sam_gov', 'opencorporates')
), '[]'::jsonb)
where enabled_sources ?| array['sam_gov', 'opencorporates'];

update public.leadgen_source_industry_mappings
set enabled = false,
    metadata = metadata || jsonb_build_object(
        'disabled_reason', 'SAM.gov is validation-only on the basic API quota; OpenCorporates is excluded from the default free-source stack.',
        'disabled_at', now()
    ),
    updated_at = now()
where source_key in ('sam_gov', 'opencorporates');

update public.leadgen_source_location_mappings
set enabled = false,
    metadata = metadata || jsonb_build_object(
        'disabled_reason', 'SAM.gov is validation-only on the basic API quota; OpenCorporates is excluded from the default free-source stack.',
        'disabled_at', now()
    ),
    updated_at = now()
where source_key in ('sam_gov', 'opencorporates');
