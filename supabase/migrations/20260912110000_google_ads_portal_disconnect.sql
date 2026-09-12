-- Disconnect the relationship's BE connection, not the agency's Google manager link.
create function public.disconnect_google_ads_portal(p_token text, p_workspace_id uuid)
returns void language plpgsql security invoker set search_path = public as $$
declare
    target uuid;
    oauth public.google_ads_oauth_attempts%rowtype;
    connection public.relationship_google_ads_connections%rowtype;
begin
    target := public.google_ads_portal_relationship(p_token, p_workspace_id);
    perform pg_advisory_xact_lock(hashtextextended('google-ads-oauth:' || p_workspace_id::text || ':' || target::text, 0));
    perform pg_advisory_xact_lock(hashtextextended(p_workspace_id::text || ':' || target::text, 0));
    select * into oauth from public.google_ads_oauth_attempts where workspace_id = p_workspace_id and relationship_id = target for update;
    select * into connection from public.relationship_google_ads_connections where workspace_id = p_workspace_id and relationship_id = target for update;
    if (oauth.phase = 'connecting' and oauth.expires_at > now()) or (connection.attempt_id is not null and connection.attempt_started_at > now() - interval '2 minutes') then
        raise exception using errcode = 'P0001', message = 'A connection check is still running. Wait for it to finish, then disconnect.';
    end if;
    -- Invalidate open OAuth windows and remove report snapshots via the connection FK cascade.
    delete from public.google_ads_oauth_attempts where workspace_id = p_workspace_id and relationship_id = target;
    delete from public.relationship_google_ads_connections where workspace_id = p_workspace_id and relationship_id = target;
    -- Active onboarding must verify a connection again. Completed sessions retain their history.
    delete from public.onboarding_block_requirements requirement using public.relationship_onboarding_sessions session
    where requirement.workspace_id = p_workspace_id and requirement.session_id = session.id
      and session.workspace_id = p_workspace_id and session.relationship_id = target and session.status = 'active'
      and requirement.requirement_kind = 'google_ads_connected';
end;
$$;
revoke all on function public.disconnect_google_ads_portal(text,uuid) from public,anon,authenticated;
grant execute on function public.disconnect_google_ads_portal(text,uuid) to service_role;
