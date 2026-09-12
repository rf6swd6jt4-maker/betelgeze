-- Bounded, relationship-scoped calendar snapshot. Browser reads never call GHL.
alter table client_portal_secure.ghl_connections add column calendar_revision uuid not null default gen_random_uuid();
create table client_portal_secure.ghl_calendar_snapshots (
 relationship_id uuid primary key references client_portal_secure.ghl_connections(relationship_id) on delete cascade,
 snapshot jsonb,
 refreshed_at timestamptz,
 last_error text,
 operation_id uuid,
 lease_until timestamptz,
 attempted_at timestamptz,
 revision uuid,
 requested_month text,
 requested_calendar text,
 check(snapshot is null or (jsonb_typeof(snapshot)='object' and octet_length(snapshot::text)<524288))
);
alter table client_portal_secure.ghl_calendar_snapshots enable row level security;
revoke all on client_portal_secure.ghl_calendar_snapshots from public,anon,authenticated,service_role;

-- Replacing credentials invalidates earlier appointment data, even for the same location.
do $$
declare definition text; needle text;
begin
 definition := pg_get_functiondef('public.client_portal_ghl(text,uuid,text,uuid,text,text,text,jsonb,text)'::regprocedure);
 needle := substring(definition from 'location_name[[:space:]]*=[[:space:]]*p_location_name[[:space:]]*,');
 if needle is null then raise exception 'GHL connection function changed; review before migrating'; end if;
 execute replace(definition,needle,needle || ' calendar_revision = case when p_private_token is not null then gen_random_uuid() else calendar_revision end,');
end;
$$;
create function client_portal_secure.invalidate_ghl_calendar() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.calendar_revision is distinct from old.calendar_revision or new.vault_secret_id is distinct from old.vault_secret_id or new.location_id is distinct from old.location_id then
  delete from client_portal_secure.ghl_calendar_snapshots where relationship_id=new.relationship_id;
 end if;
 return new;
end;
$$;
revoke all on function client_portal_secure.invalidate_ghl_calendar() from public,anon,authenticated,service_role;
create trigger invalidate_ghl_calendar after update on client_portal_secure.ghl_connections for each row execute function client_portal_secure.invalidate_ghl_calendar();

create function public.client_portal_ghl_calendar(p_session_token text,p_workspace_id uuid,p_action text default 'read',p_operation_id uuid default null,p_month text default null,p_calendar_id text default null,p_snapshot jsonb default null,p_error text default null)
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
  if p_operation_id is null or p_month is null or p_month !~ '^20[0-9]{2}-(0[1-9]|1[0-2])$' or (p_calendar_id is not null and p_calendar_id !~ '^[a-zA-Z0-9_-]{10,80}$') then return jsonb_build_object('failure','response'); end if;
  if connection.lease_until>now() or saved.lease_until>now() then return jsonb_build_object('failure','busy'); end if;
  if saved.attempted_at>now()-interval '2 seconds' or (saved.requested_month=p_month and saved.requested_calendar is not distinct from p_calendar_id and saved.attempted_at>now()-interval '10 seconds') then return jsonb_build_object('failure','cooldown'); end if;
  insert into client_portal_secure.ghl_calendar_snapshots(relationship_id,operation_id,lease_until,attempted_at,revision,requested_month,requested_calendar)
  values(target,p_operation_id,now()+interval '45 seconds',now(),connection.calendar_revision,p_month,p_calendar_id)
  on conflict(relationship_id) do update set operation_id=excluded.operation_id,lease_until=excluded.lease_until,attempted_at=excluded.attempted_at,revision=excluded.revision,requested_month=excluded.requested_month,requested_calendar=excluded.requested_calendar;
  select decrypted_secret into secret_value from vault.decrypted_secrets where id=connection.vault_secret_id;
  return jsonb_build_object('locationId',connection.location_id,'privateToken',secret_value);
 elsif p_action in ('finish','fail') then
  if p_operation_id is null or saved.operation_id is distinct from p_operation_id or saved.revision is distinct from connection.calendar_revision or saved.lease_until<=now() then return jsonb_build_object('failure','changed'); end if;
  if p_action='finish' then
   if p_snapshot is null or jsonb_typeof(p_snapshot)<>'object' or octet_length(p_snapshot::text)>=524288 or jsonb_typeof(p_snapshot->'events') is distinct from 'array' or jsonb_array_length(p_snapshot->'events')>1000 or jsonb_typeof(p_snapshot->'calendars') is distinct from 'array' or jsonb_array_length(p_snapshot->'calendars')>100 or p_snapshot->>'month' is distinct from saved.requested_month or (saved.requested_calendar is not null and p_snapshot->>'calendarId' is distinct from saved.requested_calendar) then return jsonb_build_object('failure','response'); end if;
   update client_portal_secure.ghl_calendar_snapshots set snapshot=p_snapshot,refreshed_at=now(),last_error=null,operation_id=null,lease_until=null where relationship_id=target returning * into saved;
  else
   update client_portal_secure.ghl_calendar_snapshots set last_error=case when p_error in ('permissions','credentials','location','rate_limit','response','unavailable') then p_error else 'unavailable' end,operation_id=null,lease_until=null where relationship_id=target returning * into saved;
  end if;
 end if;
 return jsonb_build_object('revision',connection.calendar_revision,'snapshot',saved.snapshot,'refreshedAt',saved.refreshed_at,'error',saved.last_error,'busy',coalesce(saved.lease_until>now(),false));
end;
$$;
revoke all on function public.client_portal_ghl_calendar(text,uuid,text,uuid,text,text,jsonb,text) from public,anon,authenticated;
grant execute on function public.client_portal_ghl_calendar(text,uuid,text,uuid,text,text,jsonb,text) to service_role;
notify pgrst,'reload schema';
