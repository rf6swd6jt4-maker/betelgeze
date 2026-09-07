-- Run as postgres after the migration, in a transaction that is rolled back.
-- Existing test-run data is read and modified only inside that transaction.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';
set local role service_role;
do $$
declare
    v_old public.relationship_onboarding_sessions%rowtype;
    v_after public.relationship_onboarding_sessions%rowtype;
    v_new public.relationship_onboarding_sessions%rowtype;
    v_actor uuid;
    v_result jsonb;
    v_retry jsonb;
    v_assets bigint;
    v_steps bigint;
    v_blocks bigint;
    v_sale_status text;
    v_rejected boolean := false;
begin
    select session.* into v_old from public.relationship_onboarding_sessions session
    where session.is_test and session.status = 'active' and session.source_sale_id is not null
      and exists (select 1 from public.relationship_onboarding_session_steps where session_id = session.id)
    order by session.created_at desc limit 1 for update;
    if v_old.id is null then raise exception 'A test onboarding with a sale is required for this check'; end if;
    select user_id into v_actor from public.workspace_memberships
    where workspace_id = v_old.workspace_id and role in ('owner', 'admin') order by role desc limit 1;
    select count(*) into v_assets from public.assets where workspace_id = v_old.workspace_id and native_key like v_old.id::text || ':%';
    select count(*) into v_steps from public.relationship_onboarding_session_steps where session_id = v_old.id and superseded_at is null;
    select count(*) into v_blocks from public.relationship_onboarding_session_blocks block
        join public.relationship_onboarding_session_steps step on step.id = block.session_step_id
        where block.session_id = v_old.id and step.superseded_at is null;
    select status into v_sale_status from public.client_sales where id = v_old.source_sale_id;

    -- An error after all reset writes must roll back the old run and sale pointer.
    begin
        perform public.restart_relationship_onboarding_session(v_old.workspace_id, v_old.relationship_id, v_old.id, v_actor);
        raise exception 'TEST_ROLLBACK';
    exception when raise_exception then
        if sqlerrm <> 'TEST_ROLLBACK' then raise; end if;
    end;
    select * into v_after from public.relationship_onboarding_sessions where id = v_old.id;
    assert to_jsonb(v_old) = to_jsonb(v_after), 'Failure altered the original run';
    assert not exists (select 1 from public.relationship_onboarding_sessions where restarted_from_session_id = v_old.id), 'Failed reset left a partial run';

    -- The administrator guard must reject an unknown actor.
    begin
        perform public.restart_relationship_onboarding_session(v_old.workspace_id, v_old.relationship_id, v_old.id, gen_random_uuid());
    exception when others then v_rejected := true;
    end;
    assert v_rejected, 'Non-admin restart was accepted';

    v_result := public.restart_relationship_onboarding_session(v_old.workspace_id, v_old.relationship_id, v_old.id, v_actor);
    select * into v_new from public.relationship_onboarding_sessions where id = (v_result->>'session_id')::uuid;
    select * into v_after from public.relationship_onboarding_sessions where id = v_old.id;
    assert v_new.status = 'active' and v_new.is_test = v_old.is_test, 'Test mode lost';
    assert v_new.session_token <> v_old.session_token and v_new.completed_at is null, 'Link or completion not reset';
    assert v_new.project_timeframe_days is not distinct from v_old.project_timeframe_days, 'Timeframe changed';
    assert v_new.source_sale_id = v_old.source_sale_id, 'Sale association lost';
    assert (select status from public.client_sales where id = v_old.source_sale_id) = v_sale_status, 'Payment changed';
    assert (select onboarding_session_id from public.client_sales where id = v_old.source_sale_id) = v_new.id, 'Sale points to old run';
    assert v_after.status = 'archived' and v_after.token_revoked_at is not null, 'Old link still active';
    assert v_after.original_source_sale_id = v_old.source_sale_id and v_after.source_sale_id is null, 'Sale history missing';
    assert v_new.composition_snapshot = v_old.composition_snapshot and v_new.composition_hash = v_old.composition_hash, 'Frozen definition changed';
    assert (select count(*) from public.relationship_onboarding_session_steps where session_id = v_new.id) = v_steps, 'Step clone incomplete';
    assert (select count(*) from public.relationship_onboarding_session_blocks where session_id = v_new.id) = v_blocks, 'Block clone incomplete';
    assert not exists (select 1 from public.onboarding_step_drafts where session_id = v_new.id), 'Drafts leaked into new run';
    assert not exists (select 1 from public.onboarding_block_requirements where session_id = v_new.id), 'Block answers leaked into new run';
    assert not exists (select 1 from public.assets where native_key like v_new.id::text || ':%'), 'Assets leaked into new run';
    assert (select count(*) from public.assets where workspace_id = v_old.workspace_id and native_key like v_old.id::text || ':%') = v_assets, 'Historical assets removed';
    assert (select count(*) from public.work_items where native_kind = 'onboarding_step' and native_key like v_new.id::text || ':%' and status = 'todo') = least(v_steps, 2), 'Initial progress window missing';
    v_retry := public.restart_relationship_onboarding_session(v_old.workspace_id, v_old.relationship_id, v_old.id, v_actor);
    assert v_retry->>'session_id' = v_result->>'session_id' and (v_retry->>'idempotent')::boolean, 'Retry created another run';
end;
$$;
reset role;
select 'PASS: atomic restart, frozen snapshot, paid/test context, blank run, history, admin guard and idempotency' as result;
rollback;
