-- Quote snapshots are native-chat-only content. Encrypt before storage/Realtime,
-- using the conversation key already used for the message body and attachments.
begin;

alter table public.workspace_native_messages
    add column if not exists quote jsonb,
    add column if not exists quote_ciphertext bytea;

create or replace function communications_secure.encrypt_native_message_quote()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
    content_key record;
begin
    if new.quote is null then return new; end if;
    if tg_op <> 'INSERT' then raise exception 'message_quote_is_immutable'; end if;
    if new.reply_to_message_id is null or not exists (
        select 1 from public.workspace_native_messages original
        where original.id = new.reply_to_message_id
          and original.workspace_id = new.workspace_id
          and original.conversation_id = new.conversation_id
    ) then raise exception 'message_quote_requires_same_conversation_reply'; end if;
    if jsonb_typeof(new.quote) <> 'object'
       or jsonb_typeof(new.quote -> 'text') is distinct from 'string'
       or coalesce(char_length(btrim(new.quote ->> 'text')), 0) not between 1 and 8000
       or jsonb_typeof(new.quote -> 'start') is distinct from 'number'
       or jsonb_typeof(new.quote -> 'end') is distinct from 'number'
       or (new.quote ->> 'start') !~ '^[0-9]+$'
       or (new.quote ->> 'end') !~ '^[0-9]+$'
       or (new.quote ->> 'start')::numeric < 0
       or (new.quote ->> 'end')::numeric <= (new.quote ->> 'start')::numeric
       or (new.quote ->> 'end')::numeric > 8000
       or octet_length(new.quote::text) > 64000
    then raise exception 'invalid_message_quote'; end if;
    select * into content_key
    from communications_secure.get_or_create_content_key(new.workspace_id, 'native', new.conversation_id);
    new.quote_ciphertext := extensions.pgp_sym_encrypt(new.quote::text, content_key.secret, 'cipher-algo=aes256, compress-algo=0');
    new.body_key_id := coalesce(new.body_key_id, content_key.key_id);
    new.body_encryption_version := coalesce(new.body_encryption_version, content_key.key_version);
    new.quote := null;
    return new;
end;
$$;

revoke all on function communications_secure.encrypt_native_message_quote() from public, anon, authenticated, service_role;
drop trigger if exists encrypt_native_message_quote on public.workspace_native_messages;
create trigger encrypt_native_message_quote
before insert or update of quote on public.workspace_native_messages
for each row execute function communications_secure.encrypt_native_message_quote();

-- The return shape changes, so recreate these functions in this migration's
-- transaction. Preserve AAL2, membership, cleared-history and participant checks.
drop function public.communication_native_messages(uuid, uuid, integer);
drop function public.communication_native_message(uuid, uuid);

