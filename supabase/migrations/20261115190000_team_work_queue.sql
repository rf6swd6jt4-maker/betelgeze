-- Team queue for the Today column's Mine / Team switch. Owners and admins only; read-only.
--
-- It does not define ownership or ranking again: for each other member it calls the existing
-- read_personal_work_queue(..., 'ready') and keeps that person's first 4 items and ready count, so Team always shows
-- exactly what each person's own queue shows, in the same order. Bounded to 25 members and 4 items each (100 rows).
-- Cost is one personal queue read per other member; it runs only when someone chooses Team, never at shell start.
-- Descriptions and instructions are left out. No write, no message, read-cursor or alert path is touched.

create function public.read_team_work_queue(p_workspace uuid, p_actor uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
    member record;
    queue jsonb;
    people jsonb := '[]'::jsonb;
    considered integer := 0;
    others integer;
begin
    if not exists (select 1 from public.workspace_memberships m join public.workspaces w on w.id = m.workspace_id and w.status = 'active'
                   where m.workspace_id = p_workspace and m.user_id = p_actor and m.role in ('owner', 'admin')) then
        raise exception 'Owner or admin required.';
    end if;
    select count(*) into others from public.workspace_memberships where workspace_id = p_workspace and user_id <> p_actor;
    for member in
        select m.user_id, coalesce(nullif(trim(p.display_name), ''), nullif(trim(p.username), ''), 'Team member') as name
        from public.workspace_memberships m
        left join public.user_profiles p on p.user_id = m.user_id
        where m.workspace_id = p_workspace and m.user_id <> p_actor
        order by 2, m.user_id
        limit 25
    loop
        considered := considered + 1;
        queue := public.read_personal_work_queue(p_workspace, member.user_id, 0, 'ready');
        if coalesce((queue->>'ready')::integer, 0) = 0 then continue; end if;
        people := people || jsonb_build_object(
            'userId', member.user_id, 'name', member.name, 'ready', (queue->>'ready')::integer,
            'items', coalesce((
                select jsonb_agg(entry.item - 'description' - 'instructions' order by entry.position)
                from jsonb_array_elements(queue->'items') with ordinality as entry(item, position)
                where entry.position <= 4
            ), '[]'::jsonb));
    end loop;
    return jsonb_build_object('people', people, 'truncated', others > considered);
end $$;

revoke all on function public.read_team_work_queue(uuid, uuid) from public, anon, authenticated;
grant execute on function public.read_team_work_queue(uuid, uuid) to service_role;
