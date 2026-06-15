alter table public.clients
    add column if not exists is_test boolean not null default false;

alter table public.clients
    add column if not exists project_timeframe text;

create table if not exists public.client_services (
    id uuid primary key default gen_random_uuid(),
    client_id uuid not null references public.clients(id) on delete cascade,
    service_key text not null,
    due_date date,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique (client_id, service_key)
);

create index if not exists client_services_client_id_idx
    on public.client_services (client_id);

update public.client_services
set service_key = 'landing-page-creation',
    updated_at = now()
where service_key = 'landing-page';
