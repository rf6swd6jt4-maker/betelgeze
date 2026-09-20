-- Accept SOP setup work for real relationships and keep active delivery staff in
-- the relationship's existing Team conversation. No model work runs in a save.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

create or replace function public.assert_sop_work_scope(p_workspace uuid,p_actor uuid,p_relationship uuid,p_session uuid,p_service text) returns void
language plpgsql set search_path=public as $$
declare r relationships; i relationship_service_instances;
begin
 perform assert_sop_admin(p_workspace,p_actor);
 select * into r from relationships where workspace_id=p_workspace and id=p_relationship for update;
 if not found or r.status='archived' then raise exception 'Choose an active relationship.'; end if;
 i:=sop_generation_instance(p_workspace,p_relationship,p_service::uuid);
 if i.id is null or i.stage<>'setup' or i.disposition<>'active' or i.import_id is not null then raise exception 'Choose an active service in Setup.'; end if;
 if p_session is not null and not exists(select 1 from service_instance_sessions e join relationship_onboarding_sessions s on s.id=e.session_id and s.workspace_id=e.workspace_id
   where e.workspace_id=p_workspace and e.instance_id=i.id and s.id=p_session and s.archived_at is null and s.status='completed') then raise exception 'The service onboarding session is unavailable.'; end if;
 if i.assignee_user_id is not null and not exists(select 1 from workspace_memberships m join workspace_member_service_access a using(workspace_id,user_id)
   where m.workspace_id=p_workspace and m.user_id=i.assignee_user_id and a.service_id=i.service_id) then raise exception 'The service assignee no longer has access.'; end if;
end $$;

create or replace function public.enqueue_service_sop_work() returns trigger
language plpgsql security definer set search_path=public as $$
begin
 if new.stage='setup' and new.disposition='active' and new.import_id is null
 and (tg_op='INSERT' or old.stage is distinct from new.stage or old.disposition is distinct from new.disposition) then
  insert into sop_work_requests(instance_id,workspace_id,relationship_id,sop_id,asset_id,requested_by)
  select new.id,new.workspace_id,new.relationship_id,b.sop_id,b.asset_id,b.configured_by
  from sop_service_sources b join relationships r on r.workspace_id=b.workspace_id and r.id=new.relationship_id
  where b.workspace_id=new.workspace_id and b.service_id=new.service_id and b.enabled and r.status<>'archived'
  on conflict(instance_id) do nothing;
 end if;
 return new;
end $$;

create or replace function public.service_sop_save_result(p_workspace uuid,p_relationship uuid,p_instance uuid,p_enabled boolean) returns jsonb
language plpgsql set search_path=public as $$
declare eligible boolean;
begin
 select i.stage='setup' and i.disposition='active' and i.import_id is null and r.status<>'archived' into eligible
 from relationship_service_instances i join relationships r on r.workspace_id=i.workspace_id and r.id=i.relationship_id
 where i.workspace_id=p_workspace and i.relationship_id=p_relationship and i.id=p_instance;
 if eligible then
  if not p_enabled then raise exception 'Work generation is currently unavailable. No service was changed.'; end if;
  if not exists(select 1 from sop_work_requests where workspace_id=p_workspace and instance_id=p_instance) then
   raise exception 'Link this service to its main procedure on the SOP page first. No flow was generated.';
  end if;
 end if;
 return jsonb_build_object('id',p_instance,'generation',coalesce(eligible,false));
end $$;

-- The progress endpoint must describe the current eligibility, including
-- ordinary relationships. Guard the replacement against unexpected drift.
do $$declare definition text; begin
 select pg_get_functiondef('public.read_service_sop_progress(uuid,uuid,uuid,uuid)'::regprocedure) into definition;
 if position('active test relationship in Setup' in definition)=0 then raise exception 'Unexpected SOP progress definition'; end if;
 execute replace(definition,'active test relationship in Setup','active relationship in Setup');
end $$;

