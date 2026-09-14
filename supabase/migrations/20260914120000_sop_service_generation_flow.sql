-- Explicit SOP links and atomic generic work generation. No source is seeded here.
begin;
alter table public.sop_work_runs add column raw_output text check (octet_length(raw_output)<=800000);
alter table public.sop_work_runs alter column schema_version set default 'sop-work-generic-v3';
-- Retain costs and diagnostics when an explicitly removed test service is deleted.
alter table public.sop_work_runs alter column instance_id drop not null;
alter table public.sop_work_runs drop constraint sop_work_runs_instance_id_fkey;
alter table public.sop_work_runs add constraint sop_work_runs_instance_id_fkey foreign key(instance_id) references public.relationship_service_instances(id) on delete set null;
create index sop_service_sources_sop_idx on public.sop_service_sources(workspace_id,sop_id,service_id);


create or replace function public.queue_sop_work(p_workspace uuid,p_actor uuid,p_id uuid,p_sop uuid,p_asset uuid,p_relationship uuid,p_service text,p_model text,p_daily_limit integer default 10) returns uuid
language plpgsql set search_path=public as $$
declare existing sop_work_runs; sess uuid; interpretation uuid; grp uuid; instance relationship_service_instances;
begin
    perform assert_sop_admin(p_workspace,p_actor);
    perform 1 from workspaces where id=p_workspace for update;
    select * into instance from relationship_service_instances where workspace_id=p_workspace and relationship_id=p_relationship and id=p_service::uuid;
    if not found then raise exception 'Service instance not found.'; end if;
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
    interpretation := queue_sop_interpretation(p_workspace,p_actor,p_sop,p_asset,'sop-source-v1',p_model,false,p_daily_limit);
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
 into result from relationship_service_instances s left join onboarding_service_revisions v on v.id=s.service_revision_id and v.workspace_id=s.workspace_id
 where s.workspace_id=p_workspace and s.relationship_id=p_relationship and s.id=p_service::uuid;
 if result is null then raise exception 'Service information is unavailable.'; end if;
 return result;
end $$;

create or replace function public.prepare_sop_work(p_id uuid,p_lease uuid) returns jsonb
language plpgsql set search_path=public as $$
declare job sop_work_runs; packet jsonb;
begin
    select * into job from sop_work_runs where id=p_id and status='running' and lease_token=p_lease and lease_until>now() for update;
    if not found then raise exception 'Run lease expired.'; end if;
    perform assert_sop_work_scope(job.workspace_id,job.requested_by,job.relationship_id,job.session_id,job.instance_id::text);
    perform 1 from sops where workspace_id=job.workspace_id and id=job.sop_id and archived_at is null for share;
    if not found or not exists(select 1 from sop_assets where workspace_id=job.workspace_id and sop_id=job.sop_id and asset_id=job.asset_id) then raise exception 'The SOP source is no longer available.'; end if;
    if not exists(select 1 from sop_service_sources b join relationship_service_instances i on i.workspace_id=b.workspace_id and i.service_id=b.service_id
      where b.workspace_id=job.workspace_id and i.id=job.instance_id and b.sop_id=job.sop_id and b.asset_id=job.asset_id and b.enabled) then
      raise exception 'The service SOP link changed. No work was published.';
    end if;
    packet := sop_work_evidence(job.workspace_id,job.relationship_id,job.session_id,job.instance_id::text);
    if job.evidence_hash is not null and job.evidence_hash<>md5(packet::text) then raise exception 'Service information changed after generation began. No work was published.'; end if;
    update sop_work_runs set evidence=packet,evidence_hash=md5(packet::text) where id=p_id;
    return packet;
end $$;

