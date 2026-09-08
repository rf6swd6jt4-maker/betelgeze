-- Run after the Retention portal migration. All fixtures and queued messages roll back.
begin;
select set_config('request.jwt.claim.role', 'service_role', true);
do $$
declare
    ws uuid;
    rel uuid;
    sale uuid;
    portal uuid;
    original_token text;
begin
    select id into ws from public.workspaces where status='active' order by created_at limit 1;
    if ws is null then raise exception 'An active workspace is required for this check'; end if;
    insert into public.relationships(workspace_id, primary_person_name, business_name, lifecycle_phase, source_metadata)
    values(ws, 'Portal rollback QA', 'Portal rollback QA', 'retention', '{"is_test":true}') returning id into rel;
    insert into public.client_sales(workspace_id, relationship_id, client_name, client_phone, status, raw_payload)
    values(ws, rel, 'Portal rollback QA', '+15005550006', 'manual_awaiting_whatsapp_confirm', '{"flow":"retention_confirmation"}') returning id into sale;
    if exists(select 1 from public.client_portal_sessions where relationship_id=rel) then raise exception 'Access was provisioned before confirmation'; end if;
    update public.client_sales set status='retention_confirmed' where id=sale;
    if exists(select 1 from public.client_portal_sessions where relationship_id=rel) then raise exception 'Access was provisioned without consent timestamp'; end if;
    update public.client_sales set consent_confirmed_at=now() where id=sale;
    select id, session_token into portal, original_token from public.client_portal_sessions where workspace_id=ws and relationship_id=rel and status='active';
    if portal is null or length(original_token)<>64 then raise exception 'No durable portal was created'; end if;
    if not exists(select 1 from public.onboarding_delivery_outbox where workspace_id=ws and portal_session_id=portal and relationship_id=rel and session_id is null and kind='client_portal_link' and status='queued') then raise exception 'Portal link was not queued without onboarding'; end if;
    update public.client_sales set status='retention_confirmed',consent_confirmed_at=now() where id=sale;
    if (select count(*) from public.onboarding_delivery_outbox where workspace_id=ws and idempotency_key='retention-client-portal:'||sale::text)<>1 then raise exception 'Confirmation replay duplicated delivery'; end if;
    if (select session_token from public.client_portal_sessions where id=portal)<>original_token then raise exception 'Confirmation replay rotated the token'; end if;
    if (select lifecycle_phase from public.relationships where id=rel)<>'retention' then raise exception 'Confirmation moved the client out of Retention'; end if;
    update public.client_portal_sessions set status='revoked',token_revoked_at=now() where id=portal;
    update public.client_sales set status='retention_confirmed' where id=sale;
    if (select status from public.client_portal_sessions where id=portal)<>'revoked' then raise exception 'Replay reactivated revoked access'; end if;
    update public.relationships set status='archived' where id=rel;
    begin
        update public.client_sales set status='retention_confirmed' where id=sale;
        raise exception 'Archived relationship was accepted';
    exception when raise_exception then
        if sqlerrm <> 'An active Retention relationship is required for portal access' then raise; end if;
    end;
end;
$$;
rollback;
select true as retention_portal_checks_passed_and_rolled_back;
