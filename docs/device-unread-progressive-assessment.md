# Device unread counts with progressive previews

Assessment date: 2026-10-11. Baseline: `f2cc3331dce775e89f4ad80e861460603fbdd56e`. Diagnostic branch: `codex/device-unread-progressive`.

Status: isolated candidate and measurements for approval. No application runtime, production schema, alert contract, speed contract, rollout flag, or deployment changed. The user authorized investigation of server-stored device counts and progressive preview loading while retaining server-confirmed reads and cross-device alert suppression. This is not approval to ship a speed regression.

The recommended design is viable for application implementation and validation, with explicit speed costs. In the isolated slow-network fixture, Team previews improved from about 2.5 seconds to 0.54 seconds, but first uncached Client selection became about 0.21 seconds and device confirmation added a wait when the account was already read elsewhere. The guarded SQL save added about 0.05 ms. Use the independently scheduled selected-history variant. These results support a design decision, not production release approval.

## Proposed behavior

Each browser installation has a server-stored reading position for each conversation. The count is computed from that position; it is not reconstructed from locally downloaded bodies. The existing account-wide reading position continues to drive human receipts and cross-device alert suppression. A successful read transaction advances the installation position and, if necessary, the account position. A failed transaction advances neither. The additional private write introduces another possible transaction failure; atomic rollback preserves correctness but does not prove identical save availability. Device badge clearing still waits for server acknowledgement.

The chat list receives authorized names, stable ordering metadata, and a separate workspace count summary. Visible preview bodies load in batches of at most 20 with one batch in flight. The selected chat has its own request slot and receives its history and confirmed reading position together, so an unrelated preview does not hold it up. Preview/history concurrency is bounded at two. The earlier shared-queue comparison is recorded below. Offscreen bodies stay deferred. A device with 10,000 unread messages does not download 10,000 bodies to fill the preview; it needs the latest preview and a bounded selected history window. Retained previews remain visible during refresh; a genuinely missing preview shows `Loading messages` and a spinner. Failure produces an explicit retry state. A confirmed empty chat says `No messages`. Unknown counts do not display zero.

Names/order metadata and the summary still scale with all authorized conversations; only preview body work is bounded by the viewport.

The summary retains the existing cap of 100 per chat, displayed as `99+`; it does not promise an exact arbitrary total. The independent summary makes an unread filter possible without loading every message body. A preview completing, a spinner appearing, or a selected chat opening is not itself a read; the existing foreground/newest-visible/uncovered eligibility remains necessary.

## What stays shared

Keep the canonical account cursor, account receipt events, notification dismissal, delivery recovery and suppression logic. Add a separate installation acknowledgement/event namespace for badge state; an account receipt from another installation cannot clear this installation's badge. Retain post-acknowledgement summary reconciliation and focus/online recovery. Use one summary owner per mounted shell.

Pin the protocol before the shell owner mounts, carry it through native panel/cache keys and legacy frame negotiation, and let an old shell keep its existing account semantics. A child frame must not independently switch its parent to device semantics or add another summary owner. These product integration changes are requirements, not implemented by this diagnostic fixture. Full microsecond timestamp/message-ID frontiers, explicit confirmed-null versus unknown positions, stale-response fencing and same-installation sibling-tab reconciliation remain mandatory. No silent account-only fallback may clear a device badge.

Successful transactions preserve existing suppression decisions, but additional binding, initialization or private-write failure can delay account confirmation and hence suppression. The diagnostic tests do not prove identical real-world notification timing or delivery.

## Data and cutover decisions

