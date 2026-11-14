-- Approved by the workspace owner on 2026-11-14 (follow-up to offboarding-orphan-cancel-20261114.sql).
-- After the North Texas Shutters Meta Ads Setup service was transferred, the existing service transfer left the removed
-- former assignee as a collaborator on the service's group header (work_items.workflow_role = 'service_group'),
-- because transfer_service_assignee never moves group headers. This removes that one collaborator row.
-- The work item, its owner (none), its tasks and every other collaborator are unchanged.
--
-- Fails closed unless exactly one such row exists: a non-member collaborator on that open group header.
-- The row is copied to offboarding_repair_20261114.work_item_assignee_snapshots first.
-- Rehearsal: replace the final COMMIT with ROLLBACK (or a raising DO block).
-- Undo (after commit):
--   insert into public.work_item_assignees select (jsonb_populate_record(null::public.work_item_assignees, row_data)).*
--   from offboarding_repair_20261114.work_item_assignee_snapshots;

begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

create table offboarding_repair_20261114.work_item_assignee_snapshots (
    work_item_id uuid not null,
    user_id uuid not null,
    row_data jsonb not null,
    captured_at timestamptz not null default now(),
    primary key (work_item_id, user_id)
);
alter table offboarding_repair_20261114.work_item_assignee_snapshots enable row level security;
grant select on offboarding_repair_20261114.work_item_assignee_snapshots to service_role;

insert into offboarding_repair_20261114.work_item_assignee_snapshots (work_item_id, user_id, row_data)
select a.work_item_id, a.user_id, to_jsonb(a)
from public.work_item_assignees a
join public.work_items w on w.workspace_id = a.workspace_id and w.id = a.work_item_id
where a.work_item_id = 'c6b39e1d-7d5d-4b47-b3d0-03943c308ede'
  and w.workflow_role = 'service_group' and w.status not in ('done', 'canceled') and w.metadata->>'archived_at' is null
  and not exists (select 1 from public.workspace_memberships m where m.workspace_id = a.workspace_id and m.user_id = a.user_id);

do $$
declare n integer;
begin
    select count(*) into n from offboarding_repair_20261114.work_item_assignee_snapshots;
    if n <> 1 then raise exception 'Expected exactly one former-member collaborator on the group header, found %. Nothing was changed.', n; end if;
end $$;

delete from public.work_item_assignees a
using offboarding_repair_20261114.work_item_assignee_snapshots s
where a.work_item_id = s.work_item_id and a.user_id = s.user_id;

do $$
declare left_over integer;
begin
    select count(*) into left_over from public.work_item_assignees a
    where a.work_item_id = 'c6b39e1d-7d5d-4b47-b3d0-03943c308ede'
      and not exists (select 1 from public.workspace_memberships m where m.workspace_id = a.workspace_id and m.user_id = a.user_id);
    if left_over <> 0 then raise exception 'A former-member collaborator remains (%). Nothing was changed.', left_over; end if;
end $$;

commit;
