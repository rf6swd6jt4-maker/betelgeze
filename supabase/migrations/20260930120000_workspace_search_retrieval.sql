-- One current-membership read for search. The HTTP owner verifies AAL2 first;
-- only the server role may supply the already verified actor. No stored rows,
-- existing access policies, message reads or alert owners are changed.
-- The 1000-row relationship/client windows preserve the deployed PostgREST
-- max_rows confirmed for this release. Verify that prerequisite in other targets.
-- Existing category sampling remains deliberate; complete coverage is a later pass.
begin;

-- JavaScript lowercases with Unicode's context-sensitive mappings. The ICU
-- root collation preserves dotted I and final sigma; libc simple lower does not.
-- Fail installation closed if this database cannot preserve those semantics.
do $preflight$
begin
    if lower('İ' collate pg_catalog."und-x-icu") <> U&'i\0307'
       or lower('ΟΔΟΣ' collate pg_catalog."und-x-icu") <> 'οδος' then
        raise exception 'Search requires Unicode full lowercase support';
    end if;
end;
$preflight$;

create function public.search_workspace_records(p_workspace_slug text, p_user_id uuid, p_query text)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $function$
declare
    -- ECMAScript String.trim whitespace for the existing legacy-client fallback.
    v_trim constant text := U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF';
    v_workspace_id uuid;
    v_workspace_name text;
    v_workspace_slug text;
    v_role text;
    v_private boolean;
    v_can_sell boolean;
    v_capabilities text[];
    v_query text := lower(btrim(coalesce(p_query, ''), v_trim) collate pg_catalog."und-x-icu");
    v_result jsonb;
    v_rows jsonb;
    -- Bounded legacy navigation map from the same source windows as the old
    -- application. Owner/admin only; never a workspace authorization scope.
    v_client_relationships jsonb;
