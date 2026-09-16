-- The original gate used `on conflict do nothing`, so the first unread
-- message permanently blocked every newer push for that subscription and
-- conversation until a read cursor cleared the row. Advance the gate for a
-- strictly newer message instead. The service worker can then replace the
-- visible notification and update its unread count, while duplicate or
-- out-of-order delivery jobs remain suppressed.
create or replace function public.claim_chat_push_notification(
    p_subscription_id uuid,
    p_workspace_id uuid,
    p_conversation_kind text,
    p_conversation_id uuid,
    p_message_id uuid,
    p_message_created_at timestamptz
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
    subscription_user_id uuid;
    read_through timestamptz;
    affected_count integer;
begin
    if p_conversation_kind not in ('client', 'native') then
        return false;
    end if;

    select user_id into subscription_user_id
    from public.web_push_subscriptions
    where id = p_subscription_id;

    if subscription_user_id is null then
        return false;
    end if;

    if p_conversation_kind = 'client' then
        select last_read_at into read_through
        from public.communication_read_cursors
        where workspace_id = p_workspace_id
          and relationship_id = p_conversation_id
          and user_id = subscription_user_id;
    else
        select last_read_at into read_through
        from public.workspace_native_read_cursors
        where workspace_id = p_workspace_id
          and conversation_id = p_conversation_id
          and user_id = subscription_user_id;
    end if;

    if read_through is not null and read_through >= p_message_created_at then
        return false;
    end if;

    insert into public.chat_push_notification_states as current_state (
        subscription_id,
        workspace_id,
        conversation_kind,
        conversation_id,
        message_id,
        message_created_at
    ) values (
        p_subscription_id,
        p_workspace_id,
        p_conversation_kind,
        p_conversation_id,
        p_message_id,
        p_message_created_at
    )
    on conflict (subscription_id, conversation_kind, conversation_id) do update
    set workspace_id = excluded.workspace_id,
        message_id = excluded.message_id,
        message_created_at = excluded.message_created_at,
        created_at = now()
    where current_state.workspace_id = excluded.workspace_id
      and excluded.message_created_at > current_state.message_created_at;

    get diagnostics affected_count = row_count;
    return affected_count = 1;
end;
$$;

revoke all on function public.claim_chat_push_notification(uuid, uuid, text, uuid, uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.claim_chat_push_notification(uuid, uuid, text, uuid, uuid, timestamptz) to service_role;
