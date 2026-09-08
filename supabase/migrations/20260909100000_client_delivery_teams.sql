-- Client delivery teams: workspace authority, operational eligibility, and
-- client responsibility are separate. Existing sold allocations are retained.
begin;

drop trigger if exists workspace_memberships_require_staff_service on public.workspace_memberships;
drop trigger if exists workspace_member_service_access_requires_one on public.workspace_member_service_access;

create table public.workspace_operational_roles (
    workspace_id uuid not null,
    user_id uuid not null,
    can_sell boolean not null default false,
    can_manage boolean not null default false,
    updated_by uuid references auth.users(id) on delete set null,
    updated_at timestamptz not null default now(),
    primary key (workspace_id, user_id),
    foreign key (workspace_id, user_id) references public.workspace_memberships(workspace_id, user_id) on delete cascade
);
create table public.workspace_operational_permissions (
    workspace_id uuid not null references public.workspaces(id) on delete cascade,
    position text not null check (position in ('seller', 'manager')),
    capability text not null check (capability in ('relationships.view', 'communications.manage', 'onboarding.manage', 'fulfilment.manage')),
    primary key (workspace_id, position, capability)
);
insert into public.workspace_operational_roles(workspace_id, user_id, can_sell, can_manage)
select m.workspace_id, m.user_id,
    m.role in ('owner','admin') or exists(select 1 from public.relationships r where r.workspace_id=m.workspace_id and r.seller_user_id=m.user_id),
    m.role in ('owner','admin') or exists(select 1 from public.relationships r where r.workspace_id=m.workspace_id and r.fulfilment_manager_user_id=m.user_id)
from public.workspace_memberships m;
insert into public.workspace_operational_permissions
select w.id, p.position, p.capability from public.workspaces w
cross join (values ('seller','relationships.view'), ('seller','communications.manage'),
 ('manager','relationships.view'), ('manager','communications.manage'), ('manager','onboarding.manage'), ('manager','fulfilment.manage')) p(position,capability);

-- Reuse service-access rows as the eligible delivery pool, for every workspace role.
insert into public.workspace_member_service_access(workspace_id,user_id,service_id)
select r.workspace_id,r.assignee_user_id,r.service_id from public.relationship_services r
join public.workspace_memberships m on m.workspace_id=r.workspace_id and m.user_id=r.assignee_user_id
where r.service_id is not null on conflict do nothing;
insert into public.workspace_member_service_access(workspace_id,user_id,service_id)
select r.workspace_id,r.responsible_user_id,r.service_id from public.workspace_team_service_responsibilities r
join public.workspace_memberships m on m.workspace_id=r.workspace_id and m.user_id=r.responsible_user_id
on conflict do nothing;
insert into public.workspace_member_service_access(workspace_id,user_id,service_id)
select r.workspace_id,r.default_assignee_user_id,r.service_id from public.onboarding_service_revisions r
join public.workspace_memberships m on m.workspace_id=r.workspace_id and m.user_id=r.default_assignee_user_id
where r.default_assignee_user_id is not null on conflict do nothing;

alter table public.relationships add column pos_started_at timestamptz;
alter table public.relationships add column team_locked_at timestamptz;
alter table public.client_sales add column seller_user_id uuid references auth.users(id) on delete set null;
alter table public.workspace_teams drop constraint workspace_teams_kind_check;
alter table public.workspace_teams add constraint workspace_teams_kind_check check (kind in ('admins','maintenance','custom','relationship'));
alter table public.workspace_teams drop constraint workspace_teams_check;
alter table public.workspace_teams add constraint workspace_teams_check check ((kind in ('admins','maintenance') and archived_at is null) or kind in ('custom','relationship'));
alter table public.workspace_teams add column relationship_id uuid;
alter table public.workspace_teams add constraint workspace_teams_relationship_fkey foreign key(workspace_id,relationship_id) references public.relationships(workspace_id,id) on delete cascade;
create unique index workspace_teams_relationship_unique on public.workspace_teams(workspace_id,relationship_id) where relationship_id is not null;
-- Client names are not globally unique. System/custom group names still are.
drop index public.workspace_teams_active_name_unique;
create unique index workspace_teams_active_name_unique on public.workspace_teams(workspace_id,lower(name)) where archived_at is null and kind <> 'relationship';

create table public.relationship_client_chat_members (
    workspace_id uuid not null,
    relationship_id uuid not null,
    user_id uuid not null,
    added_by uuid references auth.users(id) on delete set null,
    added_at timestamptz not null default now(),
    primary key(relationship_id,user_id),
    foreign key(workspace_id,relationship_id) references public.relationships(workspace_id,id) on delete cascade,
    foreign key(workspace_id,user_id) references public.workspace_memberships(workspace_id,user_id) on delete cascade
);
create table public.relationship_team_events (
    id uuid primary key default gen_random_uuid(),
    workspace_id uuid not null references public.workspaces(id) on delete cascade,
    relationship_id uuid not null references public.relationships(id) on delete cascade,
    actor_user_id uuid references auth.users(id) on delete set null,
    event_type text not null,
    details jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now()
);

alter table public.workspace_operational_roles enable row level security;
alter table public.workspace_operational_permissions enable row level security;
alter table public.relationship_client_chat_members enable row level security;
alter table public.relationship_team_events enable row level security;
create policy "workspace members read operational roles" on public.workspace_operational_roles for select to authenticated using(public.is_workspace_member(workspace_id));
create policy "workspace members read operational permissions" on public.workspace_operational_permissions for select to authenticated using(public.is_workspace_member(workspace_id));
create policy "admins read team audit" on public.relationship_team_events for select to authenticated using(public.is_workspace_member(workspace_id,array['owner','admin']));

create function public.workspace_user_can_sell(p_workspace_id uuid,p_user_id uuid default auth.uid()) returns boolean
language sql stable security definer set search_path=public as $$
 select exists(select 1 from public.workspace_operational_roles o join public.workspace_memberships m using(workspace_id,user_id)
 where o.workspace_id=p_workspace_id and o.user_id=p_user_id and o.can_sell)
$$;
create function public.client_conversation_can_access(p_workspace_id uuid,p_relationship_id uuid,p_user_id uuid default auth.uid()) returns boolean
language sql stable security definer set search_path=public as $$
 select exists(select 1 from public.relationships r join public.workspace_memberships m on m.workspace_id=r.workspace_id and m.user_id=p_user_id
 where r.workspace_id=p_workspace_id and r.id=p_relationship_id and r.status <> 'archived'
 and (r.seller_user_id=p_user_id or r.fulfilment_manager_user_id=p_user_id or exists(
 select 1 from public.relationship_client_chat_members c where c.workspace_id=r.workspace_id and c.relationship_id=r.id and c.user_id=p_user_id)))
$$;
create policy "participants read client chat members" on public.relationship_client_chat_members for select to authenticated using(public.client_conversation_can_access(workspace_id,relationship_id));

-- One scoped roster read per workspace, including large agencies.
create function public.client_conversation_rosters(p_workspace_id uuid,p_user_id uuid)
returns table(relationship_id uuid,manager_id uuid,member_ids uuid[],optional_ids uuid[],eligible_ids uuid[])
language sql stable security definer set search_path=public as $$
 select r.id,r.fulfilment_manager_user_id,
 array(select m.user_id from public.workspace_memberships m where m.workspace_id=r.workspace_id and (m.user_id in(r.seller_user_id,r.fulfilment_manager_user_id) or exists(select 1 from public.relationship_client_chat_members c where c.relationship_id=r.id and c.user_id=m.user_id))),
 array(select c.user_id from public.relationship_client_chat_members c where c.relationship_id=r.id and c.user_id is distinct from r.seller_user_id and c.user_id is distinct from r.fulfilment_manager_user_id),
 array(select distinct s.assignee_user_id from public.relationship_services s join public.workspace_memberships m on m.workspace_id=s.workspace_id and m.user_id=s.assignee_user_id where s.workspace_id=r.workspace_id and s.relationship_id=r.id and s.assignee_user_id is distinct from r.seller_user_id and s.assignee_user_id is distinct from r.fulfilment_manager_user_id)
 from public.relationships r where r.workspace_id=p_workspace_id and public.client_conversation_can_access(p_workspace_id,r.id,p_user_id)
