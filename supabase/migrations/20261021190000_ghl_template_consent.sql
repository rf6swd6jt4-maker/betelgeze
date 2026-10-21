-- Recognize retained channel-selected permission for appointment templates only.
-- No client record, confirmation history, notification setting or free-form rule changes.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';
create function public.relationship_template_messaging_choices(p_workspace_id uuid,p_relationship_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare choices jsonb; choice jsonb; rel public.relationships%rowtype; sale record; integration public.workspace_integrations%rowtype;
begin
 choices:=public.relationship_messaging_choices(p_workspace_id,p_relationship_id);
 select x into choice from jsonb_array_elements(choices) x where x->>'provider'='meta_whatsapp';
 -- Existing confirmation remains authoritative. Revocation never falls back.
 if choice is null or nullif(choice->>'confirmedAt','') is not null or choice->>'confirmationStatus'='revoked' then return choices; end if;
 select * into rel from public.relationships where workspace_id=p_workspace_id and id=p_relationship_id;
 if rel.id is null or rel.status='archived' or rel.whatsapp_opted_out_at is not null
 or public.relationship_contact_phone(rel.whatsapp_phone) is distinct from choice->>'address'
 or coalesce(choice->>'address','') !~ '^\+[1-9][0-9]{7,14}$' then return choices; end if;
 -- The existing partial index bounds this to the latest confirmed sale.
 select id,deleted_at,raw_payload,client_phone,consent_confirmed_at into sale from public.client_sales where workspace_id=p_workspace_id and relationship_id=p_relationship_id
 and consent_confirmed_at is not null order by consent_confirmed_at desc limit 1;
 if sale.id is null or sale.deleted_at is not null or sale.raw_payload->>'confirmation_source' is distinct from 'relationship_channels'
 or public.relationship_contact_phone(sale.client_phone) is distinct from choice->>'address'
 or jsonb_typeof(sale.raw_payload->'delivery_choices') is distinct from 'array' then return choices; end if;
 if not exists(select 1 from jsonb_array_elements(sale.raw_payload->'delivery_choices') x
 where x->>'provider'='meta_whatsapp' and x->>'address'=choice->>'address') then return choices; end if;
 select * into integration from public.workspace_integrations where workspace_id=p_workspace_id and provider='meta_whatsapp';
 -- Do not infer free-form permission from this evidence or renew a reply window.
 return (select jsonb_agg(case when x->>'provider'='meta_whatsapp' then x||jsonb_build_object(
 'confirmedAt',sale.consent_confirmed_at,'state',case when not coalesce(integration.enabled,false) or integration.connection_status in('needs_attention','degraded') then 'broken' else 'active' end) else x end)
 from jsonb_array_elements(choices) x);
end $$;
revoke all on function public.relationship_template_messaging_choices(uuid,uuid) from public,anon,authenticated;
grant execute on function public.relationship_template_messaging_choices(uuid,uuid) to service_role;
-- Same evidence at both activation and the final atomic send boundary.
do $$ declare signature text; definition text; needle text:='public.relationship_messaging_choices('; begin
 foreach signature in array array['public.ghl_appointment_setup(text,jsonb)','public.ghl_appointment_automation(text,jsonb)'] loop
  definition:=pg_get_functiondef(signature::regprocedure);
  if position(needle in definition)=0 then raise exception 'Expected consent lookup missing in %',signature; end if;
  execute replace(definition,needle,'public.relationship_template_messaging_choices(');
 end loop;
end $$;
commit;
