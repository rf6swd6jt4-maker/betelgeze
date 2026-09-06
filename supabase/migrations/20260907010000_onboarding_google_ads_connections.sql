-- Google Ads onboarding uses the workspace manager credential; no client secrets.
-- Public callers cannot forge completion: the service verifies Google first.
alter table public.onboarding_block_requirements
    drop constraint if exists onboarding_block_requirements_requirement_kind_check;
alter table public.onboarding_block_requirements
    add constraint onboarding_block_requirements_requirement_kind_check
    check (requirement_kind in ('button_opened', 'video_finished', 'calendar_scheduled', 'meta_ads_connected', 'google_ads_connected', 'appointment_medium_configured', 'appointment_fields_configured'));

create or replace function public.validate_onboarding_module_definition(p_definition jsonb)
returns void
language plpgsql
immutable
security invoker
set search_path = public
as $$
declare
    v_step jsonb;
    v_field jsonb;
    v_block jsonb;
    v_step_ids uuid[] := '{}'::uuid[];
    v_block_ids uuid[];
    v_field_ids uuid[];
    v_id uuid;
    v_header_count integer;
    v_estimate_count integer;
    v_form_count integer;
    v_checklist_count integer;
    v_video_count integer;
    v_button_count integer;
    v_calendar_count integer;
    v_connection_count integer;
    v_medium_count integer;
    v_appointment_fields_count integer;
