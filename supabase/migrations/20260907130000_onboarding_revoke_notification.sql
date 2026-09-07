begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';
alter table public.onboarding_delivery_outbox drop constraint if exists onboarding_delivery_outbox_kind_check;
alter table public.onboarding_delivery_outbox add constraint onboarding_delivery_outbox_kind_check
    check (kind in ('onboarding_link', 'module_update', 'client_portal_link', 'onboarding_link_revoked'));

create or replace function public.revoke_relationship_onboarding_session_token(
    p_workspace_id uuid,
    p_relationship_id uuid,
    p_session_id uuid,
    p_actor_user_id uuid,
    p_expected_token_version integer,
    p_correlation_id uuid default null,
    p_idempotency_key text default null
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
    v_session public.relationship_onboarding_sessions%rowtype;
    v_workspace_slug text;
    v_event_id uuid;
    v_outbox_id uuid;
    v_notification_key text;
    v_body text := 'Your previous onboarding link has been disabled. Your saved progress and submitted information have been kept. Please reply here if you need help accessing onboarding.';
begin
    if current_user <> 'service_role' then
        raise exception using errcode = '42501', message = 'Onboarding session tokens may only be changed by trusted server actions';
    end if;
    perform public.require_onboarding_admin_actor(p_workspace_id, p_actor_user_id);
    select slug into v_workspace_slug from public.workspaces where id = p_workspace_id;
    if v_workspace_slug is null or not exists (
        select 1 from public.relationships
        where workspace_id = p_workspace_id and id = p_relationship_id
    ) then
        raise exception using errcode = 'P0001', message = 'Onboarding relationship not found';
    end if;
    select * into v_session
    from public.relationship_onboarding_sessions
    where workspace_id = p_workspace_id
      and relationship_id = p_relationship_id
      and id = p_session_id
      and status in ('active', 'completed')
    for update;
    if v_session.id is null then
        raise exception using errcode = 'P0001', message = 'Onboarding session not found';
    end if;
    if p_expected_token_version is null or v_session.token_version <> p_expected_token_version then
        raise exception using errcode = '40001', message = 'The onboarding link changed. Reload and try again';
    end if;
    v_notification_key := format('onboarding.token.revoked:%s:%s:notification', v_session.id, v_session.token_version);
    if v_session.token_revoked_at is not null then
        return jsonb_build_object('session_id', v_session.id, 'revoked', true,
            'token_version', v_session.token_version, 'idempotent', true,
            'notification_queued', exists (select 1 from public.onboarding_delivery_outbox
                where workspace_id = p_workspace_id and idempotency_key = v_notification_key));
    end if;
    update public.relationship_onboarding_sessions
    set token_revoked_at = now(), updated_at = now()
    where workspace_id = p_workspace_id and id = v_session.id;
    insert into public.onboarding_delivery_outbox (
        workspace_id, relationship_id, session_id, correlation_id, kind,
        destination, payload, idempotency_key
    ) values (
        p_workspace_id, p_relationship_id, v_session.id,
        coalesce(p_correlation_id, v_session.source_sale_id, v_session.id),
        'onboarding_link_revoked', 'relationship:' || p_relationship_id::text,
        jsonb_build_object('message', v_body, 'token_version', v_session.token_version),
        v_notification_key
    ) returning id into v_outbox_id;
    -- The queued message appears in Comms immediately, even if the provider is
    -- unavailable. The delivery worker updates this same encrypted message.
    insert into public.client_messages (
        workspace_id, relationship_id, direction, provider, body, status,
        sender_kind, automation_kind, automation_label, client_request_id, raw_payload
    ) values (
        p_workspace_id, p_relationship_id, 'outbound', 'omnichannel', v_body, 'queued',
        'automation', 'onboarding_link_revoked', 'Onboarding link revoked', v_outbox_id,
        jsonb_build_object('outbox_id', v_outbox_id, 'kind', 'onboarding_link_revoked',
            'session_id', v_session.id, 'token_version', v_session.token_version)
    );
    v_event_id := public.record_workspace_admin_activity(
        p_workspace_id, 'onboarding', 'onboarding.token.revoked',
        'Onboarding link revoked',
        p_entity_type => 'onboarding_session', p_entity_id => v_session.id::text,
        p_source_href => format('/%s/onboarding/%s', v_workspace_slug, p_relationship_id),
        p_actor_user_id => p_actor_user_id, p_actor_kind => 'staff',
        p_correlation_id => coalesce(p_correlation_id, v_session.source_sale_id, v_session.id),
        p_idempotency_key => coalesce(
            nullif(trim(p_idempotency_key), ''),
            format('onboarding.token.revoked:%s:%s', v_session.id, v_session.token_version)
        ),
        p_metadata => jsonb_build_object(
            'relationship_id', p_relationship_id,
            'session_id', v_session.id,
            'token_version', v_session.token_version
        )
    );
    return jsonb_build_object(
        'session_id', v_session.id, 'revoked', true,
        'token_version', v_session.token_version,
        'event_id', v_event_id, 'idempotent', false,
        'notification_queued', true, 'outbox_id', v_outbox_id
    );
end;
$$;

revoke all on function public.revoke_relationship_onboarding_session_token(uuid, uuid, uuid, uuid, integer, uuid, text) from public, anon, authenticated;
grant execute on function public.revoke_relationship_onboarding_session_token(uuid, uuid, uuid, uuid, integer, uuid, text) to service_role;
commit;
