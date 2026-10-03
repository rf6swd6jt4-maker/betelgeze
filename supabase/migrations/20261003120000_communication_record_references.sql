-- On-demand internal chat reference discovery and viewer-bound resolution.
-- Additive indexes/RPC only: no message, read cursor, alert or record is rewritten.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $preflight$
begin
    if lower('İ' collate pg_catalog."und-x-icu") <> U&'i\0307'
       or lower('ΟΔΟΣ' collate pg_catalog."und-x-icu") <> 'οδος' then
        raise exception 'References require Unicode full lowercase support';
    end if;
    if to_regprocedure('public.native_conversation_can_read(uuid,uuid)') is null
       or to_regprocedure('public.workspace_user_can_access_work_item(uuid,uuid,uuid)') is null
       or to_regprocedure('public.workspace_user_can_access_asset(uuid,uuid,uuid)') is null
       or to_regprocedure('public.workspace_user_can_access_relationship(uuid,uuid,uuid)') is null then
        raise exception 'Canonical reference authorization is required';
    end if;
end $preflight$;

-- C-ordered normalized prefix ranges use these B-trees directly. No substring
-- scan or GIN posting-list expansion on each keystroke. Only title/name writes
-- maintain new name indexes; unrelated message writes do not touch them.
create index comms_reference_work_name_idx on public.work_items
    (workspace_id, (left(lower(title collate pg_catalog."und-x-icu"),240) collate "C"), id)
    where metadata->>'archived_at' is null;
create index comms_reference_asset_name_idx on public.assets
    (workspace_id, (left(lower(title collate pg_catalog."und-x-icu"),240) collate "C"), id)
    where metadata->>'archived_at' is null;
create index comms_reference_relationship_name_idx on public.relationships
    (workspace_id, (left(lower(primary_person_name collate pg_catalog."und-x-icu"),240) collate "C"), id)
    where status <> 'archived';
create index comms_reference_relationship_business_idx on public.relationships
    (workspace_id, (left(lower(business_name collate pg_catalog."und-x-icu"),240) collate "C"), id)
    where status <> 'archived';
create index comms_reference_relationship_recent_idx on public.relationships
    (workspace_id, updated_at desc, id) where status <> 'archived';

-- PostgREST >=12.2 hoists statement_timeout before the RPC statement. Verify
-- db-hoisted-tx-settings includes it on the target (the platform default).
create function public.read_communication_references(
    p_workspace_slug text, p_user_id uuid, p_conversation_id uuid,
    p_query text default null, p_references jsonb default null
) returns jsonb
language plpgsql stable security definer set search_path = '' set plan_cache_mode = 'force_custom_plan' set statement_timeout = '3s'
as $function$
declare
    v_workspace_id uuid;
    v_role text;
    v_relationship_id uuid;
    v_relationship_route text := 'work';
    v_query text := lower(btrim(coalesce(p_query, '')) collate pg_catalog."und-x-icu");
    v_upper text;
    v_candidates jsonb := '[]'::jsonb;
    v_results jsonb;
    v_limit integer := 4;
