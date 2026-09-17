-- Last verified sign-in owns this installation until explicit logout/off.
begin;
-- Preserve the last sign-in even when Auth later expires/deletes its session.
create table public.chat_push_device_owners (
 device_id uuid primary key,
 user_id uuid not null references auth.users(id) on delete cascade,
 session_id uuid not null,
 signed_in_at timestamptz not null
);
alter table public.chat_push_device_owners enable row level security;
revoke all on public.chat_push_device_owners from public,anon,authenticated;
grant all on public.chat_push_device_owners to service_role;
insert into public.chat_push_device_owners(device_id,user_id,session_id,signed_in_at)
select distinct on(d.device_id) d.device_id,s.user_id,s.id,s.created_at
from public.account_session_devices d join auth.sessions s on s.id=d.session_id
order by d.device_id,s.created_at desc,s.id desc;
create index if not exists account_session_devices_device_idx on public.account_session_devices(device_id,session_id);
create index if not exists web_push_subscriptions_device_idx on public.web_push_subscriptions(device_id);
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
       or account_session_devices.last_seen_at<now()-interval '5 minutes';
    -- The last verified sign-in owns enabled notifications on this installation.
    -- Expiry/closing does not revoke push. Older live tabs cannot take it back.
    insert into chat_push_device_owners(device_id,user_id,session_id,signed_in_at)
    select p_device,v_user,v_session,s.created_at from auth.sessions s where s.id=v_session
    on conflict(device_id) do update set user_id=excluded.user_id,session_id=excluded.session_id,signed_in_at=excluded.signed_in_at
    where (excluded.signed_in_at,excluded.session_id)>(chat_push_device_owners.signed_in_at,chat_push_device_owners.session_id);
    if exists(select 1 from chat_push_device_owners where device_id=p_device and session_id=v_session and user_id=v_user) then
        update web_push_subscriptions set user_id=v_user
        where device_id=p_device and user_id<>v_user;
    end if;
    if not p_list then return jsonb_build_object('recorded',true); end if;

    with sessions as (
        select s.id,d.device_id,coalesce(d.user_agent,s.user_agent) user_agent,
            max(s.created_at) over(partition by coalesce(d.device_id,s.id)) signed_in_at,
            greatest(d.last_seen_at,s.refreshed_at at time zone 'UTC',s.updated_at,s.created_at) last_seen_at,
            s.id=v_session is_current,
            row_number() over(partition by coalesce(d.device_id,s.id)
                order by (s.id=v_session) desc, greatest(d.last_seen_at,s.refreshed_at at time zone 'UTC',s.updated_at,s.created_at) desc) position
        from auth.sessions s left join public.account_session_devices d on d.session_id=s.id and d.user_id=v_user
        where s.user_id=v_user and (s.not_after is null or s.not_after>now())
    ), devices as (
        select s.id,s.user_agent,s.last_seen_at,s.signed_in_at,s.is_current,
            case when s.device_id is null then null else exists(
                select 1 from public.web_push_subscriptions p where p.user_id=v_user and p.device_id=s.device_id
            ) end notifications_enabled
        from sessions s where position=1 order by signed_in_at desc,id desc limit 100
    ) select coalesce(jsonb_agg(to_jsonb(devices) order by signed_in_at desc,id desc), '[]'::jsonb) into v_devices from devices;
    return jsonb_build_object('devices',v_devices);
end;
$$;
revoke all on function public.account_devices(uuid,text,boolean) from public,anon;
grant execute on function public.account_devices(uuid,text,boolean) to authenticated;

create or replace function public.register_chat_push_subscription(p_user uuid,p_device uuid,p_endpoint text,p_key text,p_auth text,p_agent text default null,p_reconcile boolean default false)
returns uuid language plpgsql security definer set search_path=public as $$
declare existing web_push_subscriptions; saved uuid;
begin
 perform pg_advisory_xact_lock(hashtextextended(p_device::text,2));
 if exists(select 1 from chat_push_device_owners where device_id=p_device and user_id<>p_user) then
  raise exception 'A newer account owns this installation' using errcode='42501';
 end if;
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
 delete from web_push_subscriptions where device_id=p_device and id<>saved;
 return saved;
end $$;
revoke all on function public.register_chat_push_subscription(uuid,uuid,text,text,text,text,boolean) from public,anon,authenticated;
grant execute on function public.register_chat_push_subscription(uuid,uuid,text,text,text,text,boolean) to service_role;

-- Explicit logout also works after the HTTP login has expired. The device
-- capability is an HTTP-only random cookie, never a caller-supplied remote ID.
create function public.revoke_chat_push_device(p_device uuid,p_user uuid default null)
returns void language plpgsql security definer set search_path=public as $$
begin
 perform pg_advisory_xact_lock(hashtextextended(p_device::text,2));
 delete from web_push_subscriptions where device_id=p_device and (p_user is null or user_id=p_user);
end $$;
revoke all on function public.revoke_chat_push_device(uuid,uuid) from public,anon,authenticated;
grant execute on function public.revoke_chat_push_device(uuid,uuid) to service_role;
notify pgrst,'reload schema';
commit;
