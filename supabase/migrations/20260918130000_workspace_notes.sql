create table if not exists public.notes (
    id uuid primary key default gen_random_uuid(),
    workspace_id uuid not null references public.workspaces(id) on delete cascade,
    name text not null check (char_length(btrim(name)) between 1 and 160),
    description text not null check (char_length(btrim(description)) between 1 and 20000),
    created_by uuid references auth.users(id) on delete set null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create table if not exists public.note_relationships (
    note_id uuid not null references public.notes(id) on delete cascade,
    relationship_id uuid not null references public.relationships(id) on delete cascade,
    workspace_id uuid not null references public.workspaces(id) on delete cascade,
    created_at timestamptz not null default now(),
    primary key (note_id, relationship_id)
);

create table if not exists public.note_assets (
    note_id uuid not null references public.notes(id) on delete cascade,
    asset_id uuid not null references public.assets(id) on delete cascade,
    workspace_id uuid not null references public.workspaces(id) on delete cascade,
    created_at timestamptz not null default now(),
    primary key (note_id, asset_id)
);

create index if not exists notes_workspace_updated_idx
on public.notes(workspace_id, updated_at desc, id desc);

create index if not exists note_relationships_relationship_idx
on public.note_relationships(relationship_id, created_at desc);

create index if not exists note_assets_asset_idx
on public.note_assets(asset_id, created_at desc);

create or replace function public.enforce_note_link_workspace()
returns trigger
language plpgsql
set search_path = public
as $$
begin
    if not exists (
        select 1 from public.notes note
        where note.id = new.note_id and note.workspace_id = new.workspace_id
    ) then
        raise exception 'Note does not belong to the link workspace';
    end if;
    if tg_table_name = 'note_relationships' and not exists (
        select 1 from public.relationships relationship
        where relationship.id = new.relationship_id and relationship.workspace_id = new.workspace_id
    ) then
        raise exception 'Relationship does not belong to the link workspace';
    end if;
    if tg_table_name = 'note_assets' and not exists (
        select 1 from public.assets asset
        where asset.id = new.asset_id and asset.workspace_id = new.workspace_id
    ) then
        raise exception 'Asset does not belong to the link workspace';
    end if;
    return new;
end;
$$;

drop trigger if exists enforce_note_relationship_workspace on public.note_relationships;
create trigger enforce_note_relationship_workspace
before insert or update on public.note_relationships
for each row execute function public.enforce_note_link_workspace();

drop trigger if exists enforce_note_asset_workspace on public.note_assets;
create trigger enforce_note_asset_workspace
before insert or update on public.note_assets
for each row execute function public.enforce_note_link_workspace();

drop trigger if exists notes_updated_at on public.notes;
create trigger notes_updated_at
before update on public.notes
for each row execute function public.set_updated_at();

alter table public.notes enable row level security;
alter table public.note_relationships enable row level security;
alter table public.note_assets enable row level security;

drop policy if exists workspace_admins_can_manage_notes on public.notes;
create policy workspace_admins_can_manage_notes
on public.notes
for all
using (public.is_workspace_member(workspace_id, array['owner','admin']))
with check (public.is_workspace_member(workspace_id, array['owner','admin']));

drop policy if exists workspace_admins_can_manage_note_relationships on public.note_relationships;
create policy workspace_admins_can_manage_note_relationships
on public.note_relationships
for all
using (public.is_workspace_member(workspace_id, array['owner','admin']))
with check (public.is_workspace_member(workspace_id, array['owner','admin']));

drop policy if exists workspace_admins_can_manage_note_assets on public.note_assets;
create policy workspace_admins_can_manage_note_assets
on public.note_assets
for all
using (public.is_workspace_member(workspace_id, array['owner','admin']))
with check (public.is_workspace_member(workspace_id, array['owner','admin']));
