-- Subscription consent belongs to the installation; user_id is only delivery routing.
begin;
alter table public.web_push_subscriptions add column binding_version bigint not null default 0;
alter table public.chat_push_deliveries add column binding_version bigint not null default 0;
create table public.chat_push_installations (
 device_id uuid primary key,
 notifications_enabled boolean not null default false
);
alter table public.chat_push_installations enable row level security;
revoke all on public.chat_push_installations from public,anon,authenticated;
grant all on public.chat_push_installations to service_role;
insert into public.chat_push_installations(device_id,notifications_enabled)
select distinct device_id,true from public.web_push_subscriptions;
alter table public.web_push_subscriptions alter column user_id drop not null;
alter table public.web_push_subscriptions drop constraint web_push_subscriptions_user_id_fkey;
alter table public.web_push_subscriptions add constraint web_push_subscriptions_user_id_fkey foreign key(user_id) references auth.users(id) on delete set null;
alter table public.chat_push_device_owners add column logged_out boolean not null default false;
alter table public.chat_push_device_owners alter column user_id drop not null;
create or replace function public.account_devices(p_device uuid, p_agent text, p_list boolean default false)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
    v_user uuid := auth.uid();
    v_session uuid := nullif(auth.jwt()->>'session_id','')::uuid;
    v_devices jsonb;
begin
    if v_user is null or auth.jwt()->>'aal' is distinct from 'aal2' or p_device is null
       or not exists(select 1 from auth.sessions s where s.id=v_session and s.user_id=v_user
           and (s.not_after is null or s.not_after>now())) then
        raise exception 'A current verified session is required' using errcode='42501';
    end if;
    if exists(select 1 from public.user_profiles where user_id=v_user and mfa_reenrollment_required) then
        raise exception 'Authenticator verification required' using errcode='42501';
    end if;
    perform pg_advisory_xact_lock(hashtextextended(p_device::text,2));
    insert into public.account_session_devices(session_id,user_id,device_id,user_agent,last_seen_at)
    values(v_session,v_user,p_device,left(p_agent,500),now())
    on conflict(session_id) do update set device_id=excluded.device_id,user_agent=excluded.user_agent,last_seen_at=excluded.last_seen_at
    where account_session_devices.device_id is distinct from excluded.device_id
       or account_session_devices.user_agent is distinct from excluded.user_agent
       or account_session_devices.last_seen_at<now()-interval '1 second';
    -- The last verified sign-in owns enabled notifications on this installation.
    -- Expiry/closing does not revoke push. Older live tabs cannot take it back.
    insert into chat_push_device_owners(device_id,user_id,session_id,signed_in_at,logged_out)
    select p_device,v_user,v_session,s.created_at,false from auth.sessions s where s.id=v_session
    on conflict(device_id) do update set user_id=excluded.user_id,session_id=excluded.session_id,signed_in_at=excluded.signed_in_at,logged_out=false
    where (excluded.signed_in_at,excluded.session_id)>(chat_push_device_owners.signed_in_at,chat_push_device_owners.session_id);
    if exists(select 1 from chat_push_device_owners where device_id=p_device and session_id=v_session and user_id=v_user and not logged_out) then
        if exists(select 1 from web_push_subscriptions where device_id=p_device and user_id is distinct from v_user) then
            update chat_push_deliveries set status='revoked',lease_token=null,lease_until=null
            where subscription_id in(select id from web_push_subscriptions where device_id=p_device)
              and user_id<>v_user and status in('pending','processing');
            update web_push_subscriptions set user_id=v_user,binding_version=binding_version+1
            where device_id=p_device and user_id is distinct from v_user;
        end if;
    end if;
    if not p_list then return jsonb_build_object('recorded',true); end if;

    with sessions as (
        select s.id,d.device_id,coalesce(d.user_agent,s.user_agent) user_agent,
            max(s.created_at) over(partition by coalesce(d.device_id,s.id)) signed_in_at,
            max(coalesce(d.last_seen_at,s.created_at)) over(partition by coalesce(d.device_id,s.id)) last_seen_at,
            s.id=v_session is_current,
            row_number() over(partition by coalesce(d.device_id,s.id)
                order by (s.id=v_session) desc, coalesce(d.last_seen_at,s.created_at) desc,s.id desc) position
        from auth.sessions s left join public.account_session_devices d on d.session_id=s.id and d.user_id=v_user
        where s.user_id=v_user and (s.not_after is null or s.not_after>now())
    ), devices as (
        select s.id,s.user_agent,s.last_seen_at,s.signed_in_at,s.is_current,
            case when s.device_id is null then null else exists(
                select 1 from public.web_push_subscriptions p where p.device_id=s.device_id
            ) end notifications_enabled
        from sessions s where position=1 order by last_seen_at desc,id desc limit 100
    ) select coalesce(jsonb_agg(to_jsonb(devices) order by last_seen_at desc,id desc), '[]'::jsonb) into v_devices from devices;
    return jsonb_build_object('devices',v_devices);
