-- Stage user service commands; publish the service and work in one transaction.
begin;
create table public.sop_service_intents (
 instance_id uuid primary key,
 workspace_id uuid not null references workspaces(id),
 relationship_id uuid not null references relationships(id),
 requested_by uuid not null references auth.users(id),
 request_id uuid not null,
 command jsonb not null,
 proposed_instance jsonb not null,
 expected_version integer,
 actual_instance_id uuid references relationship_service_instances(id),
 published_at timestamptz,
 created_at timestamptz not null default now(),
 unique(workspace_id,request_id)
);
alter table public.sop_service_intents enable row level security;
revoke all on public.sop_service_intents from public,anon,authenticated;
grant all on public.sop_service_intents to service_role;
-- A pending service has an intent identity, not an active service row.
alter table public.sop_work_requests drop constraint sop_work_requests_instance_id_fkey;
alter table public.sop_work_runs drop constraint sop_work_runs_instance_id_fkey;

create function public.sop_generation_instance(p_workspace uuid,p_relationship uuid,p_instance uuid)
returns public.relationship_service_instances language plpgsql set search_path=public as $$
declare intent sop_service_intents; result relationship_service_instances; current_version integer;
begin
 select * into intent from sop_service_intents where workspace_id=p_workspace and relationship_id=p_relationship and instance_id=p_instance and published_at is null;
 if found then
  if not can_manage_relationship_service(p_workspace,p_relationship,intent.requested_by,intent.proposed_instance->>'origin') then raise exception 'Service editing access was revoked.'; end if;
  if intent.expected_version is not null then
   select version into current_version from relationship_service_instances where workspace_id=p_workspace and relationship_id=p_relationship and id=p_instance for share;
   if current_version is distinct from intent.expected_version then raise exception 'Service changed during generation; review it before retrying.'; end if;
  end if;
  select * into result from jsonb_populate_record(null::relationship_service_instances,intent.proposed_instance);
 else
  select * into result from relationship_service_instances where workspace_id=p_workspace and relationship_id=p_relationship and id=p_instance for share;
 end if;
 return result;
end $$;

create function public.stage_sop_service_command(p_workspace uuid,p_relationship uuid,p_actor uuid,p_request uuid,p_command jsonb)
returns jsonb language plpgsql set search_path=public as $$
declare intent sop_service_intents; proposed relationship_service_instances; target uuid; binding sop_service_sources; expected integer;
begin
 perform 1 from relationships where workspace_id=p_workspace and id=p_relationship for update;
 select * into intent from sop_service_intents where workspace_id=p_workspace and request_id=p_request;
 if found then
  if not can_manage_relationship_service(p_workspace,p_relationship,p_actor,intent.proposed_instance->>'origin') then raise exception 'Service editing access required.'; end if;
  if intent.command is distinct from p_command or intent.requested_by<>p_actor or intent.relationship_id<>p_relationship then raise exception 'Request ID reused with different service details.'; end if;
  return jsonb_build_object('id',intent.instance_id,'generation',true);
 end if;
 -- Existing validators run in a rollback-only subtransaction. Their writes,
 -- stage events and outbox effects never become visible before publication.
 begin
  if p_command->>'kind'='add' then
   target:=add_relationship_service(p_workspace,p_relationship,p_actor,p_request,(p_command->>'service_id')::uuid,(p_command->>'revision_id')::uuid,p_command->>'origin','setup',(p_command->>'assignee')::uuid);
  else
   target:=(p_command->>'instance_id')::uuid;
   expected:=(p_command->>'version')::integer;
   if not exists(select 1 from relationship_service_instances where workspace_id=p_workspace and relationship_id=p_relationship and id=target) then raise exception 'Service not found.'; end if;
   perform change_service_instance(p_workspace,target,p_actor,p_request,expected,'setup',p_command->>'disposition',(p_command->>'assignee')::uuid,p_command->>'reason');
  end if;
  select * into strict proposed from relationship_service_instances where workspace_id=p_workspace and id=target;
  raise exception using errcode='PZ001',message='retain validated intent only';
 exception when sqlstate 'PZ001' then null;
 end;
 select * into binding from sop_service_sources where workspace_id=p_workspace and service_id=proposed.service_id and enabled;
 if not found then raise exception 'Link this service to a main SOP file before generating work.'; end if;
 if exists(select 1 from sop_work_runs where workspace_id=p_workspace and instance_id=target) then raise exception 'This service already has a generation run; recover that run first.'; end if;
 insert into sop_service_intents(instance_id,workspace_id,relationship_id,requested_by,request_id,command,proposed_instance,expected_version)
 values(target,p_workspace,p_relationship,p_actor,p_request,p_command,to_jsonb(proposed),expected);
 insert into sop_work_requests(instance_id,workspace_id,relationship_id,sop_id,asset_id,requested_by)
 values(target,p_workspace,p_relationship,binding.sop_id,binding.asset_id,binding.configured_by);
 return jsonb_build_object('id',target,'generation',true);
