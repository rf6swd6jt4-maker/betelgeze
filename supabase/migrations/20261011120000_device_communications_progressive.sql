-- Approved 11 October 2026: installation-local unread state with progressive previews,
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

create function public.communication_device_unread_summary(p_workspace_id uuid, p_device_id uuid, p_include_cursors boolean default false)
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
-- A single authorized roster snapshot supplies ordering without decrypting bodies.
create function public.communication_device_roster(p_workspace_id uuid,p_device_id uuid,p_kind text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_user uuid; v_items jsonb;
begin
    v_user:=public.require_communication_device(p_workspace_id,p_device_id);
    if p_kind not in ('client','native') or p_kind is null then raise invalid_parameter_value; end if;
    perform public.initialize_communication_device_scope(p_workspace_id,v_user,p_device_id);
    if p_kind='client' then
        select coalesce(jsonb_agg(jsonb_build_object('conversationId',r.id,'latestMessageAt',m.created_at,'latestMessageId',m.id)),'[]'::jsonb) into v_items
        from public.relationships r left join lateral (
            select m.id,m.created_at from public.client_messages m
            where m.workspace_id=p_workspace_id and m.relationship_id=r.id
            order by m.created_at desc,m.id desc limit 1
        ) m on true
        where r.workspace_id=p_workspace_id and r.status<>'archived'
            and public.client_conversation_can_access(p_workspace_id,r.id,v_user);
    else
        select coalesce(jsonb_agg(jsonb_build_object('conversationId',r.id,'latestMessageAt',m.created_at,'latestMessageId',m.id)),'[]'::jsonb) into v_items
        from public.workspace_native_conversations r left join lateral (
            select m.id,m.created_at from public.workspace_native_messages m
            where m.workspace_id=p_workspace_id and m.conversation_id=r.id
                and not exists(select 1 from public.workspace_native_conversation_visibility v
                    where v.conversation_id=r.id and v.user_id=v_user and m.created_at<=v.cleared_at)
            order by m.created_at desc,m.id desc limit 1
        ) m on true
        where r.workspace_id=p_workspace_id and public.native_conversation_can_read(r.id,v_user);
    end if;
    return jsonb_build_object('deviceId',p_device_id,'items',v_items);
end $$;

-- Internal decoder wrapper: use the canonical authorized Vault decoders and
-- enrich only this bounded window with existing delivery/edit metadata.
create function public.communication_device_message_window(p_workspace_id uuid,p_kind text,p_conversation_id uuid,p_limit integer)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_messages jsonb;
begin
    if p_kind='client' then
        select coalesce(jsonb_agg(to_jsonb(m)||jsonb_build_object('deliveries',coalesce(d.items,'[]'::jsonb)) order by m.created_at desc,m.id desc),'[]'::jsonb) into v_messages
        from public.communication_client_messages_bounded(p_workspace_id,p_conversation_id,least(greatest(p_limit,1),500)) m
        left join lateral (
            select jsonb_agg(jsonb_build_object('provider',d.provider,'provider_message_id',d.provider_message_id,'status',d.status,'error',d.error,
                'sent_at',d.sent_at,'delivered_at',d.delivered_at,'read_at',d.read_at,'failed_at',d.failed_at) order by d.created_at) items
            from public.communication_message_deliveries d where d.workspace_id=p_workspace_id and d.client_message_id=m.id
        ) d on true;
    elsif p_kind='native' then
        select coalesce(jsonb_agg(to_jsonb(m)||jsonb_build_object('edited_at',raw.edited_at) order by m.created_at desc,m.id desc),'[]'::jsonb) into v_messages
        from public.communication_native_messages_bounded(p_workspace_id,p_conversation_id,least(greatest(p_limit,1),60)) m
        join public.workspace_native_messages raw on raw.workspace_id=p_workspace_id and raw.conversation_id=p_conversation_id and raw.id=m.id;
    else raise invalid_parameter_value; end if;
    return v_messages;
end $$;

create function public.communication_device_history(p_workspace_id uuid,p_device_id uuid,p_kind text,p_conversation_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_user uuid; v_cursor jsonb; v_messages jsonb;
begin
    v_user:=public.require_communication_device(p_workspace_id,p_device_id);
    if p_kind='client' then
        if public.client_conversation_can_access(p_workspace_id,p_conversation_id,v_user) is not true then raise insufficient_privilege; end if;
    elsif p_kind='native' then
        if not exists(select 1 from public.workspace_native_conversations where id=p_conversation_id and workspace_id=p_workspace_id)
            or public.native_conversation_can_read(p_conversation_id,v_user) is not true then raise insufficient_privilege; end if;
    else raise invalid_parameter_value; end if;
    perform public.initialize_communication_device_scope(p_workspace_id,v_user,p_device_id);
    select jsonb_build_object('lastReadAt',last_read_at,'lastReadMessageId',last_read_message_id) into v_cursor
    from public.communication_device_read_cursors where workspace_id=p_workspace_id and user_id=v_user and device_id=p_device_id and kind=p_kind and conversation_id=p_conversation_id;
    v_messages:=public.communication_device_message_window(p_workspace_id,p_kind,p_conversation_id,case when p_kind='client' then 500 else 60 end);
    return jsonb_build_object('deviceId',p_device_id,'cursorKnown',true,'deviceCursor',v_cursor,'messages',v_messages);
end $$;

create function public.communication_device_preview_batch(p_workspace_id uuid,p_device_id uuid,p_kind text,p_ids uuid[])
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_user uuid; v_id uuid; v_cursor jsonb; v_messages jsonb; v_items jsonb:='[]'::jsonb;
begin
    v_user:=public.require_communication_device(p_workspace_id,p_device_id);
    if p_kind not in ('client','native') or p_kind is null or p_ids is null or cardinality(p_ids)<1 or cardinality(p_ids)>20
        or exists(select 1 from unnest(p_ids) x where x is null)
        or (select count(distinct x) from unnest(p_ids) x)<>cardinality(p_ids) then raise invalid_parameter_value; end if;
    -- Authorize the complete batch before decoding any body or initializing.
    foreach v_id in array p_ids loop
        if p_kind='client' then
            if public.client_conversation_can_access(p_workspace_id,v_id,v_user) is not true then raise insufficient_privilege; end if;
        else
            if not exists(select 1 from public.workspace_native_conversations where id=v_id and workspace_id=p_workspace_id)
                or public.native_conversation_can_read(v_id,v_user) is not true then raise insufficient_privilege; end if;
        end if;
    end loop;
    perform public.initialize_communication_device_scope(p_workspace_id,v_user,p_device_id);
    foreach v_id in array p_ids loop
        select jsonb_build_object('lastReadAt',last_read_at,'lastReadMessageId',last_read_message_id) into v_cursor
        from public.communication_device_read_cursors where workspace_id=p_workspace_id and user_id=v_user and device_id=p_device_id and kind=p_kind and conversation_id=v_id;
        v_messages:=public.communication_device_message_window(p_workspace_id,p_kind,v_id,1);
        v_items:=v_items||jsonb_build_array(jsonb_build_object('kind',p_kind,'conversationId',v_id,'cursorKnown',true,'deviceCursor',v_cursor,'preview',v_messages->0));
    end loop;
    return jsonb_build_object('deviceId',p_device_id,'items',v_items);
end $$;
revoke all on function public.communication_device_roster(uuid,uuid,text), public.communication_device_message_window(uuid,text,uuid,integer),
    public.communication_device_history(uuid,uuid,text,uuid), public.communication_device_preview_batch(uuid,uuid,text,uuid[]) from public,anon,authenticated,service_role;
grant execute on function public.communication_device_roster(uuid,uuid,text), public.communication_device_history(uuid,uuid,text,uuid),
    public.communication_device_preview_batch(uuid,uuid,text,uuid[]) to authenticated;
-- Explicit on-demand preview search. Each page decrypts at most twenty
-- authorized latest previews; the browser cancels paging when the query changes.
create function public.communication_device_preview_search(p_workspace_id uuid,p_device_id uuid,p_kind text,p_search text,p_after uuid default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_user uuid; v_ids uuid[]; v_id uuid; v_preview jsonb; v_candidates jsonb:='[]'::jsonb; v_next uuid;
begin
    v_user:=public.require_communication_device(p_workspace_id,p_device_id);
    if p_kind not in ('client','native') or p_kind is null or p_search is null or length(btrim(p_search))<1 or length(p_search)>120 then raise invalid_parameter_value; end if;
    select array_agg(id order by id) into v_ids from (
        select r.id from public.relationships r where p_kind='client' and r.workspace_id=p_workspace_id and r.status<>'archived'
            and (p_after is null or r.id>p_after) and public.client_conversation_can_access(p_workspace_id,r.id,v_user)
        union all
        select c.id from public.workspace_native_conversations c where p_kind='native' and c.workspace_id=p_workspace_id
            and (p_after is null or c.id>p_after) and public.native_conversation_can_read(c.id,v_user)
        order by id limit 21
    ) readable;
    if coalesce(cardinality(v_ids),0)>20 then v_next:=v_ids[20]; v_ids:=v_ids[1:20]; end if;
    foreach v_id in array coalesce(v_ids,'{}'::uuid[]) loop
        v_preview:=public.communication_device_message_window(p_workspace_id,p_kind,v_id,1)->0;
        -- Return only this authorized page to the application server. It uses
        -- JavaScript case folding, preserving the existing UI search semantics
        -- independently of the database collation. Bodies never reach the
        -- browser search response.
        v_candidates:=v_candidates||jsonb_build_array(jsonb_build_object('conversationId',v_id,'body',coalesce(v_preview->>'body','')));
    end loop;
    return jsonb_build_object('deviceId',p_device_id,'candidates',v_candidates,'nextCursor',v_next);
end $$;
revoke all on function public.communication_device_preview_search(uuid,uuid,text,text,uuid) from public,anon,authenticated,service_role;
grant execute on function public.communication_device_preview_search(uuid,uuid,text,text,uuid) to authenticated;
notify pgrst,'reload schema';
commit;
