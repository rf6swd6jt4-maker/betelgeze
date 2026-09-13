-- Relationship card workspace and reviewed, channel-selected sales.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';

create table public.relationship_contact_confirmations (
 id uuid primary key default gen_random_uuid(), workspace_id uuid not null,
 relationship_id uuid not null, provider text not null check(provider in('meta_whatsapp','twilio_sms')),
 address text not null, status text not null default 'pending' check(status in('pending','sending','awaiting_confirmation','confirmed','send_failed','send_uncertain','revoked')),
 request_id uuid not null, actor_user_id uuid not null references auth.users(id), message_id uuid,
 created_at timestamptz not null default now(), confirmed_at timestamptz, confirmation_message_id text,
 foreign key(workspace_id,relationship_id) references public.relationships(workspace_id,id),
 unique(workspace_id,actor_user_id,request_id)
);
alter table public.relationship_contact_confirmations enable row level security;
revoke all on public.relationship_contact_confirmations from public,anon,authenticated;
grant select,insert,update on public.relationship_contact_confirmations to service_role;
create index relationship_contact_confirmation_address on public.relationship_contact_confirmations(workspace_id,provider,address,status);
create index relationship_contact_confirmation_recent on public.relationship_contact_confirmations(workspace_id,relationship_id,provider,address,created_at desc);
create index relationship_contact_recent_inbound on public.client_messages(workspace_id,relationship_id,provider,created_at desc) where direction='inbound';
create index relationship_contact_latest_delivery on public.communication_message_deliveries(workspace_id,relationship_id,provider,created_at desc);
create index relationship_sms_confirmation_lookup on public.relationship_sms_consents(workspace_id,relationship_id,phone_e164,confirmed_at desc) where status='confirmed';
create index relationship_sale_confirmation_lookup on public.client_sales(workspace_id,relationship_id,consent_confirmed_at desc) where consent_confirmed_at is not null;
create index relationship_contact_latest_message on public.client_messages(workspace_id,relationship_id,provider,created_at desc);

create function public.relationship_contact_phone(p_address text) returns text language sql immutable set search_path=public as $$
 select regexp_replace(case when digits ~ '^00' then '+'||substring(digits from 3) when length(digits)=10 then '+1'||digits else '+'||digits end,'^\+(27|31|32|33|353|44|49|61|64)0','+\1')
 from (select regexp_replace(regexp_replace(coalesce(p_address,''),'(ext|extension|x)\.?\s*[0-9]+$','','i'),'[^0-9]','','g') digits) x
$$;

-- Bounded, relationship-scoped metadata. No provider calls or message bodies.
create function public.relationship_messaging_choices(p_workspace_id uuid,p_relationship_id uuid) returns jsonb
language sql stable security definer set search_path=public as $$
 with r as (select * from relationships where workspace_id=p_workspace_id and id=p_relationship_id), choices as (
 select r.id, r.status, p.provider, public.relationship_contact_phone(case when p.provider='meta_whatsapp' then r.whatsapp_phone else r.primary_phone end) address,
 case when p.provider='meta_whatsapp' then nullif(r.whatsapp_phone,'') is not null else coalesce(r.source_metadata->'contact_methods','[]') ? 'twilio_sms' or r.communication_primary_provider='twilio_sms' and nullif(r.primary_phone,'') is not null or exists(select 1 from client_communication_channels c where c.workspace_id=p_workspace_id and c.relationship_id=r.id and c.provider=p.provider) end added
 from r cross join (values('meta_whatsapp'),('twilio_sms')) p(provider)
 ), evidence as (
 select c.*,coalesce(i.enabled,false) enabled,coalesce(i.connection_status,'not_connected') integration_status,
 coalesce((select max(f.confirmed_at) from relationship_contact_confirmations f where f.workspace_id=p_workspace_id and f.relationship_id=c.id and f.provider=c.provider and f.address=c.address and f.status='confirmed'),
 case when c.provider='twilio_sms' then (select max(s.confirmed_at) from relationship_sms_consents s where s.workspace_id=p_workspace_id and s.relationship_id=c.id and s.phone_e164=c.address and s.status='confirmed')
 else (select max(s.consent_confirmed_at) from client_sales s where s.workspace_id=p_workspace_id and s.relationship_id=c.id and public.relationship_contact_phone(s.client_phone)=c.address and s.consent_confirmed_at is not null and exists(select 1 from client_messages msg where msg.workspace_id=s.workspace_id and msg.relationship_id=s.relationship_id and msg.direction='inbound' and msg.provider='meta_whatsapp' and (msg.provider_message_id=s.consent_confirmed_message_id or msg.whatsapp_message_id=s.consent_confirmed_message_id))) end) confirmed_at,
 (select f.status from relationship_contact_confirmations f where f.workspace_id=p_workspace_id and f.relationship_id=c.id and f.provider=c.provider and f.address=c.address order by f.created_at desc,f.id desc limit 1) confirmation_status,
 (select max(msg.created_at) from (select m.created_at from client_messages m where m.workspace_id=p_workspace_id and m.relationship_id=c.id and m.provider=c.provider and m.direction='inbound' and m.created_at>now()-interval '24 hours' and public.relationship_contact_phone(m.from_address)=c.address order by m.created_at desc limit 1) msg) last_reply_at,
 c.provider<>'twilio_sms' or exists(select 1 from workspace_sms_opt_ins o where o.workspace_id=p_workspace_id and o.phone_e164=c.address and o.status='active') opted_in
 from choices c left join workspace_integrations i on i.workspace_id=p_workspace_id and i.provider=c.provider
 ) select coalesce(jsonb_agg(jsonb_build_object('provider',provider,'address',address,'added',added,'enabled',enabled,'confirmedAt',confirmed_at,'confirmationStatus',confirmation_status,'optedIn',opted_in,'canSend',coalesce(confirmed_at is not null and enabled and integration_status not in('needs_attention','degraded') and status<>'archived' and opted_in and address ~ '^\+[1-9][0-9]{7,14}$' and (provider='twilio_sms' or greatest(last_reply_at,confirmed_at)>now()-interval '24 hours'),false),
 'state',case when confirmed_at is not null and (not enabled or integration_status in('needs_attention','degraded')) then 'broken'
 when status<>'archived' and enabled and integration_status not in('needs_attention','degraded') and confirmed_at is not null and opted_in and address ~ '^\+[1-9][0-9]{7,14}$' then 'active' else 'inactive' end)), '[]') from evidence
