-- Campaign sources, booking holds and payments (docs/campaign-intake.md, docs/campaign-booking.md).
-- A campaign gets sources: one landing page each, with its own intake key, tag and booking settings. Each existing
-- campaign becomes one source carrying its key, so intake addresses already handed out keep working. Lead stages
-- become not_booked/paid_not_booked/booked/showed/no_show/sold/lost (texted and replied are activity, not stages).
-- A booking page holds a time for a lead; a source that takes payment keeps it held until Stripe confirms payment.
-- Everything stays service-only: RLS on, grants revoked, functions for service_role only. Nothing is sent.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';

create table public.campaign_sources (
 id uuid primary key default gen_random_uuid(),
 workspace_id uuid not null references public.workspaces(id),
 campaign_id uuid not null references public.campaigns(id),
 name text not null check(length(btrim(name)) between 1 and 120),
 tag text not null check(length(btrim(tag)) between 1 and 40),
 tag_tone text not null default 'sky' check(tag_tone in('emerald','sky','violet','amber','red','neutral')),
 page_url text check(page_url is null or (page_url ~ '^https://[^[:space:]]+$' and length(page_url)<=500)),
 allowed_origins text[] not null default '{}' check(cardinality(allowed_origins)<=10),
 status text not null default 'testing' check(status in('testing','live','off')),
 intake_key text not null unique check(intake_key ~ '^[A-Za-z0-9_-]{32}$'),
 books boolean not null default false,
 booking_slug text unique check(booking_slug is null or booking_slug ~ '^[a-z0-9][a-z0-9-]{1,58}[a-z0-9]$'),
 meeting_title text not null default 'Call' check(length(btrim(meeting_title)) between 1 and 80),
 meeting_minutes integer not null default 30 check(meeting_minutes in(15,30,45,60)),
 meeting_place text not null default 'phone' check(meeting_place in('phone','zoom','google_meet')),
 meeting_link text check(meeting_link is null or (meeting_link ~ '^https://[^[:space:]]+$' and length(meeting_link)<=500)),
 time_zone text not null default 'America/Chicago' check(time_zone in('America/New_York','America/Chicago','America/Denver','America/Phoenix','America/Los_Angeles')),
 booking_days integer[] not null default '{1,2,3,4,5}' check(booking_days <@ '{0,1,2,3,4,5,6}'::integer[] and cardinality(booking_days) between 1 and 7),
 day_start_minute integer not null default 540 check(day_start_minute between 0 and 1380),
 day_end_minute integer not null default 1020 check(day_end_minute between 60 and 1440),
 notice_hours integer not null default 12 check(notice_hours between 0 and 168),
 horizon_days integer not null default 21 check(horizon_days between 1 and 60),
 pay_amount_cents integer check(pay_amount_cents is null or pay_amount_cents between 50 and 10000000),
 hold_minutes integer not null default 20 check(hold_minutes in(10,15,20,30)),
 refund_rule text check(refund_rule is null or length(refund_rule)<=300),
 created_by uuid references auth.users(id),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 check(day_end_minute>day_start_minute),
 check(not books or booking_slug is not null)
);
create index campaign_sources_campaign on public.campaign_sources(campaign_id,created_at);

-- Each campaign so far becomes its first source, keeping its key and allowed sites.
insert into public.campaign_sources(workspace_id,campaign_id,name,tag,allowed_origins,status,intake_key,created_by,created_at)
select c.workspace_id,c.id,c.name,left(c.name,40),c.allowed_origins,case c.status when 'live' then 'live' when 'archived' then 'off' else 'testing' end,c.intake_key,c.created_by,c.created_at
from public.campaigns c;

alter table public.campaign_leads
 add column first_source_id uuid references public.campaign_sources(id),
 add column latest_source_id uuid references public.campaign_sources(id),
 add column is_test boolean not null default false;
update public.campaign_leads l set first_source_id=s.id from public.campaign_sources s where s.campaign_id=l.first_campaign_id and l.first_source_id is null;
update public.campaign_leads l set latest_source_id=s.id from public.campaign_sources s where s.campaign_id=l.latest_campaign_id and l.latest_source_id is null;
create index campaign_leads_source on public.campaign_leads(latest_source_id,last_submitted_at desc);

alter table public.campaign_leads drop constraint campaign_leads_stage_check;
update public.campaign_leads set stage=case stage when 'paid' then 'paid_not_booked' else 'not_booked' end where stage in('new','texted','replied','paid');
alter table public.campaign_leads alter column stage set default 'not_booked';
alter table public.campaign_leads add constraint campaign_leads_stage_check check(stage in('not_booked','paid_not_booked','booked','showed','no_show','sold','lost'));

