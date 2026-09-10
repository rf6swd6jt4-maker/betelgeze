# Workspace performance measurement

## Boundaries and privacy

`beginWorkspaceInteraction` records content-free operation labels and explicit boundaries. Mark `meaningful_ready` only when useful destination content is mounted; measure after paint in the view. Mark `local_persisted` after successful durable storage, `server_ack` after validating the authoritative command result, and `external_completed` only after provider completion. These are separate facts. A resolved fetch, shell bridge message, pending UI or accepted delivery job must not substitute for them.

Start `navigation` in the initiating interaction handler, before autosave/navigation work. If measurement begins only after a destination component mounts, use `panel_load`; it excludes the earlier input and shell delay. The browser harness supplies the complete click-to-ready interval. Deferred activity charts have their own loading state and are not included in the first useful activity-list boundary.

```ts
const measurement = beginWorkspaceInteraction({
    workspaceSlug,
    operation: "navigation",
    routeSection: "relationships",
    renderer: "native",
    cacheState: "memory",
})
measurement.mark("data_ready")
// After useful content has actually committed and painted:
measurement.mark("meaningful_ready")
measurement.finish("completed", "meaningful_ready")
```

The vocabulary is allowlisted in `lib/workspace-performance-contract.ts`. Do not add record identifiers, URLs, search strings, names, business payloads, tokens or error messages. Add a fixed operation/command label to the contract when needed. Data/cache state must describe the actual path; use `unknown` if it is not observed. `background` includes inactive workspace tabs even when their document is technically visible.

The browser retains the latest 100 samples at `window.__BETELGEZE_PERFORMANCE_SAMPLES__` and emits `betelgeze:performance-sample`. It batches up to 20 samples per authenticated ingestion request after 10 seconds or when the document leaves the foreground. Telemetry has no blocking dependency on application success. Missing marks remain absent; unfinished operations time out at 120 seconds or are recorded as aborted on page exit. Discarded buffered samples are counted locally. Network rejection and browser termination can still lose telemetry, so server samples are not a census of all interactions.

Visibility transitions, hidden time and lifecycle freeze are stored, not subtracted from duration. Lack of a freeze event does not prove an operating system never suspended the application. Existing launch telemetry now adds visibility/freeze information and separate optional code/data/meaningful-ready marks. The old `panel_ready_ms` keeps its original bridge-handshake meaning.

`20260910130000_workspace_interaction_metrics.sql` adds a private telemetry table. Apply through the normal reviewed deployment process. The endpoint returns `accepted: false` if storage is unavailable. This branch does not apply the migration itself. Rows are deduplicated by workspace/sample UUID. The ingestion path checks workspace membership, request origin, bounded JSON size and fixed labels. There is no authenticated direct table access. Before broad rollout set retention in the normal operations job (recommended 30 days) and monitor ingestion volume; the schema does not secretly install a production cleanup job.

## Reproducible controlled-browser harness

The harness uses an existing Playwright installation. It does not install browsers, authenticate itself, create records or send provider requests. Use isolated fixture accounts, a staging database and server-side disabled email/SMS/WhatsApp/payment/booking delivery. Supply a storage-state file outside the repository if login is required. Treat that file as a credential; never attach or commit it.

Create a fixture file outside the repository using actual selectors for stable, useful content. Examples below are templates, not selectors verified against a deployed BE build:

```json
[
  {
    "name": "relationships.resident-tab",
    "from": "/fixture-workspace/relationships",
    "fromReady": "[data-test-fixture=relationships-ready]",
    "click": "[data-test-fixture=other-resident-tab]",
    "ready": "[data-test-fixture=other-panel-ready]",
    "operation": "tab_switch",
    "routeSection": "relationships",
    "renderer": "native",
    "cacheState": "memory"
  }
]
```

```sh
BE_PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs node scripts/benchmark-workspace-browser.mjs \
  --base-url=http://localhost:3000 \
  --cases=/private/tmp/be-fixtures.json \
  --storage-state=/private/tmp/be-test-session.json \
  --iterations=100 --browser=chromium --deployment=reviewed-commit \
  --output=output/performance-browser/chromium.jsonl
node scripts/summarize-workspace-performance.mjs output/performance-browser/chromium.jsonl
```

Remote staging requires `--allow-staging-origin=https://exact-staging-origin`. Non-GET requests are blocked by default, including legacy read-like Server Actions. For a separately isolated, approved staging fixture use `--allow-staging-writes=true`; cross-origin writes remain blocked. An action requiring a blocked request fails the measurement rather than being silently reported fast. This browser guard does not protect against server-side integrations; disable those in staging as well. Do not point this harness at production for repeated writes or load tests.

