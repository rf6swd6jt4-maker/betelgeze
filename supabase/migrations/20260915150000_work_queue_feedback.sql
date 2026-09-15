begin;
set local lock_timeout='5s';
set local statement_timeout='60s';
create table public.work_queue_preferences (
 workspace_id uuid not null references workspaces(id), user_id uuid not null,
 timezone text not null default 'Europe/Dublin',
 verbosity integer not null default 0 check(verbosity between -2 and 2), preference_votes integer not null default 0,
 updated_at timestamptz not null default now(), primary key(workspace_id,user_id),
 foreign key(workspace_id,user_id) references workspace_memberships(workspace_id,user_id) on delete cascade
);
create table public.work_queue_plans (
 workspace_id uuid not null references workspaces(id), user_id uuid not null, work_item_id uuid not null references work_items(id) on delete cascade,
 effort_minutes integer not null, horizon text not null check(horizon in ('now','today','tomorrow','week')), anchor_day date not null, target_day date not null, conflict boolean not null default false,
 reason text not null, calculated_at timestamptz not null default now(), primary key(workspace_id,user_id,work_item_id)
);
create table public.work_queue_feedback_jobs (
 id uuid primary key default gen_random_uuid(),workspace_id uuid not null references workspaces(id),kind text not null check(kind in ('schedule','dispute','notify')),
 entity_id uuid not null, revision bigint not null default 1,claimed_revision bigint,requested_at timestamptz not null default now(),
 status text not null default 'queued' check(status in ('queued','running','done','failed')),lease_token uuid,lease_until timestamptz,attempts integer not null default 0,error text,
 unique(workspace_id,kind,entity_id)
);
create index queue_feedback_jobs_pending on work_queue_feedback_jobs(requested_at) where status in ('queued','running');
create table public.work_queue_disputes (
 id uuid primary key default gen_random_uuid(),workspace_id uuid not null references workspaces(id),work_item_id uuid not null references work_items(id),
 user_id uuid not null,resolver_id uuid not null,request_id uuid not null,relationship_id uuid,conversation_id uuid,message_id uuid,
 reason text not null,note text not null default '',blocking boolean not null, snapshot jsonb not null,
 status text not null default 'open' check(status in ('open','resolved')),assessment jsonb,assessment_at timestamptz,
 resolution text,resolved_by uuid,resolved_at timestamptz,approved boolean not null default false,created_at timestamptz not null default now(),
 unique(workspace_id,user_id,request_id)
);
create unique index queue_one_open_dispute on work_queue_disputes(workspace_id,work_item_id) where status='open';
create index queue_dispute_resolver on work_queue_disputes(workspace_id,resolver_id,status,created_at);
create table public.work_queue_effort_runs (
 id uuid primary key default gen_random_uuid(),workspace_id uuid not null references workspaces(id),work_item_id uuid not null references work_items(id),user_id uuid not null,
 bucket text not null,source_fingerprint text not null,base_minutes integer,estimate_minutes integer,horizon text,target_day date,
 started_at timestamptz not null default now(),active_since timestamptz,active_seconds numeric not null default 0,
 completed_at timestamptz,met_target boolean,valid_sample boolean not null default true,exclusion text,corrected_minutes integer,learning_applied boolean not null default false
);
create unique index queue_active_run on work_queue_effort_runs(workspace_id,work_item_id) where completed_at is null;
create index queue_effort_samples on work_queue_effort_runs(workspace_id,user_id,bucket,completed_at desc) where completed_at is not null and valid_sample;
create index queue_effort_unapplied on work_queue_effort_runs(workspace_id,user_id,bucket) where completed_at is not null and valid_sample and not learning_applied;
create table public.work_queue_calibration (
 workspace_id uuid not null,user_id uuid not null,bucket text not null,factor numeric not null default 1 check(factor between .5 and 2),sample_count integer not null default 0,
 updated_at timestamptz not null default now(),primary key(workspace_id,user_id,bucket)
);
-- Only server endpoints may select an actor; ordinary DB roles cannot bypass authorization.
alter table public.work_queue_preferences enable row level security;
revoke all on public.work_queue_preferences from public,anon,authenticated;
grant all on public.work_queue_preferences to service_role;
alter table public.work_queue_plans enable row level security;
revoke all on public.work_queue_plans from public,anon,authenticated;
grant all on public.work_queue_plans to service_role;
alter table public.work_queue_feedback_jobs enable row level security;
revoke all on public.work_queue_feedback_jobs from public,anon,authenticated;
grant all on public.work_queue_feedback_jobs to service_role;
alter table public.work_queue_disputes enable row level security;
revoke all on public.work_queue_disputes from public,anon,authenticated;
grant all on public.work_queue_disputes to service_role;
alter table public.work_queue_effort_runs enable row level security;
revoke all on public.work_queue_effort_runs from public,anon,authenticated;
grant all on public.work_queue_effort_runs to service_role;
alter table public.work_queue_calibration enable row level security;
revoke all on public.work_queue_calibration from public,anon,authenticated;
grant all on public.work_queue_calibration to service_role;
create function public.queue_feedback_enqueue(p_workspace uuid,p_kind text,p_entity uuid) returns void language sql security definer set search_path=public as $$
 insert into work_queue_feedback_jobs(workspace_id,kind,entity_id) values(p_workspace,p_kind,p_entity)
 on conflict(workspace_id,kind,entity_id) do update set revision=work_queue_feedback_jobs.revision+1,requested_at=now(),attempts=0,error=null,status=case when work_queue_feedback_jobs.status='running' then 'running' else 'queued' end
