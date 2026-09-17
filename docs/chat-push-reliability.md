# Chat push reliability patch — 17 September 2026

Status: implemented in the isolated `codex/chat-push-reliability` worktree. Application and database fixtures are validated locally. These migrations have not been applied to production, and this patch has not been deployed.

## Notification rule

Only current participants qualify: the declared direct-chat pair, current team members, or the existing client-chat roster, intersected with current workspace membership. Being a workspace owner/admin, an eligible but unselected client-service assignee, or a mentioned outsider does not independently add a recipient. The sender is excluded. Dispute notifications keep their resolver-only targeting. Existing BE system messages keep their previous explicit notification policy.

Every registered subscription belonging to an eligible recipient gets its own durable delivery job in the same transaction that saves the message. Membership and subscription ownership are rechecked immediately before dispatch. Push permission and a valid subscription are still required on each device.

A chat is active only when that exact conversation is selected in the active workspace tab, its document is visible, its top-level window is focused, and its connection is live. If none of a user's devices satisfies that rule, every eligible device gets a delivery attempt. Having another conversation open, retaining the chat in an inactive tab, or closing the app does not disqualify the recipient.

Read tracking also requires attention. Its visibility-only uses for media playback and layout remain separate. Client read cursors now store the last-read message's timestamp rather than the time a delayed HTTP request finishes.

## Recovery and boundaries

- Departure writes an inactive tombstone. A per-mounted-tab revision fences older heartbeats, even if authentication or network requests finish out of order. Switching chats also replaces the prior conversation. An old mounted client cannot recreate unsequenced suppression after the database migration.
- A fresh active lease defers a job; it never deletes the notification. Departure wakes deferred jobs. If a close/beacon never reaches the server, the 45-second lease expires. With a healthy once-per-minute scheduler and no backlog, recovery can take approximately 105 seconds in the worst case after the last heartbeat.
- Notification work is captured even if the `after()` callback never runs or encrypted save confirmation fails. Expired worker leases and provider failures remain retryable with exponential backoff, capped at 15 minutes, for the message's 24-hour useful lifetime. Provider 404/410 revokes the failed subscription without stopping other devices.
- Claims serialize briefly in the database; provider calls run with concurrency eight outside the message response. A device/conversation has one current delivery lease. Newer queued messages supersede older previews, retaining the replacement-notification behavior. Unread preview counts are bounded at `100+`.
- Subscription saves update the existing endpoint in place and replace obsolete endpoints transactionally. Background reconciliation only repairs an already-enabled device, never silently transfers another account's subscription or enables a device that is off. Settings compare the browser endpoint and encryption keys to a server fingerprint.
- Display is invoked before receipt transport. Each job records provider acceptance separately from a capability-scoped report that `showNotification()` resolved or failed. This is **not** proof that the OS presented a banner or that the person saw it. Declarative fallback display can occur without a receipt. Receipt failure never blocks display.
- An uncertain provider acknowledgement can cause a retry of an already accepted push. Stable tags/topics coalesce its display; the system does not claim exactly-once delivery. Access revocation cannot retract an encrypted push already accepted by a provider.
- Retrying an interrupted callback uses a neutral `New message` preview. Plaintext messages are not stored in the outbox. The normal callback retains the current chat name/message preview and mention handling.

The previously inspected missed notification had provider acceptance on both Apple subscriptions. This patch addresses confirmed application defects and adds missing recovery/display evidence; it does not establish the device-level cause of that particular incident.

## Validation

- `npm test`: 1,136 tests passed, zero failures.
- `BE_PGLITE_ROOT=/private/tmp/be-pglite node scripts/validate-chat-push-recovery.mjs`: executes the real SQL migrations and existing client access function against isolated Postgres fixtures. Covers recipient boundaries, both devices, atomic rollback, ordered departures, other-chat activity, killed-app lease expiry, crashed workers, revocation, read races, supersession, subscriptions, receipt capabilities, scheduler gating/throttling and retention SQL. Cron/network substitutes do not contact real providers.
- `tests/chat-push-reliability.test.mjs`: executes application functions, the actual tracker lifecycle and service worker with controlled dependencies. Covers focus, retained tabs, pagehide/unmount, per-device fan-out, one-device failures, pre-send revocation, immediate display, receipt failure and failed encrypted confirmation.
- Changed-file ESLint, `git diff --check`, and production `next build --webpack`.
- Read-only production membership preflight: 25 conversations, 15 direct participant rows, zero invalid direct participants, zero team memberships outside their workspace; results were below the query cap.

No production messages were sent as tests. These are SQL/runtime fixture results and a production build, not authenticated end-to-end Chromium/WebKit or physical iPhone, Android, or desktop delivery results.

## Performance and release gate

No new awaited browser request, provider call, or decryption step is added to sending, navigation, tab switching or typing. The original duplicate initial activity request is removed. Subscription reconciliation starts after window load, requires an existing granted subscription, runs only in the top-level document, and is throttled to at most once a minute on foreground events; it adds no polling timer.

The authoritative message transaction now includes indexed recipient selection and one small outbox insert per subscribed recipient device. Recipient selection starts with the actual roster rather than scanning every workspace member. Background claim batches are bounded; unread counts cap at 100; diagnostics expire after 30 days.

That added transactional fan-out has **not** been established as latency-neutral at production-scale team sizes. Under `app_speed.md`, a matched production-build save/acknowledgement comparison and growing-team fixture measurements remain a release gate. No claim of improved or unchanged end-to-end speed is made from tests or compilation. The application patch is ready for review; it is not represented as a completed production repair.

## Application-first rollout

1. Deploy the application commit and verify its exact Vercel deployment is Ready. The legacy sender is used only while the new claim RPC is missing, so the database cutover does not disable existing sends. Subscription saves also retain a compatible application-first path. Do not treat fallback mode as the completed fix.
2. Apply `20260917090000_chat_push_delivery_recovery.sql`, `20260917090500_chat_subscription_integrity.sql`, then `20260917091000_chat_push_scheduler.sql`. The membership integrity migration stops rather than rewriting history if it detects invalid participants. Confirm all migrations and schema-cache reloads succeeded.
3. Confirm the existing Vault `sop_work_cron_secret` matches the deployed worker's `SOP_WORK_CRON_SECRET`/`CRON_SECRET`, without exposing either value. Verify a trusted request to `/api/cron/chat-push` returns 202. Then set `public.chat_push_scheduler.enabled = true` for its singleton row. Verify the `chat-push-recovery` cron job and `pg_net` responses; enabling the flag alone is not execution proof.
4. Reload existing application tabs on the test devices so their read-tracking code is current. Confirm worker `betelgeze-pwa-v5`, notification permission, browser/server fingerprint agreement, and one subscription per enabled device.
5. Test the reported sender/recipient pair with permission from the participants: exact chat active; another chat active; the chat only in an inactive tab; no chat tab; app closed; forced termination before departure. Check Mac, iPhone/Safari Home Screen app and Android/Chrome individually, with all devices enabled together. Include loss of connectivity, membership removal and subscription disablement. Compare job status, provider acceptance, display report and the physically observed notification separately.

For application rollback, disable the scheduler before restoring the old sender, retain delivery/diagnostic rows, and account for queued jobs rather than deleting them. Do not run both senders over the same jobs. The new read/activity safeguards are only active with the new application and database path together; rollback does not retain those guarantees.

The service worker keeps the [WebKit declarative fallback](https://webkit.org/blog/16535/meet-declarative-web-push/) and immediate imperative display. Worker receipts are supplementary diagnostics, not an alternative to visible notifications.
