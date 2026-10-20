-- Additive GHL lifecycle storage. No profile, scheduler or sending activation is
-- installed by this migration. Existing message encryption/consent guards remain.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';

create table client_portal_secure.ghl_appointment_profiles (
 id uuid primary key default gen_random_uuid(),
 workspace_id uuid not null references public.workspaces(id),
 relationship_id uuid not null references public.relationships(id),
 connection_revision uuid not null,
 location_id text not null, calendar_id text not null, calendar_name text not null,
 portal_origin text not null check(portal_origin ~ '^https://[a-z0-9.-]+$'),
 detection_enabled boolean not null default false,
 sending_enabled boolean not null default false,
 sending_activated_at timestamptz, tested_at timestamptz,
 include_notes boolean not null default false,
 reminder_minutes integer not null default 60 check(reminder_minutes between 5 and 10080),
 reconcile_cursor jsonb not null default '{}' check(octet_length(reconcile_cursor::text)<=8192),
 reconcile_due_at timestamptz not null default now(), reconcile_lease uuid, reconcile_lease_until timestamptz,
 last_error text, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(workspace_id,relationship_id,location_id,calendar_id),
 check(not sending_enabled or (detection_enabled and sending_activated_at is not null and tested_at is not null))
);
create unique index ghl_appointment_profiles_active on client_portal_secure.ghl_appointment_profiles(workspace_id,relationship_id) where detection_enabled;
create index ghl_appointment_profiles_location on client_portal_secure.ghl_appointment_profiles(location_id,calendar_id) where detection_enabled;
create index ghl_appointment_profiles_due on client_portal_secure.ghl_appointment_profiles(reconcile_due_at) where detection_enabled;

create table client_portal_secure.ghl_appointment_inbox (
 id uuid primary key default gen_random_uuid(),
 profile_id uuid not null references client_portal_secure.ghl_appointment_profiles(id),
 connection_revision uuid not null, appointment_id text not null,
 event_type text not null check(event_type in('AppointmentCreate','AppointmentUpdate','AppointmentDelete','Reconcile')),
 event_key text not null check(length(event_key) between 1 and 256),
 payload_hash text not null check(payload_hash ~ '^[a-f0-9]{64}$'),
 payload jsonb not null check(octet_length(payload::text)<=1048576),
 occurred_at timestamptz,
 status text not null default 'pending' check(status in('pending','leased','applied','ignored','quarantined')),
 attempts integer not null default 0, available_at timestamptz not null default now(),
 lease_token uuid, lease_until timestamptz, last_error text,
 received_at timestamptz not null default now(), finished_at timestamptz,
 unique(profile_id,event_key)
);
create index ghl_appointment_inbox_due on client_portal_secure.ghl_appointment_inbox(available_at,received_at,id) where status in('pending','leased');
create index ghl_appointment_inbox_fence on client_portal_secure.ghl_appointment_inbox(profile_id,appointment_id,received_at) where status in('pending','leased','quarantined');

create table client_portal_secure.ghl_appointment_snapshots (
 profile_id uuid not null references client_portal_secure.ghl_appointment_profiles(id),
 appointment_id text not null, version bigint not null check(version>0),
 connection_revision uuid not null,
 snapshot jsonb not null check(jsonb_typeof(snapshot)='object' and octet_length(snapshot::text)<=65536),
 source_updated_at timestamptz, observed_at timestamptz not null default now(),
 reminder_at timestamptz, removed_at timestamptz,
 primary key(profile_id,appointment_id)
);
create index ghl_appointment_reminders_due on client_portal_secure.ghl_appointment_snapshots(reminder_at) where reminder_at is not null and removed_at is null;
create table client_portal_secure.ghl_appointment_versions (
 profile_id uuid not null, appointment_id text not null, version bigint not null,
 snapshot jsonb not null, source_updated_at timestamptz, observed_at timestamptz not null default now(),
 inbox_id uuid references client_portal_secure.ghl_appointment_inbox(id),
 primary key(profile_id,appointment_id,version),
 foreign key(profile_id,appointment_id) references client_portal_secure.ghl_appointment_snapshots(profile_id,appointment_id)
);
create table client_portal_secure.ghl_appointment_links (
 token text primary key check(token ~ '^[a-f0-9]{64}$'),
 profile_id uuid not null, appointment_id text not null,
 portal_session_id uuid not null references public.client_portal_sessions(id),
 portal_token_fingerprint text not null,
 created_at timestamptz not null default now(), revoked_at timestamptz,
 unique(profile_id,appointment_id,portal_session_id,portal_token_fingerprint),
 foreign key(profile_id,appointment_id) references client_portal_secure.ghl_appointment_snapshots(profile_id,appointment_id)
);
create table client_portal_secure.ghl_appointment_outbox (
 id uuid primary key default gen_random_uuid(), profile_id uuid not null,
 appointment_id text not null, version bigint not null,
 kind text not null check(kind in('added','rescheduled','cancelled','removed','details_updated','status_updated','reminder')),
 connection_revision uuid not null,
 snapshot jsonb not null, previous_snapshot jsonb, changed_details text not null default '' check(length(changed_details)<=1024),
 summary_token text references client_portal_secure.ghl_appointment_links(token),
 status text not null default 'pending' check(status in('pending','leased','sending','accepted','uncertain','rejected','superseded','blocked')),
 available_at timestamptz not null default now(), expires_at timestamptz not null,
 lease_token uuid, lease_until timestamptz, attempts integer not null default 0,
 message_id uuid references public.client_messages(id), delivery_id uuid references public.communication_message_deliveries(id),
 provider_message_id text, last_error text, created_at timestamptz not null default now(), dispatch_started_at timestamptz, finished_at timestamptz,
 unique(profile_id,appointment_id,version,kind),
 foreign key(profile_id,appointment_id,version) references client_portal_secure.ghl_appointment_versions(profile_id,appointment_id,version)
);
create index ghl_appointment_outbox_due on client_portal_secure.ghl_appointment_outbox(available_at,id) where status in('pending','leased','blocked');
create index ghl_appointment_outbox_current on client_portal_secure.ghl_appointment_outbox(profile_id,appointment_id,version) where status in('pending','leased','blocked');
-- Eligibility is filtered before LIMIT. These ranges exclude old dry-run and
-- expired history without deleting it or making fresh claims drain that history.
create index ghl_appointment_outbox_profile_activation on client_portal_secure.ghl_appointment_outbox(profile_id,created_at,available_at,id) where status in('pending','leased','blocked');
create index ghl_appointment_outbox_profile_expiry on client_portal_secure.ghl_appointment_outbox(profile_id,expires_at,available_at,id) where status in('pending','leased','blocked');

