-- Current operational responsibility; immutable sales and onboarding remain untouched.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';

create function public.current_appointment_service_assignments(p_workspace uuid,p_relationship uuid default null)
returns table(relationship_id uuid,service_id uuid,assignee_user_id uuid,stage text)
language sql stable security definer set search_path=public as $$
 select i.relationship_id,i.service_id,i.assignee_user_id,i.stage
 from relationship_service_instances i
 join onboarding_service_revisions v on v.workspace_id=i.workspace_id and v.id=i.service_revision_id
 join relationships r on r.workspace_id=i.workspace_id and r.id=i.relationship_id
 where i.workspace_id=p_workspace and (p_relationship is null or i.relationship_id=p_relationship)
 and i.import_id is null and i.disposition='active' and i.stage in ('onboarding','setup','maintenance')
 and r.status<>'archived' and coalesce(v.definition->>'templateId',v.definition->>'template_id')='appointment-setting'
 union all
 select s.relationship_id,s.service_id,s.assignee_user_id,'maintenance'
 from relationship_services s join relationships r on r.workspace_id=s.workspace_id and r.id=s.relationship_id
 join onboarding_service_revisions v on v.workspace_id=s.workspace_id and v.id=s.service_revision_id
 where s.workspace_id=p_workspace and (p_relationship is null or s.relationship_id=p_relationship)
 and r.status<>'archived' and r.lifecycle_phase='retention'
 and coalesce(v.definition->>'templateId',v.definition->>'template_id')='appointment-setting'
 -- Delivery responsibility supersedes legacy attribution, even after it closes.
 -- A separate tentative opportunity must not revoke an existing legacy service.
 and not exists(select 1 from relationship_service_instances i where i.workspace_id=s.workspace_id
   and i.relationship_id=s.relationship_id and i.service_id=s.service_id and i.import_id is null
   and i.stage in ('onboarding','setup','maintenance','completed'))
$$;

create or replace function public.appointment_setting_service_is_available(p_workspace_id uuid,p_relationship_id uuid,p_service_id uuid)
returns boolean language sql stable security definer set search_path=public as $$
 select exists(select 1 from current_appointment_service_assignments(p_workspace_id,p_relationship_id) a
 join onboarding_services s on s.workspace_id=p_workspace_id and s.id=a.service_id and s.state<>'archived'
 where a.service_id=p_service_id and a.stage in ('setup','maintenance'))
$$;
create or replace function public.workspace_user_can_manage_appointment_setting(p_workspace_id uuid,p_relationship_id uuid,p_service_id uuid,p_user_id uuid default auth.uid())
returns boolean language sql stable security definer set search_path=public as $$
 select exists(select 1 from workspaces where id=p_workspace_id and status='active')
 and appointment_setting_service_is_available(p_workspace_id,p_relationship_id,p_service_id)
 and case workspace_role_for_user(p_workspace_id,p_user_id) when 'owner' then true when 'admin' then true
 when 'staff' then exists(select 1 from current_appointment_service_assignments(p_workspace_id,p_relationship_id) a
 join workspace_member_service_access e on e.workspace_id=p_workspace_id and e.service_id=a.service_id and e.user_id=p_user_id
 join workspace_service_capabilities c on c.workspace_id=e.workspace_id and c.service_id=e.service_id and c.capability='appointment_setting.manage'
 where a.service_id=p_service_id and a.assignee_user_id=p_user_id and a.stage in ('setup','maintenance')) else false end
$$;
create function public.service_assignee_can_setup_client(p_workspace uuid,p_user uuid,p_relationship uuid default null)
returns boolean language sql stable security definer set search_path=public as $$
 select exists(select 1 from workspace_memberships m join workspaces w on w.id=m.workspace_id and w.status='active'
 where m.workspace_id=p_workspace and m.user_id=p_user)
 and ((workspace_role_for_user(p_workspace,p_user) in ('owner','admin') and
 (p_relationship is null or exists(select 1 from current_appointment_service_assignments(p_workspace,p_relationship))))
 or exists(select 1 from appointment_setting_setup_assignees a where a.workspace_id=p_workspace and a.user_id=p_user
 and (p_relationship is null or a.relationship_id=p_relationship))
 or exists(select 1 from relationship_service_instances i
 join onboarding_service_revisions v on v.workspace_id=i.workspace_id and v.id=i.service_revision_id
 join relationships r on r.workspace_id=i.workspace_id and r.id=i.relationship_id and r.status<>'archived'
 join workspace_member_service_access e on e.workspace_id=i.workspace_id and e.service_id=i.service_id and e.user_id=p_user
 where i.workspace_id=p_workspace and i.assignee_user_id=p_user and i.disposition='active'
 and i.stage in ('onboarding','setup','maintenance') and i.import_id is null
 and (p_relationship is null or i.relationship_id=p_relationship)
 and coalesce(v.definition->>'templateId',v.definition->>'template_id')='appointment-setting'))
