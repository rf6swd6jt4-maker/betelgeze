begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

-- A sale points to its current run. Archived runs retain their sale provenance,
-- frozen definition and assets; each run can be restarted at most once.
alter table public.relationship_onboarding_sessions
    add column if not exists restarted_from_session_id uuid references public.relationship_onboarding_sessions(id) on delete restrict,
    add column if not exists original_source_sale_id uuid references public.client_sales(id) on delete restrict;
create unique index if not exists relationship_onboarding_sessions_restart_unique
    on public.relationship_onboarding_sessions(restarted_from_session_id)
    where restarted_from_session_id is not null;

create or replace function public.restart_relationship_onboarding_session(
    p_workspace_id uuid,
    p_relationship_id uuid,
    p_session_id uuid,
    p_actor_user_id uuid
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
    v_old public.relationship_onboarding_sessions%rowtype;
    v_existing uuid;
    v_new uuid := gen_random_uuid();
    v_token text := encode(extensions.gen_random_bytes(32), 'hex');
    v_now timestamptz := now();
    v_module record;
    v_step record;
    v_module_ids jsonb := '{}'::jsonb;
    v_step_ids jsonb := '{}'::jsonb;
    v_id uuid;
    v_stage_id uuid;
    v_item_id uuid;
    v_previous_item_id uuid;
    v_slug text;
begin
    if current_user <> 'service_role' then
        raise exception using errcode = '42501', message = 'Trusted onboarding server access required';
    end if;
    perform public.require_onboarding_admin_actor(p_workspace_id, p_actor_user_id);
    select * into v_old from public.relationship_onboarding_sessions
    where workspace_id = p_workspace_id and relationship_id = p_relationship_id and id = p_session_id
    for update;
    if v_old.id is null then raise exception 'Onboarding session not found'; end if;
    select id into v_existing from public.relationship_onboarding_sessions
    where workspace_id = p_workspace_id and relationship_id = p_relationship_id and restarted_from_session_id = p_session_id;
    if v_existing is not null then
        return jsonb_build_object('session_id', v_existing, 'idempotent', true);
    end if;
    if v_old.status not in ('active', 'completed') then
        raise exception 'This onboarding is no longer current. Refresh the detail page.';
    end if;
    perform 1 from public.relationships
    where workspace_id = p_workspace_id and id = p_relationship_id for update;
    if exists (select 1 from public.relationship_onboarding_sessions
        where workspace_id = p_workspace_id and relationship_id = p_relationship_id
          and id <> p_session_id and status = 'active') then
        raise exception 'A newer onboarding run already exists. Refresh the detail page.';
    end if;
    if not exists (select 1 from public.relationship_onboarding_session_steps
        where session_id = p_session_id and superseded_at is null and is_actionable) then
        raise exception 'This older onboarding has no frozen steps to restart safely';
    end if;
    -- Visual bookends must already be materialized, otherwise their insert
    -- trigger would expand a second set of steps during the clone.
    if exists (select 1 from public.relationship_onboarding_session_steps step
        join public.onboarding_configuration_revisions revision on revision.id = step.bookend_revision_id
        where step.session_id = p_session_id and step.superseded_at is null
          and step.source_step_id is null and revision.definition->>'schemaVersion' = '2') then
        raise exception 'The onboarding snapshot is incomplete and cannot be restarted safely';
    end if;

    -- All subsequent writes roll back together on any error, including activity.
    update public.relationship_onboarding_sessions
    set status = 'archived', archived_at = v_now, token_revoked_at = v_now,
        original_source_sale_id = coalesce(source_sale_id, original_source_sale_id),
        source_sale_id = null, updated_at = v_now
    where id = p_session_id and workspace_id = p_workspace_id;
    insert into public.relationship_onboarding_sessions (
        id, workspace_id, relationship_id, session_token, status, is_test,
        project_timeframe_days, created_by, source_sale_id, original_source_sale_id,
        configuration_revision_id, welcome_revision_id, completion_revision_id,
        snapshot_schema_version, composition_hash, composition_snapshot,
        restarted_from_session_id, created_at, updated_at
    ) values (
        v_new, p_workspace_id, p_relationship_id, v_token, 'active', v_old.is_test,
        v_old.project_timeframe_days, p_actor_user_id, v_old.source_sale_id,
        coalesce(v_old.source_sale_id, v_old.original_source_sale_id),
        v_old.configuration_revision_id, v_old.welcome_revision_id, v_old.completion_revision_id,
        v_old.snapshot_schema_version, v_old.composition_hash, v_old.composition_snapshot,
        p_session_id, v_now, v_now
    );
    for v_module in select * from public.relationship_onboarding_session_modules
        where session_id = p_session_id and workspace_id = p_workspace_id order by sort_order
    loop
        v_id := gen_random_uuid();
        insert into public.relationship_onboarding_session_modules (
            id, workspace_id, session_id, module_id, module_revision_id, source_kind,
            source_service_revision_id, sort_order, title, description, is_test
        ) values (
            v_id, p_workspace_id, v_new, v_module.module_id, v_module.module_revision_id,
            v_module.source_kind, v_module.source_service_revision_id, v_module.sort_order,
            v_module.title, v_module.description, v_module.is_test
        );
        v_module_ids := v_module_ids || jsonb_build_object(v_module.id::text, v_id);
    end loop;
    for v_step in select * from public.relationship_onboarding_session_steps
        where session_id = p_session_id and workspace_id = p_workspace_id and superseded_at is null order by sort_order
    loop
        v_id := gen_random_uuid();
        insert into public.relationship_onboarding_session_steps (
            id, workspace_id, session_id, session_module_id, source_step_id, module_revision_id,
            bookend_revision_id, kind, title, description, estimated_time, why_we_ask,
            video_url, video_storage_path, sort_order, legacy_step_key, legacy_form_key,
            navigation, is_actionable
        ) values (
            v_id, p_workspace_id, v_new, (v_module_ids->>v_step.session_module_id::text)::uuid,
            v_step.source_step_id, v_step.module_revision_id, v_step.bookend_revision_id,
            v_step.kind, v_step.title, v_step.description, v_step.estimated_time, v_step.why_we_ask,
            v_step.video_url, v_step.video_storage_path, v_step.sort_order,
            v_step.legacy_step_key, v_step.legacy_form_key, v_step.navigation, v_step.is_actionable
        );
        v_step_ids := v_step_ids || jsonb_build_object(v_step.id::text, v_id);
    end loop;
    insert into public.relationship_onboarding_session_fields (
        workspace_id, session_id, session_step_id, source_field_id, type, label,
        required, help_text, placeholder, file_accept, multiple, sort_order, legacy_field_name
    ) select p_workspace_id, v_new, (v_step_ids->>field.session_step_id::text)::uuid,
        field.source_field_id, field.type, field.label, field.required, field.help_text,
        field.placeholder, field.file_accept, field.multiple, field.sort_order, field.legacy_field_name
    from public.relationship_onboarding_session_fields field
    where field.workspace_id = p_workspace_id and field.session_id = p_session_id
      and v_step_ids ? field.session_step_id::text;
    -- Replace only new-run trigger-generated blocks with the exact frozen copy.
    delete from public.relationship_onboarding_session_blocks where session_id = v_new and workspace_id = p_workspace_id;
    insert into public.relationship_onboarding_session_blocks (
        workspace_id, session_id, session_step_id, source_block_id, kind, sort_order, definition, required
    ) select p_workspace_id, v_new, (v_step_ids->>block.session_step_id::text)::uuid,
        block.source_block_id, block.kind, block.sort_order, block.definition, block.required
    from public.relationship_onboarding_session_blocks block
    where block.workspace_id = p_workspace_id and block.session_id = p_session_id
      and v_step_ids ? block.session_step_id::text;
    -- Drafts, responses, uploads and satisfied requirements deliberately stay
    -- with the archived run; new IDs also isolate browser drafts and upload receipts.
    update public.client_sales set onboarding_session_id = v_new, updated_at = v_now
    where workspace_id = p_workspace_id and id = v_old.source_sale_id;
    update public.work_items
    set workflow_required = false, status = case when status = 'done' then status else 'canceled' end, updated_at = v_now
    where workspace_id = p_workspace_id and (native_kind = 'onboarding_step' or (native_kind = 'relationship_workflow' and workflow_role = 'review'))
      and (metadata->>'session_id' = p_session_id::text or native_key like p_session_id::text || ':%');

    update public.work_items set status = case when status = 'done' then status else 'canceled' end, updated_at = v_now
    where workspace_id = p_workspace_id and native_kind = 'relationship_workflow'
      and native_key = p_relationship_id::text || ':onboarding_review'
      and metadata->>'onboarding_review_session_id' = p_session_id::text;

    insert into public.work_items (
        workspace_id, title, description, lifecycle_phase, status, priority, is_key_task,
        native_kind, native_key, workflow_role, completion_mode, workflow_action,
        actual_start_at, actual_start_has_time, sort_order, metadata, created_by
    ) values (
        p_workspace_id, 'Onboard Client', 'Complete the client onboarding session.', 'onboarding', 'doing', 2, true,
        'relationship_workflow', p_relationship_id::text || ':onboarding', 'lifecycle_stage',
        'all_required_children', 'await_onboarding', v_now, true, 0,
        jsonb_build_object('relationship_id', p_relationship_id, 'created_from', 'onboarding_restart'), p_actor_user_id
    ) on conflict (workspace_id, native_kind, native_key) where native_kind is not null and native_key is not null
    do update set status = 'doing', actual_start_at = v_now, actual_start_has_time = true,
        actual_completed_at = null, actual_completed_has_time = false, updated_at = v_now
    returning id into v_stage_id;
    insert into public.work_item_relationships (workspace_id, work_item_id, relationship_id)
    values (p_workspace_id, v_stage_id, p_relationship_id) on conflict (work_item_id, relationship_id) do nothing;
    select slug into v_slug from public.workspaces where id = p_workspace_id;
    for v_step in select * from public.relationship_onboarding_session_steps
        where session_id = v_new and workspace_id = p_workspace_id and is_actionable order by sort_order limit 2
    loop
        insert into public.work_items (
            workspace_id, title, description, lifecycle_phase, status, priority, is_key_task,
            native_kind, native_key, native_href, parent_work_item_id, workflow_role,
            actual_start_at, actual_start_has_time, sort_order, metadata, created_by
        ) values (
            p_workspace_id, v_step.title, v_step.description, 'onboarding', 'todo', 3, true,
            'onboarding_step', v_new::text || ':step:' || v_step.id::text,
            format('/%s/onboarding/%s', v_slug, p_relationship_id), v_stage_id, 'task',
            case when v_previous_item_id is null then v_now else null end, v_previous_item_id is null,
            v_step.sort_order, jsonb_strip_nulls(jsonb_build_object(
                'session_id', v_new, 'relationship_id', p_relationship_id,
                'session_step_id', v_step.id, 'step_key', v_step.id,
                'legacy_step_key', v_step.legacy_step_key, 'module_revision_id', v_step.module_revision_id,
                'kind', v_step.kind, 'auto_created', true
            )), p_actor_user_id
        ) returning id into v_item_id;
        insert into public.work_item_relationships (workspace_id, work_item_id, relationship_id)
        values (p_workspace_id, v_item_id, p_relationship_id);
        if v_previous_item_id is not null then
            insert into public.work_item_dependencies (workspace_id, work_item_id, depends_on_work_item_id, source)
            values (p_workspace_id, v_item_id, v_previous_item_id, 'manual');
        end if;
        v_previous_item_id := v_item_id;
    end loop;
    update public.relationships set lifecycle_phase = 'onboarding', started_onboarding_at = v_now, updated_at = v_now
    where workspace_id = p_workspace_id and id = p_relationship_id;
    perform public.record_workspace_admin_activity(
        p_workspace_id, 'onboarding', 'onboarding.session.restarted', 'Onboarding session restarted',
        p_entity_type => 'onboarding_session', p_entity_id => v_new::text,
        p_actor_user_id => p_actor_user_id, p_actor_kind => 'staff',
        p_source_href => format('/%s/onboarding/%s', v_slug, p_relationship_id),
        p_correlation_id => coalesce(v_old.source_sale_id, v_new),
        p_idempotency_key => 'onboarding.session.restarted:' || p_session_id::text,
        p_metadata => jsonb_build_object('relationship_id', p_relationship_id, 'previous_session_id', p_session_id,
            'session_id', v_new, 'sale_id', v_old.source_sale_id, 'is_test', v_old.is_test)
    );
    return jsonb_build_object('session_id', v_new, 'idempotent', false);
end;
$$;
revoke all on function public.restart_relationship_onboarding_session(uuid, uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.restart_relationship_onboarding_session(uuid, uuid, uuid, uuid) to service_role;

commit;
