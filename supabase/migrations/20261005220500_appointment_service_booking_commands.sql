-- Current service responsibility authorizes bookings independently of the
-- relationship's aggregate lifecycle. The canonical access predicate already
-- checks an active relationship and a Setup/Maintenance service (or eligible
-- legacy Retention assignment). Keep draft receipts and submission delivery
-- unchanged; remove only the two obsolete, additional Retention gates.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '15s';

do $$
declare
    definition text;
    old_clause text;
begin
    definition := pg_get_functiondef('public.save_appointment_setting_draft_command(uuid,uuid,uuid,uuid,uuid,timestamptz,uuid,text,jsonb)'::regprocedure);
    old_clause := ' and lifecycle_phase = ''retention''';
    if (length(definition) - length(replace(definition, old_clause, ''))) / length(old_clause) <> 1
       or position('public.workspace_user_can_manage_appointment_setting(p_workspace_id, p_relationship_id, p_service_id, p_user_id)' in definition) = 0 then
        raise exception 'Unexpected Appointment Setting draft access definition';
    end if;
    execute replace(definition, old_clause, '');

    -- The installed submit function includes the later client_portal provider
    -- addition. Replace its access clause in place to retain that definition,
    -- encrypted-message triggers, replay, and the queued submission wrapper.
    definition := pg_get_functiondef('public.submit_appointment_setting_appointment(uuid,uuid,uuid,uuid,uuid,timestamptz,uuid,text,text,text)'::regprocedure);
    old_clause := ' and relationship.lifecycle_phase = ''retention''';
    if (length(definition) - length(replace(definition, old_clause, ''))) / length(old_clause) <> 1
       or position('public.workspace_user_can_manage_appointment_setting(p_workspace_id, p_relationship_id, p_service_id, p_user_id)' in definition) = 0
       or position('''omnichannel'', ''client_portal''' in definition) = 0 then
        raise exception 'Unexpected Appointment Setting submission access definition';
    end if;
    execute replace(definition, old_clause, '');
end;
$$;

notify pgrst, 'reload schema';
commit;
