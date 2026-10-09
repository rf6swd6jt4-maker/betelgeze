-- Staff-owned calendar choice; retain existing owner schedules until explicitly edited.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';
alter table client_portal_secure.ghl_connections add column selected_calendar_id text,
 add column selected_calendar_name text;

-- Legacy credential replacement must not carry a calendar into another location.
create function client_portal_secure.clear_changed_location_calendar() returns trigger
language plpgsql security definer set search_path='' as $$ begin
 if new.location_id is distinct from old.location_id then
  new.selected_calendar_id:=null; new.selected_calendar_name:=null;
 end if;
 return new;
end $$;
revoke all on function client_portal_secure.clear_changed_location_calendar() from public,anon,authenticated,service_role;
create trigger clear_changed_location_calendar before update on client_portal_secure.ghl_connections
for each row execute function client_portal_secure.clear_changed_location_calendar();

create function public.manage_client_ghl_connection_v2(
 p_workspace_id uuid,p_user_id uuid,p_action text,p_relationship_id uuid default null,
 p_operation_id uuid default null,p_account_type text default null,p_location_id text default null,
 p_private_token text default null,p_location_name text default null,p_metrics jsonb default null,
 p_error text default null,p_expected_revision uuid default null,p_calendar_id text default null,p_calendar_name text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare items jsonb; result jsonb; saved client_portal_secure.ghl_connections%rowtype; secret_value text;
begin
 items:=public.manage_client_ghl_connection(p_workspace_id,p_user_id,'list');
 if jsonb_typeof(items) is distinct from 'array' then return items; end if;
 if p_action='list' then
  return coalesce((select jsonb_agg(item || jsonb_build_object('revision',case when c.vault_secret_id is not null then c.calendar_revision else null end,'calendarId',c.selected_calendar_id,'calendarName',c.selected_calendar_name) order by ordinal)
   from jsonb_array_elements(items) with ordinality a(item,ordinal)
   left join client_portal_secure.ghl_connections c on c.relationship_id=(item->>'relationshipId')::uuid and c.workspace_id=p_workspace_id),'[]'::jsonb);
 end if;
 if not exists(select 1 from jsonb_array_elements(items) item where item->>'relationshipId'=p_relationship_id::text) then return jsonb_build_object('failure','access'); end if;
 if p_action not in ('credentials','begin_connect','begin_refresh','finish','fail','remove') then return jsonb_build_object('failure','invalid_action'); end if;
 -- Same lock order for edits/removal and portal snapshots. Legacy connect writes
 -- are serialized by the client lock; portal finish cannot race invalidation.
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('client-ghl:'||p_relationship_id::text,0));
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('portal-ghl:'||p_relationship_id::text,0));
 select * into saved from client_portal_secure.ghl_connections where workspace_id=p_workspace_id and relationship_id=p_relationship_id;
 if p_action in ('credentials','begin_connect','remove') and
  (case when saved.vault_secret_id is not null then saved.calendar_revision else null end) is distinct from p_expected_revision then return jsonb_build_object('failure','changed'); end if;
 if p_action='credentials' then
  if saved.vault_secret_id is not null then select decrypted_secret into secret_value from vault.decrypted_secrets where id=saved.vault_secret_id; end if;
  return jsonb_build_object('locationId',saved.location_id,'privateToken',secret_value);
 elsif p_action='remove' then
  -- Remove only this BE link and its managed secret, not provider/client history.
  delete from client_portal_secure.ghl_connections where workspace_id=p_workspace_id and relationship_id=p_relationship_id;
  return jsonb_build_object('removed',true);
 elsif p_action='finish' and p_calendar_id is not null then
  if p_calendar_id !~ '^[a-zA-Z0-9_-]{10,80}$' or p_calendar_name is null or length(p_calendar_name) not between 1 and 200 then return jsonb_build_object('failure','response'); end if;
 end if;
 result:=public.manage_client_ghl_connection(p_workspace_id,p_user_id,p_action,p_relationship_id,p_operation_id,p_account_type,p_location_id,p_private_token,p_location_name,p_metrics,p_error);
 if result ? 'failure' then return result; end if;
 if p_action='finish' then
  update client_portal_secure.ghl_connections set
   selected_calendar_id=coalesce(p_calendar_id,selected_calendar_id),
   selected_calendar_name=coalesce(p_calendar_name,selected_calendar_name),
   calendar_revision=case when p_private_token is not null or p_calendar_id is not null then gen_random_uuid() else calendar_revision end
  where workspace_id=p_workspace_id and relationship_id=p_relationship_id;
 end if;
 return result;
