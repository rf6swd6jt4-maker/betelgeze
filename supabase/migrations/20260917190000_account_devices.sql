-- Browser installations are associated with real Auth sessions, never inferred
-- from a push subscription or a user-agent match. No tokens leave this function.
create table public.account_session_devices (
    session_id uuid primary key references auth.sessions(id) on delete cascade,
    user_id uuid not null references auth.users(id) on delete cascade,
    device_id uuid not null,
    user_agent text,
    last_seen_at timestamptz not null default now()
);
create index account_session_devices_user_device_idx on public.account_session_devices(user_id, device_id);
alter table public.account_session_devices enable row level security;
revoke all on public.account_session_devices from anon, authenticated;

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
    insert into public.account_session_devices(session_id,user_id,device_id,user_agent,last_seen_at)
    values(v_session,v_user,p_device,left(p_agent,500),now())
    on conflict(session_id) do update set device_id=excluded.device_id,user_agent=excluded.user_agent,last_seen_at=excluded.last_seen_at
    where account_session_devices.device_id is distinct from excluded.device_id
       or account_session_devices.user_agent is distinct from excluded.user_agent
       or account_session_devices.last_seen_at<now()-interval '5 minutes';
    if not p_list then return jsonb_build_object('recorded',true); end if;

    with sessions as (
        select s.id,d.device_id,coalesce(d.user_agent,s.user_agent) user_agent,
            greatest(d.last_seen_at,s.refreshed_at at time zone 'UTC',s.updated_at,s.created_at) last_seen_at,
            s.id=v_session is_current,
            row_number() over(partition by coalesce(d.device_id,s.id)
                order by (s.id=v_session) desc, greatest(d.last_seen_at,s.refreshed_at at time zone 'UTC',s.updated_at,s.created_at) desc) position
        from auth.sessions s left join public.account_session_devices d on d.session_id=s.id and d.user_id=v_user
        where s.user_id=v_user and (s.not_after is null or s.not_after>now())
    ), devices as (
        select s.id,s.user_agent,s.last_seen_at,s.is_current,
            case when s.device_id is null then null else exists(
                select 1 from public.web_push_subscriptions p where p.user_id=v_user and p.device_id=s.device_id
            ) end notifications_enabled
        from sessions s where position=1 order by is_current desc,last_seen_at desc limit 100
    ) select coalesce(jsonb_agg(to_jsonb(devices)), '[]'::jsonb) into v_devices from devices;
    return jsonb_build_object('devices',v_devices);
end;
$$;
revoke all on function public.account_devices(uuid,text,boolean) from public,anon;
grant execute on function public.account_devices(uuid,text,boolean) to authenticated;