create or replace function public.publish_sop_work(p_id uuid,p_lease uuid) returns uuid[]
language plpgsql set search_path=public as $$
declare job sop_work_runs; task jsonb; step_ref jsonb; dependency jsonb; ids uuid[]='{}'; item uuid; idx integer=0; owner_id uuid; description text; source jsonb; service_name text;
begin
    select * into job from sop_work_runs where id=p_id for update;
    if not found then raise exception 'Run not found.'; end if;
    if job.status='published' then return job.work_item_ids; end if;
    if job.status<>'running' or job.lease_token is distinct from p_lease or job.lease_until<=now() then raise exception 'Run lease expired.'; end if;
    perform prepare_sop_work(p_id,p_lease);
    -- Pin service execution metadata during atomic publication.
    perform 1 from relationship_service_instances where workspace_id=job.workspace_id and id=job.instance_id for share;
    perform 1 from relationship_onboarding_sessions where id=job.session_id for share;
    perform prepare_sop_work(p_id,p_lease);
    if job.plan is null or jsonb_typeof(job.plan->'tasks') is distinct from 'array' or jsonb_array_length(job.plan->'tasks') not between 1 and 40 or octet_length(job.plan::text)>120000 or job.source_snapshot is null then raise exception 'Invalid work plan.'; end if;
    owner_id := (job.evidence->'service'->>'assignee')::uuid;
    service_name := job.evidence->'service'->>'name';
    if owner_id is not null and not exists(select 1 from workspace_memberships where workspace_id=job.workspace_id and user_id=owner_id) then raise exception 'The work assignee is no longer available.'; end if;
    -- No placeholder or partial flow exists before this transaction succeeds.
    if job.group_work_item_id is null then
      insert into work_items(workspace_id,service_id,title,description,lifecycle_phase,status,workflow_role,completion_mode,native_kind,native_key,metadata,created_by)
      values(job.workspace_id,(job.evidence->'service'->>'id')::uuid,left(service_name,200),job.plan->>'summary','fulfilment','todo','service_group','manual','relationship_workflow','service:'||job.instance_id||':setup:sop',
        jsonb_build_object('relationship_id',job.relationship_id,'sop_work_run_id',job.id,'service_instance_id',job.instance_id),job.requested_by) returning id into job.group_work_item_id;
      update sop_work_runs set group_work_item_id=job.group_work_item_id where id=job.id;
      insert into work_item_relationships(workspace_id,relationship_id,work_item_id) values(job.workspace_id,job.relationship_id,job.group_work_item_id);
      insert into service_instance_work_items(workspace_id,instance_id,work_item_id) values(job.workspace_id,job.instance_id,job.group_work_item_id);
      if owner_id is not null then insert into work_item_assignees(workspace_id,work_item_id,user_id,assigned_by) values(job.workspace_id,job.group_work_item_id,owner_id,job.requested_by); end if;
    end if;
    for task in select value from jsonb_array_elements(job.plan->'tasks') loop
        idx:=idx+1;
        if length(trim(task->>'title')) not between 1 and 200 or length(trim(task->>'instruction')) not between 1 and 6000 or jsonb_typeof(task->'depends_on') is distinct from 'array' or jsonb_typeof(task->'source_steps') is distinct from 'array' or jsonb_array_length(task->'source_steps') not between 1 and 10 or jsonb_array_length(task->'depends_on')>39 then raise exception 'Invalid generated task.'; end if;
        description := task->>'instruction';
        if coalesce(task->>'blocked_reason','')<>'' then description:=description||E'\n\nMissing information: '||(task->>'blocked_reason'); end if;
        description:=description||E'\n\nSOP source: '||job.sop_id::text||' / asset '||job.asset_id::text;
        for step_ref in select value from jsonb_array_elements(task->'source_steps') loop
            if step_ref::text !~ '^[0-9]+$' or step_ref::text::integer not between 1 and jsonb_array_length(job.source_snapshot->'steps') then raise exception 'Invalid source reference.'; end if;
            source:=job.source_snapshot->'steps'->(step_ref::text::integer-1);
            description:=description||E'\n\n'||(source->>'source_location')||': '||(source->>'source_quote');
        end loop;
        insert into work_items(workspace_id,service_id,title,description,lifecycle_phase,status,workflow_role,parent_work_item_id,native_kind,native_key,sort_order,metadata,created_by)
          values(job.workspace_id,(job.evidence->'service'->>'id')::uuid,trim(task->>'title'),description,'fulfilment',case when coalesce(task->>'blocked_reason','')='' then 'todo' else 'blocked' end,'task',job.group_work_item_id,'relationship_workflow','service:'||job.instance_id||':setup:sop:'||idx,idx*10,
            jsonb_build_object('relationship_id',job.relationship_id,'service_instance_id',job.instance_id,'sop_work_run_id',job.id,'sop_id',job.sop_id,'sop_asset_id',job.asset_id,'source_steps',task->'source_steps','generator_version',job.schema_version),job.requested_by) returning id into item;
        ids:=array_append(ids,item);
        insert into work_item_relationships(workspace_id,relationship_id,work_item_id) values(job.workspace_id,job.relationship_id,item);
        insert into service_instance_work_items(workspace_id,instance_id,work_item_id) values(job.workspace_id,job.instance_id,item);
        insert into asset_work_items(workspace_id,asset_id,work_item_id) values(job.workspace_id,job.asset_id,item);
        if owner_id is not null then insert into work_item_assignees(workspace_id,work_item_id,user_id,assigned_by) values(job.workspace_id,item,owner_id,job.requested_by); end if;
        for dependency in select value from jsonb_array_elements(task->'depends_on') loop
            if dependency::text !~ '^[0-9]+$' or dependency::text::integer not between 1 and idx-1 then raise exception 'Invalid task dependency.'; end if;
            insert into work_item_dependencies(workspace_id,work_item_id,depends_on_work_item_id,created_by) values(job.workspace_id,item,ids[dependency::text::integer],job.requested_by);
        end loop;
    end loop;
    update work_items set title=left(service_name,200),description=(job.plan->>'summary')||E'\n\nAI pilot. Check the original SOP for source limitations.',status='todo',completion_mode='all_required_children' where id=job.group_work_item_id;
    -- Independent service stages are authoritative; never move unrelated services.
    update sop_work_runs set status='published',work_item_ids=ids,lease_token=null,lease_until=null,error_summary=null,updated_at=now() where id=p_id;
    return ids;
