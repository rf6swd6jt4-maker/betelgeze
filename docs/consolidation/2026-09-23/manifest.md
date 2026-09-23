# Betelgeze consolidation manifest

Audit date: 23 September 2026. Status: Pass 1 findings; not a completed release.

Pass 2 is authorized and implemented separately in this worktree. Preserve the original findings below as the baseline. Updated Pro/backup evidence is in [pass-2-live-checks.md](./pass-2-live-checks.md); package reports and the final Pass 2 integration record distinguish local validation from production release evidence.

The subsequent [Pass 3 integration record](./pass-3-integration.md) covers editor recovery, real PostgreSQL contention rehearsal, CI checks and operating guidance. It supersedes the corresponding local-work status below without changing this dated audit baseline or claiming a production release.

## Scope and authority

The user requested three passes consolidating daily operations and protecting future additions, with explicit protection of client data. The initial preparation and Pass 1 are read-only with respect to application behavior and production. Inspection artifacts and disposable fixtures are local. No migration, provider request, client message, billing change, production data update or deployment has been performed.

Preserve `app_speed.md`, `app-alerts.md`, existing authorization, encryption, concurrency and delivery contracts. Protected alert behavior requires explicit scope authorization before changing it. No production table, historical migration, storage object, user, client or historical record is a deletion candidate in this programme. Existing accepted work must remain recoverable. A backup alone does not authorize deletion or a destructive migration.

## Verified baseline

- Remote Git `main`: `31388081894e6d4143d5bb0d577c0341ec31edf7`, verified with `git ls-remote`.
- Vercel lists that commit's production deployment as Ready: `7JzXRFwcHv1bgtpshJJh2aQyfWAc`. The GitHub Vercel status also reports success. This is deployment evidence, not authenticated UI or physical-device proof.
- Primary checkout HEAD: `d83e0774f0f023f71825f466a090da7705a3b458`, with extensive unrelated tracked/untracked changes. It is not the release source and was not cleaned/reset.
- Isolated worktree: `/private/tmp/betelgeze-platform-consolidation`, branch `codex/platform-consolidation`, based on verified current main.
- Production Supabase was inspected through its signed-in dashboard using metadata and aggregate SELECTs only. No client message bodies, credentials, or storage contents were read.
- `to_regclass('supabase_migrations.schema_migrations')` returned NULL. Installed-object comparison is required; repository filenames do not establish live migration parity. Do not replay the entire migration directory or invent registry entries.
- Installed `enforce_note_link_workspace()` body MD5: `75cb6e5209f6c5d59aefb3ffcfefac5e`; exact match to repository migration `20260918130000_workspace_notes.sql`.
- Installed `prepare_chat_push_delivery(uuid,uuid)` body MD5: `a6dd542e3499cb0375b52a7a894bea3a`. Its local `read_at` declaration is present. Earlier investigation recorded ambiguity errors; current delivery failures and a precise repair need separate verification and protected-scope authorization.
- Lead Gen poll counts: 49 failed, 19 completed, 2 cancelled; no queued/running parent polls at observation. Preserve all history and child tasks; terminal parents do not imply terminal children.
- Live child-task check found eight queued and one running `leadgen_poll_tasks`, all under failed parents. Do not mistake those stranded child states for executable active polls or delete them during quarantine. Investigation/stage-task inventories remain separate.
- Database cron inventory: `chat-push-recovery` every minute; `chat-push-retention` daily at 03:17; `personal-work-queue` every five minutes; `sop-work-recovery` every minute; `whatsapp-window-warnings` every five minutes. All five active. No Lead Gen database cron appears. This does not exclude external workers/schedules or prove successful execution.
- Top-80 `pg_stat_user_tables` inventory is approximate, not an exact preservation snapshot. Selected observed estimates: native messages 920; Lead Gen investigation tasks 5,153; poll tasks 1,353; evidence 1,630; source records 1,310. No deletion or mutation is justified by these estimates.
- Supabase Database > Backups explicitly reports: "Free Plan does not include project backups." No independent recoverable backup/restore was verified. No subscription was changed. Recovery coverage must be established before production schema/data changes, including object storage coverage where applicable.

