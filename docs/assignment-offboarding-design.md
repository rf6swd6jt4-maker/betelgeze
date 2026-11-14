# Reassign and remove: design proposal

Status: proposal, open questions decided 2026-11-14 (see Decisions). No migration or application behavior changes yet;
the migration still needs explicit approval. Read with
`docs/assignment-dependency-map.md`. Every claim below about how removal behaves today is checked by
`scripts/validate-assignment-offboarding-full-schema.mjs`; the commands and interface are proposals.

## Problem

Moving someone's work to a colleague, removing them, or taking them off a service is a manual hunt: find every client and service they touch, change each
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
| 6 | Seller on a client | Allowed; client keeps the former member | not moved (decision 1) |
| 7 | Service eligibility, client chat access, queue preferences, operational roles | Deleted automatically by foreign-key cascade | not applicable |
| 8 | Team chat membership | Synced by triggers | handled inside the commands above |

## Proposed commands

Three database commands, in the same style as `transfer_service_assignee` (request id receipt, advisory lock, relationship-first
lock order, fingerprint check, one transaction). The two write commands share one internal function, so the moving rules exist
once.

1. `preview_workspace_member_footprint(workspace, actor, target, scope)` returns the footprint for the person. It is read-only
   and bounded. Each item carries a stable item key (attachment kind, record id and, for legacy rows, the service key), its own
   item fingerprint, and the eligible replacement candidates for it. The result also carries a footprint fingerprint over the
   whole set. `scope` is the whole workspace for the Staff panel and Remove, or a single service for "take off this service".
   Sellers (row 6) are listed as history and are never part of a plan.
2. `reassign_workspace_member_items(workspace, actor, request, source, plan)` moves **some or all** of a person's items to other
   people and leaves their membership untouched. This is the Staff panel's bulk "Move to" and the per-item reassign. The plan is
   a list of item keys, each with its item fingerprint and a recipient. It:
   - verifies the actor is an owner or admin (admins may move items held by staff or admins, not by an owner); the source and
     every recipient are current members; no recipient is the source; and every recipient is eligible for that item's service;
   - fails with "reload" only if a **planned** item's fingerprint changed or the item no longer belongs to the source, so an edit
     elsewhere in the person's footprint does not block an unrelated move;
   - requires a recipient for every planned item; "leave unassigned" does not exist here;
   - writes a receipt recording what moved, so a repeated request returns the same result.
3. `offboard_workspace_member(workspace, actor, request, target, footprint_fingerprint, plan)` reassigns the **whole** footprint
   and then removes the member. It:
   - applies the same checks as `reassign_workspace_member_items`, and also that the target is not an owner (admins remove only
     staff, as today);
   - recomputes the footprint and fails with "reload" if the footprint fingerprint changed, so nothing assigned after the preview
     is left behind;
   - requires a recipient for items 1 to 4 and for every open task, except that one explicit "leave open tasks unassigned"
     choice clears item 5 for the whole removal (decision 2);
   - deletes the membership last, so the two existing guards act as a backstop rather than the primary check.

Shared internal function: `apply_member_item_moves` (not granted to any client role) locks relationships first, then
instances, then work, matching existing order, and moves items 1 to 5 using the existing commands' logic
(`change_service_instance`, roster save, work owner and collaborator update, chat membership cleanup), so no assignment rule is
reimplemented. Where the recipient is already on a shared roster or already a collaborator on a task, the source is removed
and no duplicate is added. One receipts table records both commands, with the command kind on each receipt.

Nothing is partially applied: if any planned item fails, the whole request is rolled back. For a removal, the person also
stays a member.

## Interface

One dialog replaces the confirm prompt and the error message. It opens from Remove in Settings > Users and from unticking
someone in Settings > Services.

- Header: who is leaving and how many clients, services and open tasks they are on.
- Default: one "Give everything to" picker listing only people eligible for all of it, with a per-client override list collapsed
  underneath.
- Anything with no eligible replacement is shown with the reason and blocks the button, instead of failing after the click.
- A single "Reassign and remove" action; a second submit with the same request id is safe.

The Staff panel uses the same preview for one selected person and `reassign_workspace_member_items` for its actions:

- Items are grouped as in the footprint (clients managed, primary services, shared queues, open work), each with a checkbox.
- "Move to" lists only people eligible for every selected item; when the selection mixes services, ineligible people are shown
  with the reason instead of being hidden.
- After a move the items read "Now with <name>" from the committed receipt, never before the transaction commits.
- "Reassign and remove" opens the removal dialog above with the remaining footprint.

## Work that already exists and is reused

`transfer_service_assignee` and its preview (per-instance work selection, 200-item cap, receipts, lock ordering, chat cleanup),
`save_service_queue_roster`, `change_service_instance`, `set_service_delivery_users`. The offboarding command orchestrates these;
it does not copy their rules.

## Speed and safety

- The write commands run only on reassign and remove actions, never on list, tab or chat paths. The preview runs when a
  person is opened in the Staff panel or a removal dialog opens, for that one person only. Preview reads are bounded (item cap,
  with a clear "split into batches" result above it). No new subscriptions, polling or hot-path queries.
- The Staff panel's list of people with counts is a separate read, designed and measured with the Staff panel step; it is not
  part of this migration.
- Existing guards stay. Extending them to cover items 3 and 5 follows once the commands exist (decision 3).
- Migrations are additive and immutable; no existing rows are rewritten. Rollback is dropping the new functions and receipt table.
- The UI keeps the app-speed rules: local pending state, no blocking overlay for unrelated tabs, no "removed" until the
  transaction commits.

## Testing before any user sees it

Extend the full-schema harness with one scenario per footprint row, plus: atomic rollback when one item fails, idempotent retry
with the same request id, request id reuse with different input, a recipient who is not eligible, a changed fingerprint,
concurrent offboarding of two people from one client, and access checks showing the recipient can now see the work and the
former member cannot.

For `reassign_workspace_member_items` specifically: a partial plan moves only the planned items and leaves the rest and the
membership unchanged; a changed fingerprint on a planned item fails while a change to an unplanned item does not; an item that
already moved to someone else fails; a recipient already on the roster or already a collaborator ends with one entry, not two;
the source as recipient, a non-member recipient and an admin moving an owner's items are refused; moving everything and then
running `offboard_workspace_member` removes the person with nothing left behind.

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

1. Read-only report of existing orphaned assignments (no schema change). Written and checked; production results pending.
2. Migration with the preview command, `reassign_workspace_member_items`, `offboard_workspace_member`, their shared internal
   function and the receipts table, plus full-schema scenario tests. Needs explicit approval because it is a new migration.
3. Removal dialog and the two existing entry points, behind the same permission checks as today.
4. Staff panel: the people list with counts (its own bounded read), the per-person footprint and bulk "Move to".
5. Backstop guards (decision 3) and a Settings > Services "take off this service" path using the same commands.
