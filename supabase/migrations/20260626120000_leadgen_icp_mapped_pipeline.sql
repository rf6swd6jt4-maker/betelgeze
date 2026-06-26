create table if not exists public.leadgen_icp_industries (
    id uuid primary key default gen_random_uuid(),
    value text not null unique,
    label text not null,
    category text not null default 'home_services',
    enabled boolean not null default true,
    metadata jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create table if not exists public.leadgen_icp_locations (
    id uuid primary key default gen_random_uuid(),
    value text not null unique,
    label text not null,
    location_kind text not null default 'city' check (location_kind in ('country', 'state', 'metro', 'county', 'city', 'radius')),
    country text not null default 'US',
    region text,
    locality text,
    latitude double precision,
    longitude double precision,
    radius_meters integer check (radius_meters is null or radius_meters between 1000 and 40000),
    enabled boolean not null default true,
    metadata jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create table if not exists public.leadgen_source_industry_mappings (
    id uuid primary key default gen_random_uuid(),
    source_key text not null,
    icp_industry_value text not null references public.leadgen_icp_industries(value) on delete cascade,
    native_values text[] not null default '{}',
    native_label text,
    enabled boolean not null default true,
    metadata jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique (source_key, icp_industry_value)
);

create table if not exists public.leadgen_source_location_mappings (
    id uuid primary key default gen_random_uuid(),
    source_key text not null,
    icp_location_value text not null references public.leadgen_icp_locations(value) on delete cascade,
    native_values text[] not null default '{}',
    enabled boolean not null default true,
    metadata jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique (source_key, icp_location_value)
);

create table if not exists public.leadgen_source_credentials (
    workspace_id uuid not null references public.workspaces(id) on delete cascade,
    source_key text not null,
    enabled boolean not null default true,
    credential_status text not null default 'not_required' check (credential_status in ('not_required', 'missing', 'configured', 'invalid')),
    required_env_keys text[] not null default '{}',
    config jsonb not null default '{}'::jsonb,
    last_checked_at timestamptz,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    primary key (workspace_id, source_key)
);

create table if not exists public.leadgen_candidates (
    id uuid primary key default gen_random_uuid(),
    workspace_id uuid not null references public.workspaces(id) on delete cascade,
    first_seen_poll_id uuid references public.leadgen_polls(id) on delete set null,
    canonical_name text not null,
    display_name text not null,
    phone text,
    website_domain text,
    website_url text,
    address jsonb not null default '{}'::jsonb,
    latitude double precision,
    longitude double precision,
    source_key text not null,
    source_record_id text not null,
    industry_value text,
    location_value text,
    candidate_status text not null default 'seeded' check (candidate_status in ('seeded', 'normalised', 'enriched', 'qualified', 'rejected')),
    metadata jsonb not null default '{}'::jsonb,
    last_seen_at timestamptz not null default now(),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique (workspace_id, source_key, source_record_id)
);

create table if not exists public.leadgen_evidence (
    id uuid primary key default gen_random_uuid(),
    workspace_id uuid not null references public.workspaces(id) on delete cascade,
    poll_id uuid references public.leadgen_polls(id) on delete set null,
    candidate_id uuid references public.leadgen_candidates(id) on delete cascade,
    company_id uuid references public.leadgen_companies(id) on delete cascade,
    source_key text not null,
    evidence_kind text not null,
    confidence integer check (confidence is null or confidence between 0 and 100),
    value jsonb not null default '{}'::jsonb,
    raw_payload jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now()
);

create table if not exists public.leadgen_people (
    id uuid primary key default gen_random_uuid(),
    workspace_id uuid not null references public.workspaces(id) on delete cascade,
    full_name text not null,
    phone text,
    email text,
    role text,
    source_key text,
    confidence integer check (confidence is null or confidence between 0 and 100),
    metadata jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create table if not exists public.leadgen_company_people (
    company_id uuid not null references public.leadgen_companies(id) on delete cascade,
    person_id uuid not null references public.leadgen_people(id) on delete cascade,
    relationship text not null default 'owner',
    confidence integer check (confidence is null or confidence between 0 and 100),
    evidence_id uuid references public.leadgen_evidence(id) on delete set null,
    created_at timestamptz not null default now(),
    primary key (company_id, person_id, relationship)
);

alter table public.leadgen_polls
add column if not exists icp_snapshot jsonb not null default '{}'::jsonb;

alter table public.leadgen_poll_tasks
add column if not exists stage text not null default 'source_query',
add column if not exists candidate_id uuid references public.leadgen_candidates(id) on delete set null;

alter table public.leadgen_companies
add column if not exists owner_name text,
add column if not exists owner_phone text,
add column if not exists owner_source_key text,
add column if not exists owner_confidence integer check (owner_confidence is null or owner_confidence between 0 and 100),
add column if not exists owner_evidence jsonb not null default '{}'::jsonb;

create index if not exists leadgen_icp_industries_label_idx on public.leadgen_icp_industries (label);
create index if not exists leadgen_icp_locations_label_idx on public.leadgen_icp_locations (label);
create index if not exists leadgen_source_industry_mappings_lookup_idx on public.leadgen_source_industry_mappings (source_key, icp_industry_value);
create index if not exists leadgen_source_location_mappings_lookup_idx on public.leadgen_source_location_mappings (source_key, icp_location_value);
create index if not exists leadgen_candidates_workspace_created_idx on public.leadgen_candidates (workspace_id, created_at desc);
create index if not exists leadgen_evidence_company_idx on public.leadgen_evidence (company_id, evidence_kind, created_at desc);
create index if not exists leadgen_companies_owner_phone_idx on public.leadgen_companies (workspace_id, owner_phone) where owner_phone is not null;

drop trigger if exists leadgen_icp_industries_updated_at on public.leadgen_icp_industries;
create trigger leadgen_icp_industries_updated_at before update on public.leadgen_icp_industries for each row execute function public.set_updated_at();

drop trigger if exists leadgen_icp_locations_updated_at on public.leadgen_icp_locations;
create trigger leadgen_icp_locations_updated_at before update on public.leadgen_icp_locations for each row execute function public.set_updated_at();

drop trigger if exists leadgen_source_industry_mappings_updated_at on public.leadgen_source_industry_mappings;
create trigger leadgen_source_industry_mappings_updated_at before update on public.leadgen_source_industry_mappings for each row execute function public.set_updated_at();

drop trigger if exists leadgen_source_location_mappings_updated_at on public.leadgen_source_location_mappings;
create trigger leadgen_source_location_mappings_updated_at before update on public.leadgen_source_location_mappings for each row execute function public.set_updated_at();

drop trigger if exists leadgen_source_credentials_updated_at on public.leadgen_source_credentials;
create trigger leadgen_source_credentials_updated_at before update on public.leadgen_source_credentials for each row execute function public.set_updated_at();

drop trigger if exists leadgen_candidates_updated_at on public.leadgen_candidates;
create trigger leadgen_candidates_updated_at before update on public.leadgen_candidates for each row execute function public.set_updated_at();

drop trigger if exists leadgen_people_updated_at on public.leadgen_people;
create trigger leadgen_people_updated_at before update on public.leadgen_people for each row execute function public.set_updated_at();

insert into public.leadgen_icp_industries (value, label, category, metadata)
select value, label, option_group, metadata || '{"source":"legacy_icp_options"}'::jsonb
from public.leadgen_source_options
where source_key = 'icp'
and option_kind = 'industry'
on conflict (value)
do update set label = excluded.label, category = excluded.category, enabled = true, metadata = public.leadgen_icp_industries.metadata || excluded.metadata, updated_at = now();

insert into public.leadgen_icp_locations (value, label, location_kind, country, region, locality, latitude, longitude, radius_meters, metadata)
select value, label, 'city', country, region, locality, latitude, longitude, radius_meters, metadata || '{"source":"legacy_geo_targets"}'::jsonb
from public.leadgen_geo_targets
where enabled = true
on conflict (value)
do update set label = excluded.label, location_kind = excluded.location_kind, country = excluded.country, region = excluded.region, locality = excluded.locality, latitude = excluded.latitude, longitude = excluded.longitude, radius_meters = excluded.radius_meters, enabled = true, metadata = public.leadgen_icp_locations.metadata || excluded.metadata, updated_at = now();

insert into public.leadgen_icp_locations (value, label, location_kind, country, region, locality, latitude, longitude, radius_meters, metadata)
values
    ('united_states', 'United States', 'country', 'US', null, null, 39.8283, -98.5795, 40000, '{"seed":"icp_pipeline_v1"}'::jsonb),
    ('texas', 'Texas', 'state', 'US', 'TX', null, 31.9686, -99.9018, 40000, '{"seed":"icp_pipeline_v1"}'::jsonb),
    ('florida', 'Florida', 'state', 'US', 'FL', null, 27.6648, -81.5158, 40000, '{"seed":"icp_pipeline_v1"}'::jsonb),
    ('georgia', 'Georgia', 'state', 'US', 'GA', null, 32.1656, -82.9001, 40000, '{"seed":"icp_pipeline_v1"}'::jsonb),
    ('north_carolina', 'North Carolina', 'state', 'US', 'NC', null, 35.7596, -79.0193, 40000, '{"seed":"icp_pipeline_v1"}'::jsonb),
    ('tennessee', 'Tennessee', 'state', 'US', 'TN', null, 35.5175, -86.5804, 40000, '{"seed":"icp_pipeline_v1"}'::jsonb),
    ('arizona', 'Arizona', 'state', 'US', 'AZ', null, 34.0489, -111.0937, 40000, '{"seed":"icp_pipeline_v1"}'::jsonb),
    ('colorado', 'Colorado', 'state', 'US', 'CO', null, 39.5501, -105.7821, 40000, '{"seed":"icp_pipeline_v1"}'::jsonb),
    ('dfw_tx', 'Dallas-Fort Worth, TX', 'metro', 'US', 'TX', 'Dallas-Fort Worth', 32.8998, -97.0403, 40000, '{"seed":"icp_pipeline_v1"}'::jsonb),
    ('greater_houston_tx', 'Greater Houston, TX', 'metro', 'US', 'TX', 'Houston', 29.7604, -95.3698, 40000, '{"seed":"icp_pipeline_v1"}'::jsonb)
on conflict (value)
do update set label = excluded.label, location_kind = excluded.location_kind, country = excluded.country, region = excluded.region, locality = excluded.locality, latitude = excluded.latitude, longitude = excluded.longitude, radius_meters = excluded.radius_meters, enabled = true, metadata = public.leadgen_icp_locations.metadata || excluded.metadata, updated_at = now();

insert into public.leadgen_icp_industries (value, label, category, metadata)
values
    ('water_well_services', 'Water Well Services', 'home_services', '{"seed":"icp_pipeline_v1"}'::jsonb)
on conflict (value)
do update set label = excluded.label, category = excluded.category, enabled = true, metadata = public.leadgen_icp_industries.metadata || excluded.metadata, updated_at = now();

insert into public.leadgen_icp_locations (value, label, location_kind, country, region, locality, latitude, longitude, radius_meters, metadata)
values
    ('fort_worth_tx', 'Fort Worth, TX', 'city', 'US', 'TX', 'Fort Worth', 32.7555, -97.3308, 24000, '{"seed":"icp_pipeline_v1"}'::jsonb)
on conflict (value)
do update set label = excluded.label, location_kind = excluded.location_kind, country = excluded.country, region = excluded.region, locality = excluded.locality, latitude = excluded.latitude, longitude = excluded.longitude, radius_meters = excluded.radius_meters, enabled = true, metadata = public.leadgen_icp_locations.metadata || excluded.metadata, updated_at = now();

insert into public.leadgen_source_industry_mappings (source_key, icp_industry_value, native_values, native_label, metadata)
select source_key, industry_value, source_category_aliases, source_search_term, metadata || jsonb_build_object('osm_tags', source_category_aliases)
from public.leadgen_source_category_mappings
where source_key = 'osm'
and enabled = true
on conflict (source_key, icp_industry_value)
do update set native_values = excluded.native_values, native_label = excluded.native_label, enabled = true, metadata = public.leadgen_source_industry_mappings.metadata || excluded.metadata, updated_at = now();

insert into public.leadgen_source_location_mappings (source_key, icp_location_value, native_values, metadata)
select 'osm', value, array[value], '{"source":"geo_target_self"}'::jsonb
from public.leadgen_geo_targets
where enabled = true
on conflict (source_key, icp_location_value)
do update set native_values = excluded.native_values, enabled = true, metadata = public.leadgen_source_location_mappings.metadata || excluded.metadata, updated_at = now();

insert into public.leadgen_source_location_mappings (source_key, icp_location_value, native_values, metadata)
values
    ('osm', 'texas', array['dallas_tx','austin_tx','houston_tx','san_antonio_tx'], '{"source":"state_to_city_seed"}'::jsonb),
    ('osm', 'florida', array['jacksonville_fl','miami_fl','orlando_fl','tampa_fl'], '{"source":"state_to_city_seed"}'::jsonb),
    ('osm', 'georgia', array['atlanta_ga'], '{"source":"state_to_city_seed"}'::jsonb),
    ('osm', 'north_carolina', array['charlotte_nc','raleigh_nc'], '{"source":"state_to_city_seed"}'::jsonb),
    ('osm', 'tennessee', array['nashville_tn'], '{"source":"state_to_city_seed"}'::jsonb),
    ('osm', 'arizona', array['phoenix_az'], '{"source":"state_to_city_seed"}'::jsonb),
    ('osm', 'colorado', array['denver_co'], '{"source":"state_to_city_seed"}'::jsonb),
    ('osm', 'dfw_tx', array['dallas_tx'], '{"source":"metro_to_city_seed"}'::jsonb),
    ('osm', 'greater_houston_tx', array['houston_tx'], '{"source":"metro_to_city_seed"}'::jsonb)
on conflict (source_key, icp_location_value)
do update set native_values = excluded.native_values, enabled = true, metadata = public.leadgen_source_location_mappings.metadata || excluded.metadata, updated_at = now();

insert into public.leadgen_source_industry_mappings (source_key, icp_industry_value, native_values, native_label, metadata)
values
    ('state_licensing', 'hvac_contractors', array['a_c_contractor','a_c_technician'], 'Texas TDLR A/C licensing', '{"board":"tdlr","state":"TX"}'::jsonb),
    ('state_licensing', 'electricians', array['electrical_contractor','master_electrician','journeyman_electrician','electrical_sign_contractor'], 'Texas TDLR electrical licensing', '{"board":"tdlr","state":"TX"}'::jsonb),
    ('state_licensing', 'water_well_services', array['water_well_driller','water_well_pump_installer'], 'Texas TDLR water well licensing', '{"board":"tdlr","state":"TX"}'::jsonb)
on conflict (source_key, icp_industry_value)
do update set native_values = excluded.native_values, native_label = excluded.native_label, enabled = true, metadata = public.leadgen_source_industry_mappings.metadata || excluded.metadata, updated_at = now();

insert into public.leadgen_source_location_mappings (source_key, icp_location_value, native_values, metadata)
values
    ('state_licensing', 'texas', array['dallas','tarrant','collin','denton','ellis','hunt','johnson','kaufman','parker','rockwall','wise'], '{"board":"tdlr","state":"TX","scope":"dfw_seed"}'::jsonb),
    ('state_licensing', 'dfw_tx', array['dallas','tarrant','collin','denton','ellis','hunt','johnson','kaufman','parker','rockwall','wise'], '{"board":"tdlr","state":"TX","scope":"dfw_seed"}'::jsonb),
    ('state_licensing', 'dallas_tx', array['dallas'], '{"board":"tdlr","state":"TX"}'::jsonb),
    ('state_licensing', 'fort_worth_tx', array['tarrant'], '{"board":"tdlr","state":"TX"}'::jsonb),
    ('state_licensing', 'greater_houston_tx', array[]::text[], '{"board":"tdlr","state":"TX","status":"pending_county_seed"}'::jsonb),
    ('state_licensing', 'austin_tx', array[]::text[], '{"board":"tdlr","state":"TX","status":"pending_county_seed"}'::jsonb),
    ('state_licensing', 'houston_tx', array[]::text[], '{"board":"tdlr","state":"TX","status":"pending_county_seed"}'::jsonb),
    ('state_licensing', 'san_antonio_tx', array[]::text[], '{"board":"tdlr","state":"TX","status":"pending_county_seed"}'::jsonb)
on conflict (source_key, icp_location_value)
do update set native_values = excluded.native_values, enabled = true, metadata = public.leadgen_source_location_mappings.metadata || excluded.metadata, updated_at = now();

insert into public.leadgen_source_industry_mappings (source_key, icp_industry_value, native_values, native_label, metadata)
select 'overture', value, array[value], label, '{"adapter":"geoparquet","status":"mapping_seeded"}'::jsonb
from public.leadgen_icp_industries
where enabled = true
on conflict (source_key, icp_industry_value)
do update set native_values = excluded.native_values, native_label = excluded.native_label, enabled = true, metadata = public.leadgen_source_industry_mappings.metadata || excluded.metadata, updated_at = now();

insert into public.leadgen_source_location_mappings (source_key, icp_location_value, native_values, metadata)
select 'overture', value, array[value], jsonb_build_object('adapter', 'geoparquet', 'status', 'mapping_seeded', 'location_kind', location_kind, 'region', region, 'locality', locality, 'latitude', latitude, 'longitude', longitude, 'radius_meters', radius_meters)
from public.leadgen_icp_locations
where enabled = true
on conflict (source_key, icp_location_value)
do update set native_values = excluded.native_values, enabled = true, metadata = public.leadgen_source_location_mappings.metadata || excluded.metadata, updated_at = now();
