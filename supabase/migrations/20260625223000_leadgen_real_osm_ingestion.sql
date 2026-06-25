create table if not exists public.leadgen_source_options (
    id uuid primary key default gen_random_uuid(),
    source_key text not null,
    option_kind text not null check (option_kind in ('industry', 'location')),
    option_group text not null,
    value text not null,
    label text not null,
    enabled boolean not null default true,
    metadata jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique (source_key, option_kind, value)
);

create table if not exists public.leadgen_geo_targets (
    id uuid primary key default gen_random_uuid(),
    value text not null unique,
    label text not null,
    country text not null default 'US',
    region text,
    locality text,
    latitude double precision,
    longitude double precision,
    radius_meters integer not null default 24000 check (radius_meters between 1000 and 40000),
    enabled boolean not null default true,
    metadata jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create table if not exists public.leadgen_source_category_mappings (
    id uuid primary key default gen_random_uuid(),
    source_key text not null,
    industry_value text not null,
    source_search_term text not null,
    source_category_aliases text[] not null default '{}',
    enabled boolean not null default true,
    metadata jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique (source_key, industry_value)
);

create table if not exists public.leadgen_poll_tasks (
    id uuid primary key default gen_random_uuid(),
    poll_id uuid not null references public.leadgen_polls(id) on delete cascade,
    workspace_id uuid not null references public.workspaces(id) on delete cascade,
    source_key text not null,
    industry_value text,
    location_value text,
    status text not null default 'queued' check (status in ('queued', 'running', 'completed', 'failed', 'cancelled')),
    source_query jsonb not null default '{}'::jsonb,
    raw_count integer not null default 0,
    company_count integer not null default 0,
    error text,
    started_at timestamptz,
    completed_at timestamptz,
    created_at timestamptz not null default now()
);

create table if not exists public.leadgen_source_records (
    id uuid primary key default gen_random_uuid(),
    workspace_id uuid not null references public.workspaces(id) on delete cascade,
    poll_id uuid references public.leadgen_polls(id) on delete set null,
    task_id uuid references public.leadgen_poll_tasks(id) on delete set null,
    source_key text not null,
    source_record_id text not null,
    company_name text not null,
    phone text,
    website_url text,
    profile_url text,
    address jsonb not null default '{}'::jsonb,
    latitude double precision,
    longitude double precision,
    categories jsonb not null default '[]'::jsonb,
    rating numeric,
    review_count integer,
    raw_payload jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique (workspace_id, source_key, source_record_id)
);

create table if not exists public.leadgen_companies (
    id uuid primary key default gen_random_uuid(),
    workspace_id uuid not null references public.workspaces(id) on delete cascade,
    canonical_name text not null,
    display_name text not null,
    phone text,
    website_domain text,
    website_url text,
    profile_url text,
    source_key text not null,
    source_record_id text not null,
    address jsonb not null default '{}'::jsonb,
    latitude double precision,
    longitude double precision,
    categories jsonb not null default '[]'::jsonb,
    rating numeric,
    review_count integer,
    industry_value text,
    location_value text,
    first_seen_poll_id uuid references public.leadgen_polls(id) on delete set null,
    last_seen_at timestamptz not null default now(),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique (workspace_id, source_key, source_record_id)
);

create index if not exists leadgen_poll_tasks_poll_status_idx
on public.leadgen_poll_tasks (poll_id, status, created_at);

create index if not exists leadgen_source_records_workspace_created_idx
on public.leadgen_source_records (workspace_id, created_at desc);

create index if not exists leadgen_companies_workspace_created_idx
on public.leadgen_companies (workspace_id, created_at desc);

create index if not exists leadgen_companies_phone_idx
on public.leadgen_companies (workspace_id, phone)
where phone is not null;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
    new.updated_at = now();
    return new;
end;
$$;

drop trigger if exists leadgen_geo_targets_updated_at on public.leadgen_geo_targets;
create trigger leadgen_geo_targets_updated_at
before update on public.leadgen_geo_targets
for each row execute function public.set_updated_at();

drop trigger if exists leadgen_source_category_mappings_updated_at on public.leadgen_source_category_mappings;
create trigger leadgen_source_category_mappings_updated_at
before update on public.leadgen_source_category_mappings
for each row execute function public.set_updated_at();

drop trigger if exists leadgen_source_records_updated_at on public.leadgen_source_records;
create trigger leadgen_source_records_updated_at
before update on public.leadgen_source_records
for each row execute function public.set_updated_at();

drop trigger if exists leadgen_companies_updated_at on public.leadgen_companies;
create trigger leadgen_companies_updated_at
before update on public.leadgen_companies
for each row execute function public.set_updated_at();

insert into public.leadgen_geo_targets (value, label, country, region, locality, latitude, longitude, radius_meters, metadata)
values
    ('atlanta_ga', 'Atlanta, GA', 'US', 'GA', 'Atlanta', 33.7490, -84.3880, 24000, '{"seed":"osm_v1"}'::jsonb),
    ('austin_tx', 'Austin, TX', 'US', 'TX', 'Austin', 30.2672, -97.7431, 24000, '{"seed":"osm_v1"}'::jsonb),
    ('charlotte_nc', 'Charlotte, NC', 'US', 'NC', 'Charlotte', 35.2271, -80.8431, 24000, '{"seed":"osm_v1"}'::jsonb),
    ('dallas_tx', 'Dallas, TX', 'US', 'TX', 'Dallas', 32.7767, -96.7970, 24000, '{"seed":"osm_v1"}'::jsonb),
    ('denver_co', 'Denver, CO', 'US', 'CO', 'Denver', 39.7392, -104.9903, 24000, '{"seed":"osm_v1"}'::jsonb),
    ('houston_tx', 'Houston, TX', 'US', 'TX', 'Houston', 29.7604, -95.3698, 24000, '{"seed":"osm_v1"}'::jsonb),
    ('jacksonville_fl', 'Jacksonville, FL', 'US', 'FL', 'Jacksonville', 30.3322, -81.6557, 24000, '{"seed":"osm_v1"}'::jsonb),
    ('miami_fl', 'Miami, FL', 'US', 'FL', 'Miami', 25.7617, -80.1918, 24000, '{"seed":"osm_v1"}'::jsonb),
    ('nashville_tn', 'Nashville, TN', 'US', 'TN', 'Nashville', 36.1627, -86.7816, 24000, '{"seed":"osm_v1"}'::jsonb),
    ('orlando_fl', 'Orlando, FL', 'US', 'FL', 'Orlando', 28.5383, -81.3792, 24000, '{"seed":"osm_v1"}'::jsonb),
    ('phoenix_az', 'Phoenix, AZ', 'US', 'AZ', 'Phoenix', 33.4484, -112.0740, 24000, '{"seed":"osm_v1"}'::jsonb),
    ('raleigh_nc', 'Raleigh, NC', 'US', 'NC', 'Raleigh', 35.7796, -78.6382, 24000, '{"seed":"osm_v1"}'::jsonb),
    ('san_antonio_tx', 'San Antonio, TX', 'US', 'TX', 'San Antonio', 29.4241, -98.4936, 24000, '{"seed":"osm_v1"}'::jsonb),
    ('tampa_fl', 'Tampa, FL', 'US', 'FL', 'Tampa', 27.9506, -82.4572, 24000, '{"seed":"osm_v1"}'::jsonb)
on conflict (value)
do update set
    label = excluded.label,
    country = excluded.country,
    region = excluded.region,
    locality = excluded.locality,
    latitude = excluded.latitude,
    longitude = excluded.longitude,
    radius_meters = excluded.radius_meters,
    enabled = true,
    metadata = excluded.metadata,
    updated_at = now();

insert into public.leadgen_source_options (source_key, option_kind, option_group, value, label, metadata)
values
    ('icp', 'industry', 'home_services', 'bathroom_remodelling', 'Bathroom Remodelling', '{"taxonomy":"betelgeze_icp","seed":"osm_v1"}'::jsonb),
    ('icp', 'industry', 'home_services', 'concrete_contractors', 'Concrete Contractors', '{"taxonomy":"betelgeze_icp","seed":"osm_v1"}'::jsonb),
    ('icp', 'industry', 'home_services', 'deck_builders', 'Deck Builders', '{"taxonomy":"betelgeze_icp","seed":"osm_v1"}'::jsonb),
    ('icp', 'industry', 'home_services', 'electricians', 'Electricians', '{"taxonomy":"betelgeze_icp","seed":"osm_v1"}'::jsonb),
    ('icp', 'industry', 'home_services', 'fencing_contractors', 'Fencing Contractors', '{"taxonomy":"betelgeze_icp","seed":"osm_v1"}'::jsonb),
    ('icp', 'industry', 'home_services', 'flooring_contractors', 'Flooring Contractors', '{"taxonomy":"betelgeze_icp","seed":"osm_v1"}'::jsonb),
    ('icp', 'industry', 'home_services', 'garage_door_companies', 'Garage Door Companies', '{"taxonomy":"betelgeze_icp","seed":"osm_v1"}'::jsonb),
    ('icp', 'industry', 'home_services', 'general_contractors', 'General Contractors', '{"taxonomy":"betelgeze_icp","seed":"osm_v1"}'::jsonb),
    ('icp', 'industry', 'home_services', 'home_builders', 'Home Builders', '{"taxonomy":"betelgeze_icp","seed":"osm_v1"}'::jsonb),
    ('icp', 'industry', 'home_services', 'hvac_contractors', 'HVAC Contractors', '{"taxonomy":"betelgeze_icp","seed":"osm_v1"}'::jsonb),
    ('icp', 'industry', 'home_services', 'kitchen_remodelling', 'Kitchen Remodelling', '{"taxonomy":"betelgeze_icp","seed":"osm_v1"}'::jsonb),
    ('icp', 'industry', 'home_services', 'landscapers', 'Landscapers', '{"taxonomy":"betelgeze_icp","seed":"osm_v1"}'::jsonb),
    ('icp', 'industry', 'home_services', 'lawn_care_companies', 'Lawn Care Companies', '{"taxonomy":"betelgeze_icp","seed":"osm_v1"}'::jsonb),
    ('icp', 'industry', 'home_services', 'painters', 'Painters', '{"taxonomy":"betelgeze_icp","seed":"osm_v1"}'::jsonb),
    ('icp', 'industry', 'home_services', 'plumbers', 'Plumbers', '{"taxonomy":"betelgeze_icp","seed":"osm_v1"}'::jsonb),
    ('icp', 'industry', 'home_services', 'pool_builders', 'Pool Builders', '{"taxonomy":"betelgeze_icp","seed":"osm_v1"}'::jsonb),
    ('icp', 'industry', 'home_services', 'remodellers', 'Remodellers', '{"taxonomy":"betelgeze_icp","seed":"osm_v1"}'::jsonb),
    ('icp', 'industry', 'home_services', 'restoration_companies', 'Restoration Companies', '{"taxonomy":"betelgeze_icp","seed":"osm_v1"}'::jsonb),
    ('icp', 'industry', 'home_services', 'roofers', 'Roofers', '{"taxonomy":"betelgeze_icp","seed":"osm_v1"}'::jsonb),
    ('icp', 'industry', 'home_services', 'siding_contractors', 'Siding Contractors', '{"taxonomy":"betelgeze_icp","seed":"osm_v1"}'::jsonb),
    ('icp', 'industry', 'home_services', 'solar_installers', 'Solar Installers', '{"taxonomy":"betelgeze_icp","seed":"osm_v1"}'::jsonb),
    ('icp', 'industry', 'home_services', 'tree_services', 'Tree Services', '{"taxonomy":"betelgeze_icp","seed":"osm_v1"}'::jsonb),
    ('icp', 'industry', 'home_services', 'window_and_door_contractors', 'Window and Door Contractors', '{"taxonomy":"betelgeze_icp","seed":"osm_v1"}'::jsonb)
on conflict (source_key, option_kind, value)
do update set
    label = excluded.label,
    option_group = excluded.option_group,
    metadata = excluded.metadata,
    enabled = true,
    updated_at = now();

insert into public.leadgen_source_category_mappings (source_key, industry_value, source_search_term, source_category_aliases, metadata)
values
    ('osm', 'bathroom_remodelling', 'bathroom remodeling', '{"shop=bathroom_furnishing","craft=builder","craft=tiler"}', '{"seed":"osm_v1"}'::jsonb),
    ('osm', 'concrete_contractors', 'concrete contractor', '{"craft=concrete","craft=builder"}', '{"seed":"osm_v1"}'::jsonb),
    ('osm', 'deck_builders', 'deck builder', '{"craft=carpenter","craft=builder"}', '{"seed":"osm_v1"}'::jsonb),
    ('osm', 'electricians', 'electrician', '{"craft=electrician"}', '{"seed":"osm_v1"}'::jsonb),
    ('osm', 'fencing_contractors', 'fence contractor', '{"craft=fence_maker","craft=builder"}', '{"seed":"osm_v1"}'::jsonb),
    ('osm', 'flooring_contractors', 'flooring contractor', '{"craft=floorer","shop=flooring"}', '{"seed":"osm_v1"}'::jsonb),
    ('osm', 'garage_door_companies', 'garage door services', '{"craft=garage_door","shop=doors"}', '{"seed":"osm_v1"}'::jsonb),
    ('osm', 'general_contractors', 'general contractor', '{"craft=builder","office=construction_company"}', '{"seed":"osm_v1"}'::jsonb),
    ('osm', 'home_builders', 'home builder', '{"craft=builder","office=construction_company"}', '{"seed":"osm_v1"}'::jsonb),
    ('osm', 'hvac_contractors', 'hvac contractor', '{"craft=hvac","craft=air_conditioning","shop=heating"}', '{"seed":"osm_v1"}'::jsonb),
    ('osm', 'kitchen_remodelling', 'kitchen remodeling', '{"shop=kitchen","craft=builder"}', '{"seed":"osm_v1"}'::jsonb),
    ('osm', 'landscapers', 'landscaper', '{"craft=landscaper","craft=gardener"}', '{"seed":"osm_v1"}'::jsonb),
    ('osm', 'lawn_care_companies', 'lawn care', '{"craft=gardener","craft=landscaper"}', '{"seed":"osm_v1"}'::jsonb),
    ('osm', 'painters', 'painter', '{"craft=painter"}', '{"seed":"osm_v1"}'::jsonb),
    ('osm', 'plumbers', 'plumber', '{"craft=plumber"}', '{"seed":"osm_v1"}'::jsonb),
    ('osm', 'pool_builders', 'pool builder', '{"shop=swimming_pool","craft=builder"}', '{"seed":"osm_v1"}'::jsonb),
    ('osm', 'remodellers', 'remodeling contractor', '{"craft=builder","office=construction_company"}', '{"seed":"osm_v1"}'::jsonb),
    ('osm', 'restoration_companies', 'restoration company', '{"craft=builder","office=construction_company"}', '{"seed":"osm_v1"}'::jsonb),
    ('osm', 'roofers', 'roofer', '{"craft=roofer"}', '{"seed":"osm_v1"}'::jsonb),
    ('osm', 'siding_contractors', 'siding contractor', '{"craft=builder","craft=carpenter"}', '{"seed":"osm_v1"}'::jsonb),
    ('osm', 'solar_installers', 'solar installer', '{"craft=solar_panel","shop=solar"}', '{"seed":"osm_v1"}'::jsonb),
    ('osm', 'tree_services', 'tree service', '{"craft=tree_surgeon","craft=arborist"}', '{"seed":"osm_v1"}'::jsonb),
    ('osm', 'window_and_door_contractors', 'window and door contractor', '{"shop=windows","shop=doors","craft=glazier"}', '{"seed":"osm_v1"}'::jsonb)
on conflict (source_key, industry_value)
do update set
    source_search_term = excluded.source_search_term,
    source_category_aliases = excluded.source_category_aliases,
    enabled = true,
    metadata = excluded.metadata,
    updated_at = now();
