-- Current connection metadata and on-demand relationship choices. No records,
-- credentials, accepted setup work, or retained connection history are rewritten.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';
do $$ begin
 if to_regprocedure('public.read_client_advertising_connections(uuid,uuid,uuid,uuid,text)') is null
    or to_regprocedure('public.manage_client_ghl_connection_v2(uuid,uuid,text,uuid,uuid,text,text,text,text,jsonb,text,uuid,text,text)') is null
    or to_regprocedure('public.service_assignee_can_setup_client(uuid,uuid,uuid)') is null then
  raise exception 'Install Client Connections and advertising summaries before current connection choices';
 end if;
end $$;

-- Reuse relationships_workspace_id_id_unique and the existing normalized
-- relationship-name indexes. No new write-path indexes or table locks.

create function public.read_current_client_ghl_connections(p_workspace_id uuid,p_user_id uuid,p_relationship_id uuid default null)
returns jsonb language plpgsql security definer set search_path='' set plan_cache_mode='force_custom_plan' as $$
declare actor_role text; permitted uuid[]; allowed jsonb; accounts jsonb;
begin
 select m.role into actor_role from public.workspace_memberships m
 join public.workspaces w on w.id=m.workspace_id and w.status='active'
 where m.workspace_id=p_workspace_id and m.user_id=p_user_id;
 if actor_role is null then return jsonb_build_object('failure','access'); end if;
 if actor_role not in ('owner','admin') then
  allowed:=public.manage_client_ghl_connection_v2(p_workspace_id,p_user_id,'list',p_relationship_id);
  if jsonb_typeof(allowed) is distinct from 'array' then return jsonb_build_object('failure','access'); end if;
  select array_agg((item->>'relationshipId')::uuid) into permitted from jsonb_array_elements(allowed) item;
  if coalesce(cardinality(permitted),0)=0 then return jsonb_build_object('accounts','[]'::jsonb); end if;
 end if;
 with current_rows as (
  select r.id,r.primary_person_name,r.business_name,c.account_type,c.location_id,c.location_name,
   c.selected_calendar_id,c.selected_calendar_name,c.calendar_revision,c.ready_at,c.refreshed_at,c.last_error,c.lease_until
  from client_portal_secure.ghl_connections c
  join public.relationships r on r.workspace_id=c.workspace_id and r.id=c.relationship_id and r.status<>'archived'
  where c.workspace_id=p_workspace_id and c.vault_secret_id is not null
   and (p_relationship_id is null or c.relationship_id=p_relationship_id)
   and (actor_role in ('owner','admin') or c.relationship_id=any(permitted))
  order by c.relationship_id limit 1001
 ) select coalesce(jsonb_agg(jsonb_build_object(
  'relationshipId',c.id,'clientName',c.primary_person_name,'businessName',c.business_name,'archived',false,
  'accountType',coalesce(c.account_type,'client_account'),'connected',true,'locationId',c.location_id,'locationName',c.location_name,
  'calendarId',c.selected_calendar_id,'calendarName',c.selected_calendar_name,'revision',c.calendar_revision,
  'readyAt',c.ready_at,'refreshedAt',c.refreshed_at,'error',c.last_error,'busy',coalesce(c.lease_until>now(),false)
 ) order by coalesce(c.business_name,c.primary_person_name),c.id),'[]'::jsonb) into accounts from current_rows c;
 if jsonb_array_length(accounts)>1000 then return jsonb_build_object('failure','list_limit'); end if;
 return jsonb_build_object('accounts',accounts);