- Known installations start from a frozen account cursor snapshot at cutover. Earlier device-specific history cannot be reconstructed because it was never stored.
- A newly recognized installation starts from current shared account positions once, then advances independently.
- Clearing local caches while retaining the installation cookie restores the saved server positions. Losing the installation cookie creates a new installation; server storage does not identify a device whose identifier has been lost.
- An old offline browser absent from the inventory is indistinguishable from a new installation. Reads made by an old shell after cutover are not independent device observations; after an upgrade those messages can appear unread for that installation.
- Private storage grows with initialized installations times retained conversation positions. There is no assumed destructive expiry of old device history.
- Initialization copies conversation positions once. Live-session binding is still required; a first visit may need the existing device-observation request before a device summary succeeds. This extra serial request is not included in the preinitialized browser cases.
- The held cutover snapshots all known installations and all shared cursors across accounts/workspaces. Per-workspace initialization timings do not measure that one-time production migration; its total rows, transaction duration, locks and WAL require a rehearsal.

## Measurement boundaries

The SQL harness uses isolated PGlite with canonical current read/summary/inbox SQL, the held device-cursor candidate, and a bounded diagnostic preview RPC. It measures database execution, initialization, row writes, storage and synthetic response size. Plaintext synthetic bodies intentionally omit production encryption/decryption. Access/session fixture tables allow policy cases but do not measure real Supabase authentication or provider latency. Native message indexes match the current source inventory; Client fixtures omit provider-scoped indexes and columns, so their timings do not represent the complete production index inventory. A single PGlite connection cannot establish real PostgreSQL concurrent locking, WAL, replication or production load behavior.

The browser harness bundles production React and current source read/summary/visibility/recovery hooks. A diagnostic HTTP server connects those hooks to the SQL fixture. The shell, notifications and telemetry transport are adapters. Both arms use the same unminified production-React bundle; asset transfer is not network shaped. The simple diagnostic input is not the product composer, and no incremental production bundle, memory, CPU or battery measurement is claimed. Network conditions are artificial RTT and one aggregate compressed-body budget per run, with whole responses scheduled by completion order; this is not TCP or a physical cellular connection. HTTP headers, TLS, external authentication, real decryption and the full Next app are excluded. The server's bootstrap staging is synthetic rather than the current app's complete parallel bootstrap. Browser timings are comparative fixture observations, not production latency promises or a passed `app_speed.md` release gate.

## Database observations

All times below are warmed SQL execution milliseconds, median / p95, with 30 observations per arm after five warmups. Main read-only arms alternate order. Total chats split equally between Client and Team; the preview batch covers at most 20 Team chats. Responses are uncompressed synthetic JSON bytes. The 1,000-chat first pass had brief unrelated local correctness activity and is exploratory; its uncontended repeat is recorded separately below.

| Total chats / installations / unread per chat | Shared summary ms | Device scalar summary ms | Current Team inbox ms | Visible Team preview batch ms | Current inbox / preview bytes |
| --- | ---: | ---: | ---: | ---: | ---: |
| 20 / 1 / 0 | 0.589 / 0.782 | 0.508 / 0.611 | 0.685 / 0.823 | 0.511 / 0.636 | 4,665 / 4,561 |
| 20 / 1 / 100 | 2.774 / 2.905 | 1.627 / 1.679 | 5.496 / 5.632 | 0.513 / 0.566 | 151,655 / 4,561 |
| 200 / 1 / 100 | 29.358 / 30.784 | 16.778 / 17.836 | 136.071 / 165.539 | 1.237 / 1.344 | 1,516,325 / 9,061 |
| 1,000 / 1 / 100 | 170.373 / 191.515 | 114.673 / 125.664 | 2453.990 / 2786.490 | 2.481 / 2.690 | 7,581,525 / 9,061 |
| 200 / 20 / 100 | 29.089 / 29.851 | 16.706 / 17.923 | 134.753 / 135.732 | 1.207 / 1.273 | 1,516,325 / 9,061 |
| 200 / 100 / 100 | 29.133 / 30.322 | 16.605 / 17.855 | 134.799 / 138.111 | 1.216 / 1.277 | 1,516,325 / 9,061 |
| 20 / 1 / 10,000 | 4.400 / 4.784 | 3.585 / 3.768 | 473.879 / 479.675 | 0.539 / 0.573 | 14,704,655 / 4,561 |

