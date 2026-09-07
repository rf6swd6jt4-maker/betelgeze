-- Appointment setters build incomplete drafts, then submit one immutable client-facing
-- appointment and one idempotent Communications automation together.

alter table public.appointment_setting_appointments
    alter column contact_name drop not null,
    alter column appointment_at drop not null,
    add column if not exists appointment_date date,
    add column if not exists appointment_time time without time zone,
    add column if not exists workflow_status text not null default 'draft',
    add column if not exists submitted_at timestamptz,
    add column if not exists submitted_by uuid references auth.users(id) on delete set null,
    add column if not exists submission_message_id uuid references public.client_messages(id) on delete set null;

update public.appointment_setting_appointments
set
    appointment_date = coalesce(appointment_date, (
        appointment_at at time zone case
            when exists (select 1 from pg_timezone_names zone where zone.name = appointment_timezone) then appointment_timezone
            else 'UTC'
        end
    )::date),
    appointment_time = coalesce(appointment_time, (
        appointment_at at time zone case
            when exists (select 1 from pg_timezone_names zone where zone.name = appointment_timezone) then appointment_timezone
            else 'UTC'
        end
    )::time),
    workflow_status = 'submitted',
    submitted_at = coalesce(submitted_at, created_at),
    submitted_by = coalesce(submitted_by, updated_by, created_by)
where appointment_at is not null
  and workflow_status = 'draft';

alter table public.appointment_setting_appointments
    drop constraint if exists appointment_setting_appointments_workflow_status_check,
    add constraint appointment_setting_appointments_workflow_status_check
        check (workflow_status in ('draft', 'submitted')),
    drop constraint if exists appointment_setting_appointments_submission_check,
    add constraint appointment_setting_appointments_submission_check check (
        workflow_status = 'draft'
        or (
            nullif(btrim(coalesce(contact_name, '')), '') is not null
            and appointment_at is not null
            and appointment_date is not null
            and appointment_time is not null
            and submitted_at is not null
        )
    ),
    drop constraint if exists appointment_setting_appointments_remote_link_check,
    add constraint appointment_setting_appointments_remote_link_check check (
        workflow_status = 'draft'
        or meeting_medium = 'phone'
        or meeting_link is not null
    );

create index if not exists appointment_setting_appointments_workflow_idx
on public.appointment_setting_appointments(workspace_id, relationship_id, workflow_status, appointment_at, created_at);

create unique index if not exists appointment_setting_appointments_submission_message_unique
on public.appointment_setting_appointments(submission_message_id)
where submission_message_id is not null;

create or replace function public.validate_appointment_setting_appointment_configuration()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
    v_config public.relationship_appointment_setting_configs%rowtype;
    v_field jsonb;
    v_value text;
begin
    if new.workflow_status = 'draft' then return new; end if;
    if nullif(btrim(coalesce(new.contact_name, '')), '') is null
       or new.appointment_date is null
       or new.appointment_time is null
       or new.appointment_at is null then
        raise exception using errcode = '23514', message = 'Complete the appointment name, date, and time before submitting.';
    end if;
    select config.* into v_config from public.relationship_appointment_setting_configs config
    where config.workspace_id = new.workspace_id and config.relationship_id = new.relationship_id and config.service_id = new.service_id;
    if v_config.workspace_id is null then
        if new.meeting_medium <> 'phone' or nullif(btrim(coalesce(new.phone, '')), '') is null then
            raise exception using errcode = '23514', message = 'Appointment does not match the client configuration.';
        end if;
        return new;
    end if;
    if not (new.meeting_medium = any(v_config.mediums)) then raise exception using errcode = '23514', message = 'Appointment medium is not available for this client.'; end if;
    for v_field in select value from jsonb_array_elements(v_config.requested_fields) loop
        if coalesce((v_field->>'required')::boolean, false) then
            v_value := case when v_field->>'key' = 'phone' then new.phone else new.details->>(v_field->>'key') end;
            if nullif(btrim(coalesce(v_value, '')), '') is null then raise exception using errcode = '23514', message = 'Appointment is missing required client information.'; end if;
        end if;
    end loop;
    return new;
end;
$$;

drop trigger if exists validate_appointment_setting_appointment_configuration on public.appointment_setting_appointments;
create trigger validate_appointment_setting_appointment_configuration
before insert or update of workspace_id, relationship_id, service_id, contact_name, phone, appointment_at,
    appointment_date, appointment_time, meeting_medium, meeting_link, details, workflow_status
