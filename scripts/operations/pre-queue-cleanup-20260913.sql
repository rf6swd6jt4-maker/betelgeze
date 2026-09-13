-- Explicitly approved Scaylup cleanup. No storage deletion, billing or provider calls.
-- Run once. For rehearsal replace final COMMIT with ROLLBACK.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';
create schema pre_queue_cleanup_20260913;
revoke all on schema pre_queue_cleanup_20260913 from public,anon,authenticated;
create table pre_queue_cleanup_20260913.snapshots(table_name text not null,id uuid not null,row_data jsonb not null,primary key(table_name,id));
alter table pre_queue_cleanup_20260913.snapshots enable row level security;
grant usage on schema pre_queue_cleanup_20260913 to service_role;
grant all on pre_queue_cleanup_20260913.snapshots to service_role;
create temp table cleanup_targets(id uuid primary key);
insert into cleanup_targets values
('c3c7188d-4498-4e89-9166-9792b17483ab'),
('530fc335-979e-4287-97a5-754cda9292e2'),
('df3c22bc-0749-4836-af18-036262b1af2e'),
('e8fe31f1-a50e-43e2-a5fb-0fc0ce79ead6'),
('e6bea576-89fe-4690-bf6e-fa399178d0ef'),
('4d1c17a8-e2d2-4591-90cc-d08cb5ca8312'),
('959883fc-780f-493f-86fe-1289c3d28e50'),
('101c8f59-204c-4075-bf5d-431708e9769d'),
('e1080796-a0cc-416a-8664-5eb79ee43515'),
('d891b3c1-41d9-4a16-9716-5df24ac6863c'),
('7dc66420-a9db-4dee-a1e3-cb783a3907cc'),
('fc936f97-5745-4b2a-8108-91a0391215a9'),
('61a911fe-133e-4619-8c16-9e3a5e2bd265'),
('7ce686b0-19fc-4f0e-92ad-0fd2e1249841'),
('7dab5cab-b6c8-4957-847e-b0e6081f2f92'),
('58dcc35b-f2f0-45a7-8369-3fa05ca66532'),
('228d2fcb-c830-4d2d-9fe6-1eb386bca4f9'),
('f1ffe6e1-b349-42f8-9a43-d9b54f1fbb6a'),
('69e381e3-0008-488b-bacb-6927e3c7519a'),
('ece2e8a2-4328-4d03-805a-51d22d3bd8a6'),
('beda5947-66c8-478e-b322-ffa6ab5558ff'),
('bd0a07c0-54d8-4d90-9db6-bb83e1dfd361'),
('8b6c145c-db61-4d0a-89de-31b8973bd8e0'),
('7aa12785-66f8-495a-a4c0-7647f0614492'),
('801e6887-0f77-49b4-99d7-f498b7195d73'),
('de414023-f9c3-4f40-83ca-926735c1a526'),
('9e9be4fa-b164-4b7b-9356-ac8872169a33'),
('08c571b4-839b-4656-96b1-70076b5d68a3'),
('ea9daa57-2c26-4dac-bc4d-104bcc6d0a94'),
('941777d9-4f1f-4038-92e3-a2c15b2e1c92'),
('0989c6e1-b554-4410-9fd9-eca635ace2a3'),
('d22a285c-5b3b-4d92-8c79-e1dc27c10423'),
('40086727-1e7c-4544-8b55-9c50d709484c'),
('2bbdbf02-1fa7-4066-8171-f4fbb1aead41'),
('9b6af804-9567-4607-8cea-ce89ad287a2b'),
('8d594c1c-72c6-44f3-ab7c-dc5afaf4ec8b'),
('6797ef87-0a84-446a-9098-8145234116de'),
('9f799f68-6325-463f-87bc-0160018a7b34'),
('ef715916-8997-487e-85fb-b7a81dd9d05a'),
('5fcb288e-cc8a-4e5a-bafe-824b25241462');
create temp table protected_relationships(id uuid primary key);
insert into protected_relationships values('36c6d3de-ddc8-4f38-be23-ab9bba512d93'),('e0379342-4a2e-4d2f-918f-7a73ab02d171');
-- Capture all relationship-keyed Bruce data plus linked work and team membership.
create function pg_temp.protected_fingerprint() returns jsonb language plpgsql as $$
declare t record; digest text; result jsonb:='{}'; begin
 for t in select c.table_name from information_schema.columns c join information_schema.tables tab on tab.table_schema=c.table_schema and tab.table_name=c.table_name where c.table_schema='public' and c.column_name='relationship_id' and tab.table_type='BASE TABLE' loop
  execute format('select md5(coalesce(jsonb_agg(to_jsonb(r) order by to_jsonb(r)::text)::text,''[]'')) from public.%I r where relationship_id in(select id from protected_relationships)',t.table_name) into digest;
  result:=result||jsonb_build_object(t.table_name,digest);
 end loop;
 select md5(coalesce(jsonb_agg(to_jsonb(r) order by r.id)::text,'[]')) into digest from relationships r where id in(select id from protected_relationships); result:=result||jsonb_build_object('relationships',digest);
 select md5(coalesce(jsonb_agg(to_jsonb(w) order by w.id)::text,'[]')) into digest from work_items w where id in(select work_item_id from work_item_relationships where relationship_id in(select id from protected_relationships)); result:=result||jsonb_build_object('work_items',digest);
 select md5(coalesce(jsonb_agg(to_jsonb(m) order by to_jsonb(m)::text)::text,'[]')) into digest from workspace_team_members m where team_id in(select id from workspace_teams where relationship_id in(select id from protected_relationships)); result:=result||jsonb_build_object('team_members',digest);
 return result;
