-- Additive range cache and durable work, owned by the existing GHL scheduler.
-- No live bindings, messages, appointment history or sending flags are rewritten.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';

alter table client_portal_secure.ghl_appointment_profiles add column portal_sync_enabled boolean not null default false;
create index ghl_appointment_portal_due on client_portal_secure.ghl_appointment_profiles(reconcile_due_at) where portal_sync_enabled;

create table client_portal_secure.ghl_calendar_ranges (
 relationship_id uuid not null references public.relationships(id),
 calendar_id text not null, month text not null check(month ~ '^20[0-9]{2}-(0[1-9]|1[0-2])$'),
 revision uuid not null, snapshot jsonb check(snapshot is null or octet_length(snapshot::text)<524288),
 checked_at timestamptz, requested_at timestamptz not null default now(),
 available_at timestamptz not null default now(), lease_token uuid, lease_until timestamptz,
 last_error text, hydration_after text, hydration_pending boolean not null default false,
 primary key(relationship_id,calendar_id,month)
);
create index ghl_calendar_ranges_due on client_portal_secure.ghl_calendar_ranges(available_at,requested_at) where requested_at>checked_at or checked_at is null or hydration_pending;
alter table client_portal_secure.ghl_calendar_ranges enable row level security;
revoke all on client_portal_secure.ghl_calendar_ranges from public,anon,authenticated,service_role;

-- Portal synchronization does not enable WhatsApp detection/sending or reset a
-- current profile's consent, activation, accepted jobs or notification settings.
create function client_portal_secure.ensure_portal_ghl_profile(c client_portal_secure.ghl_connections)
returns boolean language plpgsql security definer set search_path='' as $$
declare origin text;
begin
 if c.selected_calendar_id is null then return false;end if;
 select 'https://'||lower(custom_client_portal_domain) into origin from public.workspaces
 where id=c.workspace_id and status='active' and custom_client_portal_domain_status='verified';
 if origin is null then return false;end if;
 perform pg_advisory_xact_lock(hashtextextended('ghl-appointment-profile:'||c.workspace_id::text||':'||c.relationship_id::text,0));
 update client_portal_secure.ghl_appointment_profiles set portal_sync_enabled=false
 where workspace_id=c.workspace_id and relationship_id=c.relationship_id and portal_sync_enabled
 and (location_id<>c.location_id or calendar_id<>c.selected_calendar_id);
 insert into client_portal_secure.ghl_appointment_profiles(workspace_id,relationship_id,connection_revision,location_id,calendar_id,calendar_name,portal_origin,calendars,portal_sync_enabled)
 values(c.workspace_id,c.relationship_id,c.calendar_revision,c.location_id,c.selected_calendar_id,coalesce(c.selected_calendar_name,c.selected_calendar_id),origin,client_portal_secure.calendar_choices(c.selected_calendars,c.selected_calendar_id,c.selected_calendar_name),true)
 on conflict(workspace_id,relationship_id,location_id,calendar_id) do update set
  portal_sync_enabled=true,connection_revision=excluded.connection_revision,calendars=excluded.calendars,portal_origin=excluded.portal_origin,
  sending_enabled=case when ghl_appointment_profiles.connection_revision=excluded.connection_revision then ghl_appointment_profiles.sending_enabled else false end,
  sending_activated_at=case when ghl_appointment_profiles.connection_revision=excluded.connection_revision then ghl_appointment_profiles.sending_activated_at else null end,
  reconcile_due_at=least(ghl_appointment_profiles.reconcile_due_at,now());
 return true;
end $$;

create function client_portal_secure.save_ghl_calendar_range(c client_portal_secure.ghl_connections, value jsonb, stamp timestamptz)
returns void language plpgsql security definer set search_path='' as $$
declare detail_sync boolean;
begin
 detail_sync:=client_portal_secure.ensure_portal_ghl_profile(c);
 -- Persist setup readiness during refresh, without a profile/inbox lookup on
 -- each calendar read. Appointment details are read only when opened.
 value:=value||jsonb_build_object('detailsUnavailable',not detail_sync);
 insert into client_portal_secure.ghl_calendar_ranges(relationship_id,calendar_id,month,revision,snapshot,checked_at,requested_at,hydration_pending)
 values(c.relationship_id,coalesce(value->>'calendarId',''),value->>'month',c.calendar_revision,value,stamp,stamp,detail_sync)
 on conflict(relationship_id,calendar_id,month) do update set revision=excluded.revision,snapshot=excluded.snapshot,checked_at=excluded.checked_at,requested_at=excluded.requested_at,
  available_at=now(),lease_token=null,lease_until=null,last_error=null,hydration_after=null,hydration_pending=excluded.hydration_pending;
 -- Only transient range caches are evicted. Durable appointment history is kept.
 delete from client_portal_secure.ghl_calendar_ranges where relationship_id=c.relationship_id and (calendar_id,month) in
 (select calendar_id,month from client_portal_secure.ghl_calendar_ranges where relationship_id=c.relationship_id order by requested_at desc,calendar_id,month offset 6);