$$;
create function public.queue_schedule_item(p_workspace uuid,p_item uuid) returns void language sql security definer set search_path=public as $$
 select queue_feedback_enqueue(p_workspace,'schedule',u) from (
 select execution_owner_id u from work_items where workspace_id=p_workspace and id=p_item and execution_owner_id is not null
 union select user_id from work_item_assignees where workspace_id=p_workspace and work_item_id=p_item
 union select i.assignee_user_id from service_instance_work_items l join relationship_service_instances i on i.id=l.instance_id and i.workspace_id=l.workspace_id where l.workspace_id=p_workspace and l.work_item_id=p_item and i.assignee_user_id is not null
 union select s.assignee_user_id from work_item_relationships l join work_items w on w.id=l.work_item_id join relationship_services s on s.workspace_id=l.workspace_id and s.relationship_id=l.relationship_id and s.service_id=w.service_id where l.workspace_id=p_workspace and l.work_item_id=p_item and s.assignee_user_id is not null
 union select user_id from work_queue_plans where workspace_id=p_workspace and work_item_id=p_item
 ) q where exists(select 1 from workspace_memberships where workspace_id=p_workspace and user_id=u)
$$;
create function public.queue_schedule_changed() returns trigger language plpgsql security definer set search_path=public as $$
begin
 if tg_table_name='work_items' then perform queue_schedule_item(new.workspace_id,new.id);
 elsif tg_table_name='work_queue_assessments' then perform queue_schedule_item(new.workspace_id,new.work_item_id);
 elsif tg_table_name='relationship_service_instances' then
  if old.assignee_user_id is not null then perform queue_feedback_enqueue(old.workspace_id,'schedule',old.assignee_user_id);end if;
  if new.assignee_user_id is not null then perform queue_feedback_enqueue(new.workspace_id,'schedule',new.assignee_user_id);end if;
 else
  if tg_op<>'INSERT' then perform queue_schedule_item(old.workspace_id,old.work_item_id);end if;
  if tg_op<>'DELETE' then perform queue_schedule_item(new.workspace_id,new.work_item_id);end if;
 end if;return null;
end $$;
create trigger queue_schedule_work after insert or update of status,due_date,due_time,planned_start_date,planned_start_time,execution_owner_id,instructions,metadata on work_items for each row execute function queue_schedule_changed();
create trigger queue_schedule_assessment after update of assessment on work_queue_assessments for each row when(old.assessment is distinct from new.assessment) execute function queue_schedule_changed();
create trigger queue_schedule_assignment after insert or update or delete on work_item_assignees for each row execute function queue_schedule_changed();
create trigger queue_schedule_instance after update of assignee_user_id,disposition,stage on relationship_service_instances for each row execute function queue_schedule_changed();
create trigger queue_schedule_edge after insert or update or delete on work_item_dependencies for each row execute function queue_schedule_changed();
create trigger queue_schedule_link after insert or update or delete on service_instance_work_items for each row execute function queue_schedule_changed();

create function public.queue_feedback_can_review(p_workspace uuid,p_dispute uuid,p_user uuid) returns boolean language sql stable security definer set search_path=public as $$
 select exists(select 1 from work_queue_disputes d join workspace_memberships m on m.workspace_id=d.workspace_id and m.user_id=p_user
 where d.workspace_id=p_workspace and d.id=p_dispute and (m.role in ('owner','admin') or d.resolver_id=p_user)
 and workspace_user_can_access_work_item(p_workspace,d.work_item_id,p_user))
