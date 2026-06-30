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
        ('transport.fmcsa_safer')
),
workspace_sources as (
    select settings.workspace_id,
        array(
            select distinct value
            from unnest(coalesce(settings.enabled_sources, '{}'::text[]) || array(select source_key from recommended)) as values(value)
            where value is not null and value <> ''
            order by value
        ) as enabled_sources
    from public.leadgen_workspace_settings settings
)
update public.leadgen_workspace_settings settings
set enabled_sources = workspace_sources.enabled_sources,
    source_config = coalesce(settings.source_config, '{}'::jsonb),
    updated_at = now()
from workspace_sources
where settings.workspace_id = workspace_sources.workspace_id;
