-- Split Google Ads services while preserving one relationship-level OAuth connection.
begin;

create or replace function public.install_onboarding_service_template(
    p_workspace_id uuid,
    p_actor_user_id uuid,
    p_service_id uuid,
    p_definition jsonb,
    p_template_id text,
    p_connection_provider text
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
    v_saved jsonb;
begin
    if p_service_id is not null then
        raise exception 'Service templates can only be installed as new services';
    end if;
    if not (
        coalesce(p_template_id = 'meta-ads' and p_connection_provider = 'windsor', false)
        or coalesce(p_template_id in ('google-search-ads', 'google-local-services-ads') and p_connection_provider = 'google_ads', false)
    ) then
        raise exception 'Unknown service template setup';
    end if;
    if p_definition ->> 'templateId' is distinct from p_template_id
        or not (coalesce(p_definition -> 'requiredConnectionKeys', '[]'::jsonb) @> jsonb_build_array(p_connection_provider)) then
        raise exception 'Service template setup does not match its trusted definition';
    end if;

    v_saved := public.save_onboarding_service_revision(p_workspace_id, p_actor_user_id, null, p_definition);

    insert into public.workspace_integrations (workspace_id, provider, enabled, mode, connection_status, config_hint)
    values (p_workspace_id, p_connection_provider, false, 'disabled', 'not_connected', '{}'::jsonb)
    on conflict (workspace_id, provider) do nothing;

    return v_saved || jsonb_build_object('template_id', p_template_id, 'connection_provider', p_connection_provider);
end;
$$;

revoke all on function public.install_onboarding_service_template(uuid, uuid, uuid, jsonb, text, text) from public, anon, authenticated;
grant execute on function public.install_onboarding_service_template(uuid, uuid, uuid, jsonb, text, text) to service_role;

-- Existing snapshots were account-wide and cannot truthfully be relabelled as Search.
delete from public.relationship_google_ads_reports;
alter table public.relationship_google_ads_reports add column report_kind text not null default 'search';
alter table public.relationship_google_ads_reports add constraint relationship_google_ads_reports_kind_check check (report_kind in ('search', 'local_services'));
alter table public.relationship_google_ads_reports drop constraint relationship_google_ads_reports_pkey;
alter table public.relationship_google_ads_reports add primary key (connection_id, period, report_kind);

drop function public.client_portal_google_ads_report(text,uuid,text,text,uuid,text,jsonb,text);

create function public.client_portal_google_ads_report(
    p_token text,
    p_workspace_id uuid,
    p_period text,
    p_report_kind text,
    p_action text default 'read',
    p_operation_id uuid default null,
    p_expected_config text default null,
    p_report jsonb default null,
    p_error text default null
) returns jsonb language plpgsql security invoker set search_path = public as $$
declare
    target uuid;
    c public.relationship_google_ads_connections%rowtype;
    i public.workspace_integrations%rowtype;
    r public.relationship_google_ads_reports%rowtype;
begin
    target := public.google_ads_portal_relationship(p_token,p_workspace_id);
    if p_period is null or p_period not in ('last7','last30','month')
      or p_report_kind is null or p_report_kind not in ('search','local_services')
      or p_action is null or p_action not in ('read','begin','finish','fail') then raise exception 'Invalid report request'; end if;
    if p_action <> 'read' then perform pg_advisory_xact_lock(hashtextextended(p_workspace_id::text||':'||target::text,0)); end if;
    select * into c from public.relationship_google_ads_connections where workspace_id=p_workspace_id and relationship_id=target;
    select * into i from public.workspace_integrations where workspace_id=p_workspace_id and provider='google_ads';
    if c.status is distinct from 'connected' or not coalesce(i.enabled,false) or i.mode is distinct from 'connected'
      or i.connected_account_id is distinct from c.manager_customer_id or i.config_encrypted is null then
        if p_action='read' then return jsonb_build_object('snapshot',null,'error',null); end if;
        raise exception using errcode='P0001',message='Connect your advertising account before loading metrics.';
    end if;
    select * into r from public.relationship_google_ads_reports where connection_id=c.id and period=p_period and report_kind=p_report_kind;
    if p_action='begin' then
        if p_operation_id is null then raise exception 'Missing report operation'; end if;
        if r.lease_until > now() then raise exception using errcode='P0001',message='A report is already refreshing. Please wait a moment.'; end if;
        if r.attempted_at > now()-interval '60 seconds' then raise exception using errcode='P0001',message='Please wait a minute before refreshing this period again.'; end if;
        insert into public.relationship_google_ads_reports(connection_id,period,report_kind,customer_id,manager_id,config_version,operation_id,lease_until,attempted_at)
        values(c.id,p_period,p_report_kind,c.customer_id,c.manager_customer_id,md5(i.config_encrypted),p_operation_id,now()+interval '90 seconds',now())
        on conflict(connection_id,period,report_kind) do update set customer_id=excluded.customer_id,manager_id=excluded.manager_id,config_version=excluded.config_version,
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
        if p_action='finish' and (p_report is null or p_report->>'customerId' is distinct from c.customer_id
          or p_report->>'kind' is distinct from p_report_kind or jsonb_typeof(p_report)<>'object' or octet_length(p_report::text)>=4096) then
            raise exception 'Invalid account report';
        end if;
        update public.relationship_google_ads_reports set report=case when p_action='finish' then p_report else report end,
          refreshed_at=case when p_action='finish' then now() else refreshed_at end,last_error=case when p_action='fail' then left(p_error,500) else null end,
          operation_id=null,lease_until=null where connection_id=c.id and period=p_period and report_kind=p_report_kind returning * into r;
    end if;
    if r.customer_id is distinct from c.customer_id or r.manager_id is distinct from c.manager_customer_id
      or r.config_version is distinct from md5(i.config_encrypted) then return jsonb_build_object('snapshot',null,'error',null); end if;
    return jsonb_build_object('snapshot',case when r.report is not null then jsonb_build_object('report',r.report,'refreshedAt',r.refreshed_at) else null end,
        'error',r.last_error,'busy',coalesce(r.lease_until>now(),false));
end;
$$;

revoke all on function public.client_portal_google_ads_report(text,uuid,text,text,text,uuid,text,jsonb,text) from public,anon,authenticated;
grant execute on function public.client_portal_google_ads_report(text,uuid,text,text,text,uuid,text,jsonb,text) to service_role;

commit;
