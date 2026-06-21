alter table public.workspace_integrations
    add column if not exists config_encrypted text,
    add column if not exists config_hint jsonb not null default '{}'::jsonb,
    add column if not exists configured_at timestamptz,
    add column if not exists configured_by uuid references auth.users(id) on delete set null;

-- ScaylUp is the only workspace allowed to continue using the existing Vercel
-- credentials. All other workspaces must be manually connected in Settings.
update public.workspace_integrations integration
set enabled = case when workspace.slug = 'scaylup' then true else false end,
    mode = case when workspace.slug = 'scaylup' then 'platform_legacy' else 'disabled' end,
    connected_account_id = null
from public.workspaces workspace
where workspace.id = integration.workspace_id;

create or replace function public.create_disabled_workspace_integrations()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
    insert into public.workspace_integrations (workspace_id, provider, enabled, mode)
    values
        (new.id, 'stripe', false, 'disabled'),
        (new.id, 'meta_whatsapp', false, 'disabled'),
        (new.id, 'clickup', false, 'disabled')
    on conflict (workspace_id, provider) do nothing;
    return new;
end;
$$;

drop trigger if exists create_disabled_workspace_integrations_after_insert on public.workspaces;
create trigger create_disabled_workspace_integrations_after_insert
after insert on public.workspaces
for each row execute procedure public.create_disabled_workspace_integrations();
