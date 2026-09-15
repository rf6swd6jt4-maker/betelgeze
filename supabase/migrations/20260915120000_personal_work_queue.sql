begin;
set local lock_timeout='5s';
set local statement_timeout='60s';

create index if not exists work_queue_open_owner_idx on work_items(workspace_id,execution_owner_id,id) where status not in ('done','canceled') and metadata->>'archived_at' is null;
create index if not exists work_queue_assignee_idx on work_item_assignees(workspace_id,user_id,work_item_id);
create index if not exists work_queue_dependency_reverse_idx on work_item_dependencies(workspace_id,depends_on_work_item_id,work_item_id);
create index if not exists work_queue_instance_item_idx on service_instance_work_items(workspace_id,work_item_id,instance_id);

create table public.work_queue_assessments (
 work_item_id uuid primary key references work_items(id) on delete cascade,
 workspace_id uuid not null references workspaces(id) on delete cascade,
 revision bigint not null default 1,
 status text not null default 'queued' check(status in ('queued','running','ready','failed')),
 requested_at timestamptz not null default now(),
 lease_token uuid, lease_until timestamptz, claimed_revision bigint,
 fingerprint text, assessment jsonb, assessed_at timestamptz,
 model text, policy_version text, error_summary text
);
create index work_queue_pending_idx on work_queue_assessments(requested_at,work_item_id) where status='queued';
create index work_queue_expired_idx on work_queue_assessments(lease_until) where status='running';
create table public.work_queue_ai_usage (
 id uuid primary key, workspace_id uuid not null references workspaces(id) on delete cascade,
 work_item_id uuid references work_items(id) on delete set null,
 model text not null, created_at timestamptz not null default now(),
 status text not null check(status in ('dispatched','received','unknown')),
 input_tokens integer, output_tokens integer, cost_usd numeric
);
create table public.work_queue_completion_followups (
 work_item_id uuid primary key references work_items(id) on delete cascade,
 workspace_id uuid not null references workspaces(id) on delete cascade,
 requested_at timestamptz not null default now(), attempts integer not null default 0,
 lease_token uuid, lease_until timestamptz, completed_at timestamptz, error_summary text
);
alter table public.work_queue_completion_followups enable row level security;
revoke all on work_queue_completion_followups from anon,authenticated;
grant all on work_queue_completion_followups to service_role;
create index queue_completion_pending_idx on work_queue_completion_followups(requested_at) where completed_at is null;
create index work_queue_usage_day_idx on work_queue_ai_usage(workspace_id,created_at);
alter table public.work_queue_assessments enable row level security;
alter table public.work_queue_ai_usage enable row level security;
revoke all on work_queue_assessments,work_queue_ai_usage from anon,authenticated;
grant all on work_queue_assessments,work_queue_ai_usage to service_role;

-- Ownership is narrower than visibility. Explicit work owners/assignees win over service defaults.
create function public.personal_queue_owns(p_workspace uuid,p_item uuid,p_user uuid) returns boolean
language sql stable security definer set search_path=public as $$
 select exists(select 1 from work_items w where w.workspace_id=p_workspace and w.id=p_item
 and public.workspace_user_can_access_work_item(p_workspace,p_item,p_user)
 and (w.execution_owner_id=p_user or (w.execution_owner_id is null and (
 exists(select 1 from work_item_assignees a where a.workspace_id=p_workspace and a.work_item_id=w.id and a.user_id=p_user)
 or (not exists(select 1 from work_item_assignees a where a.workspace_id=p_workspace and a.work_item_id=w.id) and (
 exists(select 1 from service_instance_work_items l join relationship_service_instances i on i.workspace_id=l.workspace_id and i.id=l.instance_id where l.workspace_id=p_workspace and l.work_item_id=w.id and i.assignee_user_id=p_user)
 or (not exists(select 1 from service_instance_work_items l where l.workspace_id=p_workspace and l.work_item_id=w.id) and exists(select 1 from work_item_relationships l join relationship_services s on s.workspace_id=l.workspace_id and s.relationship_id=l.relationship_id and s.service_id=w.service_id where l.workspace_id=p_workspace and l.work_item_id=w.id and s.assignee_user_id=p_user))
 ))))))
