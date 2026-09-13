-- Test rollout: service-instance Setup -> durable SOP work -> Library and relationship queue.
begin;
create table public.sop_work_runs (
    id uuid primary key,
    workspace_id uuid not null references public.workspaces(id),
    relationship_id uuid not null references public.relationships(id),
    session_id uuid references public.relationship_onboarding_sessions(id),
    service_key text not null,
    instance_id uuid not null references public.relationship_service_instances(id),
    sop_id uuid not null references public.sops(id),
    asset_id uuid not null references public.sop_assets(asset_id),
    interpretation_id uuid not null references public.sop_interpretations(id),
    requested_by uuid not null references auth.users(id),
    model text not null,
    schema_version text not null default 'sop-work-setup-v2',
    status text not null default 'queued' check(status in ('queued','running','published','failed')),
    attempts integer not null default 1,
    lease_token uuid,
    lease_until timestamptz,
    evidence jsonb,
    evidence_hash text,
    source_snapshot jsonb,
    plan jsonb,
    stage_work_item_id uuid references public.work_items(id) on delete restrict,
    group_work_item_id uuid references public.work_items(id) on delete restrict,
    work_item_ids uuid[] not null default '{}',
    error_summary text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique(workspace_id,instance_id)
);
create index sop_work_runs_pending_idx on public.sop_work_runs(created_at,id) where status='queued';
create index sop_work_runs_expired_idx on public.sop_work_runs(lease_until,id) where status='running';
create index sop_work_runs_sop_idx on public.sop_work_runs(workspace_id,sop_id,created_at desc,id desc);
create table public.sop_work_attempts (
    id bigint generated always as identity primary key,
    workspace_id uuid not null references public.workspaces(id),
    run_id uuid not null references public.sop_work_runs(id),
    created_at timestamptz not null default now()
);
create index sop_work_attempts_budget_idx on public.sop_work_attempts(workspace_id,created_at);
create table public.sop_ai_usage (
    id uuid primary key,
    workspace_id uuid not null references public.workspaces(id),
    interpretation_id uuid references public.sop_interpretations(id),
    run_id uuid references public.sop_work_runs(id),
    stage text not null check(stage in ('interpretation','generation')),
    model text not null,
    status text not null default 'dispatched' check(status in ('dispatched','received','unknown')),
    response_id text,
    usage jsonb,
    rate jsonb,
    estimated_usd numeric(18,10) check(estimated_usd>=0),
    created_at timestamptz not null default now(),
    check((stage='interpretation' and interpretation_id is not null) or (stage='generation' and run_id is not null))
);
create index sop_ai_usage_run_idx on public.sop_ai_usage(workspace_id,run_id,created_at);
create index sop_ai_usage_source_idx on public.sop_ai_usage(workspace_id,interpretation_id,created_at) where stage='interpretation';
create index sop_work_submission_idx on public.assets(workspace_id,(metadata->>'session_id'),id) where native_kind='onboarding_form_submission';
create index sop_work_test_relationships_idx on public.relationships(workspace_id,created_at desc,id desc) where source_metadata->>'is_test'='true';

alter table public.sop_work_runs enable row level security;
alter table public.sop_work_attempts enable row level security;
alter table public.sop_ai_usage enable row level security;
revoke all on public.sop_work_runs,public.sop_work_attempts,public.sop_ai_usage from public,anon,authenticated;
grant all on public.sop_work_runs,public.sop_work_attempts,public.sop_ai_usage to service_role;
grant usage,select on sequence public.sop_work_attempts_id_seq to service_role;

create function public.assert_sop_work_scope(p_workspace uuid,p_actor uuid,p_relationship uuid,p_session uuid,p_service text) returns void
language plpgsql set search_path=public as $$
declare r relationships; i relationship_service_instances;
begin
    perform assert_sop_admin(p_workspace,p_actor);
    select * into r from relationships where workspace_id=p_workspace and id=p_relationship for update;
    if not found or r.source_metadata->>'is_test' is distinct from 'true' or r.status='archived' then
        raise exception 'Use an active test relationship.';
    end if;
    select * into i from relationship_service_instances where workspace_id=p_workspace and relationship_id=p_relationship and id=p_service::uuid for share;
    if not found or i.stage<>'setup' or i.disposition<>'active' or i.import_id is not null then raise exception 'Choose an active service in Setup.'; end if;
    if p_session is not null and not exists(select 1 from service_instance_sessions e join relationship_onboarding_sessions s on s.id=e.session_id and s.workspace_id=e.workspace_id
      where e.workspace_id=p_workspace and e.instance_id=i.id and s.id=p_session and s.archived_at is null and s.status='completed') then raise exception 'The service onboarding session is unavailable.'; end if;
    if i.assignee_user_id is not null and not exists(select 1 from workspace_memberships m join workspace_member_service_access a using(workspace_id,user_id)
      where m.workspace_id=p_workspace and m.user_id=i.assignee_user_id and a.service_id=i.service_id) then raise exception 'The service assignee no longer has access.'; end if;