$$;
revoke all on function public.relationship_messaging_choices(uuid,uuid),public.relationship_contact_phone(text) from public,anon,authenticated;
grant execute on function public.relationship_messaging_choices(uuid,uuid),public.relationship_contact_phone(text) to service_role;

create function public.confirm_relationship_contact(p_workspace_id uuid,p_provider text,p_address text,p_message_id text,p_body text default 'Messaging confirmed',p_raw_payload jsonb default '{}') returns jsonb
language plpgsql security definer set search_path=public as $$
declare ids uuid[]; confirmation relationship_contact_confirmations%rowtype;
begin
 -- An old webhook replay must never confirm a later confirmation request.
 if p_message_id is not null and exists(select 1 from relationship_contact_confirmations where workspace_id=p_workspace_id and provider=p_provider and confirmation_message_id=p_message_id and status='confirmed') then return jsonb_build_object('handled',true,'ok',true); end if;
 select array_agg(f.id) into ids from relationship_contact_confirmations f join relationships r on r.workspace_id=f.workspace_id and r.id=f.relationship_id
 where f.workspace_id=p_workspace_id and f.provider=p_provider and f.address=public.relationship_contact_phone(p_address) and r.status<>'archived'
 and f.address=public.relationship_contact_phone(case when p_provider='meta_whatsapp' then r.whatsapp_phone else r.primary_phone end)
 and f.status in('sending','awaiting_confirmation','send_uncertain') and f.created_at>now()-interval '7 days';
 if coalesce(cardinality(ids),0)=0 then return jsonb_build_object('handled',false); end if;
 if cardinality(ids)>1 then return jsonb_build_object('handled',true,'ok',false,'error','More than one relationship is waiting for this channel confirmation.'); end if;
 select * into confirmation from relationship_contact_confirmations where id=ids[1] for update;
 if confirmation.status='confirmed' then return jsonb_build_object('handled',true,'ok',true); end if;
 insert into client_messages(workspace_id,relationship_id,direction,provider,provider_message_id,whatsapp_message_id,from_address,body,status,sender_kind,raw_payload)
 values(p_workspace_id,confirmation.relationship_id,'inbound',p_provider,p_message_id,case when p_provider='meta_whatsapp' then p_message_id end,p_address,p_body,'whatsapp_consent_confirmed','client',p_raw_payload)
 on conflict(provider,provider_message_id) do nothing;
 update relationship_contact_confirmations set status='confirmed',confirmed_at=now(),confirmation_message_id=p_message_id where id=confirmation.id;
 return jsonb_build_object('handled',true,'ok',true);