$$;
create function public.queue_work_open(p_item work_items) returns boolean language sql immutable as $$
 select p_item.status not in ('done','canceled') and p_item.metadata->>'archived_at' is null
 and p_item.completion_mode='manual' and p_item.workflow_role not in ('lifecycle_stage','service_group')
 and p_item.workflow_action is null and coalesce(p_item.native_kind,'') <> 'onboarding_step'
$$;
create function public.queue_enqueue(p_workspace uuid,p_item uuid) returns void language sql security definer set search_path=public as $$
 insert into work_queue_assessments(workspace_id,work_item_id)
 select workspace_id,id from work_items w where workspace_id=p_workspace and id=p_item and public.queue_work_open(w)
 on conflict(work_item_id) do update set revision=work_queue_assessments.revision+1,
 status=case when work_queue_assessments.status='running' then 'running' else 'queued' end,requested_at=now(),error_summary=null
$$;
create function public.queue_item_changed() returns trigger language plpgsql security definer set search_path=public as $$
begin
 perform queue_enqueue(new.workspace_id,new.id);
 -- Direct neighbours are the bounded context used by the assessor. No recursive fan-out on writes.
 perform queue_enqueue(new.workspace_id,d.work_item_id) from work_item_dependencies d where d.workspace_id=new.workspace_id and d.depends_on_work_item_id=new.id;
 perform queue_enqueue(new.workspace_id,d.depends_on_work_item_id) from work_item_dependencies d where d.workspace_id=new.workspace_id and d.work_item_id=new.id;
 perform queue_enqueue(new.workspace_id,w.id) from work_items w where w.workspace_id=new.workspace_id and w.parent_work_item_id=new.id and public.queue_work_open(w);
 if tg_op='INSERT' or row(old.title,old.description,old.parent_work_item_id,old.visibility,old.area,old.service_id) is distinct from row(new.title,new.description,new.parent_work_item_id,new.visibility,new.area,new.service_id) then
  perform queue_enqueue(new.workspace_id,p.id) from work_items p where p.workspace_id=new.workspace_id and p.parent_work_item_id=new.parent_work_item_id and p.id<>new.id and queue_work_open(p);
 end if;
 if tg_op='UPDATE' and row(old.visibility,old.area,old.service_id) is distinct from row(new.visibility,new.area,new.service_id) then
  update work_queue_assessments set assessment=null,fingerprint=null where work_item_id=new.id or work_item_id in (
   select work_item_id from work_item_dependencies where workspace_id=new.workspace_id and depends_on_work_item_id=new.id
   union select depends_on_work_item_id from work_item_dependencies where workspace_id=new.workspace_id and work_item_id=new.id
   union select id from work_items where workspace_id=new.workspace_id and (parent_work_item_id=new.id or parent_work_item_id=new.parent_work_item_id));
 end if;
 return new;
end $$;
create trigger queue_item_insert after insert on work_items for each row execute function queue_item_changed();
create trigger queue_item_update after update of title,description,instructions,status,due_date,due_time,planned_start_date,planned_start_time,metadata,parent_work_item_id,visibility,area,service_id on work_items for each row
 when (row(old.title,old.description,old.instructions,old.status,old.due_date,old.due_time,old.planned_start_date,old.planned_start_time,old.metadata,old.parent_work_item_id,old.visibility,old.area,old.service_id) is distinct from row(new.title,new.description,new.instructions,new.status,new.due_date,new.due_time,new.planned_start_date,new.planned_start_time,new.metadata,new.parent_work_item_id,new.visibility,new.area,new.service_id)) execute function queue_item_changed();
create function public.queue_edge_changed() returns trigger language plpgsql security definer set search_path=public as $$
begin
 if tg_op<>'INSERT' then perform queue_enqueue(old.workspace_id,old.work_item_id); perform queue_enqueue(old.workspace_id,old.depends_on_work_item_id); end if;
 if tg_op<>'DELETE' then perform queue_enqueue(new.workspace_id,new.work_item_id); perform queue_enqueue(new.workspace_id,new.depends_on_work_item_id); end if;
 return null;
end $$;
create trigger queue_edge_update after insert or update or delete on work_item_dependencies for each row execute function queue_edge_changed();

