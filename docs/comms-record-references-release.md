# Communications record references

Base: `4b2e83d09a3d14f3a70c13e95a547050edb5492a`. Candidate branch: `codex/comms-record-references`.

## Behaviour and ownership

Internal Team/direct composers share one four-choice `@` picker for current people, work items, assets and relationships. Search is the text after `@`; icons and avatars distinguish kinds. Record links open the existing destination directly, without previews or automatic prefetch. Denied records expose a neutral disabled label.

The composer and shared popup own input and focus. The workspace owns viewport and navigation. `WorkspaceRecordCache` owns bounded reference snapshots; the active conversation resolves visible identities in batches of at most 40. Ordinary messages do not invoke reference lookup. Restored draft references resolve when the composer receives focus, not during bootstrap. Queries, results, caches and cancellation are scoped to the account, workspace and conversation. Returning to the window or chat clears prior reference permission results.

`@[ref](record:TYPE:UUID)` contains no protected label. Server lookup applies current workspace/conversation and canonical record permissions. Send validation runs after accepted-request recovery and only for messages containing references; editing preserves existing references after access loss while validating newly introduced identities. Names never enter notification previews, offline summaries or saved quote text through the reference token. Quoting temporarily displays the generic `Reference` text to preserve selection offsets. Existing person recipient filtering, read cursors, active-chat detection and push scheduling are unchanged.

## Data and rollback

The additive `20261003120000_communication_record_references.sql` installs a server-only RPC. Guarded installation checks exact canonical policy bodies and source SHA-256 and refuses an ambiguous retry. No existing migration, record, message, storage object or accepted work is rewritten. Install schema before the application. Application rollback preserves opaque message tokens and installed functions; never delete sent messages or reconstruct migration history.

Generate the exact release pack with `node scripts/build-communication-references-release.mjs`. Run its read-only preflight, guarded installer and independent postflight against the intended Supabase project. Verify PostgREST supports hoisting the function's statement timeout and that configuration does not disable that setting.

## Validation and limits

Focused component fixtures cover four-row mobile layout, focus retention, atomic insertion/deletion/undo, stale query and account responses, cancelled/stalled reads, visible-only batch resolution, denied links, direct navigation and safe quote offsets. Real canonical-policy SQL fixtures cover cross-workspace/conversation denial, record access, source bounds, exact identity resolution and index plans. Installer rehearsal rejects modified source, policy drift and duplicate installation.

The first prefix-index design adds measurable index maintenance to name updates in isolated SQL fixtures. Its migration is paused under `app_speed.md` while an approach using existing indexes is evaluated. This is not a production speed result or a waiver. Final retrieval choice, full-suite/build/hosted checks, exact release commit, schema installation and production deployment evidence must be recorded before promotion.

Synthetic browser fixtures do not establish authenticated production behaviour, physical iPhone/Android interaction or sustained-session stability. No real client message, read, upload or record mutation is used solely for testing.

Read-only production API metadata on 3 October 2026 confirmed HTTP 200 and PostgREST `14.5` for the intended Supabase project `lhxrgapdrkwdaunwgeje`. This satisfies the version prerequisite for function-setting hoisting. SQL configuration overrides, canonical policy hashes and table/index preflight still need verification; this is not schema-installation evidence. No client rows or SQL changes were involved.

The server normalizes authorized record labels and secondary details to trimmed, single-line text, bounds their UTF-16 length without splitting emoji, and uses `Untitled` for an empty label. The server-to-client regression covers control characters, whitespace-only titles and long Unicode names; permission checks precede display normalization.

The bounded winner ranking treats an exact authorized company name as an exact relationship match even when its primary label is a person's name. A regression with six readable companies confirms that an older exact match precedes five newer prefix matches and a denied exact match is excluded. All six SQL validation groups and the guarded-installer corruption, policy-drift and retry rehearsals passed after this correction. The regenerated paused release pack has migration SHA-256 `cc0b0334f3c77c4f9d0fe6a78c32c3fa44147aed60b583c4ac9e21689d5169f3`, wrapper SHA-256 `78ac9e2058de87e1919d1fe186551ab74e4cee3afbbeb8586dd1cdc81049825d` and RPC body MD5 `418baa5a7d470b263335c84699e3db6a`. These checks do not authorize production installation or resolve its speed and lock gates.

The static service-worker cache advances from v6 to v7 solely to refresh the offline renderer's generic reference text for existing installations. Notification handlers, subscriptions, read behaviour and IndexedDB message/draft storage are unchanged.

### Local acceptance evidence, 3 October 2026