end $$;
revoke all on function public.confirm_relationship_contact(uuid,text,text,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.confirm_relationship_contact(uuid,text,text,text,text,jsonb) to service_role;


create or replace function public.guard_service_instance() returns trigger
language plpgsql security definer set search_path = public as $$
declare sale_transition boolean:=false; payment_transition boolean:=false;
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
        select exists(select 1 from public.client_sale_items l join public.client_sales s on s.id=l.client_sale_id and s.workspace_id=l.workspace_id
          join public.service_sale_receipts receipt on receipt.sale_id=s.id
          where l.workspace_id=new.workspace_id and l.service_instance_id=new.id and s.service_scope='selected_services' and s.snapshot_frozen_at is not null
          and old.stage in('negotiating','declined','for_later') and new.stage='awaiting_payment' and receipt.request_id=new.change_request_id and receipt.actor_user_id=new.changed_by
          and s.seller_user_id=new.seller_user_id and s.service_manager_user_id=new.manager_user_id
          and exists(select 1 from jsonb_array_elements(receipt.input->'lines') x where x->>'id'=new.id::text and (x->>'version')::integer=old.version and (x->>'assigneeId')::uuid=new.assignee_user_id)) into sale_transition;
        select exists(select 1 from public.service_instance_sale_items l join public.client_sales s on s.id=l.sale_id and s.workspace_id=l.workspace_id
          where l.workspace_id=new.workspace_id and l.instance_id=new.id and s.service_scope='selected_services' and s.status in('paid','test_paid')
          and old.stage='awaiting_payment' and new.stage='onboarding' and new.assignee_user_id is not distinct from old.assignee_user_id and new.changed_by=s.created_by) into payment_transition;
        if old.import_id is not null then raise exception 'Prepared imports are immutable; cutover is not enabled'; end if;
        if (new.id, new.workspace_id, new.relationship_id, new.service_id, new.service_revision_id, new.service_key, new.source_key, new.origin, new.import_id, new.source_snapshot, new.created_at, new.review_reasons)
            is distinct from (old.id, old.workspace_id, old.relationship_id, old.service_id, old.service_revision_id, old.service_key, old.source_key, old.origin, old.import_id, old.source_snapshot, old.created_at, old.review_reasons)
        then raise exception 'Service instance identity and original attribution are immutable'; end if;
        if not sale_transition and (new.seller_user_id,new.manager_user_id) is distinct from (old.seller_user_id,old.manager_user_id) then raise exception 'Service attribution can only be captured by the sale transaction'; end if;
        if new.version <> old.version + 1 or new.change_request_id = old.change_request_id then raise exception 'Expected next instance version and a new request ID'; end if;
        -- Payment/onboarding transitions will be owned by SS-03/04 transactions.
        if new.stage is distinct from old.stage and not sale_transition and not payment_transition and not (
            (old.stage in ('negotiating', 'for_later', 'declined') and new.stage in ('negotiating', 'for_later', 'declined'))
            or (old.stage in ('setup', 'maintenance', 'completed') and new.stage in ('setup', 'maintenance', 'completed'))
        ) then raise exception 'This stage transition requires the sale or onboarding transaction'; end if;
        new.updated_at := clock_timestamp();
    end if;
    if new.origin <> 'legacy_import' then
        if not payment_transition and not public.can_manage_relationship_service(new.workspace_id,new.relationship_id,new.changed_by,new.origin) then
            raise exception 'Service editing access required';
        end if;
        if not payment_transition and new.assignee_user_id is not null and not exists (
            select 1 from public.workspace_member_service_access a join public.workspace_memberships m using(workspace_id, user_id)
            where a.workspace_id = new.workspace_id and a.service_id = new.service_id and a.user_id = new.assignee_user_id
        ) then raise exception 'Choose a current eligible service assignee'; end if;
        if not payment_transition and exists (select 1 from public.relationships r where r.workspace_id = new.workspace_id and r.id = new.relationship_id and r.status = 'archived') then
            raise exception 'Archived relationships cannot accept new service work';
        end if;
    end if;
    return new;
end $$;

create function public.validate_relationship_sale_choices(p_workspace_id uuid,p_relationship_id uuid,p_actor_user_id uuid,p_input jsonb,p_commit boolean) returns void
language plpgsql stable security definer set search_path=public as $$
declare item jsonb; available jsonb;
begin
 if jsonb_typeof(p_input->'offered') is distinct from 'array' or jsonb_array_length(p_input->'offered') not between 1 and 300 then raise exception 'Reload the services offered in this sale'; end if;
 if (select count(distinct x->>'id') from jsonb_array_elements(p_input->'offered') x)<>jsonb_array_length(p_input->'offered') then raise exception 'Duplicate offered service'; end if;
 for item in select value from jsonb_array_elements(p_input->'offered') loop
  if not exists(select 1 from relationship_service_instances i where i.workspace_id=p_workspace_id and i.relationship_id=p_relationship_id and i.id=(item->>'id')::uuid and i.version=(item->>'version')::integer and i.origin='negotiation' and i.import_id is null and i.disposition='active' and i.stage in('negotiating','declined','for_later') and (public.workspace_user_fully_covers_relationship(p_workspace_id,p_relationship_id,p_actor_user_id) or i.assignee_user_id=p_actor_user_id)) then raise exception 'An offered service changed. Reload and review the sale'; end if;
 end loop;
 if exists(select 1 from jsonb_array_elements(p_input->'lines') x where not exists(select 1 from jsonb_array_elements(p_input->'offered') o where o->>'id'=x->>'id' and o->>'version'=x->>'version')) then raise exception 'Selected services must belong to the reviewed offer'; end if;
 if jsonb_typeof(p_input->'delivery') is distinct from 'array' or jsonb_array_length(p_input->'delivery')>(2) or p_commit and jsonb_array_length(p_input->'delivery')=0 then raise exception 'Choose a confirmed contact method'; end if;
 if (select count(distinct x->>'provider') from jsonb_array_elements(p_input->'delivery') x)<>jsonb_array_length(p_input->'delivery') then raise exception 'Select each contact method once'; end if;
 available:=public.relationship_messaging_choices(p_workspace_id,p_relationship_id);
 for item in select value from jsonb_array_elements(p_input->'delivery') loop
  if not exists(select 1 from jsonb_array_elements(available) c where c->>'provider'=item->>'provider' and c->>'address'=item->>'address' and c->>'state'='active' and c->>'canSend'='true') then raise exception 'A selected contact method is no longer confirmed and available. Review contact methods'; end if;
 end loop;
end $$;
revoke all on function public.validate_relationship_sale_choices(uuid,uuid,uuid,jsonb,boolean) from public,anon,authenticated;


create or replace function public.preview_relationship_service_sale(p_workspace_id uuid,p_relationship_id uuid,p_actor_user_id uuid,p_input jsonb) returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare r public.relationships%rowtype; ids uuid[]; line jsonb; i public.relationship_service_instances%rowtype; v public.onboarding_service_revisions%rowtype;
 lines jsonb:='[]'; modules jsonb; result jsonb; currency text; interval_name text; interval_count integer; upfront bigint:=0; recurring bigint:=0; config uuid;
begin
 if not public.workspace_user_can_sell(p_workspace_id,p_actor_user_id) or not public.workspace_user_can_access_relationship(p_workspace_id,p_relationship_id,p_actor_user_id) then raise exception 'Seller access required'; end if;
 select * into r from public.relationships where workspace_id=p_workspace_id and id=p_relationship_id and status<>'archived';
 if r.id is null then raise exception 'Relationship not found'; end if;
 if r.updated_at::text::timestamptz is distinct from (p_input->>'relationshipVersion')::timestamptz then raise exception 'Relationship details changed. Reload before reviewing the sale'; end if;
 if jsonb_typeof(p_input->'lines') is distinct from 'array' or jsonb_array_length(p_input->'lines') not between 1 and 30 then raise exception 'Select between 1 and 30 Negotiating services'; end if;
 select array_agg((x->>'id')::uuid order by x->>'id') into ids from jsonb_array_elements(p_input->'lines') x;
 if cardinality(ids)<>(select count(distinct id) from unnest(ids) id) then raise exception 'A service instance can be selected only once'; end if;
 if r.primary_email is null or r.primary_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' or coalesce(nullif(r.primary_phone,''),nullif(r.whatsapp_phone,'')) is null then raise exception 'Add a billing email and a usable SMS or WhatsApp number in relationship information'; end if;
 if not exists(select 1 from public.workspace_operational_roles o join public.workspace_memberships m using(workspace_id,user_id) where o.workspace_id=p_workspace_id and o.user_id=(p_input->>'managerId')::uuid and o.can_manage) then raise exception 'Choose an eligible manager'; end if;
 interval_name:=p_input->>'billingInterval'; interval_count:=(p_input->>'billingIntervalCount')::integer;
 if interval_name is null or interval_name not in('week','month','year') or interval_count is null or interval_count not between 1 and (case interval_name when 'year' then 3 when 'month' then 36 else 156 end) then raise exception 'Choose a supported recurring schedule'; end if;
 for line in select value from jsonb_array_elements(p_input->'lines') order by value->>'id' loop
  select * into i from public.relationship_service_instances where workspace_id=p_workspace_id and relationship_id=p_relationship_id and id=(line->>'id')::uuid and import_id is null;
  if i.id is null or i.stage not in('negotiating','declined','for_later') or i.disposition<>'active' or i.origin<>'negotiation' or i.version is distinct from (line->>'version')::integer then raise exception 'A selected service changed or is no longer available to sell. Reload the POS'; end if;
  if exists(select 1 from public.service_instance_sale_items where instance_id=i.id) then raise exception 'A selected service has already been sold'; end if;
  select * into v from public.onboarding_service_revisions where workspace_id=p_workspace_id and id=i.service_revision_id;
  if v.id is null or not exists(select 1 from public.onboarding_services where workspace_id=p_workspace_id and id=i.service_id and state='active') then raise exception 'A selected catalogue service is no longer available'; end if;
  if not exists(select 1 from public.workspace_member_service_access a join public.workspace_memberships m using(workspace_id,user_id) where a.workspace_id=p_workspace_id and a.service_id=i.service_id and a.user_id=(line->>'assigneeId')::uuid) then raise exception 'Choose an eligible assignee for every selected service'; end if;
  if jsonb_typeof(line->'upfrontCents') is distinct from 'number' or jsonb_typeof(line->'recurringCents') is distinct from 'number'
   or (line->>'upfrontCents')::numeric<>trunc((line->>'upfrontCents')::numeric) or (line->>'recurringCents')::numeric<>trunc((line->>'recurringCents')::numeric)
   or (line->>'upfrontCents')::bigint not between 0 and 99999999 or (line->>'recurringCents')::bigint not between 0 and 99999999
   or (line->>'upfrontCents')::bigint+(line->>'recurringCents')::bigint=0 then raise exception 'Set an upfront or recurring price for every selected service'; end if;
  if coalesce(v.definition->>'serviceType',v.definition->>'service_type','one_time')<>'retainer' and coalesce(v.default_recurring_price_cents,0)=0 and (line->>'recurringCents')::bigint>0 then raise exception 'This one-time service cannot have a recurring price'; end if;
  if currency is not null and currency<>upper(v.currency) then raise exception 'Selected services must use one currency. Sell different currencies separately'; end if;
  currency:=upper(v.currency); upfront:=upfront+(line->>'upfrontCents')::bigint; recurring:=recurring+(line->>'recurringCents')::bigint;
  lines:=lines||jsonb_build_array(line||jsonb_build_object('name',v.name,'description',v.description,'currency',currency,'serviceId',i.service_id,'revisionId',i.service_revision_id,'code',i.service_key,'fulfilmentRevisionId',v.fulfilment_definition_revision_id));
 end loop;
 if upfront+recurring>99999999 then raise exception 'The combined checkout amount exceeds the supported limit'; end if;
 if recurring>0 and ((select count(*) from jsonb_array_elements(lines) x where (x->>'recurringCents')::bigint>0)>20 or (select count(*) from jsonb_array_elements(lines) x where (x->>'upfrontCents')::bigint>0)>20) then raise exception 'Select fewer services to stay within the mixed checkout line limit'; end if;
 modules:=public.service_sale_modules(p_workspace_id,ids);
 if jsonb_array_length(modules)=0 then raise exception 'Publish at least one applicable onboarding module before selling'; end if;
 if jsonb_array_length(modules)>100 or octet_length(modules::text)>2097152 then raise exception 'This onboarding composition is too large for a single sale'; end if;
 select id into config from public.onboarding_configuration_revisions where workspace_id=p_workspace_id and configuration_type='mandatory_modules' and status='published' order by revision_number desc limit 1;
 result:=jsonb_build_object('lines',lines,'modules',modules,'currency',currency,'upfrontTotal',upfront,'recurringTotal',recurring,'billingInterval',case when recurring>0 then interval_name end,'billingIntervalCount',case when recurring>0 then interval_count end,'configurationId',config,
 'relationshipVersion',r.updated_at,'client',jsonb_build_object('name',r.primary_person_name,'company',r.business_name,'email',r.primary_email,'phone',r.primary_phone,'whatsapp',r.whatsapp_phone),'managerId',p_input->>'managerId');
 if p_input->>'uiVersion'='2' then
  perform public.validate_relationship_sale_choices(p_workspace_id,p_relationship_id,p_actor_user_id,p_input,false);
  result:=result||jsonb_build_object('offered',p_input->'offered');
 end if;
 return result||jsonb_build_object('hash',encode(extensions.digest(convert_to(result::text,'UTF8'),'sha256'),'hex'));
end $$;

create or replace function public.read_relationship_service_pos(p_workspace_id uuid,p_relationship_id uuid,p_actor_user_id uuid,p_offset integer default 0) returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare rows jsonb; managers jsonb; sales jsonb;
begin
 if not public.workspace_user_can_sell(p_workspace_id,p_actor_user_id) or not public.workspace_user_can_access_relationship(p_workspace_id,p_relationship_id,p_actor_user_id) then raise exception 'Seller access required'; end if;
 if p_offset<0 or p_offset>10000 then raise exception 'Invalid page'; end if;
 select coalesce(jsonb_agg(to_jsonb(x)),'[]') into rows from (
  select r.*,v.definition->>'thumbnailPath' "thumbnailPath",v.definition->>'templateId' "templateId",coalesce(v.definition->>'serviceType',v.definition->>'service_type',case when v.default_recurring_price_cents>0 then 'retainer' else 'one_time' end) service_type,
   coalesce(v.definition->>'defaultBillingInterval',v.definition->>'default_billing_interval','month') billing_interval,
   coalesce((v.definition->>'defaultBillingIntervalCount')::integer,(v.definition->>'default_billing_interval_count')::integer,1) billing_interval_count
  from public.relationship_service_rows(p_workspace_id,p_relationship_id,p_actor_user_id) r
  join public.onboarding_service_revisions v on v.workspace_id=p_workspace_id and v.id=r.service_revision_id
  where not r.legacy and r.stage in('negotiating','declined','for_later') and exists(select 1 from public.relationship_service_instances i where i.id=r.id::uuid and i.disposition='active') order by r.created_at,r.id limit 31 offset p_offset
 ) x;
 select coalesce(jsonb_agg(to_jsonb(x)),'[]') into managers from (
  select m.user_id id,coalesce(u.display_name,u.username,'Workspace member') name from public.workspace_operational_roles o join public.workspace_memberships m using(workspace_id,user_id) left join public.user_profiles u on u.user_id=m.user_id
  where m.workspace_id=p_workspace_id and o.can_manage order by coalesce(u.display_name,u.username),m.user_id limit 200
 ) x;
 select coalesce(jsonb_agg(to_jsonb(x)),'[]') into sales from (
  select s.id,s.status,s.created_at,s.currency,s.upfront_total_amount,s.recurring_total_amount,s.onboarding_session_id,s.consent_confirmed_at,
   (select jsonb_agg(jsonb_build_object('id',i.service_instance_id,'name',i.service_name) order by i.sort_order) from public.client_sale_items i where i.client_sale_id=s.id) services
  from public.client_sales s where s.workspace_id=p_workspace_id and s.relationship_id=p_relationship_id and s.service_scope='selected_services' and (s.seller_user_id=p_actor_user_id or exists(select 1 from public.workspace_memberships where workspace_id=p_workspace_id and user_id=p_actor_user_id and role in('owner','admin'))) order by s.created_at desc limit 10
 ) x;
 return jsonb_build_object('items',rows,'hasMore',jsonb_array_length(rows)>30,'managers',managers,'sales',sales,'contacts',public.relationship_messaging_choices(p_workspace_id,p_relationship_id),'relationship', (select jsonb_build_object('name',primary_person_name,'company',business_name,'email',primary_email,'phone',coalesce(primary_phone,whatsapp_phone),'updatedAt',updated_at,'managerId',fulfilment_manager_user_id) from relationships where workspace_id=p_workspace_id and id=p_relationship_id),'relationshipVersion',(select updated_at from public.relationships where workspace_id=p_workspace_id and id=p_relationship_id));
end $$;

create or replace function public.commit_relationship_service_sale(p_workspace_id uuid,p_relationship_id uuid,p_actor_user_id uuid,p_request_id uuid,p_input jsonb,p_quote_hash text,p_destination text,p_sms_destination text default null) returns jsonb
language plpgsql security definer set search_path=public as $$
declare receipt public.service_sale_receipts%rowtype; r public.relationships%rowtype; quote jsonb; line jsonb; module jsonb; sid uuid:=gen_random_uuid(); item_id uuid; result jsonb; stage_id uuid;
begin
 if p_request_id is null or p_quote_hash is null or length(p_destination) not between 5 and 100 then raise exception 'Review the sale before confirming'; end if;
 if not public.workspace_user_can_sell(p_workspace_id,p_actor_user_id) or not public.workspace_user_can_access_relationship(p_workspace_id,p_relationship_id,p_actor_user_id) then raise exception 'Seller access required'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_workspace_id::text||p_actor_user_id::text||p_request_id::text,0));
 select * into receipt from public.service_sale_receipts where workspace_id=p_workspace_id and actor_user_id=p_actor_user_id and request_id=p_request_id;
 if receipt.sale_id is not null then
  if receipt.input<>p_input or receipt.relationship_id<>p_relationship_id or receipt.quote_hash<>p_quote_hash then raise exception 'This sale request was already used with different choices'; end if;
  return jsonb_build_object('saleId',receipt.sale_id,'sessionId',(select onboarding_session_id from public.client_sales where id=receipt.sale_id),'replayed',true);
 end if;
 -- Every selected version and its contact snapshot are checked under the same
 -- transaction lock. A second click/tab can never sell an instance twice.
 select * into r from public.relationships where workspace_id=p_workspace_id and id=p_relationship_id for update;
 perform 1 from public.relationship_service_instances where workspace_id=p_workspace_id and relationship_id=p_relationship_id and id in(select (x->>'id')::uuid from jsonb_array_elements(case when p_input->>'uiVersion'='2' then p_input->'offered' else p_input->'lines' end) x) order by id for update;
 if p_input->>'uiVersion'='2' then perform public.validate_relationship_sale_choices(p_workspace_id,p_relationship_id,p_actor_user_id,p_input,true); end if;
 quote:=public.preview_relationship_service_sale(p_workspace_id,p_relationship_id,p_actor_user_id,p_input);
 if quote->>'hash'<>p_quote_hash then raise exception 'The sale preview changed. Review the latest prices and modules before confirming'; end if;
 insert into public.client_sales(id,workspace_id,relationship_id,service_scope,seller_user_id,service_manager_user_id,client_name,client_email,client_phone,sms_recipient_e164,service_keys,project_timeframe_days,currency,upfront_total_amount,recurring_total_amount,total_amount,billing_model,checkout_flow,billing_interval,billing_interval_count,status,created_by,correlation_id,raw_payload)
 values(sid,p_workspace_id,p_relationship_id,'selected_services',p_actor_user_id,(p_input->>'managerId')::uuid,coalesce(r.business_name,r.primary_person_name),r.primary_email,p_destination,p_sms_destination,
  (select jsonb_agg(x->>'code') from jsonb_array_elements(quote->'lines') x),r.project_timeframe_days,lower(quote->>'currency'),(quote->>'upfrontTotal')::integer,(quote->>'recurringTotal')::integer,(quote->>'upfrontTotal')::integer+(quote->>'recurringTotal')::integer,
  case when (quote->>'recurringTotal')::integer>0 then 'recurring' else 'one_off' end,'onboarding_payment_gate',quote->>'billingInterval',(quote->>'billingIntervalCount')::integer,'draft',p_actor_user_id,p_request_id,jsonb_build_object('flow','onboarding_payment_gate'));
 insert into public.service_sale_receipts(workspace_id,actor_user_id,request_id,relationship_id,sale_id,input,quote_hash) values(p_workspace_id,p_actor_user_id,p_request_id,p_relationship_id,sid,p_input,p_quote_hash);
 for line in select value from jsonb_array_elements(quote->'lines') loop
  insert into public.client_sale_items(workspace_id,client_sale_id,service_id,service_revision_id,service_instance_id,service_code,service_name,description,amount_cents,upfront_amount_cents,recurring_amount_cents,currency,default_assignee_user_id,sort_order,fulfilment_definition_revision_id)
   values(p_workspace_id,sid,(line->>'serviceId')::uuid,(line->>'revisionId')::uuid,(line->>'id')::uuid,line->>'code',line->>'name',line->>'description',(line->>'upfrontCents')::integer+(line->>'recurringCents')::integer,(line->>'upfrontCents')::integer,(line->>'recurringCents')::integer,quote->>'currency',(line->>'assigneeId')::uuid,(select count(*) from public.client_sale_items where client_sale_id=sid),(line->>'fulfilmentRevisionId')::uuid);
 end loop;
 for module in select value from jsonb_array_elements(quote->'modules') loop
  select id into item_id from public.client_sale_items where client_sale_id=sid and service_instance_id in(select value::uuid from jsonb_array_elements_text(module->'instance_ids')) order by sort_order limit 1;
  insert into public.client_sale_composition_items(workspace_id,client_sale_id,item_kind,source_kind,module_id,module_revision_id,configuration_revision_id,source_service_item_id,source_service_revision_id,sort_order,definition,source_references)
   values(p_workspace_id,sid,'module',case when (module->>'mandatory')::boolean then 'mandatory' else 'service' end,(module->>'module_id')::uuid,(module->>'module_revision_id')::uuid,(quote->>'configurationId')::uuid,
   case when (module->>'mandatory')::boolean then null else item_id end,case when (module->>'mandatory')::boolean then null else (select service_revision_id from public.client_sale_items where id=item_id) end,(module->>'sort_order')::integer,module->'definition',jsonb_build_object('instance_ids',module->'instance_ids','module_code',module->>'code'));
 end loop;
 update public.client_sales set configuration_revision_id=(quote->>'configurationId')::uuid,composition_hash=p_quote_hash,snapshot_frozen_at=now(),status='sale_confirmation_pending' where id=sid;
 for line in select value from jsonb_array_elements(quote->'lines') loop
  update public.relationship_service_instances set stage='awaiting_payment',assignee_user_id=(line->>'assigneeId')::uuid,seller_user_id=p_actor_user_id,manager_user_id=(p_input->>'managerId')::uuid,
   version=version+1,change_request_id=p_request_id,change_reason='Sold in selected-service sale '||sid::text,changed_by=p_actor_user_id where workspace_id=p_workspace_id and id=(line->>'id')::uuid;
  insert into public.service_instance_sale_items(workspace_id,relationship_id,instance_id,sale_item_id,sale_id,commercial_snapshot)
   select p_workspace_id,p_relationship_id,service_instance_id,id,sid,'{}' from public.client_sale_items where client_sale_id=sid and service_instance_id=(line->>'id')::uuid;
 end loop;
 -- Seed relationship contacts only once; later sale attribution stays on the sale.
 update public.relationships set seller_user_id=coalesce(seller_user_id,p_actor_user_id),fulfilment_manager_user_id=coalesce(fulfilment_manager_user_id,(p_input->>'managerId')::uuid),updated_at=now() where workspace_id=p_workspace_id and id=p_relationship_id;
 result:=public.create_selected_service_session(p_workspace_id,sid,p_request_id,'service-sale:'||sid);
 insert into public.work_items(workspace_id,title,description,lifecycle_phase,status,priority,native_kind,native_key,workflow_role,workflow_action,metadata,created_by)
 values(p_workspace_id,'Confirm and pay for selected services','Waiting for client confirmation and checkout.','sold','waiting',2,'relationship_workflow',sid::text||':service-payment','task','await_payment',jsonb_build_object('sale_id',sid,'session_id',result->>'session_id'),p_actor_user_id) returning id into stage_id;
 insert into public.work_item_relationships(workspace_id,relationship_id,work_item_id) values(p_workspace_id,p_relationship_id,stage_id);
 insert into public.work_item_assignees(workspace_id,work_item_id,user_id) values(p_workspace_id,stage_id,p_actor_user_id);
 insert into public.service_instance_work_items(workspace_id,instance_id,work_item_id) select p_workspace_id,instance_id,stage_id from public.service_instance_sale_items where sale_id=sid;
 if p_input->>'uiVersion'='2' then
  update relationship_service_instances set stage='declined',version=version+1,change_request_id=p_request_id,change_reason='Not selected in sale '||sid::text,changed_by=p_actor_user_id
  where workspace_id=p_workspace_id and relationship_id=p_relationship_id and stage in('negotiating','for_later') and id in(select (x->>'id')::uuid from jsonb_array_elements(p_input->'offered') x) and id not in(select (x->>'id')::uuid from jsonb_array_elements(p_input->'lines') x);
  update client_sales set consent_confirmed_at=now(),status='onboarding_payment_pending',raw_payload=raw_payload||jsonb_build_object('delivery_choices',p_input->'delivery','confirmation_source','relationship_channels') where id=sid;
  insert into onboarding_delivery_outbox(workspace_id,relationship_id,session_id,correlation_id,kind,destination,payload,idempotency_key)
  values(p_workspace_id,p_relationship_id,(result->>'session_id')::uuid,p_request_id,'onboarding_link',p_destination,
    jsonb_build_object('sale_id',sid,'message','Your secure onboarding link is ready.','delivery_choices',p_input->'delivery'),'onboarding-link:'||sid::text)
  on conflict(workspace_id,idempotency_key) do nothing;
 end if;
 return jsonb_build_object('saleId',sid,'sessionId',result->>'session_id','replayed',false);
