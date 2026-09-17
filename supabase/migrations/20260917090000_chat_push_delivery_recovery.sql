begin;

-- Presence is ordered per mounted tab. An inactive tombstone must outlive older
-- in-flight heartbeats; deleting a row on departure allowed it to be resurrected.
alter table public.communications_active_sessions
 add column activity_revision bigint not null default 0,
 add column activity_version integer not null default 1,
 add column active boolean not null default false;

create function public.record_chat_activity(p_user uuid,p_tab uuid,p_revision bigint,p_active boolean,p_workspace uuid default null,p_kind text default null,p_conversation uuid default null,p_seen_at timestamptz default now())
returns boolean language plpgsql security definer set search_path=public as $$
declare changed integer;
begin
 if p_revision < 1 or p_revision > 9007199254740991 then raise exception 'Invalid activity revision'; end if;
 insert into communications_active_sessions(user_id,tab_id,workspace_id,conversation_kind,conversation_id,connection_live,last_seen_at,activity_revision,activity_version,active)
 values(p_user,p_tab,p_workspace,p_kind,p_conversation,p_active,least(p_seen_at,clock_timestamp()),p_revision,2,p_active)
 on conflict(user_id,tab_id) do update set workspace_id=excluded.workspace_id,conversation_kind=excluded.conversation_kind,
 conversation_id=excluded.conversation_id,connection_live=excluded.connection_live,last_seen_at=excluded.last_seen_at,
 activity_revision=excluded.activity_revision,activity_version=2,active=excluded.active
 where excluded.activity_revision>communications_active_sessions.activity_revision;
 get diagnostics changed=row_count;
 return changed=1;
end $$;

-- This is the participant set, not workspace-wide membership or administrative
-- visibility. Team conversations use team membership, not direct-chat rows.
create function public.chat_push_recipients(p_workspace uuid,p_kind text,p_conversation uuid)
returns table(user_id uuid) language sql stable security definer set search_path=public as $$
 select distinct candidate.user_id from (
  select p.user_id from workspace_native_conversations c
  join workspace_native_conversation_participants p on p.conversation_id=c.id and p.workspace_id=c.workspace_id and p.user_id in(c.direct_user_one,c.direct_user_two)
  where p_kind='native' and c.workspace_id=p_workspace and c.id=p_conversation and c.kind='direct' and c.archived_at is null
  union all
  select tm.user_id from workspace_native_conversations c
  join workspace_teams t on t.id=c.team_id and t.workspace_id=c.workspace_id and t.archived_at is null
  join workspace_team_members tm on tm.team_id=t.id and tm.workspace_id=t.workspace_id
  where p_kind='native' and c.workspace_id=p_workspace and c.id=p_conversation and c.kind='team' and c.archived_at is null
  union all
  select roster.user_id from relationships r cross join lateral (
   select r.seller_user_id user_id union select r.fulfilment_manager_user_id
   union select extra.user_id from relationship_client_chat_members extra where extra.workspace_id=r.workspace_id and extra.relationship_id=r.id
  ) roster
  where p_kind='client' and r.workspace_id=p_workspace and r.id=p_conversation and r.status<>'archived'
   and public.client_conversation_can_access(p_workspace,p_conversation,roster.user_id)
 ) candidate join workspace_memberships m on m.workspace_id=p_workspace and m.user_id=candidate.user_id
$$;

create table public.chat_push_deliveries (
 id uuid primary key default gen_random_uuid(),
 workspace_id uuid not null references public.workspaces(id) on delete cascade,
 conversation_kind text not null check(conversation_kind in('native','client')),
 conversation_id uuid not null,
 message_id uuid not null,
 message_created_at timestamptz not null,
 user_id uuid not null references auth.users(id) on delete cascade,
 subscription_id uuid references public.web_push_subscriptions(id) on delete set null,
 status text not null default 'pending' check(status in('pending','processing','accepted','read','revoked','expired','failed','superseded')),
 attempts integer not null default 0,
 available_at timestamptz not null default now(),
 lease_token uuid,
 lease_until timestamptz,
 accepted_at timestamptz,
 display_reported_at timestamptz,
 display_failed_at timestamptz,
 receipt_token uuid not null default gen_random_uuid(),
 last_error text,
 created_at timestamptz not null default now(),
 unique(subscription_id,conversation_kind,message_id)
);
alter table public.chat_push_deliveries enable row level security;
revoke all on public.chat_push_deliveries from public,anon,authenticated;
grant select,update on public.chat_push_deliveries to service_role;
create index chat_push_deliveries_pending_idx on public.chat_push_deliveries(available_at,id) where status='pending';
create index chat_push_deliveries_lease_idx on public.chat_push_deliveries(lease_until) where status='processing';
create index chat_push_deliveries_stream_idx on public.chat_push_deliveries(subscription_id,conversation_kind,conversation_id,message_created_at desc,id) where status in('pending','processing','accepted');
create index chat_push_deliveries_message_idx on public.chat_push_deliveries(message_id);
create index chat_push_deliveries_user_pending_idx on public.chat_push_deliveries(user_id,available_at) where status='pending';

