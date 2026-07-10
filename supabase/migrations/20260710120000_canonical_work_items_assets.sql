create table if not exists public.work_items (
    id uuid primary key default gen_random_uuid(),
    workspace_id uuid not null references public.workspaces(id) on delete cascade,
    title text not null,
    description text,
    lifecycle_phase text not null default 'lead' check (lifecycle_phase in ('lead', 'nurturing', 'potential_client', 'invoiced', 'onboarding', 'onboarding_complete', 'fulfilment', 'retention', 'completed_lost')),
    status text not null default 'todo' check (status in ('todo', 'doing', 'waiting', 'blocked', 'done', 'canceled')),
    priority integer not null default 3 check (priority between 1 and 5),
    is_key_task boolean not null default true,
    native_kind text,
    native_id uuid,
    native_href text,
    planned_start_date date,
    due_date date,
    actual_start_at timestamptz,
    actual_completed_at timestamptz,
    sort_order integer not null default 0,
    metadata jsonb not null default '{}'::jsonb,
    created_by uuid references auth.users(id) on delete set null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create table if not exists public.work_item_relationships (
    work_item_id uuid not null references public.work_items(id) on delete cascade,
    relationship_id uuid not null references public.relationships(id) on delete cascade,
    workspace_id uuid not null references public.workspaces(id) on delete cascade,
    created_at timestamptz not null default now(),
    primary key (work_item_id, relationship_id)
);

create table if not exists public.assets (
    id uuid primary key default gen_random_uuid(),
    workspace_id uuid not null references public.workspaces(id) on delete cascade,
    title text not null,
    description text,
    asset_kind text not null check (asset_kind in ('file', 'media', 'document', 'invoice', 'form_submission', 'message', 'lead_evidence', 'other')),
    source_kind text not null default 'upload' check (source_kind in ('upload', 'stripe_invoice', 'onboarding_submission', 'message', 'lead_evidence', 'legacy_note', 'system', 'other')),
    storage_path text,
    external_url text,
    content_type text,
    file_size bigint,
    native_kind text,
    native_id uuid,
    metadata jsonb not null default '{}'::jsonb,
    created_by uuid references auth.users(id) on delete set null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create table if not exists public.asset_relationships (
    asset_id uuid not null references public.assets(id) on delete cascade,
    relationship_id uuid not null references public.relationships(id) on delete cascade,
    workspace_id uuid not null references public.workspaces(id) on delete cascade,
    created_at timestamptz not null default now(),
    primary key (asset_id, relationship_id)
);

create table if not exists public.asset_work_items (
    asset_id uuid not null references public.assets(id) on delete cascade,
    work_item_id uuid not null references public.work_items(id) on delete cascade,
    workspace_id uuid not null references public.workspaces(id) on delete cascade,
    created_at timestamptz not null default now(),
    primary key (asset_id, work_item_id)
);

create index if not exists work_items_workspace_status_idx
on public.work_items(workspace_id, status, priority, due_date);

create index if not exists work_items_workspace_phase_idx
on public.work_items(workspace_id, lifecycle_phase, sort_order, created_at);

create unique index if not exists work_items_native_unique
on public.work_items(workspace_id, native_kind, native_id)
where native_kind is not null and native_id is not null;

create index if not exists work_item_relationships_relationship_idx
on public.work_item_relationships(relationship_id, created_at desc);

create index if not exists assets_workspace_kind_idx
on public.assets(workspace_id, asset_kind, created_at desc);

create unique index if not exists assets_native_unique
on public.assets(workspace_id, native_kind, native_id)
where native_kind is not null and native_id is not null;

create index if not exists asset_relationships_relationship_idx
on public.asset_relationships(relationship_id, created_at desc);

create index if not exists asset_work_items_work_item_idx
on public.asset_work_items(work_item_id, created_at desc);

drop trigger if exists work_items_updated_at on public.work_items;
create trigger work_items_updated_at
before update on public.work_items
for each row execute function public.set_updated_at();

drop trigger if exists assets_updated_at on public.assets;
create trigger assets_updated_at
before update on public.assets
for each row execute function public.set_updated_at();

insert into public.work_items (
    workspace_id,
    title,
    description,
    lifecycle_phase,
    status,
    priority,
    is_key_task,
    native_kind,
    native_id,
    native_href,
    planned_start_date,
    due_date,
    actual_start_at,
    actual_completed_at,
    sort_order,
    metadata,
    created_at,
    updated_at
)
select
    workspace_id,
    title,
    description,
    lifecycle_phase,
    status,
    priority,
    is_key_task,
    native_kind,
    native_id,
    native_href,
    planned_start_date,
    planned_end_date,
    actual_start_at,
    actual_completed_at,
    sort_order,
    metadata || jsonb_build_object('legacy_relationship_work_item_id', id),
    created_at,
    updated_at
from public.relationship_work_items
on conflict (workspace_id, native_kind, native_id)
where native_kind is not null and native_id is not null
do update set
    title = excluded.title,
    description = excluded.description,
    lifecycle_phase = excluded.lifecycle_phase,
    status = excluded.status,
    priority = excluded.priority,
    due_date = excluded.due_date,
    metadata = public.work_items.metadata || excluded.metadata,
    updated_at = now();

insert into public.work_item_relationships (work_item_id, relationship_id, workspace_id, created_at)
select
    wi.id,
    rwi.relationship_id,
    rwi.workspace_id,
    rwi.created_at
from public.relationship_work_items rwi
join public.work_items wi
    on wi.workspace_id = rwi.workspace_id
    and (
        (wi.native_kind = rwi.native_kind and wi.native_id = rwi.native_id and rwi.native_kind is not null and rwi.native_id is not null)
        or wi.metadata->>'legacy_relationship_work_item_id' = rwi.id::text
    )
on conflict do nothing;

insert into public.assets (
    workspace_id,
    title,
    description,
    asset_kind,
    source_kind,
    storage_path,
    external_url,
    native_kind,
    native_id,
    metadata,
    created_by,
    created_at,
    updated_at
)
select
    workspace_id,
    title,
    description,
    case
        when asset_type = 'file' then 'file'
        when asset_type = 'document' then 'document'
        when asset_type = 'invoice' then 'invoice'
        when asset_type = 'form_submission' then 'form_submission'
        when asset_type = 'message' then 'message'
        when asset_type = 'lead_evidence' then 'lead_evidence'
        else 'other'
    end,
    case
        when asset_type = 'invoice' then 'stripe_invoice'
        when asset_type = 'form_submission' then 'onboarding_submission'
        when asset_type = 'message' then 'message'
        when asset_type = 'lead_evidence' then 'lead_evidence'
        when asset_type = 'note' then 'legacy_note'
        else 'system'
    end,
    storage_path,
    external_url,
    native_kind,
    native_id,
    metadata || jsonb_build_object('legacy_relationship_asset_id', id, 'legacy_asset_type', asset_type),
    created_by,
    created_at,
    updated_at
from public.relationship_assets
on conflict (workspace_id, native_kind, native_id)
where native_kind is not null and native_id is not null
do update set
    title = excluded.title,
    description = excluded.description,
    asset_kind = excluded.asset_kind,
    source_kind = excluded.source_kind,
    storage_path = excluded.storage_path,
    external_url = excluded.external_url,
    metadata = public.assets.metadata || excluded.metadata,
    updated_at = now();

insert into public.asset_relationships (asset_id, relationship_id, workspace_id, created_at)
select
    a.id,
    ra.relationship_id,
    ra.workspace_id,
    ra.created_at
from public.relationship_assets ra
join public.assets a
    on a.workspace_id = ra.workspace_id
    and (
        (a.native_kind = ra.native_kind and a.native_id = ra.native_id and ra.native_kind is not null and ra.native_id is not null)
        or a.metadata->>'legacy_relationship_asset_id' = ra.id::text
    )
on conflict do nothing;

alter table public.work_items enable row level security;
alter table public.work_item_relationships enable row level security;
alter table public.assets enable row level security;
alter table public.asset_relationships enable row level security;
alter table public.asset_work_items enable row level security;

drop policy if exists workspace_members_can_read_work_items on public.work_items;
create policy workspace_members_can_read_work_items
on public.work_items
for select
using (public.is_workspace_member(workspace_id));

drop policy if exists workspace_admins_can_manage_work_items on public.work_items;
create policy workspace_admins_can_manage_work_items
on public.work_items
for all
using (public.is_workspace_member(workspace_id, array['owner','admin']))
with check (public.is_workspace_member(workspace_id, array['owner','admin']));

drop policy if exists workspace_members_can_read_work_item_relationships on public.work_item_relationships;
create policy workspace_members_can_read_work_item_relationships
on public.work_item_relationships
for select
using (public.is_workspace_member(workspace_id));

drop policy if exists workspace_admins_can_manage_work_item_relationships on public.work_item_relationships;
create policy workspace_admins_can_manage_work_item_relationships
on public.work_item_relationships
for all
using (public.is_workspace_member(workspace_id, array['owner','admin']))
with check (public.is_workspace_member(workspace_id, array['owner','admin']));

drop policy if exists workspace_members_can_read_assets on public.assets;
create policy workspace_members_can_read_assets
on public.assets
for select
using (public.is_workspace_member(workspace_id));

drop policy if exists workspace_admins_can_manage_assets on public.assets;
create policy workspace_admins_can_manage_assets
on public.assets
for all
using (public.is_workspace_member(workspace_id, array['owner','admin']))
with check (public.is_workspace_member(workspace_id, array['owner','admin']));

drop policy if exists workspace_members_can_read_asset_relationships on public.asset_relationships;
create policy workspace_members_can_read_asset_relationships
on public.asset_relationships
for select
using (public.is_workspace_member(workspace_id));

drop policy if exists workspace_admins_can_manage_asset_relationships on public.asset_relationships;
create policy workspace_admins_can_manage_asset_relationships
on public.asset_relationships
for all
using (public.is_workspace_member(workspace_id, array['owner','admin']))
with check (public.is_workspace_member(workspace_id, array['owner','admin']));

drop policy if exists workspace_members_can_read_asset_work_items on public.asset_work_items;
create policy workspace_members_can_read_asset_work_items
on public.asset_work_items
for select
using (public.is_workspace_member(workspace_id));

drop policy if exists workspace_admins_can_manage_asset_work_items on public.asset_work_items;
create policy workspace_admins_can_manage_asset_work_items
on public.asset_work_items
for all
using (public.is_workspace_member(workspace_id, array['owner','admin']))
with check (public.is_workspace_member(workspace_id, array['owner','admin']));
