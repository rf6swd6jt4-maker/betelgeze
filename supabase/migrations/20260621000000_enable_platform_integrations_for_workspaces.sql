-- Until each workspace has its own provider connections, every workspace uses
-- the established ScaylUp Stripe, Meta WhatsApp, and ClickUp configuration.
insert into public.workspace_integrations (workspace_id, provider, enabled, mode)
select workspace.id, provider, true, 'platform_legacy'
from public.workspaces workspace
cross join (values ('stripe'), ('meta_whatsapp'), ('clickup')) as providers(provider)
on conflict (workspace_id, provider)
do update set enabled = excluded.enabled, mode = excluded.mode;

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
    insert into public.workspace_integrations (workspace_id, provider, enabled, mode)
    values
        (new_workspace_id, 'stripe', true, 'platform_legacy'),
        (new_workspace_id, 'meta_whatsapp', true, 'platform_legacy'),
        (new_workspace_id, 'clickup', true, 'platform_legacy');
    return new;
end;
$$;