The inbox and preview columns deliberately expose different scopes: all Team previews plus all unread IDs versus only a visible batch with its saved positions. The proposal also needs the separate workspace summary and selected history. These are not interchangeable full-request latency measurements. At 200 chats, the device count-only summary is 39,293 bytes versus 105,708 bytes with every device cursor included. Fetching a conversation cursor with its preview/history avoids that full cursor-map payload. At 10,000 unread messages per chat, the count stays capped while the existing Team unread-ID payload grows.

### Confirmed read saves

60 alternating observations per arm after eight warmups, with 200 total chats and 100 initialized installations (20,000 private cursor rows). Both arms call a save RPC in this SQL test.

| Conversation / operation | Current shared save ms | Device + shared save ms |
| --- | ---: | ---: |
| client / advance | 0.070 / 0.077 | 0.120 / 0.136 |
| client / accountAhead | 0.065 / 0.072 | 0.117 / 0.137 |
| client / duplicate | 0.066 / 0.069 | 0.114 / 0.124 |
| native / advance | 0.096 / 0.101 | 0.147 / 0.153 |
| native / accountAhead | 0.088 / 0.095 | 0.138 / 0.147 |
| native / duplicate | 0.087 / 0.094 | 0.135 / 0.140 |

The complete guarded candidate adds about 0.05 ms to an advancing database save in this fixture. Its SQL result grows from 156 to 689 bytes. A new read changes one private row plus the account row when needed; an account-ahead read changes only the private row; a duplicate changes neither. There is no extra private write per incoming message or copy of message history per installation. These SQL timings do not include network, auth or production durability.

**Previously request-free observations are a separate cost.** If another installation has already advanced the account, the current reader can send no save at all. The independent device now needs its own save POST plus post-acknowledgement summary GET. Comparing two invoked RPCs does not price this zero-to-network change. Browser cases below measure it separately.

### First scope initialization

| Total chats / existing installations | Known-installation seed ms | First device summary including seed ms |
| --- | ---: | ---: |
| 20 / 1 | 0.151 / 0.192 | 1.770 / 1.867 |
| 200 / 1 | 1.149 / 1.204 | 19.482 / 24.797 |
| 1,000 / 1 | 5.880 / 6.228 | 121.165 / 124.522 |
| 200 / 20 | 1.366 / 1.452 | 18.735 / 19.548 |
| 200 / 100 | 2.374 / 2.520 | 19.019 / 19.569 |

These are per-workspace initialization costs after identity exists, not the fleet-wide cutover migration or first-session device-registration request. Private relation allocations from the main run include initialization churn; use the fresh-storage supplement for retained-size examples.

### Fresh storage, new installations and Client payloads

Fresh relation sizes below were captured before repeated initialization. They include heap, indexes and PostgreSQL ancillary allocation in this synthetic fixture; they are not production storage forecasts. New-installation seed timings use 30 warmed observations, median / p95.

| Total chats / installations | Device cursor rows | Device cursor relation bytes | All four private relations bytes | New-installation seed ms |
| --- | ---: | ---: | ---: | ---: |
| 20 / 1 | 20 | 32,768 | 114,688 | 0.428 / 0.623 |
| 200 / 1 | 200 | 106,496 | 253,952 | 3.813 / 4.110 |
| 1,000 / 1 | 1,000 | 278,528 | 589,824 | 20.520 / 38.289 |
| 200 / 20 | 4,000 | 1,114,112 | 1,261,568 | 3.839 / 4.033 |
| 200 / 100 | 20,000 | 5,595,136 | 5,775,360 | 4.844 / 5.071 |

At 200 total chats, the current Client global-2,000-row body projection is 714,001 uncompressed bytes and 7.095 / 7.194 ms, before decryption and route work. This initial preloading also gives many other Client chats a resident history window: deferring it trades a smaller initial payload for a possible first-selection wait. The browser Client comparison retains those baseline windows rather than incorrectly charging both arms a history request.

