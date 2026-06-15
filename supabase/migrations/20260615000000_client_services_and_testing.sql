alter table public.clients
    add column if not exists is_test boolean not null default false;

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
