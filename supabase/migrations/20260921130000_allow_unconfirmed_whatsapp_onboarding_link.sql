-- An explicit seller acknowledgement may send the configured WhatsApp Utility
-- onboarding-link template without waiting for an inbound client reply.
create or replace function public.validate_relationship_sale_choices(p_workspace_id uuid,p_relationship_id uuid,p_actor_user_id uuid,p_input jsonb,p_commit boolean) returns void
language plpgsql stable security definer set search_path=public as $$
declare item jsonb; available jsonb;
begin
 if jsonb_typeof(p_input->'offered') is distinct from 'array' or jsonb_array_length(p_input->'offered') not between 1 and 300 then raise exception 'Reload the services offered in this sale'; end if;
 if (select count(distinct x->>'id') from jsonb_array_elements(p_input->'offered') x)<>jsonb_array_length(p_input->'offered') then raise exception 'Duplicate offered service'; end if;
 for item in select value from jsonb_array_elements(p_input->'offered') loop
  if not exists(select 1 from relationship_service_instances i where i.workspace_id=p_workspace_id and i.relationship_id=p_relationship_id and i.id=(item->>'id')::uuid and i.version=(item->>'version')::integer and i.origin='negotiation' and i.import_id is null and i.disposition='active' and i.stage in('negotiating','declined','for_later') and (public.workspace_user_fully_covers_relationship(p_workspace_id,p_relationship_id,p_actor_user_id) or i.assignee_user_id=p_actor_user_id)) then raise exception 'An offered service changed. Reload and review the sale'; end if;
 end loop;
 if exists(select 1 from jsonb_array_elements(p_input->'lines') x where not exists(select 1 from jsonb_array_elements(p_input->'offered') o where o->>'id'=x->>'id' and o->>'version'=x->>'version')) then raise exception 'Selected services must belong to the reviewed offer'; end if;
 if jsonb_typeof(p_input->'delivery') is distinct from 'array' or jsonb_array_length(p_input->'delivery')>(2) or p_commit and jsonb_array_length(p_input->'delivery')=0 then raise exception 'Choose a contact method'; end if;
 if (select count(distinct x->>'provider') from jsonb_array_elements(p_input->'delivery') x)<>jsonb_array_length(p_input->'delivery') then raise exception 'Select each contact method once'; end if;
 available:=public.relationship_messaging_choices(p_workspace_id,p_relationship_id);
 for item in select value from jsonb_array_elements(p_input->'delivery') loop
  if not exists(select 1 from jsonb_array_elements(available) c where c->>'provider'=item->>'provider' and c->>'address'=item->>'address' and (
   (c->>'state'='active' and c->>'canSend'='true')
   or (item->>'provider'='meta_whatsapp' and c->>'enabled'='true' and c->>'state' in ('active','inactive'))
  )) then raise exception 'A selected contact method is no longer configured and available. Review contact methods'; end if;
 end loop;
end $$;
revoke all on function public.validate_relationship_sale_choices(uuid,uuid,uuid,jsonb,boolean) from public,anon,authenticated;
