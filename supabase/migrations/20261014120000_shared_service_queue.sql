-- Additive, opt-in service membership. Never clone work or rewrite sold history.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';

create table public.service_queue_rosters (
 workspace_id uuid not null, instance_id uuid primary key, version integer not null default 1,
 foreign key(workspace_id,instance_id) references public.relationship_service_instances(workspace_id,id),
 unique(workspace_id,instance_id)
);
create table public.service_queue_members (
 workspace_id uuid not null, instance_id uuid not null, user_id uuid not null,
 added_by uuid not null references auth.users(id), added_at timestamptz not null default now(),
 primary key(instance_id,user_id),
 foreign key(workspace_id,instance_id) references public.service_queue_rosters(workspace_id,instance_id),
 foreign key(workspace_id,user_id) references public.workspace_memberships(workspace_id,user_id) on delete cascade
);
create index service_queue_member_actor_idx on public.service_queue_members(workspace_id,user_id,instance_id);
create table public.service_queue_chat_members (
 workspace_id uuid not null, team_id uuid not null, user_id uuid not null,
 primary key(team_id,user_id),
 foreign key(team_id,user_id) references public.workspace_team_members(team_id,user_id) on delete cascade
);
create table public.service_queue_activity (
 workspace_id uuid not null, work_item_id uuid primary key references public.work_items(id),
 started_by uuid references auth.users(id), active boolean not null default false,
 completed_by uuid references auth.users(id), updated_at timestamptz not null default now()
);
create unique index service_queue_one_active_actor_idx on public.service_queue_activity(workspace_id,started_by) where active;
create table public.service_queue_receipts (
 workspace_id uuid not null, actor_id uuid not null references auth.users(id), request_id uuid not null,
 kind text not null check(kind in ('roster','work')), input jsonb not null, result jsonb not null,
 created_at timestamptz not null default now(), primary key(workspace_id,actor_id,request_id)
);
create function public.guard_service_queue_receipt() returns trigger language plpgsql as $$
begin raise exception 'Shared queue history is immutable'; end $$;
create trigger immutable_service_queue_receipt before update or delete on public.service_queue_receipts for each row execute function public.guard_service_queue_receipt();

