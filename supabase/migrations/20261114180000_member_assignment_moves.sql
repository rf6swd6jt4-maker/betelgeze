-- Reassign and remove workspace members (docs/assignment-offboarding-design.md).
--
-- Additive: two new tables, a footprint read, a preview, two commands and their internal move functions. Nothing here runs
-- on list, tab or chat paths. The two sold-client guards are redefined unchanged except that each accepts a change of the
-- manager or legacy service assignee when, and only when, the current transaction holds a member-move permit for that
-- client. Only apply_member_item_moves writes permits, and it removes them before returning.

-- Permits: one row per client a running move command may change. Never readable or writable by clients.
create table public.member_move_permits (
    transaction_id bigint not null default txid_current(),
    workspace_id uuid not null references public.workspaces(id) on delete cascade,
    relationship_id uuid not null,
    primary key (transaction_id, workspace_id, relationship_id)
);
alter table public.member_move_permits enable row level security;
revoke all on public.member_move_permits from public, anon, authenticated;

-- Receipts make a repeated request return the original result and record what moved, who did it and why.
create table public.member_move_receipts (
    workspace_id uuid not null references public.workspaces(id) on delete cascade,
    request_id uuid not null,
    command text not null check (command in ('reassign', 'offboard')),
    actor_user_id uuid not null,
    source_user_id uuid not null,
    input jsonb not null,
    result jsonb not null,
    created_at timestamptz not null default now(),
    primary key (workspace_id, request_id)
);
alter table public.member_move_receipts enable row level security;
revoke all on public.member_move_receipts from public, anon, authenticated;

create function public.member_move_permitted(p_workspace uuid, p_relationship uuid) returns boolean
language sql stable security definer set search_path = public as $$
    select exists(select 1 from public.member_move_permits
                  where transaction_id = txid_current() and workspace_id = p_workspace and relationship_id = p_relationship)
$$;

-- Same as 20260910120000_fix_relationship_archive_team_guard.sql, plus the permit exception for the manager only.
create or replace function public.guard_relationship_delivery_team() returns trigger
language plpgsql security definer set search_path=public as $$
begin
 if old.pos_started_at is not null and new.seller_user_id is distinct from old.seller_user_id then raise exception 'Seller attribution is locked to the user who began POS'; end if;
 if old.team_locked_at is not null and (new.team_locked_at is distinct from old.team_locked_at
   or (new.fulfilment_manager_user_id is distinct from old.fulfilment_manager_user_id and not public.member_move_permitted(new.workspace_id,new.id))) then
   raise exception 'The sold client team cannot be changed'; end if;
 if old.team_locked_at is null
   and old.lifecycle_phase in ('lead','potential_client','nurturing','completed_lost')
   and new.lifecycle_phase not in ('lead','potential_client','nurturing','completed_lost')
   and new.status <> 'archived' then
   perform public.validate_relationship_delivery_team(new.workspace_id,new.id);
   new.team_locked_at=now();
 end if;
 return new;
end $$;

-- Same as 20260909150000_retention_service_setup.sql, plus the permit exception for the assignee only.
create or replace function public.guard_sold_service_assignment() returns trigger
language plpgsql security definer set search_path=public as $$
declare w uuid; r uuid;
begin
 if tg_op='UPDATE' and (new.workspace_id,new.relationship_id) is distinct from (old.workspace_id,old.relationship_id) then raise exception 'Service assignment cannot be moved to another relationship'; end if;
 w=case when tg_op='DELETE' then old.workspace_id else new.workspace_id end;
 r=case when tg_op='DELETE' then old.relationship_id else new.relationship_id end;
 perform 1 from public.relationships where workspace_id=w and id=r for update;
 if exists(select 1 from public.relationships where workspace_id=w and id=r and team_locked_at is not null) then
   if tg_op='INSERT' then
     if not exists(select 1 from public.retention_service_insert_permits where transaction_id=txid_current()
       and workspace_id=w and relationship_id=r and service_id=new.service_id) then raise exception 'The sold client services cannot be changed'; end if;
   elsif tg_op='DELETE' then raise exception 'The sold client services cannot be changed';
   elsif (new.service_id,new.relationship_id) is distinct from (old.service_id,old.relationship_id)
     or (new.assignee_user_id is distinct from old.assignee_user_id and not public.member_move_permitted(w,r)) then
     raise exception 'The sold client service assignment cannot be changed';
   end if;
 end if;
 if tg_op='DELETE' then return old; end if; return new;
