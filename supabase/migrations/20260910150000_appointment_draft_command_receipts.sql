-- Expand-only migration. Deploy before enabling the HTTP draft command path.
-- Receipts contain no field values; the currently authorized record is returned
-- on replay. Old clients may continue using the existing conditional update.
create table if not exists public.appointment_draft_command_receipts (
    workspace_id uuid not null references public.workspaces(id) on delete cascade,
    user_id uuid not null references auth.users(id) on delete cascade,
    request_id uuid not null,
    appointment_id uuid not null references public.appointment_setting_appointments(id) on delete cascade,
    request_hash text not null check (request_hash ~ '^[0-9a-f]{64}$'),
    committed_updated_at timestamptz not null,
    created_at timestamptz not null default now(),
    primary key (workspace_id, user_id, request_id)
);
alter table public.appointment_draft_command_receipts enable row level security;
revoke all on public.appointment_draft_command_receipts from public, anon, authenticated;
grant select, insert, delete on public.appointment_draft_command_receipts to service_role;
create index if not exists appointment_draft_command_receipts_created_idx
    on public.appointment_draft_command_receipts(created_at);

-- Every writer, including legacy actions, advances the version even when two
-- edits occur inside one transaction (now() would otherwise be unchanged).
create or replace function public.set_appointment_setting_updated_at()
returns trigger language plpgsql set search_path = public as $$
begin
    new.updated_at := greatest(clock_timestamp(), old.updated_at + interval '1 microsecond');
    return new;
end;
$$;
drop trigger if exists appointment_setting_appointments_updated_at on public.appointment_setting_appointments;
create trigger appointment_setting_appointments_updated_at
before update on public.appointment_setting_appointments
for each row execute function public.set_appointment_setting_updated_at();

create or replace function public.save_appointment_setting_draft_command(
    p_workspace_id uuid,
    p_relationship_id uuid,
    p_service_id uuid,
    p_appointment_id uuid,
    p_user_id uuid,
    p_expected_updated_at timestamptz,
    p_request_id uuid,
    p_request_hash text,
    p_changes jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
    v_appointment public.appointment_setting_appointments%rowtype;
    v_receipt public.appointment_draft_command_receipts%rowtype;
    v_patch public.appointment_setting_appointments%rowtype;
begin
    if current_user <> 'service_role' then raise exception using errcode = '42501', message = 'Trusted Appointment Setting runtime required'; end if;
    if not public.workspace_user_can_manage_appointment_setting(p_workspace_id, p_relationship_id, p_service_id, p_user_id)
       or not exists (select 1 from public.relationships where workspace_id = p_workspace_id and id = p_relationship_id and status <> 'archived' and lifecycle_phase = 'retention') then
        raise exception using errcode = '42501', message = 'Appointment Setting access is required.';
    end if;
    if p_request_id is null or p_request_hash is null or p_request_hash !~ '^[0-9a-f]{64}$' or p_expected_updated_at is null then
        raise exception using errcode = '22023', message = 'Draft command identity is required.';
    end if;
    -- The row lock orders new saves and replays for this appointment. Receipt
    -- insertion and the conditional edit commit together, including on a retry.
    select * into v_appointment from public.appointment_setting_appointments
    where workspace_id = p_workspace_id and relationship_id = p_relationship_id
      and service_id = p_service_id and id = p_appointment_id for update;
    if not found then raise exception using errcode = 'P0002', message = 'Appointment draft not found.'; end if;
    select * into v_receipt from public.appointment_draft_command_receipts
    where workspace_id = p_workspace_id and user_id = p_user_id and request_id = p_request_id;
    if found then
        if v_receipt.appointment_id <> p_appointment_id or v_receipt.request_hash <> p_request_hash then
            raise exception using errcode = '22023', message = 'Draft command identity was reused for different changes.';
        end if;
        return jsonb_build_object('appointment', to_jsonb(v_appointment), 'version', v_receipt.committed_updated_at, 'replayed', true);
    end if;
    if v_appointment.workflow_status <> 'draft' or v_appointment.updated_at <> p_expected_updated_at then
        raise exception using errcode = '40001', message = 'This draft changed. Review its latest details and try again.';
    end if;
    if p_changes is null or jsonb_typeof(p_changes) <> 'object'
       or exists (select 1 from jsonb_object_keys(p_changes) as keys(key) where key not in ('contact_name', 'phone', 'appointment_date', 'appointment_time', 'appointment_timezone', 'meeting_medium', 'meeting_link', 'details', 'updated_by')) then
        raise exception using errcode = '22023', message = 'Invalid draft column changes.';
    end if;
    -- Application validation has normalized fields against the current client
    -- configuration. Never allow a JSON patch to change ownership/workflow.
    select * into v_patch from jsonb_populate_record(v_appointment, p_changes);
    update public.appointment_setting_appointments set
        contact_name = v_patch.contact_name, phone = v_patch.phone,
        appointment_date = v_patch.appointment_date, appointment_time = v_patch.appointment_time,
        appointment_timezone = v_patch.appointment_timezone, meeting_medium = v_patch.meeting_medium,
        meeting_link = case when v_patch.meeting_medium = 'phone' then null else v_patch.meeting_link end,
        details = v_patch.details, updated_by = p_user_id,
        updated_at = greatest(clock_timestamp(), v_appointment.updated_at + interval '1 microsecond')
    where workspace_id = p_workspace_id and id = p_appointment_id
    returning * into v_appointment;
    insert into public.appointment_draft_command_receipts(workspace_id, user_id, request_id, appointment_id, request_hash, committed_updated_at)
    values(p_workspace_id, p_user_id, p_request_id, p_appointment_id, p_request_hash, v_appointment.updated_at);
    return jsonb_build_object('appointment', to_jsonb(v_appointment), 'version', v_appointment.updated_at, 'replayed', false);
end;
$$;
revoke all on function public.save_appointment_setting_draft_command(uuid, uuid, uuid, uuid, uuid, timestamptz, uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.save_appointment_setting_draft_command(uuid, uuid, uuid, uuid, uuid, timestamptz, uuid, text, jsonb) to service_role;