do $$ declare t text; begin
 foreach t in array array['ghl_appointment_profiles','ghl_appointment_inbox','ghl_appointment_snapshots','ghl_appointment_versions','ghl_appointment_links','ghl_appointment_outbox'] loop
  execute format('alter table client_portal_secure.%I enable row level security',t);
  execute format('revoke all on client_portal_secure.%I from public,anon,authenticated,service_role',t);
 end loop;
end $$;

create function client_portal_secure.ghl_appointment_profile_json(p client_portal_secure.ghl_appointment_profiles)
returns jsonb language sql stable set search_path='' as $$
 select jsonb_build_object('id',p.id,'workspaceId',p.workspace_id,'relationshipId',p.relationship_id,
  'connectionRevision',p.connection_revision,'locationId',p.location_id,'calendarId',p.calendar_id,'calendarName',p.calendar_name,
  'portalOrigin',p.portal_origin,'detectionEnabled',p.detection_enabled,'sendingEnabled',p.sending_enabled,
  'reminderMinutes',p.reminder_minutes,'includeNotes',p.include_notes,'reconcileCursor',p.reconcile_cursor,'sendingActivatedAt',p.sending_activated_at)
$$;
revoke all on function client_portal_secure.ghl_appointment_profile_json(client_portal_secure.ghl_appointment_profiles) from public,anon,authenticated,service_role;

-- A new portal session token gets a new summary capability. Old links remain
-- retained and fail their fingerprint check; no bearer link opens a whole portal.
create function client_portal_secure.ghl_appointment_summary_token(p_profile_id uuid,p_appointment_id text)
returns text language plpgsql security definer set search_path='' as $$
declare p client_portal_secure.ghl_appointment_profiles%rowtype; ps public.client_portal_sessions%rowtype; token_value text;
begin
 select * into p from client_portal_secure.ghl_appointment_profiles where id=p_profile_id;
 select * into ps from public.client_portal_sessions where workspace_id=p.workspace_id and relationship_id=p.relationship_id and status='active' and token_revoked_at is null;
 if ps.id is null then return null; end if;
 token_value:=replace(gen_random_uuid()::text,'-','')||replace(gen_random_uuid()::text,'-','');
 insert into client_portal_secure.ghl_appointment_links(token,profile_id,appointment_id,portal_session_id,portal_token_fingerprint)
 values(token_value,p_profile_id,p_appointment_id,ps.id,md5(ps.session_token))
 on conflict(profile_id,appointment_id,portal_session_id,portal_token_fingerprint) do nothing;
 select token into token_value from client_portal_secure.ghl_appointment_links where profile_id=p_profile_id and appointment_id=p_appointment_id and portal_session_id=ps.id and portal_token_fingerprint=md5(ps.session_token) and revoked_at is null;
 return token_value;
end $$;
revoke all on function client_portal_secure.ghl_appointment_summary_token(uuid,text) from public,anon,authenticated,service_role;

-- All mutations for a profile serialize on its row. Intake and dispatch therefore
-- agree on the committed pending-inbox fence; a provider call already in flight
-- cannot be recalled, so its terminal result is retained instead of retried.
create function public.ghl_appointment_automation(p_action text,p_input jsonb default '{}')
returns jsonb language plpgsql security definer set search_path='' as $$
declare
 p client_portal_secure.ghl_appointment_profiles%rowtype;
 e client_portal_secure.ghl_appointment_inbox%rowtype;
 s client_portal_secure.ghl_appointment_snapshots%rowtype;
 o client_portal_secure.ghl_appointment_outbox%rowtype;
 c client_portal_secure.ghl_connections%rowtype;
 portal public.client_portal_sessions%rowtype;
 rel public.relationships%rowtype;
 items jsonb:='[]'; item jsonb; kinds jsonb; choice jsonb; secret_value text;
 token_value text; kind_value text; new_version bigint; n integer:=0; bound integer;
 next_snapshot jsonb; stamp timestamptz; reminder timestamptz; message_uuid uuid; delivery_uuid uuid;
