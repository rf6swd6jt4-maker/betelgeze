-- Relationship-linked assets (asset_relationships) were visible only to
-- whoever "fully covers" the whole relationship (owner/admin, seller,
-- fulfilment manager, or a staff member who is the primary assignee of
-- EVERY service on it). A Shared Service Assignees roster member who isn't
-- the primary assignee of every service could already see this relationship
-- and its work items, but not its relationship-linked assets. Extend the
-- same roster eligibility already used for relationship/work-item access
-- (shared-service-queue migration) to this one remaining asset path.
-- Assets linked to a specific work item (asset_work_items) already flow
-- through workspace_user_can_access_work_item, which the shared-queue
-- migration already made roster-aware; this migration does not touch that.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';

do $$declare d text; old text; new text;begin
 d:=pg_get_functiondef('public.workspace_user_can_access_asset(uuid,uuid,uuid)'::regprocedure);
 old:='public.workspace_user_fully_covers_relationship(p_workspace_id,l.relationship_id,p_user_id))';
 new:='(public.workspace_user_fully_covers_relationship(p_workspace_id,l.relationship_id,p_user_id) or exists(select 1 from public.service_queue_members sq where sq.workspace_id=p_workspace_id and sq.user_id=p_user_id and public.service_queue_is_member(p_workspace_id,sq.instance_id,p_user_id) and exists(select 1 from public.relationship_service_instances si where si.id=sq.instance_id and si.relationship_id=l.relationship_id))))';
 if position(old in d)=0 then raise exception 'Unexpected asset access definition'; end if;
 execute replace(d,old,new);
end $$;

notify pgrst,'reload schema';
commit;