end $$;

create or replace function public.add_relationship_service_with_sop(p_workspace_id uuid,p_relationship_id uuid,p_actor_user_id uuid,p_request_id uuid,p_service_id uuid,p_revision_id uuid,p_origin text,p_stage text,p_assignee_user_id uuid,p_generation_enabled boolean) returns jsonb
language plpgsql set search_path=public as $$
declare instance uuid;
begin
 if p_stage='setup' and exists(select 1 from relationships where workspace_id=p_workspace_id and id=p_relationship_id and source_metadata->>'is_test'='true' and status<>'archived') then
  if not p_generation_enabled then raise exception 'Work generation unavailable; service was not added.'; end if;
  return stage_sop_service_command(p_workspace_id,p_relationship_id,p_actor_user_id,p_request_id,jsonb_build_object('kind','add','service_id',p_service_id,'revision_id',p_revision_id,'origin',p_origin,'assignee',p_assignee_user_id));
 end if;
 instance:=add_relationship_service(p_workspace_id,p_relationship_id,p_actor_user_id,p_request_id,p_service_id,p_revision_id,p_origin,p_stage,p_assignee_user_id);
 return service_sop_save_result(p_workspace_id,p_relationship_id,instance,p_generation_enabled);
end $$;
create or replace function public.change_relationship_service_with_sop(p_workspace_id uuid,p_relationship_id uuid,p_instance_id uuid,p_actor_user_id uuid,p_request_id uuid,p_expected_version integer,p_stage text,p_disposition text,p_assignee_user_id uuid,p_reason text,p_generation_enabled boolean) returns jsonb
language plpgsql set search_path=public as $$
begin
 if p_stage='setup' and p_disposition='active'
 and exists(select 1 from relationships where workspace_id=p_workspace_id and id=p_relationship_id and source_metadata->>'is_test'='true' and status<>'archived')
 and not exists(select 1 from sop_work_runs where workspace_id=p_workspace_id and instance_id=p_instance_id and status='published') then
  if not p_generation_enabled then raise exception 'Work generation unavailable; service stage was not changed.'; end if;
  return stage_sop_service_command(p_workspace_id,p_relationship_id,p_actor_user_id,p_request_id,jsonb_build_object('kind','change','instance_id',p_instance_id,'version',p_expected_version,'disposition',p_disposition,'assignee',p_assignee_user_id,'reason',p_reason));
 end if;
 if not exists(select 1 from relationship_service_instances where workspace_id=p_workspace_id and relationship_id=p_relationship_id and id=p_instance_id) then raise exception 'Service not found.'; end if;
 perform change_service_instance(p_workspace_id,p_instance_id,p_actor_user_id,p_request_id,p_expected_version,p_stage,p_disposition,p_assignee_user_id,p_reason);
 return service_sop_save_result(p_workspace_id,p_relationship_id,p_instance_id,p_generation_enabled);
end $$;

