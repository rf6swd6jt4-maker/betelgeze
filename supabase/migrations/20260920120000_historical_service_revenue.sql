begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- The amount received for an already completed, historically imported service.
-- This is separate from immutable sale lines and cannot create a charge.
create table if not exists public.relationship_historical_service_revenue (
    instance_id uuid primary key,
    workspace_id uuid not null,
    relationship_id uuid not null,
    amount_cents bigint not null check (amount_cents between 0 and 1000000000000),
    currency text not null check (currency ~ '^[A-Z]{3}$'),
    version integer not null default 1 check (version > 0),
    updated_by uuid not null references auth.users(id),
    updated_at timestamptz not null default now(),
    foreign key (workspace_id, relationship_id, instance_id)
        references public.relationship_service_instances(workspace_id, relationship_id, id)
);
create index if not exists relationship_historical_revenue_total_idx
    on public.relationship_historical_service_revenue(workspace_id, relationship_id, currency);

create table if not exists public.relationship_historical_service_revenue_events (
    id uuid primary key default gen_random_uuid(),
    workspace_id uuid not null,
    instance_id uuid not null references public.relationship_historical_service_revenue(instance_id),
    request_id uuid not null,
    old_amount_cents bigint,
    new_amount_cents bigint not null,
    version integer not null,
    actor_user_id uuid not null references auth.users(id),
    created_at timestamptz not null default now(),
    unique (instance_id, request_id),
    unique (instance_id, version)
);
create index if not exists relationship_historical_revenue_events_idx
    on public.relationship_historical_service_revenue_events(workspace_id, instance_id, created_at desc);
alter table public.relationship_historical_service_revenue enable row level security;
alter table public.relationship_historical_service_revenue_events enable row level security;
revoke all on public.relationship_historical_service_revenue, public.relationship_historical_service_revenue_events from public, anon, authenticated;
grant select, insert, update on public.relationship_historical_service_revenue to service_role;
grant select, insert on public.relationship_historical_service_revenue_events to service_role;

create or replace function public.set_completed_service_revenue(
    p_workspace_id uuid, p_relationship_id uuid, p_instance_id uuid, p_actor_user_id uuid,
    p_request_id uuid, p_expected_version integer, p_amount_cents bigint
) returns integer
language plpgsql security definer set search_path = public as $$
declare existing public.relationship_historical_service_revenue%rowtype;
        prior public.relationship_historical_service_revenue_events%rowtype;
        service_currency text;
        next_version integer;
begin
    if p_request_id is null or p_expected_version is null or p_expected_version < 0
       or p_amount_cents is null or p_amount_cents not between 0 and 1000000000000 then
        raise exception 'Choose a valid historical amount';
    end if;
    if not public.can_manage_relationship_service(p_workspace_id, p_relationship_id, p_actor_user_id, 'already_onboarded') then
        raise exception 'Service import access required';
    end if;
    select upper(v.currency) into service_currency
    from public.relationship_service_instances i
    join public.onboarding_service_revisions v on v.workspace_id=i.workspace_id and v.id=i.service_revision_id
    where i.workspace_id=p_workspace_id and i.relationship_id=p_relationship_id and i.id=p_instance_id
      and i.origin='already_onboarded' and i.stage='completed' and i.disposition='active'
      and not exists(select 1 from public.service_instance_sale_items s where s.instance_id=i.id)
    for update of i;
    if service_currency is null then raise exception 'Only unsold, completed historical services can record revenue'; end if;
    select * into prior from public.relationship_historical_service_revenue_events
      where instance_id=p_instance_id and request_id=p_request_id;
    if prior.id is not null then
        if prior.new_amount_cents <> p_amount_cents then raise exception 'Request ID reused with a different amount'; end if;
        return prior.version;
    end if;
    select * into existing from public.relationship_historical_service_revenue
      where instance_id=p_instance_id for update;
    if coalesce(existing.version, 0) <> p_expected_version then raise exception 'Historical price changed; reload before saving'; end if;
    next_version := p_expected_version + 1;
    insert into public.relationship_historical_service_revenue(instance_id,workspace_id,relationship_id,amount_cents,currency,version,updated_by)
      values(p_instance_id,p_workspace_id,p_relationship_id,p_amount_cents,service_currency,next_version,p_actor_user_id)
      on conflict(instance_id) do update set amount_cents=excluded.amount_cents,version=excluded.version,
        updated_by=excluded.updated_by,updated_at=now();
    insert into public.relationship_historical_service_revenue_events(workspace_id,instance_id,request_id,old_amount_cents,new_amount_cents,version,actor_user_id)
      values(p_workspace_id,p_instance_id,p_request_id,existing.amount_cents,p_amount_cents,next_version,p_actor_user_id);
    return next_version;
end $$;
revoke all on function public.set_completed_service_revenue(uuid,uuid,uuid,uuid,uuid,integer,bigint) from public,anon,authenticated;
grant execute on function public.set_completed_service_revenue(uuid,uuid,uuid,uuid,uuid,integer,bigint) to service_role;

-- Add the existing completed service and its historical amount atomically.
create or replace function public.add_completed_relationship_service_with_revenue(
    p_workspace_id uuid, p_relationship_id uuid, p_actor_user_id uuid, p_request_id uuid,
    p_service_id uuid, p_revision_id uuid, p_assignee_user_id uuid,
    p_seller_user_id uuid, p_manager_user_id uuid, p_amount_cents bigint
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare result jsonb; receipt public.relationship_historical_service_revenue%rowtype;
begin
    result := public.add_completed_relationship_service(
        p_workspace_id,p_relationship_id,p_actor_user_id,p_request_id,p_service_id,p_revision_id,
        p_assignee_user_id,p_seller_user_id,p_manager_user_id);
    select * into receipt from public.relationship_historical_service_revenue where instance_id=(result->>'id')::uuid;
    if receipt.instance_id is null then
        perform public.set_completed_service_revenue(p_workspace_id,p_relationship_id,(result->>'id')::uuid,
            p_actor_user_id,p_request_id,0,p_amount_cents);
    elsif receipt.amount_cents <> p_amount_cents then
        raise exception 'Request ID reused with a different amount';
    end if;
    return result;
end $$;
revoke all on function public.add_completed_relationship_service_with_revenue(uuid,uuid,uuid,uuid,uuid,uuid,uuid,uuid,uuid,bigint) from public,anon,authenticated;
grant execute on function public.add_completed_relationship_service_with_revenue(uuid,uuid,uuid,uuid,uuid,uuid,uuid,uuid,uuid,bigint) to service_role;

-- Existing Stripe events retain the invoice amount and sale ID. Index the
-- extraction so opening one relationship never scans the workspace's history.
create index if not exists stripe_events_revenue_sale_idx on public.stripe_events (
    workspace_id,
    (coalesce(raw_payload #>> '{data,object,metadata,client_sale_id}',
              raw_payload #>> '{data,object,parent,subscription_details,metadata,client_sale_id}',
              raw_payload #>> '{data,object,subscription_details,metadata,client_sale_id}'))
) where event_type in ('invoice.paid','invoice.payment_succeeded');

create or replace function public.relationship_recorded_revenue(p_workspace_id uuid, p_relationship_id uuid)
returns table(currency text, amount_cents bigint)
language sql stable security definer set search_path = public as $$
    with sales as (
        select id, upper(currency) currency, total_amount, status, raw_payload
        from public.client_sales
        where workspace_id=p_workspace_id and relationship_id=p_relationship_id
          and deleted_at is null and status not in ('test_paid','retired_billing_model')
          and (status='paid' or stripe_invoice_status='paid' or initial_payment_received_at is not null)
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