$$;
create function public.submit_queue_dispute(p_workspace uuid,p_user uuid,p_item uuid,p_version timestamptz,p_request uuid,p_reason text,p_note text) returns jsonb language plpgsql security definer set search_path=public as $$
declare w work_items; d work_queue_disputes;r uuid;manager uuid;conv uuid;team_name text;slug text;is_blocking boolean;
begin
 perform pg_advisory_xact_lock(hashtextextended(p_workspace::text||p_user::text,121));
 select * into w from work_items where workspace_id=p_workspace and id=p_item for update;
 if not found or not personal_queue_owns(p_workspace,p_item,p_user) then raise exception 'This work is not available to you';end if;
 select * into d from work_queue_disputes where workspace_id=p_workspace and user_id=p_user and request_id=p_request;
 if found then if d.work_item_id<>p_item or d.reason<>p_reason or d.note<>btrim(p_note) then raise exception 'Request already used';end if;return jsonb_build_object('id',d.id,'status',d.status,'conversationId',d.conversation_id);end if;
 if not queue_work_open(w) or w.updated_at is distinct from p_version then raise exception 'This work changed. Refresh before disputing';end if;
 if p_reason not in ('Missing client information','Missing access, permission or asset','Another task must happen first','Instructions are unclear or incomplete','Instructions contradict the SOP','Does not apply to this client','Already completed or duplicated','Assigned to the wrong person','Estimate seems unrealistic','Too detailed','Too brief','Other') or p_note is null or length(p_note)>3000 or (p_reason='Other' and btrim(p_note)='') then raise exception 'Choose a reason and provide required details';end if;
 if exists(select 1 from work_queue_disputes where workspace_id=p_workspace and work_item_id=p_item and status='open') then raise exception 'This work already has an open dispute';end if;
 select case when count(*)=1 then min(relationship_id::text)::uuid end into r from work_item_relationships where workspace_id=p_workspace and work_item_id=p_item;
 if r is not null and w.visibility='workspace' and w.area<>'admin' then
  select rel.fulfilment_manager_user_id,c.id,t.name into manager,conv,team_name from relationships rel join workspace_teams t on t.workspace_id=rel.workspace_id and t.relationship_id=rel.id and t.archived_at is null join workspace_native_conversations c on c.workspace_id=t.workspace_id and c.team_id=t.id and c.kind='team' and c.archived_at is null where rel.workspace_id=p_workspace and rel.id=r;
 end if;
 -- Incomplete routing goes only to the private Admin team, with an accountable owner.
 if manager is null or conv is null or not exists(select 1 from workspace_memberships where workspace_id=p_workspace and user_id=manager) then
  select m.user_id,c.id,t.name into manager,conv,team_name from workspace_memberships m join workspace_teams t on t.workspace_id=m.workspace_id and t.kind='admins' and t.archived_at is null join workspace_native_conversations c on c.workspace_id=t.workspace_id and c.team_id=t.id and c.archived_at is null where m.workspace_id=p_workspace and m.role in ('owner','admin') order by (m.role='owner') desc,m.user_id limit 1;
 end if;
 if manager is null or conv is null then raise exception 'No manager team is configured. Ask an administrator to configure it';end if;
 select workspaces.slug into slug from workspaces where id=p_workspace;
 is_blocking:=p_reason not in ('Too detailed','Too brief');
 insert into work_queue_disputes(workspace_id,work_item_id,user_id,resolver_id,request_id,relationship_id,conversation_id,reason,note,blocking,snapshot)
 values(p_workspace,p_item,p_user,manager,p_request,r,conv,p_reason,btrim(p_note),is_blocking,jsonb_build_object('title',w.title,'instructions',w.instructions,'description',w.description,'metadata',w.metadata,'version',w.updated_at,'status',w.status,'assessment',(select assessment from work_queue_assessments where work_item_id=p_item),'dependencies',(select coalesce(jsonb_agg(depends_on_work_item_id),'[]') from work_item_dependencies where workspace_id=p_workspace and work_item_id=p_item))) returning * into d;
 insert into workspace_native_messages(workspace_id,conversation_id,sender_user_id,client_request_id,body)
 values(p_workspace,conv,p_user,d.id,'Dispute in '||team_name||E'\n@[Manager](mention:'||manager::text||E')\n'||w.title||E'\nReason: '||p_reason||case when btrim(p_note)<>'' then E'\n'||btrim(p_note) else '' end||E'\nReview: /'||slug||'/queue/feedback?dispute='||d.id::text) returning id into d.message_id;
 update work_queue_disputes set message_id=d.message_id where id=d.id;
 update work_queue_effort_runs set valid_sample=false,exclusion='dispute' where workspace_id=p_workspace and work_item_id=p_item and completed_at is null;
 if is_blocking then update work_items set status='blocked',updated_at=clock_timestamp() where id=p_item;end if;
 perform queue_feedback_enqueue(p_workspace,'dispute',d.id);perform queue_feedback_enqueue(p_workspace,'notify',d.id);
 return jsonb_build_object('id',d.id,'status',d.status,'conversationId',conv,'blocking',is_blocking);
end $$;

