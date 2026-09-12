-- Release the existing relationship-scoped integration to all active portals.
-- Keep the session, workspace, archival, encryption and service-role checks intact.
do $$
declare
    definition text;
    test_guard text := ' and r.source_metadata->''is_test'' = ''true''::jsonb';
begin
    definition := pg_get_functiondef('public.client_portal_ghl(text,uuid,text,uuid,text,text,text,jsonb,text)'::regprocedure);
    if strpos(definition, test_guard) = 0 then
        raise exception 'Expected GHL rollout guard was not found; review the installed function before releasing';
    end if;
    execute replace(definition, test_guard, '');
end;
$$;
notify pgrst, 'reload schema';