end $$;
create temp table protected_before as select pg_temp.protected_fingerprint() fingerprint;
do $$ begin
 if (select count(*) from relationships r join cleanup_targets t using(id) where workspace_id='765d71f8-4f7c-4a3b-8e65-ccc4cf7d275b')<>40 then raise exception 'Cleanup target set changed'; end if;
 if exists(select 1 from cleanup_targets join protected_relationships using(id)) then raise exception 'Protected relationship selected'; end if;
 if exists(select 1 from onboarding_delivery_outbox where relationship_id in(select id from cleanup_targets) and status='processing') then raise exception 'Delivery in progress; retry after completion'; end if;
end $$;
create temp table cleanup_work as with recursive work(id) as (
 select work_item_id from work_item_relationships where relationship_id in(select id from cleanup_targets)
 union select w.id from work_items w join work p on w.parent_work_item_id=p.id
) select distinct id from work;
do $$ begin
 if exists(select 1 from work_item_relationships where work_item_id in(select id from cleanup_work) and relationship_id not in(select id from cleanup_targets)) then raise exception 'Shared work needs review'; end if;
 if exists(select 1 from work_item_dependencies where depends_on_work_item_id in(select id from cleanup_work) and work_item_id not in(select id from cleanup_work)) then raise exception 'External work depends on cleanup work'; end if;
end $$;
create temp table cleanup_assets as select a.id from assets a where a.workspace_id='765d71f8-4f7c-4a3b-8e65-ccc4cf7d275b'
 and exists(select 1 from asset_relationships l where l.asset_id=a.id and l.relationship_id in(select id from cleanup_targets))
 and not exists(select 1 from asset_relationships l where l.asset_id=a.id and l.relationship_id not in(select id from cleanup_targets))
 and not exists(select 1 from asset_work_items l where l.asset_id=a.id and l.work_item_id not in(select id from cleanup_work));
