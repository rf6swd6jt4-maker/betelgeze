-- Explicitly approved 9 October 2026: installation-local unread state,
-- while preserving account-level read receipts and existing RPC compatibility.
begin;

create table public.communication_read_cutover_installations (
    user_id uuid not null references auth.users(id) on delete cascade,
    device_id uuid not null,
    primary key (user_id, device_id)
);
create table public.communication_read_cutover_baselines (
    workspace_id uuid not null references public.workspaces(id) on delete cascade,
    user_id uuid not null references auth.users(id) on delete cascade,
    kind text not null check (kind in ('client', 'native')),
    conversation_id uuid not null,
    last_read_message_id uuid,
    last_read_at timestamptz not null,
    primary key (workspace_id, user_id, kind, conversation_id)
);
create table public.communication_device_read_scopes (
    workspace_id uuid not null references public.workspaces(id) on delete cascade,
    user_id uuid not null references auth.users(id) on delete cascade,
    device_id uuid not null,
    initialized_at timestamptz not null default now(),
    primary key (workspace_id, user_id, device_id)
);
create table public.communication_device_read_cursors (
    workspace_id uuid not null,
    user_id uuid not null,
    device_id uuid not null,
    kind text not null check (kind in ('client', 'native')),
    conversation_id uuid not null,
    last_read_message_id uuid,
    last_read_at timestamptz not null,
    primary key (workspace_id, user_id, device_id, kind, conversation_id),
    foreign key (workspace_id, user_id, device_id)
        references public.communication_device_read_scopes(workspace_id, user_id, device_id) on delete cascade
);
-- Message UUIDs intentionally have no FK: deletion cannot erase ordering ties.
-- No index is added to a populated message table during this migration.
alter table public.communication_read_cutover_installations enable row level security;
alter table public.communication_read_cutover_baselines enable row level security;
alter table public.communication_device_read_scopes enable row level security;
alter table public.communication_device_read_cursors enable row level security;
revoke all on public.communication_read_cutover_installations, public.communication_read_cutover_baselines,
    public.communication_device_read_scopes, public.communication_device_read_cursors from public, anon, authenticated, service_role;
grant select on public.communication_read_cutover_installations, public.communication_read_cutover_baselines,
    public.communication_device_read_scopes, public.communication_device_read_cursors to service_role;

-- One statement snapshot freezes both the known installation inventory and
-- account read boundaries. Sleeping installations never inherit later reads.
with installations as (
    insert into public.communication_read_cutover_installations(user_id, device_id)
    select user_id, device_id from public.account_session_devices
    union select user_id, device_id from public.web_push_subscriptions where user_id is not null
    union select user_id, device_id from public.chat_push_device_owners where user_id is not null
    returning user_id
)
insert into public.communication_read_cutover_baselines(workspace_id, user_id, kind, conversation_id, last_read_message_id, last_read_at)
select c.workspace_id, c.user_id, 'client', c.relationship_id, c.last_read_message_id, coalesce(m.created_at, c.last_read_at)
from public.communication_read_cursors c left join public.client_messages m
    on m.id=c.last_read_message_id and m.relationship_id=c.relationship_id and m.workspace_id=c.workspace_id
union all
select c.workspace_id, c.user_id, 'native', c.conversation_id, c.last_read_message_id, coalesce(m.created_at, c.last_read_at)
from public.workspace_native_read_cursors c left join public.workspace_native_messages m
    on m.id=c.last_read_message_id and m.conversation_id=c.conversation_id and m.workspace_id=c.workspace_id;

create function public.require_communication_device(p_workspace_id uuid, p_device_id uuid)
returns uuid language plpgsql stable security definer set search_path='' as $$
declare v_user uuid := auth.uid(); v_session uuid := nullif(auth.jwt()->>'session_id','')::uuid;
begin
    if auth.role() is distinct from 'authenticated' or v_user is null or p_device_id is null
        or public.current_session_is_aal2() is not true
        or public.is_workspace_member(p_workspace_id) is not true
        or not exists(select 1 from auth.sessions s where s.id=v_session and s.user_id=v_user and (s.not_after is null or s.not_after>now())) then
        raise insufficient_privilege;
    end if;
    if not exists(select 1 from public.account_session_devices d
        where d.session_id=v_session and d.user_id=v_user and d.device_id=p_device_id) then
        -- The existing account-device observation must finish first. This RPC
        -- neither invents an installation nor changes notification ownership.
        raise no_data_found;
    end if;
    return v_user;
end $$;