end $$;

-- Only confirmed form answers and a narrow business/service profile. No session
-- tokens, provider connections, unrelated relationships or communications.
create function public.sop_work_evidence(p_workspace uuid,p_relationship uuid,p_session uuid,p_service text) returns jsonb
language plpgsql set search_path=public as $$
declare result jsonb; submissions jsonb; n integer; bytes bigint;
begin
    select count(*),coalesce(sum(octet_length(x.response::text)),0) into n,bytes from (
        select metadata->'response' response from assets where workspace_id=p_workspace and native_kind='onboarding_form_submission' and metadata->>'session_id'=p_session::text order by id limit 51
    ) x;
    if n>50 or bytes>120000 then raise exception 'Onboarding information exceeds this pilot limit.'; end if;
    select coalesce(jsonb_agg(jsonb_build_object('id',id,'title',title,'answers',metadata->'response') order by id),'[]'::jsonb) into submissions
      from assets where workspace_id=p_workspace and native_kind='onboarding_form_submission' and metadata->>'session_id'=p_session::text;
    select jsonb_build_object('client',jsonb_build_object('business_name',r.business_name,'website_url',r.website_url,'industry',r.industry_value,'location',r.location_value,'notes',r.notes_summary),
      'service',jsonb_build_object('key',s.service_key,'id',s.service_id,'revision_id',s.service_revision_id,'name',coalesce(v.name,s.service_key),'assignee',s.assignee_user_id),
      'manager',s.manager_user_id,'session_id',p_session,'onboarding',submissions)
      into result from relationships r join relationship_service_instances s on s.relationship_id=r.id and s.workspace_id=r.workspace_id
      left join onboarding_service_revisions v on v.id=s.service_revision_id and v.workspace_id=s.workspace_id
      where r.workspace_id=p_workspace and r.id=p_relationship and s.id=p_service::uuid;
    if result is null or octet_length(result::text)>150000 then raise exception 'Client evidence is unavailable or too large.'; end if;
    return result;
end $$;

create function public.queue_sop_work(p_workspace uuid,p_actor uuid,p_id uuid,p_sop uuid,p_asset uuid,p_relationship uuid,p_service text,p_model text,p_daily_limit integer default 10) returns uuid
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
    interpretation := queue_sop_interpretation(p_workspace,p_actor,p_sop,p_asset,'sop-source-v1',p_model,false,p_daily_limit);
    insert into work_items(workspace_id,service_id,title,description,lifecycle_phase,status,workflow_role,completion_mode,native_kind,native_key,metadata,created_by)
    values(p_workspace,instance.service_id,'Generate SOP work','SOP work generation is queued. Open the SOP work report to check progress.','fulfilment','blocked','service_group','manual','relationship_workflow','service:'||instance.id||':setup:sop',jsonb_build_object('relationship_id',p_relationship,'sop_work_run_id',p_id,'service_instance_id',instance.id),p_actor) returning id into grp;
    insert into work_item_relationships(workspace_id,relationship_id,work_item_id) values(p_workspace,p_relationship,grp);
    insert into service_instance_work_items(workspace_id,instance_id,work_item_id) values(p_workspace,instance.id,grp);
    if instance.assignee_user_id is not null then
      insert into work_item_assignees(workspace_id,work_item_id,user_id,assigned_by) values(p_workspace,grp,instance.assignee_user_id,p_actor);
    end if;
    insert into sop_work_runs(id,workspace_id,relationship_id,session_id,service_key,instance_id,sop_id,asset_id,interpretation_id,requested_by,model,group_work_item_id)
      values(p_id,p_workspace,p_relationship,sess,instance.service_key,instance.id,p_sop,p_asset,interpretation,p_actor,p_model,grp);
    insert into sop_work_attempts(workspace_id,run_id) values(p_workspace,p_id);
    return p_id;
end $$;