end $$;

create or replace function public.save_relationship_background_command(
    p_workspace_id uuid, p_relationship_id uuid, p_user_id uuid, p_expected_updated_at timestamptz,
    p_request_id uuid, p_request_hash text, p_values jsonb
)
returns jsonb language plpgsql security invoker set search_path = public as $$
declare
    v_relationship public.relationships%rowtype;
    v_receipt public.relationship_background_command_receipts%rowtype;
    v_role text; v_values jsonb; v_version timestamptz;
begin
    if current_user <> 'service_role' then raise exception using errcode = '42501', message = 'Trusted relationship runtime required'; end if;
    if public.workspace_user_can_access_relationship(p_workspace_id, p_relationship_id, p_user_id) is not true
       or not exists(select 1 from public.workspaces where id = p_workspace_id and status = 'active') then
        raise exception using errcode = '42501', message = 'Relationship access is required.';
    end if;
    if p_request_id is null or p_request_hash is null or p_request_hash !~ '^[0-9a-f]{64}$' or p_expected_updated_at is null then
        raise exception using errcode = '22023', message = 'Relationship command identity is required.';
    end if;
    select * into v_relationship from public.relationships where workspace_id = p_workspace_id and id = p_relationship_id for update;
    if not found then raise exception using errcode = 'P0002', message = 'Relationship not found.'; end if;
    v_role := public.workspace_role_for_user(p_workspace_id, p_user_id);
    if v_role is null or (v_role not in ('owner','admin') and v_relationship.seller_user_id is distinct from p_user_id
        and v_relationship.fulfilment_manager_user_id is distinct from p_user_id and v_relationship.pos_started_at is not null) then
        raise exception using errcode = '42501', message = 'Relationship seller, manager or workspace administrator required.';
    end if;
    select * into v_receipt from public.relationship_background_command_receipts
    where workspace_id = p_workspace_id and user_id = p_user_id and request_id = p_request_id;
    if found and (v_receipt.relationship_id <> p_relationship_id or v_receipt.request_hash <> p_request_hash) then
        raise exception using errcode = '22023', message = 'Relationship command identity was reused for different changes.';
    end if;
    if v_receipt.request_id is null and v_relationship.updated_at = p_expected_updated_at then
        if jsonb_typeof(p_values) is distinct from 'object' or (select count(*) from jsonb_object_keys(p_values)) not in (9,10)
           or not (p_values ?& array['primaryPersonName','businessName','primaryContactRole','primaryPhone','whatsappPhone','communicationPrimaryProvider','communicationDeliveryMode','primaryEmail','description'])
           or exists(select 1 from jsonb_each(p_values) where jsonb_typeof(value) <> 'string')
           or nullif(btrim(p_values->>'primaryPersonName'),'') is null
           or p_values->>'communicationPrimaryProvider' not in ('meta_whatsapp','twilio_sms')
           or p_values->>'communicationDeliveryMode' not in ('primary_only','primary_with_fallback','mirror') then
            raise exception using errcode = '22023', message = 'Invalid relationship background values.';
        end if;
        update public.relationships set
            primary_person_name = btrim(p_values->>'primaryPersonName'), business_name = nullif(btrim(p_values->>'businessName'),''),
            primary_contact_role = nullif(btrim(p_values->>'primaryContactRole'),''), primary_phone = nullif(btrim(p_values->>'primaryPhone'),''),
            whatsapp_phone = nullif(btrim(p_values->>'whatsappPhone'),''), communication_primary_provider = p_values->>'communicationPrimaryProvider',
            communication_delivery_mode = p_values->>'communicationDeliveryMode', primary_email = nullif(btrim(p_values->>'primaryEmail'),''),
            notes_summary = nullif(btrim(p_values->>'description'),''), location_value = case when p_values ? 'locationValue' then nullif(btrim(p_values->>'locationValue'),'') else location_value end
        where workspace_id = p_workspace_id and id = p_relationship_id returning * into v_relationship;
        insert into public.relationship_background_command_receipts(workspace_id,user_id,request_id,relationship_id,request_hash,committed_updated_at)
        values(p_workspace_id,p_user_id,p_request_id,p_relationship_id,p_request_hash,v_relationship.updated_at)
        returning * into v_receipt;
    end if;
    v_values := jsonb_build_object('primaryPersonName',v_relationship.primary_person_name,'businessName',coalesce(v_relationship.business_name,''),
        'locationValue',coalesce(v_relationship.location_value,''),'primaryContactRole',coalesce(v_relationship.primary_contact_role,''),'primaryPhone',coalesce(v_relationship.primary_phone,''),
        'whatsappPhone',coalesce(v_relationship.whatsapp_phone,''),'communicationPrimaryProvider',v_relationship.communication_primary_provider,
        'communicationDeliveryMode',v_relationship.communication_delivery_mode,'primaryEmail',coalesce(v_relationship.primary_email,''),'description',coalesce(v_relationship.notes_summary,''));
    if v_receipt.request_id is null then
        return jsonb_build_object('ok',false,'conflict',true,'version',v_relationship.updated_at,'values',v_values,
            'error','Another user changed this relationship. Review their version before retrying your edits.');
    end if;
    return jsonb_build_object('ok',true,'version',v_receipt.committed_updated_at,'currentVersion',v_relationship.updated_at,'values',v_values);
