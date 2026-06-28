create table if not exists public.leadgen_source_catalog (
    source_key text primary key,
    label text not null,
    family text not null,
    source_points integer not null default 1 check (source_points between 1 and 3),
    owner_identity_points integer not null default 0 check (owner_identity_points between 0 and 3),
    owner_phone_points integer not null default 0 check (owner_phone_points between 0 and 3),
    business_support_points integer not null default 0 check (business_support_points between 0 and 3),
    access_method text not null default 'public_html',
    free_status text not null default 'free',
    implementation_status text not null default 'planned',
    run_stage text not null default 'candidate_investigation',
    enabled boolean not null default false,
    rate_limit_ms integer not null default 1000 check (rate_limit_ms >= 0),
    coverage jsonb not null default '{}'::jsonb,
    metadata jsonb not null default '{}'::jsonb,
    last_checked_at timestamptz,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create table if not exists public.leadgen_investigation_tasks (
    id uuid primary key default gen_random_uuid(),
    workspace_id uuid not null references public.workspaces(id) on delete cascade,
    poll_id uuid not null references public.leadgen_polls(id) on delete cascade,
    company_id uuid not null references public.leadgen_companies(id) on delete cascade,
    source_key text not null references public.leadgen_source_catalog(source_key) on delete restrict,
    status text not null default 'queued' check (status in ('queued', 'running', 'completed', 'skipped', 'failed')),
    matched boolean not null default false,
    skip_reason text,
    error text,
    owner_identity_points integer not null default 0,
    owner_phone_points integer not null default 0,
    business_support_points integer not null default 0,
    raw_payload jsonb not null default '{}'::jsonb,
    started_at timestamptz,
    completed_at timestamptz,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique (poll_id, company_id, source_key)
);

create table if not exists public.leadgen_evidence_claims (
    id uuid primary key default gen_random_uuid(),
    workspace_id uuid not null references public.workspaces(id) on delete cascade,
    poll_id uuid references public.leadgen_polls(id) on delete set null,
    company_id uuid references public.leadgen_companies(id) on delete cascade,
    source_key text not null,
    claim_kind text not null,
    claim_value jsonb not null default '{}'::jsonb,
    points_awarded integer not null default 0,
    confidence integer check (confidence is null or confidence between 0 and 100),
    provenance_url text,
    raw_payload jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now()
);

create table if not exists public.leadgen_candidate_scores (
    company_id uuid primary key references public.leadgen_companies(id) on delete cascade,
    workspace_id uuid not null references public.workspaces(id) on delete cascade,
    poll_id uuid references public.leadgen_polls(id) on delete set null,
    owner_identity_points integer not null default 0,
    owner_phone_points integer not null default 0,
    business_support_points integer not null default 0,
    total_score integer not null default 0,
    qualification_status text not null default 'researching' check (qualification_status in ('qualified', 'researching', 'rejected')),
    disqualification_reason text,
    best_owner_name text,
    best_owner_phone text,
    score_detail jsonb not null default '{}'::jsonb,
    updated_at timestamptz not null default now()
);

create table if not exists public.leadgen_source_health (
    source_key text primary key references public.leadgen_source_catalog(source_key) on delete cascade,
    status text not null default 'unknown' check (status in ('healthy', 'degraded', 'blocked', 'unknown')),
    last_success_at timestamptz,
    last_failure_at timestamptz,
    last_error text,
    metadata jsonb not null default '{}'::jsonb,
    updated_at timestamptz not null default now()
);

alter table public.leadgen_companies
add column if not exists owner_identity_points integer not null default 0,
add column if not exists owner_phone_points integer not null default 0,
add column if not exists business_support_points integer not null default 0,
add column if not exists lead_score integer not null default 0,
add column if not exists qualification_status text not null default 'researching',
add column if not exists qualified_at timestamptz,
add column if not exists disqualification_reason text;

create index if not exists leadgen_source_catalog_family_idx on public.leadgen_source_catalog (family, implementation_status, enabled);
create index if not exists leadgen_investigation_tasks_poll_status_idx on public.leadgen_investigation_tasks (poll_id, status, created_at);
create index if not exists leadgen_investigation_tasks_company_idx on public.leadgen_investigation_tasks (company_id, source_key);
create index if not exists leadgen_evidence_claims_company_idx on public.leadgen_evidence_claims (company_id, claim_kind, created_at desc);
create index if not exists leadgen_candidate_scores_poll_status_idx on public.leadgen_candidate_scores (poll_id, qualification_status, total_score desc);
create index if not exists leadgen_companies_score_idx on public.leadgen_companies (workspace_id, qualification_status, lead_score desc, created_at desc);

drop trigger if exists leadgen_source_catalog_updated_at on public.leadgen_source_catalog;
create trigger leadgen_source_catalog_updated_at before update on public.leadgen_source_catalog for each row execute function public.set_updated_at();

drop trigger if exists leadgen_investigation_tasks_updated_at on public.leadgen_investigation_tasks;
create trigger leadgen_investigation_tasks_updated_at before update on public.leadgen_investigation_tasks for each row execute function public.set_updated_at();

insert into public.leadgen_source_catalog (
    source_key, label, family, source_points, owner_identity_points, owner_phone_points, business_support_points,
    access_method, free_status, implementation_status, run_stage, enabled, rate_limit_ms, coverage, metadata
)
values
    ('overture', 'Overture Places', 'seed', 1, 0, 0, 1, 'public_geoparquet', 'free', 'active', 'seed', true, 0, '{"countries":["US"]}'::jsonb, '{"role":"candidate_seed","stores_raw":true}'::jsonb),
    ('website', 'Company website crawler', 'web', 2, 2, 2, 1, 'public_html', 'free', 'active', 'candidate_investigation', true, 500, '{"countries":["US"]}'::jsonb, '{"phone_rule":"owner_phone_only_when_near_owner_evidence"}'::jsonb),
    ('osm', 'OpenStreetMap / Overpass', 'seed', 1, 0, 0, 1, 'public_api', 'free', 'active', 'candidate_investigation', false, 3000, '{"countries":["US"]}'::jsonb, '{"note":"research/support only until matched per candidate"}'::jsonb),
    ('state_license.tx.tdlr', 'Texas TDLR licensing', 'licensing', 3, 3, 3, 2, 'public_html', 'free', 'active', 'candidate_investigation', true, 1500, '{"states":["TX"],"industries":["hvac_contractors","electricians","water_well_services"]}'::jsonb, '{"adapter":"existing_state_licensing_worker","board":"tdlr"}'::jsonb),
    ('sam_gov', 'SAM.gov Entity Management', 'procurement', 2, 2, 2, 2, 'public_api_key', 'free_key', 'validation_only', 'validation', false, 10000, '{"countries":["US"]}'::jsonb, '{"quota":"basic accounts are too limited for bulk polling"}'::jsonb),

    ('state_license.tx.plumbing', 'Texas plumbing board lookup', 'licensing', 3, 3, 3, 2, 'public_html', 'free', 'planned', 'candidate_investigation', false, 1500, '{"states":["TX"],"industries":["plumbers"]}'::jsonb, '{"priority":"high"}'::jsonb),
    ('state_license.fl.dbpr', 'Florida DBPR construction licensing', 'licensing', 3, 3, 3, 2, 'public_html', 'free', 'planned', 'candidate_investigation', false, 1500, '{"states":["FL"]}'::jsonb, '{"priority":"high"}'::jsonb),
    ('state_license.fl.electrical', 'Florida electrical contractor licensing', 'licensing', 3, 3, 3, 2, 'public_html', 'free', 'planned', 'candidate_investigation', false, 1500, '{"states":["FL"],"industries":["electricians"]}'::jsonb, '{"priority":"high"}'::jsonb),
    ('state_license.ca.cslb', 'California CSLB contractor lookup', 'licensing', 3, 3, 3, 2, 'public_html', 'free', 'planned', 'candidate_investigation', false, 1500, '{"states":["CA"]}'::jsonb, '{"priority":"high"}'::jsonb),
    ('state_license.az.roc', 'Arizona Registrar of Contractors', 'licensing', 3, 3, 3, 2, 'public_html', 'free', 'planned', 'candidate_investigation', false, 1500, '{"states":["AZ"]}'::jsonb, '{"priority":"high"}'::jsonb),
    ('state_license.nc.general_contractors', 'North Carolina general contractor board', 'licensing', 3, 3, 3, 2, 'public_html', 'free', 'planned', 'candidate_investigation', false, 1500, '{"states":["NC"],"industries":["general_contractors","remodellers"]}'::jsonb, '{"priority":"high"}'::jsonb),
    ('state_license.nc.electrical', 'North Carolina electrical contractor board', 'licensing', 3, 3, 3, 2, 'public_html', 'free', 'planned', 'candidate_investigation', false, 1500, '{"states":["NC"],"industries":["electricians"]}'::jsonb, '{"priority":"high"}'::jsonb),
    ('state_license.nc.plumbing_hvac', 'North Carolina plumbing/HVAC/fire sprinkler board', 'licensing', 3, 3, 3, 2, 'public_html', 'free', 'planned', 'candidate_investigation', false, 1500, '{"states":["NC"],"industries":["plumbers","hvac_contractors"]}'::jsonb, '{"priority":"high"}'::jsonb),
    ('state_license.ga.contractors', 'Georgia construction licensing boards', 'licensing', 3, 3, 3, 2, 'public_html', 'free', 'planned', 'candidate_investigation', false, 1500, '{"states":["GA"]}'::jsonb, '{"priority":"medium"}'::jsonb),
    ('state_license.tn.contractors', 'Tennessee contractor licensing', 'licensing', 3, 3, 3, 2, 'public_html', 'free', 'planned', 'candidate_investigation', false, 1500, '{"states":["TN"]}'::jsonb, '{"priority":"medium"}'::jsonb),
    ('state_license.co.local_contractors', 'Colorado local contractor licensing', 'licensing', 2, 2, 2, 2, 'public_html', 'free', 'planned', 'candidate_investigation', false, 1500, '{"states":["CO"]}'::jsonb, '{"note":"Colorado coverage is often municipal"}'::jsonb),
    ('state_license.fire_alarm_sprinkler', 'Fire alarm and sprinkler licensing', 'licensing', 3, 3, 3, 2, 'public_html', 'free', 'planned', 'candidate_investigation', false, 1500, '{"countries":["US"]}'::jsonb, '{"priority":"medium"}'::jsonb),
    ('state_license.pesticide_applicator', 'Pesticide applicator licensing', 'licensing', 3, 3, 3, 2, 'public_html', 'free', 'planned', 'candidate_investigation', false, 1500, '{"countries":["US"],"industries":["landscapers","tree_services"]}'::jsonb, '{"priority":"medium"}'::jsonb),
    ('state_license.septic_well', 'Septic and well installer licensing', 'licensing', 3, 3, 3, 2, 'public_html', 'free', 'planned', 'candidate_investigation', false, 1500, '{"countries":["US"],"industries":["water_well_services"]}'::jsonb, '{"priority":"medium"}'::jsonb),

    ('permits.socrata.generic', 'Generic Socrata permits adapter', 'permits', 3, 2, 3, 3, 'public_api', 'free', 'planned', 'candidate_investigation', false, 1000, '{"countries":["US"]}'::jsonb, '{"adapter_type":"dataset_config"}'::jsonb),
    ('permits.csv.generic', 'Generic CSV/bulk permits adapter', 'permits', 3, 2, 3, 3, 'public_csv', 'free', 'planned', 'candidate_investigation', false, 1000, '{"countries":["US"]}'::jsonb, '{"adapter_type":"dataset_config"}'::jsonb),
    ('permits.html.generic', 'Generic public HTML permits adapter', 'permits', 2, 1, 2, 2, 'public_html', 'free', 'planned', 'candidate_investigation', false, 2000, '{"countries":["US"]}'::jsonb, '{"adapter_type":"parser_config"}'::jsonb),
    ('permits.tx.dallas', 'Dallas building permits', 'permits', 3, 2, 3, 3, 'public_api', 'free', 'planned', 'candidate_investigation', false, 1000, '{"states":["TX"],"cities":["Dallas"]}'::jsonb, '{"priority":"high"}'::jsonb),
    ('permits.tx.fort_worth', 'Fort Worth building permits', 'permits', 3, 2, 3, 3, 'public_api', 'free', 'planned', 'candidate_investigation', false, 1000, '{"states":["TX"],"cities":["Fort Worth"]}'::jsonb, '{"priority":"high"}'::jsonb),
    ('permits.tx.houston', 'Houston permits', 'permits', 3, 2, 3, 3, 'public_api', 'free', 'planned', 'candidate_investigation', false, 1000, '{"states":["TX"],"cities":["Houston"]}'::jsonb, '{"priority":"high"}'::jsonb),
    ('permits.tx.austin', 'Austin permits', 'permits', 3, 2, 3, 3, 'public_api', 'free', 'planned', 'candidate_investigation', false, 1000, '{"states":["TX"],"cities":["Austin"]}'::jsonb, '{"priority":"high"}'::jsonb),
    ('permits.tx.san_antonio', 'San Antonio permits', 'permits', 3, 2, 3, 3, 'public_api', 'free', 'planned', 'candidate_investigation', false, 1000, '{"states":["TX"],"cities":["San Antonio"]}'::jsonb, '{"priority":"high"}'::jsonb),
    ('permits.fl.miami_dade', 'Miami-Dade permits', 'permits', 3, 2, 3, 3, 'public_api', 'free', 'planned', 'candidate_investigation', false, 1000, '{"states":["FL"],"counties":["Miami-Dade"]}'::jsonb, '{"priority":"medium"}'::jsonb),
    ('permits.fl.orlando', 'Orlando permits', 'permits', 3, 2, 3, 3, 'public_api', 'free', 'planned', 'candidate_investigation', false, 1000, '{"states":["FL"],"cities":["Orlando"]}'::jsonb, '{"priority":"medium"}'::jsonb),
    ('permits.fl.tampa', 'Tampa permits', 'permits', 3, 2, 3, 3, 'public_api', 'free', 'planned', 'candidate_investigation', false, 1000, '{"states":["FL"],"cities":["Tampa"]}'::jsonb, '{"priority":"medium"}'::jsonb),
    ('permits.fl.jacksonville', 'Jacksonville permits', 'permits', 3, 2, 3, 3, 'public_api', 'free', 'planned', 'candidate_investigation', false, 1000, '{"states":["FL"],"cities":["Jacksonville"]}'::jsonb, '{"priority":"medium"}'::jsonb),
    ('permits.ca.los_angeles', 'Los Angeles permits', 'permits', 3, 2, 3, 3, 'public_api', 'free', 'planned', 'candidate_investigation', false, 1000, '{"states":["CA"],"cities":["Los Angeles"]}'::jsonb, '{"priority":"medium"}'::jsonb),
    ('permits.nc.charlotte', 'Charlotte permits', 'permits', 3, 2, 3, 3, 'public_api', 'free', 'planned', 'candidate_investigation', false, 1000, '{"states":["NC"],"cities":["Charlotte"]}'::jsonb, '{"priority":"medium"}'::jsonb),
    ('permits.nc.raleigh', 'Raleigh permits', 'permits', 3, 2, 3, 3, 'public_api', 'free', 'planned', 'candidate_investigation', false, 1000, '{"states":["NC"],"cities":["Raleigh"]}'::jsonb, '{"priority":"medium"}'::jsonb),
    ('permits.az.phoenix', 'Phoenix permits', 'permits', 3, 2, 3, 3, 'public_api', 'free', 'planned', 'candidate_investigation', false, 1000, '{"states":["AZ"],"cities":["Phoenix"]}'::jsonb, '{"priority":"medium"}'::jsonb),
    ('permits.co.denver', 'Denver permits', 'permits', 3, 2, 3, 3, 'public_api', 'free', 'planned', 'candidate_investigation', false, 1000, '{"states":["CO"],"cities":["Denver"]}'::jsonb, '{"priority":"medium"}'::jsonb),
    ('permits.ga.atlanta', 'Atlanta permits', 'permits', 3, 2, 3, 3, 'public_api', 'free', 'planned', 'candidate_investigation', false, 1000, '{"states":["GA"],"cities":["Atlanta"]}'::jsonb, '{"priority":"medium"}'::jsonb),
    ('permits.tn.nashville', 'Nashville permits', 'permits', 3, 2, 3, 3, 'public_api', 'free', 'planned', 'candidate_investigation', false, 1000, '{"states":["TN"],"cities":["Nashville"]}'::jsonb, '{"priority":"medium"}'::jsonb),

    ('registry.tx.sos', 'Texas SOS entity lookup', 'registries', 2, 2, 0, 2, 'public_html', 'planned_free_unknown', 'planned', 'candidate_investigation', false, 1500, '{"states":["TX"]}'::jsonb, '{"note":"free pullability must be verified"}'::jsonb),
    ('registry.fl.sunbiz', 'Florida Sunbiz', 'registries', 3, 3, 0, 2, 'public_html', 'free', 'planned', 'candidate_investigation', false, 1500, '{"states":["FL"]}'::jsonb, '{"priority":"high"}'::jsonb),
    ('registry.ca.bizfile', 'California bizfile', 'registries', 2, 2, 0, 2, 'public_html', 'free', 'planned', 'candidate_investigation', false, 1500, '{"states":["CA"]}'::jsonb, '{"priority":"medium"}'::jsonb),
    ('registry.nc.sos', 'North Carolina SOS', 'registries', 3, 3, 0, 2, 'public_html', 'free', 'planned', 'candidate_investigation', false, 1500, '{"states":["NC"]}'::jsonb, '{"priority":"medium"}'::jsonb),
    ('registry.co.sos', 'Colorado SOS', 'registries', 3, 3, 0, 2, 'public_html', 'free', 'planned', 'candidate_investigation', false, 1500, '{"states":["CO"]}'::jsonb, '{"priority":"medium"}'::jsonb),
    ('registry.az.corp_commission', 'Arizona Corporation Commission', 'registries', 3, 3, 0, 2, 'public_html', 'free', 'planned', 'candidate_investigation', false, 1500, '{"states":["AZ"]}'::jsonb, '{"priority":"medium"}'::jsonb),
    ('registry.ga.sos', 'Georgia SOS', 'registries', 2, 2, 0, 2, 'public_html', 'free', 'planned', 'candidate_investigation', false, 1500, '{"states":["GA"]}'::jsonb, '{"priority":"medium"}'::jsonb),
    ('registry.tn.sos', 'Tennessee SOS', 'registries', 2, 2, 0, 2, 'public_html', 'free', 'planned', 'candidate_investigation', false, 1500, '{"states":["TN"]}'::jsonb, '{"priority":"medium"}'::jsonb),
    ('registry.dba.county', 'County DBA / assumed-name records', 'registries', 3, 3, 0, 2, 'public_html', 'free', 'planned', 'candidate_investigation', false, 1500, '{"countries":["US"]}'::jsonb, '{"priority":"high"}'::jsonb),
    ('registry.ucc', 'UCC filings', 'registries', 2, 2, 0, 1, 'public_html', 'free', 'planned', 'candidate_investigation', false, 1500, '{"countries":["US"]}'::jsonb, '{"priority":"low"}'::jsonb),
    ('registry.liens', 'Mechanics/tax lien records', 'registries', 2, 2, 0, 2, 'public_html', 'free', 'planned', 'candidate_investigation', false, 1500, '{"countries":["US"]}'::jsonb, '{"priority":"low"}'::jsonb),
    ('registry.county_recorder', 'County recorder documents', 'registries', 2, 2, 0, 1, 'public_html', 'free', 'planned', 'candidate_investigation', false, 1500, '{"countries":["US"]}'::jsonb, '{"priority":"low"}'::jsonb),

    ('procurement.usaspending', 'USAspending awards', 'procurement', 2, 1, 0, 2, 'public_api', 'free', 'planned', 'candidate_investigation', false, 500, '{"countries":["US"]}'::jsonb, '{"priority":"medium"}'::jsonb),
    ('procurement.state_awards', 'State procurement awards', 'procurement', 2, 1, 1, 2, 'public_api_or_html', 'free', 'planned', 'candidate_investigation', false, 1000, '{"countries":["US"]}'::jsonb, '{"priority":"medium"}'::jsonb),
    ('procurement.local_vendor_lists', 'City/county vendor lists', 'procurement', 2, 1, 2, 2, 'public_api_or_html', 'free', 'planned', 'candidate_investigation', false, 1000, '{"countries":["US"]}'::jsonb, '{"priority":"medium"}'::jsonb),
    ('procurement.school_vendor_lists', 'School district vendor lists', 'procurement', 2, 1, 2, 2, 'public_html', 'free', 'planned', 'candidate_investigation', false, 1000, '{"countries":["US"]}'::jsonb, '{"priority":"medium"}'::jsonb),
    ('procurement.bid_tabs', 'Bid tabulations', 'procurement', 2, 1, 1, 2, 'public_html', 'free', 'planned', 'candidate_investigation', false, 1000, '{"countries":["US"]}'::jsonb, '{"priority":"medium"}'::jsonb),
    ('procurement.planholders', 'Planholder and bidders lists', 'procurement', 2, 1, 2, 2, 'public_html', 'free', 'planned', 'candidate_investigation', false, 1000, '{"countries":["US"]}'::jsonb, '{"priority":"medium"}'::jsonb),
    ('procurement.prequalified_contractors', 'Prequalified contractor lists', 'procurement', 3, 2, 2, 3, 'public_html', 'free', 'planned', 'candidate_investigation', false, 1000, '{"countries":["US"]}'::jsonb, '{"priority":"high"}'::jsonb),

    ('safety.osha', 'OSHA establishment search', 'safety', 1, 0, 0, 1, 'public_html', 'free', 'planned', 'candidate_investigation', false, 1000, '{"countries":["US"]}'::jsonb, '{"note":"activity/safety context only"}'::jsonb),
    ('transport.fmcsa_safer', 'FMCSA SAFER company snapshot', 'transport', 3, 1, 3, 3, 'public_html', 'free', 'planned', 'candidate_investigation', false, 1000, '{"countries":["US"],"industries":["moving","transport","freight"]}'::jsonb, '{"priority":"medium"}'::jsonb),
    ('transport.fmcsa_insurance', 'FMCSA licensing and insurance', 'transport', 2, 1, 2, 2, 'public_html', 'free', 'planned', 'candidate_investigation', false, 1000, '{"countries":["US"],"industries":["moving","transport","freight"]}'::jsonb, '{"priority":"medium"}'::jsonb),
    ('regulated.msha', 'MSHA contractor/operator data', 'regulated', 2, 1, 1, 2, 'public_api_or_html', 'free', 'planned', 'candidate_investigation', false, 1000, '{"countries":["US"]}'::jsonb, '{"priority":"low"}'::jsonb),
    ('regulated.epa_echo', 'EPA ECHO regulated facilities', 'regulated', 1, 0, 0, 1, 'public_api', 'free', 'planned', 'candidate_investigation', false, 1000, '{"countries":["US"]}'::jsonb, '{"priority":"low"}'::jsonb),
    ('regulated.state_environmental_permits', 'State environmental permit databases', 'regulated', 2, 1, 1, 2, 'public_api_or_html', 'free', 'planned', 'candidate_investigation', false, 1000, '{"countries":["US"]}'::jsonb, '{"priority":"low"}'::jsonb),
    ('regulated.nppes', 'NPPES NPI Registry', 'regulated', 3, 3, 3, 2, 'public_bulk', 'free', 'planned', 'future_vertical', false, 0, '{"countries":["US"],"verticals":["healthcare"]}'::jsonb, '{"note":"not contractor default"}'::jsonb),

    ('directory.bbb', 'BBB profiles', 'directories', 2, 1, 1, 2, 'public_html', 'free', 'planned', 'candidate_investigation', false, 1500, '{"countries":["US"]}'::jsonb, '{"priority":"medium"}'::jsonb),
    ('directory.chamber', 'Chamber of Commerce directories', 'directories', 1, 1, 1, 1, 'public_html', 'free', 'planned', 'candidate_investigation', false, 1500, '{"countries":["US"]}'::jsonb, '{"priority":"low"}'::jsonb),
    ('directory.trade_associations', 'Trade association member directories', 'directories', 2, 1, 1, 2, 'public_html', 'free', 'planned', 'candidate_investigation', false, 1500, '{"countries":["US"]}'::jsonb, '{"priority":"medium"}'::jsonb),
    ('directory.manufacturer_installers', 'Manufacturer certified installer directories', 'directories', 2, 0, 1, 2, 'public_html', 'free', 'planned', 'candidate_investigation', false, 1500, '{"countries":["US"]}'::jsonb, '{"priority":"medium"}'::jsonb),
    ('directory.foursquare_os_places', 'Foursquare OS Places', 'directories', 1, 0, 0, 1, 'public_dataset', 'free', 'planned', 'candidate_investigation', false, 0, '{"countries":["US"]}'::jsonb, '{"priority":"low"}'::jsonb),
    ('directory.alltheplaces', 'AllThePlaces', 'directories', 1, 0, 0, 1, 'public_dataset', 'free', 'planned', 'candidate_investigation', false, 0, '{"countries":["US"]}'::jsonb, '{"priority":"low"}'::jsonb),
    ('web.json_ld', 'Website structured data / JSON-LD', 'web', 1, 0, 0, 1, 'public_html', 'free', 'active', 'candidate_investigation', true, 500, '{"countries":["US"]}'::jsonb, '{"adapter":"website"}'::jsonb),
    ('web.linkedin_public', 'LinkedIn public company/founder pages', 'web', 2, 2, 0, 1, 'public_html', 'free', 'planned', 'candidate_investigation', false, 2000, '{"countries":["US"]}'::jsonb, '{"note":"only publicly accessible/compliant pages"}'::jsonb),
    ('web.local_news', 'Local news/business profiles', 'web', 2, 2, 0, 1, 'public_html', 'free', 'planned', 'candidate_investigation', false, 2000, '{"countries":["US"]}'::jsonb, '{"priority":"low"}'::jsonb),
    ('web.press_releases', 'Press releases', 'web', 1, 1, 0, 1, 'public_html', 'free', 'planned', 'candidate_investigation', false, 2000, '{"countries":["US"]}'::jsonb, '{"priority":"low"}'::jsonb),
    ('web.social_bios', 'Public social bios', 'web', 1, 0, 1, 1, 'public_html', 'free', 'planned', 'candidate_investigation', false, 2000, '{"countries":["US"]}'::jsonb, '{"note":"weak contact support only"}'::jsonb),
    ('web.rdap_whois', 'Domain RDAP/WHOIS', 'web', 1, 0, 0, 1, 'public_api', 'free', 'planned', 'candidate_investigation', false, 1000, '{"countries":["US"]}'::jsonb, '{"note":"usually redacted; weak support"}'::jsonb),
    ('web.certificate_transparency', 'Certificate transparency', 'web', 1, 0, 0, 1, 'public_dataset', 'free', 'planned', 'candidate_investigation', false, 0, '{"countries":["US"]}'::jsonb, '{"note":"domain infrastructure signal only"}'::jsonb)
on conflict (source_key)
do update set
    label = excluded.label,
    family = excluded.family,
    source_points = excluded.source_points,
    owner_identity_points = excluded.owner_identity_points,
    owner_phone_points = excluded.owner_phone_points,
    business_support_points = excluded.business_support_points,
    access_method = excluded.access_method,
    free_status = excluded.free_status,
    implementation_status = excluded.implementation_status,
    run_stage = excluded.run_stage,
    enabled = excluded.enabled,
    rate_limit_ms = excluded.rate_limit_ms,
    coverage = excluded.coverage,
    metadata = public.leadgen_source_catalog.metadata || excluded.metadata,
    updated_at = now();

insert into public.leadgen_source_health (source_key, status)
select source_key,
    case
        when implementation_status = 'blocked' then 'blocked'
        when implementation_status in ('active', 'validation_only') then 'unknown'
        else 'unknown'
    end
from public.leadgen_source_catalog
on conflict (source_key) do nothing;
