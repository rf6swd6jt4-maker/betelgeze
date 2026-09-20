begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- Edit a completed historical service and its cash collected in one transaction.
-- A cash-only edit leaves the service version and stage history untouched.
create or replace function public.edit_completed_relationship_service_with_cash(
    p_workspace_id uuid, p_relationship_id uuid, p_instance_id uuid, p_actor_user_id uuid,
    p_request_id uuid, p_expected_instance_version integer, p_stage text,
    p_assignee_user_id uuid, p_reason text, p_expected_cash_version integer,
    p_cash_cents bigint
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare instance public.relationship_service_instances%rowtype;
        prior_change public.service_instance_stage_events%rowtype;
        result jsonb;
begin
    if p_request_id is null or p_expected_instance_version is null or p_expected_instance_version < 1
       or p_expected_cash_version is null or p_expected_cash_version < 0 then
        raise exception 'Reload the service before saving';
    end if;
    select * into instance from public.relationship_service_instances
      where workspace_id=p_workspace_id and relationship_id=p_relationship_id and id=p_instance_id for update;
    if instance.id is null or instance.origin <> 'already_onboarded' or instance.stage <> 'completed'
       or instance.disposition <> 'active' or p_stage <> 'completed'
       or exists(select 1 from public.service_instance_sale_items s where s.instance_id=p_instance_id) then
        raise exception 'Only completed, unsold historical services can record cash collected';
    end if;
    if not public.can_manage_relationship_service(p_workspace_id,p_relationship_id,p_actor_user_id,instance.origin) then
        raise exception 'Service editing access required';
    end if;
    select * into prior_change from public.service_instance_stage_events
      where workspace_id=p_workspace_id and instance_id=p_instance_id and request_id=p_request_id;
    if instance.assignee_user_id is distinct from p_assignee_user_id or prior_change.id is not null then
        if nullif(trim(p_reason),'') is null then raise exception 'Give a reason for the service change'; end if;
        result := public.change_relationship_service_with_sop(
            p_workspace_id,p_relationship_id,p_instance_id,p_actor_user_id,p_request_id,
            p_expected_instance_version,p_stage,'active',p_assignee_user_id,trim(p_reason),false);
    else
        if instance.version <> p_expected_instance_version then raise exception 'Service instance changed; reload before updating'; end if;
        result := jsonb_build_object('id',p_instance_id,'generation',false);
    end if;
    if p_cash_cents is not null then
        perform public.set_completed_service_revenue(
            p_workspace_id,p_relationship_id,p_instance_id,p_actor_user_id,p_request_id,
            p_expected_cash_version,p_cash_cents);
    end if;
    return result;
end $$;
revoke all on function public.edit_completed_relationship_service_with_cash(uuid,uuid,uuid,uuid,uuid,integer,text,uuid,text,integer,bigint) from public,anon,authenticated;
grant execute on function public.edit_completed_relationship_service_with_cash(uuid,uuid,uuid,uuid,uuid,integer,text,uuid,text,integer,bigint) to service_role;

notify pgrst, 'reload schema';
commit;