-- Materialize the intent inside the same transaction as work and attachments.
alter function public.publish_sop_work(uuid,uuid) rename to publish_sop_work_with_assets;
create function public.publish_sop_work(p_id uuid,p_lease uuid) returns uuid[] language plpgsql set search_path=public as $$
declare job sop_work_runs; intent sop_service_intents; target uuid; result uuid[];
begin
 select * into job from sop_work_runs where id=p_id for update;
 if not found then raise exception 'Run not found.'; end if;
 if job.status='published' then return job.work_item_ids; end if;
 if job.status<>'running' or job.lease_token is distinct from p_lease or job.lease_until<=now() then raise exception 'Run lease expired.'; end if;
 select * into intent from sop_service_intents where workspace_id=job.workspace_id and instance_id=job.instance_id and published_at is null for update;
 if found then
  perform prepare_sop_work(p_id,p_lease);
  if intent.command->>'kind'='add' then
   target:=add_relationship_service(intent.workspace_id,intent.relationship_id,intent.requested_by,intent.request_id,(intent.command->>'service_id')::uuid,(intent.command->>'revision_id')::uuid,intent.command->>'origin','setup',(intent.command->>'assignee')::uuid);
   -- The ordinary add command allocates the final service identity here.
   delete from sop_work_requests where instance_id=target and run_id is null;
   update sop_work_runs set instance_id=target where id=p_id;
  else
   target:=intent.instance_id;
   perform change_service_instance(intent.workspace_id,target,intent.requested_by,intent.request_id,intent.expected_version,'setup',intent.command->>'disposition',(intent.command->>'assignee')::uuid,intent.command->>'reason');
  end if;
  update sop_service_intents set actual_instance_id=target,published_at=now() where instance_id=intent.instance_id;
 end if;
 result:=publish_sop_work_with_assets(p_id,p_lease);
 return result;
end $$;

create or replace function public.assert_sop_work_scope(p_workspace uuid,p_actor uuid,p_relationship uuid,p_session uuid,p_service text) returns void
language plpgsql set search_path=public as $$
declare r relationships; i relationship_service_instances;
begin
    perform assert_sop_admin(p_workspace,p_actor);
    select * into r from relationships where workspace_id=p_workspace and id=p_relationship for update;
    if not found or r.source_metadata->>'is_test' is distinct from 'true' or r.status='archived' then
        raise exception 'Use an active test relationship.';
    end if;
    i:=sop_generation_instance(p_workspace,p_relationship,p_service::uuid);
    if i.id is null or i.stage<>'setup' or i.disposition<>'active' or i.import_id is not null then raise exception 'Choose an active service in Setup.'; end if;
    if p_session is not null and not exists(select 1 from service_instance_sessions e join relationship_onboarding_sessions s on s.id=e.session_id and s.workspace_id=e.workspace_id
      where e.workspace_id=p_workspace and e.instance_id=i.id and s.id=p_session and s.archived_at is null and s.status='completed') then raise exception 'The service onboarding session is unavailable.'; end if;
    if i.assignee_user_id is not null and not exists(select 1 from workspace_memberships m join workspace_member_service_access a using(workspace_id,user_id)
      where m.workspace_id=p_workspace and m.user_id=i.assignee_user_id and a.service_id=i.service_id) then raise exception 'The service assignee no longer has access.'; end if;
