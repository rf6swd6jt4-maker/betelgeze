-- Decode one preview per readable conversation, not the whole chat archive.
-- Unread metadata keeps badges accurate without decrypting unseen message bodies.
begin;
create or replace function public.communication_native_inbox(p_workspace_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
    conversation record;
    previews jsonb := '[]'::jsonb;
    unread jsonb := '[]'::jsonb;
    preview jsonb;
    unread_rows jsonb;
begin
    if auth.role() is distinct from 'authenticated' or auth.uid() is null
       or public.current_session_is_aal2() is not true
       or public.is_workspace_member(p_workspace_id) is not true then
        return jsonb_build_object('messages', previews, 'unread', unread);
    end if;
    for conversation in
        select c.id from public.workspace_native_conversations c
        where c.workspace_id = p_workspace_id and public.native_conversation_can_read(c.id, auth.uid())
    loop
        select coalesce(jsonb_agg(to_jsonb(m)), '[]'::jsonb) into preview
        from public.communication_native_messages_bounded(p_workspace_id, conversation.id, 1) m;
        previews := previews || preview;
        select coalesce(jsonb_agg(jsonb_build_object('id', m.id, 'senderUserId', coalesce(m.sender_user_id::text, 'be'), 'createdAt', m.created_at) order by m.created_at, m.id), '[]'::jsonb)
        into unread_rows
        from public.workspace_native_messages m
        left join public.workspace_native_read_cursors cursor
            on cursor.conversation_id = m.conversation_id and cursor.user_id = auth.uid()
        left join public.workspace_native_messages read_message
            on read_message.id = cursor.last_read_message_id and read_message.conversation_id = m.conversation_id
        where m.workspace_id = p_workspace_id and m.conversation_id = conversation.id
          and m.sender_user_id is distinct from auth.uid()
          and not exists (select 1 from public.workspace_native_conversation_visibility v
              where v.conversation_id = m.conversation_id and v.user_id = auth.uid() and m.created_at <= v.cleared_at)
          and (cursor.user_id is null
              or (read_message.id is not null and (m.created_at, m.id) > (read_message.created_at, read_message.id))
              or (read_message.id is null and m.created_at > cursor.last_read_at));
        unread := unread || jsonb_build_array(jsonb_build_object('conversation_id', conversation.id, 'messages', unread_rows));
    end loop;
    return jsonb_build_object('messages', previews, 'unread', unread);
end;
$$;
revoke all on function public.communication_native_inbox(uuid) from public, anon, service_role;
grant execute on function public.communication_native_inbox(uuid) to authenticated;
notify pgrst, 'reload schema';
commit;