end $$;

create or replace function public.claim_sop_work(p_id uuid default null) returns setof public.sop_work_runs
language plpgsql set search_path=public as $$
begin
    update sop_work_runs set status='failed',error_summary='Work generation was interrupted. No flow was published.',lease_token=null,lease_until=null,updated_at=now()
      where id in(select id from sop_work_runs where status='running' and lease_until<now() order by lease_until limit 20 for update skip locked);
    return query with candidate as (
      select id from sop_work_runs where status='queued' and (p_id is null or id=p_id) order by created_at,id limit 1 for update skip locked
    ) update sop_work_runs j set status='running',lease_token=gen_random_uuid(),lease_until=now()+interval '6 minutes',updated_at=now() from candidate c where j.id=c.id returning j.*;
end $$;

create or replace function public.accept_sop_work_request(p_instance uuid,p_model text,p_daily_limit integer default 10) returns uuid
language plpgsql set search_path=public as $$
declare request sop_work_requests; run uuid;
begin
 select * into request from sop_work_requests where status='pending' and (p_instance is null or instance_id=p_instance)
 order by created_at,instance_id limit 1 for update skip locked;
 if not found then return null; end if;
 begin
  if not exists(select 1 from sop_service_sources b where b.workspace_id=request.workspace_id and b.sop_id=request.sop_id and b.asset_id=request.asset_id and b.enabled
    and b.service_id=(select service_id from relationship_service_instances where id=request.instance_id)) then raise exception 'The automatic SOP source was disabled or changed.'; end if;
  run:=queue_sop_work(request.workspace_id,request.requested_by,gen_random_uuid(),request.sop_id,request.asset_id,request.relationship_id,request.instance_id::text,p_model,p_daily_limit);
  update sop_work_requests set status='accepted',run_id=run where instance_id=request.instance_id;
 exception when others then
  -- No paid dispatch has happened. Preserve durable failure for the relationship.
  update sop_work_requests set status='failed',error_summary='SOP work could not be queued. Check the linked main SOP file, service stage, access and daily limit. No flow was generated.' where instance_id=request.instance_id;
 end;
 return run;
end $$;