-- A service in active delivery owns an internal Team chat even when the
-- relationship has not passed through checkout. Reuse the sold-client team.
create function public.ensure_active_service_fulfilment_chat(p_workspace uuid,p_relationship uuid) returns void
language plpgsql security definer set search_path=public as $$
declare r relationships; v_team_id uuid;
begin
 select * into r from relationships where workspace_id=p_workspace and id=p_relationship for update;
 if not found or r.status='archived' or not exists(select 1 from relationship_service_instances i
  where i.workspace_id=p_workspace and i.relationship_id=p_relationship and i.disposition='active'
   and i.stage in ('onboarding','setup','maintenance') and i.import_id is null) then return; end if;
 v_team_id:=create_relationship_delivery_team(p_workspace,p_relationship);
 update workspace_teams set archived_at=null where workspace_id=p_workspace and id=v_team_id and archived_at is not null;
 insert into workspace_native_conversations(workspace_id,kind,team_id,created_by)
 values(p_workspace,'team',v_team_id,r.seller_user_id) on conflict do nothing;
 update workspace_native_conversations set archived_at=null
 where workspace_id=p_workspace and team_id=v_team_id and kind='team' and archived_at is not null;
 insert into workspace_team_members(workspace_id,team_id,user_id,added_by)
 select p_workspace,v_team_id,m.user_id,r.seller_user_id
 from workspace_memberships m where m.workspace_id=p_workspace and
 (m.user_id in (r.seller_user_id,r.fulfilment_manager_user_id) or exists(
  select 1 from relationship_service_instances i join workspace_member_service_access a
   on a.workspace_id=i.workspace_id and a.service_id=i.service_id and a.user_id=i.assignee_user_id
  where i.workspace_id=p_workspace and i.relationship_id=p_relationship and i.assignee_user_id=m.user_id
   and i.disposition='active' and i.stage in ('onboarding','setup','maintenance') and i.import_id is null))
 on conflict do nothing;
end $$;
create function public.sync_service_fulfilment_chat() returns trigger
language plpgsql security definer set search_path=public as $$
begin
 if new.disposition='active' and new.stage in ('onboarding','setup','maintenance') and new.import_id is null then
  perform ensure_active_service_fulfilment_chat(new.workspace_id,new.relationship_id);
 end if;
 return new;
end $$;
create trigger sync_service_fulfilment_chat after insert or update of stage,disposition,assignee_user_id on public.relationship_service_instances
for each row execute function public.sync_service_fulfilment_chat();
create function public.sync_relationship_fulfilment_chat_roster() returns trigger
language plpgsql security definer set search_path=public as $$
begin
 if (new.seller_user_id,new.fulfilment_manager_user_id) is distinct from (old.seller_user_id,old.fulfilment_manager_user_id) then
  perform ensure_active_service_fulfilment_chat(new.workspace_id,new.id);
 end if;
 return new;
end $$;
create trigger sync_relationship_fulfilment_chat_roster after update of seller_user_id,fulfilment_manager_user_id on public.relationships
for each row execute function public.sync_relationship_fulfilment_chat_roster();
revoke all on function public.ensure_active_service_fulfilment_chat(uuid,uuid),public.sync_service_fulfilment_chat() from public,anon,authenticated;
revoke all on function public.sync_relationship_fulfilment_chat_roster() from public,anon,authenticated;
grant execute on function public.ensure_active_service_fulfilment_chat(uuid,uuid) to service_role;

-- The active population is bounded by the relationship/service indexes. This
-- reconciles chats without altering completed or archived relationship history.
do $$declare service record; begin
 for service in select distinct i.workspace_id,i.relationship_id from relationship_service_instances i
  join relationships r on r.workspace_id=i.workspace_id and r.id=i.relationship_id
  where i.disposition='active' and i.stage in ('onboarding','setup','maintenance') and i.import_id is null and r.status<>'archived'
  order by i.workspace_id,i.relationship_id loop
  perform public.ensure_active_service_fulfilment_chat(service.workspace_id,service.relationship_id);
 end loop;
end $$;
commit;
