-- The provider's inbound timestamp, rather than webhook arrival time, owns the
-- customer-service window. A late or repeated webhook must not move it back.
alter table public.relationships
    add column if not exists last_whatsapp_inbound_at timestamptz,
    add column if not exists whatsapp_opted_out_at timestamptz;

with recent as (
    select workspace_id, relationship_id, max(created_at) as received_at
    from public.client_messages
    where provider = 'meta_whatsapp' and direction = 'inbound'
      and relationship_id is not null and status <> 'webhook_failed'
    group by workspace_id, relationship_id
)
update public.relationships r
set last_whatsapp_inbound_at = recent.received_at
from recent
where r.workspace_id = recent.workspace_id and r.id = recent.relationship_id
  and r.last_whatsapp_inbound_at is null;

create index if not exists relationships_whatsapp_window_due
    on public.relationships (last_whatsapp_inbound_at)
    where last_whatsapp_inbound_at is not null and status <> 'archived';

create or replace function public.record_relationship_whatsapp_inbound(
    p_workspace_id uuid, p_relationship_id uuid, p_sent_at timestamptz, p_body text
) returns void
language plpgsql security invoker
set search_path = public
as $$
declare
    normalized_body text := upper(trim(coalesce(p_body, '')));
    effective_at timestamptz := least(coalesce(p_sent_at, now()), now());
begin
    update public.relationships
    set last_whatsapp_inbound_at = greatest(coalesce(last_whatsapp_inbound_at, effective_at), effective_at),
        whatsapp_opted_out_at = case
            when normalized_body in ('STOP', 'UNSUBSCRIBE', 'CANCEL', 'END', 'QUIT')
                then effective_at
            when normalized_body in ('CONFIRM', 'START', 'UNSTOP')
                and (whatsapp_opted_out_at is null or effective_at > whatsapp_opted_out_at)
                then null
            else whatsapp_opted_out_at
        end
    where workspace_id = p_workspace_id and id = p_relationship_id;
end;
$$;

revoke all on function public.record_relationship_whatsapp_inbound(uuid, uuid, timestamptz, text)
    from public, anon, authenticated;
grant execute on function public.record_relationship_whatsapp_inbound(uuid, uuid, timestamptz, text)
    to service_role;

-- One paid reconfirmation attempt per expired customer-service window. A
-- subsequent client message changes the window key and permits a later request.
create unique index if not exists client_messages_whatsapp_reconfirmation_window
    on public.client_messages (workspace_id, relationship_id, (raw_payload->>'window_key'))
    where automation_kind = 'whatsapp_reconfirmation';

create or replace function public.guard_whatsapp_reconfirmation_insert()
returns trigger language plpgsql security invoker set search_path = public as $$
declare
    relationship_record public.relationships%rowtype;
begin
    if new.automation_kind is distinct from 'whatsapp_reconfirmation' then return new; end if;
    select * into relationship_record from public.relationships
    where workspace_id = new.workspace_id and id = new.relationship_id for update;
    if relationship_record.id is null or relationship_record.status = 'archived' then
        raise exception 'The client conversation is unavailable';
    end if;
    if relationship_record.whatsapp_opted_out_at is not null then
        raise exception 'This client opted out of WhatsApp messages';
    end if;
    if relationship_record.last_whatsapp_inbound_at > now() - interval '24 hours' then
        raise exception 'The WhatsApp response window is still open';
    end if;
    new.raw_payload := coalesce(new.raw_payload, '{}'::jsonb) || jsonb_build_object(
        'window_key', coalesce(relationship_record.last_whatsapp_inbound_at::text, 'never')
    );
    return new;
end;
$$;

create trigger client_messages_guard_whatsapp_reconfirmation
before insert on public.client_messages
for each row execute function public.guard_whatsapp_reconfirmation_insert();

-- Every modern WhatsApp path, including queued onboarding/portal sends, writes
-- a delivery row before reaching Meta. Refuse a new attempt after STOP without
-- adding another network read to the interactive send path.
create or replace function public.guard_opted_out_whatsapp_delivery()
returns trigger language plpgsql security invoker set search_path = public as $$
begin
    if new.provider = 'meta_whatsapp' and new.status = 'sending'
       and exists (
           select 1 from public.relationships r
           where r.workspace_id = new.workspace_id and r.id = new.relationship_id
             and r.whatsapp_opted_out_at is not null
       ) then raise exception 'This client opted out of WhatsApp messages'; end if;
    return new;
end;
$$;
create trigger communication_delivery_whatsapp_opt_out
before insert or update of status on public.communication_message_deliveries
for each row execute function public.guard_opted_out_whatsapp_delivery();
