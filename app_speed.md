# Betelgeze app speed standard

Established: 2026-09-11. Applies to every feature, fix, refactor, dependency, query, migration, integration, and configuration change that can affect the app.

## 1. Mandatory rule: preserve or improve speed

Read this file before planning or implementing app changes. Performance is an acceptance requirement, alongside correctness and the established UI. Preserve the speed of existing user actions; improve it where practical. Do not knowingly introduce a regression, even if another action becomes faster or the slower action still meets a target.

Speed includes launch, navigation, tab and conversation switching, typing, filtering, saving, media display, and recovery. It also includes database work, transferred data, memory, background CPU, subscriptions, and battery use that can make those actions slower as usage grows.

This is a development and release gate, not a claim that every network request can always finish within one second. Existing slow paths are work to improve, not permission to make them worse. A skeleton, animation, stale result, or early success indicator is not a substitute for a completed action.

Ordinary feature work must follow this standard. The only permitted way to supersede a performance rule is the explicit speed-update process in section 7. Do not quietly weaken the rules or relabel a feature as a speed update.

## 2. Assess first; stop when a feature puts speed at risk

Before editing, identify the affected user actions and their current execution paths. Check:

- What must finish before the user can see and use the result? Does the change add a request, serial dependency, auth/bootstrap repetition, provider call, or loading gate?
- How many rows, messages, bytes, decryptions, media requests, rendered items, subscriptions, and timers are involved now? How does that work grow with records, conversations, workspaces, and open tabs?
- Can existing authorized data and resident UI be reused? Does the change invalidate caches, remount panels, duplicate fetches, or repeat initialization?
- Does it add startup JavaScript, synchronous browser/storage work, expensive renders, or hidden-tab activity?
- Can writes, retries, freshness, access changes, and offline recovery remain correct without blocking unrelated interactions?

**If assessment or implementation reveals a credible risk of slowing the app or violating a rule below, stop the affected implementation and explain the risk to the user immediately.** Do this before adding the risky behavior. If the problem appears after editing, stop extending that approach and do not merge or deploy it. Preserve unrelated work.

The explanation must state:

1. The proposed feature or change and the user actions affected.
2. The mechanism that could make them slower, including growth or device conditions that matter.
3. The evidence available, what remains unknown, and whether any code has already changed.
4. A compliant alternative, or the investigation/speed work needed to remove the risk.

Read-only investigation, bounded diagnostics, and unrelated compliant work may continue. Resume affected implementation only after the user selects a compliant approach, or authorizes the explicit speed update described in section 7. A generic request to build a feature is not permission to weaken this standard. Do not invent a percentage estimate when the impact is unmeasured.

Apply judgment: this gate concerns a concrete mechanism or unresolved material risk, not the abstract possibility that any code could run slowly. A documentation or copy edit does not require a platform benchmark.

## 3. Runtime and data rules

### Shell, tabs, and navigation

- Preserve the persistent workspace shell and reuse resident tabs, loaded panel code, and valid authorized snapshots. Routine navigation must not introduce a full app reload, repeated shell bootstrap, or unnecessary panel remount.
- Preserve each tab's route/history, scroll, selection, filters, focus, and drafts. Opening or refreshing one tab must not reset another.
- Load the active view first. Defer inactive modes, heavy editors, charts, and optional resources until needed; bound prefetch concurrency. Do not eagerly fetch the whole workspace to make one destination appear fast.
- Deduplicate in-flight reads and reuse the existing cache/navigation owners. Avoid parallel Next route prefetch and native reads for the same destination.
- Keep background refresh local and quiet. Use the existing authenticated GET read paths for focus, visibility, and routine refresh; do not introduce read-only Server Actions that trigger the foreground loading overlay.
- Keep the mounted shell's bootstrap tab identity stable across server revalidation. Readiness belongs to the mounted document: recover missed acknowledgements with bounded local probes for initial, new, and restored tabs. A timer, tab activation, or iframe `load` event must not automatically restart a pending document; retain slow destinations with an explicit retry and matching late recovery.
- Bound native panel reads (currently 30 seconds including response parsing), release failed request deduplication slots, and surface errors without discarding usable cached content. Never turn a request timeout into automatic repeated fetches.
- Preserve mounted/ready/paint distinctions, exact destination matching, cancellation, and late recovery. An iframe `load` event, resolved request, or bridge location message must not be reported as usable painted content.
- A committed in-frame URL replacement must clear the preceding load's timeout; distinguish it from an old probe reply during a still-pending navigation.
- Pause unnecessary hidden-tab rendering, polling, prefetch, and media work. Bound resident resources and clean up listeners/timers; retain the recovery and subscriptions needed for correctness.

