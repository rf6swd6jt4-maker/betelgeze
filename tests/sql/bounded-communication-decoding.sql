-- Append inside the full-schema rollback harness, after its synthetic fixture.
-- Requires pg_temp.performance_rollout_fixture; no real workspace/record is used.
-- Existing message encryption, conversation-touch and quote triggers execute.
-- No provider send functions, queue worker, HTTP extension or storage upload is
-- called. The outer harness must first audit unexpected/custom external triggers.
do $bounded_test$
declare
    fixture record;
    native_id uuid;
    native_original uuid;
    client_tie_one uuid;
    client_tie_two uuid;
    native_tie_one uuid;
    native_tie_two uuid;
    stamp timestamptz := clock_timestamp() + interval '3 hours';
    old_rows jsonb;
    bounded_rows jsonb;
    first_id uuid;
begin
    select * into strict fixture from pg_temp.performance_rollout_fixture;
    perform set_config('request.jwt.claims', jsonb_build_object('sub',fixture.owner_id,'role','authenticated','aal','aal2')::text,true);

    insert into public.client_messages(workspace_id,relationship_id,direction,provider,body,status,sender_kind,raw_payload,created_at)
    select fixture.workspace_id,fixture.relationship_id,'inbound','meta_whatsapp','Client bounded fixture '||item,'received','client',jsonb_build_object('fixture','bounded decoder','ordinal',item),stamp + item * interval '1 second'
    from generate_series(1,260) item;
    -- Test the same filtering as the established decryptors. Updating only the
    -- ciphertext does not invoke encryption again; every modified row is ours.
    update public.client_messages set body_ciphertext='invalid-fixture-ciphertext'::bytea
    where workspace_id=fixture.workspace_id and relationship_id=fixture.relationship_id
      and created_at between stamp + interval '254 seconds' and stamp + interval '260 seconds';
    insert into public.client_messages(workspace_id,relationship_id,direction,provider,body,status,sender_kind,raw_payload,created_at)
    values(fixture.workspace_id,fixture.relationship_id,'inbound','meta_whatsapp','Client timestamp tie one','received','client','{}',stamp + interval '1000 seconds') returning id into client_tie_one;
    insert into public.client_messages(workspace_id,relationship_id,direction,provider,body,status,sender_kind,raw_payload,created_at)
    values(fixture.workspace_id,fixture.relationship_id,'inbound','meta_whatsapp','Client timestamp tie two','received','client','{}',stamp + interval '1000 seconds') returning id into client_tie_two;

    select jsonb_agg(to_jsonb(message) order by message.created_at desc,message.id desc) into old_rows
    from public.communication_client_messages(fixture.workspace_id,fixture.relationship_id,200) message;
    select jsonb_agg(to_jsonb(message) order by message.created_at desc,message.id desc) into bounded_rows
    from public.communication_client_messages_bounded(fixture.workspace_id,fixture.relationship_id,200) message;
    assert jsonb_array_length(bounded_rows)=200 and bounded_rows=old_rows,'Client bounded rows must preserve decrypted bodies, payloads and corrupt-row skipping';
    select message.id into first_id from public.communication_client_messages_bounded(fixture.workspace_id,fixture.relationship_id,1) message;
    assert first_id=greatest(client_tie_one,client_tie_two),'Client timestamp ties must be stable by ID';

    insert into public.workspace_native_conversations(workspace_id,kind,direct_user_one,direct_user_two,created_by)
    values(fixture.workspace_id,'direct',least(fixture.owner_id,fixture.setter_id),greatest(fixture.owner_id,fixture.setter_id),fixture.owner_id)
    returning id into native_id;
    insert into public.workspace_native_messages(workspace_id,conversation_id,sender_user_id,body,created_at)
    values(fixture.workspace_id,native_id,fixture.owner_id,'Native original fixture',stamp) returning id into native_original;
    insert into public.workspace_native_messages(workspace_id,conversation_id,sender_user_id,body,reply_to_message_id,attachment,quote,created_at)
    select fixture.workspace_id,native_id,fixture.owner_id,'Native bounded fixture '||item,native_original,
        jsonb_build_object('kind','document','fileName','Fixture.txt','storagePath','synthetic-fixture-only'),
        jsonb_build_object('text','Native','start',0,'end',6),stamp + item * interval '1 second'
    from generate_series(1,260) item;
    update public.workspace_native_messages set attachment_ciphertext='invalid-fixture-ciphertext'::bytea
    where workspace_id=fixture.workspace_id and conversation_id=native_id
      and created_at between stamp + interval '254 seconds' and stamp + interval '260 seconds';
    insert into public.workspace_native_messages(workspace_id,conversation_id,sender_user_id,body,created_at)
    values(fixture.workspace_id,native_id,fixture.owner_id,'Native timestamp tie one',stamp + interval '1000 seconds') returning id into native_tie_one;
    insert into public.workspace_native_messages(workspace_id,conversation_id,sender_user_id,body,created_at)
    values(fixture.workspace_id,native_id,fixture.owner_id,'Native timestamp tie two',stamp + interval '1000 seconds') returning id into native_tie_two;
    select jsonb_agg(to_jsonb(message) order by message.created_at desc,message.id desc) into old_rows
    from public.communication_native_messages(fixture.workspace_id,native_id,200) message;
    select jsonb_agg(to_jsonb(message) order by message.created_at desc,message.id desc) into bounded_rows
    from public.communication_native_messages_bounded(fixture.workspace_id,native_id,200) message;
    assert jsonb_array_length(bounded_rows)=200 and bounded_rows=old_rows,'Native bounded rows must preserve encrypted bodies, attachments, quotes and corrupt-row skipping';
    select message.id into first_id from public.communication_native_messages_bounded(fixture.workspace_id,native_id,1) message;
    assert first_id=greatest(native_tie_one,native_tie_two),'Native timestamp ties must be stable by ID';

    insert into public.workspace_native_conversation_visibility(workspace_id,conversation_id,user_id,cleared_at)
    values(fixture.workspace_id,native_id,fixture.owner_id,stamp + interval '250 seconds');
    assert (select count(*) from public.communication_native_messages_bounded(fixture.workspace_id,native_id,100))=5,'Cleared or corrupt history must remain excluded';
    perform set_config('request.jwt.claims', jsonb_build_object('sub',fixture.outsider_id,'role','authenticated','aal','aal2')::text,true);
    assert not exists(select 1 from public.communication_client_messages_bounded(fixture.workspace_id,fixture.relationship_id,100)),'Client bounded decoder must deny nonparticipants';
    assert not exists(select 1 from public.communication_native_messages_bounded(fixture.workspace_id,native_id,100)),'Native bounded decoder must deny nonparticipants';
    perform set_config('request.jwt.claims', jsonb_build_object('sub',fixture.owner_id,'role','authenticated','aal','aal1')::text,true);
    assert not exists(select 1 from public.communication_client_messages_bounded(fixture.workspace_id,fixture.relationship_id,100)),'Client bounded decoder must enforce AAL2';
    assert not exists(select 1 from public.communication_native_messages_bounded(fixture.workspace_id,native_id,100)),'Native bounded decoder must enforce AAL2';
    perform set_config('request.jwt.claims', jsonb_build_object('sub',fixture.owner_id,'role','authenticated','aal','aal2')::text,true);
end;
$bounded_test$;
select 'PASS: bounded decoder encrypted parity, corrupt-row continuation, timestamp ties, cleared history and access checks' as result;
