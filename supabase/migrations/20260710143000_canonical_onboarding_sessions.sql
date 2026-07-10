alter table public.work_items
add column if not exists native_key text;

alter table public.assets
add column if not exists native_key text;

create unique index if not exists work_items_native_key_unique
on public.work_items(workspace_id, native_kind, native_key)
where native_kind is not null and native_key is not null;

create unique index if not exists assets_native_key_unique
on public.assets(workspace_id, native_kind, native_key)
where native_kind is not null and native_key is not null;

create table if not exists public.relationship_onboarding_sessions (
    id uuid primary key default gen_random_uuid(),
    workspace_id uuid not null references public.workspaces(id) on delete cascade,
    relationship_id uuid not null references public.relationships(id) on delete cascade,
    session_token text not null unique,
    status text not null default 'active' check (status in ('active', 'completed', 'archived')),
    is_test boolean not null default false,
    project_timeframe_days integer,
    legacy_client_id uuid references public.clients(id) on delete set null,
    created_by uuid references auth.users(id) on delete set null,
    archived_at timestamptz,
    completed_at timestamptz,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create unique index if not exists relationship_onboarding_sessions_one_active
on public.relationship_onboarding_sessions(workspace_id, relationship_id)
where status = 'active';

create index if not exists relationship_onboarding_sessions_relationship_idx
on public.relationship_onboarding_sessions(relationship_id, created_at desc);

create table if not exists public.relationship_onboarding_modules (
    workspace_id uuid not null references public.workspaces(id) on delete cascade,
    relationship_id uuid not null references public.relationships(id) on delete cascade,
    module_key text not null,
    created_at timestamptz not null default now(),
    primary key (relationship_id, module_key)
);

create index if not exists relationship_onboarding_modules_workspace_idx
on public.relationship_onboarding_modules(workspace_id, module_key);

create table if not exists public.relationship_services (
    workspace_id uuid not null references public.workspaces(id) on delete cascade,
    relationship_id uuid not null references public.relationships(id) on delete cascade,
    service_key text not null,
    due_date date,
    created_at timestamptz not null default now(),
    primary key (relationship_id, service_key)
);

create index if not exists relationship_services_workspace_idx
on public.relationship_services(workspace_id, service_key);

drop trigger if exists relationship_onboarding_sessions_updated_at on public.relationship_onboarding_sessions;
create trigger relationship_onboarding_sessions_updated_at
before update on public.relationship_onboarding_sessions
for each row execute function public.set_updated_at();

insert into public.relationship_onboarding_sessions (
    workspace_id,
    relationship_id,
    session_token,
    status,
    is_test,
    project_timeframe_days,
    legacy_client_id,
    created_by,
    archived_at,
    completed_at,
    created_at,
    updated_at
)
with legacy_sessions as (
    select
        c.*,
        r.id as canonical_relationship_id,
        row_number() over (
            partition by r.id
            order by (c.archived_at is null) desc, c.created_at desc
        ) as relationship_session_rank
    from public.clients c
    join public.relationships r
      on r.workspace_id = c.workspace_id
     and (r.client_id = c.id or c.relationship_id = r.id)
    where c.session_token is not null
)
select
    c.workspace_id,
    c.canonical_relationship_id,
    c.session_token,
    case when c.archived_at is not null or c.relationship_session_rank > 1 then 'archived' else 'active' end,
    coalesce(c.is_test, false),
    c.project_timeframe_days,
    c.id,
    c.created_by,
    case when c.archived_at is not null or c.relationship_session_rank > 1 then coalesce(c.archived_at, c.created_at) else null end,
    case when c.archived_at is not null then c.archived_at else null end,
    c.created_at,
    c.created_at
from legacy_sessions c
on conflict (session_token) do update set
    relationship_id = excluded.relationship_id,
    status = excluded.status,
    is_test = excluded.is_test,
    project_timeframe_days = excluded.project_timeframe_days,
    legacy_client_id = excluded.legacy_client_id,
    archived_at = excluded.archived_at,
    completed_at = excluded.completed_at,
    updated_at = greatest(public.relationship_onboarding_sessions.updated_at, excluded.updated_at);

insert into public.relationship_onboarding_modules (
    workspace_id,
    relationship_id,
    module_key,
    created_at
)
select distinct
    cm.workspace_id,
    cm.relationship_id,
    cm.module_key,
    min(cm.created_at) over (partition by cm.relationship_id, cm.module_key)
from public.client_modules cm
where cm.relationship_id is not null
on conflict (relationship_id, module_key) do nothing;

insert into public.relationship_services (
    workspace_id,
    relationship_id,
    service_key,
    due_date,
    created_at
)
select distinct
    cs.workspace_id,
    cs.relationship_id,
    cs.service_key,
    cs.due_date,
    min(cs.created_at) over (partition by cs.relationship_id, cs.service_key)
from public.client_services cs
where cs.relationship_id is not null
on conflict (relationship_id, service_key) do nothing;

insert into public.work_items (
    workspace_id,
    title,
    description,
    lifecycle_phase,
    status,
    priority,
    is_key_task,
    native_kind,
    native_key,
    native_href,
    sort_order,
    metadata,
    created_by,
    created_at,
    updated_at
)
select
    s.workspace_id,
    initcap(replace(cp.step_key, '-', ' ')),
    'Generated from legacy onboarding progress.',
    'onboarding',
    'done',
    3,
    true,
    'onboarding_step',
    s.id::text || ':' || cp.step_key,
    null,
    100,
    jsonb_build_object(
        'session_id', s.id,
        'relationship_id', s.relationship_id,
        'step_key', cp.step_key,
        'legacy_client_progress_id', cp.id,
        'legacy_client_id', cp.client_id
    ),
    null,
    coalesce(cp.created_at, s.created_at),
    coalesce(cp.completed_at, cp.created_at, s.updated_at)
from public.client_progress cp
join public.relationship_onboarding_sessions s
  on s.legacy_client_id = cp.client_id
where cp.relationship_id is not null
on conflict (workspace_id, native_kind, native_key)
where native_kind is not null and native_key is not null
do update set
    status = 'done',
    actual_completed_at = coalesce(public.work_items.actual_completed_at, excluded.updated_at),
    metadata = public.work_items.metadata || excluded.metadata,
    updated_at = greatest(public.work_items.updated_at, excluded.updated_at);

insert into public.work_items (
    workspace_id,
    title,
    description,
    lifecycle_phase,
    status,
    priority,
    is_key_task,
    native_kind,
    native_key,
    native_href,
    sort_order,
    metadata,
    created_by,
    created_at,
    updated_at
)
select
    s.workspace_id,
    initcap(replace(r.step_key, '-', ' ')),
    'Generated from legacy onboarding submission.',
    'onboarding',
    'done',
    3,
    true,
    'onboarding_step',
    s.id::text || ':' || r.step_key,
    null,
    100,
    jsonb_build_object(
        'session_id', s.id,
        'relationship_id', s.relationship_id,
        'step_key', r.step_key,
        'legacy_client_form_response_id', r.id,
        'legacy_client_id', r.client_id
    ),
    null,
    coalesce(r.created_at, s.created_at),
    coalesce(r.updated_at, r.created_at, s.updated_at)
from public.client_form_responses r
join public.relationship_onboarding_sessions s
  on s.legacy_client_id = r.client_id
where r.relationship_id is not null
on conflict (workspace_id, native_kind, native_key)
where native_kind is not null and native_key is not null
do update set
    metadata = public.work_items.metadata || excluded.metadata,
    updated_at = greatest(public.work_items.updated_at, excluded.updated_at);

insert into public.work_item_relationships (
    work_item_id,
    relationship_id,
    workspace_id
)
select
    wi.id,
    s.relationship_id,
    s.workspace_id
from public.relationship_onboarding_sessions s
join public.work_items wi
  on wi.workspace_id = s.workspace_id
 and wi.native_kind = 'onboarding_step'
 and wi.native_key like s.id::text || ':%'
on conflict (work_item_id, relationship_id) do nothing;

insert into public.assets (
    workspace_id,
    title,
    description,
    asset_kind,
    source_kind,
    native_kind,
    native_key,
    metadata,
    created_at,
    updated_at
)
select
    r.workspace_id,
    initcap(replace(r.step_key, '-', ' ')) || ' submission',
    'Onboarding form submission.',
    'form_submission',
    'onboarding_submission',
    'onboarding_form_submission',
    s.id::text || ':' || r.step_key || ':submission',
    jsonb_build_object(
        'session_id', s.id,
        'relationship_id', s.relationship_id,
        'step_key', r.step_key,
        'response', r.response,
        'legacy_client_form_response_id', r.id,
        'legacy_client_id', r.client_id
    ),
    r.created_at,
    r.updated_at
from public.client_form_responses r
join public.relationship_onboarding_sessions s
  on s.legacy_client_id = r.client_id
where r.relationship_id is not null
on conflict (workspace_id, native_kind, native_key)
where native_kind is not null and native_key is not null
do update set
    metadata = public.assets.metadata || excluded.metadata,
    updated_at = excluded.updated_at;

insert into public.assets (
    workspace_id,
    title,
    description,
    asset_kind,
    source_kind,
    storage_path,
    content_type,
    file_size,
    native_kind,
    native_key,
    metadata,
    created_at,
    updated_at
)
select
    r.workspace_id,
    coalesce(upload.value->>'name', 'Onboarding upload'),
    'Onboarding uploaded file.',
    case
        when coalesce(upload.value->>'type', '') like 'image/%' then 'media'
        when coalesce(upload.value->>'type', '') like 'video/%' then 'media'
        when coalesce(upload.value->>'type', '') like 'audio/%' then 'media'
        when coalesce(upload.value->>'type', '') like '%pdf%' then 'document'
        when coalesce(upload.value->>'type', '') like '%document%' then 'document'
        when coalesce(upload.value->>'type', '') like '%spreadsheet%' then 'document'
        when coalesce(upload.value->>'type', '') like '%presentation%' then 'document'
        else 'file'
    end,
    'onboarding_submission',
    upload.value->>'path',
    nullif(upload.value->>'type', ''),
    nullif(upload.value->>'size', '')::bigint,
    'onboarding_upload',
    s.id::text || ':' || r.step_key || ':upload:' || (upload.value->>'path'),
    jsonb_build_object(
        'session_id', s.id,
        'relationship_id', s.relationship_id,
        'step_key', r.step_key,
        'field_name', field.key,
        'provider', coalesce(upload.value->>'provider', 'r2'),
        'legacy_client_form_response_id', r.id,
        'legacy_client_id', r.client_id
    ),
    r.created_at,
    r.updated_at
from public.client_form_responses r
join public.relationship_onboarding_sessions s
  on s.legacy_client_id = r.client_id
cross join lateral jsonb_each(r.response) as field(key, value)
cross join lateral jsonb_array_elements(
    case when jsonb_typeof(field.value) = 'array' then field.value else '[]'::jsonb end
) as upload(value)
where r.relationship_id is not null
  and upload.value ? 'path'
on conflict (workspace_id, native_kind, native_key)
where native_kind is not null and native_key is not null
do update set
    title = excluded.title,
    storage_path = excluded.storage_path,
    content_type = excluded.content_type,
    file_size = excluded.file_size,
    metadata = public.assets.metadata || excluded.metadata,
    updated_at = excluded.updated_at;

insert into public.asset_relationships (
    asset_id,
    relationship_id,
    workspace_id
)
select
    a.id,
    s.relationship_id,
    s.workspace_id
from public.relationship_onboarding_sessions s
join public.assets a
  on a.workspace_id = s.workspace_id
and a.native_kind = 'onboarding_form_submission'
 and a.native_key like s.id::text || ':%:submission'
on conflict (asset_id, relationship_id) do nothing;

insert into public.asset_relationships (
    asset_id,
    relationship_id,
    workspace_id
)
select
    a.id,
    s.relationship_id,
    s.workspace_id
from public.relationship_onboarding_sessions s
join public.assets a
  on a.workspace_id = s.workspace_id
 and a.native_kind = 'onboarding_upload'
 and a.native_key like s.id::text || ':%:upload:%'
on conflict (asset_id, relationship_id) do nothing;

insert into public.asset_work_items (
    asset_id,
    work_item_id,
    workspace_id
)
select
    a.id,
    wi.id,
    a.workspace_id
from public.assets a
join public.work_items wi
  on wi.workspace_id = a.workspace_id
 and wi.native_kind = 'onboarding_step'
 and wi.native_key = split_part(a.native_key, ':', 1) || ':' || split_part(a.native_key, ':', 2)
where a.native_kind = 'onboarding_form_submission'
on conflict (asset_id, work_item_id) do nothing;

insert into public.asset_work_items (
    asset_id,
    work_item_id,
    workspace_id
)
select
    a.id,
    wi.id,
    a.workspace_id
from public.assets a
join public.work_items wi
  on wi.workspace_id = a.workspace_id
 and wi.native_kind = 'onboarding_step'
 and wi.native_key = split_part(a.native_key, ':', 1) || ':' || split_part(a.native_key, ':', 2)
where a.native_kind = 'onboarding_upload'
on conflict (asset_id, work_item_id) do nothing;

alter table public.relationship_onboarding_sessions enable row level security;
alter table public.relationship_onboarding_modules enable row level security;
alter table public.relationship_services enable row level security;

drop policy if exists workspace_members_can_read_relationship_onboarding_sessions on public.relationship_onboarding_sessions;
create policy workspace_members_can_read_relationship_onboarding_sessions
on public.relationship_onboarding_sessions
for select
using (public.is_workspace_member(workspace_id));

drop policy if exists workspace_admins_can_manage_relationship_onboarding_sessions on public.relationship_onboarding_sessions;
create policy workspace_admins_can_manage_relationship_onboarding_sessions
on public.relationship_onboarding_sessions
for all
using (public.is_workspace_member(workspace_id, array['owner','admin']))
with check (public.is_workspace_member(workspace_id, array['owner','admin']));

drop policy if exists workspace_members_can_read_relationship_onboarding_modules on public.relationship_onboarding_modules;
create policy workspace_members_can_read_relationship_onboarding_modules
on public.relationship_onboarding_modules
for select
using (public.is_workspace_member(workspace_id));

drop policy if exists workspace_admins_can_manage_relationship_onboarding_modules on public.relationship_onboarding_modules;
create policy workspace_admins_can_manage_relationship_onboarding_modules
on public.relationship_onboarding_modules
for all
using (public.is_workspace_member(workspace_id, array['owner','admin']))
with check (public.is_workspace_member(workspace_id, array['owner','admin']));

drop policy if exists workspace_members_can_read_relationship_services on public.relationship_services;
create policy workspace_members_can_read_relationship_services
on public.relationship_services
for select
using (public.is_workspace_member(workspace_id));

drop policy if exists workspace_admins_can_manage_relationship_services on public.relationship_services;
create policy workspace_admins_can_manage_relationship_services
on public.relationship_services
for all
using (public.is_workspace_member(workspace_id, array['owner','admin']))
with check (public.is_workspace_member(workspace_id, array['owner','admin']));
