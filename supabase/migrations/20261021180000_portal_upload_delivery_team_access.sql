-- Client portal uploads are shared with the matching current delivery team.
-- One canonical read owner; no records, links, messages, indexes or alerts change.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

do $preflight$
begin
    if not exists (
        select 1 from pg_proc where oid = 'public.workspace_user_can_access_asset(uuid,uuid,uuid)'::regprocedure
          and md5(prosrc) = '70c49c60615c5e7839296a6994f377cd' and prosecdef and provolatile = 's'
    ) then raise exception 'Asset access owner changed; review before installation'; end if;
    if exists (
        select 1 from unnest(array[
            'public.workspace_teams_relationship_unique',
            'public.workspace_team_members_pkey',
            'public.asset_relationships_pkey'
        ]) name left join pg_index i on i.indexrelid = to_regclass(name)
        where i.indexrelid is null or not i.indisvalid or not i.indisready
    ) then
        raise exception 'Indexed delivery team and asset relationship lookups are required';
    end if;
end $preflight$;

create or replace function public.workspace_user_can_access_asset(p_workspace_id uuid,p_asset_id uuid,p_user_id uuid default auth.uid()) returns boolean
-- Every added lookup is by an indexed exact identity. Reuse plans across calls
-- in reference batches instead of repeatedly planning this per-row RLS owner.
language plpgsql stable security definer set search_path=public set plan_cache_mode=force_generic_plan
as $asset_access$
declare
    actor_role text := public.workspace_role_for_user(p_workspace_id,p_user_id);
    asset_metadata jsonb;
    asset_native_kind text;
    asset_source_kind text;
begin
    if actor_role in ('owner','admin') then return true; end if;
    if actor_role is distinct from 'staff' then return false; end if;
    select a.metadata,a.native_kind,a.source_kind into asset_metadata,asset_native_kind,asset_source_kind
    from public.assets a where a.workspace_id=p_workspace_id and a.id=p_asset_id;
    -- Preserve the exclusive selected-service gate before any portal team grant.
    if exists (
        select 1 from public.relationship_onboarding_sessions s
        where s.workspace_id=p_workspace_id and s.id=case when asset_metadata->>'session_id' ~* '^[0-9a-f-]{36}$'
            then (asset_metadata->>'session_id')::uuid end and s.service_scope='selected_services'
    ) then
        return exists (
            select 1 from public.relationship_onboarding_session_steps st where st.workspace_id=p_workspace_id
            and st.id=case when asset_metadata->>'session_step_id' ~* '^[0-9a-f-]{36}$' then (asset_metadata->>'session_step_id')::uuid end
            and st.session_id::text=asset_metadata->>'session_id'
            and public.workspace_user_can_access_session_module(p_workspace_id,st.session_module_id,p_user_id)
        );
    end if;
    if asset_native_kind='client_portal_resource' and asset_source_kind='upload' and asset_metadata->>'source'='client_portal'
       and asset_metadata->>'relationship_id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
        if exists (
            select 1 from public.asset_relationships l
            join public.workspace_teams t on t.workspace_id=l.workspace_id and t.relationship_id=l.relationship_id and t.kind='relationship' and t.archived_at is null
            join public.workspace_team_members m on m.workspace_id=t.workspace_id and m.team_id=t.id and m.user_id=p_user_id
            join public.relationships r on r.workspace_id=l.workspace_id and r.id=l.relationship_id and r.status<>'archived'
            join public.workspaces w on w.id=l.workspace_id and w.status='active'
            where l.workspace_id=p_workspace_id and l.asset_id=p_asset_id and l.relationship_id=(asset_metadata->>'relationship_id')::uuid
        ) then return true; end if;
    end if;
    return exists(select 1 from public.asset_relationships l where l.workspace_id=p_workspace_id and l.asset_id=p_asset_id and public.workspace_user_fully_covers_relationship(p_workspace_id,l.relationship_id,p_user_id))
        or exists(select 1 from public.asset_work_items l where l.workspace_id=p_workspace_id and l.asset_id=p_asset_id and public.workspace_user_can_access_work_item(p_workspace_id,l.work_item_id,p_user_id));
end
$asset_access$;

-- Preserve the existing execution boundary and all table RLS/write policies.
revoke all on function public.workspace_user_can_access_asset(uuid,uuid,uuid) from public, anon;
grant execute on function public.workspace_user_can_access_asset(uuid,uuid,uuid) to authenticated, service_role;
notify pgrst, 'reload schema';
commit;
