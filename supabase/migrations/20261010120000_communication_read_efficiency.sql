-- Reuse this call's signed-in identity after the original authorization gate.
-- Shared account read positions, read receipts, unread and alert rules stay intact.
-- Keep target validation before the lock and cursor lookup after lock acquisition.
-- No tables, indexes, stored rows, grants, publications or policy helpers change.
begin;

create or replace function public.advance_communication_read(p_workspace_id uuid, p_kind text, p_conversation_id uuid, p_message_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_user uuid; target_at timestamptz; previous_at timestamptz; previous_id uuid;
begin
    if auth.role() is distinct from 'authenticated' or auth.uid() is null
       or public.current_session_is_aal2() is not true
       or public.is_workspace_member(p_workspace_id) is not true then raise insufficient_privilege; end if;
    if p_kind = 'client' then
        v_user:=auth.uid();
        if public.client_conversation_can_access(p_workspace_id,p_conversation_id,v_user) is not true then raise insufficient_privilege; end if;
        select created_at into target_at from public.client_messages where workspace_id=p_workspace_id and relationship_id=p_conversation_id and id=p_message_id;
    elsif p_kind = 'native' then
        v_user:=auth.uid();
        if public.native_conversation_can_read(p_conversation_id,v_user) is not true then raise insufficient_privilege; end if;
        select created_at into target_at from public.workspace_native_messages where workspace_id=p_workspace_id and conversation_id=p_conversation_id and id=p_message_id;
    else raise invalid_parameter_value; end if;
    if target_at is null then raise invalid_parameter_value; end if;
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_user::text || ':' || p_kind || ':' || p_conversation_id::text,0));
    if p_kind = 'client' then
        select c.last_read_message_id, coalesce(m.created_at,c.last_read_at) into previous_id,previous_at
        from public.communication_read_cursors c left join public.client_messages m on m.id=c.last_read_message_id and m.relationship_id=p_conversation_id
        where c.workspace_id=p_workspace_id and c.relationship_id=p_conversation_id and c.user_id=v_user;
        if previous_at is null or (target_at,p_message_id) > (previous_at,coalesce(previous_id,'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid)) then
            insert into public.communication_read_cursors(workspace_id,relationship_id,user_id,last_read_message_id,last_read_at)
            values(p_workspace_id,p_conversation_id,v_user,p_message_id,target_at)
            on conflict(workspace_id,relationship_id,user_id) do update set last_read_message_id=excluded.last_read_message_id,last_read_at=excluded.last_read_at;
            previous_id:=p_message_id; previous_at:=target_at;
        end if;
    else
        select c.last_read_message_id, coalesce(m.created_at,c.last_read_at) into previous_id,previous_at
        from public.workspace_native_read_cursors c left join public.workspace_native_messages m on m.id=c.last_read_message_id and m.conversation_id=p_conversation_id
        where c.workspace_id=p_workspace_id and c.conversation_id=p_conversation_id and c.user_id=v_user;
        if previous_at is null or (target_at,p_message_id) > (previous_at,coalesce(previous_id,'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid)) then
            insert into public.workspace_native_read_cursors(workspace_id,conversation_id,user_id,last_read_message_id,last_read_at)
            values(p_workspace_id,p_conversation_id,v_user,p_message_id,target_at)
            on conflict(conversation_id,user_id) do update set last_read_message_id=excluded.last_read_message_id,last_read_at=excluded.last_read_at;
            previous_id:=p_message_id; previous_at:=target_at;
        end if;
    end if;
    return jsonb_build_object('userId',v_user,'lastReadMessageId',previous_id,'lastReadAt',previous_at);
end $$;

-- CREATE OR REPLACE preserves the authenticated-only grants and existing owner.
notify pgrst, 'reload schema';
commit;