create or replace function public.communication_native_messages(
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
language sql
stable
security definer
set search_path = ''
as $$
    with readable as materialized (
        select
            message.*,
            decrypted.decrypted_secret as secret
        from public.workspace_native_messages message
        join public.workspace_native_conversations conversation on conversation.id = message.conversation_id
        left join communications_secure.content_keys content_key on content_key.id = message.body_key_id
        left join vault.decrypted_secrets decrypted on decrypted.id = content_key.vault_secret_id
        left join public.workspace_native_conversation_visibility visibility
          on visibility.conversation_id = message.conversation_id and visibility.user_id = auth.uid()
        where auth.role() = 'authenticated'
          and auth.uid() is not null
          and public.current_session_is_aal2()
          and message.workspace_id = p_workspace_id
          and (p_conversation_id is null or message.conversation_id = p_conversation_id)
          and (visibility.cleared_at is null or message.created_at > visibility.cleared_at)
          and (
              (conversation.kind = 'direct' and exists (
                  select 1 from public.workspace_native_conversation_participants participant
                  where participant.conversation_id = conversation.id and participant.user_id = auth.uid()
              ))
              or
              (conversation.kind = 'team' and exists (
                  select 1 from public.workspace_team_members team_member
                  where team_member.team_id = conversation.team_id and team_member.user_id = auth.uid()
              ))
          )
          and public.is_workspace_member(p_workspace_id)
    ), decoded as materialized (
        select
            message.*,
            communications_secure.try_decrypt_text(message.body_ciphertext, message.secret) as decrypted_body,
            communications_secure.try_decrypt_jsonb(message.attachment_ciphertext, message.secret) as decrypted_attachment,
            communications_secure.try_decrypt_jsonb(message.quote_ciphertext, message.secret) as decrypted_quote
        from readable message
    )
    select
        message.id,
        message.client_request_id,
        message.conversation_id,
        message.sender_user_id,
        message.sender_workspace_role,
        case when message.body_ciphertext is null then coalesce(message.body, '') else message.decrypted_body end,
        message.reply_to_message_id,
        case when message.attachment_ciphertext is null then message.attachment else message.decrypted_attachment end,
        message.created_at,
        message.decrypted_quote
    from decoded message
    where (message.body_ciphertext is null or message.decrypted_body is not null)
      and (message.attachment_ciphertext is null or message.decrypted_attachment is not null)
    order by message.created_at desc
    limit least(greatest(coalesce(p_limit, 4000), 1), 4000);
$$;

revoke all on function public.communication_native_messages(uuid, uuid, integer) from public, anon, service_role;
grant execute on function public.communication_native_messages(uuid, uuid, integer) to authenticated;

create or replace function public.communication_native_message(
    p_workspace_id uuid,
    p_message_id uuid
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
language sql
stable
security definer
set search_path = ''
as $$
    with readable as materialized (
        select
            message.*,
            decrypted.decrypted_secret as secret
        from public.workspace_native_messages message
        join public.workspace_native_conversations conversation on conversation.id = message.conversation_id
        left join communications_secure.content_keys content_key on content_key.id = message.body_key_id
        left join vault.decrypted_secrets decrypted on decrypted.id = content_key.vault_secret_id
        left join public.workspace_native_conversation_visibility visibility
          on visibility.conversation_id = message.conversation_id and visibility.user_id = auth.uid()
        where auth.role() = 'authenticated'
          and auth.uid() is not null
          and public.current_session_is_aal2()
          and public.is_workspace_member(p_workspace_id)
          and message.workspace_id = p_workspace_id
          and message.id = p_message_id
          and (visibility.cleared_at is null or message.created_at > visibility.cleared_at)
          and (
              (conversation.kind = 'direct' and exists (
                  select 1 from public.workspace_native_conversation_participants participant
                  where participant.conversation_id = conversation.id and participant.user_id = auth.uid()
              ))
              or
              (conversation.kind = 'team' and exists (
                  select 1 from public.workspace_team_members team_member
                  where team_member.team_id = conversation.team_id and team_member.user_id = auth.uid()
              ))
          )
    ), decoded as materialized (
        select
            message.*,
            communications_secure.try_decrypt_text(message.body_ciphertext, message.secret) as decrypted_body,
            communications_secure.try_decrypt_jsonb(message.attachment_ciphertext, message.secret) as decrypted_attachment,
            communications_secure.try_decrypt_jsonb(message.quote_ciphertext, message.secret) as decrypted_quote
        from readable message
    )
    select
        message.id,
        message.client_request_id,
        message.conversation_id,
        message.sender_user_id,
        message.sender_workspace_role,
        case when message.body_ciphertext is null then coalesce(message.body, '') else message.decrypted_body end,
        message.reply_to_message_id,
        case when message.attachment_ciphertext is null then message.attachment else message.decrypted_attachment end,
        message.created_at,
        message.decrypted_quote
    from decoded message
    where (message.body_ciphertext is null or message.decrypted_body is not null)
      and (message.attachment_ciphertext is null or message.decrypted_attachment is not null);
$$;

revoke all on function public.communication_native_message(uuid, uuid) from public, anon, service_role;
grant execute on function public.communication_native_message(uuid, uuid) to authenticated;

notify pgrst, 'reload schema';

commit;
