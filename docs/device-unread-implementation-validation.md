# Device unread counts and progressive previews: implementation validation

Date: 11 October 2026. Status: implemented in an isolated candidate; **not deployed and no production migration or flag changes made**. The user approved the assessed implementation tradeoffs and separately selected “Preserve body search on demand.” Deployment still requires approval of these results.

## Candidate and implemented behavior

Base application: `f2cc3331dce775e89f4ad80e861460603fbdd56e`. Candidate branch: `codex/device-unread-progressive`. The candidate includes the earlier assessment commit `aa8c32ceb6cdd4ab156eb63d69d33fa8f6f8b786`; final runtime and validation source fingerprints are retained with the evidence archive.

- The server retains a private read cursor for each authenticated browser installation and calculates its unread counts, capped at 100 for the existing `99+` presentation. Incoming messages add no per-device counter writes. These are server-owned positions and derived counts, not client-only state or a copied integer counter on every message.
- An acknowledged device read updates its private cursor and the existing account cursor atomically. Precise timestamp/UUID ordering, deleted-message boundaries, visibility qualification and the durable retry queue are preserved. Account receipts and cross-device alert suppression still use the account cursor.
- Known installations inherit the migration's frozen account baseline; a new installation inherits current account positions once. Cookie loss starts a new installation. No TTL erases private history.
- The shell pins one protocol and one summary owner. Old shells retain account behavior; new device children cannot promote them. Private ACKs, caches and queues are fenced by account/workspace/installation/protocol.
- The initial roster contains metadata and counts. Visible previews use batches of at most 20; uncached rows show “Loading messages” with a spinner, failures show retry, and confirmed-empty rows show “No messages.” Selected history has an independent lane, bounded to 60 native or 500 Client messages. Cached history, replies, scroll ordering and later live messages survive metadata refreshes.
- Search preserves the existing latest-preview body matches, plus immediate local name matches. It debounces for 180 ms and pages through at most 20 authorized latest bodies at a time. Bodies remain on the server for canonical JavaScript Unicode matching; only matching conversation IDs reach the browser. Incomplete search is visibly pending and stale queries are cancelled. This is latest-preview search, not new full-history search.

## Validation

The complete repository suite passed **1,662 tests**, with no failures, skips or cancellations. The complete production Next.js 16.2.11 webpack build passed using loopback placeholders. The foundation gate preserved **277 historical migrations** and accepted one additive migration; changed-file lint and whitespace checks passed.

| Gate | Result and evidence boundary |
| --- | --- |
| Encrypted device SQL | 52 assertions passed using actual candidate RPCs, pgcrypto and canonical decoders, with synthetic Auth/Vault adapters. |
| Native PostgreSQL 16.14 concurrency | 6 checks passed on independent blocked connections: concurrent initialization, old/new writers, independent installations, same-device ordering and duplicate saves. |
| Browser foundations | 650 checks across Chromium and WebKit passed. These are actual component/helper fixtures, not deployed application sessions. |
| Existing confirmed reads | 160 checks passed; rejected/late reads, viewport and visibility cases retained. |
| Existing account convergence | 52 checks passed across separate browser contexts. |
| Native host after final count changes | 20 checks passed across both engines. |
| Broader browser regressions | All 17 packs passed: Communications polish/roster/reads/lifecycle, reconciliation/loading, Assets, Client Connections, service transfer, queue refresh, overlays and popup/routing lifetimes. A separate strict-mode Settings check passed 4/4. Some packs overlap the named counts above; do not add them as unique cases. |
| Broader SQL regressions | All 15 packs passed, including shared reads/unread, native inbox, unchanged push recovery, Library permissions, search, references, service transfer and appointment commands. |
| Complete production application | 88 candidate checks / 24 normal samples, zero errors; matched baseline 32 checks / 24 samples, zero errors. Eight cohorts: Chromium/WebKit × desktop/mobile × Client/native. |

The full-app harness uses the actual Next shell/proxy, browser UI, route handlers and encrypted SQL. It verifies a second installation keeps its count after an account read; preview loading does not create a read; a held or failed read retains the rendered badge; the same pending queue recovers on reconnect; and an uncached body-search match appears only after the final server page. Deterministically held preview responses prove selected history and its confirmed read can proceed independently.

