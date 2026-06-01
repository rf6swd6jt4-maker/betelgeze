create table if not exists public.clients (
    id uuid primary key default gen_random_uuid(),
    email text not null,
    name text,
    session_token text not null unique,
    created_at timestamptz not null default now(),
    archived_at timestamptz
);

create table if not exists public.client_progress (
    id uuid primary key default gen_random_uuid(),
    client_id uuid not null references public.clients(id) on delete cascade,
    step_key text not null,
    completed_at timestamptz not null default now(),
    created_at timestamptz not null default now(),
    unique (client_id, step_key)
);

create table if not exists public.client_modules (
    id uuid primary key default gen_random_uuid(),
    client_id uuid not null references public.clients(id) on delete cascade,
    module_key text not null,
    created_at timestamptz not null default now(),
    unique (client_id, module_key)
);

create table if not exists public.client_notes (
    id uuid primary key default gen_random_uuid(),
    client_id uuid not null references public.clients(id) on delete cascade,
    note text not null,
    created_at timestamptz not null default now()
);

create table if not exists public.client_activity (
    id uuid primary key default gen_random_uuid(),
    client_id uuid not null references public.clients(id) on delete cascade,
    activity_type text not null,
    activity_text text not null,
    created_at timestamptz not null default now()
);

create table if not exists public.client_form_responses (
    id uuid primary key default gen_random_uuid(),
    client_id uuid not null references public.clients(id) on delete cascade,
    step_key text not null,
    response jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique (client_id, step_key)
);

create index if not exists client_progress_client_id_idx
    on public.client_progress (client_id);

create index if not exists client_modules_client_id_idx
    on public.client_modules (client_id);

create index if not exists client_notes_client_id_created_at_idx
    on public.client_notes (client_id, created_at desc);

create index if not exists client_activity_client_id_created_at_idx
    on public.client_activity (client_id, created_at desc);

create index if not exists client_form_responses_client_id_idx
    on public.client_form_responses (client_id);