## Baseline validation

- Initial reuse of the primary checkout's dependencies produced 1,226 passes and three failures: one pre-existing source-format assertion plus two missing-package failures. That dependency tree was older than the audited current-main lockfile.
- Replaced only the isolated worktree's dependency symlink with a fresh `npm ci` (483 packages). Primary dependencies were untouched. With the correct lockfile installation, `npm test` ran 1,241 tests: **1,240 passed, one failed**, none skipped/cancelled, approximately 6.55 seconds. The remaining failure is `tests/admin-okr-maintenance.test.ts:139`, expecting an exact TrendChart CSS class spelling. It is not proof of a rendered chart defect. Do not fix it by weakening a behavioral invariant.
- Focused navigation coverage: 91 passed; mobile motion/controller/origin/state coverage: 42 passed. These overlap the full suite and must not be added to its total.
- Three extra actual-source navigation probes reproduced the draft-retry, renderer-departure and optional-storage defects. They confirm current defects; they are not passing acceptance tests for repaired behavior.
- The additional mobile lost-touchend fixture fails against current code as expected. It is helper-level evidence, not a physical-device reproduction.
- Exact-original Note trigger plus proposed replacement: 13 disposable PGlite/PostgreSQL 18.3 checks passed, including reproduction of both original 42703 failures and verification of the proposed fix's authorization/uniqueness behavior. No production INSERT was used.
- Production build, authenticated operation fixtures and physical-device testing were not performed in Pass 1. Ready deployment is separately recorded above.
- Reproduction scripts and logs are under `/private/tmp/be-consolidation-evidence`; Note trigger script is `/private/tmp/be-note-attachment-trigger-audit.mjs`. Retain/copy audit artifacts before temporary-directory cleanup.

## Confirmed findings and repair packages

