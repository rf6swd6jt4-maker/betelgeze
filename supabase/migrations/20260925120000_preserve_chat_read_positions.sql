-- app-alerts.md: authorized read/unread reliability repair, 25 September 2026.
-- A read position is historical (created_at, message_id) metadata. Deleting its
-- message must not erase the UUID boundary and swallow unread timestamp ties.
-- Keep existing null/legacy cursor semantics; no rows are rewritten/backfilled.
-- advance_communication_read still authorizes the exact live target message,
-- workspace, membership and AAL2 before advancing; grants/RLS remain unchanged.
-- Existing applications can consume a cursor whose message is no longer loaded.
-- Application rollback is compatible. Do not restore these FKs by nulling retained
-- IDs: that would discard read history and recreate the defect.
begin;

alter table public.communication_read_cursors
    drop constraint communication_read_cursors_last_read_message_id_fkey;
alter table public.workspace_native_read_cursors
    drop constraint workspace_native_read_cursors_last_read_message_id_fkey;

create or replace function public.communication_unread_summary(p_workspace_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare result jsonb;
begin
    if auth.role() is distinct from 'authenticated' or auth.uid() is null
       or public.current_session_is_aal2() is not true
       or public.is_workspace_member(p_workspace_id) is not true then
        raise insufficient_privilege;
    end if;
    with readable as materialized (
        select 'client'::text kind, r.id from public.relationships r
        where r.workspace_id = p_workspace_id and r.status <> 'archived'
          and public.client_conversation_can_access(p_workspace_id, r.id, auth.uid())
        union all
        select 'native', c.id from public.workspace_native_conversations c
        where c.workspace_id = p_workspace_id and public.native_conversation_can_read(c.id, auth.uid())
    ), counts as (
        select r.kind, r.id, u.* from readable r
        cross join lateral (
            select count(*)::int count,
                (array_agg(m.id order by m.created_at desc, m.id desc))[1] latest_id,
                max(m.created_at) latest_at
            from (
                select m.id, m.created_at from public.client_messages m
                left join public.communication_read_cursors c on c.workspace_id = p_workspace_id and c.relationship_id = r.id and c.user_id = auth.uid()
                left join public.client_messages read_message on read_message.id = c.last_read_message_id and read_message.relationship_id = r.id
                where r.kind = 'client' and m.workspace_id = p_workspace_id and m.relationship_id = r.id and m.direction = 'inbound'
                  and (m.created_at, m.id) > (coalesce(read_message.created_at, c.last_read_at, '-infinity'::timestamptz), coalesce(read_message.id, c.last_read_message_id, 'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid))
                order by m.created_at desc, m.id desc limit 100
            ) m
            where r.kind = 'client'
            union all
            select count(*)::int,
                (array_agg(m.id order by m.created_at desc, m.id desc))[1], max(m.created_at)
            from (
                select m.id, m.created_at from public.workspace_native_messages m
                left join public.workspace_native_read_cursors c on c.conversation_id = r.id and c.user_id = auth.uid()
                left join public.workspace_native_messages read_message on read_message.id = c.last_read_message_id and read_message.conversation_id = r.id
                left join public.workspace_native_conversation_visibility v on v.conversation_id = r.id and v.user_id = auth.uid()
                where r.kind = 'native' and m.workspace_id = p_workspace_id and m.conversation_id = r.id and m.sender_user_id is distinct from auth.uid()
                  and (m.created_at, m.id) > (coalesce(read_message.created_at, c.last_read_at, '-infinity'::timestamptz), coalesce(read_message.id, c.last_read_message_id, 'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid))
                  and m.created_at > coalesce(v.cleared_at, '-infinity'::timestamptz)
                order by m.created_at desc, m.id desc limit 100
            ) m
            where r.kind = 'native'
        ) u
    )
    select coalesce(jsonb_agg(jsonb_build_object('kind', kind, 'conversationId', id, 'count', count, 'latestMessageId', latest_id, 'latestMessageAt', latest_at)) filter (where count > 0), '[]'::jsonb)
    into result from counts;
    return result;
end $$;

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
              or (read_message.id is null and (m.created_at, m.id) > (cursor.last_read_at, coalesce(cursor.last_read_message_id, 'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid))));
        unread := unread || jsonb_build_array(jsonb_build_object('conversation_id', conversation.id, 'messages', unread_rows));
    end loop;
    return jsonb_build_object('messages', previews, 'unread', unread);
end;
$$;

-- CREATE OR REPLACE retains the existing authenticated-only function grants.
notify pgrst, 'reload schema';
commit;
