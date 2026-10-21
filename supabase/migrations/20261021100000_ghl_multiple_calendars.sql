-- Multiple selected calendars; legacy single-calendar bindings remain readable.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';
alter table client_portal_secure.ghl_connections add column selected_calendars jsonb,
 add column calendar_selection_request uuid, add column calendar_selection_hash text;
alter table client_portal_secure.ghl_appointment_profiles add column calendars jsonb;
create function client_portal_secure.valid_calendar_choices(v jsonb) returns boolean
language sql immutable set search_path='' as $$
 select case when jsonb_typeof(v) is distinct from 'array' then false else coalesce(jsonb_array_length(v) between 1 and 10
 and not exists(select 1 from jsonb_array_elements(v) x where jsonb_typeof(x) is distinct from 'object'
  or coalesce(x->>'id','') !~ '^[a-zA-Z0-9_-]{10,80}$' or jsonb_typeof(x->'name') is distinct from 'string' or length(x->>'name') not between 1 and 200
  or (x ? 'isActive' and jsonb_typeof(x->'isActive') is distinct from 'boolean') or x-'id'-'name'-'isActive'<>'{}')
 and (select count(distinct x->>'id') from jsonb_array_elements(v) x)=jsonb_array_length(v),false) end
$$;
create function client_portal_secure.calendar_choices(v jsonb,primary_id text,primary_name text) returns jsonb
language sql immutable set search_path='' as $$
 select coalesce(v,case when primary_id is not null then jsonb_build_array(jsonb_build_object('id',primary_id,'name',coalesce(primary_name,primary_id))) else '[]'::jsonb end)
$$;
alter table client_portal_secure.ghl_connections add constraint ghl_selected_calendars_valid check(selected_calendars is null or (client_portal_secure.valid_calendar_choices(selected_calendars) and selected_calendars->0->>'id'=selected_calendar_id));
alter table client_portal_secure.ghl_appointment_profiles add constraint ghl_profile_calendars_valid check(calendars is null or (client_portal_secure.valid_calendar_choices(calendars) and calendars->0->>'id'=calendar_id));
revoke all on function client_portal_secure.valid_calendar_choices(jsonb),client_portal_secure.calendar_choices(jsonb,text,text) from public,anon,authenticated;
grant execute on function client_portal_secure.valid_calendar_choices(jsonb),client_portal_secure.calendar_choices(jsonb,text,text) to service_role;
create or replace function client_portal_secure.clear_changed_location_calendar() returns trigger
language plpgsql security definer set search_path='' as $$ begin
 if new.location_id is distinct from old.location_id then new.selected_calendar_id:=null;new.selected_calendar_name:=null;end if;
 if new.selected_calendar_id is distinct from old.selected_calendar_id or new.location_id is distinct from old.location_id then new.selected_calendars:=null;new.calendar_selection_request:=null;new.calendar_selection_hash:=null;end if;
 return new;
end $$;

