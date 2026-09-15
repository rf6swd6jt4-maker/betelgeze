-- Recognize current service assignments in the shared visibility check used by
-- personal queues, relationship work and instruction/detail reads.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';
create or replace function public.workspace_user_can_access_work_item(p_workspace_id uuid,p_work_item_id uuid,p_user_id uuid default auth.uid()) returns boolean
language sql stable security definer set search_path=public as $$
 select exists(select 1 from public.work_items i join public.workspace_memberships m on m.workspace_id=i.workspace_id and m.user_id=p_user_id
 where i.workspace_id=p_workspace_id and i.id=p_work_item_id and (m.role in ('owner','admin') or (i.visibility='workspace' and i.area <> 'admin' and (
 -- Current service-instance assignment grants access to that instance's linked work only.
 exists(select 1 from public.service_instance_work_items il
 join public.relationship_service_instances si on si.workspace_id=il.workspace_id and si.id=il.instance_id
 join public.work_item_relationships ir on ir.workspace_id=il.workspace_id and ir.work_item_id=il.work_item_id and ir.relationship_id=si.relationship_id
 where il.workspace_id=p_workspace_id and il.work_item_id=i.id and si.assignee_user_id=p_user_id
 and si.import_id is null and si.disposition<>'cancelled' and si.service_id is not distinct from i.service_id)
 or exists(
 select 1 from public.work_item_relationships l join public.relationships r on r.id=l.relationship_id and r.workspace_id=l.workspace_id
 where l.workspace_id=p_workspace_id and l.work_item_id=i.id and (
 r.fulfilment_manager_user_id=p_user_id or r.seller_user_id=p_user_id
 or exists(select 1 from public.relationship_services s where s.workspace_id=p_workspace_id and s.relationship_id=r.id and s.assignee_user_id=p_user_id
 and (s.service_id=i.service_id or (i.service_id is null and i.native_kind='onboarding_step' and case when coalesce(i.metadata->>'session_step_id','') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then public.workspace_user_can_access_session_step(p_workspace_id,(i.metadata->>'session_step_id')::uuid,p_user_id) else false end)))
 or (i.service_id is null and public.workspace_user_fully_covers_relationship(p_workspace_id,r.id,p_user_id))))))))
$$;
notify pgrst,'reload schema';
commit;
