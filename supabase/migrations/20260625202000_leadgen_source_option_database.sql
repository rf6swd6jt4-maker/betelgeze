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

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
    new.updated_at = now();
    return new;
end;
$$;

insert into public.leadgen_source_options (source_key, option_kind, option_group, value, label, metadata)
values
    ('state_licensing', 'location', 'dfw_counties', 'collin', 'Collin', '{"state":"TX","source":"DFW intake"}'::jsonb),
    ('state_licensing', 'location', 'dfw_counties', 'dallas', 'Dallas', '{"state":"TX","source":"DFW intake"}'::jsonb),
    ('state_licensing', 'location', 'dfw_counties', 'denton', 'Denton', '{"state":"TX","source":"DFW intake"}'::jsonb),
    ('state_licensing', 'location', 'dfw_counties', 'ellis', 'Ellis', '{"state":"TX","source":"DFW intake"}'::jsonb),
    ('state_licensing', 'location', 'dfw_counties', 'hunt', 'Hunt', '{"state":"TX","source":"DFW intake"}'::jsonb),
    ('state_licensing', 'location', 'dfw_counties', 'johnson', 'Johnson', '{"state":"TX","source":"DFW intake"}'::jsonb),
    ('state_licensing', 'location', 'dfw_counties', 'kaufman', 'Kaufman', '{"state":"TX","source":"DFW intake"}'::jsonb),
    ('state_licensing', 'location', 'dfw_counties', 'parker', 'Parker', '{"state":"TX","source":"DFW intake"}'::jsonb),
    ('state_licensing', 'location', 'dfw_counties', 'rockwall', 'Rockwall', '{"state":"TX","source":"DFW intake"}'::jsonb),
    ('state_licensing', 'location', 'dfw_counties', 'tarrant', 'Tarrant', '{"state":"TX","source":"DFW intake"}'::jsonb),
    ('state_licensing', 'location', 'dfw_counties', 'wise', 'Wise', '{"state":"TX","source":"DFW intake"}'::jsonb),
    ('state_licensing', 'industry', 'tdlr_license_types', 'a_c_ce_provider', 'A/C CE Provider', '{"state":"TX","source":"TDLR intake"}'::jsonb),
    ('state_licensing', 'industry', 'tdlr_license_types', 'a_c_contractor', 'A/C Contractor', '{"state":"TX","source":"TDLR intake"}'::jsonb),
    ('state_licensing', 'industry', 'tdlr_license_types', 'a_c_technician', 'A/C Technician', '{"state":"TX","source":"TDLR intake"}'::jsonb),
    ('state_licensing', 'industry', 'tdlr_license_types', 'appliance_installation_contractor', 'Appliance Installation Contractor', '{"state":"TX","source":"TDLR intake"}'::jsonb),
    ('state_licensing', 'industry', 'tdlr_license_types', 'appliance_installer', 'Appliance Installer', '{"state":"TX","source":"TDLR intake"}'::jsonb),
    ('state_licensing', 'industry', 'tdlr_license_types', 'apprentice_electrician', 'Apprentice Electrician', '{"state":"TX","source":"TDLR intake"}'::jsonb),
    ('state_licensing', 'industry', 'tdlr_license_types', 'apprentice_sign_electrician', 'Apprentice Sign Electrician', '{"state":"TX","source":"TDLR intake"}'::jsonb),
    ('state_licensing', 'industry', 'tdlr_license_types', 'associate_auctioneer', 'Associate Auctioneer', '{"state":"TX","source":"TDLR intake"}'::jsonb),
    ('state_licensing', 'industry', 'tdlr_license_types', 'auctioneer', 'Auctioneer', '{"state":"TX","source":"TDLR intake"}'::jsonb),
    ('state_licensing', 'industry', 'tdlr_license_types', 'auctioneer_ce_provider', 'Auctioneer CE Provider', '{"state":"TX","source":"TDLR intake"}'::jsonb),
    ('state_licensing', 'industry', 'tdlr_license_types', 'barber_school', 'Barber School', '{"state":"TX","source":"TDLR intake"}'::jsonb),
    ('state_licensing', 'industry', 'tdlr_license_types', 'behavior_analyst', 'Behavior Analyst', '{"state":"TX","source":"TDLR intake"}'::jsonb),
    ('state_licensing', 'industry', 'tdlr_license_types', 'behavior_analyst_assistant', 'Behavior Analyst Assistant', '{"state":"TX","source":"TDLR intake"}'::jsonb),
    ('state_licensing', 'industry', 'tdlr_license_types', 'boiler_authorized_inspection_agency', 'Boiler Authorized Inspection Agency', '{"state":"TX","source":"TDLR intake"}'::jsonb),
    ('state_licensing', 'industry', 'tdlr_license_types', 'boiler_inspectors', 'Boiler Inspectors', '{"state":"TX","source":"TDLR intake"}'::jsonb),
    ('state_licensing', 'industry', 'tdlr_license_types', 'electrical_contractor', 'Electrical Contractor', '{"state":"TX","source":"TDLR intake"}'::jsonb)
on conflict (source_key, option_kind, value)
do update set
    label = excluded.label,
    option_group = excluded.option_group,
    metadata = excluded.metadata,
    enabled = true,
    updated_at = now();

drop trigger if exists leadgen_source_options_updated_at on public.leadgen_source_options;

create trigger leadgen_source_options_updated_at
before update on public.leadgen_source_options
for each row execute function public.set_updated_at();
