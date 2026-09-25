# Comms read/unread reliability — 25 September 2026

The user explicitly requested repairs to unread/read/update mechanics after reporting that reading chats did not reliably update counts. This work preserves the established rule: only the newest visible message in the active, focused foreground chat may create a read intent, and only an authorized server acknowledgement clears confirmed unread state. Mobile geometry, composer focus and chat animation owners remain unchanged.

## Reproduced defects and repairs

| Defect | Cause | Repair |
| --- | --- | --- |
| Opening a mobile chat leaves it unread until another interaction | The two-frame read check happens during the inert entrance animation; presentation completes without another check | The shared reader observes relevant visibility changes and rechecks after two frames. Entrance completion, deferred pane attachment, positioning, overlay removal and tab identity are covered. |
| Standalone Comms retains old counts after a message, deletion or remote read | The shell normally owns summary invalidation; standalone workspaces did not notify their owner | Reuse existing workspace Realtime events to invalidate the standalone metadata owner. No second socket or history load. |
| Clear private chat leaves the shell badge stale | Clearance changes private visibility, not a published message/read row | A scoped event invalidates the existing summary owner after the clear acknowledgement, once, even if the subsequent panel refresh fails. |
| Recovery updates chat contents while badges remain stale | Accepted conversation snapshots did not reconcile the authoritative count summary | Accepted roster/recovery snapshots notify the same owner. Ordinary local edit, reaction, checklist and pin refreshes skip this extra metadata request. |
| An invalidation at request settlement is lost | The resource's promise remains pending briefly after its refresh loop finishes | A final revision check starts the coalesced follow-up after settlement. Failure without newer intent does not retry in a loop. |
| Deleting a read-boundary message swallows an unseen timestamp tie | A message foreign key sets the cursor UUID to null; timestamp-only fallback then includes the entire timestamp | Preserve the historical UUID after deletion and use it in the summary/compact inbox fallback. Exact-message access checks still gate cursor advancement. |

## Ownership and performance

- The shell retains one unread metadata owner. Standalone Comms owns one only when no hosted shell exists. Published summaries and confirmed reads remain scoped to account/workspace.
- Visibility observation installs only for the active attentive reader. It normally watches the latest row, pane and their ancestors, direct portal changes, existing layout/viewport events and resize. Broader child discovery lasts only while the pane/row is absent or detached. No timer, network request or history fetch is added by the observer.
- Pointer/key rechecks stop once the current latest position is acknowledged. Activity transitions and notification dismissals are deduplicated. The existing activity policy and its heartbeat cadence are unchanged.
- Read saves remain serialized, durable within session storage and acknowledgement-only. Hidden/covered/inert panes, inactive tabs and scrolled-up history cannot manufacture reads.
- Existing visible safety reconciliation can now add one coalesced metadata GET (normally every 20 seconds while an active Comms mode reconciles). This is intentional recovery for missed events outside loaded history, whose effects cannot be inferred from a bounded local snapshot. There is no new polling timer or hidden-tab polling. `app_speed.md` remains unchanged.
- Server summary counting stays capped at 100 per conversation with the existing indexed predicates. No additional message body or provider request is introduced.

## Database change and rollback

Migration: `20260925120000_preserve_chat_read_positions.sql`.

Prerequisites are the installed cursor tables, atomic `advance_communication_read`, `communication_unread_summary` and compact `communication_native_inbox`. Verify these exact message-FK names before applying:

- `communication_read_cursors_last_read_message_id_fkey`
- `workspace_native_read_cursors_last_read_message_id_fkey`

The migration drops only those message-reference FKs. A read cursor is historical ordering metadata, so its message UUID may outlive the message. It updates two summary functions to consume that retained boundary. No message, conversation, cursor or notification row is rewritten or backfilled. Workspace/user/relationship constraints, RLS, grants, authentication, encryption and exact live-target authorization remain unchanged.

Historical null cursors retain their legacy timestamp-inclusive behavior; the erased UUID cannot be safely reconstructed. This change prevents future loss rather than guessing historical positions.

Application rollback is compatible with retained UUIDs. Preserve this database correction when reverting application UI/code. Recreating the FKs by nulling retained IDs would discard read history and recreate the defect. Do not replay historical migrations or delete data to roll back.

## Validation and evidence boundaries

Base: `f0f49edbc1e6b75fd0ea007a58054665884114f1`, isolated from the dirty primary checkout.

- Full repository suite: 1,333 tests passed.
- Production webpack build: passed using placeholder service configuration; existing Google Font downloads required network access.
- Scoped lint, migration-history and whitespace gate: passed after fixing a fixture-only unused variable and replacing the local browser dependency symlink with the locked install.
- Read integration fixtures: 136/136 passed (34 each in Chromium mobile/desktop and WebKit mobile/desktop). They mount actual reader/summary hooks, queue, broadcasts and mobile surface. Synthetic fetch replaces account I/O. They cover Team/client, mobile/desktop, both engines, delayed/failed acknowledgements, new arrivals during a save, tab identity, inert/hidden ancestors, portal/row attachment, overlay removal, clear invalidation and another browser's confirmed read.
- SQL fixtures run exact functions against isolated PGlite 0.5.8 with real message FKs: both cursor kinds, deletion/timestamp ties, subsequent arrivals, older reads, deleted-target rejection, legacy null compatibility, compact-inbox agreement, grants and current push eligibility. No production calls.
- The baseline resource loses a settlement-time invalidation (one fetch instead of two). The baseline SQL fixture fails the deleted-boundary assertion. The original hook/predicate fails the mobile entrance case without another interaction using `COMMS_READ_BASELINE=f0f49edb`; the candidate passes it.
- Existing foundation and chat-polish browser suites remain required. The Foundations workflow now also runs the read browser fixtures and three read/inbox/push SQL validators.

Final browser counts, candidate CI, exact release commit, installed schema and production deployment status must be recorded in the release handoff. Automated synthetic fixtures do not prove a physical Android/iPhone session, authenticated production behavior, OS notification receipt or sustained-day stability. No real client messages or reads were generated for testing.
