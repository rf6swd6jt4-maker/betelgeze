# Betelgeze message reads and alerts

Established 17 September 2026. This is the protected behavioral contract for staff Communications, direct messages, Team chats, and staff-side client conversations.

## Mandatory permission boundary

Read this document before changing anything that can affect message reading, unread counts, read receipts, foreground/active-chat detection, notification recipients, push subscriptions, delivery/retry/suppression, notification display/click handling, or their database functions and schedulers. **Do not edit this document or change those behaviors without the user's explicit permission for that scope.** An unrelated UI, performance, shell, authentication or cleanup task does not authorize changing these rules. Trace indirect effects before editing shared dependencies. Record the authorized scope, evidence, rollout and rollback here with any authorized change. Do not use a historical repair document to supersede this contract.

The 17 September 2026 conversation authorizes this assessment and rebuild. The user explicitly selected:

- Read only when the newest message is visible in the active foreground chat.
- Suppress alerts across the user's devices while that exact chat is actively being read on any one device.
- First make staff, Team/DM and staff-side client-chat alerts reliable. Portal visitor read receipts/push enrollment are outside this pass.

`app_speed.md` and existing authorization/encryption requirements remain mandatory.

### Authorized addition: profile and device settings

The user subsequently explicitly requested a centered profile, a three-dot Edit profile/Security/Log out menu, moving password and account deletion to Security, and independent device notification switches with other devices disabled. This scope authorizes the following changes without weakening the chat-reading contract:

- Security lists real `auth.sessions`, scoped by the signed JWT user and live session, requiring AAL2 and no pending MFA re-enrollment. `account_session_devices` links observed browser installations to sessions and is removed by the session's deletion cascade. It is RLS-protected; only the narrow authenticated RPC exposes the user's safe display fields, never refresh tokens, IPs, endpoints or subscription keys.
- A foreground mount/resume observation, throttled to five minutes, links the current HTTP-only device cookie and updates last seen. No polling or hidden iframe observations. Security loads devices independently of the password/authenticator UI; profile rendering no longer requests the authenticator list. Auth's latest refresh/creation time is the fallback for older installations. Last seen is an observation, not a continuous online indicator.
- Cards represent browsers or installed apps, not unique physical hardware. Known installations deduplicate repeated sessions. The current card validates browser permission and subscription fingerprint before reporting enabled. Remote cards show the saved server subscription setting; they cannot attest to the remote OS permission or physical delivery. Previously signed-in installations show “Not checked yet” until they open the updated app; never infer a subscription match from a shared user-agent. The list is scoped to this account, filters explicitly expired/deleted sessions and returns at most 100 devices. Auth-provider inactivity/timebox policy can additionally invalidate a retained session at its next refresh.
- Only the current device can request push enrollment/deletion. Existing push routes derive the target from the HTTP-only cookie and authenticated user, never a supplied remote device ID. Remote controls are disabled. Browser reconciliation cannot restore a server subscription deliberately deleted by the toggle. Failed saves keep the previously confirmed switch value; stale inspections cannot override a newer save.
- Apply `20260917190000_account_devices.sql` before releasing this addition. If unavailable, Security shows a retryable device error; it never substitutes subscriptions for a session inventory. Existing chat push continues independently. Rollback the UI first; the additive device table/function may remain without changing read, suppression, recipient or delivery policy. No live migration or deployment has yet occurred.

