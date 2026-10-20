-- Target immediate webhook work to its location; retain the scheduled recovery lane.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';
create index ghl_appointment_inbox_profile_due on client_portal_secure.ghl_appointment_inbox(profile_id,available_at,received_at,id) where status in('pending','leased');
create index ghl_appointment_inbox_occurrence_due on client_portal_secure.ghl_appointment_inbox(profile_id,appointment_id,available_at,received_at,id) where status in('pending','leased');
do $migration$
declare definition text; needle text;
begin
 definition:=pg_get_functiondef('public.ghl_appointment_automation(text,jsonb)'::regprocedure);
 needle:='i.lease_until<=now()) order by i.available_at,i.received_at,i.id';
 if position(needle in definition)=0 then raise exception 'Unexpected GHL event claim'; end if;
 definition:=replace(definition,needle,$replacement$i.lease_until<=now())
  and (p_input->>'locationId' is null or i.profile_id in(select pr.id from client_portal_secure.ghl_appointment_profiles pr where pr.location_id=p_input->>'locationId' and pr.detection_enabled))
  and (p_input->>'appointmentId' is null or i.appointment_id=p_input->>'appointmentId') order by i.available_at,i.received_at,i.id$replacement$);
 needle:='ob.created_at>=pr.sending_activated_at order by ob.available_at,ob.id';
 if position(needle in definition)=0 then raise exception 'Unexpected GHL notification claim'; end if;
 definition:=replace(definition,needle,$replacement$ob.created_at>=pr.sending_activated_at
  and (p_input->>'locationId' is null or pr.location_id=p_input->>'locationId')
  and (p_input->>'appointmentId' is null or ob.appointment_id=p_input->>'appointmentId')
  and not exists(select 1 from client_portal_secure.ghl_appointment_inbox pending where pending.profile_id=pr.id and pending.appointment_id=ob.appointment_id and pending.status in('pending','leased','quarantined'))
  order by ob.available_at,ob.id$replacement$);
 execute definition;
end $migration$;
-- The same RPC serves global recovery and selective webhook work. Plan using
-- each call's actual scope so a generic optional-filter plan cannot scan every
-- other location's pending events when an individual appointment changes.
alter function public.ghl_appointment_automation(text,jsonb) set plan_cache_mode='force_custom_plan';
commit;
