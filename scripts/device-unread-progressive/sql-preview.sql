-- Isolated diagnostic extension. Synthetic plaintext body excludes production
-- encryption, signing and route bootstrap CPU. Do not install on production.
create function public.diagnostic_device_preview_batch(p_workspace_id uuid,p_device_id uuid,p_kind text,p_ids uuid[])
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_user uuid; v_id uuid; result jsonb;
begin
 v_user:=public.require_communication_device(p_workspace_id,p_device_id);
 if p_kind not in ('client','native') or p_kind is null or p_ids is null or cardinality(p_ids)>20 or cardinality(p_ids)<1
 or exists(select 1 from unnest(p_ids) x where x is null) then raise invalid_parameter_value; end if;
 foreach v_id in array p_ids loop
  if p_kind='client' then
   if public.client_conversation_can_access(p_workspace_id,v_id,v_user) is not true then raise insufficient_privilege;end if;
  else
   if not exists(select 1 from public.workspace_native_conversations c where c.id=v_id and c.workspace_id=p_workspace_id)
   or public.native_conversation_can_read(v_id,v_user) is not true then raise insufficient_privilege;end if;
  end if;
 end loop;
 perform public.initialize_communication_device_scope(p_workspace_id,v_user,p_device_id);
 select jsonb_build_object('deviceId',p_device_id,'items',jsonb_agg(jsonb_build_object(
 'kind',p_kind,'conversationId',r.id,'cursorKnown',true,
 'deviceCursor',case when c.last_read_at is null then null else jsonb_build_object('lastReadAt',c.last_read_at,'lastReadMessageId',c.last_read_message_id) end,
 'preview',preview.value) order by r.ord)) into result
 from unnest(p_ids) with ordinality r(id,ord)
 left join public.communication_device_read_cursors c on c.workspace_id=p_workspace_id and c.user_id=v_user and c.device_id=p_device_id and c.kind=p_kind and c.conversation_id=r.id
 left join lateral (
 select jsonb_build_object('id',m.id,'createdAt',m.created_at,'body',m.body) value from public.client_messages m
 where p_kind='client' and m.workspace_id=p_workspace_id and m.relationship_id=r.id order by m.created_at desc,m.id desc limit 1
 ) cp on true
 left join lateral (
 select jsonb_build_object('id',m.id,'createdAt',m.created_at,'body',m.body) value from public.workspace_native_messages m
 where p_kind='native' and m.workspace_id=p_workspace_id and m.conversation_id=r.id
 and not exists(select 1 from public.workspace_native_conversation_visibility v where v.conversation_id=r.id and v.user_id=v_user and m.created_at<=v.cleared_at)
 order by m.created_at desc,m.id desc limit 1
 ) np on true
 cross join lateral (select coalesce(cp.value,np.value) value) preview;
 return result;
end $$;
revoke all on function public.diagnostic_device_preview_batch(uuid,uuid,text,uuid[]) from public,anon,authenticated,service_role;
grant execute on function public.diagnostic_device_preview_batch(uuid,uuid,text,uuid[]) to authenticated;
