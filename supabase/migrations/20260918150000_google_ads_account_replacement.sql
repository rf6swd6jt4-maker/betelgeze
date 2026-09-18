-- Let a client replace a pending or connected account without agency support.
-- Provider cancellation remains outside the transaction; the application only
-- cancels a still-pending old invitation after the replacement request exists.
create or replace function public.begin_google_ads_onboarding(
    p_token text, p_block_id uuid, p_customer_id text, p_manager_id text, p_attempt_id uuid
) returns jsonb language plpgsql security invoker set search_path = public as $$
declare
    v_block public.relationship_onboarding_session_blocks%rowtype;
    v_connection public.relationship_google_ads_connections%rowtype;
    v_relationship_id uuid;
    v_previous_customer_id text;
    v_replaced boolean := false;
begin
    v_block := public.google_ads_onboarding_block(p_token, p_block_id);
    if p_customer_id is null or p_customer_id !~ '^[0-9]{10}$' or p_manager_id is null or p_manager_id !~ '^[0-9]{10}$' or p_customer_id = p_manager_id or p_attempt_id is null then
        raise exception using errcode = '22023', message = 'Enter the 10-digit customer ID of the account that runs your ads.';
    end if;
    if not exists (select 1 from public.workspace_integrations integration where integration.workspace_id = v_block.workspace_id and integration.provider = 'google_ads' and integration.enabled and integration.mode = 'connected' and integration.connected_account_id = p_manager_id) then
        raise exception using errcode = 'P0001', message = 'Your agency needs to reconnect its Google Ads manager account.';
    end if;
    select relationship_id into v_relationship_id from public.relationship_onboarding_sessions where id = v_block.session_id and workspace_id = v_block.workspace_id;
    perform pg_advisory_xact_lock(hashtextextended(v_block.workspace_id::text || ':' || v_relationship_id::text, 0));
    select * into v_connection from public.relationship_google_ads_connections where workspace_id = v_block.workspace_id and relationship_id = v_relationship_id for update;
    if v_connection.attempt_id is not null and v_connection.attempt_started_at > now() - interval '2 minutes' then
        raise exception using errcode = 'P0001', message = 'A connection check is already running. Wait a moment, then try again.';
    end if;
    if v_connection.updated_at > now() - interval '5 seconds' then raise exception using errcode = 'P0001', message = 'Wait a few seconds before checking again.'; end if;
    if v_connection.rate_window_started_at > now() - interval '1 hour' and v_connection.rate_window_count >= 60 then raise exception using errcode = 'P0001', message = 'Too many connection attempts. Please try again later.'; end if;
    if exists (select 1 from public.relationship_google_ads_connections where workspace_id = v_block.workspace_id and customer_id = p_customer_id and relationship_id <> v_relationship_id) then
        raise exception using errcode = 'P0001', message = 'This advertising account is assigned to another relationship. Contact your agency.';
    end if;
    v_previous_customer_id := v_connection.customer_id;
    v_replaced := v_connection.id is not null and (v_connection.customer_id is distinct from p_customer_id or v_connection.manager_customer_id is distinct from p_manager_id);
    insert into public.relationship_google_ads_connections (workspace_id, relationship_id, onboarding_session_id, source_session_block_id, manager_customer_id, customer_id, attempt_id, attempt_started_at, rate_window_count)
    values (v_block.workspace_id, v_relationship_id, v_block.session_id, v_block.id, p_manager_id, p_customer_id, p_attempt_id, now(), 1)
    on conflict (workspace_id, relationship_id) do update set
        onboarding_session_id = excluded.onboarding_session_id, source_session_block_id = excluded.source_session_block_id,
        customer_id = excluded.customer_id, manager_customer_id = excluded.manager_customer_id,
        status = case when relationship_google_ads_connections.customer_id is distinct from excluded.customer_id or relationship_google_ads_connections.manager_customer_id is distinct from excluded.manager_customer_id then 'needs_attention' else relationship_google_ads_connections.status end,
        account_name = case when relationship_google_ads_connections.customer_id = excluded.customer_id and relationship_google_ads_connections.manager_customer_id = excluded.manager_customer_id then relationship_google_ads_connections.account_name else null end,
        currency_code = case when relationship_google_ads_connections.customer_id = excluded.customer_id and relationship_google_ads_connections.manager_customer_id = excluded.manager_customer_id then relationship_google_ads_connections.currency_code else null end,
        time_zone = case when relationship_google_ads_connections.customer_id = excluded.customer_id and relationship_google_ads_connections.manager_customer_id = excluded.manager_customer_id then relationship_google_ads_connections.time_zone else null end,
        connected_at = case when relationship_google_ads_connections.customer_id = excluded.customer_id and relationship_google_ads_connections.manager_customer_id = excluded.manager_customer_id then relationship_google_ads_connections.connected_at else null end,
        last_verified_at = case when relationship_google_ads_connections.customer_id = excluded.customer_id and relationship_google_ads_connections.manager_customer_id = excluded.manager_customer_id then relationship_google_ads_connections.last_verified_at else null end,
        last_error = null, attempt_id = excluded.attempt_id, attempt_started_at = now(), updated_at = now(),
        rate_window_started_at = case when relationship_google_ads_connections.rate_window_started_at <= now() - interval '1 hour' then now() else relationship_google_ads_connections.rate_window_started_at end,
        rate_window_count = case when relationship_google_ads_connections.rate_window_started_at <= now() - interval '1 hour' then 1 else relationship_google_ads_connections.rate_window_count + 1 end
    returning * into v_connection;
    if v_replaced then
        delete from public.relationship_google_ads_reports where connection_id = v_connection.id;
        delete from public.onboarding_block_requirements where workspace_id = v_block.workspace_id and session_block_id = v_block.id and requirement_kind = 'google_ads_connected';
    end if;
    return jsonb_build_object('id', v_connection.id, 'previousCustomerId', case when v_replaced then v_previous_customer_id else null end);
