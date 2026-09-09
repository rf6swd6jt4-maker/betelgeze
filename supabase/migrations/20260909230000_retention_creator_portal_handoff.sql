-- Retention portal access and its private creator handoff are one transaction.
begin;

alter table public.workspace_native_conversations add column is_system boolean not null default false;
alter table public.workspace_native_conversations drop constraint workspace_native_conversations_check;
alter table public.workspace_native_conversations add constraint workspace_native_conversations_check check (
 (not is_system and kind='team' and team_id is not null and direct_user_one is null and direct_user_two is null)
 or (not is_system and kind='direct' and team_id is null and direct_user_one is not null and direct_user_two is not null and direct_user_one::text < direct_user_two::text)
 or (is_system and kind='direct' and team_id is null and direct_user_one is not null and direct_user_two is null)
);
create unique index workspace_native_conversations_system_recipient_unique
 on public.workspace_native_conversations(workspace_id,direct_user_one) where is_system;
alter table public.workspace_native_messages alter column sender_user_id drop not null;

create or replace function public.sync_native_direct_participants()
returns trigger language plpgsql set search_path=public as $$
begin
 if new.kind='direct' then
   insert into public.workspace_native_conversation_participants(workspace_id,conversation_id,user_id)
   select new.workspace_id,new.id,recipient from unnest(array[new.direct_user_one,new.direct_user_two]) recipient
   where recipient is not null on conflict do nothing;
 end if;
 return new;
end $$;

create or replace function communications_secure.validate_direct_conversation_policy()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
    creator_role text;
    first_role text;
    second_role text;
begin
    if new.is_system then
        if auth.role() is distinct from 'service_role' or new.created_by is distinct from new.direct_user_one
           or not exists(select 1 from public.workspace_memberships where workspace_id=new.workspace_id and user_id=new.direct_user_one)
        then raise exception 'System conversations require a server-created active recipient'; end if;
        return new;
    end if;
    if new.kind <> 'direct' then return new; end if;
    select case when role = 'member' then 'staff' else role end into creator_role
    from public.workspace_memberships where workspace_id = new.workspace_id and user_id = new.created_by;
    select case when role = 'member' then 'staff' else role end into first_role
    from public.workspace_memberships where workspace_id = new.workspace_id and user_id = new.direct_user_one;
    select case when role = 'member' then 'staff' else role end into second_role
    from public.workspace_memberships where workspace_id = new.workspace_id and user_id = new.direct_user_two;
    if creator_role not in ('owner', 'admin') then raise exception 'only_admins_can_start_private_chats'; end if;
    if first_role is null or second_role is null then raise exception 'private_chat_members_must_be_active'; end if;
    if first_role = 'staff' and second_role = 'staff' then raise exception 'staff_private_chats_are_not_allowed'; end if;
    return new;
end;
$$;

-- A system sender has no login/profile and cannot be impersonated in human chats.
create function public.guard_native_system_message()
returns trigger language plpgsql set search_path=public as $$
declare system_conversation boolean;
begin
 select is_system into system_conversation from public.workspace_native_conversations
 where workspace_id=new.workspace_id and id=new.conversation_id;
 if system_conversation is distinct from (new.sender_user_id is null) then
   raise exception 'Invalid message sender for this conversation';
 end if;
 return new;
end $$;
create trigger guard_native_system_message before insert or update of conversation_id,sender_user_id
 on public.workspace_native_messages for each row execute function public.guard_native_system_message();
revoke all on function public.guard_native_system_message() from public,anon,authenticated;

create or replace function public.native_conversation_can_write(target_conversation uuid, target_user uuid default auth.uid())
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
        left join public.workspace_teams team on team.id = conversation.team_id
        where conversation.id = target_conversation
          and conversation.archived_at is null
          and not conversation.is_system
          and (target_user = auth.uid() or auth.role() = 'service_role')
          and (
            (conversation.kind = 'direct' and exists (
                select 1 from public.workspace_native_conversation_participants participant
                where participant.conversation_id = conversation.id and participant.user_id = target_user
            ))
            or
            (conversation.kind = 'team' and team.archived_at is null and exists (
                select 1 from public.workspace_team_members team_member
                where team_member.team_id = conversation.team_id and team_member.user_id = target_user
            ))
          )
    );
$$;

-- Preserve the existing service/team creation rules inside the same transaction.
alter function public.create_retention_relationship(uuid,uuid,uuid,jsonb,jsonb) rename to create_retention_relationship_details;
revoke all on function public.create_retention_relationship_details(uuid,uuid,uuid,jsonb,jsonb) from public,anon,authenticated,service_role;