Full-app Auth, surrounding REST metadata, Realtime transport, activity and notification-cleanup sinks are synthetic. The native SQL fixture uses direct-chat participation while the surrounding roster renders Team labels; production Team membership policy coverage is not established by that harness. Native concurrency and existing alert-policy SQL tests are separate evidence. No production login, provider delivery, physical Android/Chrome or iPhone/Safari/PWA, hosted CI run, or sustained-session stability is claimed. CI wiring was added, but has not been run remotely.

## Measured tradeoffs

### Read saves, summaries and growing datasets

Actual encrypted candidate SQL was measured with 30 observations after four warmups per operation, at 100 and 1,000 total chats (half Client, half native), 101 messages and 100 unread messages per chat. The table separates SQL execution from the enclosing local RPC. These are local PGlite measurements with synthetic Auth/Vault adapters, excluding HTTP, hosted authentication, production load, WAL, replication and physical device behavior.

**The measured extra SQL work per saved read is 0.042–0.066 ms, rather than a universal 0.02 ms.** Account-ahead and duplicate saves still pay for the private cursor. The transaction result grows from 156 to 689 raw JSON bytes (about 106–109 to 179–180 gzip bytes); the actual HTTP envelope differs.

| Chats | Read case | SQL median, account → device (ms) | SQL p95, account → device (ms) | Local RPC median, account → device (ms) |
| --- | --- | --- | --- | --- |
| 100 | client.advance | 0.083 → 0.148 | 0.103 → 0.212 | 0.180 → 0.257 |
| 100 | client.accountAhead | 0.074 → 0.140 | 0.101 → 0.263 | 0.162 → 0.232 |
| 100 | client.duplicate | 0.076 → 0.134 | 0.125 → 0.153 | 0.159 → 0.221 |
| 100 | native.advance | 0.098 → 0.158 | 0.112 → 0.180 | 0.185 → 0.248 |
| 100 | native.accountAhead | 0.090 → 0.151 | 0.104 → 0.164 | 0.173 → 0.240 |
| 100 | native.duplicate | 0.092 → 0.148 | 0.101 → 0.158 | 0.173 → 0.230 |
| 1,000 | client.advance | 0.073 → 0.119 | 0.087 → 0.227 | 0.159 → 0.206 |
| 1,000 | client.accountAhead | 0.063 → 0.113 | 0.066 → 0.129 | 0.143 → 0.194 |
| 1,000 | client.duplicate | 0.064 → 0.107 | 0.070 → 0.132 | 0.147 → 0.193 |
| 1,000 | native.advance | 0.150 → 0.198 | 0.154 → 0.283 | 0.234 → 0.285 |
| 1,000 | native.accountAhead | 0.143 → 0.191 | 0.146 → 0.207 | 0.223 → 0.276 |
| 1,000 | native.duplicate | 0.145 → 0.187 | 0.148 → 0.218 | 0.226 → 0.271 |

The device summary remains proportional to authorized conversations and counts at most 100 eligible unread messages per chat. Its local RPC median/p95 was **7.864/8.271 ms at 100 chats** (account 13.318/14.043), and **106.712/107.355 ms at 1,000** (account 161.587/162.776). Its raw result grows from 19.7 KB to 196.1 KB across these datasets; progressive previews do not make roster/count metadata constant-sized.

| Candidate operation | 100 total chats: median / p95 (ms) | 1,000 total chats: median / p95 (ms) | Bound / response |
| --- | --- | --- | --- |
| Client metadata roster | 0.857 / 0.905 | 6.815 / 7.021 | 50 / 500 rows; 8.5 / 84.1 KB JSON |
| Native metadata roster | 1.909 / 1.987 | 48.232 / 48.646 | 50 / 500 rows; 8.5 / 84.1 KB JSON |
| Client previews | 9.849 / 10.127 | 12.168 / 12.398 | 20 bodies; 17.1 KB JSON |
| Native previews | 14.653 / 15.045 | 15.671 / 15.858 | 20 bodies; 12.5 KB JSON |
| Selected Client history (101 present) | 43.507 / 45.242 | 42.507 / 42.850 | 101 bodies, limit 500; 63.2 KB JSON |
| Selected native history | 15.921 / 16.122 | 17.338 / 17.566 | 60 bodies; 23.8 KB JSON |
| Selected Client history (500 present) | 219.020 / 227.512 | 209.610 / 210.561 | 500 bodies; 309.4 KB JSON |

