-- On-demand access from a client's Team roster. No membership backfill,
-- message writes, alert replay, indexes, or changes to the inbox read path.
begin;

create function public.read_team_client_chat_members(p_workspace_id uuid,p_team_id uuid,p_actor_user_id uuid)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare r public.relationships%rowtype; eligible uuid[]; members uuid[];
begin
 select relationship.* into r from public.workspace_teams t
 join public.relationships relationship on relationship.workspace_id=t.workspace_id and relationship.id=t.relationship_id
 where t.workspace_id=p_workspace_id and t.id=p_team_id and t.kind='relationship'
 and t.archived_at is null and relationship.status <> 'archived';
 if r.id is null or r.fulfilment_manager_user_id is distinct from p_actor_user_id
 or not exists(select 1 from public.workspace_memberships where workspace_id=p_workspace_id and user_id=p_actor_user_id)
 then raise exception 'Only this client’s assigned manager can add people to Client chat' using errcode='42501'; end if;

 select array(select tm.user_id from public.workspace_team_members tm
 join public.workspace_memberships m on m.workspace_id=tm.workspace_id and m.user_id=tm.user_id
 where tm.workspace_id=p_workspace_id and tm.team_id=p_team_id
 and tm.user_id is distinct from r.seller_user_id and tm.user_id is distinct from r.fulfilment_manager_user_id
 order by tm.user_id limit 201) into eligible;
 if cardinality(eligible)>200 then raise exception 'This team is too large for the participant editor'; end if;
 select array(select user_id from (
   select r.seller_user_id as user_id union select r.fulfilment_manager_user_id
   union select c.user_id from public.relationship_client_chat_members c where c.workspace_id=p_workspace_id and c.relationship_id=r.id
 ) participants where exists(select 1 from public.workspace_memberships m where m.workspace_id=p_workspace_id and m.user_id=participants.user_id)
 order by user_id) into members;
 return jsonb_build_object('relationshipId',r.id,'title',coalesce(nullif(r.business_name,''),r.primary_person_name),
   'memberIds',members,'eligibleIds',eligible);
end $$;

create function public.add_team_client_chat_members(p_workspace_id uuid,p_team_id uuid,p_actor_user_id uuid,p_user_ids uuid[])
returns jsonb language plpgsql security definer set search_path=public as $$
declare snapshot jsonb; added uuid[]; relationship uuid;
begin
 if p_user_ids is null or cardinality(p_user_ids)<1 or cardinality(p_user_ids)>200
 or array_position(p_user_ids,null) is not null then raise exception 'Choose between 1 and 200 team members' using errcode='22023'; end if;
 -- Share the existing relationship lock with the participant replacement owner.
 perform 1 from public.relationships r join public.workspace_teams t on t.workspace_id=r.workspace_id and t.relationship_id=r.id
 where t.workspace_id=p_workspace_id and t.id=p_team_id for update of r;
 snapshot:=public.read_team_client_chat_members(p_workspace_id,p_team_id,p_actor_user_id);
 relationship:=(snapshot->>'relationshipId')::uuid;
 if exists(select 1 from unnest(p_user_ids) u where not exists(
   select 1 from jsonb_array_elements_text(snapshot->'eligibleIds') e where e::uuid=u
 )) then raise exception 'Only current members of this client’s Team chat can be added' using errcode='42501'; end if;
 with inserted as (
   insert into public.relationship_client_chat_members(workspace_id,relationship_id,user_id,added_by)
   select p_workspace_id,relationship,u,p_actor_user_id from (select distinct unnest(p_user_ids) u) selected
   on conflict (relationship_id,user_id) do nothing returning user_id
 ) select coalesce(array_agg(user_id order by user_id),'{}'::uuid[]) into added from inserted;
 if cardinality(added)>0 then
   insert into public.relationship_team_events(workspace_id,relationship_id,actor_user_id,event_type,details)
   values(p_workspace_id,relationship,p_actor_user_id,'client_chat_members_added',jsonb_build_object('team_id',p_team_id,'user_ids',added));
 end if;
 -- Repeating an uncertain request is additive and does not duplicate audit rows.
 return public.read_team_client_chat_members(p_workspace_id,p_team_id,p_actor_user_id)
   || jsonb_build_object('addedUserIds',added);