The Auth session columns and refresh-time interpretation were checked against [Supabase's session model](https://github.com/supabase/auth/blob/master/internal/models/sessions.go). See the validation report for fixture and device evidence boundaries.

## What the assessment found

The primary checkout was at `00f37493` with extensive unrelated edits. It was not the current release source. GitHub's main branch was verified at `7627cbe74d9c12f90869a34df6d35a2040a9e42a`. The rebuild is isolated on `codex/app-alerts`; no unrelated edits were copied or overwritten.

At that baseline the system had several independent owners:

1. Client and Team components each inferred reading from selection, document attention and a remembered scroll boolean. Each optimistically advanced local cursors before HTTP acknowledgement, with one pending read slot for the whole component. New pending reads could replace a failed read in another conversation. Their badge helpers also returned zero whenever the chat looked actively read.
2. The shell used a separate authorized unread-summary RPC. Conversation rows could instead count only the message history/metadata loaded by their component. These counts did not have a shared acknowledged snapshot.
3. The activity tracker reported selected chat, foreground focus and live connection. It did not observe latest-message visibility. Scrolling up could leave incoming messages unread while continuously renewing push deferral.
4. Database reads had already been repaired to advance atomically with a timestamp/UUID position. Push preparation still compared timestamps alone. Two messages at the same timestamp could disagree between unread counts and notification eligibility. Browser notification cleanup also compared timestamp strings and could close an unidentifiable notification.
5. Read endpoints saved the cursor and then awaited separate legacy notification cleanup. A cleanup failure could return a failed request even though the read had committed.
6. Durable push capture, device fan-out, provider retries, membership rechecks, ordered activity leases, display reports and a recovery scheduler already existed. Replacing them wholesale would discard useful protections. The application retained a legacy sender if the new claim RPC was absent; fallback operation is not the reliability contract.

Current production metadata was inspected read-only during this assessment: recovery enabled; 46 returned delivery records comprising 40 provider-accepted and six read-resolved jobs; 21 browser display reports, zero reported display failures; six subscriptions with zero recorded failure counts. The live service worker was `betelgeze-pwa-v6`. This proves those components exist, not that every notification appeared on a device. There were no pending records in that returned sample. Scheduler execution under a newly queued recovery job was not tested; `enabled` is not execution proof.

Communications currently uses retained iframe routes; `native` messaging means Team/DM storage and is distinct from the shell's optional native panel renderer. The new reader supports explicit native panel identity too, but that was not established as the cause of the reported production symptoms.

## Simple rules

| Situation | Read state | Alert decision |
| --- | --- | --- |
| Exact chat active, foreground focused, newest saved row painted and visible | Submit a read through that exact message; commit only on server acknowledgement | A live reading lease may defer push while the read is saved |
| Chat selected but scrolled above the newest message | Keep new messages unread | Notify eligible subscribed devices |
| Chat hidden in another workspace tab or Communications mode | Keep new messages unread | Notify eligible subscribed devices |
| Different browser tab/app/window in front, device locked or app closed | Keep new messages unread | Notify eligible devices; an unreported departure lease expires |
| A viewer/modal covers the newest row | Do not infer reading from the underlying chat | Do not renew an active-reading lease |
| Network/read save fails after the row was seen | Keep the confirmed badge; retain the observed position as retryable intent | Deferred jobs remain durable; after the bounded reading grace, recovery attempts delivery if still unread |
| Same chat actually read on another device | Share the acknowledged user/conversation read position | Stop pending sends covered by that position |
| Newer message arrives after a read | It remains unread until itself observed and acknowledged | The older read cannot suppress or dismiss it |
| User leaves an already-read chat | Keep the old messages read | Leaving a chat does not make its history unread again |

Read means observed by the app under these visibility rules, not proof of human comprehension. The trailing edge of a very tall message can establish newest-message visibility; the app does not require an entire tall message to fit on screen.

## Owners and data flow

### Reading and badges

`useConversationRead` is the shared reader for both staff chat surfaces. It checks:

- the active Communications mode and current shell tab identity, including a synchronous recheck at dispatch;
- a visible document and focused top-level window;
- a positioned, nonzero-height pane at the latest scroll position;
- the exact latest message row, its viewport intersection, and hit testing against local/host overlays;
- two animation frames followed by another check, so selection/mounting alone cannot create a read.

`createChatReadQueue` retains one newest observed position per conversation. It serializes saves, coalesces newer positions, gives each request a ten-second timeout, and leaves failed positions pending. Positions contain identifiers/timestamps only. They are persisted in session storage scoped by workspace, account, chat kind and resident-tab identity. Separate mounted copies cannot overwrite each other's pending storage. This survives a page reload within that browser session; it is not a guarantee that a destroyed browser session will restore intent. If intent is lost, unread remains, which is safer than manufacturing a read. Storage failure is reported; pending entries are capped at 256 and overflow is reported without clearing a badge.

Existing reconciliation, focus and online events flush pending intent; there is no new polling loop or eager history request. A seen position may finish saving after leaving the chat, but a hidden chat cannot create new seen positions. Disposal aborts its request and prevents a late response from being published into another account.

Only `advance_communication_read` advances the acknowledged cursor. It verifies authentication/AAL2/membership/conversation access and uses a transaction lock to prevent older concurrent requests from regressing it. The ordering is `(message.created_at, message.id)`, preserving PostgreSQL microseconds. Do not substitute request time, browser wall-clock time, arrival order or a timestamp-only comparison. Message list ordering, unread comparisons, push eligibility and notification dismissal must agree on that ordering.

Read acknowledgements propagate to sibling resident frames and browser tabs within their workspace/account scope. The shell's authorized metadata summary is published to resident chat lists; the shell, mode badges and rows converge on one summary instead of overwriting each other with partial history counts. Standalone Communications owns one summary request. Until a summary arrives, loaded-history counts are provisional. Counts above 99 render `99+`. Stale summaries retain their last known values; they are not converted to zero.

Legacy notification-state cleanup runs after the read response and cannot turn a committed read into an HTTP failure. Local OS notification dismissal occurs only after an acknowledged cursor; it uses timestamp and message ID and retains notifications with insufficient identity. A read on one device does not promise immediate removal of an already-shown notification on a sleeping different device.

### Notification capture and delivery

Message insertion and per-device delivery jobs are committed together by `enqueue_message_chat_push`. Eligible recipients are the existing direct-chat pair, current Team members, or current client-chat roster, intersected with workspace membership. Senders are excluded. Administrative visibility is not an independent subscription to every chat. Mentioning an outsider does not grant access. Existing explicit system-message and resolver-only dispute policies remain distinct.

Each valid subscription at message creation gets its own job. Enabling a new device later does not replay historical message alerts. `processChatPushDeliveries` claims bounded leased jobs and checks membership, message existence, subscription ownership, read position and foreground activity immediately before provider dispatch. One failed device cannot cancel the other devices. A newer unread message may replace an older preview in the same chat; this is grouped notification delivery, not one banner per historical message.

`CommunicationsActivityTracker` uses the reader's same visibility predicate. Only the active mode mounts its tracker. Version 3 means actual latest-row visibility. Old version-2 selection-only sessions cannot suppress notifications after the new migration. The separately named `record_chat_reading_activity` RPC prevents an old server from accidentally labelling old selection heartbeats as version 3 during rollout. Revisions fence out-of-order departures and heartbeats. A live foreground lease defers a durable job; it never deletes it. Deferral is capped at 45 seconds from that job's creation: if no read acknowledgement arrives, a continuously renewed heartbeat cannot suppress it forever. A still-unread message may then alert even if the app looks live; this makes a failed read path visible rather than silently losing the alert. Newer messages can still replace older previews under the grouping rule. Losing a departure request leaves at most the existing 45-second lease before recovery eligibility. With a healthy once-per-minute scheduler and no backlog, that recovery may take about 105 seconds after the last heartbeat. This is an existing recovery bound, not an immediate-delivery guarantee.

Provider failures retry with the existing bounded backoff (up to 15 minutes) within the 24-hour notification lifetime. Expired worker leases are reclaimable. Provider 404/410 removes an invalid subscription. Stable provider topics and browser tags replace previews; uncertain provider acknowledgements can cause retries, so exactly-once display is not promised. No plaintext message bodies are added to the durable outbox.

### Browser and operating system

The worker displays immediately and reports its display API result afterward. Receipt transport must never block display. Retain declarative Web Push compatibility. Do not send silent cleanup pushes: [WebKit requires original Web Push to produce visible notifications](https://webkit.org/blog/12945/meet-web-push/), and [declarative push provides a browser-handled display path](https://webkit.org/blog/16535/meet-declarative-web-push/).

Keep these facts separate: message committed; notification job captured; eligible/deferred/read/revoked; provider accepted; browser reported display; operating system visibly presented; person actually read. Permission, OS Focus settings, connectivity and device behavior are outside a server's control. For operationally critical messages, a future escalation/acknowledgement policy needs separate explicit product authorization; do not silently add email/SMS or claim Web Push alone guarantees attention.

## Protected implementation map

- Reading: `components/communications/useConversationRead.ts`, `lib/communications/read-queue.ts`, `reading-visibility.ts`, `read-state.ts`, `lib/record-version.js`, both Communications workspaces, their layout/scroll behavior and workspace tab-activity contracts.
- Badges: `useCommunicationsUnread.ts`, `useSharedUnreadSummary.ts`, `lib/communications/unread.ts`, `unread-summary.ts`, `unread-broadcast.ts`, `UnreadMessageCount.tsx`, shell Realtime invalidation and summary SQL.
- Push: `components/communications/CommunicationsActivityTracker.tsx`, `lib/push/*`, `app/api/communications/activity`, `app/api/push/*`, `app/api/cron/chat-push`, `public/sw.js`, push settings/subscription reconciliation, message creation callbacks/triggers and their access rules.
- Database: read-cursor/summary functions; recipients; subscription integrity; atomic enqueue, claims, prepare/finish/receipts; activity leases; recovery scheduler and retention. Historical migrations are immutable; alter behavior through a new reviewed migration.

## Release and verification gate

This file describes the authorized contract and the local implementation. It is not a production-completion claim. The changes from this task have not been deployed, and the new migration has not been applied.

1. Verify baseline delivery-recovery, subscription-integrity, scheduler and atomic-read migrations are present. Apply `20260917180000_app_alerts_reading_contract.sql` before releasing this application revision. It adds a separately named version-3 activity function and replaces preparation; it does not rewrite message history, read cursors or existing deliveries. Database-first temporarily favors extra alerts from old clients over missing alerts.
2. Verify the exact deployed commit, health of cron/pg_net recovery, and read/summary RPC availability. An enabled scheduler flag alone is insufficient. Do not use the legacy fallback as evidence of durable delivery.
3. Refresh test installations so the reader/activity code is current. Keep per-device permission and browser/server subscription fingerprint checks. Do not ask real participants to send test messages without their authorization.
4. Verify Chromium/Android and WebKit/iOS equally: active newest row, scrolled-up chat, another chat, hidden mode/tab, shell overlay, background window, lock/unlock, app closure/forced termination, offline recovery, rapid chat switching, equal-timestamp arrivals, delayed read responses, several devices and revoked access. Synthetic browser fixtures are not physical-device evidence.
5. Report tests, SQL fixtures, build, deployment, authenticated UI and physical-device receipt separately. See `docs/app-alerts-validation.md` for this change's actual results.

Rollback: restore the prior application first. Keep the version-3 activity/prepare functions until the rollback's intended notification policy is explicitly approved: prior version-2 clients then receive alerts rather than unsafe selected-chat suppression. Reverting to version-2 preparation restores the diagnosed scroll-away suppression defect. Do not delete pending deliveries or read history. Do not disable the durable scheduler merely to roll back this reader change.
