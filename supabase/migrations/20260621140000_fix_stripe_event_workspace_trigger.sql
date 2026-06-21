-- Some earlier manually applied migration variants included stripe_events in
-- the client-owned branch below. Stripe events do not have client_id, so that
-- caused webhook deliveries to fail before the payment automation ran.
create or replace function public.assign_workspace_id()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
    if new.workspace_id is not null then return new; end if;

    if tg_table_name = 'stripe_events' then
        select id into new.workspace_id from public.workspaces where slug = 'scaylup';
    elsif tg_table_name = 'clients' then
        select id into new.workspace_id from public.workspaces where slug = 'scaylup';
    elsif tg_table_name in (
        'client_progress', 'client_modules', 'client_notes', 'client_activity',
        'client_form_responses', 'client_services',
        'client_communication_channels', 'client_messages',
        'client_clickup_items', 'client_sales'
    ) and new.client_id is not null then
        select workspace_id into new.workspace_id from public.clients where id = new.client_id;
    else
        select id into new.workspace_id from public.workspaces where slug = 'scaylup';
    end if;
    return new;
end;
$$;