end $$;
create or replace function public.queue_sop_work(p_workspace uuid,p_actor uuid,p_id uuid,p_sop uuid,p_asset uuid,p_relationship uuid,p_service text,p_model text,p_daily_limit integer default 10) returns uuid
language plpgsql set search_path=public as $$
declare existing sop_work_runs; sess uuid; interpretation uuid; grp uuid; instance relationship_service_instances;
begin
    perform assert_sop_admin(p_workspace,p_actor);
    perform 1 from workspaces where id=p_workspace for update;
    instance:=sop_generation_instance(p_workspace,p_relationship,p_service::uuid);
    if instance.id is null then raise exception 'Service instance not found.'; end if;
    select * into existing from sop_work_runs where workspace_id=p_workspace and instance_id=instance.id for update;
    if found then
        if existing.sop_id<>p_sop or existing.asset_id<>p_asset then raise exception 'This service already has a run with another source. Use a new test service.'; end if;
        return existing.id;
    end if;
    select s.id into sess from service_instance_sessions e join relationship_onboarding_sessions s on s.workspace_id=e.workspace_id and s.id=e.session_id
      where e.workspace_id=p_workspace and e.instance_id=instance.id and s.status='completed' and s.archived_at is null order by s.created_at desc limit 1;
    perform assert_sop_work_scope(p_workspace,p_actor,p_relationship,sess,p_service);
    if p_daily_limit not between 1 and 100 or (select count(*) from sop_work_attempts where workspace_id=p_workspace and created_at>=date_trunc('day',now() at time zone 'UTC') at time zone 'UTC')>=p_daily_limit then raise exception 'The daily work-generation attempt limit has been reached.'; end if;
    if p_model is null or p_model !~ '^[a-zA-Z0-9_.:-]{1,100}$' then raise exception 'Invalid model.'; end if;
    if exists(select 1 from service_instance_work_items l join work_items w on w.id=l.work_item_id
      where l.workspace_id=p_workspace and l.instance_id=instance.id and w.lifecycle_phase='fulfilment') then raise exception 'This service already has setup work. Use a fresh test service.'; end if;
    if not exists(select 1 from sop_service_sources where workspace_id=p_workspace and service_id=instance.service_id and sop_id=p_sop and asset_id=p_asset and enabled) then
      raise exception 'Link this service to its SOP before generating work.';
    end if;
    interpretation := queue_sop_interpretation(p_workspace,p_actor,p_sop,p_asset,'sop-source-images-v3',p_model,false,p_daily_limit);
    insert into sop_work_runs(id,workspace_id,relationship_id,session_id,service_key,instance_id,sop_id,asset_id,interpretation_id,requested_by,model,group_work_item_id)
      values(p_id,p_workspace,p_relationship,sess,instance.service_key,instance.id,p_sop,p_asset,interpretation,p_actor,p_model,grp);
    insert into sop_work_attempts(workspace_id,run_id) values(p_workspace,p_id);
    return p_id;
end $$;
create or replace function public.sop_work_evidence(p_workspace uuid,p_relationship uuid,p_session uuid,p_service text) returns jsonb
language plpgsql set search_path=public as $$
declare result jsonb;
begin
 -- Execution metadata stays server-side. The model receives only the SOP.
 select jsonb_build_object('mode','generic','service',jsonb_build_object('id',s.service_id,'revision_id',s.service_revision_id,'name',coalesce(v.name,s.service_key),'assignee',s.assignee_user_id))
 into result from sop_generation_instance(p_workspace,p_relationship,p_service::uuid) s left join onboarding_service_revisions v on v.id=s.service_revision_id and v.workspace_id=s.workspace_id
 where s.workspace_id=p_workspace and s.relationship_id=p_relationship and s.id=p_service::uuid;
 if result is null then raise exception 'Service information is unavailable.'; end if;
 return result;
end $$;
create or replace function public.read_service_sop_progress(p_workspace uuid,p_actor uuid,p_relationship uuid,p_instance uuid) returns jsonb
language plpgsql set search_path=public as $$
declare request sop_work_requests; job sop_work_runs; source_status text; progress integer; label text;
begin
 if not workspace_user_can_access_relationship(p_workspace_id => p_workspace,p_relationship_id => p_relationship,p_user_id => p_actor) then raise exception 'Relationship access required'; end if;
 if not exists(select 1 from relationship_service_instances where workspace_id=p_workspace and relationship_id=p_relationship and id=p_instance) and not exists(select 1 from sop_service_intents where workspace_id=p_workspace and relationship_id=p_relationship and instance_id=p_instance) then raise exception 'Service not found'; end if;
 select * into request from sop_work_requests where workspace_id=p_workspace and relationship_id=p_relationship and instance_id=p_instance;
 if not found then return jsonb_build_object('status','unavailable','progress',0,'label','Work was not queued','error','Link this service to a main SOP file, then add it to an active test relationship in Setup.'); end if;
 select * into job from sop_work_runs where workspace_id=p_workspace and id=request.run_id;
 if job.id is null then return jsonb_build_object('status',request.status,'progress',10,'label','Waiting to read the SOP','error',request.error_summary); end if;
 select status into source_status from sop_interpretations where workspace_id=p_workspace and id=job.interpretation_id;
 progress:=case when job.status='published' then 100 when job.plan is not null then 90 when job.raw_output is not null then 80 when source_status in ('ready','reviewed') then 50 when source_status='running' then 25 else 10 end;
 label:=case progress when 100 then 'Work added to the queue' when 90 then 'Adding work to the queue' when 80 then 'Checking the work flow' when 50 then 'Creating SOP-based work' when 25 then 'Reading the SOP' else 'Waiting to read the SOP' end;
 return jsonb_build_object('status',job.status,'progress',progress,'label',label,'error',job.error_summary);
