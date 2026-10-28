begin;

-- A saved member row grants View. Existing grants retain their previous Edit
-- permission through a constant default; no membership or history is rewritten.
alter table public.relationship_client_chat_members add column can_edit boolean not null default true;

create function public.client_conversation_can_write(p_workspace_id uuid,p_relationship_id uuid,p_user_id uuid default auth.uid()) returns boolean
language sql stable security definer set search_path=public as $$
 select exists(select 1 from public.relationships r join public.workspace_memberships m on m.workspace_id=r.workspace_id and m.user_id=p_user_id
 where r.workspace_id=p_workspace_id and r.id=p_relationship_id and r.status <> 'archived'
 and (r.seller_user_id=p_user_id or r.fulfilment_manager_user_id=p_user_id or exists(
 select 1 from public.relationship_client_chat_members c where c.workspace_id=r.workspace_id and c.relationship_id=r.id and c.user_id=p_user_id and c.can_edit)))
$$;
revoke all on function public.client_conversation_can_write(uuid,uuid,uuid) from public,anon;
grant execute on function public.client_conversation_can_write(uuid,uuid,uuid) to authenticated,service_role;

-- Replace the existing roster request, rather than fetching again when its
-- dialog opens. One indexed grant scan supplies both optional permissions.
-- Existing clients keep using the unchanged legacy roster signature.
create function public.client_conversation_permission_rosters(p_workspace_id uuid,p_user_id uuid)
returns table(relationship_id uuid,manager_id uuid,member_ids uuid[],optional_ids uuid[],eligible_ids uuid[],view_only_ids uuid[])
language sql stable security definer set search_path=public as $$
 with visible as materialized (
   -- Identical read predicate, evaluated relationally within this workspace.
   select r.id,r.workspace_id,r.seller_user_id,r.fulfilment_manager_user_id from public.relationships r
   where r.workspace_id=p_workspace_id and r.status <> 'archived'
     and exists(select 1 from public.workspace_memberships m where m.workspace_id=p_workspace_id and m.user_id=p_user_id)
     and (r.seller_user_id=p_user_id or r.fulfilment_manager_user_id=p_user_id or exists(
       select 1 from public.relationship_client_chat_members c where c.workspace_id=r.workspace_id and c.relationship_id=r.id and c.user_id=p_user_id))
 ), team_rosters as (
   select r.id,coalesce(array_agg(m.user_id) filter(where m.user_id is not null),'{}'::uuid[]) ids
   from visible r
   join public.workspace_teams t on t.workspace_id=p_workspace_id and t.relationship_id=r.id and t.kind='relationship' and t.archived_at is null
   left join public.workspace_team_members tm on tm.workspace_id=p_workspace_id and tm.team_id=t.id
     and tm.user_id is distinct from r.seller_user_id and tm.user_id is distinct from r.fulfilment_manager_user_id
   left join public.workspace_memberships m on m.workspace_id=p_workspace_id and m.user_id=tm.user_id
   group by r.id
 )
 select r.id,r.fulfilment_manager_user_id,
   base.ids || grants.ids, grants.ids,
   coalesce(team.ids, array(
     select distinct s.assignee_user_id from public.relationship_services s
     join public.workspace_memberships m on m.workspace_id=s.workspace_id and m.user_id=s.assignee_user_id
     where s.workspace_id=r.workspace_id and s.relationship_id=r.id
       and s.assignee_user_id is distinct from r.seller_user_id and s.assignee_user_id is distinct from r.fulfilment_manager_user_id
   )), grants.view_only_ids
 from visible r
 cross join lateral (
   select array(select distinct u from unnest(array[r.seller_user_id,r.fulfilment_manager_user_id]) u
     where exists(select 1 from public.workspace_memberships m where m.workspace_id=r.workspace_id and m.user_id=u)) ids
   offset 0 -- Keep fixed-role membership as one reusable projection.
 ) base
 cross join lateral (
   select coalesce(array_agg(c.user_id),'{}'::uuid[]) ids,
     coalesce(array_agg(c.user_id) filter(where not c.can_edit),'{}'::uuid[]) view_only_ids
   from public.relationship_client_chat_members c
   join public.workspace_memberships m on m.workspace_id=c.workspace_id and m.user_id=c.user_id
   where c.workspace_id=r.workspace_id and c.relationship_id=r.id
     and c.user_id is distinct from r.seller_user_id and c.user_id is distinct from r.fulfilment_manager_user_id
 ) grants
 left join team_rosters team on team.id=r.id
