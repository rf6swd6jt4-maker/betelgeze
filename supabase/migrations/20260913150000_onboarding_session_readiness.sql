-- SS-04: session isolation, explicit welcome evidence, relationship team union.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';
alter table public.relationship_onboarding_sessions add column welcome_completed_at timestamptz, add column welcome_skipped_from_session_id uuid references public.relationship_onboarding_sessions(id), add column welcome_test_skipped boolean not null default false;
create index onboarding_welcome_evidence_idx on public.relationship_onboarding_sessions(workspace_id,relationship_id,welcome_completed_at) where welcome_completed_at is not null;
create index onboarding_reuse_field_lookup_idx on public.relationship_onboarding_session_fields(workspace_id,session_step_id,source_field_id);
create index onboarding_submission_step_lookup_idx on public.assets(workspace_id,(metadata->>'session_step_id'),updated_at desc) where native_kind='onboarding_form_submission';

create function public.onboarding_welcome_step_ids(p_workspace_id uuid,p_session_id uuid) returns setof uuid
language sql stable security definer set search_path=public as $$
 select step.id from public.relationship_onboarding_session_steps step
 left join public.relationship_onboarding_session_modules sm on sm.workspace_id=step.workspace_id and sm.id=step.session_module_id
 left join public.onboarding_modules m on m.workspace_id=sm.workspace_id and m.id=sm.module_id
 where step.workspace_id=p_workspace_id and step.session_id=p_session_id and step.superseded_at is null and step.is_actionable
 and (step.kind='welcome' or m.internal_code='system-welcome')
$$;
create function public.record_onboarding_welcome_completion(p_workspace_id uuid,p_session_id uuid) returns void
language plpgsql security definer set search_path=public as $$
begin
 update public.relationship_onboarding_sessions s set welcome_completed_at=now()
 where s.workspace_id=p_workspace_id and s.id=p_session_id and s.welcome_completed_at is null and not s.welcome_test_skipped and s.welcome_skipped_from_session_id is null
 and exists(select 1 from public.onboarding_welcome_step_ids(p_workspace_id,p_session_id))
 and not exists(select 1 from public.onboarding_welcome_step_ids(p_workspace_id,p_session_id) step_id where not exists(
  select 1 from public.work_items w where w.workspace_id=p_workspace_id and w.native_kind='onboarding_step' and w.native_key=p_session_id::text||':step:'||step_id::text and w.status='done' and w.actual_completed_at is not null
  and exists(select 1 from public.workspace_admin_activity event where event.workspace_id=p_workspace_id and event.entity_type='work_item' and event.entity_id=w.id::text and event.event_key='onboarding.step.completed' and event.actor_kind='client')
  and not exists(select 1 from public.relationship_onboarding_session_blocks block where block.workspace_id=p_workspace_id and block.session_step_id=step_id and block.required and not exists(select 1 from public.onboarding_block_requirements proof where proof.workspace_id=block.workspace_id and proof.session_block_id=block.id))));
end $$;
-- Backfill requires the authoritative client completion event and every required
-- block receipt, not merely a completed work item or a session count.
do $$ declare s record; begin
 for s in select id,workspace_id from public.relationship_onboarding_sessions where not is_test loop
  perform public.record_onboarding_welcome_completion(s.workspace_id,s.id);
 end loop;
end $$;

create function public.sync_selected_sale_relationship_team() returns trigger
language plpgsql security definer set search_path=public as $$
declare t uuid;
begin
 if new.service_scope<>'selected_services' or new.snapshot_frozen_at is null or exists(select 1 from public.relationships where workspace_id=new.workspace_id and id=new.relationship_id and status='archived') then return new; end if;
 perform public.create_relationship_delivery_team(new.workspace_id,new.relationship_id);
 select id into t from public.workspace_teams where workspace_id=new.workspace_id and relationship_id=new.relationship_id;
 insert into public.workspace_team_members(workspace_id,team_id,user_id,added_by)
 select new.workspace_id,t,m.user_id,new.created_by from public.workspace_memberships m where m.workspace_id=new.workspace_id
 and (m.user_id in(new.seller_user_id,new.service_manager_user_id) or exists(select 1 from public.client_sale_items i where i.workspace_id=new.workspace_id and i.client_sale_id=new.id and i.default_assignee_user_id=m.user_id)) on conflict do nothing;
 return new;
end $$;
create trigger sync_selected_sale_relationship_team after insert or update of status on public.client_sales for each row execute function public.sync_selected_sale_relationship_team();


create function public.service_instance_onboarding_ready(p_workspace_id uuid,p_instance_id uuid,p_session_id uuid) returns boolean
language sql stable security definer set search_path=public as $$
 select exists(select 1 from public.relationship_service_instances i
 join public.service_instance_sessions e on e.workspace_id=i.workspace_id and e.instance_id=i.id
 join public.relationship_onboarding_sessions s on s.workspace_id=e.workspace_id and s.id=e.session_id
 join public.client_sales sale on sale.workspace_id=s.workspace_id and sale.id=s.source_sale_id
 where i.workspace_id=p_workspace_id and i.id=p_instance_id and s.id=p_session_id and s.status in('active','completed') and s.token_revoked_at is null and sale.consent_confirmed_at is not null and sale.status in('paid','test_paid')
 and not exists(select 1 from public.service_instance_module_requirements req
 join public.relationship_onboarding_session_steps st on st.workspace_id=req.workspace_id and st.session_module_id=req.session_module_id and st.superseded_at is null and st.is_actionable
 where req.workspace_id=p_workspace_id and req.session_id=s.id and req.instance_id=i.id and req.required and not exists(select 1 from public.relationship_onboarding_session_modules sm join public.onboarding_modules m on m.workspace_id=sm.workspace_id and m.id=sm.module_id where sm.id=req.session_module_id and m.internal_code='system-completion') and
 (not exists(select 1 from public.work_items w where w.workspace_id=p_workspace_id and w.native_kind='onboarding_step' and w.native_key=s.id::text||':step:'||st.id and w.status='done')
 or req.review_required and st.id not in(select public.onboarding_welcome_step_ids(p_workspace_id,s.id)) and not exists(select 1 from public.work_items review where review.workspace_id=p_workspace_id and review.native_kind='relationship_workflow' and review.native_key=s.id::text||':service-review:'||st.id and review.status='done'))))
