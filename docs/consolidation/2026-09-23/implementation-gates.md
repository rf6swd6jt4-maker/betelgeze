# Pass 2 implementation packages and Pass 3 release gates

Prepared from the read-only Pass 1 audit of `31388081894e6d4143d5bb0d577c0341ec31edf7` in `/private/tmp/betelgeze-platform-consolidation`. This is a file-ownership and sequencing plan, not authorization to execute SQL, change production configuration, send messages, or remove data. No app source is changed by this document.

The objective is bounded repairs to diagnosed failures. Preserve the dirty primary checkout, resident UI, drafts, message history, users, immutable sales/service revisions, onboarding snapshots, assets/storage objects, credentials and accepted jobs. There is no package here for an application rewrite, schema cleanup, database reset or provider migration.

## Ownership and execution order

Use one integrator and three concurrent implementation owners at most. An owner can run sequential subpackages; another owner must not edit its files concurrently. Integration points in the large shell, shared create actions, shared upload utility and migration directory require explicit handoff.

| Package | Exclusive implementation owner | Dependency | Can run alongside |
| --- | --- | --- | --- |
| S1 optional shell storage and bounded bookkeeping | Shell owner | Baseline/evidence capture | A1, M1 assessment |
| S2 frame departure acknowledgement and safe Retry | Shell owner | S1; failing lifecycle fixtures first | A2/A3, L1 isolated files |
| S3 native error recovery and shell prefetch integration | Shell owner | S2; distinguish data/render/module failures | A packages, L1 isolated files |
| A1 existing-note trigger correction | Records owner; integrator reserves migration filename | Live function hash already matches; isolated 13-check proof | S1, L1 |
| A2 attachment reads and acknowledged-save recovery | Records owner | A1 for complete note-link browser acceptance | S2, L1, M1 |
| A3 new-upload provenance and note concurrency | Records owner | Transaction design/SQL fixture; coordinate shared upload utility | S2/S3, L1 |
| A4 create-and-link atomicity/idempotency | Records owner, sequential to A3 | A1/A3; explicit old-client compatibility contract | S3/L2 if files do not overlap |
| L1 Lead Gen exposure/admission quarantine | Quarantine owner | Reconfirm selected quarantine policy; inventory accepted work | S/A packages; shell-owned edits queued |
| L2 worker/schedule quarantine | Quarantine owner + integrator | Parent/child/scheduler inventory and accepted-work policy | Only unrelated packages |
| M1 interrupted gesture cleanup | Mobile owner, using next free slot | Regression proving hidden-frame defect; protected-behavior review | S/A/L code outside shared shell |
| G1 contracts, CI and combined verification | Integrator | Incremental as packages land; final suite after final integration | Documentation may proceed throughout |

Suggested slot order: Shell + Records + Quarantine first; mobile helper is small and can replace the Quarantine owner after L1 assessment/isolated changes, or run first while the integrator finishes the external-scheduler inventory. Do not open extra copies of the shell or shared actions to increase apparent parallelism.

## S: shell, storage and recovery

**Owned files:**

- `components/workspace/WorkspaceTopBarClient.tsx`
- `components/workspace/WorkspaceTabFrameGuard.tsx`
- `components/workspace/WorkspaceTabBridge.tsx` only if the existing root-receiver protocol requires a corresponding acknowledgement integration
- `components/workspace/NativeWorkspaceTab.tsx`
- `lib/workspace-tabs.ts`
- `lib/workspace-frame-navigation.ts`
- New, small helpers proposed as `lib/workspace-tab-departure.ts` and `lib/workspace-shell-storage.ts`
- Focused tests proposed as `tests/workspace-tab-departure.test.ts`, `tests/workspace-shell-storage.test.ts`, `tests/workspace-native-error-recovery.test.ts`, plus existing navigation fixtures where the actual contract changes

**S1.** Centralize optional tab/sidebar/context restoration reads/writes. Storage failure must leave the mounted shell usable, with in-memory state and bounded diagnostics. Do not generalize this helper to draft checkpoints or treat failed durable storage as success. Prune stable frame IDs and context metadata for genuinely retired tab IDs while preserving current mounted order and the 20-entry reopen contract. Do not bulk-clear session storage.

