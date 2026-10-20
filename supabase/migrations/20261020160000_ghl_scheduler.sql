-- Reuse the existing trusted scheduler credential; activation is explicit.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';
create table client_portal_secure.ghl_scheduler (
 kind text primary key check(kind in('appointments','oauth')), enabled boolean not null default false,
 last_request_id bigint,last_dispatched_at timestamptz
);
alter table client_portal_secure.ghl_scheduler enable row level security;
revoke all on client_portal_secure.ghl_scheduler from public,anon,authenticated,service_role;
insert into client_portal_secure.ghl_scheduler(kind) values('appointments'),('oauth');
create function public.set_ghl_scheduler(p_enabled boolean) returns void
language plpgsql security definer set search_path='' as $$
begin
 if auth.role() is distinct from 'service_role' then raise exception 'Access denied'; end if;
 if p_enabled is null then raise exception 'Enabled is required'; end if;
 if p_enabled and not exists(select 1 from vault.decrypted_secrets where name='sop_work_cron_secret' and nullif(decrypted_secret,'') is not null) then raise exception 'Scheduler credential is unavailable'; end if;
 update client_portal_secure.ghl_scheduler set enabled=p_enabled;
end $$;
revoke all on function public.set_ghl_scheduler(boolean) from public,anon,authenticated;
grant execute on function public.set_ghl_scheduler(boolean) to service_role;
create function public.dispatch_ghl_work(p_kind text) returns bigint
language plpgsql security definer set search_path='' as $$
declare settings client_portal_secure.ghl_scheduler%rowtype; token text; request_id bigint;
begin
 select * into settings from client_portal_secure.ghl_scheduler where kind=p_kind and enabled for update skip locked;
 if not found or settings.last_dispatched_at>now()-interval '45 seconds' then return null; end if;
 if p_kind='appointments' then
  if not exists(select 1 from client_portal_secure.ghl_app_events where status='pending')
   and not exists(select 1 from client_portal_secure.ghl_appointment_profiles where detection_enabled and reconcile_due_at<=now())
   and not exists(select 1 from client_portal_secure.ghl_appointment_inbox where status in('pending','leased') and available_at<=now() and (lease_until is null or lease_until<=now()))
   and not exists(select 1 from client_portal_secure.ghl_appointment_outbox ob join client_portal_secure.ghl_appointment_profiles p on p.id=ob.profile_id where p.sending_enabled and ob.status in('pending','leased','blocked') and ob.available_at<=now() and ob.expires_at>now() and ob.created_at>=p.sending_activated_at and (ob.lease_until is null or ob.lease_until<=now()))
   and not exists(select 1 from client_portal_secure.ghl_appointment_outbox where status='sending' and lease_until<=now())
   and not exists(select 1 from client_portal_secure.ghl_appointment_snapshots s join client_portal_secure.ghl_appointment_profiles p on p.id=s.profile_id where p.detection_enabled and s.reminder_at<=now() and s.reminder_at>now()-interval '30 minutes' and s.removed_at is null) then return null; end if;
 else
  if not exists(select 1 from client_portal_secure.ghl_oauth_credentials where status in('active','refreshing') and expires_at<=now()+interval '2 hours')
   and not exists(select 1 from client_portal_secure.ghl_oauth_attempts where expires_at<=now()) then return null; end if;
 end if;
 select decrypted_secret into token from vault.decrypted_secrets where name='sop_work_cron_secret';
 if nullif(token,'') is null then raise exception 'GHL scheduler credential unavailable'; end if;
 request_id:=net.http_post(url:='https://app.betelgeze.com/api/cron/ghl-'||p_kind,headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||token),body:='{}'::jsonb,timeout_milliseconds:=10000);
 update client_portal_secure.ghl_scheduler set last_request_id=request_id,last_dispatched_at=now() where kind=p_kind;
 return request_id;
end $$;
revoke all on function public.dispatch_ghl_work(text) from public,anon,authenticated,service_role;
select cron.schedule('ghl-appointment-recovery','* * * * *',$q$select public.dispatch_ghl_work('appointments');$q$);
select cron.schedule('ghl-oauth-renewal','*/5 * * * *',$q$select public.dispatch_ghl_work('oauth');$q$);
notify pgrst,'reload schema';
commit;
