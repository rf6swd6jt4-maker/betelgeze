-- Windsor.ai becomes the active Meta Ads reporting transport. The original
-- Betelgeze Meta App connection and relationship tables remain intact so the
-- direct path can be reactivated after Meta business verification.
alter table public.workspace_integrations
    drop constraint if exists workspace_integrations_provider_check;
alter table public.workspace_integrations
    add constraint workspace_integrations_provider_check
    check (provider in ('stripe', 'meta_whatsapp', 'meta_ads', 'windsor', 'google_ads', 'twilio_sms', 'clickup'));

alter table public.workspace_connection_attempts
    drop constraint if exists workspace_connection_attempts_provider_check;
alter table public.workspace_connection_attempts
    add constraint workspace_connection_attempts_provider_check
    check (provider in ('stripe', 'meta_whatsapp', 'meta_ads', 'windsor', 'google_ads', 'twilio_sms'));

create table if not exists public.relationship_windsor_meta_ads_connections (
    id uuid primary key default gen_random_uuid(),
    workspace_id uuid not null references public.workspaces(id) on delete cascade,
    relationship_id uuid not null,
    onboarding_session_id uuid not null,
    source_session_block_id uuid not null,
    status text not null default 'pending' check (status in ('pending', 'connected', 'needs_attention')),
    authorization_encrypted text,
    authorization_hash text check (authorization_hash is null or authorization_hash ~ '^[a-f0-9]{64}$'),
    integration_fingerprint text not null check (integration_fingerprint ~ '^[a-f0-9]{64}$'),
    datasource text,
    account_id text,
    account_name text,
    authorization_started_at timestamptz not null default now(),
    connected_at timestamptz,
    last_verified_at timestamptz,
    rate_window_started_at timestamptz not null default now(),
    rate_window_count integer not null default 0,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    foreign key (workspace_id, relationship_id) references public.relationships(workspace_id, id) on delete cascade,
    foreign key (workspace_id, onboarding_session_id) references public.relationship_onboarding_sessions(workspace_id, id) on delete cascade,
    foreign key (workspace_id, source_session_block_id) references public.relationship_onboarding_session_blocks(workspace_id, id) on delete cascade,
    unique (workspace_id, relationship_id),
    unique (authorization_hash),
    check ((status = 'connected') = (account_id is not null and connected_at is not null))
);

create unique index if not exists relationship_windsor_meta_ads_account_unique
    on public.relationship_windsor_meta_ads_connections (workspace_id, account_id)
    where status = 'connected';
create index if not exists relationship_windsor_meta_ads_session_idx
    on public.relationship_windsor_meta_ads_connections (workspace_id, onboarding_session_id);

alter table public.relationship_windsor_meta_ads_connections enable row level security;
revoke all on public.relationship_windsor_meta_ads_connections from public, anon, authenticated;
grant all on public.relationship_windsor_meta_ads_connections to service_role;

create or replace function public.windsor_meta_ads_onboarding_block(p_token text, p_block_id uuid)
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
      and block.id = p_block_id and block.kind = 'connection' and block.definition->>'provider' = 'meta_ads'
      and step.superseded_at is null
      and (session.source_sale_id is null or exists (
          select 1 from public.client_sales sale where sale.workspace_id = session.workspace_id and sale.id = session.source_sale_id and sale.consent_confirmed_at is not null
      ))
    for update of session, block;
    if v_block.id is null then raise exception using errcode = 'P0001', message = 'This Meta Ads onboarding step is unavailable. Refresh your onboarding page.'; end if;
    if exists (
        select 1 from public.work_items item
        where item.workspace_id = v_block.workspace_id and item.native_kind = 'onboarding_step'
          and item.metadata->>'session_step_id' = v_block.session_step_id::text and item.status = 'done'
    ) then raise exception using errcode = 'P0001', message = 'This onboarding step has already been submitted.'; end if;
    return v_block;
end;
$$;

create or replace function public.begin_windsor_meta_ads_onboarding(
    p_token text,
    p_block_id uuid,
    p_authorization_encrypted text,
    p_authorization_hash text,
    p_integration_fingerprint text
) returns jsonb
language plpgsql security invoker set search_path = public as $$
declare
    v_block public.relationship_onboarding_session_blocks%rowtype;
    v_relationship_id uuid;
    v_existing public.relationship_windsor_meta_ads_connections%rowtype;