$$;
revoke all on function public.client_conversation_rosters(uuid,uuid) from public,anon,authenticated;
grant execute on function public.client_conversation_rosters(uuid,uuid) to service_role;

create function public.begin_relationship_pos(p_workspace_id uuid,p_relationship_id uuid,p_actor_user_id uuid) returns jsonb
language plpgsql security definer set search_path=public as $$
declare r public.relationships%rowtype;
begin
 if not public.workspace_user_can_sell(p_workspace_id,p_actor_user_id) then raise exception 'Your account is not enabled for selling'; end if;
 select * into r from public.relationships where workspace_id=p_workspace_id and id=p_relationship_id and status <> 'archived' for update;
 if r.id is null then raise exception 'Relationship not found'; end if;
 if r.pos_started_at is not null or r.team_locked_at is not null then
   if r.seller_user_id is distinct from p_actor_user_id then raise exception 'This POS belongs to another seller'; end if;
   return jsonb_build_object('seller_user_id',r.seller_user_id,'updated_at',r.updated_at);
 end if;
 update public.relationships set seller_user_id=p_actor_user_id,pos_started_at=now(),updated_at=now() where id=r.id returning * into r;
 insert into public.relationship_team_events(workspace_id,relationship_id,actor_user_id,event_type) values(p_workspace_id,r.id,p_actor_user_id,'pos_started');
 return jsonb_build_object('seller_user_id',r.seller_user_id,'updated_at',r.updated_at);
end $$;

create function public.validate_relationship_delivery_team(p_workspace_id uuid,p_relationship_id uuid) returns void
language plpgsql security definer set search_path=public as $$
declare r public.relationships%rowtype;
begin
 select * into r from public.relationships where workspace_id=p_workspace_id and id=p_relationship_id for update;
 if r.id is null then raise exception 'Relationship not found'; end if;
 if r.team_locked_at is not null then return; end if;
 if r.pos_started_at is null or r.seller_user_id is null then raise exception 'Begin POS before selling this client'; end if;
 if not exists(select 1 from public.workspace_memberships where workspace_id=p_workspace_id and user_id=r.seller_user_id) then raise exception 'The seller is no longer in this workspace'; end if;
 if not exists(select 1 from public.workspace_operational_roles where workspace_id=p_workspace_id and user_id=r.fulfilment_manager_user_id and can_manage) then raise exception 'Choose an eligible fulfilment manager'; end if;
 if not exists(select 1 from public.relationship_services where workspace_id=p_workspace_id and relationship_id=r.id) then raise exception 'Choose at least one service'; end if;
 if exists(select 1 from public.relationship_services s where s.workspace_id=p_workspace_id and s.relationship_id=r.id and not exists(
 select 1 from public.workspace_member_service_access e where e.workspace_id=s.workspace_id and e.service_id=s.service_id and e.user_id=s.assignee_user_id)) then raise exception 'Choose an eligible fulfilment person for every service'; end if;
end $$;

create function public.create_relationship_delivery_team(p_workspace_id uuid,p_relationship_id uuid) returns uuid
language plpgsql security definer set search_path=public as $$
declare r public.relationships%rowtype; t uuid;
begin
 select * into r from public.relationships where workspace_id=p_workspace_id and id=p_relationship_id for update;
 if r.id is null then raise exception 'Relationship not found'; end if;
 select id into t from public.workspace_teams where workspace_id=p_workspace_id and relationship_id=r.id;
 if t is not null then return t; end if;
 insert into public.workspace_teams(workspace_id,name,kind,relationship_id,created_by)
 values(p_workspace_id,left('Team: '||coalesce(nullif(r.business_name,''),r.primary_person_name),80),'relationship',r.id,r.seller_user_id) returning id into t;
 insert into public.workspace_team_members(workspace_id,team_id,user_id,added_by)
 select p_workspace_id,t,m.user_id,r.seller_user_id from public.workspace_memberships m
 where m.workspace_id=p_workspace_id and (m.user_id in(r.seller_user_id,r.fulfilment_manager_user_id) or exists(
 select 1 from public.relationship_services s where s.workspace_id=p_workspace_id and s.relationship_id=r.id and s.assignee_user_id=m.user_id)) on conflict do nothing;
 insert into public.relationship_team_events(workspace_id,relationship_id,actor_user_id,event_type,details)
 values(p_workspace_id,r.id,r.seller_user_id,'team_created',jsonb_build_object('team_id',t));
 return t;
end $$;

-- Import existing sold clients from their saved service assignments, never from
-- a reusable team's current routing map. Existing chat history remains intact.
update public.relationships set team_locked_at=coalesce(updated_at,created_at),pos_started_at=coalesce(updated_at,created_at)
where lifecycle_phase not in ('lead','potential_client','nurturing');
update public.client_sales s set seller_user_id=r.seller_user_id from public.relationships r where r.id=s.relationship_id and r.workspace_id=s.workspace_id;
do $$ declare r record; begin
 for r in select workspace_id,id from public.relationships where team_locked_at is not null and status <> 'archived' loop
 perform public.create_relationship_delivery_team(r.workspace_id,r.id);
 end loop;
end $$;

create function public.guard_relationship_delivery_team() returns trigger
language plpgsql security definer set search_path=public as $$
begin
 if old.pos_started_at is not null and new.seller_user_id is distinct from old.seller_user_id then raise exception 'Seller attribution is locked to the user who began POS'; end if;
 if old.team_locked_at is not null and (new.fulfilment_manager_user_id is distinct from old.fulfilment_manager_user_id or new.team_locked_at is distinct from old.team_locked_at) then raise exception 'The sold client team cannot be changed'; end if;
 if old.team_locked_at is null and old.lifecycle_phase in ('lead','potential_client','nurturing') and new.lifecycle_phase not in ('lead','potential_client','nurturing') then
   perform public.validate_relationship_delivery_team(new.workspace_id,new.id);
   new.team_locked_at=now();
 end if;
 return new;
end $$;
create trigger guard_relationship_delivery_team before update on public.relationships for each row execute function public.guard_relationship_delivery_team();
create function public.sync_relationship_delivery_team() returns trigger
language plpgsql security definer set search_path=public as $$
begin
 if new.team_locked_at is not null then
 perform public.create_relationship_delivery_team(new.workspace_id,new.id);
 update public.workspace_teams set name=left('Team: '||coalesce(nullif(new.business_name,''),new.primary_person_name),80),archived_at=case when new.status='archived' then now() else null end where workspace_id=new.workspace_id and relationship_id=new.id;
 end if;
 return new;
end $$;
create trigger sync_relationship_delivery_team after update of lifecycle_phase,business_name,primary_person_name,status on public.relationships for each row execute function public.sync_relationship_delivery_team();

create function public.guard_sold_service_assignment() returns trigger
language plpgsql security definer set search_path=public as $$
declare w uuid; r uuid;
begin
 if tg_op='UPDATE' and (new.workspace_id,new.relationship_id) is distinct from (old.workspace_id,old.relationship_id) then raise exception 'Service assignment cannot be moved to another relationship'; end if;
 w=case when tg_op='DELETE' then old.workspace_id else new.workspace_id end;
 r=case when tg_op='DELETE' then old.relationship_id else new.relationship_id end;
 -- Lock the parent, sharing the same serialization boundary as POS/sale.
 perform 1 from public.relationships where workspace_id=w and id=r for update;
 if exists(select 1 from public.relationships where workspace_id=w and id=r and team_locked_at is not null) then
 if tg_op='INSERT' or tg_op='DELETE' then raise exception 'The sold client services cannot be changed'; end if;
 if (new.assignee_user_id,new.service_id,new.relationship_id) is distinct from (old.assignee_user_id,old.service_id,old.relationship_id) then raise exception 'The sold client service assignment cannot be changed'; end if;
 end if;
 if tg_op='DELETE' then return old; end if; return new;
