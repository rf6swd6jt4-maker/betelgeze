-- Fix for 20261114180000_member_assignment_moves.sql: preview_workspace_member_footprint emptied its temp table with a
-- bare DELETE. API requests run as authenticator, whose sessions preload pg-safeupdate ("DELETE requires a WHERE clause",
-- SQLSTATE 21000, HTTP 400), so every Staff and removal preview failed through the app while working in the SQL editor.
-- Same function and result; the temp table is dropped and recreated instead. Privileges are kept by CREATE OR REPLACE.

create or replace function public.preview_workspace_member_footprint(p_workspace uuid, p_actor uuid, p_target uuid, p_service uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare n integer; items jsonb; groups jsonb; fingerprint text; sellers integer;
begin
    if not exists (select 1 from public.workspace_memberships m join public.workspaces w on w.id = m.workspace_id and w.status = 'active'
                   where m.workspace_id = p_workspace and m.user_id = p_actor and m.role in ('owner', 'admin')) then
        raise exception 'Owner or admin required.';
    end if;
    -- Rebuilt rather than emptied: PostgREST sessions load pg-safeupdate, which refuses DELETE without WHERE.
    drop table if exists member_preview_items;
    create temp table member_preview_items on commit drop as
        select * from public.member_assignment_footprint(p_workspace, p_target, p_service) limit 301;
    select count(*) into n from member_preview_items;
    if n > 300 then raise exception 'This person has more than 300 assignments here. Move them one service at a time.'; end if;

    select coalesce(jsonb_agg(jsonb_build_object(
            'key', f.item_key, 'kind', f.kind, 'relationshipId', f.relationship_id, 'recordId', f.record_id,
            'serviceKey', f.service_key, 'serviceId', f.service_id, 'client', f.client, 'title', f.title, 'fingerprint', f.item_fingerprint,
            'eligibleGroup', case when f.kind = 'client_manager' then 'managers'
                                  when f.kind in ('legacy_service_assignee', 'service_assignee', 'queue_member') then 'service:' || f.service_id
                                  else 'members' end,
            'blockedReason', case when f.imported and f.kind in ('service_assignee', 'queue_member') then 'This imported service must be reviewed before it can move.' end)
            order by f.kind, f.client, f.title, f.item_key), '[]'::jsonb),
           md5(coalesce(string_agg(f.item_key || ':' || f.item_fingerprint, ',' order by f.item_key), ''))
      into items, fingerprint
      from member_preview_items f;

    select jsonb_object_agg(g.key, g.people) into groups from (
        select 'managers' as key, coalesce(jsonb_agg(o.user_id order by o.user_id), '[]'::jsonb) as people
        from public.workspace_operational_roles o join public.workspace_memberships m using (workspace_id, user_id)
        where o.workspace_id = p_workspace and o.can_manage and o.user_id <> p_target
        union all
        select 'members', coalesce(jsonb_agg(m.user_id order by m.user_id), '[]'::jsonb)
        from public.workspace_memberships m where m.workspace_id = p_workspace and m.user_id <> p_target
        union all
        select 'service:' || s.service_id, coalesce(jsonb_agg(e.user_id order by e.user_id) filter (where e.user_id is not null), '[]'::jsonb)
        from (select distinct service_id from member_preview_items where service_id is not null) s
        left join public.workspace_member_service_access e on e.workspace_id = p_workspace and e.service_id = s.service_id and e.user_id <> p_target
             and exists (select 1 from public.workspace_memberships m where m.workspace_id = p_workspace and m.user_id = e.user_id)
        group by s.service_id
    ) g;

    select count(*) into sellers from public.relationships r
    where r.workspace_id = p_workspace and r.seller_user_id = p_target and r.status <> 'archived' and r.lifecycle_phase <> 'completed_lost';

    return jsonb_build_object('targetId', p_target, 'serviceId', p_service,
        'isMember', exists (select 1 from public.workspace_memberships where workspace_id = p_workspace and user_id = p_target),
        'targetRole', (select role from public.workspace_memberships where workspace_id = p_workspace and user_id = p_target),
        'items', items, 'eligibility', coalesce(groups, '{}'::jsonb), 'fingerprint', fingerprint,
        'history', jsonb_build_object('sellerClients', sellers));
end $$;