The uncontended 1,000-chat repeat measured shared summary 170.205 / 173.330 ms, device summary 115.378 / 117.688 ms, and 20 native previews 2.325 / 2.464 ms. The heavier earlier inbox figure remains an exploratory single-environment observation.

The paired account-ahead supplement also found that the current shared summary can spend more CPU resolving/joining historical positions even when its result is empty. At 20 chats with 10,000 historical unread messages each, current account-ahead summary was 302.543 / 311.139 ms versus 3.812 / 4.253 ms for the normalized device-behind summary. The empty shared result is still only 2 bytes versus 4,013 bytes for device counts. This confirms a local query improvement, not a reason to ignore additional requests or a claim about production plans.

## Browser observations

Team main matrix: 160 cold trials, 10 per arm in each of eight engine/viewport/network cohorts, no failures. Dataset: 200 total chats, 100 per mode, 100 unread messages per chat; selected Team window 60. Profile `150 ms / 1 Mbps` is the synthetic JSON-API shaping model described above. Milliseconds below are median / observed p95; with 10 samples, p95 is the largest observation, not a reliable tail guarantee.

| Engine / viewport / network | Selected content, shared → device | Visible previews, shared → device | Confirmed badge zero, shared → device |
| --- | ---: | ---: | ---: |
| chromium / desktop / 150 ms / 1 Mbps | 2506 / 2523 → 350 / 356 | 2506 / 2523 → 539 / 554 | 2705 / 2723 → 540 / 554 |
| chromium / desktop / loopback | 255 / 314 → 88 / 114 | 255 / 314 → 89 / 114 | 289 / 346 → 155 / 163 |
| chromium / mobile / 150 ms / 1 Mbps | 2506 / 2555 → 348 / 387 | 2506 / 2555 → 540 / 555 | 2705 / 2754 → 540 / 588 |
| chromium / mobile / loopback | 256 / 272 → 89 / 109 | 256 / 272 → 89 / 143 | 289 / 308 → 155 / 193 |
| webkit / desktop / 150 ms / 1 Mbps | 2513 / 2525 → 374 / 377 | 2513 / 2525 → 532 / 571 | 2714 / 2732 → 564 / 572 |
| webkit / desktop / loopback | 252 / 301 → 99 / 118 | 252 / 302 → 99 / 118 | 290 / 350 → 148 / 167 |
| webkit / mobile / 150 ms / 1 Mbps | 2512 / 2522 → 373 / 411 | 2513 / 2522 → 544 / 573 | 2712 / 2720 → 568 / 606 |
| webkit / mobile / loopback | 250 / 256 → 95 / 102 | 250 / 256 → 96 / 102 | 290 / 301 → 144 / 154 |

The candidate delivered 23,667–23,754 compressed response bytes versus 278,604–278,614 for the baseline through confirmed cold-state reconciliation (about 91% less synthetic transfer), with **five requests rather than four**. The additional request is the visible preview batch. A badge can clear after the confirmed save while its required reconciliation GET is still running; the transfer/request totals include that reconciliation.

| Engine / viewport / network | Read POST → server ACK, shared → device ms | First other Team chat paint, shared → device ms |
| --- | ---: | ---: |
| chromium / desktop / 150 ms / 1 Mbps | 161 / 163 → 158 / 160 | 197 / 198 → 196 / 204 |
| chromium / desktop / loopback | 2 / 4 → 2 / 3 | 65 / 82 → 64 / 81 |
| chromium / mobile / 150 ms / 1 Mbps | 161 / 164 → 158 / 162 | 197 / 198 → 196 / 197 |
| chromium / mobile / loopback | 2 / 2 → 2 / 6 | 64 / 81 → 64 / 65 |
| webkit / desktop / 150 ms / 1 Mbps | 161 / 168 → 158 / 160 | 213 / 215 → 213 / 214 |
| webkit / desktop / loopback | 3 / 3 → 3 / 3 | 30 / 31 → 30 / 30 |
| webkit / mobile / 150 ms / 1 Mbps | 161 / 167 → 159 / 160 | 214 / 215 → 213 / 213 |
| webkit / mobile / loopback | 3 / 3 → 3 / 3 | 30 / 31 → 30 / 31 |

