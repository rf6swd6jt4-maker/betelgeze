-- Isolated, rollback-only fixture check. No external integrations are called.
begin;
set local role service_role;
do $$
declare
    row public.relationships%rowtype; actor uuid; request_id uuid := gen_random_uuid();
    first_result jsonb; repeated_result jsonb; conflicting_result jsonb;
    values_json jsonb := '{"primaryPersonName":"Fixture name","businessName":"Fixture business","primaryContactRole":"Owner","primaryPhone":"5551234567","whatsappPhone":"5551234567","communicationPrimaryProvider":"meta_whatsapp","communicationDeliveryMode":"mirror","primaryEmail":"fixture@example.invalid","description":"Fixture notes"}';
begin
    if has_function_privilege('authenticated','public.save_relationship_background_command(uuid,uuid,uuid,timestamptz,uuid,text,jsonb)','execute')
       or has_function_privilege('anon','public.save_relationship_background_command(uuid,uuid,uuid,timestamptz,uuid,text,jsonb)','execute')
       or has_table_privilege('authenticated','public.relationship_background_command_receipts','select') then raise exception 'Background commands must remain private'; end if;
    select r.* into strict row from public.relationships r join public.workspace_memberships m on m.workspace_id=r.workspace_id and m.role='owner' limit 1;
    select user_id into strict actor from public.workspace_memberships where workspace_id=row.workspace_id and role='owner' limit 1;
    first_result := public.save_relationship_background_command(row.workspace_id,row.id,actor,row.updated_at,request_id,repeat('a',64),values_json);
    repeated_result := public.save_relationship_background_command(row.workspace_id,row.id,actor,row.updated_at,request_id,repeat('a',64),values_json);
    if first_result->>'ok'<>'true' or first_result->>'version'<>repeated_result->>'version' or repeated_result->'values'->>'primaryPersonName'<>'Fixture name'
       or (select count(*) from public.relationship_background_command_receipts where relationship_id=row.id)<>1 then raise exception 'Expected one background commit and a stable replay'; end if;
    conflicting_result := public.save_relationship_background_command(row.workspace_id,row.id,actor,row.updated_at,gen_random_uuid(),repeat('b',64),values_json);
    if conflicting_result->>'ok'<>'false' or conflicting_result->>'conflict'<>'true' or conflicting_result->>'version'<>first_result->>'version' then raise exception 'Stale command did not return current authority'; end if;
    begin
        perform public.save_relationship_background_command(row.workspace_id,row.id,actor,row.updated_at,request_id,repeat('c',64),values_json);
        raise exception 'Changed payload reused a request ID';
    exception when invalid_parameter_value then null;
    end;
    begin
        perform public.save_relationship_background_command(row.workspace_id,row.id,gen_random_uuid(),row.updated_at,request_id,repeat('a',64),values_json);
        raise exception 'Unauthorized actor could replay a saved command';
    exception when insufficient_privilege then null;
    end;
    update public.relationships set primary_person_name='Later remote edit' where workspace_id=row.workspace_id and id=row.id;
    repeated_result := public.save_relationship_background_command(row.workspace_id,row.id,actor,row.updated_at,request_id,repeat('a',64),values_json);
    if repeated_result->'values'->>'primaryPersonName'<>'Later remote edit'
       or repeated_result->>'version'<>first_result->>'version'
       or (repeated_result->>'currentVersion')::timestamptz <= (repeated_result->>'version')::timestamptz then raise exception 'Replay erased or hid a later writer'; end if;
end;
$$;
rollback;
select true as relationship_background_command_checks_passed_and_rolled_back;
