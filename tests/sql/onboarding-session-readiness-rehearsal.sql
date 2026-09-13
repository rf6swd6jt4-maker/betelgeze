-- Exercise live schema owners with no persistent writes or provider calls.
set local role service_role;
do $$ declare s record; actor uuid; result jsonb; restarted uuid; before_peer jsonb; after_peer jsonb; tests integer:=0; begin
 for s in select * from public.relationship_onboarding_sessions where status in('active','completed') and token_revoked_at is null limit 30 loop
  perform public.read_onboarding_session_reuse(s.workspace_id,s.id,s.session_token);
  select user_id into actor from public.workspace_memberships where workspace_id=s.workspace_id and role in('owner','admin') limit 1;
  if actor is not null then perform public.read_onboarding_panel_sessions(s.workspace_id,actor,0,s.relationship_id); end if;
 end loop;
 for s in select * from public.relationship_onboarding_sessions where service_scope='selected_services' and is_test and status='active' order by created_at desc limit 1 loop
  select user_id into actor from public.workspace_memberships where workspace_id=s.workspace_id and role in('owner','admin') limit 1;
  select jsonb_agg(to_jsonb(peer) order by id) into before_peer from public.relationship_onboarding_sessions peer where peer.workspace_id=s.workspace_id and peer.relationship_id=s.relationship_id and peer.id<>s.id;
  begin
   result:=public.restart_relationship_onboarding_session(s.workspace_id,s.relationship_id,s.id,actor);
   restarted:=(result->>'session_id')::uuid;
   if restarted is null then raise exception 'Restart missing replacement'; end if;
   if (public.restart_relationship_onboarding_session(s.workspace_id,s.relationship_id,s.id,actor)->>'session_id')::uuid<>restarted then raise exception 'Restart replay mismatch'; end if;
   select jsonb_agg(to_jsonb(peer) order by id) into after_peer from public.relationship_onboarding_sessions peer where peer.workspace_id=s.workspace_id and peer.relationship_id=s.relationship_id and peer.id not in(s.id,restarted);
   if before_peer is distinct from after_peer then raise exception 'Restart touched another session'; end if;
   raise exception using errcode='Z0001',message='intentional rehearsal rollback';
  exception when sqlstate 'Z0001' then tests:=tests+1;
  end;
 end loop;
 raise notice 'SS04 live read checks and % selected test restart passed; transaction will roll back',tests;
end $$;
reset role;
select 'SS04_REHEARSAL_PASSED' result,
(select count(*) from public.relationship_onboarding_sessions where welcome_completed_at is not null) proven_welcomes,
(select count(*) from public.relationship_onboarding_sessions where service_scope='selected_services') selected_sessions,
(select count(*) from public.workspace_teams where relationship_id is not null) relationship_teams;
rollback;
