-- Additive retained details and a separate optional STAFF-ONLY notes lane.
-- No client note publication, provider sends, client configuration or backfill.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';

create function public.read_client_portal_ghl_appointment(p_session_token text,p_workspace_id uuid,p_calendar_id text,p_appointment_id text)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare target uuid; p client_portal_secure.ghl_appointment_profiles%rowtype; result jsonb;
begin
 if auth.role() is distinct from 'service_role' or coalesce(p_session_token,'') !~ '^[a-f0-9]{64}$'
 or coalesce(p_calendar_id,'') !~ '^[a-zA-Z0-9_-]{1,160}$' or coalesce(p_appointment_id,'') !~ '^[a-zA-Z0-9_-]{1,160}$' then return jsonb_build_object('failure','access');end if;
 select s.relationship_id into target from public.client_portal_sessions s
 join public.relationships r on r.id=s.relationship_id and r.workspace_id=s.workspace_id and r.status<>'archived'
 join public.workspaces w on w.id=s.workspace_id and w.status='active'
 where s.session_token=p_session_token and s.workspace_id=p_workspace_id and s.status='active' and s.token_revoked_at is null;
 if target is null then return jsonb_build_object('failure','access');end if;
 select pr.* into p from client_portal_secure.ghl_appointment_profiles pr
 join client_portal_secure.ghl_connections c on c.relationship_id=pr.relationship_id and c.workspace_id=pr.workspace_id
  and c.location_id=pr.location_id and c.calendar_revision=pr.connection_revision and c.selected_calendar_id=pr.calendar_id and c.vault_secret_id is not null
 where pr.workspace_id=p_workspace_id and pr.relationship_id=target and (pr.detection_enabled or pr.portal_sync_enabled)
 and exists(select 1 from jsonb_array_elements(client_portal_secure.calendar_choices(c.selected_calendars,c.selected_calendar_id,c.selected_calendar_name)) x where x->>'id'=p_calendar_id)
 order by pr.updated_at desc,pr.id limit 1;
 if p.id is null then return jsonb_build_object('failure','not_retained');end if;
 select jsonb_build_object('snapshot',case when p.include_notes then a.snapshot else jsonb_set(a.snapshot||jsonb_build_object('bookingDetails','Booking details are not configured.'),'{details,booking}',jsonb_build_object('text',null,'state','not_enabled'),false) end,
  'version',a.version,'observedAt',a.observed_at,'removedAt',a.removed_at)
 into result from client_portal_secure.ghl_appointment_snapshots a
 where a.profile_id=p.id and a.appointment_id=p_appointment_id and a.connection_revision=p.connection_revision and a.snapshot->>'calendarId'=p_calendar_id;
 return coalesce(result,jsonb_build_object('failure','not_retained'));
end $$;
revoke all on function public.read_client_portal_ghl_appointment(text,uuid,text,text) from public,anon,authenticated;
grant execute on function public.read_client_portal_ghl_appointment(text,uuid,text,text) to service_role;

create table client_portal_secure.ghl_appointment_note_jobs (
 profile_id uuid not null,appointment_id text not null,connection_revision uuid not null,source_updated_at timestamptz,
 status text not null default 'pending' check(status in('pending','leased','ready','partial','error')),
 next_offset integer not null default 0 check(next_offset between 0 and 1000),
 due_at timestamptz not null default now(),lease_token uuid,lease_until timestamptz,
 attempts integer not null default 0,checked_at timestamptz,last_error text,
 primary key(profile_id,appointment_id),
 foreign key(profile_id,appointment_id) references client_portal_secure.ghl_appointment_snapshots(profile_id,appointment_id)
);
create index ghl_appointment_note_jobs_due on client_portal_secure.ghl_appointment_note_jobs(due_at,profile_id,appointment_id) where status in('pending','leased');
create table client_portal_secure.ghl_appointment_notes (
 profile_id uuid not null,appointment_id text not null,note_id text not null check(note_id~'^[a-zA-Z0-9_-]{1,160}$'),
 note jsonb not null check(jsonb_typeof(note)='object' and octet_length(note::text)<=393216),
 content_hash text not null,observed_at timestamptz not null default now(),
 primary key(profile_id,appointment_id,note_id),
 foreign key(profile_id,appointment_id) references client_portal_secure.ghl_appointment_snapshots(profile_id,appointment_id)
);
create table client_portal_secure.ghl_appointment_note_versions (
 profile_id uuid not null,appointment_id text not null,note_id text not null,content_hash text not null,
 note jsonb not null,observed_at timestamptz not null default now(),
 primary key(profile_id,appointment_id,note_id,content_hash),
 foreign key(profile_id,appointment_id,note_id) references client_portal_secure.ghl_appointment_notes(profile_id,appointment_id,note_id)
);
do $$ declare name text;begin
 foreach name in array array['ghl_appointment_note_jobs','ghl_appointment_notes','ghl_appointment_note_versions'] loop
  execute format('alter table client_portal_secure.%I enable row level security',name);
  execute format('revoke all on client_portal_secure.%I from public,anon,authenticated,service_role',name);
 end loop;
end $$;

