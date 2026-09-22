begin;

create or replace function public.relationship_recorded_revenue(p_workspace_id uuid, p_relationship_id uuid)
returns table(currency text, amount_cents bigint)
language sql stable security definer set search_path = public as $$
    with sales as (
        select s.id,
               upper(s.currency) currency,
               coalesce(a.effective_upfront_amount + a.effective_recurring_amount, s.total_amount) total_amount,
               s.status,
               s.raw_payload
        from public.client_sales s
        left join lateral (
            select adjustment.effective_upfront_amount, adjustment.effective_recurring_amount
            from public.client_sale_commercial_adjustments adjustment
            where adjustment.workspace_id=s.workspace_id and adjustment.sale_id=s.id
            order by adjustment.version desc
            limit 1
        ) a on true
        where s.workspace_id=p_workspace_id and s.relationship_id=p_relationship_id
          and s.deleted_at is null and s.status not in ('test_paid','retired_billing_model')
          and (s.status='paid' or s.stripe_invoice_status='paid' or s.initial_payment_received_at is not null)
    ), paid_invoices as (
        select distinct on (sale.id, e.raw_payload #>> '{data,object,id}')
            sale.id sale_id,
            upper(coalesce(e.raw_payload #>> '{data,object,currency}',sale.currency)) currency,
            (e.raw_payload #>> '{data,object,amount_paid}')::bigint amount_cents
        from sales sale
        join public.stripe_events e on e.workspace_id=p_workspace_id
          and e.event_type in ('invoice.paid','invoice.payment_succeeded')
          and coalesce(e.raw_payload #>> '{data,object,metadata,client_sale_id}',
                       e.raw_payload #>> '{data,object,parent,subscription_details,metadata,client_sale_id}',
                       e.raw_payload #>> '{data,object,subscription_details,metadata,client_sale_id}')=sale.id::text
        where e.raw_payload->>'livemode'='true'
          and e.raw_payload #>> '{data,object,id}' is not null
          and e.raw_payload #>> '{data,object,amount_paid}' ~ '^[0-9]{1,15}$'
        order by sale.id, e.raw_payload #>> '{data,object,id}', e.id
    ), receipts as (
        select currency, amount_cents from paid_invoices
        union all
        select sale.currency, sale.total_amount::bigint from sales sale
        where coalesce(sale.raw_payload->>'livemode','true') <> 'false'
          and not exists (select 1 from paid_invoices invoice where invoice.sale_id=sale.id)
        union all
        select historical.currency, historical.amount_cents
        from public.relationship_historical_service_revenue historical
        where historical.workspace_id=p_workspace_id and historical.relationship_id=p_relationship_id
    )
    select receipts.currency, sum(receipts.amount_cents)::bigint
    from receipts group by receipts.currency
$$;

revoke all on function public.relationship_recorded_revenue(uuid,uuid) from public,anon,authenticated;
grant execute on function public.relationship_recorded_revenue(uuid,uuid) to service_role;

notify pgrst, 'reload schema';
commit;
