-- Leads in Comms (docs/comms-leads.md; authorized in app-alerts.md, 22 November 2026: "Just make it follow the same rules
-- as the rest of Comms right now and make it a third tab in Comms").
-- A lead's text conversation is a native conversation of kind 'lead'. Its messages are ordinary native messages, so
-- encryption, read cursors, the newest-visible reading rule, the unread summaries and Web Push apply unchanged. Its
-- participants (owners and admins with Campaigns, set by the server) read it and receive its alerts, like a Team chat's
-- members. A lead's inbound text has no staff sender (sms_direction 'inbound') and alerts like a client's inbound text.
-- Every function below is its latest definition with only the lead branch added; client and Team behaviour is unchanged.
-- Staff do not post into a lead conversation through the native send path: texts go out through SignalHouse and are
-- stored by the server (service role), so native_conversation_can_write stays false for lead conversations.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';

alter table public.workspace_native_conversations add column lead_id uuid references public.campaign_leads(id);
alter table public.workspace_native_conversations drop constraint workspace_native_conversations_kind_check;
alter table public.workspace_native_conversations add constraint workspace_native_conversations_kind_check check (kind in ('direct','team','lead'));
alter table public.workspace_native_conversations drop constraint workspace_native_conversations_check;
alter table public.workspace_native_conversations add constraint workspace_native_conversations_check check (
 (not is_system and kind='team' and team_id is not null and direct_user_one is null and direct_user_two is null and lead_id is null)
 or (not is_system and kind='direct' and team_id is null and direct_user_one is not null and direct_user_two is not null and direct_user_one::text < direct_user_two::text and lead_id is null)
 or (is_system and kind='direct' and team_id is null and direct_user_one is not null and direct_user_two is null and lead_id is null)
 or (not is_system and kind='lead' and lead_id is not null and team_id is null and direct_user_one is null and direct_user_two is null)
);
create unique index workspace_native_conversations_lead_unique on public.workspace_native_conversations(workspace_id,lead_id) where kind='lead';

-- Participants: a direct chat's declared pair (unchanged), or a lead conversation's owners and admins, added by the server.
create or replace function public.guard_native_direct_participant() returns trigger language plpgsql security definer set search_path=public as $$
begin
 if exists(select 1 from workspace_native_conversations c join workspace_memberships m on m.workspace_id=c.workspace_id and m.user_id=new.user_id
  where c.workspace_id=new.workspace_id and c.id=new.conversation_id and c.kind='lead' and m.role in('owner','admin')) then
  if auth.role() is distinct from 'service_role' and session_user<>'postgres' then
   raise exception 'Lead conversation participants are set by the server' using errcode='42501';
  end if;
  return new;
 end if;
 if not exists(select 1 from workspace_native_conversations c join workspace_memberships m on m.workspace_id=c.workspace_id and m.user_id=new.user_id
  where c.workspace_id=new.workspace_id and c.id=new.conversation_id and c.kind='direct' and new.user_id in(c.direct_user_one,c.direct_user_two)) then
  raise exception 'Only the declared direct-chat recipients may participate' using errcode='42501';
 end if;
 return new;
end $$;

-- A conversation's recipients, now including its lead, cannot be reassigned.
create or replace function public.guard_native_conversation_identity() returns trigger language plpgsql set search_path=public as $$
begin
 if (new.workspace_id,new.kind,new.direct_user_one,new.direct_user_two,new.team_id,new.lead_id) is distinct from (old.workspace_id,old.kind,old.direct_user_one,old.direct_user_two,old.team_id,old.lead_id) then
  raise exception 'A conversation cannot be reassigned to different recipients' using errcode='42501';
 end if;
 return new;
end $$;
drop trigger if exists guard_native_conversation_identity on public.workspace_native_conversations;
create trigger guard_native_conversation_identity before update of workspace_id,kind,direct_user_one,direct_user_two,team_id,lead_id on public.workspace_native_conversations for each row execute function public.guard_native_conversation_identity();

-- SMS facts for messages in a lead conversation. Null for every other message.
alter table public.workspace_native_messages
 add column sms_direction text check(sms_direction is null or sms_direction in('inbound','outbound')),
 add column sms_status text check(sms_status is null or length(sms_status)<=40),
 add column sms_error text check(sms_error is null or length(sms_error)<=300),
 add column sms_provider_message_id text check(sms_provider_message_id is null or length(sms_provider_message_id)<=100),
 add column sms_number_id uuid references public.campaign_sms_numbers(id);
alter table public.workspace_native_messages add constraint workspace_native_messages_sms_sender_check
 check(sms_direction is distinct from 'inbound' or sender_user_id is null);
create unique index workspace_native_messages_sms_provider_unique on public.workspace_native_messages(sms_provider_message_id) where sms_provider_message_id is not null;

-- Lead conversations accept a sender-less message only as a lead's inbound text, written by the server.
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
    if conversation_record.kind = 'lead' then
        if current_user not in ('postgres', 'service_role') then raise exception 'Lead texts are stored by the server'; end if;
        if (new.sender_user_id is null) is distinct from (new.sms_direction = 'inbound') then
            raise exception 'Invalid message sender for this conversation';
        end if;
        return new;
    end if;
    if new.sms_direction is not null then raise exception 'Only lead conversations carry texts'; end if;
    if conversation_record.is_system is distinct from (new.sender_user_id is null) then
        raise exception 'Invalid message sender for this conversation';
    end if;
    return new;
end;
$$;

drop trigger if exists guard_native_system_message on public.workspace_native_messages;
create trigger guard_native_system_message
before insert or update of conversation_id, sender_user_id, system_notice_kind, sms_direction
on public.workspace_native_messages
for each row execute function public.guard_native_system_message();

-- Reading: a lead conversation's participants.
create or replace function public.native_conversation_can_read(target_conversation uuid, target_user uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
    select public.current_session_is_aal2() and exists (
        select 1
        from public.workspace_native_conversations conversation
        join public.workspace_memberships membership
          on membership.workspace_id = conversation.workspace_id
         and membership.user_id = target_user
        where conversation.id = target_conversation
          and (target_user = auth.uid() or auth.role() = 'service_role')
          and (
            (conversation.kind = 'direct' and exists (
                select 1 from public.workspace_native_conversation_participants participant
                where participant.conversation_id = conversation.id and participant.user_id = target_user
            ))
            or
            (conversation.kind = 'team' and exists (
                select 1 from public.workspace_team_members team_member
                where team_member.team_id = conversation.team_id and team_member.user_id = target_user
            ))
            or
            (conversation.kind = 'lead' and exists (
                select 1 from public.workspace_native_conversation_participants participant
                where participant.conversation_id = conversation.id and participant.user_id = target_user
            ))
          )
    );
$$;

-- Alert recipients: a lead conversation's participants who are still workspace members.
create or replace function public.chat_push_recipients(p_workspace uuid,p_kind text,p_conversation uuid)
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
  select p.user_id from workspace_native_conversations c
  join workspace_native_conversation_participants p on p.conversation_id=c.id and p.workspace_id=c.workspace_id
  where p_kind='native' and c.workspace_id=p_workspace and c.id=p_conversation and c.kind='lead' and c.archived_at is null
  union all
  select roster.user_id from relationships r cross join lateral (
   select r.seller_user_id user_id union select r.fulfilment_manager_user_id
   union select extra.user_id from relationship_client_chat_members extra where extra.workspace_id=r.workspace_id and extra.relationship_id=r.id
  ) roster
  where p_kind='client' and r.workspace_id=p_workspace and r.id=p_conversation and r.status<>'archived'
   and public.client_conversation_can_access(p_workspace,p_conversation,roster.user_id)
 ) candidate join workspace_memberships m on m.workspace_id=p_workspace and m.user_id=candidate.user_id
$$;

-- A lead's inbound text alerts like a client's inbound message (no staff sender to exclude).
create or replace function public.enqueue_message_chat_push() returns trigger
language plpgsql security definer set search_path=public as $$
declare kind text; conversation uuid; sender uuid; resolver uuid;
begin
 if tg_table_name='workspace_native_messages' then
  kind:='native';conversation:=new.conversation_id;sender:=new.sender_user_id;
  -- System messages retain their existing explicit notification policy.
  if sender is null and new.sms_direction is distinct from 'inbound' then return new;end if;
  -- A text sent to a lead alerts nobody, like an outbound client message.
  if new.sms_direction='outbound' then return new;end if;
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

-- The preview count includes a lead's inbound texts (sender-less); other sender-less messages keep their old treatment.
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
  select count(*) into unread_count from(select 1 from workspace_native_messages where workspace_id=d.workspace_id and conversation_id=d.conversation_id and (case when sms_direction is not null then sms_direction='inbound' else sender_user_id<>d.user_id end) and (created_at,id)>(coalesce(read_at,'-infinity'::timestamptz),coalesce(read_id,'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid)) limit 100) unread;
 else
  select count(*) into unread_count from(select 1 from client_messages where workspace_id=d.workspace_id and relationship_id=d.conversation_id and direction='inbound' and (created_at,id)>(coalesce(read_at,'-infinity'::timestamptz),coalesce(read_id,'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid)) limit 100) unread;
 end if;
 return jsonb_build_object('state','send','unreadCount',greatest(1,unread_count));
end $$;

-- Unread summaries: lead conversations are counted as native conversations (their read cursors are native cursors) and
-- marked "lead": true so the Leads tab, not Team, shows them. The Comms total includes them like any conversation. Like a
-- client conversation, only the lead's inbound texts count; a teammate's outbound text is not unread.
create or replace function public.communication_unread_summary(p_workspace_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare result jsonb;
begin
    if auth.role() is distinct from 'authenticated' or auth.uid() is null
       or public.current_session_is_aal2() is not true
       or public.is_workspace_member(p_workspace_id) is not true then
        raise insufficient_privilege;
    end if;
    with readable as materialized (
        select 'client'::text kind, r.id, false is_lead from public.relationships r
        where r.workspace_id = p_workspace_id and r.status <> 'archived'
          and public.client_conversation_can_access(p_workspace_id, r.id, auth.uid())
        union all
        select 'native', c.id, c.kind = 'lead' from public.workspace_native_conversations c
        where c.workspace_id = p_workspace_id and public.native_conversation_can_read(c.id, auth.uid())
    ), counts as (
        select r.kind, r.id, r.is_lead, u.* from readable r
        cross join lateral (
            select count(*)::int count,
                (array_agg(m.id order by m.created_at desc, m.id desc))[1] latest_id,
                max(m.created_at) latest_at
            from (
                select m.id, m.created_at from public.client_messages m
                left join public.communication_read_cursors c on c.workspace_id = p_workspace_id and c.relationship_id = r.id and c.user_id = auth.uid()
                left join public.client_messages read_message on read_message.id = c.last_read_message_id and read_message.relationship_id = r.id
                where r.kind = 'client' and m.workspace_id = p_workspace_id and m.relationship_id = r.id and m.direction = 'inbound'
                  and (m.created_at, m.id) > (coalesce(read_message.created_at, c.last_read_at, '-infinity'::timestamptz), coalesce(read_message.id, c.last_read_message_id, 'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid))
                order by m.created_at desc, m.id desc limit 100
            ) m
            where r.kind = 'client'
            union all
            select count(*)::int,
                (array_agg(m.id order by m.created_at desc, m.id desc))[1], max(m.created_at)
            from (
                select m.id, m.created_at from public.workspace_native_messages m
                left join public.workspace_native_read_cursors c on c.conversation_id = r.id and c.user_id = auth.uid()
                left join public.workspace_native_messages read_message on read_message.id = c.last_read_message_id and read_message.conversation_id = r.id
                left join public.workspace_native_conversation_visibility v on v.conversation_id = r.id and v.user_id = auth.uid()
                where r.kind = 'native' and m.workspace_id = p_workspace_id and m.conversation_id = r.id and m.sender_user_id is distinct from auth.uid()
                  and (not r.is_lead or m.sms_direction = 'inbound')
                  and (m.created_at, m.id) > (coalesce(read_message.created_at, c.last_read_at, '-infinity'::timestamptz), coalesce(read_message.id, c.last_read_message_id, 'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid))
                  and m.created_at > coalesce(v.cleared_at, '-infinity'::timestamptz)
                order by m.created_at desc, m.id desc limit 100
            ) m
            where r.kind = 'native'
        ) u
    )
    select coalesce(jsonb_agg(jsonb_build_object('kind', kind, 'conversationId', id, 'count', count, 'latestMessageId', latest_id, 'latestMessageAt', latest_at)
        || case when is_lead then jsonb_build_object('lead', true) else '{}'::jsonb end) filter (where count > 0), '[]'::jsonb)
    into result from counts;
    return result;
end $$;

create or replace function public.communication_device_unread_summary(p_workspace_id uuid, p_device_id uuid, p_include_cursors boolean default false)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_user uuid; result jsonb;
begin
    v_user:=public.require_communication_device(p_workspace_id,p_device_id);
    perform public.initialize_communication_device_scope(p_workspace_id,v_user,p_device_id);
    with readable as materialized (
        select 'client'::text kind,r.id,false is_lead from public.relationships r where r.workspace_id=p_workspace_id and r.status<>'archived'
            and public.client_conversation_can_access(p_workspace_id,r.id,v_user)
        union all
        select 'native',c.id,c.kind='lead' from public.workspace_native_conversations c where c.workspace_id=p_workspace_id and public.native_conversation_can_read(c.id,v_user)
    ), boundaries as materialized (
        select r.kind,r.id,r.is_lead,c.last_read_at,c.last_read_message_id
        from readable r left join public.communication_device_read_cursors c
            on c.workspace_id=p_workspace_id and c.user_id=v_user and c.device_id=p_device_id and c.kind=r.kind and c.conversation_id=r.id
    ), counts as (
        select r.kind,r.id,r.is_lead,u.* from boundaries r cross join lateral (
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
                    and (not r.is_lead or m.sms_direction='inbound')
                    and (m.created_at,m.id)>(coalesce(r.last_read_at,'-infinity'::timestamptz),coalesce(r.last_read_message_id,'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid))
                    and m.created_at>coalesce(v.cleared_at,'-infinity'::timestamptz)
                order by m.created_at desc,m.id desc limit 100) m where r.kind='native'
        ) u
    )
    select jsonb_build_object('deviceId',p_device_id,'cursorsIncluded',coalesce(p_include_cursors,false),
        'conversations',coalesce((select jsonb_agg(jsonb_build_object('kind',kind,'conversationId',id,'count',count,'latestMessageId',latest_id,'latestMessageAt',latest_at)
            || case when is_lead then jsonb_build_object('lead',true) else '{}'::jsonb end) from counts where count>0),'[]'::jsonb))
        || case when p_include_cursors then jsonb_build_object('readCursors',coalesce((select jsonb_agg(jsonb_build_object('workspaceId',p_workspace_id,'userId',v_user,'deviceId',p_device_id,'kind',kind,'conversationId',id,'lastReadAt',last_read_at,'lastReadMessageId',last_read_message_id)) from boundaries where last_read_at is not null),'[]'::jsonb)) else '{}'::jsonb end into result;
    return result;
end $$;

-- The Team tab's inbox leaves lead conversations to the Leads tab.
create or replace function public.communication_native_inbox(p_workspace_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
    conversation record;
    previews jsonb := '[]'::jsonb;
    unread jsonb := '[]'::jsonb;
    preview jsonb;
    unread_rows jsonb;
begin
    if auth.role() is distinct from 'authenticated' or auth.uid() is null
       or public.current_session_is_aal2() is not true
       or public.is_workspace_member(p_workspace_id) is not true then
        return jsonb_build_object('messages', previews, 'unread', unread);
    end if;
    for conversation in
        select c.id from public.workspace_native_conversations c
        where c.workspace_id = p_workspace_id and c.kind <> 'lead' and public.native_conversation_can_read(c.id, auth.uid())
    loop
        select coalesce(jsonb_agg(to_jsonb(m)), '[]'::jsonb) into preview
        from public.communication_native_messages_bounded(p_workspace_id, conversation.id, 1) m;
        previews := previews || preview;
        select coalesce(jsonb_agg(jsonb_build_object('id', m.id, 'senderUserId', coalesce(m.sender_user_id::text, 'be'), 'createdAt', m.created_at) order by m.created_at, m.id), '[]'::jsonb)
        into unread_rows
        from public.workspace_native_messages m
        left join public.workspace_native_read_cursors cursor
            on cursor.conversation_id = m.conversation_id and cursor.user_id = auth.uid()
        left join public.workspace_native_messages read_message
            on read_message.id = cursor.last_read_message_id and read_message.conversation_id = m.conversation_id
        where m.workspace_id = p_workspace_id and m.conversation_id = conversation.id
          and m.sender_user_id is distinct from auth.uid()
          and not exists (select 1 from public.workspace_native_conversation_visibility v
              where v.conversation_id = m.conversation_id and v.user_id = auth.uid() and m.created_at <= v.cleared_at)
          and (cursor.user_id is null
              or (read_message.id is not null and (m.created_at, m.id) > (read_message.created_at, read_message.id))
              or (read_message.id is null and (m.created_at, m.id) > (cursor.last_read_at, coalesce(cursor.last_read_message_id, 'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid))));
        unread := unread || jsonb_build_array(jsonb_build_object('conversation_id', conversation.id, 'messages', unread_rows));
    end loop;
    return jsonb_build_object('messages', previews, 'unread', unread);
end;
$$;

-- CREATE OR REPLACE retains each function's existing grants.
notify pgrst, 'reload schema';
commit;