### Database, API, and caching

- Fetch only the fields and records required for the current view. Use bounded summaries and pagination for growing collections. Do not add unbounded history scans, full-table downloads, per-row queries, or per-row signing/decryption to interactive paths.
- Parallelize independent authorized reads; preserve dependencies needed for authorization and business rules. Reuse request-scoped access checks where safe rather than repeating full bootstrap work.
- For query changes, inspect filters, ordering, indexes, execution plans, result size, and realistic growth. A row limit alone does not prove the database scans or decrypts only that many rows.
- Keep expensive reports, aggregation, bulk operations, and provider work off the initial useful-content path. Background jobs require durable acceptance and recovery; merely forgetting a promise is not a queue.
- Scope caches and deduplication keys by account, workspace, permissions where relevant, entity, query/filter, and version as appropriate. Bound retention, protect pending edits, reject stale responses, and invalidate or reconcile the smallest correct scope.
- Never accelerate reads by bypassing authentication, MFA, RLS, conversation access, encryption, revocation, or private-media authorization. An in-memory authorized cache is not permission to publicly cache private HTML/API responses or reuse another account's data.
- Keep freshness and errors visible through the existing UX. Do not silently disable Realtime, refresh, unread accuracy, history, search, or error recovery to report a speed gain.

### Communications and media

- Preserve the Team compact-inbox design on its enabled path: a preview per readable conversation plus unread metadata, with a recent 60-message selected-conversation window. Do not restore bulk body decoding across every chat to show the inbox. Legacy compatibility paths remain separate until deliberately retired.
- Preserve active-mode-first loading and reuse already loaded conversations. Do not fetch the selected history twice on initial entry or wait for an inactive Communications mode before showing the active one.
- Keep older messages accessible through cursor history and targeted reply/pin reads. Preserve timestamp precision, tie-breaking, scroll anchors, and previously loaded history. A capped snapshot is authoritative only within its own conversation/window; omission outside that window is not deletion.
- Preserve coordinated updates, read cursors, tombstones, pending mutations, acknowledgement reconciliation, and reliable reconnect behavior. Unread metadata must remain correct even for messages whose bodies are not loaded.
- Request visible chat previews first with bounded concurrency. Preserve stable media dimensions and keep chat originals/playback on demand. Opening a message gallery may retain media and preload its remaining originals one at a time, only after the selected image decodes or video can play through. Limit gallery residency with the 96 MiB admission estimate (encoded bytes plus image pixels/video frame allowance); unknown metadata and over-budget files remain on demand. Keep visited items ahead of speculative items, promote an in-flight selection without restarting it, cancel speculation when selection changes or playback buffers, pause hidden-viewer work, and release media on close. Do not bulk download, sign, or decode other offscreen chat attachments.
- Missing-preview cleanup must not await cancellation of a cloned fetch stream. Bound preview lookup/preparation and abort its upstream work before falling back to the authorized original; an expired preview deadline must not abort the original stream. Cover nonempty cloned storage errors in regression tests.
- Keep staff, Team/direct, client, and portal authorization boundaries distinct. Their endpoints and data volumes are not interchangeable.

### Writes, drafts, and offline behavior

- Keep immediate local feedback where safe, with accurate pending/error state. Measure local response, durable local persistence, server acknowledgement, and external delivery separately.
- Never display “saved,” “sent,” or “completed” before the corresponding guarantee is true. Preserve server validation, concurrency protection, business transactions, and failure recovery.
- Reuse the existing per-record mutation owner, durable request IDs, idempotency, and lost-acknowledgement recovery. Coalesce safe repeated intent and serialize dependent writes without blocking unrelated records.
- Navigation must not lose drafts or queued changes. Persist intent before discarding its owner, or retain the necessary confirmation/checkpoint. Background saves are not an excuse to drop a failed write.
- Keep offline caching and recovery from delaying the normal online path. Account/workspace isolation, storage failure, logout, access expiry, and reconnect must remain explicit. Do not promise operating-system background execution that the platform does not guarantee.
- Move external side effects to an outbox only when its atomic acceptance, worker scheduling, retry behavior, and rollback have been verified. Do not assume an optional or disabled queue is available everywhere.