-- Context must share the same client scope. Visibility/service equality alone is not enough.
create function public.queue_context_compatible(p_target work_items,p_source work_items) returns boolean
language sql stable security definer set search_path=public as $$
 select p_source.workspace_id=p_target.workspace_id and p_source.visibility=p_target.visibility
 and p_source.area=p_target.area and p_source.service_id is not distinct from p_target.service_id
 and array(select relationship_id from work_item_relationships where workspace_id=p_target.workspace_id and work_item_id=p_target.id order by relationship_id)
 = array(select relationship_id from work_item_relationships where workspace_id=p_source.workspace_id and work_item_id=p_source.id order by relationship_id)
$$;

create function public.queue_assessment_context(p_workspace uuid,p_item uuid) returns jsonb language sql stable security definer set search_path=public as $$
 select jsonb_build_object('item',jsonb_build_object('title',w.title,'goal',left(w.description,3000),'instructions',left(w.instructions,18000),'due_date',w.due_date,'kind',w.kind),
 'parent',(select jsonb_build_object('title',p.title,'goal',left(p.description,2000)) from work_items p where p.workspace_id=w.workspace_id and p.id=w.parent_work_item_id and queue_context_compatible(w,p)),
 'prerequisites',coalesce((select jsonb_agg(to_jsonb(q)) from (select p.title,p.status,left(p.description,800) goal from work_item_dependencies d join work_items p on p.workspace_id=d.workspace_id and p.id=d.depends_on_work_item_id where d.workspace_id=w.workspace_id and d.work_item_id=w.id and queue_context_compatible(w,p) order by p.id limit 12) q),'[]'),
 'downstream',coalesce((select jsonb_agg(to_jsonb(q)) from (select p.title,p.status,p.due_date,left(p.description,1000) goal,left(p.instructions,1200) instructions from work_item_dependencies d join work_items p on p.workspace_id=d.workspace_id and p.id=d.work_item_id where d.workspace_id=w.workspace_id and d.depends_on_work_item_id=w.id and queue_context_compatible(w,p) order by p.due_date nulls last,p.id limit 12) q),'[]'),
 'related_work',coalesce((select jsonb_agg(to_jsonb(q)) from (select p.title,left(p.description,800) goal from work_items p where p.workspace_id=w.workspace_id and p.parent_work_item_id=w.parent_work_item_id and p.id<>w.id and queue_context_compatible(w,p) order by p.sort_order,p.created_at,p.id limit 10) q),'[]'),
 'downstream_count',(select count(*) from work_item_dependencies d where d.workspace_id=w.workspace_id and d.depends_on_work_item_id=w.id),
 'relationships',coalesce((select jsonb_agg(to_jsonb(q)) from (select r.primary_person_name,r.business_name,left(r.notes_summary,3000) notes from work_item_relationships l join relationships r on r.workspace_id=l.workspace_id and r.id=l.relationship_id where l.workspace_id=w.workspace_id and l.work_item_id=w.id and (select count(*) from work_item_relationships scope where scope.workspace_id=w.workspace_id and scope.work_item_id=w.id)=1 order by r.id limit 3) q),'[]'))
 from work_items w where w.workspace_id=p_workspace and w.id=p_item and queue_work_open(w)
$$;

create function public.claim_queue_assessment(p_model text,p_policy text,p_daily_limit integer) returns setof work_queue_assessments language plpgsql security definer set search_path=public as $$
declare candidate work_queue_assessments;
begin
 if p_daily_limit not between 1 and 5000 then raise exception 'Invalid daily limit'; end if;
 update work_queue_assessments set status='failed',error_summary='Assessment interrupted. A later source change will queue a new assessment.',lease_token=null,lease_until=null where work_item_id in(select work_item_id from work_queue_assessments where status='running' and lease_until<now() order by lease_until limit 20 for update skip locked);
 select a.* into candidate from work_queue_assessments a join work_items w on w.id=a.work_item_id and w.workspace_id=a.workspace_id where a.status='queued' and queue_work_open(w)
 and (select count(*) from work_queue_ai_usage u where u.workspace_id=a.workspace_id and u.created_at>=date_trunc('day',now()))<p_daily_limit
 order by case when w.status='doing' then 0 when w.status='todo' and (w.planned_start_date is null or w.planned_start_date<=current_date) then 1 else 2 end,w.due_date nulls last,a.requested_at,a.work_item_id limit 1 for update of a skip locked;
 if not found then return; end if;
 -- Serialize quota reservation across workers in a workspace.
 perform pg_advisory_xact_lock(hashtextextended(candidate.workspace_id::text,120));
 if (select count(*) from work_queue_ai_usage where workspace_id=candidate.workspace_id and created_at>=date_trunc('day',now()))>=p_daily_limit then return; end if;
 update work_queue_assessments set status='running',lease_token=gen_random_uuid(),lease_until=now()+interval '3 minutes',claimed_revision=revision,model=p_model,policy_version=p_policy where work_item_id=candidate.work_item_id returning * into candidate;
 insert into work_queue_ai_usage(id,workspace_id,work_item_id,model,status) values(candidate.lease_token,candidate.workspace_id,candidate.work_item_id,p_model,'dispatched');
 return next candidate;
