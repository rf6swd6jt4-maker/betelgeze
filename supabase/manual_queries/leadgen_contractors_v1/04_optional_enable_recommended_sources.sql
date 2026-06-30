-- Optional: enable the recommended contractor v1 sources for existing workspaces.
-- Skip this if you prefer to toggle sources manually in the Sources tab.

with recommended(source_key) as (
    values
        ('state_license.tx.tdlr'),
        ('state_license.tx.plumbing'),
        ('state_license.fl.dbpr'),
        ('state_license.fl.electrical'),
        ('state_license.nc.general_contractors'),
        ('permits.tx.dallas'),
        ('permits.tx.austin'),
        ('permits.fl.orlando'),
        ('registry.fl.orlando_btr'),
        ('permits.ca.los_angeles'),
        ('regulated.epa_echo'),
        ('transport.fmcsa_safer'),
        ('website'),
        ('phone.basic_format_validation')
),
workspace_sources as (
    select settings.workspace_id,
        array_agg(distinct merged.source_key order by merged.source_key) as enabled_sources
    from public.leadgen_workspace_settings settings
    cross join lateral (
        select unnest(coalesce(settings.enabled_sources, '{}'::text[])) as source_key
        union all
        select recommended.source_key
        from recommended
    ) merged
    where merged.source_key is not null
    and merged.source_key <> ''
    group by settings.workspace_id
)
update public.leadgen_workspace_settings settings
set enabled_sources = workspace_sources.enabled_sources,
    source_config = coalesce(settings.source_config, '{}'::jsonb),
    updated_at = now()
from workspace_sources
where settings.workspace_id = workspace_sources.workspace_id;
