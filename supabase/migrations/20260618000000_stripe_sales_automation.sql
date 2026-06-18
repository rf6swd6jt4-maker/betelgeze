create table if not exists public.client_sales (
    id uuid primary key default gen_random_uuid(),
    client_id uuid references public.clients(id) on delete set null,
    client_name text not null,
    client_email text,
    client_phone text not null,
    service_keys jsonb not null default '[]'::jsonb,
    line_items jsonb not null default '[]'::jsonb,
    project_timeframe_days integer,
    currency text not null default 'eur',
    total_amount integer not null default 0,
    status text not null default 'draft',
    stripe_customer_id text,
    stripe_invoice_id text unique,
    stripe_invoice_status text,
    stripe_hosted_invoice_url text,
    stripe_invoice_pdf text,
    consent_template_sent_at timestamptz,
    consent_template_message_id text,
    consent_confirmed_at timestamptz,
    consent_confirmed_message_id text,
    onboarding_link_sent_at timestamptz,
    onboarding_link_message_id text,
    raw_payload jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create index if not exists client_sales_client_id_idx
    on public.client_sales (client_id);

create index if not exists client_sales_status_idx
    on public.client_sales (status);

create index if not exists client_sales_client_phone_idx
    on public.client_sales (client_phone);

create index if not exists client_sales_stripe_customer_id_idx
    on public.client_sales (stripe_customer_id);

create table if not exists public.stripe_events (
    id text primary key,
    event_type text not null,
    processed_at timestamptz not null default now(),
    raw_payload jsonb not null default '{}'::jsonb
);
