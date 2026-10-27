-- Staff add/verify uses the existing Google provider and relationship binding.
-- No portal/onboarding bearer, report deletion, accepted-work change or account replacement.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';
do $$ begin
 if to_regprocedure('public.manage_client_ghl_connection_v2(uuid,uuid,text,uuid,uuid,text,text,text,text,jsonb,text,uuid,text,text)') is null
    or to_regprocedure('public.begin_google_ads_portal(text,uuid,text,text,uuid)') is null then
  raise exception 'Install Client Connections controls and Google Ads portal support first';
 end if;
end $$;

create function public.require_google_ads_staff_setup(p_workspace_id uuid,p_user_id uuid,p_relationship_id uuid)
returns void language plpgsql security invoker set search_path='' as $$
declare actor_role text; allowed jsonb;
begin
 if current_user<>'service_role' then raise exception using errcode='42501',message='Trusted Google Ads runtime required'; end if;
 select m.role into actor_role from public.workspace_memberships m
 join public.workspaces w on w.id=m.workspace_id and w.status='active'
 where m.workspace_id=p_workspace_id and m.user_id=p_user_id;
 if actor_role is null or not exists(select 1 from public.relationships r
     where r.workspace_id=p_workspace_id and r.id=p_relationship_id and r.status<>'archived') then
  raise exception using errcode='42501',message='You do not have access to this client connection';
 end if;
 if actor_role not in ('owner','admin') then
  -- Targeted canonical scope includes explicit setup grants and current service assignments.
  allowed:=public.manage_client_ghl_connection_v2(p_workspace_id,p_user_id,'list',p_relationship_id);
  if jsonb_typeof(allowed) is distinct from 'array' then
   raise exception using errcode='42501',message='You do not have access to this client connection';
  end if;
  if not exists(select 1 from jsonb_array_elements(allowed) item where item->>'relationshipId'=p_relationship_id::text) then
   raise exception using errcode='42501',message='You do not have access to this client connection';
  end if;
 end if;
end $$;

create function public.read_google_ads_staff(p_workspace_id uuid,p_user_id uuid,p_relationship_id uuid,p_credentials boolean default false)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare integration public.workspace_integrations%rowtype; connection public.relationship_google_ads_connections%rowtype;
 manager_name text; ready boolean; result jsonb;
begin
 perform public.require_google_ads_staff_setup(p_workspace_id,p_user_id,p_relationship_id);
 select * into integration from public.workspace_integrations where workspace_id=p_workspace_id and provider='google_ads';
 select coalesce(nullif(integration.config_hint->>'manager_name',''),w.name,'Your agency') into manager_name from public.workspaces w where w.id=p_workspace_id;
 ready:=coalesce(integration.enabled and integration.mode='connected' and nullif(integration.connected_account_id,'') is not null and nullif(integration.config_encrypted,'') is not null,false);
 if not ready then
  return jsonb_build_object('connection',null,'managerId','','managerName',manager_name,'error','Connect the agency Google Ads manager account in Settings first.');
 end if;
 select * into connection from public.relationship_google_ads_connections where workspace_id=p_workspace_id and relationship_id=p_relationship_id;
 result:=jsonb_build_object('managerId',integration.connected_account_id,'managerName',manager_name,'connection',
  case when connection.id is null then null else jsonb_build_object(
   'customerId',connection.customer_id,'managerId',integration.connected_account_id,'managerName',manager_name,
   'status',case when connection.manager_customer_id=integration.connected_account_id then connection.status else 'needs_attention' end,
   'accountName',case when connection.manager_customer_id=integration.connected_account_id then connection.account_name else null end,
   'verifiedAt',case when connection.manager_customer_id=integration.connected_account_id then connection.last_verified_at else null end) end);
 -- This private branch is used only by the server after an explicit connect/verify action.
 if p_credentials then result:=result||jsonb_build_object('integrationEncrypted',integration.config_encrypted); end if;
 return result;
end $$;

