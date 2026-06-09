create table if not exists public.client_clickup_items (
    id uuid primary key default gen_random_uuid(),
    client_id uuid not null references public.clients(id) on delete cascade,
    item_key text not null,
    item_type text not null,
    clickup_id text not null,
    clickup_parent_id text,
    step_key text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique (client_id, item_key)
);

create index if not exists client_clickup_items_client_id_idx
    on public.client_clickup_items (client_id);

create index if not exists client_clickup_items_step_key_idx
    on public.client_clickup_items (client_id, step_key);