create or replace function public.client_portal_ghl_calendar(p_session_token text,p_workspace_id uuid,p_action text default 'read',p_operation_id uuid default null,p_month text default null,p_calendar_id text default null,p_snapshot jsonb default null,p_error text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
 access jsonb;
 target uuid;
 connection client_portal_secure.ghl_connections%rowtype;
 saved client_portal_secure.ghl_calendar_snapshots%rowtype;
 secret_value text; choices jsonb; selected jsonb;
begin
 access := public.client_portal_ghl(p_session_token,p_workspace_id,'read');
 if access ? 'failure' then return access; end if;
 if not coalesce((access->>'connected')::boolean,false) then return jsonb_build_object('failure','credentials_missing'); end if;
 select relationship_id into target from public.client_portal_sessions where session_token=p_session_token and workspace_id=p_workspace_id;
 if p_action not in ('read','begin','finish','fail') then return jsonb_build_object('failure','invalid_action'); end if;
 if p_action<>'read' then perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('portal-ghl:'||target::text,0)); end if;
 select * into connection from client_portal_secure.ghl_connections where relationship_id=target and workspace_id=p_workspace_id;
 if connection.vault_secret_id is null then return jsonb_build_object('failure','credentials_missing'); end if;
 choices:=client_portal_secure.calendar_choices(connection.selected_calendars,connection.selected_calendar_id,connection.selected_calendar_name);
 if p_action<>'read' and p_calendar_id is not null and not exists(select 1 from jsonb_array_elements(choices) x where x->>'id'=p_calendar_id) then return jsonb_build_object('failure','access');end if;
 select x into selected from jsonb_array_elements(choices) x where x->>'id'=coalesce(p_calendar_id,connection.selected_calendar_id);
 select * into saved from client_portal_secure.ghl_calendar_snapshots where relationship_id=target;
 if p_action='begin' then
  if p_operation_id is null or p_month is null or p_month !~ '^20[0-9]{2}-(0[1-9]|1[0-2])$' then return jsonb_build_object('failure','response'); end if;
  if connection.lease_until>now() or saved.lease_until>now() then return jsonb_build_object('failure','busy'); end if;
  if saved.attempted_at>now()-interval '2 seconds' or (saved.requested_month=p_month and saved.requested_calendar is not distinct from p_calendar_id and saved.attempted_at>now()-interval '10 seconds') then return jsonb_build_object('failure','cooldown'); end if;
  p_calendar_id:=selected->>'id';
  insert into client_portal_secure.ghl_calendar_snapshots(relationship_id,operation_id,lease_until,attempted_at,revision,requested_month,requested_calendar)
  values(target,p_operation_id,now()+interval '45 seconds',now(),connection.calendar_revision,p_month,p_calendar_id)
  on conflict(relationship_id) do update set operation_id=excluded.operation_id,lease_until=excluded.lease_until,attempted_at=excluded.attempted_at,revision=excluded.revision,requested_month=excluded.requested_month,requested_calendar=excluded.requested_calendar;
  select decrypted_secret into secret_value from vault.decrypted_secrets where id=connection.vault_secret_id;
  return jsonb_build_object('locationId',connection.location_id,'privateToken',secret_value,'binding',case when connection.selected_calendar_id is not null then jsonb_build_object('calendarId',selected->>'id','calendarName',selected->>'name') when saved.snapshot->>'source'='owner-user' and saved.last_error is distinct from 'owner_unavailable' then jsonb_build_object('companyId',saved.snapshot->'companyId','timezone',saved.snapshot->'timezone','owner',saved.snapshot->'owner') else null end);
 elsif p_action in ('finish','fail') then
  if p_operation_id is null or saved.operation_id is distinct from p_operation_id or saved.revision is distinct from connection.calendar_revision or saved.lease_until<=now() then return jsonb_build_object('failure','changed'); end if;
  if p_action='finish' then
   if p_snapshot is null or jsonb_typeof(p_snapshot)<>'object' or octet_length(p_snapshot::text)>=524288
    or (case when connection.selected_calendar_id is null then p_snapshot->>'source' is distinct from 'owner-user' else p_snapshot->>'source' is distinct from 'booking-calendar' or p_snapshot->>'calendarId' is distinct from saved.requested_calendar or not exists(select 1 from jsonb_array_elements(choices) x where x->>'id'=saved.requested_calendar) end)
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
 return jsonb_build_object('revision',connection.calendar_revision,'calendars',choices,'snapshot',case when saved.revision=connection.calendar_revision and (p_calendar_id is null or saved.snapshot->>'calendarId'=p_calendar_id) then saved.snapshot end,'refreshedAt',saved.refreshed_at,'error',saved.last_error,'busy',coalesce(saved.lease_until>now(),false));
end;
$$;

do $migration$
declare d text; needle text;
begin
 d:=pg_get_functiondef('public.ghl_oauth_connection(text,jsonb)'::regprocedure);
 needle:='  op:=gen_random_uuid();';
 if position(needle in d)=0 then raise exception 'Unexpected OAuth connect';end if;
 d:=replace(d,needle,$r$  if p_input ? 'calendars' and (not client_portal_secure.valid_calendar_choices(p_input->'calendars') or p_input->'calendars'->0->>'id' is distinct from p_input->>'calendarId') then return jsonb_build_object('failure','response');end if;
  op:=gen_random_uuid();$r$);
 needle:='  insert into client_portal_secure.ghl_oauth_credentials';
 if position(needle in d)=0 then raise exception 'Unexpected OAuth credential save';end if;
 d:=replace(d,needle,$r$  update client_portal_secure.ghl_connections set selected_calendars=coalesce(p_input->'calendars',jsonb_build_array(jsonb_build_object('id',p_input->>'calendarId','name',p_input->>'calendarName'))),calendar_selection_request=null,calendar_selection_hash=null where relationship_id=a.relationship_id;
  insert into client_portal_secure.ghl_oauth_credentials$r$);
 execute d;
