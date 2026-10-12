-- Additive pricing corrections. Original sale headers, lines and onboarding remain immutable.
begin;
alter table public.client_sales
 add column pricing_revision integer not null default 0 check (pricing_revision >= 0),
 add column pricing_override jsonb,
 add column pricing_correction_id uuid;

create table public.client_sale_price_corrections (
 request_id uuid primary key,
 workspace_id uuid not null,
 sale_id uuid not null,
 actor_user_id uuid not null references auth.users(id),
 expected_version integer not null,
 terms jsonb not null,
 reason text not null check(length(btrim(reason)) between 10 and 1000),
 previous_checkout_id text,
 state text not null default 'pending' check(state in('pending','committed','rejected')),
 created_at timestamptz not null default now(),
 finished_at timestamptz,
 foreign key(workspace_id,sale_id) references public.client_sales(workspace_id,id)
);
alter table public.client_sale_price_corrections enable row level security;
revoke all on public.client_sale_price_corrections from public,anon,authenticated,service_role;
grant select on public.client_sale_price_corrections to service_role;

create function public.begin_client_sale_price_correction(p_workspace uuid,p_relationship uuid,p_sale uuid,p_actor uuid,p_request uuid,p_version integer,p_terms jsonb,p_reason text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare s public.client_sales%rowtype; existing public.client_sale_price_corrections%rowtype; item jsonb; frozen record;
 upfront bigint:=0; recurring bigint:=0; line_count integer; schedule text; cadence integer;
begin
 if not exists(select 1 from public.workspace_memberships where workspace_id=p_workspace and user_id=p_actor and role in('owner','admin'))
 or not public.workspace_user_can_access_relationship(p_workspace,p_relationship,p_actor) then raise exception 'Owner or admin access required'; end if;
 select * into s from public.client_sales where workspace_id=p_workspace and relationship_id=p_relationship and id=p_sale for update;
 if s.id is null or s.deleted_at is not null or s.service_scope<>'selected_services' then raise exception 'Selected-service sale not found'; end if;
 select * into existing from public.client_sale_price_corrections where request_id=p_request;
 if found then
  if existing.workspace_id<>p_workspace or existing.sale_id<>p_sale or existing.expected_version<>p_version or existing.terms<>p_terms or existing.reason<>btrim(p_reason) then raise exception 'Correction request does not match its saved details'; end if;
  return to_jsonb(existing);
 end if;
 if s.status not in('sale_confirmation_pending','onboarding_payment_pending','onboarding_link_sent','onboarding_link_failed','payment_failed')
 or s.initial_payment_received_at is not null or s.stripe_subscription_id is not null or s.stripe_checkout_status='complete'
 or s.stripe_invoice_status='paid' then raise exception 'Only an unpaid sale can be corrected'; end if;
 if s.pricing_correction_id is not null then raise exception 'Resume the pending pricing correction first'; end if;
 if s.pricing_revision<>p_version then raise exception 'Prices changed. Reload the sale before correcting'; end if;
 if s.service_checkout_request is not null and s.stripe_checkout_session_id is null then raise exception 'The previous checkout result must be recovered before correcting prices'; end if;
 if p_request is null or p_reason is null or length(btrim(p_reason)) not between 10 and 1000 or jsonb_typeof(p_terms->'lines') is distinct from 'array'
 or jsonb_array_length(p_terms->'lines') not between 1 and 30 then raise exception 'Review the prices and explain the correction'; end if;
 schedule:=p_terms->>'billingInterval'; cadence:=(p_terms->>'billingIntervalCount')::integer;
 if schedule is null or schedule not in('week','month','year') or cadence is null or cadence not between 1 and (case schedule when 'week' then 156 when 'month' then 36 else 3 end) then raise exception 'Choose a supported recurring schedule'; end if;
 select count(*) into line_count from public.client_sale_items where workspace_id=p_workspace and client_sale_id=s.id;
 if line_count<>jsonb_array_length(p_terms->'lines') or line_count<>(select count(distinct x->>'id') from jsonb_array_elements(p_terms->'lines') x) then raise exception 'Keep every original service exactly once'; end if;
 for item in select value from jsonb_array_elements(p_terms->'lines') loop
  select i.*,v.definition,v.default_recurring_price_cents into frozen from public.client_sale_items i join public.onboarding_service_revisions v on v.workspace_id=i.workspace_id and v.id=i.service_revision_id
   where i.workspace_id=p_workspace and i.client_sale_id=s.id and i.id=(item->>'id')::uuid;
  if not found then raise exception 'The sale services changed'; end if;
  if jsonb_typeof(item->'upfrontCents') is distinct from 'number' or jsonb_typeof(item->'recurringCents') is distinct from 'number'
   or (item->>'upfrontCents')::numeric<>trunc((item->>'upfrontCents')::numeric) or (item->>'recurringCents')::numeric<>trunc((item->>'recurringCents')::numeric)
   or (item->>'upfrontCents')::bigint not between 0 and 99999999 or (item->>'recurringCents')::bigint not between 0 and 99999999
   or (item->>'upfrontCents')::bigint+(item->>'recurringCents')::bigint=0 then raise exception 'Set a valid price for every service'; end if;
  if (item->>'recurringCents')::bigint>0 and coalesce(frozen.definition->>'serviceType',frozen.definition->>'service_type','one_time')<>'retainer' and coalesce(frozen.default_recurring_price_cents,0)=0 then raise exception 'A one-time service cannot become a subscription'; end if;
  upfront:=upfront+(item->>'upfrontCents')::bigint; recurring:=recurring+(item->>'recurringCents')::bigint;
 end loop;
 if upfront+recurring>99999999 or upfront is distinct from (p_terms->>'upfrontTotal')::bigint or recurring is distinct from (p_terms->>'recurringTotal')::bigint then raise exception 'The reviewed total does not match the service prices'; end if;
 if recurring>0 and ((select count(*) from jsonb_array_elements(p_terms->'lines') x where (x->>'upfrontCents')::bigint>0)>20 or (select count(*) from jsonb_array_elements(p_terms->'lines') x where (x->>'recurringCents')::bigint>0)>20) then raise exception 'Too many checkout line items'; end if;
 insert into public.client_sale_price_corrections(request_id,workspace_id,sale_id,actor_user_id,expected_version,terms,reason,previous_checkout_id)
 values(p_request,p_workspace,s.id,p_actor,p_version,p_terms,btrim(p_reason),s.stripe_checkout_session_id) returning * into existing;
 update public.client_sales set pricing_correction_id=p_request where id=s.id;
 return to_jsonb(existing);
end $$;

create function public.finish_client_sale_price_correction(p_workspace uuid,p_actor uuid,p_request uuid,p_accept boolean)
returns jsonb language plpgsql security definer set search_path=public as $$
declare correction public.client_sale_price_corrections%rowtype; s public.client_sales%rowtype; next_version integer;
begin
 if not exists(select 1 from public.workspace_memberships where workspace_id=p_workspace and user_id=p_actor and role in('owner','admin')) then raise exception 'Owner or admin access required'; end if;
 select * into correction from public.client_sale_price_corrections where workspace_id=p_workspace and request_id=p_request;
 if not found then raise exception 'Correction not found'; end if;
 select * into s from public.client_sales where workspace_id=p_workspace and id=correction.sale_id for update;
 if not public.workspace_user_can_access_relationship(p_workspace,s.relationship_id,p_actor) then raise exception 'Relationship access required'; end if;
 select * into correction from public.client_sale_price_corrections where workspace_id=p_workspace and request_id=p_request for update;
 if correction.state<>'pending' then return to_jsonb(correction); end if;
 if s.pricing_correction_id is distinct from p_request or s.pricing_revision<>correction.expected_version then raise exception 'Correction ownership changed'; end if;
 if p_accept then
  if s.deleted_at is not null or s.status not in('sale_confirmation_pending','onboarding_payment_pending','onboarding_link_sent','onboarding_link_failed','payment_failed')
   or s.initial_payment_received_at is not null or s.stripe_subscription_id is not null or s.stripe_invoice_status='paid' or s.stripe_checkout_status='complete'
   or s.stripe_checkout_session_id is distinct from correction.previous_checkout_id then raise exception 'Payment state changed; reconcile before correcting'; end if;
  select coalesce(max(version),0)+1 into next_version from public.client_sale_commercial_adjustments where workspace_id=p_workspace and sale_id=s.id;
  insert into public.client_sale_commercial_adjustments(workspace_id,sale_id,version,request_id,effective_upfront_amount,effective_recurring_amount,billing_interval,billing_interval_count,reason,actor_user_id)
  values(p_workspace,s.id,next_version,p_request,(correction.terms->>'upfrontTotal')::integer,(correction.terms->>'recurringTotal')::integer,
   case when (correction.terms->>'recurringTotal')::integer>0 then correction.terms->>'billingInterval' end,
   case when (correction.terms->>'recurringTotal')::integer>0 then (correction.terms->>'billingIntervalCount')::integer end,correction.reason,correction.actor_user_id);
  update public.client_sales set pricing_revision=pricing_revision+1,pricing_override=(correction.terms-'lines')||jsonb_build_object('linePrices',(select jsonb_object_agg(x->>'id',x-'id') from jsonb_array_elements(correction.terms->'lines') x)),pricing_correction_id=null,
   stripe_checkout_session_id=null,stripe_checkout_url=null,stripe_checkout_expires_at=null,stripe_checkout_status=null,service_checkout_request=null,service_checkout_requested_at=null
   where id=s.id;
 else
  update public.client_sales set pricing_correction_id=null where id=s.id;
 end if;
 update public.client_sale_price_corrections set state=case when p_accept then 'committed' else 'rejected' end,finished_at=now() where request_id=p_request returning * into correction;
 return to_jsonb(correction);
end $$;
revoke all on function public.begin_client_sale_price_correction(uuid,uuid,uuid,uuid,uuid,integer,jsonb,text),public.finish_client_sale_price_correction(uuid,uuid,uuid,boolean) from public,anon,authenticated;
grant execute on function public.begin_client_sale_price_correction(uuid,uuid,uuid,uuid,uuid,integer,jsonb,text),public.finish_client_sale_price_correction(uuid,uuid,uuid,boolean) to service_role;

-- Install guards in the existing checkout owner, preserving its receipt/recovery rules.
do $installer$
declare source text; needle text;
begin
 source:=pg_get_functiondef('public.claim_selected_service_checkout(uuid,uuid,text,text,jsonb)'::regprocedure);
 needle:='if s.status in(''paid'',''test_paid'') then return jsonb_build_object(''paid'',true); end if;';
 if position(needle in source)=0 then raise exception 'Checkout owner changed; review before installing pricing guards'; end if;
 source:=replace(source,needle,needle||E'\n if s.pricing_correction_id is not null then raise exception ''Prices are being corrected. Please reopen payment shortly.''; end if;\n if coalesce((p_request->>''pricingRevision'')::integer,0)<>s.pricing_revision then raise exception ''Prices changed. Reopen the onboarding link to review the corrected total.''; end if;');
 execute source;
end $installer$;

-- Bounded existing projections: no extra round trip, polling, full history or new read index.
do $installer$
declare source text; needle text;
begin
 source:=pg_get_functiondef('public.relationship_service_catalogue(uuid,uuid,text,integer)'::regprocedure);
 needle:='v.default_recurring_price_cents recurring_cents,v.currency';
 if position(needle in source)=0 then raise exception 'Catalogue projection changed'; end if;
 source:=replace(source,needle,needle||',coalesce(v.definition->>''defaultBillingInterval'',v.definition->>''default_billing_interval'',''month'') billing_interval,coalesce((v.definition->>''defaultBillingIntervalCount'')::integer,(v.definition->>''default_billing_interval_count'')::integer,1) billing_interval_count');
 execute source;
 source:=pg_get_functiondef('public.read_relationship_service_pos(uuid,uuid,uuid,integer)'::regprocedure);
 needle:='s.onboarding_session_id,s.consent_confirmed_at,';
 if position(needle in source)=0 then raise exception 'POS sale projection changed'; end if;
 source:=replace(source,needle,needle||E'\n   coalesce(a.billing_interval,s.billing_interval) billing_interval,coalesce(a.billing_interval_count,s.billing_interval_count) billing_interval_count,s.pricing_revision,s.pricing_correction_id,\n   ((s.pricing_correction_id is not null or s.status in(''sale_confirmation_pending'',''onboarding_payment_pending'',''onboarding_link_sent'',''onboarding_link_failed'',''payment_failed'') and s.initial_payment_received_at is null and s.stripe_subscription_id is null) and exists(select 1 from workspace_memberships where workspace_id=p_workspace_id and user_id=p_actor_user_id and role in(''owner'',''admin''))) can_correct_prices,');
 needle:='select x.effective_upfront_amount,x.effective_recurring_amount from public.client_sale_commercial_adjustments x';
 if position(needle in source)=0 then raise exception 'POS effective commercial terms changed'; end if;
 source:=replace(source,needle,'select x.effective_upfront_amount,x.effective_recurring_amount,x.billing_interval,x.billing_interval_count from public.client_sale_commercial_adjustments x');
 execute source;
 source:=pg_get_functiondef('public.read_relationship_service_cards(uuid,uuid,uuid,integer,text)'::regprocedure);
 needle:='select line.upfront_amount_cents,line.recurring_amount_cents,line.currency,s.billing_interval,s.billing_interval_count';
 if position(needle in source)=0 then raise exception 'Service card sale projection changed'; end if;
 source:=replace(source,needle,'select coalesce((s.pricing_override->''linePrices''->line.id::text->>''upfrontCents'')::integer,line.upfront_amount_cents) upfront_amount_cents,coalesce((s.pricing_override->''linePrices''->line.id::text->>''recurringCents'')::integer,line.recurring_amount_cents) recurring_amount_cents,line.currency,coalesce(s.pricing_override->>''billingInterval'',s.billing_interval) billing_interval,coalesce((s.pricing_override->>''billingIntervalCount'')::integer,s.billing_interval_count) billing_interval_count');
 needle:='''billing_interval'',sale.billing_interval,''billing_interval_count'',sale.billing_interval_count';
 if position(needle in source)=0 then raise exception 'Service card schedule projection changed'; end if;
 source:=replace(source,needle,'''billing_interval'',coalesce(sale.billing_interval,v.definition->>''defaultBillingInterval'',v.definition->>''default_billing_interval'',''month''),''billing_interval_count'',coalesce(sale.billing_interval_count,(v.definition->>''defaultBillingIntervalCount'')::integer,(v.definition->>''default_billing_interval_count'')::integer,1)');
 execute source;
end $installer$;
notify pgrst,'reload schema';
commit;
