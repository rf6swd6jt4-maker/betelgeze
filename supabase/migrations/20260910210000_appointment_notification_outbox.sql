-- Atomic appointment + encrypted message + delivery job. Existing synchronous
-- submission remains available; never enqueue a job for its historical replay.
create table if not exists public.appointment_notification_outbox (
    id uuid primary key default gen_random_uuid(),
    workspace_id uuid not null references public.workspaces(id) on delete cascade,
    relationship_id uuid not null,
    appointment_id uuid not null unique references public.appointment_setting_appointments(id) on delete cascade,
    message_id uuid not null unique references public.client_messages(id) on delete cascade,
    actor_user_id uuid references auth.users(id) on delete set null,
    status text not null default 'queued' check (status in ('queued','processing','dispatched','sent','failed','uncertain')),
    lease_token uuid,
    lease_expires_at timestamptz,
    attempt_count integer not null default 0,
    error_summary text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    foreign key(workspace_id, relationship_id) references public.relationships(workspace_id, id) on delete cascade
);
alter table public.appointment_notification_outbox enable row level security;
revoke all on public.appointment_notification_outbox from public, anon, authenticated;
grant all on public.appointment_notification_outbox to service_role;
create index if not exists appointment_notification_outbox_pending_idx on public.appointment_notification_outbox(status, created_at)
where status in ('queued','processing','dispatched');

create or replace function public.submit_appointment_setting_appointment_queued(
    p_workspace_id uuid, p_relationship_id uuid, p_service_id uuid, p_appointment_id uuid,
    p_user_id uuid, p_expected_updated_at timestamptz, p_communication_channel_id uuid,
    p_provider text, p_to_address text, p_body text
)
returns jsonb language plpgsql security invoker set search_path = public as $$
declare v_result jsonb; v_job_id uuid;
begin
    if current_user <> 'service_role' then raise exception using errcode = '42501', message = 'Trusted Appointment Setting runtime required'; end if;
    if not public.workspace_user_can_manage_appointment_setting(p_workspace_id, p_relationship_id, p_service_id, p_user_id) then
        raise exception using errcode = '42501', message = 'Appointment Setting access is required.';
    end if;
    v_result := public.submit_appointment_setting_appointment(p_workspace_id, p_relationship_id, p_service_id, p_appointment_id, p_user_id, p_expected_updated_at, p_communication_channel_id, p_provider, p_to_address, p_body);
    if not (v_result->>'already_submitted')::boolean then
        insert into public.appointment_notification_outbox(workspace_id, relationship_id, appointment_id, message_id, actor_user_id)
        values(p_workspace_id, p_relationship_id, p_appointment_id, (v_result->>'message_id')::uuid, p_user_id)
        returning id into v_job_id;
    else
        select id into v_job_id from public.appointment_notification_outbox where workspace_id = p_workspace_id and appointment_id = p_appointment_id;
    end if;
    return v_result || jsonb_build_object('outbox_id', v_job_id);
end;
$$;

create or replace function public.claim_appointment_notification_outbox(p_limit integer default 5, p_outbox_id uuid default null)
returns setof public.appointment_notification_outbox language plpgsql security invoker set search_path = public as $$
begin
    if current_user <> 'service_role' then raise exception using errcode = '42501', message = 'Trusted delivery runtime required'; end if;
    -- Once dispatch may have started there is no safe automatic resend. Expose
    -- uncertainty in the existing Communications/Appointment notification UI.
    with expired as (
        update public.appointment_notification_outbox set status = 'uncertain', lease_token = null, lease_expires_at = null,
            error_summary = 'Delivery worker ended after dispatch began. Review the provider before retrying.', updated_at = clock_timestamp()
        where status = 'dispatched' and lease_expires_at < now()
        returning workspace_id, message_id, error_summary
    ) update public.client_messages m set status = 'send_uncertain', error = expired.error_summary
      from expired where m.workspace_id = expired.workspace_id and m.id = expired.message_id and m.status = 'sending';
    return query with candidates as (
        select id from public.appointment_notification_outbox
        where (status = 'queued' or (status = 'processing' and lease_expires_at < now()))
          and (p_outbox_id is null or id = p_outbox_id)
        order by created_at, id for update skip locked limit greatest(1, least(coalesce(p_limit, 5), 25))
    ) update public.appointment_notification_outbox job set status = 'processing', lease_token = gen_random_uuid(),
        lease_expires_at = now() + interval '5 minutes', attempt_count = attempt_count + 1, updated_at = clock_timestamp()
      from candidates where job.id = candidates.id returning job.*;