do $$declare t text;begin
 foreach t in array array['service_queue_rosters','service_queue_members','service_queue_chat_members','service_queue_activity','service_queue_receipts'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from public,anon,authenticated,service_role',t);
 end loop;
end $$;

-- Membership grants service work, never financial/full-client access.
create function public.service_queue_is_member(p_workspace uuid,p_instance uuid,p_user uuid) returns boolean
language sql stable security definer set search_path=public as $$
 select exists(select 1 from service_queue_rosters q
 join relationship_service_instances i on i.workspace_id=q.workspace_id and i.id=q.instance_id
 join relationships r on r.workspace_id=i.workspace_id and r.id=i.relationship_id and r.status<>'archived'
 join workspace_memberships m on m.workspace_id=i.workspace_id and m.user_id=p_user
 join workspace_member_service_access e on e.workspace_id=i.workspace_id and e.service_id=i.service_id and e.user_id=m.user_id
 where q.workspace_id=p_workspace and q.instance_id=p_instance and i.import_id is null
 and i.disposition<>'cancelled' and i.stage in ('onboarding','setup','maintenance')
 and (i.assignee_user_id=p_user or exists(select 1 from service_queue_members a where a.instance_id=i.id and a.user_id=p_user)))
$$;

-- Only unambiguous work from this exact engagement is shared. Review/module
-- identity is checked, not inferred from a null catalogue service_id.
create function public.service_queue_work_instance(p_workspace uuid,p_item uuid) returns uuid
language sql stable security definer set search_path=public as $$
 select i.id from work_items w
 join service_instance_work_items l on l.workspace_id=w.workspace_id and l.work_item_id=w.id
 join service_queue_rosters q on q.workspace_id=l.workspace_id and q.instance_id=l.instance_id
 join relationship_service_instances i on i.workspace_id=l.workspace_id and i.id=l.instance_id
 where w.workspace_id=p_workspace and w.id=p_item and w.visibility='workspace' and w.area<>'admin' and i.import_id is null
 and exists(select 1 from work_item_relationships r where r.workspace_id=w.workspace_id and r.work_item_id=w.id and r.relationship_id=i.relationship_id)
 and not exists(select 1 from work_item_relationships r where r.workspace_id=w.workspace_id and r.work_item_id=w.id and r.relationship_id<>i.relationship_id)
 and not exists(select 1 from service_instance_work_items other where other.workspace_id=w.workspace_id and other.work_item_id=w.id and other.instance_id<>i.id)
 and (w.service_id=i.service_id or (w.service_id is null and w.native_kind='relationship_workflow' and w.workflow_role='review'
  and w.native_key=(w.metadata->>'session_id')||':service-review:'||(w.metadata->>'session_step_id')
  and exists(select 1 from relationship_onboarding_session_steps step
   join relationship_onboarding_sessions sess on sess.workspace_id=step.workspace_id and sess.id=step.session_id and sess.relationship_id=i.relationship_id
   join service_instance_module_requirements req on req.workspace_id=step.workspace_id and req.session_module_id=step.session_module_id and req.session_id=step.session_id
   where step.workspace_id=w.workspace_id and step.id::text=w.metadata->>'session_step_id' and step.session_id::text=w.metadata->>'session_id' and req.instance_id=i.id and req.review_required)))
$$;
create function public.service_queue_can_work(p_workspace uuid,p_item uuid,p_user uuid) returns boolean
language sql stable security definer set search_path=public as $$
 select exists(select 1 from service_queue_rosters q join service_instance_work_items l on l.workspace_id=q.workspace_id and l.instance_id=q.instance_id
 where q.workspace_id=p_workspace and l.work_item_id=p_item
 and public.service_queue_is_member(p_workspace,q.instance_id,p_user)
 and public.service_queue_work_instance(p_workspace,p_item)=q.instance_id)
$$;

-- Preserve each canonical function's OID/grants and fail installation on drift.
do $$declare d text; old text; new text;begin
 d:=pg_get_functiondef('public.workspace_user_can_access_work_item(uuid,uuid,uuid)'::regprocedure);
 old:=E'))))))))\n';
 new:=E')))))))) or public.service_queue_can_work(p_workspace_id,p_work_item_id,p_user_id)\n';
 if position(old in d)=0 then raise exception 'Unexpected work access definition';end if;
 execute replace(d,old,new);
 d:=pg_get_functiondef('public.personal_queue_owns(uuid,uuid,uuid)'::regprocedure);
 old:=E' ))))))\n';
 if position(old in d)=0 then raise exception 'Unexpected queue ownership definition';end if;
 execute replace(d,old,E' )))))) or public.service_queue_can_work(p_workspace,p_item,p_user)\n');
 d:=pg_get_functiondef('public.workspace_user_can_access_relationship(uuid,uuid,uuid)'::regprocedure);
 old:=E'p_user_id in(i.assignee_user_id,i.seller_user_id,i.manager_user_id))))\n';
 if position(old in d)=0 then raise exception 'Unexpected relationship access definition';end if;
 execute replace(d,old,rtrim(old)||E' or exists(select 1 from public.service_queue_members sq where sq.workspace_id=p_workspace_id and sq.user_id=p_user_id and public.service_queue_is_member(p_workspace_id,sq.instance_id,p_user_id) and exists(select 1 from public.relationship_service_instances si where si.id=sq.instance_id and si.relationship_id=p_relationship_id))\n');
 d:=pg_get_functiondef('public.workspace_user_can_access_session_module(uuid,uuid,uuid)'::regprocedure);
 old:='i.assignee_user_id=p_user_id';
 if position(old in d)=0 then raise exception 'Unexpected session module access definition';end if;
 execute replace(d,old,'(i.assignee_user_id=p_user_id or (i.relationship_id=s.relationship_id and req.session_id=s.id and public.service_queue_is_member(p_workspace_id,i.id,p_user_id)))');
end $$;

-- A shared queue is not everyone's personal active task. Preserve old command
-- checks while making their one-running-task predicate actor-specific.
create function public.queue_actor_is_working(p_workspace uuid,p_item uuid,p_user uuid) returns boolean
language sql stable security definer set search_path=public as $$
 select case when public.service_queue_work_instance(p_workspace,p_item) is not null then
 exists(select 1 from service_queue_activity a where a.workspace_id=p_workspace and a.work_item_id=p_item and a.started_by=p_user and a.active)
 else public.personal_queue_owns(p_workspace,p_item,p_user) end
$$;
do $$declare d text;begin
 d:=pg_get_functiondef('public.personal_queue_command_v1(uuid,uuid,uuid,text,timestamptz)'::regprocedure);
 if position('personal_queue_owns(p_workspace,other.id,p_user)' in d)=0 then raise exception 'Unexpected queue active-work check';end if;
 d:=replace(d,'personal_queue_owns(p_workspace,other.id,p_user)','queue_actor_is_working(p_workspace,other.id,p_user)');
 d:=replace(d,'-- One running task per user across simultaneous tabs. Existing work remains stable.',E'if exists(select 1 from public.service_queue_rosters sq join public.service_instance_work_items sl on sl.workspace_id=sq.workspace_id and sl.instance_id=sq.instance_id where sq.workspace_id=p_workspace and sl.work_item_id=p_item) and public.service_queue_work_instance(p_workspace,p_item) is not null then raise exception ''Reload the queue to use shared work.''; end if;\n -- One running task per user across simultaneous tabs. Existing work remains stable.');
 execute d;
end $$;

-- Roster reads are on demand, capped by workspace membership and eligibility.
create function public.read_service_queue_roster(p_workspace uuid,p_relationship uuid,p_instance uuid,p_actor uuid) returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare i relationship_service_instances; result jsonb;begin
 if not exists(select 1 from workspace_memberships where workspace_id=p_workspace and user_id=p_actor and role in ('owner','admin')) then raise exception 'Owner or admin required';end if;
 select * into i from relationship_service_instances where workspace_id=p_workspace and relationship_id=p_relationship and id=p_instance and import_id is null;
 if not found then raise exception 'Service not found';end if;
 select jsonb_build_object('instanceId',i.id,'version',coalesce((select version from service_queue_rosters where instance_id=i.id),0),
 'primaryId',i.assignee_user_id,'memberIds',coalesce((select jsonb_agg(user_id order by user_id) from service_queue_members where instance_id=i.id),'[]'),
 'people',coalesce((select jsonb_agg(x order by x.name,x.id) from (select m.user_id id,coalesce(u.display_name,u.username,'Workspace member') name
 from workspace_member_service_access e join workspace_memberships m using(workspace_id,user_id) join user_profiles u on u.user_id=m.user_id
 where e.workspace_id=p_workspace and e.service_id=i.service_id order by m.user_id limit 201) x),'[]')) into result;
 if jsonb_array_length(result->'people')>200 then raise exception 'Too many eligible people. Contact an administrator.';end if;
 return result;
end $$;

-- Distinguish rows inserted by this feature from independently granted chat
-- membership. A later explicit insert/upsert makes that grant independent.
create function public.preserve_explicit_service_queue_chat_member() returns trigger language plpgsql security definer set search_path=public as $$
begin
 if current_setting('app.service_queue_chat',true) is distinct from 'managed' then
  delete from service_queue_chat_members where team_id=new.team_id and user_id=new.user_id;
 end if;
 return new;
end $$;
create trigger preserve_explicit_service_queue_chat_member after insert or update on public.workspace_team_members for each row execute function public.preserve_explicit_service_queue_chat_member();

create function public.sync_service_queue_chat(p_workspace uuid,p_relationship uuid) returns void
language plpgsql security definer set search_path=public as $$
declare team uuid; member uuid; inserted uuid;begin
 perform ensure_active_service_fulfilment_chat(p_workspace,p_relationship);
 select id into team from workspace_teams where workspace_id=p_workspace and relationship_id=p_relationship;
 if team is null then raise exception 'Internal client group is unavailable';end if;
 perform set_config('app.service_queue_chat','managed',true);
 for member in select distinct a.user_id from service_queue_members a join relationship_service_instances i on i.id=a.instance_id and i.workspace_id=a.workspace_id
 where i.workspace_id=p_workspace and i.relationship_id=p_relationship and i.disposition<>'cancelled' and service_queue_is_member(p_workspace,i.id,a.user_id) loop
  inserted:=null;
  insert into workspace_team_members(workspace_id,team_id,user_id,added_by) values(p_workspace,team,member,null) on conflict do nothing returning user_id into inserted;
  if inserted is not null then insert into service_queue_chat_members values(p_workspace,team,member) on conflict do nothing;end if;
 end loop;
 delete from workspace_team_members m using service_queue_chat_members own
 where own.workspace_id=p_workspace and own.team_id=team and m.team_id=own.team_id and m.user_id=own.user_id
 and not exists(select 1 from service_queue_members a join relationship_service_instances i on i.id=a.instance_id and i.workspace_id=a.workspace_id where i.workspace_id=p_workspace and i.relationship_id=p_relationship and a.user_id=m.user_id and i.disposition<>'cancelled' and service_queue_is_member(p_workspace,i.id,a.user_id))
 and not exists(select 1 from relationship_service_instances i where i.workspace_id=p_workspace and i.relationship_id=p_relationship and i.assignee_user_id=m.user_id and i.disposition='active' and i.stage in ('onboarding','setup','maintenance'))
 and not exists(select 1 from relationship_services s where s.workspace_id=p_workspace and s.relationship_id=p_relationship and s.assignee_user_id=m.user_id)
 and not exists(select 1 from relationships r where r.workspace_id=p_workspace and r.id=p_relationship and m.user_id in(r.seller_user_id,r.fulfilment_manager_user_id));
 perform set_config('app.service_queue_chat','',true);
end $$;

create function public.save_service_queue_roster(p_workspace uuid,p_relationship uuid,p_instance uuid,p_actor uuid,p_request uuid,p_version integer,p_members uuid[]) returns jsonb
language plpgsql security definer set search_path=public as $$
declare i relationship_service_instances; prior service_queue_receipts; v integer; input jsonb; result jsonb; removed uuid[];begin
 if p_request is null or p_members is null or cardinality(p_members)>19 or array_position(p_members,null) is not null then raise exception 'Choose up to 19 additional assignees';end if;
 if cardinality(p_members)<>(select count(distinct x) from unnest(p_members) x) then raise exception 'Duplicate assignees';end if;
 perform 1 from workspace_memberships where workspace_id=p_workspace and user_id=p_actor and role in ('owner','admin') for share;
 if not found then raise exception 'Owner or admin required';end if;
 input:=jsonb_build_object('instance',p_instance,'relationship',p_relationship,'version',p_version,'members',(select coalesce(jsonb_agg(x order by x),'[]') from unnest(p_members) x));
 perform pg_advisory_xact_lock(hashtextextended('shared-queue:'||p_workspace::text||p_actor::text||p_request::text,0));
 select * into prior from service_queue_receipts where workspace_id=p_workspace and actor_id=p_actor and request_id=p_request;
 if found then if prior.kind<>'roster' or prior.input<>input then raise exception 'Request already used with different input';end if;return prior.result;end if;
 perform 1 from relationships where workspace_id=p_workspace and id=p_relationship and status<>'archived' for update;
 if not found then raise exception 'Active client required';end if;
 select * into i from relationship_service_instances where workspace_id=p_workspace and relationship_id=p_relationship and id=p_instance for update;
 if not found or i.import_id is not null or i.disposition='cancelled' or i.stage not in ('onboarding','setup','maintenance') then raise exception 'Choose a current delivery service';end if;
 select version into v from service_queue_rosters where instance_id=i.id;
 if coalesce(v,0)<>p_version then raise exception 'Assignments changed. Reload before saving';end if;
 if not exists(select 1 from workspace_memberships m join workspace_member_service_access e using(workspace_id,user_id) where m.workspace_id=p_workspace and m.user_id=i.assignee_user_id and e.service_id=i.service_id) then raise exception 'The primary assignee must have current service eligibility';end if;
 if i.assignee_user_id is null or i.assignee_user_id=any(p_members) then raise exception 'Keep the primary assignee; use Transfer assignee to change them';end if;
 perform 1 from workspace_memberships where workspace_id=p_workspace and user_id=any(p_members) order by user_id for share;
 perform 1 from workspace_member_service_access where workspace_id=p_workspace and service_id=i.service_id and user_id=any(p_members) order by user_id for share;
 if exists(select 1 from unnest(p_members) person where not exists(select 1 from workspace_memberships m join workspace_member_service_access e using(workspace_id,user_id) where m.workspace_id=p_workspace and m.user_id=person and e.service_id=i.service_id)) then raise exception 'Choose current eligible service assignees';end if;
 insert into service_queue_rosters values(p_workspace,i.id,1) on conflict(instance_id) do update set version=service_queue_rosters.version+1;
 select coalesce(array_agg(user_id),'{}') into removed from service_queue_members where instance_id=i.id and not(user_id=any(p_members));
 delete from service_queue_members where instance_id=i.id and not(user_id=any(p_members));
 insert into service_queue_members(workspace_id,instance_id,user_id,added_by) select p_workspace,i.id,person,p_actor from unnest(p_members) person on conflict do nothing;
 -- Preserve already-started work when sharing is first enabled.
 insert into service_queue_activity(workspace_id,work_item_id,started_by,active)
 select p_workspace,w.id,coalesce(run.user_id,w.execution_owner_id,i.assignee_user_id),true
 from service_instance_work_items l join work_items w on w.workspace_id=l.workspace_id and w.id=l.work_item_id
 left join work_queue_effort_runs run on run.workspace_id=w.workspace_id and run.work_item_id=w.id and run.completed_at is null
 where l.instance_id=i.id and w.status='doing' and service_queue_work_instance(p_workspace,w.id)=i.id
 on conflict(work_item_id) do nothing;
 -- Removing an active worker pauses only their shared task; never completes it,
 -- clears their work content or resets its original start/progress history.
 perform 1 from work_items w join service_instance_work_items l on l.workspace_id=w.workspace_id and l.work_item_id=w.id where l.instance_id=i.id order by w.id for update of w;
 update work_items w set status='todo',updated_at=clock_timestamp() from service_queue_activity a
 where a.workspace_id=p_workspace and a.work_item_id=w.id and a.active and w.status='doing'
 and service_queue_work_instance(p_workspace,w.id)=i.id and a.started_by=any(removed) and not service_queue_is_member(p_workspace,i.id,a.started_by);
 update service_queue_activity a set active=false,updated_at=clock_timestamp() where a.workspace_id=p_workspace and a.active
 and service_queue_work_instance(p_workspace,a.work_item_id)=i.id and a.started_by=any(removed) and not service_queue_is_member(p_workspace,i.id,a.started_by);
 perform sync_service_queue_chat(p_workspace,p_relationship);
 result:=read_service_queue_roster(p_workspace,p_relationship,i.id,p_actor);
 insert into service_queue_receipts(workspace_id,actor_id,request_id,kind,input,result) values(p_workspace,p_actor,p_request,'roster',input,result);
 return result;
end $$;

-- New caller supplies durable request identity. Old callers are rejected on a
-- shared item by personal_queue_command_v1 instead of applying personal rules.
create function public.shared_queue_command(p_workspace uuid,p_user uuid,p_item uuid,p_action text,p_version timestamptz,p_request uuid) returns jsonb
language plpgsql security definer set search_path=public as $$
declare instance uuid; relationship uuid; w work_items; prior service_queue_receipts; input jsonb; result jsonb; starter uuid;begin
 if p_request is null or p_action not in ('start','pause','complete') then raise exception 'Invalid shared work action';end if;
 input:=jsonb_build_object('id',p_item,'action',p_action,'version',p_version);
 perform pg_advisory_xact_lock(hashtextextended('shared-queue:'||p_workspace::text||p_user::text||p_request::text,0));
 select * into prior from service_queue_receipts where workspace_id=p_workspace and actor_id=p_user and request_id=p_request;
 if found then if prior.kind<>'work' or prior.input<>input then raise exception 'Request already used with different input';end if;return prior.result;end if;
 instance:=service_queue_work_instance(p_workspace,p_item);
 if instance is null then return personal_queue_command(p_workspace,p_user,p_item,p_action,p_version);end if;
 if not service_queue_is_member(p_workspace,instance,p_user) then raise exception 'This work is not available to you';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_workspace::text||p_user::text,121));
 select relationship_id into relationship from relationship_service_instances where id=instance;
 perform 1 from relationships where workspace_id=p_workspace and id=relationship for share;
 perform 1 from relationship_service_instances where workspace_id=p_workspace and id=instance for share;
 perform 1 from workspace_memberships where workspace_id=p_workspace and user_id=p_user for share;
 perform 1 from workspace_member_service_access e join relationship_service_instances i on i.workspace_id=e.workspace_id and i.service_id=e.service_id where i.id=instance and e.user_id=p_user for share of e;
 if not service_queue_is_member(p_workspace,instance,p_user) then raise exception 'Your service assignment changed';end if;
 select * into w from work_items where workspace_id=p_workspace and id=p_item for update;
 if service_queue_work_instance(p_workspace,p_item) is distinct from instance or not queue_work_open(w) then raise exception 'This work is no longer available';end if;
 if w.updated_at is distinct from p_version then raise exception 'This work changed. Refresh before continuing';end if;
 if p_action='start' and w.status<>'todo' then raise exception 'Someone already started this work, or it is not ready';end if;
 if p_action in ('pause','complete') and w.status<>'doing' then raise exception 'This work is not in progress';end if;
 if p_action in ('start','complete') then
  if exists(select 1 from work_queue_disputes where workspace_id=p_workspace and work_item_id=p_item and status='open' and blocking) then raise exception 'Resolve the open dispute first';end if;
  perform 1 from work_item_dependencies d join work_items p on p.workspace_id=d.workspace_id and p.id=d.depends_on_work_item_id where d.workspace_id=p_workspace and d.work_item_id=p_item order by p.id for share of p;
  if exists(select 1 from work_item_dependencies d left join work_items p on p.workspace_id=d.workspace_id and p.id=d.depends_on_work_item_id where d.workspace_id=p_workspace and d.work_item_id=p_item and (p.id is null or p.status<>'done')) then raise exception 'Complete the prerequisites first';end if;
  if exists(select 1 from relationship_service_instances where id=instance and (disposition<>'active' or stage not in ('onboarding','setup','maintenance'))) then raise exception 'This service is not active';end if;
  if p_action='start' and w.planned_start_date+coalesce(w.planned_start_time,time '00:00')>now() at time zone 'UTC' then raise exception 'This work is scheduled for later';end if;
 end if;
 if p_action='start' and exists(select 1 from work_items other where other.workspace_id=p_workspace and other.id<>p_item and other.status='doing' and queue_work_open(other) and queue_actor_is_working(p_workspace,other.id,p_user)) then raise exception 'Pause your current task before starting another';end if;
 perform set_config('app.queue_actor',p_user::text,true);
 select started_by into starter from service_queue_activity where work_item_id=p_item;
 -- Team effort must never train an individual's timing estimates.
 update work_queue_effort_runs set valid_sample=false,exclusion='shared_service' where workspace_id=p_workspace and work_item_id=p_item and completed_at is null;
 update work_items set status=case p_action when 'start' then 'doing' when 'pause' then 'todo' else 'done' end,updated_at=clock_timestamp() where id=p_item returning * into w;
 insert into service_queue_activity(workspace_id,work_item_id,started_by,active,completed_by)
 values(p_workspace,p_item,case when p_action='start' then p_user else starter end,p_action='start',case when p_action='complete' then p_user end)
 on conflict(work_item_id) do update set started_by=excluded.started_by,active=excluded.active,completed_by=excluded.completed_by,updated_at=clock_timestamp();
 if p_action='complete' then insert into work_queue_completion_followups(workspace_id,work_item_id) values(p_workspace,p_item) on conflict(work_item_id) do update set completed_at=null,attempts=0,requested_at=now();end if;
 result:=jsonb_build_object('id',w.id,'status',w.status,'updated_at',w.updated_at,'actual_start_at',w.actual_start_at,'shared',true,'started_by',case when p_action='start' then p_user else starter end);
 insert into service_queue_receipts(workspace_id,actor_id,request_id,kind,input,result) values(p_workspace,p_user,p_request,'work',input,result);
 return result;
