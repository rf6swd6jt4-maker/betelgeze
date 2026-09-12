-- SS-02. New relationships and additional service instances, with legacy
-- assignments still owned by their original workflow until its cutover.
begin;
create table public.relationship_create_receipts (
    workspace_id uuid not null,
    actor_user_id uuid not null references auth.users(id),
    request_id uuid not null,
    relationship_id uuid not null,
    input jsonb not null,
    created_at timestamptz not null default now(),
    primary key(workspace_id,actor_user_id,request_id),
    foreign key(workspace_id,relationship_id) references public.relationships(workspace_id,id)
);
alter table public.relationship_create_receipts enable row level security;
revoke all on public.relationship_create_receipts from public,anon,authenticated;
grant select,insert on public.relationship_create_receipts to service_role;

create or replace function public.workspace_user_can_access_relationship(p_workspace_id uuid,p_relationship_id uuid,p_user_id uuid default auth.uid()) returns boolean
language sql stable security definer set search_path=public as $$
 select exists(select 1 from public.relationships r join public.workspace_memberships m on m.workspace_id=r.workspace_id and m.user_id=p_user_id
 where r.workspace_id=p_workspace_id and r.id=p_relationship_id and (m.role in ('owner','admin')
 or r.seller_user_id=p_user_id or r.fulfilment_manager_user_id=p_user_id
 or (r.pos_started_at is null and r.team_locked_at is null and public.workspace_user_can_sell(p_workspace_id,p_user_id))
 or exists(select 1 from public.relationship_services s where s.workspace_id=p_workspace_id and s.relationship_id=r.id and s.assignee_user_id=p_user_id)
 or exists(select 1 from public.relationship_service_instances i where i.workspace_id=p_workspace_id and i.relationship_id=r.id and i.import_id is null and i.disposition <> 'cancelled' and p_user_id in(i.assignee_user_id,i.seller_user_id,i.manager_user_id))))
$$;
create or replace function public.workspace_user_fully_covers_relationship(p_workspace_id uuid,p_relationship_id uuid,p_user_id uuid default auth.uid()) returns boolean
language sql stable security definer set search_path=public as $$
 select exists(select 1 from public.relationships r join public.workspace_memberships m on m.workspace_id=r.workspace_id and m.user_id=p_user_id
 where r.workspace_id=p_workspace_id and r.id=p_relationship_id and (m.role in ('owner','admin') or r.seller_user_id=p_user_id or r.fulfilment_manager_user_id=p_user_id
 or (r.pos_started_at is null and r.team_locked_at is null and public.workspace_user_can_sell(p_workspace_id,p_user_id))
 or ((exists(select 1 from public.relationship_services s where s.workspace_id=r.workspace_id and s.relationship_id=r.id)
      or exists(select 1 from public.relationship_service_instances i where i.workspace_id=r.workspace_id and i.relationship_id=r.id and i.import_id is null))
 and not exists(select 1 from public.relationship_services s where s.workspace_id=r.workspace_id and s.relationship_id=r.id and s.assignee_user_id is distinct from p_user_id)
 and not exists(select 1 from public.relationship_service_instances i where i.workspace_id=r.workspace_id and i.relationship_id=r.id and i.import_id is null and i.assignee_user_id is distinct from p_user_id))))
$$;