create function public.create_retention_relationship(p_workspace_id uuid,p_actor_user_id uuid,p_request_id uuid,p_details jsonb,p_services jsonb)
returns jsonb language plpgsql security definer set search_path=public,extensions as $$
declare result jsonb; portal public.client_portal_sessions%rowtype; inbox uuid; portal_url text; base_url text; client_label text; saved_message uuid;
begin
 result:=public.create_retention_relationship_details(p_workspace_id,p_actor_user_id,p_request_id,p_details,p_services);
 -- The inner function checks actor, workspace, request ownership and locks retries.
 insert into public.client_portal_sessions(workspace_id,relationship_id,session_token)
 values(p_workspace_id,p_request_id,encode(extensions.gen_random_bytes(32),'hex'))
 on conflict(workspace_id,relationship_id) do nothing;
 select * into portal from public.client_portal_sessions
 where workspace_id=p_workspace_id and relationship_id=p_request_id;
 if portal.status<>'active' or portal.token_revoked_at is not null then
   raise exception 'This client portal has been revoked';
 end if;
 select case when custom_client_portal_domain_status='verified' then 'https://'||custom_client_portal_domain else null end
 into base_url from public.workspaces where id=p_workspace_id;
 if base_url is not null then portal_url:=base_url||'/'||portal.session_token;
 else
   base_url:=rtrim(p_details->>'portal_base_url','/');
   if base_url is null or base_url !~ '^https?://[^/]+$' then raise exception 'Client portal URL is not configured'; end if;
   portal_url:=base_url||'/client-portal/session/'||portal.session_token;
 end if;
 insert into public.workspace_native_conversations(workspace_id,kind,direct_user_one,is_system,created_by)
 values(p_workspace_id,'direct',p_actor_user_id,true,p_actor_user_id)
 on conflict(workspace_id,direct_user_one) where is_system do nothing;
 select id into inbox from public.workspace_native_conversations
 where workspace_id=p_workspace_id and direct_user_one=p_actor_user_id and is_system;
 select coalesce(nullif(business_name,''),primary_person_name) into client_label from public.relationships where id=p_request_id;
 -- Existing encryption triggers encrypt the URL before storage and Realtime.
 insert into public.workspace_native_messages(workspace_id,conversation_id,sender_user_id,client_request_id,body)
 values(p_workspace_id,inbox,null,(result->>'sale_id')::uuid,
   client_label||' is ready in Retention.'||E'\n\nClient portal: '||portal_url||E'\n\nShare this private access link only with the intended client through your existing contact with them. The portal is available now. Messaging stays in the portal until the client confirms their preferred channel.')
 on conflict(workspace_id,client_request_id) where client_request_id is not null do nothing;
 select id into saved_message from public.workspace_native_messages
 where workspace_id=p_workspace_id and client_request_id=(result->>'sale_id')::uuid and conversation_id=inbox;
 if saved_message is null then raise exception 'Could not save the private portal handoff'; end if;
 update public.relationships set source_metadata=coalesce(source_metadata,'{}'::jsonb)||jsonb_build_object(
   'portal_handoff','creator_dm','external_messaging_pending',not exists(
     select 1 from public.client_sales where id=(result->>'sale_id')::uuid and consent_confirmed_at is not null and status='retention_confirmed'))
 where workspace_id=p_workspace_id and id=p_request_id;
 return result||jsonb_build_object('handoff_conversation_id',inbox,'handoff_message_id',saved_message);
