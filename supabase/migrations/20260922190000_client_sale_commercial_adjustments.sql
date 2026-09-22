-- Preserve the immutable sale quote while allowing an audited effective-value
-- correction for paid sales that were settled outside Stripe.
begin;

create table public.client_sale_commercial_adjustments (
    id uuid primary key default gen_random_uuid(),
    workspace_id uuid not null,
    sale_id uuid not null,
    version integer not null check (version > 0),
    request_id uuid not null,
    effective_upfront_amount integer not null check (effective_upfront_amount >= 0),
    effective_recurring_amount integer not null check (effective_recurring_amount >= 0),
    billing_interval text check (billing_interval in ('week', 'month', 'year')),
    billing_interval_count integer check (billing_interval_count > 0),
    reason text not null check (length(btrim(reason)) between 10 and 1000),
    actor_user_id uuid not null references auth.users(id),
    created_at timestamptz not null default now(),
    foreign key (workspace_id, sale_id) references public.client_sales(workspace_id, id),
    unique (sale_id, version),
    unique (sale_id, request_id),
    check (
        (effective_recurring_amount = 0 and billing_interval is null and billing_interval_count is null)
        or
        (effective_recurring_amount > 0 and billing_interval is not null and billing_interval_count is not null)
    )
);
create index client_sale_commercial_adjustments_latest_idx
    on public.client_sale_commercial_adjustments(workspace_id, sale_id, version desc);

create function public.reject_client_sale_commercial_adjustment_change() returns trigger
language plpgsql set search_path = public as $$
begin
    raise exception 'Commercial adjustment history is immutable';
end $$;
create trigger immutable_client_sale_commercial_adjustments
before update or delete on public.client_sale_commercial_adjustments
for each row execute function public.reject_client_sale_commercial_adjustment_change();

alter table public.client_sale_commercial_adjustments enable row level security;
revoke all on public.client_sale_commercial_adjustments from public, anon, authenticated;
grant select, insert on public.client_sale_commercial_adjustments to service_role;

