-- Install the two indexes concurrently before this transaction in production.
-- Existing relationship formatting and all message history remain unchanged.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';
create index if not exists relationships_inbound_whatsapp_phone_idx
on public.relationships (workspace_id, public.relationship_contact_phone(whatsapp_phone))
where status <> 'archived';
create index if not exists relationships_inbound_primary_phone_idx
on public.relationships (workspace_id, public.relationship_contact_phone(primary_phone))
where status <> 'archived';

create function public.find_whatsapp_inbound_relationships(p_workspace_id uuid, p_from_address text)
returns table(id uuid, client_id uuid)
language sql stable security invoker set search_path = '' as $$
    with recipient as materialized (
        select public.relationship_contact_phone(p_from_address) as phone
    ), candidates as (
        (select r.id, r.client_id from public.relationships r
         where r.workspace_id = p_workspace_id and r.status <> 'archived'
           and public.relationship_contact_phone(r.whatsapp_phone) = (select phone from recipient)
           and (select phone from recipient) ~ '^\+[0-9]{8,15}$'
         limit 2)
        union
        (select r.id, r.client_id from public.relationships r
         where r.workspace_id = p_workspace_id and r.status <> 'archived'
           and public.relationship_contact_phone(r.primary_phone) = (select phone from recipient)
           and (select phone from recipient) ~ '^\+[0-9]{8,15}$'
         limit 2)
    )
    select candidates.id, candidates.client_id from candidates limit 2
$$;
revoke all on function public.find_whatsapp_inbound_relationships(uuid,text) from public,anon,authenticated;
grant execute on function public.find_whatsapp_inbound_relationships(uuid,text) to service_role;
commit;
