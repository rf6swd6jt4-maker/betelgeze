-- Appointment onboarding offers five optional information fields. Remove the
-- legacy four-field ceiling while preserving per-block option allow-lists.

alter table public.relationship_appointment_setting_configs
    drop constraint if exists relationship_appointment_setting_configs_requested_fields_check;
alter table public.relationship_appointment_setting_configs
    add constraint relationship_appointment_setting_configs_requested_fields_check
    check (jsonb_typeof(requested_fields) = 'array' and jsonb_array_length(requested_fields) <= 5);

do $$
declare
    v_definition text;
    v_updated text;
begin
    select pg_get_functiondef('public.validate_onboarding_module_definition(jsonb)'::regprocedure)
    into v_definition;
    v_updated := replace(v_definition, 'not between 1 and 4', 'not between 1 and 5');
    v_updated := replace(v_updated, 'one to four extra fields', 'one to five extra fields');
    if v_updated = v_definition then
        raise exception 'Expected Appointment information validator ceiling was not found';
    end if;
    execute v_updated;

    select pg_get_functiondef('public.configure_appointment_setting_onboarding_block(text,uuid,jsonb)'::regprocedure)
    into v_definition;
    v_updated := replace(
        v_definition,
        'jsonb_array_length(p_configuration->''fields'') > least(4, coalesce((v_block.definition->>''maximumFields'')::integer, 4))',
        'jsonb_array_length(p_configuration->''fields'') > jsonb_array_length(v_block.definition->''options'')'
    );
    if v_updated = v_definition then
        raise exception 'Expected Appointment information runtime ceiling was not found';
    end if;
    execute v_updated;
end;
$$;
