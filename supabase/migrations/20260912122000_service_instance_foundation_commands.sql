-- Internal SS-01 commands. Later packages expose appropriately authorized UI.
begin;
create function public.create_service_instance(
    p_workspace_id uuid, p_relationship_id uuid, p_actor_user_id uuid, p_request_id uuid,
    p_service_id uuid, p_origin text, p_stage text, p_assignee_user_id uuid default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare i public.relationship_service_instances%rowtype; s public.onboarding_services%rowtype; revision_id uuid;
begin
    if not exists(select 1 from public.workspace_memberships where workspace_id = p_workspace_id and user_id = p_actor_user_id and role in ('owner', 'admin')) then raise exception 'Owner or admin required'; end if;
    if p_request_id is null or p_origin is null or p_stage is null or p_origin not in ('negotiation', 'already_onboarded') then raise exception 'Choose Negotiating or Already onboarded'; end if;
    select * into i from public.relationship_service_instances where workspace_id = p_workspace_id and relationship_id = p_relationship_id and source_key = 'request:' || p_request_id;
    if i.id is not null then
        if i.source_snapshot <> jsonb_build_object('service_id', p_service_id, 'origin', p_origin, 'stage', p_stage, 'assignee_user_id', p_assignee_user_id, 'actor_user_id', p_actor_user_id) then raise exception 'Request ID reused with different input'; end if;
        return i.id;
    end if;
    select * into strict s from public.onboarding_services where workspace_id = p_workspace_id and id = p_service_id and state = 'active';
    select id into revision_id from public.onboarding_service_revisions where workspace_id = p_workspace_id and service_id = s.id order by revision_number desc limit 1;
    if revision_id is null then raise exception 'Publish this service before assigning it'; end if;
    insert into public.relationship_service_instances(workspace_id, relationship_id, service_id, service_revision_id, service_key, source_key, origin, stage,
        assignee_user_id, source_snapshot, change_request_id, change_reason, changed_by)
    values(p_workspace_id, p_relationship_id, s.id, revision_id, s.internal_code, 'request:' || p_request_id, p_origin, p_stage,
        p_assignee_user_id, jsonb_build_object('service_id', p_service_id, 'origin', p_origin, 'stage', p_stage, 'assignee_user_id', p_assignee_user_id, 'actor_user_id', p_actor_user_id),
        p_request_id, 'Service assigned through SS-01 foundation command', p_actor_user_id)
    on conflict (workspace_id, relationship_id, source_key) do nothing returning * into i;
    if i.id is null then
        -- Concurrent duplicate: verify intent, rather than accepting changed input.
        return public.create_service_instance(p_workspace_id, p_relationship_id, p_actor_user_id, p_request_id, p_service_id, p_origin, p_stage, p_assignee_user_id);
    end if;
    return i.id;
end $$;

create function public.change_service_instance(
    p_workspace_id uuid, p_instance_id uuid, p_actor_user_id uuid, p_request_id uuid, p_expected_version integer,
    p_stage text, p_disposition text, p_assignee_user_id uuid, p_reason text
) returns integer
language plpgsql security definer set search_path = public as $$
declare i public.relationship_service_instances%rowtype; e public.service_instance_stage_events%rowtype;
begin
    if not exists(select 1 from public.workspace_memberships where workspace_id = p_workspace_id and user_id = p_actor_user_id and role in ('owner', 'admin')) then raise exception 'Owner or admin required'; end if;
    if p_expected_version is null or p_request_id is null then raise exception 'Version and request ID are required'; end if;
    select * into strict i from public.relationship_service_instances where workspace_id = p_workspace_id and id = p_instance_id for update;
    select * into e from public.service_instance_stage_events where workspace_id = p_workspace_id and instance_id = p_instance_id and request_id = p_request_id;
    if e.id is not null then
        if e.version <> p_expected_version + 1 or (e.new_stage, e.new_disposition, e.new_assignee_user_id, e.reason, e.actor_user_id)
            is distinct from (p_stage, p_disposition, p_assignee_user_id, p_reason, p_actor_user_id) then raise exception 'Request ID reused with different input'; end if;
        return e.version;
    end if;
    if p_expected_version is null or i.version <> p_expected_version then raise exception 'Service instance changed; reload before updating'; end if;
    update public.relationship_service_instances set stage = p_stage, disposition = p_disposition, assignee_user_id = p_assignee_user_id,
        version = version + 1, change_request_id = p_request_id, change_reason = p_reason, changed_by = p_actor_user_id
    where workspace_id = p_workspace_id and id = p_instance_id;
    return i.version + 1;
end $$;
revoke all on function public.create_service_instance(uuid, uuid, uuid, uuid, uuid, text, text, uuid), public.change_service_instance(uuid, uuid, uuid, uuid, integer, text, text, uuid, text) from public, anon, authenticated;
grant execute on function public.create_service_instance(uuid, uuid, uuid, uuid, uuid, text, text, uuid), public.change_service_instance(uuid, uuid, uuid, uuid, integer, text, text, uuid, text) to service_role;
commit;