These operation times are local RPC wall times; each response is authorized and bounded. A full 500-message Client window is a larger selected-history operation (about 210–219 ms here), even though it no longer runs for every chat on entry.

### On-demand body search

The approved search tradeoff moves work from startup to the explicit query. Name filtering remains local. Latest-body search waits 180 ms, then uses sequential pages of up to 20 candidates with visible pending/error state and cancellation. It shares the preview lane, so queued previews may wait for search; selected history and read saves retain their independent path. A no-match query must finish all pages before absence is known.

| Matching / no-match search | 50 chats of that kind, 3 pages: median / p95 (ms) | 500 chats of that kind, 25 pages: median / p95 (ms) |
| --- | --- | --- |
| Client, all match | 24.182 / 24.991 | 361.218 / 366.450 |
| Client, no match | 24.000 / 24.964 | 362.090 / 369.146 |
| Native, all match | 35.842 / 36.235 | 925.117 / 932.075 |
| Native, no match | 35.639 / 37.663 | 926.093 / 932.252 |

Those search totals exclude the 180 ms debounce, HTTP/authentication and network round trips for each page. At 500 native chats, complete search still takes about **0.93 seconds of local RPC work plus those costs**. A slow network can therefore take materially longer. At 500 matches, browser JSON totals 23.2 KB (about 4.3 KB summed gzip); candidate bodies total 59.4 KB between database and server, not browser. No-match browser JSON is 3.7 KB. Query length is capped at 120 characters.

A query-plan defect found during validation was removed from the new native message enrichment join: adding its already-known conversation ID changed the raw metadata scan from 50,500 workspace rows / 1,531 buffer hits to 101 conversation rows / 6 hits. On the same encrypted fixture, alternating measurements retained identical preview/history/search outputs and reduced native preview-20 from 178.090 to 15.355 ms, history-60 from 23.697 to 14.880 ms, and full 500-chat search from 5,008.844 to 909.492 ms. That isolated proof used 30 preview/history and 10 search samples. The final measurements above are a fresh fixture, so differences across runs cannot all be attributed to that predicate.

### Initialization and retained storage

| Cost | 100 total chats | 1,000 total chats |
| --- | --- | --- |
| Known-installation seed only, SQL median | 0.618 ms | 5.994 ms |
| New-installation seed only, SQL median | 1.856 ms | 20.537 ms |
| First known-installation summary, local RPC median | 8.438 ms | 112.834 ms |
| First new-installation summary, local RPC median | 9.636 ms | 127.092 ms |
| Four new relations at cutover, including indexes/TOAST | 114,688 B | 294,912 B |
| After one initialized installation | 196,608 B | 573,440 B |
| After 100 installations (10,000 / 100,000 private cursor rows) | 2,408,448 B | 22,634,496 B |

Storage grows with retained installation/account/conversation state, not every incoming message. These are isolated relation sizes, excluding Auth/session bookkeeping, production WAL/backups and migration-lock duration. The capacity sample removes rollback-only benchmark churn before initializing the other 99 scopes; real updates can leave additional free space/bloat. Existing installation cutover records and account baselines must remain durable so a sleeping device does not silently inherit later account reads.

### Complete-app latency and resource observations

Both exact production builds ran against the same final SQL fixture: 48 chats, 101 encrypted messages per chat, 100 unread; three fresh browser contexts per cohort, reusing each run's server process. Below are **small-sample medians in milliseconds, baseline → candidate**, not p95 or production guarantees. Chromium/WebKit mobile are browser emulation, not physical Android/iPhone evidence. Raw min/max and observations are retained.