end $$;


-- Build scope from indexed assignments once, before ordering/pagination. The
-- shared branch uses the same exact-engagement predicates as the command helper.
create function public.service_queue_visible_work(p_workspace uuid,p_user uuid)
returns table(work_item_id uuid,shared boolean)
language sql stable security definer set search_path=public as $$
 with eligible as materialized (
  select i.id,i.relationship_id,i.service_id from service_queue_rosters q
  join relationship_service_instances i on i.workspace_id=q.workspace_id and i.id=q.instance_id
  join relationships r on r.workspace_id=i.workspace_id and r.id=i.relationship_id and r.status<>'archived'
  join workspace_memberships m on m.workspace_id=i.workspace_id and m.user_id=p_user
  join workspace_member_service_access e on e.workspace_id=i.workspace_id and e.service_id=i.service_id and e.user_id=m.user_id
  where q.workspace_id=p_workspace and i.import_id is null and i.disposition<>'cancelled' and i.stage in ('onboarding','setup','maintenance')
  and (i.assignee_user_id=p_user or exists(select 1 from service_queue_members a where a.instance_id=i.id and a.user_id=p_user))
 ), shared_work as materialized (
  select w.id from eligible i
  join service_instance_work_items l on l.workspace_id=p_workspace and l.instance_id=i.id
  join work_items w on w.workspace_id=l.workspace_id and w.id=l.work_item_id
  where w.visibility='workspace' and w.area<>'admin'
  and exists(select 1 from work_item_relationships r where r.workspace_id=w.workspace_id and r.work_item_id=w.id and r.relationship_id=i.relationship_id)
  and not exists(select 1 from work_item_relationships r where r.workspace_id=w.workspace_id and r.work_item_id=w.id and r.relationship_id<>i.relationship_id)
  and not exists(select 1 from service_instance_work_items other where other.workspace_id=w.workspace_id and other.work_item_id=w.id and other.instance_id<>i.id)
  and (w.service_id=i.service_id or (w.service_id is null and w.native_kind='relationship_workflow' and w.workflow_role='review'
   and w.native_key=(w.metadata->>'session_id')||':service-review:'||(w.metadata->>'session_step_id')
   and exists(select 1 from relationship_onboarding_session_steps step
    join relationship_onboarding_sessions sess on sess.workspace_id=step.workspace_id and sess.id=step.session_id and sess.relationship_id=i.relationship_id
   join service_instance_module_requirements req on req.workspace_id=step.workspace_id and req.session_module_id=step.session_module_id and req.session_id=step.session_id
    where step.workspace_id=w.workspace_id and step.id::text=w.metadata->>'session_step_id' and step.session_id::text=w.metadata->>'session_id' and req.instance_id=i.id and req.review_required)))
 ), assigned as (
  select id from work_items where workspace_id=p_workspace and execution_owner_id=p_user and status not in ('done','canceled') and metadata->>'archived_at' is null
  union
  select a.work_item_id from work_item_assignees a join work_items w on w.workspace_id=a.workspace_id and w.id=a.work_item_id and w.execution_owner_id is null where a.workspace_id=p_workspace and a.user_id=p_user
  union
  select l.work_item_id from relationship_service_instances i
  join service_instance_work_items l on l.workspace_id=i.workspace_id and l.instance_id=i.id
  join work_items w on w.workspace_id=l.workspace_id and w.id=l.work_item_id and w.execution_owner_id is null
  where i.workspace_id=p_workspace and i.assignee_user_id=p_user
  and not exists(select 1 from work_item_assignees a where a.workspace_id=p_workspace and a.work_item_id=w.id)
  union
  select l.work_item_id from relationship_services s
  join work_item_relationships l on l.workspace_id=s.workspace_id and l.relationship_id=s.relationship_id
  join work_items w on w.workspace_id=l.workspace_id and w.id=l.work_item_id and w.service_id=s.service_id and w.execution_owner_id is null
  where s.workspace_id=p_workspace and s.assignee_user_id=p_user
  and not exists(select 1 from work_item_assignees a where a.workspace_id=p_workspace and a.work_item_id=w.id)
  and not exists(select 1 from service_instance_work_items i where i.workspace_id=p_workspace and i.work_item_id=w.id)
 ), personal as materialized (select a.id from assigned a where not exists(select 1 from shared_work s where s.id=a.id))
 select id,true from shared_work
 union all
 select a.id,false from personal a where workspace_user_can_access_work_item(p_workspace,a.id,p_user)

