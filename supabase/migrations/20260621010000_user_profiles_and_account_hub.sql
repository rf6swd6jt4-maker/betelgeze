create table if not exists public.user_profiles (
    user_id uuid primary key references auth.users(id) on delete cascade,
    username text not null unique check (username ~ '^[a-z0-9](?:[a-z0-9-]{1,28}[a-z0-9])?$'),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

insert into public.user_profiles (user_id, username)
select
    id,
    'user-' || left(id::text, 8)
from auth.users
on conflict (user_id) do nothing;

create or replace function public.create_workspace_for_new_owner()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare requested_name text := new.raw_user_meta_data ->> 'business_name';
declare requested_slug text := new.raw_user_meta_data ->> 'workspace_slug';
declare requested_username text := new.raw_user_meta_data ->> 'username';
declare new_workspace_id uuid;
begin
    insert into public.user_profiles(user_id, username)
    values (new.id, coalesce(requested_username, 'user-' || left(new.id::text, 8)));

    if requested_name is null or requested_slug is null then return new; end if;
    insert into public.workspaces(name, slug) values (requested_name, requested_slug)
    returning id into new_workspace_id;
    insert into public.workspace_memberships(workspace_id, user_id, role)
    values (new_workspace_id, new.id, 'owner');
    insert into public.workspace_integrations (workspace_id, provider, enabled, mode)
    values
        (new_workspace_id, 'stripe', true, 'platform_legacy'),
        (new_workspace_id, 'meta_whatsapp', true, 'platform_legacy'),
        (new_workspace_id, 'clickup', true, 'platform_legacy');
    return new;
end;
$$;

alter table public.user_profiles enable row level security;
create policy "users can view their profile" on public.user_profiles
for select using (user_id = auth.uid());
create policy "users can update their profile" on public.user_profiles
for update using (user_id = auth.uid()) with check (user_id = auth.uid());
