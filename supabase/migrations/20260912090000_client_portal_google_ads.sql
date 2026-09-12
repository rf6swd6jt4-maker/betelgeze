-- One advertising account per relationship, reusable after onboarding.
alter table public.relationship_google_ads_connections alter column onboarding_session_id drop not null;
alter table public.relationship_google_ads_connections alter column source_session_block_id drop not null;

create function public.google_ads_portal_relationship(p_token text, p_workspace_id uuid)
returns uuid language plpgsql security invoker set search_path = public as $$
declare target uuid;
begin
    if current_user <> 'service_role' then raise exception using errcode='42501', message='Trusted portal runtime required'; end if;
    select r.id into target from public.client_portal_sessions s
    join public.relationships r on r.id=s.relationship_id and r.workspace_id=s.workspace_id
    join public.workspaces w on w.id=s.workspace_id
    where s.session_token=p_token and s.workspace_id=p_workspace_id and s.status='active'
      and s.token_revoked_at is null and r.status <> 'archived' and w.status='active';
    if target is null then raise exception using errcode='P0001', message='This client portal is unavailable. Please reopen your portal link.'; end if;
    return target;
end;
$$;
create function public.begin_google_ads_portal(
    p_token text, p_workspace_id uuid, p_customer_id text, p_manager_id text, p_attempt_id uuid
) returns jsonb language plpgsql security invoker set search_path = public as $$
declare
    v_connection public.relationship_google_ads_connections%rowtype;
    v_relationship_id uuid;
begin
    v_relationship_id := public.google_ads_portal_relationship(p_token, p_workspace_id);
    if p_customer_id is null or p_customer_id !~ '^[0-9]{10}$' or p_manager_id is null or p_manager_id !~ '^[0-9]{10}$' or p_customer_id = p_manager_id or p_attempt_id is null then
        raise exception using errcode = '22023', message = 'Enter the 10-digit customer ID of the account that runs your ads.';
    end if;
    if not exists (select 1 from public.workspace_integrations integration where integration.workspace_id = p_workspace_id and integration.provider = 'google_ads' and integration.enabled and integration.mode = 'connected' and integration.connected_account_id = p_manager_id) then
        raise exception using errcode = 'P0001', message = 'Your agency needs to reconnect its Google Ads manager account.';
    end if;
    -- Serialise all blocks and sessions for this relationship before reserving an account.
    perform pg_advisory_xact_lock(hashtextextended(p_workspace_id::text || ':' || v_relationship_id::text, 0));
    select * into v_connection from public.relationship_google_ads_connections where workspace_id = p_workspace_id and relationship_id = v_relationship_id for update;
    if v_connection.attempt_id is not null and v_connection.attempt_started_at > now() - interval '2 minutes' then
        raise exception using errcode = 'P0001', message = 'A connection check is already running. Wait a moment, then try again.';
    end if;
    if v_connection.updated_at > now() - interval '5 seconds' then raise exception using errcode = 'P0001', message = 'Wait a few seconds before checking again.'; end if;
    if v_connection.rate_window_started_at > now() - interval '1 hour' and v_connection.rate_window_count >= 60 then raise exception using errcode = 'P0001', message = 'Too many connection attempts. Please try again later.'; end if;
    if v_connection.customer_id is distinct from p_customer_id and v_connection.status in ('pending', 'connected') then
        raise exception using errcode = 'P0001', message = 'An account is already linked or awaiting approval. Contact your agency to change the account.';
    end if;
    if exists (select 1 from public.relationship_google_ads_connections where workspace_id = p_workspace_id and customer_id = p_customer_id and relationship_id <> v_relationship_id) then
        raise exception using errcode = 'P0001', message = 'This advertising account is assigned to another relationship. Contact your agency.';
    end if;
    insert into public.relationship_google_ads_connections (workspace_id, relationship_id, onboarding_session_id, source_session_block_id, manager_customer_id, customer_id, attempt_id, attempt_started_at, rate_window_count)
    values (p_workspace_id, v_relationship_id, null, null, p_manager_id, p_customer_id, p_attempt_id, now(), 1)
    on conflict (workspace_id, relationship_id) do update set
        customer_id = excluded.customer_id, manager_customer_id = excluded.manager_customer_id,
        status = case when relationship_google_ads_connections.manager_customer_id = excluded.manager_customer_id then relationship_google_ads_connections.status else 'needs_attention' end,
        attempt_id = excluded.attempt_id, attempt_started_at = now(), updated_at = now(),
        rate_window_started_at = case when relationship_google_ads_connections.rate_window_started_at <= now() - interval '1 hour' then now() else relationship_google_ads_connections.rate_window_started_at end,
        rate_window_count = case when relationship_google_ads_connections.rate_window_started_at <= now() - interval '1 hour' then 1 else relationship_google_ads_connections.rate_window_count + 1 end
    returning * into v_connection;
    return jsonb_build_object('id', v_connection.id);