create function public.resolve_queue_dispute(p_workspace uuid,p_user uuid,p_dispute uuid,p_resolution text,p_approved boolean) returns jsonb language plpgsql security definer set search_path=public as $$
declare d work_queue_disputes;v integer;
begin
 select * into d from work_queue_disputes where workspace_id=p_workspace and id=p_dispute for update;
 if not found or not queue_feedback_can_review(p_workspace,p_dispute,p_user) then raise exception 'This dispute is not available to you';end if;
 if d.status='resolved' then return jsonb_build_object('id',d.id,'status',d.status);end if;
 if p_resolution is null or length(btrim(p_resolution))<5 or length(p_resolution)>3000 then raise exception 'Explain the resolution';end if;
 update work_queue_disputes set status='resolved',resolution=btrim(p_resolution),approved=p_approved,resolved_by=p_user,resolved_at=now() where id=d.id;
 -- Resolution does not clear unrelated dependencies or change approved instructions.
 if d.blocking then update work_items set status='todo',updated_at=clock_timestamp() where workspace_id=p_workspace and id=d.work_item_id and status='blocked';end if;
 if p_approved and d.reason in ('Too detailed','Too brief') then
  insert into work_queue_preferences(workspace_id,user_id) values(p_workspace,d.user_id) on conflict do nothing;
  update work_queue_preferences set preference_votes=case when sign(preference_votes)=case when d.reason='Too brief' then 1 else -1 end then preference_votes else 0 end+case when d.reason='Too brief' then 1 else -1 end where workspace_id=p_workspace and user_id=d.user_id returning preference_votes into v;
  if abs(v)>=3 then update work_queue_preferences set verbosity=greatest(-2,least(2,verbosity+sign(v))),preference_votes=0,updated_at=now() where workspace_id=p_workspace and user_id=d.user_id;end if;
 end if;
 perform queue_schedule_item(p_workspace,d.work_item_id);
 return jsonb_build_object('id',d.id,'status','resolved');
end $$;

-- Track only actual started sessions; old elapsed timestamps are never backfilled as effort.
create function public.queue_capture_effort() returns trigger language plpgsql security definer set search_path=public as $$
declare run work_queue_effort_runs;seconds numeric;
begin
 select * into run from work_queue_effort_runs where workspace_id=new.workspace_id and work_item_id=new.id and completed_at is null for update;
 if not found then return null;end if;
 if new.status is distinct from old.status and old.status='doing' and run.active_since is not null then
  seconds:=greatest(0,extract(epoch from(clock_timestamp()-run.active_since)));
  update work_queue_effort_runs set active_seconds=active_seconds+seconds,active_since=null,valid_sample=valid_sample and seconds<=14400,exclusion=case when seconds>14400 then coalesce(exclusion,'timer') else exclusion end where id=run.id;
 end if;
 if new.status='doing' and old.status<>'doing' and current_setting('app.queue_actor',true) is distinct from run.user_id::text then update work_queue_effort_runs set valid_sample=false,exclusion='untracked_resume' where id=run.id;end if;
 if new.status='done' and old.status<>'done' then update work_queue_effort_runs set completed_at=clock_timestamp(),valid_sample=valid_sample and (active_seconds>=60 or corrected_minutes is not null),exclusion=case when active_seconds<60 and corrected_minutes is null then coalesce(exclusion,'timer') else exclusion end,met_target=case when target_day is null then null else (clock_timestamp() at time zone coalesce((select timezone from work_queue_preferences where workspace_id=new.workspace_id and user_id=run.user_id),'Europe/Dublin'))::date<=target_day end where id=run.id;
 elsif new.status='canceled' then update work_queue_effort_runs set completed_at=clock_timestamp(),valid_sample=false,exclusion='cancelled' where id=run.id;
 end if;
 if row(new.instructions,new.description,new.execution_owner_id) is distinct from row(old.instructions,old.description,old.execution_owner_id) then update work_queue_effort_runs set valid_sample=false,exclusion='source_change' where id=run.id;end if;
 return null;
end $$;
create trigger queue_capture_effort after update of status,instructions,description,execution_owner_id on work_items for each row execute function queue_capture_effort();
alter function public.personal_queue_command(uuid,uuid,uuid,text,timestamptz) rename to personal_queue_command_v1;
create function public.personal_queue_command(p_workspace uuid,p_user uuid,p_item uuid,p_action text,p_version timestamptz) returns jsonb language plpgsql security definer set search_path=public as $$
declare result jsonb;w work_items;run work_queue_effort_runs;
begin
 if p_action in ('start','complete') and exists(select 1 from work_queue_disputes where workspace_id=p_workspace and work_item_id=p_item and status='open' and blocking) then raise exception 'Resolve the open dispute first';end if;
 perform set_config('app.queue_actor',p_user::text,true);
 result:=personal_queue_command_v1(p_workspace,p_user,p_item,p_action,p_version);
 if p_action='start' then
  select * into w from work_items where id=p_item;
  select * into run from work_queue_effort_runs where workspace_id=p_workspace and work_item_id=p_item and completed_at is null;
  if run.id is null then
   insert into work_queue_effort_runs(workspace_id,work_item_id,user_id,bucket,source_fingerprint,base_minutes,estimate_minutes,horizon,target_day,active_since)
   select p_workspace,p_item,p_user,coalesce(w.service_id::text,'internal')||':'||coalesce(w.kind,'task'),md5(coalesce(w.instructions,'')||coalesce(w.description,'')),(a.assessment->>'effort_minutes')::integer,coalesce(p.effort_minutes,(a.assessment->>'effort_minutes')::integer),p.horizon,p.target_day,clock_timestamp() from (select 1) x left join work_queue_assessments a on a.work_item_id=p_item left join work_queue_plans p on p.workspace_id=p_workspace and p.work_item_id=p_item and p.user_id=p_user;
  else update work_queue_effort_runs set active_since=coalesce(active_since,clock_timestamp()),valid_sample=valid_sample and user_id=p_user,exclusion=case when user_id<>p_user then 'assignee_change' else exclusion end where id=run.id;end if;
 end if;return result;
