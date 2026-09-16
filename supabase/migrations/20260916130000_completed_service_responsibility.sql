-- Completed service imports carry the historical seller and manager. Those
-- same relationship responsibilities authorize the client conversation.
begin;

create function public.relationship_service_responsibility_choices(
    p_workspace_id uuid,
    p_relationship_id uuid,
    p_user_id uuid
) returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare sellers jsonb; managers jsonb;
begin
    if not public.can_manage_relationship_service(p_workspace_id,p_relationship_id,p_user_id,'already_onboarded') then
        raise exception 'Service import access required';
    end if;
    select coalesce(jsonb_agg(to_jsonb(choice) order by choice.name,choice.id),'[]') into sellers from (
        select membership.user_id id,coalesce(profile.display_name,profile.username,'Workspace member') name
        from public.workspace_operational_roles operational
        join public.workspace_memberships membership using(workspace_id,user_id)
        left join public.user_profiles profile on profile.user_id=membership.user_id
        where operational.workspace_id=p_workspace_id and operational.can_sell
    ) choice;
    select coalesce(jsonb_agg(to_jsonb(choice) order by choice.name,choice.id),'[]') into managers from (
        select membership.user_id id,coalesce(profile.display_name,profile.username,'Workspace member') name
        from public.workspace_operational_roles operational
        join public.workspace_memberships membership using(workspace_id,user_id)
        left join public.user_profiles profile on profile.user_id=membership.user_id
        where operational.workspace_id=p_workspace_id and operational.can_manage
    ) choice;
    return jsonb_build_object('sellers',sellers,'managers',managers);
end $$;

create function public.add_completed_relationship_service(
    p_workspace_id uuid,
    p_relationship_id uuid,
    p_actor_user_id uuid,
    p_request_id uuid,
    p_service_id uuid,
    p_revision_id uuid,
    p_assignee_user_id uuid,
    p_seller_user_id uuid,
    p_manager_user_id uuid
) returns jsonb
language plpgsql security definer set search_path=public as $$
declare
    instance public.relationship_service_instances%rowtype;
    relationship public.relationships%rowtype;
    service public.onboarding_services%rowtype;
    latest_revision uuid;
    snapshot jsonb;
begin
    if p_request_id is null or p_seller_user_id is null or p_manager_user_id is null then
        raise exception 'Choose a seller and manager';
    end if;
    if not public.can_manage_relationship_service(p_workspace_id,p_relationship_id,p_actor_user_id,'already_onboarded') then
        raise exception 'Service import access required';
    end if;
    snapshot:=jsonb_build_object(
        'service_id',p_service_id,
        'revision_id',p_revision_id,
        'origin','already_onboarded',
        'stage','completed',
        'assignee_user_id',p_assignee_user_id,
        'seller_user_id',p_seller_user_id,
        'manager_user_id',p_manager_user_id,
        'actor_user_id',p_actor_user_id
    );
    perform pg_advisory_xact_lock(hashtextextended(p_workspace_id::text||p_relationship_id::text||p_request_id::text,0));
    select * into instance from public.relationship_service_instances
      where workspace_id=p_workspace_id and relationship_id=p_relationship_id and source_key='request:'||p_request_id;
    if instance.id is not null then
        if instance.source_snapshot is distinct from snapshot then raise exception 'Request ID reused with different input'; end if;
        return jsonb_build_object('id',instance.id,'generation',false);
    end if;
    select * into relationship from public.relationships
      where workspace_id=p_workspace_id and id=p_relationship_id for update;
    if relationship.id is null then raise exception 'Relationship not found'; end if;
    if relationship.seller_user_id is not null and relationship.seller_user_id is distinct from p_seller_user_id then
        raise exception 'This relationship already has a different seller';
    end if;
    if relationship.fulfilment_manager_user_id is not null and relationship.fulfilment_manager_user_id is distinct from p_manager_user_id then
        raise exception 'This relationship already has a different manager';
    end if;
    if not exists(
        select 1 from public.workspace_operational_roles operational
        join public.workspace_memberships membership using(workspace_id,user_id)
        where operational.workspace_id=p_workspace_id and operational.user_id=p_seller_user_id and operational.can_sell
    ) then raise exception 'Choose an eligible seller'; end if;
    if not exists(
        select 1 from public.workspace_operational_roles operational
        join public.workspace_memberships membership using(workspace_id,user_id)
        where operational.workspace_id=p_workspace_id and operational.user_id=p_manager_user_id and operational.can_manage
    ) then raise exception 'Choose an eligible manager'; end if;
    select * into service from public.onboarding_services
      where workspace_id=p_workspace_id and id=p_service_id and state='active' for update;
    if service.id is null then raise exception 'Choose an active service'; end if;
    select id into latest_revision from public.onboarding_service_revisions
      where workspace_id=p_workspace_id and service_id=p_service_id order by revision_number desc limit 1;
    if latest_revision is null or latest_revision is distinct from p_revision_id then
        raise exception 'This service was updated. Choose it again from the catalogue.';
    end if;
    update public.relationships set
        seller_user_id=coalesce(seller_user_id,p_seller_user_id),
        fulfilment_manager_user_id=coalesce(fulfilment_manager_user_id,p_manager_user_id),
        updated_at=now()
      where workspace_id=p_workspace_id and id=p_relationship_id;
    insert into public.relationship_service_instances(
        workspace_id,relationship_id,service_id,service_revision_id,service_key,source_key,origin,stage,
        assignee_user_id,seller_user_id,manager_user_id,source_snapshot,change_request_id,change_reason,changed_by
    ) values (
        p_workspace_id,p_relationship_id,service.id,p_revision_id,service.internal_code,'request:'||p_request_id,'already_onboarded','completed',
        p_assignee_user_id,p_seller_user_id,p_manager_user_id,snapshot,p_request_id,'Completed service added with historical responsibility',p_actor_user_id
    ) returning * into instance;
    return jsonb_build_object('id',instance.id,'generation',false);
end $$;

revoke all on function public.relationship_service_responsibility_choices(uuid,uuid,uuid),public.add_completed_relationship_service(uuid,uuid,uuid,uuid,uuid,uuid,uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.relationship_service_responsibility_choices(uuid,uuid,uuid),public.add_completed_relationship_service(uuid,uuid,uuid,uuid,uuid,uuid,uuid,uuid,uuid) to service_role;

notify pgrst,'reload schema';
commit;