**S2.** Introduce one bounded request/acknowledgement exchange for departure from an existing iframe. It must use the existing same-origin root frame receiver, validate source window/tab/document/request identity, consult the current registered flusher, and fence older intents. A successful durable checkpoint or confirmed flush permits departure. A false result, timeout, missing receiver or stale acknowledgement does not establish safety.

Apply that owner before iframe-to-native renderer replacement, closing an affected tab, and explicit forced iframe Retry. Check eviction separately: a capped resident set must not evict an uncheckpointed draft owner. Retaining a blocked owner cannot silently turn into an unbounded resident pool; stop speculative warming/eviction or refuse that transition while exposing the blocked save. Keep the old panel visible/reachable when persistence fails, rather than hiding it behind a destination skeleton that prevents the user repairing the save.

Preserve current zero-extra-network warm native navigation, the existing frame navigation sequence fence, 12 foreground-second UI deadline, 30-second native read deadline, exact URL matching and late recovery. A safety acknowledgement is a local exchange, not another auth/bootstrap/data read. Do not add timer-triggered reloads, automatic fetch retries or repeated shell bootstrap. Empty/new frames require an explicitly established no-owner case; missing acknowledgement from a formerly live frame is not equivalent.

**S3.** Route shell Retry to the right owner: data reread for read failure, boundary reset for component failure, and an explicit guarded recovery for failed code loading if a real fixture establishes that path. Do not solve every failure by reloading the whole workspace. Investigate duplicate sidebar prefetch in a production-mode fixture; disable unused framework prefetch at shell-owned links only after preserving useful frame-route prefetch elsewhere.

**Package gate:** failed/pending checkpoint + Retry/close/renderer change/eviction; rapid A-B-A; stale/missing acknowledgement; background/foreground; storage SecurityError/QuotaExceededError; successful safe departure; native render failure recovered from the visible shell control; stable iframe identity; no automatic retries. Existing navigation group baseline is 91/91. Add an actual mounted component/frame fixture where feasible; helper-only tests did not catch the current seam defects.

**No concurrent edits:** L1 must submit the shell direct-search/sidebar changes to this owner. M1 should not edit the shell for its first bounded helper repair.

## A: attachment links, notes and upload provenance

**Owned files:**

- `components/detail/RecordAttachments.tsx`
- `app/api/workspaces/[workspaceSlug]/attachments/route.ts`
- `lib/record-attachments.ts`
- `app/[workspaceSlug]/attachment-actions.ts`
- `app/[workspaceSlug]/notes/[id]/actions.ts`
- `app/[workspaceSlug]/notes/[id]/NoteEditor.tsx`
- `app/[workspaceSlug]/notes/[id]/NoteFieldsEditor.tsx`
- `app/[workspaceSlug]/notes/[id]/page.tsx`, `lib/notes.ts` only for authoritative edit-baseline propagation
- `app/[workspaceSlug]/relationships/actions.ts` limited to `createAssetFromModal` / `createNoteFromModal` and their immediate adapters
- `app/api/workspaces/[workspaceSlug]/assets/upload/route.ts`
- `components/workspace/WorkspaceCreateModal.tsx` for new-upload receipt/accepted-create handling, if its current call path requires it
- `lib/onboarding/uploads.ts` only the generic asset-upload helper, after caller inventory; preserve client onboarding upload callers
- Proposed small new provenance helper: `lib/assets/upload-receipt.ts`
- New additive migrations under `supabase/migrations/`, with unique timestamps reserved by the integrator; never edit `20260918130000_workspace_notes.sql`
- Behavioral tests proposed as `tests/record-attachments-loading.test.ts`, `tests/note-concurrency.test.ts`, `tests/asset-upload-provenance.test.ts`, and isolated SQL fixture scripts for trigger/transaction behavior

**A1, first standalone repair.** Replace `enforce_note_link_workspace` in one new migration using separate `TG_TABLE_NAME` branches, so a statement does not reference a field absent from that table's `NEW` shape. Preserve workspace, target and note authorization/integrity checks, trigger bindings, uniqueness and all existing rows. Parent audit verified the live function MD5 `75cb6e5209f6c5d59aefb3ffcfefac5e` matches the historical migration; isolated PGlite reproduces both valid links failing with SQLSTATE 42703 and the branched replacement passes 13 checks. Evidence: `/private/tmp/be-note-attachment-trigger-audit-result.json`.