`fromReady` establishes the starting screen outside the measurement interval. `click` performs the measured navigation; omit it to measure reload. `frame` optionally selects the legacy iframe containing the readiness target. `ready` must identify usable content, not a spinner/header that appears before the data. The harness waits for visible content and two animation frames. It records actual observations, failed/blocked requests and completed-request transfer sizes, never response bodies. Resource counts exclude requests still pending at the readiness boundary; they are a bounded comparison, not complete page transfer totals. Cross-document navigation loses visibility continuity and is conservatively excluded from the foreground-throughout cohort.

Run Chromium and WebKit separately, with matched build, data, viewport, account permissions, network and hardware. Service workers are blocked by default for deterministic route comparisons. Use `--service-workers=allow` for a separate persistence cohort. Explicitly separate cold install, uncached navigation, in-memory revisits and persisted restart; labelling a case `memory` does not warm it automatically. The starting fixture must create that condition and verify it.

The summary reports p50/p95 using nearest-rank quantiles, sample counts, all outcomes and each missing boundary. It separates cache, renderer, deployment, background, foreground and suspension cohorts. Inspect failure and missing counts before interpreting a percentile. The harness has no hard timing assertions in `npm test` because local machines and networks are variable.

## Evidence still required before enabling broadly

- Authenticated matched old/new runs with real controlled records and stable useful-content selectors.
- Actual iPhone Safari and installed PWA measurements; desktop WebKit is not physical-device evidence.
- SQL plans and database CPU/IO/connection waits in a controlled environment; browser timings cannot diagnose these alone.
- Vercel execution region and actual Supabase region/tier from the provider account. No committed `vercel.json` establishes the execution region, so it must not be inferred from repository configuration.
- Repeated tab churn, memory/subscription growth, storage eviction, expired access and offline recovery.

Native Library, Fulfilment, Appointment Setting and Admin views preserve the current presentation while their original server pages remain as the gated fallback. The duplicated presentation is temporary rollout code; do not remove the fallback until authenticated parity and rollback checks pass. Admin activity keeps cursor/facet queries on the server and defers chart aggregation; its category/level/cursor belong in the read-cache key. Ordinary client-only list filters remain tab-local. Signed asset/people URLs are transient authorised display URLs, not durable offline records.

## Implementation and rollout state

| Area | Implemented in this branch | Enablement and remaining evidence |
| --- | --- | --- |
| Native staff navigation | Relationships, Library, Fulfilment, Admin and Appointment Setting: 16 existing product page patterns with client views and authenticated JSON reads | `WORKSPACE_NATIVE_PANELS` remains unset by default. Exact workspace UUID rollout requires authenticated UI, history, edits, access and device checks. |
| Native navigation infrastructure | Shared tab navigation/context, bounded read cache, active-tab behavior and native-aware links | `WorkspaceLink` disables Next route prefetch only within native context. Production browser checks must verify no duplicate RSC reads; development does not exercise Next prefetch. |
| Draft/command paths | Durable appointment drafts and relationship background edits; JSON appointment submission; conditional inline OKR deletion | Command receipts require their migrations. Queued notifications additionally require verified cron scheduling and `WORKSPACE_APPOINTMENT_OUTBOX_READY=1`; see the command operations document. |
| Communications/media | Shared history/lifecycle and media-path improvements | Communications retains its existing frame route. Full-schema migration, authenticated history/media and physical-device evidence are separate gates. |
| Remaining native migrations | No native Onboarding management, Settings or LeadGen view is included | Existing routes remain available. Builder, public onboarding, client portal and account routes retain their separate boundaries. |
| Measurement | Content-free telemetry, static inventory, browser harness and percentile summaries | The telemetry migration and authenticated old/new measurement runs are not applied or inferred by the tooling. No production percentile claim is made. |

`docs/workspace-performance-inventory.md` and its JSON enumerate all discovered pages, handlers and server actions, including explicit implementation states. Static discovery does not prove a handler's runtime authorization or an interaction's completion behavior. Regenerate after removing local browser fixtures or changing routes. For queued command rollout and rollback, follow `docs/workspace-performance-command-operations.md`; reverting the UI must preserve pending receipts, local drafts and accepted jobs.

The deterministic contract and summary tests are executed in the repository test suite. No new production latency result is claimed by these utilities.