create function public.create_empty_relationship(p_workspace_id uuid,p_actor_user_id uuid,p_request_id uuid,p_details jsonb) returns uuid
language plpgsql security definer set search_path=public as $$
declare prior public.relationship_create_receipts%rowtype; rid uuid;
begin
 if not exists(select 1 from public.workspace_memberships where workspace_id=p_workspace_id and user_id=p_actor_user_id and role in ('owner','admin'))
    and not public.workspace_user_can_sell(p_workspace_id,p_actor_user_id) then raise exception 'Seller access required'; end if;
 if p_request_id is null or jsonb_typeof(p_details) is distinct from 'object' or length(btrim(coalesce(p_details->>'name',''))) not between 1 and 200
    or length(coalesce(p_details->>'company',''))>200 or length(coalesce(p_details->>'email',''))>320 or length(coalesce(p_details->>'phone',''))>80 then raise exception 'Check the relationship details'; end if;
 -- Serializes duplicate requests only, not unrelated clients.
 perform pg_advisory_xact_lock(hashtextextended(p_workspace_id::text||p_actor_user_id::text||p_request_id::text,0));
 select * into prior from public.relationship_create_receipts where workspace_id=p_workspace_id and actor_user_id=p_actor_user_id and request_id=p_request_id;
 if prior.relationship_id is not null then
    if prior.input <> p_details then raise exception 'This request was already used with different details'; end if;
    return prior.relationship_id;
 end if;
 insert into public.relationships(workspace_id,primary_person_name,business_name,primary_email,primary_phone,source_type,source_label,lifecycle_phase,status,source_metadata)
 values(p_workspace_id,btrim(p_details->>'name'),nullif(btrim(p_details->>'company'),''),nullif(btrim(p_details->>'email'),''),nullif(btrim(p_details->>'phone'),''),'manual','Manual','potential_client','active',
    jsonb_build_object('created_by',p_actor_user_id,'created_from','service_relationship','service_instances',true,'is_test',coalesce((p_details->>'isTest')::boolean,false))) returning id into rid;
 insert into public.relationship_create_receipts values(p_workspace_id,p_actor_user_id,p_request_id,rid,p_details,now());
 return rid;
end $$;

-- A compact common read model avoids loading the onboarding builder on detail entry.
create function public.relationship_service_rows(p_workspace_id uuid,p_relationship_id uuid,p_user_id uuid)
returns table(id text,service_id uuid,service_revision_id uuid,name text,stage text,origin text,assignee_user_id uuid,assignee_name text,version integer,upfront_cents integer,recurring_cents integer,currency text,created_at timestamptz,legacy boolean)
language sql stable security definer set search_path=public as $$
 with permitted as (select public.workspace_user_can_access_relationship(p_workspace_id,p_relationship_id,p_user_id) access,
     public.workspace_user_fully_covers_relationship(p_workspace_id,p_relationship_id,p_user_id) full_access),
 rows as (
 select i.id::text id,i.service_id,i.service_revision_id,coalesce(v.name,i.service_key) name,i.stage,i.origin,i.assignee_user_id,i.version,
    coalesce(v.default_upfront_price_cents,0) upfront_cents,coalesce(v.default_recurring_price_cents,0) recurring_cents,coalesce(v.currency,'USD') currency,i.created_at,false legacy
 from public.relationship_service_instances i left join public.onboarding_service_revisions v on v.workspace_id=i.workspace_id and v.id=i.service_revision_id,permitted p
 where i.workspace_id=p_workspace_id and i.relationship_id=p_relationship_id and i.import_id is null and i.disposition<>'cancelled' and p.access and (p.full_access or i.assignee_user_id=p_user_id)
 union all
 select 'legacy:'||s.service_key,s.service_id,s.service_revision_id,coalesce(v.name,s.service_key),
    case r.lifecycle_phase when 'lead' then 'negotiating' when 'nurturing' then 'negotiating' when 'potential_client' then 'negotiating' when 'sold' then 'awaiting_payment' when 'invoiced' then 'awaiting_payment' when 'onboarding' then 'onboarding' when 'onboarding_review' then 'onboarding' when 'fulfilment' then 'setup' else null end,
    'legacy',s.assignee_user_id,0,s.upfront_price_cents,s.recurring_price_cents,upper(s.currency),s.created_at,true
 from public.relationship_services s join public.relationships r on r.workspace_id=s.workspace_id and r.id=s.relationship_id
 left join public.onboarding_service_revisions v on v.workspace_id=s.workspace_id and v.id=s.service_revision_id,permitted p
 where s.workspace_id=p_workspace_id and s.relationship_id=p_relationship_id and p.access and (p.full_access or s.assignee_user_id=p_user_id)
 ) select x.id,x.service_id,x.service_revision_id,x.name,x.stage,x.origin,x.assignee_user_id,coalesce(u.display_name,u.username,'Unassigned'),x.version,x.upfront_cents,x.recurring_cents,x.currency,x.created_at,x.legacy
 from rows x left join public.user_profiles u on u.user_id=x.assignee_user_id