end $$;
create trigger guard_sold_service_assignment before insert or update or delete on public.relationship_services for each row execute function public.guard_sold_service_assignment();

create function public.set_client_chat_members(p_workspace_id uuid,p_relationship_id uuid,p_actor_user_id uuid,p_user_ids uuid[]) returns void
language plpgsql security definer set search_path=public as $$
declare r public.relationships%rowtype;
begin
 select * into r from public.relationships where workspace_id=p_workspace_id and id=p_relationship_id and status <> 'archived' for update;
 if r.id is null or r.fulfilment_manager_user_id is distinct from p_actor_user_id or not exists(select 1 from public.workspace_memberships where workspace_id=p_workspace_id and user_id=p_actor_user_id) then raise exception 'Only this client’s manager can change client-chat participation'; end if;
 if exists(select 1 from unnest(coalesce(p_user_ids,'{}'::uuid[])) u where not exists(
 select 1 from public.relationship_services s join public.workspace_memberships m on m.workspace_id=s.workspace_id and m.user_id=s.assignee_user_id
 where s.workspace_id=p_workspace_id and s.relationship_id=r.id and s.assignee_user_id=u)) then raise exception 'Only this client’s fulfilment staff can join the client conversation'; end if;
 delete from public.relationship_client_chat_members where relationship_id=r.id;
 insert into public.relationship_client_chat_members(workspace_id,relationship_id,user_id,added_by)
 select p_workspace_id,r.id,u,p_actor_user_id from (select distinct unnest(coalesce(p_user_ids,'{}'::uuid[])) u) x;
 insert into public.relationship_team_events(workspace_id,relationship_id,actor_user_id,event_type,details) values(p_workspace_id,r.id,p_actor_user_id,'client_chat_members_changed',jsonb_build_object('user_ids',p_user_ids));
end $$;

create function public.save_workspace_operations(p_workspace_id uuid,p_actor_user_id uuid,p_people jsonb,p_permissions jsonb) returns void
language plpgsql security definer set search_path=public as $$
declare p jsonb; k text; caps jsonb;
begin
 if not coalesce(public.workspace_role_for_user(p_workspace_id,p_actor_user_id) in ('owner','admin'),false) then raise exception 'Workspace administration required'; end if;
 perform 1 from public.workspaces where id=p_workspace_id for update;
 for p in select value from jsonb_array_elements(p_people) loop
 if not exists(select 1 from public.workspace_memberships where workspace_id=p_workspace_id and user_id=(p->>'userId')::uuid) then raise exception 'Choose current workspace members'; end if;
 insert into public.workspace_operational_roles(workspace_id,user_id,can_sell,can_manage,updated_by)
 values(p_workspace_id,(p->>'userId')::uuid,(p->>'canSell')::boolean,(p->>'canManage')::boolean,p_actor_user_id)
 on conflict(workspace_id,user_id) do update set can_sell=excluded.can_sell,can_manage=excluded.can_manage,updated_by=excluded.updated_by,updated_at=now();
 end loop;
 for k,caps in select * from jsonb_each(p_permissions) loop
 if k not in ('seller','manager') then raise exception 'Invalid operational position'; end if;
 delete from public.workspace_operational_permissions where workspace_id=p_workspace_id and position=k;
 insert into public.workspace_operational_permissions select p_workspace_id,k,value from jsonb_array_elements_text(caps);
 end loop;
end $$;

create function public.set_service_delivery_users(p_workspace_id uuid,p_actor_user_id uuid,p_service_id uuid,p_user_ids uuid[]) returns void
language plpgsql security definer set search_path=public as $$
begin
 if not coalesce(public.workspace_role_for_user(p_workspace_id,p_actor_user_id) in ('owner','admin'),false) then raise exception 'Workspace administration required'; end if;
 perform 1 from public.onboarding_services where workspace_id=p_workspace_id and id=p_service_id for update;
 if not found then raise exception 'Service not found'; end if;
 if exists(select 1 from unnest(coalesce(p_user_ids,'{}'::uuid[])) u where not exists(select 1 from public.workspace_memberships where workspace_id=p_workspace_id and user_id=u)) then raise exception 'Choose current workspace members'; end if;
 delete from public.workspace_member_service_access where workspace_id=p_workspace_id and service_id=p_service_id;
 insert into public.workspace_member_service_access(workspace_id,user_id,service_id,granted_by)
 select p_workspace_id,u,p_service_id,p_actor_user_id from (select distinct unnest(coalesce(p_user_ids,'{}'::uuid[])) u) x;
end $$;

create or replace function public.workspace_user_has_capability(p_workspace_id uuid,p_capability text,p_user_id uuid default auth.uid()) returns boolean
language sql stable security definer set search_path=public as $$
 select case when public.workspace_role_for_user(p_workspace_id,p_user_id) is null then false
 when public.workspace_role_for_user(p_workspace_id,p_user_id) in ('owner','admin') then true
 when p_capability='communications.manage' then true -- team chat for every member; individual conversations remain scoped
 else exists(select 1 from public.workspace_operational_roles o join public.workspace_operational_permissions p on p.workspace_id=o.workspace_id
 where o.workspace_id=p_workspace_id and o.user_id=p_user_id and p.capability=p_capability and ((p.position='seller' and (o.can_sell or exists(select 1 from public.relationships r where r.workspace_id=p_workspace_id and r.seller_user_id=p_user_id))) or (p.position='manager' and (o.can_manage or exists(select 1 from public.relationships r where r.workspace_id=p_workspace_id and r.fulfilment_manager_user_id=p_user_id)))))
 or exists(select 1 from public.workspace_service_capabilities c where c.workspace_id=p_workspace_id and c.capability=p_capability and (
 exists(select 1 from public.workspace_member_service_access a where a.workspace_id=p_workspace_id and a.service_id=c.service_id and a.user_id=p_user_id)
 or exists(select 1 from public.relationship_services s where s.workspace_id=p_workspace_id and s.service_id=c.service_id and s.assignee_user_id=p_user_id))) end
$$;
create or replace function public.workspace_user_can_access_relationship(p_workspace_id uuid,p_relationship_id uuid,p_user_id uuid default auth.uid()) returns boolean
language sql stable security definer set search_path=public as $$
 select exists(select 1 from public.relationships r join public.workspace_memberships m on m.workspace_id=r.workspace_id and m.user_id=p_user_id
 where r.workspace_id=p_workspace_id and r.id=p_relationship_id and (m.role in ('owner','admin')
 or r.seller_user_id=p_user_id or r.fulfilment_manager_user_id=p_user_id
 or (r.pos_started_at is null and r.team_locked_at is null and public.workspace_user_can_sell(p_workspace_id,p_user_id))
 or exists(select 1 from public.relationship_services s where s.workspace_id=p_workspace_id and s.relationship_id=r.id and s.assignee_user_id=p_user_id)))
$$;
create or replace function public.workspace_user_fully_covers_relationship(p_workspace_id uuid,p_relationship_id uuid,p_user_id uuid default auth.uid()) returns boolean
language sql stable security definer set search_path=public as $$
 select exists(select 1 from public.relationships r join public.workspace_memberships m on m.workspace_id=r.workspace_id and m.user_id=p_user_id
 where r.workspace_id=p_workspace_id and r.id=p_relationship_id and (m.role in ('owner','admin') or r.seller_user_id=p_user_id or r.fulfilment_manager_user_id=p_user_id
 or (exists(select 1 from public.relationship_services s where s.workspace_id=r.workspace_id and s.relationship_id=r.id) and not exists(
 select 1 from public.relationship_services s where s.workspace_id=r.workspace_id and s.relationship_id=r.id and s.assignee_user_id is distinct from p_user_id))))
