-- Run after the migration. This rolls back all changes and sends no messages.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';
set local role service_role;
do $$
declare
    v_session public.relationship_onboarding_sessions%rowtype;
    v_actor uuid;
    v_result jsonb;
    v_retry jsonb;
    v_key text;
    v_rejected boolean := false;
begin
    select * into v_session from public.relationship_onboarding_sessions
    where is_test and status = 'active' and token_revoked_at is null order by created_at desc limit 1 for update;
    if v_session.id is null then raise exception 'An active test session is required'; end if;
    select user_id into v_actor from public.workspace_memberships
    where workspace_id = v_session.workspace_id and role in ('owner', 'admin') limit 1;
    v_key := format('onboarding.token.revoked:%s:%s:notification', v_session.id, v_session.token_version);
    begin
        perform public.revoke_relationship_onboarding_session_token(v_session.workspace_id, v_session.relationship_id, v_session.id, v_actor, v_session.token_version + 1);
    exception when serialization_failure then v_rejected := true;
    end;
    assert v_rejected, 'Stale link version was revoked';
    begin
        perform public.revoke_relationship_onboarding_session_token(v_session.workspace_id, v_session.relationship_id, v_session.id, v_actor, v_session.token_version);
        raise exception 'TEST_ROLLBACK';
    exception when raise_exception then
        if sqlerrm <> 'TEST_ROLLBACK' then raise; end if;
    end;
    assert (select token_revoked_at is null from public.relationship_onboarding_sessions where id = v_session.id), 'Failure left the link revoked';
    assert not exists (select 1 from public.onboarding_delivery_outbox where workspace_id = v_session.workspace_id and idempotency_key = v_key), 'Failure left a queued notification';

    v_result := public.revoke_relationship_onboarding_session_token(v_session.workspace_id, v_session.relationship_id, v_session.id, v_actor, v_session.token_version);
    assert (v_result->>'notification_queued')::boolean, 'Revocation did not queue notification';
    assert (select token_revoked_at is not null from public.relationship_onboarding_sessions where id = v_session.id), 'Link was not revoked';
    assert exists (select 1 from public.onboarding_delivery_outbox where id = (v_result->>'outbox_id')::uuid and kind = 'onboarding_link_revoked' and status = 'queued' and payload->>'message' not like '%http%'), 'Incorrect outbox notification';
    assert exists (select 1 from public.client_messages where workspace_id = v_session.workspace_id and relationship_id = v_session.relationship_id and client_request_id = (v_result->>'outbox_id')::uuid and status = 'queued' and automation_label = 'Onboarding link revoked'), 'Notification not visible in Comms';
    v_retry := public.revoke_relationship_onboarding_session_token(v_session.workspace_id, v_session.relationship_id, v_session.id, v_actor, v_session.token_version);
    assert (v_retry->>'idempotent')::boolean and (v_retry->>'notification_queued')::boolean, 'Retry was not idempotent';
    assert (select count(*) from public.onboarding_delivery_outbox where workspace_id = v_session.workspace_id and idempotency_key = v_key) = 1, 'Duplicate outbox message';
    assert (select count(*) from public.client_messages where workspace_id = v_session.workspace_id and client_request_id = (v_result->>'outbox_id')::uuid) = 1, 'Duplicate Comms message';
end;
$$;
reset role;
select 'PASS: revoke, Comms queue, retry deduplication, stale link rejection and rollback' as result;
rollback;
