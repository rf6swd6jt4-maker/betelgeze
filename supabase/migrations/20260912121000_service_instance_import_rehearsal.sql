-- SS-01 migration planning and import. Explicit, per-relationship, service-only.
-- No call is made by applying this migration. No client-facing state is changed.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

create function public.service_instance_import_source(p_workspace_id uuid, p_relationship_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare result jsonb;
begin
    -- Bounded operational batches, never a page/bootstrap reader. Fail closed;
    -- an oversized relationship needs a separately reviewed migration batch.
    if (select count(*) from (select 1 from public.relationship_services where workspace_id = p_workspace_id and relationship_id = p_relationship_id limit 501) q) > 500
        or (select count(*) from (select 1 from public.client_sales where workspace_id = p_workspace_id and relationship_id = p_relationship_id limit 101) q) > 100
        or (select count(*) from (select 1 from public.client_sale_items i join public.client_sales s on s.id = i.client_sale_id and s.workspace_id = i.workspace_id where s.workspace_id = p_workspace_id and s.relationship_id = p_relationship_id limit 501) q) > 500
        or (select count(*) from (select 1 from public.relationship_onboarding_sessions where workspace_id = p_workspace_id and relationship_id = p_relationship_id limit 101) q) > 100
        or (select count(*) from (select 1 from public.work_item_relationships where workspace_id = p_workspace_id and relationship_id = p_relationship_id limit 5001) q) > 5000
        or (select count(*) from (select 1 from public.relationship_onboarding_session_modules m join public.relationship_onboarding_sessions s on s.workspace_id = m.workspace_id and s.id = m.session_id where s.workspace_id = p_workspace_id and s.relationship_id = p_relationship_id limit 2001) q) > 2000
    then raise exception 'Relationship exceeds SS-01 rehearsal bounds; use a reviewed migration batch'; end if;
    select jsonb_build_object(
        'relationship', jsonb_build_object('id', r.id, 'workspace_id', r.workspace_id, 'lifecycle_phase', r.lifecycle_phase, 'status', r.status,
            'seller_user_id', r.seller_user_id, 'manager_user_id', r.fulfilment_manager_user_id),
        'services', coalesce((select jsonb_agg(to_jsonb(s) order by s.service_key) from public.relationship_services s where s.workspace_id = r.workspace_id and s.relationship_id = r.id), '[]'::jsonb),
        'sales', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'snapshot_frozen_at', s.snapshot_frozen_at, 'status', s.status,
            'stripe_invoice_status', s.stripe_invoice_status, 'seller_user_id', s.seller_user_id, 'currency', s.currency,
            'upfront_total_amount', s.upfront_total_amount, 'recurring_total_amount', s.recurring_total_amount,
            'billing_interval', s.billing_interval, 'billing_interval_count', s.billing_interval_count) order by s.id)
            from public.client_sales s where s.workspace_id = r.workspace_id and s.relationship_id = r.id), '[]'::jsonb),
        'sale_items', coalesce((select jsonb_agg(to_jsonb(i) order by i.id) from public.client_sale_items i join public.client_sales s on s.workspace_id = i.workspace_id and s.id = i.client_sale_id
            where s.workspace_id = r.workspace_id and s.relationship_id = r.id), '[]'::jsonb),
        'sessions', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'status', s.status, 'source_sale_id', s.source_sale_id) order by s.id)
            from public.relationship_onboarding_sessions s where s.workspace_id = r.workspace_id and s.relationship_id = r.id), '[]'::jsonb),
        'modules', coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'session_id', m.session_id, 'source_kind', m.source_kind,
            'source_service_revision_id', m.source_service_revision_id, 'module_revision_id', m.module_revision_id,
            'service_revision_ids', coalesce((select jsonb_agg(distinct rm.service_revision_id) from public.onboarding_service_revision_modules rm
                join public.client_sale_items li on li.workspace_id = rm.workspace_id and li.service_revision_id = rm.service_revision_id
                where rm.workspace_id = m.workspace_id and rm.module_id = m.module_id and li.client_sale_id = s.source_sale_id), '[]'::jsonb)) order by m.id)
            from public.relationship_onboarding_session_modules m join public.relationship_onboarding_sessions s on s.workspace_id = m.workspace_id and s.id = m.session_id
            where s.workspace_id = r.workspace_id and s.relationship_id = r.id), '[]'::jsonb),
        'work', coalesce((select jsonb_agg(jsonb_build_object('id', w.id, 'service_id', w.service_id, 'native_key', w.native_key,
            'status', w.status, 'actual_completed_at', w.actual_completed_at) order by w.id)
            from public.work_items w where w.workspace_id = r.workspace_id and exists(select 1 from public.work_item_relationships l where l.workspace_id = r.workspace_id and l.relationship_id = r.id and l.work_item_id = w.id)), '[]'::jsonb)
    ) into result from public.relationships r where r.workspace_id = p_workspace_id and r.id = p_relationship_id;
    if result is null then raise exception 'Relationship not found'; end if;
    return result;