create function public.initialize_communication_device_scope(p_workspace_id uuid, p_user_id uuid, p_device_id uuid)
returns void language plpgsql security definer set search_path='' as $$
begin
    if exists(select 1 from public.communication_device_read_scopes where workspace_id=p_workspace_id and user_id=p_user_id and device_id=p_device_id) then return; end if;
    -- INSERT serializes a concurrent first summary/read on this exact scope.
    -- Marker and copied cursors commit together; failure cannot leave an empty seed.
    insert into public.communication_device_read_scopes(workspace_id,user_id,device_id)
    values(p_workspace_id,p_user_id,p_device_id) on conflict do nothing;
    if not found then return; end if;
    if exists(select 1 from public.communication_read_cutover_installations where user_id=p_user_id and device_id=p_device_id) then
        insert into public.communication_device_read_cursors(workspace_id,user_id,device_id,kind,conversation_id,last_read_message_id,last_read_at)
        select workspace_id,user_id,p_device_id,kind,conversation_id,last_read_message_id,last_read_at
        from public.communication_read_cutover_baselines where workspace_id=p_workspace_id and user_id=p_user_id;
    else
        insert into public.communication_device_read_cursors(workspace_id,user_id,device_id,kind,conversation_id,last_read_message_id,last_read_at)
        select c.workspace_id,c.user_id,p_device_id,'client',c.relationship_id,c.last_read_message_id,coalesce(m.created_at,c.last_read_at)
        from public.communication_read_cursors c left join public.client_messages m
            on m.id=c.last_read_message_id and m.relationship_id=c.relationship_id and m.workspace_id=c.workspace_id
        where c.workspace_id=p_workspace_id and c.user_id=p_user_id
        union all
        select c.workspace_id,c.user_id,p_device_id,'native',c.conversation_id,c.last_read_message_id,coalesce(m.created_at,c.last_read_at)
        from public.workspace_native_read_cursors c left join public.workspace_native_messages m
            on m.id=c.last_read_message_id and m.conversation_id=c.conversation_id and m.workspace_id=c.workspace_id
        where c.workspace_id=p_workspace_id and c.user_id=p_user_id;
    end if;
end $$;