create function public.retry_sop_work(p_workspace uuid,p_actor uuid,p_id uuid,p_daily_limit integer default 10) returns uuid
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
    if job.plan is null then perform queue_sop_interpretation(p_workspace,p_actor,job.sop_id,job.asset_id,'sop-source-v1',job.model,true,p_daily_limit); end if;
    update sop_work_runs set status='queued',requested_by=p_actor,attempts=attempts+1,lease_token=null,lease_until=null,error_summary=null,updated_at=now() where id=p_id;
    insert into sop_work_attempts(workspace_id,run_id) values(p_workspace,p_id);
    return p_id;
end $$;

create function public.claim_sop_work(p_id uuid default null) returns setof public.sop_work_runs
language plpgsql set search_path=public as $$
begin
    update sop_work_runs set status='failed',error_summary='Generation was interrupted. Check the cost report before explicitly retrying.',lease_token=null,lease_until=null,updated_at=now()
      where id in(select id from sop_work_runs where status='running' and lease_until<now() order by lease_until limit 20 for update skip locked);
    return query with candidate as (
      select id from sop_work_runs where status='queued' and (p_id is null or id=p_id) order by created_at,id limit 1 for update skip locked
    ) update sop_work_runs j set status='running',lease_token=gen_random_uuid(),lease_until=now()+interval '6 minutes',updated_at=now() from candidate c where j.id=c.id returning j.*;
end $$;

create function public.prepare_sop_work(p_id uuid,p_lease uuid) returns jsonb
language plpgsql set search_path=public as $$
declare job sop_work_runs; packet jsonb;
begin
    select * into job from sop_work_runs where id=p_id and status='running' and lease_token=p_lease and lease_until>now() for update;
    if not found then raise exception 'Run lease expired.'; end if;
    perform assert_sop_work_scope(job.workspace_id,job.requested_by,job.relationship_id,job.session_id,job.instance_id::text);
    perform 1 from sops where workspace_id=job.workspace_id and id=job.sop_id and archived_at is null for share;
    if not found or not exists(select 1 from sop_assets where workspace_id=job.workspace_id and sop_id=job.sop_id and asset_id=job.asset_id) then raise exception 'The SOP source is no longer available.'; end if;
    packet := sop_work_evidence(job.workspace_id,job.relationship_id,job.session_id,job.instance_id::text);
    if job.evidence_hash is not null and job.evidence_hash<>md5(packet::text) then raise exception 'Client information changed after generation began. Use a new test relationship.'; end if;
    update sop_work_runs set evidence=packet,evidence_hash=md5(packet::text) where id=p_id;
    return packet;
end $$;

-- The pilot owns the reserved canonical service group. A racing legacy generator
-- must fail rather than overwrite the group or create a second set of children.
create function public.guard_sop_work_owner() returns trigger language plpgsql security definer set search_path=public as $$
declare owner_id text;
begin
    if new.native_kind='relationship_workflow' and new.lifecycle_phase='fulfilment' then
        select id::text into owner_id from sop_work_runs where workspace_id=new.workspace_id and group_work_item_id=coalesce(new.parent_work_item_id,new.id);
        if owner_id is null then select id::text into owner_id from sop_work_runs where workspace_id=new.workspace_id and group_work_item_id=new.id; end if;
        if owner_id is not null and new.metadata->>'sop_work_run_id' is distinct from owner_id then raise exception 'This fulfilment service is owned by SOP generation.'; end if;
        if owner_id is not null and new.id=(select group_work_item_id from sop_work_runs where id=owner_id::uuid) and new.status='done' and exists(select 1 from sop_work_runs where id=owner_id::uuid and status<>'published') then raise exception 'Wait for SOP generation before completing this service.'; end if;
    end if;
    return new;
end $$;
create index sop_work_runs_group_idx on public.sop_work_runs(workspace_id,group_work_item_id);
create trigger guard_sop_work_owner before insert or update of metadata,parent_work_item_id,status on public.work_items for each row when(new.native_kind='relationship_workflow' and new.lifecycle_phase='fulfilment') execute function public.guard_sop_work_owner();