end $$;
revoke all on function public.manage_client_ghl_connection_v2(uuid,uuid,text,uuid,uuid,text,text,text,text,jsonb,text,uuid,text,text) from public,anon,authenticated;
grant execute on function public.manage_client_ghl_connection_v2(uuid,uuid,text,uuid,uuid,text,text,text,text,jsonb,text,uuid,text,text) to service_role;
create or replace function public.client_portal_ghl_calendar(p_session_token text,p_workspace_id uuid,p_action text default 'read',p_operation_id uuid default null,p_month text default null,p_calendar_id text default null,p_snapshot jsonb default null,p_error text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
 access jsonb;
 target uuid;
 connection client_portal_secure.ghl_connections%rowtype;
 saved client_portal_secure.ghl_calendar_snapshots%rowtype;
 secret_value text;
begin
 access := public.client_portal_ghl(p_session_token,p_workspace_id,'read');
 if access ? 'failure' then return access; end if;
 if not coalesce((access->>'connected')::boolean,false) then return jsonb_build_object('failure','credentials_missing'); end if;
 select relationship_id into target from public.client_portal_sessions where session_token=p_session_token and workspace_id=p_workspace_id;
 if p_action not in ('read','begin','finish','fail') then return jsonb_build_object('failure','invalid_action'); end if;
 if p_action<>'read' then perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('portal-ghl:'||target::text,0)); end if;
 select * into connection from client_portal_secure.ghl_connections where relationship_id=target and workspace_id=p_workspace_id;
 if connection.vault_secret_id is null then return jsonb_build_object('failure','credentials_missing'); end if;
 select * into saved from client_portal_secure.ghl_calendar_snapshots where relationship_id=target;
 if p_action='begin' then
  if p_operation_id is null or p_month is null or p_month !~ '^20[0-9]{2}-(0[1-9]|1[0-2])$' or p_calendar_id is not null then return jsonb_build_object('failure','response'); end if;
  if connection.lease_until>now() or saved.lease_until>now() then return jsonb_build_object('failure','busy'); end if;
  if saved.attempted_at>now()-interval '2 seconds' or (saved.requested_month=p_month and saved.requested_calendar is not distinct from p_calendar_id and saved.attempted_at>now()-interval '10 seconds') then return jsonb_build_object('failure','cooldown'); end if;
  insert into client_portal_secure.ghl_calendar_snapshots(relationship_id,operation_id,lease_until,attempted_at,revision,requested_month,requested_calendar)
  values(target,p_operation_id,now()+interval '45 seconds',now(),connection.calendar_revision,p_month,p_calendar_id)
  on conflict(relationship_id) do update set operation_id=excluded.operation_id,lease_until=excluded.lease_until,attempted_at=excluded.attempted_at,revision=excluded.revision,requested_month=excluded.requested_month,requested_calendar=excluded.requested_calendar;
  select decrypted_secret into secret_value from vault.decrypted_secrets where id=connection.vault_secret_id;
  return jsonb_build_object('locationId',connection.location_id,'privateToken',secret_value,'binding',case when connection.selected_calendar_id is not null then jsonb_build_object('calendarId',connection.selected_calendar_id,'calendarName',connection.selected_calendar_name) when saved.snapshot->>'source'='owner-user' and saved.last_error is distinct from 'owner_unavailable' then jsonb_build_object('companyId',saved.snapshot->'companyId','timezone',saved.snapshot->'timezone','owner',saved.snapshot->'owner') else null end);
 elsif p_action in ('finish','fail') then
  if p_operation_id is null or saved.operation_id is distinct from p_operation_id or saved.revision is distinct from connection.calendar_revision or saved.lease_until<=now() then return jsonb_build_object('failure','changed'); end if;
  if p_action='finish' then
   if p_snapshot is null or jsonb_typeof(p_snapshot)<>'object' or octet_length(p_snapshot::text)>=524288
    or (case when connection.selected_calendar_id is null then p_snapshot->>'source' is distinct from 'owner-user' else p_snapshot->>'source' is distinct from 'booking-calendar' or p_snapshot->>'calendarId' is distinct from connection.selected_calendar_id end)
    or jsonb_typeof(p_snapshot->'events') is distinct from 'array' or jsonb_array_length(p_snapshot->'events')>1000
    or jsonb_typeof(p_snapshot->'owner') is distinct from 'object'
    or coalesce(p_snapshot->'owner'->>'id','') !~ '^[a-zA-Z0-9_-]{10,80}$'
    or coalesce(p_snapshot->>'companyId','') !~ '^[a-zA-Z0-9_-]{10,80}$'
    or jsonb_typeof(p_snapshot->'owner'->'name') is distinct from 'string'
    or jsonb_typeof(p_snapshot->'timezone') is distinct from 'string'
    or p_snapshot->>'month' is distinct from saved.requested_month then return jsonb_build_object('failure','response'); end if;
   update client_portal_secure.ghl_calendar_snapshots set snapshot=p_snapshot||jsonb_build_object('snapshotId',p_operation_id),refreshed_at=now(),last_error=null,operation_id=null,lease_until=null where relationship_id=target returning * into saved;
  else
   update client_portal_secure.ghl_calendar_snapshots set last_error=case when p_error in ('permissions','credentials','location','rate_limit','response','unavailable','owner_unavailable') then p_error else 'unavailable' end,operation_id=null,lease_until=null where relationship_id=target returning * into saved;
  end if;
 end if;
 return jsonb_build_object('revision',connection.calendar_revision,'snapshot',saved.snapshot,'refreshedAt',saved.refreshed_at,'error',saved.last_error,'busy',coalesce(saved.lease_until>now(),false));
