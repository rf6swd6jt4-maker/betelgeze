-- The seller's explicit acknowledgement can send an approved Utility onboarding-link template without an inbound WhatsApp reply.
create or replace function public.prepare_confirmed_onboarding_session(p_workspace_id uuid, p_sale_id uuid, p_correlation_id uuid, p_idempotency_key text)
returns jsonb language plpgsql security invoker set search_path = public as $$
declare v_sale public.client_sales%rowtype; v_result jsonb; v_relationship_id uuid;
begin
    if current_user <> 'service_role' then raise exception using errcode = '42501', message = 'Confirmed onboarding may only be created by trusted automation'; end if;
    select * into v_sale from public.client_sales where workspace_id = p_workspace_id and id = p_sale_id for update;
    if v_sale.id is null then raise exception 'SALE_NOT_FOUND: Client sale does not belong to this workspace'; end if;
    if v_sale.checkout_flow <> 'onboarding_payment_gate' then raise exception 'SALE_FLOW_INVALID: This sale does not use the onboarding Payment gate'; end if;
    if v_sale.status not in ('sale_confirmation_pending', 'sold_awaiting_whatsapp_confirm', 'onboarding_payment_pending', 'onboarding_link_failed', 'onboarding_link_sent') then raise exception 'SALE_NOT_CONFIRMED: Sale must be prepared before onboarding is created'; end if;
    v_relationship_id := v_sale.relationship_id;
    update public.client_sales set status = 'paid', updated_at = now() where workspace_id = p_workspace_id and id = p_sale_id;
    v_result := public.create_paid_onboarding_session(p_workspace_id, p_sale_id, p_correlation_id, p_idempotency_key || ':compose');
    update public.client_sales set status = 'onboarding_payment_pending', updated_at = now() where workspace_id = p_workspace_id and id = p_sale_id;
    update public.relationships set lifecycle_phase = 'sold', started_onboarding_at = null, updated_at = now() where workspace_id = p_workspace_id and id = v_relationship_id;
    update public.work_items set status = 'todo', actual_start_at = null, actual_start_has_time = false, actual_completed_at = null, actual_completed_has_time = false, updated_at = now() where workspace_id = p_workspace_id and native_kind = 'relationship_workflow' and native_key = v_relationship_id::text || ':onboarding';
    update public.work_items set status = 'todo', actual_start_at = null, actual_start_has_time = false, actual_completed_at = null, actual_completed_has_time = false, updated_at = now() where workspace_id = p_workspace_id and native_kind = 'onboarding_step' and metadata->>'session_id' = v_result->>'session_id';
    perform public.record_workspace_admin_activity(p_workspace_id, 'onboarding', 'onboarding.session.payment_locked', 'Onboarding session created behind Payment', p_entity_type => 'onboarding_session', p_entity_id => v_result->>'session_id', p_actor_kind => 'automation', p_correlation_id => coalesce(p_correlation_id, gen_random_uuid()), p_idempotency_key => p_idempotency_key || ':payment-locked', p_metadata => jsonb_build_object('sale_id', p_sale_id, 'relationship_id', v_relationship_id));
    return v_result;
end;
$$;
