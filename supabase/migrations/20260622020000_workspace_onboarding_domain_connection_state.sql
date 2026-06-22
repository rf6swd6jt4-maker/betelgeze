alter table public.workspaces
    add column if not exists custom_onboarding_domain_error text;

drop function if exists public.resolve_workspace_onboarding_domain(text);

create or replace function public.resolve_workspace_onboarding_domain(requested_domain text)
returns table (workspace_slug text, domain_status text)
language sql
stable
security definer
set search_path = public
as $$
    select slug, custom_onboarding_domain_status
    from public.workspaces
    where status = 'active'
      and custom_onboarding_domain is not null
      and lower(custom_onboarding_domain) = lower(requested_domain)
    limit 1;
$$;

revoke all on function public.resolve_workspace_onboarding_domain(text) from public;
grant execute on function public.resolve_workspace_onboarding_domain(text) to anon, authenticated;