end $$;

create function public.claim_queue_feedback_job(p_kind text,p_daily_limit integer default 500) returns setof work_queue_feedback_jobs language plpgsql security definer set search_path=public as $$
declare j work_queue_feedback_jobs;
begin
 select * into j from work_queue_feedback_jobs where kind=p_kind and (status='queued' or(status='running' and lease_until<now())) and attempts<5 order by requested_at limit 1 for update skip locked;
 if not found then return;end if;
 if p_kind='dispute' then
  perform pg_advisory_xact_lock(hashtextextended(j.workspace_id::text,120));
  if (select count(*) from work_queue_ai_usage where workspace_id=j.workspace_id and created_at>=date_trunc('day',now() at time zone 'UTC') at time zone 'UTC')>=least(5000,greatest(1,p_daily_limit)) then return;end if;
  -- An expired AI dispatch is uncertain, and must not create another paid retry.
  if j.status='running' then update work_queue_feedback_jobs set status='failed',error='Assessment could not be confirmed; manager review remains available' where id=j.id;return;end if;
 end if;
 update work_queue_feedback_jobs set status='running',lease_token=gen_random_uuid(),lease_until=now()+interval '5 minutes',claimed_revision=revision,attempts=attempts+1 where id=j.id returning * into j;
 if p_kind='dispute' then insert into work_queue_ai_usage(id,workspace_id,work_item_id,model,status) select j.lease_token,j.workspace_id,work_item_id,'gpt-5.4-mini','dispatched' from work_queue_disputes where id=j.entity_id;end if;
 return next j;
end $$;
create function public.finish_queue_feedback_job(p_job uuid,p_lease uuid,p_error text default null) returns boolean language plpgsql security definer set search_path=public as $$
begin
 update work_queue_feedback_jobs set status=case when revision<>claimed_revision then 'queued' when p_error is null then 'done' when kind<>'dispute' and attempts<5 then 'queued' else 'failed' end,error=p_error,lease_token=null,lease_until=null where id=p_job and lease_token=p_lease;
 return found;
end $$;
create function public.queue_schedule_context(p_workspace uuid,p_user uuid) returns jsonb language sql stable security definer set search_path=public as $$
 select jsonb_build_object('timezone',coalesce((select timezone from work_queue_preferences where workspace_id=p_workspace and user_id=p_user),'Europe/Dublin'),
 'tasks',coalesce((select jsonb_agg(to_jsonb(q)) from (
 select w.id,w.status,coalesce((a.assessment->>'effort_minutes')::integer,60) effort,coalesce(c.factor,1) factor,coalesce(a.assessment->>'horizon','week') horizon,p.anchor_day,p.horizon old_horizon,
 not exists(select 1 from work_item_dependencies d left join work_items b on b.id=d.depends_on_work_item_id and b.workspace_id=d.workspace_id where d.workspace_id=p_workspace and d.work_item_id=w.id and (b.id is null or b.status<>'done'))
 and not exists(select 1 from service_instance_work_items l join relationship_service_instances i on i.id=l.instance_id and i.workspace_id=l.workspace_id where l.workspace_id=p_workspace and l.work_item_id=w.id and (i.disposition<>'active' or i.stage is null or i.stage in ('for_later','completed','declined')))
 and w.status in ('todo','doing') and (w.planned_start_date is null or w.planned_start_date<=current_date) ready
 from work_items w left join work_queue_assessments a on a.work_item_id=w.id
 left join work_queue_plans p on p.workspace_id=w.workspace_id and p.user_id=p_user and p.work_item_id=w.id
 left join work_queue_calibration c on c.workspace_id=w.workspace_id and c.user_id=p_user and c.bucket=coalesce(w.service_id::text,'internal')||':'||coalesce(w.kind,'task')
 where w.workspace_id=p_workspace and queue_work_open(w) and personal_queue_owns(p_workspace,w.id,p_user) order by w.id limit 1001) q),'[]'))