end $$;

-- Match the bounded source size; no extra model calls or task proliferation.
do $$declare def text; begin
 select pg_get_functiondef('public.publish_sop_work_without_assets(uuid,uuid)'::regprocedure) into def;
 if position('jsonb_array_length(task->''source_steps'') not between 1 and 10' in def)=0 then raise exception 'Unexpected publication definition'; end if;
 def:=replace(def,'jsonb_array_length(task->''source_steps'') not between 1 and 10','jsonb_array_length(task->''source_steps'') not between 1 and 80');
 execute def;
end $$;
do $$declare def text; begin
 select pg_get_functiondef('public.publish_sop_work_with_assets(uuid,uuid)'::regprocedure) into def;
 execute replace(def,'r.schema_version=''sop-work-assets-v7''','r.schema_version in (''sop-work-assets-v7'',''sop-work-assets-v8'')');
end $$;
do $$declare def text; begin
 select pg_get_functiondef('public.read_relationship_work_queue(uuid,uuid,uuid,integer)'::regprocedure) into def;
 execute replace(def,'j.instance_id=q.instance_id','j.id=q.run_id');
 select pg_get_functiondef('public.publish_sop_work_without_assets(uuid,uuid)'::regprocedure) into def;
 -- Bound evidence size even when a single request references all 80 source steps.
 execute replace(def,$find$(source->>'source_quote')$find$,$replacement$left(source->>'source_quote',greatest(80,12000/jsonb_array_length(task->'source_steps')))$replacement$);
end $$;
do $$declare def text; begin
 select pg_get_functiondef('public.accept_sop_work_request(uuid,text,integer)'::regprocedure) into def;
 def:=replace(def,'select service_id from relationship_service_instances where id=request.instance_id','select service_id from sop_generation_instance(request.workspace_id,request.relationship_id,request.instance_id)');
 def:=replace(def,$old$error_summary='SOP work could not be queued. Check the linked main SOP file, service stage, access and daily limit. No flow was generated.'$old$,$new$error_summary=case when SQLSTATE='P0001' then left(regexp_replace(SQLERRM,'[[:space:]]+',' ','g'),150) else 'Work could not be queued (database '||SQLSTATE||'); no service change was published.' end$new$);
 execute def;
end $$;
do $$declare def text; begin
 select pg_get_functiondef('public.prepare_sop_work(uuid,uuid)'::regprocedure) into def;
 execute replace(def,'join relationship_service_instances i on i.workspace_id=b.workspace_id','join sop_generation_instance(job.workspace_id,job.relationship_id,job.instance_id) i on i.workspace_id=b.workspace_id');
end $$;
create function public.guard_sop_generation_identity() returns trigger language plpgsql security definer set search_path=public as $$
begin
 if new.instance_id is not null and not exists(select 1 from relationship_service_instances where id=new.instance_id and workspace_id=new.workspace_id and relationship_id=new.relationship_id)
 and not exists(select 1 from sop_service_intents where instance_id=new.instance_id and workspace_id=new.workspace_id and relationship_id=new.relationship_id) then raise exception 'Service generation identity is unavailable.'; end if;
 return new;
