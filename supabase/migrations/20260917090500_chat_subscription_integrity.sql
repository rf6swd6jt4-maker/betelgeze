begin;

create function public.register_chat_push_subscription(p_user uuid,p_device uuid,p_endpoint text,p_key text,p_auth text,p_agent text default null,p_reconcile boolean default false)
returns uuid language plpgsql security definer set search_path=public as $$
declare existing web_push_subscriptions; saved uuid;
begin
 perform pg_advisory_xact_lock(hashtextextended(p_endpoint,0));
 perform pg_advisory_xact_lock(hashtextextended(p_user::text||p_device::text,1));
 select * into existing from web_push_subscriptions where endpoint=p_endpoint for update;
 if existing.id is not null and existing.user_id<>p_user and (p_reconcile or existing.p256dh<>p_key or existing.auth<>p_auth) then
  raise exception 'Subscription belongs to another account' using errcode='42501';
 end if;
 if p_reconcile and not exists(select 1 from web_push_subscriptions where user_id=p_user and device_id=p_device) then
  raise exception 'Device must be explicitly enabled' using errcode='42501';
 end if;
 insert into web_push_subscriptions(user_id,device_id,endpoint,p256dh,auth,user_agent)
 values(p_user,p_device,p_endpoint,p_key,p_auth,p_agent)
 on conflict(endpoint) do update set user_id=excluded.user_id,device_id=excluded.device_id,p256dh=excluded.p256dh,auth=excluded.auth,user_agent=excluded.user_agent,updated_at=now(),failure_count=0
 returning id into saved;
 -- Delete obsolete endpoints only after the replacement is safely stored in
 -- this same transaction. Re-saving the same endpoint preserves its job IDs.
 delete from web_push_subscriptions where user_id=p_user and device_id=p_device and id<>saved;
 return saved;
end $$;
revoke all on function public.register_chat_push_subscription(uuid,uuid,text,text,text,text,boolean) from public,anon,authenticated;
grant execute on function public.register_chat_push_subscription(uuid,uuid,text,text,text,text,boolean) to service_role;

-- Do not silently rewrite historical membership. Stop the migration if stored
-- direct participants disagree with the declared pair; inspect those rows first.
do $$begin
 if exists(select 1 from workspace_native_conversation_participants p join workspace_native_conversations c on c.id=p.conversation_id
  where p.workspace_id<>c.workspace_id or c.kind<>'direct' or p.user_id is distinct from c.direct_user_one and p.user_id is distinct from c.direct_user_two) then
  raise exception 'Direct-chat participant integrity needs review';
 end if;
end $$;
create function public.guard_native_direct_participant() returns trigger language plpgsql security definer set search_path=public as $$
begin
 if not exists(select 1 from workspace_native_conversations c join workspace_memberships m on m.workspace_id=c.workspace_id and m.user_id=new.user_id
  where c.workspace_id=new.workspace_id and c.id=new.conversation_id and c.kind='direct' and new.user_id in(c.direct_user_one,c.direct_user_two)) then
  raise exception 'Only the declared direct-chat recipients may participate' using errcode='42501';
 end if;
 return new;
end $$;
create trigger guard_native_direct_participant before insert or update on public.workspace_native_conversation_participants for each row execute function public.guard_native_direct_participant();
create function public.guard_native_conversation_identity() returns trigger language plpgsql set search_path=public as $$
begin
 if (new.workspace_id,new.kind,new.direct_user_one,new.direct_user_two,new.team_id) is distinct from (old.workspace_id,old.kind,old.direct_user_one,old.direct_user_two,old.team_id) then
  raise exception 'A conversation cannot be reassigned to different recipients' using errcode='42501';
 end if;
 return new;
end $$;
create trigger guard_native_conversation_identity before update of workspace_id,kind,direct_user_one,direct_user_two,team_id on public.workspace_native_conversations for each row execute function public.guard_native_conversation_identity();
revoke all on function public.guard_native_direct_participant() from public,anon,authenticated;
revoke all on function public.guard_native_conversation_identity() from public,anon,authenticated;
notify pgrst,'reload schema';
commit;