The advancing-save network observations do not show a large added round trip when both arms already save. Small loopback/ACK differences are not production gains or a proof of equal latency. In this first matrix, warm switches measure retained-view paint only: the actual Team component also refreshes selected history in the background, which this initial bundle omitted in both arms. Later matrices restore that request. The main matrix used the original single-flight queue; an explicit independent-selection variant is measured below. The exact measured bundle is retained with its hash.

### Client first-selection and scrolling costs

80 Client trials, five per arm/cohort, no failures, using the independent selected-history lane. The baseline retains the actual 2,000-row global snapshot: 100 loaded chats, with 20 messages in the first alternate chat. The candidate initially loads only selected history; opening the alternate chat fetches its available 101 messages (bounded at 500). This compares current and proposed behavior, not identical body windows. The larger selected window does not erase the new first-selection wait. With five observations, reported p95 is the largest sample.

| Engine / viewport / network | Visible previews, shared to device ms | First alternate Client selection, shared to device ms | First offscreen preview, shared to device ms |
| --- | ---: | ---: | ---: |
| chromium / desktop / 150 ms / 1 Mbps | 1071 / 1073 to 556 / 571 | 40 / 47 to 213 / 214 | 33 / 33 to 233 / 235 |
| chromium / desktop / loopback | 122 / 162 to 88 / 91 | 32 / 36 to 64 / 64 | 33 / 33 to 66 / 66 |
| chromium / mobile / 150 ms / 1 Mbps | 1080 / 1094 to 562 / 575 | 38 / 52 to 212 / 213 | 33 / 33 to 232 / 235 |
| chromium / mobile / loopback | 122 / 127 to 89 / 91 | 38 / 43 to 64 / 81 | 33 / 33 to 65 / 66 |
| webkit / desktop / 150 ms / 1 Mbps | 1066 / 1074 to 544 / 546 | 27 / 30 to 212 / 213 | 33 / 34 to 234 / 237 |
| webkit / desktop / loopback | 115 / 194 to 97 / 101 | 30 / 31 to 30 / 30 | 33 / 34 to 67 / 67 |
| webkit / mobile / 150 ms / 1 Mbps | 1051 / 1067 to 533 / 541 | 28 / 30 to 212 / 214 | 34 / 34 to 233 / 246 |
| webkit / mobile / loopback | 115 / 125 to 99 / 159 | 30 / 31 to 30 / 30 | 34 / 35 to 67 / 67 |

Client cold response transfer was 107,231-107,242 compressed bytes versus 24,712-25,715. Initial requests were four in the baseline and five in 39 of 40 candidate trials. One WebKit/mobile/loopback candidate trial issued six requests, including a duplicate preview batch. This scheduler race was found in the independent audit; the original measurements are retained, with the correction and focused verification documented separately below. First alternate selection adds one selected-history GET, and first offscreen reveal adds one bounded preview-batch request. The already visible name/count remains usable while its body preview loads. Warm offscreen revisits remained about 33 ms in the shaped-network fixture. Caches must retain valid visited content; retained histories and memory growth still need a bounded production integration and profiling.

### Account already read elsewhere

80 Native trials, five per arm/cohort, no failures. Every shared account cursor starts at the latest message while this known installation remains behind its own cutover position. This is the case where the existing app needs no read POST, but the proposed device must confirm its own observation.