alter table public.campaign_lead_submissions add column source_id uuid references public.campaign_sources(id);
update public.campaign_lead_submissions x set source_id=s.id from public.campaign_sources s where s.campaign_id=x.campaign_id and x.source_id is null;

create table public.campaign_bookings (
 id uuid primary key default gen_random_uuid(),
 workspace_id uuid not null references public.workspaces(id),
 campaign_id uuid not null references public.campaigns(id),
 source_id uuid not null references public.campaign_sources(id),
 lead_id uuid not null references public.campaign_leads(id),
 starts_at timestamptz not null,
 ends_at timestamptz not null,
 status text not null check(status in('held','booked','released','cancelled','showed','no_show')),
 held_until timestamptz,
 amount_cents integer check(amount_cents is null or amount_cents>=0),
 stripe_checkout_session_id text unique check(stripe_checkout_session_id is null or stripe_checkout_session_id ~ '^cs_[A-Za-z0-9_]{1,250}$'),
 stripe_checkout_url text check(stripe_checkout_url is null or (stripe_checkout_url ~ '^https://checkout\.stripe\.com/' and length(stripe_checkout_url)<=2000)),
 paid_at timestamptz,
 stripe_event_id text,
 booked_by text not null default 'lead' check(booked_by in('lead','staff')),
 actor_id uuid references auth.users(id),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 check(ends_at>starts_at),
 check(status<>'held' or held_until is not null)
);
-- One open hold or booking per time on a source. An expired hold is released before its time is offered again.
create unique index campaign_bookings_open_slot on public.campaign_bookings(source_id,starts_at) where status in('held','booked');
create index campaign_bookings_lead on public.campaign_bookings(lead_id,created_at desc);
create index campaign_bookings_source_time on public.campaign_bookings(source_id,starts_at);

do $$ declare t text; begin
 foreach t in array array['campaign_sources','campaign_bookings'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from public,anon,authenticated',t);
 end loop;
end $$;

-- Owner or admin of an active workspace.
create or replace function public.campaign_can_manage(p_workspace uuid,p_actor uuid)
returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.workspace_memberships m join public.workspaces w on w.id=m.workspace_id and w.status='active'
  where m.workspace_id=p_workspace and m.user_id=p_actor and m.role in('owner','admin'))
$$;
revoke all on function public.campaign_can_manage(uuid,uuid) from public,anon,authenticated;
grant execute on function public.campaign_can_manage(uuid,uuid) to service_role;

create or replace function public.campaign_new_key()
returns text language sql volatile security definer set search_path='' as $$
 select translate(rtrim(encode(extensions.gen_random_bytes(24),'base64'),'='),'+/','-_')
$$;
revoke all on function public.campaign_new_key() from public,anon,authenticated;
grant execute on function public.campaign_new_key() to service_role;

-- Normalizes a list of origins; raises when one is not https://host.
create or replace function public.campaign_origins(p_value jsonb)
returns text[] language plpgsql immutable security definer set search_path='' as $$
declare v text[];
begin
 if jsonb_typeof(coalesce(p_value,'[]'::jsonb)) is distinct from 'array' then raise exception 'Origins must be a list.'; end if;
 select coalesce(array_agg(distinct lower(o)),'{}') into v from jsonb_array_elements_text(coalesce(p_value,'[]'::jsonb)) o;
 if cardinality(v)>10 or exists(select 1 from unnest(v) o where o !~ '^https://[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$') then
  raise exception 'Origins must be up to 10 https://host values without a path.';
 end if;
 return v;
end $$;
revoke all on function public.campaign_origins(jsonb) from public,anon,authenticated;
grant execute on function public.campaign_origins(jsonb) to service_role;

-- Records a lead event and, when the stage changes, the new stage.
create or replace function public.campaign_lead_note(p_lead uuid,p_kind text,p_detail jsonb,p_stage text default null)
returns void language plpgsql security definer set search_path='' as $$
declare l public.campaign_leads;
begin
 select * into l from public.campaign_leads where id=p_lead for update;
 if not found then raise exception 'Lead not found.'; end if;
 if p_stage is not null and p_stage is distinct from l.stage then
  update public.campaign_leads set stage=p_stage,updated_at=now() where id=p_lead;
  insert into public.campaign_lead_events(workspace_id,lead_id,kind,detail) values(l.workspace_id,p_lead,'stage_changed',jsonb_build_object('from',l.stage,'to',p_stage));
 end if;
 insert into public.campaign_lead_events(workspace_id,lead_id,kind,detail) values(l.workspace_id,p_lead,p_kind,coalesce(p_detail,'{}'::jsonb));