create function public.enqueue_message_chat_push() returns trigger
language plpgsql security definer set search_path=public as $$
declare kind text; conversation uuid; sender uuid; resolver uuid;
begin
 if tg_table_name='workspace_native_messages' then
  kind:='native';conversation:=new.conversation_id;sender:=new.sender_user_id;
  -- System messages retain their existing explicit notification policy.
  if sender is null then return new;end if;
  select resolver_id into resolver from work_queue_disputes where workspace_id=new.workspace_id and id=new.client_request_id;
 else
  if new.direction<>'inbound' or new.relationship_id is null then return new;end if;
  kind:='client';conversation:=new.relationship_id;sender:=null;
 end if;
 insert into chat_push_deliveries(workspace_id,conversation_kind,conversation_id,message_id,message_created_at,user_id,subscription_id)
 select new.workspace_id,kind,conversation,new.id,new.created_at,r.user_id,s.id
 from chat_push_recipients(new.workspace_id,kind,conversation) r join web_push_subscriptions s on s.user_id=r.user_id
 where r.user_id is distinct from sender and (resolver is null or r.user_id=resolver)
 on conflict do nothing;
 return new;
end $$;
create trigger enqueue_native_chat_push after insert on public.workspace_native_messages for each row execute function public.enqueue_message_chat_push();
create trigger enqueue_client_chat_push after insert on public.client_messages for each row execute function public.enqueue_message_chat_push();

create function public.claim_chat_push_deliveries(p_message uuid default null,p_user uuid default null,p_limit integer default 50)
returns setof public.chat_push_deliveries language plpgsql security definer set search_path=public as $$
begin
 -- Serialize short claims, not provider calls. A stream may have only one
 -- leased delivery so an older send cannot overwrite a newer notification.
 perform pg_advisory_xact_lock(hashtextextended('chat_push_claim',0));
 return query with candidates as (
  select q.id from chat_push_deliveries q where ((status='pending' and available_at<=now()) or(status='processing' and lease_until<now()))
   and(p_message is null or message_id=p_message) and(p_user is null or user_id=p_user)
   and not exists(select 1 from chat_push_deliveries other where other.subscription_id=q.subscription_id and other.conversation_kind=q.conversation_kind and other.conversation_id=q.conversation_id
    and other.id<>q.id and other.status='processing' and other.lease_until>now())
   and not exists(select 1 from chat_push_deliveries newer where newer.subscription_id=q.subscription_id and newer.conversation_kind=q.conversation_kind and newer.conversation_id=q.conversation_id
    and newer.status='pending' and newer.available_at<=now() and (newer.message_created_at,newer.message_id)>(q.message_created_at,q.message_id))
  order by available_at,id for update skip locked limit greatest(1,least(p_limit,100))
 ) update chat_push_deliveries d set status='processing',lease_token=gen_random_uuid(),lease_until=now()+interval '90 seconds',attempts=attempts+1
 from candidates c where d.id=c.id returning d.*;
end $$;