### Launch and loading visuals

- Preserve the app-controlled startup canvas: dark grey `#171717` with the white Betelgeze diamond centered, available from early HTML/inline styles without waiting for a remote image, font, or JavaScript hydration.
- Remove the startup cover when the real page/shell is ready. Do not add a minimum splash duration or leave it over usable content.
- Keep the document, iframe canvas, loading states, and panel fallbacks dark before CSS/content arrives, including when the operating system uses a light theme. Do not expose a white intermediate Communications frame.
- Keep shared chrome under one owner. The workspace banner/logo belongs to the shared layout/`WorkspacePanelChrome`; `WorkspaceTabOpeningState` must not repeat it as another skeleton beneath the real banner.
- Preserve stable layout and existing appearance. Fixing loading colors or hiding a blank frame improves presentation; report actual latency improvements separately. Browser/OS frames before the app receives HTML are outside this canvas guarantee.

## 4. Measure real user outcomes

Compare the affected path before and after under matched build mode, account permissions, data volume, device/viewport, network, and cache conditions. Use production builds for performance conclusions; development compilation and mocked browser fixtures cannot establish production speed.

| Action | Completion boundary |
| --- | --- |
| Launch | Intended shell and first useful view are usable; separately identify browser/OS startup |
| Navigate or switch tabs/chats | Correct destination content has painted and controls respond, measured from the initiating interaction |
| Type, filter, or edit locally | Correct visible response without disruptive input or scroll delay |
| Persist a draft | Durable local storage succeeds |
| Confirm a write | Server acknowledges the authoritative transaction |
| Complete external work | Provider completion is confirmed; queue acceptance is a separate event |
| Load media | The requested preview or playable media is actually displayed, not merely requested |

Use `lib/workspace-performance-contract.ts` and the existing measurement helpers/harness; do not create incompatible timing definitions. Keep telemetry asynchronous, bounded, and free of business content, record identifiers, URLs, and credentials.

Separate cold entry, uncached reads, warm/resident navigation, persisted restart, background/suspended sessions, and slow-network recovery. Report sample counts, failures, missing samples, and variation. Use median/p95 for sufficiently repeated observations, and label small samples as observations. A database-only time is not an end-to-end action time.

The existing plan's goals—resident switches around 150 ms p95, available-data navigation around 300 ms p95, immediate local edits below 100 ms p95, and routine server acknowledgements below one second p95 under reference conditions—are targets, not platform-wide achieved guarantees. Passing a target does not excuse a regression from a faster baseline. Never silently increase a budget to make a change pass.

Do not choose an arbitrary acceptable slowdown percentage. Investigate repeatable worsening beyond measurement noise, including tail latency, failures, request/payload growth, memory, and background load. Do not average a regression in one action, permission group, or device cohort away with gains elsewhere. Where a credible risk cannot be resolved with available evidence, use the stop-and-explain gate.

## 5. Verification and completion gate

Scale checks to the change. For app runtime changes, run relevant behavior tests, changed-file lint, `git diff --check`, the repository test suite, and a production build as applicable. Add meaningful regression tests for new concurrency, authorization, pagination, or recovery behavior; avoid tests that only repeat implementation text.

For affected user paths, verify warm and cold behavior, representative/growing datasets, loading transitions, and preserved interactions. Exercise stale responses, account/access changes, failed reads/writes, tab churn, and offline recovery when those mechanisms change. Use Chromium/WebKit and mobile viewports where relevant; identify physical iPhone/Safari/PWA checks separately.

Do not benchmark repeated writes or load-test production as routine validation. Use isolated fixtures with external delivery disabled. Preserve user data, drafts, and unrelated working files.

Before declaring completion, report the affected actions, regression assessment, measured evidence and limits, checks performed, and outstanding verification. “Tests pass,” “build succeeds,” “deployed,” “authenticated UI checked,” and “physical device checked” are different claims. A deployment alone proves none of the others.

## 6. Architecture baseline and source of truth