create function public.publish_sop_work(p_id uuid,p_lease uuid) returns uuid[]
language plpgsql set search_path=public as $$
declare job sop_work_runs; task jsonb; step_ref jsonb; dependency jsonb; ids uuid[]='{}'; item uuid; idx integer=0; owner_id uuid; description text; source jsonb; service_name text;
begin
    select * into job from sop_work_runs where id=p_id for update;
    if not found then raise exception 'Run not found.'; end if;
    if job.status='published' then return job.work_item_ids; end if;
    if job.status<>'running' or job.lease_token is distinct from p_lease or job.lease_until<=now() then raise exception 'Run lease expired.'; end if;
    perform prepare_sop_work(p_id,p_lease);
    -- Lock evidence against concurrent answer edits during the atomic publication.
    perform 1 from assets where workspace_id=job.workspace_id and native_kind='onboarding_form_submission' and metadata->>'session_id'=job.session_id::text for share;
    perform 1 from relationship_service_instances where workspace_id=job.workspace_id and id=job.instance_id for share;
    perform 1 from relationship_onboarding_sessions where id=job.session_id for share;
    perform prepare_sop_work(p_id,p_lease);
    if job.plan is null or jsonb_typeof(job.plan->'tasks') is distinct from 'array' or jsonb_array_length(job.plan->'tasks') not between 1 and 40 or octet_length(job.plan::text)>120000 or job.source_snapshot is null then raise exception 'Invalid work plan.'; end if;
    owner_id := (job.evidence->'service'->>'assignee')::uuid;
    service_name := job.evidence->'service'->>'name';
    if owner_id is not null and not exists(select 1 from workspace_memberships where workspace_id=job.workspace_id and user_id=owner_id) then raise exception 'The work assignee is no longer available.'; end if;
    for task in select value from jsonb_array_elements(job.plan->'tasks') loop
        idx:=idx+1;
        if length(trim(task->>'title')) not between 1 and 200 or length(trim(task->>'instruction')) not between 1 and 6000 or jsonb_typeof(task->'depends_on') is distinct from 'array' or jsonb_typeof(task->'source_steps') is distinct from 'array' or jsonb_array_length(task->'source_steps') not between 1 and 10 or jsonb_array_length(task->'depends_on')>10 then raise exception 'Invalid generated task.'; end if;
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

revoke all on function public.assert_sop_work_scope(uuid,uuid,uuid,uuid,text),public.sop_work_evidence(uuid,uuid,uuid,text),public.queue_sop_work(uuid,uuid,uuid,uuid,uuid,uuid,text,text,integer),public.retry_sop_work(uuid,uuid,uuid,integer),public.claim_sop_work(uuid),public.prepare_sop_work(uuid,uuid),public.guard_sop_work_owner(),public.publish_sop_work(uuid,uuid) from public,anon,authenticated;
grant execute on function public.assert_sop_work_scope(uuid,uuid,uuid,uuid,text),public.sop_work_evidence(uuid,uuid,uuid,text),public.queue_sop_work(uuid,uuid,uuid,uuid,uuid,uuid,text,text,integer),public.retry_sop_work(uuid,uuid,uuid,integer),public.claim_sop_work(uuid),public.prepare_sop_work(uuid,uuid),public.guard_sop_work_owner(),public.publish_sop_work(uuid,uuid) to service_role;

-- An explicit service/source binding is configured once, never on each client.
create table public.sop_service_sources (
 workspace_id uuid not null references public.workspaces(id),
 service_id uuid not null references public.onboarding_services(id),
 sop_id uuid not null references public.sops(id),
 asset_id uuid not null references public.sop_assets(asset_id),
 configured_by uuid not null references auth.users(id),
 enabled boolean not null default true,
 updated_at timestamptz not null default now(),
 primary key(workspace_id,service_id)
);
create table public.sop_work_requests (
 instance_id uuid primary key references public.relationship_service_instances(id),
 workspace_id uuid not null references public.workspaces(id),
 relationship_id uuid not null references public.relationships(id),
 sop_id uuid not null references public.sops(id),
 asset_id uuid not null references public.sop_assets(asset_id),
 requested_by uuid not null references auth.users(id),
 status text not null default 'pending' check(status in ('pending','accepted','failed')),
 run_id uuid references public.sop_work_runs(id),
 error_summary text,
 created_at timestamptz not null default now()
);
create index sop_work_requests_pending_idx on public.sop_work_requests(created_at,instance_id) where status='pending';
create index sop_work_requests_relationship_idx on public.sop_work_requests(workspace_id,relationship_id,created_at desc);
alter table public.sop_service_sources enable row level security;
alter table public.sop_work_requests enable row level security;
revoke all on public.sop_service_sources,public.sop_work_requests from public,anon,authenticated;
grant all on public.sop_service_sources,public.sop_work_requests to service_role;