end $$;
revoke all on function public.create_retention_relationship(uuid,uuid,uuid,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.create_retention_relationship(uuid,uuid,uuid,jsonb,jsonb) to service_role;

-- Retention clients skip onboarding. Persist their portal and its delivery in
-- the same transaction as consent, so a worker retry cannot lose the handoff.
create or replace function public.provision_client_portal_after_retention_consent()
returns trigger
language plpgsql
security invoker
set search_path = public, extensions
as $$
declare
    portal_session public.client_portal_sessions%rowtype;
begin
    if new.status <> 'retention_confirmed'
       or new.raw_payload->>'flow' is distinct from 'retention_confirmation'
       or new.consent_confirmed_at is null
       or new.relationship_id is null then return new; end if;

    if not exists (
        select 1 from public.relationships
        where workspace_id = new.workspace_id and id = new.relationship_id
          and lifecycle_phase = 'retention' and status <> 'archived'
    ) then raise exception 'An active Retention relationship is required for portal access'; end if;

    insert into public.client_portal_sessions(workspace_id, relationship_id, session_token)
    values (new.workspace_id, new.relationship_id, encode(extensions.gen_random_bytes(32), 'hex'))
    on conflict (workspace_id, relationship_id) do nothing;

    select * into portal_session from public.client_portal_sessions
    where workspace_id = new.workspace_id and relationship_id = new.relationship_id;
    -- A consent replay must never silently reactivate deliberately revoked access.
    if portal_session.status <> 'active' or portal_session.token_revoked_at is not null then return new; end if;

    -- A manual handoff already delivered the same portal privately to its seller.
    update public.relationships set source_metadata=source_metadata||'{"external_messaging_pending":false}'::jsonb
    where workspace_id=new.workspace_id and id=new.relationship_id
      and source_metadata->>'portal_handoff'='creator_dm';
    if found then return new; end if;

    insert into public.onboarding_delivery_outbox (
        workspace_id, relationship_id, portal_session_id, correlation_id,
        kind, destination, payload, idempotency_key
    ) values (
        new.workspace_id, new.relationship_id, portal_session.id, new.id,
        'client_portal_link', new.client_phone,
        jsonb_build_object('client_id', new.client_id, 'message', 'Your client portal is ready. View your booked appointments, share files, and chat with your team here.'),
        'retention-client-portal:' || new.id::text
    ) on conflict (workspace_id, idempotency_key) do nothing;
    return new;
end;
$$;


-- Appointment submissions use the same portal-only communication destination.
create or replace function public.submit_appointment_setting_appointment(
    p_workspace_id uuid,
    p_relationship_id uuid,
    p_service_id uuid,
    p_appointment_id uuid,
    p_user_id uuid,
    p_expected_updated_at timestamptz,
    p_communication_channel_id uuid,
    p_provider text,
    p_to_address text,
    p_body text
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
    v_appointment public.appointment_setting_appointments%rowtype;
    v_client_id uuid;
    v_message_id uuid;
begin
    if current_user <> 'service_role' then raise exception using errcode = '42501', message = 'Trusted Appointment Setting runtime required'; end if;
    select appointment.* into v_appointment
    from public.appointment_setting_appointments appointment
    where appointment.workspace_id = p_workspace_id
      and appointment.relationship_id = p_relationship_id
      and appointment.service_id = p_service_id
      and appointment.id = p_appointment_id
    for update;
    if v_appointment.id is null then raise exception using errcode = 'P0002', message = 'Appointment draft not found.'; end if;
    if v_appointment.workflow_status = 'submitted' then
        return jsonb_build_object('appointment', to_jsonb(v_appointment), 'message_id', v_appointment.submission_message_id, 'already_submitted', true);
    end if;
    if p_expected_updated_at is null or v_appointment.updated_at <> p_expected_updated_at then
        raise exception using errcode = '40001', message = 'This draft changed. Review its latest details before submitting.';
    end if;
    if not public.workspace_user_can_manage_appointment_setting(p_workspace_id, p_relationship_id, p_service_id, p_user_id) then
        raise exception using errcode = '42501', message = 'Appointment Setting access is required.';
    end if;
    if not exists (select 1 from pg_timezone_names where name = v_appointment.appointment_timezone) then
        raise exception using errcode = '23514', message = 'Choose a valid appointment timezone.';
    end if;
    if (((v_appointment.appointment_date + v_appointment.appointment_time) at time zone v_appointment.appointment_timezone) at time zone v_appointment.appointment_timezone)
       is distinct from (v_appointment.appointment_date + v_appointment.appointment_time) then
        raise exception using errcode = '23514', message = 'This local time does not exist because of daylight saving. Choose another time.';
    end if;
    select relationship.client_id into v_client_id
    from public.relationships relationship
    where relationship.workspace_id = p_workspace_id and relationship.id = p_relationship_id and relationship.status <> 'archived' and relationship.lifecycle_phase = 'retention';
    if not found then raise exception using errcode = 'P0002', message = 'Relationship not found.'; end if;
    if p_provider not in ('meta_whatsapp', 'twilio_sms', 'omnichannel', 'client_portal')
       or nullif(btrim(coalesce(p_to_address, '')), '') is null
       or nullif(btrim(coalesce(p_body, '')), '') is null then
        raise exception using errcode = '22023', message = 'Appointment notification destination is incomplete.';
    end if;

    insert into public.client_messages (
        workspace_id, relationship_id, client_id, communication_channel_id,
        direction, provider, to_address, body, status, sender_kind,
        automation_kind, automation_label, client_request_id, raw_payload
    ) values (
        p_workspace_id, p_relationship_id, v_client_id, p_communication_channel_id,
        'outbound', p_provider, p_to_address, p_body, 'sending', 'automation',
        'appointment_submitted', 'New appointment', p_appointment_id,
        jsonb_build_object('appointment_id', p_appointment_id, 'kind', 'appointment_submitted')
    )
    returning id into v_message_id;

    update public.appointment_setting_appointments appointment
    set
        appointment_at = (appointment.appointment_date + appointment.appointment_time) at time zone appointment.appointment_timezone,
        workflow_status = 'submitted',
        submitted_at = now(),
        submitted_by = p_user_id,
        submission_message_id = v_message_id,
        updated_by = p_user_id
    where appointment.workspace_id = p_workspace_id and appointment.id = p_appointment_id
    returning appointment.* into v_appointment;

    return jsonb_build_object('appointment', to_jsonb(v_appointment), 'message_id', v_message_id, 'already_submitted', false);
end;
$$;

commit;
