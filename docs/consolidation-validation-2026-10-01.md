# Consolidation validation — 1 October 2026

## Candidate and scope

Comparison base: `36747562015eeb88f189097a7229928fae4c0ff1` on `main`. The final application source is commit `6b7e0fbd`; the following report commit changes documentation only. Work was coordinated in an isolated integration checkout, with separate loading, Library authorization and read-acknowledgement workers. The primary checkout remained unchanged.

The candidate repairs shared loading presentation, relationship context navigation and the mobile right drawer, Library asset authorization, read-acknowledgement recovery, and native modal cleanup across tab lifetimes. It extends the existing owners in `platform-foundation.md`; it does not replace platform architecture.

- [Panel loading behavior and resource evidence](panel-loading-consistency-2026-10-01.md)
- [Relationship context and modal lifecycle](context-overlay-reliability-2026-10-01.md)
- [Library authorization and bounded attachment reads](library-authorization-2026-10-01.md)
- [Read acknowledgement recovery](comms-read-reliability-2026-10-01.md)

## Completed local validation

All checks below completed successfully on the integrated application source, including the final removal of duplicate work-detail attachment prefetch where relevant. Browser fixtures use the real components/hooks and synthetic loopback data. External account/message requests are blocked.

| Check | Evidence |
| --- | --- |
| Complete repository test suite | 1,407 passed; zero failed, skipped or cancelled |
| Foundation change gate | Changed-source ESLint, whitespace and migration immutability passed; 272 historical migrations preserved, zero new migrations |
| Production compile | `npx next build --webpack` passed with local placeholder Supabase values; no production environment copied |
| Browser foundations | 550 checks, 275 each in Chromium and WebKit |
| Panel loading matrix | 264 states: 33 scenarios in each of four viewports/motion modes per engine, including shared opening components composed in a synthetic shell |
| Native loading transitions | Four engine/viewport cohorts passed; exactly six reads each across cold/deferred/refresh/failure/retry/access-loss scenarios |
| Relationship context and overlays | 40 actual-component/CSS checks passed across Chromium/WebKit, mobile, narrow reduced-motion and desktop |
| Shared UI reconciliation | 28 checks passed, including framed/unframed native dismissal and busy-dialog protection |
| Acknowledged reads | 144 checks passed, 36 per engine/mobile-or-desktop cohort |
| Communications pane lifecycle | 52 checks passed, 13 per engine/mobile-or-desktop cohort |
| Broader Communications interactions | All eight `run-comms-polish.mjs` suites passed in Chromium and WebKit: actions, action edges, fullscreen edges, final actions, media, portals, popups and safe areas |
| Library policy rehearsal | Five isolated PGlite groups passed using effective database policy bodies, including revoked access, selected-service denial, private notes, MFA, role demotion and 5,000 denied links |

The local Library SQL fixture used pinned `@electric-sql/pglite@0.5.8` outside the repository. A denied-heavy attachment query used `asset_work_items_pkey` and authorized no more than 20 candidates. This is isolated policy/query-shape evidence, not a production performance measurement.

Negative controls reproduced the repaired defects: the prior native loading implementation produced a duplicate initial refresh indicator; the prior retained-dialog implementation failed iframe-deactivation cleanup; the prior reader failed retained-dialog close cases; and the prior queue lost a newer read intent arriving during promise settlement. Each candidate regression passes.

The Foundations workflow now runs native loading, relationship/modal lifecycle and Library authorization regressions alongside its existing gates. Hosted checks for the exact PR head must be evaluated separately; successful local checks are not evidence that hosted checks or deployment have completed.

Local logs are stored under `/private/tmp/consolidation-*.log`, with browser JSON/screenshots under the ignored candidate `browser-results/` directory. These are local evidence and are not committed artifacts; hosted workflow logs provide reviewable remote evidence once complete.

## Data preservation and resource boundaries

No schema or migration changed. `app_speed.md` and `app-alerts.md` are unchanged. No production user/client records, messages, read cursors, files, memberships, provider connections or stored drafts were mutated for implementation or testing.

Loading/context presentation adds no polling, banner request, new cache or minimum loading duration. Read recovery adds bounded settlement work and native-dialog invalidation listeners while preserving the acknowledgement-only unread contract. Library attachment authorization uses two parallel source-link windows of 21 rows each, then at most 20 independently authorized targets per lane. The obsolete full work-detail attachment prefetch and unused image signing have been removed.

The Library workspace list still has its existing 160-record/24-preview limits. This repair does not make discovery exhaustive. Asset-preview signed URLs retain their existing one-hour lifetime; private resource download URLs retain their 60-second lifetime. High-fanout direct asset linked-record reads retain their pre-existing Data API ceiling; growth behavior there was not established by this repair. Synthetic tests establish specific lifecycle and authorization behavior, not unchanged production latency under every workload.

## Remaining release evidence

This candidate has not been merged or deployed to production. Release remains subject to `reliability-release-gate.md`, including exact-head hosted checks and an isolated authenticated owner/staff workflow. Current production schema and installed policy state must be checked during release; executing policy bodies locally does not establish production installation state.

Authenticated full-shell cold/warm navigation, Library role/selected-service cases, message acknowledgement under background/resume, and repeated drawer/modal transitions still need production-equivalent verification. Android/Chrome and iPhone/Safari/PWA physical-device confirmation remain outstanding. Browser emulation is not physical-device evidence. Broader platform acceptance requirements, including sustained production observation and recovery rehearsal, remain separate from these scoped repairs.

Rollback is application-only: revert the application changes while preserving records, stored files, accepted work, pending read positions and historical migrations. There is no data conversion to reverse.

## Checkout cleanup

The three completed worker worktrees were archived through the Codex managed-worktree API after their commits were integrated and their processes stopped. The primary checkout stayed clean at the comparison base. The integration checkout remains available for PR review; its tracked and non-ignored untracked files are committed. Final clean status is checked again after publishing the draft PR.
