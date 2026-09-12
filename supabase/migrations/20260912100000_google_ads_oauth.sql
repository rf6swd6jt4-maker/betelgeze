-- Short-lived, server-only Google sign-in attempts. One current attempt per relationship.
create table public.google_ads_oauth_attempts (
    workspace_id uuid not null references public.workspaces(id) on delete cascade,
    relationship_id uuid not null,
    state_hash text not null unique check (length(state_hash) = 64),
    browser_hash text,
    phase text not null check (phase in ('prepared','authorizing','exchanging','ready','connecting','done','failed')),
    context_encrypted text not null,
    credential_encrypted text,
    choices jsonb not null default '[]'::jsonb check (jsonb_typeof(choices) = 'array' and jsonb_array_length(choices) <= 100),
    limited boolean not null default false,
    result jsonb,
    created_at timestamptz not null default now(),
    expires_at timestamptz not null,
    primary key (workspace_id, relationship_id),
    foreign key (workspace_id, relationship_id) references public.relationships(workspace_id, id) on delete cascade
);
alter table public.google_ads_oauth_attempts enable row level security;
revoke all on public.google_ads_oauth_attempts from public, anon, authenticated;
grant all on public.google_ads_oauth_attempts to service_role;
create index google_ads_oauth_expiry on public.google_ads_oauth_attempts(expires_at);

create function public.prepare_google_ads_oauth(p_workspace uuid, p_relationship uuid, p_state_hash text, p_context text)
returns void language plpgsql security definer set search_path = public as $$
begin
    if current_user <> 'postgres' and current_user <> 'service_role' then raise exception 'Not authorised'; end if;
    perform pg_advisory_xact_lock(hashtextextended('google-ads-oauth:' || p_workspace::text || ':' || p_relationship::text, 0));
    if exists (select 1 from google_ads_oauth_attempts where workspace_id = p_workspace and relationship_id = p_relationship and (created_at > now() - interval '10 seconds' or (phase = 'connecting' and expires_at > now()))) then
        raise exception 'A Google connection is already starting. Wait a moment before trying again.';
    end if;
    delete from google_ads_oauth_attempts where state_hash in (select state_hash from google_ads_oauth_attempts where expires_at < now() order by expires_at limit 1000);
    insert into google_ads_oauth_attempts(workspace_id, relationship_id, state_hash, phase, context_encrypted, expires_at)
    values(p_workspace, p_relationship, p_state_hash, 'prepared', p_context, now() + interval '10 minutes')
    on conflict(workspace_id, relationship_id) do update set state_hash = excluded.state_hash, phase = excluded.phase, context_encrypted = excluded.context_encrypted, expires_at = excluded.expires_at, created_at = now(), browser_hash = null, credential_encrypted = null, choices = '[]', limited = false, result = null;
end $$;
revoke all on function public.prepare_google_ads_oauth(uuid,uuid,text,text) from public, anon, authenticated;
grant execute on function public.prepare_google_ads_oauth(uuid,uuid,text,text) to service_role;