begin
    -- Only the trusted HTTP owner supplies an actor, after fresh AAL2 auth.
    -- The explicit role condition also fails closed if grants ever drift.
    if auth.role() is distinct from 'service_role' then return null; end if;
    select w.id, case m.role when 'member' then 'staff' else m.role end, t.relationship_id
      into v_workspace_id, v_role, v_relationship_id
    from public.workspaces w
    join public.workspace_memberships m on m.workspace_id=w.id and m.user_id=p_user_id
    join public.workspace_native_conversations c on c.workspace_id=w.id and c.id=p_conversation_id
    left join public.workspace_teams t on t.workspace_id=w.id and t.id=c.team_id
    where w.slug=p_workspace_slug and w.status='active'
      and m.role in ('owner','admin','staff','member') and c.kind in ('team','direct')
      and public.native_conversation_can_read(c.id,p_user_id);
    if v_workspace_id is null then return null; end if;

    if v_role in ('owner','admin') or exists (
        select 1 from public.workspace_operational_roles o where o.workspace_id=v_workspace_id
          and o.user_id=p_user_id and (o.can_sell or o.can_manage)
    ) then v_relationship_route := 'relationships';
    elsif exists (
        select 1 from public.workspace_member_service_access a
        join public.workspace_service_capabilities c on c.workspace_id=a.workspace_id and c.service_id=a.service_id
        where a.workspace_id=v_workspace_id and a.user_id=p_user_id and c.capability='onboarding.manage'
    ) then v_relationship_route := 'onboarding'; end if;

    if p_references is not null then
        if p_query is not null or jsonb_typeof(p_references) <> 'array'
           or jsonb_array_length(p_references) > 40 then
            raise exception 'Invalid reference batch' using errcode='22023';
        end if;
        if exists (select 1 from jsonb_array_elements(p_references) r
                   where jsonb_typeof(r) <> 'object' or coalesce(r->>'type','') not in ('work_item','asset','relationship')
                     or coalesce(r->>'id','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$') then
            raise exception 'Invalid reference identity' using errcode='22023';
        end if;
        v_candidates := p_references;
        v_limit := 40;
    elsif length(v_query) > 100 then
        raise exception 'Reference query is too long' using errcode='22023';
    elsif v_query ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
        select jsonb_agg(jsonb_build_object('type',k,'id',v_query)) into v_candidates
        from unnest(array['work_item','asset','relationship']) k;
    elsif v_query = '' then
        -- Fixed, indexed source windows; authorization happens before output.
        with candidates as materialized (
            (select 'work_item'::text type, i.id from public.work_items i
             where i.workspace_id=v_workspace_id and i.visibility='workspace' and i.metadata->>'archived_at' is null
             order by i.updated_at desc limit 12)
            union all
            (select 'asset', a.id from public.assets a
             where a.workspace_id=v_workspace_id and a.metadata->>'archived_at' is null
             order by a.updated_at desc, a.id desc limit 12)
            union all
            (select 'relationship', r.id from public.relationships r
             where r.workspace_id=v_workspace_id and r.status<>'archived'
             order by r.updated_at desc, r.id limit 12)
            union all
            select 'relationship',v_relationship_id where v_relationship_id is not null
        ) select coalesce(jsonb_agg(to_jsonb(candidates)), '[]'::jsonb) into v_candidates from candidates;
    else
        -- Lexicographic successor: supports all Unicode scalar values without
        -- a wildcard interpretation, broad scan, or arbitrary Unicode sentinel.
        v_upper := v_query;
        while length(v_upper)>0 and ascii(right(v_upper,1))=1114111 loop
            v_upper := left(v_upper,length(v_upper)-1);
        end loop;
        if length(v_upper)>0 then
            v_upper := left(v_upper,length(v_upper)-1)||chr(case when ascii(right(v_upper,1))=55295 then 57344 else ascii(right(v_upper,1))+1 end);
        else v_upper := null; end if;
        with candidates as materialized (
            (select 'work_item'::text type, i.id from public.work_items i
             where i.workspace_id=v_workspace_id and i.metadata->>'archived_at' is null
               and left(lower(i.title collate pg_catalog."und-x-icu"),240) collate "C" >= v_query collate "C"
               and (v_upper is null or left(lower(i.title collate pg_catalog."und-x-icu"),240) collate "C" < v_upper collate "C")
             order by left(lower(i.title collate pg_catalog."und-x-icu"),240) collate "C", i.id limit 24)
            union all
            (select 'asset', a.id from public.assets a
             where a.workspace_id=v_workspace_id and a.metadata->>'archived_at' is null
               and left(lower(a.title collate pg_catalog."und-x-icu"),240) collate "C" >= v_query collate "C"
               and (v_upper is null or left(lower(a.title collate pg_catalog."und-x-icu"),240) collate "C" < v_upper collate "C")
             order by left(lower(a.title collate pg_catalog."und-x-icu"),240) collate "C", a.id limit 24)
            union all
            (select 'relationship', r.id from public.relationships r
             where r.workspace_id=v_workspace_id and r.status<>'archived'
               and left(lower(r.primary_person_name collate pg_catalog."und-x-icu"),240) collate "C" >= v_query collate "C"
               and (v_upper is null or left(lower(r.primary_person_name collate pg_catalog."und-x-icu"),240) collate "C" < v_upper collate "C")
             order by left(lower(r.primary_person_name collate pg_catalog."und-x-icu"),240) collate "C", r.id limit 24)
            union all
            (select 'relationship', r.id from public.relationships r
             where r.workspace_id=v_workspace_id and r.status<>'archived'
               and left(lower(r.business_name collate pg_catalog."und-x-icu"),240) collate "C" >= v_query collate "C"
               and (v_upper is null or left(lower(r.business_name collate pg_catalog."und-x-icu"),240) collate "C" < v_upper collate "C")
             order by left(lower(r.business_name collate pg_catalog."und-x-icu"),240) collate "C", r.id limit 24)
        ) select coalesce(jsonb_agg(to_jsonb(candidates)), '[]'::jsonb) into v_candidates from candidates;
    end if;

    with candidates as materialized (
        select distinct r.type, r.id from jsonb_to_recordset(v_candidates) as r(type text,id uuid)
    ), permitted as materialized (
        select c.type, i.id, left(i.title,240) label, null::text detail, i.updated_at,
            case when exists(select 1 from public.work_item_relationships l where l.workspace_id=v_workspace_id
                 and l.work_item_id=i.id and l.relationship_id=v_relationship_id) then 1 else 2 end context_rank
        from candidates c join public.work_items i on c.type='work_item' and i.id=c.id and i.workspace_id=v_workspace_id
        where public.workspace_user_can_access_work_item(v_workspace_id,i.id,p_user_id)
        union all
        select c.type,a.id,left(a.title,240),null::text,a.updated_at,
            case when exists(select 1 from public.asset_relationships l where l.workspace_id=v_workspace_id
                 and l.asset_id=a.id and l.relationship_id=v_relationship_id) then 1 else 2 end
        from candidates c join public.assets a on c.type='asset' and a.id=c.id and a.workspace_id=v_workspace_id
        where public.workspace_user_can_access_asset(v_workspace_id,a.id,p_user_id)
        union all
        select c.type,r.id,left(r.primary_person_name,240),left(nullif(r.business_name,''),160),r.updated_at,
            case when r.id=v_relationship_id then 0 else 2 end
        from candidates c join public.relationships r on c.type='relationship' and r.id=c.id and r.workspace_id=v_workspace_id
        where public.workspace_user_can_access_relationship(v_workspace_id,r.id,p_user_id)
    ), winners as (
        select * from permitted order by
            case when id::text=v_query then 0
                 when lower(label collate pg_catalog."und-x-icu")=v_query
                   or (type='relationship' and lower(detail collate pg_catalog."und-x-icu")=v_query) then 1
                 else 2 end,
            context_rank,updated_at desc,type,id limit v_limit
    ) select coalesce(jsonb_agg(jsonb_build_object('type',type,'id',id,'label',label,'detail',detail)), '[]'::jsonb)
      into v_results from winners;
    return jsonb_build_object('scope',jsonb_build_object('userId',p_user_id,'workspaceId',v_workspace_id),
        'relationshipRoute',v_relationship_route,'results',v_results);
end $function$;
revoke all on function public.read_communication_references(text,uuid,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.read_communication_references(text,uuid,uuid,text,jsonb) to service_role;
comment on function public.read_communication_references(text,uuid,uuid,text,jsonb) is
'Internal Team/direct reference suggestions and current-viewer resolution. Server verifies AAL2. Prefix candidates max24 per name index, recent max12 per type, batch max40. Canonical row and conversation access; labels never persisted in messages.';
notify pgrst, 'reload schema';
commit;
