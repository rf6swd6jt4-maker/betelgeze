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

create index if not exists leadgen_source_options_lookup_idx
on public.leadgen_source_options (source_key, option_kind, label);

insert into public.leadgen_source_options (source_key, option_kind, option_group, value, label, metadata)
values
    ('icp', 'industry', 'home_services', 'bathroom_remodelling', 'Bathroom Remodelling', '{"taxonomy":"betelgeze_icp"}'::jsonb),
    ('icp', 'industry', 'home_services', 'concrete_contractors', 'Concrete Contractors', '{"taxonomy":"betelgeze_icp"}'::jsonb),
    ('icp', 'industry', 'home_services', 'deck_builders', 'Deck Builders', '{"taxonomy":"betelgeze_icp"}'::jsonb),
    ('icp', 'industry', 'home_services', 'electricians', 'Electricians', '{"taxonomy":"betelgeze_icp"}'::jsonb),
    ('icp', 'industry', 'home_services', 'fencing_contractors', 'Fencing Contractors', '{"taxonomy":"betelgeze_icp"}'::jsonb),
    ('icp', 'industry', 'home_services', 'flooring_contractors', 'Flooring Contractors', '{"taxonomy":"betelgeze_icp"}'::jsonb),
    ('icp', 'industry', 'home_services', 'garage_door_companies', 'Garage Door Companies', '{"taxonomy":"betelgeze_icp"}'::jsonb),
    ('icp', 'industry', 'home_services', 'general_contractors', 'General Contractors', '{"taxonomy":"betelgeze_icp"}'::jsonb),
    ('icp', 'industry', 'home_services', 'hardscaping_contractors', 'Hardscaping Contractors', '{"taxonomy":"betelgeze_icp"}'::jsonb),
    ('icp', 'industry', 'home_services', 'home_builders', 'Home Builders', '{"taxonomy":"betelgeze_icp"}'::jsonb),
    ('icp', 'industry', 'home_services', 'hvac_contractors', 'HVAC Contractors', '{"taxonomy":"betelgeze_icp"}'::jsonb),
    ('icp', 'industry', 'home_services', 'insulation_contractors', 'Insulation Contractors', '{"taxonomy":"betelgeze_icp"}'::jsonb),
    ('icp', 'industry', 'home_services', 'kitchen_remodelling', 'Kitchen Remodelling', '{"taxonomy":"betelgeze_icp"}'::jsonb),
    ('icp', 'industry', 'home_services', 'landscapers', 'Landscapers', '{"taxonomy":"betelgeze_icp"}'::jsonb),
    ('icp', 'industry', 'home_services', 'lawn_care_companies', 'Lawn Care Companies', '{"taxonomy":"betelgeze_icp"}'::jsonb),
    ('icp', 'industry', 'home_services', 'masonry_contractors', 'Masonry Contractors', '{"taxonomy":"betelgeze_icp"}'::jsonb),
    ('icp', 'industry', 'home_services', 'painters', 'Painters', '{"taxonomy":"betelgeze_icp"}'::jsonb),
    ('icp', 'industry', 'home_services', 'patio_contractors', 'Patio Contractors', '{"taxonomy":"betelgeze_icp"}'::jsonb),
    ('icp', 'industry', 'home_services', 'paving_contractors', 'Paving Contractors', '{"taxonomy":"betelgeze_icp"}'::jsonb),
    ('icp', 'industry', 'home_services', 'plumbers', 'Plumbers', '{"taxonomy":"betelgeze_icp"}'::jsonb),
    ('icp', 'industry', 'home_services', 'pool_builders', 'Pool Builders', '{"taxonomy":"betelgeze_icp"}'::jsonb),
    ('icp', 'industry', 'home_services', 'remodellers', 'Remodellers', '{"taxonomy":"betelgeze_icp"}'::jsonb),
    ('icp', 'industry', 'home_services', 'restoration_companies', 'Restoration Companies', '{"taxonomy":"betelgeze_icp"}'::jsonb),
    ('icp', 'industry', 'home_services', 'roofers', 'Roofers', '{"taxonomy":"betelgeze_icp"}'::jsonb),
    ('icp', 'industry', 'home_services', 'siding_contractors', 'Siding Contractors', '{"taxonomy":"betelgeze_icp"}'::jsonb),
    ('icp', 'industry', 'home_services', 'solar_installers', 'Solar Installers', '{"taxonomy":"betelgeze_icp"}'::jsonb),
    ('icp', 'industry', 'home_services', 'tree_services', 'Tree Services', '{"taxonomy":"betelgeze_icp"}'::jsonb),
    ('icp', 'industry', 'home_services', 'water_damage_restoration', 'Water Damage Restoration', '{"taxonomy":"betelgeze_icp"}'::jsonb),
    ('icp', 'industry', 'home_services', 'window_and_door_contractors', 'Window and Door Contractors', '{"taxonomy":"betelgeze_icp"}'::jsonb),
    ('icp', 'location', 'us_states', 'alabama', 'Alabama', '{"country":"US","taxonomy":"betelgeze_icp"}'::jsonb),
    ('icp', 'location', 'us_states', 'arizona', 'Arizona', '{"country":"US","taxonomy":"betelgeze_icp"}'::jsonb),
    ('icp', 'location', 'us_states', 'arkansas', 'Arkansas', '{"country":"US","taxonomy":"betelgeze_icp"}'::jsonb),
    ('icp', 'location', 'us_states', 'california', 'California', '{"country":"US","taxonomy":"betelgeze_icp"}'::jsonb),
    ('icp', 'location', 'us_states', 'colorado', 'Colorado', '{"country":"US","taxonomy":"betelgeze_icp"}'::jsonb),
    ('icp', 'location', 'us_states', 'florida', 'Florida', '{"country":"US","taxonomy":"betelgeze_icp"}'::jsonb),
    ('icp', 'location', 'us_states', 'georgia', 'Georgia', '{"country":"US","taxonomy":"betelgeze_icp"}'::jsonb),
    ('icp', 'location', 'us_states', 'illinois', 'Illinois', '{"country":"US","taxonomy":"betelgeze_icp"}'::jsonb),
    ('icp', 'location', 'us_states', 'indiana', 'Indiana', '{"country":"US","taxonomy":"betelgeze_icp"}'::jsonb),
    ('icp', 'location', 'us_states', 'louisiana', 'Louisiana', '{"country":"US","taxonomy":"betelgeze_icp"}'::jsonb),
    ('icp', 'location', 'us_states', 'michigan', 'Michigan', '{"country":"US","taxonomy":"betelgeze_icp"}'::jsonb),
    ('icp', 'location', 'us_states', 'missouri', 'Missouri', '{"country":"US","taxonomy":"betelgeze_icp"}'::jsonb),
    ('icp', 'location', 'us_states', 'nevada', 'Nevada', '{"country":"US","taxonomy":"betelgeze_icp"}'::jsonb),
    ('icp', 'location', 'us_states', 'new_york', 'New York', '{"country":"US","taxonomy":"betelgeze_icp"}'::jsonb),
    ('icp', 'location', 'us_states', 'north_carolina', 'North Carolina', '{"country":"US","taxonomy":"betelgeze_icp"}'::jsonb),
    ('icp', 'location', 'us_states', 'ohio', 'Ohio', '{"country":"US","taxonomy":"betelgeze_icp"}'::jsonb),
    ('icp', 'location', 'us_states', 'oklahoma', 'Oklahoma', '{"country":"US","taxonomy":"betelgeze_icp"}'::jsonb),
    ('icp', 'location', 'us_states', 'pennsylvania', 'Pennsylvania', '{"country":"US","taxonomy":"betelgeze_icp"}'::jsonb),
    ('icp', 'location', 'us_states', 'south_carolina', 'South Carolina', '{"country":"US","taxonomy":"betelgeze_icp"}'::jsonb),
    ('icp', 'location', 'us_states', 'tennessee', 'Tennessee', '{"country":"US","taxonomy":"betelgeze_icp"}'::jsonb),
    ('icp', 'location', 'us_states', 'texas', 'Texas', '{"country":"US","taxonomy":"betelgeze_icp"}'::jsonb),
    ('icp', 'location', 'us_states', 'virginia', 'Virginia', '{"country":"US","taxonomy":"betelgeze_icp"}'::jsonb),
    ('icp', 'location', 'us_states', 'washington', 'Washington', '{"country":"US","taxonomy":"betelgeze_icp"}'::jsonb)
