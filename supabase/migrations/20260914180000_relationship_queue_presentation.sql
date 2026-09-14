-- Add bounded display metadata to the existing relationship work queue read.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

create or replace function public.read_relationship_work_queue(p_workspace_id uuid,p_relationship_id uuid,p_user_id uuid,p_offset integer default 0) returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare result jsonb;
begin
 if not public.workspace_user_can_access_relationship(p_workspace_id,p_relationship_id,p_user_id) then raise exception 'Relationship access required'; end if;
 if p_offset<0 or p_offset>10000 then raise exception 'Invalid page'; end if;
 with candidates as (
  select w.id,w.title,w.status,w.workflow_action,w.due_date,w.planned_start_date,w.updated_at,w.created_at,w.priority,
   exists(select 1 from public.work_item_dependencies d left join public.work_items p on p.workspace_id=d.workspace_id and p.id=d.depends_on_work_item_id where d.workspace_id=p_workspace_id and d.work_item_id=w.id and (p.id is null or p.status not in ('done','canceled'))) blocked,
   (select coalesce(jsonb_agg(jsonb_build_object('userId',a.user_id,'username',coalesce(u.display_name,u.username,'Workspace member'),'avatarUrl',null)),'[]') from public.work_item_assignees a left join public.user_profiles u on u.user_id=a.user_id where a.workspace_id=p_workspace_id and a.work_item_id=w.id) assignees,
   coalesce((select jsonb_agg(name order by name) from (
    select distinct coalesce(v.name,i.service_key) name
    from public.service_instance_work_items l
    join public.relationship_service_instances i on i.workspace_id=l.workspace_id and i.id=l.instance_id and i.relationship_id=p_relationship_id
    left join public.onboarding_service_revisions v on v.workspace_id=i.workspace_id and v.id=i.service_revision_id
    where l.workspace_id=p_workspace_id and l.work_item_id=w.id
    union
    select coalesce((select revision.name from public.onboarding_service_revisions revision where revision.workspace_id=s.workspace_id and revision.service_id=s.id order by revision.revision_number desc limit 1),s.internal_code)
    from public.onboarding_services s
    where s.workspace_id=p_workspace_id and s.id=w.service_id
     and not exists(select 1 from public.service_instance_work_items l where l.workspace_id=p_workspace_id and l.work_item_id=w.id)
   ) labels),'[]'::jsonb) services,
   w.native_kind='relationship_workflow' and w.metadata ? 'sop_work_run_id' automated,
   case when w.created_by is null then null else jsonb_build_object('userId',w.created_by,'username',coalesce(creator.display_name,creator.username,'Workspace member'),'avatarUrl',null) end creator
  from public.work_item_relationships l
  join public.work_items w on w.workspace_id=l.workspace_id and w.id=l.work_item_id
  left join public.user_profiles creator on creator.user_id=w.created_by
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

revoke all on function public.read_relationship_work_queue(uuid,uuid,uuid,integer) from public,anon,authenticated;
grant execute on function public.read_relationship_work_queue(uuid,uuid,uuid,integer) to service_role;
notify pgrst,'reload schema';
commit;