end $$;

-- Preserve the existing Client chat editor and pre-Team service allocations.
-- Retained grants remain editable after a person's Team assignment changes.
-- Apply only the requested difference so existing attribution stays intact.
create or replace function public.set_client_chat_members(p_workspace_id uuid,p_relationship_id uuid,p_actor_user_id uuid,p_user_ids uuid[]) returns void
language plpgsql security definer set search_path=public as $$
declare r public.relationships%rowtype;
begin
 select * into r from public.relationships where workspace_id=p_workspace_id and id=p_relationship_id and status <> 'archived' for update;
 if r.id is null or r.fulfilment_manager_user_id is distinct from p_actor_user_id or not exists(select 1 from public.workspace_memberships where workspace_id=p_workspace_id and user_id=p_actor_user_id) then raise exception 'Only this client’s manager can change client-chat participation'; end if;
 -- Keep the existing service-assignee query as the ordinary path. PostgreSQL
 -- plans the broader membership query only for previously unsupported choices.
 if exists(select 1 from unnest(coalesce(p_user_ids,'{}'::uuid[])) u where not exists(
   select 1 from public.relationship_services s join public.workspace_memberships m on m.workspace_id=s.workspace_id and m.user_id=s.assignee_user_id
   where s.workspace_id=p_workspace_id and s.relationship_id=r.id and s.assignee_user_id=u
 )) then
   if exists(select 1 from unnest(coalesce(p_user_ids,'{}'::uuid[])) u where not exists(
     select 1 from public.workspace_memberships m where m.workspace_id=p_workspace_id and m.user_id=u and (
       exists(select 1 from public.relationship_services s where s.workspace_id=p_workspace_id and s.relationship_id=r.id and s.assignee_user_id=u)
       or exists(select 1 from public.workspace_teams t join public.workspace_team_members tm on tm.workspace_id=t.workspace_id and tm.team_id=t.id
         where t.workspace_id=p_workspace_id and t.relationship_id=r.id and t.kind='relationship' and t.archived_at is null and tm.user_id=u)
       or exists(select 1 from public.relationship_client_chat_members c where c.workspace_id=p_workspace_id and c.relationship_id=r.id and c.user_id=u)
     )
   )) then raise exception 'Only this client’s team members can join the client conversation'; end if;
 end if;
 delete from public.relationship_client_chat_members where workspace_id=p_workspace_id and relationship_id=r.id and not(user_id=any(coalesce(p_user_ids,'{}'::uuid[])));
 insert into public.relationship_client_chat_members(workspace_id,relationship_id,user_id,added_by)
 select p_workspace_id,r.id,u,p_actor_user_id from (select distinct unnest(coalesce(p_user_ids,'{}'::uuid[])) u) x
 on conflict (relationship_id,user_id) do nothing;
 insert into public.relationship_team_events(workspace_id,relationship_id,actor_user_id,event_type,details) values(p_workspace_id,r.id,p_actor_user_id,'client_chat_members_changed',jsonb_build_object('user_ids',p_user_ids));
end $$;

revoke all on function public.read_team_client_chat_members(uuid,uuid,uuid) from public,anon,authenticated;
revoke all on function public.add_team_client_chat_members(uuid,uuid,uuid,uuid[]) from public,anon,authenticated;
grant execute on function public.read_team_client_chat_members(uuid,uuid,uuid) to service_role;
grant execute on function public.add_team_client_chat_members(uuid,uuid,uuid,uuid[]) to service_role;
commit;
