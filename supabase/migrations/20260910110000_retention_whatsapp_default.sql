-- Automatic confirmation and portal delivery is the default; private BE handoff stays opt-in.
create or replace function public.create_retention_relationship(p_workspace_id uuid,p_actor_user_id uuid,p_request_id uuid,p_details jsonb,p_services jsonb)
returns jsonb language plpgsql security definer set search_path=public,extensions as $$
declare result jsonb; portal public.client_portal_sessions%rowtype; inbox uuid; portal_url text; base_url text; client_label text; saved_message uuid; handoff text;
begin
 result:=public.create_retention_relationship_details(p_workspace_id,p_actor_user_id,p_request_id,p_details,p_services);
 -- The inner function checks actor, workspace, request ownership and locks retries.
 -- Keep the original handoff choice on retries, including older open forms.
 select source_metadata->>'portal_handoff' into handoff from public.relationships where id=p_request_id;
 handoff:=coalesce(handoff,case when p_details->>'retention_handoff'='request_confirmation' then 'messaging_confirmation' else 'creator_dm' end);
 if handoff='messaging_confirmation' then
   update public.relationships set source_metadata=coalesce(source_metadata,'{}'::jsonb)||jsonb_build_object(
     'portal_handoff',handoff,'external_messaging_pending',not exists(
       select 1 from public.client_sales where id=(result->>'sale_id')::uuid and consent_confirmed_at is not null and status='retention_confirmed'))
   where workspace_id=p_workspace_id and id=p_request_id;
   return result;
 end if;
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
    handoff text;
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

    select source_metadata->>'portal_handoff' into handoff from public.relationships where id=new.relationship_id;
    -- Both paths activate messaging, but only automatic handoffs enqueue the URL.
    update public.relationships set source_metadata=source_metadata||'{"external_messaging_pending":false}'::jsonb
    where workspace_id=new.workspace_id and id=new.relationship_id
      and source_metadata->>'portal_handoff' in ('creator_dm','messaging_confirmation');
    if handoff='creator_dm' then return new; end if;

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


