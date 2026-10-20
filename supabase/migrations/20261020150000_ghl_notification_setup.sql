-- Explicit per-client activation after live provider/template preflight. No sends.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';
create function public.ghl_appointment_setup(p_action text,p_input jsonb default '{}') returns jsonb
language plpgsql security definer set search_path='' as $$
declare c client_portal_secure.ghl_connections%rowtype; p client_portal_secure.ghl_appointment_profiles%rowtype;
 w public.workspaces%rowtype; r public.relationships%rowtype; item jsonb; choice jsonb; result jsonb; secret_value text;
begin
 if auth.role() is distinct from 'service_role' then return jsonb_build_object('failure','access'); end if;
 if jsonb_typeof(p_input) is distinct from 'object' or p_action not in('ensure','read','enable','disable') then return jsonb_build_object('failure','input'); end if;
 result:=public.read_client_ghl_connections((p_input->>'workspaceId')::uuid,(p_input->>'userId')::uuid,(p_input->>'relationshipId')::uuid);
 select value into item from jsonb_array_elements(coalesce(result->'accounts','[]')) where value->>'relationshipId'=p_input->>'relationshipId' and not coalesce((value->>'archived')::boolean,false);
 if item is null then return jsonb_build_object('failure','access'); end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('client-ghl:'||(p_input->>'relationshipId'),0));
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('portal-ghl:'||(p_input->>'relationshipId'),0));
 select * into c from client_portal_secure.ghl_connections where workspace_id=(p_input->>'workspaceId')::uuid and relationship_id=(p_input->>'relationshipId')::uuid;
 if c.vault_secret_id is null or c.selected_calendar_id is null then return jsonb_build_object('failure','connection'); end if;
 if c.calendar_revision::text is distinct from p_input->>'expectedRevision' then return jsonb_build_object('failure','changed'); end if;
 select * into p from client_portal_secure.ghl_appointment_profiles where workspace_id=c.workspace_id and relationship_id=c.relationship_id and location_id=c.location_id and calendar_id=c.selected_calendar_id for update;
 if p_action='disable' then
  update client_portal_secure.ghl_appointment_profiles set sending_enabled=false,sending_activated_at=null,updated_at=now() where workspace_id=c.workspace_id and relationship_id=c.relationship_id;
  return jsonb_build_object('sendingEnabled',false);
 end if;
 select * into w from public.workspaces where id=c.workspace_id;
 select * into r from public.relationships where id=c.relationship_id and workspace_id=c.workspace_id;
 if w.status<>'active' or r.status='archived' then return jsonb_build_object('failure','access'); end if;
 -- Existing approved templates contain this portal origin, not a generic URL.
 if w.custom_client_portal_domain_status is distinct from 'verified' or lower(w.custom_client_portal_domain) is distinct from 'portal.scaylup.com' then return jsonb_build_object('failure','portal'); end if;
 select decrypted_secret into secret_value from vault.decrypted_secrets where id=c.vault_secret_id;
 if not exists(select 1 from client_portal_secure.ghl_oauth_credentials g where g.relationship_id=c.relationship_id and g.workspace_id=c.workspace_id and g.location_id=c.location_id and g.app_id=p_input->>'appId' and g.status in('active','refreshing') and g.expires_at>now() and g.access_hash=encode(extensions.digest(secret_value,'sha256'),'hex')) then return jsonb_build_object('failure','oauth'); end if;
 if p_action='ensure' and (p.id is null or p.connection_revision<>c.calendar_revision or not p.detection_enabled or p.portal_origin<>'https://portal.scaylup.com') then
  result:=public.ghl_appointment_automation('configure',jsonb_build_object('workspaceId',c.workspace_id,'relationshipId',c.relationship_id,'portalOrigin','https://portal.scaylup.com','detectionEnabled',true));
  if result ? 'failure' then return result; end if;
  select * into p from client_portal_secure.ghl_appointment_profiles where id=(result->'profile'->>'id')::uuid;
 end if;
 if p.id is null or p.connection_revision<>c.calendar_revision or not p.detection_enabled or p.portal_origin<>'https://portal.scaylup.com' then return jsonb_build_object('failure','profile'); end if;
 select x into choice from jsonb_array_elements(public.relationship_messaging_choices(c.workspace_id,c.relationship_id)) x where x->>'provider'='meta_whatsapp' and x->>'address'=public.relationship_contact_phone(r.whatsapp_phone);
 if p_action='enable' then
  if p_input->>'verifiedAt' is null or (p_input->>'verifiedAt')::timestamptz<now()-interval '2 minutes' or (p_input->>'verifiedAt')::timestamptz>now()+interval '1 minute' or p_input->'verifiedTemplates' is distinct from '["added","rescheduled","cancelled","removed","details_updated","status_updated","reminder"]'::jsonb then return jsonb_build_object('failure','preflight'); end if;
  if r.whatsapp_opted_out_at is not null or nullif(choice->>'confirmedAt','') is null or choice->>'state' is distinct from 'active' or choice->>'confirmationStatus'='revoked' then return jsonb_build_object('failure','consent'); end if;
  if not exists(select 1 from public.client_portal_sessions ps where ps.workspace_id=c.workspace_id and ps.relationship_id=c.relationship_id and ps.status='active' and ps.token_revoked_at is null) then return jsonb_build_object('failure','portal_session'); end if;
  -- tested_at records this preflight, never a claim of real-message delivery.
  -- Keep the activation boundary on retries; do not invalidate fresh queued work.
  update client_portal_secure.ghl_appointment_profiles set sending_enabled=true,tested_at=now(),sending_activated_at=coalesce(sending_activated_at,now()),updated_at=now() where id=p.id returning * into p;
 end if;
 return jsonb_build_object('profile',client_portal_secure.ghl_appointment_profile_json(p),'revision',c.calendar_revision,'consentReady',r.whatsapp_opted_out_at is null and nullif(choice->>'confirmedAt','') is not null and choice->>'state'='active' and choice->>'confirmationStatus' is distinct from 'revoked','privateToken',case when p_action='read' then secret_value end);
end $$;
revoke all on function public.ghl_appointment_setup(text,jsonb) from public,anon,authenticated;
grant execute on function public.ghl_appointment_setup(text,jsonb) to service_role;
commit;