begin
    select w.id, w.name, w.slug, case m.role when 'member' then 'staff' else m.role end
    into v_workspace_id, v_workspace_name, v_workspace_slug, v_role
    from public.workspaces w
    join public.workspace_memberships m on m.workspace_id = w.id and m.user_id = p_user_id
    where w.slug = p_workspace_slug and w.status = 'active'
      and m.role in ('owner', 'admin', 'staff', 'member');
    if v_workspace_id is null then return null; end if;
    if length(v_query) > 200 then raise exception 'Search query is too long' using errcode = '22023'; end if;

    v_private := v_role in ('owner', 'admin');
    v_can_sell := public.workspace_user_can_sell(v_workspace_id, p_user_id);
    -- Only capabilities consumed by the existing search navigation registry.
    -- Appointment template definitions are unrelated to these destinations.
    if v_private then
        v_capabilities := array['relationships.view', 'onboarding.manage', 'fulfilment.manage',
            'client_connections.manage', 'communications.manage', 'library.manage',
            'onboarding_builder.manage', 'leadgen.manage', 'admin.manage', 'settings.manage'];
    else
        v_capabilities := array['fulfilment.manage', 'communications.manage'];
        if exists (select 1 from public.workspace_operational_roles o
                   where o.workspace_id = v_workspace_id and o.user_id = p_user_id and (o.can_sell or o.can_manage)) then
            v_capabilities := array_append(v_capabilities, 'relationships.view');
        end if;
        if exists (select 1 from public.workspace_member_service_access a
                   join public.workspace_service_capabilities c on c.workspace_id = a.workspace_id and c.service_id = a.service_id
                   where a.workspace_id = v_workspace_id and a.user_id = p_user_id and c.capability = 'onboarding.manage') then
            v_capabilities := array_append(v_capabilities, 'onboarding.manage');
        end if;
        if exists (select 1 from public.appointment_setting_setup_assignees a
                   where a.workspace_id = v_workspace_id and a.user_id = p_user_id) then
            v_capabilities := array_append(v_capabilities, 'client_connections.manage');
        end if;
    end if;

    v_result := jsonb_build_object(
        'workspace', jsonb_build_object('id', v_workspace_id, 'name', v_workspace_name, 'slug', v_workspace_slug),
        'role', v_role, 'can_sell', v_can_sell, 'capabilities', to_jsonb(v_capabilities),
        'relationships', '[]'::jsonb, 'work_items', '[]'::jsonb, 'channels', '[]'::jsonb,
        'okrs', '[]'::jsonb, 'key_results', '[]'::jsonb, 'admin_activity', '[]'::jsonb,
        'modules', '[]'::jsonb, 'services', '[]'::jsonb, 'clients', '[]'::jsonb,
        'assets', '[]'::jsonb, 'notes', '[]'::jsonb, 'activities', '[]'::jsonb);
    if length(v_query) < 2 then return v_result; end if;

    -- Match before authorization; materialization prevents an expensive access
    -- predicate from being evaluated against nonmatching source candidates.
    -- Source windows retain existing discovery limits. Every emitted record
    -- passes its policy before the final result limit.
    -- array_to_string skips NULL and array_remove skips empty strings, matching
    -- the existing readable-field join. strpos treats wildcard characters literally.
    with canonical as materialized (
        select r.id, r.workspace_id, r.client_id, r.primary_person_name, r.primary_email, r.primary_phone,
            r.business_name, r.website_url, r.industry_value, r.location_value, r.source_label,
            r.primary_contact_role, r.notes_summary, r.updated_at
        from public.relationships r where r.workspace_id = v_workspace_id order by r.updated_at desc limit 1000
    ), client_sample as materialized (
        select c.id, c.workspace_id, c.name, c.email, c.phone, c.archived_at, c.created_at
        from public.clients c where c.workspace_id = v_workspace_id and c.archived_at is null
        order by c.created_at desc, c.id limit 1000
    ), matching as materialized (
        select r.id, r.primary_person_name, r.business_name, r.primary_email, r.primary_phone, r.updated_at
        from canonical r
        where r.workspace_id = v_workspace_id and (
            strpos(lower(r.id::text collate pg_catalog."und-x-icu"), v_query) > 0 or
            strpos(lower(array_to_string(array_remove(array[r.primary_person_name, r.primary_email, r.primary_phone,
                r.business_name, r.website_url, r.industry_value, r.location_value, r.source_label,
                r.primary_contact_role, r.notes_summary], ''), ' ') collate pg_catalog."und-x-icu"), v_query) > 0)
    ), permitted as (
        select m.* from matching m
        where v_private or public.workspace_user_can_access_relationship(v_workspace_id, m.id, p_user_id)
        union all
        select c.id, coalesce(nullif(btrim(c.name, v_trim), ''), nullif(btrim(c.email, v_trim), ''), nullif(btrim(c.phone, v_trim), ''), 'Unknown relationship'),
            c.name, c.email, c.phone, c.created_at
        from client_sample c
        where v_private and c.workspace_id = v_workspace_id and c.archived_at is null
          and not exists (select 1 from canonical r where r.client_id = c.id and r.workspace_id = v_workspace_id)
          and (strpos(lower(c.id::text collate pg_catalog."und-x-icu"), v_query) > 0 or
            strpos(lower(array_to_string(array_remove(array[
                coalesce(nullif(btrim(c.name, v_trim), ''), nullif(btrim(c.email, v_trim), ''), nullif(btrim(c.phone, v_trim), ''), 'Unknown relationship'),
                c.email, c.phone, c.name, 'Legacy onboarding'], ''), ' ') collate pg_catalog."und-x-icu"), v_query) > 0)
    )
    select (
        select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) from (
            select id, primary_person_name, business_name, primary_email, primary_phone from permitted
            order by updated_at desc, id limit 8
        ) x
    ), case when v_private then
        coalesce((select jsonb_object_agg(c.id::text, c.id) from client_sample c), '{}'::jsonb)
        || coalesce((select jsonb_object_agg(r.client_id::text, r.id) from canonical r where r.client_id is not null), '{}'::jsonb)
       else '{}'::jsonb end
    into v_rows, v_client_relationships;
    v_result := v_result || jsonb_build_object('relationships', v_rows);

    with matching as materialized (
        select i.id, i.title, i.description, i.kind, i.visibility, i.area
        from (
            (select i.id, i.workspace_id, i.title, i.description, i.lifecycle_phase, i.kind, i.visibility, i.area
             from public.work_items i where i.workspace_id = v_workspace_id and i.visibility = 'workspace'
             limit 80)
            union all
            (select i.id, i.workspace_id, i.title, i.description, i.lifecycle_phase, i.kind, i.visibility, i.area
             from public.work_items i where v_private and i.workspace_id = v_workspace_id and i.visibility = 'admins_only' limit 80)
        ) i
        where i.workspace_id = v_workspace_id
          and (i.visibility = 'workspace' or (v_private and i.visibility = 'admins_only'))
          and (v_private or i.area <> 'admin')
          and strpos(lower(array_to_string(array_remove(array[i.id::text, i.title, i.description, i.lifecycle_phase], ''), ' ') collate pg_catalog."und-x-icu"), v_query) > 0
    )
    select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) into v_rows from (
        select m.id, m.title, m.description, m.kind, m.visibility from matching m
        where v_private or public.workspace_user_can_access_work_item(v_workspace_id, m.id, p_user_id)
        order by case m.visibility when 'workspace' then 0 else 1 end, m.id limit 6
    ) x;
    v_result := v_result || jsonb_build_object('work_items', v_rows);

    with matching as materialized (
        select c.id, c.client_id, c.external_address, c.provider
        from (select c.id, c.workspace_id, c.client_id, c.external_address, c.provider, c.is_active
            from public.client_communication_channels c where c.workspace_id = v_workspace_id limit 60) c
        where c.workspace_id = v_workspace_id and c.is_active
          and strpos(lower(array_to_string(array_remove(array[c.external_address, c.provider], ''), ' ') collate pg_catalog."und-x-icu"), v_query) > 0
    )
    select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) into v_rows from (
        select r.id relationship_id, c.external_address, c.provider
        from matching c
        cross join lateral (
            select r.id from public.relationships r
            where r.client_id = c.client_id and r.workspace_id = v_workspace_id limit 1
        ) r
        where public.client_conversation_can_access(v_workspace_id, r.id, p_user_id)
        order by c.id limit 4
    ) x;
    v_result := v_result || jsonb_build_object('channels', v_rows);

    -- These categories inherit the existing owner/admin-only panel boundary.
    -- Staff execution never scans their tables or revision definitions.
    if v_private then
        select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) into v_rows from (
            select o.id, o.objective, o.objective_type, o.description, o.status, o.period_end
            from (select o.id, o.workspace_id, o.objective, o.objective_type, o.description, o.status, o.period_end from public.workspace_okrs o where o.workspace_id = v_workspace_id limit 60) o
            where o.workspace_id = v_workspace_id
              and strpos(lower(array_to_string(array_remove(array[o.id::text, o.objective, o.objective_type, o.description, o.status], ''), ' ') collate pg_catalog."und-x-icu"), v_query) > 0
            order by o.id limit 6
        ) x;
        v_result := v_result || jsonb_build_object('okrs', v_rows);

        select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) into v_rows from (
            select k.id, k.name, k.description from (select k.id, k.workspace_id, k.name, k.description, k.unit, k.comparator from public.workspace_okr_key_results k where k.workspace_id = v_workspace_id limit 100) k
            where k.workspace_id = v_workspace_id
              and strpos(lower(array_to_string(array_remove(array[k.id::text, k.name, k.description, k.unit, k.comparator], ''), ' ') collate pg_catalog."und-x-icu"), v_query) > 0
            order by k.id limit 6
        ) x;
        v_result := v_result || jsonb_build_object('key_results', v_rows);

        select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) into v_rows from (
            select a.id, a.summary, a.category, a.level from (select a.id, a.workspace_id, a.summary, a.category, a.level, a.event_key, a.entity_type, a.entity_id, a.occurred_at from public.workspace_admin_activity a where a.workspace_id = v_workspace_id order by a.occurred_at desc limit 100) a
            where a.workspace_id = v_workspace_id
              and strpos(lower(array_to_string(array_remove(array[a.id::text, a.category, a.level, a.event_key, a.summary, a.entity_type, a.entity_id], ''), ' ') collate pg_catalog."und-x-icu"), v_query) > 0
            order by a.occurred_at desc, a.id limit 6
        ) x;
        v_result := v_result || jsonb_build_object('admin_activity', v_rows);

        with latest as materialized (
            select distinct on (r.module_id) r.module_id, r.definition, r.status
            from (select r.id, r.workspace_id, r.module_id, r.definition, r.status, r.updated_at from public.onboarding_module_revisions r where r.workspace_id = v_workspace_id order by r.updated_at desc limit 200) r
            where r.workspace_id = v_workspace_id
            order by r.module_id, r.updated_at desc, r.id
        )
        select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) into v_rows from (
            select m.id, d.name, d.description, coalesce(r.status, m.status) status
            from (select m.id, m.workspace_id, m.internal_code, m.status from public.onboarding_modules m where m.workspace_id = v_workspace_id limit 100) m
            left join latest r on r.module_id = m.id
            cross join lateral (
                select case when jsonb_typeof(r.definition -> 'name') = 'string' then r.definition ->> 'name' else m.internal_code end name,
                    case when jsonb_typeof(r.definition -> 'description') = 'string' then r.definition ->> 'description' else 'Reusable onboarding module' end description
            ) d
            where m.workspace_id = v_workspace_id
              and strpos(lower(array_to_string(array_remove(array[m.id::text, m.internal_code, d.name, d.description], ''), ' ') collate pg_catalog."und-x-icu"), v_query) > 0
            order by m.id limit 6
        ) x;
        v_result := v_result || jsonb_build_object('modules', v_rows);

        with latest as materialized (
            select distinct on (r.service_id) r.service_id, r.name, r.description
            from (select r.id, r.workspace_id, r.service_id, r.name, r.description, r.published_at from public.onboarding_service_revisions r where r.workspace_id = v_workspace_id order by r.published_at desc limit 200) r
            where r.workspace_id = v_workspace_id
            order by r.service_id, r.published_at desc, r.id
        )
        select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) into v_rows from (
            select s.id, coalesce(r.name, s.internal_code) name, r.description, s.state
            from (select s.id, s.workspace_id, s.internal_code, s.state from public.onboarding_services s where s.workspace_id = v_workspace_id limit 100) s
            left join latest r on r.service_id = s.id
            where s.workspace_id = v_workspace_id
              and strpos(lower(array_to_string(array_remove(array[s.id::text, s.internal_code, coalesce(r.name, s.internal_code), r.description], ''), ' ') collate pg_catalog."und-x-icu"), v_query) > 0
            order by s.id limit 6
        ) x;
        v_result := v_result || jsonb_build_object('services', v_rows);

        -- Use the same bounded canonical/fallback map for clients and activity,
        -- independently of which relationships matched this query. No later
        -- point lookup may silently substitute a record outside that window.
        select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) into v_rows from (
            select c.id, c.name, c.email, c.phone, (v_client_relationships ->> c.id::text)::uuid relationship_id
            from (select c.id, c.workspace_id, c.name, c.email, c.phone, c.archived_at, c.created_at
                from public.clients c where c.workspace_id = v_workspace_id and c.archived_at is null
                order by c.created_at desc, c.id limit 80) c
            where c.workspace_id = v_workspace_id and c.archived_at is null
              and v_client_relationships ? c.id::text
              and strpos(lower(array_to_string(array_remove(array[c.id::text, c.name, c.email, c.phone], ''), ' ') collate pg_catalog."und-x-icu"), v_query) > 0
            order by c.created_at desc, c.id limit 6
        ) x;
        v_result := v_result || jsonb_build_object('clients', v_rows);

        select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) into v_rows from (
            select a.id, a.title from (select a.id, a.workspace_id, a.title, a.description, a.asset_kind, a.source_kind, a.created_at from public.assets a where a.workspace_id = v_workspace_id order by a.created_at desc limit 80) a
            where a.workspace_id = v_workspace_id
              and strpos(lower(array_to_string(array_remove(array[a.id::text, a.asset_kind, a.source_kind, a.title, a.description], ''), ' ') collate pg_catalog."und-x-icu"), v_query) > 0
            order by a.created_at desc, a.id limit 6
        ) x;
        v_result := v_result || jsonb_build_object('assets', v_rows);

        select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) into v_rows from (
            select n.id, n.name, n.description from (select n.id, n.workspace_id, n.name, n.description, n.updated_at from public.notes n where n.workspace_id = v_workspace_id order by n.updated_at desc limit 80) n
            where n.workspace_id = v_workspace_id
              and strpos(lower(array_to_string(array_remove(array[n.id::text, n.name, n.description], ''), ' ') collate pg_catalog."und-x-icu"), v_query) > 0
            order by n.updated_at desc, n.id limit 6
        ) x;
        v_result := v_result || jsonb_build_object('notes', v_rows);

        select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) into v_rows from (
            select a.id, (v_client_relationships ->> a.client_id::text)::uuid relationship_id, a.activity_text, a.activity_type
            from (select a.id, a.workspace_id, a.client_id, a.activity_text, a.activity_type, a.created_at from public.client_activity a where a.workspace_id = v_workspace_id order by a.created_at desc limit 60) a
            where a.workspace_id = v_workspace_id and v_client_relationships ? a.client_id::text
              and strpos(lower(array_to_string(array_remove(array[a.id::text, a.client_id::text, a.activity_text, a.activity_type], ''), ' ') collate pg_catalog."und-x-icu"), v_query) > 0
            order by a.created_at desc, a.id limit 4
        ) x;
        v_result := v_result || jsonb_build_object('activities', v_rows);
    end if;

    return v_result;
end;
$function$;

revoke all on function public.search_workspace_records(text, uuid, text) from public, anon, authenticated;
grant execute on function public.search_workspace_records(text, uuid, text) to service_role;
comment on function public.search_workspace_records(text, uuid, text) is
'Current membership, existing record policies and readable-field-only search. Server verifies AAL2; no message/history writes. Existing source windows remain; final result limits follow matching and authorization.';

commit;