begin
    v_block := public.windsor_meta_ads_onboarding_block(p_token, p_block_id);
    if nullif(p_authorization_encrypted, '') is null or p_authorization_hash !~ '^[a-f0-9]{64}$' or p_integration_fingerprint !~ '^[a-f0-9]{64}$' then
        raise exception using errcode = '22023', message = 'Windsor.ai returned an invalid authorization link. Start again.';
    end if;
    if not exists (
        select 1 from public.workspace_integrations integration
        where integration.workspace_id = v_block.workspace_id and integration.provider = 'windsor'
          and integration.enabled and integration.mode = 'connected' and integration.connection_status = 'connected'
          and encode(extensions.digest(convert_to(integration.config_encrypted, 'UTF8'), 'sha256'), 'hex') = p_integration_fingerprint
    ) then raise exception using errcode = 'P0001', message = 'Your agency needs to reconnect Windsor.ai before you continue.'; end if;
    select relationship_id into v_relationship_id from public.relationship_onboarding_sessions where workspace_id = v_block.workspace_id and id = v_block.session_id;
    perform pg_advisory_xact_lock(hashtextextended(v_block.workspace_id::text || ':' || v_relationship_id::text || ':windsor-meta', 0));
    select * into v_existing from public.relationship_windsor_meta_ads_connections
    where workspace_id = v_block.workspace_id and relationship_id = v_relationship_id for update;
    if v_existing.id is not null and v_existing.updated_at > now() - interval '3 seconds' then
        raise exception using errcode = 'P0001', message = 'A connection was just started. Wait a moment before trying again.';
    end if;
    if v_existing.id is not null and v_existing.rate_window_started_at > now() - interval '1 hour' and v_existing.rate_window_count >= 20 then
        raise exception using errcode = 'P0001', message = 'Too many connection attempts. Try again later.';
    end if;
    insert into public.relationship_windsor_meta_ads_connections (
        workspace_id, relationship_id, onboarding_session_id, source_session_block_id,
        status, authorization_encrypted, authorization_hash, integration_fingerprint,
        authorization_started_at, rate_window_started_at, rate_window_count
    ) values (
        v_block.workspace_id, v_relationship_id, v_block.session_id, v_block.id,
        'pending', p_authorization_encrypted, p_authorization_hash, p_integration_fingerprint,
        now(), now(), 1
    ) on conflict (workspace_id, relationship_id) do update set
        onboarding_session_id = excluded.onboarding_session_id,
        source_session_block_id = excluded.source_session_block_id,
        status = 'pending', authorization_encrypted = excluded.authorization_encrypted,
        authorization_hash = excluded.authorization_hash, integration_fingerprint = excluded.integration_fingerprint,
        datasource = null, account_id = null, account_name = null, connected_at = null, last_verified_at = null,
        authorization_started_at = now(), updated_at = now(),
        rate_window_started_at = case when relationship_windsor_meta_ads_connections.rate_window_started_at <= now() - interval '1 hour' then now() else relationship_windsor_meta_ads_connections.rate_window_started_at end,
        rate_window_count = case when relationship_windsor_meta_ads_connections.rate_window_started_at <= now() - interval '1 hour' then 1 else relationship_windsor_meta_ads_connections.rate_window_count + 1 end;
    delete from public.onboarding_block_requirements
    where workspace_id = v_block.workspace_id and session_block_id = v_block.id and requirement_kind = 'meta_ads_connected';
    return jsonb_build_object('status', 'pending');
exception when unique_violation then
    raise exception using errcode = 'P0001', message = 'This authorization link is already assigned. Start a new connection.';
end;
$$;

create or replace function public.finish_windsor_meta_ads_onboarding(
    p_token text,
    p_block_id uuid,
    p_account_id text,
    p_account_name text,
    p_datasource text,
    p_integration_fingerprint text
) returns jsonb
language plpgsql security invoker set search_path = public as $$
declare
    v_block public.relationship_onboarding_session_blocks%rowtype;
    v_connection public.relationship_windsor_meta_ads_connections%rowtype;
    v_response jsonb;
begin
    v_block := public.windsor_meta_ads_onboarding_block(p_token, p_block_id);
    if nullif(trim(p_account_id), '') is null or length(p_account_id) > 200
       or nullif(trim(p_account_name), '') is null or length(p_account_name) > 300
       or p_datasource not in ('facebook', 'facebook_ads') then
        raise exception using errcode = '22023', message = 'Choose a valid Meta Ads account.';
    end if;
    select * into v_connection from public.relationship_windsor_meta_ads_connections
    where workspace_id = v_block.workspace_id and onboarding_session_id = v_block.session_id
      and source_session_block_id = v_block.id and status = 'pending' for update;
    if v_connection.id is null or v_connection.integration_fingerprint is distinct from p_integration_fingerprint then
        raise exception using errcode = 'P0001', message = 'A newer connection attempt replaced this one. Check again.';
    end if;
    if not exists (
        select 1 from public.workspace_integrations integration
        where integration.workspace_id = v_block.workspace_id and integration.provider = 'windsor'
          and integration.enabled and integration.mode = 'connected' and integration.connection_status = 'connected'
          and encode(extensions.digest(convert_to(integration.config_encrypted, 'UTF8'), 'sha256'), 'hex') = p_integration_fingerprint
    ) then raise exception using errcode = 'P0001', message = 'Your agency changed its Windsor.ai connection. Start again.'; end if;
    update public.relationship_windsor_meta_ads_connections set
        status = 'connected', datasource = p_datasource, account_id = p_account_id,
        account_name = p_account_name, connected_at = now(), last_verified_at = now(),
        authorization_encrypted = null, authorization_hash = null, updated_at = now()
    where id = v_connection.id returning * into v_connection;
    v_response := jsonb_build_object(
        'provider', 'windsor', 'accountId', v_connection.account_id,
        'accountName', v_connection.account_name, 'datasource', v_connection.datasource,
        'connectedAt', v_connection.connected_at
    );
    insert into public.onboarding_block_requirements (
        workspace_id, session_id, session_step_id, session_block_id, requirement_kind, response, satisfied_at
    ) values (
        v_block.workspace_id, v_block.session_id, v_block.session_step_id, v_block.id, 'meta_ads_connected', v_response, now()
    ) on conflict (session_block_id) do update set requirement_kind = excluded.requirement_kind, response = excluded.response, satisfied_at = now();
    return v_response;
