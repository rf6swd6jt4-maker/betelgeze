alter table public.client_messages
    add column if not exists whatsapp_message_id text,
    add column if not exists reply_to_whatsapp_message_id text;

create index if not exists client_messages_whatsapp_message_id_idx
    on public.client_messages (whatsapp_message_id);

create index if not exists client_messages_reply_to_whatsapp_message_id_idx
    on public.client_messages (reply_to_whatsapp_message_id);

update public.client_messages
set whatsapp_message_id = provider_message_id
where provider = 'meta_whatsapp'
  and provider_message_id is not null
  and whatsapp_message_id is null;