$$;
create function public.read_assigned_appointment_services(p_workspace uuid,p_user uuid,p_relationship uuid default null)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare result jsonb;
begin
 -- The caller opens the first authorized service for each client. Preserve its
 -- historical created_at choice; UUID ordering is only a tie/new-service fallback.
 select coalesce(jsonb_agg(jsonb_build_object('relationship_id',x.relationship_id,'service_id',x.service_id)
 order by x.relationship_id,x.legacy_created_at nulls last,x.service_id),'[]') into result from (
 select a.relationship_id,a.service_id,min(s.created_at) legacy_created_at
 from (select distinct current_assignment.relationship_id,current_assignment.service_id
   from current_appointment_service_assignments(p_workspace,p_relationship) current_assignment
   where workspace_user_can_manage_appointment_setting(p_workspace,current_assignment.relationship_id,current_assignment.service_id,p_user)) a
 left join relationship_services s on s.workspace_id=p_workspace and s.relationship_id=a.relationship_id and s.service_id=a.service_id
   and (p_relationship is null or s.relationship_id=p_relationship)
 group by a.relationship_id,a.service_id
 order by a.relationship_id,min(s.created_at) nulls last,a.service_id limit 1001) x;
 if jsonb_array_length(result)>1000 then raise exception 'Open a specific client to view Appointment Setting.'; end if;
 return result;
end $$;

