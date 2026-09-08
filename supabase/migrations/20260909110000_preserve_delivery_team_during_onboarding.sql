-- Confirming a sale composes onboarding from its frozen snapshot. Its delivery
-- assignments already exist and are locked; legacy invoices may still need them
-- imported. Patch only that import, preserving the current composition function.
begin;

do $migration$
declare
    definition text := pg_get_functiondef('public.create_paid_onboarding_session(uuid,uuid,uuid,text)'::regprocedure);
    previous_import text := $old$
    insert into public.relationship_services (
        workspace_id, relationship_id, service_key, price_cents, currency,
        assignee_user_id, service_id, service_revision_id
    )
    select p_workspace_id, v_sale.relationship_id, item.service_code, item.amount_cents,
           lower(item.currency), item.default_assignee_user_id, item.service_id, item.service_revision_id
    from public.client_sale_items item
    where item.workspace_id = p_workspace_id and item.client_sale_id = p_sale_id
    on conflict (relationship_id, service_key) do update set
        price_cents = excluded.price_cents, currency = excluded.currency,
        assignee_user_id = excluded.assignee_user_id, service_id = excluded.service_id,
        service_revision_id = excluded.service_revision_id;
$old$;
    guarded_import text;
begin
    -- Fail visibly if the function has drifted rather than overwriting other work.
    if position(previous_import in definition) = 0 then
        raise exception 'Expected onboarding service import was not found';
    end if;
    guarded_import := $new$
    -- POS allocations are authoritative after sale. Even an identical UPSERT
    -- runs BEFORE INSERT and would violate the sold-service assignment guard.
    perform 1 from public.relationships
    where workspace_id = p_workspace_id and id = v_sale.relationship_id
    for update;
    if not exists (
        select 1 from public.relationships
        where workspace_id = p_workspace_id and id = v_sale.relationship_id
          and team_locked_at is not null
    ) then
$new$ || previous_import || E'    end if;\n';
    execute replace(definition, previous_import, guarded_import);
end;
$migration$;

notify pgrst, 'reload schema';
commit;
