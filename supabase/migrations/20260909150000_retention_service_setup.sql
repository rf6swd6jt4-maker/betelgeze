begin;

-- A service pool makes staff eligible; a client allocation grants access.
create or replace function public.workspace_user_can_manage_appointment_setting(
 p_workspace_id uuid, p_relationship_id uuid, p_service_id uuid, p_user_id uuid default auth.uid()
) returns boolean language sql stable security definer set search_path=public as $$
 select public.appointment_setting_service_is_available(p_workspace_id,p_relationship_id,p_service_id)
 and exists(select 1 from public.relationships r join public.workspaces w on w.id=r.workspace_id
   where r.workspace_id=p_workspace_id and r.id=p_relationship_id and w.status='active'
   and r.status <> 'archived' and r.lifecycle_phase='retention')
 and case public.workspace_role_for_user(p_workspace_id,p_user_id)
 when 'owner' then true when 'admin' then true
 when 'staff' then exists(select 1 from public.relationship_services s
   join public.workspace_service_capabilities c on c.workspace_id=s.workspace_id and c.service_id=s.service_id
   where s.workspace_id=p_workspace_id and s.relationship_id=p_relationship_id and s.service_id=p_service_id
   and s.assignee_user_id=p_user_id and c.capability='appointment_setting.manage')
 else false end
$$;

-- Only the guarded append operation can authorize one INSERT into a locked client.
-- No caller-controlled session setting or general unlock bypass is used.
create table public.retention_service_insert_permits (
 transaction_id bigint not null, workspace_id uuid not null, relationship_id uuid not null, service_id uuid not null,
 primary key(transaction_id,workspace_id,relationship_id,service_id)
);
alter table public.retention_service_insert_permits enable row level security;
revoke all on public.retention_service_insert_permits from public,anon,authenticated,service_role;

create or replace function public.guard_sold_service_assignment() returns trigger
language plpgsql security definer set search_path=public as $$
declare w uuid; r uuid;
begin
 if tg_op='UPDATE' and (new.workspace_id,new.relationship_id) is distinct from (old.workspace_id,old.relationship_id) then raise exception 'Service assignment cannot be moved to another relationship'; end if;
 w=case when tg_op='DELETE' then old.workspace_id else new.workspace_id end;
 r=case when tg_op='DELETE' then old.relationship_id else new.relationship_id end;
 perform 1 from public.relationships where workspace_id=w and id=r for update;
 if exists(select 1 from public.relationships where workspace_id=w and id=r and team_locked_at is not null) then
   if tg_op='INSERT' then
     if not exists(select 1 from public.retention_service_insert_permits where transaction_id=txid_current()
       and workspace_id=w and relationship_id=r and service_id=new.service_id) then raise exception 'The sold client services cannot be changed'; end if;
   elsif tg_op='DELETE' then raise exception 'The sold client services cannot be changed';
   elsif (new.assignee_user_id,new.service_id,new.relationship_id) is distinct from (old.assignee_user_id,old.service_id,old.relationship_id) then
     raise exception 'The sold client service assignment cannot be changed';
   end if;
 end if;
 if tg_op='DELETE' then return old; end if; return new;
end $$;

-- Internal primitive shared by initial setup and the future admin service editor.
create function public.insert_retention_service(p_workspace_id uuid,p_relationship_id uuid,p_service jsonb) returns void
language plpgsql security definer set search_path=public as $$
declare s public.onboarding_services%rowtype; v public.onboarding_service_revisions%rowtype;
 assignee uuid; config jsonb; mediums text[]; fields jsonb;
