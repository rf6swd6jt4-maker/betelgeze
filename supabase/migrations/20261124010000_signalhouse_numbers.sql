-- SignalHouse texting for Campaigns (docs/signalhouse.md).
-- A workspace connects one or more SignalHouse accounts (one per SignalHouse group). Betelgeze reads each account's
-- 10DLC registrations ("campaigns" in SignalHouse) and phone numbers; a number is "added" when the workspace chooses to
-- use it. A campaign has a default number, a source may use its own, and a lead keeps the number that first texted it.
-- Webhook deliveries are stored once each (by SignalHouse's delivery id) and processed after the 200 reply.
-- Everything stays service-only: RLS on, grants revoked. Nothing here sends a text.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';

create table public.signalhouse_accounts (
 id uuid primary key default gen_random_uuid(),
 workspace_id uuid not null references public.workspaces(id),
 group_id text not null check(group_id ~ '^G[A-Za-z0-9]{7}$'),
 name text not null default '' check(length(name)<=200),
 -- Encrypted with the workspace integration key: the API key and the webhook signing secret(s).
 config_encrypted text not null,
 key_hint text not null default '' check(length(key_hint)<=20),
 key_expires_at timestamptz,
 webhook_id text check(webhook_id is null or length(webhook_id)<=100),
 status text not null default 'connected' check(status in('connected','needs_attention','disconnected')),
 last_synced_at timestamptz,
 last_webhook_at timestamptz,
 last_error text check(last_error is null or length(last_error)<=500),
 created_by uuid references auth.users(id),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create unique index signalhouse_accounts_group on public.signalhouse_accounts(workspace_id,group_id) where status<>'disconnected';

-- 10DLC registrations, as SignalHouse last reported them.
create table public.signalhouse_registrations (
 id uuid primary key default gen_random_uuid(),
 workspace_id uuid not null references public.workspaces(id),
 account_id uuid not null references public.signalhouse_accounts(id),
 external_id text not null check(length(external_id) between 1 and 100),
 usecase text not null default '' check(length(usecase)<=100),
 description text not null default '' check(length(description)<=2000),
 status text not null default '' check(length(status)<=40),
 synced_at timestamptz not null default now(),
 unique(account_id,external_id)
);

-- Every number in a connected account. added_at is set while the workspace uses it; removed_at when it leaves.
create table public.campaign_sms_numbers (
 id uuid primary key default gen_random_uuid(),
 workspace_id uuid not null references public.workspaces(id),
 account_id uuid not null references public.signalhouse_accounts(id),
 phone_e164 text not null check(phone_e164 ~ '^\+1[2-9][0-9]{9}$'),
 label text not null default '' check(length(label)<=60),
 registration_external_id text check(registration_external_id is null or length(registration_external_id)<=100),
 status text not null default '' check(length(status)<=40),
 capabilities text[] not null default '{}',
 health jsonb not null default '{}' check(jsonb_typeof(health)='object' and octet_length(health::text)<=8192),
 added_at timestamptz,
 removed_at timestamptz,
 synced_at timestamptz not null default now(),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 unique(account_id,phone_e164)
);
create index campaign_sms_numbers_workspace on public.campaign_sms_numbers(workspace_id) where added_at is not null and removed_at is null;

alter table public.campaigns add column sms_number_id uuid references public.campaign_sms_numbers(id);
alter table public.campaign_sources add column sms_number_id uuid references public.campaign_sms_numbers(id);
-- The number that first texted the lead. Their replies stay in one conversation even if a default changes later.
alter table public.campaign_leads add column sms_number_id uuid references public.campaign_sms_numbers(id);
create index campaign_leads_sms_number on public.campaign_leads(sms_number_id) where sms_number_id is not null;

-- Webhook deliveries, once each. Stored before the reply; processed afterwards.
create table public.signalhouse_webhook_events (
 id uuid primary key default gen_random_uuid(),
 account_id uuid not null references public.signalhouse_accounts(id),
 delivery_id text not null unique check(length(delivery_id) between 1 and 100),
 event text not null check(event ~ '^[A-Z0-9_]{1,60}$'),
 identifier text check(identifier is null or length(identifier)<=4000),
 payload jsonb not null check(jsonb_typeof(payload)='object' and octet_length(payload::text)<=65536),
 received_at timestamptz not null default now(),
 processed_at timestamptz
);
create index signalhouse_webhook_events_account on public.signalhouse_webhook_events(account_id,received_at desc);

do $$ declare t text; begin
 foreach t in array array['signalhouse_accounts','signalhouse_registrations','campaign_sms_numbers','signalhouse_webhook_events'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from public,anon,authenticated',t);
 end loop;
end $$;

notify pgrst,'reload schema';
commit;
