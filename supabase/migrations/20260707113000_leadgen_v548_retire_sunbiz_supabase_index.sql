-- Lead Gen v5.4.8 Sunbiz storage rollback.
-- The full Florida Sunbiz index is too large for the Supabase database tier.
-- Keep the source visible as a future external lookup, but remove it from poll-time fan-out.

drop table if exists public.leadgen_sunbiz_owner_index cascade;

with source_updates(source_key, label, reason, metadata_patch) as (
    values
        (
            'registry.fl.sunbiz',
            'Florida Sunbiz officers',
            'Sunbiz bulk records must be queried from an external file/shard service; the retired Supabase index exceeds the database storage tier.',
            '{
                "adapter":"sunbiz_external_lookup_required",
                "poll_safety":"external_lookup_required",
                "retired_adapter":"sunbiz_owner_index",
                "retired_index_table":"leadgen_sunbiz_owner_index",
                "retired_reason":"supabase_storage_limit",
                "source_url":"https://dos.fl.gov/sunbiz/other-services/data-downloads/",
                "daily_data_url":"https://dos.fl.gov/sunbiz/other-services/data-downloads/daily-data/",
                "quarterly_data_url":"https://dos.fl.gov/sunbiz/other-services/data-downloads/quarterly-data/",
                "source_role":"direct_owner_identity"
            }'::jsonb
        ),
        (
            'registry.fl.fictitious_names',
            'Florida Sunbiz fictitious names',
            'Sunbiz fictitious-name bulk records must be queried from an external file/shard service; the retired Supabase index exceeds the database storage tier.',
            '{
                "adapter":"sunbiz_external_lookup_required",
                "poll_safety":"external_lookup_required",
                "retired_adapter":"sunbiz_owner_index",
                "retired_index_table":"leadgen_sunbiz_owner_index",
                "retired_reason":"supabase_storage_limit",
                "source_url":"https://dos.fl.gov/sunbiz/other-services/data-downloads/",
                "daily_data_url":"https://dos.fl.gov/sunbiz/other-services/data-downloads/daily-data/",
                "quarterly_data_url":"https://dos.fl.gov/sunbiz/other-services/data-downloads/quarterly-data/",
                "source_role":"direct_owner_identity"
            }'::jsonb
        )
)
update public.leadgen_source_catalog source
set label = source_updates.label,
    access_method = 'public_bulk_download_external',
    implementation_status = 'planned',
    run_stage = 'external_lookup_required',
    enabled = false,
    metadata = (
        coalesce(source.metadata, '{}'::jsonb)
        - 'adapter'
        - 'poll_safe_html'
        - 'search_url'
        - 'index_table'
        - 'claim_profile'
        - 'identity_claim_kind'
        - 'person_role'
        - 'query_limit'
        - 'search_term_limit'
        - 'field_map'
        - 'pass'
    ) || source_updates.metadata_patch || jsonb_build_object('reason', source_updates.reason),
    updated_at = now()
from source_updates
where source.source_key = source_updates.source_key;

update public.leadgen_source_stage_capabilities capabilities
set enabled = false,
    metadata = coalesce(capabilities.metadata, '{}'::jsonb) || '{
        "disabled_by":"20260707113000_leadgen_v548_retire_sunbiz_supabase_index",
        "reason":"Retired Supabase Sunbiz index exceeded database storage tier; external lookup required."
    }'::jsonb,
    updated_at = now()
where capabilities.source_key in ('registry.fl.sunbiz', 'registry.fl.fictitious_names')
and capabilities.stage_key in ('owner_identity', 'business_validation', 'owner_phone');

update public.leadgen_source_catalog source
set stage_capabilities = coalesce((
        select jsonb_agg(jsonb_build_object('stage_key', stage_key, 'priority', priority) order by priority, stage_key)
        from public.leadgen_source_stage_capabilities capabilities
        where capabilities.source_key = source.source_key
        and capabilities.enabled = true
    ), '[]'::jsonb),
    updated_at = now()
where source.source_key in ('registry.fl.sunbiz', 'registry.fl.fictitious_names');

insert into public.leadgen_source_health (source_key, status, last_error, metadata)
values
    (
        'registry.fl.sunbiz',
        'blocked',
        'Retired Supabase Sunbiz owner index exceeded database storage tier; configure external Sunbiz lookup before poll-time activation.',
        '{"disabled_by":"20260707113000_leadgen_v548_retire_sunbiz_supabase_index","status_detail":"needs_external_lookup","retired_index_table":"leadgen_sunbiz_owner_index"}'::jsonb
    ),
    (
        'registry.fl.fictitious_names',
        'blocked',
        'Retired Supabase Sunbiz fictitious-name index exceeded database storage tier; configure external Sunbiz lookup before poll-time activation.',
        '{"disabled_by":"20260707113000_leadgen_v548_retire_sunbiz_supabase_index","status_detail":"needs_external_lookup","retired_index_table":"leadgen_sunbiz_owner_index"}'::jsonb
    )
on conflict (source_key) do update set
    status = excluded.status,
    last_error = excluded.last_error,
    metadata = coalesce(public.leadgen_source_health.metadata, '{}'::jsonb) || excluded.metadata,
    updated_at = now();

with retired_sources(source_key) as (
    values
        ('registry.fl.sunbiz'),
        ('registry.fl.fictitious_names')
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
            from retired_sources
            where retired_sources.source_key = enabled_value.source_key
        )
    ) enabled_source on true
    group by settings.workspace_id
)
update public.leadgen_workspace_settings settings
set enabled_sources = cleaned_settings.enabled_sources,
    updated_at = now()
from cleaned_settings
where settings.workspace_id = cleaned_settings.workspace_id;
