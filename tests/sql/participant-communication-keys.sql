-- Run against an active sold test relationship after the key migration.
-- No external messages or uploads; every fixture and key is rolled back.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';
do $test$
declare
    r public.relationships%rowtype;
    message_id uuid;
    outsider uuid;
    file_path text;
    file_key text;
    actual_key text;
begin
    select * into strict r from public.relationships
    where source_metadata->>'is_test' = 'true' and status <> 'archived'
      and team_locked_at is not null and seller_user_id is not null
    order by created_at desc limit 1;
    select user_id into strict outsider from public.workspace_memberships
    where workspace_id = r.workspace_id
      and not public.client_conversation_can_access(r.workspace_id, r.id, user_id)
    limit 1;

    insert into public.client_messages(workspace_id,relationship_id,direction,provider,body,status,sender_kind,raw_payload)
    values(r.workspace_id,r.id,'outbound','meta_whatsapp','Rollback-only encrypted confirmation','sent','automation','{"regression":"participant-keys"}')
    returning id into message_id;
    assert exists(select 1 from public.client_messages where id=message_id and body is null and body_ciphertext is not null), 'Fixture was not encrypted';

    perform set_config('request.jwt.claims', jsonb_build_object('sub',r.seller_user_id,'role','authenticated','aal','aal2')::text, true);
    assert exists(select 1 from public.communication_client_message(r.workspace_id,message_id)
        where body='Rollback-only encrypted confirmation' and raw_payload->>'regression'='participant-keys'), 'Seller cannot read encrypted message and payload';
    assert exists(select 1 from public.communication_client_messages(r.workspace_id,r.id,500) where id=message_id), 'Conversation list drops encrypted messages';
    assert exists(select 1 from public.client_conversation_rosters(r.workspace_id,r.seller_user_id) where relationship_id=r.id), 'Seller roster is missing the client';

    file_path := r.workspace_id::text || '/regression-' || gen_random_uuid()::text;
    file_key := public.communication_create_file_key(r.workspace_id,'client',r.id,file_path);
    select d.decrypted_secret into actual_key from communications_secure.encrypted_files f
    join vault.decrypted_secrets d on d.id=f.vault_secret_id where f.storage_path=file_path;
    assert file_key=actual_key and public.communication_file_key_for_user(file_path)=actual_key, 'File key differs from usable Vault key';

    if r.fulfilment_manager_user_id is not null then
        perform set_config('request.jwt.claims', jsonb_build_object('sub',r.fulfilment_manager_user_id,'role','authenticated','aal','aal2')::text, true);
        assert exists(select 1 from public.communication_client_message(r.workspace_id,message_id)), 'Manager cannot read encrypted message';
    end if;
    perform set_config('request.jwt.claims', jsonb_build_object('sub',outsider,'role','authenticated','aal','aal2')::text, true);
    assert not exists(select 1 from public.communication_client_message(r.workspace_id,message_id)), 'Nonparticipant can read encrypted message';
    assert not exists(select 1 from public.communication_client_messages(r.workspace_id,r.id,500)), 'Nonparticipant can read conversation history';
    assert public.communication_file_key_for_user(file_path) is null, 'Nonparticipant can read file key';

    perform set_config('request.jwt.claims', jsonb_build_object('sub',r.seller_user_id,'role','authenticated','aal','aal1')::text, true);
    assert not exists(select 1 from public.communication_client_message(r.workspace_id,message_id)), 'AAL1 bypassed message protection';
end;
$test$;
select 'PASS: encrypted messages, payloads, roster and file keys work for participants; nonparticipants and AAL1 stay blocked' as result;
rollback;