end $$;
create function public.finish_queue_assessment(p_item uuid,p_lease uuid,p_fingerprint text,p_assessment jsonb,p_error text default null) returns boolean language plpgsql security definer set search_path=public as $$
begin
 update work_queue_assessments set status=case when revision<>claimed_revision then 'queued' when p_error is not null then 'failed' else 'ready' end,
 assessment=case when revision=claimed_revision and p_error is null then p_assessment else assessment end,
 fingerprint=case when revision=claimed_revision and p_error is null then p_fingerprint else fingerprint end,
 assessed_at=case when revision=claimed_revision and p_error is null then now() else assessed_at end,
 error_summary=left(p_error,300),lease_token=null,lease_until=null
 where work_item_id=p_item and lease_token=p_lease and status='running' and lease_until>now();
 return found;
end $$;

-- All rows are server-authorized before returning even a title. Ranking scans only open work.
create function public.read_personal_work_queue(p_workspace uuid,p_user uuid,p_offset integer default 0,p_view text default 'all') returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare result jsonb;
begin
 if not exists(select 1 from workspace_memberships where workspace_id=p_workspace and user_id=p_user) then raise exception 'Workspace membership required'; end if;
 if p_offset<0 or p_offset>10000 or p_view not in ('all','ready','deferred') then raise exception 'Invalid page'; end if;
 with candidates as materialized (
 select w.id,w.title,left(w.description,1000) description,w.status,w.created_at,w.updated_at,w.actual_start_at,w.priority_override,
 case when w.due_date is not null then (w.due_date+coalesce(w.due_time,time '23:59:59')) at time zone 'UTC' end due_at,
 case when w.planned_start_date is not null then (w.planned_start_date+coalesce(w.planned_start_time,time '00:00')) at time zone 'UTC' end planned_at,
 exists(select 1 from work_item_dependencies d left join work_items p on p.workspace_id=d.workspace_id and p.id=d.depends_on_work_item_id where d.workspace_id=p_workspace and d.work_item_id=w.id and (p.id is null or p.status<>'done')) blocked,
 exists(select 1 from service_instance_work_items l join relationship_service_instances i on i.workspace_id=l.workspace_id and i.id=l.instance_id where l.workspace_id=p_workspace and l.work_item_id=w.id and (i.disposition<>'active' or i.stage is null or i.stage in ('for_later','completed','declined'))) paused,
 (select coalesce(r.business_name,r.primary_person_name) from work_item_relationships l join relationships r on r.workspace_id=l.workspace_id and r.id=l.relationship_id where l.workspace_id=p_workspace and l.work_item_id=w.id and workspace_user_can_access_relationship(p_workspace,r.id,p_user) order by r.id limit 1) relationship,
 (select coalesce(v.name,i.service_key) from service_instance_work_items l join relationship_service_instances i on i.workspace_id=l.workspace_id and i.id=l.instance_id left join onboarding_service_revisions v on v.workspace_id=i.workspace_id and v.id=i.service_revision_id where l.workspace_id=p_workspace and l.work_item_id=w.id order by i.id limit 1) service,
 a.assessment,a.status assessment_status,a.assessed_at
 from work_items w left join work_queue_assessments a on a.work_item_id=w.id and a.workspace_id=w.workspace_id
 where w.workspace_id=p_workspace and queue_work_open(w) and personal_queue_owns(p_workspace,w.id,p_user)
 and not exists(select 1 from work_item_relationships l join relationships r on r.workspace_id=l.workspace_id and r.id=l.relationship_id where l.workspace_id=p_workspace and l.work_item_id=w.id and r.status='archived')
 ), scored as (
 select *,case when paused or blocked or status in ('blocked','waiting') or (status<>'doing' and planned_at>now()) then 2 when status='doing' then 0 else 1 end band,
 coalesce((assessment->>'impact')::numeric,40)*.55+coalesce((assessment->>'urgency')::numeric,30)*.25+
 case when extract(epoch from (due_at-now()))/3600-coalesce((assessment->>'effort_minutes')::numeric,60)/60<=0 then 100 when extract(epoch from (due_at-now()))/3600-coalesce((assessment->>'effort_minutes')::numeric,60)/60<24 then 75 when extract(epoch from (due_at-now()))/3600-coalesce((assessment->>'effort_minutes')::numeric,60)/60<72 then 35 else 0 end+
 least(20,greatest(0,extract(epoch from(now()-created_at))/86400))+greatest(0,10-coalesce((assessment->>'effort_minutes')::numeric,60)/60) score from candidates
 ), page as (
 select * from scored where p_view='all' or (p_view='ready' and band<2) or (p_view='deferred' and band=2) order by band,case when band=0 then actual_start_at end nulls last,coalesce(priority_override,3),score desc,created_at,id limit 31 offset p_offset
 ) select jsonb_build_object('items',coalesce((select jsonb_agg(to_jsonb(page)) from page),'[]'),'hasMore',(select count(*)>30 from page),
 'ready',(select count(*) from scored where band<2),'deferred',(select count(*) from scored where band=2),'assessed',(select count(*) from scored where assessment is not null),'total',(select count(*) from scored)) into result;
 return result;