-- Preserve the existing list projection and secret/lease implementation. Staff
-- lists start at the actor's indexed grants, not one helper call for every client.
do $$declare definition text; old_clause text; old_cte text; actor_cte text; list_query text; list_start integer; list_end integer; begin
 definition:=pg_get_functiondef('public.manage_client_ghl_connection(uuid,uuid,text,uuid,uuid,text,text,text,text,jsonb,text)'::regprocedure);
 old_clause:=$old$exists (
                select 1 from public.appointment_setting_setup_assignees assignment
                where assignment.workspace_id=p_workspace_id and assignment.relationship_id=relationship.id and assignment.user_id=p_user_id
            )$old$;
 if position(old_clause in definition)=0 then raise exception 'Unexpected client connection list grant'; end if;
 old_cte:=$old$with eligible as (
                select instance.relationship_id from public.relationship_service_instances instance
                join public.onboarding_service_revisions revision on revision.workspace_id=instance.workspace_id and revision.id=instance.service_revision_id
                where instance.workspace_id=p_workspace_id and instance.import_id is null and instance.disposition <> 'cancelled'
                  and coalesce(revision.definition->>'templateId',revision.definition->>'template_id')='appointment-setting'
                union
                select service.relationship_id from public.relationship_services service
                join public.onboarding_service_revisions revision on revision.workspace_id=service.workspace_id and revision.id=service.service_revision_id
                where service.workspace_id=p_workspace_id
                  and coalesce(revision.definition->>'templateId',revision.definition->>'template_id')='appointment-setting'
            )$old$;
 actor_cte:=$new$with eligible as (
                select instance.relationship_id from public.relationship_service_instances instance
                join public.onboarding_service_revisions revision on revision.workspace_id=instance.workspace_id and revision.id=instance.service_revision_id
                join public.workspace_member_service_access access on access.workspace_id=instance.workspace_id and access.service_id=instance.service_id and access.user_id=p_user_id
                where instance.workspace_id=p_workspace_id and instance.assignee_user_id=p_user_id
                  and instance.import_id is null and instance.disposition='active' and instance.stage in ('onboarding','setup','maintenance')
                  and coalesce(revision.definition->>'templateId',revision.definition->>'template_id')='appointment-setting'
                union
                select assignment.relationship_id from public.appointment_setting_setup_assignees assignment
                where assignment.workspace_id=p_workspace_id and assignment.user_id=p_user_id
                  and (exists(select 1 from public.relationship_service_instances instance
                    join public.onboarding_service_revisions revision on revision.workspace_id=instance.workspace_id and revision.id=instance.service_revision_id
                    where instance.workspace_id=p_workspace_id and instance.relationship_id=assignment.relationship_id
                      and instance.import_id is null and instance.disposition<>'cancelled'
                      and coalesce(revision.definition->>'templateId',revision.definition->>'template_id')='appointment-setting')
                  or exists(select 1 from public.relationship_services service
                    join public.onboarding_service_revisions revision on revision.workspace_id=service.workspace_id and revision.id=service.service_revision_id
                    where service.workspace_id=p_workspace_id and service.relationship_id=assignment.relationship_id
                      and coalesce(revision.definition->>'templateId',revision.definition->>'template_id')='appointment-setting'))
            )$new$;
 list_start:=position('        return coalesce((' in definition);
 list_end:=position('        ), ''[]''::jsonb);' in substring(definition from list_start));
 if list_start=0 or list_end=0 or position('    if p_action = ''list'' then' in definition)=0 then raise exception 'Unexpected client connection list shape'; end if;
 list_query:=substring(definition from list_start for list_end+length('        ), ''[]''::jsonb);')-1);
 if position(old_cte in list_query)=0 or position('where v_role in (''owner'',''admin'') or '||old_clause in list_query)=0 then raise exception 'Unexpected client connection eligibility'; end if;
 list_query:=replace(replace(list_query,old_cte,actor_cte),'where v_role in (''owner'',''admin'') or '||old_clause,'');
 definition:=replace(definition,'    if p_action = ''list'' then',E'    if p_action = ''list'' and v_role not in (''owner'',''admin'') then\n'||list_query||E'\n    end if;\n\n    if p_action = ''list'' then');
 old_clause:=$old$exists (
        select 1 from public.appointment_setting_setup_assignees assignment
        where assignment.workspace_id=p_workspace_id and assignment.relationship_id=p_relationship_id and assignment.user_id=p_user_id
    )$old$;
 if position(old_clause in definition)=0 then raise exception 'Unexpected client connection command grant'; end if;
 -- Existing explicit grants retain their fast path; only a derived grant needs
 -- the additional scoped service check before touching credentials or leases.
 execute replace(definition,old_clause,'('||old_clause||' or public.service_assignee_can_setup_client(p_workspace_id,p_user_id,p_relationship_id))');
end $$;

create table public.service_assignee_transfer_receipts (
 workspace_id uuid not null references public.workspaces(id), request_id uuid not null,
 actor_user_id uuid not null references auth.users(id), instance_id uuid not null,
 input jsonb not null, result jsonb not null, created_at timestamptz not null default now(),
 primary key(workspace_id,request_id),
 foreign key(workspace_id,instance_id) references public.relationship_service_instances(workspace_id,id)
);
alter table public.service_assignee_transfer_receipts enable row level security;
revoke all on public.service_assignee_transfer_receipts from public,anon,authenticated,service_role;
create trigger immutable_history before update or delete on public.service_assignee_transfer_receipts
for each row execute function public.reject_service_instance_history_change();