$$;
revoke all on function public.service_instance_onboarding_ready(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.service_instance_onboarding_ready(uuid,uuid,uuid) to service_role;
create function public.refresh_service_onboarding_readiness(p_workspace_id uuid,p_session_id uuid) returns void
language plpgsql security definer set search_path=public as $$
declare s public.relationship_onboarding_sessions%rowtype; sale public.client_sales%rowtype; step record; wid uuid;
begin
 perform pg_advisory_xact_lock(hashtextextended('onboarding-ready:'||p_workspace_id::text||p_session_id::text,0));
 select * into s from public.relationship_onboarding_sessions where workspace_id=p_workspace_id and id=p_session_id and service_scope='selected_services' and status in('active','completed');
 if s.id is null then return; end if;
 select * into sale from public.client_sales where workspace_id=p_workspace_id and id=s.source_sale_id;
 if sale.status is null or sale.status not in('paid','test_paid') or sale.consent_confirmed_at is null then return; end if;
 -- Review is released as information arrives, independent of other modules.
 for step in select st.* from public.relationship_onboarding_session_steps st
 where st.workspace_id=p_workspace_id and st.session_id=s.id and st.superseded_at is null and st.is_actionable and st.id not in(select public.onboarding_welcome_step_ids(p_workspace_id,s.id))
 and not exists(select 1 from public.relationship_onboarding_session_modules sm join public.onboarding_modules m on m.workspace_id=sm.workspace_id and m.id=sm.module_id where sm.id=st.session_module_id and m.internal_code='system-completion')
 and exists(select 1 from public.service_instance_module_requirements req where req.workspace_id=p_workspace_id and req.session_module_id=st.session_module_id and req.review_required)
 and exists(select 1 from public.work_items w where w.workspace_id=p_workspace_id and w.native_kind='onboarding_step' and w.native_key=s.id::text||':step:'||st.id::text and w.status='done')
 loop
  insert into public.work_items(workspace_id,title,description,lifecycle_phase,status,priority,native_kind,native_key,workflow_role,metadata,created_by)
  values(p_workspace_id,'Review: '||step.title,'Review this service onboarding information.','onboarding_review','todo',2,'relationship_workflow',s.id::text||':service-review:'||step.id,'review',jsonb_build_object('session_id',s.id,'session_step_id',step.id,'sale_id',sale.id),sale.created_by)
  on conflict (workspace_id,native_kind,native_key) where native_kind is not null and native_key is not null do nothing returning id into wid;
  if wid is not null then
   insert into public.work_item_relationships(workspace_id,relationship_id,work_item_id) values(p_workspace_id,s.relationship_id,wid);
   insert into public.work_item_assignees(workspace_id,work_item_id,user_id) values(p_workspace_id,wid,sale.service_manager_user_id) on conflict do nothing;
   insert into public.service_instance_work_items(workspace_id,instance_id,work_item_id) select p_workspace_id,instance_id,wid from public.service_instance_module_requirements where workspace_id=p_workspace_id and session_id=s.id and session_module_id=step.session_module_id;
  end if;
 end loop;
 update public.relationship_service_instances i set stage='setup',version=version+1,change_request_id=gen_random_uuid(),change_reason='Required onboarding information reviewed',changed_by=sale.service_manager_user_id
 where i.workspace_id=p_workspace_id and i.stage='onboarding' and exists(select 1 from public.service_instance_sessions e where e.workspace_id=p_workspace_id and e.session_id=s.id and e.instance_id=i.id)
 and public.service_instance_onboarding_ready(p_workspace_id,i.id,s.id);
end $$;
create function public.service_onboarding_work_changed() returns trigger
language plpgsql security definer set search_path=public as $$
begin
 if new.status='done' and new.status is distinct from old.status and new.metadata->>'session_id' ~* '^[0-9a-f-]{36}$' then
  perform public.refresh_service_onboarding_readiness(new.workspace_id,(new.metadata->>'session_id')::uuid);
 end if;
 return new;
end $$;
create trigger service_onboarding_work_changed after update of status on public.work_items for each row execute function public.service_onboarding_work_changed();

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
    v_paid boolean;
begin
    if current_user <> 'service_role' then
        raise exception using errcode = '42501', message = 'Trusted onboarding server access required';
    end if;
    perform public.require_onboarding_admin_actor(p_workspace_id, p_actor_user_id);
    select * into v_old from public.relationship_onboarding_sessions
    where workspace_id = p_workspace_id and relationship_id = p_relationship_id and id = p_session_id
    for update;
    if v_old.id is null then raise exception 'Onboarding session not found'; end if;
    v_paid := v_old.service_scope='relationship' or exists(select 1 from public.client_sales where workspace_id=p_workspace_id and id=v_old.source_sale_id and status in('paid','test_paid') and consent_confirmed_at is not null);
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
          and id <> p_session_id and status = 'active' and v_old.service_scope='relationship' and service_scope='relationship') then
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
        restarted_from_session_id, service_scope, created_at, updated_at
    ) values (
        v_new, p_workspace_id, p_relationship_id, v_token, 'active', v_old.is_test,
        v_old.project_timeframe_days, p_actor_user_id, v_old.source_sale_id,
        coalesce(v_old.source_sale_id, v_old.original_source_sale_id),
        v_old.configuration_revision_id, v_old.welcome_revision_id, v_old.completion_revision_id,
        v_old.snapshot_schema_version, v_old.composition_hash, v_old.composition_snapshot,
        p_session_id, v_old.service_scope, v_now, v_now
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
        p_workspace_id, 'Onboard Client', 'Complete the client onboarding session.', 'onboarding', case when v_paid then 'doing' else 'waiting' end, 2, true,
        'relationship_workflow', case when v_old.service_scope='selected_services' then v_new::text||':service-onboarding' else p_relationship_id::text||':onboarding' end, case when v_old.service_scope='selected_services' then 'service_group' else 'lifecycle_stage' end,
        'all_required_children', 'await_onboarding', case when v_paid then v_now end, v_paid, 0,
        jsonb_build_object('relationship_id', p_relationship_id, 'session_id', v_new, 'created_from', 'onboarding_restart'), p_actor_user_id
    ) on conflict (workspace_id, native_kind, native_key) where native_kind is not null and native_key is not null
    do update set status = excluded.status, actual_start_at = excluded.actual_start_at, actual_start_has_time = excluded.actual_start_has_time,
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
            format('/%s/onboarding/%s?session=%s', v_slug, p_relationship_id, v_new), v_stage_id, 'task',
            case when v_paid and v_previous_item_id is null then v_now else null end, v_paid and v_previous_item_id is null,
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
    where workspace_id = p_workspace_id and id = p_relationship_id and v_old.service_scope='relationship';
    if v_old.service_scope='selected_services' then
        insert into public.work_item_assignees(workspace_id,work_item_id,user_id) select p_workspace_id,v_stage_id,service_manager_user_id from public.client_sales where workspace_id=p_workspace_id and id=v_old.source_sale_id on conflict do nothing;
        update public.service_instance_sessions set enrollment='historical' where workspace_id=p_workspace_id and session_id=p_session_id;
        insert into public.service_instance_sessions(workspace_id,relationship_id,instance_id,session_id,enrollment) select workspace_id,relationship_id,instance_id,v_new,'active' from public.service_instance_sessions where workspace_id=p_workspace_id and session_id=p_session_id;
        insert into public.service_instance_module_requirements(workspace_id,instance_id,session_id,session_module_id,required,review_required) select workspace_id,instance_id,v_new,(v_module_ids->>session_module_id::text)::uuid,required,review_required from public.service_instance_module_requirements where workspace_id=p_workspace_id and session_id=p_session_id and v_module_ids ? session_module_id::text;
        insert into public.service_instance_work_items(workspace_id,instance_id,work_item_id) select p_workspace_id,instance_id,v_stage_id from public.service_instance_sessions where workspace_id=p_workspace_id and session_id=v_new;
        insert into public.service_instance_work_items(workspace_id,instance_id,work_item_id)
        select p_workspace_id,req.instance_id,w.id
        from public.service_instance_module_requirements req
        join public.relationship_onboarding_session_steps st on st.workspace_id=req.workspace_id and st.session_module_id=req.session_module_id
        join public.work_items w on w.workspace_id=st.workspace_id and w.native_kind='onboarding_step' and w.native_key=v_new::text||':step:'||st.id::text
        where req.workspace_id=p_workspace_id and req.session_id=v_new on conflict do nothing;
    end if;
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

