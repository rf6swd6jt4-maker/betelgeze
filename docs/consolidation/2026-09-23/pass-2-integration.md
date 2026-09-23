# Pass 2 integration record

Candidate branch: `codex/platform-consolidation`, in `/private/tmp/betelgeze-platform-consolidation`, based on main `31388081894e6d4143d5bb0d577c0341ec31edf7`. The dirty primary checkout and its dependencies are preserved. This document records local implementation; it is not a production release.

**Status: reviewed local candidate, with an unresolved shell release blocker.** The final draft check can precede React's actual removal of an editor. Native in-panel navigation has an additional uncovered departure path. Automatic approval review blocked the proposed commit wrapper; that patch remains unapplied and alone would not cover the native path. See the [concrete continuation scope](./shell-departure-continuation.md). Pass 2 must not be described as fully complete or safe to release.

## Packages

- Shell recovery: optional session metadata tolerates unavailable storage; closed-tab bookkeeping stays bounded; destructive iframe departure requires a scoped acknowledgement; native render failures have an explicit boundary Retry. No timer-driven reload was introduced.
- Records: a new Note trigger definition fixes invalid shared-trigger field references. New commands make note fields conflict-aware, link edits explicit, and record creation plus associations atomic. Manual asset uploads require an actor/workspace receipt and an immutable upload key. Attachment reads have bounded pages, deadlines and stale-result protection.
- Lead Gen: one reversible code policy pauses mutation/processing/import paths and removes ordinary discovery/read work while retaining administrator history and all underlying data/dependencies.
- Mobile: hidden/deactivated surfaces retire stale touch state and temporary keyboard geometry. Active visible scrolling retains its existing deferral.

See the package reports in this directory for exact behavior, limitations and focused validation. Independent review has included rapid tab intents, delayed acknowledgements, metadata changes during departure, immutable create intent and concurrent browser storage ownership.

## Validation status

Final accepted-source validation:

- `npm test`: **1,309/1,309 passed**, zero failed/skipped/cancelled, approximately 8.42 seconds. Package counts overlap this suite and must not be added to it.
- Disposable PostgreSQL-compatible PGlite validator: **31/31 passed**, zero production calls. Its single serialized connection does not establish multi-connection contention behavior.
- Changed-file ESLint: **72 JavaScript/TypeScript files passed**. The final type-only refusal annotation also passed scoped lint and 19 related tests.
- `git diff --check`: passed. Root speed/alerts contracts, protected alert implementations, dependency manifests and lockfile are unchanged.
- `npx next build --webpack`: **passed**, Next 16.2.11; compilation 6.5 seconds, TypeScript 11.2 seconds, 33 static pages generated, build traces completed. Dummy Supabase credentials point at loopback; no production environment file was copied into this worktree.

The first combined run exposed obsolete source/callback fixture assumptions and an auto-discovered optional SQL validator. These were corrected without weakening behavior checks; the validator now has an explicit command. The final build then caught a refusal helper inferred as `boolean` instead of literal `false`; an explicit return annotation fixed that type error. An earlier restricted-network build could not fetch Google Fonts; the subsequent approved network build and final build completed. Passing these checks does not resolve the shell release blocker.

Logs are retained under `/private/tmp/be-consolidation-evidence/pass-2-final-{suite,sql,lint,build}.log`; compact durable evidence and independent static review are in this directory's `evidence/` folder.

The mobile helper has matched before/after browser evidence: baseline 2/5, candidate 5/5, in both Chromium and Safari at a synthetic 390px frame width. Physical phones, native keyboards and installed PWAs remain unverified.

## Production and Pass 3 gates

The user upgraded Supabase to Pro. Read-only dashboard inspection verifies available scheduled physical database backups, latest observed 23 September 2026 at 05:24:03 UTC. Restore rehearsal and storage-object recovery are separate; see [live checks](./pass-2-live-checks.md).

No migrations, production writes, deployments, client messages, provider jobs, storage-object mutations or external scheduler changes have been performed in Pass 2. Protected alerts implementation and both root speed/alerts contracts remain unchanged.

Before release:

0. Complete and independently validate the shell departure repair in [the continuation scope](./shell-departure-continuation.md). The proposed wrapper has static review only, remains unapplied, and does not cover native in-panel navigation. Mounted React/browser composition and matched navigation timings are required before treating it as complete.
1. Review the exact migration/application candidate together. Rehearse the SQL against an isolated database with representative installed constraints and concurrent connections. The local PGlite connection is useful functional PostgreSQL evidence, not a production lock-contention test.
2. Verify installed schema definitions and record a narrow installation plan. Production has no observed migration registry; do not replay historical migrations or fabricate registry history.
3. Confirm database restore and object-storage recovery requirements, then install the new schema before compatible application callers. New commands must fail visibly when unavailable; there is no fallback to the unsafe old multi-write sequence.
4. Complete accepted Lead Gen work/external process inventory. The source audit cannot disable older deployed processes, ad hoc imports or remote schedulers. Preserve the unrelated chat, SOP and onboarding recovery paths.
5. Add the planned concise contracts/CI gates in Pass 3, validate the exact final candidate, then perform any authorized release with separate commit, schema and terminal deployment evidence.
6. Run authenticated read/navigation checks and isolated-write browser fixtures, compare matched warm/cold performance, and verify Android/Chrome and iPhone/Safari/PWA separately. No real client messages are test fixtures.

Rollback is application-first and data-preserving. Retain additive schema/receipts and historical jobs/links; do not delete records, remove storage, replay creates or disable recovery schedulers to simplify rollback.