$$;

create function public.read_relationship_services(p_workspace_id uuid,p_relationship_id uuid,p_user_id uuid,p_offset integer default 0) returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare result jsonb; totals jsonb;
begin
 if not public.workspace_user_can_access_relationship(p_workspace_id,p_relationship_id,p_user_id) then raise exception 'Relationship access required'; end if;
 if p_offset<0 or p_offset>10000 then raise exception 'Invalid page'; end if;
 select jsonb_build_object('items',coalesce(jsonb_agg(to_jsonb(x)),'[]'),'hasMore',count(*)>30) into result
 from (select * from public.relationship_service_rows(p_workspace_id,p_relationship_id,p_user_id) order by created_at,id limit 31 offset p_offset) x;
 if p_offset=0 and public.workspace_user_fully_covers_relationship(p_workspace_id,p_relationship_id,p_user_id) then
  select coalesce(jsonb_agg(to_jsonb(t)),'[]') into totals from (
   select upper(x.currency) currency,'catalogue_estimate'::text kind,cadence.billing_interval,cadence.billing_interval_count,sum(x.upfront_cents)::bigint upfront_cents,sum(x.recurring_cents)::bigint recurring_cents
   from public.relationship_service_rows(p_workspace_id,p_relationship_id,p_user_id) x
   left join public.onboarding_service_revisions v on v.workspace_id=p_workspace_id and v.id=x.service_revision_id
   cross join lateral (select
    case when coalesce(v.definition->>'defaultBillingInterval',v.definition->>'default_billing_interval') in ('week','month','year') then coalesce(v.definition->>'defaultBillingInterval',v.definition->>'default_billing_interval') else 'month' end billing_interval,
    case when coalesce(v.definition->>'defaultBillingIntervalCount',v.definition->>'default_billing_interval_count') ~ '^[1-9][0-9]{0,2}$' then coalesce(v.definition->>'defaultBillingIntervalCount',v.definition->>'default_billing_interval_count')::integer else 1 end billing_interval_count
   ) cadence
   where x.stage='negotiating' group by upper(x.currency),cadence.billing_interval,cadence.billing_interval_count
   union all
   select upper(currency),'sold',billing_interval,billing_interval_count,sum(upfront_total_amount)::bigint,sum(recurring_total_amount)::bigint
   from public.client_sales where workspace_id=p_workspace_id and relationship_id=p_relationship_id and snapshot_frozen_at is not null
    and status in ('onboarding_payment_pending','onboarding_created','onboarding_link_sent','onboarding_link_failed','payment_failed','paid')
   group by upper(currency),billing_interval,billing_interval_count
  ) t;
  result := result || jsonb_build_object('values',totals);
 end if;
 return result;
end $$;

create function public.summarize_relationship_services(p_workspace_id uuid,p_user_id uuid,p_relationship_ids uuid[]) returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare result jsonb;
begin
 if cardinality(p_relationship_ids)>2000 then raise exception 'Use a smaller relationship page'; end if;
 select coalesce(jsonb_agg(jsonb_build_object('relationship_id',r.id,'stages',s.stages,'count',s.n,'services',s.labels)),'[]') into result
 from public.relationships r cross join lateral (
    select count(*) n,coalesce(jsonb_agg(distinct stage) filter(where stage is not null),'[]') stages,
       jsonb_path_query_array(coalesce(jsonb_agg(jsonb_build_object('key',id,'label',name) order by created_at,id),'[]'),'$[0 to 3]') labels
    from public.relationship_service_rows(p_workspace_id,r.id,p_user_id)
 ) s where r.workspace_id=p_workspace_id and r.id=any(p_relationship_ids) and public.workspace_user_can_access_relationship(p_workspace_id,r.id,p_user_id);
 return result;
end $$;