insert into pre_queue_cleanup_20260913.snapshots select 'relationships',r.id,to_jsonb(r) from relationships r join cleanup_targets t using(id);
insert into pre_queue_cleanup_20260913.snapshots select 'work_items',w.id,to_jsonb(w) from work_items w join cleanup_work t using(id);
insert into pre_queue_cleanup_20260913.snapshots select 'assets',a.id,to_jsonb(a) from assets a join cleanup_assets t using(id);
do $$ declare tab text; begin
 foreach tab in array array['relationship_onboarding_sessions','onboarding_delivery_outbox','workspace_teams','client_portal_sessions'] loop
 execute format('insert into pre_queue_cleanup_20260913.snapshots select %L,id,to_jsonb(r) from public.%I r where relationship_id in(select id from cleanup_targets)',tab,tab);
 end loop;
end $$;
grant select on cleanup_targets to service_role;
set local role service_role;
do $$ declare r record; actor uuid; begin
 select user_id into actor from workspace_memberships where workspace_id='765d71f8-4f7c-4a3b-8e65-ccc4cf7d275b' and role='owner' limit 1;
 if actor is null then raise exception 'Workspace owner missing'; end if;
 for r in select rel.id,rel.workspace_id from relationships rel join cleanup_targets t using(id) where rel.status<>'archived' loop
 perform public.archive_workspace_relationship(r.workspace_id,r.id,actor);
 end loop;
end $$;
reset role;
update relationship_onboarding_sessions set status='archived',archived_at=coalesce(archived_at,now()),token_revoked_at=coalesce(token_revoked_at,now()),updated_at=now() where relationship_id in(select id from cleanup_targets) and (status<>'archived' or token_revoked_at is null);
update onboarding_delivery_outbox set status='canceled',locked_at=null,error_code='pre_queue_cleanup',error_summary='Obsolete test relationship archived',updated_at=now() where relationship_id in(select id from cleanup_targets) and status in('queued','failed');
update client_portal_sessions set status='revoked',token_revoked_at=coalesce(token_revoked_at,now()),updated_at=now() where relationship_id in(select id from cleanup_targets) and status='active';
update work_items set status=case when status='done' then status else 'canceled' end,workflow_required=false,metadata=metadata||jsonb_build_object('archived_at',now(),'archive_reason','Pre-queue test cleanup','archive_batch','20260913'),updated_at=now() where id in(select id from cleanup_work);
update assets set metadata=metadata||jsonb_build_object('archived_at',now(),'archive_reason','Pre-queue test cleanup','archive_batch','20260913'),updated_at=now() where id in(select id from cleanup_assets);
do $$ begin
 if (select fingerprint from protected_before) is distinct from pg_temp.protected_fingerprint() then raise exception 'Bruce changed; rolling back cleanup'; end if;
 if exists(select 1 from relationships where id in(select id from cleanup_targets) and status<>'archived') then raise exception 'Unarchived target'; end if;
 if exists(select 1 from work_items where id in(select id from cleanup_work) and status not in('done','canceled')) then raise exception 'Unfinished target work'; end if;
 if exists(select 1 from relationship_onboarding_sessions where relationship_id in(select id from cleanup_targets) and (status<>'archived' or token_revoked_at is null)) then raise exception 'Live test session remains'; end if;
end $$;
select 'CLEANUP_PASSED' result,
(select count(*) from pre_queue_cleanup_20260913.snapshots where table_name='relationships' and row_data->>'status'<>'archived') newly_archived_relationships,
(select count(*) from cleanup_work) archived_work,
(select count(*) from pre_queue_cleanup_20260913.snapshots where table_name='work_items' and row_data->>'status' not in('done','canceled')) newly_canceled_work,
(select count(*) from cleanup_assets) archived_assets,
(select count(*) from relationship_onboarding_sessions where relationship_id in(select id from cleanup_targets)) archived_sessions,
(select count(*) from pre_queue_cleanup_20260913.snapshots where table_name='onboarding_delivery_outbox' and row_data->>'status' in('queued','failed')) canceled_deliveries,
(select count(*) from pre_queue_cleanup_20260913.snapshots where table_name='client_portal_sessions' and row_data->>'status'='active') revoked_portals,
(select count(*) from relationships where workspace_id='765d71f8-4f7c-4a3b-8e65-ccc4cf7d275b' and status<>'archived') remaining_relationships;
commit;