$$;
revoke all on function public.client_conversation_permission_rosters(uuid,uuid) from public,anon,authenticated;
grant execute on function public.client_conversation_permission_rosters(uuid,uuid) to service_role;

create function public.set_client_chat_permissions(p_workspace_id uuid,p_relationship_id uuid,p_actor_user_id uuid,p_view_ids uuid[],p_view_only_ids uuid[] default '{}'::uuid[]) returns void
language plpgsql security definer set search_path=public as $$
declare r public.relationships%rowtype;
begin
 if p_view_ids is null or p_view_only_ids is null or cardinality(p_view_ids)>1000 or cardinality(p_view_only_ids)>1000
   or (cardinality(p_view_only_ids)>0 and not p_view_only_ids <@ p_view_ids)
   then raise exception 'View-only members require View access' using errcode='22023'; end if;
 select * into r from public.relationships where workspace_id=p_workspace_id and id=p_relationship_id and status <> 'archived' for update;
 if r.id is null or r.fulfilment_manager_user_id is distinct from p_actor_user_id or not exists(
   select 1 from public.workspace_memberships where workspace_id=p_workspace_id and user_id=p_actor_user_id
 ) then raise exception 'Only this client’s assigned manager can change Client chat access' using errcode='42501'; end if;
 -- Preserve the original service-only validation fast path, with current Team
 -- and retained grants admitted only when that path does not cover a choice.
 if exists(select 1 from unnest(p_view_ids) u where not exists(
   select 1 from public.relationship_services s join public.workspace_memberships m on m.workspace_id=s.workspace_id and m.user_id=s.assignee_user_id
   where s.workspace_id=p_workspace_id and s.relationship_id=r.id and s.assignee_user_id=u
 )) then
   if exists(select 1 from unnest(p_view_ids) u where not exists(
     select 1 from public.workspace_memberships m where m.workspace_id=p_workspace_id and m.user_id=u and (
       u=r.seller_user_id or u=r.fulfilment_manager_user_id
       or exists(select 1 from public.relationship_services s where s.workspace_id=p_workspace_id and s.relationship_id=r.id and s.assignee_user_id=u)
       or exists(select 1 from public.workspace_teams t join public.workspace_team_members tm on tm.workspace_id=t.workspace_id and tm.team_id=t.id
         where t.workspace_id=p_workspace_id and t.relationship_id=r.id and t.kind='relationship' and t.archived_at is null and tm.user_id=u)
       or exists(select 1 from public.relationship_client_chat_members c where c.workspace_id=p_workspace_id and c.relationship_id=r.id and c.user_id=u)
     )
   )) then raise exception 'Only this client’s team members can join the client conversation' using errcode='42501'; end if;
 end if;
 -- Selected and deselected IDs are disjoint. Apply both sets and their audit
 -- in one statement while holding the existing relationship mutation lock.
 with removed as (
   delete from public.relationship_client_chat_members where workspace_id=p_workspace_id and relationship_id=r.id and not(user_id=any(p_view_ids)) returning 1
 ), changed as (
   insert into public.relationship_client_chat_members(workspace_id,relationship_id,user_id,added_by,can_edit)
   select p_workspace_id,r.id,u,p_actor_user_id,not u=any(p_view_only_ids) from (select distinct unnest(p_view_ids) u) selected
   where u is distinct from r.seller_user_id and u is distinct from r.fulfilment_manager_user_id
   on conflict (relationship_id,user_id) do update set can_edit=excluded.can_edit
   where relationship_client_chat_members.can_edit is distinct from excluded.can_edit returning 1
 )
 insert into public.relationship_team_events(workspace_id,relationship_id,actor_user_id,event_type,details)
 select p_workspace_id,r.id,p_actor_user_id,'client_chat_permissions_changed',
   case when cardinality(p_view_only_ids)=0 then jsonb_build_object('user_ids',p_view_ids)
     else jsonb_build_object('user_ids',p_view_ids,'view_only_ids',p_view_only_ids) end
 where exists(select 1 from removed) or exists(select 1 from changed);