**A2.** Give attachment GETs one scoped request owner, deadline covering parsing, cancellation/stale-response fencing and explicit retry. Preserve account/workspace/owner identity and bounded retention. A confirmed link insertion followed by a failed list refresh must say that refresh is stale/retryable, not claim the insert failed. Keep duplicate-link idempotency. Replace silent 80-attached/100-choice truncation with bounded pagination or targeted server search and an explicit completeness/cursor contract; do not fetch the full library or sign every asset to hide the cutoff. Preserve specialized message-media/SOP image authorization rather than routing all storage through a generic signer.

**A3 upload provenance.** New generic asset creation must accept a server-issued receipt tied to workspace, actor and the exact upload metadata/path, then verify the uploaded object before inserting its trusted reference. Do not trust a client-submitted `storage_path` alone. Keep legacy asset reads compatible and authorized; do not rewrite historical paths or invalidate valid onboarding/SOP/message receipts. Test forged/cross-workspace/cross-actor paths and late/lost acknowledgements without real uploads.

**A3 note concurrency.** The current relationship editor submits a complete stale selected set; field autosave overwrites both fields without a baseline. Replace this with authorized transaction operations using explicit edit baselines and relationship add/remove intent. Compare the submitted text baseline/version to authoritative state; reject conflicting intent with the current value available for resolution while retaining the draft. Concurrent untouched fields/links must not be removed. Reuse existing version/idempotency primitives where suitable; do not create a second general mutation framework.

**A4.** Create-and-link presently spans separate writes with unchecked compensation. Make record creation and requested links atomic in one authorized transaction, with a durable request identity so lost acknowledgements can be reconciled. Keep this as a separate reviewable package after the trigger/provenance/concurrency contracts are stable. Do not describe create-and-attach as reliably complete until this package passes. Do not use cleanup deletion of a possibly accepted record as error recovery.

**Package gate:** valid note↔asset and note↔relationship links; cross-workspace denial; duplicate insert; concurrent edits and link additions; stale whole-form submission; denied/lost acknowledgement; one confirmed insert plus failed refresh; account/owner switch with an old GET completing; exact uploaded-object provenance; pagination beyond current cutoffs. SQL fixtures must prove rollback/unchanged counts after failure. Preserve sale/onboarding and stored assets; real client records are not test fixtures.

**Migration order:** A1 can be applied independently after reviewed migration approval. Transaction functions/receipt infrastructure, if needed for A3/A4, must be installed and verified before the corresponding application callers. New commands must fail visibly if required schema is absent; no fallback to the diagnosed unsafe write sequence. Explicitly document stale-client behavior: preserving old command signatures is not permission to keep an unsafe unconditional overwrite path. A safe retry/reload may be required, with draft preservation. Roll application back first and leave compatible additive functions/tables/receipts until all callers are understood.

## L: reversible Lead Gen quarantine

**Owned files:**

- Proposed central policy helper: `lib/leadgen/availability.ts`
- `lib/workspace-panels.ts`, `lib/workspace-capabilities.ts` only as needed for a reversible availability gate, not removal of persisted capability identity
- `app/api/workspaces/[workspaceSlug]/search/route.ts`
- `app/[workspaceSlug]/settings/page.tsx`
- `app/[workspaceSlug]/leadgen/actions.ts`, `app/[workspaceSlug]/leadgen/settings/actions.ts`
- Lead Gen route entry files: `app/[workspaceSlug]/leadgen/page.tsx`, `new/page.tsx`, `polls/page.tsx`, `poll/[pollId]/page.tsx`
- `components/leadgen/PollsAutoRefresh.tsx`, `PollLiveRefresh.tsx` only for quarantine-specific admission/processing behavior
- L2 only: `app/api/leadgen/polls/process/route.ts`, `app/api/leadgen/sunbiz/import/route.ts`, and verified scheduler configuration actually responsible for these calls
- `lib/leadgen/poll-runner.ts` only if policy enforcement cannot be guaranteed at entry points; preserve all historical runners/data modules until their users are inventoried
- Proposed tests: `tests/leadgen-availability.test.ts`, `tests/leadgen-quarantine-accepted-work.test.ts`