$$;

do $$declare d text; old text; signature text; rel text; svc text;begin
 d:=pg_get_functiondef('public.read_personal_work_queue(uuid,uuid,integer,text)'::regprocedure);
 old:='with candidates as materialized (';
 if position(old in d)=0 or position('plan.user_id=p_user' in d)=0 then raise exception 'Unexpected queue reader';end if;
 d:=replace(d,old,'with visible as materialized (select * from service_queue_visible_work(p_workspace,p_user)), candidates as materialized (');
 d:=replace(d,'w.priority_override,','w.priority_override,visible.shared,');
 d:=replace(d,'from work_items w left join work_queue_assessments','from visible join work_items w on w.id=visible.work_item_id left join work_queue_assessments');
 d:=replace(d,'plan.user_id=p_user','plan.user_id=p_user and not visible.shared');
 d:=replace(d,' and personal_queue_owns(p_workspace,w.id,p_user)','');
 -- These display fields never influence ranking. Resolve them for 31 rows only.
 rel:='(select coalesce(r.business_name,r.primary_person_name) from work_item_relationships l join relationships r on r.workspace_id=l.workspace_id and r.id=l.relationship_id where l.workspace_id=p_workspace and l.work_item_id=w.id and workspace_user_can_access_relationship(p_workspace,r.id,p_user) order by r.id limit 1)';
 svc:='(select coalesce(v.name,i.service_key) from service_instance_work_items l join relationship_service_instances i on i.workspace_id=l.workspace_id and i.id=l.instance_id left join onboarding_service_revisions v on v.workspace_id=i.workspace_id and v.id=i.service_revision_id where l.workspace_id=p_workspace and l.work_item_id=w.id order by i.id limit 1)';
 if position(rel in d)=0 or position(svc in d)=0 then raise exception 'Unexpected queue display fields';end if;
 d:=replace(replace(d,rel,'null::text'),svc,'null::text');
 rel:=replace(replace(rel,'w.id','page.id'),'and workspace_user_can_access_relationship(p_workspace,r.id,p_user)','and (page.shared or workspace_user_can_access_relationship(p_workspace,r.id,p_user))');
 svc:=replace(svc,'w.id','page.id');
 d:=replace(d,'jsonb_agg(to_jsonb(page)) from page','jsonb_agg(to_jsonb(page)||jsonb_build_object(''relationship'','||rel||',''service'','||svc||',''started_by'',activity.started_by,''started_by_name'',coalesce(worker.display_name,worker.username))) from page left join service_queue_activity activity on activity.workspace_id=p_workspace and activity.work_item_id=page.id left join user_profiles worker on worker.user_id=activity.started_by');
 execute d;
 -- Existing personal schedules must not count the same shared task per member.
 d:=pg_get_functiondef('public.queue_schedule_context(uuid,uuid)'::regprocedure);
 old:='queue_work_open(w) and personal_queue_owns(p_workspace,w.id,p_user)';
 if position(old in d)=0 then raise exception 'Unexpected schedule context';end if;
 execute replace(d,old,old||' and public.service_queue_work_instance(p_workspace,w.id) is null');
 d:=pg_get_functiondef('public.queue_schedule_item(uuid,uuid)'::regprocedure);
 old:='where exists(select 1 from workspace_memberships';
 if position(old in d)=0 then raise exception 'Unexpected schedule enqueue';end if;
 execute replace(d,old,'where (not exists(select 1 from public.service_queue_rosters sq join public.service_instance_work_items sl on sl.workspace_id=sq.workspace_id and sl.instance_id=sq.instance_id where sq.workspace_id=p_workspace and sl.work_item_id=p_item) or public.service_queue_work_instance(p_workspace,p_item) is null) and exists(select 1 from workspace_memberships');
 foreach signature in array array['public.relationship_service_rows(uuid,uuid,uuid)','public.read_selected_service_session_access(uuid,uuid[],uuid)'] loop
  d:=pg_get_functiondef(signature::regprocedure);
  old:='i.assignee_user_id=p_user_id';
  if position(old in d)=0 then raise exception 'Unexpected scoped service reader: %',signature;end if;
  execute replace(d,old,'(i.assignee_user_id=p_user_id or public.service_queue_is_member(p_workspace_id,i.id,p_user_id))');
 end loop;
 d:=pg_get_functiondef('public.can_read_service_instance(uuid,uuid)'::regprocedure);
 old:='i.assignee_user_id=m.user_id';
 if position(old in d)=0 then raise exception 'Unexpected instance read policy';end if;
 execute replace(d,old,'(i.assignee_user_id=m.user_id or public.service_queue_is_member(p_workspace_id,i.id,m.user_id))');