end $$;
revoke all on function public.campaign_lead_note(uuid,text,jsonb,text) from public,anon,authenticated;
grant execute on function public.campaign_lead_note(uuid,text,jsonb,text) to service_role;

-- Owner/admin commands for the Campaigns screens. Service role only; the route passes the signed-in actor.
create or replace function public.campaign_admin(p_action text,p_input jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
 v_workspace uuid; v_actor uuid; v_name text; v_origins text[]; v_key text; v_row public.campaigns; s public.campaign_sources;
 v_lead public.campaign_leads; b public.campaign_bookings; v_slug text; v_stage text; v jsonb; v_id uuid;
begin
 if jsonb_typeof(p_input) is distinct from 'object' then raise exception 'Invalid input.'; end if;
 v_workspace:=(p_input->>'workspace_id')::uuid; v_actor:=(p_input->>'actor_id')::uuid;
 if not public.campaign_can_manage(v_workspace,v_actor) then raise exception 'Owner or admin required.'; end if;

 if p_action='create' then
  v_name:=btrim(p_input->>'name');
  if v_name is null or length(v_name) not between 1 and 120 then raise exception 'Name must be 1 to 120 characters.'; end if;
  v_origins:=public.campaign_origins(p_input->'allowed_origins');
  v_key:=public.campaign_new_key();
  insert into public.campaigns(workspace_id,name,status,intake_key,allowed_origins,created_by)
  values(v_workspace,v_name,'draft',v_key,v_origins,v_actor) returning * into v_row;
  if coalesce((p_input->>'with_source')::boolean,true) then
   insert into public.campaign_sources(workspace_id,campaign_id,name,tag,allowed_origins,intake_key,created_by)
   values(v_workspace,v_row.id,v_name,left(v_name,40),v_origins,v_key,v_actor);
  end if;
  return jsonb_build_object('id',v_row.id,'intake_key',v_row.intake_key,'status',v_row.status,'allowed_origins',to_jsonb(v_row.allowed_origins));
 end if;

 if p_action='update_campaign' then
  select * into v_row from public.campaigns where id=(p_input->>'campaign_id')::uuid and workspace_id=v_workspace for update;
  if not found then raise exception 'Campaign not found.'; end if;
  v_name:=coalesce(btrim(p_input->>'name'),v_row.name);
  if length(v_name) not between 1 and 120 then raise exception 'Name must be 1 to 120 characters.'; end if;
  if coalesce(p_input->>'status',v_row.status) not in('draft','live','paused','archived') then raise exception 'Unknown status.'; end if;
  update public.campaigns set name=v_name,status=coalesce(p_input->>'status',v_row.status),updated_at=now() where id=v_row.id;
  return jsonb_build_object('id',v_row.id);
 end if;

 if p_action='create_source' then
  select * into v_row from public.campaigns where id=(p_input->>'campaign_id')::uuid and workspace_id=v_workspace and status<>'archived';
  if not found then raise exception 'Campaign not found.'; end if;
  insert into public.campaign_sources(workspace_id,campaign_id,name,tag,tag_tone,intake_key,created_by)
  values(v_workspace,v_row.id,'New source','New source',coalesce(nullif(p_input->>'tag_tone',''),'sky'),public.campaign_new_key(),v_actor) returning * into s;
  return jsonb_build_object('id',s.id,'intake_key',s.intake_key);
 end if;

 if p_action in('update_source','move_source') then
  select * into s from public.campaign_sources where id=(p_input->>'source_id')::uuid and workspace_id=v_workspace for update;
  if not found then raise exception 'Source not found.'; end if;
  if p_action='move_source' then
   if not exists(select 1 from public.campaigns where id=(p_input->>'campaign_id')::uuid and workspace_id=v_workspace and status<>'archived') then raise exception 'Campaign not found.'; end if;
   update public.campaign_sources set campaign_id=(p_input->>'campaign_id')::uuid,updated_at=now() where id=s.id;
   update public.campaign_leads set latest_campaign_id=(p_input->>'campaign_id')::uuid,updated_at=now() where latest_source_id=s.id;
   return jsonb_build_object('id',s.id);
  end if;
  v:=coalesce(p_input->'fields','{}'::jsonb);
  if jsonb_typeof(v)<>'object' then raise exception 'Invalid fields.'; end if;
  v_slug:=case when v ? 'booking_slug' then nullif(lower(btrim(v->>'booking_slug')),'') else s.booking_slug end;
  if v_slug is not null and v_slug !~ '^[a-z0-9][a-z0-9-]{1,58}[a-z0-9]$' then raise exception 'The booking address may use a-z, 0-9 and dashes, 3 to 60 characters.'; end if;
  if v_slug is not null and exists(select 1 from public.campaign_sources where booking_slug=v_slug and id<>s.id) then raise exception 'Another source already uses that booking address.'; end if;
  begin
   update public.campaign_sources set
    name=case when v ? 'name' then btrim(v->>'name') else name end,
    tag=case when v ? 'tag' then btrim(v->>'tag') else tag end,
    tag_tone=case when v ? 'tag_tone' then v->>'tag_tone' else tag_tone end,
    page_url=case when v ? 'page_url' then nullif(btrim(v->>'page_url'),'') else page_url end,
    allowed_origins=case when v ? 'allowed_origins' then public.campaign_origins(v->'allowed_origins') else allowed_origins end,
    status=case when v ? 'status' then v->>'status' else status end,
    books=case when v ? 'books' then (v->>'books')::boolean else books end,
    booking_slug=v_slug,
    meeting_title=case when v ? 'meeting_title' then btrim(v->>'meeting_title') else meeting_title end,
    meeting_minutes=case when v ? 'meeting_minutes' then (v->>'meeting_minutes')::integer else meeting_minutes end,
    meeting_place=case when v ? 'meeting_place' then v->>'meeting_place' else meeting_place end,
    meeting_link=case when v ? 'meeting_link' then nullif(btrim(v->>'meeting_link'),'') else meeting_link end,
    time_zone=case when v ? 'time_zone' then v->>'time_zone' else time_zone end,
    booking_days=case when v ? 'booking_days' then array(select (x)::integer from jsonb_array_elements_text(v->'booking_days') x order by 1) else booking_days end,
    day_start_minute=case when v ? 'day_start_minute' then (v->>'day_start_minute')::integer else day_start_minute end,
    day_end_minute=case when v ? 'day_end_minute' then (v->>'day_end_minute')::integer else day_end_minute end,
    notice_hours=case when v ? 'notice_hours' then (v->>'notice_hours')::integer else notice_hours end,
    horizon_days=case when v ? 'horizon_days' then (v->>'horizon_days')::integer else horizon_days end,
    pay_amount_cents=case when v ? 'pay_amount_cents' then (v->>'pay_amount_cents')::integer else pay_amount_cents end,
    hold_minutes=case when v ? 'hold_minutes' then (v->>'hold_minutes')::integer else hold_minutes end,
    refund_rule=case when v ? 'refund_rule' then nullif(btrim(v->>'refund_rule'),'') else refund_rule end,
    updated_at=now()
   where id=s.id returning * into s;
  exception when check_violation or invalid_text_representation or not_null_violation then
   raise exception 'One of the settings is not valid.';
  end;
  return jsonb_build_object('id',s.id,'status',s.status,'books',s.books,'booking_slug',s.booking_slug,'allowed_origins',to_jsonb(s.allowed_origins));
 end if;

 if p_action='set_stage' then
  v_stage:=p_input->>'stage';
  if v_stage not in('not_booked','paid_not_booked','booked','showed','no_show','sold','lost') then raise exception 'Unknown stage.'; end if;
  select * into v_lead from public.campaign_leads where id=(p_input->>'lead_id')::uuid and workspace_id=v_workspace for update;
  if not found then raise exception 'Lead not found.'; end if;
  if v_stage='paid_not_booked' and not exists(select 1 from public.campaign_bookings where lead_id=v_lead.id and paid_at is not null) then raise exception 'Only a Stripe payment moves a lead to Paid, not booked.'; end if;
  if v_stage='booked' and not exists(select 1 from public.campaign_bookings where lead_id=v_lead.id and status='booked') then raise exception 'Book a time for them to move them to Booked.'; end if;
  -- Moving out of Booked by hand cancels the open booking so its time is offered again.
  if v_lead.stage='booked' and v_stage in('not_booked','paid_not_booked','lost') then
   update public.campaign_bookings set status='cancelled',updated_at=now(),actor_id=v_actor where lead_id=v_lead.id and status='booked';
  end if;
  perform public.campaign_lead_note(v_lead.id,'stage_set',jsonb_build_object('by',v_actor),v_stage);
  return jsonb_build_object('id',v_lead.id,'stage',v_stage);
 end if;

 if p_action='booking_status' then
  select * into b from public.campaign_bookings where id=(p_input->>'booking_id')::uuid and workspace_id=v_workspace for update;
  if not found then raise exception 'Booking not found.'; end if;
  v_stage:=p_input->>'status';
  if v_stage not in('cancelled','showed','no_show') or b.status not in('booked','showed','no_show') then raise exception 'That change is not possible for this booking.'; end if;
  update public.campaign_bookings set status=v_stage,actor_id=v_actor,updated_at=now() where id=b.id;
  perform public.campaign_lead_note(b.lead_id,case v_stage when 'cancelled' then 'booking_cancelled' when 'showed' then 'showed' else 'no_show' end,
   jsonb_build_object('booking_id',b.id,'starts_at',b.starts_at,'by',v_actor),
   case v_stage when 'showed' then 'showed' when 'no_show' then 'no_show' else case when b.paid_at is not null then 'paid_not_booked' else 'not_booked' end end);
  return jsonb_build_object('id',b.id,'status',v_stage);
 end if;

 raise exception 'Unknown action.';
end $$;
revoke all on function public.campaign_admin(text,jsonb) from public,anon,authenticated;
grant execute on function public.campaign_admin(text,jsonb) to service_role;

-- The public route's routing facts, now per source. An off source answers like an archived campaign.
create or replace function public.campaign_intake_target(p_key text)
returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('status',case when s.status='off' or c.status='archived' then 'archived' else s.status end,'allowed_origins',to_jsonb(s.allowed_origins))
 from public.campaign_sources s join public.campaigns c on c.id=s.campaign_id join public.workspaces w on w.id=s.workspace_id and w.status='active'
 where s.intake_key=p_key and p_key ~ '^[A-Za-z0-9_-]{32}$'
$$;
revoke all on function public.campaign_intake_target(text) from public,anon,authenticated;
grant execute on function public.campaign_intake_target(text) to service_role;

-- Stores one validated submission atomically, attributed to its source. Leads from a Testing source are Test leads
-- until a live source sends the same phone.
create or replace function public.campaign_intake(p_key text,p_input jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
 s public.campaign_sources; v_campaign public.campaigns; v_lead_id uuid; v_reference text; v_existing public.campaign_lead_submissions;
 v_submission uuid; v_phone text; v_now timestamptz:=now(); v_created boolean; v_test boolean;
 v_answers jsonb; v_contact jsonb; v_attr jsonb;
begin
 if jsonb_typeof(p_input) is distinct from 'object' then return jsonb_build_object('failure','invalid'); end if;
 select x.* into s from public.campaign_sources x join public.workspaces w on w.id=x.workspace_id and w.status='active'
  where x.intake_key=p_key and x.status<>'off' for share of x;
 if not found then return jsonb_build_object('failure','campaign'); end if;
 select * into v_campaign from public.campaigns where id=s.campaign_id and status<>'archived' for share;
 if not found then return jsonb_build_object('failure','campaign'); end if;
 v_test:=s.status='testing';

 begin v_submission:=(p_input->>'submission_id')::uuid; exception when others then return jsonb_build_object('failure','invalid'); end;
 v_phone:=p_input->>'phone_e164';
 v_answers:=coalesce(p_input->'answers','[]'::jsonb); v_attr:=coalesce(p_input->'attribution','{}'::jsonb);
 v_contact:=jsonb_strip_nulls(jsonb_build_object('first_name',p_input->>'first_name','last_name',p_input->>'last_name','company',p_input->>'company','phone',v_phone,'email',p_input->>'email'));
 if v_submission is null or v_phone is null or v_phone !~ '^\+1[2-9][0-9]{9}$' or nullif(p_input->>'first_name','') is null
  or jsonb_typeof(v_answers)<>'array' or jsonb_array_length(v_answers) not between 1 and 20 or jsonb_typeof(v_attr)<>'object'
  or coalesce(p_input->>'ip_hmac','') !~ '^[a-f0-9]{64}$' or coalesce(p_input->>'consent_sha256','') !~ '^[a-f0-9]{64}$' then
  return jsonb_build_object('failure','invalid');
 end if;

 select * into v_existing from public.campaign_lead_submissions where campaign_id=s.campaign_id and submission_id=v_submission;
 if found then
  return jsonb_build_object('accepted',true,'duplicate',true,'reference',(select l.reference from public.campaign_leads l where l.id=v_existing.lead_id));
 end if;

 if (select count(*) from public.campaign_lead_submissions x where x.campaign_id=s.campaign_id and x.ip_hmac=p_input->>'ip_hmac' and x.received_at>v_now-interval '10 minutes')>=8
  or (select count(*) from public.campaign_lead_submissions x join public.campaign_leads l on l.id=x.lead_id
      where l.workspace_id=s.workspace_id and l.phone_e164=v_phone and x.received_at>v_now-interval '10 minutes')>=3 then
  return jsonb_build_object('failure','rate_limited');
 end if;

 begin
 insert into public.campaign_leads as l(workspace_id,first_campaign_id,latest_campaign_id,first_source_id,latest_source_id,is_test,reference,first_name,last_name,company,phone_e164,email,
   answers,first_attribution,sms_consent,sms_consent_at,sms_consent_submission_id,first_submitted_at,last_submitted_at)
 values(s.workspace_id,s.campaign_id,s.campaign_id,s.id,s.id,v_test,encode(extensions.gen_random_bytes(32),'hex'),p_input->>'first_name',nullif(p_input->>'last_name',''),nullif(p_input->>'company',''),
   v_phone,nullif(p_input->>'email',''),v_answers,v_attr,'opted_in',v_now,v_submission,v_now,v_now)
 on conflict(workspace_id,phone_e164) do update set
   latest_campaign_id=excluded.latest_campaign_id,
   latest_source_id=excluded.latest_source_id,
   is_test=l.is_test and excluded.is_test,
   first_name=excluded.first_name,
   last_name=coalesce(excluded.last_name,l.last_name),
   company=coalesce(excluded.company,l.company),
   email=coalesce(excluded.email,l.email),
   answers=excluded.answers,
   sms_consent='opted_in', sms_consent_at=excluded.sms_consent_at, sms_consent_submission_id=excluded.sms_consent_submission_id,
   submission_count=l.submission_count+1,
   last_submitted_at=excluded.last_submitted_at,
   updated_at=excluded.last_submitted_at
 returning l.id,l.reference,(xmax=0) into v_lead_id,v_reference,v_created;

 insert into public.campaign_lead_submissions(workspace_id,campaign_id,source_id,lead_id,submission_id,offer,answers,contact,consent_text,consent_sha256,attribution,ip_hmac,user_agent,received_at)
 values(s.workspace_id,s.campaign_id,s.id,v_lead_id,v_submission,p_input->>'offer',v_answers,v_contact,p_input->>'consent_text',p_input->>'consent_sha256',v_attr,p_input->>'ip_hmac',left(nullif(p_input->>'user_agent',''),300),v_now);

 insert into public.campaign_lead_events(workspace_id,lead_id,kind,detail,created_at)
 values(s.workspace_id,v_lead_id,'submitted',jsonb_build_object('campaign_id',s.campaign_id,'source_id',s.id,'submission_id',v_submission,'new_lead',v_created,'test',v_test),v_now);
 exception when unique_violation then
  select l.reference into v_reference from public.campaign_lead_submissions x join public.campaign_leads l on l.id=x.lead_id
   where x.campaign_id=s.campaign_id and x.submission_id=v_submission;
  if v_reference is null then raise; end if;
  return jsonb_build_object('accepted',true,'duplicate',true,'reference',v_reference);
 end;

 return jsonb_build_object('accepted',true,'duplicate',false,'created',v_created,'reference',v_reference);
end $$;
revoke all on function public.campaign_intake(text,jsonb) from public,anon,authenticated;
grant execute on function public.campaign_intake(text,jsonb) to service_role;

-- Finds the lead a booking page was opened for: by the submission ID the funnel passes on, or the lead reference.
create or replace function public.campaign_booking_lead(p_source public.campaign_sources,p_submission text,p_reference text)
returns public.campaign_leads language plpgsql stable security definer set search_path='' as $$
declare l public.campaign_leads; v_sub uuid;
begin
 if p_submission ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
  v_sub:=p_submission::uuid;
  select x.* into l from public.campaign_leads x join public.campaign_lead_submissions sub on sub.lead_id=x.id
   where sub.campaign_id=p_source.campaign_id and sub.submission_id=v_sub and x.workspace_id=p_source.workspace_id;
  if found then return l; end if;
 end if;
 if p_reference ~ '^[a-f0-9]{64}$' then
  select * into l from public.campaign_leads where reference=p_reference and workspace_id=p_source.workspace_id;
  if found then return l; end if;
 end if;
 return null;
end $$;
revoke all on function public.campaign_booking_lead(public.campaign_sources,text,text) from public,anon,authenticated;
grant execute on function public.campaign_booking_lead(public.campaign_sources,text,text) to service_role;

-- Everything the public booking page needs in one read: the source's public settings, who it is for, their current
-- hold or booking at this source, and the times already taken.
create or replace function public.campaign_booking_page(p_slug text,p_submission text,p_reference text)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare s public.campaign_sources; l public.campaign_leads; v_ws text; v_open public.campaign_bookings; v_credit boolean:=false;
begin
 select x.* into s from public.campaign_sources x join public.campaigns c on c.id=x.campaign_id and c.status<>'archived'
  join public.workspaces w on w.id=x.workspace_id and w.status='active'
  where x.booking_slug=p_slug and x.books and x.status<>'off';
 if not found then return null; end if;
 select name into v_ws from public.workspaces where id=s.workspace_id;
 l:=public.campaign_booking_lead(s,p_submission,p_reference);
 if l.id is not null then
  select * into v_open from public.campaign_bookings where lead_id=l.id and source_id=s.id
   and (status='booked' or (status='held' and held_until>now())) and starts_at>now()-interval '2 hours' order by created_at desc limit 1;
  v_credit:=l.stage='paid_not_booked';
 end if;
 return jsonb_build_object(
  'workspace_name',v_ws,'source_id',s.id,'meeting_title',s.meeting_title,'meeting_minutes',s.meeting_minutes,'meeting_place',s.meeting_place,
  'time_zone',s.time_zone,'booking_days',to_jsonb(s.booking_days),'day_start_minute',s.day_start_minute,'day_end_minute',s.day_end_minute,
  'notice_hours',s.notice_hours,'horizon_days',s.horizon_days,'pay_amount_cents',s.pay_amount_cents,'hold_minutes',s.hold_minutes,'refund_rule',s.refund_rule,
  'lead',case when l.id is null then null else jsonb_build_object('first_name',l.first_name,'paid_credit',v_credit) end,
  'open',case when v_open.id is null then null else jsonb_build_object('id',v_open.id,'status',v_open.status,'starts_at',v_open.starts_at,'held_until',v_open.held_until,'checkout_url',v_open.stripe_checkout_url) end,
  'taken',coalesce((select jsonb_agg(b.starts_at order by b.starts_at) from public.campaign_bookings b where b.source_id=s.id
   and (b.status='booked' or (b.status='held' and b.held_until>now())) and b.starts_at between now() and now()+make_interval(days=>s.horizon_days+1)
   and (v_open.id is null or b.id<>v_open.id)),'[]'::jsonb));
end $$;
revoke all on function public.campaign_booking_page(text,text,text) from public,anon,authenticated;
grant execute on function public.campaign_booking_page(text,text,text) to service_role;

-- Holds (or, without payment, books) one time for the lead. Validates the time against the source's hours, notice
-- and horizon. Returns a failure code instead of raising for anything the visitor can fix.
create or replace function public.campaign_booking_hold(p_slug text,p_input jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare s public.campaign_sources; l public.campaign_leads; v_start timestamptz; v_local timestamp; v_minute integer; b public.campaign_bookings;
 v_pay boolean; v_held_until timestamptz;
begin
 if jsonb_typeof(p_input) is distinct from 'object' then return jsonb_build_object('failure','invalid'); end if;
 select x.* into s from public.campaign_sources x join public.campaigns c on c.id=x.campaign_id and c.status<>'archived'
  join public.workspaces w on w.id=x.workspace_id and w.status='active'
  where x.booking_slug=p_slug and x.books and x.status<>'off' for share of x;
 if not found then return jsonb_build_object('failure','source'); end if;
 l:=public.campaign_booking_lead(s,p_input->>'submission',p_input->>'reference');
 if l.id is null then return jsonb_build_object('failure','lead'); end if;
 select * into l from public.campaign_leads where id=l.id for update;
 if l.stage in('sold','lost') then return jsonb_build_object('failure','closed'); end if;
 begin v_start:=(p_input->>'starts_at')::timestamptz; exception when others then return jsonb_build_object('failure','invalid'); end;
 v_local:=v_start at time zone s.time_zone;
 v_minute:=extract(hour from v_local)::integer*60+extract(minute from v_local)::integer;
 if v_start is null or extract(second from v_local)<>0 or v_start<now()+make_interval(hours=>s.notice_hours) or v_start>now()+make_interval(days=>s.horizon_days)
  or not (extract(dow from v_local)::integer = any(s.booking_days)) or v_minute<s.day_start_minute or v_minute+s.meeting_minutes>s.day_end_minute
  or (v_minute-s.day_start_minute)%s.meeting_minutes<>0 then
  return jsonb_build_object('failure','time');
 end if;
 if exists(select 1 from public.campaign_bookings where lead_id=l.id and source_id=s.id and status='booked' and starts_at>now()) then
  return jsonb_build_object('failure','already_booked');
 end if;

 -- Lapsed holds give their time back; the lead's own earlier hold here is replaced by this one.
 update public.campaign_bookings set status='released',updated_at=now() where source_id=s.id and status='held' and held_until<=now();
 update public.campaign_bookings set status='released',updated_at=now() where lead_id=l.id and source_id=s.id and status='held';

 v_pay:=s.pay_amount_cents is not null and l.stage<>'paid_not_booked';
 v_held_until:=case when v_pay then now()+make_interval(mins=>s.hold_minutes) else null end;
 begin
  insert into public.campaign_bookings(workspace_id,campaign_id,source_id,lead_id,starts_at,ends_at,status,held_until,amount_cents)
  values(s.workspace_id,s.campaign_id,s.id,l.id,v_start,v_start+make_interval(mins=>s.meeting_minutes),case when v_pay then 'held' else 'booked' end,v_held_until,
   case when v_pay then s.pay_amount_cents else null end) returning * into b;
 exception when unique_violation then
  return jsonb_build_object('failure','taken');
 end;
 if v_pay then
  perform public.campaign_lead_note(l.id,'time_held',jsonb_build_object('booking_id',b.id,'starts_at',b.starts_at,'held_until',b.held_until),null);
 else
  perform public.campaign_lead_note(l.id,'booked',jsonb_build_object('booking_id',b.id,'starts_at',b.starts_at,'by','lead'),'booked');
 end if;
 return jsonb_build_object('booking_id',b.id,'status',b.status,'starts_at',b.starts_at,'held_until',b.held_until,'amount_cents',b.amount_cents,
  'workspace_id',s.workspace_id,'source_id',s.id,'meeting_title',s.meeting_title,'lead_first_name',l.first_name,'lead_email',l.email,'lead_phone',l.phone_e164,'lead_test',l.is_test);
end $$;
revoke all on function public.campaign_booking_hold(text,jsonb) from public,anon,authenticated;
grant execute on function public.campaign_booking_hold(text,jsonb) to service_role;

-- Saves the Checkout page made for a hold, so returning to the booking page resumes the same payment.
create or replace function public.campaign_booking_checkout(p_booking uuid,p_session text,p_url text)
returns boolean language plpgsql security definer set search_path='' as $$
begin
 update public.campaign_bookings set stripe_checkout_session_id=p_session,stripe_checkout_url=p_url,updated_at=now()
  where id=p_booking and status='held' and paid_at is null;
 return found;
end $$;
revoke all on function public.campaign_booking_checkout(uuid,text,text) from public,anon,authenticated;
grant execute on function public.campaign_booking_checkout(uuid,text,text) to service_role;

-- Applies a confirmed Stripe payment once. The held time is booked if it is still free (even after the hold lapsed);
-- otherwise the lead is Paid, not booked and picks a new time without paying again.
create or replace function public.campaign_booking_paid(p_input jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare b public.campaign_bookings; v_amount integer; v_booked boolean:=false;
begin
 select * into b from public.campaign_bookings where id=(p_input->>'booking_id')::uuid and workspace_id=(p_input->>'workspace_id')::uuid for update;
 if not found then return jsonb_build_object('failure','booking'); end if;
 if b.paid_at is not null then return jsonb_build_object('duplicate',true,'status',b.status); end if;
 v_amount:=(p_input->>'amount_cents')::integer;
 update public.campaign_bookings set paid_at=now(),stripe_event_id=p_input->>'event_id',amount_cents=coalesce(v_amount,amount_cents),
  stripe_checkout_session_id=coalesce(stripe_checkout_session_id,p_input->>'session_id'),updated_at=now() where id=b.id;
 perform public.campaign_lead_note(b.lead_id,'paid',jsonb_build_object('booking_id',b.id,'amount_cents',coalesce(v_amount,b.amount_cents),'stripe_event_id',p_input->>'event_id'),null);
 if b.status in('held','released') then
  begin
   update public.campaign_bookings set status='booked',held_until=null,updated_at=now() where id=b.id;
   v_booked:=true;
  exception when unique_violation then
   update public.campaign_bookings set status='released',updated_at=now() where id=b.id;
  end;
 end if;
 if v_booked then
  perform public.campaign_lead_note(b.lead_id,'booked',jsonb_build_object('booking_id',b.id,'starts_at',b.starts_at,'by','payment'),'booked');
  return jsonb_build_object('status','booked','booking_id',b.id);
 end if;
 perform public.campaign_lead_note(b.lead_id,'paid_time_taken',jsonb_build_object('booking_id',b.id,'starts_at',b.starts_at),'paid_not_booked');
 return jsonb_build_object('status','paid_not_booked','booking_id',b.id);
end $$;
revoke all on function public.campaign_booking_paid(jsonb) from public,anon,authenticated;
grant execute on function public.campaign_booking_paid(jsonb) to service_role;

notify pgrst,'reload schema';
commit;