Baseline established from the performance work through PRs #37–#44 on 2026-09-11. Some improvements use workspace/user rollout flags; they are not automatically enabled for every account. Read current source and rollout configuration before treating an old report as current behavior.

| Area | Starting standard to preserve | Main source pointers |
| --- | --- | --- |
| Workspace | Persistent shell, resident tabs, native reads/cache where enabled, recoverable legacy frames | `components/workspace/WorkspaceTopBarClient.tsx`, `components/workspace/NativeWorkspaceTab.tsx`, `lib/workspace-native.ts` |
| Loading | One shared banner; dark frame readiness; early diamond canvas | `components/workspace/WorkspacePanelChrome.tsx`, `components/workspace/WorkspaceTabOpeningState.tsx`, `components/AppStartupScreen.tsx`, `app/layout.tsx`, `app/globals.css` |
| Team inbox | Authorized compact summaries and selected recent history on the enabled path | `lib/teams/server.ts`, `components/communications/TeamCommunicationsWorkspace.tsx`, `supabase/migrations/20260911010000_native_communications_inbox.sql` |
| Chat correctness | Coordinated mutations, per-conversation history windows, accurate unread state, reconnect recovery | `lib/communications/coordinated-updates.ts`, `lib/communications/unread.ts`, `components/communications/useConversationHistory.ts` |
| Measurement | Separate usable paint, persistence, acknowledgement, and provider boundaries | `lib/workspace-performance-contract.ts`, `docs/workspace-performance-measurement.md` |
| Rollout/recovery | Scoped flags, compatible fallbacks, recoverable accepted commands/jobs | `docs/workspace-performance-command-operations.md`, `docs/performance-baseline/pilot-rollout.md` |

Historical implementation/coordination documents contain earlier-stage descriptions; verify them against the later code before reusing old limits. In particular, the older broad Team history bootstrap is not the compact-inbox standard. The native panel cache does not imply that all records persist across cold restarts. PowerSync is not an implemented dependency of this baseline.

The baseline does not certify universal sub-second actions. Cold server reads, provider delivery, large transfers, first synchronization, and physical-device performance require their own evidence. Retain the faster verified paths while improving these separately.

## 7. Only exception: an explicit speed update

When the user explicitly authorizes performance work, an existing implementation rule may be superseded if doing so is necessary for a demonstrated improvement. This is a narrow, documented replacement of that rule, not permission to ignore this entire file. Correctness, security, honest completion, the risk-reporting gate, and evidence requirements still apply.

1. Identify the old rule and the replacement before implementing the departure. Explain the intended benefit, affected paths, possible costs, and verification plan. If a different action or cohort may become slower, stop and explain before proceeding; the label “speed update” does not hide that tradeoff.
2. Implement a bounded, reversible change. Preserve compatible data/command paths and staged rollout controls where needed. Rollback must not erase drafts, committed records, or accepted jobs.
3. Compare the old and new behavior under matched conditions and verify correctness. If the improvement is unproven or an unresolved regression remains, do not promote it as the new standard or deploy it as a completed speed fix.
4. **Update the applicable rules and baseline in this file in the same change, before merge/deployment.** Merely appending a note while leaving contradictory instructions is insufficient. Update affected supporting documentation too.
5. Append an entry below with evidence, limitations, rollout, and rollback. The revised rules become mandatory for every subsequent feature and fix. A later rollback must restore the corresponding standard while retaining the history of both decisions.

Never use this exception to relax a threshold after a failed feature benchmark, to remove a check, or to justify an unrelated slowdown.

## 8. Speed-standard change log

### 2026-09-11 — Initial standard

- Established the mandatory regression assessment, stop-and-explain gate, and speed-update-only revision process at the user's request.
- Carried forward persistent/native workspace navigation and recovery from PRs #37–#40; shared dark loading from #41; compact Team inbox, history loading, and startup work from #42–#43; and the Team system-sender lookup correction from #44.
- This entry records existing implementation patterns. Creating this document introduces no runtime change and establishes no new benchmark result. Numeric goals remain targets; deployment scope and performance evidence must be verified for subsequent changes.
- Rollback: documentation-only change; no database, runtime, or provider changes.

### 2026-09-11 — Tab loading recovery

