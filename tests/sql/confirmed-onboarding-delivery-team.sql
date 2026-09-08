-- Run after the delivery-team fix against a sold test relationship awaiting
-- confirmation. No provider messages are sent; all writes are rolled back.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';
set local role service_role;

do $test$
declare
    sale public.client_sales%rowtype;
    before_services jsonb;
    after_services jsonb;
    before_members jsonb;
    after_members jsonb;
    result jsonb;
    replay jsonb;
    delivery jsonb;
    delivery_replay jsonb;
    rejected boolean := false;
begin
    select s.* into sale
    from public.client_sales s
    join public.relationships r on r.id = s.relationship_id and r.workspace_id = s.workspace_id
    where r.source_metadata->>'is_test' = 'true' and r.status <> 'archived'
      and r.team_locked_at is not null and s.onboarding_session_id is null
      and s.status = 'sold_awaiting_whatsapp_confirm'
      and s.checkout_flow = 'onboarding_payment_gate'
    order by s.created_at desc limit 1 for update of s;
    assert sale.id is not null, 'A sold test relationship awaiting confirmation is required';

    select jsonb_agg(to_jsonb(s) order by s.service_key) into before_services
    from public.relationship_services s where s.relationship_id = sale.relationship_id;
    select jsonb_agg(to_jsonb(m) order by m.user_id) into before_members
    from public.workspace_team_members m join public.workspace_teams t on t.id = m.team_id
    where t.relationship_id = sale.relationship_id;

    result := public.prepare_confirmed_onboarding_session(sale.workspace_id, sale.id, sale.id, 'delivery-confirmation-regression:' || sale.id);
    assert result->>'session_id' is not null, 'Confirmation did not compose onboarding';
    assert result->>'created' = 'true', 'First confirmation did not create a session';
    assert exists(select 1 from public.relationship_onboarding_session_modules where session_id = (result->>'session_id')::uuid), 'Frozen modules were not composed';
    assert exists(select 1 from public.client_sales where id = sale.id and status = 'onboarding_payment_pending'), 'Payment gate was bypassed';
    assert exists(select 1 from public.relationships where id = sale.relationship_id and lifecycle_phase = 'sold'), 'Unpaid confirmation advanced the lifecycle';
    replay := public.prepare_confirmed_onboarding_session(sale.workspace_id, sale.id, sale.id, 'delivery-confirmation-regression:' || sale.id);
    assert replay->>'session_id' = result->>'session_id' and replay->>'created' = 'false', 'Confirmation replay duplicated onboarding';

    select jsonb_agg(to_jsonb(s) order by s.service_key) into after_services
    from public.relationship_services s where s.relationship_id = sale.relationship_id;
    select jsonb_agg(to_jsonb(m) order by m.user_id) into after_members
    from public.workspace_team_members m join public.workspace_teams t on t.id = m.team_id
    where t.relationship_id = sale.relationship_id;
    assert before_services = after_services, 'Onboarding changed the sold service assignments';
    assert before_members = after_members, 'Onboarding changed the delivery team';
    begin
        update public.relationship_services set assignee_user_id = null where relationship_id = sale.relationship_id;
    exception when others then
        rejected := sqlerrm = 'The sold client service assignment cannot be changed';
    end;
    assert rejected, 'Sold assignment protection was weakened';
    assert public.client_conversation_can_access(sale.workspace_id, sale.relationship_id, sale.seller_user_id), 'Seller cannot access client chat';
    update public.client_sales set consent_confirmed_at = now() where id = sale.id;
    delivery := public.enqueue_onboarding_link_delivery(sale.workspace_id, sale.id, sale.relationship_id, (result->>'session_id')::uuid, sale.client_phone, 'Rollback-only onboarding link check', sale.id, 'delivery-link-regression:' || sale.id);
    assert delivery->>'outbox_id' is not null and delivery->>'created' = 'true', 'Confirmation did not queue the onboarding link';
    delivery_replay := public.enqueue_onboarding_link_delivery(sale.workspace_id, sale.id, sale.relationship_id, (result->>'session_id')::uuid, sale.client_phone, 'Rollback-only onboarding link check', sale.id, 'delivery-link-regression:' || sale.id);
    assert delivery_replay->>'outbox_id' = delivery->>'outbox_id' and delivery_replay->>'created' = 'false', 'Confirmation replay duplicated link delivery';
end;
$test$;

select 'PASS: confirmation composes onboarding, preserves allocations, retains Payment and chat access, and queues one link delivery' as result;
rollback;
