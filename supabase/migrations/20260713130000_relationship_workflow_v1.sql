-- Relationship-native workflow v1 follow-up: WhatsApp is intentionally
-- separate from the general contact phone, because it drives the consent and
-- onboarding-link automation.

alter table public.relationships
    add column if not exists whatsapp_phone text;

create index if not exists relationships_workspace_whatsapp_phone_idx
on public.relationships(workspace_id, whatsapp_phone)
where whatsapp_phone is not null;
