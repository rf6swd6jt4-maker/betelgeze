alter table public.workspaces
    add column if not exists custom_onboarding_domain text;

create unique index if not exists workspaces_custom_onboarding_domain_unique
    on public.workspaces (lower(custom_onboarding_domain))
    where custom_onboarding_domain is not null;

create or replace function public.resolve_workspace_onboarding_domain(requested_domain text)
returns table (workspace_slug text)
language sql
stable
security definer
set search_path = public
as $$
    select slug
    from public.workspaces
    where status = 'active'
      and lower(custom_onboarding_domain) = lower(requested_domain)
    limit 1;
$$;

revoke all on function public.resolve_workspace_onboarding_domain(text) from public;
grant execute on function public.resolve_workspace_onboarding_domain(text) to anon, authenticated;