end $$;
revoke all on function public.read_current_client_ghl_connections(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.read_current_client_ghl_connections(uuid,uuid,uuid) to service_role;

create function public.read_client_connection_relationships(
 p_workspace_id uuid,p_user_id uuid,p_provider text,p_query text default '',p_after uuid default null,p_relationship_id uuid default null
) returns jsonb language plpgsql security definer set search_path='' set plan_cache_mode='force_custom_plan' as $$
declare actor_role text; permitted uuid[]; allowed jsonb; accounts jsonb; next_cursor uuid;
 search_upper text; search_query text:=lower(btrim(coalesce(p_query,'')) collate pg_catalog."und-x-icu");
begin
 select m.role into actor_role from public.workspace_memberships m
 join public.workspaces w on w.id=m.workspace_id and w.status='active'
 where m.workspace_id=p_workspace_id and m.user_id=p_user_id;
 if actor_role is null then return jsonb_build_object('failure','access'); end if;
 if p_provider is null or p_provider not in ('ghl','meta_ads','google_ads') or length(coalesce(p_query,''))>100 then
  return jsonb_build_object('failure','response');
 end if;
 if actor_role not in ('owner','admin') then
  -- Preserve the existing indexed grant/service scope; panel membership alone
  -- must never expose another client's connection or setup choices.
  allowed:=public.manage_client_ghl_connection_v2(p_workspace_id,p_user_id,'list',p_relationship_id);
  if jsonb_typeof(allowed) is distinct from 'array' then return jsonb_build_object('failure','access'); end if;
  select array_agg((item->>'relationshipId')::uuid) into permitted from jsonb_array_elements(allowed) item;
  if coalesce(cardinality(permitted),0)=0 then return jsonb_build_object('accounts','[]'::jsonb,'nextCursor',null); end if;
 end if;
 -- Reuse the established normalized name indexes for literal prefix search.
 search_upper:=search_query;
 while length(search_upper)>0 and ascii(right(search_upper,1))=1114111 loop
  search_upper:=left(search_upper,length(search_upper)-1);
 end loop;
 if length(search_upper)>0 then
  search_upper:=left(search_upper,length(search_upper)-1)||chr(case when ascii(right(search_upper,1))=55295 then 57344 else ascii(right(search_upper,1))+1 end);
 else search_upper:=null; end if;
 with choices as (
  select r.id,r.primary_person_name,r.business_name,c.account_type,c.vault_secret_id is not null connected,c.location_id,c.location_name,
   c.selected_calendar_id,c.selected_calendar_name,c.calendar_revision,c.ready_at,c.refreshed_at,c.last_error,c.lease_until
  from public.relationships r
  left join client_portal_secure.ghl_connections c on p_provider='ghl' and c.workspace_id=p_workspace_id and c.relationship_id=r.id
  where r.workspace_id=p_workspace_id and r.status<>'archived' and (p_after is null or r.id>p_after)
   and (p_relationship_id is null or r.id=p_relationship_id)
   and (search_query='' or (
     left(lower(r.primary_person_name collate pg_catalog."und-x-icu"),240) collate "C">=search_query collate "C"
     and (search_upper is null or left(lower(r.primary_person_name collate pg_catalog."und-x-icu"),240) collate "C"<search_upper collate "C")) or (
     left(lower(r.business_name collate pg_catalog."und-x-icu"),240) collate "C">=search_query collate "C"
     and (search_upper is null or left(lower(r.business_name collate pg_catalog."und-x-icu"),240) collate "C"<search_upper collate "C")))
   and (actor_role in ('owner','admin') or r.id=any(permitted))
   and (p_provider<>'meta_ads' or actor_role in ('owner','admin') or public.service_assignee_can_setup_client(p_workspace_id,p_user_id,r.id))
   -- Match the existing owner GHL list eligibility; this is discovery only.
   -- Existing command owners independently recheck authorization on every write.
   and (p_provider<>'ghl' or actor_role not in ('owner','admin') or c.vault_secret_id is not null
    or r.lifecycle_phase in ('onboarding','retention') or r.id in (
     select i.relationship_id from public.relationship_service_instances i
     where i.workspace_id=p_workspace_id and i.import_id is null and i.disposition='active' and i.stage in ('onboarding','setup','maintenance')
     union all
     select i.relationship_id from public.relationship_service_instances i
     join public.onboarding_service_revisions v on v.workspace_id=i.workspace_id and v.id=i.service_revision_id
     where i.workspace_id=p_workspace_id and i.import_id is null and i.disposition<>'cancelled'
      and not(i.disposition='active' and i.stage in ('onboarding','setup','maintenance'))
      and coalesce(v.definition->>'templateId',v.definition->>'template_id')='appointment-setting'
     union all
     select a.relationship_id from public.relationship_services a
     join public.onboarding_service_revisions v on v.workspace_id=a.workspace_id and v.id=a.service_revision_id
     where a.workspace_id=p_workspace_id and coalesce(v.definition->>'templateId',v.definition->>'template_id')='appointment-setting'
    ))
  order by r.id limit 51
 ) select coalesce(jsonb_agg(jsonb_build_object(
  'relationshipId',c.id,'clientName',c.primary_person_name,'businessName',c.business_name,'archived',false,
  'accountType',coalesce(c.account_type,'client_account'),'connected',c.connected,'locationId',c.location_id,'locationName',c.location_name,
  'calendarId',c.selected_calendar_id,'calendarName',c.selected_calendar_name,'revision',case when c.connected then c.calendar_revision else null end,
  'readyAt',c.ready_at,'refreshedAt',c.refreshed_at,'error',c.last_error,'busy',coalesce(c.lease_until>now(),false)
 ) order by c.id),'[]'::jsonb) into accounts from choices c;
 if jsonb_array_length(accounts)>50 then
  accounts:=accounts-50;
  next_cursor:=(accounts->49->>'relationshipId')::uuid;
 end if;
 return jsonb_build_object('accounts',accounts,'nextCursor',next_cursor);
end $$;
revoke all on function public.read_client_connection_relationships(uuid,uuid,text,text,uuid,uuid) from public,anon,authenticated;
grant execute on function public.read_client_connection_relationships(uuid,uuid,text,text,uuid,uuid) to service_role;

-- Keep the earlier advertising RPC unchanged for rollback and older callers.
-- The current filter and canonical permission scope run before each provider's
-- LIMIT. These are output bounds; sparse/archived data can require more scans.
-- Private tuple contract (at most 51 ordered rows): relationship ID, provider,
-- client name, business name, status, account ID, account name, connected at,
-- verified at. The server exposes 50 objects and derives the cursor from row 50
-- only when the 51st lookahead row exists. No credentials or history are read.
create function public.read_current_client_advertising_connections(p_workspace_id uuid, p_user_id uuid, p_relationship_id uuid DEFAULT NULL::uuid, p_after_relationship uuid DEFAULT NULL::uuid, p_after_provider text DEFAULT NULL::text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
 SET plan_cache_mode TO 'force_custom_plan'
AS $function$
declare actor_role text; permitted uuid[]; allowed jsonb; accounts json;
begin
 select m.role into actor_role from public.workspace_memberships m
 join public.workspaces w on w.id=m.workspace_id and w.status='active'
 where m.workspace_id=p_workspace_id and m.user_id=p_user_id;
 if actor_role is null then return json_build_object('failure','access'); end if;
 if (p_after_relationship is null) <> (p_after_provider is null)
    or (p_after_provider is not null and p_after_provider not in ('google_ads','meta_ads','windsor')) then
  return json_build_object('failure','cursor');
 end if;
 -- Reuse the canonical current setup scope, including explicit grants and
 -- shared-service assignments. Never infer staff access from a provider row.
 if actor_role not in ('owner','admin') then
  allowed:=public.manage_client_ghl_connection_v2(p_workspace_id,p_user_id,'list',p_relationship_id);
  if jsonb_typeof(allowed) is distinct from 'array' then return json_build_object('failure','access'); end if;
  select array_agg((item->>'relationshipId')::uuid) into permitted from jsonb_array_elements(allowed) item;
  if coalesce(cardinality(permitted),0)=0 then return '[]'::json; end if;
 end if;
 with candidates as (
  (select c.relationship_id,'google_ads'::text provider,c.status,c.customer_id account_id,c.account_name,c.connected_at,c.last_verified_at,r.primary_person_name,r.business_name
   from public.relationship_google_ads_connections c join public.relationships r on r.workspace_id=c.workspace_id and r.id=c.relationship_id and r.status<>'archived' and r.id>=coalesce(p_after_relationship,'00000000-0000-0000-0000-000000000000'::uuid) and (p_relationship_id is null or r.id=p_relationship_id)
   where c.workspace_id=p_workspace_id and (p_relationship_id is null or c.relationship_id=p_relationship_id)
    and (actor_role in ('owner','admin') or c.relationship_id=any(permitted))
    and (p_after_relationship is null or (c.relationship_id,'google_ads'::text)>(p_after_relationship,p_after_provider))
   order by c.relationship_id limit 51)
  union all
  (select c.relationship_id,'meta_ads'::text,
    case when c.status='connected' and c.access_token_expires_at<=now() then 'needs_attention' else c.status end,
    c.facebook_user_id,c.facebook_user_name,c.connected_at,c.last_verified_at,r.primary_person_name,r.business_name
   from public.relationship_meta_ads_connections c join public.relationships r on r.workspace_id=c.workspace_id and r.id=c.relationship_id and r.status<>'archived' and r.id>=coalesce(p_after_relationship,'00000000-0000-0000-0000-000000000000'::uuid) and (p_relationship_id is null or r.id=p_relationship_id)
   where c.workspace_id=p_workspace_id and (p_relationship_id is null or c.relationship_id=p_relationship_id)
    and (actor_role in ('owner','admin') or c.relationship_id=any(permitted))
    and (p_after_relationship is null or (c.relationship_id,'meta_ads'::text)>(p_after_relationship,p_after_provider))
   order by c.relationship_id limit 51)
  union all
  (select c.relationship_id,'windsor'::text,
    case when c.status='connected' and (c.reporting_verified_at is null or c.last_report_error is not null) then 'needs_attention' else c.status end,
    c.account_id,c.account_name,c.connected_at,c.reporting_verified_at,r.primary_person_name,r.business_name
   from public.relationship_windsor_meta_ads_connections c join public.relationships r on r.workspace_id=c.workspace_id and r.id=c.relationship_id and r.status<>'archived' and r.id>=coalesce(p_after_relationship,'00000000-0000-0000-0000-000000000000'::uuid) and (p_relationship_id is null or r.id=p_relationship_id)
   where c.workspace_id=p_workspace_id and (p_relationship_id is null or c.relationship_id=p_relationship_id)
    and (actor_role in ('owner','admin') or c.relationship_id=any(permitted))
    and (p_after_relationship is null or (c.relationship_id,'windsor'::text)>(p_after_relationship,p_after_provider))
   order by c.relationship_id limit 51)
 ), page as (
  select * from candidates order by relationship_id,provider limit 51
 ) select coalesce(json_agg(json_build_array(relationship_id,provider,primary_person_name,business_name,status,account_id,account_name,connected_at,last_verified_at) order by relationship_id,provider),'[]'::json) into accounts from page;
 return accounts;
end $function$;
revoke all on function public.read_current_client_advertising_connections(uuid,uuid,uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.read_current_client_advertising_connections(uuid,uuid,uuid,uuid,text) to service_role;
notify pgrst,'reload schema';
commit;