| ID | Finding and evidence | Smallest repair | Acceptance boundary |
| --- | --- | --- | --- |
| N1 | Shell Retry forcibly replaces a frame after its draft flusher rejected navigation. Frame-to-native transitions and closure check only native draft owners. Actual source callbacks reproduced the bypass. | One request/document-fenced host-to-frame departure acknowledgement through the existing root receiver. Failed/missing acknowledgement retains the document. | Real mounted frame plus failed/pending draft persistence; close, retry, renderer change, rapid navigation, stale acknowledgements. No unrelated reset. |
| N2 | Optional shell `sessionStorage` writes can throw before tab hydration. Actual callback propagates `QuotaExceededError`. | Safely degrade optional tab/chrome persistence to in-memory state; keep durable draft checkpoints strict. | Quota/security failures during cold entry and navigation still produce a usable shell; failures cannot manufacture saved drafts. |
| N3 | Native host Retry refreshes data but cannot reset the mounted render-error boundary. | Explicit retry/reset ownership, distinct from ordinary refresh. | Mounted throwing component recovers on visible Retry, with ordinary refresh preserving drafts. |
| N4 | Closed tab IDs and per-tab context storage are never pruned despite bounded open tabs. | Prune only retired shell metadata while retaining reopen history and active mounted order. | Long tab churn keeps bookkeeping bounded and preserves current state. No performance number claimed yet. |
| A1 | Live Note-link trigger references columns absent from each other link table. Both valid insert shapes fail with SQLSTATE 42703 in PostgreSQL-compatible disposable fixture. | One additive migration replacing only the trigger function, separating table-specific statements. No record rewrite. | 13 fixture checks passed for proposed function: valid pairs, cross-workspace denial, duplicate uniqueness and retained rows. Live installation still requires reviewed migration and verification. |
| A2 | Note relationship replacement uses a stale complete set, deleting concurrent additions; text save overwrites both fields without baseline checks. | Transactional explicit link deltas or baseline-checked replacement; field-level compare-and-swap, retained conflict drafts. | Concurrent editors cannot silently remove newer links or overwrite newer content. Validate authorization and transaction rollback. |
| A3 | Manual asset creation trusts supplied `storage_path`; generic reads later sign it. | Validate new upload identity against workspace/actor; reuse established signed receipt pattern. Keep historical assets readable. | Forged foreign key/receipt denied; genuine upload and legacy reads preserved. No live exploit attempted. |
| A4 | Attachment GETs can settle out of order or hang; a failed refresh after confirmed attach is reported as failed attach. | Bounded, fenced read ownership; preserve last usable items and distinguish write acknowledgement from refresh. | Delayed pre-write response cannot hide a confirmed link; failure messages accurately describe persisted state. |
| A5 | Picker silently excludes records beyond newest 100; attached lists cap at 80 without continuation. | Bounded scoped server search/cursor pagination with deterministic ordering. | Older entries remain reachable without unbounded loading; account/access changes invalidate correctly. |
| A6 | Create record then link uses separate writes; unchecked compensation can misreport that nothing was created. | Transactional creation/link plus durable request identity; no automatic orphan cleanup. | Lost acknowledgement/retry cannot duplicate or lose records. |
| M1 | Lost touchend across hidden resident-frame lifecycle leaves stale interaction ownership, preventing keyboard layout completion. Deterministic helper fixture reproduced stuck temporary geometry while existing tests pass. | Reset retired gesture state on actual deactivation, preserving visible touch/inertia deferral. | Shell+chat+portal lifecycle fixtures, then equal physical iOS/Android coverage. No reading/activity policy changes. |
| L1 | Lead Gen performs seven Settings reads, two global-search reads, five-second poll processing and globally traced DuckDB work. | Shared quarantine policy enforced at discovery, route, action, API, worker and script boundaries. Preserve archived route identities and data. | No Lead Gen reads/background/provider execution from ordinary Settings/search; no new admission/provider execution through stale entry points. Authorized historical reads remain bounded and accessible. |

Source details: [navigation audit](navigation-audit.md), [mobile audit](mobile-audit.md), [trigger fixture](note-trigger-fixture.json), [exact implementation ownership and gates](implementation-gates.md). Additional attachment facts are in `components/detail/RecordAttachments.tsx`, `lib/record-attachments.ts`, Note editor/actions and `relationships/actions.ts`. The six generic attachment pairs currently use INSERT plus duplicate-key success; do not repeat the obsolete upsert-conflict diagnosis.

## Protected data map

Core protected surfaces: authentication/MFA/workspace membership; Relationships; sale/service/commercial history; active and historical onboarding; Work Queue/SOP fulfilment; Communications; Library/assets/notes; client portals; Admin/Settings; providers used by sold services.

- Preserve original sale/service revisions, commercial adjustments, frozen session definitions, lifecycle history, work-cycle snapshots and accepted outbox jobs.
- Preserve native/client messages, encrypted keys, media authorization, read positions, push subscriptions and queued delivery state. Quarantine is not permission to disable recovery schedulers.
- Preserve asset/note identities, storage keys, link provenance and detached historical context. A failed lookup is not evidence that a record is disposable.
- Preserve `relationships.leadgen_company_id` and historical evidence. Its FK uses ON DELETE SET NULL, so deleting a company would erase provenance even if the relationship survived.
- Preserve all applied migrations and credentials. Duplicate-looking local files and old worktrees may be unrelated user work; no cleanup is authorized on that basis alone.

Before a production data transformation (none proposed for the initial application fixes), collect exact scoped IDs/counts and recovery evidence privately, verify current foreign-key consequences and rollback, and obtain explicit approval. Do not put customer content or credentials in committed evidence. Current catalog estimates are not a backup or reconciliation manifest.

