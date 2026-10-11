# Device unread validation with the complete Next application

This harness opens a built production Next application in Chromium and WebKit,
using loopback HTTP and an isolated database. It exercises the actual workspace
shell, proxy, Communications components, API handlers and encrypted Comms SQL.
It is validation tooling; it does not deploy the application or contact a hosted
Supabase project or delivery provider.

## Reproduce

Use Node 24.16.0 and an isolated checkout of the exact application candidate.
Keep production environment files and credentials out of that checkout. Ports
45678 and 45679 must be free. Run only one harness instance at a time.

From the candidate checkout:

```sh
npm ci
npm ci --prefix scripts/browser --ignore-scripts
node scripts/browser/node_modules/playwright/cli.js install chromium webkit

device_fixture_deps=$(mktemp -d /tmp/be-device-pglite.XXXXXX)
npm install --prefix "$device_fixture_deps" --no-save --ignore-scripts --package-lock=false @electric-sql/pglite@0.5.8

NEXT_TELEMETRY_DISABLED=1 \
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:45679 \
NEXT_PUBLIC_SUPABASE_ANON_KEY=fixture-only \
SUPABASE_SERVICE_ROLE_KEY=fixture-service \
NEXT_PUBLIC_SITE_URL=http://127.0.0.1:45678 \
npx next build --webpack

BE_BROWSER_TEST_ROOT="$PWD/scripts/browser" \
BE_PGLITE_ROOT="$device_fixture_deps" \
node scripts/full-app-device-unread/run.mjs "$PWD" device /tmp/device-full-app.json
```

On Linux, the browser installation may also need Playwright's `--with-deps`
option. The CI recipe is the `device-full-app` job in
[foundations.yml](../../.github/workflows/foundations.yml).

The runner accepts `run.mjs BUILT_CHECKOUT [device|baseline] [OUTPUT_JSON]`.
Run it from the checkout containing this harness. `BUILT_CHECKOUT` supplies the
complete `.next` build; it can point to a separately built baseline checkout.
Build that checkout with the same loopback variables, then pass its absolute
path and `baseline`. Baseline mode disables the device activation flag; it does
not itself select an earlier Git revision. Record the exact baseline and
candidate revisions separately. Both runs use the current harness's SQL fixture,
including the compatible account RPCs and additive device migration.

The runner starts and stops both local HTTP services and creates a fresh
in-memory database. It supplies the app process with synthetic configuration,
`WORKSPACE_NATIVE_PANELS=all`, `WORKSPACE_COMMUNICATIONS_BOUNDED_READS=all`, and
`WORKSPACE_COMMUNICATIONS_DEVICE_UNREAD=all` only in device mode. It does not
forward the caller's production credentials. Public environment values must
also be correct at build time because Next embeds them in browser assets.

Optional runner variables:

| Variable | Default | Meaning |
| --- | --- | --- |
| `BE_BROWSER_TEST_ROOT` | `scripts/browser` | Directory containing the isolated Playwright installation. |
| `BE_PGLITE_ROOT` | Repository dependency resolution | Directory containing `@electric-sql/pglite@0.5.8`. |
| `BE_FULL_APP_ENGINES` | `chromium,webkit` | Comma-separated installed engines. |
| `BE_FULL_APP_VIEWPORTS` | `desktop,mobile` | Comma-separated viewport names for a focused repeat. |
| `BE_FULL_APP_KINDS` | `native,client` | Conversation kinds for a focused repeat. |
| `BE_FULL_APP_FAULT_PROBES` | Enabled | Set `0` only for focused timing repeats; excludes isolation/failure/held-response probes. |
| `BE_FULL_APP_SAMPLES` | `3` | Navigation/read samples per engine, viewport and conversation kind. |
| `BE_FULL_APP_CHATS` | `48` | Total synthetic chats, alternating Client and Team. Use enough chats to leave an uncached search target. |
| `BE_FULL_APP_SCREENSHOTS` | Unset | Set `1` to save loading-probe screenshots beside the report. |

Each chat contains 101 encrypted messages, with a 100-message unread backlog.
Desktop uses 1280×900; mobile uses 390×844 with touch/mobile browser emulation.
Both Client and native UI paths run in each engine and viewport. The synthetic REST roster labels native chats as Teams, while the SQL fixture uses direct-conversation participation; this harness does not establish production Team membership policy coverage. Device A and
Device B use separate browser contexts, installation cookies and synthetic live
session IDs for the same account. Trials reset SQL cursors and create new
browser contexts; they reuse the already-started Next process. This is not a
fresh server-process startup measurement for every sample.

## What is real and what is adapted

| Boundary | Exercised here |
| --- | --- |
| Application | Full production Next build, actual app-host proxy routing, shell, components, hooks and API handlers. No component or application-route replacements. The local server rewrites Host/Origin to exercise the app-host branch while transport stays on loopback. |
| Comms data | Actual checked-in account/device RPCs and canonical encrypted message decoders, loaded by `production-fixture.mjs`. Bodies use pgcrypto ciphertext with a synthetic fixture key. Preview batches, selected history, counts and read writes execute SQL. |
| Identity | Synthetic Auth endpoints, signed fixture tokens, user/session tables and SQL claims. This does not validate hosted Supabase token verification, real login, MFA enrollment or session revocation infrastructure. |
| REST metadata | Synthetic workspace, membership, profile, roster and surrounding table responses. The adapter is not a complete PostgREST implementation or a production permission inventory. |
| Realtime | Local WebSocket join/heartbeat acknowledgements. It does not stream real database WAL changes or establish hosted Realtime ordering, latency or recovery behavior. |
| Activity and alerts | Activity, notification cleanup and telemetry RPCs are stubbed. Read writes advance the actual account SQL cursor, but this browser harness does not exercise the push scheduler, delivery providers, active-reading lease persistence or remote OS notification dismissal. |
| Database runtime | One PGlite connection, with RPC work serialized so synthetic request claims cannot interleave. Auth and the Vault decrypted-secret view are fixture adapters. This is not native PostgreSQL concurrency, production durability or replication evidence. |

