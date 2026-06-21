create table if not exists public.workspaces (
    id uuid primary key default gen_random_uuid(),
    name text not null,
    slug text not null unique check (slug ~ '^[a-z0-9](?:[a-z0-9-]{1,48}[a-z0-9])?$'),
    status text not null default 'active' check (status in ('active', 'suspended')),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create table if not exists public.workspace_memberships (
    workspace_id uuid not null references public.workspaces(id) on delete cascade,
    user_id uuid not null references auth.users(id) on delete cascade,
    role text not null check (role in ('owner', 'admin', 'member')),
    created_at timestamptz not null default now(),
    primary key (workspace_id, user_id)
);

create table if not exists public.workspace_integrations (
    workspace_id uuid not null references public.workspaces(id) on delete cascade,
    provider text not null check (provider in ('stripe', 'meta_whatsapp', 'clickup')),
    enabled boolean not null default false,
    mode text not null default 'disabled' check (mode in ('disabled', 'platform_legacy', 'connected')),
    connected_account_id text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    primary key (workspace_id, provider),
    check ((mode = 'connected') = (connected_account_id is not null))
);

insert into public.workspaces (name, slug)
values ('ScaylUp', 'scaylup')
on conflict (slug) do nothing;

alter table public.clients add column if not exists workspace_id uuid references public.workspaces(id);
alter table public.client_progress add column if not exists workspace_id uuid references public.workspaces(id);
alter table public.client_modules add column if not exists workspace_id uuid references public.workspaces(id);
alter table public.client_notes add column if not exists workspace_id uuid references public.workspaces(id);
alter table public.client_activity add column if not exists workspace_id uuid references public.workspaces(id);
alter table public.client_form_responses add column if not exists workspace_id uuid references public.workspaces(id);
alter table public.client_services add column if not exists workspace_id uuid references public.workspaces(id);
alter table public.client_communication_channels add column if not exists workspace_id uuid references public.workspaces(id);
alter table public.client_messages add column if not exists workspace_id uuid references public.workspaces(id);
alter table public.client_clickup_items add column if not exists workspace_id uuid references public.workspaces(id);
alter table public.client_sales add column if not exists workspace_id uuid references public.workspaces(id);
alter table public.stripe_events add column if not exists workspace_id uuid references public.workspaces(id);

do $$
declare scaylup_id uuid;
begin
    select id into scaylup_id from public.workspaces where slug = 'scaylup';
    update public.clients set workspace_id = scaylup_id where workspace_id is null;
    update public.client_progress p set workspace_id = c.workspace_id from public.clients c where p.client_id = c.id and p.workspace_id is null;
    update public.client_modules m set workspace_id = c.workspace_id from public.clients c where m.client_id = c.id and m.workspace_id is null;
    update public.client_notes n set workspace_id = c.workspace_id from public.clients c where n.client_id = c.id and n.workspace_id is null;
    update public.client_activity a set workspace_id = c.workspace_id from public.clients c where a.client_id = c.id and a.workspace_id is null;
    update public.client_form_responses r set workspace_id = c.workspace_id from public.clients c where r.client_id = c.id and r.workspace_id is null;
    update public.client_services s set workspace_id = c.workspace_id from public.clients c where s.client_id = c.id and s.workspace_id is null;
    update public.client_communication_channels ch set workspace_id = c.workspace_id from public.clients c where ch.client_id = c.id and ch.workspace_id is null;
    update public.client_messages m set workspace_id = c.workspace_id from public.clients c where m.client_id = c.id and m.workspace_id is null;
    -- Historical unmatched provider messages have no client_id. They belong to
    -- the original platform workspace until provider connections become
    -- workspace-specific.
    update public.client_messages set workspace_id = scaylup_id where workspace_id is null;
    update public.client_clickup_items i set workspace_id = c.workspace_id from public.clients c where i.client_id = c.id and i.workspace_id is null;
    update public.client_sales s set workspace_id = coalesce(c.workspace_id, scaylup_id) from public.clients c where s.client_id = c.id and s.workspace_id is null;
    update public.client_sales set workspace_id = scaylup_id where workspace_id is null;
    update public.stripe_events set workspace_id = scaylup_id where workspace_id is null;
end $$;

alter table public.clients alter column workspace_id set not null;
alter table public.client_progress alter column workspace_id set not null;
alter table public.client_modules alter column workspace_id set not null;
alter table public.client_notes alter column workspace_id set not null;
alter table public.client_activity alter column workspace_id set not null;
alter table public.client_form_responses alter column workspace_id set not null;
alter table public.client_services alter column workspace_id set not null;
alter table public.client_communication_channels alter column workspace_id set not null;
alter table public.client_messages alter column workspace_id set not null;
alter table public.client_clickup_items alter column workspace_id set not null;
alter table public.client_sales alter column workspace_id set not null;
alter table public.stripe_events alter column workspace_id set not null;

create or replace function public.assign_workspace_id()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
    if new.workspace_id is not null then return new; end if;
    if tg_table_name = 'clients' then
        select id into new.workspace_id from public.workspaces where slug = 'scaylup';
    elsif tg_table_name in ('client_progress','client_modules','client_notes','client_activity','client_form_responses','client_services','client_communication_channels','client_messages','client_clickup_items','client_sales') and new.client_id is not null then
        select workspace_id into new.workspace_id from public.clients where id = new.client_id;
    else
        select id into new.workspace_id from public.workspaces where slug = 'scaylup';
    end if;
    return new;
end;
$$;

do $$
declare table_name text;
begin
    foreach table_name in array array['clients','client_progress','client_modules','client_notes','client_activity','client_form_responses','client_services','client_communication_channels','client_messages','client_clickup_items','client_sales','stripe_events'] loop
        execute format('drop trigger if exists assign_workspace_id_before_insert on public.%I', table_name);
        execute format('create trigger assign_workspace_id_before_insert before insert on public.%I for each row execute procedure public.assign_workspace_id()', table_name);
    end loop;
end $$;

create index if not exists clients_workspace_id_idx on public.clients(workspace_id);
create index if not exists client_sales_workspace_id_idx on public.client_sales(workspace_id);
create index if not exists workspace_memberships_user_id_idx on public.workspace_memberships(user_id);

insert into public.workspace_integrations (workspace_id, provider, enabled, mode)
select id, provider, true, 'platform_legacy'
from public.workspaces cross join (values ('stripe'), ('meta_whatsapp'), ('clickup')) as providers(provider)
where slug = 'scaylup'
on conflict (workspace_id, provider) do update set enabled = excluded.enabled, mode = excluded.mode;

create or replace function public.create_workspace_for_new_owner()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare requested_name text := new.raw_user_meta_data ->> 'business_name';
declare requested_slug text := new.raw_user_meta_data ->> 'workspace_slug';
declare new_workspace_id uuid;
begin
    if requested_name is null or requested_slug is null then return new; end if;
    insert into public.workspaces(name, slug) values (requested_name, requested_slug)
    returning id into new_workspace_id;
    insert into public.workspace_memberships(workspace_id, user_id, role)
    values (new_workspace_id, new.id, 'owner');
    return new;
end;
$$;

drop trigger if exists on_auth_user_created_workspace on auth.users;
create trigger on_auth_user_created_workspace
after insert on auth.users
for each row execute procedure public.create_workspace_for_new_owner();

create or replace function public.is_workspace_member(target_workspace uuid, allowed_roles text[] default array['owner','admin','member'])
returns boolean language sql stable security definer set search_path = public
as $$
    select exists (
        select 1 from public.workspace_memberships
        where workspace_id = target_workspace and user_id = auth.uid() and role = any(allowed_roles)
    );
$$;

alter table public.workspaces enable row level security;
alter table public.workspace_memberships enable row level security;

do $$
declare table_name text;
begin
    foreach table_name in array array['clients','client_progress','client_modules','client_notes','client_activity','client_form_responses','client_services','client_communication_channels','client_messages','client_clickup_items','client_sales','stripe_events'] loop
        execute format('alter table public.%I enable row level security', table_name);
        execute format('create policy %I on public.%I for select using (public.is_workspace_member(workspace_id))', 'workspace_members_can_read_' || table_name, table_name);
        execute format('create policy %I on public.%I for all using (public.is_workspace_member(workspace_id, array[''owner'',''admin''])) with check (public.is_workspace_member(workspace_id, array[''owner'',''admin'']))', 'workspace_admins_can_manage_' || table_name, table_name);
    end loop;
end $$;

create policy "members can view their workspaces" on public.workspaces for select using (public.is_workspace_member(id));
create policy "members can view workspace memberships" on public.workspace_memberships for select using (public.is_workspace_member(workspace_id));
create policy "members can view workspace clients" on public.clients for select using (public.is_workspace_member(workspace_id));
create policy "admins can manage workspace clients" on public.clients for all using (public.is_workspace_member(workspace_id, array['owner','admin'])) with check (public.is_workspace_member(workspace_id, array['owner','admin']));
