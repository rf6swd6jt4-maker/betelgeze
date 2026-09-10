-- Additive opt-in reads. Existing RPCs, encrypted storage and decrypt functions
-- stay intact for rollback. No data is copied and no decryption keys are exposed.
begin;

create or replace function public.communication_client_messages_bounded(
    p_workspace_id uuid,
    p_relationship_id uuid default null,
    p_limit integer default 2000
)
returns table (
    id uuid,
    client_request_id uuid,
    relationship_id uuid,
    body text,
    direction text,
    provider text,
    provider_message_id text,
    whatsapp_message_id text,
    reply_to_whatsapp_message_id text,
    reply_to_message_id uuid,
    status text,
    error text,
    sender_kind text,
    sender_user_id uuid,
    automation_kind text,
    automation_label text,
    created_at timestamptz,
    sent_at timestamptz,
    delivered_at timestamptz,
    read_at timestamptz,
    failed_at timestamptz,
    raw_payload jsonb
)
language plpgsql stable security definer set search_path = ''
as $$
declare
    remaining integer := least(greatest(coalesce(p_limit, 2000), 1), 4000);
    batch_ids uuid[];
    batch_times timestamptz[];
    before_time timestamptz;
    before_id uuid;
    decoded_count integer;
    readable_relationships uuid[];
begin
    if auth.role() is distinct from 'authenticated' or auth.uid() is null
       or public.current_session_is_aal2() is not true then return; end if;
    select array_agg(relationship.id) into readable_relationships
    from public.relationships relationship
    where relationship.workspace_id = p_workspace_id
      and (p_relationship_id is null or relationship.id = p_relationship_id)
      and public.client_conversation_can_access(p_workspace_id, relationship.id, auth.uid());
    if coalesce(cardinality(readable_relationships), 0) = 0 then return; end if;
    loop
        -- Select only identifiers before invoking the established Vault decoder.
        -- Keep walking if an unreadable/corrupt record returns no decoded row:
        -- the legacy limit applies to valid results, not candidate ciphertexts.
        select array_agg(candidate.id order by candidate.created_at desc, candidate.id desc),
               array_agg(candidate.created_at order by candidate.created_at desc, candidate.id desc)
        into batch_ids, batch_times
        from (
            select message.id, message.created_at
            from public.client_messages message
            where message.workspace_id = p_workspace_id
              and message.relationship_id = any(readable_relationships)
              and (before_time is null or (message.created_at, message.id) < (before_time, before_id))
            order by message.created_at desc, message.id desc
            limit least(remaining, 128)
        ) candidate;
        if coalesce(cardinality(batch_ids), 0) = 0 then return; end if;

        return query
            select decoded.*
            from unnest(batch_ids) with ordinality requested(message_id, position)
            cross join lateral public.communication_client_message(p_workspace_id, requested.message_id) decoded
            order by requested.position;
        get diagnostics decoded_count = row_count;
        remaining := remaining - decoded_count;
        if remaining <= 0 then return; end if;
        before_time := batch_times[cardinality(batch_times)];
        before_id := batch_ids[cardinality(batch_ids)];
    end loop;
end;
$$;
revoke all on function public.communication_client_messages_bounded(uuid,uuid,integer) from public, anon, service_role;
grant execute on function public.communication_client_messages_bounded(uuid,uuid,integer) to authenticated;

create or replace function public.communication_native_messages_bounded(
    p_workspace_id uuid,
    p_conversation_id uuid default null,
    p_limit integer default 4000
)
returns table (
    id uuid,
    client_request_id uuid,
    conversation_id uuid,
    sender_user_id uuid,
    sender_workspace_role text,
    body text,
    reply_to_message_id uuid,
    attachment jsonb,
    created_at timestamptz,
    quote jsonb
)
language plpgsql stable security definer set search_path = ''
as $$
declare
    remaining integer := least(greatest(coalesce(p_limit, 4000), 1), 4000);
    batch_ids uuid[];
    batch_times timestamptz[];
    before_time timestamptz;
    before_id uuid;
    decoded_count integer;
    readable_conversations uuid[];
begin
    if auth.role() is distinct from 'authenticated' or auth.uid() is null
       or public.current_session_is_aal2() is not true then return; end if;
    if public.is_workspace_member(p_workspace_id) is not true then return; end if;
    select array_agg(conversation.id) into readable_conversations
    from public.workspace_native_conversations conversation
    where conversation.workspace_id = p_workspace_id
      and (p_conversation_id is null or conversation.id = p_conversation_id)
      and public.native_conversation_can_read(conversation.id, auth.uid());
    if coalesce(cardinality(readable_conversations), 0) = 0 then return; end if;
    loop
        -- Select only identifiers before invoking the established Vault decoder.
        -- Keep walking if an unreadable/corrupt record returns no decoded row:
        -- the legacy limit applies to valid results, not candidate ciphertexts.
        select array_agg(candidate.id order by candidate.created_at desc, candidate.id desc),
               array_agg(candidate.created_at order by candidate.created_at desc, candidate.id desc)
        into batch_ids, batch_times
        from (
            select message.id, message.created_at
            from public.workspace_native_messages message
            where message.workspace_id = p_workspace_id
              and message.conversation_id = any(readable_conversations)
              and not exists (
                  select 1 from public.workspace_native_conversation_visibility visibility
                  where visibility.conversation_id = message.conversation_id and visibility.user_id = auth.uid()
                    and message.created_at <= visibility.cleared_at
              )
              and (before_time is null or (message.created_at, message.id) < (before_time, before_id))
            order by message.created_at desc, message.id desc
            limit least(remaining, 128)
        ) candidate;
        if coalesce(cardinality(batch_ids), 0) = 0 then return; end if;

        return query
            select decoded.*
            from unnest(batch_ids) with ordinality requested(message_id, position)
            cross join lateral public.communication_native_message(p_workspace_id, requested.message_id) decoded
            order by requested.position;
        get diagnostics decoded_count = row_count;
        remaining := remaining - decoded_count;
        if remaining <= 0 then return; end if;
        before_time := batch_times[cardinality(batch_times)];
        before_id := batch_ids[cardinality(batch_ids)];
    end loop;
end;
$$;
revoke all on function public.communication_native_messages_bounded(uuid,uuid,integer) from public, anon, service_role;
grant execute on function public.communication_native_messages_bounded(uuid,uuid,integer) to authenticated;

notify pgrst, 'reload schema';
commit;
