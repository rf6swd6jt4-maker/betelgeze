-- Lead Gen v5.4 owner-identity source pass.
-- Replaces fragile poll-time Sunbiz HTML fan-out with a local index fed by official Sunbiz fixed-width downloads.

create extension if not exists pg_trgm with schema public;

create table if not exists public.leadgen_sunbiz_owner_index (
    id uuid primary key default gen_random_uuid(),
    source_key text not null check (source_key in ('registry.fl.sunbiz', 'registry.fl.fictitious_names')),
    record_id text not null,
    business_name text not null,
    status text,
    record_type text,
    person_name text not null,
    person_role text not null,
    person_source_field text not null,
    person_type text,
    address jsonb not null default '{}'::jsonb,
    search_text text not null,
    raw_payload jsonb not null default '{}'::jsonb,
    imported_at timestamptz not null default now(),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique (source_key, record_id, person_source_field, person_name)
);

create index if not exists leadgen_sunbiz_owner_index_source_search_idx
on public.leadgen_sunbiz_owner_index using gin (search_text gin_trgm_ops);

create index if not exists leadgen_sunbiz_owner_index_source_status_idx
on public.leadgen_sunbiz_owner_index (source_key, status);

drop trigger if exists leadgen_sunbiz_owner_index_updated_at on public.leadgen_sunbiz_owner_index;
create trigger leadgen_sunbiz_owner_index_updated_at
before update on public.leadgen_sunbiz_owner_index
for each row execute function public.set_updated_at();

with source_updates(source_key, label, metadata_patch) as (
    values
        (
            'registry.fl.sunbiz',
            'Florida Sunbiz officers',
            '{
                "adapter":"sunbiz_owner_index",
                "source_url":"https://dos.fl.gov/sunbiz/other-services/data-downloads/",
                "daily_data_url":"https://dos.fl.gov/sunbiz/other-services/data-downloads/daily-data/",
                "quarterly_data_url":"https://dos.fl.gov/sunbiz/other-services/data-downloads/quarterly-data/",
                "definition_url":"https://dos.sunbiz.org/data-definitions/cor.html",
                "claim_profile":"florida_sunbiz_bulk_officer_index",
                "identity_claim_kind":"officer_identity",
                "person_role":"officer_manager_or_registered_agent",
                "query_limit":14,
                "search_term_limit":6,
                "owner_identity_points_on_match":3,
                "owner_phone_points_on_match":0,
                "business_support_points_on_match":2,
                "source_role":"direct_owner_identity",
                "pass":"owner_identity_v5_4_sunbiz_owner_index",
                "poll_safety":"local_bulk_download_index",
                "field_map":{
                    "business_name":["business_name"],
                    "owner_name":["owner_name","person_name"],
                    "person_name":["person_name"],
                    "address":["address"],
                    "city":["city"],
                    "state":["state"],
                    "postcode":["postcode"],
                    "record_id":["record_id"],
                    "status":["status"],
                    "record_type":["record_type"],
                    "additional_match_name":["raw_payload"]
                }
            }'::jsonb
        ),
        (
            'registry.fl.fictitious_names',
            'Florida Sunbiz fictitious names',
            '{
                "adapter":"sunbiz_owner_index",
                "source_url":"https://dos.fl.gov/sunbiz/other-services/data-downloads/",
                "daily_data_url":"https://dos.fl.gov/sunbiz/other-services/data-downloads/daily-data/",
                "quarterly_data_url":"https://dos.fl.gov/sunbiz/other-services/data-downloads/quarterly-data/",
                "definition_url":"https://dos.sunbiz.org/data-definitions/fic.html",
                "claim_profile":"florida_sunbiz_bulk_fictitious_name_index",
                "identity_claim_kind":"owner_identity",
                "person_role":"fictitious_name_owner_or_registrant",
                "query_limit":14,
                "search_term_limit":6,
                "owner_identity_points_on_match":3,
                "owner_phone_points_on_match":0,
                "business_support_points_on_match":2,
                "source_role":"direct_owner_identity",
                "pass":"owner_identity_v5_4_sunbiz_owner_index",
                "poll_safety":"local_bulk_download_index",
                "field_map":{
                    "business_name":["business_name"],
                    "owner_name":["owner_name","person_name"],
                    "person_name":["person_name"],
                    "address":["address"],
                    "city":["city"],
                    "state":["state"],
                    "postcode":["postcode"],
                    "record_id":["record_id"],
                    "status":["status"],
                    "record_type":["record_type"],
                    "additional_match_name":["raw_payload"]
                }
            }'::jsonb
        )
)
update public.leadgen_source_catalog source
set label = source_updates.label,
    family = 'registries',
    source_points = 3,
    owner_identity_points = 3,
    owner_phone_points = 0,
    business_support_points = 2,
    access_method = 'public_bulk_download_index',
    free_status = 'free',
    implementation_status = 'active',
    run_stage = 'candidate_investigation',
    enabled = true,
    rate_limit_ms = 80,
    coverage = '{"states":["FL"]}'::jsonb,
    metadata = (
        coalesce(source.metadata, '{}'::jsonb)
        - 'search_url'
        - 'blocked_by'
        - 'reason'
        - 'fragile_polling_disabled_by'
        - 'guarded_surface'
    ) || source_updates.metadata_patch,
    updated_at = now()
