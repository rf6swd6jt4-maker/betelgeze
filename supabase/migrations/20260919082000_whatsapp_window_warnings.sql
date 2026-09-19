-- An internal Team-chat notice is not a client message and never goes to WA.
alter table public.workspace_native_messages
    add column if not exists system_notice_kind text
    check (system_notice_kind is null or system_notice_kind = 'whatsapp_window_warning');

create or replace function public.guard_native_system_message()
returns trigger language plpgsql set search_path = public as $$
declare
    conversation_record public.workspace_native_conversations%rowtype;
begin
    select * into conversation_record from public.workspace_native_conversations
    where workspace_id = new.workspace_id and id = new.conversation_id;
    if new.system_notice_kind is not null then
        if new.system_notice_kind <> 'whatsapp_window_warning'
           or new.sender_user_id is not null
           or current_user not in ('postgres', 'service_role')
           or not exists (
               select 1 from public.workspace_teams team
               where team.workspace_id = new.workspace_id
                 and team.id = conversation_record.team_id
                 and team.kind = 'relationship' and team.archived_at is null
           ) then raise exception 'Invalid internal Team notice'; end if;
        return new;
    end if;
    if conversation_record.is_system is distinct from (new.sender_user_id is null) then
        raise exception 'Invalid message sender for this conversation';
    end if;
    return new;
end;
$$;

drop trigger if exists guard_native_system_message on public.workspace_native_messages;
create trigger guard_native_system_message
before insert or update of conversation_id, sender_user_id, system_notice_kind
on public.workspace_native_messages
for each row execute function public.guard_native_system_message();

create table public.whatsapp_window_warnings (
    workspace_id uuid not null references public.workspaces(id) on delete cascade,
    relationship_id uuid not null references public.relationships(id) on delete cascade,
    inbound_at timestamptz not null,
    message_id uuid not null references public.workspace_native_messages(id) on delete cascade,
    created_at timestamptz not null default now(),
    primary key (workspace_id, relationship_id, inbound_at)
);
alter table public.whatsapp_window_warnings enable row level security;
revoke all on public.whatsapp_window_warnings from public, anon, authenticated;
grant select on public.whatsapp_window_warnings to service_role;

create or replace function public.enqueue_whatsapp_window_warnings()
returns integer language plpgsql security definer
set search_path = public as $$
declare
    item record;
    notice_id uuid;
    total integer := 0;
    notice_body text;
begin
    for item in
        select r.workspace_id, r.id relationship_id, r.primary_person_name,
               r.last_whatsapp_inbound_at, r.seller_user_id,
               r.fulfilment_manager_user_id, c.id conversation_id, w.slug
        from public.relationships r
        join public.workspaces w on w.id = r.workspace_id and w.status = 'active'
        join public.workspace_teams t on t.workspace_id = r.workspace_id
             and t.relationship_id = r.id and t.kind = 'relationship' and t.archived_at is null
        join public.workspace_native_conversations c on c.workspace_id = t.workspace_id
             and c.team_id = t.id and c.kind = 'team' and c.archived_at is null
        where r.status <> 'archived'
          and r.whatsapp_opted_out_at is null
          and r.seller_user_id is not null
          and r.fulfilment_manager_user_id is not null
          and r.last_whatsapp_inbound_at <= now() - interval '23 hours'
          and r.last_whatsapp_inbound_at > now() - interval '24 hours'
          -- An already answered inbound does not need an urgency notice.
          and coalesce((
              select m.created_at from public.client_messages m
              where m.workspace_id = r.workspace_id and m.relationship_id = r.id
                and m.direction = 'outbound'
                and m.sender_kind = 'staff'
                and (
                    (m.provider = 'meta_whatsapp' and m.status in ('sent', 'delivered', 'read', 'whatsapp_sent', 'whatsapp_delivered', 'whatsapp_read'))
                    or exists (
                        select 1 from public.communication_message_deliveries d
                        where d.client_message_id = m.id and d.provider = 'meta_whatsapp'
                          and d.status in ('sent', 'delivered', 'read')
                    )
                )
              order by m.created_at desc limit 1
          ), '-infinity'::timestamptz) < r.last_whatsapp_inbound_at
          and not exists (
              select 1 from public.whatsapp_window_warnings prior
              where prior.workspace_id = r.workspace_id
                and prior.relationship_id = r.id
                and prior.inbound_at = r.last_whatsapp_inbound_at
          )
        order by r.last_whatsapp_inbound_at, r.id
        limit 100
        for update of r skip locked
    loop
        notice_body := 'WhatsApp reply window for ' || left(item.primary_person_name, 80) ||
            ' closes in about ' ||
            greatest(1, ceil(extract(epoch from (item.last_whatsapp_inbound_at + interval '24 hours' - now())) / 60)::integer)::text ||
            ' minutes.' || E'\n' ||
            '@[Seller](mention:' || item.seller_user_id::text || ') ' ||
            '@[Manager](mention:' || item.fulfilment_manager_user_id::text || ')' || E'\n' ||
            'Client: /' || item.slug || '/relationships/' || item.relationship_id::text;
        insert into public.workspace_native_messages (
            workspace_id, conversation_id, sender_user_id, body, system_notice_kind
        ) values (
            item.workspace_id, item.conversation_id, null, notice_body,
            'whatsapp_window_warning'
        ) returning id into notice_id;
        insert into public.whatsapp_window_warnings (
            workspace_id, relationship_id, inbound_at, message_id
        ) values (
            item.workspace_id, item.relationship_id, item.last_whatsapp_inbound_at, notice_id
        );
        total := total + 1;
    end loop;
    return total;
end;
$$;
revoke all on function public.enqueue_whatsapp_window_warnings() from public, anon, authenticated;
grant execute on function public.enqueue_whatsapp_window_warnings() to service_role;

select cron.schedule(
    'whatsapp-window-warnings', '*/5 * * * *',
    'select public.enqueue_whatsapp_window_warnings();'
);
