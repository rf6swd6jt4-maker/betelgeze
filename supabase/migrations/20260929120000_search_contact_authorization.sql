-- Search discovers only contacts attached to a currently readable client chat.
-- Reuse its existing policy for every role; no message/read/alert policy changes.
begin;

create function public.read_search_contact_channels(p_workspace_id uuid, p_user_id uuid)
returns table(relationship_id uuid, external_address text, provider text)
language plpgsql stable security definer set search_path = '' as $$
begin
    if not exists (
        select 1 from public.workspaces workspace
        join public.workspace_memberships membership on membership.workspace_id = workspace.id
        where workspace.id = p_workspace_id and workspace.status = 'active'
          and membership.user_id = p_user_id
    ) then return; end if;

    return query
    with candidates as materialized (
        -- Preserve the current sample before excluding inactive channels, so
        -- inactive history cannot expand the candidate scan in this release.
        select channel.client_id, channel.external_address, channel.provider, channel.is_active
        from public.client_communication_channels channel
        where channel.workspace_id = p_workspace_id
        limit 60
    ), mapped as materialized (
        -- The unique canonical client link determines the destination. A stale
        -- or inconsistent channel.relationship_id must not grant discovery.
        select relationship.id as relationship_id,
               candidate.external_address, candidate.provider
        from candidates candidate
        cross join lateral (
            select relationship.id
            from public.relationships relationship
            where relationship.client_id = candidate.client_id
              and relationship.workspace_id = p_workspace_id
            limit 1
        ) relationship
        where candidate.is_active
    )
    select contact.relationship_id, contact.external_address, contact.provider
    from mapped contact
    where public.client_conversation_can_access(p_workspace_id, contact.relationship_id, p_user_id);
    -- The materialized mapping also bounds the existing policy to <=60 checks;
    -- the planner cannot push it into a scan of all workspace relationships.
end;
$$;

revoke all on function public.read_search_contact_channels(uuid, uuid) from public, anon, authenticated;
grant execute on function public.read_search_contact_channels(uuid, uuid) to service_role;

notify pgrst, 'reload schema';
commit;