create function client_portal_secure.queue_ghl_appointment_notes(p_profile_id uuid,p_appointment_id text,p_source_updated_at timestamptz)
returns void language plpgsql security definer set search_path='' as $$
declare p client_portal_secure.ghl_appointment_profiles%rowtype;
begin
 select * into p from client_portal_secure.ghl_appointment_profiles where id=p_profile_id;
 if not p.include_notes or not(p.detection_enabled or p.portal_sync_enabled) or not exists(select 1 from client_portal_secure.ghl_appointment_snapshots where profile_id=p.id and appointment_id=p_appointment_id and removed_at is null) then return;end if;
 insert into client_portal_secure.ghl_appointment_note_jobs(profile_id,appointment_id,connection_revision,source_updated_at)
 values(p.id,p_appointment_id,p.connection_revision,p_source_updated_at)
 on conflict(profile_id,appointment_id) do update set connection_revision=excluded.connection_revision,source_updated_at=excluded.source_updated_at,
 status='pending',next_offset=0,due_at=now(),lease_token=null,lease_until=null,attempts=0,last_error=null
 where ghl_appointment_note_jobs.connection_revision is distinct from excluded.connection_revision
 or ghl_appointment_note_jobs.source_updated_at is distinct from excluded.source_updated_at
 or (ghl_appointment_note_jobs.status in('ready','partial','error') and ghl_appointment_note_jobs.due_at<now()-interval '1 day');
end $$;
revoke all on function client_portal_secure.queue_ghl_appointment_notes(uuid,text,timestamptz) from public,anon,authenticated,service_role;

create function public.ghl_appointment_note_enrichment(p_action text,p_input jsonb default '{}') returns jsonb
language plpgsql security definer set search_path='' as $$
declare j client_portal_secure.ghl_appointment_note_jobs%rowtype;p client_portal_secure.ghl_appointment_profiles%rowtype;
 c client_portal_secure.ghl_connections%rowtype; note jsonb;secret_value text; content_hash text; has_more boolean; v_next_offset integer;