The `communication_*` and `advance_communication_*` RPC dispatch runs actual
SQL; surrounding non-Comms RPCs use explicit synthetic adapters. Unknown REST tables, RPCs or
paths are recorded as fixture failures. The browser context route guard blocks HTTP(S) requests to
non-loopback hostnames, records them as errors, and disables service workers;
`data:` and `blob:` resources are allowed. The configured WebSocket transport
is local; the HTTP route guard is not a separate WebSocket firewall. The services
bind to `127.0.0.1`. This guard is not an operating-system egress sandbox: retain the isolated
checkout and synthetic build/runtime configuration rather than supplying real
service endpoints.

## Deterministic behavior probes

Normal samples verify metadata, visible preview, selected history and a
server-confirmed read. Each trial also checks latest-preview body search through the final result page. First trials run the additional failure and installation-isolation cases. Device mode additionally
checks the second installation's unread count, a rejected read retaining its
badge/cursor, and recovery of that pending read through the existing queue.

A separate device loading probe holds the preview response with a promise gate.
While it remains held, the row must show “Loading messages” and its spinner;
selected history must still paint. A second gate holds the read before SQL runs:
the private cursor and rendered badge must remain unread. Releasing only that
read gate must allow the cursor and badge to confirm while previews are still
held. Batch IDs are checked against the maximum of 20. These are state/order
assertions, not arbitrary elapsed-time thresholds, and their fault-injection
work is excluded from normal timing samples.

## Read the evidence

The output JSON records mode, build ID, checks, samples and errors. Timing-critical visibility checks use immediate `isVisible()` probes at 40 ms intervals; they avoid the increasing retry delays in locator `waitFor()`. Paint checks retain two animation frames. These probes still have observation overhead and are not browser trace timestamps. A companion
`OUTPUT_JSON.server.log` contains the local Next output. Errors attempt a
screenshot without replacing the original failure. Report all failed or missing
cohorts; a partial file is not a complete successful run.

- `metadataMs`: navigation start to the first CSS-visible conversation row/name; this does not establish that its count is ready.
- `countMs`: navigation start to that row showing the expected `99+` unread badge, observed concurrently with preview loading. Device counts are authoritative; the account path can display its existing provisional count.
- `previewMs`: navigation start to the first row's expected visible preview, followed by two animation frames; this does not mean all visible previews finished.
- `selectedMs`: row click to the exact latest message intersecting its scroll pane, followed by two animation frames.
- `httpAckMs`: row click to completed successful read HTTP response, timestamped in its response handler independently of the selected-history paint observer; this is not the network duration of that request alone.
- `ackMs`: row click through confirmed account/private cursor checks and rendered badge clearance, followed by two animation frames.
- `searchMs`: body-search input through the final result and paint check.

`resourceBoundary` is **completed browser resource entries through confirmed
badge paint; excludes later background work**. `encodedBytes` sums their
`encodedBodySize` values across the page's frames. Navigation entries are not added: the top-level HTML and any document bodies not exposed as resource entries are excluded (an iframe document may appear as a parent resource). `resourceEntries` retains
per-resource encoded/transfer sizes and durations. These are not full-session
traffic, total network overhead, retained memory or a count of all later
background requests. The historically named `apiRequests` field counts observed API response events, not all started requests. `apiStatuses` and `backendRequests` are also
snapshots at that same normal sample boundary; subsequent search and fault
probes do not belong to those counts. Browser resource APIs have their usual
cache/cross-origin measurement limits.

Keep engines, viewports, chat kinds and actions separate when comparing the
baseline and candidate. One CI sample is a correctness observation, not a latency
percentile. Small local samples and a loopback, serial database cannot establish
production p95, network conditions, concurrent load, battery cost or sustained
session behavior.

## Separate native PostgreSQL evidence

`scripts/device-unread-progressive/postgres-checks.mjs` runs the candidate SQL
through independent native PostgreSQL connections. It holds the canonical
advisory lock, observes blocked writers and verifies initialization, old/new
account-frontier convergence, independent private positions, same-installation
ordering and duplicate saves. It creates and drops its own random database on
an explicitly created disposable loopback cluster.

Set `BE_DEVICE_POSTGRES_URL` to that disposable local cluster, `BE_PG_ROOT` to an
isolated `pg@8.16.3` installation and `BE_PGLITE_ROOT` to the fixture dependency
directory. Never point it at an existing application database. The exact cluster
setup/cleanup recipe lives in the workflow's `isolated-postgres` job. Its output
is separate from this browser report; running this browser harness does not run
that concurrency gate. Native PostgreSQL still uses synthetic Auth/Vault
adapters and is not hosted Supabase or production-load validation.

Passing these checks proves the listed isolated application/SQL behaviors. It
makes no claim of production deployment, authenticated production acceptance,
external delivery, a physical Android/iPhone/Safari/PWA check, or full-app
coverage outside the exercised Communications journeys.
