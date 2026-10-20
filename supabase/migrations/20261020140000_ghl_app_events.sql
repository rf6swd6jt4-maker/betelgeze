-- Contact-only changes and uninstall events are durable, compact and paginated.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';
create table client_portal_secure.ghl_app_events (
 event_key text primary key check(length(event_key) between 1 and 256),
 payload_hash text not null check(payload_hash ~ '^[a-f0-9]{64}$'),
 event_type text not null check(event_type in('ContactUpdate','UNINSTALL')),
 app_id text not null, location_id text, company_id text, contact_id text,
 cursor_profile uuid not null default '00000000-0000-0000-0000-000000000000', cursor_appointment text not null default '',
 status text not null default 'pending' check(status in('pending','done')),
 received_at timestamptz not null default now(), finished_at timestamptz
);
create index ghl_app_events_pending on client_portal_secure.ghl_app_events(received_at,event_key) where status='pending';
create index ghl_appointment_snapshots_contact on client_portal_secure.ghl_appointment_snapshots(profile_id,(snapshot->>'contactId'),appointment_id) where removed_at is null;
alter table client_portal_secure.ghl_app_events enable row level security;
revoke all on client_portal_secure.ghl_app_events from public,anon,authenticated,service_role;
create function public.ghl_app_event(p_action text,p_input jsonb default '{}') returns jsonb
language plpgsql security definer set search_path='' as $$
declare e client_portal_secure.ghl_app_events%rowtype; row_value record; n integer:=0; result jsonb; wakes jsonb:='[]'; key_value text;
begin
 if auth.role() is distinct from 'service_role' then return jsonb_build_object('failure','access'); end if;
 if jsonb_typeof(p_input) is distinct from 'object' then return jsonb_build_object('failure','input'); end if;
 if p_action='ingest' then
  if p_input->>'eventType' is null or p_input->>'eventType' not in('ContactUpdate','UNINSTALL') or nullif(p_input->>'appId','') is null or nullif(p_input->>'eventKey','') is null or p_input->>'payloadHash' is null or p_input->>'payloadHash' !~ '^[a-f0-9]{64}$' then return jsonb_build_object('failure','input'); end if;
  if p_input->>'eventType'='ContactUpdate' and (nullif(p_input->>'locationId','') is null or nullif(p_input->>'contactId','') is null) then return jsonb_build_object('failure','input'); end if;
  if p_input->>'eventType'='UNINSTALL' and nullif(p_input->>'locationId','') is null and nullif(p_input->>'companyId','') is null then return jsonb_build_object('failure','input'); end if;
  insert into client_portal_secure.ghl_app_events(event_key,payload_hash,event_type,app_id,location_id,company_id,contact_id)
   values(p_input->>'eventKey',p_input->>'payloadHash',p_input->>'eventType',p_input->>'appId',p_input->>'locationId',p_input->>'companyId',p_input->>'contactId') on conflict(event_key) do nothing;
  if exists(select 1 from client_portal_secure.ghl_app_events where event_key=p_input->>'eventKey' and payload_hash<>p_input->>'payloadHash') then return jsonb_build_object('failure','event_key_collision'); end if;
  return jsonb_build_object('accepted',true);
 elsif p_action='drain' then
  select * into e from client_portal_secure.ghl_app_events where status='pending' and (p_input->>'eventKey' is null or event_key=p_input->>'eventKey') order by received_at,event_key limit 1 for update skip locked;
  if e.event_key is null then return jsonb_build_object('processed',0,'wakes','[]'::jsonb); end if;
  if e.event_type='ContactUpdate' then
   for row_value in select p.id,p.location_id,p.calendar_id,s.appointment_id from client_portal_secure.ghl_appointment_profiles p
    join client_portal_secure.ghl_appointment_snapshots s on s.profile_id=p.id
    where p.location_id=e.location_id and p.detection_enabled and s.removed_at is null and s.snapshot->>'contactId'=e.contact_id
     and (p.id,s.appointment_id)>(e.cursor_profile,e.cursor_appointment)
    order by p.id,s.appointment_id limit 20 loop
    key_value:='contact:'||encode(extensions.digest(e.event_key||':'||row_value.id::text||':'||row_value.appointment_id,'sha256'),'hex');
    result:=public.ghl_appointment_automation('ingest',jsonb_build_object('locationId',row_value.location_id,'calendarId',row_value.calendar_id,'appointmentId',row_value.appointment_id,'eventType','AppointmentUpdate','eventKey',key_value,'payloadHash',e.payload_hash,'payload',jsonb_build_object('source','ContactUpdate')));
    if result ? 'failure' then raise exception 'Contact appointment event could not be retained'; end if;
    wakes:=wakes||jsonb_build_array(jsonb_build_object('locationId',row_value.location_id,'appointmentId',row_value.appointment_id));
    e.cursor_profile:=row_value.id; e.cursor_appointment:=row_value.appointment_id; n:=n+1;
   end loop;
  else
   for row_value in select g.relationship_id,g.workspace_id from client_portal_secure.ghl_oauth_credentials g
    where g.app_id=e.app_id and ((e.location_id is not null and g.location_id=e.location_id) or (e.location_id is null and g.company_id=e.company_id)) and g.relationship_id>e.cursor_profile
    order by g.relationship_id limit 20 loop
    -- Same lock order as credential replacement/retirement/renewal.
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('client-ghl:'||row_value.relationship_id::text,0));
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('portal-ghl:'||row_value.relationship_id::text,0));
    update client_portal_secure.ghl_oauth_credentials set status='revoked',lease_token=null,lease_until=null,last_error='app_uninstalled' where relationship_id=row_value.relationship_id;
    update client_portal_secure.ghl_appointment_profiles set detection_enabled=false,sending_enabled=false,sending_activated_at=null,last_error='app_uninstalled' where workspace_id=row_value.workspace_id and relationship_id=row_value.relationship_id;
    e.cursor_profile:=row_value.relationship_id; n:=n+1;
   end loop;
  end if;
  update client_portal_secure.ghl_app_events set cursor_profile=e.cursor_profile,cursor_appointment=e.cursor_appointment,status=case when n<20 then 'done' else 'pending' end,finished_at=case when n<20 then now() end where event_key=e.event_key;
  return jsonb_build_object('processed',n,'wakes',wakes,'more',n=20);
 end if;
 return jsonb_build_object('failure','action');
end $$;
revoke all on function public.ghl_app_event(text,jsonb) from public,anon,authenticated;
grant execute on function public.ghl_app_event(text,jsonb) to service_role;
commit;
