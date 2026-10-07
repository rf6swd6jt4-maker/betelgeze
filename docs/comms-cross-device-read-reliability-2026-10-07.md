# Cross-device Comms read convergence — 7 October 2026

## Authorization and scope

The user explicitly approved the investigated application repair and production deployment. Base: `ffae9bb607f5048d8a1cfa1b81e40da389841c01`. Implementation uses an isolated `codex/comms-read-convergence` checkout. Preserve `app_speed.md`, the newest-visible/active-foreground/server-acknowledged reading rules, user data, immutable migrations, and push behavior.

## Reproduced failures

- A current-user database read event delivered to a hosted chat updated its local cursor while the shared summary badge stayed unread. Hosted panels forwarded invalidation through a disabled local owner. Local HTTP acknowledgement used an immediate summary update; remote cursor events and recovery snapshots did not.
- A stalled conversation synchronization request occupied the in-flight recovery slot indefinitely. Repeated safety ticks and focus events could not synchronize. The separate durable read queue could also hold the synchronization promise open.
- Relative-time text uses the current browser time during render; updating that text does not prove any read or unread synchronization occurred.

Live schema-only inspection confirmed account/conversation cursor keys with no device field. Source matches the base production deployment. Available schema metadata does not prove installed function definitions, publication membership or actual device event delivery. A bounded content-free sample of the latest 500 read/unread metrics from the most recently reporting workspace included 17 successful read saves and 480 successful / 3 failed unread requests. These samples do not identify the user's affected session or establish incident causality.

## Repair and ownership

- Normalize authorized own-user cursors from database events and accepted recovery snapshots into the existing confirmed-read path. Apply covered positions immediately to the existing summary owner; preserve newer messages, timestamp microseconds and UUID ordering.
- Deduplicate advancing read positions in at most 1,024 entries per mounted account/workspace summary owner; clear on disposal. Preserve legacy single-message broadcasts during rollout. No new persistent read cache or database state is introduced.
- Batch recovery positions. After the first accepted snapshot, publish only advancing positions relative to existing cursor state. Merge cursor batches through one state update with a linear index instead of repeated array scans.
- Forward hosted invalidations through the existing scoped host event. Deduplicate identical database message events received by the shell and panel using bounded event identity metadata, while preserving distinct events during an in-flight request.
- Share routine and reconnect synchronization through one cancellable operation. Bound both conversation GETs through response parsing at 30 seconds, reject late old-owner responses and callbacks, retain usable data on failure, and reuse existing foreground/reconnect recovery. Trigger durable read-queue flushing without awaiting it in metadata synchronization.

## Performance and UI contract

No new socket, polling cadence, history/body query, database function, migration, provider call or useful-content loading gate. No fetch on scroll or typing. Existing summary reconciliation remains one in-flight request with coalesced follow-up when a distinct newer event invalidates it. Duplicate receipts/message events must not add a request. Deadlines release stalled work; retries continue through the existing scheduler/backoff rather than a new retry loop.

Conversation selection, drafts, scrolling, pane geometry, keyboard/focus, mobile entrance motion and all layout classes are unchanged. Confirmed read receipts clear badges; selection alone does not. Hidden, covered and scrolled-up chats cannot create new reads. New messages after the acknowledged position remain unread.

## Validation

- Full repository suite: 1,500/1,500 tests passed. Meaningful new cases cover confirmed remote reads with failed/slow summaries, snapshot batching, duplicate message events, newer messages, scope/lifecycle isolation, bounded memory, stalled response bodies and recovery deduplication.
- Production webpack build passed using placeholder configuration. Migration-history, changed-file lint and whitespace gates passed; zero new migrations and all 275 historical migrations unchanged.
- Chromium and WebKit foundation suite: 650/650 checks over 40 fixtures, including native shell residency, drafts, viewport and conversation layout. The existing acknowledged-reader pack passed 144/144 over mobile/desktop on both engines.
- New separate-context convergence fixture: candidate 52/52 and baseline 52/52 (baseline assertions intentionally reproduce the old failure). It invokes actual workspace event/snapshot callbacks and actual unread hooks with synthetic transport. Local BroadcastChannel cannot reach the second context. The simulated remote event is delivered to the hosted panel while the shell event is omitted.
- Quiet matched production-React observations: eight remote-read samples cleared in 3–8.4 ms to React layout commit on the candidate, while baseline badges remained unchanged during the 120 ms observation and after the summary failed. Eight snapshot-read samples cleared in 1–2 ms before a held summary response. These are small fixture observations, not production latency, p95, browser paint or device evidence.
- Healthy local acknowledgements: 24 samples per variant. Chromium baseline 0.7–1.2 ms versus candidate 0.6–0.9 ms; WebKit 1–2 ms in both. Both made exactly one summary request per sample. Duplicate remote receipts added zero requests; unchanged repeated snapshots emitted zero cursor broadcasts. The batch merge regression checks linear indexing rather than repeated per-cursor scans.
- The first hosted Linux WebKit run exposed a fixture timing defect: wheel scrolling was still moving after the fixed 50 ms pause. The fixture now waits for 250 ms of stable nonzero scroll position, with a 5-second deadline, before retaining the exact before/after equality assertion. No application scrolling behavior changed.
- Browser reports remain in the candidate's ignored `browser-results/` directory. The new convergence runner is included in the hosted Foundations matrix; baseline mode remains an explicit manual comparison.

Synthetic browser delivery does not establish installed Supabase publication/RLS behavior, authenticated production transport, physical Android/iPhone behavior, or sustained-session stability. Broader existing browser packs, isolated SQL and the exact candidate build also run in hosted CI before release. No production messages, read cursors or user records were changed for validation.

## Release and rollback

Application-only release; no schema or data mutation is needed. Validate the exact candidate commit on the branch with Foundations CI before advancing main, then independently verify production deployment and read-only HTTP health. No real message reads or sends are generated for testing.

Rollback restores the prior application commit/tree while retaining all database state, user read history, messages, drafts and stored files. Existing schema remains compatible. Reopen/reload device installations to test the released JavaScript. User-assisted live cross-device checks and an ordinary working day of stability remain separate acceptance evidence.