begin
 if auth.role() is distinct from 'service_role' then return jsonb_build_object('failure','access'); end if;
 if jsonb_typeof(p_input) is distinct from 'object' then return jsonb_build_object('failure','input'); end if;
 bound:=greatest(1,least(coalesce((p_input->>'limit')::integer,20),20));
 if p_action='configure' then
  -- Provisioning captures the existing connection revision and always disables sending.
  select * into c from client_portal_secure.ghl_connections where workspace_id=(p_input->>'workspaceId')::uuid and relationship_id=(p_input->>'relationshipId')::uuid;
  if c.vault_secret_id is null or c.selected_calendar_id is null then return jsonb_build_object('failure','connection'); end if;
  if not exists(select 1 from public.workspaces w join public.relationships r on r.workspace_id=w.id where w.id=c.workspace_id and r.id=c.relationship_id and w.status='active' and r.status<>'archived' and w.custom_client_portal_domain_status='verified' and 'https://'||lower(w.custom_client_portal_domain)=p_input->>'portalOrigin') then return jsonb_build_object('failure','access'); end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('ghl-appointment-profile:'||c.workspace_id::text||':'||c.relationship_id::text,0));
  update client_portal_secure.ghl_appointment_profiles set detection_enabled=false,sending_enabled=false,sending_activated_at=null where workspace_id=c.workspace_id and relationship_id=c.relationship_id;
  update client_portal_secure.ghl_appointment_outbox ob set status='superseded',last_error='profile_reconfigured',finished_at=now(),lease_token=null,lease_until=null from client_portal_secure.ghl_appointment_profiles pr where pr.id=ob.profile_id and pr.workspace_id=c.workspace_id and pr.relationship_id=c.relationship_id and ob.status in('pending','leased','blocked');
  insert into client_portal_secure.ghl_appointment_profiles(workspace_id,relationship_id,connection_revision,location_id,calendar_id,calendar_name,portal_origin,detection_enabled,reminder_minutes,include_notes)
  values(c.workspace_id,c.relationship_id,c.calendar_revision,c.location_id,c.selected_calendar_id,coalesce(c.selected_calendar_name,c.selected_calendar_id),p_input->>'portalOrigin',coalesce((p_input->>'detectionEnabled')::boolean,false),coalesce((p_input->>'reminderMinutes')::integer,60),coalesce(p_input->'includeNotes'='true'::jsonb,false))
  on conflict(workspace_id,relationship_id,location_id,calendar_id) do update set connection_revision=excluded.connection_revision,location_id=excluded.location_id,calendar_id=excluded.calendar_id,calendar_name=excluded.calendar_name,portal_origin=excluded.portal_origin,detection_enabled=excluded.detection_enabled,include_notes=excluded.include_notes,reminder_minutes=excluded.reminder_minutes,sending_enabled=false,sending_activated_at=null,tested_at=null,reconcile_cursor='{}',reconcile_due_at=now(),reconcile_lease=null,reconcile_lease_until=null,updated_at=now()
  returning * into p;
  update client_portal_secure.ghl_appointment_outbox set status='superseded',last_error='profile_reconfigured',finished_at=now(),lease_token=null,lease_until=null where profile_id=p.id and status in('pending','leased','blocked');
  return jsonb_build_object('profile',client_portal_secure.ghl_appointment_profile_json(p));
 elsif p_action='ingest' then
  if p_input->>'eventType' not in('AppointmentCreate','AppointmentUpdate','AppointmentDelete','Reconcile') or nullif(p_input->>'appointmentId','') is null or length(p_input->>'appointmentId')>200 or p_input->>'payloadHash' !~ '^[a-f0-9]{64}$' or octet_length(coalesce(p_input->'payload','{}')::text)>1048576 then return jsonb_build_object('failure','input'); end if;
  for p in select pr.* from client_portal_secure.ghl_appointment_profiles pr join client_portal_secure.ghl_connections cn on cn.relationship_id=pr.relationship_id and cn.workspace_id=pr.workspace_id and cn.calendar_revision=pr.connection_revision and cn.selected_calendar_id=pr.calendar_id and cn.location_id=pr.location_id
   where pr.detection_enabled and exists(select 1 from public.workspaces w join public.relationships r on r.workspace_id=w.id where w.id=pr.workspace_id and r.id=pr.relationship_id and w.status='active' and r.status<>'archived') and pr.location_id=p_input->>'locationId' and (pr.calendar_id=p_input->>'calendarId' or exists(select 1 from client_portal_secure.ghl_appointment_snapshots a where a.profile_id=pr.id and a.appointment_id=p_input->>'appointmentId') or (nullif(p_input->>'calendarId','') is null and (exists(select 1 from client_portal_secure.ghl_appointment_snapshots a where a.profile_id=pr.id and a.appointment_id=p_input->>'appointmentId') or (select count(*) from client_portal_secure.ghl_appointment_profiles x where x.detection_enabled and x.location_id=pr.location_id)=1)))
   order by pr.id limit 20 for update of pr loop
   insert into client_portal_secure.ghl_appointment_inbox(profile_id,connection_revision,appointment_id,event_type,event_key,payload_hash,payload,occurred_at)
   values(p.id,p.connection_revision,p_input->>'appointmentId',p_input->>'eventType',coalesce(nullif(p_input->>'eventKey',''),p_input->>'payloadHash'),p_input->>'payloadHash',coalesce(p_input->'payload','{}'),nullif(p_input->>'occurredAt','')::timestamptz)
   on conflict(profile_id,event_key) do nothing returning * into e;
   if e.id is not null then n:=n+1;
   elsif exists(select 1 from client_portal_secure.ghl_appointment_inbox x where x.profile_id=p.id and x.event_key=coalesce(nullif(p_input->>'eventKey',''),p_input->>'payloadHash') and x.payload_hash<>p_input->>'payloadHash') then
    return jsonb_build_object('failure','event_key_collision');
   end if;
  end loop;
  return jsonb_build_object('accepted',true,'queued',n,'unmapped',n=0 and not exists(select 1 from client_portal_secure.ghl_appointment_profiles x where x.detection_enabled and x.location_id=p_input->>'locationId'));
 elsif p_action='claim_events' then
  for e in select i.* from client_portal_secure.ghl_appointment_inbox i where i.status in('pending','leased') and i.available_at<=now() and (i.lease_until is null or i.lease_until<=now()) order by i.available_at,i.received_at,i.id limit bound for update skip locked loop
   select * into p from client_portal_secure.ghl_appointment_profiles where id=e.profile_id;
   if not p.detection_enabled or not exists(select 1 from public.workspaces w join public.relationships r on r.workspace_id=w.id where w.id=p.workspace_id and r.id=p.relationship_id and w.status='active' and r.status<>'archived') or not exists(select 1 from client_portal_secure.ghl_connections cn where cn.workspace_id=p.workspace_id and cn.relationship_id=p.relationship_id and cn.calendar_revision=e.connection_revision and cn.calendar_revision=p.connection_revision and cn.selected_calendar_id=p.calendar_id and cn.vault_secret_id is not null) then
    update client_portal_secure.ghl_appointment_inbox set status='ignored',last_error='connection_changed',finished_at=now() where id=e.id; continue;
   end if;
   update client_portal_secure.ghl_appointment_inbox set status='leased',lease_token=gen_random_uuid(),lease_until=now()+interval '120 seconds',attempts=attempts+1 where id=e.id returning * into e;
   select * into s from client_portal_secure.ghl_appointment_snapshots where profile_id=e.profile_id and appointment_id=e.appointment_id;
   items:=items||jsonb_build_array(jsonb_build_object('id',e.id,'leaseToken',e.lease_token,'profileId',e.profile_id,'appointmentId',e.appointment_id,'eventType',e.event_type,'payload',e.payload,'occurredAt',e.occurred_at,'profile',client_portal_secure.ghl_appointment_profile_json(p),'current',case when s.version is null then null else jsonb_build_object('version',s.version,'snapshot',s.snapshot) end));
  end loop;
  return jsonb_build_object('items',items);
 elsif p_action in('event_context','apply_event','fail_event') then
  select * into e from client_portal_secure.ghl_appointment_inbox where id=(p_input->>'id')::uuid;
  select * into p from client_portal_secure.ghl_appointment_profiles where id=e.profile_id for update;
  select * into e from client_portal_secure.ghl_appointment_inbox where id=e.id for update;
  if e.status is distinct from 'leased' or e.lease_token is distinct from (p_input->>'leaseToken')::uuid or e.lease_until<=now() then return jsonb_build_object('failure','lease'); end if;
  if not exists(select 1 from public.workspaces w join public.relationships r on r.workspace_id=w.id where w.id=p.workspace_id and r.id=p.relationship_id and w.status='active' and r.status<>'archived') then
   update client_portal_secure.ghl_appointment_inbox set status='ignored',last_error='access_revoked',finished_at=now(),lease_token=null,lease_until=null where id=e.id;
   return jsonb_build_object('failure','access');
  end if;
  select * into c from client_portal_secure.ghl_connections where relationship_id=p.relationship_id and workspace_id=p.workspace_id;
  if not p.detection_enabled or c.vault_secret_id is null or c.calendar_revision is distinct from p.connection_revision or c.calendar_revision is distinct from e.connection_revision or c.selected_calendar_id is distinct from p.calendar_id then
   update client_portal_secure.ghl_appointment_inbox set status='ignored',last_error='connection_changed',finished_at=now(),lease_token=null,lease_until=null where id=e.id;
   return jsonb_build_object('failure','connection_changed');
  end if;
  select * into s from client_portal_secure.ghl_appointment_snapshots where profile_id=p.id and appointment_id=e.appointment_id;
  if p_action='event_context' then
   select decrypted_secret into secret_value from vault.decrypted_secrets where id=c.vault_secret_id;
   return jsonb_build_object('profile',client_portal_secure.ghl_appointment_profile_json(p),'current',case when s.version is null then null else jsonb_build_object('version',s.version,'snapshot',s.snapshot) end,'privateToken',secret_value);
  elsif p_action='fail_event' then
   update client_portal_secure.ghl_appointment_inbox set status=case when coalesce((p_input->>'retryable')::boolean,false) and attempts<8 then 'pending' else 'quarantined' end,available_at=now()+make_interval(secs=>least(900,power(2,least(attempts,8))::integer*5)),lease_token=null,lease_until=null,last_error=left(coalesce(p_input->>'error','unavailable'),160) where id=e.id;
   return jsonb_build_object('accepted',true);
  end if;
  if coalesce(s.version,0)<>coalesce((p_input->>'expectedVersion')::bigint,-1) then return jsonb_build_object('failure','version'); end if;
  next_snapshot:=p_input->'snapshot'; kinds:=coalesce(p_input->'kinds','[]');
  if jsonb_typeof(next_snapshot) is distinct from 'object' or octet_length(next_snapshot::text)>65536 or next_snapshot->>'id' is distinct from e.appointment_id or next_snapshot->>'locationId' is distinct from p.location_id or next_snapshot->>'calendarId' is distinct from p.calendar_id or jsonb_typeof(kinds) is distinct from 'array' or jsonb_array_length(kinds)>3 or exists(select 1 from jsonb_array_elements_text(kinds) k where k not in('added','rescheduled','cancelled','removed','details_updated','status_updated')) then return jsonb_build_object('failure','snapshot'); end if;
  stamp:=nullif(p_input->>'sourceUpdatedAt','')::timestamptz;
  if stamp is not null and s.source_updated_at is not null and stamp<s.source_updated_at then
   update client_portal_secure.ghl_appointment_inbox set status='ignored',last_error='older_provider_version',finished_at=now(),lease_token=null,lease_until=null where id=e.id;
   return jsonb_build_object('ignored',true,'version',s.version);
  end if;
  reminder:=nullif(p_input->>'reminderAt','')::timestamptz;
  if coalesce((next_snapshot->>'deleted')::boolean,false) or lower(coalesce(next_snapshot->>'status','')) in('cancelled','canceled','invalid','noshow','no_show','showed','completed') then reminder:=null; end if;
  if s.snapshot-'observedAt'-'sourceUpdatedAt'=next_snapshot-'observedAt'-'sourceUpdatedAt' and s.connection_revision=p.connection_revision then
   update client_portal_secure.ghl_appointment_snapshots set observed_at=now(),source_updated_at=coalesce(stamp,source_updated_at),snapshot=next_snapshot,reminder_at=reminder where profile_id=p.id and appointment_id=e.appointment_id;
   update client_portal_secure.ghl_appointment_inbox set status='applied',finished_at=now(),lease_token=null,lease_until=null where id=e.id;
   return jsonb_build_object('applied',true,'unchanged',true,'version',s.version);
  end if;
  new_version:=coalesce(s.version,0)+1;
  insert into client_portal_secure.ghl_appointment_snapshots(profile_id,appointment_id,version,connection_revision,snapshot,source_updated_at,reminder_at,removed_at)
  values(p.id,e.appointment_id,new_version,p.connection_revision,next_snapshot,stamp,reminder,case when coalesce((next_snapshot->>'deleted')::boolean,false) then now() end)
  on conflict(profile_id,appointment_id) do update set version=excluded.version,connection_revision=excluded.connection_revision,snapshot=excluded.snapshot,source_updated_at=coalesce(excluded.source_updated_at,ghl_appointment_snapshots.source_updated_at),observed_at=now(),reminder_at=excluded.reminder_at,removed_at=excluded.removed_at;
  insert into client_portal_secure.ghl_appointment_versions(profile_id,appointment_id,version,snapshot,source_updated_at,inbox_id) values(p.id,e.appointment_id,new_version,next_snapshot,stamp,e.id);
  update client_portal_secure.ghl_appointment_outbox set status='superseded',last_error='newer_appointment_version',finished_at=now(),lease_token=null,lease_until=null where profile_id=p.id and appointment_id=e.appointment_id and status in('pending','leased','blocked');
  token_value:=client_portal_secure.ghl_appointment_summary_token(p.id,e.appointment_id);
  for kind_value in select distinct value from jsonb_array_elements_text(kinds) loop
   if kind_value='removed' and lower(s.snapshot->>'status') in('cancelled','canceled') and exists(select 1 from client_portal_secure.ghl_appointment_outbox prior where prior.profile_id=p.id and prior.appointment_id=e.appointment_id and prior.version=s.version and prior.kind='cancelled' and prior.status in('accepted','sending','uncertain')) then continue; end if;
   insert into client_portal_secure.ghl_appointment_outbox(profile_id,appointment_id,version,kind,connection_revision,snapshot,previous_snapshot,changed_details,summary_token,expires_at)
   values(p.id,e.appointment_id,new_version,kind_value,p.connection_revision,next_snapshot,s.snapshot,left(coalesce(p_input->>'changedDetails',''),1024),token_value,now()+interval '1 hour') on conflict do nothing;
  end loop;
  update client_portal_secure.ghl_appointment_inbox set status='applied',finished_at=now(),lease_token=null,lease_until=null where id=e.id;
  return jsonb_build_object('applied',true,'version',new_version,'summaryToken',token_value);
 elsif p_action='claim_reconciliations' then
  for p in select pr.* from client_portal_secure.ghl_appointment_profiles pr where pr.detection_enabled and exists(select 1 from public.workspaces w join public.relationships r on r.workspace_id=w.id where w.id=pr.workspace_id and r.id=pr.relationship_id and w.status='active' and r.status<>'archived') and pr.reconcile_due_at<=now() and (pr.reconcile_lease_until is null or pr.reconcile_lease_until<=now()) order by pr.reconcile_due_at,pr.id limit least(bound,5) for update skip locked loop
   select * into c from client_portal_secure.ghl_connections where relationship_id=p.relationship_id and workspace_id=p.workspace_id;
   if c.vault_secret_id is null or c.calendar_revision is distinct from p.connection_revision or c.selected_calendar_id is distinct from p.calendar_id then continue; end if;
   update client_portal_secure.ghl_appointment_profiles set reconcile_lease=gen_random_uuid(),reconcile_lease_until=now()+interval '120 seconds' where id=p.id returning * into p;
   select decrypted_secret into secret_value from vault.decrypted_secrets where id=c.vault_secret_id;
   items:=items||jsonb_build_array(jsonb_build_object('profile',client_portal_secure.ghl_appointment_profile_json(p),'profileId',p.id,'leaseToken',p.reconcile_lease,'privateToken',secret_value,'cursor',p.reconcile_cursor));
  end loop;
  return jsonb_build_object('items',items);
 elsif p_action in('finish_reconciliation','reconciliation_candidates') then
  select * into p from client_portal_secure.ghl_appointment_profiles where id=(p_input->>'profileId')::uuid for update;
  if p.reconcile_lease is distinct from (p_input->>'leaseToken')::uuid or p.reconcile_lease is null or p.reconcile_lease_until<=now() or not p.detection_enabled or not exists(select 1 from public.workspaces w join public.relationships r on r.workspace_id=w.id where w.id=p.workspace_id and r.id=p.relationship_id and w.status='active' and r.status<>'archived') or not exists(select 1 from client_portal_secure.ghl_connections cn where cn.workspace_id=p.workspace_id and cn.relationship_id=p.relationship_id and cn.calendar_revision=p.connection_revision and cn.selected_calendar_id=p.calendar_id and cn.vault_secret_id is not null) then return jsonb_build_object('failure','lease'); end if;
  if p_action='reconciliation_candidates' then
   for s in select a.* from client_portal_secure.ghl_appointment_snapshots a where a.profile_id=p.id and a.connection_revision=p.connection_revision and a.removed_at is null and a.appointment_id>coalesce(p_input->>'afterId','') order by a.appointment_id limit least(bound,10) loop
    items:=items||jsonb_build_array(jsonb_build_object('appointmentId',s.appointment_id,'snapshot',s.snapshot)); token_value:=s.appointment_id;
   end loop;
   return jsonb_build_object('items',items,'nextCursor',case when jsonb_array_length(items)=least(bound,10) then token_value end);
  end if;
  if p_input ? 'cursor' and (jsonb_typeof(p_input->'cursor') is distinct from 'object' or octet_length((p_input->'cursor')::text)>8192) then return jsonb_build_object('failure','cursor'); end if;
  update client_portal_secure.ghl_appointment_profiles set reconcile_cursor=coalesce(p_input->'cursor',reconcile_cursor),reconcile_lease=null,reconcile_lease_until=null,reconcile_due_at=now()+case when nullif(p_input->>'error','') is null then interval '1 minute' else interval '5 minutes' end,last_error=left(p_input->>'error',160) where id=p.id;
  return jsonb_build_object('accepted',true);
 elsif p_action='enqueue_reminders' then
  for s in select a.* from client_portal_secure.ghl_appointment_snapshots a where a.reminder_at<=now() and a.reminder_at>now()-interval '30 minutes' and a.removed_at is null order by a.reminder_at limit bound for update skip locked loop
   select * into p from client_portal_secure.ghl_appointment_profiles where id=s.profile_id;
   if not p.detection_enabled or not exists(select 1 from public.workspaces w join public.relationships r on r.workspace_id=w.id where w.id=p.workspace_id and r.id=p.relationship_id and w.status='active' and r.status<>'archived') or s.connection_revision<>p.connection_revision or (s.snapshot->>'startTime')::timestamptz<=now() then continue; end if;
   token_value:=client_portal_secure.ghl_appointment_summary_token(p.id,s.appointment_id);
   insert into client_portal_secure.ghl_appointment_outbox(profile_id,appointment_id,version,kind,connection_revision,snapshot,summary_token,expires_at)
   values(p.id,s.appointment_id,s.version,'reminder',p.connection_revision,s.snapshot,token_value,least(now()+interval '30 minutes',(s.snapshot->>'startTime')::timestamptz)) on conflict do nothing;
   update client_portal_secure.ghl_appointment_snapshots set reminder_at=null where profile_id=s.profile_id and appointment_id=s.appointment_id;
   n:=n+1;
  end loop;
  return jsonb_build_object('queued',n);
 elsif p_action='claim_notifications' then
  -- Crash after send_started is ambiguous, never automatically retried.
  for o in select ob.* from client_portal_secure.ghl_appointment_outbox ob where ob.status='sending' and ob.lease_until<=now() order by ob.lease_until limit bound for update skip locked loop
   update client_portal_secure.ghl_appointment_outbox set status='uncertain',last_error='dispatch_lease_expired',finished_at=now() where id=o.id;
   update public.client_messages set status='send_uncertain' where id=o.message_id and status='sending';
   update public.communication_message_deliveries set status='send_uncertain',error='Appointment provider acknowledgement was not recorded.',updated_at=now() where id=o.delivery_id and status='sending';
  end loop;
  for o in select ob.* from client_portal_secure.ghl_appointment_outbox ob join client_portal_secure.ghl_appointment_profiles pr on pr.id=ob.profile_id where ob.status in('pending','leased','blocked') and ob.available_at<=now() and (ob.lease_until is null or ob.lease_until<=now()) and pr.sending_enabled and pr.detection_enabled and exists(select 1 from public.workspaces w join public.relationships r on r.workspace_id=w.id where w.id=pr.workspace_id and r.id=pr.relationship_id and w.status='active' and r.status<>'archived') and ob.expires_at>now() and ob.created_at>=pr.sending_activated_at order by ob.available_at,ob.id limit bound for update of ob skip locked loop
   select * into p from client_portal_secure.ghl_appointment_profiles where id=o.profile_id;
   if o.expires_at<=now() or o.created_at<p.sending_activated_at then update client_portal_secure.ghl_appointment_outbox set status='superseded',last_error='expired_or_predates_activation',finished_at=now() where id=o.id; continue; end if;
   update client_portal_secure.ghl_appointment_outbox set status='leased',summary_token=client_portal_secure.ghl_appointment_summary_token(profile_id,appointment_id),lease_token=gen_random_uuid(),lease_until=now()+interval '120 seconds',attempts=attempts+1 where id=o.id returning * into o;
   items:=items||jsonb_build_array(jsonb_build_object('id',o.id,'leaseToken',o.lease_token,'kind',o.kind,'appointmentId',o.appointment_id,'version',o.version,'snapshot',o.snapshot,'previousSnapshot',o.previous_snapshot,'changedDetails',o.changed_details,'summaryToken',o.summary_token,'recordedAt',o.created_at,'profile',client_portal_secure.ghl_appointment_profile_json(p)));
  end loop;
  return jsonb_build_object('items',items);
 elsif p_action in('begin_dispatch','finish_dispatch','finish_notification','notification_context') then
  select * into o from client_portal_secure.ghl_appointment_outbox where id=(p_input->>'id')::uuid;
  select * into p from client_portal_secure.ghl_appointment_profiles where id=o.profile_id for update;
  select * into o from client_portal_secure.ghl_appointment_outbox where id=o.id for update;
  if o.id is null or o.lease_token is distinct from (p_input->>'leaseToken')::uuid or o.lease_token is null then return jsonb_build_object('failure','lease'); end if;
  if p_action='finish_dispatch' then
   if o.status not in('sending','uncertain') then return jsonb_build_object('failure','dispatch_state'); end if;
   if p_input->>'outcome' not in('accepted','uncertain','rejected') then return jsonb_build_object('failure','outcome'); end if;
   if p_input->>'outcome'='accepted' and nullif(p_input->>'providerMessageId','') is null then return jsonb_build_object('failure','provider_id'); end if;
   update client_portal_secure.ghl_appointment_outbox set status=p_input->>'outcome',provider_message_id=coalesce(p_input->>'providerMessageId',provider_message_id),last_error=left(p_input->>'error',160),finished_at=now(),lease_until=null where id=o.id;
   update public.communication_message_deliveries set provider_message_id=coalesce(provider_message_id,p_input->>'providerMessageId'),status=case when status in('sent','whatsapp_sent','delivered','whatsapp_delivered','read','whatsapp_read','failed','delivery_failed','send_failed') then status when p_input->>'outcome'='accepted' then 'sent' when p_input->>'outcome'='rejected' then 'delivery_failed' else 'send_uncertain' end,sent_at=case when p_input->>'outcome'='accepted' then coalesce(sent_at,now()) else sent_at end,failed_at=case when p_input->>'outcome'='rejected' and status not in('sent','whatsapp_sent','delivered','whatsapp_delivered','read','whatsapp_read','failed','delivery_failed','send_failed') then now() else failed_at end,error=case when status in('sent','whatsapp_sent','delivered','whatsapp_delivered','read','whatsapp_read','failed','delivery_failed','send_failed') then error else left(p_input->>'error',160) end,updated_at=now() where id=o.delivery_id;
   update public.client_messages set provider_message_id=coalesce(provider_message_id,p_input->>'providerMessageId'),whatsapp_message_id=coalesce(whatsapp_message_id,p_input->>'providerMessageId'),status=case when status in('sent','whatsapp_sent','delivered','whatsapp_delivered','read','whatsapp_read','failed','delivery_failed','send_failed') then status when p_input->>'outcome'='accepted' then 'sent' when p_input->>'outcome'='rejected' then 'delivery_failed' else 'send_uncertain' end,sent_at=case when p_input->>'outcome'='accepted' then coalesce(sent_at,now()) else sent_at end,failed_at=case when p_input->>'outcome'='rejected' and status not in('sent','whatsapp_sent','delivered','whatsapp_delivered','read','whatsapp_read','failed','delivery_failed','send_failed') then now() else failed_at end,error=case when status in('sent','whatsapp_sent','delivered','whatsapp_delivered','read','whatsapp_read','failed','delivery_failed','send_failed') then error else left(p_input->>'error',160) end where id=o.message_id;
   return jsonb_build_object('accepted',true);
  end if;
  if o.status is distinct from 'leased' or o.lease_until<=now() then return jsonb_build_object('failure','lease'); end if;
  if p_action='finish_notification' then
   if p_input->>'outcome' not in('blocked','superseded') then return jsonb_build_object('failure','outcome'); end if;
   update client_portal_secure.ghl_appointment_outbox set status=p_input->>'outcome',lease_token=null,lease_until=null,last_error=left(p_input->>'error',160),available_at=now()+make_interval(secs=>greatest(30,least(3600,coalesce((p_input->>'retryAfterSeconds')::integer,300)))),finished_at=case when p_input->>'outcome'='superseded' then now() end where id=o.id;
   return jsonb_build_object('accepted',true);
  end if;
  select * into c from client_portal_secure.ghl_connections where relationship_id=p.relationship_id and workspace_id=p.workspace_id;
  select * into s from client_portal_secure.ghl_appointment_snapshots where profile_id=p.id and appointment_id=o.appointment_id;
  if not p.sending_enabled or not p.detection_enabled or p.tested_at is null or p.sending_activated_at is null or o.created_at<p.sending_activated_at then return jsonb_build_object('failure','disabled'); end if;
  if c.vault_secret_id is null or c.calendar_revision is distinct from p.connection_revision or o.connection_revision<>p.connection_revision or c.selected_calendar_id is distinct from p.calendar_id or s.version<>o.version or o.expires_at<=now() then return jsonb_build_object('failure','superseded'); end if;
  if exists(select 1 from client_portal_secure.ghl_appointment_inbox i where i.profile_id=p.id and i.appointment_id=o.appointment_id and i.status in('pending','leased','quarantined')) then return jsonb_build_object('failure','pending_events'); end if;
  if not exists(select 1 from public.workspaces w join public.relationships r on r.workspace_id=w.id where w.id=p.workspace_id and r.id=p.relationship_id and w.status='active' and r.status<>'archived') then return jsonb_build_object('failure','access'); end if;
  if p_action='notification_context' then
   select decrypted_secret into secret_value from vault.decrypted_secrets where id=c.vault_secret_id;
   select * into rel from public.relationships where workspace_id=p.workspace_id and id=p.relationship_id;
   return jsonb_build_object('profile',client_portal_secure.ghl_appointment_profile_json(p),'privateToken',secret_value,'destination',public.relationship_contact_phone(rel.whatsapp_phone));
  end if;
  if p_input->>'templateName' is distinct from 'be_appointment_'||o.kind or p_input->>'templateLanguage' is distinct from 'en_US' or p_input->>'templateStatus' is distinct from 'APPROVED' or p_input->>'templateCategory' is distinct from 'UTILITY' or nullif(p_input->>'templateVerifiedAt','')::timestamptz<now()-interval '5 minutes' or nullif(p_input->>'templateVerifiedAt','')::timestamptz>now()+interval '1 minute' or nullif(p_input->>'templateVerifiedAt','') is null then return jsonb_build_object('failure','template'); end if;
  select * into rel from public.relationships where workspace_id=p.workspace_id and id=p.relationship_id for update;
  if rel.status='archived' or rel.whatsapp_opted_out_at is not null or public.relationship_contact_phone(rel.whatsapp_phone) is distinct from p_input->>'destination' then return jsonb_build_object('failure','recipient'); end if;
  select x into choice from jsonb_array_elements(public.relationship_messaging_choices(p.workspace_id,p.relationship_id)) x where x->>'provider'='meta_whatsapp' and x->>'address'=p_input->>'destination';
  if nullif(choice->>'confirmedAt','') is null or choice->>'state' is distinct from 'active' or choice->>'confirmationStatus'='revoked' then return jsonb_build_object('failure','consent'); end if;
  if nullif(p_input->>'channelId','') is not null then return jsonb_build_object('failure','channel'); end if;
  if nullif(btrim(p_input->>'body'),'') is null or length(p_input->>'body')>4096 or not exists(select 1 from public.workspaces w where w.id=p.workspace_id and w.status='active' and w.custom_client_portal_domain_status='verified' and 'https://'||lower(w.custom_client_portal_domain)=p.portal_origin) or not exists(select 1 from client_portal_secure.ghl_appointment_links l join public.client_portal_sessions ps on ps.id=l.portal_session_id where l.token=o.summary_token and l.revoked_at is null and ps.workspace_id=p.workspace_id and ps.relationship_id=p.relationship_id and ps.status='active' and ps.token_revoked_at is null and md5(ps.session_token)=l.portal_token_fingerprint) then return jsonb_build_object('failure','summary'); end if;
  if o.kind='reminder' and (coalesce((s.snapshot->>'deleted')::boolean,false) or lower(s.snapshot->>'status') in('cancelled','canceled','invalid','noshow','no_show','showed','completed') or (s.snapshot->>'startTime')::timestamptz<=now()) then return jsonb_build_object('failure','superseded'); end if;
  if o.kind='reminder' and exists(select 1 from client_portal_secure.ghl_appointment_outbox earlier where earlier.profile_id=p.id and earlier.appointment_id=o.appointment_id and earlier.kind='reminder' and earlier.snapshot->>'startTime'=o.snapshot->>'startTime' and earlier.status in('sending','accepted','uncertain')) then return jsonb_build_object('failure','superseded'); end if;
  insert into public.client_messages(workspace_id,relationship_id,client_id,communication_channel_id,direction,provider,to_address,body,status,sender_kind,automation_kind,automation_label,client_request_id,raw_payload)
  values(p.workspace_id,p.relationship_id,rel.client_id,nullif(p_input->>'channelId','')::uuid,'outbound','meta_whatsapp','whatsapp:'||(p_input->>'destination'),p_input->>'body','sending','automation','ghl_appointment_'||o.kind,'Appointment update',o.id,jsonb_build_object('ghl_appointment_outbox_id',o.id,'template_name',p_input->>'templateName','template_language','en_US')) returning id into message_uuid;
  insert into public.communication_message_deliveries(workspace_id,relationship_id,client_message_id,communication_channel_id,provider,destination,status,raw_payload)
  values(p.workspace_id,p.relationship_id,message_uuid,nullif(p_input->>'channelId','')::uuid,'meta_whatsapp','whatsapp:'||(p_input->>'destination'),'sending',jsonb_build_object('ghl_appointment_outbox_id',o.id)) returning id into delivery_uuid;
  update client_portal_secure.ghl_appointment_outbox set status='sending',dispatch_started_at=now(),message_id=message_uuid,delivery_id=delivery_uuid where id=o.id;
  return jsonb_build_object('messageId',message_uuid,'deliveryId',delivery_uuid,'destination',p_input->>'destination');
 end if;
 return jsonb_build_object('failure','action');