from source_updates
where source.source_key = source_updates.source_key;

insert into public.leadgen_source_stage_capabilities (source_key, stage_key, priority, metadata, enabled)
values
    ('registry.fl.sunbiz', 'owner_identity', 32, '{"reason":"sunbiz_bulk_index_officer_or_manager","pass":"owner_identity_v5_4_sunbiz_owner_index"}'::jsonb, true),
    ('registry.fl.fictitious_names', 'owner_identity', 33, '{"reason":"sunbiz_bulk_index_fictitious_name_owner","pass":"owner_identity_v5_4_sunbiz_owner_index"}'::jsonb, true)
on conflict (source_key, stage_key)
do update set enabled = true,
    priority = excluded.priority,
    metadata = coalesce(public.leadgen_source_stage_capabilities.metadata, '{}'::jsonb) || excluded.metadata,
    updated_at = now();

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
    ('registry.fl.sunbiz', 'unknown', null, '{"adapter_seeded_by":"20260706223000_leadgen_v54_sunbiz_owner_index","pass":"owner_identity_v5_4_sunbiz_owner_index","index_table":"leadgen_sunbiz_owner_index"}'::jsonb),
    ('registry.fl.fictitious_names', 'unknown', null, '{"adapter_seeded_by":"20260706223000_leadgen_v54_sunbiz_owner_index","pass":"owner_identity_v5_4_sunbiz_owner_index","index_table":"leadgen_sunbiz_owner_index"}'::jsonb)
on conflict (source_key) do update set
    status = excluded.status,
    last_error = excluded.last_error,
    metadata = coalesce(public.leadgen_source_health.metadata, '{}'::jsonb) || excluded.metadata,
    updated_at = now();

with default_sources(source_key) as (
    values
        ('registry.fl.sunbiz'),
        ('registry.fl.fictitious_names')
),
expanded_settings as (
    select settings.workspace_id, jsonb_array_elements_text(settings.enabled_sources) as source_key
    from public.leadgen_workspace_settings settings
    union
    select settings.workspace_id, default_sources.source_key
    from public.leadgen_workspace_settings settings
    cross join default_sources
),
aggregated_settings as (
    select workspace_id, jsonb_agg(source_key order by source_key) as enabled_sources
    from (
        select distinct workspace_id, source_key
        from expanded_settings
        where source_key is not null and source_key <> ''
    ) deduped_settings
    group by workspace_id
)
update public.leadgen_workspace_settings settings
set enabled_sources = aggregated_settings.enabled_sources,
    updated_at = now()
from aggregated_settings
where settings.workspace_id = aggregated_settings.workspace_id;
