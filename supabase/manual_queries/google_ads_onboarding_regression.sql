begin;
set local role service_role;
do $qa$
declare
    w uuid := gen_random_uuid(); r uuid := gen_random_uuid(); s uuid := gen_random_uuid();
    step_id uuid := gen_random_uuid(); block_id uuid := gen_random_uuid(); rev uuid := gen_random_uuid();
    attempt uuid := gen_random_uuid(); result jsonb; item uuid := gen_random_uuid();
begin
    insert into public.workspaces(id,name,slug) values(w,'Google onboarding transaction QA','google-ob-qa-'||left(w::text,8));
    insert into public.relationships(id,workspace_id,primary_person_name,lifecycle_phase) values(r,w,'Transaction QA','onboarding');
    insert into public.relationship_onboarding_sessions(id,workspace_id,relationship_id,session_token,is_test) values(s,w,r,s::text,false);
    insert into public.onboarding_configuration_revisions(id,workspace_id,configuration_type,definition_hash) values(rev,w,'welcome','qa');
    insert into public.relationship_onboarding_session_steps(id,workspace_id,session_id,kind,title,sort_order,bookend_revision_id) values(step_id,w,s,'welcome','Google Ads QA',0,rev);
    insert into public.relationship_onboarding_session_blocks(id,workspace_id,session_id,session_step_id,source_block_id,kind,sort_order,definition)
      values(block_id,w,s,step_id,gen_random_uuid(),'connection',0,'{"kind":"connection","provider":"google_ads","label":"Connect Google Ads"}');
    insert into public.workspace_integrations(workspace_id,provider,enabled,mode,connected_account_id,connection_status,config_encrypted,config_hint)
      values(w,'google_ads',true,'connected','1111111111','connected','qa-config','{"manager_name":"QA Agency"}');
    insert into public.work_items(id,workspace_id,title,native_kind,metadata) values(item,w,'Google onboarding QA','onboarding_step',jsonb_build_object('session_step_id',step_id));
    begin
        perform public.begin_google_ads_onboarding('wrong-token',block_id,'2222222222','1111111111',attempt);
        raise exception 'Wrong token was accepted';
    exception when sqlstate 'P0001' then if sqlerrm = 'Wrong token was accepted' then raise; end if; end;
    perform public.begin_google_ads_onboarding(s::text,block_id,'2222222222','1111111111',attempt);
    begin
        perform public.finish_google_ads_onboarding(s::text,block_id,gen_random_uuid(),'qa-config','connected');
        raise exception 'Stale attempt was accepted';
    exception when sqlstate 'P0001' then if sqlerrm = 'Stale attempt was accepted' then raise; end if; end;
    begin
        perform public.finish_google_ads_onboarding(s::text,block_id,attempt,'changed-config','connected');
        raise exception 'Changed credentials were accepted';
    exception when sqlstate 'P0001' then if sqlerrm = 'Changed credentials were accepted' then raise; end if; end;
    result := public.finish_google_ads_onboarding(s::text,block_id,attempt,'qa-config','pending');
    if result->>'status' <> 'pending' or exists(select 1 from public.onboarding_block_requirements where session_block_id=block_id) then raise exception 'Pending marked complete'; end if;
    begin
        update public.work_items set status='done' where id=item;
        raise exception 'Unverified account completed onboarding';
    exception when sqlstate 'P0001' then if sqlerrm = 'Unverified account completed onboarding' then raise; end if; end;
    update public.relationship_google_ads_connections set updated_at=now()-interval '10 seconds' where workspace_id=w;
    attempt := gen_random_uuid();
    perform public.begin_google_ads_onboarding(s::text,block_id,'2222222222','1111111111',attempt);
    result := public.finish_google_ads_onboarding(s::text,block_id,attempt,'qa-config','connected','QA Ads','EUR','Europe/Dublin');
    if result->>'status' <> 'connected' or not exists(select 1 from public.onboarding_block_requirements where session_block_id=block_id and requirement_kind='google_ads_connected') then raise exception 'Verified account did not complete'; end if;
    update public.work_items set status='done' where id=item;
    begin
        perform public.begin_google_ads_onboarding(s::text,block_id,'2222222222','1111111111',gen_random_uuid());
        raise exception 'Submitted step was changed';
    exception when sqlstate 'P0001' then if sqlerrm = 'Submitted step was changed' then raise; end if; end;
    if has_function_privilege('anon','public.finish_google_ads_onboarding(text,uuid,uuid,text,text,text,text,text,text)','EXECUTE') or has_function_privilege('authenticated','public.finish_google_ads_onboarding(text,uuid,uuid,text,text,text,text,text,text)','EXECUTE') then raise exception 'Public access to trusted finalization'; end if;
end $qa$;
select true as google_onboarding_guards_and_completion_passed;
rollback;
