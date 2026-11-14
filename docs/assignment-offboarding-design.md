# Reassign and remove: design proposal

Status: proposal, open questions decided 2026-11-14 (see Decisions). No migration or application behavior changes yet;
the migration still needs explicit approval. Read with
`docs/assignment-dependency-map.md`; every behavior claimed below is checked by
`scripts/validate-assignment-offboarding-full-schema.mjs` unless marked as an open question.

## Problem

Removing someone, or taking them off a service, is a manual hunt: find every client and service they touch, change each
one in a different screen, then retry. Two database guards refuse the removal with a message that names only one kind of blocker,
and four kinds of assignment are not guarded at all, so they can be silently orphaned.

## What a person can be attached to (their footprint)

| # | Attachment | Today on removal | Moves with |
| - | --- | --- | --- |
| 1 | Fulfilment manager of a locked, active client | Refused by `guard_client_team_offboarding` | client team save |
| 2 | Legacy per-service assignee (`relationship_services`) on a locked, active client | Refused by the same guard; sold rows cannot be edited directly | `transfer_service_assignee` |
| 3 | Primary assignee of an active service instance | **Allowed; instance keeps the former member** | `transfer_service_assignee` |
| 4 | Shared queue roster member on an active instance | Refused by `guard_service_queue_offboarding` | `save_service_queue_roster` |
| 5 | Work item execution owner or collaborator | **Allowed; task keeps the former member** | `transfer_service_assignee` (selected work) |
| 6 | Seller on a client | Allowed; client keeps the former member | not moved (see open question 1) |
| 7 | Service eligibility, client chat access, queue preferences, operational roles | Deleted automatically by foreign-key cascade | not applicable |
| 8 | Team chat membership | Synced by triggers | handled inside the commands above |

## Proposed commands

Two database commands, in the same style as `transfer_service_assignee` (request id receipt, advisory lock, relationship-first
lock order, fingerprint check, one transaction):

1. `preview_workspace_member_offboarding(workspace, actor, target, scope)` returns the footprint for the person. It is read-only,
   bounded, and returns a fingerprint plus eligible replacement candidates per item. `scope` is the whole workspace for Remove,
   or a single service for "take off this service".
2. `offboard_workspace_member(workspace, actor, request, target, plan)` takes the previewed fingerprint and a plan that maps each
   footprint item to a recipient (or to "leave unassigned" if open question 2 allows it). In one transaction it:
   - verifies the actor is owner or admin (admins only for staff), the target is not an owner, and every recipient is a member
     eligible for that service;
   - locks relationships first, then instances, then work, matching existing order, and fails with "reload preview" if the
     fingerprint changed;
   - moves items 1 to 5 using the existing commands' logic (`change_service_instance`, roster save, work owner and collaborator
     update, chat membership cleanup), so no assignment rule is reimplemented;
   - deletes the membership last, so the two existing guards act as a backstop rather than the primary check;
   - writes one receipt recording what moved, so a repeated request returns the same result.

Nothing is partially applied: if any item fails, the whole removal is rolled back and the person stays a member.

## Interface

One dialog replaces the confirm prompt and the error message. It opens from Remove in Settings > Users and from unticking
someone in Settings > Services.

- Header: who is leaving and how many clients, services and open tasks they are on.
- Default: one "Give everything to" picker listing only people eligible for all of it, with a per-client override list collapsed
  underneath.
- Anything with no eligible replacement is shown with the reason and blocks the button, instead of failing after the click.
- A single "Reassign and remove" action; a second submit with the same request id is safe.

## Work that already exists and is reused

`transfer_service_assignee` and its preview (per-instance work selection, 200-item cap, receipts, lock ordering, chat cleanup),
`save_service_queue_roster`, `change_service_instance`, `set_service_delivery_users`. The offboarding command orchestrates these;
it does not copy their rules.

## Speed and safety

- Runs only on offboarding actions, never on list, tab or chat paths. Preview reads are bounded (item cap, with a clear
  "split into batches" result above it). No new subscriptions, polling or hot-path queries.
- Existing guards stay. Extending them to cover items 3 and 5 as well is optional follow-up (open question 3).
- Migrations are additive and immutable; no existing rows are rewritten. Rollback is dropping the new functions and receipt table.
- The UI keeps the app-speed rules: local pending state, no blocking overlay for unrelated tabs, no "removed" until the
  transaction commits.

## Testing before any user sees it

Extend the full-schema harness with one scenario per footprint row, plus: atomic rollback when one item fails, idempotent retry
with the same request id, request id reuse with different input, a recipient who is not eligible, a changed fingerprint,
concurrent offboarding of two people from one client, and access checks showing the recipient can now see the work and the
former member cannot.

## Decisions

Accepted by the user on 2026-11-14, as recommended:

1. **Seller.** Leave sellers alone. `seller_user_id` and sale seller attribution are deliberate history; show the former
   seller's name from preserved attribution. Offboarding never moves or clears them.
2. **Leave unassigned.** Items 1 to 4 (client manager, legacy service assignee, instance primary assignee, shared roster) must
   each have a recipient. Item 5 (open work items) allows one explicit "leave open tasks unassigned" choice for the whole
   removal. A service with no eligible recipient blocks the action until someone is made eligible.
3. **Guards.** Once the offboarding command exists, extend the database backstop to refuse removing an active instance primary
   assignee or open-work owner, so nothing outside the command can orphan work.
4. **Existing orphans.** Run a read-only report of assignments already pointing at former members
   (`scripts/assignment-orphan-report.sql`) before any migration, and decide how to repair what it finds separately.

## Staged plan

1. Read-only report of existing orphaned assignments (no schema change).
2. Migration with preview command, offboarding command and receipts table, plus full-schema scenario tests. Needs explicit approval
   because it is a new migration.
3. Dialog and the two entry points, behind the same permission checks as today.
4. Optional backstop guards and a Settings > Services "take off this service" path using the same command.