end $migration$;

revoke all on function public.client_portal_ghl_calendar(text,uuid,text,uuid,text,text,jsonb,text) from public,anon,authenticated;
grant execute on function public.client_portal_ghl_calendar(text,uuid,text,uuid,text,text,jsonb,text) to service_role;
-- Existing saved credentials can edit selections without installing/authorising again.
create function public.ghl_calendar_selection(p_action text,p_input jsonb default '{}') returns jsonb
language plpgsql security definer set search_path='' as $$
declare c client_portal_secure.ghl_connections%rowtype; result jsonb; item jsonb; choices jsonb; secret_value text; fingerprint text;
begin
 if auth.role() is distinct from 'service_role' then return jsonb_build_object('failure','access');end if;
 if p_action not in('read','save') or jsonb_typeof(p_input) is distinct from 'object' then return jsonb_build_object('failure','input');end if;
 result:=public.read_client_ghl_connections((p_input->>'workspaceId')::uuid,(p_input->>'userId')::uuid,(p_input->>'relationshipId')::uuid);
 select value into item from jsonb_array_elements(coalesce(result->'accounts','[]')) where value->>'relationshipId'=p_input->>'relationshipId' and not coalesce((value->>'archived')::boolean,false);
 if item is null then return jsonb_build_object('failure','access');end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('client-ghl:'||(p_input->>'relationshipId'),0));
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('portal-ghl:'||(p_input->>'relationshipId'),0));
 select * into c from client_portal_secure.ghl_connections where workspace_id=(p_input->>'workspaceId')::uuid and relationship_id=(p_input->>'relationshipId')::uuid for update;
 if c.vault_secret_id is null then return jsonb_build_object('failure','connection');end if;
 if p_action='save' then
  choices:=p_input->'calendars';
  if not client_portal_secure.valid_calendar_choices(choices) or p_input->>'requestId' is null then return jsonb_build_object('failure','response');end if;
  fingerprint:=encode(extensions.digest(choices::text,'sha256'),'hex');
  if c.calendar_selection_request=(p_input->>'requestId')::uuid then
   if c.calendar_selection_hash is distinct from fingerprint then return jsonb_build_object('failure','changed');end if;
   return jsonb_build_object('connected',true,'revision',c.calendar_revision,'calendars',c.selected_calendars);
  end if;
 end if;
 if p_action='read' and p_input->>'requestId' is not null and c.calendar_selection_request=(p_input->>'requestId')::uuid then
  if (select jsonb_agg(x->>'id' order by x->>'id') from jsonb_array_elements(c.selected_calendars) x) is distinct from (select jsonb_agg(x order by x) from jsonb_array_elements_text(p_input->'calendarIds') x) then return jsonb_build_object('failure','changed');end if;
  return jsonb_build_object('connected',true,'revision',c.calendar_revision,'calendars',c.selected_calendars);
 end if;
 if c.calendar_revision::text is distinct from p_input->>'expectedRevision' then return jsonb_build_object('failure','changed');end if;
 if p_action='read' then
  select decrypted_secret into secret_value from vault.decrypted_secrets where id=c.vault_secret_id;
  return jsonb_build_object('locationId',c.location_id,'privateToken',secret_value,'revision',c.calendar_revision,'calendars',client_portal_secure.calendar_choices(c.selected_calendars,c.selected_calendar_id,c.selected_calendar_name));
 end if;
 if c.lease_until>now() then return jsonb_build_object('failure','busy');end if;
 -- Preserve one canonical profile/appointment history whenever its anchor is retained.
 if exists(select 1 from jsonb_array_elements(choices) x where x->>'id'=c.selected_calendar_id) then
  select jsonb_agg(x order by (x->>'id'=c.selected_calendar_id) desc,ordinal) into choices from jsonb_array_elements(choices) with ordinality a(x,ordinal);
 end if;
 update client_portal_secure.ghl_connections set selected_calendar_id=choices->0->>'id',selected_calendar_name=choices->0->>'name',calendar_revision=gen_random_uuid() where relationship_id=c.relationship_id returning * into c;
 -- Separate update: the legacy before-update trigger clears a changed anchor.
 update client_portal_secure.ghl_connections set selected_calendars=choices,calendar_selection_request=(p_input->>'requestId')::uuid,calendar_selection_hash=fingerprint where relationship_id=c.relationship_id;
 update client_portal_secure.ghl_appointment_profiles set detection_enabled=false,sending_enabled=false,sending_activated_at=null where workspace_id=c.workspace_id and relationship_id=c.relationship_id;
 return jsonb_build_object('connected',true,'revision',c.calendar_revision,'calendars',choices);
