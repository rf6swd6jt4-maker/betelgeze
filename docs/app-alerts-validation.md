# Alerts rebuild validation — 17 September 2026

Contract: `app-alerts.md`. Baseline: `7627cbe7`; isolated branch: `codex/app-alerts`.

## Evidence obtained

- Full repository suite: **1,162 passed, zero failed** (`npm test`). Includes eleven new alerts tests plus updated tracker/read regressions. Tests cover per-conversation failed-read retention, reload recovery, serialized/coalesced writes, newer intent surviving old acknowledgement, account isolation, teardown, confirmed-only counts, row visibility/occlusion, native tab identity, shared summary scoping, notification dismissal and timestamp/ID ordering.
- Push SQL fixture: passed, executing the actual additive migration against isolated PGlite. Covers both chat kinds, recipients, two recipient devices, transaction rollback, ordered departures, expired activity and worker leases, membership revocation, provider retries, read races, same-timestamp message IDs, old-server activity isolation, bounded active-reading deferral, subscription stability, scoped receipts and scheduler gating/retention.
- Read/summary SQL fixture: passed. Covers conversation authorization/AAL2, monotonic reads, microseconds, cleared history, own/system messages, a 10,000-message range capped to 100 results, and indexed range use. Local summary observation was 2 ms; this is not a production latency benchmark.
- Chromium and WebKit: passed at **1280×900** and **390×844**. The fixture imports the actual reader/layout/activity hooks. Each run exercises foreground read acknowledgement; scrolling away while a message arrives; returning to the bottom; hidden retained iframe arrivals; reopening; a shell overlay covering the chat; dismissal; failed read persistence retaining unread state; and online recovery. Each completed run made six read requests for the scripted sequence. The new shared logic keeps activity writes bounded to changes plus the existing heartbeat.
- Changed runtime-file ESLint and `git diff --check`: passed.
- Production Next.js Webpack build: passed, including TypeScript. The isolated validation environment supplies dependencies missing from the older primary checkout; repository lockfiles were not changed.

## Reproduction

Run from the isolated branch with repository dependencies available:

```sh
npm test
BE_PGLITE_ROOT=/path/to/isolated-pglite node scripts/validate-chat-push-recovery.mjs
BE_PGLITE_ROOT=/path/to/isolated-pglite node scripts/validate-communications-unread-sql.mjs
BE_BROWSER_TEST_ROOT=/path/to/isolated-playwright node scripts/validate-app-alerts-browser.mjs
npx next build --webpack
```

The browser harness creates a temporary Next fixture, uses an ephemeral local port, intercepts message-read and activity endpoints, and writes `output/app-alerts-2026-09-17/browser-results.json`. Optional `CHROMIUM_EXECUTABLE`, `WEBKIT_EXECUTABLE` and `BE_ALERTS_OUTPUT` override local browser/output paths. It does not send real business messages or contact a push provider. WebKit's automation protocol omits Blob beacon bodies, so the harness carries that exact payload through intercepted fetch; native Blob/sequence behavior is also covered in the tracker lifecycle unit test. This does not prove real device beacon transport.

The first WebKit fixture failed when its test-only layout omitted the real component's active-tab wiring. Its newest message was actually below the viewport, and the reader correctly retained unread. The fixture was corrected to use the same `useWorkspaceTabActive` layout input as both real chat components; all four configurations then passed. No production visibility requirement was weakened to make that check pass.

## Performance assessment

No provider work or message-history request was added to navigation, startup or the message response. Hosted conversation lists reuse the shell's existing authorized summary; they use a per-kind map for row lookups. A standalone Communications document owns one summary resource. Pending read storage is bounded to 256 metadata entries per owner; writes coalesce per conversation and preserve failures. Hidden tabs do not schedule read-observation frames or pointer listeners. The existing 20-second activity heartbeat and existing reconciliation path are reused; there is no new polling timer. Duplicate activity-state transitions are deduplicated. The new SQL uses the existing per-conversation/read-cursor indexes and adds no recipient fan-out or table scan to message insertion.

These are code-path/resource checks plus synthetic browser regressions. Matched authenticated production latency, large-workspace browser behavior and physical-device battery/latency have not been measured. They remain rollout checks; test/build success does not prove production performance.

## Production evidence and remaining work

Read-only health inspection confirmed that the existing durable pipeline and worker v6 were present. Of 46 returned delivery rows, 40 were provider accepted and six resolved as read; 21 had browser display reports and none had reported display failure. Missing display reports do not establish missing banners. Six subscriptions had zero stored failure counts. The scheduler flag was enabled; this inspection did not execute a recovery job or establish current cron/pg_net health under a new failure.

The changes in this branch and `20260917180000_app_alerts_reading_contract.sql` **have not been deployed/applied**. No production messages, cursors, subscriptions, delivery jobs or scheduler settings were changed. No client or staff member received a test message.

Outstanding release evidence: migration application, exact deployed commit, authenticated end-to-end read/summary behavior, an authorized recovery delivery, and physical Android/Chrome and iPhone/Safari Home Screen checks with multiple subscribed devices. Client-portal visitor read tracking and notifications are deliberately outside this authorized pass.