-- Keep the existing sale/session/module link guards intact.
create function public.guard_sop_service_work_link() returns trigger
language plpgsql security definer set search_path=public as $$
begin
 if exists(select 1 from sop_work_runs j join work_items w on w.id=new.work_item_id and w.workspace_id=j.workspace_id
   where j.workspace_id=new.workspace_id and j.instance_id=new.instance_id and w.lifecycle_phase='fulfilment'
   and w.metadata->>'sop_work_run_id' is distinct from j.id::text) then
   raise exception 'This service setup is owned by SOP generation.';
 end if;
 return new;
end $$;
create trigger guard_sop_service_work_link before insert on public.service_instance_work_items for each row execute function public.guard_sop_service_work_link();
revoke all on function public.guard_sop_service_work_link() from public,anon,authenticated;

-- Configuration is explicit and cannot silently replace another SOP's binding.
create function public.link_sop_service(p_workspace uuid,p_actor uuid,p_sop uuid,p_service uuid,p_asset uuid,p_unlink boolean default false) returns void
language plpgsql set search_path=public as $$
declare existing sop_service_sources;
begin
 perform assert_sop_admin(p_workspace,p_actor);
 perform 1 from onboarding_services where workspace_id=p_workspace and id=p_service for update;
 if not found then raise exception 'Service not found.'; end if;
 select * into existing from sop_service_sources where workspace_id=p_workspace and service_id=p_service for update;
 if found and existing.sop_id<>p_sop and existing.enabled then raise exception 'This service is linked to another SOP. Unlink it there first.'; end if;
 if p_unlink then
   delete from sop_service_sources where workspace_id=p_workspace and service_id=p_service and sop_id=p_sop and asset_id=p_asset;
   return;
 end if;
 perform set_sop_service_source(p_workspace,p_actor,p_service,p_sop,p_asset,true);
end $$;

create function public.read_service_sop_progress(p_workspace uuid,p_actor uuid,p_relationship uuid,p_instance uuid) returns jsonb
language plpgsql set search_path=public as $$
declare request sop_work_requests; job sop_work_runs; source_status text; progress integer; label text;
begin
 if not workspace_user_can_access_relationship(p_workspace,p_actor,p_relationship) then raise exception 'Relationship access required'; end if;
 if not exists(select 1 from relationship_service_instances where workspace_id=p_workspace and relationship_id=p_relationship and id=p_instance) then raise exception 'Service not found'; end if;
 select * into request from sop_work_requests where workspace_id=p_workspace and relationship_id=p_relationship and instance_id=p_instance;
 if not found then return jsonb_build_object('status','unavailable','progress',0,'label','Work was not queued','error','Link this service to a main SOP file, then add it to an active test relationship in Setup.'); end if;
 select * into job from sop_work_runs where workspace_id=p_workspace and id=request.run_id;
 if job.id is null then return jsonb_build_object('status',request.status,'progress',10,'label','Waiting to read the SOP','error',request.error_summary); end if;
 select status into source_status from sop_interpretations where workspace_id=p_workspace and id=job.interpretation_id;
 progress:=case when job.status='published' then 100 when job.plan is not null then 90 when job.raw_output is not null then 80 when source_status in ('ready','reviewed') then 50 when source_status='running' then 25 else 10 end;
 label:=case progress when 100 then 'Work added to the queue' when 90 then 'Adding work to the queue' when 80 then 'Checking the work flow' when 50 then 'Creating SOP-based work' when 25 then 'Reading the SOP' else 'Waiting to read the SOP' end;
 return jsonb_build_object('status',job.status,'progress',progress,'label',label,'error',job.error_summary);
end $$;
revoke all on function public.link_sop_service(uuid,uuid,uuid,uuid,uuid,boolean),public.read_service_sop_progress(uuid,uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.link_sop_service(uuid,uuid,uuid,uuid,uuid,boolean),public.read_service_sop_progress(uuid,uuid,uuid,uuid) to service_role;
create function public.read_sop_service_links(p_workspace uuid,p_actor uuid,p_sop uuid,p_offset integer default 0) returns jsonb
language plpgsql set search_path=public as $$
declare result jsonb;
begin
 perform assert_sop_admin(p_workspace,p_actor);
 if p_offset not between 0 and 10000 then raise exception 'Invalid page'; end if;
 select coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb) into result from (
   select b.service_id,b.asset_id,coalesce(v.name,'Service') service_name,a.title asset_name
   from sop_service_sources b join assets a on a.workspace_id=b.workspace_id and a.id=b.asset_id
   left join lateral(select name from onboarding_service_revisions where workspace_id=b.workspace_id and service_id=b.service_id order by revision_number desc limit 1) v on true
   where b.workspace_id=p_workspace and b.sop_id=p_sop and b.enabled order by b.service_id limit 31 offset p_offset
 ) x;
 return result;
