-- The delivery-team migration redefined these RPCs from a version preceding
-- 20260821234500. Keep the participant checks and restore the usable Vault key.
begin;

do $migration$
declare
    signature text;
    definition text;
begin
    foreach signature in array array[
        'public.communication_client_messages(uuid,uuid,integer)',
        'public.communication_client_message(uuid,uuid)',
        'public.communication_create_file_key(uuid,text,uuid,text)',
        'public.communication_file_key_for_user(text)'
    ] loop
        definition := pg_get_functiondef(signature::regprocedure);
        if position('decrypted.secret' in definition) = 0
           or position('client_conversation_can_access' in definition) = 0 then
            raise exception 'Expected participant-scoped Vault lookup missing: %', signature;
        end if;
        execute replace(definition, 'decrypted.secret', 'decrypted.decrypted_secret');
    end loop;
end;
$migration$;

notify pgrst, 'reload schema';
commit;