begin
 select * into s from public.onboarding_services where workspace_id=p_workspace_id and id=(p_service->>'service_id')::uuid for share;
 if s.id is null or s.state <> 'active' then raise exception 'Choose an active service'; end if;
 select * into v from public.onboarding_service_revisions where workspace_id=p_workspace_id and service_id=s.id order by revision_number desc limit 1;
 if v.id is null or v.id is distinct from (p_service->>'revision_id')::uuid then raise exception 'Service configuration changed. Reload the form and try again'; end if;
 assignee:=(p_service->>'assignee_user_id')::uuid;
 perform 1 from public.workspace_memberships m join public.workspace_member_service_access e using(workspace_id,user_id)
 where m.workspace_id=p_workspace_id and m.user_id=assignee and e.service_id=s.id for share of m,e;
 if not found then raise exception 'Choose an eligible delivery person for every service'; end if;
 if exists(select 1 from public.relationship_services where workspace_id=p_workspace_id and relationship_id=p_relationship_id and service_id=s.id) then
   raise exception 'This service is already assigned to the client';
 end if;
 if coalesce(v.definition->>'templateId',v.definition->>'template_id')='appointment-setting' then
   if exists(select 1 from public.relationship_services a join public.onboarding_service_revisions v2 on v2.workspace_id=a.workspace_id and v2.id=a.service_revision_id
     where a.workspace_id=p_workspace_id and a.relationship_id=p_relationship_id and coalesce(v2.definition->>'templateId',v2.definition->>'template_id')='appointment-setting') then
     raise exception 'This client already has an Appointment Setting service';
   end if;
   config:=p_service->'appointment_configuration';
   if config is null or jsonb_typeof(config->'mediums') is distinct from 'array' or jsonb_typeof(config->'fields') is distinct from 'array' then
     raise exception 'Choose appointment options and requested information';
   end if;
   select array_agg(value) into mediums from jsonb_array_elements_text(config->'mediums');
   if coalesce(cardinality(mediums),0) not between 1 and 3 or not mediums <@ array['phone','google_meet','zoom']::text[]
     or (select count(distinct x) from unnest(mediums) x)<>cardinality(mediums) then raise exception 'Choose at least one valid appointment option'; end if;
   fields:=config->'fields';
   if jsonb_array_length(fields)>4 or exists(select 1 from jsonb_array_elements(fields) f
     where coalesce(f->>'key','') not in ('phone','email','service','address','notes') or jsonb_typeof(f->'required') is distinct from 'boolean')
     or (select count(distinct f->>'key') from jsonb_array_elements(fields) f)<>jsonb_array_length(fields) then
     raise exception 'Choose up to four distinct appointment information fields';
   end if;
 end if;
 insert into public.retention_service_insert_permits values(txid_current(),p_workspace_id,p_relationship_id,s.id);
 insert into public.relationship_services(workspace_id,relationship_id,service_key,service_id,service_revision_id,assignee_user_id,price_cents,upfront_price_cents,recurring_price_cents,currency)
 values(p_workspace_id,p_relationship_id,s.internal_code,s.id,v.id,assignee,0,0,0,v.currency);
 delete from public.retention_service_insert_permits where transaction_id=txid_current() and workspace_id=p_workspace_id and relationship_id=p_relationship_id and service_id=s.id;
 if mediums is not null then
   insert into public.relationship_appointment_setting_configs(workspace_id,relationship_id,service_id,mediums,requested_fields)
   values(p_workspace_id,p_relationship_id,s.id,mediums,fields);
 end if;
end $$;
revoke all on function public.insert_retention_service(uuid,uuid,jsonb) from public,anon,authenticated,service_role;

