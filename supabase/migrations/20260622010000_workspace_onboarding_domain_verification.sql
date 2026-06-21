alter table public.workspaces
    add column if not exists custom_onboarding_domain_status text not null default 'none'
        check (custom_onboarding_domain_status in ('none', 'pending_dns', 'verified')),
    add column if not exists custom_onboarding_domain_records jsonb not null default '[]'::jsonb,
    add column if not exists custom_onboarding_domain_verified_at timestamptz;

update public.workspaces
set custom_onboarding_domain_status = case
        when custom_onboarding_domain is null then 'none'
        else 'pending_dns'
    end
where custom_onboarding_domain_status = 'none';

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
      and custom_onboarding_domain_status = 'verified'
      and lower(custom_onboarding_domain) = lower(requested_domain)
    limit 1;
$$;

revoke all on function public.resolve_workspace_onboarding_domain(text) from public;
grant execute on function public.resolve_workspace_onboarding_domain(text) to anon, authenticated;
