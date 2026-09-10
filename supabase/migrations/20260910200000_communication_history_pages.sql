-- Additive cursor reads: bound candidate IDs before decrypting content. Existing
-- RPCs remain unchanged for old clients and rollback. Apply before enabling UI.
begin;

create or replace function public.communication_client_message_page(
    p_workspace_id uuid,
    p_conversation_id uuid,
    p_before_created_at timestamptz default null,
    p_before_id uuid default null,
    p_limit integer default 60
) returns jsonb
language sql stable security definer set search_path = ''
as $$
    with candidates as materialized (
        select message.id, message.created_at
        from public.client_messages message
        where auth.role() = 'authenticated' and auth.uid() is not null
          and public.current_session_is_aal2()
          and public.client_conversation_can_access(p_workspace_id, p_conversation_id, auth.uid())
          and message.workspace_id = p_workspace_id
          and message.relationship_id = p_conversation_id
          and ((p_before_created_at is null and p_before_id is null)
            or (p_before_created_at is not null and p_before_id is not null
                and (message.created_at, message.id) < (p_before_created_at, p_before_id)))
        order by message.created_at desc, message.id desc
        limit least(greatest(coalesce(p_limit, 60), 1), 100) + 1
    ), page as materialized (
        select * from candidates order by created_at desc, id desc
        limit least(greatest(coalesce(p_limit, 60), 1), 100)
    ), decoded as materialized (
        -- The established single-message RPC retains Vault decryption and all
        -- participant/AAL/visibility checks. Never return ciphertext or keys.
        select result.* from page
        cross join lateral public.communication_client_message(p_workspace_id, page.id) result
    )
    select jsonb_build_object(
        'messages', coalesce((select jsonb_agg(to_jsonb(decoded) order by created_at desc, id desc) from decoded), '[]'::jsonb),
        'hasMore', (select count(*) from candidates) > least(greatest(coalesce(p_limit, 60), 1), 100),
        'nextBefore', (select jsonb_build_object('createdAt', created_at, 'id', id) from page order by created_at, id limit 1)
    );
$$;
revoke all on function public.communication_client_message_page(uuid,uuid,timestamptz,uuid,integer) from public, anon, service_role;
grant execute on function public.communication_client_message_page(uuid,uuid,timestamptz,uuid,integer) to authenticated;

create or replace function public.communication_native_message_page(
    p_workspace_id uuid,
    p_conversation_id uuid,
    p_before_created_at timestamptz default null,
    p_before_id uuid default null,
    p_limit integer default 60
) returns jsonb
language sql stable security definer set search_path = ''
as $$
    with candidates as materialized (
        select message.id, message.created_at
        from public.workspace_native_messages message
        where auth.role() = 'authenticated' and auth.uid() is not null
          and public.current_session_is_aal2()
          and public.is_workspace_member(p_workspace_id) and public.native_conversation_can_read(p_conversation_id, auth.uid())
          and message.workspace_id = p_workspace_id
          and message.conversation_id = p_conversation_id
          and not exists (
              select 1 from public.workspace_native_conversation_visibility visibility
              where visibility.conversation_id = p_conversation_id and visibility.user_id = auth.uid()
                and message.created_at <= visibility.cleared_at
          )
          and ((p_before_created_at is null and p_before_id is null)
            or (p_before_created_at is not null and p_before_id is not null
                and (message.created_at, message.id) < (p_before_created_at, p_before_id)))
        order by message.created_at desc, message.id desc
        limit least(greatest(coalesce(p_limit, 60), 1), 100) + 1
    ), page as materialized (
        select * from candidates order by created_at desc, id desc
        limit least(greatest(coalesce(p_limit, 60), 1), 100)
    ), decoded as materialized (
        -- The established single-message RPC retains Vault decryption and all
        -- participant/AAL/visibility checks. Never return ciphertext or keys.
        select result.* from page
        cross join lateral public.communication_native_message(p_workspace_id, page.id) result
    )
    select jsonb_build_object(
        'messages', coalesce((select jsonb_agg(to_jsonb(decoded) order by created_at desc, id desc) from decoded), '[]'::jsonb),
        'hasMore', (select count(*) from candidates) > least(greatest(coalesce(p_limit, 60), 1), 100),
        'nextBefore', (select jsonb_build_object('createdAt', created_at, 'id', id) from page order by created_at, id limit 1)
    );
$$;
revoke all on function public.communication_native_message_page(uuid,uuid,timestamptz,uuid,integer) from public, anon, service_role;
grant execute on function public.communication_native_message_page(uuid,uuid,timestamptz,uuid,integer) to authenticated;

notify pgrst, 'reload schema';
commit;
