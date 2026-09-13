-- Conditional minute wake-up on Supabase, including when the browser is closed.
begin;
create extension if not exists pg_cron;
create extension if not exists pg_net;
create table public.sop_work_scheduler (
 id boolean primary key default true check(id),
 worker_url text not null,
 enabled boolean not null default false,
 last_request_id bigint,
 last_dispatched_at timestamptz
);
alter table public.sop_work_scheduler enable row level security;
revoke all on public.sop_work_scheduler from public,anon,authenticated;
grant select on public.sop_work_scheduler to service_role;
create function public.configure_sop_work_scheduler(p_url text,p_secret text,p_enabled boolean) returns void
language plpgsql security definer set search_path=public as $$
declare secret_id uuid;
begin
 if p_url !~ '^https://[a-zA-Z0-9.-]+/api/cron/sop-work$' or length(p_secret) not between 32 and 256 then raise exception 'Invalid SOP scheduler configuration.'; end if;
 select id into secret_id from vault.secrets where name='sop_work_cron_secret';
 if secret_id is null then perform vault.create_secret(p_secret,'sop_work_cron_secret','SOP worker authentication');
 else perform vault.update_secret(secret_id,p_secret); end if;
 insert into sop_work_scheduler(id,worker_url,enabled) values(true,p_url,p_enabled)
 on conflict(id) do update set worker_url=excluded.worker_url,enabled=excluded.enabled;
end $$;
create function public.dispatch_pending_sop_work() returns bigint
language plpgsql security definer set search_path=public as $$
declare settings sop_work_scheduler; token text; request_id bigint;
begin
 select * into settings from sop_work_scheduler where id and enabled for update skip locked;
 if not found then return null; end if;
 -- Idle checks use partial indexes and never invoke a Vercel function.
 if not exists(select 1 from sop_work_requests where status='pending')
 and not exists(select 1 from sop_work_runs where status='queued' or (status='running' and lease_until<now())) then return null; end if;
 if settings.last_dispatched_at>now()-interval '45 seconds' then return null; end if;
 select decrypted_secret into token from vault.decrypted_secrets where name='sop_work_cron_secret';
 if token is null then raise exception 'SOP scheduler credential is unavailable'; end if;
 request_id:=net.http_post(url:=settings.worker_url,headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||token),body:='{}'::jsonb,timeout_milliseconds:=10000);
 update sop_work_scheduler set last_request_id=request_id,last_dispatched_at=now() where id;
 return request_id;
end $$;
revoke all on function public.configure_sop_work_scheduler(text,text,boolean),public.dispatch_pending_sop_work() from public,anon,authenticated;
grant execute on function public.configure_sop_work_scheduler(text,text,boolean) to service_role;
select cron.schedule('sop-work-recovery','* * * * *','select public.dispatch_pending_sop_work();');
notify pgrst,'reload schema';
commit;