end $$;

create function public.personal_queue_command(p_workspace uuid,p_user uuid,p_item uuid,p_action text,p_version timestamptz) returns jsonb
language plpgsql security definer set search_path=public as $$
declare w work_items;
begin
 -- One running task per user across simultaneous tabs. Existing work remains stable.
 perform pg_advisory_xact_lock(hashtextextended(p_workspace::text||p_user::text,121));
 select * into w from work_items where workspace_id=p_workspace and id=p_item for update;
 if not found or not queue_work_open(w) or not personal_queue_owns(p_workspace,p_item,p_user) then raise exception 'This work is not available to you'; end if;
 if p_action not in ('start','pause','complete') then raise exception 'Invalid queue action'; end if;
 if w.updated_at is distinct from p_version then raise exception 'This work changed. Refresh before continuing'; end if;
 if p_action='pause' and w.status<>'doing' then raise exception 'Only started work can be paused'; end if;
 if p_action in ('start','complete') then
  if w.status not in ('todo','doing') then raise exception 'This work is not ready'; end if;
  perform 1 from work_item_dependencies d join work_items p on p.id=d.depends_on_work_item_id and p.workspace_id=d.workspace_id where d.workspace_id=p_workspace and d.work_item_id=p_item for share of p;
  if exists(select 1 from work_item_dependencies d left join work_items p on p.id=d.depends_on_work_item_id and p.workspace_id=d.workspace_id where d.workspace_id=p_workspace and d.work_item_id=p_item and (p.id is null or p.status<>'done')) then raise exception 'Complete the prerequisites first'; end if;
  perform 1 from service_instance_work_items l join relationship_service_instances i on i.workspace_id=l.workspace_id and i.id=l.instance_id where l.workspace_id=p_workspace and l.work_item_id=p_item for share of i;
  if exists(select 1 from service_instance_work_items l join relationship_service_instances i on i.workspace_id=l.workspace_id and i.id=l.instance_id where l.workspace_id=p_workspace and l.work_item_id=p_item and (i.disposition<>'active' or i.stage is null or i.stage in ('for_later','completed','declined'))) then raise exception 'This service is not active'; end if;
  if exists(select 1 from work_item_relationships l join relationships r on r.workspace_id=l.workspace_id and r.id=l.relationship_id where l.workspace_id=p_workspace and l.work_item_id=p_item and r.status='archived') then raise exception 'This relationship is archived'; end if;
  if p_action='start' and w.status<>'doing' and w.planned_start_date+coalesce(w.planned_start_time,time '00:00')>now() at time zone 'UTC' then raise exception 'This work is scheduled for later'; end if;
 end if;
 if p_action='start' and exists(select 1 from work_items other where other.workspace_id=p_workspace and other.id<>p_item and other.status='doing' and queue_work_open(other) and personal_queue_owns(p_workspace,other.id,p_user)) then raise exception 'Pause your current task before starting another'; end if;
 if p_action='complete' and w.status<>'doing' then raise exception 'Start this work before completing it'; end if;
 update work_items set status=case p_action when 'start' then 'doing' when 'pause' then 'todo' else 'done' end,updated_at=clock_timestamp() where workspace_id=p_workspace and id=p_item returning * into w;
 if p_action='complete' then insert into work_queue_completion_followups(workspace_id,work_item_id) values(p_workspace,p_item) on conflict(work_item_id) do update set completed_at=null,attempts=0,requested_at=now(); end if;
 return jsonb_build_object('id',w.id,'status',w.status,'updated_at',w.updated_at,'actual_start_at',w.actual_start_at);
