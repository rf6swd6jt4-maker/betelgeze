alter table public.leadgen_polls
add column if not exists current_stage text not null default 'queued',
add column if not exists target_validated_count integer not null default 10 check (target_validated_count between 1 and 100),
add column if not exists max_seed_candidates integer not null default 50 check (max_seed_candidates between 1 and 500),
add column if not exists seeded_count integer not null default 0,
add column if not exists validation_passed_count integer not null default 0,
add column if not exists owner_identity_count integer not null default 0,
add column if not exists owner_phone_count integer not null default 0,
add column if not exists callable_phone_count integer not null default 0,
add column if not exists stage_summary jsonb not null default '{}'::jsonb;

alter table public.leadgen_source_catalog
add column if not exists stage_capabilities jsonb not null default '[]'::jsonb;

create table if not exists public.leadgen_poll_stage_runs (
    id uuid primary key default gen_random_uuid(),
    workspace_id uuid not null references public.workspaces(id) on delete cascade,
    poll_id uuid not null references public.leadgen_polls(id) on delete cascade,
    stage_key text not null check (stage_key in ('seed', 'business_validation', 'owner_identity', 'owner_phone', 'phone_validation')),
    stage_order integer not null,
    status text not null default 'queued' check (status in ('queued', 'running', 'completed', 'failed', 'skipped')),
    target_count integer,
    input_count integer not null default 0,
    passed_count integer not null default 0,
    failed_count integer not null default 0,
    skipped_count integer not null default 0,
    replaced_count integer not null default 0,
    error text,
    metrics jsonb not null default '{}'::jsonb,
    started_at timestamptz,
    completed_at timestamptz,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique (poll_id, stage_key)
);

create table if not exists public.leadgen_company_stage_status (
    id uuid primary key default gen_random_uuid(),
    workspace_id uuid not null references public.workspaces(id) on delete cascade,
    poll_id uuid not null references public.leadgen_polls(id) on delete cascade,
    company_id uuid not null references public.leadgen_companies(id) on delete cascade,
    stage_key text not null check (stage_key in ('business_validation', 'owner_identity', 'owner_phone', 'phone_validation')),
    status text not null default 'queued' check (status in ('queued', 'running', 'passed', 'failed', 'skipped')),
    attempt_number integer not null default 1,
    source_keys jsonb not null default '[]'::jsonb,
    score integer not null default 0,
    reason text,
    metrics jsonb not null default '{}'::jsonb,
    started_at timestamptz,
    completed_at timestamptz,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique (poll_id, company_id, stage_key)
);

create table if not exists public.leadgen_source_stage_capabilities (
    source_key text not null references public.leadgen_source_catalog(source_key) on delete cascade,
    stage_key text not null check (stage_key in ('seed', 'business_validation', 'owner_identity', 'owner_phone', 'phone_validation')),
    enabled boolean not null default true,
    priority integer not null default 100,
    metadata jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    primary key (source_key, stage_key)
);

insert into public.leadgen_source_catalog (
    source_key,
    label,
    family,
    source_points,
    owner_identity_points,
    owner_phone_points,
    business_support_points,
    access_method,
    free_status,
    implementation_status,
    run_stage,
    enabled,
    rate_limit_ms,
    coverage,
    metadata
) values (
    'phone.basic_format_validation',
    'Basic phone format validation',
    'phone_validation',
    1,
    0,
    0,
    0,
    'internal',
    'internal',
    'active',
    'phone_validation',
    true,
    0,
    '{"countries":["US"]}'::jsonb,
    '{"note":"Internal first-pass validation. External carrier, line-type, and reachability checks can replace this stage later."}'::jsonb
)
on conflict (source_key)
do update set implementation_status = excluded.implementation_status,
    run_stage = excluded.run_stage,
    enabled = excluded.enabled,
    metadata = public.leadgen_source_catalog.metadata || excluded.metadata,
    updated_at = now();