end $$;

create function public.service_instance_import_candidates(p_source jsonb) returns jsonb
language plpgsql immutable set search_path = public as $$
declare candidate jsonb; sale jsonb; legacy jsonb; candidates jsonb := '[]'; result jsonb := '[]';
    reasons text[]; stage text; phase text := p_source#>>'{relationship,lifecycle_phase}'; n integer; sale_count integer; assignment_count integer;
begin
    -- Every frozen historical purchase is distinct, including repeated services.
    for candidate in select value from jsonb_array_elements(p_source->'sale_items') loop
        select value into sale from jsonb_array_elements(p_source->'sales') where value->>'id' = candidate->>'client_sale_id';
        if sale->>'snapshot_frozen_at' is not null then
            candidates := candidates || jsonb_build_array(jsonb_build_object('source_key', 'sale-item:' || (candidate->>'id'),
                'service_key', candidate->>'service_code', 'service_id', candidate->>'service_id', 'service_revision_id', candidate->>'service_revision_id',
                'sale_item_id', candidate->>'id', 'sale_id', sale->>'id', 'snapshot', candidate));
        end if;
    end loop;
    for legacy in select value from jsonb_array_elements(p_source->'services') loop
        if not exists(select 1 from jsonb_array_elements(candidates) c where c->>'service_id' = legacy->>'service_id') then
            candidates := candidates || jsonb_build_array(jsonb_build_object('source_key', 'legacy-service:' || (legacy->>'service_key'),
                'service_key', legacy->>'service_key', 'service_id', legacy->>'service_id', 'service_revision_id', legacy->>'service_revision_id',
                'sale_item_id', null, 'sale_id', null, 'snapshot', legacy));
        end if;
    end loop;
    for candidate in select value from jsonb_array_elements(candidates) loop
        reasons := '{}'; stage := null; sale := null; legacy := null;
        select count(*) into n from jsonb_array_elements(candidates) c where c->>'service_id' = candidate->>'service_id';
        select count(*) into assignment_count from jsonb_array_elements(p_source->'services') s where s->>'service_id' = candidate->>'service_id';
        if candidate->>'sale_item_id' is null then
            legacy := candidate->'snapshot';
        elsif assignment_count = 1 and n = 1 then
            select value into legacy from jsonb_array_elements(p_source->'services') s where s->>'service_id' = candidate->>'service_id';
        end if;
        if n > 1 or assignment_count > 1 then reasons := array_append(reasons, 'ambiguous_repeated_service'); end if;
        if candidate->>'service_id' is null or candidate->>'service_revision_id' is null then reasons := array_append(reasons, 'missing_catalogue_revision'); end if;
        if candidate->>'sale_id' is not null then
            select value into sale from jsonb_array_elements(p_source->'sales') where value->>'id' = candidate->>'sale_id';
            if legacy is null then reasons := array_append(reasons, 'no_unambiguous_current_assignment'); end if;
            if legacy is not null and legacy->>'service_revision_id' is distinct from candidate->>'service_revision_id' then reasons := array_append(reasons, 'current_revision_differs_from_sale'); end if;
        end if;
        select count(*) into sale_count from jsonb_array_elements(p_source->'sales') s where s->>'snapshot_frozen_at' is not null;
        if sale_count > 1 then reasons := array_append(reasons, 'relationship_stage_covers_multiple_sales'); end if;
        if p_source#>>'{relationship,status}' = 'archived' or phase = 'completed_lost' then
            reasons := array_append(reasons, 'archived_or_completed_lost_is_ambiguous');
        elsif phase in ('lead', 'nurturing', 'potential_client') and sale is null then stage := 'negotiating';
        elsif phase in ('sold', 'invoiced') then
            if sale->>'status' = 'paid' or sale->>'stripe_invoice_status' = 'paid' then stage := 'onboarding';
            elsif sale->>'status' = 'payment_pending' or sale->>'stripe_invoice_status' = 'open' then stage := 'awaiting_payment';
            else reasons := array_append(reasons, 'payment_state_not_verified'); end if;
        elsif phase in ('onboarding', 'onboarding_review') then
            if sale is not null and not (coalesce(sale->>'status', '') = 'paid' or coalesce(sale->>'stripe_invoice_status', '') = 'paid') then
                reasons := array_append(reasons, 'payment_state_not_verified');
            elsif exists(select 1 from jsonb_array_elements(p_source->'sessions') s where (sale is null and s->>'source_sale_id' is null) or s->>'source_sale_id' = sale->>'id') then stage := 'onboarding';
            else reasons := array_append(reasons, 'missing_onboarding_session'); end if;
        elsif phase = 'fulfilment' then
            if sale is not null and not (coalesce(sale->>'status', '') = 'paid' or coalesce(sale->>'stripe_invoice_status', '') = 'paid') then
                reasons := array_append(reasons, 'payment_state_not_verified');
            elsif exists(select 1 from jsonb_array_elements(p_source->'sessions') s where s->>'status' = 'active' and (sale is null or s->>'source_sale_id' = sale->>'id')) then
                reasons := array_append(reasons, 'setup_conflicts_with_active_onboarding');
            else stage := 'setup'; end if;
        elsif phase = 'retention' then reasons := array_append(reasons, 'retention_requires_service_evidence');
        else reasons := array_append(reasons, 'unmapped_or_conflicting_stage'); end if;
        if cardinality(reasons) > 0 then stage := null; end if;
        result := result || jsonb_build_array(candidate || jsonb_build_object('stage', stage, 'review_reasons', to_jsonb(reasons),
            'assignee_user_id', legacy->>'assignee_user_id', 'seller_user_id', coalesce(sale->>'seller_user_id', p_source#>>'{relationship,seller_user_id}'),
            'manager_user_id', p_source#>>'{relationship,manager_user_id}'));
    end loop;
    return result;
end $$;

create function public.prepare_service_instance_import(p_workspace_id uuid, p_relationship_id uuid, p_actor_user_id uuid, p_apply boolean default false) returns jsonb
language plpgsql security definer set search_path = public as $$
declare source jsonb; candidates jsonb; v_candidate jsonb; v_session jsonb; v_module jsonb; v_work jsonb; report jsonb; source_hash text;
    existing public.service_instance_imports%rowtype; v_import_id uuid; instance_id uuid; work_links jsonb; unlinked_work jsonb; unlinked_modules jsonb;
begin
    if not exists(select 1 from public.workspace_memberships where workspace_id = p_workspace_id and user_id = p_actor_user_id and role in ('owner', 'admin')) then
        raise exception 'An owner or admin must authorize migration rehearsal';
    end if;
    if p_apply is null then raise exception 'Specify dry run or prepare explicitly'; end if;
    if p_apply and current_setting('transaction_isolation') not in ('repeatable read', 'serializable') then
        raise exception 'Prepare imports in a REPEATABLE READ or SERIALIZABLE transaction';
    end if;
    source := public.service_instance_import_source(p_workspace_id, p_relationship_id);
    source_hash := md5(source::text);
    select * into existing from public.service_instance_imports where workspace_id = p_workspace_id and relationship_id = p_relationship_id;
    if existing.id is not null then
        if existing.source_hash <> source_hash then raise exception 'Legacy source changed since rehearsal; prepared import is stale and must not be activated'; end if;
        return existing.report || jsonb_build_object('prepared', true, 'import_id', existing.id, 'replayed', true);
    end if;
    candidates := public.service_instance_import_candidates(source);
    -- Only exact, unique service attribution is imported. Shared/general work
    -- stays linked to its relationship; no lifecycle parent is falsely copied.
    select coalesce(jsonb_agg(jsonb_build_object('work_item_id', w->>'id', 'source_key', c->>'source_key') order by w->>'id'), '[]') into work_links
    from jsonb_array_elements(source->'work') w join jsonb_array_elements(candidates) c on c->>'service_id' = w->>'service_id'
    where not ((c->'review_reasons') ? 'current_revision_differs_from_sale') and (select count(*) from jsonb_array_elements(candidates) c2 where c2->>'service_id' = w->>'service_id') = 1;
    select coalesce(jsonb_agg(w->>'id' order by w->>'id'), '[]') into unlinked_work from jsonb_array_elements(source->'work') w
    where not exists(select 1 from jsonb_array_elements(work_links) l where l->>'work_item_id' = w->>'id');
    select coalesce(jsonb_agg(m->>'id' order by m->>'id'), '[]') into unlinked_modules
    from jsonb_array_elements(source->'modules') m where not exists (
        select 1 from jsonb_array_elements(source->'sessions') s join jsonb_array_elements(candidates) c on c->>'sale_id' = s->>'source_sale_id'
        where s->>'id' = m->>'session_id' and (m->>'source_kind' = 'mandatory' or m->>'source_service_revision_id' = c->>'service_revision_id' or (m->'service_revision_ids') ? (c->>'service_revision_id'))
    );
    report := jsonb_build_object('version', 1, 'runtime_owner', 'legacy', 'source_hash', source_hash, 'instances', candidates,
        'instance_count', jsonb_array_length(candidates), 'review_count', (select count(*) from jsonb_array_elements(candidates) c where jsonb_array_length(c->'review_reasons') > 0),
        'work_links', work_links, 'unattributed_work_ids', unlinked_work, 'unattributed_module_ids', unlinked_modules,
        'unfrozen_sale_item_ids', (select coalesce(jsonb_agg(i->>'id'), '[]') from jsonb_array_elements(source->'sale_items') i where not exists(select 1 from jsonb_array_elements(candidates) c where c->>'sale_item_id' = i->>'id')),
        'unlinked_session_ids', (select coalesce(jsonb_agg(s->>'id'), '[]') from jsonb_array_elements(source->'sessions') s where not exists(select 1 from jsonb_array_elements(candidates) c where c->>'sale_id' = s->>'source_sale_id')),
        'sales_without_frozen_items', (select coalesce(jsonb_agg(s->>'id'), '[]') from jsonb_array_elements(source->'sales') s where not exists(select 1 from jsonb_array_elements(candidates) c where c->>'sale_id' = s->>'id')),
        'source_service_count', jsonb_array_length(source->'services'), 'source_sale_item_count', jsonb_array_length(source->'sale_items'),
        'source_work_count', jsonb_array_length(source->'work'), 'source_session_count', jsonb_array_length(source->'sessions'));
    if not p_apply then return report || jsonb_build_object('prepared', false); end if;
    insert into public.service_instance_imports(workspace_id, relationship_id, source_hash, report, created_by)
    values(p_workspace_id, p_relationship_id, source_hash, report, p_actor_user_id) returning id into v_import_id;
    for v_candidate in select value from jsonb_array_elements(candidates) loop
        insert into public.relationship_service_instances(workspace_id, relationship_id, service_id, service_revision_id, service_key, source_key, origin, stage,
            import_id, review_reasons, assignee_user_id, seller_user_id, manager_user_id, source_snapshot, change_request_id, change_reason, changed_by)
        values(p_workspace_id, p_relationship_id, (v_candidate->>'service_id')::uuid, (v_candidate->>'service_revision_id')::uuid, v_candidate->>'service_key', v_candidate->>'source_key', 'legacy_import', v_candidate->>'stage',
            v_import_id, array(select jsonb_array_elements_text(v_candidate->'review_reasons')), (v_candidate->>'assignee_user_id')::uuid, (v_candidate->>'seller_user_id')::uuid, (v_candidate->>'manager_user_id')::uuid,
            v_candidate->'snapshot', gen_random_uuid(), 'SS-01 prepared import; legacy remains authoritative', p_actor_user_id) returning id into instance_id;
        if v_candidate->>'sale_item_id' is not null then
            insert into public.service_instance_sale_items(workspace_id, relationship_id, instance_id, sale_item_id, sale_id, commercial_snapshot)
            values(p_workspace_id, p_relationship_id, instance_id, (v_candidate->>'sale_item_id')::uuid, (v_candidate->>'sale_id')::uuid, '{}');
            for v_session in select value from jsonb_array_elements(source->'sessions') where value->>'source_sale_id' = v_candidate->>'sale_id' loop
                insert into public.service_instance_sessions(workspace_id, relationship_id, instance_id, session_id)
                values(p_workspace_id, p_relationship_id, instance_id, (v_session->>'id')::uuid);
                for v_module in select value from jsonb_array_elements(source->'modules') where value->>'session_id' = v_session->>'id'
                    and (value->>'source_kind' = 'mandatory' or value->>'source_service_revision_id' = v_candidate->>'service_revision_id' or (value->'service_revision_ids') ? (v_candidate->>'service_revision_id')) loop
                    insert into public.service_instance_module_requirements(workspace_id, instance_id, session_id, session_module_id)
                    values(p_workspace_id, instance_id, (v_session->>'id')::uuid, (v_module->>'id')::uuid);
                end loop;
            end loop;
        end if;
        for v_work in select value from jsonb_array_elements(work_links) where value->>'source_key' = v_candidate->>'source_key' loop
            insert into public.service_instance_work_items(workspace_id, instance_id, work_item_id) values(p_workspace_id, instance_id, (v_work->>'work_item_id')::uuid);
        end loop;
    end loop;
    -- Reconcile via explicit qualified predicates (see below) before acceptance.
    if (select count(*) from public.relationship_service_instances i where i.workspace_id = p_workspace_id and i.import_id = v_import_id) <> jsonb_array_length(candidates) then
        raise exception 'Instance reconciliation failed';
    end if;
    if exists (select 1 from public.service_instance_sale_items l
        join public.relationship_service_instances i on i.id = l.instance_id
        join public.client_sale_items li on li.workspace_id = l.workspace_id and li.id = l.sale_item_id
        where i.import_id = v_import_id and l.commercial_snapshot->'line' is distinct from to_jsonb(li)) then
        raise exception 'Commercial snapshot reconciliation failed';
    end if;
    if (select count(*) from public.service_instance_work_items l join public.relationship_service_instances i on i.id = l.instance_id where i.import_id = v_import_id) <> jsonb_array_length(work_links) then
        raise exception 'Work link reconciliation failed';
    end if;
    return report || jsonb_build_object('prepared', true, 'import_id', v_import_id, 'replayed', false);
end $$;
revoke all on function public.service_instance_import_source(uuid, uuid), public.service_instance_import_candidates(jsonb), public.prepare_service_instance_import(uuid, uuid, uuid, boolean) from public, anon, authenticated;
grant execute on function public.service_instance_import_source(uuid, uuid), public.service_instance_import_candidates(jsonb), public.prepare_service_instance_import(uuid, uuid, uuid, boolean) to service_role;
commit;