end $$;
revoke all on function public.read_sop_service_links(uuid,uuid,uuid,integer) from public,anon,authenticated;
grant execute on function public.read_sop_service_links(uuid,uuid,uuid,integer) to service_role;
-- Return durable generation acceptance in the existing save round trip.
create function public.service_sop_save_result(p_workspace uuid,p_relationship uuid,p_instance uuid,p_enabled boolean) returns jsonb
language plpgsql set search_path=public as $$
declare eligible boolean;
begin
 select i.stage='setup' and i.disposition='active' and i.import_id is null and r.source_metadata->>'is_test'='true' and r.status<>'archived' into eligible
 from relationship_service_instances i join relationships r on r.workspace_id=i.workspace_id and r.id=i.relationship_id
 where i.workspace_id=p_workspace and i.relationship_id=p_relationship and i.id=p_instance;
 if eligible then
  if not p_enabled then raise exception 'Work generation is currently unavailable. No service was changed.'; end if;
  if not exists(select 1 from sop_work_requests where workspace_id=p_workspace and instance_id=p_instance) then
    raise exception 'Link this service to its main procedure on the SOP page first. No flow was generated.';
  end if;
 end if;
 return jsonb_build_object('id',p_instance,'generation',coalesce(eligible,false));
end $$;
create function public.add_relationship_service_with_sop(p_workspace_id uuid,p_relationship_id uuid,p_actor_user_id uuid,p_request_id uuid,p_service_id uuid,p_revision_id uuid,p_origin text,p_stage text,p_assignee_user_id uuid,p_generation_enabled boolean) returns jsonb
language plpgsql set search_path=public as $$
declare instance uuid;
begin
 instance:=add_relationship_service(p_workspace_id,p_relationship_id,p_actor_user_id,p_request_id,p_service_id,p_revision_id,p_origin,p_stage,p_assignee_user_id);
 return service_sop_save_result(p_workspace_id,p_relationship_id,instance,p_generation_enabled);
end $$;
create function public.change_relationship_service_with_sop(p_workspace_id uuid,p_relationship_id uuid,p_instance_id uuid,p_actor_user_id uuid,p_request_id uuid,p_expected_version integer,p_stage text,p_disposition text,p_assignee_user_id uuid,p_reason text,p_generation_enabled boolean) returns jsonb
language plpgsql set search_path=public as $$
begin
 if not exists(select 1 from relationship_service_instances where workspace_id=p_workspace_id and relationship_id=p_relationship_id and id=p_instance_id) then raise exception 'Service not found'; end if;
 perform change_service_instance(p_workspace_id,p_instance_id,p_actor_user_id,p_request_id,p_expected_version,p_stage,p_disposition,p_assignee_user_id,p_reason);
 return service_sop_save_result(p_workspace_id,p_relationship_id,p_instance_id,p_generation_enabled);
end $$;
revoke all on function public.service_sop_save_result(uuid,uuid,uuid,boolean),public.add_relationship_service_with_sop(uuid,uuid,uuid,uuid,uuid,uuid,text,text,uuid,boolean),public.change_relationship_service_with_sop(uuid,uuid,uuid,uuid,uuid,integer,text,text,uuid,text,boolean) from public,anon,authenticated;
grant execute on function public.add_relationship_service_with_sop(uuid,uuid,uuid,uuid,uuid,uuid,text,text,uuid,boolean),public.change_relationship_service_with_sop(uuid,uuid,uuid,uuid,uuid,integer,text,text,uuid,text,boolean),public.service_sop_save_result(uuid,uuid,uuid,boolean) to service_role;

notify pgrst,'reload schema';
commit;