create function public.create_retention_relationship(p_workspace_id uuid,p_actor_user_id uuid,p_request_id uuid,p_details jsonb,p_services jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare r uuid; sale uuid; stage uuid; manager uuid; item jsonb; provider text;
begin
 if not public.workspace_user_can_sell(p_workspace_id,p_actor_user_id) or not exists(select 1 from public.workspaces where id=p_workspace_id and status='active') then
   raise exception 'Your account is not enabled for selling';
 end if;
 if p_request_id is null then raise exception 'A creation request ID is required'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_request_id::text,0));
 -- A response lost in transit must not create another client or confirmation.
 if exists(select 1 from public.relationships where id=p_request_id) then
   select id into r from public.relationships where id=p_request_id and workspace_id=p_workspace_id
     and status <> 'archived' and lifecycle_phase='retention'
     and source_metadata->>'created_by'=p_actor_user_id::text and source_metadata->>'created_from'='retention_relationship_form';
   if r is null then raise exception 'This creation request is not available'; end if;
   select id into sale from public.client_sales where workspace_id=p_workspace_id and relationship_id=r and raw_payload->>'flow'='retention_confirmation' order by created_at limit 1;
   return jsonb_build_object('relationship_id',r,'sale_id',sale);
 end if;
 if nullif(btrim(p_details->>'primary_person_name'),'') is null then raise exception 'Add the primary contact name'; end if;
 provider:=p_details->>'communication_primary_provider';
 if provider is null or provider not in ('meta_whatsapp','twilio_sms') or nullif(p_details->>'confirmation_address','') is null then raise exception 'Choose a messaging channel and usable number'; end if;
 if jsonb_typeof(p_services) is distinct from 'array' then raise exception 'Choose at least one service'; end if;
 if jsonb_array_length(p_services) not between 1 and 50 then raise exception 'Choose between one and fifty services'; end if;
 manager:=(p_details->>'fulfilment_manager_user_id')::uuid;
 perform 1 from public.workspace_operational_roles o join public.workspace_memberships m using(workspace_id,user_id)
 where o.workspace_id=p_workspace_id and o.user_id=manager and o.can_manage for share of o,m;
 if not found then raise exception 'Choose an eligible client manager'; end if;
 r:=p_request_id;
 insert into public.relationships(id,workspace_id,source_type,primary_person_name,business_name,primary_email,primary_phone,whatsapp_phone,
 website_url,industry_value,location_value,source_label,primary_contact_role,notes_summary,lifecycle_phase,status,
 communication_primary_provider,communication_delivery_mode,seller_user_id,fulfilment_manager_user_id,pos_started_at,source_metadata)
 values(r,p_workspace_id,'manual',btrim(p_details->>'primary_person_name'),p_details->>'business_name',p_details->>'primary_email',p_details->>'primary_phone',p_details->>'whatsapp_phone',
 p_details->>'website_url',p_details->>'industry_value',p_details->>'location_value',coalesce(p_details->>'source_label','Manual'),p_details->>'primary_contact_role',p_details->>'notes_summary','retention','active',
 provider,'primary_only',p_actor_user_id,manager,now(),jsonb_build_object('created_from','retention_relationship_form','created_by',p_actor_user_id,'is_test',coalesce((p_details->>'is_test')::boolean,false)));
 for item in select value from jsonb_array_elements(p_services) loop
   perform public.insert_retention_service(p_workspace_id,r,item);
 end loop;
 update public.relationships set team_locked_at=now() where id=r;
 perform public.create_relationship_delivery_team(p_workspace_id,r);
 insert into public.work_items(workspace_id,title,lifecycle_phase,workflow_role,completion_mode,native_kind,native_key,planned_start_date,actual_start_at,actual_start_has_time,metadata)
 values(p_workspace_id,'Retain Client','retention','lifecycle_stage','manual','relationship_workflow',r::text||':retention',current_date,now(),true,jsonb_build_object('relationship_id',r,'created_from','relationship_workflow')) returning id into stage;
 insert into public.work_item_relationships(workspace_id,relationship_id,work_item_id) values(p_workspace_id,r,stage);
 insert into public.work_item_assignees(workspace_id,work_item_id,user_id) values(p_workspace_id,stage,manager);
 insert into public.client_sales(workspace_id,relationship_id,client_name,client_email,client_phone,sms_recipient_e164,service_keys,line_items,currency,total_amount,status,created_by,raw_payload)
 values(p_workspace_id,r,coalesce(p_details->>'business_name',p_details->>'primary_person_name'),p_details->>'primary_email',p_details->>'confirmation_address',p_details->>'sms_recipient_e164','[]','[]','usd',0,'manual_consent_pending',p_actor_user_id,
 jsonb_build_object('flow','retention_confirmation','relationship_start_phase','retention')) returning id into sale;
 return jsonb_build_object('relationship_id',r,'sale_id',sale);
end $$;
revoke all on function public.create_retention_relationship(uuid,uuid,uuid,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.create_retention_relationship(uuid,uuid,uuid,jsonb,jsonb) to service_role;

-- Minimal additive upgrade path: no edits to sold pricing, original allocations,
-- onboarding snapshots or existing appointments, and no invoice or client message.
create function public.add_retention_relationship_service(p_workspace_id uuid,p_relationship_id uuid,p_actor_user_id uuid,p_service jsonb,p_reason text)
returns void language plpgsql security definer set search_path=public as $$
declare t uuid;
begin
 if not coalesce(public.workspace_role_for_user(p_workspace_id,p_actor_user_id) in ('owner','admin'),false)
   or not exists(select 1 from public.workspaces where id=p_workspace_id and status='active') then raise exception 'Only workspace admins can add a retention service'; end if;
 if nullif(btrim(p_reason),'') is null then raise exception 'Describe the service change'; end if;
 perform 1 from public.relationships where workspace_id=p_workspace_id and id=p_relationship_id and lifecycle_phase='retention' and status <> 'archived' for update;
 if not found then raise exception 'An active Retention relationship is required'; end if;
 perform public.insert_retention_service(p_workspace_id,p_relationship_id,p_service);
 t:=public.create_relationship_delivery_team(p_workspace_id,p_relationship_id);
 insert into public.workspace_team_members(workspace_id,team_id,user_id,added_by)
 values(p_workspace_id,t,(p_service->>'assignee_user_id')::uuid,p_actor_user_id) on conflict do nothing;
 insert into public.relationship_team_events(workspace_id,relationship_id,actor_user_id,event_type,details)
 values(p_workspace_id,p_relationship_id,p_actor_user_id,'retention_service_added',jsonb_build_object('service_id',p_service->>'service_id','revision_id',p_service->>'revision_id','assignee_user_id',p_service->>'assignee_user_id','reason',btrim(p_reason)));
end $$;
revoke all on function public.add_retention_relationship_service(uuid,uuid,uuid,jsonb,text) from public,anon,authenticated;
grant execute on function public.add_retention_relationship_service(uuid,uuid,uuid,jsonb,text) to service_role;
notify pgrst,'reload schema';
commit;