create function public.begin_google_ads_staff(p_workspace_id uuid,p_user_id uuid,p_relationship_id uuid,
 p_customer_id text,p_manager_id text,p_attempt_id uuid,p_expected_config text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare connection public.relationship_google_ads_connections%rowtype;
begin
 if p_customer_id is null or p_customer_id !~ '^[0-9]{10}$' or p_manager_id is null or p_manager_id !~ '^[0-9]{10}$' or p_customer_id=p_manager_id or p_attempt_id is null then
  raise exception using errcode='22023',message='Enter the 10-digit customer ID of the account that runs the client’s ads.';
 end if;
 -- Same relationship lock as the existing onboarding and portal commands.
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_workspace_id::text||':'||p_relationship_id::text,0));
 perform public.require_google_ads_staff_setup(p_workspace_id,p_user_id,p_relationship_id);
 if not exists(select 1 from public.workspace_integrations i where i.workspace_id=p_workspace_id and i.provider='google_ads'
   and i.enabled and i.mode='connected' and i.connected_account_id=p_manager_id and i.config_encrypted=p_expected_config) then
  raise exception using errcode='P0001',message='The agency Google Ads connection changed. Reload and try again.';
 end if;
 select * into connection from public.relationship_google_ads_connections where workspace_id=p_workspace_id and relationship_id=p_relationship_id for update;
 if connection.id is not null and connection.customer_id is distinct from p_customer_id then
  raise exception using errcode='P0001',message='This client already has a different Google Ads account. Verify the existing account instead.';
 end if;
 if connection.attempt_id is not null and connection.attempt_started_at>now()-interval '2 minutes' then
  raise exception using errcode='P0001',message='A connection check is already running. Wait a moment, then try again.';
 end if;
 if connection.updated_at>now()-interval '5 seconds' then raise exception using errcode='P0001',message='Wait a few seconds before checking again.'; end if;
 if connection.rate_window_started_at>now()-interval '1 hour' and connection.rate_window_count>=60 then raise exception using errcode='P0001',message='Too many connection attempts. Please try again later.'; end if;
 if exists(select 1 from public.relationship_google_ads_connections where workspace_id=p_workspace_id and customer_id=p_customer_id and relationship_id<>p_relationship_id) then
  raise exception using errcode='P0001',message='This advertising account is assigned to another relationship.';
 end if;
 insert into public.relationship_google_ads_connections(workspace_id,relationship_id,onboarding_session_id,source_session_block_id,manager_customer_id,customer_id,attempt_id,attempt_started_at,rate_window_count)
 values(p_workspace_id,p_relationship_id,null,null,p_manager_id,p_customer_id,p_attempt_id,now(),1)
 on conflict(workspace_id,relationship_id) do update set
  manager_customer_id=excluded.manager_customer_id,
  status=case when relationship_google_ads_connections.manager_customer_id=excluded.manager_customer_id then relationship_google_ads_connections.status else 'needs_attention' end,
  account_name=case when relationship_google_ads_connections.manager_customer_id=excluded.manager_customer_id then relationship_google_ads_connections.account_name else null end,
  currency_code=case when relationship_google_ads_connections.manager_customer_id=excluded.manager_customer_id then relationship_google_ads_connections.currency_code else null end,
  time_zone=case when relationship_google_ads_connections.manager_customer_id=excluded.manager_customer_id then relationship_google_ads_connections.time_zone else null end,
  connected_at=case when relationship_google_ads_connections.manager_customer_id=excluded.manager_customer_id then relationship_google_ads_connections.connected_at else null end,
  last_verified_at=case when relationship_google_ads_connections.manager_customer_id=excluded.manager_customer_id then relationship_google_ads_connections.last_verified_at else null end,
  last_error=null,attempt_id=excluded.attempt_id,attempt_started_at=now(),updated_at=now(),
  rate_window_started_at=case when relationship_google_ads_connections.rate_window_started_at<=now()-interval '1 hour' then now() else relationship_google_ads_connections.rate_window_started_at end,
  rate_window_count=case when relationship_google_ads_connections.rate_window_started_at<=now()-interval '1 hour' then 1 else relationship_google_ads_connections.rate_window_count+1 end
 returning * into connection;
 return jsonb_build_object('id',connection.id);
exception when unique_violation then raise exception using errcode='P0001',message='This advertising account is assigned to another relationship.';
end $$;

create function public.finish_google_ads_staff(p_workspace_id uuid,p_user_id uuid,p_relationship_id uuid,
 p_attempt_id uuid,p_customer_id text,p_expected_config text,p_status text,p_account_name text default null,
 p_currency text default null,p_timezone text default null,p_error text default null)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare connection public.relationship_google_ads_connections%rowtype; integration public.workspace_integrations%rowtype;
begin
 -- Recheck authority after any wait for the shared relationship lock.
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_workspace_id::text||':'||p_relationship_id::text,0));
 perform public.require_google_ads_staff_setup(p_workspace_id,p_user_id,p_relationship_id);
 select * into connection from public.relationship_google_ads_connections where workspace_id=p_workspace_id and relationship_id=p_relationship_id
  and attempt_id=p_attempt_id and customer_id=p_customer_id and attempt_started_at>now()-interval '2 minutes' for update;
 if connection.id is null then raise exception using errcode='P0001',message='This connection attempt expired or was replaced. Please check again.'; end if;
 select * into integration from public.workspace_integrations where workspace_id=p_workspace_id and provider='google_ads' for share;
 if not coalesce(integration.enabled,false) or integration.mode is distinct from 'connected'
    or integration.connected_account_id is distinct from connection.manager_customer_id or integration.config_encrypted is distinct from p_expected_config then
  raise exception using errcode='P0001',message='The agency Google Ads connection changed. Reload and try again.';
 end if;
 if p_status is null or p_status not in ('pending','connected','needs_attention') then raise exception using errcode='22023',message='Invalid connection result'; end if;
 update public.relationship_google_ads_connections set status=p_status,
  account_name=case when p_status='connected' then left(p_account_name,300) else null end,
  currency_code=case when p_status='connected' then left(p_currency,10) else null end,
  time_zone=case when p_status='connected' then left(p_timezone,100) else null end,
  connected_at=case when p_status='connected' then coalesce(connected_at,now()) else connected_at end,
  last_verified_at=case when p_status='connected' then now() else null end,
  last_error=left(p_error,500),attempt_id=null,updated_at=now()
 where id=connection.id returning * into connection;
 return jsonb_build_object('customerId',connection.customer_id,'managerId',connection.manager_customer_id,
  'managerName',coalesce(integration.config_hint->>'manager_name','Your agency'),'status',connection.status,
  'accountName',connection.account_name,'verifiedAt',connection.last_verified_at);
end $$;

revoke all on function public.require_google_ads_staff_setup(uuid,uuid,uuid),public.read_google_ads_staff(uuid,uuid,uuid,boolean),
 public.begin_google_ads_staff(uuid,uuid,uuid,text,text,uuid,text),public.finish_google_ads_staff(uuid,uuid,uuid,uuid,text,text,text,text,text,text,text) from public,anon,authenticated;
grant execute on function public.require_google_ads_staff_setup(uuid,uuid,uuid),public.read_google_ads_staff(uuid,uuid,uuid,boolean),
 public.begin_google_ads_staff(uuid,uuid,uuid,text,text,uuid,text),public.finish_google_ads_staff(uuid,uuid,uuid,uuid,text,text,text,text,text,text,text) to service_role;
notify pgrst,'reload schema';
commit;