create function public.preview_service_assignee_transfer(p_workspace uuid,p_relationship uuid,p_instance uuid,p_actor uuid,p_recipient uuid)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare i relationship_service_instances; ids uuid[]; items jsonb; result jsonb; appointment boolean; former_role text;
begin
 if not exists(select 1 from workspace_memberships m join workspaces w on w.id=m.workspace_id and w.status='active'
 where m.workspace_id=p_workspace and m.user_id=p_actor and m.role in ('owner','admin')) then raise exception 'Owner or admin required.'; end if;
 select * into i from relationship_service_instances where workspace_id=p_workspace and relationship_id=p_relationship and id=p_instance;
 if i.id is null or i.import_id is not null or i.disposition<>'active' or i.stage not in ('onboarding','setup','maintenance')
 or not exists(select 1 from relationships where workspace_id=p_workspace and id=p_relationship and status<>'archived') then raise exception 'Choose an active delivery service.'; end if;
 if p_recipient is null or p_recipient is not distinct from i.assignee_user_id or not exists(
 select 1 from workspace_memberships m join workspace_member_service_access a using(workspace_id,user_id)
 where m.workspace_id=p_workspace and m.user_id=p_recipient and a.service_id=i.service_id) then raise exception 'Choose a different eligible service assignee.'; end if;
 select array_agg(work_item_id order by work_item_id) into ids from (
 select work_item_id from service_instance_work_items where workspace_id=p_workspace and instance_id=p_instance order by work_item_id limit 201) x;
 if coalesce(cardinality(ids),0)>200 then raise exception 'This service has more than 200 linked records. A reviewed bulk transfer is required.'; end if;
 select coalesce(jsonb_agg(to_jsonb(x) order by x.id),'[]') into items from (
 select w.id,w.title,w.status,w.updated_at,w.execution_owner_id,w.service_id,w.visibility,w.workflow_role,
 coalesce((select jsonb_agg(a.user_id order by a.user_id) from work_item_assignees a where a.workspace_id=p_workspace and a.work_item_id=w.id),'[]') assignees,
 (select count(*) from service_instance_work_items l where l.workspace_id=p_workspace and l.work_item_id=w.id)>1
 or exists(select 1 from work_item_relationships l where l.workspace_id=p_workspace and l.work_item_id=w.id and l.relationship_id<>p_relationship) shared,
 w.status not in ('done','canceled') and w.metadata->>'archived_at' is null
 and coalesce(w.workflow_role,'') not in ('service_group','lifecycle_stage')
 and w.service_id=i.service_id and w.visibility<>'admins_only'
 and exists(select 1 from work_item_relationships l where l.workspace_id=p_workspace and l.work_item_id=w.id and l.relationship_id=p_relationship)
 and (select count(*) from service_instance_work_items l where l.workspace_id=p_workspace and l.work_item_id=w.id)=1
 and not exists(select 1 from work_item_relationships l where l.workspace_id=p_workspace and l.work_item_id=w.id and l.relationship_id<>p_relationship) movable
 from work_items w where w.workspace_id=p_workspace and w.id=any(coalesce(ids,'{}'::uuid[]))) x;
 select coalesce(v.definition->>'templateId',v.definition->>'template_id')='appointment-setting' into appointment
 from onboarding_service_revisions v where v.workspace_id=p_workspace and v.id=i.service_revision_id;
 former_role:=workspace_role_for_user(p_workspace,i.assignee_user_id);
 result:=jsonb_build_object('instanceId',i.id,'version',i.version,'stage',i.stage,'formerId',i.assignee_user_id,'recipientId',p_recipient,
 'formerName',case when i.assignee_user_id is null then 'Unassigned' else coalesce((select coalesce(nullif(display_name,''),nullif(username,'')) from user_profiles where user_id=i.assignee_user_id),'Workspace member') end,
 'recipientName',coalesce((select coalesce(nullif(display_name,''),nullif(username,'')) from user_profiles where user_id=p_recipient),'Workspace member'),
 'items',items,'appointment',coalesce(appointment,false),
 'bookingEnabled',not coalesce(appointment,false) or exists(select 1 from workspace_service_capabilities where workspace_id=p_workspace and service_id=i.service_id and capability='appointment_setting.manage') or workspace_role_for_user(p_workspace,p_recipient) in ('owner','admin'),
 -- Check the current canonical grant, then require an independent source that
 -- survives this instance's reassignment. Another service needs its own eligibility.
 'formerSetupRetained',coalesce(service_assignee_can_setup_client(p_workspace,i.assignee_user_id,p_relationship)
 and (former_role in ('owner','admin')
 or exists(select 1 from appointment_setting_setup_assignees where workspace_id=p_workspace and relationship_id=p_relationship and user_id=i.assignee_user_id)
 or exists(select 1 from relationship_service_instances other join onboarding_service_revisions v on v.workspace_id=other.workspace_id and v.id=other.service_revision_id
 join workspace_member_service_access e on e.workspace_id=other.workspace_id and e.service_id=other.service_id and e.user_id=i.assignee_user_id
 where other.workspace_id=p_workspace and other.relationship_id=p_relationship and other.id<>i.id and other.assignee_user_id=i.assignee_user_id
 and other.import_id is null and other.disposition='active' and other.stage in ('onboarding','setup','maintenance')
 and coalesce(v.definition->>'templateId',v.definition->>'template_id')='appointment-setting')),false),
 'formerBookingRetained',coalesce(workspace_user_can_manage_appointment_setting(p_workspace,p_relationship,i.service_id,i.assignee_user_id)
 and (former_role in ('owner','admin') or exists(select 1 from relationship_service_instances other
 join onboarding_service_revisions v on v.workspace_id=other.workspace_id and v.id=other.service_revision_id
 where other.workspace_id=p_workspace and other.relationship_id=p_relationship and other.id<>i.id and other.service_id=i.service_id
 and other.assignee_user_id=i.assignee_user_id and other.import_id is null and other.disposition='active' and other.stage in ('setup','maintenance')
 and coalesce(v.definition->>'templateId',v.definition->>'template_id')='appointment-setting')),false),
 'teamMembershipRetained',true);
 return result||jsonb_build_object('fingerprint',md5(result::text));