create function public.correct_paid_client_sale_commercial_terms(
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

    perform public.record_workspace_admin_activity(
        p_workspace_id, 'billing', 'client_sale.pricing_corrected', 'Effective commercial terms corrected',
        p_entity_type => 'client_sale', p_entity_id => p_sale_id::text,
        p_actor_user_id => p_actor_user_id, p_actor_kind => 'staff',
        p_correlation_id => coalesce(v_sale.correlation_id, p_sale_id),
        p_idempotency_key => 'client_sale.pricing_corrected:' || p_sale_id::text || ':' || p_request_id::text,
        p_metadata => jsonb_build_object(
            'relationship_id', v_sale.relationship_id,
            'onboarding_session_id', v_sale.onboarding_session_id,
            'original', jsonb_build_object('upfront_amount', v_sale.upfront_total_amount, 'recurring_amount', v_sale.recurring_total_amount,
                'billing_interval', v_sale.billing_interval, 'billing_interval_count', v_sale.billing_interval_count),
            'effective', jsonb_build_object('upfront_amount', p_effective_upfront_amount, 'recurring_amount', p_effective_recurring_amount,
                'billing_interval', case when p_effective_recurring_amount > 0 then p_billing_interval end,
                'billing_interval_count', case when p_effective_recurring_amount > 0 then p_billing_interval_count end),
            'adjustment_id', v_existing.id, 'adjustment_version', v_existing.version
        )
    );
    return jsonb_build_object('sale_id', p_sale_id, 'adjustment_id', v_existing.id, 'version', v_existing.version, 'replayed', false);
end $$;

create or replace function public.read_relationship_services(p_workspace_id uuid,p_relationship_id uuid,p_user_id uuid,p_offset integer default 0) returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare result jsonb; totals jsonb;
begin
 if not public.workspace_user_can_access_relationship(p_workspace_id,p_relationship_id,p_user_id) then raise exception 'Relationship access required'; end if;
 if p_offset<0 or p_offset>10000 then raise exception 'Invalid page'; end if;
 select jsonb_build_object('items',coalesce(jsonb_agg(to_jsonb(x)),'[]'),'hasMore',count(*)>30) into result
 from (select * from public.relationship_service_rows(p_workspace_id,p_relationship_id,p_user_id) order by created_at,id limit 31 offset p_offset) x;
 if p_offset=0 and public.workspace_user_fully_covers_relationship(p_workspace_id,p_relationship_id,p_user_id) then
  select coalesce(jsonb_agg(to_jsonb(t)),'[]') into totals from (
   select upper(x.currency) currency,'catalogue_estimate'::text kind,cadence.billing_interval,cadence.billing_interval_count,sum(x.upfront_cents)::bigint upfront_cents,sum(x.recurring_cents)::bigint recurring_cents
   from public.relationship_service_rows(p_workspace_id,p_relationship_id,p_user_id) x
   left join public.onboarding_service_revisions v on v.workspace_id=p_workspace_id and v.id=x.service_revision_id
   cross join lateral (select
    case when coalesce(v.definition->>'defaultBillingInterval',v.definition->>'default_billing_interval') in ('week','month','year') then coalesce(v.definition->>'defaultBillingInterval',v.definition->>'default_billing_interval') else 'month' end billing_interval,
    case when coalesce(v.definition->>'defaultBillingIntervalCount',v.definition->>'default_billing_interval_count') ~ '^[1-9][0-9]{0,2}$' then coalesce(v.definition->>'defaultBillingIntervalCount',v.definition->>'default_billing_interval_count')::integer else 1 end billing_interval_count
   ) cadence
   where x.stage='negotiating' group by upper(x.currency),cadence.billing_interval,cadence.billing_interval_count
   union all
   select upper(s.currency),'sold',coalesce(a.billing_interval,s.billing_interval),coalesce(a.billing_interval_count,s.billing_interval_count),
      sum(coalesce(a.effective_upfront_amount,s.upfront_total_amount))::bigint,sum(coalesce(a.effective_recurring_amount,s.recurring_total_amount))::bigint
   from public.client_sales s left join lateral (
      select x.effective_upfront_amount,x.effective_recurring_amount,x.billing_interval,x.billing_interval_count
      from public.client_sale_commercial_adjustments x where x.workspace_id=s.workspace_id and x.sale_id=s.id order by x.version desc limit 1
   ) a on true
   where s.workspace_id=p_workspace_id and s.relationship_id=p_relationship_id and s.snapshot_frozen_at is not null
    and s.status in ('onboarding_payment_pending','onboarding_created','onboarding_link_sent','onboarding_link_failed','payment_failed','paid','test_paid')
   group by upper(s.currency),coalesce(a.billing_interval,s.billing_interval),coalesce(a.billing_interval_count,s.billing_interval_count)
  ) t;
  result := result || jsonb_build_object('values',totals);
 end if;
 return result;
end $$;

create or replace function public.read_relationship_service_pos(p_workspace_id uuid,p_relationship_id uuid,p_actor_user_id uuid,p_offset integer default 0) returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare rows jsonb; managers jsonb; sales jsonb;
begin
 if not public.workspace_user_can_sell(p_workspace_id,p_actor_user_id) or not public.workspace_user_can_access_relationship(p_workspace_id,p_relationship_id,p_actor_user_id) then raise exception 'Seller access required'; end if;
 if p_offset<0 or p_offset>10000 then raise exception 'Invalid page'; end if;
 select coalesce(jsonb_agg(to_jsonb(x)),'[]') into rows from (
  select r.*,v.definition->>'thumbnailPath' "thumbnailPath",v.definition->>'templateId' "templateId",coalesce(v.definition->>'serviceType',v.definition->>'service_type',case when v.default_recurring_price_cents>0 then 'retainer' else 'one_time' end) service_type,
   coalesce(v.definition->>'defaultBillingInterval',v.definition->>'default_billing_interval','month') billing_interval,
   coalesce((v.definition->>'defaultBillingIntervalCount')::integer,(v.definition->>'default_billing_interval_count')::integer,1) billing_interval_count
  from public.relationship_service_rows(p_workspace_id,p_relationship_id,p_actor_user_id) r
  join public.onboarding_service_revisions v on v.workspace_id=p_workspace_id and v.id=r.service_revision_id
  where not r.legacy and r.stage in('negotiating','declined','for_later') and exists(select 1 from public.relationship_service_instances i where i.id=r.id::uuid and i.disposition='active') order by r.created_at,r.id limit 31 offset p_offset
 ) x;
 select coalesce(jsonb_agg(to_jsonb(x)),'[]') into managers from (
  select m.user_id id,coalesce(u.display_name,u.username,'Workspace member') name from public.workspace_operational_roles o join public.workspace_memberships m using(workspace_id,user_id) left join public.user_profiles u on u.user_id=m.user_id
  where m.workspace_id=p_workspace_id and o.can_manage order by coalesce(u.display_name,u.username),m.user_id limit 200
 ) x;
 select coalesce(jsonb_agg(to_jsonb(x)),'[]') into sales from (
  select s.id,s.status,s.created_at,s.currency,coalesce(a.effective_upfront_amount,s.upfront_total_amount) upfront_total_amount,
   coalesce(a.effective_recurring_amount,s.recurring_total_amount) recurring_total_amount,s.onboarding_session_id,s.consent_confirmed_at,
   (select jsonb_agg(jsonb_build_object('id',i.service_instance_id,'name',i.service_name) order by i.sort_order) from public.client_sale_items i where i.client_sale_id=s.id) services
  from public.client_sales s left join lateral (
   select x.effective_upfront_amount,x.effective_recurring_amount from public.client_sale_commercial_adjustments x
   where x.workspace_id=s.workspace_id and x.sale_id=s.id order by x.version desc limit 1
  ) a on true
  where s.workspace_id=p_workspace_id and s.relationship_id=p_relationship_id and s.service_scope='selected_services' and (s.seller_user_id=p_actor_user_id or exists(select 1 from public.workspace_memberships where workspace_id=p_workspace_id and user_id=p_actor_user_id and role in('owner','admin'))) order by s.created_at desc limit 10
 ) x;
 return jsonb_build_object('items',rows,'hasMore',jsonb_array_length(rows)>30,'managers',managers,'sales',sales,'contacts',public.relationship_messaging_choices(p_workspace_id,p_relationship_id),'relationship', (select jsonb_build_object('name',primary_person_name,'company',business_name,'email',primary_email,'phone',coalesce(primary_phone,whatsapp_phone),'updatedAt',updated_at,'managerId',fulfilment_manager_user_id) from relationships where workspace_id=p_workspace_id and id=p_relationship_id),'relationshipVersion',(select updated_at from public.relationships where workspace_id=p_workspace_id and id=p_relationship_id));
end $$;

revoke all on function public.reject_client_sale_commercial_adjustment_change(),
 public.correct_paid_client_sale_commercial_terms(uuid,uuid,uuid,uuid,integer,integer,integer,text,integer,text)
 from public, anon, authenticated;
grant execute on function public.correct_paid_client_sale_commercial_terms(uuid,uuid,uuid,uuid,integer,integer,integer,text,integer,text) to service_role;

commit;