$$;
create or replace function public.workspace_user_can_access_session_module(p_workspace_id uuid,p_session_module_id uuid,p_user_id uuid default auth.uid()) returns boolean
language sql stable security definer set search_path=public as $$
 select exists(select 1 from public.relationship_onboarding_session_modules m
 join public.relationship_onboarding_sessions s on s.workspace_id=m.workspace_id and s.id=m.session_id
 join public.relationships r on r.workspace_id=s.workspace_id and r.id=s.relationship_id
 join public.workspace_memberships u on u.workspace_id=r.workspace_id and u.user_id=p_user_id
 left join public.onboarding_service_revisions v on v.workspace_id=m.workspace_id and v.id=m.source_service_revision_id
 where m.workspace_id=p_workspace_id and m.id=p_session_module_id and
 (u.role in ('owner','admin') or r.seller_user_id=p_user_id or r.fulfilment_manager_user_id=p_user_id or exists(
 select 1 from public.relationship_services a where a.workspace_id=r.workspace_id and a.relationship_id=r.id and a.assignee_user_id=p_user_id and (m.source_kind='mandatory' or a.service_id=v.service_id))))
$$;

create or replace function public.workspace_user_can_access_work_item(p_workspace_id uuid,p_work_item_id uuid,p_user_id uuid default auth.uid()) returns boolean
language sql stable security definer set search_path=public as $$
 select exists(select 1 from public.work_items i join public.workspace_memberships m on m.workspace_id=i.workspace_id and m.user_id=p_user_id
 where i.workspace_id=p_workspace_id and i.id=p_work_item_id and (m.role in ('owner','admin') or (i.visibility='workspace' and i.area <> 'admin' and exists(
 select 1 from public.work_item_relationships l join public.relationships r on r.id=l.relationship_id and r.workspace_id=l.workspace_id
 where l.workspace_id=p_workspace_id and l.work_item_id=i.id and (
 r.fulfilment_manager_user_id=p_user_id or r.seller_user_id=p_user_id
 or exists(select 1 from public.relationship_services s where s.workspace_id=p_workspace_id and s.relationship_id=r.id and s.assignee_user_id=p_user_id
 and (s.service_id=i.service_id or (i.service_id is null and i.native_kind='onboarding_step' and case when coalesce(i.metadata->>'session_step_id','') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then public.workspace_user_can_access_session_step(p_workspace_id,(i.metadata->>'session_step_id')::uuid,p_user_id) else false end)))
 or (i.service_id is null and public.workspace_user_fully_covers_relationship(p_workspace_id,r.id,p_user_id)))))))
$$;

create function public.workspace_delivery_access_scope(p_workspace_id uuid,p_user_id uuid) returns jsonb
language sql stable security definer set search_path=public as $$
 select jsonb_build_object(
 'relationships',coalesce((select jsonb_agg(id) from public.relationships where workspace_id=p_workspace_id and public.workspace_user_can_access_relationship(p_workspace_id,id,p_user_id)),'[]'::jsonb),
 'full_relationships',coalesce((select jsonb_agg(id) from public.relationships where workspace_id=p_workspace_id and public.workspace_user_fully_covers_relationship(p_workspace_id,id,p_user_id)),'[]'::jsonb),
 'work_items',coalesce((select jsonb_agg(id) from public.work_items where workspace_id=p_workspace_id and public.workspace_user_can_access_work_item(p_workspace_id,id,p_user_id)),'[]'::jsonb))
$$;

create index relationship_delivery_assignee_idx on public.relationship_services(workspace_id,assignee_user_id,relationship_id) where assignee_user_id is not null;
create index relationship_delivery_seller_idx on public.relationships(workspace_id,seller_user_id) where seller_user_id is not null;
create index relationship_delivery_manager_idx on public.relationships(workspace_id,fulfilment_manager_user_id) where fulfilment_manager_user_id is not null;
drop policy if exists "service scoped staff relationship services" on public.relationship_services;
create policy "client allocated relationship services" on public.relationship_services as restrictive for select to authenticated
using(public.workspace_user_can_access_relationship(workspace_id,relationship_id) and (public.workspace_user_fully_covers_relationship(workspace_id,relationship_id) or assignee_user_id=auth.uid()));

-- Deny direct-table access as well as decrypted reads for nonparticipants,
-- including workspace administrators who are not on this client conversation.
drop policy if exists "staff cannot access client messages" on public.client_messages;
drop policy if exists "staff cannot access communication cursors" on public.communication_read_cursors;
drop policy if exists "staff cannot access communication reactions" on public.communication_reactions;
drop policy if exists "staff cannot access communication deliveries" on public.communication_message_deliveries;
create policy "client conversation participants only" on public.client_messages as restrictive for all to authenticated using(public.client_conversation_can_access(workspace_id,relationship_id)) with check(public.client_conversation_can_access(workspace_id,relationship_id));
create policy "client cursor participants only" on public.communication_read_cursors as restrictive for all to authenticated using(public.client_conversation_can_access(workspace_id,relationship_id)) with check(public.client_conversation_can_access(workspace_id,relationship_id));
create policy "client reaction participants only" on public.communication_reactions as restrictive for all to authenticated using(public.client_conversation_can_access(workspace_id,relationship_id)) with check(public.client_conversation_can_access(workspace_id,relationship_id));
create policy "client delivery participants only" on public.communication_message_deliveries as restrictive for all to authenticated using(public.client_conversation_can_access(workspace_id,relationship_id)) with check(public.client_conversation_can_access(workspace_id,relationship_id));
drop policy if exists "staff cannot access communication stickers" on public.communication_stickers;
drop policy if exists "staff cannot access native conversation participants" on public.workspace_native_conversation_participants;
drop policy if exists "staff cannot access native conversations" on public.workspace_native_conversations;
drop policy if exists "staff cannot access native messages" on public.workspace_native_messages;
drop policy if exists "staff cannot access native reactions" on public.workspace_native_reactions;
drop policy if exists "staff cannot access native read cursors" on public.workspace_native_read_cursors;

create or replace function public.can_access_communications_realtime(p_topic text) returns boolean
language sql stable security definer set search_path='' as $$
 select p_topic ~ '^communications:[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$' and public.current_session_is_aal2() and exists(
 select 1 from public.workspaces w join public.workspace_memberships m on m.workspace_id=w.id
 where w.slug=split_part(p_topic,':',2) and m.user_id=auth.uid() and w.status='active')
$$;

-- There are no authenticated write policies on team members; avoid a trigger
-- here because sale creation and workspace membership cleanup are security-definer.

create function public.stamp_client_sale_seller() returns trigger
language plpgsql security definer set search_path=public as $$
begin
 if tg_op='UPDATE' and old.seller_user_id is not null and new.seller_user_id is distinct from old.seller_user_id then raise exception 'Sale seller attribution is immutable'; end if;
 if new.snapshot_frozen_at is not null and (tg_op='INSERT' or old.snapshot_frozen_at is null) then
 perform public.validate_relationship_delivery_team(new.workspace_id,new.relationship_id);
 update public.relationships set team_locked_at=coalesce(team_locked_at,now()) where workspace_id=new.workspace_id and id=new.relationship_id;
 perform public.create_relationship_delivery_team(new.workspace_id,new.relationship_id);
 end if;
 if new.seller_user_id is null then select seller_user_id into new.seller_user_id from public.relationships where workspace_id=new.workspace_id and id=new.relationship_id; end if;
 return new;
