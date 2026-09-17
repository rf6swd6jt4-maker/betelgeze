begin;

-- Metadata-only unread ranges. No message bodies or decryptions; each range is
-- capped at 100 because navigation badges display 99+ beyond that threshold.
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
                  and (m.created_at, m.id) > (coalesce(read_message.created_at, c.last_read_at, '-infinity'::timestamptz), coalesce(read_message.id, 'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid))
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
                  and (m.created_at, m.id) > (coalesce(read_message.created_at, c.last_read_at, '-infinity'::timestamptz), coalesce(read_message.id, 'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid))
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

-- Concurrent resident tabs cannot move the durable read position backwards.
create or replace function public.advance_communication_read(p_workspace_id uuid, p_kind text, p_conversation_id uuid, p_message_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare target_at timestamptz; previous_at timestamptz; previous_id uuid;
begin
    if auth.role() is distinct from 'authenticated' or auth.uid() is null
       or public.current_session_is_aal2() is not true
       or public.is_workspace_member(p_workspace_id) is not true then raise insufficient_privilege; end if;
    if p_kind = 'client' then
        if public.client_conversation_can_access(p_workspace_id,p_conversation_id,auth.uid()) is not true then raise insufficient_privilege; end if;
        select created_at into target_at from public.client_messages where workspace_id=p_workspace_id and relationship_id=p_conversation_id and id=p_message_id;
    elsif p_kind = 'native' then
        if public.native_conversation_can_read(p_conversation_id,auth.uid()) is not true then raise insufficient_privilege; end if;
        select created_at into target_at from public.workspace_native_messages where workspace_id=p_workspace_id and conversation_id=p_conversation_id and id=p_message_id;
    else raise invalid_parameter_value; end if;
    if target_at is null then raise invalid_parameter_value; end if;
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(auth.uid()::text || ':' || p_kind || ':' || p_conversation_id::text,0));
    if p_kind = 'client' then
        select c.last_read_message_id, coalesce(m.created_at,c.last_read_at) into previous_id,previous_at
        from public.communication_read_cursors c left join public.client_messages m on m.id=c.last_read_message_id and m.relationship_id=p_conversation_id
        where c.workspace_id=p_workspace_id and c.relationship_id=p_conversation_id and c.user_id=auth.uid();
        if previous_at is null or (target_at,p_message_id) > (previous_at,coalesce(previous_id,'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid)) then
            insert into public.communication_read_cursors(workspace_id,relationship_id,user_id,last_read_message_id,last_read_at)
            values(p_workspace_id,p_conversation_id,auth.uid(),p_message_id,target_at)
            on conflict(workspace_id,relationship_id,user_id) do update set last_read_message_id=excluded.last_read_message_id,last_read_at=excluded.last_read_at;
            previous_id:=p_message_id; previous_at:=target_at;
        end if;
    else
        select c.last_read_message_id, coalesce(m.created_at,c.last_read_at) into previous_id,previous_at
        from public.workspace_native_read_cursors c left join public.workspace_native_messages m on m.id=c.last_read_message_id and m.conversation_id=p_conversation_id
        where c.workspace_id=p_workspace_id and c.conversation_id=p_conversation_id and c.user_id=auth.uid();
        if previous_at is null or (target_at,p_message_id) > (previous_at,coalesce(previous_id,'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid)) then
            insert into public.workspace_native_read_cursors(workspace_id,conversation_id,user_id,last_read_message_id,last_read_at)
            values(p_workspace_id,p_conversation_id,auth.uid(),p_message_id,target_at)
            on conflict(conversation_id,user_id) do update set last_read_message_id=excluded.last_read_message_id,last_read_at=excluded.last_read_at;
            previous_id:=p_message_id; previous_at:=target_at;
        end if;
    end if;
    return jsonb_build_object('userId',auth.uid(),'lastReadMessageId',previous_id,'lastReadAt',previous_at);
end $$;

revoke all on function public.communication_unread_summary(uuid) from public,anon,service_role;
revoke all on function public.advance_communication_read(uuid,text,uuid,uuid) from public,anon,service_role;
grant execute on function public.communication_unread_summary(uuid) to authenticated;
grant execute on function public.advance_communication_read(uuid,text,uuid,uuid) to authenticated;
notify pgrst,'reload schema';
commit;