end $$;

-- Keep live shared activity honest when existing dispute/status paths pause it.
create function public.sync_service_queue_activity() returns trigger language plpgsql security definer set search_path=public as $$
begin
 if new.status<>'doing' and old.status='doing' then
  update service_queue_activity set active=false,updated_at=clock_timestamp() where work_item_id=new.id and active;
 end if;return null;
end $$;
create trigger sync_service_queue_activity after update of status on public.work_items for each row when(old.status='doing' and new.status<>'doing') execute function public.sync_service_queue_activity();
create function public.sync_service_queue_lifecycle() returns trigger language plpgsql security definer set search_path=public as $$
begin
 if exists(select 1 from service_queue_rosters where instance_id=new.id) then
  if new.assignee_user_id is distinct from old.assignee_user_id then
   -- Promotion to primary establishes the same retained historical grant as an
   -- ordinary primary assignment; a later transfer must not remove it.
   delete from service_queue_chat_members a using workspace_teams t
   where t.workspace_id=new.workspace_id and t.relationship_id=new.relationship_id
   and a.team_id=t.id and a.user_id=new.assignee_user_id;
   delete from service_queue_members where instance_id=new.id and user_id=new.assignee_user_id;
   update service_queue_rosters set version=version+1 where instance_id=new.id;
  end if;
  -- A transferred/closed service cannot strand an active former worker.
  update work_items w set status='todo',updated_at=clock_timestamp() from service_queue_activity a
  where a.workspace_id=new.workspace_id and a.work_item_id=w.id and a.active and w.status='doing'
  and service_queue_work_instance(new.workspace_id,w.id)=new.id
  and not service_queue_is_member(new.workspace_id,new.id,a.started_by);
  perform sync_service_queue_chat(new.workspace_id,new.relationship_id);
 end if;return null;