create function public.relationship_service_catalogue(p_workspace_id uuid,p_user_id uuid,p_query text default '',p_offset integer default 0) returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare result jsonb;
begin
 if not exists(select 1 from public.workspace_memberships where workspace_id=p_workspace_id and user_id=p_user_id and role in ('owner','admin'))
    and not public.workspace_user_can_sell(p_workspace_id,p_user_id) then raise exception 'Seller access required'; end if;
 if length(p_query)>100 or p_offset<0 or p_offset>10000 then raise exception 'Invalid catalogue page'; end if;
 select coalesce(jsonb_agg(to_jsonb(x)),'[]') into result from (
    select s.id,v.id revision_id,v.name,v.description,v.default_upfront_price_cents upfront_cents,v.default_recurring_price_cents recurring_cents,v.currency
    from public.onboarding_services s cross join lateral (select v.* from public.onboarding_service_revisions v where v.workspace_id=s.workspace_id and v.service_id=s.id order by v.revision_number desc limit 1) v
    where s.workspace_id=p_workspace_id and s.state='active' and (p_query='' or v.name ilike '%'||p_query||'%') order by lower(v.name),s.id limit 31 offset p_offset
 ) x;
 return result;
end $$;

revoke all on function public.create_empty_relationship(uuid,uuid,uuid,jsonb),public.relationship_service_rows(uuid,uuid,uuid),public.read_relationship_services(uuid,uuid,uuid,integer),public.summarize_relationship_services(uuid,uuid,uuid[]),public.relationship_service_catalogue(uuid,uuid,text,integer) from public,anon,authenticated;
grant execute on function public.create_empty_relationship(uuid,uuid,uuid,jsonb),public.read_relationship_services(uuid,uuid,uuid,integer),public.summarize_relationship_services(uuid,uuid,uuid[]),public.relationship_service_catalogue(uuid,uuid,text,integer) to service_role;

-- Sellers can add/edit opportunities they can access. Recording existing delivery
-- remains an explicit owner/admin operation; no billing or onboarding is invoked.
create function public.can_manage_relationship_service(p_workspace_id uuid,p_relationship_id uuid,p_user_id uuid,p_origin text) returns boolean
language sql stable security definer set search_path=public as $$
 select public.workspace_user_can_access_relationship(p_workspace_id,p_relationship_id,p_user_id) and
 (exists(select 1 from public.workspace_memberships where workspace_id=p_workspace_id and user_id=p_user_id and role in ('owner','admin'))
 or (p_origin='negotiation' and public.workspace_user_can_sell(p_workspace_id,p_user_id)))