end $$;

create function public.client_portal_ghl_calendar_v2(p_session_token text,p_workspace_id uuid,p_action text default 'read',p_operation_id uuid default null,p_month text default null,p_calendar_id text default null,p_snapshot jsonb default null,p_error text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb; c client_portal_secure.ghl_connections%rowtype; saved client_portal_secure.ghl_calendar_ranges%rowtype; target uuid; selected text; value jsonb;
begin
 if auth.role() is distinct from 'service_role' then return jsonb_build_object('failure','access');end if;
 -- Reuse the existing portal authorization, mutation leases and provider fences.
 result:=public.client_portal_ghl_calendar(p_session_token,p_workspace_id,case when p_action='request' then 'read' else p_action end,p_operation_id,p_month,p_calendar_id,p_snapshot,p_error);
 if result ? 'failure' then return result;end if;
 select relationship_id into target from public.client_portal_sessions where session_token=p_session_token and workspace_id=p_workspace_id;
 if p_action='request' then perform pg_advisory_xact_lock(hashtextextended('portal-ghl:'||target::text,0));end if;
 select * into c from client_portal_secure.ghl_connections where relationship_id=target and workspace_id=p_workspace_id;
 if result->>'revision' is distinct from c.calendar_revision::text then return jsonb_build_object('failure','changed');end if;
 selected:=coalesce(p_calendar_id,c.selected_calendar_id,'');
 if selected<>'' and not exists(select 1 from jsonb_array_elements(result->'calendars') x where x->>'id'=selected) then return jsonb_build_object('failure','access');end if;
 if p_month is not null and p_month !~ '^20[0-9]{2}-(0[1-9]|1[0-2])$' then return jsonb_build_object('failure','response');end if;
 if p_action='begin' then return result;end if;
 if p_action='finish' and result->'snapshot' is not null then
  perform client_portal_secure.save_ghl_calendar_range(c,result->'snapshot',(result->>'refreshedAt')::timestamptz);
  p_month:=result->'snapshot'->>'month';selected:=coalesce(result->'snapshot'->>'calendarId','');
 elsif p_action='request' then
  if p_month is null then return jsonb_build_object('failure','response');end if;
  perform client_portal_secure.ensure_portal_ghl_profile(c);
  insert into client_portal_secure.ghl_calendar_ranges(relationship_id,calendar_id,month,revision)
  values(target,selected,p_month,c.calendar_revision)
  on conflict(relationship_id,calendar_id,month) do update set
   revision=excluded.revision,requested_at=case when ghl_calendar_ranges.revision<>excluded.revision or ghl_calendar_ranges.checked_at is null or ghl_calendar_ranges.checked_at<now()-interval '5 minutes' then now() else ghl_calendar_ranges.requested_at end,
   snapshot=case when ghl_calendar_ranges.revision=excluded.revision then ghl_calendar_ranges.snapshot end,
   checked_at=case when ghl_calendar_ranges.revision=excluded.revision then ghl_calendar_ranges.checked_at end,
   lease_token=case when ghl_calendar_ranges.revision=excluded.revision then ghl_calendar_ranges.lease_token end,
   lease_until=case when ghl_calendar_ranges.revision=excluded.revision then ghl_calendar_ranges.lease_until end,
   hydration_after=case when ghl_calendar_ranges.revision=excluded.revision then ghl_calendar_ranges.hydration_after end,
   hydration_pending=case when ghl_calendar_ranges.revision=excluded.revision then ghl_calendar_ranges.hydration_pending else false end,
   last_error=case when ghl_calendar_ranges.revision=excluded.revision then ghl_calendar_ranges.last_error end,
   available_at=case when ghl_calendar_ranges.revision=excluded.revision then ghl_calendar_ranges.available_at else now() end;
  delete from client_portal_secure.ghl_calendar_ranges where relationship_id=target and (calendar_id,month) in
   (select calendar_id,month from client_portal_secure.ghl_calendar_ranges where relationship_id=target order by requested_at desc,calendar_id,month offset 6);
 end if;
 if p_month is null then p_month:=result->'snapshot'->>'month';end if;
 select * into saved from client_portal_secure.ghl_calendar_ranges where relationship_id=target and calendar_id=selected and month=p_month and revision=c.calendar_revision;
 value:=case when saved.snapshot is not null then saved.snapshot when result->'snapshot'->>'month'=p_month then result->'snapshot' end;
 -- Calendar rows retain the provider range's checked-at boundary. Latest saved
 -- appointment details are fetched separately on demand, never per row here.
 return result||jsonb_build_object('snapshot',value,'refreshedAt',coalesce(saved.checked_at,case when result->'snapshot'->>'month'=p_month then (result->>'refreshedAt')::timestamptz end),
  'error',coalesce(saved.last_error,result->>'error',case when (value->>'detailsUnavailable')::boolean then 'portal_setup' end),'complete',coalesce((value->>'coverageComplete')::boolean,value is not null),
  'busy',coalesce(saved.lease_until>now() or saved.requested_at>saved.checked_at or (saved.checked_at is null and saved.relationship_id is not null),false),
  'detailsPending',coalesce(saved.hydration_pending,false) or coalesce((value->>'detailsPending')::boolean,false),'queued',p_action='request');
end $$;

-- Optional contact labels retain their existing bounded lease owner. Copy only
-- enrichment for the exact range snapshot; never advance its provider timestamp.
create function client_portal_secure.retain_ghl_calendar_labels() returns trigger
language plpgsql security definer set search_path='' as $$ begin
 if new.snapshot->'contactLabels' is distinct from old.snapshot->'contactLabels' or new.snapshot->'namesStatus' is distinct from old.snapshot->'namesStatus' then
  update client_portal_secure.ghl_calendar_ranges set snapshot=snapshot||jsonb_build_object('contactLabels',new.snapshot->'contactLabels','namesStatus',new.snapshot->'namesStatus')
  where relationship_id=new.relationship_id and revision=new.revision and calendar_id=coalesce(new.snapshot->>'calendarId','') and month=new.snapshot->>'month' and snapshot->>'snapshotId'=new.snapshot->>'snapshotId';
 end if;return new;
end $$;
revoke all on function client_portal_secure.retain_ghl_calendar_labels() from public,anon,authenticated,service_role;
create trigger retain_ghl_calendar_labels after update of snapshot on client_portal_secure.ghl_calendar_snapshots for each row execute function client_portal_secure.retain_ghl_calendar_labels();

-- The existing scheduler claims one range at a time. The queue is finite: no
-- background provider refresh is admitted without an active portal request.
create function public.ghl_portal_calendar_refresh(p_action text,p_input jsonb default '{}')
returns jsonb language plpgsql security definer set search_path='' as $$
declare r client_portal_secure.ghl_calendar_ranges%rowtype; c client_portal_secure.ghl_connections%rowtype; p client_portal_secure.ghl_appointment_profiles%rowtype;
 value jsonb; entry jsonb; result jsonb; secret_value text; rows jsonb; last_id text; n integer:=0;
begin
 if auth.role() is distinct from 'service_role' then return jsonb_build_object('failure','access');end if;
 if p_action='claim' then
  select q.* into r from client_portal_secure.ghl_calendar_ranges q
  join client_portal_secure.ghl_connections cn on cn.relationship_id=q.relationship_id and cn.calendar_revision=q.revision
  join public.relationships rel on rel.id=q.relationship_id and rel.workspace_id=cn.workspace_id and rel.status<>'archived'
  join public.workspaces w on w.id=cn.workspace_id and w.status='active'
  where cn.vault_secret_id is not null and q.available_at<=now() and (q.lease_until is null or q.lease_until<=now())
   and (q.checked_at is null or q.requested_at>q.checked_at or q.hydration_pending)
  order by q.available_at,q.requested_at limit 1 for update of q skip locked;
  if not found then return jsonb_build_object('job',null);end if;
  select * into c from client_portal_secure.ghl_connections where relationship_id=r.relationship_id;
  if r.calendar_id<>'' and not exists(select 1 from jsonb_array_elements(client_portal_secure.calendar_choices(c.selected_calendars,c.selected_calendar_id,c.selected_calendar_name)) x where x->>'id'=r.calendar_id) then return jsonb_build_object('job',null);end if;
  update client_portal_secure.ghl_calendar_ranges set lease_token=gen_random_uuid(),lease_until=now()+interval '45 seconds' where relationship_id=r.relationship_id and calendar_id=r.calendar_id and month=r.month returning * into r;
  if r.snapshot is not null and r.checked_at>=r.requested_at and r.hydration_pending then
   return jsonb_build_object('job',jsonb_build_object('relationshipId',r.relationship_id,'calendarId',r.calendar_id,'month',r.month,'revision',r.revision,'leaseToken',r.lease_token,'mode','hydrate'));
  end if;
  select decrypted_secret into secret_value from vault.decrypted_secrets where id=c.vault_secret_id;
  return jsonb_build_object('job',jsonb_build_object('relationshipId',r.relationship_id,'calendarId',r.calendar_id,'month',r.month,'revision',r.revision,'leaseToken',r.lease_token,'mode','refresh','locationId',c.location_id,'privateToken',secret_value,'binding',case when r.calendar_id<>'' then jsonb_build_object('calendarId',r.calendar_id,'calendarName',(select x->>'name' from jsonb_array_elements(client_portal_secure.calendar_choices(c.selected_calendars,c.selected_calendar_id,c.selected_calendar_name)) x where x->>'id'=r.calendar_id)) else null end));
 end if;
 perform pg_advisory_xact_lock(hashtextextended('portal-ghl:'||(p_input->>'relationshipId'),0));
 select * into r from client_portal_secure.ghl_calendar_ranges where relationship_id=(p_input->>'relationshipId')::uuid and calendar_id=p_input->>'calendarId' and month=p_input->>'month' for update;
 select * into c from client_portal_secure.ghl_connections where relationship_id=r.relationship_id;
 if r.lease_token is null or r.lease_token is distinct from (p_input->>'leaseToken')::uuid or r.lease_until<=now() or r.revision::text is distinct from p_input->>'revision' or c.calendar_revision is distinct from r.revision or c.vault_secret_id is null
  or not exists(select 1 from public.workspaces w join public.relationships rel on rel.workspace_id=w.id where w.id=c.workspace_id and rel.id=c.relationship_id and w.status='active' and rel.status<>'archived') then return jsonb_build_object('failure','lease');end if;
 if p_action='fail' then
  update client_portal_secure.ghl_calendar_ranges set last_error=case when p_input->>'error' in('permissions','credentials','location','rate_limit','response','owner_unavailable') then p_input->>'error' else 'unavailable' end,available_at=now()+interval '5 minutes',lease_token=null,lease_until=null where relationship_id=r.relationship_id and calendar_id=r.calendar_id and month=r.month;
  return jsonb_build_object('accepted',true);
 elsif p_action='finish' then
  value:=p_input->'snapshot';
  if jsonb_typeof(value) is distinct from 'object' or octet_length(value::text)>=524288 or value->>'month' is distinct from r.month or coalesce(value->>'calendarId','')<>r.calendar_id
   or jsonb_typeof(value->'events') is distinct from 'array' or jsonb_array_length(value->'events')>1000 or jsonb_typeof(value->'timezone') is distinct from 'string' then return jsonb_build_object('failure','snapshot');end if;
  value:=value||jsonb_build_object('snapshotId',r.lease_token);
  perform client_portal_secure.save_ghl_calendar_range(c,value,now());
  -- Compatibility for existing bounded name enrichment; never steal a manual lease.
  insert into client_portal_secure.ghl_calendar_snapshots(relationship_id,revision,snapshot,refreshed_at) values(c.relationship_id,c.calendar_revision,value,now())
  on conflict(relationship_id) do update set revision=excluded.revision,snapshot=excluded.snapshot,refreshed_at=excluded.refreshed_at,last_error=null where ghl_calendar_snapshots.lease_until is null or ghl_calendar_snapshots.lease_until<=now();
  return jsonb_build_object('accepted',true);
 elsif p_action='hydrate' then
  select * into p from client_portal_secure.ghl_appointment_profiles where workspace_id=c.workspace_id and relationship_id=c.relationship_id and location_id=c.location_id and calendar_id=c.selected_calendar_id and connection_revision=c.calendar_revision;
  select coalesce(jsonb_agg(e order by e->>'id'),'[]') into rows from (select e from jsonb_array_elements(r.snapshot->'events') e where e->>'kind'='appointment' and e->>'id'>coalesce(r.hydration_after,'') order by e->>'id' limit 10) x;
  for entry in select x from jsonb_array_elements(rows) x loop
   last_id:=entry->>'id';n:=n+1;
   result:=public.ghl_appointment_automation('ingest',jsonb_build_object('locationId',c.location_id,'calendarId',r.calendar_id,'appointmentId',last_id,'eventType','Reconcile',
    'eventKey','portal:'||encode(extensions.digest(r.revision::text||':'||(r.snapshot->>'snapshotId')||':'||last_id,'sha256'),'hex'),
    'payloadHash',encode(extensions.digest(r.revision::text||':'||(r.snapshot->>'snapshotId')||':'||last_id,'sha256'),'hex'),
    'payload',jsonb_build_object('source','portal_calendar','baseline',true),'occurredAt',now()));
   if result->>'accepted' is distinct from 'true' then return jsonb_build_object('failure','intake');end if;
  end loop;
  update client_portal_secure.ghl_calendar_ranges set hydration_after=coalesce(last_id,hydration_after),hydration_pending=n=10,lease_token=null,lease_until=null,available_at=now(),last_error=null where relationship_id=r.relationship_id and calendar_id=r.calendar_id and month=r.month;
  return jsonb_build_object('accepted',true,'queued',n);
 end if;
 return jsonb_build_object('failure','action');
end $$;

-- Portal-only profiles use the same signed intake and leased recovery. All
-- notification admission still requires the existing sending/consent fences.
do $migration$
declare d text; needle text;
begin
 d:=pg_get_functiondef('client_portal_secure.ghl_appointment_profile_json(client_portal_secure.ghl_appointment_profiles)'::regprocedure);
 needle:=$n$'detectionEnabled',p.detection_enabled$n$;
 if position(needle in d)=0 then raise exception 'Unexpected profile projection';end if;
 execute replace(d,needle,needle||$n$,'portalSyncEnabled',p.portal_sync_enabled$n$);
 d:=pg_get_functiondef('public.ghl_appointment_automation(text,jsonb)'::regprocedure);
 d:=replace(d,'pr.detection_enabled and','(pr.detection_enabled or pr.portal_sync_enabled) and');
 d:=replace(d,'x.detection_enabled and','(x.detection_enabled or x.portal_sync_enabled) and');
 needle:=$n$pr.location_id=p_input->>'locationId' and pr.detection_enabled))$n$;
 if position(needle in d)=0 then raise exception 'Unexpected scoped intake eligibility';end if;
 d:=replace(d,needle,$n$pr.location_id=p_input->>'locationId' and (pr.detection_enabled or pr.portal_sync_enabled)))$n$);
 d:=replace(d,'not p.detection_enabled','not (p.detection_enabled or p.portal_sync_enabled)');
 -- Detection-only portal work must never relax notification dispatch eligibility.
 d:=replace(d,'not p.sending_enabled or not (p.detection_enabled or p.portal_sync_enabled)','not p.sending_enabled or not p.detection_enabled');
 d:=replace(d,'pr.sending_enabled and (pr.detection_enabled or pr.portal_sync_enabled)','pr.sending_enabled and pr.detection_enabled');
 needle:=$n$s.snapshot-'observedAt'-'sourceUpdatedAt'-'sourceCreatedAt'=next_snapshot-'observedAt'-'sourceUpdatedAt'-'sourceCreatedAt'$n$;
 if position(needle in d)=0 then raise exception 'Unexpected snapshot equality';end if;
 d:=replace(d,needle,$n$s.snapshot-'observedAt'-'sourceUpdatedAt'-'sourceCreatedAt'-'details'=next_snapshot-'observedAt'-'sourceUpdatedAt'-'sourceCreatedAt'-'details'$n$);
 execute d;
end $migration$;
revoke all on function client_portal_secure.ensure_portal_ghl_profile(client_portal_secure.ghl_connections),client_portal_secure.save_ghl_calendar_range(client_portal_secure.ghl_connections,jsonb,timestamptz) from public,anon,authenticated,service_role;
revoke all on function public.client_portal_ghl_calendar_v2(text,uuid,text,uuid,text,text,jsonb,text),public.ghl_portal_calendar_refresh(text,jsonb) from public,anon,authenticated;
grant execute on function public.client_portal_ghl_calendar_v2(text,uuid,text,uuid,text,text,jsonb,text),public.ghl_portal_calendar_refresh(text,jsonb) to service_role;
notify pgrst,'reload schema';
commit;