create or replace function public.complete_selected_service_session(p_workspace_id uuid,p_session_id uuid,p_session_token text) returns jsonb
language plpgsql security definer set search_path=public as $$
declare s public.relationship_onboarding_sessions%rowtype; sale public.client_sales%rowtype; step record; wid uuid;
begin
 select * into s from public.relationship_onboarding_sessions where workspace_id=p_workspace_id and id=p_session_id and session_token=p_session_token and token_revoked_at is null and status in('active','completed') and service_scope='selected_services' for update;
 if s.id is null then raise exception 'Invalid onboarding session'; end if;
 select * into sale from public.client_sales where workspace_id=p_workspace_id and id=s.source_sale_id;
 if sale.status not in('paid','test_paid') or sale.consent_confirmed_at is null then raise exception 'Confirm and pay before completing onboarding'; end if;
 if s.status='completed' then return jsonb_build_object('session_id',s.id,'idempotent',true); end if;
 if exists(select 1 from public.relationship_onboarding_session_steps x where x.workspace_id=p_workspace_id and x.session_id=s.id and x.kind<>'completion' and not exists(select 1 from public.work_items w where w.workspace_id=p_workspace_id and w.status='done' and w.native_kind='onboarding_step' and w.metadata->>'session_id'=s.id::text and w.metadata->>'session_step_id'=x.id::text)) then raise exception 'Submit every onboarding step before finishing'; end if;
 update public.relationship_onboarding_sessions set status='completed',completed_at=now(),updated_at=now() where id=s.id;
 update public.work_items set status='done',actual_completed_at=now(),actual_completed_has_time=true where workspace_id=p_workspace_id and native_key=s.id::text||':service-onboarding';
 update public.service_instance_sessions set enrollment='historical' where workspace_id=p_workspace_id and session_id=s.id;

 perform public.refresh_service_onboarding_readiness(p_workspace_id,s.id);
 return jsonb_build_object('session_id',s.id,'idempotent',false,'workflow_finalized',true);