end $$;
create trigger stamp_client_sale_seller before insert or update on public.client_sales for each row execute function public.stamp_client_sale_seller();

-- Reject membership removal with active delivery responsibility until an explicit
-- handover is implemented, instead of silently stranding a sold client's team.
create function public.guard_client_team_offboarding() returns trigger
language plpgsql security definer set search_path=public as $$
begin
 if exists(select 1 from public.workspaces where id=old.workspace_id) and exists(
 select 1 from public.relationships r where r.workspace_id=old.workspace_id and r.team_locked_at is not null and r.status <> 'archived' and r.lifecycle_phase <> 'completed_lost'
 and (r.fulfilment_manager_user_id=old.user_id or exists(select 1 from public.relationship_services s where s.workspace_id=r.workspace_id and s.relationship_id=r.id and s.assignee_user_id=old.user_id))) then
 raise exception 'This member is assigned to an active client team. Client-team handover must be completed before removal'; end if;
 return old;
end $$;
create trigger guard_client_team_offboarding before delete on public.workspace_memberships for each row execute function public.guard_client_team_offboarding();

create or replace function public.communication_client_messages(
    p_workspace_id uuid,
    p_relationship_id uuid default null,
    p_limit integer default 2000
)
returns table (
    id uuid,
    client_request_id uuid,
    relationship_id uuid,
    body text,
    direction text,
    provider text,
    provider_message_id text,
    whatsapp_message_id text,
    reply_to_whatsapp_message_id text,
    reply_to_message_id uuid,
    status text,
    error text,
    sender_kind text,
    sender_user_id uuid,
    automation_kind text,
    automation_label text,
    created_at timestamptz,
    sent_at timestamptz,
    delivered_at timestamptz,
    read_at timestamptz,
    failed_at timestamptz,
    raw_payload jsonb
)
language sql
stable
security definer
set search_path = ''
as $$
    with decoded as materialized (
        select
            message.*,
            communications_secure.try_decrypt_text(message.body_ciphertext, decrypted.secret) as decrypted_body,
            communications_secure.try_decrypt_jsonb(message.raw_payload_ciphertext, decrypted.secret) as decrypted_raw_payload
        from public.client_messages message
        left join communications_secure.content_keys content_key on content_key.id = message.body_key_id
        left join vault.decrypted_secrets decrypted on decrypted.id = content_key.vault_secret_id
        where auth.role() = 'authenticated'
          and auth.uid() is not null
          and public.current_session_is_aal2()
          and public.client_conversation_can_access(p_workspace_id, message.relationship_id, auth.uid())
          and message.workspace_id = p_workspace_id
          and (p_relationship_id is null or message.relationship_id = p_relationship_id)
    )
    select
        message.id,
        message.client_request_id,
        message.relationship_id,
        case when message.body_ciphertext is null then message.body else message.decrypted_body end,
        message.direction,
        message.provider,
        message.provider_message_id,
        message.whatsapp_message_id,
        message.reply_to_whatsapp_message_id,
        message.reply_to_message_id,
        message.status,
        message.error,
        message.sender_kind,
        message.sender_user_id,
        message.automation_kind,
        message.automation_label,
        message.created_at,
        message.sent_at,
        message.delivered_at,
        message.read_at,
        message.failed_at,
        case when message.raw_payload_ciphertext is null then message.raw_payload else message.decrypted_raw_payload end
    from decoded message
    where (message.body_ciphertext is null or message.decrypted_body is not null)
      and (message.raw_payload_ciphertext is null or message.decrypted_raw_payload is not null)
    order by message.created_at desc
    limit least(greatest(coalesce(p_limit, 2000), 1), 4000);
$$;

create or replace function public.communication_client_message(
    p_workspace_id uuid,
    p_message_id uuid
)
returns table (
    id uuid,
    client_request_id uuid,
    relationship_id uuid,
    body text,
    direction text,
    provider text,
    provider_message_id text,
    whatsapp_message_id text,
    reply_to_whatsapp_message_id text,
    reply_to_message_id uuid,
    status text,
    error text,
    sender_kind text,
    sender_user_id uuid,
    automation_kind text,
    automation_label text,
    created_at timestamptz,
    sent_at timestamptz,
    delivered_at timestamptz,
    read_at timestamptz,
    failed_at timestamptz,
    raw_payload jsonb
)
language sql
stable
security definer
set search_path = ''
as $$
    with decoded as materialized (
        select
            message.*,
            communications_secure.try_decrypt_text(message.body_ciphertext, decrypted.secret) as decrypted_body,
            communications_secure.try_decrypt_jsonb(message.raw_payload_ciphertext, decrypted.secret) as decrypted_raw_payload
        from public.client_messages message
        left join communications_secure.content_keys content_key on content_key.id = message.body_key_id
        left join vault.decrypted_secrets decrypted on decrypted.id = content_key.vault_secret_id
        where auth.role() = 'authenticated'
          and auth.uid() is not null
          and public.current_session_is_aal2()
          and public.client_conversation_can_access(p_workspace_id, message.relationship_id, auth.uid())
          and message.workspace_id = p_workspace_id
          and message.id = p_message_id
    )
    select
        message.id,
        message.client_request_id,
        message.relationship_id,
        case when message.body_ciphertext is null then message.body else message.decrypted_body end,
        message.direction,
        message.provider,
        message.provider_message_id,
        message.whatsapp_message_id,
        message.reply_to_whatsapp_message_id,
        message.reply_to_message_id,
        message.status,
        message.error,
        message.sender_kind,
        message.sender_user_id,
        message.automation_kind,
        message.automation_label,
        message.created_at,
        message.sent_at,
        message.delivered_at,
        message.read_at,
        message.failed_at,
        case when message.raw_payload_ciphertext is null then message.raw_payload else message.decrypted_raw_payload end
    from decoded message
    where (message.body_ciphertext is null or message.decrypted_body is not null)
      and (message.raw_payload_ciphertext is null or message.decrypted_raw_payload is not null);
$$;

