-- Bounded approved contact-field capture, separate from appointment notices.
-- No live mappings, flags, messages, retained versions or jobs are rewritten.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';

create function client_portal_secure.valid_ghl_lead_field_mapping(value jsonb)
returns boolean language plpgsql immutable set search_path='' as $$
declare item jsonb; field_id text; field_label text; seen text[]:='{}';
begin
 if jsonb_typeof(value) is distinct from 'array' then return false;end if;
 if jsonb_array_length(value)>8 or octet_length(value::text)>4096 then return false;end if;
 for item in select x from jsonb_array_elements(value) x loop
  if jsonb_typeof(item) is distinct from 'object' or item-'fieldId'-'label'<>'{}'::jsonb
   or jsonb_typeof(item->'fieldId') is distinct from 'string' or jsonb_typeof(item->'label') is distinct from 'string' then return false;end if;
  field_id:=item->>'fieldId';field_label:=item->>'label';
  if field_id !~ '^[a-zA-Z0-9_-]{1,160}$' or length(field_label) not between 1 and 200
   or field_label<>btrim(field_label) or field_label~'[[:cntrl:]]' or array_position(seen,field_id) is not null then return false;end if;
  seen:=array_append(seen,field_id);
 end loop;
 return true;
end $$;
revoke all on function client_portal_secure.valid_ghl_lead_field_mapping(jsonb) from public,anon,authenticated,service_role;

-- Domain validation runs when this value is assigned; unrelated worker lease
-- and reconciliation updates do not repeatedly validate the stored mapping.
create domain client_portal_secure.ghl_lead_field_mapping as jsonb
 constraint ghl_appointment_lead_field_mapping_valid check(value='[]'::jsonb or client_portal_secure.valid_ghl_lead_field_mapping(value));
alter table client_portal_secure.ghl_appointment_profiles
 add column lead_field_mapping client_portal_secure.ghl_lead_field_mapping not null default '[]';

do $migration$
declare d text; needle text;
begin
 d:=pg_get_functiondef('client_portal_secure.ghl_appointment_profile_json(client_portal_secure.ghl_appointment_profiles)'::regprocedure);
 needle:=$n$'includeNotes',p.include_notes$n$;
 if (length(d)-length(replace(d,needle,'')))/length(needle)<>1 then raise exception 'Unexpected appointment profile lead mapping projection';end if;
 execute replace(d,needle,needle||$n$,'leadFieldMapping',p.lead_field_mapping$n$);

 d:=pg_get_functiondef('public.ghl_appointment_automation(text,jsonb)'::regprocedure);
 needle:=$n$next_snapshot jsonb;$n$;
 if (length(d)-length(replace(d,needle,'')))/length(needle)<>1 then raise exception 'Unexpected appointment lead capture declarations';end if;
 d:=replace(d,needle,needle||' lead_capture text; retained_lead_capture text;');
 -- Both accepted snapshots are objects. Remove ignored metadata in one pass
 -- rather than copying richer details through four intermediate objects.
 needle:=$n$s.snapshot-'observedAt'-'sourceUpdatedAt'-'sourceCreatedAt'-'details'=next_snapshot-'observedAt'-'sourceUpdatedAt'-'sourceCreatedAt'-'details'$n$;
 if (length(d)-length(replace(d,needle,'')))/length(needle)<>1 then raise exception 'Unexpected appointment equality boundary';end if;
 d:=replace(d,needle,$n$(s.snapshot-array['observedAt','sourceUpdatedAt','sourceCreatedAt','details']::text[])=(next_snapshot-array['observedAt','sourceUpdatedAt','sourceCreatedAt','details']::text[])$n$);
 needle:=$n$  if not(next_snapshot ? 'details') and s.snapshot ? 'details' then next_snapshot:=next_snapshot||jsonb_build_object('details',s.snapshot->'details');end if;$n$;
 if (length(d)-length(replace(d,needle,'')))/length(needle)<>1 then raise exception 'Unexpected appointment detail compatibility boundary';end if;
 execute replace(d,needle,$n$  if not(next_snapshot ? 'details') and s.snapshot ? 'details' then
   -- Legacy callers without structured details cannot carry another contact's
   -- lead information. Preserve all other existing compatibility behavior.
   next_snapshot:=next_snapshot||jsonb_build_object('details',case when s.connection_revision=p.connection_revision and nullif(next_snapshot->>'contactId','') is not null and next_snapshot->>'contactId'=s.snapshot->>'contactId' then s.snapshot->'details' else (s.snapshot->'details')-'lead' end);
  elsif s.snapshot->'details' ? 'lead' and jsonb_typeof(next_snapshot->'details')='object' and not(next_snapshot->'details' ? 'lead')
   and s.connection_revision=p.connection_revision and nullif(next_snapshot->>'contactId','') is not null and next_snapshot->>'contactId'=s.snapshot->>'contactId' then
   -- A pre-lead worker still supplies a details object. Only an omitted lead
   -- field is carried forward; explicit new data, including nulls, wins.
   next_snapshot:=jsonb_set(next_snapshot,'{details,lead}',s.snapshot->'details'->'lead');
  end if;
  -- No-lead callers avoid the capture path. Read each timestamp once when
  -- both projections contain lead data; no history or extra row is fetched.
  if next_snapshot->'details' ? 'lead' and s.snapshot->'details' ? 'lead' then
   lead_capture:=next_snapshot#>>'{details,lead,capturedAt}';
   retained_lead_capture:=s.snapshot#>>'{details,lead,capturedAt}';
   -- Equal/newer fixed-width UTC needs no retention or date parsing. Older
   -- or noncanonical values must pass every identity and validity check.
   if length(lead_capture)=24 and length(retained_lead_capture)=24
    and lead_capture like '____-__-__T__:__:__.___Z' and retained_lead_capture like '____-__-__T__:__:__.___Z'
    and lead_capture collate "C">=retained_lead_capture collate "C" then null;
   elsif s.connection_revision=p.connection_revision and nullif(next_snapshot->>'contactId','') is not null
    and next_snapshot->>'contactId'=s.snapshot->>'contactId'
    and jsonb_typeof(next_snapshot#>'{details,lead,capturedAt}')='string' and jsonb_typeof(s.snapshot#>'{details,lead,capturedAt}')='string'
    and length(lead_capture)<=64 and length(retained_lead_capture)<=64
    and lead_capture~'^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]+)?(Z|[+-][0-9]{2}:[0-9]{2})$'
    and retained_lead_capture~'^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]+)?(Z|[+-][0-9]{2}:[0-9]{2})$'
    and (case when pg_input_is_valid(lead_capture,'timestamp with time zone') and pg_input_is_valid(retained_lead_capture,'timestamp with time zone')
     then lead_capture::timestamptz<retained_lead_capture::timestamptz else false end) then
    next_snapshot:=jsonb_set(next_snapshot,'{details,lead}',s.snapshot->'details'->'lead');
   end if;
  end if;$n$);
 -- Reuse the existing authorized session join. This value is internal to the
 -- server summary adapter; the public appointment projection remains explicit.
 d:=pg_get_functiondef('public.read_ghl_appointment_summary(text,text,text)'::regprocedure);
 needle:=$n$'relationshipId',p.relationship_id$n$;
 if (length(d)-length(replace(d,needle,'')))/length(needle)<>1 then raise exception 'Unexpected appointment summary portal session projection';end if;
 execute replace(d,needle,needle||$n$,'portalSessionToken',ps.session_token$n$);
end $migration$;
notify pgrst,'reload schema';
commit;