| Engine / viewport / network | Visible previews, shared to device ms | Confirmed zero badge, shared to device ms |
| --- | ---: | ---: |
| chromium / desktop / 150 ms / 1 Mbps | 371 / 373 to 538 / 539 | 371 / 373 to 538 / 539 |
| chromium / desktop / loopback | 121 / 155 to 88 / 89 | 121 / 155 to 154 / 155 |
| chromium / mobile / 150 ms / 1 Mbps | 371 / 378 to 540 / 544 | 371 / 378 to 540 / 544 |
| chromium / mobile / loopback | 108 / 122 to 94 / 107 | 108 / 122 to 156 / 161 |
| webkit / desktop / 150 ms / 1 Mbps | 371 / 401 to 533 / 543 | 371 / 401 to 566 / 577 |
| webkit / desktop / loopback | 114 / 194 to 92 / 95 | 114 / 194 to 140 / 143 |
| webkit / mobile / 150 ms / 1 Mbps | 374 / 376 to 519 / 551 | 374 / 376 to 552 / 555 |
| webkit / mobile / loopback | 115 / 117 to 94 / 99 | 115 / 117 to 145 / 149 |

Here the cold path grows from **two requests to five**: the extra preview batch plus the device read POST and its required summary reconciliation GET. Compressed response bytes grow from 11,546 to 23,662-23,744. Under the shaped network, the badge reached confirmed zero in roughly 371-374 ms before versus 538-566 ms with device counts. The device save itself needed roughly 158 ms. An initial device summary still reports unread until this device qualifies and the server acknowledges; no optimistic badge clearing is used.

The refined bundle restores the current Team background history refresh on warm selection. Fast retained-content paint does not imply no network work. Typing samples use a plain diagnostic input and cannot certify the real composer, mobile keyboard, CPU or battery performance.

### Keep selected chats independent of preview loading

The recommended variant has one bounded preview batch and a separate selected-history request slot: at most two preview/history requests in flight. This prevents an unrelated slow preview from occupying the selected-chat slot. Selected content still requires its own acknowledged history/frontier response.

In 24 controlled observations (three per browser/viewport/lane), the API model added 150 ms RTT, 1 Mbps aggregate body throughput and a deliberate 500 ms preview delay. These small samples test queue behavior, not normal-load production latency.

| Engine / viewport | Shared queue selected paint median ms | Independent lane selected paint median ms |
| --- | ---: | ---: |
| chromium / desktop | 865.9 | 198.7 |
| chromium / mobile | 867.4 | 198.5 |
| webkit / desktop | 865.0 | 199.0 |
| webkit / mobile | 866.0 | 217.0 |

Both variants issued exactly one selected-history request. Maximum observed preview/history concurrency was one for the shared queue and two for the independent lane. Use the independent lane in the proposed application implementation; preserve current selection cancellation, cache ownership and stale-response rules.

### Duplicate-request audit and correction

The independent audit found one duplicate preview batch among the original 40 candidate Client trials. A deterministic stress case then reproduced it: repeated visibility checks in the short gap between request completion and the committed React render admitted the same IDs again (two batches, 11 duplicate IDs). The original measurement files and bundle remain unchanged.

The corrected diagnostic scheduler records completed/failed preview admission synchronously, without making local state authoritative for reads. A separate preview generation prevents an older response from consuming a refresh requested while it was in flight. In 40 corrected WebKit/mobile/Client stress runs (20 per queue variant, each forcing 20 checks at completion), every run issued exactly one preview batch and zero duplicate IDs. The final corrected fixture also passed 48 shared-lane and 48 independent-lane lifecycle checks, including a held response followed by a newer refresh. One intermediate test attempt raced an automatically disappearing Retry control; its test ordering was stabilized before the final passing run. These focused results validate the correction; they do not replace the original timing matrix or prove production deduplication.

## Correctness and remaining evidence

