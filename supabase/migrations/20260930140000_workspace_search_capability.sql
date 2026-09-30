-- One current-membership read for search. The HTTP owner verifies AAL2 first;
-- only the server role may supply the already verified actor. No stored rows,
-- existing access policies, message reads or alert owners are changed.
-- The 1000-row relationship/client windows preserve the deployed PostgREST
-- max_rows confirmed for this release. Verify that prerequisite in other targets.
-- Existing discovery windows remain. Strong identities gain bounded related
-- destinations with independent access checks; all-record scans are not used.
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

create or replace function public.search_workspace_records(p_workspace_slug text, p_user_id uuid, p_query text)
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
    v_id_query boolean := v_query ~ '^[0-9a-f-]+$';
    v_result jsonb;
    v_rows jsonb;
    v_related_ids uuid[] := '{}'::uuid[];

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
        'schema_version',2,'related','[]'::jsonb,'workspace', jsonb_build_object('id', v_workspace_id, 'name', v_workspace_name, 'slug', v_workspace_slug),
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
        select r.id,r.workspace_id,r.client_id,r.primary_person_name,r.primary_email,r.primary_phone,r.business_name,r.website_url,r.industry_value,r.location_value,r.source_label,r.primary_contact_role,r.notes_summary,r.status,r.updated_at
        from public.relationships r where r.workspace_id=v_workspace_id order by r.updated_at desc limit 1000
    ), matching as materialized (
        select r.id,r.client_id,r.primary_person_name,r.business_name,r.primary_email,r.primary_phone,r.status,r.updated_at,r.notes_summary
        from canonical r
        where (v_id_query and strpos(r.id::text,v_query)>0) or
            strpos(lower(array_to_string(array_remove(array[r.primary_person_name,r.primary_email,r.primary_phone,r.business_name,r.website_url,r.industry_value,r.location_value,r.source_label,r.primary_contact_role,r.notes_summary],''),' ') collate pg_catalog."und-x-icu"),v_query)>0
    ), alias_candidates as materialized (
        select c.* from (select c.id,c.workspace_id,c.name,c.email,c.phone,c.created_at from public.clients c
            where v_private and c.workspace_id=v_workspace_id and c.archived_at is null order by c.created_at desc,c.id limit 1000) c
        where not exists(select 1 from matching m where m.client_id=c.id)
    ), alias_matching as materialized (
        select c.* from alias_candidates c where ((v_id_query and strpos(c.id::text,v_query)>0) or
            strpos(lower(array_to_string(array_remove(array[coalesce(nullif(btrim(c.name,v_trim),''),nullif(btrim(c.email,v_trim),''),nullif(btrim(c.phone,v_trim),''),'Unknown relationship'),c.email,c.phone,c.name,'Legacy onboarding'],''),' ') collate pg_catalog."und-x-icu"),v_query)>0)
    ), permitted as materialized (
        select m.id,m.primary_person_name,m.business_name,m.primary_email,m.primary_phone,m.status,m.updated_at,m.notes_summary,false is_alias from matching m
        where v_private or public.workspace_user_can_access_relationship(v_workspace_id,m.id,p_user_id)
        union all
        select coalesce(r.id,c.id),
            case when r.id is not null then r.primary_person_name else coalesce(nullif(btrim(c.name,v_trim),''),nullif(btrim(c.email,v_trim),''),nullif(btrim(c.phone,v_trim),''),'Unknown relationship') end,
            case when r.id is not null then r.business_name else c.name end,
            case when r.id is not null then r.primary_email else c.email end,
            case when r.id is not null then r.primary_phone else c.phone end,
            coalesce(r.status,'active'),coalesce(r.updated_at,c.created_at),r.notes_summary,r.id is not null
        from alias_matching c
        left join public.relationships r on r.workspace_id=v_workspace_id and r.client_id=c.id
    ), normalized as materialized (
        select p.*,
            lower(coalesce(p.primary_person_name,'') collate pg_catalog."und-x-icu") name_value,
            lower(coalesce(p.business_name,'') collate pg_catalog."und-x-icu") business_value,
            lower(coalesce(p.primary_email,'') collate pg_catalog."und-x-icu") email_value,
            lower(coalesce(p.primary_phone,'') collate pg_catalog."und-x-icu") phone_value
        from permitted p
    ), ranked as (
        select n.*,case when is_alias then 5 when id::text=v_query then 0
            when v_query in(name_value,business_value,email_value) then 1
            when starts_with(name_value,v_query) or starts_with(business_value,v_query) or starts_with(email_value,v_query) or starts_with(phone_value,v_query) then 2
            when strpos(name_value,v_query)>0 or strpos(business_value,v_query)>0 or strpos(email_value,v_query)>0 or strpos(phone_value,v_query)>0 then 3 else 5 end match_rank
        from normalized n
    ), deduplicated as (
        select distinct on(id) * from ranked order by id,match_rank
    ), winners as materialized (
        select * from deduplicated order by (status='archived'),match_rank,updated_at desc,id limit 8
    )
    select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) into v_rows from (
        select id,primary_person_name,business_name,primary_email,primary_phone,status,match_rank,
            case when is_alias then 'details' when id::text=v_query then 'id'
                when name_value=v_query then 'name' when business_value=v_query then 'business' when email_value=v_query then 'email'
                when starts_with(name_value,v_query) then 'name' when starts_with(business_value,v_query) then 'business'
                when starts_with(email_value,v_query) then 'email' when starts_with(phone_value,v_query) then 'phone'
                when strpos(name_value,v_query)>0 then 'name' when strpos(business_value,v_query)>0 then 'business'
                when strpos(email_value,v_query)>0 then 'email' when strpos(phone_value,v_query)>0 then 'phone'
                when strpos(lower(coalesce(notes_summary,'') collate pg_catalog."und-x-icu"),v_query)>0 then 'notes' else 'details' end match_field
        from winners order by (status='archived'),match_rank,updated_at desc,id
    ) x;
    v_result := v_result || jsonb_build_object('relationships', v_rows);

    -- Broad/ambiguous terms stay focused on direct matches. Expand only the best
    -- identity tier when it has at most two readable active canonical records.
    if length(v_query) >= 3 and jsonb_array_length(v_rows) > 0 then
        with candidates as (
            select (x->>'id')::uuid id, (x->>'match_rank')::integer rank
            from jsonb_array_elements(v_rows) x
            where x->>'status' <> 'archived' and (x->>'match_rank')::integer <= 3
              and exists (select 1 from public.relationships r
                  where r.workspace_id = v_workspace_id and r.id = (x->>'id')::uuid)
        ), best as (select * from candidates where rank = (select min(rank) from candidates))
        select case when count(*) <= 2 then coalesce(array_agg(id order by id), '{}'::uuid[]) else '{}'::uuid[] end
        into v_related_ids from best;
    end if;


    with matching as materialized (
        select i.id, i.title, i.description, i.kind, i.visibility, i.area, i.archived
        from (
            (select i.id, i.workspace_id, i.title, i.description, i.lifecycle_phase, i.kind, i.visibility, i.area, (i.metadata->>'archived_at' is not null) as archived
             from public.work_items i where i.workspace_id = v_workspace_id and i.visibility = 'workspace'
             limit 80)
            union all
            (select i.id, i.workspace_id, i.title, i.description, i.lifecycle_phase, i.kind, i.visibility, i.area, (i.metadata->>'archived_at' is not null) as archived
             from public.work_items i where v_private and i.workspace_id = v_workspace_id and i.visibility = 'admins_only' limit 80)
        ) i
        where i.workspace_id = v_workspace_id
          and (i.visibility = 'workspace' or (v_private and i.visibility = 'admins_only'))
          and (v_private or i.area <> 'admin')
          and strpos(lower(array_to_string(array_remove(array[i.id::text, i.title, i.description, i.lifecycle_phase], ''), ' ') collate pg_catalog."und-x-icu"), v_query) > 0
    )
    select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) into v_rows from (
        select m.id, m.title, m.description, m.kind, m.visibility, m.archived from matching m
        where v_private or public.workspace_user_can_access_work_item(v_workspace_id, m.id, p_user_id)
        order by m.archived, case m.visibility when 'workspace' then 0 else 1 end, m.id limit 6
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

        select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) into v_rows from (
            select m.id,d.name,d.description,case when m.status = 'archived' then 'archived' else coalesce(r.status,m.status) end status
            from (select m.id,m.workspace_id,m.internal_code,m.status from public.onboarding_modules m where m.workspace_id=v_workspace_id limit 100) m
            left join lateral (select r.definition,r.status from public.onboarding_module_revisions r
                where r.workspace_id=v_workspace_id and r.module_id=m.id order by r.updated_at desc,r.id limit 1) r on true
            cross join lateral (select case when jsonb_typeof(r.definition->'name')='string' then r.definition->>'name' else m.internal_code end name,
                case when jsonb_typeof(r.definition->'description')='string' then r.definition->>'description' else 'Reusable onboarding module' end description) d
            where strpos(lower(array_to_string(array_remove(array[m.id::text,m.internal_code,d.name,d.description],''),' ') collate pg_catalog."und-x-icu"),v_query)>0
            order by (m.status = 'archived' or coalesce(r.status, m.status) = 'archived'), m.id limit 6
        ) x;
        v_result := v_result || jsonb_build_object('modules', v_rows);

        select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) into v_rows from (
            select s.id,coalesce(r.name,s.internal_code) name,r.description,s.state
            from (select s.id,s.workspace_id,s.internal_code,s.state from public.onboarding_services s where s.workspace_id=v_workspace_id limit 100) s
            left join lateral (select r.name,r.description from public.onboarding_service_revisions r
                where r.workspace_id=v_workspace_id and r.service_id=s.id order by r.published_at desc,r.id limit 1) r on true
            where strpos(lower(array_to_string(array_remove(array[s.id::text,s.internal_code,coalesce(r.name,s.internal_code),r.description],''),' ') collate pg_catalog."und-x-icu"),v_query)>0
            order by (s.state = 'archived'), s.id limit 6
        ) x;
        v_result := v_result || jsonb_build_object('services', v_rows);



        select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) into v_rows from (
            select a.id, a.title, a.archived from (select a.id, a.workspace_id, a.title, a.description, a.asset_kind, a.source_kind, a.created_at, (a.metadata->>'archived_at' is not null) as archived from public.assets a where a.workspace_id = v_workspace_id order by a.created_at desc limit 80) a
            where a.workspace_id = v_workspace_id
              and strpos(lower(array_to_string(array_remove(array[a.id::text, a.asset_kind, a.source_kind, a.title, a.description], ''), ' ') collate pg_catalog."und-x-icu"), v_query) > 0
            order by a.archived, a.created_at desc, a.id limit 6
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
            select a.id,coalesce(r.id,c.id) relationship_id,a.activity_text,a.activity_type
            from (select a.id,a.workspace_id,a.client_id,a.activity_text,a.activity_type,a.created_at
                from public.client_activity a where a.workspace_id=v_workspace_id order by a.created_at desc limit 60) a
            join public.clients c on c.id=a.client_id and c.workspace_id=v_workspace_id
            left join public.relationships r on r.client_id=c.id and r.workspace_id=v_workspace_id
            where (r.id is not null or c.archived_at is null)
              and strpos(lower(array_to_string(array_remove(array[a.id::text,a.client_id::text,a.activity_text,a.activity_type],''),' ') collate pg_catalog."und-x-icu"),v_query)>0
            order by a.created_at desc,a.id limit 4
        ) x;
        v_result := v_result || jsonb_build_object('activities', v_rows);
    end if;

    if cardinality(v_related_ids) > 0 then
        with seeds as materialized (
            select r.id, seed.ordinality as seed_order,
                r.primary_person_name as relationship_name
            from unnest(v_related_ids) with ordinality as seed(id, ordinality)
            join public.relationships r on r.workspace_id = v_workspace_id and r.id = seed.id
            where r.status <> 'archived'
            order by seed.ordinality
            limit 2
        ), related as (
            select r.seed_order, 0 as destination_order, 0::bigint as item_order,
                'onboarding'::text as kind, r.id, r.id as relationship_id,
                r.relationship_name, 'Onboarding'::text as title,
                sessions.status, sessions.session_id, null::text as due_date, null::text as visibility
            from (select * from seeds where (v_private or 'onboarding.manage' = any(v_capabilities))) r
            cross join lateral (
                -- Suggestions inspect one shared recent window before status or
                -- permission checks. The full destination keeps older history.
                -- Equal-created-at source ties follow the existing index order.
                with recent as materialized (
                    select s.id, s.workspace_id, s.status, s.archived_at, s.created_at
                    from public.relationship_onboarding_sessions s
                    where s.workspace_id = v_workspace_id and s.relationship_id = r.id
                    order by s.created_at desc
                    limit 20
                ), ordered as materialized (
                    select * from recent where archived_at is null and status in ('active','completed')
                    order by created_at desc,id desc
                ), active as materialized (
                    select s.id, s.status, s.created_at
                    from ordered s
                    where s.status = 'active' and s.archived_at is null
                      and (public.workspace_user_can_access_full_onboarding_session(v_workspace_id, s.id, p_user_id)
                        or exists (
                            select 1 from public.relationship_onboarding_session_modules m
                            where m.workspace_id = s.workspace_id and m.session_id = s.id
                              and public.workspace_user_can_access_session_module(v_workspace_id, m.id, p_user_id)
                        ))
                    order by s.created_at desc, s.id desc
                    limit 2
                ), completed as materialized (
                    select s.id, s.status, s.created_at
                    from ordered s
                    where not exists (select 1 from active)
                      and s.status = 'completed' and s.archived_at is null
                      and (public.workspace_user_can_access_full_onboarding_session(v_workspace_id, s.id, p_user_id)
                        or exists (
                            select 1 from public.relationship_onboarding_session_modules m
                            where m.workspace_id = s.workspace_id and m.session_id = s.id
                              and public.workspace_user_can_access_session_module(v_workspace_id, m.id, p_user_id)
                        ))
                    order by s.created_at desc, s.id desc
                    limit 2
                ), permitted as (select * from active union all select * from completed)
                select min(p.status) as status,
                    case when count(*) = 1 then min(p.id::text)::uuid else null::uuid end as session_id
                from permitted p
                having count(*) > 0
            ) sessions

            union all
            select r.seed_order, 1, 0::bigint,
                'client_chat', r.id, r.id, r.relationship_name, 'Client chat',
                null::text, null::uuid, null::text, null::text
            from seeds r
            where (v_private or 'communications.manage' = any(v_capabilities))
              and public.client_conversation_can_access(v_workspace_id, r.id, p_user_id)

            union all
            select r.seed_order, 2, 0::bigint,
                'team_chat', c.id, r.id,
                r.relationship_name,
                t.name, null::text, null::uuid, null::text, null::text
            from seeds r
            join public.workspace_teams t on t.workspace_id = v_workspace_id and t.relationship_id = r.id
                and t.kind = 'relationship' and t.archived_at is null
            join public.workspace_native_conversations c on c.workspace_id = t.workspace_id and c.team_id = t.id
                and c.kind = 'team' and c.archived_at is null
            where (v_private or 'communications.manage' = any(v_capabilities))
              and public.native_conversation_can_read(c.id, p_user_id)

            union all
            select r.seed_order, 3, i.item_order,
                'work_item', i.id, r.id, r.relationship_name, i.title,
                i.status, null::uuid, i.due_date::text, i.visibility
            from (select * from seeds where (v_private or 'fulfilment.manage' = any(v_capabilities) or 'onboarding.manage' = any(v_capabilities))) r
            cross join lateral (
                with recent as materialized (
                    select l.workspace_id,l.work_item_id from public.work_item_relationships l
                    where l.workspace_id=v_workspace_id and l.relationship_id=r.id
                    order by l.created_at desc limit 80
                ), useful as materialized (
                    select i.id,i.title,i.status,i.due_date,i.due_time,i.visibility,i.planned_start_date,i.created_at,
                        case when i.status='doing' then 0 else 1 end status_order,
                        case when ((i.due_date+coalesce(i.due_time,time '23:59:59')) at time zone 'UTC')<now() then 0 else 1 end overdue_order,
                        row_number() over(order by
                            case when i.status='doing' then 0 else 1 end,
                            case when ((i.due_date+coalesce(i.due_time,time '23:59:59')) at time zone 'UTC')<now() then 0 else 1 end,
                            i.due_date asc nulls last,i.due_time asc nulls last,i.planned_start_date asc nulls last,i.created_at,i.id) item_order
                    from recent l join public.work_items i on i.workspace_id=l.workspace_id and i.id=l.work_item_id
                    where public.queue_work_open(i)
                      and (i.visibility='workspace' or (v_private and i.visibility='admins_only'))
                      and (v_private or i.area<>'admin')
                    order by status_order,overdue_order,i.due_date asc nulls last,i.due_time asc nulls last,i.planned_start_date asc nulls last,i.created_at,i.id
                )
                select i.id,i.title,i.status,i.due_date,i.visibility,i.item_order
                from useful i
                where v_private or public.workspace_user_can_access_work_item(v_workspace_id,i.id,p_user_id)
                order by i.status_order,i.overdue_order,i.due_date asc nulls last,i.due_time asc nulls last,i.planned_start_date asc nulls last,i.created_at,i.id
                limit 2
            ) i
        ), deduplicated as (
            -- A work item linked to both seeds has one destination; first seed wins.
            select distinct on (kind, id) * from related
            order by kind, id, seed_order, destination_order, item_order
        ), bounded as (
            select * from deduplicated order by seed_order, destination_order, item_order, id limit 10
        )
        select v_result || jsonb_build_object('related', coalesce(jsonb_agg(
            jsonb_build_object(
                'kind', kind, 'id', id, 'relationship_id', relationship_id,
                'relationship_name', relationship_name, 'title', title, 'status', status,
                'session_id', session_id, 'due_date', due_date, 'visibility', visibility
            ) order by seed_order, destination_order, item_order, id
        ), '[]'::jsonb))
        into v_result
        from bounded;
    end if;

    return v_result;
end;
$function$;

revoke all on function public.search_workspace_records(text, uuid, text) from public, anon, authenticated;
grant execute on function public.search_workspace_records(text, uuid, text) to service_role;
comment on function public.search_workspace_records(text, uuid, text) is
'Ranked canonical search and bounded related destinations under current record/session/chat policies. Server verifies AAL2. No message/history writes; source discovery windows remain explicit.';

commit;