end $$;

create function public.set_service_bookend_requirements() returns trigger language plpgsql security definer set search_path=public as $$
declare code text;
begin
 select m.internal_code into code from public.relationship_onboarding_session_modules sm join public.onboarding_modules m on m.workspace_id=sm.workspace_id and m.id=sm.module_id where sm.workspace_id=new.workspace_id and sm.id=new.session_module_id;
 if code in('system-welcome','system-completion') then new.review_required:=false; end if;
 if code='system-completion' then new.required:=false; end if;
 return new;
end $$;
create trigger set_service_bookend_requirements before insert on public.service_instance_module_requirements for each row execute function public.set_service_bookend_requirements();


-- Genuine completion goes through the existing authoritative validator. Neither
-- opening another session nor skipping a test step can create this evidence.
alter function public.complete_onboarding_session_step(uuid,uuid,uuid,uuid,text,uuid,text,jsonb,text,text,jsonb) rename to complete_onboarding_session_step_before_ss04;
create function public.complete_onboarding_session_step(p_workspace_id uuid,p_session_id uuid,p_session_step_id uuid,p_work_item_id uuid,p_session_token text,p_correlation_id uuid default null,p_idempotency_key text default null,p_form_response jsonb default null,p_form_title text default null,p_form_key text default null,p_uploads jsonb default '[]') returns jsonb
language plpgsql security invoker set search_path=public as $$
declare result jsonb;
begin
 result:=public.complete_onboarding_session_step_before_ss04(p_workspace_id,p_session_id,p_session_step_id,p_work_item_id,p_session_token,p_correlation_id,p_idempotency_key,p_form_response,p_form_title,p_form_key,p_uploads);
 perform public.record_onboarding_welcome_completion(p_workspace_id,p_session_id);
 return result;
end $$;

create function public.skip_previously_completed_welcome(p_workspace_id uuid,p_session_id uuid,p_session_token text,p_step_id uuid) returns void
language plpgsql security definer set search_path=public as $$
declare s public.relationship_onboarding_sessions%rowtype; prior uuid; step record; wid uuid; parent_id uuid;
begin
 select * into s from public.relationship_onboarding_sessions where workspace_id=p_workspace_id and id=p_session_id and session_token=p_session_token and token_revoked_at is null and status='active' for update;
 if s.id is null or not exists(select 1 from public.onboarding_welcome_step_ids(p_workspace_id,s.id) id where id=p_step_id) then raise exception 'Welcome cannot be skipped here'; end if;
 select id into prior from public.relationship_onboarding_sessions where workspace_id=p_workspace_id and relationship_id=s.relationship_id and id<>s.id and welcome_completed_at is not null and not welcome_test_skipped and welcome_skipped_from_session_id is null order by welcome_completed_at desc limit 1;
 if prior is null then raise exception 'Complete the welcome sequence before skipping it in another session'; end if;
 if s.source_sale_id is not null and not exists(select 1 from public.client_sales where workspace_id=p_workspace_id and id=s.source_sale_id and consent_confirmed_at is not null and status in('paid','test_paid')) then raise exception 'Confirm payment before continuing'; end if;
 if exists(select 1 from public.relationship_onboarding_session_steps x where x.workspace_id=p_workspace_id and x.session_id=s.id and x.superseded_at is null and x.is_actionable and x.sort_order<(select min(sort_order) from public.relationship_onboarding_session_steps where id in(select public.onboarding_welcome_step_ids(p_workspace_id,s.id))) and not exists(select 1 from public.work_items w where w.workspace_id=p_workspace_id and w.native_key=s.id::text||':step:'||x.id and w.status='done')) then raise exception 'Complete the preceding step first'; end if;
 update public.relationship_onboarding_sessions set welcome_skipped_from_session_id=prior where id=s.id;
 select parent_work_item_id into parent_id from public.work_items where workspace_id=p_workspace_id and native_kind='onboarding_step' and native_key=s.id::text||':step:'||p_step_id;
 for step in select * from public.relationship_onboarding_session_steps where id in(select public.onboarding_welcome_step_ids(p_workspace_id,s.id)) order by sort_order loop
  insert into public.work_items(workspace_id,title,description,lifecycle_phase,status,priority,native_kind,native_key,workflow_role,parent_work_item_id,actual_completed_at,actual_completed_has_time,sort_order,metadata,created_by)
  values(p_workspace_id,step.title,step.description,'onboarding','done',3,'onboarding_step',s.id::text||':step:'||step.id,'task',parent_id,now(),true,step.sort_order,jsonb_build_object('session_id',s.id,'session_step_id',step.id,'welcome_skipped_from',prior),s.created_by)
  on conflict (workspace_id,native_kind,native_key) where native_kind is not null and native_key is not null do update set status='done',actual_completed_at=coalesce(work_items.actual_completed_at,now()),metadata=work_items.metadata||jsonb_build_object('welcome_skipped_from',prior) returning id into wid;
  insert into public.work_item_relationships(workspace_id,relationship_id,work_item_id) values(p_workspace_id,s.relationship_id,wid) on conflict do nothing;
 end loop;
 perform public.refresh_service_onboarding_readiness(p_workspace_id,s.id);