- 32 sequential SQL checks from the main/behavior harness and 26 independent protocol checks passed: 58 total. They cover separate device positions, canonical shared progress, duplicate writes, tuple ties and deletion, access/session denial, clear boundaries, initialization/reset and atomic rollback.
- The original 88 browser lifecycle checks passed across Chromium/WebKit and desktop/mobile viewports for both queue variants. Pending and lost-ACK reads do not clear the badge prematurely; retries, cache-loss recovery, retained previews, stale responses, unknown counts, initial load retry, scope disposal and inactive-view work are covered.
- 320 main browser trials completed with no recorded errors, plus 24 explicit account-ahead request checks and 24 selection-priority observations. The HTML/bundle, API wrappers, source revisions and conditions differ from the full product; the exact measured bundles are retained.
- Workspace inactive-view tests are not real OS suspension/locked-phone tests. The current device/account broadcast split, mixed-version shell negotiation, same-installation concurrent tabs, real auth, native PostgreSQL concurrent sessions, full-app memory/bundle/CPU/battery behavior and actual push delivery remain release gates.
- Failed/lost acknowledgements preserve correctness but can increase saves from one POST to a retry. The completion time depends on recovery; this report does not establish a production reconnect or background-delivery deadline.

## Evidence and reproduction

The checked-in diagnostic source is under `scripts/device-unread-progressive/`. SQL result/provenance files are alongside it. Node v24.16.0 and PGlite v0.5.8 were used. Read `sql-notes.md` for exact function/index provenance. The raw browser trials, exact measured bundles, independent review results and a SHA256 manifest are retained in the [evidence directory](/Users/jedryszczyk/.codex/visualizations/2026/10/11/01a12a07-521b-77d1-90ce-f3067fa0af38/device-unread-progressive-2026-10-11).

Run from this worktree, with the optional PGlite package installed as documented by `scripts/pglite-fixture.mjs`:

```sh
export BE_PGLITE_ROOT=/private/tmp/be-device-redesign-pglite
node scripts/device-unread-progressive/sql-measure.mjs /private/tmp/sql-results.json
node scripts/device-unread-progressive/sql-supplement.mjs /private/tmp/sql-supplement.json
node scripts/device-unread-progressive/sql-behavior.mjs /private/tmp/sql-behavior.json
node scripts/device-unread-progressive/review-protocol.mjs /private/tmp/protocol.json
node scripts/device-unread-progressive/browser-serve.mjs
```

Use the printed loopback URL with `browser-measure.mjs`, `browser-check.mjs` and `browser-priority.mjs`. Run one benchmark at a time. The defaults measure native shared-queue behavior; use `BE_BROWSER_KIND=client`, `BE_BROWSER_ACCOUNT_AHEAD=1` and `BE_BROWSER_SELECTION_LANE=independent` for the refined cohorts. Set `BE_BROWSER_SAMPLES=5` for the Client/account-ahead runs (10 for the Native main run). The original Native bundle predates the source-faithful Client cache and Team background-refresh refinements; its preserved bundle and metadata identify that exact run. The separate `browser-dedup.mjs` script exercises the admission stress case. No benchmark connects to production.

## Approval scope and release gates

The decision requested is approval to implement and benchmark the complete application candidate with the disclosed costs, followed by a separate release decision. These fixture observations are not production slowdown ceilings.

Any approval should cover the specific costs shown by the completed measurement tables, including previously request-free device reads, deferred uncached previews, initialization and retained storage. Startup gains cannot cancel slower actions under the existing per-action speed rule. The loading spinner does not count as completed content.

Before release, integrate the pinned protocol and distinct account/device event owners into the real application, measure matched production builds with real authorization and encryption, exercise actual PostgreSQL concurrent old/new writers and initialization, and verify authenticated Chromium/Android and WebKit/iPhone behavior. Physical-device checks, push delivery, deployment and production performance are separate evidence. A scoped speed-contract update requires the user's explicit acceptance; no contract has been changed by this assessment.

Rollback should restore account badge semantics through the same pinned protocol boundary while retaining private tables and saved device history. Rollout must be additive and capability gated; old sessions remain readable. Application rollback does not remove storage already retained or private writes from still-running new clients.