begin
    if jsonb_typeof(p_definition) <> 'object' or nullif(trim(p_definition->>'name'), '') is null then raise exception 'Give this module a name before publishing'; end if;
    if jsonb_typeof(p_definition->'steps') <> 'array' or jsonb_array_length(p_definition->'steps') = 0 then raise exception 'A module must contain at least one step'; end if;
    for v_step in select value from jsonb_array_elements(p_definition->'steps') loop
        begin v_id := (v_step->>'id')::uuid; exception when others then raise exception 'Every step requires a stable UUID'; end;
        if v_id = any(v_step_ids) then raise exception 'Step IDs must be unique within a module'; end if;
        v_step_ids := array_append(v_step_ids, v_id);
        if coalesce((p_definition->>'schemaVersion')::integer, 1) = 2 then
            if jsonb_typeof(v_step->'blocks') <> 'array' or jsonb_array_length(v_step->'blocks') = 0 then raise exception 'Every visual onboarding step requires blocks'; end if;
            v_header_count := 0; v_estimate_count := 0; v_form_count := 0; v_checklist_count := 0;
            v_video_count := 0; v_button_count := 0; v_calendar_count := 0; v_connection_count := 0; v_medium_count := 0;
            v_appointment_fields_count := 0; v_block_ids := '{}'::uuid[];
            for v_block in select value from jsonb_array_elements(v_step->'blocks') with ordinality order by ordinality loop
                begin v_id := (v_block->>'id')::uuid; exception when others then raise exception 'Every onboarding block requires a stable UUID'; end;
                if v_id = any(v_block_ids) then raise exception 'Block IDs must be unique within a step'; end if;
                v_block_ids := array_append(v_block_ids, v_id);
                if v_block->>'kind' not in ('header', 'estimate', 'form', 'checklist', 'video', 'button', 'calendar', 'connection', 'appointment_medium', 'appointment_fields') then raise exception 'Unknown onboarding block type'; end if;
                if v_block->>'kind' = 'header' then
                    v_header_count := v_header_count + 1;
                    if v_header_count <> 1 or v_block <> (v_step->'blocks')->0 then raise exception 'The Header must be the first block in every step'; end if;
                    if nullif(trim(v_block->>'title'), '') is null then raise exception 'Every step requires a title'; end if;
                elsif v_block->>'kind' = 'estimate' then
                    v_estimate_count := v_estimate_count + 1;
                    if v_estimate_count > 1 then raise exception 'A step may contain only one Estimated time block'; end if;
                elsif v_block->>'kind' = 'form' then
                    v_form_count := v_form_count + 1;
                    if v_form_count > 1 then raise exception 'A step may contain only one Form block'; end if;
                    if jsonb_typeof(v_block->'fields') <> 'array' then raise exception 'Form blocks require a fields array'; end if;
                    v_field_ids := '{}'::uuid[];
                    for v_field in select value from jsonb_array_elements(v_block->'fields') loop
                        begin v_id := (v_field->>'id')::uuid; exception when others then raise exception 'Every field requires a stable UUID'; end;
                        if v_id = any(v_field_ids) then raise exception 'Field IDs must be unique within a Form block'; end if;
                        v_field_ids := array_append(v_field_ids, v_id);
                        if nullif(trim(v_field->>'label'), '') is null then raise exception 'Every field requires a label'; end if;
                        if v_field->>'type' not in ('text','email','tel','url','textarea','file') then raise exception 'Unknown onboarding field type'; end if;
                    end loop;
                elsif v_block->>'kind' = 'checklist' then
                    v_checklist_count := v_checklist_count + 1;
                    if v_checklist_count > 1 then raise exception 'A step may contain only one Checklist block'; end if;
                    if coalesce(v_block->>'source', 'custom') not in ('custom', 'modules') then raise exception 'Unknown checklist source'; end if;
                    if jsonb_typeof(coalesce(v_block->'items', '[]'::jsonb)) <> 'array' then raise exception 'Checklist blocks require an items array'; end if;
                elsif v_block->>'kind' = 'video' then
                    v_video_count := v_video_count + 1;
                    if v_video_count > 1 then raise exception 'A step may contain only one Video block'; end if;
                    if nullif(v_block#>>'{upload,path}', '') is null then raise exception 'Upload every video before publishing'; end if;
                    if nullif(v_block->>'legacyEmbedUrl', '') is not null then raise exception 'Replace embedded videos with workspace uploads before publishing'; end if;
                    if coalesce(v_block->>'requirement', 'none') not in ('none','finish') then raise exception 'Unknown video requirement'; end if;
                elsif v_block->>'kind' = 'button' then
                    v_button_count := v_button_count + 1;
                    if v_button_count > 1 then raise exception 'A step may contain only one Button block'; end if;
                    if nullif(trim(v_block->>'label'), '') is null then raise exception 'Every button requires a label'; end if;
                    if coalesce(v_block->>'url', '') !~ '^https://' then raise exception 'Buttons require a secure HTTPS URL'; end if;
                elsif v_block->>'kind' = 'calendar' then
                    v_calendar_count := v_calendar_count + 1;
                    if v_calendar_count > 1 then raise exception 'A step may contain only one Calendar block'; end if;
                    if nullif(trim(v_block->>'title'), '') is null then raise exception 'Every Calendar block requires a heading'; end if;
                    if nullif(trim(v_block->>'timeLabel'), '') is null then raise exception 'Every Calendar block requires a time label'; end if;
                    if coalesce((v_block->>'required')::boolean, false) is not true then raise exception 'Calendar blocks must be required'; end if;
                elsif v_block->>'kind' = 'connection' then
                    v_connection_count := v_connection_count + 1;
                    if v_connection_count > 1 then raise exception 'A step may contain only one Connection block'; end if;
                    if coalesce(v_block->>'provider', '') not in ('meta_ads', 'google_ads') then raise exception 'Unknown onboarding connection provider'; end if;
                    if nullif(trim(v_block->>'label'), '') is null then raise exception 'Every connection requires a button label'; end if;
                elsif v_block->>'kind' = 'appointment_medium' then
                    v_medium_count := v_medium_count + 1;
                    if v_medium_count > 1 then raise exception 'A step may contain only one Appointment medium block'; end if;
                    if jsonb_typeof(v_block->'options') <> 'array' or jsonb_array_length(v_block->'options') = 0 then raise exception 'Appointment medium requires at least one option'; end if;
                    if exists (select 1 from jsonb_array_elements_text(v_block->'options') option where option not in ('phone', 'google_meet', 'zoom')) then raise exception 'Unknown appointment medium'; end if;
                elsif v_block->>'kind' = 'appointment_fields' then
                    v_appointment_fields_count := v_appointment_fields_count + 1;
                    if v_appointment_fields_count > 1 then raise exception 'A step may contain only one Appointment information block'; end if;
                    if jsonb_typeof(v_block->'options') <> 'array' then raise exception 'Appointment information requires an options array'; end if;
                    if coalesce((v_block->>'maximumFields')::integer, 0) not between 1 and 4 then raise exception 'Appointment information supports one to four extra fields'; end if;
                    if exists (select 1 from jsonb_array_elements_text(v_block->'options') option where option not in ('phone', 'email', 'service', 'address', 'notes')) then raise exception 'Unknown appointment information field'; end if;
                end if;
            end loop;
            if v_header_count <> 1 then raise exception 'Every step requires exactly one Header block'; end if;
            if v_estimate_count <> 1 then raise exception 'Every step requires exactly one Estimated time block'; end if;
        else
            if nullif(trim(v_step->>'title'), '') is null then raise exception 'Every step requires a title'; end if;
            if coalesce(v_step->>'kind', '') not in ('form', 'video') then raise exception 'Unknown onboarding step type'; end if;
        end if;
        if coalesce(v_step->>'kind', '') not in ('form', 'video') then raise exception 'Every step requires a compatibility kind'; end if;
        if v_step->>'kind' = 'form' and jsonb_typeof(v_step->'fields') <> 'array' then raise exception 'Form steps require a fields array'; end if;
    end loop;
end;
$$;

create table public.relationship_google_ads_connections (
    id uuid primary key default gen_random_uuid(),
    workspace_id uuid not null references public.workspaces(id) on delete cascade,
    relationship_id uuid not null,
    onboarding_session_id uuid not null,
    source_session_block_id uuid not null,
    manager_customer_id text not null check (manager_customer_id ~ '^[0-9]{10}$'),
    customer_id text not null check (customer_id ~ '^[0-9]{10}$'),
    status text not null default 'needs_attention' check (status in ('pending', 'connected', 'needs_attention')),
    account_name text,
    currency_code text,
    time_zone text,
    connected_at timestamptz,
    last_verified_at timestamptz,
    last_error text,
    attempt_id uuid,
    attempt_started_at timestamptz,
    rate_window_started_at timestamptz not null default now(),
    rate_window_count integer not null default 0,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    foreign key (workspace_id, relationship_id) references public.relationships(workspace_id, id) on delete cascade,
    foreign key (workspace_id, onboarding_session_id) references public.relationship_onboarding_sessions(workspace_id, id) on delete cascade,
    foreign key (workspace_id, source_session_block_id) references public.relationship_onboarding_session_blocks(workspace_id, id) on delete cascade,
    unique (workspace_id, relationship_id),
    unique (workspace_id, customer_id)
);
alter table public.relationship_google_ads_connections enable row level security;
revoke all on public.relationship_google_ads_connections from anon, authenticated;
grant all on public.relationship_google_ads_connections to service_role;

-- Shared authorization is also used when committing the result, so expired,
-- revoked, superseded, submitted, and cross-session blocks cannot complete.
create function public.google_ads_onboarding_block(p_token text, p_block_id uuid)
returns public.relationship_onboarding_session_blocks
language plpgsql security invoker set search_path = public as $$
declare
    v_block public.relationship_onboarding_session_blocks%rowtype;
begin
    if current_user <> 'service_role' then raise exception using errcode = '42501', message = 'Trusted onboarding runtime required'; end if;
    select block.* into v_block
    from public.relationship_onboarding_session_blocks block
    join public.relationship_onboarding_sessions session on session.workspace_id = block.workspace_id and session.id = block.session_id
    join public.relationship_onboarding_session_steps step on step.workspace_id = block.workspace_id and step.id = block.session_step_id and step.session_id = session.id
    where session.session_token = p_token and session.status = 'active' and session.token_revoked_at is null
      and block.id = p_block_id and block.kind = 'connection' and block.definition->>'provider' = 'google_ads'
      and step.superseded_at is null
      and (session.source_sale_id is null or exists (
          select 1 from public.client_sales sale where sale.workspace_id = session.workspace_id and sale.id = session.source_sale_id and sale.consent_confirmed_at is not null
      ))
    for update of session, block;
    if v_block.id is null then raise exception using errcode = 'P0001', message = 'This Google Ads onboarding step is unavailable. Refresh your onboarding page.'; end if;
    if exists (select 1 from public.work_items item where item.workspace_id = v_block.workspace_id and item.native_kind = 'onboarding_step' and item.metadata->>'session_step_id' = v_block.session_step_id::text and item.status = 'done') then
        raise exception using errcode = 'P0001', message = 'This onboarding step has already been submitted.';
    end if;
    return v_block;
end;
$$;

create function public.begin_google_ads_onboarding(
    p_token text, p_block_id uuid, p_customer_id text, p_manager_id text, p_attempt_id uuid
) returns jsonb language plpgsql security invoker set search_path = public as $$
declare
    v_block public.relationship_onboarding_session_blocks%rowtype;
    v_connection public.relationship_google_ads_connections%rowtype;
    v_relationship_id uuid;
begin
    v_block := public.google_ads_onboarding_block(p_token, p_block_id);
    if p_customer_id is null or p_customer_id !~ '^[0-9]{10}$' or p_manager_id is null or p_manager_id !~ '^[0-9]{10}$' or p_customer_id = p_manager_id or p_attempt_id is null then
        raise exception using errcode = '22023', message = 'Enter the 10-digit customer ID of the account that runs your ads.';
    end if;
    if not exists (select 1 from public.workspace_integrations integration where integration.workspace_id = v_block.workspace_id and integration.provider = 'google_ads' and integration.enabled and integration.mode = 'connected' and integration.connected_account_id = p_manager_id) then
        raise exception using errcode = 'P0001', message = 'Your agency needs to reconnect its Google Ads manager account.';
    end if;
    select relationship_id into v_relationship_id from public.relationship_onboarding_sessions where id = v_block.session_id and workspace_id = v_block.workspace_id;
    -- Serialise all blocks and sessions for this relationship before reserving an account.
    perform pg_advisory_xact_lock(hashtextextended(v_block.workspace_id::text || ':' || v_relationship_id::text, 0));
    select * into v_connection from public.relationship_google_ads_connections where workspace_id = v_block.workspace_id and relationship_id = v_relationship_id for update;
    if v_connection.attempt_id is not null and v_connection.attempt_started_at > now() - interval '2 minutes' then
        raise exception using errcode = 'P0001', message = 'A connection check is already running. Wait a moment, then try again.';
    end if;
    if v_connection.updated_at > now() - interval '5 seconds' then raise exception using errcode = 'P0001', message = 'Wait a few seconds before checking again.'; end if;
    if v_connection.rate_window_started_at > now() - interval '1 hour' and v_connection.rate_window_count >= 60 then raise exception using errcode = 'P0001', message = 'Too many connection attempts. Please try again later.'; end if;
    if v_connection.customer_id is distinct from p_customer_id and v_connection.status in ('pending', 'connected') then
        raise exception using errcode = 'P0001', message = 'An account is already linked or awaiting approval. Contact your agency to change the account.';
    end if;
    if exists (select 1 from public.relationship_google_ads_connections where workspace_id = v_block.workspace_id and customer_id = p_customer_id and relationship_id <> v_relationship_id) then
        raise exception using errcode = 'P0001', message = 'This advertising account is assigned to another relationship. Contact your agency.';
    end if;
    insert into public.relationship_google_ads_connections (workspace_id, relationship_id, onboarding_session_id, source_session_block_id, manager_customer_id, customer_id, attempt_id, attempt_started_at, rate_window_count)
    values (v_block.workspace_id, v_relationship_id, v_block.session_id, v_block.id, p_manager_id, p_customer_id, p_attempt_id, now(), 1)
    on conflict (workspace_id, relationship_id) do update set
        onboarding_session_id = excluded.onboarding_session_id, source_session_block_id = excluded.source_session_block_id,
        customer_id = excluded.customer_id, manager_customer_id = excluded.manager_customer_id,
        status = case when relationship_google_ads_connections.manager_customer_id = excluded.manager_customer_id then relationship_google_ads_connections.status else 'needs_attention' end,
        attempt_id = excluded.attempt_id, attempt_started_at = now(), updated_at = now(),
        rate_window_started_at = case when relationship_google_ads_connections.rate_window_started_at <= now() - interval '1 hour' then now() else relationship_google_ads_connections.rate_window_started_at end,
        rate_window_count = case when relationship_google_ads_connections.rate_window_started_at <= now() - interval '1 hour' then 1 else relationship_google_ads_connections.rate_window_count + 1 end
    returning * into v_connection;
    return jsonb_build_object('id', v_connection.id);
exception when unique_violation then
    raise exception using errcode = 'P0001', message = 'This advertising account is assigned to another relationship. Contact your agency.';
end;
$$;

create function public.finish_google_ads_onboarding(
    p_token text, p_block_id uuid, p_attempt_id uuid, p_expected_config text,
    p_status text, p_account_name text default null, p_currency text default null, p_timezone text default null, p_error text default null
) returns jsonb language plpgsql security invoker set search_path = public as $$
declare
    v_block public.relationship_onboarding_session_blocks%rowtype;
    v_connection public.relationship_google_ads_connections%rowtype;
    v_integration public.workspace_integrations%rowtype;
    v_response jsonb;
begin
    v_block := public.google_ads_onboarding_block(p_token, p_block_id);
    select * into v_connection from public.relationship_google_ads_connections where workspace_id = v_block.workspace_id and onboarding_session_id = v_block.session_id and source_session_block_id = v_block.id and attempt_id = p_attempt_id for update;
    if v_connection.id is null then raise exception using errcode = 'P0001', message = 'A newer connection attempt has replaced this one. Please check again.'; end if;
    select * into v_integration from public.workspace_integrations where workspace_id = v_block.workspace_id and provider = 'google_ads' for share;
    if not coalesce(v_integration.enabled, false) or v_integration.mode is distinct from 'connected' or v_integration.connected_account_id is distinct from v_connection.manager_customer_id or v_integration.config_encrypted is distinct from p_expected_config then
        raise exception using errcode = 'P0001', message = 'Your agency changed its Google Ads connection. Refresh this page and try again.';
    end if;
    if p_status is null or p_status not in ('pending', 'connected', 'needs_attention') then raise exception 'Invalid connection result'; end if;
    update public.relationship_google_ads_connections set
        status = p_status, account_name = case when p_status = 'connected' then left(p_account_name, 300) else null end,
        currency_code = case when p_status = 'connected' then left(p_currency, 10) else null end,
        time_zone = case when p_status = 'connected' then left(p_timezone, 100) else null end,
        connected_at = case when p_status = 'connected' then coalesce(connected_at, now()) else connected_at end,
        last_verified_at = case when p_status = 'connected' then now() else null end,
        last_error = left(p_error, 500), attempt_id = null, updated_at = now()
    where id = v_connection.id returning * into v_connection;
    v_response := jsonb_build_object('customerId', v_connection.customer_id, 'managerId', v_connection.manager_customer_id,
        'managerName', coalesce(v_integration.config_hint->>'manager_name', 'Your agency'), 'status', p_status,
        'accountName', v_connection.account_name, 'verifiedAt', v_connection.last_verified_at);
    if p_status = 'connected' then
        insert into public.onboarding_block_requirements (workspace_id, session_id, session_step_id, session_block_id, requirement_kind, response, satisfied_at)
        values (v_block.workspace_id, v_block.session_id, v_block.session_step_id, v_block.id, 'google_ads_connected', v_response, now())
        on conflict (session_block_id) do update set requirement_kind = excluded.requirement_kind, response = excluded.response, satisfied_at = now();
    else
        delete from public.onboarding_block_requirements where workspace_id = v_block.workspace_id and session_block_id = v_block.id and requirement_kind = 'google_ads_connected';
    end if;
    return v_response;
end;
$$;

revoke all on function public.google_ads_onboarding_block(text, uuid) from public, anon, authenticated;
revoke all on function public.begin_google_ads_onboarding(text, uuid, text, text, uuid) from public, anon, authenticated;
revoke all on function public.finish_google_ads_onboarding(text, uuid, uuid, text, text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.google_ads_onboarding_block(text, uuid) to service_role;
grant execute on function public.begin_google_ads_onboarding(text, uuid, text, text, uuid) to service_role;
grant execute on function public.finish_google_ads_onboarding(text, uuid, uuid, text, text, text, text, text, text) to service_role;
