-- Add bounded metadata comparison to the existing leased recovery owner.
-- No client settings, stored appointments or deliveries are rewritten.
begin;
do $migration$
declare d text; needle text;
begin
 d:=pg_get_functiondef('client_portal_secure.ghl_appointment_profile_json(client_portal_secure.ghl_appointment_profiles)'::regprocedure);
 needle:=$n$'sendingActivatedAt',p.sending_activated_at$n$;
 if position(needle in d)=0 then raise exception 'Unexpected profile projection';end if;
 execute replace(d,needle,needle||$n$,'createdAt',p.created_at$n$);
 d:=pg_get_functiondef('public.ghl_appointment_automation(text,jsonb)'::regprocedure);
 needle:=$n$p_action in('finish_reconciliation','reconciliation_candidates')$n$;
 if position(needle in d)=0 then raise exception 'Unexpected recovery lease branch';end if;
 d:=replace(d,needle,$n$p_action in('finish_reconciliation','reconciliation_candidates','reconciliation_changes')$n$);
 needle:=$n$  if p_action='reconciliation_candidates' then$n$;
 if position(needle in d)=0 then raise exception 'Unexpected recovery candidates branch';end if;
 d:=replace(d,needle,$branch$
  if p_action='reconciliation_changes' then
   if jsonb_typeof(p_input->'observations') is distinct from 'array' or jsonb_array_length(p_input->'observations')>1000 or octet_length((p_input->'observations')::text)>524288 or not exists(select 1 from jsonb_array_elements(client_portal_secure.calendar_choices(p.calendars,p.calendar_id,p.calendar_name)) x where x->>'id'=p_input->>'calendarId') then return jsonb_build_object('failure','input');end if;
   select coalesce(jsonb_agg(x.item),'[]'::jsonb) into items from (
    select jsonb_build_object('id',v->>'id','version',coalesce(a.version,0)) item
    from jsonb_array_elements(p_input->'observations') v
    left join client_portal_secure.ghl_appointment_snapshots a on a.profile_id=p.id and a.appointment_id=v->>'id'
    where nullif(v->>'id','') is not null and length(v->>'id')<=160
     and (a.appointment_id is null or (nullif(v->>'updatedAt','')::timestamptz is not null and (a.source_updated_at is null or (v->>'updatedAt')::timestamptz>a.source_updated_at))
      or (a.snapshot->>'startTime')::timestamptz is distinct from (v->>'startTime')::timestamptz
      or (a.snapshot->>'endTime')::timestamptz is distinct from (v->>'endTime')::timestamptz
      or a.snapshot->>'status' is distinct from v->>'status' or a.snapshot->>'title' is distinct from v->>'title'
      or a.snapshot->>'contactId' is distinct from v->>'contactId' or a.snapshot->>'calendarId' is distinct from p_input->>'calendarId')
     and not exists(select 1 from client_portal_secure.ghl_appointment_inbox i where i.profile_id=p.id and i.appointment_id=v->>'id' and i.status in('pending','leased','quarantined'))
    order by v->>'id' limit least(bound,5)
   ) x;
   return jsonb_build_object('items',items);
  end if;
$branch$||needle);
 needle:=$n$last_error=left(p_input->>'error',160) where id=p.id;$n$;
 if position(needle in d)=0 then raise exception 'Unexpected recovery diagnostics';end if;
 d:=replace(d,needle,$n$last_error=left(coalesce(p_input->>'error',p_input->>'warning'),160) where id=p.id;$n$);
 -- Provider creation time is import metadata, not a visible appointment change.
 needle:=$n$s.snapshot-'observedAt'-'sourceUpdatedAt'=next_snapshot-'observedAt'-'sourceUpdatedAt'$n$;
 if position(needle in d)=0 then raise exception 'Unexpected snapshot equality';end if;
 d:=replace(d,needle,$n$s.snapshot-'observedAt'-'sourceUpdatedAt'-'sourceCreatedAt'=next_snapshot-'observedAt'-'sourceUpdatedAt'-'sourceCreatedAt'$n$);
 execute d;
end $migration$;
notify pgrst,'reload schema';
commit;
