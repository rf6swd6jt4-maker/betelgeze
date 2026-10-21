-- Retain the exact prepared template with the existing encrypted message. No
-- historical messages, outbox rows, receipts or reading policy are rewritten.
begin;
create function client_portal_secure.ghl_template_evidence_valid(e jsonb, kind text, token text, version bigint, origin text)
returns boolean language plpgsql immutable set search_path='' as $$
declare expected_id text; suffix text; parameter jsonb;
begin
 if jsonb_typeof(e) is distinct from 'object' or octet_length(e::text)>8192 or e->>'schemaVersion' is distinct from '1'
  or e->>'templateName' is distinct from 'be_appointment_'||kind or e->>'language' is distinct from 'en_US'
  or nullif(e->>'capturedAt','') is null then return false;end if;
 perform (e->>'capturedAt')::timestamptz;
 expected_id:=case kind when 'added' then '1415800937309351' when 'rescheduled' then '1796403754961389'
  when 'cancelled' then '2521941414984943' when 'removed' then '2622511831545035' when 'details_updated' then '1084971824315078'
  when 'status_updated' then '28383522704653151' when 'reminder' then '4488234441393579' end;
 if expected_id is null or e->>'templateId' is distinct from expected_id
  or jsonb_typeof(e->'components') is distinct from 'array' or jsonb_array_length(e->'components')<>2
  or e#>>'{components,0,type}' is distinct from 'body'
  or jsonb_typeof(e#>'{components,0,parameters}') is distinct from 'array'
  or jsonb_array_length(e#>'{components,0,parameters}')<>(case kind when 'added' then 9 when 'rescheduled' then 8 when 'cancelled' then 6 when 'removed' then 5 when 'details_updated' then 6 when 'status_updated' then 7 when 'reminder' then 8 end)
  then return false;end if;
 for parameter in select value from jsonb_array_elements(e#>'{components,0,parameters}') loop
  if parameter->>'type' is distinct from 'text' or jsonb_typeof(parameter->'text') is distinct from 'string' or length(parameter->>'text') not between 1 and 512 then return false;end if;
 end loop;
 suffix:=e#>>'{components,1,parameters,0,text}';
 if suffix is null or suffix not in(token,token||'?v='||version::text)
  or e->'components'->1 is distinct from jsonb_build_object('type','button','sub_type','url','index','0','parameters',jsonb_build_array(jsonb_build_object('type','text','text',suffix)))
  or e->'buttons' is distinct from jsonb_build_array(jsonb_build_object('index',0,'type','url','label','View appointment','url',origin||'/appointment/'||suffix)) then return false;end if;
 return true;
exception when others then return false;
end $$;
revoke all on function client_portal_secure.ghl_template_evidence_valid(jsonb,text,text,bigint,text) from public,anon,authenticated,service_role;

create function communications_secure.template_evidence_payload(ciphertext bytea, key_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare secret text;
begin
 select v.decrypted_secret into secret from communications_secure.content_keys k join vault.decrypted_secrets v on v.id=k.vault_secret_id where k.id=key_id;
 if secret is null or ciphertext is null then raise exception 'template_evidence_key_unavailable';end if;
 return extensions.pgp_sym_decrypt(ciphertext,secret)::jsonb;
end $$;
revoke all on function communications_secure.template_evidence_payload(bytea,uuid) from public,anon,authenticated,service_role;

-- A body-only edit must not re-encrypt the redacted evidence placeholder. A
-- later provider payload update can add metadata, but cannot replace evidence.
create function communications_secure.preserve_template_evidence()
returns trigger language plpgsql security definer set search_path='' as $$
declare retained jsonb; incoming jsonb;
begin
 if new.raw_payload is not distinct from old.raw_payload then return new;end if;
 retained:=communications_secure.template_evidence_payload(old.raw_payload_ciphertext,old.body_key_id)->'template_evidence';
 incoming:=new.raw_payload->'template_evidence';
 if retained is null or (incoming is not null and incoming is distinct from retained and incoming is distinct from old.raw_payload->'template_evidence') then raise exception 'template_evidence_is_immutable';end if;
 new.raw_payload:=coalesce(new.raw_payload,'{}'::jsonb)||jsonb_build_object('template_evidence',retained);
 return new;
end $$;
revoke all on function communications_secure.preserve_template_evidence() from public,anon,authenticated,service_role;
create trigger a_preserve_template_evidence before update of raw_payload on public.client_messages
for each row when (old.raw_payload ? 'template_evidence') execute function communications_secure.preserve_template_evidence();

do $migration$
declare d text; needle text;
begin
 d:=pg_get_functiondef('communications_secure.encrypt_client_message()'::regprocedure);
 needle:=$n$if new.raw_payload is not null and new.raw_payload <> '{}'::jsonb then$n$;
 if position(needle in d)=0 then raise exception 'Unexpected encrypted message payload owner';end if;
 execute replace(d,needle,$n$if tg_op='UPDATE' and old.raw_payload ? 'template_evidence' and new.raw_payload is not distinct from old.raw_payload
        and key_loaded and content_key.key_id is distinct from old.body_key_id then
        -- A rotated body key also requires the payload to move to that key.
        new.raw_payload:=communications_secure.template_evidence_payload(old.raw_payload_ciphertext,old.body_key_id);
    end if;
    if new.raw_payload is not null and new.raw_payload <> '{}'::jsonb
        and not (tg_op='UPDATE' and old.raw_payload ? 'template_evidence' and new.raw_payload is not distinct from old.raw_payload) then$n$);
 d:=pg_get_functiondef('public.ghl_appointment_automation(text,jsonb)'::regprocedure);
 needle:=$n$return jsonb_build_object('profile',client_portal_secure.ghl_appointment_profile_json(p),'privateToken',secret_value$n$;
 if position(needle in d)=0 then raise exception 'Unexpected notification context';end if;
 d:=replace(d,needle,$n$return jsonb_build_object('templateEvidenceVersion',1,'profile',client_portal_secure.ghl_appointment_profile_json(p),'privateToken',secret_value$n$);
 needle:=$n$  insert into public.client_messages(workspace_id,relationship_id,client_id,communication_channel_id,direction,provider,to_address,body,status,sender_kind,automation_kind,automation_label,client_request_id,raw_payload)$n$;
 if position(needle in d)=0 then raise exception 'Unexpected notification message admission';end if;
 d:=replace(d,needle,$n$  if p_input ? 'templateEvidence' then
   if not client_portal_secure.ghl_template_evidence_valid(p_input->'templateEvidence',o.kind,o.summary_token,o.version,p.portal_origin) then return jsonb_build_object('failure','template_evidence');end if;
   if (p_input#>>'{templateEvidence,capturedAt}')::timestamptz<now()-interval '5 minutes' or (p_input#>>'{templateEvidence,capturedAt}')::timestamptz>now()+interval '1 minute' then return jsonb_build_object('failure','template_evidence');end if;
  end if;
$n$||needle);
 needle:=$n$jsonb_build_object('ghl_appointment_outbox_id',o.id,'template_name',p_input->>'templateName','template_language','en_US')) returning id into message_uuid;$n$;
 if position(needle in d)=0 then raise exception 'Unexpected encrypted notification content';end if;
 d:=replace(d,needle,$n$jsonb_build_object('ghl_appointment_outbox_id',o.id,'template_name',p_input->>'templateName','template_language','en_US')
   ||case when p_input ? 'templateEvidence' then jsonb_build_object('template_evidence',jsonb_build_object('text',((p_input->'templateEvidence')||jsonb_build_object('outboxId',o.id,'appointmentId',o.appointment_id,'appointmentVersion',o.version))::text)) else '{}'::jsonb end) returning id into message_uuid;$n$);
 needle:=$n$return jsonb_build_object('messageId',message_uuid,'deliveryId',delivery_uuid,'destination',p_input->>'destination');$n$;
 if position(needle in d)=0 then raise exception 'Unexpected dispatch acknowledgement';end if;
 d:=replace(d,needle,$n$return jsonb_build_object('messageId',message_uuid,'deliveryId',delivery_uuid,'destination',p_input->>'destination','templateEvidenceRecorded',p_input ? 'templateEvidence');$n$);
 execute d;
end $migration$;
notify pgrst,'reload schema';
commit;
