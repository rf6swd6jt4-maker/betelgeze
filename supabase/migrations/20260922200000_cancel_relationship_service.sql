begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- A service and its unfinished, exclusively owned work leave active queues together.
-- Shared work needs an explicit reassignment before this command can proceed.
create function public.cancel_relationship_service(
    p_workspace_id uuid, p_relationship_id uuid, p_instance_id uuid,
    p_actor_user_id uuid, p_request_id uuid, p_expected_version integer, p_reason text
) returns jsonb language plpgsql security definer set search_path = public as $$
declare instance public.relationship_service_instances%rowtype; canceled_count integer;
begin
    if p_request_id is null or p_expected_version is null or length(btrim(coalesce(p_reason, ''))) not between 1 and 1000 then
        raise exception 'A request ID, current version and reason are required';
    end if;
    select * into instance from public.relationship_service_instances
    where workspace_id = p_workspace_id and relationship_id = p_relationship_id and id = p_instance_id for update;
    if instance.id is null or instance.import_id is not null then raise exception 'Service not found'; end if;
    if not public.can_manage_relationship_service(p_workspace_id, p_relationship_id, p_actor_user_id, instance.origin) then
        raise exception 'Service editing access required';
    end if;
    if instance.disposition = 'cancelled' and instance.change_request_id = p_request_id then
        if instance.version <> p_expected_version + 1 or instance.change_reason <> btrim(p_reason) then
            raise exception 'Request ID reused with different input';
        end if;
        return jsonb_build_object('version', instance.version, 'idempotent', true);
    end if;
    if instance.disposition <> 'active' or instance.version <> p_expected_version then
        raise exception 'Service changed; reload before cancelling';
    end if;
    if exists (
        select 1 from public.service_instance_work_items link
        join public.work_items work on work.workspace_id = link.workspace_id and work.id = link.work_item_id
        where link.workspace_id = p_workspace_id and link.instance_id = p_instance_id
          and work.status not in ('done', 'canceled')
          and (
              exists (select 1 from public.service_instance_work_items other
                  where other.workspace_id = link.workspace_id and other.work_item_id = link.work_item_id and other.instance_id <> p_instance_id)
              or exists (select 1 from public.work_item_relationships other
                  where other.workspace_id = link.workspace_id and other.work_item_id = link.work_item_id and other.relationship_id <> p_relationship_id)
          )
    ) then raise exception 'This service has shared open work. Reassign that work before cancelling.'; end if;

    perform public.change_service_instance(p_workspace_id, p_instance_id, p_actor_user_id, p_request_id,
        p_expected_version, instance.stage, 'cancelled', instance.assignee_user_id, btrim(p_reason));
    update public.work_items work set status = 'canceled', updated_at = now()
    where work.workspace_id = p_workspace_id and work.status not in ('done', 'canceled')
      and exists (select 1 from public.service_instance_work_items link
          where link.workspace_id = p_workspace_id and link.instance_id = p_instance_id and link.work_item_id = work.id);
    get diagnostics canceled_count = row_count;
    return jsonb_build_object('version', p_expected_version + 1, 'canceledWork', canceled_count);
end $$;

revoke all on function public.cancel_relationship_service(uuid,uuid,uuid,uuid,uuid,integer,text) from public, anon, authenticated;
grant execute on function public.cancel_relationship_service(uuid,uuid,uuid,uuid,uuid,integer,text) to service_role;

-- Keep cancelled instances visible on relationship service cards. The existing
-- row projection remains scoped to active services for summaries and POS.
create or replace function public.read_relationship_service_cards(p_workspace_id uuid,p_relationship_id uuid,p_user_id uuid,p_offset integer default 0,p_id text default null) returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare result jsonb;
begin
 if not public.workspace_user_can_access_relationship(p_workspace_id,p_relationship_id,p_user_id) then raise exception 'Relationship access required'; end if;
 if p_offset<0 or p_offset>10000 then raise exception 'Invalid page'; end if;
 with source as (
  select base.id, base.created_at, to_jsonb(base) || jsonb_build_object('disposition','active') data
  from public.relationship_service_rows(p_workspace_id,p_relationship_id,p_user_id) base
  union all
  select i.id::text, i.created_at, jsonb_build_object(
   'id',i.id::text,'service_id',i.service_id,'service_revision_id',i.service_revision_id,
   'name',coalesce(v.name,i.service_key),'stage',i.stage,'origin',i.origin,
   'assignee_user_id',i.assignee_user_id,'assignee_name',coalesce(u.display_name,u.username,'Unassigned'),
   'version',i.version,'upfront_cents',coalesce(v.default_upfront_price_cents,0),
   'recurring_cents',coalesce(v.default_recurring_price_cents,0),'currency',coalesce(v.currency,'USD'),
   'created_at',i.created_at,'legacy',false,'disposition','cancelled')
  from public.relationship_service_instances i
  left join public.onboarding_service_revisions v on v.workspace_id=i.workspace_id and v.id=i.service_revision_id
  left join public.user_profiles u on u.user_id=i.assignee_user_id
  where i.workspace_id=p_workspace_id and i.relationship_id=p_relationship_id and i.import_id is null
   and i.disposition='cancelled' and (public.workspace_user_fully_covers_relationship(p_workspace_id,p_relationship_id,p_user_id) or i.assignee_user_id=p_user_id)
 ), page as (
  select * from source where p_id is null or id=p_id order by created_at,id limit 31 offset p_offset
 )
 select coalesce(jsonb_agg(page.data || jsonb_build_object(
  'thumbnailPath',v.definition->>'thumbnailPath','templateId',v.definition->>'templateId',
  'description',v.description,'notes',coalesce(i.source_snapshot->>'notes',''),
  'manager',coalesce(manager.display_name,manager.username),'seller',coalesce(seller.display_name,seller.username),
  'sold_upfront_cents',sale.upfront_amount_cents,'sold_recurring_cents',sale.recurring_amount_cents,
  'sold_currency',sale.currency,'billing_interval',sale.billing_interval,'billing_interval_count',sale.billing_interval_count
 )),'[]'::jsonb) into result
 from page
 left join public.onboarding_service_revisions v on v.workspace_id=p_workspace_id and v.id=(page.data->>'service_revision_id')::uuid
 left join public.relationship_service_instances i on (page.data->>'legacy')::boolean=false and i.workspace_id=p_workspace_id and i.id::text=page.id
 left join public.user_profiles manager on manager.user_id=i.manager_user_id
 left join public.user_profiles seller on seller.user_id=i.seller_user_id
 left join lateral(select line.upfront_amount_cents,line.recurring_amount_cents,line.currency,s.billing_interval,s.billing_interval_count
  from public.client_sale_items line join public.client_sales s on s.workspace_id=line.workspace_id and s.id=line.client_sale_id
  where line.workspace_id=p_workspace_id and s.relationship_id=p_relationship_id
   and (line.service_instance_id=i.id or (page.data->>'legacy')::boolean and line.service_id=(page.data->>'service_id')::uuid and line.service_instance_id is null)
   and s.snapshot_frozen_at is not null and s.deleted_at is null order by s.created_at desc limit 1) sale on true;
 return jsonb_build_object('items',result,'hasMore',jsonb_array_length(result)>30);
end $$;

notify pgrst, 'reload schema';
commit;
