-- SS-02 revision: service lifecycles in the existing relationship chart.
-- Read-only projections; no workflow, assignment or historical-date backfill.
begin;
create function public.read_relationship_service_plan(p_workspace_id uuid,p_relationship_id uuid,p_user_id uuid,p_offset integer default 0) returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare services jsonb; ids uuid[]; work_ids uuid[]; work_rows jsonb; events jsonb; edges jsonb; links jsonb;
begin
 if not public.workspace_user_can_access_relationship(p_workspace_id,p_relationship_id,p_user_id) then raise exception 'Relationship access required'; end if;
 if p_offset<0 or p_offset>10000 then raise exception 'Invalid page'; end if;
 select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at,x.id),'[]') into services from (
  select * from public.relationship_service_rows(p_workspace_id,p_relationship_id,p_user_id) order by created_at,id limit 31 offset p_offset
 ) x;
 select coalesce(array_agg((x->>'id')::uuid),'{}') into ids from jsonb_array_elements(services) with ordinality s(x,n) where n<=30 and not (x->>'legacy')::boolean;
 -- Latest recorded visit to each stage, omitting assignment-only audit events.
 with transitions as (
  select instance_id,new_stage,created_at,version,lead(created_at) over(partition by instance_id order by version) ended_at
  from public.service_instance_stage_events where workspace_id=p_workspace_id and instance_id=any(ids) and old_stage is distinct from new_stage
 ), latest as (select distinct on(instance_id,new_stage) * from transitions order by instance_id,new_stage,version desc)
 select coalesce(jsonb_agg(to_jsonb(latest)),'[]') into events from latest;
 -- Bounded, relationship-local graph. The queue has an independent paged query.
 select coalesce(array_agg(x.id),'{}') into work_ids from (
  select w.id from public.work_item_relationships l join public.work_items w on w.workspace_id=l.workspace_id and w.id=l.work_item_id
  where l.workspace_id=p_workspace_id and l.relationship_id=p_relationship_id and public.workspace_user_can_access_work_item(p_workspace_id,w.id,p_user_id)
  order by w.created_at,w.id limit 501
 ) x;
 select coalesce(jsonb_agg(jsonb_build_object(
  'id',w.id,'title',w.title,'status',w.status,'lifecycle_phase',w.lifecycle_phase,'workflow_role',w.workflow_role,'workflow_action',w.workflow_action,
  'parent_work_item_id',w.parent_work_item_id,'planned_start_date',w.planned_start_date,'planned_start_time',w.planned_start_time,
  'due_date',w.due_date,'due_time',w.due_time,'actual_start_at',w.actual_start_at,'actual_start_has_time',w.actual_start_has_time,
  'actual_completed_at',w.actual_completed_at,'actual_completed_has_time',w.actual_completed_has_time,'sort_order',w.sort_order,
  'created_at',w.created_at,'updated_at',w.updated_at,'service_id',w.service_id,'native_key',w.native_key,
  'shared',exists(select 1 from public.work_item_relationships other where other.workspace_id=p_workspace_id and other.work_item_id=w.id and other.relationship_id<>p_relationship_id),
  'assignees',coalesce((select jsonb_agg(jsonb_build_object('userId',a.user_id,'username',coalesce(u.display_name,u.username,'Workspace member'),'avatarUrl',null)) from public.work_item_assignees a left join public.user_profiles u on u.user_id=a.user_id where a.workspace_id=p_workspace_id and a.work_item_id=w.id),'[]')
 ) order by w.created_at,w.id),'[]') into work_rows from public.work_items w where w.workspace_id=p_workspace_id and w.id=any(work_ids[1:500]);
 select coalesce(jsonb_agg(to_jsonb(x)),'[]') into edges from (
  select d.work_item_id,d.depends_on_work_item_id,d.source,coalesce(p.status in ('done','canceled'),false) depends_on_completed
  from public.work_item_dependencies d left join public.work_items p on p.workspace_id=d.workspace_id and p.id=d.depends_on_work_item_id
  where d.workspace_id=p_workspace_id and d.work_item_id=any(work_ids[1:500]) order by d.work_item_id,d.depends_on_work_item_id limit 5001
 ) x;
 select coalesce(jsonb_agg(jsonb_build_object('instance_id',instance_id,'work_item_id',work_item_id)),'[]') into links
 from public.service_instance_work_items where workspace_id=p_workspace_id and work_item_id=any(work_ids[1:500]) and instance_id=any(ids);
 return jsonb_build_object('services',services,'events',events,'work',work_rows,'dependencies',edges,'links',links,'workTruncated',cardinality(work_ids)>500 or jsonb_array_length(edges)>5000);
end $$;

create function public.read_relationship_work_queue(p_workspace_id uuid,p_relationship_id uuid,p_user_id uuid,p_offset integer default 0) returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare result jsonb;
begin
 if not public.workspace_user_can_access_relationship(p_workspace_id,p_relationship_id,p_user_id) then raise exception 'Relationship access required'; end if;
 if p_offset<0 or p_offset>10000 then raise exception 'Invalid page'; end if;
 with candidates as (
  select w.id,w.title,w.status,w.workflow_action,w.due_date,w.planned_start_date,w.updated_at,w.created_at,w.priority,
   exists(select 1 from public.work_item_dependencies d left join public.work_items p on p.workspace_id=d.workspace_id and p.id=d.depends_on_work_item_id where d.workspace_id=p_workspace_id and d.work_item_id=w.id and (p.id is null or p.status not in ('done','canceled'))) blocked,
   (select coalesce(jsonb_agg(jsonb_build_object('userId',a.user_id,'username',coalesce(u.display_name,u.username,'Workspace member'),'avatarUrl',null)),'[]') from public.work_item_assignees a left join public.user_profiles u on u.user_id=a.user_id where a.workspace_id=p_workspace_id and a.work_item_id=w.id) assignees
  from public.work_item_relationships l join public.work_items w on w.workspace_id=l.workspace_id and w.id=l.work_item_id
  where l.workspace_id=p_workspace_id and l.relationship_id=p_relationship_id and w.status not in ('done','canceled')
   and public.workspace_user_can_access_work_item(p_workspace_id,w.id,p_user_id)
   and (w.workflow_role not in ('lifecycle_stage','service_group') or w.workflow_action in ('sell_client','await_payment','await_onboarding','move_to_potential_client','begin_fulfilment','begin_retention'))
 ), ordered as (
  select *,case when blocked or status='blocked' then 'Blocked' when status='waiting' or workflow_action in ('await_payment','await_onboarding') then 'Waiting'
    when planned_start_date>current_date then 'Scheduled' when status='doing' then 'In progress' else 'Ready' end queue_state
  from candidates
 ), page as (
  select * from ordered order by case queue_state when 'Ready' then 0 when 'In progress' then 0 when 'Scheduled' then 1 when 'Waiting' then 2 else 3 end,
   due_date nulls last,case when status='doing' then 0 else 1 end,priority,created_at,id limit 31 offset p_offset
 )
 select jsonb_build_object('items',coalesce(jsonb_agg(to_jsonb(page)),'[]'),'hasMore',count(*)>30) into result from page;
 return result;
end $$;
revoke all on function public.read_relationship_service_plan(uuid,uuid,uuid,integer),public.read_relationship_work_queue(uuid,uuid,uuid,integer) from public,anon,authenticated;
grant execute on function public.read_relationship_service_plan(uuid,uuid,uuid,integer),public.read_relationship_work_queue(uuid,uuid,uuid,integer) to service_role;
notify pgrst,'reload schema';
commit;