end $$;

-- Everything a person is responsible for that can be moved. Sellers and per-service seller/manager snapshots are history and
-- are never part of it. Open work linked to exactly one of the person's own services (including its group and stage headers)
-- follows that service and is not listed separately. Bounded by one workspace; used only by the commands below.
create function public.member_assignment_footprint(p_workspace uuid, p_target uuid, p_service uuid default null)
returns table(item_key text, kind text, relationship_id uuid, record_id uuid, service_key text, service_id uuid,
              client text, title text, imported boolean, item_fingerprint text)
language sql stable security definer set search_path = public as $$
with active_clients as (
    select r.* from public.relationships r
    where r.workspace_id = p_workspace and r.status <> 'archived' and r.lifecycle_phase <> 'completed_lost'
),
active_instances as (
    select i.*, coalesce(c.business_name, c.primary_person_name) as client_name, coalesce(v.name, i.service_key) as service_name
    from public.relationship_service_instances i
    join active_clients c on c.workspace_id = i.workspace_id and c.id = i.relationship_id
    left join public.onboarding_service_revisions v on v.workspace_id = i.workspace_id and v.id = i.service_revision_id
    where i.workspace_id = p_workspace and i.disposition = 'active' and i.stage in ('onboarding', 'setup', 'maintenance')
      and (p_service is null or i.service_id = p_service)
),
own_instances as (select * from active_instances where assignee_user_id = p_target),
following as (
    select l.work_item_id, l.instance_id
    from public.service_instance_work_items l
    join own_instances i on i.id = l.instance_id
    join public.work_items w on w.workspace_id = l.workspace_id and w.id = l.work_item_id
    where l.workspace_id = p_workspace and w.status not in ('done', 'canceled') and w.metadata->>'archived_at' is null
      and (select count(*) from public.service_instance_work_items o where o.workspace_id = p_workspace and o.work_item_id = w.id) = 1
),
open_work as (
    select w.* from public.work_items w
    where w.workspace_id = p_workspace and w.status not in ('done', 'canceled') and w.metadata->>'archived_at' is null
      and (p_service is null or w.service_id = p_service)
      and not exists (select 1 from following f where f.work_item_id = w.id)
      and (w.execution_owner_id = p_target
           or exists (select 1 from public.work_item_assignees a where a.workspace_id = p_workspace and a.work_item_id = w.id and a.user_id = p_target))
)
select 'client_manager:' || c.id, 'client_manager', c.id, c.id, null::text, null::uuid,
       coalesce(c.business_name, c.primary_person_name), 'Fulfilment manager', false,
       md5(concat_ws('|', c.fulfilment_manager_user_id, c.status, c.lifecycle_phase, c.team_locked_at))
from active_clients c where c.fulfilment_manager_user_id = p_target and p_service is null
union all
select 'legacy_service_assignee:' || s.relationship_id || ':' || s.service_key, 'legacy_service_assignee', s.relationship_id, s.relationship_id,
       s.service_key, s.service_id, coalesce(c.business_name, c.primary_person_name), s.service_key, false,
       md5(concat_ws('|', s.assignee_user_id, s.service_id))
from public.relationship_services s
join active_clients c on c.workspace_id = s.workspace_id and c.id = s.relationship_id
where s.workspace_id = p_workspace and s.assignee_user_id = p_target and (p_service is null or s.service_id = p_service)
union all
select 'service_assignee:' || i.id, 'service_assignee', i.relationship_id, i.id, null, i.service_id, i.client_name, i.service_name,
       i.import_id is not null,
       md5(concat_ws('|', i.version, i.assignee_user_id,
           (select string_agg(f.work_item_id::text || ':' || coalesce(w.execution_owner_id::text, '') || ':' || w.updated_at::text, ',' order by f.work_item_id)
              from following f join public.work_items w on w.id = f.work_item_id where f.instance_id = i.id)))
from own_instances i
union all
select 'queue_member:' || i.id, 'queue_member', i.relationship_id, i.id, null, i.service_id, i.client_name, i.service_name,
       i.import_id is not null,
       md5(concat_ws('|', (select q.version from public.service_queue_rosters q where q.instance_id = i.id), i.assignee_user_id))
