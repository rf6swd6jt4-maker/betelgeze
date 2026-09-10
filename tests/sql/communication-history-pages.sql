-- Isolated/staging database only. Requires an active sold test relationship and
-- an existing native conversation. No provider calls; all rows/keys roll back.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';
do $test$
declare
    relationship public.relationships%rowtype;
    first_id uuid;
    second_id uuid;
    newer_id uuid;
    older_id uuid;
    page jsonb;
    stamp timestamptz := clock_timestamp() + interval '1 hour';
    native_workspace uuid;
    native_conversation uuid;
    native_user uuid;
begin
    select * into strict relationship from public.relationships
    where source_metadata->>'is_test' = 'true' and status <> 'archived'
      and team_locked_at is not null and seller_user_id is not null
    order by created_at desc limit 1;
    insert into public.client_messages(workspace_id,relationship_id,direction,provider,body,status,sender_kind,raw_payload,created_at)
    values(relationship.workspace_id,relationship.id,'outbound','meta_whatsapp','History page one','sent','automation','{}',stamp)
    returning id into first_id;
    insert into public.client_messages(workspace_id,relationship_id,direction,provider,body,status,sender_kind,raw_payload,created_at)
    values(relationship.workspace_id,relationship.id,'outbound','meta_whatsapp','History page two','sent','automation','{}',stamp)
    returning id into second_id;
    newer_id := greatest(first_id, second_id);
    older_id := least(first_id, second_id);
    perform set_config('request.jwt.claims', jsonb_build_object('sub',relationship.seller_user_id,'role','authenticated','aal','aal2')::text, true);
    page := public.communication_client_message_page(relationship.workspace_id,relationship.id,null,null,1);
    assert jsonb_array_length(page->'messages')=1, 'Client page must be bounded';
    assert page->'messages'->0->>'id'=newer_id::text, 'Client timestamp ties must use deterministic IDs';
    assert (page->>'hasMore')::boolean, 'Client history has another page';
    assert page->'messages'->0->>'body' in ('History page one','History page two'), 'Client page must decrypt content';
    page := public.communication_client_message_page(relationship.workspace_id,relationship.id,(page->'nextBefore'->>'createdAt')::timestamptz,(page->'nextBefore'->>'id')::uuid,1);
    assert page->'messages'->0->>'id'=older_id::text, 'Cursor must not skip a timestamp tie or repeat a row';
    page := public.communication_client_message_page(relationship.workspace_id,relationship.id,stamp,null,1);
    assert jsonb_array_length(page->'messages')=0, 'Half a cursor must not restart history';
    perform set_config('request.jwt.claims', jsonb_build_object('sub',gen_random_uuid(),'role','authenticated','aal','aal2')::text, true);
    page := public.communication_client_message_page(relationship.workspace_id,relationship.id,null,null,100);
    assert jsonb_array_length(page->'messages')=0 and page->'nextBefore'='null'::jsonb and not (page->>'hasMore')::boolean, 'Nonparticipants cannot read even cursor metadata';
    perform set_config('request.jwt.claims', jsonb_build_object('sub',relationship.seller_user_id,'role','authenticated','aal','aal1')::text, true);
    page := public.communication_client_message_page(relationship.workspace_id,relationship.id,null,null,100);
    assert jsonb_array_length(page->'messages')=0, 'Client pages must enforce AAL2';

    select conversation.workspace_id, conversation.id, member.user_id into strict native_workspace,native_conversation,native_user
    from public.workspace_native_conversations conversation
    join public.workspace_memberships member on member.workspace_id=conversation.workspace_id
    where not coalesce(conversation.is_system,false) and (
      (conversation.kind='direct' and exists(select 1 from public.workspace_native_conversation_participants p where p.conversation_id=conversation.id and p.user_id=member.user_id))
      or (conversation.kind='team' and exists(select 1 from public.workspace_team_members m where m.team_id=conversation.team_id and m.user_id=member.user_id))
    )
    order by conversation.created_at desc limit 1;
    perform set_config('request.jwt.claims', jsonb_build_object('sub',native_user,'role','authenticated','aal','aal2')::text, true);
    insert into public.workspace_native_messages(workspace_id,conversation_id,sender_user_id,body,created_at)
    values(native_workspace,native_conversation,native_user,'Native history page one',stamp) returning id into first_id;
    insert into public.workspace_native_messages(workspace_id,conversation_id,sender_user_id,body,created_at)
    values(native_workspace,native_conversation,native_user,'Native history page two',stamp) returning id into second_id;
    newer_id := greatest(first_id, second_id);
    older_id := least(first_id, second_id);
    perform set_config('request.jwt.claims', jsonb_build_object('sub',native_user,'role','authenticated','aal','aal2')::text, true);
    page := public.communication_native_message_page(native_workspace,native_conversation,null,null,1);
    assert jsonb_array_length(page->'messages')=1 and page->'messages'->0->>'id'=newer_id::text, 'Native page order is bounded and deterministic';
    assert page->'messages'->0->>'body' in ('Native history page one','Native history page two'), 'Native page must decrypt content';
    page := public.communication_native_message_page(native_workspace,native_conversation,(page->'nextBefore'->>'createdAt')::timestamptz,(page->'nextBefore'->>'id')::uuid,1);
    assert page->'messages'->0->>'id'=older_id::text, 'Native cursor must retain timestamp ties';
    insert into public.workspace_native_conversation_visibility(workspace_id,conversation_id,user_id,cleared_at)
    values(native_workspace,native_conversation,native_user,stamp)
    on conflict(conversation_id,user_id) do update set cleared_at=excluded.cleared_at;
    page := public.communication_native_message_page(native_workspace,native_conversation,null,null,100);
    assert not exists(select 1 from jsonb_array_elements(page->'messages') message where message->>'id' in (first_id::text,second_id::text)), 'Cleared messages must not reappear through pagination';
    perform set_config('request.jwt.claims', jsonb_build_object('sub',gen_random_uuid(),'role','authenticated','aal','aal2')::text, true);
    page := public.communication_native_message_page(native_workspace,native_conversation,null,null,100);
    assert jsonb_array_length(page->'messages')=0 and page->'nextBefore'='null'::jsonb, 'Native pages must not leak to nonparticipants';
end;
$test$;
select 'PASS: bounded encrypted history, tuple cursors, participant/AAL2 checks and cleared-history isolation' as result;
rollback;
