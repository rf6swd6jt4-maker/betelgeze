-- Lead Gen v5.4.5 Sunbiz import access hardening.
-- Keeps the bulk owner index private to backend/service processes while allowing local service-role imports.

grant select, insert, update, delete on table public.leadgen_sunbiz_owner_index to service_role;

alter table public.leadgen_sunbiz_owner_index enable row level security;

drop policy if exists service_role_can_manage_sunbiz_owner_index
on public.leadgen_sunbiz_owner_index;

create policy service_role_can_manage_sunbiz_owner_index
on public.leadgen_sunbiz_owner_index
for all
to service_role
using (true)
with check (true);
