-- SS-03: selected-instance sales. Existing relationship sales retain their path.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';
alter table public.client_sales add column service_scope text not null default 'relationship' check(service_scope in('relationship','selected_services'));
alter table public.client_sales add column service_manager_user_id uuid references auth.users(id);
alter table public.client_sale_items add column service_instance_id uuid;
alter table public.client_sale_items add constraint sale_item_instance_scope foreign key(workspace_id,service_instance_id) references public.relationship_service_instances(workspace_id,id);
alter table public.client_sale_items drop constraint client_sale_items_client_sale_id_service_id_key;
create unique index client_sale_legacy_service_unique on public.client_sale_items(client_sale_id,service_id) where service_instance_id is null;
create unique index client_sale_instance_unique on public.client_sale_items(service_instance_id) where service_instance_id is not null;
alter table public.relationship_onboarding_sessions add column service_scope text not null default 'relationship' check(service_scope in('relationship','selected_services'));
drop index public.relationship_onboarding_sessions_one_active;
create unique index relationship_onboarding_sessions_one_active on public.relationship_onboarding_sessions(workspace_id,relationship_id) where status='active' and service_scope='relationship';
create index client_sales_confirmed_message_idx on public.client_sales(workspace_id,consent_confirmed_message_id) where consent_confirmed_message_id is not null;
create table public.service_sale_receipts(
 workspace_id uuid not null, actor_user_id uuid not null references auth.users(id), request_id uuid not null,
 relationship_id uuid not null, sale_id uuid not null, input jsonb not null, quote_hash text not null, created_at timestamptz not null default now(),
 primary key(workspace_id,actor_user_id,request_id), unique(sale_id),
 foreign key(workspace_id,relationship_id) references public.relationships(workspace_id,id),
 foreign key(workspace_id,sale_id) references public.client_sales(workspace_id,id)
);
alter table public.service_sale_receipts enable row level security;
revoke all on public.service_sale_receipts from public,anon,authenticated;
grant select,insert on public.service_sale_receipts to service_role;

-- A single composition owner is used by review and commit. No current catalogue
-- revision is substituted for the service revision selected on the relationship.
create function public.service_sale_modules(p_workspace_id uuid,p_instance_ids uuid[]) returns jsonb
language sql stable security definer set search_path=public as $$
 with config as (
  select id from public.onboarding_configuration_revisions where workspace_id=p_workspace_id and configuration_type='mandatory_modules' and status='published' order by revision_number desc limit 1
 ), published as (
  select distinct on(m.id) m.id module_id,m.internal_code,v.id module_revision_id,v.revision_number,v.definition,
   (case when v.definition ? 'mandatory' then coalesce((v.definition->>'mandatory')::boolean,false) else exists(select 1 from public.onboarding_configuration_revision_modules a where a.workspace_id=p_workspace_id and a.configuration_revision_id=(select id from config) and a.module_id=m.id) end or m.internal_code in('system-welcome','system-completion')) mandatory
  from public.onboarding_modules m join public.onboarding_module_revisions v on v.workspace_id=m.workspace_id and v.module_id=m.id and v.status='published'
  where m.workspace_id=p_workspace_id and m.status='active' order by m.id,v.revision_number desc
 ), matched as (
  select p.*,array(select i.id from public.relationship_service_instances i where i.workspace_id=p_workspace_id and i.id=any(p_instance_ids)
   and (p.mandatory or case when p.definition ? 'serviceIds' then coalesce(p.definition->'serviceIds','[]') @> jsonb_build_array(i.service_id::text)
    else exists(select 1 from public.onboarding_service_revision_modules a where a.workspace_id=p_workspace_id and a.service_revision_id=i.service_revision_id and a.module_id=p.module_id) end) order by i.id) instance_ids,
   case when internal_code='system-welcome' then -1 when internal_code='system-completion' then 3 when definition->>'placement'='start' then 0 when definition->>'placement'='end' then 2 else 1 end legacy_rank
  from published p
 ), ordered as (
  select *,row_number() over(order by case when exists(select 1 from published where jsonb_typeof(definition->'sortOrder')='number') then case when jsonb_typeof(definition->'sortOrder')='number' then (definition->>'sortOrder')::integer else legacy_rank*10000 end else legacy_rank end,coalesce(definition->>'name',internal_code),module_id)-1 sort_order
  from matched where mandatory or cardinality(instance_ids)>0
 ) select coalesce(jsonb_agg(jsonb_build_object('module_id',module_id,'module_revision_id',module_revision_id,'code',internal_code,'definition',definition,'mandatory',mandatory,'instance_ids',instance_ids,'sort_order',sort_order,'configuration_revision_id',(select id from config)) order by sort_order),'[]') from ordered
$$;

create function public.preview_relationship_service_sale(p_workspace_id uuid,p_relationship_id uuid,p_actor_user_id uuid,p_input jsonb) returns jsonb
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
  if i.id is null or i.stage<>'negotiating' or i.disposition<>'active' or i.origin<>'negotiation' or i.version is distinct from (line->>'version')::integer then raise exception 'A selected service changed or is no longer Negotiating. Reload the POS'; end if;
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
 return result||jsonb_build_object('hash',encode(extensions.digest(convert_to(result::text,'UTF8'),'sha256'),'hex'));
end $$;

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
          and old.stage='negotiating' and new.stage='awaiting_payment' and receipt.request_id=new.change_request_id and receipt.actor_user_id=new.changed_by
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