end $$;

create function public.transfer_service_assignee(p_workspace uuid,p_relationship uuid,p_instance uuid,p_actor uuid,p_request uuid,p_input jsonb)
returns jsonb language plpgsql security definer set search_path=public set lock_timeout='5s' set statement_timeout='15s' as $$
declare preview jsonb; receipt service_assignee_transfer_receipts; i relationship_service_instances; selected uuid[]; work_id uuid; result jsonb; receipt_checked boolean:=false;
begin
 if p_request is null or p_input is null or jsonb_typeof(p_input->'workIds') is distinct from 'array'
 or length(btrim(p_input->>'reason')) not between 1 and 1000 or p_input->>'reason' is null then raise exception 'A request ID, work selection and reason are required.'; end if;
 if not exists(select 1 from workspace_memberships m join workspaces w on w.id=m.workspace_id and w.status='active'
 where m.workspace_id=p_workspace and m.user_id=p_actor and m.role in ('owner','admin')) then raise exception 'Owner or admin required.'; end if;
 perform pg_advisory_xact_lock(hashtextextended('service-transfer:'||p_workspace::text||':'||p_request::text,0));
 select * into receipt from service_assignee_transfer_receipts where workspace_id=p_workspace and request_id=p_request;
 if found then
 if (receipt.actor_user_id,receipt.instance_id,receipt.input) is distinct from (p_actor,p_instance,p_input)
 or receipt.result->>'relationshipId' is distinct from p_relationship::text then raise exception 'Request ID reused with different input.'; end if;
 return receipt.result;
 end if;
 receipt_checked:=true;
 -- Same relationship-first ordering as work publication and service chat ownership.
 perform 1 from relationships where workspace_id=p_workspace and id=p_relationship for update;
 -- A legacy command may already own the instance and be waiting for this
 -- relationship. Yield this new transfer instead of waiting on that cycle.
 select * into i from relationship_service_instances where workspace_id=p_workspace and relationship_id=p_relationship and id=p_instance for update nowait;
 -- Preview bounds apply before acquiring any work locks.
 preview:=preview_service_assignee_transfer(p_workspace,p_relationship,p_instance,p_actor,(p_input->>'recipientId')::uuid);
 perform 1 from workspace_memberships where workspace_id=p_workspace and user_id in (p_actor,(p_input->>'recipientId')::uuid) order by user_id for share;
 perform 1 from workspace_member_service_access where workspace_id=p_workspace and service_id=i.service_id and user_id=(p_input->>'recipientId')::uuid for share;
 perform 1 from work_items where workspace_id=p_workspace and id in(select (x->>'id')::uuid from jsonb_array_elements(preview->'items') x) order by id for update;
 perform 1 from work_item_assignees where workspace_id=p_workspace and work_item_id in(select (x->>'id')::uuid from jsonb_array_elements(preview->'items') x) order by work_item_id,user_id for update;
 preview:=preview_service_assignee_transfer(p_workspace,p_relationship,p_instance,p_actor,(p_input->>'recipientId')::uuid);
 if preview->>'fingerprint' is distinct from p_input->>'fingerprint' then raise exception 'The service, work or access changed. Review a fresh preview.'; end if;
 if preview->>'bookingEnabled'='false' then raise exception 'Enable Appointment Setting booking permission for this service before transferring.'; end if;
 select coalesce(array_agg(value::uuid),'{}') into selected from jsonb_array_elements_text(p_input->'workIds');
 if cardinality(selected)>200 or cardinality(selected)<>(select count(distinct x) from unnest(selected) x)
 or exists(select 1 from unnest(selected) id where not exists(select 1 from jsonb_array_elements(preview->'items') x where (x->>'id')::uuid=id and x->>'movable'='true')) then raise exception 'Select only the transferable work in this preview.'; end if;
 perform change_service_instance(p_workspace,p_instance,p_actor,p_request,i.version,i.stage,i.disposition,(p_input->>'recipientId')::uuid,btrim(p_input->>'reason'));
 if exists(select 1 from jsonb_array_elements(preview->'items') x where x->>'movable'='true'
 and x->>'execution_owner_id' is null and x->'assignees'='[]'::jsonb and not ((x->>'id')::uuid=any(selected))) then
 raise exception 'Work inheriting this service responsibility must be included in the transfer.'; end if;
 foreach work_id in array selected loop
 update work_items set execution_owner_id=(p_input->>'recipientId')::uuid where workspace_id=p_workspace and id=work_id;
 -- Other collaborators stay assigned. The former service assignee is the only removed collaborator.
 delete from work_item_assignees where workspace_id=p_workspace and work_item_id=work_id and user_id=i.assignee_user_id;
 if not workspace_user_can_access_work_item(p_workspace,work_id,(p_input->>'recipientId')::uuid)
 or not personal_queue_owns(p_workspace,work_id,(p_input->>'recipientId')::uuid) then raise exception 'The recipient cannot use the selected work. No transfer was saved.'; end if;
 end loop;
 if preview->>'appointment'='true' and (not service_assignee_can_setup_client(p_workspace,(p_input->>'recipientId')::uuid,p_relationship)
 or i.stage in ('setup','maintenance') and not workspace_user_can_manage_appointment_setting(p_workspace,p_relationship,i.service_id,(p_input->>'recipientId')::uuid)) then raise exception 'The recipient cannot use bookings and setup. No transfer was saved.'; end if;
 result:=jsonb_build_object('relationshipId',p_relationship,'instanceId',i.id,'version',i.version+1,'workIds',to_jsonb(selected),'recipientId',p_input->>'recipientId','preview',preview);
 insert into service_assignee_transfer_receipts(workspace_id,request_id,actor_user_id,instance_id,input,result) values(p_workspace,p_request,p_actor,i.id,p_input,result);
 return result;
