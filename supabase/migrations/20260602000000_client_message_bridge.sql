create table if not exists public.client_communication_channels (
    id uuid primary key default gen_random_uuid(),
    client_id uuid not null references public.clients(id) on delete cascade,
    provider text not null default 'twilio',
    external_address text not null,
    clickup_workspace_id text,
    clickup_channel_id text not null,
    is_active boolean not null default true,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique (client_id),
    unique (provider, external_address)
);

create table if not exists public.client_messages (
    id uuid primary key default gen_random_uuid(),
    client_id uuid references public.clients(id) on delete cascade,
    communication_channel_id uuid references public.client_communication_channels(id) on delete set null,
    direction text not null check (direction in ('inbound', 'outbound')),
    provider text not null,
    provider_message_id text,
    clickup_message_id text,
    from_address text,
    to_address text,
    body text not null,
    status text not null default 'received',
    error text,
    raw_payload jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now(),
    unique (provider, provider_message_id)
);

create index if not exists client_communication_channels_client_id_idx
    on public.client_communication_channels (client_id);

create index if not exists client_communication_channels_external_address_idx
    on public.client_communication_channels (provider, external_address);

create index if not exists client_messages_client_id_created_at_idx
    on public.client_messages (client_id, created_at desc);