end $$;
revoke all on function public.ghl_appointment_automation(text,jsonb) from public,anon,authenticated;
grant execute on function public.ghl_appointment_automation(text,jsonb) to service_role;

create index ghl_appointment_known_active on client_portal_secure.ghl_appointment_snapshots(profile_id,appointment_id) where removed_at is null;
create unique index ghl_appointment_reminder_occurrence on client_portal_secure.ghl_appointment_outbox(profile_id,appointment_id,(snapshot->>'startTime')) where kind='reminder' and status in('sending','accepted','uncertain');
create index ghl_appointment_dispatch_ambiguous on client_portal_secure.ghl_appointment_outbox(lease_until) where status='sending';

create function public.read_ghl_appointment_summary(p_token text,p_workspace_slug text,p_hostname text)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 if auth.role() is distinct from 'service_role' or p_token !~ '^[a-f0-9]{64}$' then return jsonb_build_object('failure','access'); end if;
 select jsonb_build_object('workspaceId',w.id,'workspaceName',w.name,'agencyDisplayName',w.agency_display_name,'relationshipId',p.relationship_id,'calendarName',p.calendar_name,'snapshot',s.snapshot,'version',s.version,'observedAt',s.observed_at,'removedAt',s.removed_at)
 into result
 from client_portal_secure.ghl_appointment_links l
 join client_portal_secure.ghl_appointment_profiles p on p.id=l.profile_id
 join client_portal_secure.ghl_appointment_snapshots s on s.profile_id=l.profile_id and s.appointment_id=l.appointment_id
 join public.client_portal_sessions ps on ps.id=l.portal_session_id and ps.workspace_id=p.workspace_id and ps.relationship_id=p.relationship_id
 join public.relationships r on r.id=p.relationship_id and r.workspace_id=p.workspace_id
 join public.workspaces w on w.id=p.workspace_id
 where l.token=p_token and l.revoked_at is null and ps.status='active' and ps.token_revoked_at is null and md5(ps.session_token)=l.portal_token_fingerprint
 and w.slug=p_workspace_slug and w.status='active' and r.status<>'archived'
 and w.custom_client_portal_domain_status='verified' and lower(w.custom_client_portal_domain)=lower(p_hostname) and p.portal_origin='https://'||lower(p_hostname);
 return coalesce(result,jsonb_build_object('failure','access'));
end $$;
revoke all on function public.read_ghl_appointment_summary(text,text,text) from public,anon,authenticated;
grant execute on function public.read_ghl_appointment_summary(text,text,text) to service_role;
notify pgrst,'reload schema';
commit;