exception when unique_violation then
    raise exception using errcode = 'P0001', message = 'This Meta Ads account is already assigned to another relationship. Contact your agency.';
end;
$$;

revoke all on function public.windsor_meta_ads_onboarding_block(text, uuid) from public, anon, authenticated;
revoke all on function public.begin_windsor_meta_ads_onboarding(text, uuid, text, text, text) from public, anon, authenticated;
revoke all on function public.finish_windsor_meta_ads_onboarding(text, uuid, text, text, text, text) from public, anon, authenticated;
grant execute on function public.windsor_meta_ads_onboarding_block(text, uuid) to service_role;
grant execute on function public.begin_windsor_meta_ads_onboarding(text, uuid, text, text, text) to service_role;
grant execute on function public.finish_windsor_meta_ads_onboarding(text, uuid, text, text, text, text) to service_role;

create or replace function public.install_onboarding_service_template(
    p_workspace_id uuid,
    p_actor_user_id uuid,
    p_service_id uuid,
    p_definition jsonb,
    p_template_id text,
    p_connection_provider text
) returns jsonb
language plpgsql security invoker set search_path = public as $$
declare
    v_saved jsonb;
begin
    if p_service_id is not null then raise exception 'Service templates can only be installed as new services'; end if;
    if not (coalesce(p_template_id = 'meta-ads' and p_connection_provider = 'windsor', false)
        or coalesce(p_template_id = 'google-ads' and p_connection_provider = 'google_ads', false)) then
        raise exception 'Unknown service template setup';
    end if;
    if p_definition ->> 'templateId' is distinct from p_template_id
        or not (coalesce(p_definition -> 'requiredConnectionKeys', '[]'::jsonb) @> jsonb_build_array(p_connection_provider)) then
        raise exception 'Service template setup does not match its trusted definition';
    end if;
    v_saved := public.save_onboarding_service_revision(p_workspace_id, p_actor_user_id, null, p_definition);
    insert into public.workspace_integrations (workspace_id, provider, enabled, mode, connection_status, config_hint)
    values (p_workspace_id, p_connection_provider, false, 'disabled', 'not_connected', '{}'::jsonb)
    on conflict (workspace_id, provider) do nothing;
    return v_saved || jsonb_build_object('template_id', p_template_id, 'connection_provider', p_connection_provider);
end;
$$;
revoke all on function public.install_onboarding_service_template(uuid, uuid, uuid, jsonb, text, text) from public, anon, authenticated;
grant execute on function public.install_onboarding_service_template(uuid, uuid, uuid, jsonb, text, text) to service_role;

-- Publish a new immutable revision for every installed Meta Ads service. Sold
-- relationships retain the exact revisions they purchased.
do $$
declare
    v_latest record;
    v_new_revision_id uuid;
begin
    for v_latest in
        select distinct on (revision.service_id) revision.*
        from public.onboarding_service_revisions revision
        where revision.definition->>'templateId' = 'meta-ads'
        order by revision.service_id, revision.revision_number desc
    loop
        if coalesce(v_latest.definition->'requiredConnectionKeys', '[]'::jsonb) = '["windsor"]'::jsonb then continue; end if;
        insert into public.onboarding_service_revisions (
            workspace_id, service_id, revision_number, name, description,
            default_price_cents, currency, default_assignee_user_id, is_test,
            display_priority, fulfilment_definition_revision_id, definition, created_by
        ) values (
            v_latest.workspace_id, v_latest.service_id, v_latest.revision_number + 1,
            v_latest.name, v_latest.description, v_latest.default_price_cents,
            v_latest.currency, v_latest.default_assignee_user_id, v_latest.is_test,
            v_latest.display_priority, v_latest.fulfilment_definition_revision_id,
            jsonb_set(v_latest.definition, '{requiredConnectionKeys}', '["windsor"]'::jsonb, true),
            v_latest.created_by
        ) returning id into v_new_revision_id;
        insert into public.onboarding_service_revision_modules (workspace_id, service_revision_id, module_id, sort_order)
        select assignment.workspace_id, v_new_revision_id, assignment.module_id, assignment.sort_order
        from public.onboarding_service_revision_modules assignment
        where assignment.service_revision_id = v_latest.id;
    end loop;
end;
$$;

insert into public.workspace_integrations (workspace_id, provider, enabled, mode, connection_status, config_hint)
select distinct revision.workspace_id, 'windsor', false, 'disabled', 'not_connected', '{}'::jsonb
from public.onboarding_service_revisions revision
where revision.definition->>'templateId' = 'meta-ads'
on conflict (workspace_id, provider) do nothing;