$$;
create function public.publish_queue_schedule(p_job uuid,p_lease uuid,p_plans jsonb) returns boolean language plpgsql security definer set search_path=public as $$
declare j work_queue_feedback_jobs;
begin
 select * into j from work_queue_feedback_jobs where id=p_job and lease_token=p_lease and kind='schedule' for update;
 if not found or j.revision<>j.claimed_revision then return false;end if;
 if jsonb_array_length(p_plans)>1000 then raise exception 'Queue summary limit exceeded';end if;
 delete from work_queue_plans where workspace_id=j.workspace_id and user_id=j.entity_id;
 insert into work_queue_plans(workspace_id,user_id,work_item_id,effort_minutes,horizon,anchor_day,target_day,conflict,reason)
 select j.workspace_id,j.entity_id,p.id,p.effort_minutes,p.horizon,p.anchor_day,p.target_day,p.conflict,p.reason from jsonb_to_recordset(p_plans) as p(id uuid,effort_minutes integer,horizon text,anchor_day date,target_day date,conflict boolean,reason text)
 where personal_queue_owns(j.workspace_id,p.id,j.entity_id);
 return true;
end $$;
create function public.calibrate_queue_effort(p_workspace uuid,p_user uuid) returns void language plpgsql security definer set search_path=public as $$
declare b record;old_factor numeric;med numeric;n integer;
begin
 perform pg_advisory_xact_lock(hashtextextended(p_workspace::text||p_user::text,123));
 for b in select bucket,count(*) amount from work_queue_effort_runs where workspace_id=p_workspace and user_id=p_user and completed_at is not null and valid_sample and base_minutes>0 and not learning_applied group by bucket having count(*)>=5 loop
  select coalesce(factor,1) into old_factor from work_queue_calibration where workspace_id=p_workspace and user_id=p_user and bucket=b.bucket;old_factor:=coalesce(old_factor,1);
  select percentile_cont(.5) within group(order by ratio),count(*) into med,n from (select greatest(.5,least(2,coalesce(corrected_minutes,active_seconds/60)/base_minutes)) ratio from work_queue_effort_runs where workspace_id=p_workspace and user_id=p_user and bucket=b.bucket and completed_at is not null and valid_sample and base_minutes>0 order by completed_at desc limit 30) samples;
  insert into work_queue_calibration(workspace_id,user_id,bucket,factor,sample_count) values(p_workspace,p_user,b.bucket,greatest(.5,least(2,old_factor+greatest(-.05,least(.05,med-old_factor)))),n)
  on conflict(workspace_id,user_id,bucket) do update set factor=excluded.factor,sample_count=excluded.sample_count,updated_at=now();
  update work_queue_effort_runs set learning_applied=true where workspace_id=p_workspace and user_id=p_user and bucket=b.bucket and completed_at is not null and valid_sample;
 end loop;
end $$;
create function public.queue_feedback_settings(p_workspace uuid,p_user uuid,p_timezone text default null,p_reset boolean default false) returns jsonb language plpgsql security definer set search_path=public as $$
begin
 if not exists(select 1 from workspace_memberships where workspace_id=p_workspace and user_id=p_user) then raise exception 'Workspace membership required';end if;
 insert into work_queue_preferences(workspace_id,user_id) values(p_workspace,p_user) on conflict do nothing;
 if p_timezone is not null then if not exists(select 1 from pg_timezone_names where name=p_timezone) then raise exception 'Invalid timezone';end if;update work_queue_preferences set timezone=p_timezone,updated_at=now() where workspace_id=p_workspace and user_id=p_user;perform queue_feedback_enqueue(p_workspace,'schedule',p_user);end if;
 if p_reset then update work_queue_preferences set verbosity=0,preference_votes=0,updated_at=now() where workspace_id=p_workspace and user_id=p_user;end if;
 return (select to_jsonb(p) from work_queue_preferences p where workspace_id=p_workspace and user_id=p_user);
end $$;
create function public.read_queue_feedback(p_workspace uuid,p_user uuid) returns jsonb language plpgsql stable security definer set search_path=public as $$
begin
 if not exists(select 1 from workspace_memberships where workspace_id=p_workspace and user_id=p_user) then raise exception 'Workspace membership required';end if;
 return jsonb_build_object('preferences',(select to_jsonb(p) from work_queue_preferences p where workspace_id=p_workspace and user_id=p_user),
 'disputes',coalesce((select jsonb_agg(to_jsonb(d)) from (select q.id,q.work_item_id,q.reason,q.note,q.status,q.assessment,q.resolution,q.conversation_id,jsonb_build_object('title',q.snapshot->>'title','version',q.snapshot->>'version') snapshot,queue_feedback_can_review(p_workspace,q.id,p_user) can_review from work_queue_disputes q where q.workspace_id=p_workspace and (q.user_id=p_user or queue_feedback_can_review(p_workspace,q.id,p_user)) and workspace_user_can_access_work_item(p_workspace,q.work_item_id,p_user) order by (q.status='open') desc,q.created_at desc limit 50) d),'[]'),
 'outcomes',coalesce((select jsonb_agg(to_jsonb(r)) from (select id,work_item_id,estimate_minutes,horizon,target_day,completed_at,met_target,active_seconds,valid_sample,corrected_minutes from work_queue_effort_runs where workspace_id=p_workspace and user_id=p_user and completed_at is not null order by completed_at desc limit 30) r),'[]'));