end $$;
create trigger guard_sop_run_identity before insert or update of instance_id,workspace_id,relationship_id on sop_work_runs for each row execute function guard_sop_generation_identity();
create trigger guard_sop_request_identity before insert or update of instance_id,workspace_id,relationship_id on sop_work_requests for each row execute function guard_sop_generation_identity();
-- Automatic onboarding completion observes the same publication boundary.
do $migration$declare def text; begin
 if to_regprocedure('public.refresh_service_onboarding_readiness(uuid,uuid)') is not null then
  select pg_get_functiondef('public.refresh_service_onboarding_readiness(uuid,uuid)'::regprocedure) into def;
  if position($old$ update public.relationship_service_instances i set stage='setup',version=version+1,change_request_id=gen_random_uuid(),change_reason='Required onboarding information reviewed',changed_by=sale.service_manager_user_id
 where i.workspace_id=p_workspace_id and i.stage='onboarding' and exists(select 1 from public.service_instance_sessions e where e.workspace_id=p_workspace_id and e.session_id=s.id and e.instance_id=i.id)
 and public.service_instance_onboarding_ready(p_workspace_id,i.id,s.id);$old$ in def)=0 then raise exception 'Unexpected onboarding readiness definition'; end if;
  def:=replace(def,'wid uuid;','wid uuid; pending_service relationship_service_instances;');
  execute replace(def,$old$ update public.relationship_service_instances i set stage='setup',version=version+1,change_request_id=gen_random_uuid(),change_reason='Required onboarding information reviewed',changed_by=sale.service_manager_user_id
 where i.workspace_id=p_workspace_id and i.stage='onboarding' and exists(select 1 from public.service_instance_sessions e where e.workspace_id=p_workspace_id and e.session_id=s.id and e.instance_id=i.id)
 and public.service_instance_onboarding_ready(p_workspace_id,i.id,s.id);$old$,$new$ for pending_service in select i.* from public.relationship_service_instances i where i.workspace_id=p_workspace_id and i.stage='onboarding' and exists(select 1 from public.service_instance_sessions e where e.workspace_id=p_workspace_id and e.session_id=s.id and e.instance_id=i.id)
 and public.service_instance_onboarding_ready(p_workspace_id,i.id,s.id) for update of i loop
  if pending_service.disposition='active' and pending_service.import_id is null
  and exists(select 1 from relationships where id=pending_service.relationship_id and workspace_id=p_workspace_id and source_metadata->>'is_test'='true' and status<>'archived')
  and exists(select 1 from sop_service_sources where workspace_id=p_workspace_id and service_id=pending_service.service_id and enabled) then
   if not exists(select 1 from sop_service_intents where instance_id=pending_service.id and published_at is null) then
    perform stage_sop_service_command(p_workspace_id,pending_service.relationship_id,sale.service_manager_user_id,gen_random_uuid(),jsonb_build_object('kind','change','instance_id',pending_service.id,'version',pending_service.version,'disposition','active','assignee',pending_service.assignee_user_id,'reason','Required onboarding information reviewed'));
   end if;
  else
   update relationship_service_instances set stage='setup',version=version+1,change_request_id=gen_random_uuid(),change_reason='Required onboarding information reviewed',changed_by=sale.service_manager_user_id where workspace_id=p_workspace_id and id=pending_service.id;
  end if;
 end loop;$new$);
 end if;
end $migration$;
-- Private worker functions stay inaccessible to browser roles.
do $$declare f record;begin for f in select oid::regprocedure signature from pg_proc where pronamespace='public'::regnamespace and proname in ('sop_generation_instance','stage_sop_service_command','publish_sop_work','publish_sop_work_with_assets','guard_sop_generation_identity') loop
 execute format('revoke all on function %s from public,anon,authenticated',f.signature);
 execute format('grant execute on function %s to service_role',f.signature);
end loop;end $$;
notify pgrst,'reload schema';
commit;