- **Authorized scope:** diagnose and fix tabs stuck loading and tabs loading then automatically reloading.
- **Updated standard:** stable launch identity; bounded readiness probes for every cold/restored tab; navigation deadlines report recoverable errors without restarting documents; explicit native read failures settle loading; hung native reads release their shared request slot after 30 seconds. This replaces timed automatic frame fallback/rollback with explicit retry and late recovery. Existing speed targets are unchanged.
- **Evidence:** see `docs/tab-loading-recovery.md` for reproduction, regression checks, and verification limits. Probes exchange local messages and add no data requests; warm ready tabs skip recovery work.
- **Rollout/rollback:** client changes only, preserving existing authorization, caches, chat data, and draft ownership. Revert the recovery change to restore the previous behavior; no schema or provider changes. Record release validation in the linked report before promotion.

### 2026-09-11 — Chat image request waterfall

- **Authorized scope:** improve slow Comms image loading across Team and client conversations.
- **New mandatory rule:** independent per-image membership, conversation, and key checks may overlap, but every check must pass before storage access. After an authorized preview 404, use the original GET metadata to validate conversion eligibility without repeating HEAD requests. Persist and serve generated preview bytes directly; do not download them again. Retain original size/pixel limits, SSE-C encryption, private cache policy, bounded visible-first admission, and original fallback.
- **Evidence:** existing-preview storage stays at one request. Successful legacy conversion falls from six storage operations (preview GET, preview HEAD, original HEAD, original GET, preview PUT, preview GET) to three (preview GET, original GET, preview PUT). Permission checks change from serial to concurrent with the same decisions. These are source/control-flow counts, not measured production latency. Runtime regression covers generated-byte delivery, cached previews, HEAD, conversion failure, validators, and storage denial.
- **Limitations:** first legacy preview still downloads/converts the original and persists the derivative; image-heavy chats still have a four-slot admission queue. No sub-second guarantee or authenticated-device latency result is established.
- **Rollout/rollback:** application-only change, no schema, backfill, provider purchase, or public caching. Revert this change to restore the former waterfall and corresponding standard.

### Required format for future speed updates

- **Date / change / PR or commit:**
- **User-authorized speed-update scope:**
- **Rule replaced and new mandatory rule:**
- **Affected actions, accounts/devices, and growth conditions:**
- **Before/after evidence:** build, dataset, cache/network/device conditions, sample count, latency boundaries, failures, resource costs, and evidence location.
- **Correctness and interaction checks:**
- **Limitations and remaining risks:**
- **Rollout and rollback:** flags/schema compatibility, draft/job recovery, deployment status.

Suggested instruction for `AGENTS.md` or other development instructions:

> Read and follow `app_speed.md` before planning or implementing app changes. If a proposed change may violate it or slow an existing action, stop the affected implementation and explain the risk. Only supersede a rule during an explicitly authorized speed update, and update the standard in the same change.

### 2026-09-12 — Retained media and selected-first gallery preloading

- **User-authorized scope:** eliminate repeated waits when swiping/using chevrons; the user approved the bounded preload/retention approach after the large-file risk was explained.
- **Rule replaced:** expanded galleries no longer discard each original after navigation or keep every unselected original on demand. The chat preview path is unchanged.
- **New mandatory rule:** retain admitted media for the open gallery; selected-first, one speculative original at a time, known-metadata admission within an estimated 96 MiB budget. A selected oversized item remains available while other residents are evicted. Unknown metadata stays on demand. Suspend speculative loads during buffering/hidden documents, abandon stalled speculation after 15 seconds without automatic retry, pause inactive players, and clear player sources on close.
- **Evidence:** eight policy regression tests plus Chromium/WebKit production-React component fixtures with ten images, synthetic video, and no-store responses. Previous image/player elements were replaced on return; new elements retain identity, and inactive videos pause without losing the player. All ten small images preload sequentially with maximum one original request in flight. Tests cover request promotion, budget eviction, failure/stall recovery, hidden/buffering suspension, and cleanup. See docs/communications-media-gallery.md.
- **Limits:** admission is a conservative estimate, not an exact browser memory ceiling. A selected large file may exceed it; decoder buffers and HTTP cache are browser-owned. Video preload is advisory. Fixtures do not establish production latency or physical-device behavior.
- **Rollout/rollback:** application only; existing authorization/private HTTP caching unchanged, no persistence across gallery sessions or schema/provider changes. Revert this change and its standard entry to restore selected-only loading.