create function public.create_selected_service_session(
    p_workspace_id uuid,
    p_sale_id uuid,
    p_correlation_id uuid,
    p_idempotency_key text
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
    v_sale public.client_sales%rowtype;
    v_existing public.relationship_onboarding_sessions%rowtype;
    v_session_id uuid := gen_random_uuid();
    v_session_token text := encode(extensions.gen_random_bytes(32), 'hex');
    v_correlation_id uuid := coalesce(p_correlation_id, gen_random_uuid());
    v_snapshot jsonb;
    v_composition_hash text;
    v_snapshot_schema_version integer := 1;
    v_item record;
    v_module_definition jsonb;
    v_session_module_id uuid;
    v_step jsonb;
    v_field jsonb;
    v_session_step_id uuid;
    v_stage_id uuid;
    v_work_item_id uuid;
    v_previous_work_item_id uuid;
    v_work_step record;
    v_now timestamptz := now();
begin
    select * into v_sale from public.client_sales
    where id = p_sale_id and workspace_id = p_workspace_id
    for update;
    if v_sale.id is null then raise exception using errcode = 'P0002', message = 'SALE_NOT_FOUND: Client sale does not belong to this workspace'; end if;
    select * into v_existing from public.relationship_onboarding_sessions
    where source_sale_id = p_sale_id;
    if v_existing.id is not null then
        update public.client_sales set onboarding_session_id = v_existing.id
        where id = p_sale_id and workspace_id = p_workspace_id and onboarding_session_id is distinct from v_existing.id;
        return jsonb_build_object(
            'session_id', v_existing.id, 'session_token', v_existing.session_token,
            'relationship_id', v_existing.relationship_id, 'created', false,
            'composition_hash', v_existing.composition_hash
        );
    end if;
    if v_sale.relationship_id is null then raise exception 'SALE_RELATIONSHIP_REQUIRED: Paid sale has no relationship'; end if;
    if v_sale.service_scope <> 'selected_services' or v_sale.snapshot_frozen_at is null then raise exception 'Selected service sale required'; end if;
    if not exists (
        select 1 from public.client_sale_composition_items
        where workspace_id = p_workspace_id and client_sale_id = p_sale_id and item_kind = 'module'
    ) then raise exception 'SALE_COMPOSITION_REQUIRED: Invoice has no frozen Builder module composition'; end if;

    select coalesce(jsonb_agg(jsonb_build_object(
        'id', item.id, 'kind', item.item_kind, 'source_kind', item.source_kind,
        'module_id', item.module_id, 'module_revision_id', item.module_revision_id,
        'configuration_revision_id', item.configuration_revision_id,
        'source_service_revision_id', item.source_service_revision_id,
        'sort_order', item.sort_order, 'definition', item.definition,
        'source_references', item.source_references
    ) order by item.sort_order), '[]'::jsonb) into v_snapshot
    from public.client_sale_composition_items item
    where item.workspace_id = p_workspace_id and item.client_sale_id = p_sale_id and item.item_kind = 'module';
    v_composition_hash := coalesce(v_sale.composition_hash, md5(v_snapshot::text));
    select coalesce(max(case when jsonb_typeof(item.definition->'schemaVersion') = 'number'
        then (item.definition->>'schemaVersion')::integer else 1 end), 1)
    into v_snapshot_schema_version
    from public.client_sale_composition_items item
    where item.workspace_id = p_workspace_id and item.client_sale_id = p_sale_id and item.item_kind = 'module';

    insert into public.relationship_onboarding_sessions (
        id, workspace_id, relationship_id, session_token, status, service_scope, is_test,
        project_timeframe_days, created_by, source_sale_id, configuration_revision_id,
        welcome_revision_id, completion_revision_id, snapshot_schema_version,
        composition_hash, composition_snapshot, created_at, updated_at
    ) values (
        v_session_id, p_workspace_id, v_sale.relationship_id, v_session_token, 'active', 'selected_services',
        coalesce((select (source_metadata->>'is_test')::boolean from public.relationships where id = v_sale.relationship_id), false),
        v_sale.project_timeframe_days, v_sale.created_by, p_sale_id, v_sale.configuration_revision_id,
        null, null, v_snapshot_schema_version, v_composition_hash,
        jsonb_build_object('sale_id', p_sale_id, 'source', 'published_builder_modules', 'items', v_snapshot), v_now, v_now
    );

    for v_item in
        select * from public.client_sale_composition_items
        where workspace_id = p_workspace_id and client_sale_id = p_sale_id and item_kind = 'module'
        order by sort_order
    loop
        v_module_definition := v_item.definition;
        insert into public.relationship_onboarding_session_modules (
            workspace_id, session_id, module_id, module_revision_id, source_kind,
            source_service_revision_id, sort_order, title, description, is_test
        ) values (
            p_workspace_id, v_session_id, v_item.module_id, v_item.module_revision_id,
            v_item.source_kind, v_item.source_service_revision_id, v_item.sort_order,
            coalesce(v_module_definition->>'name', 'Onboarding module'),
            nullif(v_module_definition->>'description', ''),
            coalesce((v_module_definition->>'isTest')::boolean, false)
        ) returning id into v_session_module_id;
        for v_step in select value from jsonb_array_elements(coalesce(v_module_definition->'steps', '[]'::jsonb)) with ordinality order by ordinality loop
            insert into public.relationship_onboarding_session_steps (
                workspace_id, session_id, session_module_id, source_step_id, module_revision_id,
                kind, title, description, estimated_time, why_we_ask, video_url,
                video_storage_path, sort_order, legacy_step_key, legacy_form_key,
                navigation, is_actionable
            ) values (
                p_workspace_id, v_session_id, v_session_module_id, (v_step->>'id')::uuid,
                v_item.module_revision_id, coalesce(nullif(v_step->>'kind', ''), 'form'),
                coalesce(v_step->>'title', v_step#>>'{blocks,0,title}', 'Onboarding step'),
                nullif(coalesce(v_step->>'description', v_step#>>'{blocks,0,description}'), ''),
                nullif(coalesce(v_step->>'estimatedTime', v_step#>>'{blocks,0,estimatedTime}'), ''),
                nullif(v_step->>'why', ''), nullif(v_step->>'videoUrl', ''), nullif(v_step->>'videoPath', ''),
                v_item.sort_order * 1000 + coalesce((select count(*) from public.relationship_onboarding_session_steps existing where existing.session_module_id = v_session_module_id), 0),
                nullif(v_step->>'key', ''), nullif(v_step->>'formKey', ''),
                coalesce(v_step->'navigation', '{"backLabel":"Back","continueLabel":"Complete and continue"}'::jsonb), true
            ) returning id into v_session_step_id;
            for v_field in select value from jsonb_array_elements(coalesce(v_step->'fields', '[]'::jsonb)) with ordinality order by ordinality loop
                insert into public.relationship_onboarding_session_fields (
                    workspace_id, session_id, session_step_id, source_field_id, type, label,
                    required, help_text, placeholder, file_accept, multiple, sort_order, legacy_field_name
                ) values (
                    p_workspace_id, v_session_id, v_session_step_id, (v_field->>'id')::uuid,
                    v_field->>'type', coalesce(v_field->>'label', 'Field'),
                    coalesce((v_field->>'required')::boolean, false), nullif(v_field->>'helpText', ''),
                    nullif(v_field->>'placeholder', ''),
                    case when v_field->>'type' = 'file' then coalesce(nullif(v_field->>'accept', ''), 'any') else null end,
                    case when v_field->>'type' = 'file' then coalesce((v_field->>'multiple')::boolean, true) else false end,
                    coalesce((select count(*) from public.relationship_onboarding_session_fields existing where existing.session_step_id = v_session_step_id), 0),
                    nullif(v_field->>'key', '')
                );
            end loop;
        end loop;
    end loop;

    select id into v_stage_id from public.work_items
    where workspace_id = p_workspace_id and native_kind = 'relationship_workflow'
      and native_key = v_session_id::text || ':service-onboarding'
    for update;
    if v_stage_id is null then
        insert into public.work_items (
            workspace_id, title, description, lifecycle_phase, status, priority, is_key_task,
            native_kind, native_key, workflow_role, completion_mode, workflow_action,
            actual_start_at, actual_start_has_time, sort_order, metadata, created_by
        ) values (
            p_workspace_id, 'Onboard Client', 'Complete the client onboarding session.',
            'onboarding', 'waiting', 2, true, 'relationship_workflow',
            v_session_id::text || ':service-onboarding', 'service_group',
            'manual', 'await_onboarding', null, false, 0,
            jsonb_build_object('relationship_id', v_sale.relationship_id, 'created_from', 'paid_onboarding'),
            v_sale.created_by
        ) returning id into v_stage_id;
    end if;
    insert into public.work_item_relationships (workspace_id, work_item_id, relationship_id)
    values (p_workspace_id, v_stage_id, v_sale.relationship_id)
    on conflict (work_item_id, relationship_id) do nothing;

    v_previous_work_item_id := null;
    for v_work_step in
        select * from public.relationship_onboarding_session_steps
        where workspace_id = p_workspace_id and session_id = v_session_id and is_actionable = true
        order by sort_order limit 2
    loop
        insert into public.work_items (
            workspace_id, title, description, lifecycle_phase, status, priority, is_key_task,
            native_kind, native_key, native_href, parent_work_item_id, workflow_role,
            planned_start_date, actual_start_at, actual_start_has_time, sort_order,
            metadata, created_by
        ) values (
            p_workspace_id, v_work_step.title, v_work_step.description, 'onboarding', 'todo', 3, true,
            'onboarding_step', v_session_id::text || ':step:' || v_work_step.id::text, null,
            v_stage_id, 'task', null,
            null, false, v_work_step.sort_order,
            jsonb_strip_nulls(jsonb_build_object(
                'session_id', v_session_id, 'relationship_id', v_sale.relationship_id,
                'session_step_id', v_work_step.id, 'step_key', v_work_step.legacy_step_key,
                'module_revision_id', v_work_step.module_revision_id, 'kind', v_work_step.kind,
                'auto_created', true
            )), v_sale.created_by
        ) returning id into v_work_item_id;
        insert into public.work_item_relationships (workspace_id, work_item_id, relationship_id)
        values (p_workspace_id, v_work_item_id, v_sale.relationship_id)
        on conflict (work_item_id, relationship_id) do nothing;
        if v_previous_work_item_id is not null then
            insert into public.work_item_dependencies (workspace_id, work_item_id, depends_on_work_item_id, source)
            values (p_workspace_id, v_work_item_id, v_previous_work_item_id, 'manual')
            on conflict (work_item_id, depends_on_work_item_id) do nothing;
        end if;
        v_previous_work_item_id := v_work_item_id;
    end loop;

    insert into public.work_item_relationships(workspace_id,work_item_id,relationship_id) values(p_workspace_id,v_stage_id,v_sale.relationship_id) on conflict do nothing;
    insert into public.work_item_assignees(workspace_id,work_item_id,user_id) values(p_workspace_id,v_stage_id,v_sale.service_manager_user_id) on conflict do nothing;
    insert into public.service_instance_sessions(workspace_id,relationship_id,instance_id,session_id,enrollment)
     select p_workspace_id,v_sale.relationship_id,instance_id,v_session_id,'active' from public.service_instance_sale_items where workspace_id=p_workspace_id and sale_id=p_sale_id;
    insert into public.service_instance_module_requirements(workspace_id,instance_id,session_id,session_module_id)
     select p_workspace_id,(enrolled.value)::uuid,v_session_id,m.id from public.relationship_onboarding_session_modules m
     join public.client_sale_composition_items c on c.workspace_id=m.workspace_id and c.client_sale_id=p_sale_id and c.module_id=m.module_id
     cross join lateral jsonb_array_elements_text(c.source_references->'instance_ids') enrolled
     where m.workspace_id=p_workspace_id and m.session_id=v_session_id;
    insert into public.service_instance_work_items(workspace_id,instance_id,work_item_id)
     select p_workspace_id,i.instance_id,v_stage_id from public.service_instance_sale_items i where i.workspace_id=p_workspace_id and i.sale_id=p_sale_id;
    insert into public.service_instance_work_items(workspace_id,instance_id,work_item_id)
     select p_workspace_id,req.instance_id,w.id from public.work_items w
     join public.relationship_onboarding_session_steps step on step.workspace_id=w.workspace_id and step.id::text=w.metadata->>'session_step_id'
     join public.service_instance_module_requirements req on req.workspace_id=step.workspace_id and req.session_id=step.session_id and req.session_module_id=step.session_module_id
     where w.workspace_id=p_workspace_id and step.session_id=v_session_id and w.native_kind='onboarding_step' and w.native_key=v_session_id::text||':step:'||step.id::text
     on conflict do nothing;
    update public.client_sales
    set onboarding_session_id = v_session_id, correlation_id = v_correlation_id, updated_at = v_now
    where workspace_id = p_workspace_id and id = p_sale_id;

    perform public.record_workspace_admin_activity(
        p_workspace_id, 'onboarding', 'onboarding.session.composed', 'Paid onboarding session composed from Builder snapshot',
        p_entity_type => 'onboarding_session', p_entity_id => v_session_id::text,
        p_actor_kind => 'automation', p_correlation_id => v_correlation_id,
        p_idempotency_key => p_idempotency_key || ':composed',
        p_metadata => jsonb_build_object(
            'sale_id', p_sale_id, 'relationship_id', v_sale.relationship_id,
            'configuration_revision_id', v_sale.configuration_revision_id,
            'module_count', (select count(*) from public.relationship_onboarding_session_modules where session_id = v_session_id),
            'step_count', (select count(*) from public.relationship_onboarding_session_steps where session_id = v_session_id),
            'field_count', (select count(*) from public.relationship_onboarding_session_fields where session_id = v_session_id),
            'composition_hash', v_composition_hash,
            'snapshot_schema_version', v_snapshot_schema_version,
            'composition_source', 'published_builder_modules'
        )
    );
    perform public.record_workspace_admin_activity(
        p_workspace_id, 'onboarding', 'onboarding.session.started', 'Client onboarding session prepared after payment',
        p_entity_type => 'onboarding_session', p_entity_id => v_session_id::text,
        p_actor_kind => 'automation', p_correlation_id => v_correlation_id,
        p_idempotency_key => p_idempotency_key || ':started',
        p_metadata => jsonb_build_object('sale_id', p_sale_id, 'relationship_id', v_sale.relationship_id, 'public_access', 'awaiting_whatsapp_confirmation')
    );
    return jsonb_build_object(
        'session_id', v_session_id, 'session_token', v_session_token,
        'relationship_id', v_sale.relationship_id, 'created', true,
        'composition_hash', v_composition_hash
    );
end;
$$;


create or replace function public.stamp_client_sale_seller() returns trigger
language plpgsql security definer set search_path=public as $$
begin
 if tg_op='UPDATE' and old.seller_user_id is not null and new.seller_user_id is distinct from old.seller_user_id then raise exception 'Sale seller attribution is immutable'; end if;
 if new.service_scope='selected_services' then
  if tg_op='INSERT' and (not public.workspace_user_can_sell(new.workspace_id,new.created_by) or not public.workspace_user_can_access_relationship(new.workspace_id,new.relationship_id,new.created_by) or new.seller_user_id is distinct from new.created_by) then raise exception 'Selected sale seller required'; end if;
  if new.snapshot_frozen_at is not null and (tg_op='INSERT' or old.snapshot_frozen_at is null) and not exists(select 1 from public.service_sale_receipts where workspace_id=new.workspace_id and sale_id=new.id and actor_user_id=new.seller_user_id) then raise exception 'Atomic service sale receipt required'; end if;
  return new;
 end if;
 if new.snapshot_frozen_at is not null and (tg_op='INSERT' or old.snapshot_frozen_at is null) then
  perform public.validate_relationship_delivery_team(new.workspace_id,new.relationship_id);
  update public.relationships set team_locked_at=coalesce(team_locked_at,now()) where workspace_id=new.workspace_id and id=new.relationship_id;
  perform public.create_relationship_delivery_team(new.workspace_id,new.relationship_id);
 end if;
 if new.seller_user_id is null then select seller_user_id into new.seller_user_id from public.relationships where workspace_id=new.workspace_id and id=new.relationship_id; end if;
 return new;
end $$;

create function public.guard_selected_sale_snapshot() returns trigger
language plpgsql security definer set search_path=public as $$
declare sid uuid; scoped boolean;
begin
 if tg_table_name='client_sales' then
  if old.service_scope='selected_services' and (tg_op='DELETE' or old.snapshot_frozen_at is not null and
   (new.relationship_id,new.service_scope,new.seller_user_id,new.service_manager_user_id,new.client_name,new.client_email,new.currency,new.upfront_total_amount,new.recurring_total_amount,new.total_amount,new.billing_interval,new.billing_interval_count,new.service_keys,new.configuration_revision_id,new.composition_hash,new.snapshot_frozen_at,new.created_by,new.project_timeframe_days)
    is distinct from (old.relationship_id,old.service_scope,old.seller_user_id,old.service_manager_user_id,old.client_name,old.client_email,old.currency,old.upfront_total_amount,old.recurring_total_amount,old.total_amount,old.billing_interval,old.billing_interval_count,old.service_keys,old.configuration_revision_id,old.composition_hash,old.snapshot_frozen_at,old.created_by,old.project_timeframe_days)) then raise exception 'Selected sale snapshot is immutable'; end if;
  if tg_op='DELETE' then return old; end if; return new;
 end if;
 sid:=case when tg_op='INSERT' then new.client_sale_id else old.client_sale_id end;
 select service_scope='selected_services' and snapshot_frozen_at is not null into scoped from public.client_sales where id=sid;
 if scoped then raise exception 'Selected sale lines and composition are immutable'; end if;
 if tg_op='DELETE' then return old; end if; return new;
end $$;
create trigger guard_selected_sale_snapshot before update or delete on public.client_sales for each row execute function public.guard_selected_sale_snapshot();
create trigger guard_selected_sale_lines before insert or update or delete on public.client_sale_items for each row execute function public.guard_selected_sale_snapshot();
create trigger guard_selected_sale_composition before insert or update or delete on public.client_sale_composition_items for each row execute function public.guard_selected_sale_snapshot();

create function public.commit_relationship_service_sale(p_workspace_id uuid,p_relationship_id uuid,p_actor_user_id uuid,p_request_id uuid,p_input jsonb,p_quote_hash text,p_destination text,p_sms_destination text default null) returns jsonb
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
 perform 1 from public.relationship_service_instances where workspace_id=p_workspace_id and relationship_id=p_relationship_id and id in(select (x->>'id')::uuid from jsonb_array_elements(p_input->'lines') x) order by id for update;
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
 return jsonb_build_object('saleId',sid,'sessionId',result->>'session_id','replayed',false);
end $$;

-- Trusted payment update and service advancement are one database transaction.
create function public.advance_paid_service_sale() returns trigger
language plpgsql security definer set search_path=public as $$
begin
 if new.service_scope<>'selected_services' or new.status not in('paid','test_paid') then return new; end if;
 update public.relationship_service_instances i set stage='onboarding',version=version+1,change_request_id=gen_random_uuid(),change_reason='Payment confirmed for sale '||new.id,changed_by=new.created_by
 where i.workspace_id=new.workspace_id and i.stage='awaiting_payment' and exists(select 1 from public.service_instance_sale_items l where l.workspace_id=i.workspace_id and l.instance_id=i.id and l.sale_id=new.id);
 update public.work_items set status='done',actual_completed_at=coalesce(actual_completed_at,now()),actual_completed_has_time=true where workspace_id=new.workspace_id and native_key=new.id::text||':service-payment';
 update public.work_items set status='doing',actual_start_at=coalesce(actual_start_at,now()),actual_start_has_time=true where workspace_id=new.workspace_id and native_key=new.onboarding_session_id::text||':service-onboarding' and status='waiting';
 return new;
end $$;
create trigger advance_paid_service_sale after update of status on public.client_sales for each row execute function public.advance_paid_service_sale();

revoke all on function public.service_sale_modules(uuid,uuid[]),public.preview_relationship_service_sale(uuid,uuid,uuid,jsonb),public.create_selected_service_session(uuid,uuid,uuid,text),public.commit_relationship_service_sale(uuid,uuid,uuid,uuid,jsonb,text,text,text) from public,anon,authenticated;
grant execute on function public.service_sale_modules(uuid,uuid[]),public.preview_relationship_service_sale(uuid,uuid,uuid,jsonb),public.create_selected_service_session(uuid,uuid,uuid,text),public.commit_relationship_service_sale(uuid,uuid,uuid,uuid,jsonb,text,text,text) to service_role;


create or replace function public.guard_service_instance_link() returns trigger
language plpgsql security definer set search_path = public as $$
declare i public.relationship_service_instances%rowtype; line public.client_sale_items%rowtype; sale public.client_sales%rowtype; s public.relationship_onboarding_sessions%rowtype;
begin
    select * into strict i from public.relationship_service_instances where workspace_id = new.workspace_id and id = new.instance_id;
    if tg_table_name = 'service_instance_sale_items' then
        select * into strict line from public.client_sale_items where workspace_id = new.workspace_id and id = new.sale_item_id;
        select * into strict sale from public.client_sales where workspace_id = new.workspace_id and id = line.client_sale_id;
        if sale.id <> new.sale_id or sale.relationship_id is distinct from i.relationship_id or sale.snapshot_frozen_at is null
            or line.service_id is distinct from i.service_id or line.service_revision_id is distinct from i.service_revision_id
            or (sale.service_scope='selected_services' and line.service_instance_id is distinct from i.id) then
            raise exception 'Sale line must be frozen and match this relationship and service revision';
        end if;
        -- Caller cannot forge prices, currency, cadence or original seller attribution.
        new.seller_user_id := sale.seller_user_id;
        new.manager_user_id := i.manager_user_id;
        new.assignee_user_id := i.assignee_user_id;
        new.commercial_snapshot := jsonb_build_object('line', to_jsonb(line),
            'responsibility', jsonb_build_object('seller_user_id', sale.seller_user_id, 'manager_user_id', i.manager_user_id,
                'assignee_user_id', i.assignee_user_id, 'source', case when i.origin = 'legacy_import' then 'legacy_snapshot_not_certified_historical_assignment' else 'instance_at_sale_link' end),
            'sale', jsonb_build_object(
            'id', sale.id, 'snapshot_frozen_at', sale.snapshot_frozen_at, 'currency', sale.currency,
            'upfront_total_amount', sale.upfront_total_amount, 'recurring_total_amount', sale.recurring_total_amount,
            'billing_interval', sale.billing_interval, 'billing_interval_count', sale.billing_interval_count,
            'seller_user_id', sale.seller_user_id));
    elsif tg_table_name = 'service_instance_sessions' then
        select * into strict s from public.relationship_onboarding_sessions where workspace_id = new.workspace_id and id = new.session_id;
        if s.relationship_id <> i.relationship_id or not exists (
            select 1 from public.service_instance_sale_items l where l.workspace_id = new.workspace_id and l.instance_id = i.id and l.sale_id = s.source_sale_id
        ) then raise exception 'Session must belong to the instance sale'; end if;
        if new.enrollment = 'active' and (s.status <> 'active' or i.import_id is not null) then raise exception 'Only a live active session can acquire enrollment'; end if;
        if tg_op = 'UPDATE' and (to_jsonb(new) - 'enrollment') is distinct from (to_jsonb(old) - 'enrollment') then raise exception 'Session enrollment identity is immutable'; end if;
    elsif tg_table_name = 'service_instance_module_requirements' then
        if not exists (select 1 from public.relationship_onboarding_session_modules m where m.workspace_id = new.workspace_id and m.id = new.session_module_id and m.session_id = new.session_id
            and (exists(select 1 from public.relationship_onboarding_sessions ss join public.client_sale_composition_items c on c.workspace_id=ss.workspace_id and c.client_sale_id=ss.source_sale_id where ss.id=m.session_id and ss.service_scope='selected_services' and c.module_id=m.module_id and c.module_revision_id=m.module_revision_id and c.source_references->'instance_ids' @> jsonb_build_array(i.id::text)) or m.source_kind = 'mandatory' or m.source_service_revision_id = i.service_revision_id or exists (
                select 1 from public.onboarding_service_revision_modules rm where rm.workspace_id = new.workspace_id and rm.service_revision_id = i.service_revision_id and rm.module_id = m.module_id))) then
            raise exception 'Module must belong to this session and service';
        end if;
    elsif tg_table_name = 'service_instance_work_items' then
        if not exists (select 1 from public.work_items w join public.work_item_relationships l on l.workspace_id = w.workspace_id and l.work_item_id = w.id
            where w.workspace_id = new.workspace_id and w.id = new.work_item_id and l.relationship_id = i.relationship_id
            and (w.service_id is null or w.service_id = i.service_id)) then
            raise exception 'Work must belong to this workspace, relationship and service';
        end if;
    end if;
    return new;
end $$;

create function public.complete_selected_service_session(p_workspace_id uuid,p_session_id uuid,p_session_token text) returns jsonb
language plpgsql security definer set search_path=public as $$
declare s public.relationship_onboarding_sessions%rowtype; sale public.client_sales%rowtype; step record; wid uuid;
begin
 select * into s from public.relationship_onboarding_sessions where workspace_id=p_workspace_id and id=p_session_id and session_token=p_session_token and token_revoked_at is null and status in('active','completed') and service_scope='selected_services' for update;
 if s.id is null then raise exception 'Invalid onboarding session'; end if;
 select * into sale from public.client_sales where workspace_id=p_workspace_id and id=s.source_sale_id;
 if sale.status not in('paid','test_paid') or sale.consent_confirmed_at is null then raise exception 'Confirm and pay before completing onboarding'; end if;
 if s.status='completed' then return jsonb_build_object('session_id',s.id,'idempotent',true); end if;
 if exists(select 1 from public.relationship_onboarding_session_steps x where x.workspace_id=p_workspace_id and x.session_id=s.id and x.kind<>'completion' and not exists(select 1 from public.work_items w where w.workspace_id=p_workspace_id and w.status='done' and w.native_kind='onboarding_step' and w.metadata->>'session_id'=s.id::text and w.metadata->>'session_step_id'=x.id::text)) then raise exception 'Submit every onboarding step before finishing'; end if;
 update public.relationship_onboarding_sessions set status='completed',completed_at=now(),updated_at=now() where id=s.id;
 update public.work_items set status='done',actual_completed_at=now(),actual_completed_has_time=true where workspace_id=p_workspace_id and native_key=s.id::text||':service-onboarding';
 update public.service_instance_sessions set enrollment='historical' where workspace_id=p_workspace_id and session_id=s.id;
 for step in select id,title,session_module_id from public.relationship_onboarding_session_steps where workspace_id=p_workspace_id and session_id=s.id and kind<>'completion' order by sort_order loop
  insert into public.work_items(workspace_id,title,description,lifecycle_phase,status,priority,native_kind,native_key,workflow_role,metadata,created_by)
  values(p_workspace_id,'Review: '||step.title,'Review this sale''s submitted onboarding information.','onboarding_review','todo',2,'relationship_workflow',s.id::text||':service-review:'||step.id,'review',jsonb_build_object('session_id',s.id,'session_step_id',step.id,'sale_id',sale.id),sale.created_by) returning id into wid;
  insert into public.work_item_relationships(workspace_id,relationship_id,work_item_id) values(p_workspace_id,s.relationship_id,wid);
  insert into public.work_item_assignees(workspace_id,work_item_id,user_id) values(p_workspace_id,wid,sale.service_manager_user_id);
  insert into public.service_instance_work_items(workspace_id,instance_id,work_item_id) select p_workspace_id,instance_id,wid from public.service_instance_module_requirements where workspace_id=p_workspace_id and session_id=s.id and session_module_id=step.session_module_id;
 end loop;
 return jsonb_build_object('session_id',s.id,'idempotent',false,'workflow_finalized',true);
end $$;
revoke all on function public.complete_selected_service_session(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.complete_selected_service_session(uuid,uuid,text) to service_role;

-- Preserve the installed legacy runtime, and intercept only this explicit scope.
do $$
declare definition text; anchor text:='    select * into v_relationship' ;
begin
 definition:=pg_get_functiondef('public.complete_relationship_onboarding_session(uuid,uuid,text,uuid,text)'::regprocedure);
 if position(anchor in definition)=0 then raise exception 'Onboarding completion owner changed; inspect before release'; end if;
 definition:=replace(definition,anchor,E'    if v_session.service_scope = ''selected_services'' then\n        return public.complete_selected_service_session(p_workspace_id,p_session_id,p_session_token);\n    end if;\n'||anchor);
 execute definition;
end $$;


create function public.read_relationship_service_pos(p_workspace_id uuid,p_relationship_id uuid,p_actor_user_id uuid,p_offset integer default 0) returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare rows jsonb; managers jsonb; sales jsonb;
begin
 if not public.workspace_user_can_sell(p_workspace_id,p_actor_user_id) or not public.workspace_user_can_access_relationship(p_workspace_id,p_relationship_id,p_actor_user_id) then raise exception 'Seller access required'; end if;
 if p_offset<0 or p_offset>10000 then raise exception 'Invalid page'; end if;
 select coalesce(jsonb_agg(to_jsonb(x)),'[]') into rows from (
  select r.*,coalesce(v.definition->>'serviceType',v.definition->>'service_type',case when v.default_recurring_price_cents>0 then 'retainer' else 'one_time' end) service_type,
   coalesce(v.definition->>'defaultBillingInterval',v.definition->>'default_billing_interval','month') billing_interval,
   coalesce((v.definition->>'defaultBillingIntervalCount')::integer,(v.definition->>'default_billing_interval_count')::integer,1) billing_interval_count
  from public.relationship_service_rows(p_workspace_id,p_relationship_id,p_actor_user_id) r
  join public.onboarding_service_revisions v on v.workspace_id=p_workspace_id and v.id=r.service_revision_id
  where not r.legacy and r.stage='negotiating' and exists(select 1 from public.relationship_service_instances i where i.id=r.id::uuid and i.disposition='active') order by r.created_at,r.id limit 31 offset p_offset
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
 return jsonb_build_object('items',rows,'hasMore',jsonb_array_length(rows)>30,'managers',managers,'sales',sales,'relationshipVersion',(select updated_at from public.relationships where workspace_id=p_workspace_id and id=p_relationship_id));
end $$;
revoke all on function public.read_relationship_service_pos(uuid,uuid,uuid,integer) from public,anon,authenticated;
grant execute on function public.read_relationship_service_pos(uuid,uuid,uuid,integer) to service_role;
-- Store identical provider parameters before the first Checkout request. An
-- unknown provider result is recovered, never replaced by a second attempt.
alter table public.client_sales add column service_checkout_request jsonb;
alter table public.client_sales add column service_checkout_requested_at timestamptz;
create function public.claim_selected_service_checkout(p_workspace_id uuid,p_sale_id uuid,p_session_token text,p_previous_checkout_id text,p_request jsonb) returns jsonb
language plpgsql security definer set search_path=public as $$
declare s public.client_sales%rowtype;
begin
 select * into s from public.client_sales where workspace_id=p_workspace_id and id=p_sale_id and service_scope='selected_services' for update;
 if s.id is null or s.consent_confirmed_at is null or not exists(select 1 from public.relationship_onboarding_sessions where workspace_id=p_workspace_id and source_sale_id=s.id and session_token=p_session_token and token_revoked_at is null and status='active') then raise exception 'Payment is not available for this link'; end if;
 if s.status in('paid','test_paid') then return jsonb_build_object('paid',true); end if;
 if s.service_checkout_request is not null then
  if s.stripe_checkout_session_id is null or s.stripe_checkout_session_id is distinct from p_previous_checkout_id then
   if s.service_checkout_requested_at < now()-interval '23 hours' and s.stripe_checkout_session_id is null then raise exception 'The previous checkout result needs reconciliation before another checkout can be opened'; end if;
   return jsonb_build_object('request',s.service_checkout_request);
  end if;
  if s.stripe_checkout_status<>'expired' then return jsonb_build_object('request',s.service_checkout_request); end if;
 end if;
 if p_request->>'saleId' is distinct from s.id::text or p_request->>'workspaceId' is distinct from s.workspace_id::text or jsonb_typeof(p_request->'lineItems') is distinct from 'array' or coalesce(p_request->>'idempotencyKey','')='' then raise exception 'Invalid checkout request'; end if;
 update public.client_sales set service_checkout_request=p_request,service_checkout_requested_at=now(),stripe_checkout_session_id=null,stripe_checkout_url=null,stripe_checkout_expires_at=null,stripe_checkout_status=null where id=s.id;
 return jsonb_build_object('request',p_request);
end $$;
revoke all on function public.claim_selected_service_checkout(uuid,uuid,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.claim_selected_service_checkout(uuid,uuid,text,text,jsonb) to service_role;

-- A native module is visible to its sale team and the assigned people whose
-- purchased services require it. Eligibility alone does not grant access.
create or replace function public.workspace_user_can_access_session_module(p_workspace_id uuid,p_session_module_id uuid,p_user_id uuid default auth.uid()) returns boolean
language sql stable security definer set search_path=public as $$
 select exists(select 1 from public.relationship_onboarding_session_modules m
 join public.relationship_onboarding_sessions s on s.workspace_id=m.workspace_id and s.id=m.session_id
 join public.relationships r on r.workspace_id=s.workspace_id and r.id=s.relationship_id
 join public.workspace_memberships u on u.workspace_id=r.workspace_id and u.user_id=p_user_id
 left join public.onboarding_service_revisions v on v.workspace_id=m.workspace_id and v.id=m.source_service_revision_id
 left join public.client_sales sale on sale.workspace_id=s.workspace_id and sale.id=s.source_sale_id
 where m.workspace_id=p_workspace_id and m.id=p_session_module_id and (u.role in('owner','admin') or
 case when s.service_scope='selected_services' then
  sale.seller_user_id=p_user_id or sale.service_manager_user_id=p_user_id or exists(select 1 from public.service_instance_module_requirements req join public.relationship_service_instances i on i.workspace_id=req.workspace_id and i.id=req.instance_id where req.workspace_id=p_workspace_id and req.session_module_id=m.id and i.assignee_user_id=p_user_id)
 else r.seller_user_id=p_user_id or r.fulfilment_manager_user_id=p_user_id or exists(select 1 from public.relationship_services a where a.workspace_id=r.workspace_id and a.relationship_id=r.id and a.assignee_user_id=p_user_id and (m.source_kind='mandatory' or a.service_id=v.service_id)) end))
$$;

create function public.read_selected_service_session_access(p_workspace_id uuid,p_session_ids uuid[],p_user_id uuid) returns jsonb
language sql stable security definer set search_path=public as $$
 select jsonb_build_object(
 'moduleIds',coalesce((select jsonb_agg(m.id) from public.relationship_onboarding_session_modules m join public.relationship_onboarding_sessions s on s.workspace_id=m.workspace_id and s.id=m.session_id where m.workspace_id=p_workspace_id and m.session_id=any(p_session_ids) and s.service_scope='selected_services' and public.workspace_user_can_access_session_module(p_workspace_id,m.id,p_user_id)),'[]'),
 'fullSessionIds',coalesce((select jsonb_agg(s.id) from public.relationship_onboarding_sessions s join public.client_sales sale on sale.workspace_id=s.workspace_id and sale.id=s.source_sale_id join public.workspace_memberships u on u.workspace_id=s.workspace_id and u.user_id=p_user_id where s.workspace_id=p_workspace_id and s.id=any(p_session_ids) and s.service_scope='selected_services' and (u.role in('owner','admin') or p_user_id in(sale.seller_user_id,sale.service_manager_user_id))),'[]'))
$$;
revoke all on function public.read_selected_service_session_access(uuid,uuid[],uuid) from public,anon,authenticated;
grant execute on function public.read_selected_service_session_access(uuid,uuid[],uuid) to service_role;

create or replace function public.infer_work_item_service_scope()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
    v_session_step_id uuid;
begin
    if new.native_kind='onboarding_step' and coalesce(new.metadata->>'session_id','') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
       and exists(select 1 from public.relationship_onboarding_sessions where workspace_id=new.workspace_id and id=(new.metadata->>'session_id')::uuid and service_scope='selected_services') then
        -- A module may be required by several purchased services; exact instance
        -- links below own its work scope instead of guessing one catalogue ID.
        new.service_id:=null;
        return new;
    end if;
    if new.service_id is not null then return new; end if;
    if coalesce(new.metadata->>'service_id', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
        select service.id into new.service_id
        from public.onboarding_services service
        where service.workspace_id = new.workspace_id
          and service.id = (new.metadata->>'service_id')::uuid;
        if new.service_id is not null then return new; end if;
    end if;
    if new.native_kind <> 'onboarding_step'
       or coalesce(new.metadata->>'session_step_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
        return new;
    end if;
    v_session_step_id := (new.metadata->>'session_step_id')::uuid;
    select revision.service_id into new.service_id
    from public.relationship_onboarding_session_steps step
    join public.relationship_onboarding_session_modules module
      on module.workspace_id = step.workspace_id and module.id = step.session_module_id
    join public.onboarding_service_revisions revision
      on revision.workspace_id = module.workspace_id and revision.id = module.source_service_revision_id
    where step.workspace_id = new.workspace_id and step.id = v_session_step_id;
    return new;
end;
$$;


create function public.link_selected_service_step_work() returns trigger
language plpgsql security definer set search_path=public as $$
begin
 insert into public.service_instance_work_items(workspace_id,instance_id,work_item_id)
 select new.workspace_id,req.instance_id,new.work_item_id from public.work_items w
 join public.relationship_onboarding_session_steps step on step.workspace_id=w.workspace_id and step.id::text=w.metadata->>'session_step_id'
 join public.relationship_onboarding_sessions s on s.workspace_id=step.workspace_id and s.id=step.session_id and s.relationship_id=new.relationship_id and s.service_scope='selected_services'
 join public.service_instance_module_requirements req on req.workspace_id=s.workspace_id and req.session_id=s.id and req.session_module_id=step.session_module_id
 where w.workspace_id=new.workspace_id and w.id=new.work_item_id and w.native_kind='onboarding_step' and w.native_key=s.id::text||':step:'||step.id::text
 on conflict do nothing;
 return new;
end $$;
create trigger link_selected_service_step_work after insert on public.work_item_relationships for each row execute function public.link_selected_service_step_work();

notify pgrst,'reload schema';
commit;