end $$;
create function public.read_queue_dispute(p_workspace uuid,p_user uuid,p_dispute uuid) returns jsonb language sql stable security definer set search_path=public as $$
 select to_jsonb(d)||jsonb_build_object('can_review',queue_feedback_can_review(p_workspace,d.id,p_user)) from work_queue_disputes d where workspace_id=p_workspace and id=p_dispute and (user_id=p_user or queue_feedback_can_review(p_workspace,id,p_user)) and workspace_user_can_access_work_item(p_workspace,work_item_id,p_user)
$$;
create function public.correct_queue_effort(p_workspace uuid,p_user uuid,p_run uuid,p_minutes integer) returns void language plpgsql security definer set search_path=public as $$
begin
 if p_minutes<1 or p_minutes>4800 then raise exception 'Active minutes must be between 1 and 4800';end if;
 update work_queue_effort_runs set corrected_minutes=p_minutes,valid_sample=(exclusion is null or exclusion='timer') and not exists(select 1 from work_queue_disputes d where d.workspace_id=p_workspace and d.work_item_id=work_queue_effort_runs.work_item_id and d.created_at>=work_queue_effort_runs.started_at) and source_fingerprint=(select md5(coalesce(w.instructions,'')||coalesce(w.description,'')) from work_items w where w.workspace_id=p_workspace and w.id=work_queue_effort_runs.work_item_id) where workspace_id=p_workspace and user_id=p_user and id=p_run and completed_at>now()-interval '7 days' and not learning_applied;
 if not found then raise exception 'This time sample is unavailable or already used';end if;
 perform queue_feedback_enqueue(p_workspace,'schedule',p_user);
end $$;

create or replace function public.read_personal_work_queue(p_workspace uuid,p_user uuid,p_offset integer default 0,p_view text default 'all') returns jsonb
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
 a.assessment,a.status assessment_status,a.assessed_at,plan.effort_minutes calibrated_minutes,plan.horizon,plan.anchor_day,plan.target_day,plan.conflict schedule_conflict,plan.reason schedule_reason,plan.calculated_at,
 case w.priority_override when 1 then 0 when 2 then 2 when 3 then 3 when 4 then 4 else
 case when coalesce(a.assessment->>'horizon','week')='now' then 0
 when plan.target_day<=(now() at time zone coalesce(pref.timezone,'Europe/Dublin'))::date then 1
 when plan.target_day=(now() at time zone coalesce(pref.timezone,'Europe/Dublin'))::date+1 then 2
 when a.assessment->>'horizon'='today' then 1 when a.assessment->>'horizon'='tomorrow' then 2 else 3 end end priority_band,
 exists(select 1 from work_queue_disputes d where d.workspace_id=w.workspace_id and d.work_item_id=w.id and d.status='open' and d.blocking) disputed,
 exists(select 1 from work_queue_disputes d where d.workspace_id=w.workspace_id and d.work_item_id=w.id and d.status='resolved' and d.resolved_at>now()-interval '7 days') resolved
 from work_items w left join work_queue_assessments a on a.work_item_id=w.id and a.workspace_id=w.workspace_id
 left join work_queue_preferences pref on pref.workspace_id=w.workspace_id and pref.user_id=p_user
 left join work_queue_plans plan on plan.workspace_id=w.workspace_id and plan.work_item_id=w.id and plan.user_id=p_user
 where w.workspace_id=p_workspace and queue_work_open(w) and personal_queue_owns(p_workspace,w.id,p_user)
 and not exists(select 1 from work_item_relationships l join relationships r on r.workspace_id=l.workspace_id and r.id=l.relationship_id where l.workspace_id=p_workspace and l.work_item_id=w.id and r.status='archived')
 ), scored as (
 select *,case when disputed or paused or blocked or status in ('blocked','waiting') or (status<>'doing' and planned_at>now()) then 2 when status='doing' then 0 else 1 end band,
 coalesce((assessment->>'impact')::numeric,40)*.55+coalesce((assessment->>'urgency')::numeric,30)*.25+
 least(20,greatest(0,extract(epoch from(now()-created_at))/86400))+greatest(0,10-coalesce((assessment->>'effort_minutes')::numeric,60)/60) score from candidates
 ), page as (
 select * from scored where p_view='all' or (p_view='ready' and band<2) or (p_view='deferred' and band=2) order by band,case when band=0 then actual_start_at end nulls last,priority_band,resolved desc,score desc,created_at,id limit 31 offset p_offset
 ) select jsonb_build_object('items',coalesce((select jsonb_agg(to_jsonb(page)) from page),'[]'),'hasMore',(select count(*)>30 from page),
 'ready',(select count(*) from scored where band<2),'deferred',(select count(*) from scored where band=2),'assessed',(select count(*) from scored where assessment is not null),'total',(select count(*) from scored)) into result;
 return result;