from active_instances i
join public.service_queue_members m on m.workspace_id = i.workspace_id and m.instance_id = i.id and m.user_id = p_target
union all
select case when w.execution_owner_id = p_target then 'work_owner:' else 'work_collaborator:' end || w.id,
       case when w.execution_owner_id = p_target then 'work_owner' else 'work_collaborator' end,
       (select wr.relationship_id from public.work_item_relationships wr where wr.work_item_id = w.id order by wr.relationship_id limit 1),
       w.id, null, w.service_id,
       (select string_agg(distinct coalesce(r.business_name, r.primary_person_name), ', ') from public.work_item_relationships wr
          join public.relationships r on r.id = wr.relationship_id where wr.work_item_id = w.id),
       w.title, false,
       md5(concat_ws('|', w.updated_at, w.execution_owner_id,
           (select string_agg(a.user_id::text, ',' order by a.user_id) from public.work_item_assignees a where a.work_item_id = w.id)))
from open_work w
$$;

create function public.member_move_request(p_request uuid, p_label text, p_id uuid) returns uuid
language sql immutable as $$ select md5(p_request::text || ':' || p_label || ':' || p_id::text)::uuid $$;

create function public.member_move_actor_check(p_workspace uuid, p_actor uuid, p_source uuid) returns void
language plpgsql stable security definer set search_path = public as $$
declare actor_role text; source_role text;
begin
    select m.role into actor_role from public.workspace_memberships m join public.workspaces w on w.id = m.workspace_id and w.status = 'active'
    where m.workspace_id = p_workspace and m.user_id = p_actor;
    if actor_role is null or actor_role not in ('owner', 'admin') then raise exception 'Owner or admin required.'; end if;
    select role into source_role from public.workspace_memberships where workspace_id = p_workspace and user_id = p_source;
    if actor_role = 'admin' and source_role = 'owner' then raise exception 'Admins cannot move an owner''s work.'; end if;
end $$;

-- Moves one task from the source to the recipient: ownership and collaborator entry, never anyone else's.
create function public.member_move_work(p_workspace uuid, p_actor uuid, p_work uuid, p_source uuid, p_recipient uuid) returns void
language plpgsql security definer set search_path = public as $$
declare w public.work_items%rowtype;
begin
    select * into w from public.work_items where workspace_id = p_workspace and id = p_work for update;
    if w.id is null then raise exception 'A task was removed while saving. Reload and try again.'; end if;
    if p_recipient is null then
        update public.work_items set execution_owner_id = null where workspace_id = p_workspace and id = p_work and execution_owner_id = p_source;
        delete from public.work_item_assignees where workspace_id = p_workspace and work_item_id = p_work and user_id = p_source;
        return;
    end if;
    if w.execution_owner_id = p_source then
        update public.work_items set execution_owner_id = p_recipient where workspace_id = p_workspace and id = p_work;
    end if;
    if exists (select 1 from public.work_item_assignees where workspace_id = p_workspace and work_item_id = p_work and user_id = p_source) then
        delete from public.work_item_assignees where workspace_id = p_workspace and work_item_id = p_work and user_id = p_source;
        insert into public.work_item_assignees(work_item_id, user_id, workspace_id, assigned_by)
        values (p_work, p_recipient, p_workspace, p_actor) on conflict do nothing;
    end if;
    if not public.workspace_user_can_access_work_item(p_workspace, p_work, p_recipient) then
        raise exception 'The new person cannot open "%". Nothing was moved.', w.title;
    end if;
end $$;