exception when deadlock_detected or lock_not_available then
 if not receipt_checked then
  -- A retry that could not acquire its request lock cannot disprove completion
  -- by the original attempt. Keep that request's identity for receipt recovery.
  raise exception 'Another attempt may still be finishing. Retry this same transfer.' using errcode='BT001';
 end if;
 -- This boundary rolls back every earlier write, including trigger effects.
 -- Shared downstream locks can still conflict even when the instance was free.
 raise exception 'Service busy. No transfer was saved. Reload preview.' using errcode='P0001';
end $$;
revoke all on function public.current_appointment_service_assignments(uuid,uuid),public.service_assignee_can_setup_client(uuid,uuid,uuid),public.read_assigned_appointment_services(uuid,uuid,uuid),public.preview_service_assignee_transfer(uuid,uuid,uuid,uuid,uuid),public.transfer_service_assignee(uuid,uuid,uuid,uuid,uuid,jsonb) from public,anon,authenticated;
revoke all on function public.current_appointment_service_assignments(uuid,uuid) from service_role;
grant execute on function public.service_assignee_can_setup_client(uuid,uuid,uuid),public.read_assigned_appointment_services(uuid,uuid,uuid),public.preview_service_assignee_transfer(uuid,uuid,uuid,uuid,uuid),public.transfer_service_assignee(uuid,uuid,uuid,uuid,uuid,jsonb) to service_role;
notify pgrst,'reload schema';
commit;