end $$;

create or replace function public.enforce_onboarding_block_requirements()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare v_session_step_id uuid;
begin
    if new.native_kind <> 'onboarding_step' or new.status <> 'done' or old.status = 'done' then return new; end if;
    begin v_session_step_id := nullif(new.metadata->>'session_step_id', '')::uuid;
    exception when others then v_session_step_id := null; end;
    -- Only this token-authorized welcome reuse command records this provenance.
    -- The skipped run never becomes a source of genuine welcome completion.
    if v_session_step_id is not null and exists (
        select 1 from public.relationship_onboarding_sessions session
        join public.relationship_onboarding_sessions prior on prior.workspace_id=session.workspace_id and prior.relationship_id=session.relationship_id and prior.id=session.welcome_skipped_from_session_id
        where session.workspace_id=new.workspace_id and session.id::text=new.metadata->>'session_id' and session.status='active'
          and prior.welcome_completed_at is not null and not prior.welcome_test_skipped and prior.welcome_skipped_from_session_id is null
          and new.metadata->>'welcome_skipped_from'=prior.id::text
          and v_session_step_id in(select public.onboarding_welcome_step_ids(session.workspace_id,session.id))
    ) then return new; end if;
    if v_session_step_id is not null and exists (
        select 1
        from public.relationship_onboarding_session_blocks block
        join public.relationship_onboarding_sessions session
          on session.workspace_id = block.workspace_id
         and session.id = block.session_id
        where block.workspace_id = new.workspace_id
          and block.session_step_id = v_session_step_id
          and not session.is_test
          and block.required
          and not exists (
              select 1 from public.onboarding_block_requirements requirement
              where requirement.workspace_id = block.workspace_id and requirement.session_block_id = block.id
          )
    ) then
        raise exception using errcode = 'P0001', message = 'Complete the required onboarding items before continuing.';
    end if;
    return new;
end;
$$;

-- One bounded read supplies both welcome eligibility and compatible answer hints.
-- Hints never complete steps, copy uploads/consents or mutate relationship details.
create function public.read_onboarding_session_reuse(p_workspace_id uuid,p_session_id uuid,p_session_token text) returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare s public.relationship_onboarding_sessions%rowtype; responses jsonb; prior uuid;
begin
 select * into s from public.relationship_onboarding_sessions where workspace_id=p_workspace_id and id=p_session_id and session_token=p_session_token and token_revoked_at is null and status in('active','completed');
 if s.id is null then raise exception 'Invalid onboarding session'; end if;
 select id into prior from public.relationship_onboarding_sessions where workspace_id=p_workspace_id and relationship_id=s.relationship_id and id<>s.id and welcome_completed_at is not null and not welcome_test_skipped and welcome_skipped_from_session_id is null order by welcome_completed_at desc limit 1;
 with previous as materialized (
  select id from public.relationship_onboarding_sessions where workspace_id=p_workspace_id and relationship_id=s.relationship_id and id<>s.id and created_at<s.created_at and not welcome_test_skipped order by created_at desc limit 30
 ), compatible as (
  select current_step.id,source.old_step_id,source.response from public.relationship_onboarding_session_steps current_step
  join lateral (
   select old_step.id old_step_id,a.metadata->'response' response from public.relationship_onboarding_session_steps old_step
   join previous on previous.id=old_step.session_id
   join public.assets a on a.workspace_id=p_workspace_id and a.native_kind='onboarding_form_submission' and a.metadata->>'session_step_id'=old_step.id::text
   where old_step.workspace_id=p_workspace_id and old_step.module_revision_id=current_step.module_revision_id and old_step.source_step_id=current_step.source_step_id and old_step.superseded_at is null
   and exists(select 1 from public.work_items w where w.workspace_id=p_workspace_id and w.native_kind='onboarding_step' and w.native_key=old_step.session_id::text||':step:'||old_step.id and w.status='done')
   order by a.updated_at desc limit 1
  ) source on true
  where current_step.workspace_id=p_workspace_id and current_step.session_id=s.id and current_step.superseded_at is null and current_step.kind='form'
 ), mapped as (
  select c.id,jsonb_object_agg(f.id::text,c.response->oldf.id::text) response from compatible c
  join public.relationship_onboarding_session_fields f on f.workspace_id=p_workspace_id and f.session_step_id=c.id and f.type in('text','textarea','email','tel','number','url') and concat_ws(' ',f.label,f.legacy_field_name) !~* '(consent|agree|signature|password|payment|card number|token)'
  join public.relationship_onboarding_session_fields oldf on oldf.workspace_id=p_workspace_id and oldf.session_step_id=c.old_step_id and oldf.source_field_id=f.source_field_id and c.response ? oldf.id::text
  where f.source_field_id is not null group by c.id
 ) select coalesce(jsonb_object_agg(id::text,response),'{}') into responses from mapped;
 return jsonb_build_object('canSkipWelcome',prior is not null,'welcomeStepIds',coalesce((select jsonb_agg(id) from public.onboarding_welcome_step_ids(p_workspace_id,s.id) id),'[]'),'responses',responses);
end $$;

