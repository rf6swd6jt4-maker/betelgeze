-- Preserve the existing credential-only begin contract. The legacy owner has
-- already authorized and leased the manual refresh; finish still fences revision.
-- No client state, flags, credentials, message history or installed migration changes.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';
do $migration$
declare d text; boundary text; old_return text;
begin
 d:=pg_get_functiondef('public.client_portal_ghl_calendar_v2(text,uuid,text,uuid,text,text,jsonb,text)'::regprocedure);
 boundary:=$n$ if result ? 'failure' then return result;end if;
 select relationship_id into target$n$;
 old_return:=$n$ if p_action='begin' then return result;end if;
$n$;
 if (length(d)-length(replace(d,boundary,'')))/length(boundary)<>1
  or (length(d)-length(replace(d,old_return,'')))/length(old_return)<>1 then
  raise exception 'Unexpected portal calendar begin contract';
 end if;
 d:=replace(d,old_return,'');
 d:=replace(d,boundary,$n$ if result ? 'failure' then return result;end if;
 -- Begin intentionally has no revision/calendars projection. Keep its legacy
 -- authorization, selected-calendar validation, cooldown and lease unchanged.
 if p_action='begin' then return result;end if;
 select relationship_id into target$n$);
 execute d;
end $migration$;
notify pgrst,'reload schema';
commit;