create or replace function public.communication_create_file_key(
    p_workspace_id uuid,
    p_scope_kind text,
    p_scope_id uuid,
    p_storage_path text
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
    generated_secret text;
    generated_vault_id uuid;
    stored_secret text;
begin
    if auth.role() <> 'authenticated' or auth.uid() is null or not public.current_session_is_aal2() then
        raise exception 'aal2_required';
    end if;
    if p_scope_kind = 'client' then
        if not public.client_conversation_can_access(p_workspace_id,p_scope_id,auth.uid()) or not exists (
            select 1 from public.relationships where workspace_id = p_workspace_id and id = p_scope_id
        ) then raise exception 'file_scope_forbidden'; end if;
    elsif p_scope_kind = 'native' then
        if not public.native_conversation_can_write(p_scope_id, auth.uid()) or not exists (
            select 1 from public.workspace_native_conversations where workspace_id = p_workspace_id and id = p_scope_id
        ) then raise exception 'file_scope_forbidden'; end if;
    else
        raise exception 'invalid_file_scope';
    end if;
    if p_storage_path = '' or p_storage_path not like p_workspace_id::text || '/%' then
        raise exception 'invalid_storage_path';
    end if;
    if exists (select 1 from communications_secure.encrypted_files where storage_path = p_storage_path) then
        raise exception 'file_key_already_exists';
    end if;

    generated_secret := pg_catalog.encode(extensions.gen_random_bytes(32), 'base64');
    select vault.create_secret(
        generated_secret,
        'communication-file-' || extensions.gen_random_uuid()::text,
        'Betelgeze encrypted Communications file key'
    ) into generated_vault_id;

    select decrypted.secret into stored_secret
    from vault.decrypted_secrets decrypted
    where decrypted.id = generated_vault_id;
    if stored_secret is null then
        raise exception 'communication_vault_key_roundtrip_failed';
    end if;

    insert into communications_secure.encrypted_files(storage_path, workspace_id, scope_kind, scope_id, vault_secret_id, created_by)
    values (p_storage_path, p_workspace_id, p_scope_kind, p_scope_id, generated_vault_id, auth.uid());
    return stored_secret;
end;
$$;

create or replace function public.communication_file_key_for_user(p_storage_path text)
returns text
language sql
stable
security definer
set search_path = ''
as $$
    select decrypted.secret
    from communications_secure.encrypted_files encrypted_file
    join vault.decrypted_secrets decrypted on decrypted.id = encrypted_file.vault_secret_id
    where encrypted_file.storage_path = p_storage_path
      and auth.role() = 'authenticated'
      and auth.uid() is not null
      and public.current_session_is_aal2()
      and (
          (encrypted_file.scope_kind = 'client' and public.client_conversation_can_access(encrypted_file.workspace_id,encrypted_file.scope_id,auth.uid()))
          or
          (encrypted_file.scope_kind = 'native' and public.native_conversation_can_read(encrypted_file.scope_id, auth.uid()))
      );
$$;

create or replace function public.rotate_workspace_invitation(
    p_invitation_id uuid,
    p_workspace_id uuid,
    p_email text,
    p_role text,
    p_invited_by uuid,
    p_expires_at timestamptz,
    p_token_hash text,
    p_service_ids uuid[]
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_invitation_id uuid;
    v_attempt_count integer;
    v_service_ids uuid[] := coalesce(p_service_ids, '{}'::uuid[]);
begin
    if p_invitation_id is null or p_workspace_id is null or p_invited_by is null
       or p_role not in ('admin', 'staff')
       or p_email is null or position('@' in p_email) <= 1
       or p_expires_at <= now()
       or p_token_hash !~ '^[a-f0-9]{64}$' then
        raise exception 'INVALID_INVITATION_ROTATION' using errcode = 'P0001';
    end if;
    if exists (
        select 1 from unnest(v_service_ids) requested(service_id)
        left join public.onboarding_services service
          on service.id = requested.service_id and service.workspace_id = p_workspace_id
        where service.id is null or service.state <> 'active'
    ) then
        raise exception 'INVALID_STAFF_SERVICE_ACCESS' using errcode = 'P0001';
    end if;

    insert into public.workspace_invitations as existing_invitation (
        id, workspace_id, email, role, invited_by, expires_at,
        accepted_at, accepted_by, revoked_at, token_hash, token_exchanged_at,
        delivery_status, provider_message_id, delivery_attempt_count,
        sent_at, delivered_at, delivery_failed_at, delivery_failure_code
    ) values (
        p_invitation_id, p_workspace_id, lower(p_email), p_role, p_invited_by, p_expires_at,
        null, null, null, p_token_hash, null,
        'queued', null, 1,
        null, null, null, null
    )
    on conflict (workspace_id, email) do update
    set role = excluded.role,
        invited_by = excluded.invited_by,
        expires_at = excluded.expires_at,
        accepted_at = null,
        accepted_by = null,
        revoked_at = null,
        token_hash = excluded.token_hash,
        token_exchanged_at = null,
        delivery_status = 'queued',
        provider_message_id = null,
        delivery_attempt_count = existing_invitation.delivery_attempt_count + 1,
        sent_at = null,
        delivered_at = null,
        delivery_failed_at = null,
        delivery_failure_code = null
    returning id, delivery_attempt_count into v_invitation_id, v_attempt_count;

    delete from public.workspace_invitation_service_access where invitation_id = v_invitation_id;
    if p_role = 'staff' then
        insert into public.workspace_invitation_service_access (invitation_id, workspace_id, service_id)
        select v_invitation_id, p_workspace_id, requested.service_id
        from (select distinct unnest(v_service_ids) as service_id) requested;
    end if;

    delete from public.account_onboarding_sessions where invitation_id = v_invitation_id;
    return jsonb_build_object('invitation_id', v_invitation_id, 'delivery_attempt_count', v_attempt_count);
end;
$$;

create or replace function public.set_workspace_member_service_access(
    p_workspace_id uuid,
    p_actor_user_id uuid,
    p_target_user_id uuid,
    p_role text,
    p_service_ids uuid[]
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_actor_role text;
    v_target_role text;
    v_service_ids uuid[] := coalesce(p_service_ids, '{}'::uuid[]);
begin
    select role into v_actor_role from public.workspace_memberships
    where workspace_id = p_workspace_id and user_id = p_actor_user_id;
    select role into v_target_role from public.workspace_memberships
    where workspace_id = p_workspace_id and user_id = p_target_user_id for update;
    if v_actor_role is null or v_actor_role not in ('owner', 'admin') or v_target_role is null or v_target_role = 'owner' then
        raise exception 'WORKSPACE_ACCESS_CHANGE_FORBIDDEN' using errcode = 'P0001';
    end if;
    if p_role not in ('admin', 'staff') then
        raise exception 'INVALID_WORKSPACE_ROLE' using errcode = 'P0001';
    end if;
    if v_actor_role <> 'owner' and (v_target_role <> 'staff' or p_role <> 'staff') then
        raise exception 'OWNER_REQUIRED_FOR_ROLE_CHANGE' using errcode = 'P0001';
    end if;
    if exists (
        select 1 from unnest(v_service_ids) requested(service_id)
        left join public.onboarding_services service
          on service.id = requested.service_id and service.workspace_id = p_workspace_id
        where service.id is null
    ) then
        raise exception 'INVALID_STAFF_SERVICE_ACCESS' using errcode = 'P0001';
    end if;

    update public.workspace_memberships set role = p_role
    where workspace_id = p_workspace_id and user_id = p_target_user_id;
    delete from public.workspace_member_service_access
    where workspace_id = p_workspace_id and user_id = p_target_user_id;
    insert into public.workspace_member_service_access (workspace_id, user_id, service_id, granted_by)
    select p_workspace_id, p_target_user_id, requested.service_id, p_actor_user_id
    from (select distinct unnest(v_service_ids) as service_id) requested;
    return jsonb_build_object('user_id', p_target_user_id, 'role', p_role, 'service_count', cardinality(v_service_ids));
end;
$$;

revoke all on function public.workspace_user_can_sell(uuid,uuid) from public,anon;
grant execute on function public.workspace_user_can_sell(uuid,uuid) to authenticated,service_role;

revoke all on function public.client_conversation_can_access(uuid,uuid,uuid) from public,anon;
grant execute on function public.client_conversation_can_access(uuid,uuid,uuid) to authenticated,service_role;

revoke all on function public.begin_relationship_pos(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.begin_relationship_pos(uuid,uuid,uuid) to service_role;

revoke all on function public.validate_relationship_delivery_team(uuid,uuid) from public,anon,authenticated;
grant execute on function public.validate_relationship_delivery_team(uuid,uuid) to service_role;

revoke all on function public.create_relationship_delivery_team(uuid,uuid) from public,anon,authenticated;
grant execute on function public.create_relationship_delivery_team(uuid,uuid) to service_role;

revoke all on function public.set_client_chat_members(uuid,uuid,uuid,uuid[]) from public,anon,authenticated;
grant execute on function public.set_client_chat_members(uuid,uuid,uuid,uuid[]) to service_role;

revoke all on function public.save_workspace_operations(uuid,uuid,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.save_workspace_operations(uuid,uuid,jsonb,jsonb) to service_role;

revoke all on function public.set_service_delivery_users(uuid,uuid,uuid,uuid[]) from public,anon,authenticated;
grant execute on function public.set_service_delivery_users(uuid,uuid,uuid,uuid[]) to service_role;

revoke all on function public.workspace_delivery_access_scope(uuid,uuid) from public,anon,authenticated;
grant execute on function public.workspace_delivery_access_scope(uuid,uuid) to service_role;

create function public.save_onboarding_service_with_delivery(p_workspace_id uuid,p_actor_user_id uuid,p_service_id uuid,p_definition jsonb,p_user_ids uuid[],p_template_id text default null,p_connection_provider text default null) returns jsonb
language plpgsql security invoker set search_path=public as $$
declare result jsonb; service_id uuid;
begin
 if not coalesce(public.workspace_role_for_user(p_workspace_id,p_actor_user_id) in ('owner','admin'),false) then raise exception 'Workspace administration required'; end if;
 if p_connection_provider is not null and p_service_id is null then
 result=public.install_onboarding_service_template(p_workspace_id,p_actor_user_id,p_service_id,p_definition,p_template_id,p_connection_provider);
 else result=public.save_onboarding_service_revision(p_workspace_id,p_actor_user_id,p_service_id,p_definition); end if;
 service_id=(result->>'service_id')::uuid;
 if service_id is null then raise exception 'The saved service has no identity'; end if;
 perform public.set_service_delivery_users(p_workspace_id,p_actor_user_id,service_id,p_user_ids);
 return result;
end $$;
revoke all on function public.save_onboarding_service_with_delivery(uuid,uuid,uuid,jsonb,uuid[],text,text) from public,anon,authenticated;
grant execute on function public.save_onboarding_service_with_delivery(uuid,uuid,uuid,jsonb,uuid[],text,text) to service_role;

create function public.initialize_workspace_operations() returns trigger
language plpgsql security definer set search_path=public as $$
begin
 insert into public.workspace_operational_roles(workspace_id,user_id,can_sell,can_manage)
 values(new.workspace_id,new.user_id,new.role='owner',new.role='owner') on conflict do nothing;
 insert into public.workspace_operational_permissions
 select new.workspace_id,p.position,p.capability from (values ('seller','relationships.view'),('seller','communications.manage'),('manager','relationships.view'),('manager','communications.manage'),('manager','onboarding.manage'),('manager','fulfilment.manage')) p(position,capability)
 where not exists(select 1 from public.workspace_operational_permissions where workspace_id=new.workspace_id) on conflict do nothing;
 return new;
end $$;
create trigger initialize_workspace_operations after insert on public.workspace_memberships for each row execute function public.initialize_workspace_operations();

create or replace function public.save_relationship_dual_pricing_configuration(
    p_workspace_id uuid,
    p_actor_user_id uuid,
    p_relationship_id uuid,
    p_details jsonb,
    p_services jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
    v_relationship public.relationships%rowtype;
    v_service jsonb;
    v_service_identity public.onboarding_services%rowtype;
    v_service_revision public.onboarding_service_revisions%rowtype;
    v_existing_services jsonb;
    v_requested_services jsonb;
    v_commercial_changed boolean;
    v_locked_sale_id uuid;
    v_seller_id uuid;
    v_manager_id uuid;
    v_timeframe integer;
    v_upfront integer;
    v_recurring integer;
begin
    if current_user <> 'service_role' then
        raise exception using errcode = '42501', message = 'Relationship commercial details may only be changed by trusted server actions';
    end if;
    if not exists (
        select 1 from public.workspace_memberships
        where workspace_id = p_workspace_id and user_id = p_actor_user_id
    ) then
        raise exception using errcode = '42501', message = 'Actor does not belong to this workspace';
    end if;
    if jsonb_typeof(coalesce(p_details, '{}'::jsonb)) <> 'object'
       or jsonb_typeof(coalesce(p_services, '[]'::jsonb)) <> 'array' then
        raise exception using errcode = '22023', message = 'Commercial details must contain an object and a service array';
    end if;

    select * into v_relationship from public.relationships
    where workspace_id = p_workspace_id and id = p_relationship_id
    for update;
    if v_relationship.id is null then
        raise exception using errcode = 'P0001', message = 'Relationship not found';
    end if;
    if not public.workspace_user_can_sell(p_workspace_id,p_actor_user_id) or
       (v_relationship.pos_started_at is not null and v_relationship.seller_user_id is distinct from p_actor_user_id) then
        raise exception 'Only this client''s seller can change the POS';
    end if;
    if v_relationship.team_locked_at is null then
        if nullif(p_details->>'fulfilment_manager_user_id','') is not null and not exists (
            select 1 from public.workspace_operational_roles where workspace_id=p_workspace_id and user_id=(p_details->>'fulfilment_manager_user_id')::uuid and can_manage
        ) then raise exception 'Choose an eligible fulfilment manager'; end if;
        if exists(select 1 from jsonb_array_elements(p_services) e where nullif(e->>'assignee_user_id','') is not null and not exists(
            select 1 from public.workspace_member_service_access a where a.workspace_id=p_workspace_id and a.service_id=(e->>'service_id')::uuid and a.user_id=(e->>'assignee_user_id')::uuid
        )) then raise exception 'Choose an eligible fulfilment person for each service'; end if;
    end if;
    if exists (
        select 1 from jsonb_array_elements(coalesce(p_services, '[]'::jsonb)) entry
        group by entry->>'service_key'
        having count(*) > 1 or nullif(entry->>'service_key', '') is null
    ) then
        raise exception using errcode = '22023', message = 'Relationship services must have unique service keys';
    end if;

    select coalesce(jsonb_agg(jsonb_build_object(
        'service_key', selected.service_key,
        'service_id', selected.service_id,
        'service_revision_id', selected.service_revision_id,
        'upfront_price_cents', selected.upfront_price_cents,
        'recurring_price_cents', selected.recurring_price_cents,
        'currency', upper(selected.currency),
        'assignee_user_id', selected.assignee_user_id
    ) order by selected.service_key), '[]'::jsonb)
    into v_existing_services
    from public.relationship_services selected
    where selected.workspace_id = p_workspace_id
      and selected.relationship_id = p_relationship_id;

    select coalesce(jsonb_agg(jsonb_build_object(
        'service_key', entry->>'service_key',
        'service_id', nullif(entry->>'service_id', '')::uuid,
        'service_revision_id', nullif(entry->>'service_revision_id', '')::uuid,
        'upfront_price_cents', coalesce((entry->>'upfront_price_cents')::integer, 0),
        'recurring_price_cents', coalesce((entry->>'recurring_price_cents')::integer, 0),
        'currency', upper(coalesce(nullif(entry->>'currency', ''), 'USD')),
        'assignee_user_id', nullif(entry->>'assignee_user_id', '')::uuid
    ) order by entry->>'service_key'), '[]'::jsonb)
    into v_requested_services
    from jsonb_array_elements(coalesce(p_services, '[]'::jsonb)) entry;
    v_commercial_changed := v_existing_services is distinct from v_requested_services;

    select sale.id into v_locked_sale_id
    from public.client_sales sale
    where sale.workspace_id = p_workspace_id
      and sale.relationship_id = p_relationship_id
      and sale.deleted_at is null
      and sale.snapshot_frozen_at is not null
      and sale.status <> 'draft'
    order by sale.created_at desc limit 1
    for update;
    if v_locked_sale_id is not null and v_commercial_changed then
        raise exception using errcode = 'P0001', message = 'This sale is already frozen. Create a replacement sale before changing services or negotiated prices';
    end if;

    v_seller_id := nullif(p_details->>'seller_user_id', '')::uuid;
    v_manager_id := nullif(p_details->>'fulfilment_manager_user_id', '')::uuid;
    v_timeframe := case
        when coalesce(p_details->>'project_timeframe_days', '') ~ '^[0-9]+$'
        then greatest(1, least((p_details->>'project_timeframe_days')::integer, 36500))
        else null
    end;
    if v_seller_id is not null and not exists (
        select 1 from public.workspace_memberships
        where workspace_id = p_workspace_id and user_id = v_seller_id
    ) then raise exception using errcode = '22023', message = 'Seller must belong to this workspace'; end if;
    if v_manager_id is not null and not exists (
        select 1 from public.workspace_memberships
        where workspace_id = p_workspace_id and user_id = v_manager_id
    ) then raise exception using errcode = '22023', message = 'Fulfilment manager must belong to this workspace'; end if;

    for v_service in select value from jsonb_array_elements(coalesce(p_services, '[]'::jsonb)) loop
        if coalesce(v_service->>'upfront_price_cents', '') !~ '^[0-9]+$'
           or coalesce(v_service->>'recurring_price_cents', '') !~ '^[0-9]+$'
           or upper(coalesce(v_service->>'currency', '')) !~ '^[A-Z]{3}$'
           or nullif(v_service->>'service_id', '') is null
           or nullif(v_service->>'service_revision_id', '') is null then
            raise exception using errcode = '22023', message = 'Every relationship service needs a version, non-negative prices, and three-letter currency';
        end if;
        v_upfront := (v_service->>'upfront_price_cents')::integer;
        v_recurring := (v_service->>'recurring_price_cents')::integer;
        -- POS persists its relationship/team steps before prices are negotiated.
        -- Final sale preflight requires a positive upfront or recurring component.
        select * into v_service_identity from public.onboarding_services
        where workspace_id = p_workspace_id
          and id = (v_service->>'service_id')::uuid
          and internal_code = v_service->>'service_key';
        select * into v_service_revision from public.onboarding_service_revisions
        where workspace_id = p_workspace_id
          and id = (v_service->>'service_revision_id')::uuid
          and service_id = v_service_identity.id;
        if v_service_identity.id is null or v_service_revision.id is null then
            raise exception using errcode = '22023', message = 'A selected service revision does not belong to this workspace';
        end if;
        if v_service_identity.state <> 'active' and not exists (
            select 1 from public.relationship_services existing
            where existing.workspace_id = p_workspace_id
              and existing.relationship_id = p_relationship_id
              and existing.service_id = v_service_identity.id
              and existing.service_revision_id = v_service_revision.id
        ) then
            raise exception using errcode = '22023', message = 'Only Active services can be newly assigned';
        end if;
        if nullif(v_service->>'assignee_user_id', '') is not null and not exists (
            select 1 from public.workspace_memberships
            where workspace_id = p_workspace_id
              and user_id = (v_service->>'assignee_user_id')::uuid
        ) then raise exception using errcode = '22023', message = 'Service assignee must belong to this workspace'; end if;
    end loop;

    update public.relationships
    set seller_user_id = v_seller_id,
        fulfilment_manager_user_id = v_manager_id,
        whatsapp_phone = nullif(trim(p_details->>'whatsapp_phone'), ''),
        project_timeframe_days = v_timeframe,
        primary_person_name = case when p_details ? 'primary_person_name' then p_details->>'primary_person_name' else primary_person_name end,
        business_name = case when p_details ? 'business_name' then nullif(trim(p_details->>'business_name'), '') else business_name end,
        primary_contact_role = case when p_details ? 'primary_contact_role' then nullif(trim(p_details->>'primary_contact_role'), '') else primary_contact_role end,
        primary_phone = case when p_details ? 'primary_phone' then nullif(trim(p_details->>'primary_phone'), '') else primary_phone end,
        primary_email = case when p_details ? 'primary_email' then nullif(trim(p_details->>'primary_email'), '') else primary_email end,
        notes_summary = case when p_details ? 'description' then nullif(trim(p_details->>'description'), '') else notes_summary end,
        updated_at = now()
    where workspace_id = p_workspace_id and id = p_relationship_id;

    if v_commercial_changed then
        delete from public.relationship_services
        where workspace_id = p_workspace_id and relationship_id = p_relationship_id;
        for v_service in select value from jsonb_array_elements(coalesce(p_services, '[]'::jsonb)) loop
            v_upfront := (v_service->>'upfront_price_cents')::integer;
            v_recurring := (v_service->>'recurring_price_cents')::integer;
            insert into public.relationship_services (
                workspace_id, relationship_id, service_key, price_cents,
                upfront_price_cents, recurring_price_cents, currency,
                assignee_user_id, service_id, service_revision_id
            ) values (
                p_workspace_id, p_relationship_id, v_service->>'service_key', v_upfront + v_recurring,
                v_upfront, v_recurring, upper(v_service->>'currency'),
                nullif(v_service->>'assignee_user_id', '')::uuid,
                (v_service->>'service_id')::uuid,
                (v_service->>'service_revision_id')::uuid
            );
        end loop;
    end if;

    perform public.record_workspace_admin_activity(
        p_workspace_id, 'services', 'services.relationship_assignments.changed',
        'Relationship commercial configuration saved',
        p_entity_type => 'relationship', p_entity_id => p_relationship_id::text,
        p_actor_user_id => p_actor_user_id, p_actor_kind => 'staff',
        p_correlation_id => gen_random_uuid(),
        p_idempotency_key => format(
            'services.relationship.dual_prices:%s:%s:%s',
            p_relationship_id, extract(epoch from clock_timestamp())::bigint, p_actor_user_id
        ),
        p_metadata => jsonb_build_object(
            'relationship_id', p_relationship_id,
            'service_count', jsonb_array_length(coalesce(p_services, '[]'::jsonb)),
            'commercial_changed', v_commercial_changed,
            'locked_sale_id', v_locked_sale_id
        )
    );
    return jsonb_build_object(
        'relationship_id', p_relationship_id,
        'service_count', jsonb_array_length(coalesce(p_services, '[]'::jsonb)),
        'commercial_changed', v_commercial_changed
    );
end;
$$;

create function public.save_workspace_maintenance_assignments(p_workspace_id uuid,p_actor_user_id uuid,p_assignments jsonb) returns void
language plpgsql security definer set search_path=public as $$
declare t uuid; categories text[] := array['services','leadgen','onboarding','billing','communications','integrations','system_health'];
begin
 if public.workspace_role_for_user(p_workspace_id,p_actor_user_id) is distinct from 'owner' then raise exception 'Only the workspace owner can edit Maintenance'; end if;
 select id into t from public.workspace_teams where workspace_id=p_workspace_id and kind='maintenance' for update;
 if t is null then raise exception 'Maintenance group not found'; end if;
 if exists(select 1 from unnest(categories) c where nullif(p_assignments->>c,'') is null)
 or exists(select 1 from jsonb_each_text(p_assignments) x where x.key <> all(categories) or not exists(select 1 from public.workspace_memberships m where m.workspace_id=p_workspace_id and m.user_id=x.value::uuid)) then raise exception 'Assign every maintenance category to a current workspace member'; end if;
 insert into public.workspace_team_members(workspace_id,team_id,user_id,added_by)
 select p_workspace_id,t,u,p_actor_user_id from (select distinct value::uuid u from jsonb_each_text(p_assignments) union select p_actor_user_id) x on conflict do nothing;
 insert into public.workspace_maintenance_routing(workspace_id,category,responsible_user_id,updated_by)
 select p_workspace_id,key,value::uuid,p_actor_user_id from jsonb_each_text(p_assignments)
 on conflict(workspace_id,category) do update set responsible_user_id=excluded.responsible_user_id,updated_by=excluded.updated_by,updated_at=now();
 delete from public.workspace_maintenance_routing where workspace_id=p_workspace_id and category='global';
 delete from public.workspace_team_members where workspace_id=p_workspace_id and team_id=t and user_id <> p_actor_user_id and user_id not in(select value::uuid from jsonb_each_text(p_assignments));
end $$;
revoke all on function public.save_workspace_maintenance_assignments(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.save_workspace_maintenance_assignments(uuid,uuid,jsonb) to service_role;

notify pgrst, 'reload schema';
commit;
