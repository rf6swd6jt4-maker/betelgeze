begin;
set local lock_timeout='5s';
set local statement_timeout='60s';

-- A plain transfer never re-evaluated the former assignee's Team chat
-- membership: ensure_active_service_fulfilment_chat is additive-only, and
-- sync_service_queue_lifecycle only fires when the opt-in Shared Service
-- Assignees roster already exists for that instance. This mirrors the
-- eligibility chain sync_service_queue_chat already uses for its own sweep
-- (shared-service-queue migration), generalized to one named user instead of
-- a tagged-roster join, with an optional excluded instance for preview-time
-- checks where the instance's own reassignment has not happened yet.
create function public.service_assignee_chat_membership_justified(
 p_workspace uuid, p_relationship uuid, p_user uuid, p_exclude_instance uuid default null
) returns boolean
language sql stable security definer set search_path=public as $$
 select p_user is not null and (
  exists(select 1 from service_queue_members a
   join relationship_service_instances i on i.id=a.instance_id and i.workspace_id=a.workspace_id
   where i.workspace_id=p_workspace and i.relationship_id=p_relationship and a.user_id=p_user
   and i.disposition<>'cancelled' and (p_exclude_instance is null or i.id<>p_exclude_instance)
   and service_queue_is_member(p_workspace,i.id,a.user_id))
  or exists(select 1 from relationship_service_instances i
   where i.workspace_id=p_workspace and i.relationship_id=p_relationship and i.assignee_user_id=p_user
   and i.disposition='active' and i.stage in ('onboarding','setup','maintenance')
   and (p_exclude_instance is null or i.id<>p_exclude_instance))
  or exists(select 1 from relationship_services s
   where s.workspace_id=p_workspace and s.relationship_id=p_relationship and s.assignee_user_id=p_user)
  or exists(select 1 from relationships r
   where r.workspace_id=p_workspace and r.id=p_relationship and p_user in (r.seller_user_id,r.fulfilment_manager_user_id))
 )
$$;

-- Identical to supabase/migrations/20261005220000_service_assignee_transfer.sql:152-205
-- except the final 'teamMembershipRetained' key, which now mirrors the
-- formerSetupRetained/formerBookingRetained instance-exclusion pattern
-- already in this function instead of a hardcoded literal.
create or replace function public.preview_service_assignee_transfer(p_workspace uuid,p_relationship uuid,p_instance uuid,p_actor uuid,p_recipient uuid)
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
 'teamMembershipRetained',i.assignee_user_id is null
 or service_assignee_chat_membership_justified(p_workspace,p_relationship,i.assignee_user_id,i.id));
 return result||jsonb_build_object('fingerprint',md5(result::text));
end $$;

-- Identical to supabase/migrations/20261005220000_service_assignee_transfer.sql:207-265
-- except the chat-membership cleanup added right after change_service_instance
-- commits the new assignee. This runs inside the same transaction/locks as the
-- rest of the transfer, so any later exception still rolls it back; i.assignee_user_id
-- is the pre-update value already captured by the earlier `for update nowait` select.
-- Only the one person just replaced as assignee is ever touched: independent/manual
-- Team chat members and everyone else are never inspected or removed.
create or replace function public.transfer_service_assignee(p_workspace uuid,p_relationship uuid,p_instance uuid,p_actor uuid,p_request uuid,p_input jsonb)
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
 if i.assignee_user_id is not null and i.assignee_user_id is distinct from (p_input->>'recipientId')::uuid
 and not service_assignee_chat_membership_justified(p_workspace,p_relationship,i.assignee_user_id) then
 delete from workspace_team_members m using workspace_teams t
 where t.workspace_id=p_workspace and t.relationship_id=p_relationship and m.team_id=t.id and m.user_id=i.assignee_user_id;
 -- Defensive bookkeeping only: a primary assignee's membership is never tagged
 -- by the shared-queue feature, but keep provenance honest if it ever coincides.
 delete from service_queue_chat_members c using workspace_teams t
 where t.workspace_id=p_workspace and t.relationship_id=p_relationship and c.team_id=t.id and c.user_id=i.assignee_user_id;
 end if;
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

revoke all on function public.service_assignee_chat_membership_justified(uuid,uuid,uuid,uuid),public.preview_service_assignee_transfer(uuid,uuid,uuid,uuid,uuid),public.transfer_service_assignee(uuid,uuid,uuid,uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.service_assignee_chat_membership_justified(uuid,uuid,uuid,uuid),public.preview_service_assignee_transfer(uuid,uuid,uuid,uuid,uuid),public.transfer_service_assignee(uuid,uuid,uuid,uuid,uuid,jsonb) to service_role;
notify pgrst,'reload schema';
commit;
