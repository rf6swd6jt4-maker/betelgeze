-- Match transfer, service publication and delivery-chat ownership lock order.
-- Existing version, replay, authorization and audit behavior remains canonical.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $lock_order$
declare
 definition text;
 previous_lock text := 'select * into strict i from public.relationship_service_instances where workspace_id = p_workspace_id and id = p_instance_id for update;';
 replacement_lock text := $replacement$
    -- Identity and relationship are immutable. Check access before acquiring
    -- either lock, then retain the canonical access recheck after waiting.
    select * into strict i from public.relationship_service_instances where workspace_id = p_workspace_id and id = p_instance_id;
    if not public.can_manage_relationship_service(p_workspace_id,i.relationship_id,p_actor_user_id,i.origin) then raise exception 'Service editing access required'; end if;
    perform 1 from public.relationships where workspace_id = p_workspace_id and id = i.relationship_id for update;
    select * into strict i from public.relationship_service_instances where workspace_id = p_workspace_id and id = p_instance_id for update;
$replacement$;
begin
 definition := pg_get_functiondef('public.change_service_instance(uuid,uuid,uuid,uuid,integer,text,text,uuid,text)'::regprocedure);
 if length(definition) - length(replace(definition, previous_lock, '')) <> length(previous_lock)
    or position('Identity and relationship are immutable' in definition) > 0 then
  raise exception 'Unexpected service change lock definition';
 end if;
 execute replace(definition, previous_lock, replacement_lock);
end $lock_order$;

notify pgrst, 'reload schema';
commit;
