begin;

create or replace function public.correct_paid_client_sale_commercial_terms(
    p_workspace_id uuid,
    p_sale_id uuid,
    p_actor_user_id uuid,
    p_request_id uuid,
    p_expected_adjustment_version integer,
    p_effective_upfront_amount integer,
    p_effective_recurring_amount integer,
    p_billing_interval text,
    p_billing_interval_count integer,
    p_reason text
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
    v_sale public.client_sales%rowtype;
    v_existing public.client_sale_commercial_adjustments%rowtype;
    v_version integer;
begin
    if not exists (
        select 1 from public.workspace_memberships
        where workspace_id = p_workspace_id and user_id = p_actor_user_id and role in ('owner', 'admin')
    ) then raise exception 'Owner or admin required'; end if;
    if p_request_id is null or p_expected_adjustment_version is null or p_expected_adjustment_version < 0 then
        raise exception 'Request ID and expected version are required';
    end if;
    if p_effective_upfront_amount < 0 or p_effective_recurring_amount < 0
        or p_effective_upfront_amount + p_effective_recurring_amount <= 0 then
        raise exception 'Effective commercial values must be positive';
    end if;
    if (p_effective_recurring_amount = 0 and (p_billing_interval is not null or p_billing_interval_count is not null))
        or (p_effective_recurring_amount > 0 and (p_billing_interval is null or p_billing_interval not in ('week', 'month', 'year') or p_billing_interval_count is null or p_billing_interval_count < 1
            or p_billing_interval_count > case p_billing_interval when 'year' then 3 when 'month' then 36 else 156 end)) then
        raise exception 'Choose a valid recurring schedule';
    end if;
    if length(btrim(coalesce(p_reason, ''))) not between 10 and 1000 then
        raise exception 'Explain why the commercial terms are being corrected';
    end if;

    select * into v_sale from public.client_sales
    where workspace_id = p_workspace_id and id = p_sale_id for update;
    if v_sale.id is null then raise exception 'Sale not found'; end if;
    if v_sale.snapshot_frozen_at is null or v_sale.status not in ('paid', 'test_paid') then
        raise exception 'Only a frozen paid sale can be corrected';
    end if;
    if v_sale.stripe_subscription_id is not null or coalesce(v_sale.stripe_checkout_status, '') <> 'superseded_by_external_invoice'
        or coalesce(v_sale.raw_payload->'external_payment'->>'method', '') <> 'invoice' then
        raise exception 'Use this correction only for an externally invoiced sale without a Stripe subscription';
    end if;
    if not exists (
        select 1 from public.relationship_onboarding_sessions s
        where s.workspace_id = p_workspace_id and s.id = v_sale.onboarding_session_id
          and s.relationship_id = v_sale.relationship_id and s.source_sale_id = v_sale.id
          and s.status in ('active', 'completed')
    ) then raise exception 'The paid sale must retain its onboarding session'; end if;

    select * into v_existing from public.client_sale_commercial_adjustments
    where workspace_id = p_workspace_id and sale_id = p_sale_id and request_id = p_request_id;
    if v_existing.id is not null then
        if (v_existing.version, v_existing.effective_upfront_amount, v_existing.effective_recurring_amount,
            v_existing.billing_interval, v_existing.billing_interval_count, v_existing.reason, v_existing.actor_user_id)
            is distinct from (p_expected_adjustment_version + 1, p_effective_upfront_amount, p_effective_recurring_amount,
            p_billing_interval, p_billing_interval_count, btrim(p_reason), p_actor_user_id) then
            raise exception 'Request ID reused with different correction';
        end if;
        return jsonb_build_object('sale_id', p_sale_id, 'adjustment_id', v_existing.id, 'version', v_existing.version, 'replayed', true);
    end if;

    select coalesce(max(version), 0) into v_version
    from public.client_sale_commercial_adjustments where workspace_id = p_workspace_id and sale_id = p_sale_id;
    if v_version <> p_expected_adjustment_version then raise exception 'Commercial terms changed; reload before correcting'; end if;

    insert into public.client_sale_commercial_adjustments(
        workspace_id, sale_id, version, request_id, effective_upfront_amount, effective_recurring_amount,
        billing_interval, billing_interval_count, reason, actor_user_id
    ) values (
        p_workspace_id, p_sale_id, v_version + 1, p_request_id, p_effective_upfront_amount, p_effective_recurring_amount,
        case when p_effective_recurring_amount > 0 then p_billing_interval end,
        case when p_effective_recurring_amount > 0 then p_billing_interval_count end,
        btrim(p_reason), p_actor_user_id
    ) returning * into v_existing;

    insert into public.workspace_admin_activity(
        workspace_id, category, level, event_key, summary, entity_type, entity_id,
        actor_user_id, actor_kind, metadata, diagnostics, occurred_at, correlation_id,
        idempotency_key, outcome, metric_classification
    ) values (
        p_workspace_id, 'billing', 'info', 'client_sale.pricing_corrected',
        'Effective commercial terms corrected', 'client_sale', p_sale_id::text,
        p_actor_user_id, 'staff', public.sanitize_admin_activity_json(jsonb_build_object(
            'relationship_id', v_sale.relationship_id,
            'onboarding_session_id', v_sale.onboarding_session_id,
            'original', jsonb_build_object(
                'upfront_amount', v_sale.upfront_total_amount,
                'recurring_amount', v_sale.recurring_total_amount,
                'billing_interval', v_sale.billing_interval,
                'billing_interval_count', v_sale.billing_interval_count
            ),
            'effective', jsonb_build_object(
                'upfront_amount', p_effective_upfront_amount,
                'recurring_amount', p_effective_recurring_amount,
                'billing_interval', case when p_effective_recurring_amount > 0 then p_billing_interval end,
                'billing_interval_count', case when p_effective_recurring_amount > 0 then p_billing_interval_count end
            ),
            'adjustment_id', v_existing.id,
            'adjustment_version', v_existing.version
        )), '{}'::jsonb, now(), coalesce(v_sale.correlation_id, p_sale_id),
        'client_sale.pricing_corrected:' || p_sale_id::text || ':' || p_request_id::text,
        'succeeded', 'audit'
    ) on conflict (workspace_id, idempotency_key) where idempotency_key is not null do nothing;

    return jsonb_build_object('sale_id', p_sale_id, 'adjustment_id', v_existing.id, 'version', v_existing.version, 'replayed', false);
end $$;

revoke all on function public.correct_paid_client_sale_commercial_terms(uuid,uuid,uuid,uuid,integer,integer,integer,text,integer,text)
from public, anon, authenticated;
grant execute on function public.correct_paid_client_sale_commercial_terms(uuid,uuid,uuid,uuid,integer,integer,integer,text,integer,text)
to service_role;

commit;