end $$;

alter function public.queue_assessment_context(uuid,uuid) rename to queue_assessment_context_v1;
create function public.queue_assessment_context(p_workspace uuid,p_item uuid) returns jsonb language sql stable security definer set search_path=public as $$
 select queue_assessment_context_v1(p_workspace,p_item)||jsonb_build_object(
 'approved_corrections',coalesce((select jsonb_agg(jsonb_build_object('reason',q.reason,'resolution',q.resolution)) from (
 select d.reason,d.resolution from work_queue_disputes d join work_items source on source.id=d.work_item_id join work_items target on target.id=p_item
 where d.workspace_id=p_workspace and d.approved and d.status='resolved' and queue_context_compatible(target,source) order by d.resolved_at desc limit 3) q),'[]'),
 'assignee_context',coalesce((select jsonb_agg(jsonb_build_object('presentation',case when p.verbosity<0 then 'Prefer concise guidance' when p.verbosity>0 then 'Prefer a little more explanation and examples' else 'Standard concise guidance' end,
 'workload',case when (select count(*) from work_queue_plans qp where qp.workspace_id=p_workspace and qp.user_id=m.user_id and qp.horizon in ('now','today'))>3 then 'Several urgent items already queued' else 'No recorded urgent overload' end))
 from (select user_id from workspace_memberships where workspace_id=p_workspace and personal_queue_owns(p_workspace,p_item,user_id) and (select count(*) from workspace_memberships m2 where m2.workspace_id=p_workspace and personal_queue_owns(p_workspace,p_item,m2.user_id))=1 order by user_id limit 1) m left join work_queue_preferences p on p.workspace_id=p_workspace and p.user_id=m.user_id),'[]'))
$$;
-- Include the durable feedback work in the existing five-minute scheduler.
create or replace function public.dispatch_pending_work_queue() returns bigint
language plpgsql security definer set search_path=public as $$
declare settings work_queue_scheduler; token text; request_id bigint;
begin
 select * into settings from work_queue_scheduler where id and enabled for update skip locked;
 if not found then return null; end if;
 if settings.last_dispatched_at>now()-interval '4 minutes' then return null; end if;
 if not exists(select 1 from work_queue_assessments a join work_items w on w.workspace_id=a.workspace_id and w.id=a.work_item_id where queue_work_open(w) and (a.status='queued' or (a.status='running' and a.lease_until<now())))
 and not exists(select 1 from work_queue_completion_followups where completed_at is null and attempts<5 and (lease_until is null or lease_until<now())) and not exists(select 1 from work_queue_feedback_jobs where status in ('queued','running') and attempts<5) then return null; end if;
 select decrypted_secret into token from vault.decrypted_secrets where name='sop_work_cron_secret';
 if token is null then raise exception 'Worker authentication is unavailable'; end if;
 request_id:=net.http_post(url:=settings.worker_url,headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||token),body:='{}'::jsonb,timeout_milliseconds:=10000);
 update work_queue_scheduler set last_request_id=request_id,last_dispatched_at=now() where id;
 return request_id;
end $$;

do $$declare f record;begin for f in select oid::regprocedure signature from pg_proc where pronamespace='public'::regnamespace and proname in ('queue_feedback_enqueue','queue_schedule_item','queue_schedule_changed','queue_feedback_can_review','submit_queue_dispute','resolve_queue_dispute','queue_capture_effort','personal_queue_command','personal_queue_command_v1','claim_queue_feedback_job','finish_queue_feedback_job','queue_schedule_context','publish_queue_schedule','calibrate_queue_effort','queue_feedback_settings','read_queue_feedback','correct_queue_effort','read_queue_dispute','queue_assessment_context','queue_assessment_context_v1') loop
 execute format('revoke all on function %s from public,anon,authenticated',f.signature);execute format('grant execute on function %s to service_role',f.signature);end loop;end $$;
select queue_schedule_item(workspace_id,id) from work_items w where queue_work_open(w);
update work_queue_assessments set revision=revision+1,status=case when status='running' then status else 'queued' end where assessment->>'horizon' is null;
notify pgrst,'reload schema';
commit;