exception when unique_violation then
    raise exception using errcode = 'P0001', message = 'This advertising account is assigned to another relationship. Contact your agency.';
end;
$$;

create function public.finish_google_ads_portal(
    p_token text, p_workspace_id uuid, p_attempt_id uuid, p_expected_config text,
    p_status text, p_account_name text default null, p_currency text default null, p_timezone text default null, p_error text default null
) returns jsonb language plpgsql security invoker set search_path = public as $$
declare
    v_relationship_id uuid;
    v_connection public.relationship_google_ads_connections%rowtype;
    v_integration public.workspace_integrations%rowtype;
    v_response jsonb;
begin
    v_relationship_id := public.google_ads_portal_relationship(p_token, p_workspace_id);
    select * into v_connection from public.relationship_google_ads_connections where workspace_id = p_workspace_id and relationship_id = v_relationship_id and attempt_id = p_attempt_id for update;
    if v_connection.id is null then raise exception using errcode = 'P0001', message = 'A newer connection attempt has replaced this one. Please check again.'; end if;
    select * into v_integration from public.workspace_integrations where workspace_id = p_workspace_id and provider = 'google_ads' for share;
    if not coalesce(v_integration.enabled, false) or v_integration.mode is distinct from 'connected' or v_integration.connected_account_id is distinct from v_connection.manager_customer_id or v_integration.config_encrypted is distinct from p_expected_config then
        raise exception using errcode = 'P0001', message = 'Your agency changed its Google Ads connection. Refresh this page and try again.';
    end if;
    if p_status is null or p_status not in ('pending', 'connected', 'needs_attention') then raise exception 'Invalid connection result'; end if;
    update public.relationship_google_ads_connections set
        status = p_status, account_name = case when p_status = 'connected' then left(p_account_name, 300) else null end,
        currency_code = case when p_status = 'connected' then left(p_currency, 10) else null end,
        time_zone = case when p_status = 'connected' then left(p_timezone, 100) else null end,
        connected_at = case when p_status = 'connected' then coalesce(connected_at, now()) else connected_at end,
        last_verified_at = case when p_status = 'connected' then now() else null end,
        last_error = left(p_error, 500), attempt_id = null, updated_at = now()
    where id = v_connection.id returning * into v_connection;
    v_response := jsonb_build_object('customerId', v_connection.customer_id, 'managerId', v_connection.manager_customer_id,
        'managerName', coalesce(v_integration.config_hint->>'manager_name', 'Your agency'), 'status', p_status,
        'accountName', v_connection.account_name, 'verifiedAt', v_connection.last_verified_at);
    -- A portal check does not submit or modify an onboarding step.
    return v_response;
end;
$$;

revoke all on function public.google_ads_portal_relationship(text,uuid) from public,anon,authenticated;
revoke all on function public.begin_google_ads_portal(text,uuid,text,text,uuid) from public,anon,authenticated;
revoke all on function public.finish_google_ads_portal(text,uuid,uuid,text,text,text,text,text,text) from public,anon,authenticated;
grant execute on function public.google_ads_portal_relationship(text,uuid) to service_role;
grant execute on function public.begin_google_ads_portal(text,uuid,text,text,uuid) to service_role;
grant execute on function public.finish_google_ads_portal(text,uuid,uuid,text,text,text,text,text,text) to service_role;

create table public.relationship_google_ads_reports (
    connection_id uuid not null references public.relationship_google_ads_connections(id) on delete cascade,
    period text not null check(period in ('last7','last30','month')),
    customer_id text not null,
    manager_id text not null,
    config_version text not null,
    report jsonb,
    refreshed_at timestamptz,
    last_error text,
    operation_id uuid,
    lease_until timestamptz,
    attempted_at timestamptz,
    primary key(connection_id,period),
    check(report is null or (jsonb_typeof(report)='object' and octet_length(report::text)<4096))
);
alter table public.relationship_google_ads_reports enable row level security;
revoke all on public.relationship_google_ads_reports from public,anon,authenticated;
grant all on public.relationship_google_ads_reports to service_role;

create function public.client_portal_google_ads_report(
    p_token text,p_workspace_id uuid,p_period text,p_action text default 'read',
    p_operation_id uuid default null,p_expected_config text default null,p_report jsonb default null,p_error text default null
) returns jsonb language plpgsql security invoker set search_path = public as $$
declare
    target uuid;
    c public.relationship_google_ads_connections%rowtype;
    i public.workspace_integrations%rowtype;
    r public.relationship_google_ads_reports%rowtype;