**L1.** Put the feature behind one reversible availability policy covering direct routes, server mutations, shell/search affordances and the Settings section. Hiding a sidebar item alone is insufficient. The conservative proposed policy is no new poll/import admission while historical lead/poll data remains accessible to authorized administrators. The exact policy must match the user's accepted quarantine scope; use the preparation discussion rather than inventing a deletion or cancellation policy.

Do not remove `leadgen_company_id` references from relationships, historical source/evidence records, workspace branding columns, existing capabilities, imports/migrations or stored credentials. Do not delete packages such as DuckDB based solely on a hidden navigation item; first verify every non-Lead Gen caller and deployment trace. Root's shell owner integrates direct-search/sidebar changes; do not concurrently edit `WorkspaceTopBarClient.tsx`.

**L2 is inventory-gated.** The parent observed 49 failed, 19 completed and 2 cancelled parent polls, with no queued/running parents. A subsequent live check found eight queued and one running poll-task row, all under failed parents. These are point-in-time counts, not proof of no investigation/stage-task backlog or external scheduler. Before pausing workers/schedules, finish grouped child-state inventory and verify executable policy; inspect external scheduler ownership and active import work. The source uses `queued`/`running`, not `pending`/`processing`. Child rows of cancelled/terminal parents may retain those states and are not independently runnable merely because of their label. Evidence definitions: `leadgen-backlog-statuses.md` in this folder.

If accepted runnable work appears, stop new admission first and document an explicit bounded drain or reversible pause preserving every row, receipt and status. An age cutoff is not authority to delete, cancel or mark work complete. Verify no new jobs can race the final inventory before pausing a scheduler. Change external scheduler state only under the authorized quarantine scope, after presenting the exact identified scheduler/config change; do not substitute guessed cron edits.

**Package gate:** normal app navigation/search/settings no longer loads gated Lead Gen work; direct legacy URLs and old clients receive a truthful available/history/quarantined response; server entry points enforce the same policy; unrelated relationship/service/appointment paths remain usable; accepted-work preservation and reversible resumption are demonstrated in fixtures. Preserve read/alerts schedulers and unrelated durable outboxes.

## M: mobile interrupted gesture cleanup

**Owned files:**

- `lib/chat-viewport-motion.ts`
- `tests/chat-viewport-motion.test.ts`
- Existing related fixtures only if additional coverage is needed: `tests/composer-viewport-controller.test.ts`, `tests/viewport-origin-recovery.test.ts`, `tests/chat-viewport-state.test.ts`
- Read-only dependencies: `lib/workspace-tab-activity.ts`, `components/workspace/useWorkspaceTabActive.ts`, shell frame hiding, Communications/portal motion consumers

The baseline reproducer is `/private/tmp/be-consolidation-evidence/mobile-hidden-frame-reproduction.mjs`: start keyboard motion, begin touch, hide resident frame without touchend, retire motion, show frame, request another keyboard transition. Stale touch/interacting ownership prevents final geometry and temporary styles from clearing. Existing related tests pass 42/42; this missing case fails independently.

Retire stale gesture ownership on an actually hidden/deactivated surface without applying the previous request. Preserve touch-scroll deferral on an active visible surface, reduced-motion handling, portal use, keyboard-open/close geometry and listener/timer cleanup. Keep the initial repair local to the helper; do not rewrite shell geometry or chat scrolling wholesale.

**Package gate:** the retained failing regression passes; valid active touch scrolling still defers completion; hidden return/new request settles; no old request applies to a new surface; portal and staff consumers pass; Chromium/Android and WebKit/iOS viewport fixtures both run. Physical Android/Chrome and iPhone/Safari/PWA checks remain separately reported.

## Protected alerts boundary

`app-alerts.md` explicitly requires permission before changing message reading, unread state, read receipts, active-chat/foreground detection, alert suppression/recipients, subscriptions, retry/recovery, or related database functions/schedulers. The broad consolidation instruction is not a new authorization to change those behaviors.

