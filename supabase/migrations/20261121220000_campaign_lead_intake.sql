-- Campaign lead intake (docs/campaign-intake.md). Additive: four new service-only tables and two
-- service-only functions. Nothing existing is read, changed or backfilled, and nothing is sent.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';

create table public.campaigns (
 id uuid primary key default gen_random_uuid(),
 workspace_id uuid not null references public.workspaces(id),
 name text not null check(length(btrim(name)) between 1 and 120),
 status text not null default 'draft' check(status in('draft','live','paused','archived')),
 intake_key text not null unique check(intake_key ~ '^[A-Za-z0-9_-]{32}$'),
 allowed_origins text[] not null default '{}' check(cardinality(allowed_origins)<=10),
 created_by uuid references auth.users(id),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create index campaigns_workspace on public.campaigns(workspace_id,created_at desc);

create table public.campaign_leads (
 id uuid primary key default gen_random_uuid(),
 workspace_id uuid not null references public.workspaces(id),
 first_campaign_id uuid not null references public.campaigns(id),
 latest_campaign_id uuid not null references public.campaigns(id),
 reference text not null unique check(reference ~ '^[a-f0-9]{64}$'),
 stage text not null default 'new' check(stage in('new','texted','replied','paid','booked','showed','no_show','sold','lost')),
 first_name text not null check(length(first_name) between 1 and 80),
 last_name text check(length(last_name)<=80),
 company text check(length(company)<=160),
 phone_e164 text not null check(phone_e164 ~ '^\+1[2-9][0-9]{9}$'),
 email text check(length(email)<=254),
 answers jsonb not null default '[]' check(jsonb_typeof(answers)='array' and octet_length(answers::text)<=16384),
 first_attribution jsonb not null default '{}' check(jsonb_typeof(first_attribution)='object' and octet_length(first_attribution::text)<=8192),
 sms_consent text not null default 'opted_in' check(sms_consent in('opted_in','opted_out')),
 sms_consent_at timestamptz not null,
 sms_consent_submission_id uuid,
 relationship_id uuid references public.relationships(id),
 assigned_to uuid references auth.users(id),
 submission_count integer not null default 1 check(submission_count>0),
 first_submitted_at timestamptz not null default now(),
 last_submitted_at timestamptz not null default now(),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 unique(workspace_id,phone_e164)
);
create index campaign_leads_campaign on public.campaign_leads(latest_campaign_id,last_submitted_at desc);
create index campaign_leads_workspace_recent on public.campaign_leads(workspace_id,last_submitted_at desc);

create table public.campaign_lead_submissions (
 id uuid primary key default gen_random_uuid(),
 workspace_id uuid not null references public.workspaces(id),
 campaign_id uuid not null references public.campaigns(id),
 lead_id uuid not null references public.campaign_leads(id),
 submission_id uuid not null,
 offer text not null check(offer ~ '^[a-z0-9_-]{1,64}$'),
 answers jsonb not null check(jsonb_typeof(answers)='array' and octet_length(answers::text)<=16384),
 contact jsonb not null check(jsonb_typeof(contact)='object' and octet_length(contact::text)<=4096),
 consent_text text not null check(length(consent_text) between 20 and 2000),
 consent_sha256 text not null check(consent_sha256 ~ '^[a-f0-9]{64}$'),
 attribution jsonb not null default '{}' check(jsonb_typeof(attribution)='object' and octet_length(attribution::text)<=8192),
 ip_hmac text not null check(ip_hmac ~ '^[a-f0-9]{64}$'),
 user_agent text check(length(user_agent)<=300),
 received_at timestamptz not null default now(),
 unique(campaign_id,submission_id)
);
create index campaign_lead_submissions_ip on public.campaign_lead_submissions(campaign_id,ip_hmac,received_at);
create index campaign_lead_submissions_lead on public.campaign_lead_submissions(lead_id,received_at);

create table public.campaign_lead_events (
 id uuid primary key default gen_random_uuid(),
 workspace_id uuid not null references public.workspaces(id),
 lead_id uuid not null references public.campaign_leads(id),
 kind text not null check(kind ~ '^[a-z_]{1,40}$'),
 detail jsonb not null default '{}' check(jsonb_typeof(detail)='object' and octet_length(detail::text)<=4096),
 created_at timestamptz not null default now()
);
create index campaign_lead_events_lead on public.campaign_lead_events(lead_id,created_at);

do $$ declare t text; begin
 foreach t in array array['campaigns','campaign_leads','campaign_lead_submissions','campaign_lead_events'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from public,anon,authenticated',t);
 end loop;
end $$;

-- Owner/admin campaign setup until the Campaigns screens exist. Service role only.
create or replace function public.campaign_admin(p_action text,p_input jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
 v_workspace uuid; v_actor uuid; v_name text; v_origins text[]; v_key text; v_row public.campaigns;
begin
 if p_action is distinct from 'create' then raise exception 'Unknown action.'; end if;
 if jsonb_typeof(p_input) is distinct from 'object' then raise exception 'Invalid input.'; end if;
 v_workspace:=(p_input->>'workspace_id')::uuid; v_actor:=(p_input->>'actor_id')::uuid; v_name:=btrim(p_input->>'name');
 if not exists(select 1 from public.workspace_memberships m join public.workspaces w on w.id=m.workspace_id and w.status='active'
   where m.workspace_id=v_workspace and m.user_id=v_actor and m.role in('owner','admin')) then
  raise exception 'Owner or admin required.';
 end if;
 if v_name is null or length(v_name) not between 1 and 120 then raise exception 'Name must be 1 to 120 characters.'; end if;
 if jsonb_typeof(coalesce(p_input->'allowed_origins','[]'::jsonb)) is distinct from 'array' then raise exception 'Origins must be a list.'; end if;
 select coalesce(array_agg(lower(o) order by o),'{}') into v_origins from jsonb_array_elements_text(coalesce(p_input->'allowed_origins','[]'::jsonb)) o;
 if cardinality(v_origins)>10 or exists(select 1 from unnest(v_origins) o where o !~ '^https://[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$') then
  raise exception 'Origins must be up to 10 https://host values without a path.';
 end if;
 v_key:=translate(rtrim(encode(extensions.gen_random_bytes(24),'base64'),'='),'+/','-_');
 insert into public.campaigns(workspace_id,name,status,intake_key,allowed_origins,created_by)
 values(v_workspace,v_name,'draft',v_key,v_origins,v_actor) returning * into v_row;
 return jsonb_build_object('id',v_row.id,'intake_key',v_row.intake_key,'status',v_row.status,'allowed_origins',to_jsonb(v_row.allowed_origins));
end $$;
revoke all on function public.campaign_admin(text,jsonb) from public,anon,authenticated;
grant execute on function public.campaign_admin(text,jsonb) to service_role;

-- Looks up a campaign's routing facts for the public route (origin check, archived state).
create or replace function public.campaign_intake_target(p_key text)
returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('status',c.status,'allowed_origins',to_jsonb(c.allowed_origins))
 from public.campaigns c join public.workspaces w on w.id=c.workspace_id and w.status='active'
 where c.intake_key=p_key and p_key ~ '^[A-Za-z0-9_-]{32}$'
$$;
revoke all on function public.campaign_intake_target(text) from public,anon,authenticated;
grant execute on function public.campaign_intake_target(text) to service_role;

-- Stores one validated submission atomically. The route normalizes and validates first; the
-- checks here are the database's own guarantee.
create or replace function public.campaign_intake(p_key text,p_input jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
 c public.campaigns; v_lead_id uuid; v_reference text; v_existing public.campaign_lead_submissions;
 v_submission uuid; v_phone text; v_now timestamptz:=now(); v_created boolean;
 v_answers jsonb; v_contact jsonb; v_attr jsonb;
begin
 if jsonb_typeof(p_input) is distinct from 'object' then return jsonb_build_object('failure','invalid'); end if;
 select x.* into c from public.campaigns x join public.workspaces w on w.id=x.workspace_id and w.status='active'
  where x.intake_key=p_key and x.status<>'archived' for share of x;
 if not found then return jsonb_build_object('failure','campaign'); end if;

 begin v_submission:=(p_input->>'submission_id')::uuid; exception when others then return jsonb_build_object('failure','invalid'); end;
 v_phone:=p_input->>'phone_e164';
 v_answers:=coalesce(p_input->'answers','[]'::jsonb); v_attr:=coalesce(p_input->'attribution','{}'::jsonb);
 v_contact:=jsonb_strip_nulls(jsonb_build_object('first_name',p_input->>'first_name','last_name',p_input->>'last_name','company',p_input->>'company','phone',v_phone,'email',p_input->>'email'));
 if v_submission is null or v_phone is null or v_phone !~ '^\+1[2-9][0-9]{9}$' or nullif(p_input->>'first_name','') is null
  or jsonb_typeof(v_answers)<>'array' or jsonb_array_length(v_answers) not between 1 and 20 or jsonb_typeof(v_attr)<>'object'
  or coalesce(p_input->>'ip_hmac','') !~ '^[a-f0-9]{64}$' or coalesce(p_input->>'consent_sha256','') !~ '^[a-f0-9]{64}$' then
  return jsonb_build_object('failure','invalid');
 end if;

 -- A repeated submission returns its first result.
 select * into v_existing from public.campaign_lead_submissions where campaign_id=c.id and submission_id=v_submission;
 if found then
  return jsonb_build_object('accepted',true,'duplicate',true,'reference',(select l.reference from public.campaign_leads l where l.id=v_existing.lead_id));
 end if;

 if (select count(*) from public.campaign_lead_submissions s where s.campaign_id=c.id and s.ip_hmac=p_input->>'ip_hmac' and s.received_at>v_now-interval '10 minutes')>=8
  or (select count(*) from public.campaign_lead_submissions s join public.campaign_leads l on l.id=s.lead_id
      where l.workspace_id=c.workspace_id and l.phone_e164=v_phone and s.received_at>v_now-interval '10 minutes')>=3 then
  return jsonb_build_object('failure','rate_limited');
 end if;

 -- A concurrent copy of the same submission loses on the receipt's unique key; this block then
 -- rolls back its lead change and answers with the winner's result.
 begin
 insert into public.campaign_leads as l(workspace_id,first_campaign_id,latest_campaign_id,reference,first_name,last_name,company,phone_e164,email,
   answers,first_attribution,sms_consent,sms_consent_at,sms_consent_submission_id,first_submitted_at,last_submitted_at)
 values(c.workspace_id,c.id,c.id,encode(extensions.gen_random_bytes(32),'hex'),p_input->>'first_name',nullif(p_input->>'last_name',''),nullif(p_input->>'company',''),
   v_phone,nullif(p_input->>'email',''),v_answers,v_attr,'opted_in',v_now,v_submission,v_now,v_now)
 on conflict(workspace_id,phone_e164) do update set
   latest_campaign_id=excluded.latest_campaign_id,
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

 insert into public.campaign_lead_submissions(workspace_id,campaign_id,lead_id,submission_id,offer,answers,contact,consent_text,consent_sha256,attribution,ip_hmac,user_agent,received_at)
 values(c.workspace_id,c.id,v_lead_id,v_submission,p_input->>'offer',v_answers,v_contact,p_input->>'consent_text',p_input->>'consent_sha256',v_attr,p_input->>'ip_hmac',left(nullif(p_input->>'user_agent',''),300),v_now);

 insert into public.campaign_lead_events(workspace_id,lead_id,kind,detail,created_at)
 values(c.workspace_id,v_lead_id,'submitted',jsonb_build_object('campaign_id',c.id,'submission_id',v_submission,'new_lead',v_created),v_now);
 exception when unique_violation then
  select l.reference into v_reference from public.campaign_lead_submissions s join public.campaign_leads l on l.id=s.lead_id
   where s.campaign_id=c.id and s.submission_id=v_submission;
  if v_reference is null then raise; end if;
  return jsonb_build_object('accepted',true,'duplicate',true,'reference',v_reference);
 end;

 return jsonb_build_object('accepted',true,'duplicate',false,'created',v_created,'reference',v_reference);
end $$;
revoke all on function public.campaign_intake(text,jsonb) from public,anon,authenticated;
grant execute on function public.campaign_intake(text,jsonb) to service_role;

notify pgrst,'reload schema';
commit;