end;
$$;

create or replace function public.begin_appointment_notification_dispatch(p_outbox_id uuid, p_lease_token uuid)
returns boolean language plpgsql security invoker set search_path = public as $$
declare v_id uuid;
begin
    if current_user <> 'service_role' then raise exception using errcode = '42501', message = 'Trusted delivery runtime required'; end if;
    update public.appointment_notification_outbox set status = 'dispatched', lease_expires_at = now() + interval '5 minutes', updated_at = clock_timestamp()
    where id = p_outbox_id and lease_token = p_lease_token and status = 'processing' and lease_expires_at > now()
    returning id into v_id;
    return v_id is not null;
end;
$$;

create or replace function public.finish_appointment_notification_outbox(p_outbox_id uuid, p_lease_token uuid, p_message_status text, p_error_summary text default null)
returns boolean language plpgsql security invoker set search_path = public as $$
declare v_job public.appointment_notification_outbox%rowtype; v_status text; v_message_status text;
begin
    if current_user <> 'service_role' then raise exception using errcode = '42501', message = 'Trusted delivery runtime required'; end if;
    select * into v_job from public.appointment_notification_outbox where id = p_outbox_id and lease_token = p_lease_token and status in ('processing','dispatched') for update;
    if not found then return false; end if;
    -- NULL means an exception, including a lost dispatch acknowledgement.
    -- The stored dispatch boundary, not process memory, determines safety.
    v_message_status := coalesce(p_message_status, case when v_job.status = 'dispatched' then 'send_uncertain' else 'send_failed' end);
    if v_message_status not in ('sent','delivered','read','partial_sent','send_failed','send_uncertain') then
        raise exception using errcode = '22023', message = 'Invalid appointment notification outcome';
    end if;
    v_status := case when v_message_status in ('sent','delivered','read') then 'sent' when v_message_status = 'send_uncertain' then 'uncertain' else 'failed' end;
    update public.appointment_notification_outbox set status = v_status, lease_token = null, lease_expires_at = null,
        error_summary = left(p_error_summary, 600), updated_at = clock_timestamp() where id = v_job.id;
    update public.client_messages set status = v_message_status, error = left(p_error_summary, 600)
    where workspace_id = v_job.workspace_id and id = v_job.message_id and status not in ('sent','delivered','read');
    return true;
end;
$$;

revoke all on function public.submit_appointment_setting_appointment_queued(uuid,uuid,uuid,uuid,uuid,timestamptz,uuid,text,text,text) from public,anon,authenticated;
revoke all on function public.claim_appointment_notification_outbox(integer,uuid) from public,anon,authenticated;
revoke all on function public.begin_appointment_notification_dispatch(uuid,uuid) from public,anon,authenticated;
revoke all on function public.finish_appointment_notification_outbox(uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.submit_appointment_setting_appointment_queued(uuid,uuid,uuid,uuid,uuid,timestamptz,uuid,text,text,text) to service_role;
grant execute on function public.claim_appointment_notification_outbox(integer,uuid) to service_role;
grant execute on function public.begin_appointment_notification_dispatch(uuid,uuid) to service_role;
grant execute on function public.finish_appointment_notification_outbox(uuid,uuid,text,text) to service_role;
