# Pass 3 integration record

Candidate: `codex/platform-consolidation`, isolated at `/private/tmp/betelgeze-platform-consolidation`. This pass follows local checkpoint `bd35ea85`; the release comparison remains main `31388081894e6d4143d5bb0d577c0341ec31edf7`. Read-only remote inspection on 23 September confirmed main at that baseline. The user's dirty primary checkout is preserved.

This is a **local consolidation candidate**, not a production release. No client records, stored objects, live credentials, provider jobs, protected alerts, schedulers or production configuration were changed. The only live database operations in this pass were read-only catalog queries through the signed-in Supabase dashboard.

## What changed

- **Editor recovery.** Note, SOP and work-item text and the two settings autosave forms now checkpoint unsaved text at departure and owner teardown. Typing does no synchronous storage writes. Recovery is scoped to the exact actor, workspace, record and field; duplicated windows get independent writer identities. Recovered copies require explicit comparison and save, use current server authorization/conflict guards and never automatically replay. Late acknowledgements cannot replace a new account's owner or bypass recovery review. Storage failures retain an open-document copy and refuse cancellable unload; an abrupt OS/browser termination and failure at non-cancellable pagehide remain platform limits.
- **Concurrent database commands.** A disposable real PostgreSQL rehearsal exposed stale admission checks after lock waits and a separate attachment path that could exceed the note's twenty-relationship limit. The uninstalled A4 candidate now rechecks admission after known blocking acquisitions, uses consistent parent-note lock order and applies the cap to both link paths. It retains existing lock strength to avoid newly delaying unrelated presence, relationship and workflow updates. These are admission checks, not commit-time serialization of every later access or archival change.
- **Repeatable release checks.** The new Foundations workflow checks migration history, new migration names/versions, whitespace, changed-source lint, the full suite and a production webpack build. An independent job rehearses the command migrations in its own socket-only PostgreSQL cluster using synthetic data. Actions are pinned to verified commit IDs; no production secrets or deployment/provider hooks are used. The workflow has not run on GitHub and does not itself establish branch protection or deployment sequencing.
- **Operating guidance.** The runbook defines supported recovery for unknown saves, conflicts, uploads, paused work and future additions. Bounded catalog/Lead Gen diagnostics retain accepted work and exclude client payloads. Dormant Lead Gen reopening blockers are recorded without enabling that subsystem or altering its historical records.

## Verification

Final combined application validation passed **1,353/1,353 tests**, zero failed/skipped/cancelled. Strict changed-source lint, migration/whitespace checks and the production webpack build passed with dummy loopback Supabase configuration. [The validation record](./evidence/pass-3-validation.txt) retains exact commands, results and log hashes. Both root performance/alerts contracts, protected alert implementations, the shared offline store and dependency manifests remain unchanged.

The [mounted browser fixture](./workspace-draft-browser.md) passed **25/25 cases in Chromium production React** and **25/25 in Chromium development StrictMode**, with exact runtime source hashes and no unexpected network requests. It mounts the complete draft hook/form/recovery/journal/mutation runtime with controlled server acknowledgements and mocked router/presentation seams. An initial 23/25 result exposed incomplete storage-denial injection in the fixture; denying storage enumeration correctly made the unchanged warning assertions pass. Safari's mounted attempt did not produce a completed result, and the native controls subsequently selected a different user window. It remains unverified; the earlier Safari checkpoint benchmark is separate evidence and does not substitute for this suite.

[Independent review](./records-drafts-independent-review.md) reproduced and verified corrections for actor-preservation events, stopped recovery owners and partially staged source. Root review also closed automatic resubmission of a recovered draft after an earlier in-flight save. [The draft package report](./draft-recovery-pass-3.md) records the exact owner scope, benchmarks and lifecycle limits.

The final SQL candidate passed **58/58 real PostgreSQL checks** and **31/31 PGlite checks**. The PostgreSQL harness observes actual lock waits across independent connections; its temporary cluster is stopped and removed after each run. It is a representative synthetic schema, not a production clone. The operational diagnostic fixture passed **8/8**. These separately invoked results must not be represented as production/provider evidence.

The desktop checkpoint benchmark covered up to 100,000 characters plus a matching-size baseline. Both Chromium and Safari completed the synthetic measurements with no ordinary-typing storage calls. These measurements apply to explicit local checkpoints on this machine, not physical-mobile or authenticated production latency.

## Live observations and release gates

The [live-check record](./pass-3-live-checks.md) confirms PostgreSQL 17.6, the absent expected A4 receipt table, the absent migration registry and the scheduled Pro backup timestamp. The local server was PostgreSQL 17.11/macOS; the optional hosted regression job targets PostgreSQL 16/Linux. Neither is identical to production's full schema, extensions or runtime.

Before promoting the combined candidate:

1. Complete the installed-schema comparison, including signatures, bodies, triggers, grants, RLS/default privileges, table/index size and prerequisite order. Resolve the missing migration registry with an exact baseline plan; never replay historical migrations or invent applied history.
2. Agree the recovery requirements and complete an isolated database restore plus separate object/configuration recovery rehearsal. The dashboard's scheduled DB backups exclude Storage API objects; R2 and encryption/configuration dependencies are separate.
3. Review and install only the exact A1/A4 artifacts under bounded lock/statement timeouts, then read them back before releasing compatible callers. The new index's production lock duration is unmeasured. Unknown installation outcomes require catalog inspection before retry.
4. Refresh accepted Lead Gen/import work and external process/scheduler ownership. Local code quarantine is not proof that old deployments or external importers stopped. Keep unrelated recovery schedules intact.
5. Run the hosted checks, establish the desired merge/deployment gate, deploy the reviewed commit and record the terminal deployment status separately.
6. Verify authenticated navigation and permitted synthetic write/upload flows in an isolated workspace. Record real storage conditional-write/CORS/provider behavior, matched warm/cold performance and Android/Chrome versus iPhone/Safari/PWA evidence separately. No client messages or client records are test fixtures.

Application rollback must preserve safe guarded writes or disable the affected actions. Keep corrected triggers, additive receipts, accepted records/links, objects, queued work and recovery copies. Do not restore unsafe sequential creation/blind replacement, delete uncertain records or clear drafts to simplify rollback.

Package details: [SQL rehearsal and installation/rollback](./records-pass-3-postgres.md), [operating runbook](./operations-runbook.md), [Lead Gen inventory and reopening gates](./leadgen-operations-inventory.md), [Foundations CI](./foundations-ci.md). Earlier [Pass 2 evidence](./pass-2-integration.md) remains historical; this record does not relabel those earlier fixtures as new production proof. The candidate is retained as a local commit only; nothing was pushed, installed or deployed.