revoke all on function public.onboarding_welcome_step_ids(uuid,uuid),public.record_onboarding_welcome_completion(uuid,uuid),public.refresh_service_onboarding_readiness(uuid,uuid),public.read_onboarding_session_reuse(uuid,uuid,text),public.skip_previously_completed_welcome(uuid,uuid,text,uuid),public.complete_onboarding_session_step(uuid,uuid,uuid,uuid,text,uuid,text,jsonb,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.onboarding_welcome_step_ids(uuid,uuid),public.record_onboarding_welcome_completion(uuid,uuid),public.refresh_service_onboarding_readiness(uuid,uuid),public.read_onboarding_session_reuse(uuid,uuid,text),public.skip_previously_completed_welcome(uuid,uuid,text,uuid),public.complete_onboarding_session_step(uuid,uuid,uuid,uuid,text,uuid,text,jsonb,text,text,jsonb) to service_role;

-- Archived runs retain provenance for access and display after a restart.
create or replace function public.workspace_user_can_access_session_module(p_workspace_id uuid,p_session_module_id uuid,p_user_id uuid default auth.uid()) returns boolean
language sql stable security definer set search_path=public as $$
 select exists(select 1 from public.relationship_onboarding_session_modules m
 join public.relationship_onboarding_sessions s on s.workspace_id=m.workspace_id and s.id=m.session_id
 join public.relationships r on r.workspace_id=s.workspace_id and r.id=s.relationship_id
 join public.workspace_memberships u on u.workspace_id=r.workspace_id and u.user_id=p_user_id
 left join public.onboarding_service_revisions v on v.workspace_id=m.workspace_id and v.id=m.source_service_revision_id
 left join public.client_sales sale on sale.workspace_id=s.workspace_id and sale.id=coalesce(s.source_sale_id,s.original_source_sale_id)
 where m.workspace_id=p_workspace_id and m.id=p_session_module_id and (u.role in('owner','admin') or
 case when s.service_scope='selected_services' then
  sale.seller_user_id=p_user_id or sale.service_manager_user_id=p_user_id or exists(select 1 from public.service_instance_module_requirements req join public.relationship_service_instances i on i.workspace_id=req.workspace_id and i.id=req.instance_id where req.workspace_id=p_workspace_id and req.session_module_id=m.id and i.assignee_user_id=p_user_id)
 else r.seller_user_id=p_user_id or r.fulfilment_manager_user_id=p_user_id or exists(select 1 from public.relationship_services a where a.workspace_id=r.workspace_id and a.relationship_id=r.id and a.assignee_user_id=p_user_id and (m.source_kind='mandatory' or a.service_id=v.service_id)) end))
$$;
create or replace function public.read_selected_service_session_access(p_workspace_id uuid,p_session_ids uuid[],p_user_id uuid) returns jsonb
language sql stable security definer set search_path=public as $$
 with visible_modules as materialized (
 select m.id,m.session_id from public.relationship_onboarding_session_modules m join public.relationship_onboarding_sessions s on s.workspace_id=m.workspace_id and s.id=m.session_id
 where m.workspace_id=p_workspace_id and m.session_id=any(p_session_ids) and s.service_scope='selected_services' and public.workspace_user_can_access_session_module(p_workspace_id,m.id,p_user_id)
 ), full_sessions as materialized (
 select s.id from public.relationship_onboarding_sessions s join public.client_sales sale on sale.workspace_id=s.workspace_id and sale.id=coalesce(s.source_sale_id,s.original_source_sale_id)
 join public.workspace_memberships u on u.workspace_id=s.workspace_id and u.user_id=p_user_id
 where s.workspace_id=p_workspace_id and s.id=any(p_session_ids) and s.service_scope='selected_services' and (u.role in('owner','admin') or p_user_id in(sale.seller_user_id,sale.service_manager_user_id))
 ) select jsonb_build_object('moduleIds',coalesce((select jsonb_agg(id) from visible_modules),'[]'), 'fullSessionIds',coalesce((select jsonb_agg(id) from full_sessions),'[]'),
 'sessionIds',coalesce((select jsonb_agg(id) from (select session_id id from visible_modules union select id from full_sessions) ids),'[]'),
 'serviceNamesBySession',coalesce((select jsonb_object_agg(id,names) from (
 select s.id,jsonb_agg(item.service_name order by item.sort_order) names from public.relationship_onboarding_sessions s
 join public.client_sale_items item on item.workspace_id=s.workspace_id and item.client_sale_id=coalesce(s.source_sale_id,s.original_source_sale_id)
 join public.relationship_service_instances i on i.workspace_id=item.workspace_id and i.id=item.service_instance_id
 where s.workspace_id=p_workspace_id and s.id=any(p_session_ids) and (s.id in(select id from full_sessions) or i.assignee_user_id=p_user_id) group by s.id
 ) names),'{}'))
$$;

-- A public session row contains its bearer token. Only the exact sale's full
-- team can read that row; module-scoped staff use the redacted server panel.
create function public.workspace_user_can_access_full_onboarding_session(p_workspace_id uuid,p_session_id uuid,p_user_id uuid default auth.uid()) returns boolean
language sql stable security definer set search_path=public as $$
 select exists(select 1 from public.relationship_onboarding_sessions s
 join public.workspace_memberships member on member.workspace_id=s.workspace_id and member.user_id=p_user_id
 left join public.client_sales sale on sale.workspace_id=s.workspace_id and sale.id=coalesce(s.source_sale_id,s.original_source_sale_id)
 where s.workspace_id=p_workspace_id and s.id=p_session_id and
 (member.role in('owner','admin') or case when s.service_scope='selected_services' then p_user_id in(sale.seller_user_id,sale.service_manager_user_id) else public.workspace_user_fully_covers_relationship(p_workspace_id,s.relationship_id,p_user_id) end))
$$;
revoke all on function public.workspace_user_can_access_full_onboarding_session(uuid,uuid,uuid) from public,anon;
grant execute on function public.workspace_user_can_access_full_onboarding_session(uuid,uuid,uuid) to authenticated,service_role;
drop policy if exists "service scoped staff onboarding sessions" on public.relationship_onboarding_sessions;
create policy "service scoped staff onboarding sessions" on public.relationship_onboarding_sessions as restrictive for select to authenticated using(public.workspace_user_can_access_full_onboarding_session(workspace_id,id));

create index onboarding_session_panel_order_idx on public.relationship_onboarding_sessions(workspace_id,created_at desc,id desc);
create function public.read_onboarding_panel_sessions(p_workspace_id uuid,p_user_id uuid,p_offset integer default 0,p_relationship_id uuid default null) returns jsonb
language sql stable security definer set search_path=public as $$
 with page as materialized (
 select s.* from public.relationship_onboarding_sessions s
 where s.workspace_id=p_workspace_id and (p_relationship_id is null or s.relationship_id=p_relationship_id)
 and public.workspace_user_can_access_relationship(p_workspace_id,s.relationship_id,p_user_id)
 and (public.workspace_user_can_access_full_onboarding_session(p_workspace_id,s.id,p_user_id) or exists(select 1 from public.relationship_onboarding_session_modules m where m.workspace_id=s.workspace_id and m.session_id=s.id and public.workspace_user_can_access_session_module(p_workspace_id,m.id,p_user_id)))
 order by s.created_at desc,s.id desc limit 51 offset greatest(0,least(coalesce(p_offset,0),100000))
 ), displayed as (select * from page order by created_at desc,id desc limit 50)
 select jsonb_build_object('hasMore',(select count(*)>50 from page),'sessions',coalesce((select jsonb_agg(jsonb_build_object('id',s.id,'relationship_id',s.relationship_id,'status',s.status,'session_token',case when s.token_revoked_at is null and public.workspace_user_can_access_full_onboarding_session(p_workspace_id,s.id,p_user_id) then s.session_token end,'is_test',s.is_test,'created_by',s.created_by,'created_at',s.created_at,'updated_at',s.updated_at,'completed_at',s.completed_at,'service_scope',s.service_scope,'source_sale_id',coalesce(s.source_sale_id,s.original_source_sale_id)) order by s.created_at desc,s.id desc) from displayed s),'[]'),'access',public.read_selected_service_session_access(p_workspace_id,coalesce((select array_agg(id) from displayed),'{}'),p_user_id))
$$;
revoke all on function public.read_onboarding_panel_sessions(uuid,uuid,integer,uuid) from public,anon,authenticated;
grant execute on function public.read_onboarding_panel_sessions(uuid,uuid,integer,uuid) to service_role;

create function public.mark_onboarding_test_shortcut(p_workspace_id uuid,p_session_id uuid,p_session_token text,p_step_id uuid) returns void
language plpgsql security definer set search_path=public as $$
begin
 update public.relationship_onboarding_sessions s set welcome_test_skipped=true,welcome_completed_at=null
 where s.workspace_id=p_workspace_id and s.id=p_session_id and s.session_token=p_session_token and s.is_test and s.status='active' and s.token_revoked_at is null
 and p_step_id in(select public.onboarding_welcome_step_ids(p_workspace_id,p_session_id));
end $$;
revoke all on function public.mark_onboarding_test_shortcut(uuid,uuid,text,uuid) from public,anon,authenticated;
grant execute on function public.mark_onboarding_test_shortcut(uuid,uuid,text,uuid) to service_role;

create function public.reconcile_relationship_service_team(p_workspace_id uuid,p_relationship_id uuid) returns void
language plpgsql security definer set search_path=public as $$
declare t uuid;
begin
 if exists(select 1 from public.relationships where workspace_id=p_workspace_id and id=p_relationship_id and status='archived') then return; end if;
 perform public.create_relationship_delivery_team(p_workspace_id,p_relationship_id);
 select id into t from public.workspace_teams where workspace_id=p_workspace_id and relationship_id=p_relationship_id;
 insert into public.workspace_team_members(workspace_id,team_id,user_id,added_by)
 select p_workspace_id,t,member.user_id,null from public.workspace_memberships member where member.workspace_id=p_workspace_id
 and exists(select 1 from public.client_sales sale where sale.workspace_id=p_workspace_id and sale.relationship_id=p_relationship_id and sale.service_scope='selected_services' and sale.snapshot_frozen_at is not null
 and (member.user_id in(sale.seller_user_id,sale.service_manager_user_id) or exists(select 1 from public.client_sale_items item where item.workspace_id=p_workspace_id and item.client_sale_id=sale.id and item.default_assignee_user_id=member.user_id))) on conflict do nothing;
end $$;
revoke all on function public.reconcile_relationship_service_team(uuid,uuid) from public,anon,authenticated;
grant execute on function public.reconcile_relationship_service_team(uuid,uuid) to service_role;
do $$ declare r record; begin
 for r in select distinct workspace_id,relationship_id from public.client_sales where service_scope='selected_services' and snapshot_frozen_at is not null loop
  perform public.reconcile_relationship_service_team(r.workspace_id,r.relationship_id);
 end loop;
end $$;

-- Staff attachment access follows the same session-module boundary as the panel.
create or replace function public.workspace_user_can_access_asset(p_workspace_id uuid,p_asset_id uuid,p_user_id uuid default auth.uid()) returns boolean
language sql stable security definer set search_path=public as $$
 select case when public.workspace_role_for_user(p_workspace_id,p_user_id) in('owner','admin') then true
 when public.workspace_role_for_user(p_workspace_id,p_user_id) is distinct from 'staff' then false
 when exists(select 1 from public.assets a join public.relationship_onboarding_sessions s on s.workspace_id=a.workspace_id and s.id=case when a.metadata->>'session_id' ~* '^[0-9a-f-]{36}$' then (a.metadata->>'session_id')::uuid end where a.workspace_id=p_workspace_id and a.id=p_asset_id and s.service_scope='selected_services') then
 exists(select 1 from public.assets a join public.relationship_onboarding_session_steps st on st.workspace_id=a.workspace_id and st.id=case when a.metadata->>'session_step_id' ~* '^[0-9a-f-]{36}$' then (a.metadata->>'session_step_id')::uuid end and st.session_id::text=a.metadata->>'session_id' where a.workspace_id=p_workspace_id and a.id=p_asset_id and public.workspace_user_can_access_session_module(p_workspace_id,st.session_module_id,p_user_id))
 else exists(select 1 from public.asset_relationships l where l.workspace_id=p_workspace_id and l.asset_id=p_asset_id and public.workspace_user_fully_covers_relationship(p_workspace_id,l.relationship_id,p_user_id))
 or exists(select 1 from public.asset_work_items l where l.workspace_id=p_workspace_id and l.asset_id=p_asset_id and public.workspace_user_can_access_work_item(p_workspace_id,l.work_item_id,p_user_id)) end
$$;
create function public.read_accessible_onboarding_asset_ids(p_workspace_id uuid,p_relationship_ids uuid[],p_work_item_ids uuid[],p_user_id uuid) returns setof uuid
language sql stable security definer set search_path=public as $$
 select asset_id from (select asset_id from public.asset_relationships where workspace_id=p_workspace_id and relationship_id=any(p_relationship_ids) union select asset_id from public.asset_work_items where workspace_id=p_workspace_id and work_item_id=any(p_work_item_ids)) candidates where public.workspace_user_can_access_asset(p_workspace_id,asset_id,p_user_id)
$$;
revoke all on function public.read_accessible_onboarding_asset_ids(uuid,uuid[],uuid[],uuid) from public,anon,authenticated;
grant execute on function public.read_accessible_onboarding_asset_ids(uuid,uuid[],uuid[],uuid) to service_role;

do $$ declare definition text; anchor text:='        if old.import_id is not null then'; begin
 definition:=pg_get_functiondef('public.guard_service_instance()'::regprocedure);
 if position(anchor in definition)=0 then raise exception 'Service transition owner changed; inspect before release'; end if;
 definition:=replace(definition,anchor,E'        if old.stage=''onboarding'' and new.stage=''setup'' and new.assignee_user_id is not distinct from old.assignee_user_id then\n            payment_transition:=payment_transition or exists(select 1 from public.service_instance_sessions e join public.relationship_onboarding_sessions s on s.workspace_id=e.workspace_id and s.id=e.session_id join public.client_sales sale on sale.workspace_id=s.workspace_id and sale.id=s.source_sale_id where e.workspace_id=new.workspace_id and e.instance_id=new.id and sale.service_manager_user_id=new.changed_by and public.service_instance_onboarding_ready(new.workspace_id,new.id,s.id));\n        end if;\n'||anchor);
 execute definition;
end $$;

-- Restart archives the old run while retaining its original sale identity.
do $$ declare definition text; anchor text := 'l.sale_id = s.source_sale_id'; begin
 definition := pg_get_functiondef('public.guard_service_instance_link()'::regprocedure);
 if position(anchor in definition)=0 then raise exception 'Service enrollment guard changed; inspect before release'; end if;
 execute replace(definition,anchor,'l.sale_id = coalesce(s.source_sale_id,s.original_source_sale_id)');
end $$;

create function public.isolate_archived_service_onboarding() returns trigger language plpgsql security definer set search_path=public as $$
begin
 if new.service_scope='selected_services' and new.status='archived' and old.status is distinct from new.status then
  update public.service_instance_sessions set enrollment='historical' where workspace_id=new.workspace_id and session_id=new.id;
  update public.work_items set status='canceled',workflow_required=false,updated_at=now() where workspace_id=new.workspace_id and status<>'done' and native_kind='relationship_workflow' and (native_key=new.id::text||':service-onboarding' or native_key like new.id::text||':service-review:%');
 end if;
 return new;
end $$;
create trigger isolate_archived_service_onboarding after update of status on public.relationship_onboarding_sessions for each row execute function public.isolate_archived_service_onboarding();
do $$ declare session record; begin
 for session in select workspace_id,id from public.relationship_onboarding_sessions where service_scope='selected_services' and status in('active','completed') and token_revoked_at is null loop
  perform public.refresh_service_onboarding_readiness(session.workspace_id,session.id);
 end loop;
end $$;
notify pgrst,'reload schema';
commit;