on public.appointment_setting_appointments
for each row execute function public.validate_appointment_setting_appointment_configuration();

create or replace function public.submit_appointment_setting_appointment(
    p_workspace_id uuid,
    p_relationship_id uuid,
    p_service_id uuid,
    p_appointment_id uuid,
    p_user_id uuid,
    p_expected_updated_at timestamptz,
    p_communication_channel_id uuid,
    p_provider text,
    p_to_address text,
    p_body text
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
    v_appointment public.appointment_setting_appointments%rowtype;
    v_client_id uuid;
    v_message_id uuid;
begin
    if current_user <> 'service_role' then raise exception using errcode = '42501', message = 'Trusted Appointment Setting runtime required'; end if;
    select appointment.* into v_appointment
    from public.appointment_setting_appointments appointment
    where appointment.workspace_id = p_workspace_id
      and appointment.relationship_id = p_relationship_id
      and appointment.service_id = p_service_id
      and appointment.id = p_appointment_id
    for update;
    if v_appointment.id is null then raise exception using errcode = 'P0002', message = 'Appointment draft not found.'; end if;
    if v_appointment.workflow_status = 'submitted' then
        return jsonb_build_object('appointment', to_jsonb(v_appointment), 'message_id', v_appointment.submission_message_id, 'already_submitted', true);
    end if;
    if p_expected_updated_at is null or v_appointment.updated_at <> p_expected_updated_at then
        raise exception using errcode = '40001', message = 'This draft changed. Review its latest details before submitting.';
    end if;
    if not public.workspace_user_can_manage_appointment_setting(p_workspace_id, p_relationship_id, p_service_id, p_user_id) then
        raise exception using errcode = '42501', message = 'Appointment Setting access is required.';
    end if;
    if not exists (select 1 from pg_timezone_names where name = v_appointment.appointment_timezone) then
        raise exception using errcode = '23514', message = 'Choose a valid appointment timezone.';
    end if;
    if (((v_appointment.appointment_date + v_appointment.appointment_time) at time zone v_appointment.appointment_timezone) at time zone v_appointment.appointment_timezone)
       is distinct from (v_appointment.appointment_date + v_appointment.appointment_time) then
        raise exception using errcode = '23514', message = 'This local time does not exist because of daylight saving. Choose another time.';
    end if;
    select relationship.client_id into v_client_id
    from public.relationships relationship
    where relationship.workspace_id = p_workspace_id and relationship.id = p_relationship_id and relationship.status <> 'archived' and relationship.lifecycle_phase = 'retention';
    if not found then raise exception using errcode = 'P0002', message = 'Relationship not found.'; end if;
    if p_provider not in ('meta_whatsapp', 'twilio_sms', 'omnichannel')
       or nullif(btrim(coalesce(p_to_address, '')), '') is null
       or nullif(btrim(coalesce(p_body, '')), '') is null then
        raise exception using errcode = '22023', message = 'Appointment notification destination is incomplete.';
    end if;

    insert into public.client_messages (
        workspace_id, relationship_id, client_id, communication_channel_id,
        direction, provider, to_address, body, status, sender_kind,
        automation_kind, automation_label, client_request_id, raw_payload
    ) values (
        p_workspace_id, p_relationship_id, v_client_id, p_communication_channel_id,
        'outbound', p_provider, p_to_address, p_body, 'sending', 'automation',
        'appointment_submitted', 'New appointment', p_appointment_id,
        jsonb_build_object('appointment_id', p_appointment_id, 'kind', 'appointment_submitted')
    )
    returning id into v_message_id;

    update public.appointment_setting_appointments appointment
    set
        appointment_at = (appointment.appointment_date + appointment.appointment_time) at time zone appointment.appointment_timezone,
        workflow_status = 'submitted',
        submitted_at = now(),
        submitted_by = p_user_id,
        submission_message_id = v_message_id,
        updated_by = p_user_id
    where appointment.workspace_id = p_workspace_id and appointment.id = p_appointment_id
    returning appointment.* into v_appointment;

    return jsonb_build_object('appointment', to_jsonb(v_appointment), 'message_id', v_message_id, 'already_submitted', false);
end;
$$;

revoke all on function public.submit_appointment_setting_appointment(uuid, uuid, uuid, uuid, uuid, timestamptz, uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.submit_appointment_setting_appointment(uuid, uuid, uuid, uuid, uuid, timestamptz, uuid, text, text, text) to service_role;
