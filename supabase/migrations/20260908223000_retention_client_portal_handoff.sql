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

drop trigger if exists provision_client_portal_after_retention_consent on public.client_sales;
create trigger provision_client_portal_after_retention_consent
after update of status, consent_confirmed_at on public.client_sales
for each row execute function public.provision_client_portal_after_retention_consent();

revoke all on function public.provision_client_portal_after_retention_consent() from public, anon, authenticated;
grant execute on function public.provision_client_portal_after_retention_consent() to service_role;
