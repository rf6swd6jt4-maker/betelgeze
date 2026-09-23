# Pass 2 integration record

Candidate branch: `codex/platform-consolidation`, in `/private/tmp/betelgeze-platform-consolidation`, based on main `31388081894e6d4143d5bb0d577c0341ec31edf7`. The dirty primary checkout and its dependencies are preserved. This document records local implementation; it is not a production release.

Local checkpoints: `1f82aa81` (table-specific Note trigger), `eeccc560` (atomic record commands and durable outcomes), `a8235c3f` (reviewed application/tests/audit artifacts), and `7a35b73d` (continuation scope and historical evidence). These commits were not pushed. The original zero-context shell proposal is retained as a historical artifact; the approved continuation supersedes it with the implementation described below.

**Status: the approved host/native departure continuation is implemented and locally validated. Production promotion remains gated.** The user's explicit approval reopened work after the earlier automatic-review rejection. Final owner/draft checks now share the destructive host React commit; native push/replace uses the same in-process owner. Independent review also closed stale popstate rollback, StrictMode reopen replay, late owner/document replacement and account-scope gaps. The historical proposal alone did not cover those paths. See [implementation and focused evidence](./shell-departure-continuation-validation.md) and [remaining navigation boundaries](./navigation-departure-boundaries.md). Local validation is not a universal draft-recovery or release-safety claim.

## Packages

- Shell recovery: optional session metadata tolerates unavailable storage; closed-tab bookkeeping stays bounded; destructive iframe departure requires a scoped acknowledgement; native render failures have an explicit boundary Retry. The continuation binds final draft/owner validation to host/native destructive React commits, preserves normal scheduling for retained owners, and refuses stale, failed or superseded work. No timer-driven reload was introduced.
- Records: a new Note trigger definition fixes invalid shared-trigger field references. New commands make note fields conflict-aware, link edits explicit, and record creation plus associations atomic. Manual asset uploads require an actor/workspace receipt and an immutable upload key. Attachment reads have bounded pages, deadlines and stale-result protection.
- Lead Gen: one reversible code policy pauses mutation/processing/import paths and removes ordinary discovery/read work while retaining administrator history and all underlying data/dependencies.
- Mobile: hidden/deactivated surfaces retire stale touch state and temporary keyboard geometry. Active visible scrolling retains its existing deferral.

See the package reports in this directory for exact behavior, limitations and focused validation. Independent review has included rapid tab intents, delayed acknowledgements, metadata changes during departure, immutable create intent and concurrent browser storage ownership.

## Validation status

Final accepted-source validation:

- `npm test`: **1,322/1,322 passed**, zero failed/skipped/cancelled, approximately 6.70 seconds. The focused continuation group passes **43/43**; those tests overlap the full suite and must not be added to it.
- Disposable PostgreSQL-compatible PGlite validator: **31/31 passed**, zero production calls. Its single serialized connection does not establish multi-connection contention behavior.
- Changed-file ESLint: the original 72-file package passed. The final combined check of all **10** continuation application, helper, test and fixture files passes with zero errors/warnings. The background-runtime test correction anchors the actual frame handler rather than the new early native rejection guard, preserving the existing behavior assertion.
- `git diff --check`: passed. Root speed/alerts contracts, protected alert implementations, dependency manifests and lockfile are unchanged.
- `npx next build --webpack`: **passed**, Next 16.2.11; compilation 9.8 seconds, TypeScript 11.3 seconds, 33 static pages generated, build traces completed. Dummy Supabase credentials point at loopback; no production environment file was copied into this worktree.

The original combined run exposed obsolete source/callback fixture assumptions and an auto-discovered optional SQL validator. These were corrected without weakening behavior checks; the validator now has an explicit command. A refusal helper received an explicit literal `false` return annotation after a build type error. An earlier restricted-network build could not fetch Google Fonts; approved subsequent builds completed. During the continuation, a source-slicing test matched the new native rejection guard instead of the original frame handler; correcting the exact anchor restored the check, and the complete suite passed. No protected alert implementation or contract was changed.

Original logs remain under `/private/tmp/be-consolidation-evidence/pass-2-final-{suite,sql,lint,build}.log`. Current continuation logs use `pass-2-navigation-final-{suite,lint,build}.log`; focused results use `shell-continuation-focused-tests.log`. Compact durable evidence and independent static review are in this directory's `evidence/` folder. The [browser continuation report](./shell-browser-continuation.md) records the final mounted React composition, source hashes, browser results and timing limitations separately.

The mounted shell fixture improves from **20/32 to 32/32** in Chromium and in the completed Safari run. Final Chromium production and development StrictMode both pass 32/32. The Safari-tested callback/helper bundle is byte-identical to the final candidate; its revised timing harness could not be confirmed complete after native window/background suspension problems. Final Safari timing, full-component authenticated navigation and physical-device behavior remain unverified. The small corrected Chromium timing samples show similar warm-switch medians (28.1 ms baseline, 28.3 ms candidate); they are synthetic observations, not production performance proof.

The mobile helper has matched before/after browser evidence: baseline 2/5, candidate 5/5, in both Chromium and Safari at a synthetic 390px frame width. Physical phones, native keyboards and installed PWAs remain unverified.

## Production and Pass 3 gates

The user upgraded Supabase to Pro. Read-only dashboard inspection verifies available scheduled physical database backups, latest observed 23 September 2026 at 05:24:03 UTC. Restore rehearsal and storage-object recovery are separate; see [live checks](./pass-2-live-checks.md).

No migrations, production writes, deployments, client messages, provider jobs, storage-object mutations or external scheduler changes have been performed in Pass 2. Protected alerts implementation and both root speed/alerts contracts remain unchanged.

Before release:

0. Resolve the documented legacy Next transition, frame hard-navigation and browser document-unload boundaries for editable routes. The host/native React repair now has independent review and mounted browser evidence; it does not certify these separate paths. A boundary reset also cannot guarantee recovery of a permanently rejected lazy import. Use the [boundary inventory](./navigation-departure-boundaries.md) as the starting point for Pass 3.
1. Review the exact migration/application candidate together. Rehearse the SQL against an isolated database with representative installed constraints and concurrent connections. The local PGlite connection is useful functional PostgreSQL evidence, not a production lock-contention test.
2. Verify installed schema definitions and record a narrow installation plan. Production has no observed migration registry; do not replay historical migrations or fabricate registry history.
3. Confirm database restore and object-storage recovery requirements, then install the new schema before compatible application callers. New commands must fail visibly when unavailable; there is no fallback to the unsafe old multi-write sequence.
4. Complete accepted Lead Gen work/external process inventory. The source audit cannot disable older deployed processes, ad hoc imports or remote schedulers. Preserve the unrelated chat, SOP and onboarding recovery paths.
5. Add the planned concise contracts/CI gates in Pass 3, validate the exact final candidate, then perform any authorized release with separate commit, schema and terminal deployment evidence.
6. Run authenticated read/navigation checks and isolated-write browser fixtures, compare matched warm/cold performance, and verify Android/Chrome and iPhone/Safari/PWA separately. No real client messages are test fixtures.

Rollback is application-first and data-preserving. Retain additive schema/receipts and historical jobs/links; do not delete records, remove storage, replay creates or disable recovery schedulers to simplify rollback.
