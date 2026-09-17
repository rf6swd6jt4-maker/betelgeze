begin;
-- Reuse the existing trusted scheduler credential; never expose it to clients.
create table public.chat_push_scheduler (
 id boolean primary key default true check(id),
 enabled boolean not null default false,
 last_request_id bigint,
 last_dispatched_at timestamptz
);
alter table public.chat_push_scheduler enable row level security;
revoke all on public.chat_push_scheduler from public,anon,authenticated;
grant select,update on public.chat_push_scheduler to service_role;
insert into public.chat_push_scheduler(id,enabled) values(true,false);
create function public.dispatch_pending_chat_push() returns bigint
language plpgsql security definer set search_path=public as $$
declare settings chat_push_scheduler; token text; request_id bigint;
begin
 select * into settings from chat_push_scheduler where id and enabled for update skip locked;
 if not found or settings.last_dispatched_at>now()-interval '45 seconds' then return null;end if;
 if not exists(select 1 from chat_push_deliveries where status='pending' and available_at<=now())
 and not exists(select 1 from chat_push_deliveries where status='processing' and lease_until<now()) then return null;end if;
 select decrypted_secret into token from vault.decrypted_secrets where name='sop_work_cron_secret';
 if token is null then raise exception 'Push scheduler credential unavailable';end if;
 request_id:=net.http_post(url:='https://app.betelgeze.com/api/cron/chat-push',headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||token),body:='{}'::jsonb,timeout_milliseconds:=10000);
 update chat_push_scheduler set last_request_id=request_id,last_dispatched_at=now() where id;
 return request_id;
end $$;
revoke all on function public.dispatch_pending_chat_push() from public,anon,authenticated;
select cron.schedule('chat-push-recovery','* * * * *','select public.dispatch_pending_chat_push();');
-- Keep diagnostics for a bounded window; never purge unsettled delivery jobs.
select cron.schedule('chat-push-retention','17 3 * * *',$q$
 delete from public.chat_push_deliveries where created_at<now()-interval '30 days' and status not in('pending','processing');
 update public.chat_push_deliveries set status='expired',lease_token=null,lease_until=null where created_at<now()-interval '2 days' and status in('pending','processing');
 delete from public.communications_active_sessions where last_seen_at<now()-interval '30 days';
$q$);
notify pgrst,'reload schema';
commit;