end $$;
revoke all on function public.set_client_chat_permissions(uuid,uuid,uuid,uuid[],uuid[]) from public,anon,authenticated;
grant execute on function public.set_client_chat_permissions(uuid,uuid,uuid,uuid[],uuid[]) to service_role;

-- Read authorization, cursors and recipient selection remain unchanged. Direct
-- authenticated writes use the same indexed permission predicate as the API.
drop policy "client conversation participants only" on public.client_messages;
create policy "client conversation participants only" on public.client_messages as restrictive for select to authenticated using(public.client_conversation_can_access(workspace_id,relationship_id));
create policy "client message editors insert" on public.client_messages as restrictive for insert to authenticated with check(public.client_conversation_can_write(workspace_id,relationship_id));
create policy "client message editors update" on public.client_messages as restrictive for update to authenticated using(public.client_conversation_can_write(workspace_id,relationship_id)) with check(public.client_conversation_can_write(workspace_id,relationship_id));
create policy "client message editors delete" on public.client_messages as restrictive for delete to authenticated using(public.client_conversation_can_write(workspace_id,relationship_id));
drop policy "client reaction participants only" on public.communication_reactions;
create policy "client reaction participants only" on public.communication_reactions as restrictive for select to authenticated using(public.client_conversation_can_access(workspace_id,relationship_id));
create policy "client reaction editors insert" on public.communication_reactions as restrictive for insert to authenticated with check(public.client_conversation_can_write(workspace_id,relationship_id));
create policy "client reaction editors update" on public.communication_reactions as restrictive for update to authenticated using(public.client_conversation_can_write(workspace_id,relationship_id)) with check(public.client_conversation_can_write(workspace_id,relationship_id));
create policy "client reaction editors delete" on public.communication_reactions as restrictive for delete to authenticated using(public.client_conversation_can_write(workspace_id,relationship_id));
drop policy "client delivery participants only" on public.communication_message_deliveries;
create policy "client delivery participants only" on public.communication_message_deliveries as restrictive for select to authenticated using(public.client_conversation_can_access(workspace_id,relationship_id));
create policy "client delivery editors insert" on public.communication_message_deliveries as restrictive for insert to authenticated with check(public.client_conversation_can_write(workspace_id,relationship_id));
create policy "client delivery editors update" on public.communication_message_deliveries as restrictive for update to authenticated using(public.client_conversation_can_write(workspace_id,relationship_id)) with check(public.client_conversation_can_write(workspace_id,relationship_id));
create policy "client delivery editors delete" on public.communication_message_deliveries as restrictive for delete to authenticated using(public.client_conversation_can_write(workspace_id,relationship_id));

-- Read-only members may still retrieve existing file keys, but cannot create
-- upload keys. Native conversations retain their own unchanged write policy.
do $migration$
declare definition text;
begin
    definition := pg_get_functiondef('public.communication_create_file_key(uuid,text,uuid,text)'::regprocedure);
    if position('client_conversation_can_access' in definition)=0
       or position('decrypted.decrypted_secret' in definition)=0 then
        raise exception 'Expected participant-scoped, corrected Vault upload-key function';
    end if;
    -- Preserve the corrected Vault column, encryption, MFA, native-chat policy
    -- and grants installed by the preceding immutable migrations.
    execute replace(definition,'client_conversation_can_access','client_conversation_can_write');
end;
$migration$;
notify pgrst, 'reload schema';
commit;
