-- Text flows (docs/text-flows.md; the Campaigns mockup's "Text flows", asked for on 22 November 2026).
-- A flow belongs to a campaign: it starts when a lead comes in, holds a time, books, is marked no-show or moves to a
-- stage, then runs its steps (texts, waits, conditions, actions). A run is one lead in one flow. Database triggers on
-- leads and bookings start runs and apply the stop rules, so intake, the booking page, Stripe and staff actions all
-- behave the same without changing those functions. The worker (POST /api/cron/campaign-flows) sends the texts.
-- Also here: a lead's setter default per source, a Call mark on leads, and a Confirmed mark on appointments.
-- Flow texts are outbound lead texts: they alert nobody, like every outbound lead text (app-alerts.md, 22 Nov 2026).
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';

-- Setters, Call marks and Confirmed appointments. campaign_leads.assigned_to (since 20261121220000) is the setter.
alter table public.campaign_leads
 add column call_due_at timestamptz,
 add column call_reason text check(call_reason is null or length(call_reason)<=200);
create index campaign_leads_call_due on public.campaign_leads(latest_campaign_id,call_due_at) where call_due_at is not null;
alter table public.campaign_sources add column setter_user_id uuid references auth.users(id);
alter table public.campaign_bookings add column confirmed_at timestamptz;

create table public.campaign_text_flows (
 id uuid primary key default gen_random_uuid(),
 workspace_id uuid not null references public.workspaces(id),
 campaign_id uuid not null references public.campaigns(id),
 name text not null check(length(btrim(name)) between 1 and 120),
 enabled boolean not null default false,
 trigger_kind text not null default 'new' check(trigger_kind in('new','hold','booked','noshow','stage')),
 trigger_stage text check(trigger_stage is null or trigger_stage in('not_booked','paid_not_booked','booked','showed','no_show','sold','lost')),
 source_ids uuid[] check(source_ids is null or cardinality(source_ids) between 1 and 50),
 stop_on_reply boolean not null default true,
 stop_on_book boolean not null default true,
 stop_on_pay boolean not null default false,
 window_start_minute integer not null default 480 check(window_start_minute between 0 and 1439),
 window_end_minute integer not null default 1200 check(window_end_minute between 1 and 1440),
 window_days text not null default 'every' check(window_days in('every','mon_sat','weekdays')),
 steps jsonb not null default '[]' check(jsonb_typeof(steps)='array' and jsonb_array_length(steps)<=40 and octet_length(steps::text)<=65536),
 replies jsonb not null default '[]' check(jsonb_typeof(replies)='array' and jsonb_array_length(replies)<=20 and octet_length(replies::text)<=4096),
 version integer not null default 1 check(version>0),
 created_by uuid references auth.users(id),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 deleted_at timestamptz,
 check(trigger_kind<>'stage' or trigger_stage is not null),
 check(window_end_minute>window_start_minute)
);
create index campaign_text_flows_campaign on public.campaign_text_flows(campaign_id,created_at) where deleted_at is null;

create table public.campaign_flow_runs (
 id uuid primary key default gen_random_uuid(),
 workspace_id uuid not null references public.workspaces(id),
 flow_id uuid not null references public.campaign_text_flows(id),
 lead_id uuid not null references public.campaign_leads(id),
 booking_id uuid references public.campaign_bookings(id),
 status text not null default 'active' check(status in('active','done','stopped')),
 step_id text check(step_id is null or step_id ~ '^[A-Za-z0-9_-]{1,40}$'),
 step_index integer not null default 0 check(step_index between 0 and 100),
 next_at timestamptz not null default now(),
 lease_token uuid,
 lease_until timestamptz,
 attempts integer not null default 0 check(attempts>=0),
 last_error text check(last_error is null or length(last_error)<=300),
 texts_sent integer not null default 0 check(texts_sent>=0),
 replied_at timestamptz,
 started_at timestamptz not null default now(),
 ended_at timestamptz,
 end_reason text check(end_reason is null or end_reason in('finished','condition','replied','booked','paid','closed','opted_out','removed','reply_word','flow_off','flow_deleted','no_number','failed')),
 check((status='active')=(ended_at is null))
);
-- Each lead is in a flow once at a time.
create unique index campaign_flow_runs_one_active on public.campaign_flow_runs(flow_id,lead_id) where status='active';
create index campaign_flow_runs_due on public.campaign_flow_runs(next_at) where status='active';
create index campaign_flow_runs_flow on public.campaign_flow_runs(flow_id,status,started_at desc);
create index campaign_flow_runs_lead on public.campaign_flow_runs(lead_id) where status='active';

create table public.campaign_flow_scheduler (
 id boolean primary key default true check(id),
 enabled boolean not null default false,
 last_request_id bigint,
 last_dispatched_at timestamptz
);
insert into public.campaign_flow_scheduler(enabled)
select exists(select 1 from vault.decrypted_secrets where name='sop_work_cron_secret' and nullif(decrypted_secret,'') is not null);

do $$ declare t text; begin
 foreach t in array array['campaign_text_flows','campaign_flow_runs','campaign_flow_scheduler'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from public,anon,authenticated',t);
 end loop;
end $$;

-- Starts the matching flows for a lead. A flow starts only for its campaign and sources, while it is on, for a lead who
-- can be texted and is not Sold or Lost; a hold flow only for sources that take payment. Returns how many started.
create or replace function public.campaign_flow_enroll(p_lead uuid,p_kind text,p_stage text default null,p_booking uuid default null)
returns integer language plpgsql security definer set search_path='' as $$
declare l public.campaign_leads; f public.campaign_text_flows; v_pays boolean; n integer:=0; v_id uuid;
begin
 select * into l from public.campaign_leads where id=p_lead;
 if not found or l.sms_consent<>'opted_in' or l.stage in('sold','lost') then return 0; end if;
 select s.pay_amount_cents is not null into v_pays from public.campaign_sources s where s.id=l.latest_source_id;
 for f in select * from public.campaign_text_flows x
  where x.workspace_id=l.workspace_id and x.campaign_id=l.latest_campaign_id and x.enabled and x.deleted_at is null
   and x.trigger_kind=p_kind and (p_kind<>'stage' or x.trigger_stage=p_stage)
   and (x.source_ids is null or l.latest_source_id=any(x.source_ids))
   and (p_kind<>'hold' or coalesce(v_pays,false))
 loop
  v_id:=null;
  insert into public.campaign_flow_runs(workspace_id,flow_id,lead_id,booking_id)
  values(l.workspace_id,f.id,l.id,p_booking)
  on conflict (flow_id,lead_id) where status='active' do nothing
  returning id into v_id;
  if v_id is not null then
   n:=n+1;
   insert into public.campaign_lead_events(workspace_id,lead_id,kind,detail)
   values(l.workspace_id,l.id,'flow_started',jsonb_build_object('flow_id',f.id,'flow',f.name,'run_id',v_id));
  end if;
 end loop;
 return n;
end $$;
revoke all on function public.campaign_flow_enroll(uuid,text,text,uuid) from public,anon,authenticated;
grant execute on function public.campaign_flow_enroll(uuid,text,text,uuid) to service_role;

-- Stops a lead's active runs: all of them, or only those whose flow stops on that event ('reply', 'book', 'pay').
create or replace function public.campaign_flow_stop(p_lead uuid,p_reason text,p_only text default null)
returns integer language plpgsql security definer set search_path='' as $$
declare n integer;
begin
 with stopped as (
  update public.campaign_flow_runs r set status='stopped',ended_at=now(),end_reason=p_reason,lease_token=null,lease_until=null
  from public.campaign_text_flows f
  where f.id=r.flow_id and r.lead_id=p_lead and r.status='active'
   and (p_only is null or (p_only='reply' and f.stop_on_reply) or (p_only='book' and f.stop_on_book) or (p_only='pay' and f.stop_on_pay))
  returning r.id,r.workspace_id,r.lead_id,f.id flow_id,f.name flow_name
 ), noted as (
  insert into public.campaign_lead_events(workspace_id,lead_id,kind,detail)
  select workspace_id,lead_id,'flow_stopped',jsonb_build_object('flow_id',flow_id,'flow',flow_name,'run_id',id,'reason',p_reason) from stopped
  returning 1
 ) select count(*) into n from noted;
 return n;
end $$;
revoke all on function public.campaign_flow_stop(uuid,text,text) from public,anon,authenticated;
grant execute on function public.campaign_flow_stop(uuid,text,text) to service_role;

-- A new lead takes their source's default setter.
create or replace function public.campaign_lead_default_setter() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if new.assigned_to is null and new.latest_source_id is not null then
  select s.setter_user_id into new.assigned_to from public.campaign_sources s where s.id=new.latest_source_id;
 end if;
 return new;
end $$;
revoke all on function public.campaign_lead_default_setter() from public,anon,authenticated;
create trigger campaign_lead_default_setter before insert on public.campaign_leads for each row execute function public.campaign_lead_default_setter();

-- Leads: coming in (a new lead or a repeat form), opting out, and stage changes (Sold and Lost stop every flow).
create or replace function public.campaign_lead_flows() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if tg_op='INSERT' then
  perform public.campaign_flow_enroll(new.id,'new');
  return null;
 end if;
 if new.sms_consent='opted_out' and old.sms_consent is distinct from 'opted_out' then
  perform public.campaign_flow_stop(new.id,'opted_out');
 end if;
 if new.stage is distinct from old.stage then
  if new.stage in('sold','lost') then perform public.campaign_flow_stop(new.id,'closed'); end if;
  perform public.campaign_flow_enroll(new.id,'stage',new.stage);
 end if;
 if new.submission_count>old.submission_count then perform public.campaign_flow_enroll(new.id,'new'); end if;
 return null;
end $$;
revoke all on function public.campaign_lead_flows() from public,anon,authenticated;
create trigger campaign_lead_flows after insert or update of stage,sms_consent,submission_count on public.campaign_leads
for each row execute function public.campaign_lead_flows();

-- Bookings: a hold, a booking (on the page, by staff or once paid), a payment and a no-show.
create or replace function public.campaign_booking_flows() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if tg_op='INSERT' then
  if new.paid_at is not null then perform public.campaign_flow_stop(new.lead_id,'paid','pay'); end if;
  if new.status='held' then perform public.campaign_flow_enroll(new.lead_id,'hold',null,new.id);
  elsif new.status='booked' then
   perform public.campaign_flow_stop(new.lead_id,'booked','book');
   perform public.campaign_flow_enroll(new.lead_id,'booked',null,new.id);
  end if;
  return null;
 end if;
 if new.paid_at is not null and old.paid_at is null then perform public.campaign_flow_stop(new.lead_id,'paid','pay'); end if;
 if new.status is distinct from old.status then
  if new.status='booked' then
   perform public.campaign_flow_stop(new.lead_id,'booked','book');
   perform public.campaign_flow_enroll(new.lead_id,'booked',null,new.id);
  elsif new.status='no_show' then
   perform public.campaign_flow_enroll(new.lead_id,'noshow',null,new.id);
  end if;
 end if;
 return null;
end $$;
revoke all on function public.campaign_booking_flows() from public,anon,authenticated;
create trigger campaign_booking_flows after insert or update of status,paid_at on public.campaign_bookings
for each row execute function public.campaign_booking_flows();

-- The worker's claim: due runs, oldest first, each leased for two minutes. Optionally one lead's (the after-intake kick).
create or replace function public.campaign_flow_claim(p_limit integer default 50,p_lead uuid default null)
returns setof public.campaign_flow_runs language plpgsql security definer set search_path='' as $$
begin
 return query
 update public.campaign_flow_runs r set lease_token=gen_random_uuid(),lease_until=now()+interval '2 minutes',attempts=r.attempts+1
 where r.id in (
  select x.id from public.campaign_flow_runs x
  where x.status='active' and x.next_at<=now() and (x.lease_until is null or x.lease_until<now()) and (p_lead is null or x.lead_id=p_lead)
  order by x.next_at limit least(greatest(coalesce(p_limit,50),1),200)
  for update skip locked
 )
 returning r.*;
end $$;
revoke all on function public.campaign_flow_claim(integer,uuid) from public,anon,authenticated;
grant execute on function public.campaign_flow_claim(integer,uuid) to service_role;

-- The minute scheduler: calls the worker only when a run is due, at most once every 45 seconds.
create or replace function public.dispatch_campaign_flows() returns bigint
language plpgsql security definer set search_path='' as $$
declare settings public.campaign_flow_scheduler; token text; request_id bigint;
begin
 select * into settings from public.campaign_flow_scheduler where id and enabled for update skip locked;
 if not found or settings.last_dispatched_at>now()-interval '45 seconds' then return null; end if;
 if not exists(select 1 from public.campaign_flow_runs where status='active' and next_at<=now() and (lease_until is null or lease_until<now())) then return null; end if;
 select decrypted_secret into token from vault.decrypted_secrets where name='sop_work_cron_secret';
 if nullif(token,'') is null then raise exception 'Text flow scheduler credential unavailable'; end if;
 request_id:=net.http_post(url:='https://app.betelgeze.com/api/cron/campaign-flows',headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||token),body:='{}'::jsonb,timeout_milliseconds:=10000);
 update public.campaign_flow_scheduler set last_request_id=request_id,last_dispatched_at=now() where id;
 return request_id;
end $$;
revoke all on function public.dispatch_campaign_flows() from public,anon,authenticated,service_role;
select cron.schedule('campaign-text-flows','* * * * *',$q$select public.dispatch_campaign_flows();$q$);

-- A flow text's picture is copied into the lead's conversation as an ordinary encrypted image attachment. Staff cannot
-- write lead conversations directly, so the server creates its file key here (only for a lead conversation's own path);
-- reading it keeps the existing rule (communication_file_key_for_user: the conversation's readers). Same key handling as
-- communication_create_file_key (20260909100000, with the decrypted_secret column restored by 20260909120000).
create or replace function public.campaign_lead_file_key(p_workspace_id uuid,p_conversation_id uuid,p_storage_path text,p_created_by uuid)
returns text language plpgsql security definer set search_path='' as $$
declare generated_secret text; generated_vault_id uuid; stored_secret text;
begin
 if not exists(select 1 from public.workspace_native_conversations where workspace_id=p_workspace_id and id=p_conversation_id and kind='lead') then
  raise exception 'file_scope_forbidden';
 end if;
 if p_storage_path not like p_workspace_id::text||'/communications/native/'||p_conversation_id::text||'/%' or position('/' in substr(p_storage_path,length(p_workspace_id::text||'/communications/native/'||p_conversation_id::text||'/')+1))>0 then
  raise exception 'invalid_storage_path';
 end if;
 if exists(select 1 from communications_secure.encrypted_files where storage_path=p_storage_path) then raise exception 'file_key_already_exists'; end if;
 generated_secret:=pg_catalog.encode(extensions.gen_random_bytes(32),'base64');
 select vault.create_secret(generated_secret,'communication-file-'||extensions.gen_random_uuid()::text,'Betelgeze encrypted Communications file key') into generated_vault_id;
 select decrypted.decrypted_secret into stored_secret from vault.decrypted_secrets decrypted where decrypted.id=generated_vault_id;
 if stored_secret is null then raise exception 'communication_vault_key_roundtrip_failed'; end if;
 insert into communications_secure.encrypted_files(storage_path,workspace_id,scope_kind,scope_id,vault_secret_id,created_by)
 values(p_storage_path,p_workspace_id,'native',p_conversation_id,generated_vault_id,p_created_by);
 return stored_secret;
end $$;
revoke all on function public.campaign_lead_file_key(uuid,uuid,text,uuid) from public,anon,authenticated;
grant execute on function public.campaign_lead_file_key(uuid,uuid,text,uuid) to service_role;

notify pgrst,'reload schema';
commit;