end $$;
create trigger sync_service_queue_lifecycle after update of assignee_user_id,stage,disposition on public.relationship_service_instances for each row execute function public.sync_service_queue_lifecycle();

-- Explicit removal runs through the versioned roster command, so chat provenance
-- and active work change atomically. Offboarding must not bypass that handover.
create function public.guard_service_queue_offboarding() returns trigger language plpgsql security definer set search_path=public as $$
begin
 if tg_op='UPDATE' and to_jsonb(new)->'workspace_id'=to_jsonb(old)->'workspace_id'
 and to_jsonb(new)->'user_id'=to_jsonb(old)->'user_id'
 and to_jsonb(new)->'service_id' is not distinct from to_jsonb(old)->'service_id' then return new;end if;
 if exists(select 1 from service_queue_members a join relationship_service_instances i on i.workspace_id=a.workspace_id and i.id=a.instance_id
 join relationships r on r.workspace_id=i.workspace_id and r.id=i.relationship_id
 where a.workspace_id=old.workspace_id and a.user_id=old.user_id and i.disposition<>'cancelled'
 and i.stage in ('onboarding','setup','maintenance') and r.status<>'archived'
 and (tg_table_name='workspace_memberships' or i.service_id::text=to_jsonb(old)->>'service_id')) then
  raise exception 'Remove this person from shared service assignments before removing their workspace membership or service eligibility';
 end if;
 if tg_op='DELETE' then return old;else return new;end if;
end $$;
create trigger guard_service_queue_offboarding before delete or update on public.workspace_memberships for each row execute function public.guard_service_queue_offboarding();
create trigger guard_service_queue_eligibility before delete or update on public.workspace_member_service_access for each row execute function public.guard_service_queue_offboarding();

-- No direct browser RPCs or row writes. Authentication/MFA and workspace checks
-- precede service-role commands; policy helpers retain their established use.
do $$declare f record;begin
 for f in select oid::regprocedure signature,proname from pg_proc where pronamespace='public'::regnamespace and proname in (
 'guard_service_queue_offboarding','service_queue_visible_work','sync_service_queue_activity','sync_service_queue_lifecycle','guard_service_queue_receipt','service_queue_is_member','service_queue_work_instance','service_queue_can_work','queue_actor_is_working','read_service_queue_roster','preserve_explicit_service_queue_chat_member','sync_service_queue_chat','save_service_queue_roster','shared_queue_command') loop
  execute format('revoke all on function %s from public,anon,authenticated,service_role',f.signature);
  if f.proname in ('read_service_queue_roster','save_service_queue_roster','shared_queue_command') then execute format('grant execute on function %s to service_role',f.signature);end if;
 end loop;
end $$;
notify pgrst,'reload schema';
commit;