exception when unique_violation then
    raise exception using errcode = 'P0001', message = 'This advertising account is assigned to another relationship. Contact your agency.';
end;
$$;

create or replace function public.begin_google_ads_portal(
    p_token text, p_workspace_id uuid, p_customer_id text, p_manager_id text, p_attempt_id uuid
) returns jsonb language plpgsql security invoker set search_path = public as $$
declare
    v_connection public.relationship_google_ads_connections%rowtype;
    v_relationship_id uuid;
    v_previous_customer_id text;
    v_replaced boolean := false;
begin
    v_relationship_id := public.google_ads_portal_relationship(p_token, p_workspace_id);
    if p_customer_id is null or p_customer_id !~ '^[0-9]{10}$' or p_manager_id is null or p_manager_id !~ '^[0-9]{10}$' or p_customer_id = p_manager_id or p_attempt_id is null then
        raise exception using errcode = '22023', message = 'Enter the 10-digit customer ID of the account that runs your ads.';
    end if;
    if not exists (select 1 from public.workspace_integrations integration where integration.workspace_id = p_workspace_id and integration.provider = 'google_ads' and integration.enabled and integration.mode = 'connected' and integration.connected_account_id = p_manager_id) then
        raise exception using errcode = 'P0001', message = 'Your agency needs to reconnect its Google Ads manager account.';
    end if;
    perform pg_advisory_xact_lock(hashtextextended(p_workspace_id::text || ':' || v_relationship_id::text, 0));
    select * into v_connection from public.relationship_google_ads_connections where workspace_id = p_workspace_id and relationship_id = v_relationship_id for update;
    if v_connection.attempt_id is not null and v_connection.attempt_started_at > now() - interval '2 minutes' then
        raise exception using errcode = 'P0001', message = 'A connection check is already running. Wait a moment, then try again.';
    end if;
    if v_connection.updated_at > now() - interval '5 seconds' then raise exception using errcode = 'P0001', message = 'Wait a few seconds before checking again.'; end if;
    if v_connection.rate_window_started_at > now() - interval '1 hour' and v_connection.rate_window_count >= 60 then raise exception using errcode = 'P0001', message = 'Too many connection attempts. Please try again later.'; end if;
    if exists (select 1 from public.relationship_google_ads_connections where workspace_id = p_workspace_id and customer_id = p_customer_id and relationship_id <> v_relationship_id) then
        raise exception using errcode = 'P0001', message = 'This advertising account is assigned to another relationship. Contact your agency.';
    end if;
    v_previous_customer_id := v_connection.customer_id;
    v_replaced := v_connection.id is not null and (v_connection.customer_id is distinct from p_customer_id or v_connection.manager_customer_id is distinct from p_manager_id);
    insert into public.relationship_google_ads_connections (workspace_id, relationship_id, onboarding_session_id, source_session_block_id, manager_customer_id, customer_id, attempt_id, attempt_started_at, rate_window_count)
    values (p_workspace_id, v_relationship_id, null, null, p_manager_id, p_customer_id, p_attempt_id, now(), 1)
    on conflict (workspace_id, relationship_id) do update set
        customer_id = excluded.customer_id, manager_customer_id = excluded.manager_customer_id,
        status = case when relationship_google_ads_connections.customer_id is distinct from excluded.customer_id or relationship_google_ads_connections.manager_customer_id is distinct from excluded.manager_customer_id then 'needs_attention' else relationship_google_ads_connections.status end,
        account_name = case when relationship_google_ads_connections.customer_id = excluded.customer_id and relationship_google_ads_connections.manager_customer_id = excluded.manager_customer_id then relationship_google_ads_connections.account_name else null end,
        currency_code = case when relationship_google_ads_connections.customer_id = excluded.customer_id and relationship_google_ads_connections.manager_customer_id = excluded.manager_customer_id then relationship_google_ads_connections.currency_code else null end,
        time_zone = case when relationship_google_ads_connections.customer_id = excluded.customer_id and relationship_google_ads_connections.manager_customer_id = excluded.manager_customer_id then relationship_google_ads_connections.time_zone else null end,
        connected_at = case when relationship_google_ads_connections.customer_id = excluded.customer_id and relationship_google_ads_connections.manager_customer_id = excluded.manager_customer_id then relationship_google_ads_connections.connected_at else null end,
        last_verified_at = case when relationship_google_ads_connections.customer_id = excluded.customer_id and relationship_google_ads_connections.manager_customer_id = excluded.manager_customer_id then relationship_google_ads_connections.last_verified_at else null end,
        last_error = null, attempt_id = excluded.attempt_id, attempt_started_at = now(), updated_at = now(),
        rate_window_started_at = case when relationship_google_ads_connections.rate_window_started_at <= now() - interval '1 hour' then now() else relationship_google_ads_connections.rate_window_started_at end,
        rate_window_count = case when relationship_google_ads_connections.rate_window_started_at <= now() - interval '1 hour' then 1 else relationship_google_ads_connections.rate_window_count + 1 end
    returning * into v_connection;
    if v_replaced then
        delete from public.relationship_google_ads_reports where connection_id = v_connection.id;
        delete from public.onboarding_block_requirements requirement using public.relationship_onboarding_sessions session
        where requirement.workspace_id = p_workspace_id and requirement.session_id = session.id
          and session.workspace_id = p_workspace_id and session.relationship_id = v_relationship_id and session.status = 'active'
          and requirement.requirement_kind = 'google_ads_connected';
    end if;
    return jsonb_build_object('id', v_connection.id, 'previousCustomerId', case when v_replaced then v_previous_customer_id else null end);
exception when unique_violation then
    raise exception using errcode = 'P0001', message = 'This advertising account is assigned to another relationship. Contact your agency.';
end;
$$;

revoke all on function public.begin_google_ads_onboarding(text, uuid, text, text, uuid) from public, anon, authenticated;
revoke all on function public.begin_google_ads_portal(text, uuid, text, text, uuid) from public, anon, authenticated;
grant execute on function public.begin_google_ads_onboarding(text, uuid, text, text, uuid) to service_role;
grant execute on function public.begin_google_ads_portal(text, uuid, text, text, uuid) to service_role;
