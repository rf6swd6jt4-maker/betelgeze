-- Approved by the workspace owner on 2026-11-14 (follow-up to decision 4 in docs/assignment-offboarding-design.md).
-- Cancels the 40 open SOP fulfilment tasks on archived or lost clients whose only people are removed members,
-- as found by scripts/assignment-orphan-report.sql. Changes work_items.status only: links, collaborators,
-- services, SOP runs and history are kept. No storage, billing or provider calls.
--
-- Fails closed: if the set of matching tasks is not exactly the reviewed 40 (by count and id fingerprint),
-- it raises and nothing changes. Every row is copied to offboarding_repair_20261114.work_item_snapshots first.
--
-- Rehearsal: replace the final COMMIT with ROLLBACK (or with a raising DO block to see the counts).
-- Undo (after commit):
--   update public.work_items w set status = s.row_data->>'status'
--   from offboarding_repair_20261114.work_item_snapshots s where w.id = s.id and w.status = 'canceled';

begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

create schema offboarding_repair_20261114;
revoke all on schema offboarding_repair_20261114 from public, anon, authenticated;
create table offboarding_repair_20261114.work_item_snapshots (
    id uuid primary key,
    row_data jsonb not null,
    assignees jsonb not null,
    captured_at timestamptz not null default now()
);
alter table offboarding_repair_20261114.work_item_snapshots enable row level security;
grant usage on schema offboarding_repair_20261114 to service_role;
grant select on offboarding_repair_20261114.work_item_snapshots to service_role;

create temp table repair_targets (id uuid primary key) on commit drop;
insert into repair_targets
select distinct w.id
from public.work_item_assignees a
join public.work_items w on w.workspace_id = a.workspace_id and w.id = a.work_item_id
where w.status not in ('done', 'canceled') and w.metadata->>'archived_at' is null
  and not exists (select 1 from public.workspace_memberships m where m.workspace_id = a.workspace_id and m.user_id = a.user_id)
  and exists (select 1 from public.work_item_relationships wr where wr.work_item_id = w.id)
  and not exists (select 1 from public.work_item_relationships wr join public.relationships r on r.id = wr.relationship_id
                  where wr.work_item_id = w.id and r.status <> 'archived' and r.lifecycle_phase <> 'completed_lost');

do $$
declare n integer; fp text;
begin
    select count(*), md5(string_agg(id::text, ',' order by id)) into n, fp from repair_targets;
    if n <> 40 or fp is distinct from 'a1250252bba359387d9aa69432a844c2' then
        raise exception 'Targets changed since review (% tasks, fingerprint %). Nothing was changed.', n, fp;
    end if;
end $$;

insert into offboarding_repair_20261114.work_item_snapshots (id, row_data, assignees)
select w.id, to_jsonb(w),
       coalesce((select jsonb_agg(to_jsonb(a) order by a.user_id) from public.work_item_assignees a where a.work_item_id = w.id), '[]'::jsonb)
from public.work_items w
join repair_targets t on t.id = w.id;

update public.work_items w
set status = 'canceled'
from repair_targets t
where w.id = t.id and w.status not in ('done', 'canceled');

do $$
declare snapshots integer; still_open integer; canceled integer;
begin
    select count(*) into snapshots from offboarding_repair_20261114.work_item_snapshots;
    select count(*) filter (where w.status not in ('done', 'canceled')), count(*) filter (where w.status = 'canceled')
      into still_open, canceled
      from public.work_items w join repair_targets t on t.id = w.id;
    if snapshots <> 40 or still_open <> 0 or canceled <> 40 then
        raise exception 'Unexpected result (% snapshots, % canceled, % still open). Nothing was changed.', snapshots, canceled, still_open;
    end if;
end $$;

commit;
