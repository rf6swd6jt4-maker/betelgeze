-- Goal, procedure and immutable source evidence have separate storage.
-- Additive schema; existing paid v3-v5 plans retain their publication path.
begin;
alter table public.work_items add column if not exists instructions text;
alter table public.work_items add column if not exists evidence text;
comment on column public.work_items.instructions is 'Editable procedure and completion requirements; selected detail only.';
comment on column public.work_items.evidence is 'Immutable source provenance; selected detail only; never a client-editable field.';
alter table public.sop_work_runs alter column schema_version set default 'sop-work-generic-v6';

-- Split only positively identified SOP-generated bodies. Preserve any edits
-- before the exact source marker; no model call and no unrelated work rewrite.
with existing as (
 select w.id, w.description, E'\n\nSOP source: '||(w.metadata->>'sop_id')||' / asset '||(w.metadata->>'sop_asset_id') marker
 from public.work_items w
 where w.native_kind='relationship_workflow' and w.metadata ? 'sop_work_run_id'
   and w.metadata ? 'sop_id' and w.metadata ? 'sop_asset_id' and w.instructions is null
), split as (
 select *, strpos(description,marker) pos from existing
)
update public.work_items w set description=w.title,
 instructions=left(s.description,s.pos-1),
 evidence=regexp_replace(substr(s.description,s.pos+2),'[[:space:]]+',' ','g')
from split s where w.id=s.id and s.pos>0;

create function public.guard_work_item_evidence() returns trigger language plpgsql set search_path=public as $$
begin
 if new.evidence is distinct from old.evidence then raise exception 'Work item evidence is read-only.'; end if;
 return new;
end $$;
create trigger guard_work_item_evidence before update of evidence on public.work_items
for each row execute function public.guard_work_item_evidence();
revoke all on function public.guard_work_item_evidence() from public,anon,authenticated;

-- Baseline text travels in the POST body, never an oversized URL filter.
create or replace function public.save_work_item_text(p_workspace uuid,p_item uuid,p_field text,p_value text,p_baseline text) returns timestamptz
language plpgsql set search_path=public as $$
declare version timestamptz;
begin
 if p_field not in ('description','instructions') or p_field is null or p_value is null or p_baseline is null or length(p_value)>100000 then raise exception 'Invalid work item text.'; end if;
 if p_field='description' then
  update work_items set description=nullif(trim(p_value),''),updated_at=clock_timestamp()
   where workspace_id=p_workspace and id=p_item and coalesce(description,'')=p_baseline returning updated_at into version;
 else
  update work_items set instructions=nullif(trim(p_value),''),updated_at=clock_timestamp()
   where workspace_id=p_workspace and id=p_item and coalesce(instructions,'')=p_baseline returning updated_at into version;
 end if;
 return version;