with capabilities(source_key, stage_key, priority, metadata) as (
    values
        ('overture', 'seed', 10, '{"reason":"candidate_seed"}'::jsonb),
        ('osm', 'seed', 20, '{"reason":"candidate_seed"}'::jsonb),
        ('alltheplaces', 'seed', 30, '{"reason":"candidate_seed"}'::jsonb),
        ('foursquare_os_places', 'seed', 40, '{"reason":"candidate_seed"}'::jsonb),
        ('overture', 'business_validation', 20, '{"reason":"place_record_support"}'::jsonb),
        ('osm', 'business_validation', 30, '{"reason":"place_record_support"}'::jsonb),
        ('alltheplaces', 'business_validation', 35, '{"reason":"place_record_support"}'::jsonb),
        ('foursquare_os_places', 'business_validation', 40, '{"reason":"place_record_support"}'::jsonb),
        ('website', 'business_validation', 50, '{"reason":"website_presence"}'::jsonb),
        ('website', 'owner_identity', 50, '{"reason":"about_or_team_page"}'::jsonb),
        ('website', 'owner_phone', 50, '{"reason":"owner_near_phone_evidence"}'::jsonb),
        ('web.json_ld', 'business_validation', 60, '{"reason":"structured_web_evidence"}'::jsonb),
        ('state_license.tx.tdlr', 'business_validation', 40, '{"reason":"active_license"}'::jsonb),
        ('state_license.tx.tdlr', 'owner_identity', 40, '{"reason":"license_principal"}'::jsonb),
        ('state_license.tx.tdlr', 'owner_phone', 40, '{"reason":"license_principal_phone"}'::jsonb),
        ('state_license.fl.electrical', 'business_validation', 45, '{"reason":"active_license"}'::jsonb),
        ('state_license.fl.electrical', 'owner_identity', 45, '{"reason":"license_principal"}'::jsonb),
        ('state_license.fl.electrical', 'owner_phone', 45, '{"reason":"license_principal_phone"}'::jsonb),
        ('state_license.nc.general_contractors', 'business_validation', 45, '{"reason":"active_license"}'::jsonb),
        ('state_license.nc.general_contractors', 'owner_identity', 45, '{"reason":"license_principal"}'::jsonb),
        ('state_license.nc.general_contractors', 'owner_phone', 45, '{"reason":"license_principal_phone"}'::jsonb),
        ('transport.fmcsa_safer', 'business_validation', 60, '{"reason":"carrier_registration"}'::jsonb),
        ('regulated.nppes', 'business_validation', 35, '{"reason":"active_npi_record"}'::jsonb),
        ('regulated.nppes', 'owner_identity', 35, '{"reason":"authorized_official"}'::jsonb),
        ('regulated.nppes', 'owner_phone', 35, '{"reason":"authorized_official_phone"}'::jsonb),
        ('sam_gov', 'business_validation', 80, '{"reason":"entity_registration"}'::jsonb),
        ('sam_gov', 'owner_identity', 80, '{"reason":"public_poc"}'::jsonb),
        ('sam_gov', 'owner_phone', 80, '{"reason":"public_poc_phone"}'::jsonb),
        ('permits.tx.dallas', 'business_validation', 70, '{"reason":"permit_activity"}'::jsonb),
        ('permits.tx.austin', 'business_validation', 70, '{"reason":"permit_activity"}'::jsonb),
        ('permits.fl.orlando', 'business_validation', 70, '{"reason":"permit_activity"}'::jsonb),
        ('permits.ca.los_angeles', 'business_validation', 70, '{"reason":"permit_activity"}'::jsonb),
        ('registry.fl.orlando_btr', 'business_validation', 65, '{"reason":"business_tax_record"}'::jsonb),
        ('registry.fl.orlando_btr', 'owner_identity', 65, '{"reason":"registry_principal"}'::jsonb),
        ('safety.osha', 'business_validation', 85, '{"reason":"establishment_activity"}'::jsonb),
        ('regulated.epa_echo', 'business_validation', 85, '{"reason":"regulated_facility"}'::jsonb),
        ('procurement.usaspending', 'business_validation', 85, '{"reason":"award_activity"}'::jsonb),
        ('web.rdap_whois', 'business_validation', 90, '{"reason":"domain_registration_support"}'::jsonb),
        ('web.certificate_transparency', 'business_validation', 95, '{"reason":"domain_certificate_support"}'::jsonb),
        ('phone.basic_format_validation', 'phone_validation', 10, '{"reason":"internal_callable_format_check"}'::jsonb)
)
insert into public.leadgen_source_stage_capabilities (source_key, stage_key, priority, metadata)
select capabilities.source_key, capabilities.stage_key, capabilities.priority, capabilities.metadata
from capabilities
join public.leadgen_source_catalog source on source.source_key = capabilities.source_key
on conflict (source_key, stage_key)
do update set enabled = true,
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

create index if not exists leadgen_poll_stage_runs_poll_order_idx
on public.leadgen_poll_stage_runs (poll_id, stage_order);

create index if not exists leadgen_poll_stage_runs_status_idx
on public.leadgen_poll_stage_runs (workspace_id, status, created_at desc);

create index if not exists leadgen_company_stage_status_poll_stage_idx
on public.leadgen_company_stage_status (poll_id, stage_key, status);

create index if not exists leadgen_company_stage_status_company_idx
on public.leadgen_company_stage_status (company_id, stage_key);

create index if not exists leadgen_source_stage_capabilities_stage_idx
on public.leadgen_source_stage_capabilities (stage_key, enabled, priority);

drop trigger if exists leadgen_poll_stage_runs_updated_at on public.leadgen_poll_stage_runs;
create trigger leadgen_poll_stage_runs_updated_at before update on public.leadgen_poll_stage_runs for each row execute function public.set_updated_at();

drop trigger if exists leadgen_company_stage_status_updated_at on public.leadgen_company_stage_status;
create trigger leadgen_company_stage_status_updated_at before update on public.leadgen_company_stage_status for each row execute function public.set_updated_at();

drop trigger if exists leadgen_source_stage_capabilities_updated_at on public.leadgen_source_stage_capabilities;
create trigger leadgen_source_stage_capabilities_updated_at before update on public.leadgen_source_stage_capabilities for each row execute function public.set_updated_at();
