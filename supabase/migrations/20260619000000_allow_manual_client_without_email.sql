-- Legacy manual clients can be migrated to WhatsApp and ClickUp even if no email is on record.
alter table public.clients alter column email drop not null;