end;
$$;

create or replace function public.create_empty_relationship(p_workspace_id uuid,p_actor_user_id uuid,p_request_id uuid,p_details jsonb) returns uuid
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
 if nullif(btrim(p_details->>'email'),'') is null and nullif(btrim(p_details->>'phone'),'') is null then raise exception 'Add an email or phone number'; end if;
 insert into public.relationships(workspace_id,primary_person_name,business_name,primary_email,primary_phone,source_type,source_label,lifecycle_phase,status,source_metadata)
 values(p_workspace_id,btrim(p_details->>'name'),nullif(btrim(p_details->>'company'),''),nullif(btrim(p_details->>'email'),''),nullif(btrim(p_details->>'phone'),''),'manual','Manual','potential_client','active',
    jsonb_build_object('created_by',p_actor_user_id,'created_from','service_relationship','service_instances',true,'is_test',coalesce((p_details->>'isTest')::boolean,false))) returning id into rid;
 insert into public.relationship_create_receipts values(p_workspace_id,p_actor_user_id,p_request_id,rid,p_details,now());
 return rid;
end $$;

create function public.prepare_relationship_contact_confirmation(p_workspace_id uuid,p_relationship_id uuid,p_actor_user_id uuid,p_provider text,p_request_id uuid,p_body text) returns jsonb
language plpgsql security definer set search_path=public as $$
declare r relationships%rowtype; f relationship_contact_confirmations%rowtype; recipient text; mid uuid; ready jsonb;
begin
 select * into r from relationships where workspace_id=p_workspace_id and id=p_relationship_id for update;
 if r.id is null or r.status='archived' or not public.workspace_user_can_access_relationship(p_workspace_id,p_relationship_id,p_actor_user_id) or not public.workspace_user_can_sell(p_workspace_id,p_actor_user_id) then raise exception 'Seller access required'; end if;
 if p_provider not in('meta_whatsapp','twilio_sms') or p_request_id is null then raise exception 'Choose a contact method'; end if;
 recipient:=public.relationship_contact_phone(case when p_provider='meta_whatsapp' then r.whatsapp_phone else r.primary_phone end);
 if recipient !~ '^\+[1-9][0-9]{7,14}$' then raise exception 'Save a phone number with its country code first'; end if;
 select value into ready from jsonb_array_elements(public.relationship_messaging_choices(p_workspace_id,p_relationship_id)) where value->>'provider'=p_provider;
 if not (ready->>'enabled')::boolean then raise exception 'Connect this messaging provider in Settings first'; end if;
 if not (ready->>'optedIn')::boolean then raise exception 'This number must opt in through the workspace SMS opt-in page before confirmation can be sent'; end if;
 select * into f from relationship_contact_confirmations where workspace_id=p_workspace_id and actor_user_id=p_actor_user_id and request_id=p_request_id for update;
 if f.id is not null and (f.relationship_id<>p_relationship_id or f.provider<>p_provider or f.address<>recipient) then raise exception 'The contact changed. Reopen it before requesting confirmation'; end if;
 if f.id is not null and f.status not in('pending','send_failed') then return jsonb_build_object('send',false,'status',f.status,'id',f.id); end if;
 if f.id is null then
  if ready->>'state'='active' and ready->>'canSend'='true' then return jsonb_build_object('send',false,'status','confirmed'); end if;
  select * into f from relationship_contact_confirmations where workspace_id=p_workspace_id and relationship_id=p_relationship_id and provider=p_provider and relationship_contact_confirmations.address=recipient and status in('pending','send_failed','sending','awaiting_confirmation','send_uncertain') and created_at>now()-interval '7 days' order by created_at desc,id desc limit 1 for update;
  if f.id is not null and f.status in('sending','awaiting_confirmation','send_uncertain') then return jsonb_build_object('send',false,'status',f.status,'id',f.id); end if;
 end if;
 if f.id is null then
  insert into relationship_contact_confirmations(workspace_id,relationship_id,provider,address,request_id,actor_user_id) values(p_workspace_id,p_relationship_id,p_provider,recipient,p_request_id,p_actor_user_id) returning * into f;
 end if;
 mid:=f.message_id;
 if mid is null then
  insert into client_messages(workspace_id,relationship_id,direction,provider,to_address,body,status,sender_kind,automation_kind,automation_label,raw_payload)
  values(p_workspace_id,p_relationship_id,'outbound',p_provider,case when p_provider='meta_whatsapp' then 'whatsapp:' else 'sms:' end||recipient,p_body,'queued','automation','consent_template','Messaging confirmation',jsonb_build_object('relationship_contact_confirmation_id',f.id)) returning id into mid;
 end if;
 update relationship_contact_confirmations set status='sending',message_id=mid where id=f.id;
 return jsonb_build_object('send',true,'id',f.id,'messageId',mid,'address',recipient,'status','sending');