end;
$$;
revoke all on function public.account_devices(uuid,text,boolean) from public,anon;
grant execute on function public.account_devices(uuid,text,boolean) to authenticated;

drop function public.register_chat_push_subscription(uuid,uuid,text,text,text,text,boolean);
create function public.register_chat_push_subscription(p_user uuid,p_device uuid,p_endpoint text,p_key text,p_auth text,p_agent text default null,p_reconcile boolean default false,p_recover boolean default false)
returns uuid language plpgsql security definer set search_path=public as $$
declare existing web_push_subscriptions; saved uuid;
begin
 perform pg_advisory_xact_lock(hashtextextended(p_device::text,2));
 if not exists(select 1 from chat_push_device_owners where device_id=p_device and user_id=p_user and not logged_out) then
  raise exception 'A newer account owns this installation' using errcode='42501';
 end if;
 perform pg_advisory_xact_lock(hashtextextended(p_endpoint,0));
 perform pg_advisory_xact_lock(hashtextextended(p_user::text||p_device::text,1));
 select * into existing from web_push_subscriptions where endpoint=p_endpoint for update;
 if existing.id is not null and existing.device_id<>p_device and (existing.p256dh<>p_key or existing.auth<>p_auth) then
  raise exception 'Subscription belongs to another account' using errcode='42501';
 end if;
 if p_reconcile and not exists(select 1 from chat_push_installations where device_id=p_device and notifications_enabled)
    and not (p_recover and not exists(select 1 from chat_push_installations where device_id=p_device)) then
  raise exception 'Device must be explicitly enabled' using errcode='42501';
 end if;
 insert into chat_push_installations(device_id,notifications_enabled) values(p_device,true)
 on conflict(device_id) do update set notifications_enabled=true;
 insert into web_push_subscriptions(user_id,device_id,endpoint,p256dh,auth,user_agent)
 values(p_user,p_device,p_endpoint,p_key,p_auth,p_agent)
 on conflict(endpoint) do update set user_id=excluded.user_id,device_id=excluded.device_id,p256dh=excluded.p256dh,auth=excluded.auth,user_agent=excluded.user_agent,updated_at=now(),failure_count=0,
 binding_version=web_push_subscriptions.binding_version+case when (web_push_subscriptions.user_id,web_push_subscriptions.device_id) is distinct from (excluded.user_id,excluded.device_id) then 1 else 0 end
 returning id into saved;
 -- Delete obsolete endpoints only after the replacement is safely stored in
 -- this same transaction. Re-saving the same endpoint preserves its job IDs.
 delete from web_push_subscriptions where device_id=p_device and id<>saved;
 return saved;
end $$;
revoke all on function public.register_chat_push_subscription(uuid,uuid,text,text,text,text,boolean,boolean) from public,anon,authenticated;
grant execute on function public.register_chat_push_subscription(uuid,uuid,text,text,text,text,boolean,boolean) to service_role;

create or replace function public.revoke_chat_push_device(p_device uuid,p_user uuid default null)
returns void language plpgsql security definer set search_path=public as $$
begin
 perform pg_advisory_xact_lock(hashtextextended(p_device::text,2));
 -- Old application logout calls omit p_user; preserve consent during rollout.
 if p_user is null then perform pause_chat_push_device(p_device); return; end if;
 -- Explicit off is installation-wide, regardless of which account is active.
 insert into chat_push_installations(device_id,notifications_enabled) values(p_device,false)
 on conflict(device_id) do update set notifications_enabled=false;
 delete from web_push_subscriptions where device_id=p_device;
end $$;
revoke all on function public.revoke_chat_push_device(uuid,uuid) from public,anon,authenticated;
grant execute on function public.revoke_chat_push_device(uuid,uuid) to service_role;
create function public.pause_chat_push_device(p_device uuid)
returns void language plpgsql security definer set search_path=public as $$
begin
 perform pg_advisory_xact_lock(hashtextextended(p_device::text,2));
 insert into chat_push_device_owners(device_id,user_id,session_id,signed_in_at,logged_out)
 values(p_device,null,'00000000-0000-0000-0000-000000000000',now(),true)
 on conflict(device_id) do update set logged_out=true,signed_in_at=greatest(chat_push_device_owners.signed_in_at,excluded.signed_in_at);
 -- The logout fence also covers a device whose first observation is in flight.
 update web_push_subscriptions set user_id=null,binding_version=binding_version+1 where device_id=p_device;
 -- Fence queued alerts permanently; signing back into the same account must
 -- not revive messages from the previous login interval.
 update chat_push_deliveries set status='revoked',lease_token=null,lease_until=null
 where subscription_id in(select id from web_push_subscriptions where device_id=p_device)
 and status in('pending','processing');