- Do not edit `app-alerts.md` as cleanup, move its requirements into weaker prose, or change protected readers/activity predicates while repairing shell or keyboard mechanics.
- Trace indirect effects of S/M through tab activation, visibility, focus, overlays and newest-message exposure. Run the existing read/activity regression fixtures as preservation checks; they do not authorize changed semantics.
- Reuse the existing tab activity mechanism. A departure acknowledgement must not manufacture chat activity, a read acknowledgement or a push suppression lease.
- If a required repair would deliberately change protected semantics or cannot be isolated from them, stop that specific implementation and present the concrete proposed behavior for explicit scope authorization. Other safe packages can continue.
- Lead Gen scheduler quarantine must never touch chat recovery, unread refresh, onboarding handoffs or provider outboxes.

## G: contracts and release enforcement

**Integrator-owned files:**

- Root `AGENTS.md`; scoped instruction additions proposed as `components/workspace/AGENTS.md`, `components/detail/AGENTS.md`, `lib/leadgen/AGENTS.md`, and `supabase/AGENTS.md`
- Proposed `.github/workflows/app-validation.yml`
- Proposed `scripts/check-consolidation-contracts.mjs` and focused tests for its path classification
- A concise tracked implementation/validation report under `docs/` after package results exist
- `app_speed.md` only if an explicitly authorized speed-standard replacement is actually necessary; ordinary fixes should preserve it unchanged
- `app-alerts.md` remains protected and unchanged without the required explicit scope permission

Keep instructions short and local: name the existing owner, acceptance boundary, tests and forbidden unsafe fallback. Do not create contradictory copies of speed/alerts policy. Put actual regression enforcement in behavior tests; regex guards may protect topology but must not be the only proof that persistence, authorization or recovery works.

CI should run secret-free local checks on app PRs/main: repository `npm test`, changed-file ESLint, `git diff --check`, relevant isolated SQL fixtures, and `npx next build --webpack` using the repository-supported nonproduction build configuration. Check changed paths to select extra focused tests; do not omit the full suite at final promotion. Do not run production queries, provider calls, real sends or paid imports from CI. Keep NER deployment workflow separate.

Guard against modification/deletion of historical migrations and against unreviewed protected-contract changes. Such checks should require a clear review record, not silently approve behavior through a filename or regex match. External branch protection/deployment settings require a separate verified configuration action; adding a YAML file alone does not establish enforcement.

## Promotion order and evidence gates

1. Preserve the clean baseline, original failing probes and source hashes. Record ownership before editing. Capture bounded relevant production metadata only where authorized; never copy client bodies/tokens into evidence.
2. Land isolated failing regressions, then bounded source repairs. Each package completes focused behavior tests, lint and diff checks before integration. Keep no-data migrations separate from app commits where it makes rollback/review clearer.
3. Rehearse new SQL against an isolated PostgreSQL fixture with authorization/cross-workspace/concurrency/rollback cases. Validate installed function/schema signatures and migration history before scheduling production. The A1 function-only fix changes no stored row; A3/A4 may add command infrastructure and need their own compatibility review.
4. After concrete reviewed deployment authorization, apply required additive schema first; verify the exact installed definitions and grants. Do not run backfills or replay old writes as part of a function repair. Record row counts/checks without exporting content.
5. Deploy the exact reviewed application commit. Confirm terminal deployment status and expected schema compatibility; this is not UI/provider proof. Keep the old app's command behavior and stale browser handling explicit.
6. Run authenticated read/navigation verification on the intended deployment. Use isolated fixtures with external delivery disabled for writes, concurrency and load. Check cold/warm/resident/restored, rapid changes, long-lived tab churn, hidden return, offline recovery and storage failure. No real client messaging solely for testing.
7. Verify mobile browser engines equally, then separately report physical devices. Compare measured interactions against a matched baseline; source request-count improvements are not p95 latency improvements.
8. Decide L2 only after the post-admission parent/child/external-scheduler inventory confirms the accepted-work strategy. Retain historical data regardless of quarantine status.
9. Publish the final release record with separate fields for code/tests, isolated SQL, installed schema/history, deployed commit/status, authenticated UI, provider behavior and physical-device evidence. Remaining gaps stay explicit.

Rollback is application-first, narrow and data-preserving. Keep compatible additive schema and receipts, restore the availability flag/scheduler only to its recorded prior state, and preserve newly accepted work. Do not drop tables, purge files, rewrite sale/onboarding snapshots, delete historical migrations, clear client histories, disable alert recovery, or erase queued jobs to make rollback appear clean.
