# Pass 2: reversible Lead Gen quarantine

Implemented locally on the isolated consolidation worktree derived from main `31388081894e6d4143d5bb0d577c0341ec31edf7`. This package does not execute SQL, deploy, change provider configuration/schedules, or alter any stored row, status, migration, credential, or storage object.

## Policy and ownership

`lib/leadgen/availability.ts` is the shared code-owned policy. Operations are disabled; administrator history remains available. A reviewed code change can restore admission. There is no second environment flag or database setting that silently re-enables only part of the feature.

Normal panel navigation excludes Lead Gen. `workspacePanelByKey` and `workspacePanelForUrl` retain its historical identity and administrator authorization, so saved URLs and relationship provenance still resolve. Shell direct-search/version exposure changes were handed to the shell owner; this package did not edit `WorkspaceTopBarClient.tsx`.

Unified Settings omits the Lead Gen navigation section and does not mount its section. Its client controls, loader, and actions are dynamically imported only if operations become available. Ordinary global search removes Lead Gen links and executes neither of its two Lead Gen table queries. Search by a relationship's historical `leadgen_company_id` remains supported.

## Admission and worker boundaries

Every exported action in both Lead Gen action files rejects before reading or changing Lead Gen data, uploading branding, or invoking a provider. This includes stale create, retry, cancel, delete, promotion, settings, name, logo, and cover actions. The ordinary workspace Settings actions are unchanged.

Both processing and Sunbiz import HTTP endpoints return HTTP 503 with a `paused` response and `Cache-Control: no-store`, before auth/database work or payload parsing. The response is generic and reveals no account or record information. Heavy runner/import modules are loaded only after admission. The old browser processor's eventual route refresh receives the new history surface, which does not mount polling.

The runner independently returns `{ processed: false, reason: "quarantined" }`. Initial task creation rejects. Direct Sunbiz import, clear/replace, upsert, and health-writing exports reject. All five manual Sunbiz/Arizona import/build/upload CLI entry points reject before their main functions load local configuration or act. This is a reversible pause; no existing work is cancelled or marked complete.

The coordinator's Pass 1 production inventory found 49 failed, 19 completed, and 2 cancelled parent polls, with eight queued and one running child belonging to failed parents, and no database Lead Gen cron. This package did not rerun that production query. External schedulers, old running deployments, separate NER deployment and remote workers remain a coordinator inventory/promotion concern. Deploying these guards cannot recall a provider request already accepted by an old process.

## Historical data and bounded reads

- `/[workspaceSlug]/leadgen` retains the authorized latest-poll leads view, source links, copy action, and relationship links. It omits delete/new-poll actions and refresh.
- `/leadgen/new` becomes an administrator-authenticated paused page with a history link and no Lead Gen configuration reads.
- `/leadgen/polls` returns saved parent summaries before creator/task/investigation/evidence scans. It reads at most 41 parents to display 40 and determine whether another page exists. Timestamp-plus-ID keyset pagination preserves PostgreSQL timestamp precision and reaches older history without offset growth. Cursor values are validated before entering the PostgREST filter expression.
- `/leadgen/poll/[pollId]` retains scoped details. All diagnostic collections have explicit limits: 200 source records/companies/evidence, 500 source tasks/investigations/claims/scores, 1,000 company-stage rows/catalog entries, and 10 stages. The page discloses sampled diagnostics. Stored poll totals remain separate. Automatic refresh and live duration timers are absent while paused.

All source modules, packages, historical migrations, capability values, workspace branding fields, relationship foreign keys/source types/native references, evidence and accepted jobs remain. Global DuckDB tracing is deliberately unchanged until separate artifact validation justifies narrowing it.

## Verification and evidence boundaries

Executed behavior fixtures invoke the actual transpiled server functions/routes with throwing side-effect dependencies or an instrumented database. They cover all stale actions, paused API responses, direct runner/import denial, accepted-state preservation, terminal eligibility after restoring the code policy in a fixture, all five CLI guards, administrator-only historical identity, New Poll short-circuit, keyset paging/filter validation, Settings omission, zero Lead Gen search reads, retained relationship-provenance search, and bounded read-only poll details with refresh disabled.

- 12 new quarantine tests pass.
- 87 combined Lead Gen and capability tests pass.
- Changed-file ESLint passes.
- Scoped `git diff --check` passes.
- A whole-worktree raw `tsc --noEmit --incremental false` exposed existing test-source extension/type errors plus concurrent shell edits; it reported no error in this package's application files. It is not recorded as a passing application build.

Commands and logs:

```sh
node --test --disable-warning=MODULE_TYPELESS_PACKAGE_JSON tests/leadgen-*.test.* tests/workspace-capabilities.test.ts
```

Local evidence is under `/private/tmp/be-consolidation-evidence/leadgen-pass-2-tests.log`, `leadgen-pass-2-lint.log`, and `leadgen-pass-2-typecheck.log`. The root integrator owns the final full-suite and production webpack build. No authenticated browser, physical-device, deployment, provider, or production-mutation result is claimed here. The read reduction is source/fixture evidence, not measured production latency.

## Rollback and reopening

Revert the quarantine application change or restore the shared policy only after reviewing external workers and accepted jobs. No data rollback is needed or permitted. The original operational routes/actions/modules are retained. Previously accepted work keeps its original IDs, snapshots and statuses. Before reopening, recheck worker eligibility/authorization and do not treat old running/queued children of terminal parents as newly accepted work. Preserve all non-Lead Gen outboxes, schedules, read/unread behavior and alerts contracts.
