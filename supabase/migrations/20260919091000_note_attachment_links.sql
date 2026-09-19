-- Notes can accompany work items and other notes without duplicating content.
create table if not exists public.note_work_items (
    workspace_id uuid not null references public.workspaces(id) on delete cascade,
    note_id uuid not null references public.notes(id) on delete cascade,
    work_item_id uuid not null references public.work_items(id) on delete cascade,
    created_at timestamptz not null default now(),
    primary key (note_id, work_item_id)
);
create index if not exists note_work_items_work_item_idx on public.note_work_items(workspace_id, work_item_id, created_at desc);

create table if not exists public.note_notes (
    workspace_id uuid not null references public.workspaces(id) on delete cascade,
    parent_note_id uuid not null references public.notes(id) on delete cascade,
    attached_note_id uuid not null references public.notes(id) on delete cascade,
    created_at timestamptz not null default now(),
    primary key (parent_note_id, attached_note_id),
    check (parent_note_id <> attached_note_id)
);
create index if not exists note_notes_parent_idx on public.note_notes(workspace_id, parent_note_id, created_at desc);

create or replace function public.check_note_attachment_workspace()
returns trigger language plpgsql set search_path = public as $$
begin
    if not exists (select 1 from public.notes where workspace_id = new.workspace_id and id = new.note_id) then
        raise exception 'Note does not belong to workspace';
    end if;
    if not exists (select 1 from public.work_items where workspace_id = new.workspace_id and id = new.work_item_id) then
        raise exception 'Work item does not belong to workspace';
    end if;
    return new;
end;
$$;
create trigger note_work_items_workspace before insert or update on public.note_work_items
for each row execute function public.check_note_attachment_workspace();

create or replace function public.check_note_note_workspace()
returns trigger language plpgsql set search_path = public as $$
begin
    if not exists (select 1 from public.notes where workspace_id = new.workspace_id and id = new.parent_note_id)
       or not exists (select 1 from public.notes where workspace_id = new.workspace_id and id = new.attached_note_id) then
        raise exception 'Notes do not belong to workspace';
    end if;
    return new;
end;
$$;
create trigger note_notes_workspace before insert or update on public.note_notes
for each row execute function public.check_note_note_workspace();

alter table public.note_work_items enable row level security;
alter table public.note_notes enable row level security;
revoke all on public.note_work_items, public.note_notes from public, anon, authenticated;
grant select, insert on public.note_work_items, public.note_notes to service_role;