end $$;
revoke all on function public.save_work_item_text(uuid,uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.save_work_item_text(uuid,uuid,text,text,text) to service_role;

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
    interpretation := queue_sop_interpretation(p_workspace,p_actor,p_sop,p_asset,'sop-source-v2',p_model,false,p_daily_limit);
    insert into sop_work_runs(id,workspace_id,relationship_id,session_id,service_key,instance_id,sop_id,asset_id,interpretation_id,requested_by,model,group_work_item_id)
      values(p_id,p_workspace,p_relationship,sess,instance.service_key,instance.id,p_sop,p_asset,interpretation,p_actor,p_model,grp);
    insert into sop_work_attempts(workspace_id,run_id) values(p_workspace,p_id);
    return p_id;
end $$;


create or replace function public.retry_sop_work(p_workspace uuid,p_actor uuid,p_id uuid,p_daily_limit integer default 10) returns uuid
language plpgsql set search_path=public as $$
declare job sop_work_runs;
begin
    perform assert_sop_admin(p_workspace,p_actor);
    perform 1 from workspaces where id=p_workspace for update;
    select * into job from sop_work_runs where workspace_id=p_workspace and id=p_id for update;
    if not found then raise exception 'Run not found.'; end if;
    if job.status<>'failed' then return p_id; end if;
    perform assert_sop_work_scope(p_workspace,p_actor,job.relationship_id,job.session_id,job.instance_id::text);
    if job.attempts>=3 or p_daily_limit not between 1 and 100 or (select count(*) from sop_work_attempts where workspace_id=p_workspace and created_at>=date_trunc('day',now() at time zone 'UTC') at time zone 'UTC')>=p_daily_limit then raise exception 'The work-generation attempt limit has been reached.'; end if;
    if job.plan is null then perform queue_sop_interpretation(p_workspace,p_actor,job.sop_id,job.asset_id,(select schema_version from sop_interpretations where id=job.interpretation_id),job.model,true,p_daily_limit); end if;
    update sop_work_runs set status='queued',requested_by=p_actor,attempts=attempts+1,lease_token=null,lease_until=null,error_summary=null,updated_at=now() where id=p_id;
    insert into sop_work_attempts(workspace_id,run_id) values(p_workspace,p_id);
    return p_id;
end $$;
create or replace function public.publish_sop_work(p_id uuid,p_lease uuid) returns uuid[]
language plpgsql set search_path=public as $$
declare job sop_work_runs; task jsonb; step_ref jsonb; dependency jsonb; ids uuid[]='{}'; item uuid; idx integer=0; owner_id uuid; description text; instructions text; evidence text; source jsonb; completion jsonb; service_name text;
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
        if length(trim(task->>'title')) not between 1 and 200 or coalesce(length(trim(coalesce(task->>'instructions',task->>'instruction'))),0) not between 1 and 6000 or jsonb_typeof(task->'depends_on') is distinct from 'array' or jsonb_typeof(task->'source_steps') is distinct from 'array' or jsonb_array_length(task->'source_steps') not between 1 and 10 or jsonb_array_length(task->'depends_on')>39 then raise exception 'Invalid generated task.'; end if;
        if task ? 'instructions' then
          if coalesce(length(trim(task->>'description')),0) not between 1 and 600 or jsonb_typeof(task->'completion_requirements') is distinct from 'array' then raise exception 'Invalid task content.'; end if;
          if jsonb_array_length(task->'completion_requirements') not between 1 and 10 then raise exception 'Missing completion requirements.'; end if;
          description := trim(task->>'description');
          instructions := trim(task->>'instructions')||E'\n\nComplete when:';
          for completion in select value from jsonb_array_elements(task->'completion_requirements') loop
            if jsonb_typeof(completion)<>'string' or length(trim(completion#>>'{}')) not between 1 and 600 then raise exception 'Invalid completion requirement.'; end if;
            instructions := instructions||E'\n- '||(completion#>>'{}');
          end loop;
        else
          -- Already-paid older plans remain publishable after deployment.
          if job.schema_version='sop-work-generic-v6' then raise exception 'Missing detailed work content.'; end if;
          description := trim(task->>'title');
          instructions := task->>'instruction';
          if coalesce(task->>'blocked_reason','')<>'' then instructions:=instructions||E'\n\nMissing information: '||(task->>'blocked_reason'); end if;
        end if;
        evidence := 'SOP source: '||job.sop_id::text||' / asset '||job.asset_id::text;
        for step_ref in select value from jsonb_array_elements(task->'source_steps') loop
            if step_ref::text !~ '^[0-9]+$' or step_ref::text::integer not between 1 and jsonb_array_length(job.source_snapshot->'steps') then raise exception 'Invalid source reference.'; end if;
            source:=job.source_snapshot->'steps'->(step_ref::text::integer-1);
            evidence:=evidence||' '||(source->>'source_location')||': '||(source->>'source_quote');
        end loop;
        insert into work_items(workspace_id,service_id,title,description,instructions,evidence,lifecycle_phase,status,workflow_role,parent_work_item_id,native_kind,native_key,sort_order,metadata,created_by)
          values(job.workspace_id,(job.evidence->'service'->>'id')::uuid,trim(task->>'title'),description,instructions,regexp_replace(evidence,'[[:space:]]+',' ','g'),'fulfilment',case when coalesce(task->>'blocked_reason','')='' then 'todo' else 'blocked' end,'task',job.group_work_item_id,'relationship_workflow','service:'||job.instance_id||':setup:sop:'||idx,idx*10,
            jsonb_build_object('relationship_id',job.relationship_id,'service_instance_id',job.instance_id,'sop_work_run_id',job.id,'sop_id',job.sop_id,'sop_asset_id',job.asset_id,'source_steps',task->'source_steps','generator_version',job.schema_version,'task_type',task->>'task_type','requested_inputs',task->'requested_inputs'),job.requested_by) returning id into item;
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
notify pgrst, 'reload schema';
commit;
