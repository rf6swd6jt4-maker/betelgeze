-- app-alerts.md: change only with explicit authorization.
-- Version 3 activity means the exact latest message is rendered in view.
-- Old selected-chat heartbeats must not indefinitely defer unread messages.
begin;

create or replace function public.record_chat_reading_activity(p_user uuid,p_tab uuid,p_revision bigint,p_active boolean,p_workspace uuid default null,p_kind text default null,p_conversation uuid default null,p_seen_at timestamptz default now())
returns boolean language plpgsql security definer set search_path=public as $$
declare changed integer;
begin
 if p_revision < 1 or p_revision > 9007199254740991 then raise exception 'Invalid activity revision'; end if;
 insert into communications_active_sessions(user_id,tab_id,workspace_id,conversation_kind,conversation_id,connection_live,last_seen_at,activity_revision,activity_version,active)
 values(p_user,p_tab,p_workspace,p_kind,p_conversation,p_active,least(p_seen_at,clock_timestamp()),p_revision,3,p_active)
 on conflict(user_id,tab_id) do update set workspace_id=excluded.workspace_id,conversation_kind=excluded.conversation_kind,
 conversation_id=excluded.conversation_id,connection_live=excluded.connection_live,last_seen_at=excluded.last_seen_at,
 activity_revision=excluded.activity_revision,activity_version=3,active=excluded.active
 where excluded.activity_revision>communications_active_sessions.activity_revision;
 get diagnostics changed=row_count;
 return changed=1;
end $$;

create or replace function public.prepare_chat_push_delivery(p_id uuid,p_lease uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare d chat_push_deliveries; read_at timestamptz; read_id uuid; active_at timestamptz; outcome text; unread_count integer;
begin
 select * into d from chat_push_deliveries where id=p_id and lease_token=p_lease and status='processing' and lease_until>now() for update;
 if not found then return jsonb_build_object('state','stale');end if;
 if d.subscription_id is null or not exists(select 1 from web_push_subscriptions s where s.id=d.subscription_id and s.user_id=d.user_id)
 or not exists(select 1 from chat_push_recipients(d.workspace_id,d.conversation_kind,d.conversation_id) r where r.user_id=d.user_id) then outcome:='revoked';
 elsif d.message_created_at<now()-interval '24 hours' then outcome:='expired';
 elsif d.conversation_kind='native' then
  if not exists(select 1 from workspace_native_messages where workspace_id=d.workspace_id and conversation_id=d.conversation_id and id=d.message_id and sender_user_id is distinct from d.user_id) then outcome:='revoked';end if;
  select coalesce(m.created_at,c.last_read_at), coalesce(m.id,c.last_read_message_id) into read_at,read_id
  from workspace_native_read_cursors c left join workspace_native_messages m on m.id=c.last_read_message_id and m.workspace_id=c.workspace_id and m.conversation_id=c.conversation_id
  where c.workspace_id=d.workspace_id and c.conversation_id=d.conversation_id and c.user_id=d.user_id;
 else
  if not exists(select 1 from client_messages where workspace_id=d.workspace_id and relationship_id=d.conversation_id and id=d.message_id and direction='inbound') then outcome:='revoked';end if;
  -- Use the actual last-read message timestamp, never the time of the HTTP request.
  select coalesce(m.created_at,c.last_read_at), coalesce(m.id,c.last_read_message_id) into read_at,read_id from communication_read_cursors c left join client_messages m on m.id=c.last_read_message_id and m.workspace_id=c.workspace_id and m.relationship_id=c.relationship_id
  where c.workspace_id=d.workspace_id and c.relationship_id=d.conversation_id and c.user_id=d.user_id;
 end if;
 if outcome is null and (read_at,coalesce(read_id,'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid)) >= (d.message_created_at,d.message_id) then outcome:='read';end if;
 if outcome is null and exists(select 1 from chat_push_deliveries newer where newer.subscription_id=d.subscription_id and newer.conversation_kind=d.conversation_kind and newer.conversation_id=d.conversation_id
  and newer.status in('pending','processing','accepted') and (newer.message_created_at,newer.message_id)>(d.message_created_at,d.message_id)) then outcome:='superseded';end if;
 if outcome is not null then
  update chat_push_deliveries set status=outcome,lease_token=null,lease_until=null where id=d.id;return jsonb_build_object('state',outcome);
 end if;
 select max(last_seen_at) into active_at from communications_active_sessions where user_id=d.user_id and workspace_id=d.workspace_id
 and conversation_kind=d.conversation_kind and conversation_id=d.conversation_id and activity_version=3 and active and connection_live
 and last_seen_at>now()-interval '45 seconds';
 -- A live-looking reader with broken read persistence must not renew
 -- suppression forever. Unacknowledged jobs get a bounded reading grace.
 if active_at is not null and d.created_at>now()-interval '45 seconds' then
  update chat_push_deliveries set status='pending',available_at=least(active_at+interval '45 seconds',d.created_at+interval '45 seconds'),lease_token=null,lease_until=null,attempts=greatest(0,attempts-1),last_error='active_chat_deferred' where id=d.id;
  return jsonb_build_object('state','deferred');
 end if;
 -- Cap preview counts to bound work for accounts with very old unread history.
 if d.conversation_kind='native' then
  select count(*) into unread_count from(select 1 from workspace_native_messages where workspace_id=d.workspace_id and conversation_id=d.conversation_id and sender_user_id<>d.user_id and (created_at,id)>(coalesce(read_at,'-infinity'::timestamptz),coalesce(read_id,'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid)) limit 100) unread;
 else
  select count(*) into unread_count from(select 1 from client_messages where workspace_id=d.workspace_id and relationship_id=d.conversation_id and direction='inbound' and (created_at,id)>(coalesce(read_at,'-infinity'::timestamptz),coalesce(read_id,'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid)) limit 100) unread;
 end if;
 return jsonb_build_object('state','send','unreadCount',greatest(1,unread_count));
end $$;

revoke all on function public.record_chat_reading_activity(uuid,uuid,bigint,boolean,uuid,text,uuid,timestamptz) from public,anon,authenticated;
grant execute on function public.record_chat_reading_activity(uuid,uuid,bigint,boolean,uuid,text,uuid,timestamptz) to service_role;
notify pgrst,'reload schema';
commit;