end;
$$;
revoke all on function public.client_portal_ghl_calendar(text,uuid,text,uuid,text,text,jsonb,text) from public,anon,authenticated;
grant execute on function public.client_portal_ghl_calendar(text,uuid,text,uuid,text,text,jsonb,text) to service_role;

create or replace function public.client_portal_ghl_calendar_names(p_session_token text,p_workspace_id uuid,p_action text,p_snapshot_id uuid,p_operation_id uuid default null,p_labels jsonb default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
 access jsonb;
 target uuid;
 connection client_portal_secure.ghl_connections%rowtype;
 saved client_portal_secure.ghl_calendar_snapshots%rowtype;
 secret_value text;
 item record;
begin
 access := public.client_portal_ghl(p_session_token,p_workspace_id,'read');
 if access ? 'failure' then return access; end if;
 if not coalesce((access->>'connected')::boolean,false) then return jsonb_build_object('failure','credentials_missing'); end if;
 if p_action not in ('begin','finish','fail') or p_snapshot_id is null or p_operation_id is null then return jsonb_build_object('failure','response'); end if;
 select relationship_id into target from public.client_portal_sessions where session_token=p_session_token and workspace_id=p_workspace_id;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('portal-ghl:'||target::text,0));
 select * into connection from client_portal_secure.ghl_connections where relationship_id=target and workspace_id=p_workspace_id;
 select * into saved from client_portal_secure.ghl_calendar_snapshots where relationship_id=target;
 if connection.vault_secret_id is null then return jsonb_build_object('failure','credentials_missing'); end if;
 if saved.snapshot->>'snapshotId' is distinct from p_snapshot_id::text or saved.revision is distinct from connection.calendar_revision or coalesce(saved.snapshot->>'source','') not in ('owner-user','booking-calendar') then return jsonb_build_object('failure','changed'); end if;
 if p_action='begin' then
  if saved.snapshot->>'namesStatus' is distinct from 'pending' then
   return jsonb_build_object('skipped',true,'revision',connection.calendar_revision,'snapshot',saved.snapshot,'refreshedAt',saved.refreshed_at,'error',saved.last_error,'busy',false);
  end if;
  if jsonb_typeof(saved.snapshot->'eventContacts') is distinct from 'object' then return jsonb_build_object('failure','response'); end if;
  if saved.names_base_snapshot_id=p_snapshot_id then
   if saved.names_lease_until>now() then return jsonb_build_object('failure','busy'); end if;
   if saved.names_attempted_at>now()-interval '10 seconds' then return jsonb_build_object('failure','cooldown'); end if;
  end if;
  update client_portal_secure.ghl_calendar_snapshots set names_operation_id=p_operation_id,names_lease_until=now()+interval '30 seconds',names_attempted_at=now(),names_base_snapshot_id=p_snapshot_id where relationship_id=target;
  select decrypted_secret into secret_value from vault.decrypted_secrets where id=connection.vault_secret_id;
  return jsonb_build_object('locationId',connection.location_id,'privateToken',secret_value,'snapshot',saved.snapshot);
 end if;
 if saved.names_operation_id is distinct from p_operation_id or saved.names_base_snapshot_id is distinct from p_snapshot_id or saved.names_lease_until<=now() then return jsonb_build_object('failure','changed'); end if;
 if p_action='finish' then
  if p_labels is null or jsonb_typeof(p_labels)<>'object' or octet_length(p_labels::text)>300000 or (select count(*) from jsonb_each(p_labels))>1000 then return jsonb_build_object('failure','response'); end if;
  for item in select * from jsonb_each(p_labels) loop
   if item.key !~ '^[a-zA-Z0-9_-]{10,80}$' or not exists(select 1 from jsonb_each_text(saved.snapshot->'eventContacts') pair where pair.value=item.key)
    or jsonb_typeof(item.value) is distinct from 'object' or jsonb_typeof(item.value->'name') is distinct from 'string'
    or length(item.value->>'name') not between 1 and 160
    or (item.value ? 'city' and (jsonb_typeof(item.value->'city') is distinct from 'string' or length(item.value->>'city') not between 1 and 100))
    or item.value - 'name' - 'city' <> '{}'::jsonb then return jsonb_build_object('failure','response'); end if;
  end loop;
  if octet_length((saved.snapshot||jsonb_build_object('contactLabels',p_labels))::text)>=524288 then return jsonb_build_object('failure','response'); end if;
  update client_portal_secure.ghl_calendar_snapshots set snapshot=snapshot||jsonb_build_object('contactLabels',p_labels,'namesStatus','ready'),names_operation_id=null,names_lease_until=null where relationship_id=target returning * into saved;
 else
  update client_portal_secure.ghl_calendar_snapshots set snapshot=snapshot||jsonb_build_object('namesStatus','unavailable'),names_operation_id=null,names_lease_until=null where relationship_id=target returning * into saved;
 end if;
 return jsonb_build_object('revision',connection.calendar_revision,'snapshot',saved.snapshot,'refreshedAt',saved.refreshed_at,'error',saved.last_error,'busy',coalesce(saved.lease_until>now(),false));
end;
$$;
revoke all on function public.client_portal_ghl_calendar_names(text,uuid,text,uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.client_portal_ghl_calendar_names(text,uuid,text,uuid,uuid,jsonb) to service_role;
notify pgrst,'reload schema';

commit;
