create table if not exists public.relationships (
    id uuid primary key default gen_random_uuid(),
    workspace_id uuid not null references public.workspaces(id) on delete cascade,
    client_id uuid references public.clients(id) on delete set null,
    leadgen_company_id uuid references public.leadgen_companies(id) on delete set null,
    source_type text not null default 'manual' check (source_type in ('manual', 'client', 'leadgen')),
    primary_person_name text not null,
    primary_email text,
    primary_phone text,
    business_name text,
    website_url text,
    lifecycle_phase text not null default 'found' check (lifecycle_phase in ('found', 'qualified', 'contacted', 'sold', 'invoiced', 'onboarding', 'onboarding_complete', 'fulfilment', 'retention', 'completed_lost')),
    status text not null default 'active' check (status in ('active', 'waiting', 'blocked', 'completed', 'lost', 'archived')),
    source_metadata jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create table if not exists public.relationship_work_items (
    id uuid primary key default gen_random_uuid(),
    workspace_id uuid not null references public.workspaces(id) on delete cascade,
    relationship_id uuid not null references public.relationships(id) on delete cascade,
    title text not null,
    description text,
    lifecycle_phase text not null default 'found' check (lifecycle_phase in ('found', 'qualified', 'contacted', 'sold', 'invoiced', 'onboarding', 'onboarding_complete', 'fulfilment', 'retention', 'completed_lost')),
    status text not null default 'todo' check (status in ('todo', 'doing', 'waiting', 'blocked', 'done', 'canceled')),
    priority integer not null default 3 check (priority between 1 and 5),
    is_key_task boolean not null default true,
    native_kind text,
    native_id uuid,
    native_href text,
    planned_start_date date,
    planned_end_date date,
    actual_start_at timestamptz,
    actual_completed_at timestamptz,
    sort_order integer not null default 0,
    metadata jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create unique index if not exists relationships_client_id_unique
on public.relationships(client_id)
where client_id is not null;

create unique index if not exists relationships_leadgen_company_id_unique
on public.relationships(leadgen_company_id)
where leadgen_company_id is not null;

create index if not exists relationships_workspace_phase_idx
on public.relationships(workspace_id, lifecycle_phase, updated_at desc);

create index if not exists relationships_workspace_person_idx
on public.relationships(workspace_id, primary_person_name);

create index if not exists relationship_work_items_workspace_status_idx
on public.relationship_work_items(workspace_id, status, priority, planned_end_date);

create index if not exists relationship_work_items_relationship_phase_idx
on public.relationship_work_items(relationship_id, lifecycle_phase, sort_order, created_at);

create unique index if not exists relationship_work_items_native_unique
on public.relationship_work_items(workspace_id, relationship_id, native_kind, native_id)
where native_kind is not null and native_id is not null;

drop trigger if exists relationships_updated_at on public.relationships;
create trigger relationships_updated_at
before update on public.relationships
for each row execute function public.set_updated_at();

drop trigger if exists relationship_work_items_updated_at on public.relationship_work_items;
create trigger relationship_work_items_updated_at
before update on public.relationship_work_items
for each row execute function public.set_updated_at();

create or replace function public.sync_relationship_from_client()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
    relationship_id uuid;
begin
    insert into public.relationships (
        workspace_id,
        client_id,
        source_type,
        primary_person_name,
        primary_email,
        primary_phone,
        business_name,
        lifecycle_phase,
        status,
        source_metadata,
        created_at,
        updated_at
    )
    values (
        new.workspace_id,
        new.id,
        'client',
        coalesce(nullif(new.name, ''), nullif(new.email, ''), nullif(new.phone, ''), 'Unknown relationship'),
        nullif(new.email, ''),
        nullif(new.phone, ''),
        nullif(new.name, ''),
        case when new.archived_at is not null then 'completed_lost' else 'onboarding' end,
        case when new.archived_at is not null then 'archived' else 'active' end,
        jsonb_build_object('auto_wrapped_from', 'clients', 'is_test', coalesce(new.is_test, false)),
        new.created_at,
        now()
    )
    on conflict (client_id)
    where client_id is not null
    do update set
        workspace_id = excluded.workspace_id,
        primary_person_name = excluded.primary_person_name,
        primary_email = excluded.primary_email,
        primary_phone = excluded.primary_phone,
        business_name = excluded.business_name,
        lifecycle_phase = excluded.lifecycle_phase,
        status = excluded.status,
        source_metadata = relationships.source_metadata || excluded.source_metadata,
        updated_at = now()
    returning id into relationship_id;

    insert into public.relationship_work_items (
        workspace_id,
        relationship_id,
        title,
        description,
        lifecycle_phase,
        status,
        priority,
        is_key_task,
        native_kind,
        native_id,
        native_href,
        actual_start_at,
        sort_order,
        metadata
    )
    values (
        new.workspace_id,
        relationship_id,
        'Onboarding relationship opened',
        'Created from the existing client onboarding record.',
        'onboarding',
        case when new.archived_at is not null then 'done' else 'doing' end,
        2,
        true,
        'client',
        new.id,
        '/admin/client/' || new.id::text,
        new.created_at,
        10,
        jsonb_build_object('auto_created', true)
    )
    on conflict (workspace_id, relationship_id, native_kind, native_id)
    where native_kind is not null and native_id is not null
    do update set
        title = excluded.title,
        status = excluded.status,
        updated_at = now();

    return new;
end;
$$;

drop trigger if exists sync_relationship_after_client_insert_update on public.clients;
create trigger sync_relationship_after_client_insert_update
after insert or update of workspace_id, name, email, phone, archived_at, is_test
on public.clients
for each row execute function public.sync_relationship_from_client();

insert into public.relationships (
    workspace_id,
    client_id,
    source_type,
    primary_person_name,
    primary_email,
    primary_phone,
    business_name,
    lifecycle_phase,
    status,
    source_metadata,
    created_at,
    updated_at
)
select
    c.workspace_id,
    c.id,
    'client',
    coalesce(nullif(c.name, ''), nullif(c.email, ''), nullif(c.phone, ''), 'Unknown relationship'),
    nullif(c.email, ''),
    nullif(c.phone, ''),
    nullif(c.name, ''),
    case when c.archived_at is not null then 'completed_lost' else 'onboarding' end,
    case when c.archived_at is not null then 'archived' else 'active' end,
    jsonb_build_object('auto_wrapped_from', 'clients', 'is_test', coalesce(c.is_test, false)),
    c.created_at,
    now()
from public.clients c
on conflict (client_id)
where client_id is not null
do update set
    workspace_id = excluded.workspace_id,
    primary_person_name = excluded.primary_person_name,
    primary_email = excluded.primary_email,
    primary_phone = excluded.primary_phone,
    business_name = excluded.business_name,
    lifecycle_phase = excluded.lifecycle_phase,
    status = excluded.status,
    source_metadata = relationships.source_metadata || excluded.source_metadata,
    updated_at = now();

insert into public.relationship_work_items (
    workspace_id,
    relationship_id,
    title,
    description,
    lifecycle_phase,
    status,
    priority,
    is_key_task,
    native_kind,
    native_id,
    native_href,
    actual_start_at,
    sort_order,
    metadata
)
select
    c.workspace_id,
    r.id,
    'Onboarding relationship opened',
    'Created from the existing client onboarding record.',
    'onboarding',
    case when c.archived_at is not null then 'done' else 'doing' end,
    2,
    true,
    'client',
    c.id,
    '/admin/client/' || c.id::text,
    c.created_at,
    10,
    jsonb_build_object('auto_created', true)
from public.clients c
join public.relationships r on r.client_id = c.id
on conflict (workspace_id, relationship_id, native_kind, native_id)
where native_kind is not null and native_id is not null
do update set
    status = excluded.status,
    updated_at = now();

alter table public.relationships enable row level security;
alter table public.relationship_work_items enable row level security;

drop policy if exists workspace_members_can_read_relationships on public.relationships;
create policy workspace_members_can_read_relationships
on public.relationships
for select
using (public.is_workspace_member(workspace_id));

drop policy if exists workspace_admins_can_manage_relationships on public.relationships;
create policy workspace_admins_can_manage_relationships
on public.relationships
for all
using (public.is_workspace_member(workspace_id, array['owner','admin']))
with check (public.is_workspace_member(workspace_id, array['owner','admin']));

drop policy if exists workspace_members_can_read_relationship_work_items on public.relationship_work_items;
create policy workspace_members_can_read_relationship_work_items
on public.relationship_work_items
for select
using (public.is_workspace_member(workspace_id));

drop policy if exists workspace_admins_can_manage_relationship_work_items on public.relationship_work_items;
create policy workspace_admins_can_manage_relationship_work_items
on public.relationship_work_items
for all
using (public.is_workspace_member(workspace_id, array['owner','admin']))
with check (public.is_workspace_member(workspace_id, array['owner','admin']));