| Engine / viewport / chat | First name visible | First 99+ badge visible | First preview painted | Open selected history | HTTP read completed | Confirmed badge cleared |
| --- | --- | --- | --- | --- | --- | --- |
| Chromium / desktop / Team | 418 → 426 | 420 → 476 | 483 → 543 | 903 → 184 | 820 → 189 | 947 → 282 |
| Chromium / desktop / Client | 807 → 420 | 854 → 469 | 854 → 542 | 851 → 182 | 822 → 206 | 885 → 282 |
| Chromium / mobile / Team | 534 → 446 | 535 → 448 | 1160 → 526 | 248 → 182 | 374 → 374 | 481 → 415 |
| Chromium / mobile / Client | 1061 → 454 | 1064 → 455 | 1133 → 476 | 808 → 216 | 774 → 374 | 844 → 416 |
| Webkit / desktop / Team | 493 → 259 | 498 → 271 | 547 → 311 | 885 → 216 | 849 → 224 | 966 → 298 |
| Webkit / desktop / Client | 846 → 197 | 898 → 249 | 900 → 312 | 942 → 219 | 892 → 201 | 980 → 247 |
| Webkit / mobile / Team | 554 → 470 | 556 → 489 | 1177 → 557 | 874 → 216 | 870 → 386 | 943 → 465 |
| Webkit / mobile / Client | 1119 → 461 | 1121 → 474 | 1189 → 545 | 944 → 248 | 905 → 370 | 980 → 448 |

**The slower cold-entry cohort is retained:** Chromium desktop Team showed its first name about 8 ms later, its first unread badge about 56 ms later and its first preview about 60 ms later. The focused five-sample repeat found preview 469 → 543 ms (74 ms later). That is a progressive-loading tradeoff; faster selected history does not cancel it out. The earlier apparent ~330 ms preview regression was overstated by adaptive test polling and is retained as superseded measurement evidence. No blanket claim that every action is faster is made.

The corrected runner uses immediate visibility checks every 40 ms rather than locator waits with increasing backoff. HTTP completion is timestamped independently of selected-history paint; count readiness is observed concurrently with preview loading. These are test observations with scheduling/driver overhead. Rows are CSS-visible within the app surface; full browser trace paint timing and every visible row are not measured.

| Engine / viewport / chat | Complete body search (ms) | API response events through badge clearance | Resource-entry encoded body bytes through badge clearance |
| --- | --- | --- | --- |
| Chromium / desktop / Team | 58 → 280 | 22 → 23 | 3,014,660 → 1,091,351 |
| Chromium / desktop / Client | 33 → 265 | 20 → 23 | 2,683,336 → 1,133,755 |
| Chromium / mobile / Team | 33 → 268 | 19 → 20 | 2,616,790 → 716,381 |
| Chromium / mobile / Client | 33 → 267 | 18 → 20 | 3,468,293 → 787,697 |
| Webkit / desktop / Team | 83 → 280 | 21 → 23 | 2,578,145 → 1,038,049 |
| Webkit / desktop / Client | 38 → 261 | 21 → 23 | 2,630,318 → 1,080,507 |
| Webkit / mobile / Team | 33 → 283 | 20 → 22 | 3,828,850 → 745,281 |
| Webkit / mobile / Client | 33 → 266 | 19 → 22 | 3,844,982 → 822,003 |

Search is slower because it now performs the separately approved on-demand server work instead of filtering already-downloaded preview bodies. These 48-chat runs complete two pages for the active kind and include debounce and final result paint. They do not establish the 500-chat HTTP time; its larger SQL and page count are reported separately above.

The resource column is **not a complete network-transfer total**. It sums completed `PerformanceResourceTiming` encoded bodies across frames through confirmed badge paint; navigation entries are not added (top-level HTML and any document bodies not exposed as resources are excluded), cached/frame copies can be counted, and later background/search traffic is outside the boundary. The historically named `apiRequests` field counts observed API response events, not all started requests. It increased by 1–3 in these medians. New JavaScript resource bodies add about 9.0 KB on desktop and 7.4 KB on mobile; reduced message bodies outweigh that increase within this measured boundary. No bundle, memory, battery or whole-session traffic guarantee is inferred.

The earlier approved account-ahead recovery, cold offscreen preview/history and shaped-network costs remain in the separate assessment. This complete-app run does not re-measure production networks, hosted Realtime, sustained CPU/memory/battery use or slow-network 500-chat search. Deterministic failures, held responses and independent SQL concurrency verify the listed recovery/order properties, not a production latency ceiling.