begin
    target := public.google_ads_portal_relationship(p_token,p_workspace_id);
    if p_period is null or p_period not in ('last7','last30','month') or p_action is null or p_action not in ('read','begin','finish','fail') then raise exception 'Invalid report request'; end if;
    if p_action <> 'read' then perform pg_advisory_xact_lock(hashtextextended(p_workspace_id::text||':'||target::text,0)); end if;
    select * into c from public.relationship_google_ads_connections where workspace_id=p_workspace_id and relationship_id=target;
    select * into i from public.workspace_integrations where workspace_id=p_workspace_id and provider='google_ads';
    if c.status is distinct from 'connected' or not coalesce(i.enabled,false) or i.mode is distinct from 'connected' or i.connected_account_id is distinct from c.manager_customer_id or i.config_encrypted is null then
        if p_action='read' then return jsonb_build_object('snapshot',null,'error',null); end if;
        raise exception using errcode='P0001',message='Connect your advertising account before loading metrics.';
    end if;
    select * into r from public.relationship_google_ads_reports where connection_id=c.id and period=p_period;
    if p_action='begin' then
        if p_operation_id is null then raise exception 'Missing report operation'; end if;
        if r.lease_until > now() then raise exception using errcode='P0001',message='A report is already refreshing. Please wait a moment.'; end if;
        if r.attempted_at > now()-interval '60 seconds' then raise exception using errcode='P0001',message='Please wait a minute before refreshing this period again.'; end if;
        insert into public.relationship_google_ads_reports(connection_id,period,customer_id,manager_id,config_version,operation_id,lease_until,attempted_at)
        values(c.id,p_period,c.customer_id,c.manager_customer_id,md5(i.config_encrypted),p_operation_id,now()+interval '90 seconds',now())
        on conflict(connection_id,period) do update set customer_id=excluded.customer_id,manager_id=excluded.manager_id,config_version=excluded.config_version,
            report=case when relationship_google_ads_reports.customer_id=excluded.customer_id and relationship_google_ads_reports.manager_id=excluded.manager_id and relationship_google_ads_reports.config_version=excluded.config_version then relationship_google_ads_reports.report else null end,
            refreshed_at=case when relationship_google_ads_reports.customer_id=excluded.customer_id and relationship_google_ads_reports.manager_id=excluded.manager_id and relationship_google_ads_reports.config_version=excluded.config_version then relationship_google_ads_reports.refreshed_at else null end,
            last_error=null,operation_id=excluded.operation_id,lease_until=excluded.lease_until,attempted_at=excluded.attempted_at;
        return jsonb_build_object('customerId',c.customer_id,'configEncrypted',i.config_encrypted);
    end if;
    if p_action in ('finish','fail') then
        if p_operation_id is null or r.operation_id is distinct from p_operation_id or r.lease_until <= now()
          or r.customer_id is distinct from c.customer_id or r.manager_id is distinct from c.manager_customer_id
          or i.config_encrypted is distinct from p_expected_config or r.config_version is distinct from md5(i.config_encrypted) then
            raise exception using errcode='P0001',message='The connection changed while reporting. Please reload its status.';
        end if;
        if p_action='finish' and (p_report is null or p_report->>'customerId' is distinct from c.customer_id or jsonb_typeof(p_report)<>'object' or octet_length(p_report::text)>=4096) then raise exception 'Invalid account report'; end if;
        update public.relationship_google_ads_reports set report=case when p_action='finish' then p_report else report end,
          refreshed_at=case when p_action='finish' then now() else refreshed_at end,last_error=case when p_action='fail' then left(p_error,500) else null end,
          operation_id=null,lease_until=null where connection_id=c.id and period=p_period returning * into r;
    end if;
    if r.customer_id is distinct from c.customer_id or r.manager_id is distinct from c.manager_customer_id or r.config_version is distinct from md5(i.config_encrypted) then return jsonb_build_object('snapshot',null,'error',null); end if;
    return jsonb_build_object('snapshot',case when r.report is not null then jsonb_build_object('report',r.report,'refreshedAt',r.refreshed_at) else null end,
        'error',r.last_error,'busy',coalesce(r.lease_until>now(),false));
end;
$$;
revoke all on function public.client_portal_google_ads_report(text,uuid,text,text,uuid,text,jsonb,text) from public,anon,authenticated;
grant execute on function public.client_portal_google_ads_report(text,uuid,text,text,uuid,text,jsonb,text) to service_role;
