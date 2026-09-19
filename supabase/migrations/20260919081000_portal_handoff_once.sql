-- An active portal is relationship-scoped and keeps its token across later
-- onboarding sessions. Do not send the same active link again after a prior
-- successful outbox delivery. A revoked portal gets a fresh token and link.
create or replace function public.provision_client_portal_after_onboarding()
returns trigger
language plpgsql security invoker
set search_path = public, extensions
as $$
declare
    portal_session public.client_portal_sessions%rowtype;
    previous_portal public.client_portal_sessions%rowtype;
    relationship_record public.relationships%rowtype;
    delivery_outbox_id uuid;
    already_sent boolean := false;
begin
    if new.status <> 'completed' or old.status = 'completed' then return new; end if;

    select * into previous_portal
    from public.client_portal_sessions
    where workspace_id = new.workspace_id and relationship_id = new.relationship_id
    for update;
    if previous_portal.id is not null and previous_portal.status = 'active'
       and previous_portal.token_revoked_at is null then
        select exists (
            select 1 from public.onboarding_delivery_outbox delivery
            where delivery.workspace_id = new.workspace_id
              and delivery.portal_session_id = previous_portal.id
              and delivery.kind = 'client_portal_link'
              and delivery.status = 'sent'
        ) into already_sent;
    end if;

    insert into public.client_portal_sessions (
        workspace_id, relationship_id, onboarding_session_id, session_token
    ) values (
        new.workspace_id, new.relationship_id, new.id,
        encode(extensions.gen_random_bytes(32), 'hex')
    )
    on conflict (workspace_id, relationship_id) do update set
        onboarding_session_id = excluded.onboarding_session_id,
        session_token = case
            when public.client_portal_sessions.status = 'revoked' then excluded.session_token
            else public.client_portal_sessions.session_token
        end,
        status = 'active', token_revoked_at = null, updated_at = now()
    returning * into portal_session;

    if already_sent then return new; end if;

    select * into relationship_record from public.relationships
    where workspace_id = new.workspace_id and id = new.relationship_id;

    insert into public.onboarding_delivery_outbox (
        workspace_id, relationship_id, session_id, portal_session_id,
        correlation_id, kind, destination, payload, idempotency_key
    ) values (
        new.workspace_id, new.relationship_id, new.id, portal_session.id,
        coalesce(new.source_sale_id, new.id), 'client_portal_link',
        coalesce(nullif(trim(relationship_record.primary_phone), ''), 'relationship:' || new.relationship_id::text),
        jsonb_build_object('client_id', relationship_record.client_id, 'message', 'Your client portal is ready.'),
        'client-portal-link:' || new.id::text
    )
    on conflict (workspace_id, idempotency_key) do nothing
    returning id into delivery_outbox_id;

    if delivery_outbox_id is not null then
        perform public.record_workspace_admin_activity(
            new.workspace_id, 'communications', 'client_portal.link.queued',
            'Client portal link queued for delivery',
            p_entity_type => 'client_portal_session',
            p_entity_id => portal_session.id::text,
            p_actor_kind => 'automation',
            p_correlation_id => coalesce(new.source_sale_id, new.id),
            p_idempotency_key => 'client_portal.link.queued:' || delivery_outbox_id::text,
            p_metadata => jsonb_build_object(
                'outbox_id', delivery_outbox_id,
                'relationship_id', new.relationship_id,
                'onboarding_session_id', new.id,
                'portal_session_id', portal_session.id
            )
        );
    end if;
    return new;
end;
$$;