begin
 if auth.role() is distinct from 'service_role' or jsonb_typeof(p_input) is distinct from 'object' then return jsonb_build_object('failure','access');end if;
 if p_action='claim' then
  select job.* into j from client_portal_secure.ghl_appointment_note_jobs job
  join client_portal_secure.ghl_appointment_profiles pr on pr.id=job.profile_id and pr.connection_revision=job.connection_revision and pr.include_notes and(pr.detection_enabled or pr.portal_sync_enabled)
  join client_portal_secure.ghl_appointment_snapshots a on a.profile_id=job.profile_id and a.appointment_id=job.appointment_id and a.removed_at is null
  join client_portal_secure.ghl_connections co on co.relationship_id=pr.relationship_id and co.workspace_id=pr.workspace_id and co.calendar_revision=job.connection_revision and co.location_id=pr.location_id and co.vault_secret_id is not null
  join public.workspaces w on w.id=pr.workspace_id and w.status='active'
  join public.relationships r on r.id=pr.relationship_id and r.workspace_id=pr.workspace_id and r.status<>'archived'
  where job.status in('pending','leased') and job.due_at<=now() and(job.lease_until is null or job.lease_until<=now())
  order by job.due_at,job.profile_id,job.appointment_id limit 1 for update of job skip locked;
  if j.profile_id is null then return jsonb_build_object('job',null);end if;
  select * into p from client_portal_secure.ghl_appointment_profiles where id=j.profile_id;
  select * into c from client_portal_secure.ghl_connections where relationship_id=p.relationship_id and workspace_id=p.workspace_id;
  update client_portal_secure.ghl_appointment_note_jobs set status='leased',lease_token=gen_random_uuid(),lease_until=now()+interval '30 seconds',attempts=attempts+1 where profile_id=j.profile_id and appointment_id=j.appointment_id returning * into j;
  select decrypted_secret into secret_value from vault.decrypted_secrets where id=c.vault_secret_id;
  return jsonb_build_object('job',jsonb_build_object('profileId',j.profile_id,'appointmentId',j.appointment_id,'connectionRevision',j.connection_revision,'leaseToken',j.lease_token,'offset',j.next_offset,
   'profile',jsonb_build_object('locationId',p.location_id,'calendarId',p.calendar_id,'calendarName',p.calendar_name,'includeNotes',true,'privateToken',secret_value)));
 end if;
 if p_action not in('finish','fail') then return jsonb_build_object('failure','action');end if;
 select * into j from client_portal_secure.ghl_appointment_note_jobs where profile_id=(p_input->>'profileId')::uuid and appointment_id=p_input->>'appointmentId' for update;
 select * into p from client_portal_secure.ghl_appointment_profiles where id=j.profile_id;
 select * into c from client_portal_secure.ghl_connections where relationship_id=p.relationship_id and workspace_id=p.workspace_id for share;
 if j.status is distinct from 'leased' or j.lease_token is distinct from(p_input->>'leaseToken')::uuid or j.lease_until<=now()
 or j.connection_revision is distinct from(p_input->>'connectionRevision')::uuid or c.calendar_revision is distinct from j.connection_revision or p.connection_revision is distinct from j.connection_revision
 or c.location_id is distinct from p.location_id or c.vault_secret_id is null or not p.include_notes or not(p.detection_enabled or p.portal_sync_enabled)
 or not exists(select 1 from public.relationships r join public.workspaces w on w.id=r.workspace_id where r.id=p.relationship_id and w.id=p.workspace_id and r.status<>'archived' and w.status='active') then return jsonb_build_object('failure','changed');end if;
 if p_action='fail' then
  update client_portal_secure.ghl_appointment_note_jobs set status=case when attempts<5 then 'pending' else 'error' end,
   due_at=now()+interval '5 minutes',lease_token=null,lease_until=null,last_error=case when p_input->>'error' in('permissions','credentials','location','response','rate_limit') then p_input->>'error' else 'unavailable' end
   where profile_id=j.profile_id and appointment_id=j.appointment_id;
  return jsonb_build_object('accepted',true);
 end if;
 if jsonb_typeof(p_input->'notes') is distinct from 'array' or jsonb_array_length(p_input->'notes')>5 or octet_length((p_input->'notes')::text)>1572864
 or jsonb_typeof(p_input->'hasMore') is distinct from 'boolean' then return jsonb_build_object('failure','notes');end if;
 has_more:=(p_input->>'hasMore')::boolean;v_next_offset:=(p_input->>'nextOffset')::integer;
 if v_next_offset is distinct from j.next_offset+jsonb_array_length(p_input->'notes') or(has_more and jsonb_array_length(p_input->'notes')<>5) then return jsonb_build_object('failure','notes');end if;
 if exists(select 1 from jsonb_array_elements(p_input->'notes') x where jsonb_typeof(x) is distinct from 'object' or coalesce(x->>'id','') !~ '^[a-zA-Z0-9_-]{1,160}$' or jsonb_typeof(x->'body') is distinct from 'string' or length(x->>'body')>65000 or octet_length(x::text)>393216 or x-'id'-'body'-'userId'-'createdAt'-'updatedAt'<>'{}')
 or(select count(distinct x->>'id') from jsonb_array_elements(p_input->'notes') x)<>jsonb_array_length(p_input->'notes') then return jsonb_build_object('failure','notes');end if;
 for note in select value from jsonb_array_elements(p_input->'notes') loop
  content_hash:=encode(extensions.digest(note::text,'sha256'),'hex');
  insert into client_portal_secure.ghl_appointment_notes(profile_id,appointment_id,note_id,note,content_hash) values(j.profile_id,j.appointment_id,note->>'id',note,content_hash)
  on conflict(profile_id,appointment_id,note_id) do update set note=excluded.note,content_hash=excluded.content_hash,observed_at=now();
  insert into client_portal_secure.ghl_appointment_note_versions(profile_id,appointment_id,note_id,content_hash,note) values(j.profile_id,j.appointment_id,note->>'id',content_hash,note) on conflict do nothing;
 end loop;
 update client_portal_secure.ghl_appointment_note_jobs set status=case when has_more and v_next_offset<1000 then 'pending' when has_more then 'partial' else 'ready' end,
  next_offset=least(v_next_offset,1000),due_at=now(),lease_token=null,lease_until=null,attempts=0,last_error=null,checked_at=now()
  where profile_id=j.profile_id and appointment_id=j.appointment_id;
 return jsonb_build_object('applied',true);
end $$;
revoke all on function public.ghl_appointment_note_enrichment(text,jsonb) from public,anon,authenticated;
grant execute on function public.ghl_appointment_note_enrichment(text,jsonb) to service_role;

-- Extend the existing durable acceptance boundary without changing its notices.
do $migration$ declare definition text;needle text;begin
 definition:=pg_get_functiondef('public.ghl_appointment_automation(text,jsonb)'::regprocedure);
 foreach needle in array array[
  $$return jsonb_build_object('applied',true,'unchanged',true,'version',s.version);$$,
  $$return jsonb_build_object('applied',true,'version',new_version,'summaryToken',token_value);$$
 ] loop
  if position(needle in definition)=0 then raise exception 'Unexpected appointment acceptance boundary';end if;
  definition:=replace(definition,needle,'if p.include_notes then perform client_portal_secure.queue_ghl_appointment_notes(p.id,e.appointment_id,stamp); end if; '||needle);
 end loop;
 execute definition;
end $migration$;

-- Both readers enforce the current sharing preference. Notes tables are never
-- joined or returned by either client-facing capability.
do $migration$ declare definition text;needle text;begin
 definition:=pg_get_functiondef('public.read_ghl_appointment_summary(text,text,text)'::regprocedure);
 needle:=$$'snapshot',s.snapshot$$;
 if position(needle in definition)=0 then raise exception 'Unexpected appointment summary projection';end if;
 definition:=replace(definition,needle,$r$'snapshot',case when p.include_notes then s.snapshot else jsonb_set(s.snapshot||jsonb_build_object('bookingDetails','Booking details are not configured.'),'{details,booking}',jsonb_build_object('text',null,'state','not_enabled'),false) end$r$);
 execute definition;
end $migration$;

notify pgrst,'reload schema';
commit;
