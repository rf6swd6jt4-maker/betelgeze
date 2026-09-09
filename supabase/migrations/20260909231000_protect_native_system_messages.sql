-- BE inbox messages can be hidden with Clear, but cannot be edited or deleted.
create or replace function public.delete_native_message_for_me(
    p_conversation_id uuid,
    p_message_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    target_message public.workspace_native_messages%rowtype;
    actor_role text;
    sender_role text;
    decrypted_attachment jsonb;
    secret text;
begin
    if auth.role() <> 'authenticated' or auth.uid() is null or not public.current_session_is_aal2() then
        raise exception 'aal2_required';
    end if;
    if not public.native_conversation_can_read(p_conversation_id, auth.uid()) then
        raise exception 'conversation_not_found';
    end if;

    select * into target_message
    from public.workspace_native_messages
    where id = p_message_id and conversation_id = p_conversation_id;
    if not found then return jsonb_build_object('deleted', true, 'attachment', null); end if;

    select case when membership.role = 'member' then 'staff' else membership.role end into actor_role
    from public.workspace_memberships membership
    where membership.workspace_id = target_message.workspace_id and membership.user_id = auth.uid();
    sender_role := target_message.sender_workspace_role;

    if target_message.sender_user_id is null then raise exception 'message_delete_forbidden'; end if;
    if target_message.sender_user_id <> auth.uid()
       and not (actor_role = 'admin' and sender_role = 'staff')
       and not (actor_role = 'owner' and sender_role in ('admin', 'staff')) then
        raise exception 'message_delete_forbidden';
    end if;

    if target_message.attachment_ciphertext is not null then
        select decrypted.secret into secret
        from communications_secure.content_keys content_key
        join vault.decrypted_secrets decrypted on decrypted.id = content_key.vault_secret_id
        where content_key.id = target_message.body_key_id;
        decrypted_attachment := extensions.pgp_sym_decrypt(target_message.attachment_ciphertext, secret)::jsonb;
    else
        decrypted_attachment := target_message.attachment;
    end if;

    delete from public.workspace_native_messages where id = target_message.id;
    return jsonb_build_object('deleted', true, 'attachment', decrypted_attachment);
end;
$$;
