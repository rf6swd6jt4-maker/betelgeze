alter table public.client_communication_channels
    alter column provider set default 'meta_whatsapp';

update public.clients
set phone = regexp_replace(phone, '^sms:', 'whatsapp:')
where phone like 'sms:%';

update public.client_communication_channels
set provider = 'meta_whatsapp'
where provider = 'twilio';

update public.client_communication_channels
set external_address = regexp_replace(external_address, '^sms:', 'whatsapp:')
where external_address like 'sms:%';

update public.client_messages
set provider = 'meta_whatsapp'
where provider = 'twilio';

update public.client_messages
set from_address = regexp_replace(from_address, '^sms:', 'whatsapp:')
where from_address like 'sms:%';

update public.client_messages
set to_address = regexp_replace(to_address, '^sms:', 'whatsapp:')
where to_address like 'sms:%';
