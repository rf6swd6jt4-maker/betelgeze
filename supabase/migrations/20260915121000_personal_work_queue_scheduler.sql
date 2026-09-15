begin;
create table public.work_queue_scheduler (
 id boolean primary key default true check(id),
 worker_url text not null check(worker_url ~ '^https://[a-zA-Z0-9.-]+/api/cron/work-queue$'),
 enabled boolean not null default false,
 last_request_id bigint,
 last_dispatched_at timestamptz
);
alter table public.work_queue_scheduler enable row level security;
revoke all on public.work_queue_scheduler from public,anon,authenticated;
grant select,update on public.work_queue_scheduler to service_role;
-- Same app and existing worker credential; no secret is copied into configuration or cron text.
insert into work_queue_scheduler(id,worker_url)
 select true,regexp_replace(worker_url,'/api/cron/sop-work$','/api/cron/work-queue') from sop_work_scheduler where id;
create function public.dispatch_pending_work_queue() returns bigint
language plpgsql security definer set search_path=public as $$
declare settings work_queue_scheduler; token text; request_id bigint;
begin
 select * into settings from work_queue_scheduler where id and enabled for update skip locked;
 if not found then return null; end if;
 if settings.last_dispatched_at>now()-interval '4 minutes' then return null; end if;
 if not exists(select 1 from work_queue_assessments a join work_items w on w.workspace_id=a.workspace_id and w.id=a.work_item_id where queue_work_open(w) and (a.status='queued' or (a.status='running' and a.lease_until<now())))
 and not exists(select 1 from work_queue_completion_followups where completed_at is null and attempts<5 and (lease_until is null or lease_until<now())) then return null; end if;
 select decrypted_secret into token from vault.decrypted_secrets where name='sop_work_cron_secret';
 if token is null then raise exception 'Worker authentication is unavailable'; end if;
 request_id:=net.http_post(url:=settings.worker_url,headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||token),body:='{}'::jsonb,timeout_milliseconds:=10000);
 update work_queue_scheduler set last_request_id=request_id,last_dispatched_at=now() where id;
 return request_id;
end $$;
revoke all on function public.dispatch_pending_work_queue() from public,anon,authenticated;
select cron.schedule('personal-work-queue','*/5 * * * *','select public.dispatch_pending_work_queue();');
notify pgrst,'reload schema';
commit;
