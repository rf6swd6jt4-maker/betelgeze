-- Give service reviews an explicit scope when one service owns the module.
-- Shared reviews retain a null scope and use their exact instance/module links.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';

do $migration$
declare
  definition text;
  previous_columns text := 'work_items(workspace_id,title,description,lifecycle_phase,status,priority,native_kind,native_key,workflow_role,metadata,created_by)';
  scoped_columns text := 'work_items(workspace_id,service_id,title,description,lifecycle_phase,status,priority,native_kind,native_key,workflow_role,metadata,created_by)';
  previous_values text := $old$values(p_workspace_id,'Review: '||step.title$old$;
  scoped_values text := $new$values(p_workspace_id,(
    select case when count(distinct instance.service_id)=1 then min(instance.service_id::text)::uuid end
    from public.service_instance_module_requirements requirement
    join public.relationship_service_instances instance on instance.workspace_id=requirement.workspace_id and instance.id=requirement.instance_id
    where requirement.workspace_id=p_workspace_id and requirement.session_id=s.id
      and requirement.session_module_id=step.session_module_id and requirement.review_required
      and instance.import_id is null and instance.disposition<>'cancelled'
  ),'Review: '||step.title$new$;
begin
  select pg_get_functiondef('public.refresh_service_onboarding_readiness(uuid,uuid)'::regprocedure) into definition;
  if length(definition)-length(replace(definition,previous_columns,''))<>length(previous_columns)
     or length(definition)-length(replace(definition,previous_values,''))<>length(previous_values) then
    raise exception 'Unexpected onboarding review generator definition';
  end if;
  execute replace(replace(definition,previous_columns,scoped_columns),previous_values,scoped_values);
end $migration$;

-- A shared review can cover several services, so no single service_id can
-- describe it. Authorize the current assignee only through the review's
-- matching relationship, instance, session, and reviewed module.
create or replace function public.workspace_user_can_access_work_item(p_workspace_id uuid,p_work_item_id uuid,p_user_id uuid default auth.uid()) returns boolean
language sql stable security definer set search_path=public as $$
 select exists(select 1 from public.work_items i join public.workspace_memberships m on m.workspace_id=i.workspace_id and m.user_id=p_user_id
 where i.workspace_id=p_workspace_id and i.id=p_work_item_id and (m.role in ('owner','admin') or (i.visibility='workspace' and i.area <> 'admin' and (
 exists(select 1 from public.service_instance_work_items il
 join public.relationship_service_instances si on si.workspace_id=il.workspace_id and si.id=il.instance_id
 join public.work_item_relationships ir on ir.workspace_id=il.workspace_id and ir.work_item_id=il.work_item_id and ir.relationship_id=si.relationship_id
 where il.workspace_id=p_workspace_id and il.work_item_id=i.id and si.assignee_user_id=p_user_id
 and si.import_id is null and si.disposition<>'cancelled' and (
   si.service_id is not distinct from i.service_id
   or (i.service_id is null and i.native_kind='relationship_workflow' and i.workflow_role='review'
     and i.native_key=(i.metadata->>'session_id')||':service-review:'||(i.metadata->>'session_step_id')
     and exists(select 1 from public.relationship_onboarding_session_steps step
       join public.service_instance_module_requirements requirement
         on requirement.workspace_id=step.workspace_id and requirement.session_module_id=step.session_module_id
       where step.workspace_id=p_workspace_id and step.id::text=i.metadata->>'session_step_id'
         and step.session_id::text=i.metadata->>'session_id'
         and requirement.session_id=step.session_id and requirement.instance_id=si.id and requirement.review_required))
 ))
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