end $$;
revoke all on function public.prepare_relationship_contact_confirmation(uuid,uuid,uuid,text,uuid,text) from public,anon,authenticated;
grant execute on function public.prepare_relationship_contact_confirmation(uuid,uuid,uuid,text,uuid,text) to service_role;

create function public.attach_relationship_contact(p_workspace_id uuid,p_relationship_id uuid,p_actor_user_id uuid,p_provider text) returns void
language plpgsql security definer set search_path=public as $$
begin
 if p_provider not in('twilio_sms','meta_whatsapp') or not public.workspace_user_can_sell(p_workspace_id,p_actor_user_id) or not public.workspace_user_can_access_relationship(p_workspace_id,p_relationship_id,p_actor_user_id) then raise exception 'Seller access required'; end if;
 update relationships set source_metadata=jsonb_set(coalesce(source_metadata,'{}'),'{contact_methods}',coalesce(source_metadata->'contact_methods','[]')||jsonb_build_array(p_provider))
 where workspace_id=p_workspace_id and id=p_relationship_id and status<>'archived' and not coalesce(source_metadata->'contact_methods','[]') ? p_provider;
end $$;
revoke all on function public.attach_relationship_contact(uuid,uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.attach_relationship_contact(uuid,uuid,uuid,text) to service_role;

create function public.read_relationship_service_cards(p_workspace_id uuid,p_relationship_id uuid,p_user_id uuid,p_offset integer default 0,p_id text default null) returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare result jsonb;
begin
 if not public.workspace_user_can_access_relationship(p_workspace_id,p_relationship_id,p_user_id) then raise exception 'Relationship access required'; end if;
 if p_offset<0 or p_offset>10000 then raise exception 'Invalid page'; end if;
 select coalesce(jsonb_agg(to_jsonb(x)),'[]') into result from (
 select base.*,v.definition->>'thumbnailPath' "thumbnailPath",v.definition->>'templateId' "templateId",v.description,
 coalesce(i.source_snapshot->>'notes','') notes,coalesce(manager.display_name,manager.username) manager,coalesce(seller.display_name,seller.username) seller,
 sale.upfront_amount_cents sold_upfront_cents,sale.recurring_amount_cents sold_recurring_cents,sale.currency sold_currency,sale.billing_interval,sale.billing_interval_count
 from (select * from public.relationship_service_rows(p_workspace_id,p_relationship_id,p_user_id) where p_id is null or id=p_id order by created_at,id limit 31 offset p_offset) base
 left join onboarding_service_revisions v on v.workspace_id=p_workspace_id and v.id=base.service_revision_id
 left join relationship_service_instances i on not base.legacy and i.workspace_id=p_workspace_id and i.id::text=base.id
 left join user_profiles manager on manager.user_id=i.manager_user_id
 left join user_profiles seller on seller.user_id=i.seller_user_id
 left join lateral(select line.upfront_amount_cents,line.recurring_amount_cents,line.currency,s.billing_interval,s.billing_interval_count from client_sale_items line join client_sales s on s.workspace_id=line.workspace_id and s.id=line.client_sale_id where line.workspace_id=p_workspace_id and s.relationship_id=p_relationship_id and (line.service_instance_id=i.id or base.legacy and line.service_id=base.service_id and line.service_instance_id is null) and s.snapshot_frozen_at is not null and s.deleted_at is null order by s.created_at desc limit 1) sale on true
 ) x;
 return jsonb_build_object('items',result,'hasMore',jsonb_array_length(result)>30);
end $$;
revoke all on function public.read_relationship_service_cards(uuid,uuid,uuid,integer,text) from public,anon,authenticated;
grant execute on function public.read_relationship_service_cards(uuid,uuid,uuid,integer,text) to service_role;

create or replace function public.read_relationship_services(p_workspace_id uuid,p_relationship_id uuid,p_user_id uuid,p_offset integer default 0) returns jsonb
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
   select upper(lines.currency),'sold',lines.billing_interval,lines.billing_interval_count,sum(lines.upfront_cents)::bigint,sum(lines.recurring_cents)::bigint
   from (
    select l.currency,s.billing_interval,s.billing_interval_count,l.upfront_amount_cents upfront_cents,l.recurring_amount_cents recurring_cents
    from relationship_service_instances i join client_sale_items l on l.workspace_id=i.workspace_id and l.service_instance_id=i.id
    join client_sales s on s.workspace_id=l.workspace_id and s.id=l.client_sale_id
    where i.workspace_id=p_workspace_id and i.relationship_id=p_relationship_id and i.disposition='active' and i.stage in('onboarding','setup','maintenance') and s.deleted_at is null
    union all
    (select distinct on(l.service_id) l.currency,s.billing_interval,s.billing_interval_count,l.upfront_amount_cents,l.recurring_amount_cents
    from client_sale_items l join client_sales s on s.workspace_id=l.workspace_id and s.id=l.client_sale_id
    join relationships r on r.workspace_id=s.workspace_id and r.id=s.relationship_id
    where s.workspace_id=p_workspace_id and s.relationship_id=p_relationship_id and s.service_scope='relationship' and l.service_instance_id is null and s.snapshot_frozen_at is not null and s.deleted_at is null
     and r.lifecycle_phase in('onboarding','onboarding_review','fulfilment','retention')
     and s.status in('onboarding_created','onboarding_link_sent','onboarding_link_failed','paid','test_paid') order by l.service_id,s.created_at desc,s.id desc)
   ) lines group by upper(lines.currency),lines.billing_interval,lines.billing_interval_count
  ) t;
  result := result || jsonb_build_object('values',totals);
 end if;
 return result;
end $$;

notify pgrst,'reload schema';
commit;