## Why previous fixes can regress

The existing suite has substantial behavior coverage at cache/controller/callback level, but it does not compose the actual React host, iframe document, draft owner and lifecycle together. Header/composer tests can pass while a hidden frame retains a stale gesture. Source-text assertions also confuse implementation spelling with behavior. The only checked-in GitHub workflow deploys the NER service; no application test/build workflow currently enforces the contracts. These are demonstrated gaps, not a claim that all earlier fixes were ineffective.

Current shell already has retained frames, bounded native reads, foreground navigation deadlines, stale-response fences and navigation-intent ordering. Mobile already has a shared geometry controller with headers outside the moving layer. Preserve these owners; a wholesale replacement would discard proven behavior. Supabase resource throttling is not established by this audit; the earlier healthy-capacity snapshot and egress warning remain historical until refreshed.

## Pass 2 / Pass 3 sequence

1. Preserve this baseline; the local validation environment is now installed from the exact lockfile. Turn diagnostic reproductions into behavioral acceptance tests, not tests asserting that defects remain. Inspect the remaining source-format assertion before changing its expectation.
2. Repair draft departure/storage/retry ownership; separately repair Note-link trigger and attachment refresh correctness. Add concurrency checks before changing Note write semantics.
3. Quarantine Lead Gen after parent/child/external-worker inventory. Retain historical data, routes and compatibility structures. Package any optional dependency removal separately after trace verification.
4. Apply the narrow mobile lifecycle repair with shell/portal/read-predicate regression coverage. Avoid inventing a new viewport owner.
5. Add named ownership contracts and scoped AGENTS instructions. Put a fast changed-file check map and full candidate test/build/SQL/browser gates in CI. Source-pattern checks supplement behavioral tests rather than substitute for them.
6. Review the integrated diff independently for data loss, unauthorized scope, stale/missing acknowledgements, permission changes, runtime work growth and rollback gaps. Full tests/build once per candidate; rerun affected checks when findings justify changes.
7. Release application-only changes through an isolated/pilot path first. Migration installation, production activation and protected alert changes are separate gates. Report exact commit, schema state, deployment, authenticated UI and device evidence independently. Observe a normal working day before claiming sustained reliability.

## Open gates

- Exact protected-record inventory and tested backup/restore are not completed; platform project backups are unavailable under the observed plan. No production data mutation may be inferred safe from this audit.
- Broad installed-schema parity is not established; only named function evidence is verified so far.
- External schedules/workers, rollout flag values, R2 inventory and recovery coverage remain to be verified.
- Native error-boundary mounted reproduction, stale chunk/deployment recovery, and complete host/frame departure browser composition remain required.
- Physical iPhone/Safari/PWA and Android/Chrome checks have not been performed. A helper or desktop-browser fixture cannot close that gate.
- Push preparation and onboarding outbox retry failures from the prior task require their own scoped diagnosis. `app-alerts.md` explicitly protects push/read/recovery behavior; do not slip those changes into unrelated shell work.
- No claim of end-to-end latency improvement, all-platform reliability, or absence of production data loss has been made.

## Plan recommendation requested during the audit

The user asked whether to upgrade Supabase. Recommendation: Pro with Micro compute is a sensible operational baseline for current client data; no compute bottleneck has been established that justifies a larger instance. Supabase's current [pricing](https://supabase.com/pricing) lists a $25 monthly Pro subscription, $10 compute credit covering one Micro project, 250 GB egress and seven days of daily database backups. Additional projects/add-ons/usage can change the bill.

Daily backups do not eliminate the gap since the last backup and do not include stored file objects; BE's R2 uploads also require their own recovery policy. [Supabase backup documentation](https://supabase.com/docs/guides/platform/backups) describes the coverage and separate PITR add-on. Upgrade is not evidence that a usable backup already exists, nor does it repair the diagnosed code. No purchase, subscription change or restore was performed by this task.