end $$;
revoke all on function public.ghl_calendar_selection(text,jsonb) from public,anon,authenticated;
grant execute on function public.ghl_calendar_selection(text,jsonb) to service_role;

do $migration$
declare d text; needle text;
begin
 d:=pg_get_functiondef('client_portal_secure.ghl_appointment_profile_json(client_portal_secure.ghl_appointment_profiles)'::regprocedure);
 needle:=$n$'calendarName',p.calendar_name,$n$;
 if position(needle in d)=0 then raise exception 'Unexpected profile projection';end if;
 d:=replace(d,needle,needle||$n$'calendars',client_portal_secure.calendar_choices(p.calendars,p.calendar_id,p.calendar_name),$n$);execute d;
 d:=pg_get_functiondef('public.ghl_appointment_automation(text,jsonb)'::regprocedure);
 needle:='  return jsonb_build_object(''profile'',client_portal_secure.ghl_appointment_profile_json(p));';
 if position(needle in d)=0 then raise exception 'Unexpected profile configure';end if;
 d:=replace(d,needle,$r$  update client_portal_secure.ghl_appointment_profiles set calendars=client_portal_secure.calendar_choices(c.selected_calendars,c.selected_calendar_id,c.selected_calendar_name) where id=p.id returning * into p;
  return jsonb_build_object('profile',client_portal_secure.ghl_appointment_profile_json(p));$r$);
 needle:='pr.calendar_id=p_input->>''calendarId''';
 if position(needle in d)=0 then raise exception 'Unexpected calendar intake';end if;
 d:=replace(d,needle,$r$(pr.calendar_id=p_input->>'calendarId' or pr.calendars @> jsonb_build_array(jsonb_build_object('id',p_input->>'calendarId')))$r$);
 -- Retained history only routes an out-of-selection move while its previous
 -- calendar is still selected. Unselecting a calendar must not announce removals.
 needle:='a.profile_id=pr.id and a.appointment_id=p_input->>''appointmentId''';
 if position(needle in d)=0 then raise exception 'Unexpected retained appointment intake';end if;
 d:=replace(d,needle,needle||$r$ and (pr.calendar_id=a.snapshot->>'calendarId' or pr.calendars @> jsonb_build_array(jsonb_build_object('id',a.snapshot->>'calendarId')))$r$);
 needle:='next_snapshot->>''calendarId'' is distinct from p.calendar_id';
 if position(needle in d)=0 then raise exception 'Unexpected snapshot calendar fence';end if;
 d:=replace(d,needle,$r$not exists(select 1 from jsonb_array_elements(client_portal_secure.calendar_choices(p.calendars,p.calendar_id,p.calendar_name)) x where x->>'id'=next_snapshot->>'calendarId')$r$);
 -- Older deployed workers cannot interpret multiple-calendar membership. Fail closed
 -- before they can derive removals or supersede valid notifications during rollback.
 needle:='  select * into e from client_portal_secure.ghl_appointment_inbox where id=e.id for update;';
 if position(needle in d)=0 then raise exception 'Unexpected event consumer fence';end if;
 d:=replace(d,needle,needle||$r$
  if p_action in('event_context','apply_event') and jsonb_array_length(coalesce(p.calendars,'[]'))>1 and coalesce(p_input->>'processorVersion','1')<>'2' then return jsonb_build_object('failure','processor_version');end if;$r$);
 needle:='  select * into o from client_portal_secure.ghl_appointment_outbox where id=o.id for update;';
 if position(needle in d)=0 then raise exception 'Unexpected delivery consumer fence';end if;
 d:=replace(d,needle,needle||$r$
  if p_action in('notification_context','begin_dispatch') and jsonb_array_length(coalesce(p.calendars,'[]'))>1 and coalesce(p_input->>'processorVersion','1')<>'2' then return jsonb_build_object('failure','processor_version');end if;$r$);
 execute d;
end $migration$;
notify pgrst,'reload schema';
commit;