create function public.set_sop_service_source(p_workspace uuid,p_actor uuid,p_service uuid,p_sop uuid,p_asset uuid,p_enabled boolean default true) returns void
language plpgsql set search_path=public as $$
begin
 perform assert_sop_admin(p_workspace,p_actor);
 if not exists(select 1 from onboarding_services where workspace_id=p_workspace and id=p_service and state='active')
 or not exists(select 1 from sops s join sop_assets a on a.workspace_id=s.workspace_id and a.sop_id=s.id
   join assets f on f.workspace_id=a.workspace_id and f.id=a.asset_id
   where s.workspace_id=p_workspace and s.id=p_sop and s.archived_at is null and a.asset_id=p_asset and a.role='main'
   and f.content_type not like 'video/%' and f.content_type not like 'audio/%' and f.file_size<=20971520)
 then raise exception 'Choose an active service and a readable main SOP source.'; end if;
 insert into sop_service_sources(workspace_id,service_id,sop_id,asset_id,configured_by,enabled)
 values(p_workspace,p_service,p_sop,p_asset,p_actor,p_enabled)
 on conflict(workspace_id,service_id) do update set sop_id=excluded.sop_id,asset_id=excluded.asset_id,configured_by=excluded.configured_by,enabled=excluded.enabled,updated_at=now();
end $$;

-- Minimal durable acceptance within the existing service transaction. No provider
-- work or onboarding reads occur on this foreground path. Existing clients are not backfilled.
create function public.enqueue_service_sop_work() returns trigger
language plpgsql security definer set search_path=public as $$
begin
 if new.stage='setup' and new.disposition='active' and new.import_id is null
 and (tg_op='INSERT' or old.stage is distinct from new.stage or old.disposition is distinct from new.disposition) then
  insert into sop_work_requests(instance_id,workspace_id,relationship_id,sop_id,asset_id,requested_by)
  select new.id,new.workspace_id,new.relationship_id,b.sop_id,b.asset_id,b.configured_by
  from sop_service_sources b join relationships r on r.workspace_id=b.workspace_id and r.id=new.relationship_id
  where b.workspace_id=new.workspace_id and b.service_id=new.service_id and b.enabled
   and r.source_metadata->>'is_test'='true' and r.status<>'archived'
  on conflict(instance_id) do nothing;
 end if;
 return new;
end $$;
create trigger enqueue_service_sop_work after insert or update of stage,disposition on public.relationship_service_instances
 for each row execute function public.enqueue_service_sop_work();

create function public.accept_sop_work_request(p_instance uuid,p_model text,p_daily_limit integer default 10) returns uuid
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
  update sop_work_requests set status='failed',error_summary='SOP work could not be queued. Check the source, Setup stage, access and daily limit; then use the SOP work page to retry.' where instance_id=request.instance_id;
 end;
 return run;
end $$;

-- Extend the existing bounded queue read in the same database request.
-- Only admins see generation reports; task access is unchanged.
do $queue$
declare definition text;
begin
 definition:=pg_get_functiondef('public.read_relationship_work_queue(uuid,uuid,uuid,integer)'::regprocedure);
 if position('return result;' in definition)=0 then raise exception 'Unexpected relationship queue function'; end if;
 definition:=replace(definition,'return result;',$fragment$
 if p_offset=0 and exists(select 1 from public.workspace_memberships where workspace_id=p_workspace_id and user_id=p_user_id and role in ('owner','admin')) then
  result:=result||jsonb_build_object('generation',coalesce((select jsonb_agg(to_jsonb(x)) from (
   select q.instance_id,q.sop_id,coalesce(j.id,q.run_id) run_id,coalesce(j.status,q.status) status,coalesce(j.error_summary,q.error_summary) error_summary
   from public.sop_work_requests q left join public.sop_work_runs j on j.workspace_id=q.workspace_id and j.instance_id=q.instance_id
   where q.workspace_id=p_workspace_id and q.relationship_id=p_relationship_id order by q.created_at desc limit 10
  ) x),'[]'::jsonb));
 end if;
 return result;
$fragment$);
 execute definition;
end $queue$;
revoke all on function public.set_sop_service_source(uuid,uuid,uuid,uuid,uuid,boolean),public.enqueue_service_sop_work(),public.accept_sop_work_request(uuid,text,integer) from public,anon,authenticated;
grant execute on function public.set_sop_service_source(uuid,uuid,uuid,uuid,uuid,boolean),public.accept_sop_work_request(uuid,text,integer) to service_role;
notify pgrst,'reload schema';
commit;