create function public.communication_device_unread_summary(p_workspace_id uuid, p_device_id uuid, p_include_cursors boolean default true)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_user uuid; result jsonb;
begin
    v_user:=public.require_communication_device(p_workspace_id,p_device_id);
    perform public.initialize_communication_device_scope(p_workspace_id,v_user,p_device_id);
    with readable as materialized (
        select 'client'::text kind,r.id from public.relationships r where r.workspace_id=p_workspace_id and r.status<>'archived'
            and public.client_conversation_can_access(p_workspace_id,r.id,v_user)
        union all
        select 'native',c.id from public.workspace_native_conversations c where c.workspace_id=p_workspace_id and public.native_conversation_can_read(c.id,v_user)
    ), boundaries as materialized (
        select r.kind,r.id,c.last_read_at,c.last_read_message_id
        from readable r left join public.communication_device_read_cursors c
            on c.workspace_id=p_workspace_id and c.user_id=v_user and c.device_id=p_device_id and c.kind=r.kind and c.conversation_id=r.id
    ), counts as (
        select r.kind,r.id,u.* from boundaries r cross join lateral (
            select count(*)::int count,(array_agg(m.id order by m.created_at desc,m.id desc))[1] latest_id,max(m.created_at) latest_at
            from(select m.id,m.created_at from public.client_messages m
                where r.kind='client' and m.workspace_id=p_workspace_id and m.relationship_id=r.id and m.direction='inbound'
                    and (m.created_at,m.id)>(coalesce(r.last_read_at,'-infinity'::timestamptz),coalesce(r.last_read_message_id,'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid))
                order by m.created_at desc,m.id desc limit 100) m where r.kind='client'
            union all
            select count(*)::int,(array_agg(m.id order by m.created_at desc,m.id desc))[1],max(m.created_at)
            from(select m.id,m.created_at from public.workspace_native_messages m
                left join public.workspace_native_conversation_visibility v on v.conversation_id=r.id and v.user_id=v_user
                where r.kind='native' and m.workspace_id=p_workspace_id and m.conversation_id=r.id and m.sender_user_id is distinct from v_user
                    and (m.created_at,m.id)>(coalesce(r.last_read_at,'-infinity'::timestamptz),coalesce(r.last_read_message_id,'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid))
                    and m.created_at>coalesce(v.cleared_at,'-infinity'::timestamptz)
                order by m.created_at desc,m.id desc limit 100) m where r.kind='native'
        ) u
    )
    select jsonb_build_object('deviceId',p_device_id,'cursorsIncluded',coalesce(p_include_cursors,false),
        'conversations',coalesce((select jsonb_agg(jsonb_build_object('kind',kind,'conversationId',id,'count',count,'latestMessageId',latest_id,'latestMessageAt',latest_at)) from counts where count>0),'[]'::jsonb))
        || case when p_include_cursors then jsonb_build_object('readCursors',coalesce((select jsonb_agg(jsonb_build_object('workspaceId',p_workspace_id,'userId',v_user,'deviceId',p_device_id,'kind',kind,'conversationId',id,'lastReadAt',last_read_at,'lastReadMessageId',last_read_message_id)) from boundaries where last_read_at is not null),'[]'::jsonb)) else '{}'::jsonb end into result;
    return result;
end $$;

create function public.advance_communication_device_read(p_workspace_id uuid,p_device_id uuid,p_kind text,p_conversation_id uuid,p_message_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_user uuid; target_at timestamptz; previous_at timestamptz; previous_id uuid; device_at timestamptz; device_message uuid;
begin
    v_user:=public.require_communication_device(p_workspace_id,p_device_id);
    if p_kind='client' then
        if public.client_conversation_can_access(p_workspace_id,p_conversation_id,v_user) is not true then raise insufficient_privilege; end if;
        select created_at into target_at from public.client_messages where workspace_id=p_workspace_id and relationship_id=p_conversation_id and id=p_message_id;
    elsif p_kind='native' then
        if public.native_conversation_can_read(p_conversation_id,v_user) is not true then raise insufficient_privilege; end if;
        select created_at into target_at from public.workspace_native_messages where workspace_id=p_workspace_id and conversation_id=p_conversation_id and id=p_message_id;
    else raise invalid_parameter_value; end if;
    if target_at is null then raise invalid_parameter_value; end if;
    perform public.initialize_communication_device_scope(p_workspace_id,v_user,p_device_id);
    -- Same lock as advance_communication_read, preserving mixed-version atomicity.
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_user::text||':'||p_kind||':'||p_conversation_id::text,0));
    insert into public.communication_device_read_cursors(workspace_id,user_id,device_id,kind,conversation_id,last_read_message_id,last_read_at)
    values(p_workspace_id,v_user,p_device_id,p_kind,p_conversation_id,p_message_id,target_at)
    on conflict(workspace_id,user_id,device_id,kind,conversation_id) do update set last_read_message_id=excluded.last_read_message_id,last_read_at=excluded.last_read_at
    where (excluded.last_read_at,excluded.last_read_message_id)>(communication_device_read_cursors.last_read_at,coalesce(communication_device_read_cursors.last_read_message_id,'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid));
    select last_read_at,last_read_message_id into device_at,device_message from public.communication_device_read_cursors
        where workspace_id=p_workspace_id and user_id=v_user and device_id=p_device_id and kind=p_kind and conversation_id=p_conversation_id;
    -- Account cursors remain the shared human read receipt, never device unread state.
    if p_kind='client' then
        select c.last_read_message_id,coalesce(m.created_at,c.last_read_at) into previous_id,previous_at
        from public.communication_read_cursors c left join public.client_messages m on m.id=c.last_read_message_id and m.relationship_id=p_conversation_id
        where c.workspace_id=p_workspace_id and c.relationship_id=p_conversation_id and c.user_id=v_user;
        if previous_at is null or (target_at,p_message_id)>(previous_at,coalesce(previous_id,'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid)) then
            insert into public.communication_read_cursors(workspace_id,relationship_id,user_id,last_read_message_id,last_read_at)
            values(p_workspace_id,p_conversation_id,v_user,p_message_id,target_at)
            on conflict(workspace_id,relationship_id,user_id) do update set last_read_message_id=excluded.last_read_message_id,last_read_at=excluded.last_read_at;
            previous_id:=p_message_id; previous_at:=target_at;
        end if;
    else
        select c.last_read_message_id,coalesce(m.created_at,c.last_read_at) into previous_id,previous_at
        from public.workspace_native_read_cursors c left join public.workspace_native_messages m on m.id=c.last_read_message_id and m.conversation_id=p_conversation_id
        where c.workspace_id=p_workspace_id and c.conversation_id=p_conversation_id and c.user_id=v_user;
        if previous_at is null or (target_at,p_message_id)>(previous_at,coalesce(previous_id,'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid)) then
            insert into public.workspace_native_read_cursors(workspace_id,conversation_id,user_id,last_read_message_id,last_read_at)
            values(p_workspace_id,p_conversation_id,v_user,p_message_id,target_at)
            on conflict(conversation_id,user_id) do update set last_read_message_id=excluded.last_read_message_id,last_read_at=excluded.last_read_at;
            previous_id:=p_message_id; previous_at:=target_at;
        end if;
    end if;
    return jsonb_build_object('deviceId',p_device_id,
        'deviceCursor',jsonb_build_object('workspaceId',p_workspace_id,'userId',v_user,'deviceId',p_device_id,'kind',p_kind,'conversationId',p_conversation_id,'lastReadAt',device_at,'lastReadMessageId',device_message),
        'cursor',jsonb_build_object('workspaceId',p_workspace_id,'userId',v_user,'kind',p_kind,'conversationId',p_conversation_id,'lastReadAt',previous_at,'lastReadMessageId',previous_id));
end $$;

revoke all on function public.require_communication_device(uuid,uuid), public.initialize_communication_device_scope(uuid,uuid,uuid),
    public.communication_device_unread_summary(uuid,uuid,boolean), public.advance_communication_device_read(uuid,uuid,text,uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.communication_device_unread_summary(uuid,uuid,boolean), public.advance_communication_device_read(uuid,uuid,text,uuid,uuid) to authenticated;
notify pgrst,'reload schema';
commit;