- `npm test`: 1,452 passed, zero failed/skipped, including plain-chat observer lifetime and static offline-cache refresh coverage. Log: `/private/tmp/comms-references-accepted-tests.log`.
- `node scripts/browser/run-foundations.mjs`: all 34 fixture runs passed, with 294 checks per engine across Chromium and WebKit (588 total). Log: `/private/tmp/comms-references-accepted-foundations.log`; preserved report: `/private/tmp/comms-reference-foundations-accepted.json`.
- After the final duplicate-label hint change, `node scripts/browser/run-foundations.mjs --fixture=comms-references-mobile` passed all 19 reference checks in each engine (38 total), with no unexpected network requests or page errors. Log: `/private/tmp/comms-references-final-picker-foundations.log`; preserved report: `/private/tmp/comms-reference-final-picker-foundations.json`. A sandbox-only browser launch failure preceded the successful loopback run and did not execute any test cases.
- The complete-diff migration-integrity and scoped lint gate passed against base `4b2e83d09a3d14f3a70c13e95a547050edb5492a`; all 272 historical migrations remain unchanged.
- Matched ABBA component measurements use production React, identical synthetic 60-message data and a 390px browser viewport, with 96 samples per revision/engine for mount, resident activation and append, and 384 typing samples. Plain paths make zero reference requests. The lazy lifecycle tests additionally establish zero reference observers/focus listeners for ordinary chats.
- `node scripts/browser/measure-comms-references.mjs`: final resident synchronous p95: Chromium 2.9 → 2.6 ms, WebKit 3 → 3 ms; resident two-frame observation: 35.0 → 35.2 ms and 68 → 68 ms. Typing synchronous p95: 2.9 → 2.9 ms and 3 → 3 ms. Mount synchronous p95 varies 12.0 → 12.6 ms and 9 → 10 ms, while mount two-frame observations are 34.2 → 33.4 ms and 66 → 66 ms. The earlier resident-tail increase did not reproduce; these samples do not establish universal non-regression. Report: `browser-results/comms-reference-performance.json`.
- Mobile Chromium/WebKit screenshots show four compact suggestions and inline/disabled references. This is browser emulation, with no physical-device or authenticated production claim.

Production migration, hosted exact-commit checks and deployment have not run. The source remains an isolated candidate pending the user's retrieval/write-cost choice and access to the signed-in dashboard windows.

### Production JavaScript comparison

Clean baseline `4b2e83d` and the final candidate both passed Next.js 16.2.11 webpack production builds with the same installed dependencies and placeholder environment (`NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:9`, both Supabase keys `local-build-placeholder`, telemetry disabled). Baseline build ID: `U25qxzAQ6Vy-h7vBtSys8`; candidate: `SOJx_vYRjdRIX5jM2FwUw`.

| Compiled resource set | Baseline gzip bytes | Candidate gzip bytes | Change |
| --- | ---: | ---: | ---: |
| Comms route, layouts and loading fallback | 295,668 | 295,777 | +109 |
| Comms including active Team mode | 450,779 | 456,231 | +5,452 |
| Comms including active Clients mode | 453,127 | 458,436 | +5,309 |
| Queue route, layouts and loading fallback | 298,880 | 298,991 | +111 |
| Relationships route and layouts | 322,595 | 322,030 | -565 |

The comparison reads the route's exact client-boundary dependency chunks from Next's client-reference manifest, combines root main files and root/workspace layout chunks, then adds the active Comms mode from `react-loadable-manifest.json`. Each unique JavaScript resource is compressed separately at gzip level 9. All reported chunk counts are unchanged. The Team and Clients deferred sets add 5,343 and 5,200 gzip bytes respectively; shared composer/message code reaches both modes. Initial-route raw byte changes are only 49 bytes for Comms, 53 for Queue and 47 for Relationships, with generated chunk references and compression variation affecting gzip totals. The fixture-only +40 KB estimate did not represent production dependency sharing and is superseded by this comparison.

This establishes compiled resource sizes, not production transfer encoding, authenticated request latency or useful paint. CSS, media and request headers are excluded. It does not prove a zero-cost first Comms load: the active mode includes additional code, including for conversations without record references. Local manifests, copied chunks, the comparison script and JSON report are preserved in `/private/tmp/be-reference-production-chunks`; matched build logs are `/private/tmp/be-reference-production-{baseline,candidate}-build-matched.log`.

### Installation lock gate

The current indexed installer must not run on production as written. Its ordinary `CREATE INDEX` statements acquire locks that block table writes and retain those locks through transaction completion. The five-second lock timeout limits waiting to acquire a lock; it does not limit how long successful index construction holds it. PostgreSQL documents these [table-lock rules](https://www.postgresql.org/docs/17/explicit-locking.html).

If the user selects the indexed approach, review and rehearse a concurrent installer first: execute each `CREATE INDEX CONCURRENTLY` separately outside transaction blocks, verify its exact definition and valid/ready state, then install the RPC and grants in a short transaction. Inspect live table sizes, long transactions, resource headroom and execution-session settings first. A failed concurrent build may leave an invalid index that still adds write overhead; an uncertain result needs catalog inspection and explicit recovery. Neither `IF NOT EXISTS` nor application deployment proves installation succeeded. This alternative is not implemented or executed while the speed choice is pending.