All measurements are isolated observations. The earlier approved assessment used a different helper fixture and shaped API transport; it is retained in `docs/device-unread-progressive-assessment.md` and is not re-labelled as production-app evidence. The first exploratory complete-app reports had an insufficient search completion boundary and have been superseded by the final runs. Database execution, local RPC wall time, HTTP acknowledgement and painted badge completion are distinct boundaries.

## Evidence and reproduction

Evidence directory: [/Users/jedryszczyk/.codex/visualizations/2026/10/11/01a12a07-521b-77d1-90ce-f3067fa0af38/device-unread-implementation-2026-10-11](/Users/jedryszczyk/.codex/visualizations/2026/10/11/01a12a07-521b-77d1-90ce-f3067fa0af38/device-unread-implementation-2026-10-11). Main files:

- `be-device-full-app-release-comparison.json`: all eight cohort medians/min/max and resource breakdowns.
- `be-full-app-device-release.json` and `be-full-app-baseline-release.json`: final corrected full-app checks, timings and individual resource/response observations, with logs and loading screenshots.
- `device-unread-production-measure.json`: 30-sample encrypted SQL/RPC results and retained storage.
- `device-unread-production-sql.json`, `device-unread-native-postgres.json`, `device-unread-native-window-plan.json`: correctness, independent-connection concurrency and the isolated query-plan proof.
- Repository/build/foundation logs, broader browser/SQL summaries and `browser-results/` evidence.
- `source-manifest.json` and `validation-provenance.json`: source hashes, exact local commit and compared build IDs.

Older `*-final*` and `*-focused*` browser files are retained under `superseded/`; they are not the final timing evidence. Their original raw files are preserved. Before the final rerun, a mutable response-array reporting bug was corrected; those earlier processed JSON files retain the exact prefix recorded by their response count plus a labelled remainder. The final `*-release.json` files are direct runner outputs and need no reconstruction.

The checked-in reproduction guide is `scripts/full-app-device-unread/README.md`. SQL measurement and concurrency scripts live in `scripts/device-unread-progressive/`. The evidence archive includes the compared build IDs, source hashes, raw timings, test logs and final browser screenshots. The primary checkout and its unrelated feasibility document were preserved.

### Rollout and rollback

Production installation and deployment remain unapproved until the user reviews
the implementation results. After explicit approval, verify the exact application
revision and migration, install the additive
`20261011120000_device_communications_progressive.sql` migration first, then
deploy the tested application with the intended workspace/user rollout scope.
Do not infer production validation from the isolated tests.

`WORKSPACE_COMMUNICATIONS_DEVICE_UNREAD` selects `device-v1` for new shells.
Use comma-separated workspace IDs (or `all` only when expressly intended).
`WORKSPACE_PERFORMANCE_USERS` further restricts that selection to its
comma-separated user IDs; unset/empty means every eligible user in the selected
workspaces, and `all` accepts every user. These flags select a protocol and do
not replace authentication, session/device binding, MFA or conversation access.

`WORKSPACE_COMMUNICATIONS_DEVICE_UNREAD_COMPAT` preserves the device API and
explicitly pinned device page protocol for existing owners. It uses the same
workspace syntax and `WORKSPACE_PERFORMANCE_USERS` restriction. Device requests
are supported when either activation or compatibility matches; compatibility
alone does not create device owners for ordinary new shells. Keep the approved
compatibility workspace/user scope available for all retained device owners.

For a reversible rollout, retain compatible application handlers and the
matching compatibility scope while disabling activation. Ordinary new shells
then select `account-v1`; already-mounted device shells, their resident children
and queued read intents keep their pinned namespace and can finish/recover.
A shell reload starts the newly selected protocol. Do not silently retarget an
existing device read queue to account mode. Disabling both flags makes device
requests fail explicitly (503 at the API), retaining unacknowledged intent;
it is not a transparent rollback. An application rollback to a pre-device server
also cannot support retained device clients, so preserve compatible handlers
until those owners have been retired.

Preserve device cursor tables, initialized scopes, cutover installation records
and frozen baselines. Do not delete private history, TTL it away, recalculate its
baseline from later account reads, or reverse the migration by erasing rows.
Preserve messages, drafts, account read cursors and queued alert/delivery history.
Cookie loss is a new installation, not a way to recover its previous private
position. Account receipts, server-confirmed reads and cross-device alert
suppression retain their existing semantics throughout rollout and rollback.