end $$;

create function public.claim_queue_completion() returns setof work_queue_completion_followups language sql security definer set search_path=public as $$
 with candidate as (select work_item_id from work_queue_completion_followups where completed_at is null and attempts<5 and (lease_until is null or lease_until<now()) order by requested_at limit 1 for update skip locked)
 update work_queue_completion_followups j set attempts=attempts+1,lease_token=gen_random_uuid(),lease_until=now()+interval '3 minutes' from candidate c where j.work_item_id=c.work_item_id returning j.*
$$;

-- Prepare existing work once. No model call or paid request runs in this migration.
insert into work_queue_assessments(workspace_id,work_item_id) select workspace_id,id from work_items w where queue_work_open(w);
-- Relevant context changes invalidate reusable assessments without running models on writes.
create function public.queue_relationship_changed() returns trigger language plpgsql security definer set search_path=public as $$
begin
 perform queue_enqueue(new.workspace_id,l.work_item_id) from work_item_relationships l where l.workspace_id=new.workspace_id and l.relationship_id=new.id;
 return new;
end $$;
create trigger queue_relationship_context after update of primary_person_name,business_name,notes_summary on relationships for each row
 when (row(old.primary_person_name,old.business_name,old.notes_summary) is distinct from row(new.primary_person_name,new.business_name,new.notes_summary)) execute function queue_relationship_changed();
create function public.queue_link_changed() returns trigger language plpgsql security definer set search_path=public as $$
begin
 if tg_op<>'INSERT' then
  perform queue_enqueue(old.workspace_id,old.work_item_id);
  update work_queue_assessments set assessment=null,fingerprint=null where work_item_id=old.work_item_id;
  perform queue_enqueue(old.workspace_id,d.work_item_id) from work_item_dependencies d where d.workspace_id=old.workspace_id and d.depends_on_work_item_id=old.work_item_id;
  perform queue_enqueue(old.workspace_id,d.depends_on_work_item_id) from work_item_dependencies d where d.workspace_id=old.workspace_id and d.work_item_id=old.work_item_id;
 end if;
 if tg_op<>'DELETE' then
  perform queue_enqueue(new.workspace_id,new.work_item_id);
  update work_queue_assessments set assessment=null,fingerprint=null where work_item_id=new.work_item_id;
  perform queue_enqueue(new.workspace_id,d.work_item_id) from work_item_dependencies d where d.workspace_id=new.workspace_id and d.depends_on_work_item_id=new.work_item_id;
  perform queue_enqueue(new.workspace_id,d.depends_on_work_item_id) from work_item_dependencies d where d.workspace_id=new.workspace_id and d.work_item_id=new.work_item_id;
 end if;
 return null;
end $$;
create trigger queue_relationship_link after insert or update or delete on work_item_relationships for each row execute function queue_link_changed();
-- All actor-taking helpers are service-only, matching the existing authorized read route.
do $$ declare f record; begin
 for f in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('personal_queue_owns','queue_work_open','queue_enqueue','queue_item_changed','queue_edge_changed','queue_assessment_context','queue_context_compatible','claim_queue_assessment','finish_queue_assessment','read_personal_work_queue','personal_queue_command','queue_relationship_changed','queue_link_changed','claim_queue_completion') loop
 execute format('revoke all on function %s from public,anon,authenticated',f.signature);
 execute format('grant execute on function %s to service_role',f.signature);
 end loop;
end $$;
notify pgrst,'reload schema';
commit;