-- Recheck membership and the particular message at dispatch, including on retries.
-- A fresh activity lease defers a durable job; it never discards the notification.
create function public.prepare_chat_push_delivery(p_id uuid,p_lease uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare d chat_push_deliveries; read_at timestamptz; active_at timestamptz; outcome text; unread_count integer;
begin
 select * into d from chat_push_deliveries where id=p_id and lease_token=p_lease and status='processing' and lease_until>now() for update;
 if not found then return jsonb_build_object('state','stale');end if;
 if d.subscription_id is null or not exists(select 1 from web_push_subscriptions s where s.id=d.subscription_id and s.user_id=d.user_id)
 or not exists(select 1 from chat_push_recipients(d.workspace_id,d.conversation_kind,d.conversation_id) r where r.user_id=d.user_id) then outcome:='revoked';
 elsif d.message_created_at<now()-interval '24 hours' then outcome:='expired';
 elsif d.conversation_kind='native' then
  if not exists(select 1 from workspace_native_messages where workspace_id=d.workspace_id and conversation_id=d.conversation_id and id=d.message_id and sender_user_id is distinct from d.user_id) then outcome:='revoked';end if;
  select last_read_at into read_at from workspace_native_read_cursors where workspace_id=d.workspace_id and conversation_id=d.conversation_id and user_id=d.user_id;
 else
  if not exists(select 1 from client_messages where workspace_id=d.workspace_id and relationship_id=d.conversation_id and id=d.message_id and direction='inbound') then outcome:='revoked';end if;
  -- Use the actual last-read message timestamp, never the time of the HTTP request.
  select m.created_at into read_at from communication_read_cursors c join client_messages m on m.id=c.last_read_message_id and m.workspace_id=c.workspace_id and m.relationship_id=c.relationship_id
  where c.workspace_id=d.workspace_id and c.relationship_id=d.conversation_id and c.user_id=d.user_id;
 end if;
 if outcome is null and read_at>=d.message_created_at then outcome:='read';end if;
 if outcome is null and exists(select 1 from chat_push_deliveries newer where newer.subscription_id=d.subscription_id and newer.conversation_kind=d.conversation_kind and newer.conversation_id=d.conversation_id
  and newer.status in('pending','processing','accepted') and (newer.message_created_at,newer.message_id)>(d.message_created_at,d.message_id)) then outcome:='superseded';end if;
 if outcome is not null then
  update chat_push_deliveries set status=outcome,lease_token=null,lease_until=null where id=d.id;return jsonb_build_object('state',outcome);
 end if;
 select max(last_seen_at) into active_at from communications_active_sessions where user_id=d.user_id and workspace_id=d.workspace_id
 and conversation_kind=d.conversation_kind and conversation_id=d.conversation_id and activity_version=2 and active and connection_live
 and last_seen_at>now()-interval '45 seconds';
 if active_at is not null then
  update chat_push_deliveries set status='pending',available_at=active_at+interval '45 seconds',lease_token=null,lease_until=null,attempts=greatest(0,attempts-1),last_error='active_chat_deferred' where id=d.id;
  return jsonb_build_object('state','deferred');
 end if;
 -- Cap preview counts to bound work for accounts with very old unread history.
 if d.conversation_kind='native' then
  select count(*) into unread_count from(select 1 from workspace_native_messages where workspace_id=d.workspace_id and conversation_id=d.conversation_id and sender_user_id<>d.user_id and created_at>coalesce(read_at,'-infinity'::timestamptz) limit 100) unread;
 else
  select count(*) into unread_count from(select 1 from client_messages where workspace_id=d.workspace_id and relationship_id=d.conversation_id and direction='inbound' and created_at>coalesce(read_at,'-infinity'::timestamptz) limit 100) unread;
 end if;
 return jsonb_build_object('state','send','unreadCount',greatest(1,unread_count));
end $$;

create function public.finish_chat_push_delivery(p_id uuid,p_lease uuid,p_outcome text,p_error text default null)
returns boolean language plpgsql security definer set search_path=public as $$
declare d chat_push_deliveries;
begin
 select * into d from chat_push_deliveries where id=p_id and lease_token=p_lease and status='processing' for update;
 if not found then return false;end if;
 if p_outcome not in('accepted','retry','revoked') then raise exception 'Invalid push outcome';end if;
 update chat_push_deliveries set status=case when p_outcome='retry' then 'pending' else p_outcome end,
 accepted_at=case when p_outcome='accepted' then now() else accepted_at end,
 available_at=now()+make_interval(secs=>least(900,5*power(2,least(d.attempts,8)))::integer),
 lease_token=null,lease_until=null,last_error=left(p_error,160) where id=d.id;
 return true;
end $$;

create function public.wake_chat_push_for_user(p_user uuid) returns void language sql security definer set search_path=public as $$
 update chat_push_deliveries set available_at=now() where user_id=p_user and status='pending' and last_error='active_chat_deferred';
$$;

-- Receipt capabilities can only record display outcome for one delivery. No chat
-- data, subscription keys, or authentication is exposed to an untrusted caller.
create function public.record_chat_push_receipt(p_id uuid,p_token uuid,p_outcome text) returns void language sql security definer set search_path=public as $$
 update chat_push_deliveries set display_reported_at=case when p_outcome='shown' then coalesce(display_reported_at,now()) else display_reported_at end,
 display_failed_at=case when p_outcome='failed' then coalesce(display_failed_at,now()) else display_failed_at end
 where id=p_id and receipt_token=p_token and p_outcome in('shown','failed') and created_at>now()-interval '2 days';
$$;

do $$declare f record;begin for f in select oid::regprocedure signature from pg_proc where pronamespace='public'::regnamespace and proname in
 ('record_chat_activity','chat_push_recipients','enqueue_message_chat_push','claim_chat_push_deliveries','prepare_chat_push_delivery','finish_chat_push_delivery','wake_chat_push_for_user','record_chat_push_receipt') loop
 execute format('revoke all on function %s from public,anon,authenticated',f.signature);execute format('grant execute on function %s to service_role',f.signature);end loop;end $$;
notify pgrst,'reload schema';
commit;