$$;
create or replace function public.create_service_instance(
    p_workspace_id uuid, p_relationship_id uuid, p_actor_user_id uuid, p_request_id uuid,
    p_service_id uuid, p_origin text, p_stage text, p_assignee_user_id uuid default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare i public.relationship_service_instances%rowtype; s public.onboarding_services%rowtype; revision_id uuid;
begin
    if not public.can_manage_relationship_service(p_workspace_id,p_relationship_id,p_actor_user_id,p_origin) then raise exception 'Service assignment access required'; end if;
    if p_request_id is null or p_origin is null or p_stage is null or p_origin not in ('negotiation', 'already_onboarded') then raise exception 'Choose Negotiating or Already onboarded'; end if;
    select * into i from public.relationship_service_instances where workspace_id = p_workspace_id and relationship_id = p_relationship_id and source_key = 'request:' || p_request_id;
    if i.id is not null then
        if i.source_snapshot <> jsonb_build_object('service_id', p_service_id, 'origin', p_origin, 'stage', p_stage, 'assignee_user_id', p_assignee_user_id, 'actor_user_id', p_actor_user_id) then raise exception 'Request ID reused with different input'; end if;
        return i.id;
    end if;
    select * into strict s from public.onboarding_services where workspace_id = p_workspace_id and id = p_service_id and state = 'active';
    select id into revision_id from public.onboarding_service_revisions where workspace_id = p_workspace_id and service_id = s.id order by revision_number desc limit 1;
    if revision_id is null then raise exception 'Publish this service before assigning it'; end if;
    insert into public.relationship_service_instances(workspace_id, relationship_id, service_id, service_revision_id, service_key, source_key, origin, stage,
        assignee_user_id, source_snapshot, change_request_id, change_reason, changed_by)
    values(p_workspace_id, p_relationship_id, s.id, revision_id, s.internal_code, 'request:' || p_request_id, p_origin, p_stage,
        p_assignee_user_id, jsonb_build_object('service_id', p_service_id, 'origin', p_origin, 'stage', p_stage, 'assignee_user_id', p_assignee_user_id, 'actor_user_id', p_actor_user_id),
        p_request_id, 'Service added to relationship', p_actor_user_id)
    on conflict (workspace_id, relationship_id, source_key) do nothing returning * into i;
    if i.id is null then
        -- Concurrent duplicate: verify intent, rather than accepting changed input.
        return public.create_service_instance(p_workspace_id, p_relationship_id, p_actor_user_id, p_request_id, p_service_id, p_origin, p_stage, p_assignee_user_id);
    end if;
    return i.id;
end $$;

create or replace function public.change_service_instance(
    p_workspace_id uuid, p_instance_id uuid, p_actor_user_id uuid, p_request_id uuid, p_expected_version integer,
    p_stage text, p_disposition text, p_assignee_user_id uuid, p_reason text
) returns integer
language plpgsql security definer set search_path = public as $$
declare i public.relationship_service_instances%rowtype; e public.service_instance_stage_events%rowtype;
begin

    if p_expected_version is null or p_request_id is null then raise exception 'Version and request ID are required'; end if;
    select * into strict i from public.relationship_service_instances where workspace_id = p_workspace_id and id = p_instance_id for update;
    if not public.can_manage_relationship_service(p_workspace_id,i.relationship_id,p_actor_user_id,i.origin) then raise exception 'Service editing access required'; end if;
    select * into e from public.service_instance_stage_events where workspace_id = p_workspace_id and instance_id = p_instance_id and request_id = p_request_id;
    if e.id is not null then
        if e.version <> p_expected_version + 1 or (e.new_stage, e.new_disposition, e.new_assignee_user_id, e.reason, e.actor_user_id)
            is distinct from (p_stage, p_disposition, p_assignee_user_id, p_reason, p_actor_user_id) then raise exception 'Request ID reused with different input'; end if;
        return e.version;
    end if;
    if p_expected_version is null or i.version <> p_expected_version then raise exception 'Service instance changed; reload before updating'; end if;
    update public.relationship_service_instances set stage = p_stage, disposition = p_disposition, assignee_user_id = p_assignee_user_id,
        version = version + 1, change_request_id = p_request_id, change_reason = p_reason, changed_by = p_actor_user_id
    where workspace_id = p_workspace_id and id = p_instance_id;
    return i.version + 1;
end $$;
create or replace function public.guard_service_instance() returns trigger
language plpgsql security definer set search_path = public as $$
begin
    if tg_op = 'DELETE' then raise exception 'Cancel service instances instead of deleting history'; end if;
    if new.service_revision_id is not null and not exists (
        select 1 from public.onboarding_service_revisions v where v.workspace_id = new.workspace_id and v.id = new.service_revision_id and v.service_id = new.service_id
    ) then raise exception 'Service revision does not belong to this service'; end if;
    if tg_op = 'INSERT' then
        if new.version <> 1 then raise exception 'Instance starts at version 1'; end if;
        if new.origin = 'negotiation' and new.stage <> 'negotiating' then raise exception 'New opportunities start in Negotiating'; end if;
        if new.origin = 'already_onboarded' and new.stage not in ('setup', 'maintenance', 'completed') then raise exception 'Existing work starts after onboarding'; end if;
    else
        if old.import_id is not null then raise exception 'Prepared imports are immutable; cutover is not enabled'; end if;
        if (new.id, new.workspace_id, new.relationship_id, new.service_id, new.service_revision_id, new.service_key, new.source_key, new.origin, new.import_id, new.source_snapshot, new.seller_user_id, new.manager_user_id, new.created_at, new.review_reasons)
            is distinct from (old.id, old.workspace_id, old.relationship_id, old.service_id, old.service_revision_id, old.service_key, old.source_key, old.origin, old.import_id, old.source_snapshot, old.seller_user_id, old.manager_user_id, old.created_at, old.review_reasons)
        then raise exception 'Service instance identity and original attribution are immutable'; end if;
        if new.version <> old.version + 1 or new.change_request_id = old.change_request_id then raise exception 'Expected next instance version and a new request ID'; end if;
        -- Payment/onboarding transitions will be owned by SS-03/04 transactions.
        if new.stage is distinct from old.stage and not (
            (old.stage in ('negotiating', 'for_later', 'declined') and new.stage in ('negotiating', 'for_later', 'declined'))
            or (old.stage in ('setup', 'maintenance', 'completed') and new.stage in ('setup', 'maintenance', 'completed'))
        ) then raise exception 'This stage transition requires the sale or onboarding transaction'; end if;
        new.updated_at := clock_timestamp();
    end if;
    if new.origin <> 'legacy_import' then
        if not public.can_manage_relationship_service(new.workspace_id,new.relationship_id,new.changed_by,new.origin) then
            raise exception 'Service editing access required';
        end if;
        if new.assignee_user_id is not null and not exists (
            select 1 from public.workspace_member_service_access a join public.workspace_memberships m using(workspace_id, user_id)
            where a.workspace_id = new.workspace_id and a.service_id = new.service_id and a.user_id = new.assignee_user_id
        ) then raise exception 'Choose a current eligible service assignee'; end if;
        if exists (select 1 from public.relationships r where r.workspace_id = new.workspace_id and r.id = new.relationship_id and r.status = 'archived') then
            raise exception 'Archived relationships cannot accept new service work';
        end if;
    end if;
    return new;
end $$;

create function public.relationship_service_assignees(p_workspace_id uuid,p_relationship_id uuid,p_service_id uuid,p_user_id uuid) returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare result jsonb;
begin
 if not public.can_manage_relationship_service(p_workspace_id,p_relationship_id,p_user_id,'negotiation') then raise exception 'Service assignment access required'; end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',m.user_id,'name',coalesce(u.display_name,u.username,'Workspace member')) order by coalesce(u.display_name,u.username)),'[]') into result
 from public.workspace_member_service_access a join public.workspace_memberships m using(workspace_id,user_id)
 join public.user_profiles u on u.user_id=m.user_id where a.workspace_id=p_workspace_id and a.service_id=p_service_id;
 return result;
end $$;

-- Bounded and permission-filtered work/history for the relationship's other tabs.
create function public.relationship_service_activity(p_workspace_id uuid,p_relationship_id uuid,p_user_id uuid,p_kind text,p_offset integer default 0) returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare result jsonb;
begin
 if not public.workspace_user_can_access_relationship(p_workspace_id,p_relationship_id,p_user_id) then raise exception 'Relationship access required'; end if;
 if p_offset<0 or p_offset>10000 then raise exception 'Invalid page'; end if;
 if p_kind='work' then
  select jsonb_build_object('items',coalesce(jsonb_agg(to_jsonb(x)),'[]'),'hasMore',count(*)>30) into result from (
    select w.id,w.title,w.status,w.updated_at from public.work_item_relationships l join public.work_items w on w.workspace_id=l.workspace_id and w.id=l.work_item_id
    where l.workspace_id=p_workspace_id and l.relationship_id=p_relationship_id and public.workspace_user_can_access_work_item(p_workspace_id,w.id,p_user_id)
    order by w.updated_at desc,w.id limit 31 offset p_offset
  ) x;
 elsif p_kind='history' then
  if not public.workspace_user_fully_covers_relationship(p_workspace_id,p_relationship_id,p_user_id) then raise exception 'Commercial history access required'; end if;
  select jsonb_build_object('items',coalesce(jsonb_agg(to_jsonb(x)),'[]'),'hasMore',count(*)>30) into result from (
   select id, 'Sale'::text title,status,created_at updated_at,'sale'::text kind from public.client_sales where workspace_id=p_workspace_id and relationship_id=p_relationship_id
   union all
   select id,'Onboarding'::text,status,created_at,'onboarding'::text from public.relationship_onboarding_sessions where workspace_id=p_workspace_id and relationship_id=p_relationship_id
   order by updated_at desc,id limit 31 offset p_offset
  ) x;
 else raise exception 'Unknown relationship section'; end if;
 return result;
end $$;
revoke all on function public.can_manage_relationship_service(uuid,uuid,uuid,text),public.relationship_service_assignees(uuid,uuid,uuid,uuid),public.relationship_service_activity(uuid,uuid,uuid,text,integer) from public,anon,authenticated;
grant execute on function public.can_manage_relationship_service(uuid,uuid,uuid,text),public.relationship_service_assignees(uuid,uuid,uuid,uuid),public.relationship_service_activity(uuid,uuid,uuid,text,integer) to service_role;

do $permission$
declare definition text; old_check text := 'and v_relationship.pos_started_at is not null) then';
begin
 definition := pg_get_functiondef('public.save_relationship_background_command(uuid,uuid,uuid,timestamptz,uuid,text,jsonb)'::regprocedure);
 if position(old_check in definition)=0 then raise exception 'Unexpected background command permissions; review before applying SS-02'; end if;
 execute replace(definition,old_check,'and (v_relationship.pos_started_at is not null or not public.workspace_user_can_sell(p_workspace_id,p_user_id))) then');
end $permission$;

-- Pin exactly the revision displayed in the catalogue choice. A retry recovers
-- the original instance even if the catalogue has since published a revision.
create function public.add_relationship_service(p_workspace_id uuid,p_relationship_id uuid,p_actor_user_id uuid,p_request_id uuid,p_service_id uuid,p_revision_id uuid,p_origin text,p_stage text,p_assignee_user_id uuid default null) returns uuid
language plpgsql security definer set search_path=public as $$
declare instance public.relationship_service_instances%rowtype; latest uuid;
begin
 if not public.can_manage_relationship_service(p_workspace_id,p_relationship_id,p_actor_user_id,p_origin) then raise exception 'Service assignment access required'; end if;
 perform 1 from public.onboarding_services where workspace_id=p_workspace_id and id=p_service_id for update;
 select * into instance from public.relationship_service_instances where workspace_id=p_workspace_id and relationship_id=p_relationship_id and source_key='request:'||p_request_id;
 if instance.id is not null then
  if instance.service_revision_id is distinct from p_revision_id then raise exception 'Request ID reused with a different service revision'; end if;
 else
  select id into latest from public.onboarding_service_revisions where workspace_id=p_workspace_id and service_id=p_service_id order by revision_number desc limit 1;
  if latest is null or latest is distinct from p_revision_id then raise exception 'This service was updated. Choose it again from the catalogue.'; end if;
 end if;
 return public.create_service_instance(p_workspace_id,p_relationship_id,p_actor_user_id,p_request_id,p_service_id,p_origin,p_stage,p_assignee_user_id);
end $$;
revoke all on function public.add_relationship_service(uuid,uuid,uuid,uuid,uuid,uuid,text,text,uuid) from public,anon,authenticated;
grant execute on function public.add_relationship_service(uuid,uuid,uuid,uuid,uuid,uuid,text,text,uuid) to service_role;

create or replace function public.can_read_service_instance(p_workspace_id uuid,p_instance_id uuid) returns boolean
language sql stable security definer set search_path=public as $$
 select public.current_session_is_aal2() and exists(
  select 1 from public.relationship_service_instances i join public.workspace_memberships m on m.workspace_id=i.workspace_id and m.user_id=auth.uid()
  where i.workspace_id=p_workspace_id and i.id=p_instance_id
   and public.workspace_user_can_access_relationship(i.workspace_id,i.relationship_id,m.user_id)
   and (public.workspace_user_fully_covers_relationship(i.workspace_id,i.relationship_id,m.user_id) or i.assignee_user_id=m.user_id
     or (i.import_id is null and m.user_id in(i.seller_user_id,i.manager_user_id)))
 )
$$;
commit;