end $$;
revoke all on function public.pause_chat_push_device(uuid) from public,anon,authenticated;
grant execute on function public.pause_chat_push_device(uuid) to service_role;
create function public.chat_push_device_status(p_device uuid)
returns jsonb language sql stable security definer set search_path=public as $$
 select jsonb_build_object(
  'enabled',(select notifications_enabled from chat_push_installations where device_id=p_device),
  'subscription',(select jsonb_build_object('endpoint',endpoint,'p256dh',p256dh,'auth',auth)
    from web_push_subscriptions where device_id=p_device order by updated_at desc,id desc limit 1)
 );
$$;
revoke all on function public.chat_push_device_status(uuid) from public,anon,authenticated;
grant execute on function public.chat_push_device_status(uuid) to service_role;
create or replace function public.enqueue_message_chat_push() returns trigger
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
 insert into chat_push_deliveries(workspace_id,conversation_kind,conversation_id,message_id,message_created_at,user_id,subscription_id,binding_version)
 select new.workspace_id,kind,conversation,new.id,new.created_at,r.user_id,s.id,s.binding_version
 from chat_push_recipients(new.workspace_id,kind,conversation) r join web_push_subscriptions s on s.user_id=r.user_id
 where r.user_id is distinct from sender and (resolver is null or r.user_id=resolver)
 on conflict do nothing;
 return new;
end $$;
create or replace function public.claim_chat_push_deliveries(p_message uuid default null,p_user uuid default null,p_limit integer default 50)
returns setof public.chat_push_deliveries language plpgsql security definer set search_path=public as $$
begin
 -- Serialize short claims, not provider calls. A stream may have only one
 -- leased delivery so an older send cannot overwrite a newer notification.
 perform pg_advisory_xact_lock(hashtextextended('chat_push_claim',0));
 return query with candidates as (
  select q.id from chat_push_deliveries q where ((status='pending' and available_at<=now()) or(status='processing' and lease_until<now()))
   and(p_message is null or message_id=p_message) and(p_user is null or user_id=p_user)
   and not exists(select 1 from chat_push_deliveries other where other.subscription_id=q.subscription_id and other.conversation_kind=q.conversation_kind and other.conversation_id=q.conversation_id
    and other.id<>q.id and other.binding_version=q.binding_version and other.status='processing' and other.lease_until>now())
   and not exists(select 1 from chat_push_deliveries newer where newer.subscription_id=q.subscription_id and newer.conversation_kind=q.conversation_kind and newer.conversation_id=q.conversation_id
    and newer.binding_version=q.binding_version and newer.status='pending' and newer.available_at<=now() and (newer.message_created_at,newer.message_id)>(q.message_created_at,q.message_id))
  order by available_at,id for update skip locked limit greatest(1,least(p_limit,100))
 ) update chat_push_deliveries d set status='processing',lease_token=gen_random_uuid(),lease_until=now()+interval '90 seconds',attempts=attempts+1
 from candidates c where d.id=c.id returning d.*;
end $$;

-- Recheck membership and the particular message at dispatch, including on retries.
-- A fresh activity lease defers a durable job; it never discards the notification.
create or replace function public.prepare_chat_push_delivery(p_id uuid,p_lease uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare d chat_push_deliveries; read_at timestamptz; read_id uuid; active_at timestamptz; outcome text; unread_count integer;
begin
 select * into d from chat_push_deliveries where id=p_id and lease_token=p_lease and status='processing' and lease_until>now() for update;
 if not found then return jsonb_build_object('state','stale');end if;
 if d.subscription_id is null or not exists(select 1 from web_push_subscriptions s where s.id=d.subscription_id and s.user_id=d.user_id and s.binding_version=d.binding_version)
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
  and newer.binding_version=d.binding_version and newer.status in('pending','processing','accepted') and (newer.message_created_at,newer.message_id)>(d.message_created_at,d.message_id)) then outcome:='superseded';end if;
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

revoke all on function public.enqueue_message_chat_push() from public,anon,authenticated;
revoke all on function public.claim_chat_push_deliveries(uuid,uuid,integer) from public,anon,authenticated;
revoke all on function public.prepare_chat_push_delivery(uuid,uuid) from public,anon,authenticated;
grant execute on function public.claim_chat_push_deliveries(uuid,uuid,integer) to service_role;
grant execute on function public.prepare_chat_push_delivery(uuid,uuid) to service_role;
notify pgrst,'reload schema';
commit;