-- Shared by both commands. Validates the plan against the current footprint, then moves each item using the existing rules.
create function public.apply_member_item_moves(p_workspace uuid, p_actor uuid, p_request uuid, p_source uuid,
                                               p_plan jsonb, p_reason text, p_leave_open_work boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
    step record; recipient uuid; inst public.relationship_service_instances%rowtype; preview jsonb; work record;
    roster uuid[]; roster_version integer; moved jsonb := '[]'::jsonb;
begin
    if jsonb_typeof(p_plan) is distinct from 'array' then raise exception 'A plan is required.'; end if;
    if jsonb_array_length(p_plan) > 300 then raise exception 'Move at most 300 assignments at once.'; end if;
    if (select count(distinct x->>'key') from jsonb_array_elements(p_plan) x) <> jsonb_array_length(p_plan)
       or exists (select 1 from jsonb_array_elements(p_plan) x where x->>'key' is null or x->>'fingerprint' is null) then
        raise exception 'Each assignment must appear once with its key and fingerprint.';
    end if;
    if p_reason is null or length(btrim(p_reason)) not between 1 and 1000 then raise exception 'A reason is required.'; end if;

    -- Relationship-first lock order, matching work publication, service transfer and chat ownership.
    perform 1 from public.relationships r
    where r.workspace_id = p_workspace and r.id in (
        select f.relationship_id from public.member_assignment_footprint(p_workspace, p_source, null) f
        join jsonb_array_elements(p_plan) x on x->>'key' = f.item_key where f.relationship_id is not null)
    order by r.id for update;

    drop table if exists member_move_current;
    create temp table member_move_current on commit drop as
        select f.*, x.value as entry
        from public.member_assignment_footprint(p_workspace, p_source, null) f
        join jsonb_array_elements(p_plan) x on x.value->>'key' = f.item_key;

    if (select count(*) from member_move_current) <> jsonb_array_length(p_plan)
       or exists (select 1 from member_move_current where item_fingerprint is distinct from entry->>'fingerprint') then
        raise exception 'Assignments changed. Reload and try again. Nothing was moved.';
    end if;

    for step in select * from member_move_current loop
        recipient := nullif(step.entry->>'recipientId', '')::uuid;
        if recipient is null then
            if not (p_leave_open_work and step.kind in ('work_owner', 'work_collaborator')) then
                raise exception 'Choose who takes every client, service and shared queue.';
            end if;
            continue;
        end if;
        if recipient = p_source then raise exception 'Choose someone other than the person whose work is moving.'; end if;
        if not exists (select 1 from public.workspace_memberships where workspace_id = p_workspace and user_id = recipient) then
            raise exception 'Choose current workspace members.';
        end if;
        if step.kind = 'client_manager' and not exists (select 1 from public.workspace_operational_roles
              where workspace_id = p_workspace and user_id = recipient and can_manage) then
            raise exception 'The new manager for % must be able to manage clients.', step.client;
        end if;
        if step.kind in ('legacy_service_assignee', 'service_assignee', 'queue_member') and not exists (
              select 1 from public.workspace_member_service_access where workspace_id = p_workspace and user_id = recipient and service_id = step.service_id) then
            raise exception 'The new person for % (%) is not eligible for that service.', step.title, step.client;
        end if;
        if step.kind in ('service_assignee', 'queue_member') and step.imported then
            raise exception 'An imported service (% for %) must be reviewed before it can move.', step.title, step.client;
        end if;
    end loop;

    insert into public.member_move_permits(workspace_id, relationship_id)
    select distinct p_workspace, relationship_id from member_move_current
    where kind in ('client_manager', 'legacy_service_assignee') and nullif(entry->>'recipientId', '') is not null
    on conflict do nothing;

    for step in select * from member_move_current
        order by case kind when 'client_manager' then 1 when 'legacy_service_assignee' then 2 when 'service_assignee' then 3
                           when 'queue_member' then 4 else 5 end, item_key loop
        recipient := nullif(step.entry->>'recipientId', '')::uuid;

        if step.kind = 'client_manager' then
            update public.relationships set fulfilment_manager_user_id = recipient
            where workspace_id = p_workspace and id = step.record_id and fulfilment_manager_user_id = p_source;

        elsif step.kind = 'legacy_service_assignee' then
            update public.relationship_services set assignee_user_id = recipient
            where workspace_id = p_workspace and relationship_id = step.record_id and service_key = step.service_key and assignee_user_id = p_source;

        elsif step.kind = 'service_assignee' then
            select * into inst from public.relationship_service_instances where workspace_id = p_workspace and id = step.record_id for update;
            preview := public.preview_service_assignee_transfer(p_workspace, inst.relationship_id, inst.id, p_actor, recipient);
            if preview->>'bookingEnabled' = 'false' then
                raise exception 'Enable Appointment Setting booking permission for % before moving it.', step.title;
            end if;
            perform public.change_service_instance(p_workspace, inst.id, p_actor, public.member_move_request(p_request, 'instance', inst.id),
                                                   inst.version, inst.stage, inst.disposition, recipient, btrim(p_reason));
            for work in
                select w.id from public.service_instance_work_items l
                join public.work_items w on w.workspace_id = l.workspace_id and w.id = l.work_item_id
                where l.workspace_id = p_workspace and l.instance_id = inst.id
                  and w.status not in ('done', 'canceled') and w.metadata->>'archived_at' is null
                  and (select count(*) from public.service_instance_work_items o where o.workspace_id = p_workspace and o.work_item_id = w.id) = 1
                order by w.id
            loop
                perform public.member_move_work(p_workspace, p_actor, work.id, p_source, recipient);
            end loop;
            if not public.service_assignee_chat_membership_justified(p_workspace, inst.relationship_id, p_source) then
                delete from public.workspace_team_members m using public.workspace_teams t
                where t.workspace_id = p_workspace and t.relationship_id = inst.relationship_id and m.team_id = t.id and m.user_id = p_source;
                delete from public.service_queue_chat_members c using public.workspace_teams t
                where t.workspace_id = p_workspace and t.relationship_id = inst.relationship_id and c.team_id = t.id and c.user_id = p_source;
            end if;
            if preview->>'appointment' = 'true' and (not public.service_assignee_can_setup_client(p_workspace, recipient, inst.relationship_id)
               or inst.stage in ('setup', 'maintenance') and not public.workspace_user_can_manage_appointment_setting(p_workspace, inst.relationship_id, inst.service_id, recipient)) then
                raise exception 'The new person cannot use bookings and setup for %. Nothing was moved.', step.client;
            end if;

        elsif step.kind = 'queue_member' then
            select * into inst from public.relationship_service_instances where workspace_id = p_workspace and id = step.record_id for update;
            select version into roster_version from public.service_queue_rosters where instance_id = inst.id;
            select coalesce(array_agg(m.user_id order by m.user_id), '{}') into roster from public.service_queue_members m
            where m.instance_id = inst.id and m.user_id <> p_source and m.user_id is distinct from recipient and m.user_id is distinct from inst.assignee_user_id;
            if recipient is distinct from inst.assignee_user_id then roster := roster || recipient; end if;
            perform public.save_service_queue_roster(p_workspace, inst.relationship_id, inst.id, p_actor,
                                                     public.member_move_request(p_request, 'roster', inst.id), coalesce(roster_version, 0), roster);

        else
            perform public.member_move_work(p_workspace, p_actor, step.record_id, p_source, recipient);
        end if;

        moved := moved || jsonb_build_object('key', step.item_key, 'kind', step.kind, 'recipientId', recipient);
    end loop;

    delete from public.member_move_permits where transaction_id = txid_current() and workspace_id = p_workspace;
    return jsonb_build_object('moved', moved);
end $$;

create function public.preview_workspace_member_footprint(p_workspace uuid, p_actor uuid, p_target uuid, p_service uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare n integer; items jsonb; groups jsonb; fingerprint text; sellers integer;
begin
    if not exists (select 1 from public.workspace_memberships m join public.workspaces w on w.id = m.workspace_id and w.status = 'active'
                   where m.workspace_id = p_workspace and m.user_id = p_actor and m.role in ('owner', 'admin')) then
        raise exception 'Owner or admin required.';
    end if;
    create temp table if not exists member_preview_items on commit drop as
        select * from public.member_assignment_footprint(p_workspace, p_target, p_service) limit 0;
    delete from member_preview_items;
    insert into member_preview_items select * from public.member_assignment_footprint(p_workspace, p_target, p_service) limit 301;
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

create function public.reassign_workspace_member_items(p_workspace uuid, p_actor uuid, p_request uuid, p_source uuid, p_input jsonb)
returns jsonb language plpgsql security definer set search_path = public set lock_timeout = '5s' set statement_timeout = '30s' as $$
declare receipt public.member_move_receipts%rowtype; result jsonb;
begin
    if p_request is null or p_source is null or p_input is null then raise exception 'A request ID, person and plan are required.'; end if;
    perform public.member_move_actor_check(p_workspace, p_actor, p_source);
    perform pg_advisory_xact_lock(hashtextextended('member-move:' || p_workspace::text || ':' || p_request::text, 0));
    select * into receipt from public.member_move_receipts where workspace_id = p_workspace and request_id = p_request;
    if found then
        if (receipt.command, receipt.actor_user_id, receipt.source_user_id, receipt.input) is distinct from ('reassign', p_actor, p_source, p_input) then
            raise exception 'Request ID reused with different input.';
        end if;
        return receipt.result;
    end if;
    if jsonb_array_length(coalesce(p_input->'plan', '[]'::jsonb)) = 0 then raise exception 'Choose at least one assignment to move.'; end if;
    result := public.apply_member_item_moves(p_workspace, p_actor, p_request, p_source, p_input->'plan', p_input->>'reason', false);
    insert into public.member_move_receipts(workspace_id, request_id, command, actor_user_id, source_user_id, input, result)
    values (p_workspace, p_request, 'reassign', p_actor, p_source, p_input, result);
    return result;
end $$;

create function public.offboard_workspace_member(p_workspace uuid, p_actor uuid, p_request uuid, p_target uuid, p_input jsonb)
returns jsonb language plpgsql security definer set search_path = public set lock_timeout = '5s' set statement_timeout = '30s' as $$
declare receipt public.member_move_receipts%rowtype; result jsonb; actor_role text; target_role text; current_fingerprint text;
        leave boolean; uncovered integer; work record;
begin
    if p_request is null or p_target is null or p_input is null then raise exception 'A request ID, person and plan are required.'; end if;
    perform public.member_move_actor_check(p_workspace, p_actor, p_target);
    perform pg_advisory_xact_lock(hashtextextended('member-move:' || p_workspace::text || ':' || p_request::text, 0));
    select * into receipt from public.member_move_receipts where workspace_id = p_workspace and request_id = p_request;
    if found then
        if (receipt.command, receipt.actor_user_id, receipt.source_user_id, receipt.input) is distinct from ('offboard', p_actor, p_target, p_input) then
            raise exception 'Request ID reused with different input.';
        end if;
        return receipt.result;
    end if;

    select role into actor_role from public.workspace_memberships where workspace_id = p_workspace and user_id = p_actor;
    select role into target_role from public.workspace_memberships where workspace_id = p_workspace and user_id = p_target for update;
    if target_role is null then raise exception 'That person is no longer in this workspace.'; end if;
    if target_role = 'owner' then raise exception 'Owners cannot be removed here.'; end if;
    if actor_role = 'admin' and target_role <> 'staff' then raise exception 'Admins can only remove staff.'; end if;
    if p_actor = p_target then raise exception 'You cannot remove yourself here.'; end if;

    select md5(coalesce(string_agg(f.item_key || ':' || f.item_fingerprint, ',' order by f.item_key), '')) into current_fingerprint
    from public.member_assignment_footprint(p_workspace, p_target, null) f;
    if current_fingerprint is distinct from p_input->>'footprintFingerprint' then
        raise exception 'Assignments changed. Reload and try again. Nothing was moved.';
    end if;

    leave := coalesce((p_input->>'leaveOpenWork')::boolean, false);
    select count(*) into uncovered from public.member_assignment_footprint(p_workspace, p_target, null) f
    where not exists (select 1 from jsonb_array_elements(coalesce(p_input->'plan', '[]'::jsonb)) x where x->>'key' = f.item_key)
      and (f.kind not in ('work_owner', 'work_collaborator') or not leave);
    if uncovered > 0 then raise exception 'Choose who takes every assignment before removing this person.'; end if;

    result := public.apply_member_item_moves(p_workspace, p_actor, p_request, p_target, coalesce(p_input->'plan', '[]'::jsonb), p_input->>'reason', leave);

    if leave then
        for work in select f.record_id from public.member_assignment_footprint(p_workspace, p_target, null) f
                    where f.kind in ('work_owner', 'work_collaborator') order by f.record_id loop
            perform public.member_move_work(p_workspace, p_actor, work.record_id, p_target, null);
        end loop;
    end if;

    if exists (select 1 from public.member_assignment_footprint(p_workspace, p_target, null)) then
        raise exception 'Something was assigned to this person while saving. Reload and try again. Nothing was moved.';
    end if;

    delete from public.workspace_memberships where workspace_id = p_workspace and user_id = p_target;
    result := result || jsonb_build_object('removed', true, 'leftOpenWorkUnassigned', leave);
    insert into public.member_move_receipts(workspace_id, request_id, command, actor_user_id, source_user_id, input, result)
    values (p_workspace, p_request, 'offboard', p_actor, p_target, p_input, result);
    return result;
end $$;

-- Server-only, like the existing service transfer: the app calls these with the service role after its own auth and MFA checks.
do $$
declare f record;
begin
    for f in select oid::regprocedure as signature, proname from pg_proc where pronamespace = 'public'::regnamespace and proname in (
        'member_move_permitted', 'member_assignment_footprint', 'member_move_request', 'member_move_actor_check', 'member_move_work',
        'apply_member_item_moves', 'preview_workspace_member_footprint', 'reassign_workspace_member_items', 'offboard_workspace_member') loop
        execute format('revoke all on function %s from public, anon, authenticated, service_role', f.signature);
        if f.proname in ('preview_workspace_member_footprint', 'reassign_workspace_member_items', 'offboard_workspace_member') then
            execute format('grant execute on function %s to service_role', f.signature);
        end if;
    end loop;
end $$;