on conflict (source_key, option_kind, value)
do update set
    label = excluded.label,
    option_group = excluded.option_group,
    metadata = excluded.metadata,
    enabled = true,
    updated_at = now();

update public.leadgen_source_options
set enabled = false, updated_at = now()
where source_key = 'state_licensing'
and option_kind = 'industry'
and value in (
    'associate_auctioneer',
    'auctioneer',
    'auctioneer_ce_provider',
    'barber_school',
    'behavior_analyst',
    'behavior_analyst_assistant'
);

insert into public.leadgen_source_options (source_key, option_kind, option_group, value, label, metadata)
values
    ('state_licensing', 'industry', 'tdlr_license_types', 'electrical_apprentice', 'Electrical Apprentice', '{"state":"TX","source":"TDLR intake"}'::jsonb),
    ('state_licensing', 'industry', 'tdlr_license_types', 'electrical_sign_contractor', 'Electrical Sign Contractor', '{"state":"TX","source":"TDLR intake"}'::jsonb),
    ('state_licensing', 'industry', 'tdlr_license_types', 'journeyman_electrician', 'Journeyman Electrician', '{"state":"TX","source":"TDLR intake"}'::jsonb),
    ('state_licensing', 'industry', 'tdlr_license_types', 'master_electrician', 'Master Electrician', '{"state":"TX","source":"TDLR intake"}'::jsonb),
    ('state_licensing', 'industry', 'tdlr_license_types', 'water_well_driller', 'Water Well Driller', '{"state":"TX","source":"TDLR intake"}'::jsonb),
    ('state_licensing', 'industry', 'tdlr_license_types', 'water_well_pump_installer', 'Water Well Pump Installer', '{"state":"TX","source":"TDLR intake"}'::jsonb)
on conflict (source_key, option_kind, value)
do update set
    label = excluded.label,
    option_group = excluded.option_group,
    metadata = excluded.metadata,
    enabled = true,
    updated_at = now();
