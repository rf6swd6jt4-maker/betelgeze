alter table public.leadgen_companies
add column if not exists legal_name text,
add column if not exists dba_name text,
add column if not exists entity_number text,
add column if not exists filing_id text,
add column if not exists registered_address jsonb not null default '{}'::jsonb,
add column if not exists known_aliases text[] not null default '{}',
add column if not exists identity_resolution jsonb not null default '{}'::jsonb,
add column if not exists identity_source_key text,
add column if not exists identity_confidence integer check (identity_confidence is null or identity_confidence between 0 and 100),
add column if not exists identity_resolved_at timestamptz;

create index if not exists leadgen_companies_legal_name_idx
on public.leadgen_companies (workspace_id, legal_name)
where legal_name is not null;

create index if not exists leadgen_companies_dba_name_idx
on public.leadgen_companies (workspace_id, dba_name)
where dba_name is not null;

create index if not exists leadgen_companies_entity_number_idx
on public.leadgen_companies (workspace_id, entity_number)
where entity_number is not null;

create index if not exists leadgen_companies_known_aliases_idx
on public.leadgen_companies using gin (known_aliases);
