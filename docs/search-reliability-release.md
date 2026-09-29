# Search reliability and speed — stage II

Base: `c06fe1a797f9fdf371babb1c52aa5dc509783824`. Candidate branch: `codex/search-reliability`.

## Behavior and ownership

The workspace shell still owns navigation and draft departure. Search now has one request controller and one result presentation shared by desktop and mobile. Each input/account/workspace/permission change masks the preceding results immediately, cancels pending work, and fences every response, error and completion against its exact request. Closing the popup cancels and clears its results; reopening performs a fresh authorized read. The server echoes the verified actor and workspace, so a response from a changed cookie session cannot populate the previous account's search.

Typing remains debounced by 180 ms. There is no result cache, background poll, automatic retry or result-link prefetch. Enter and click selection use only the current completed search; arrows, Home and End choose within that result set. Composition Enter does not navigate. Escape restores focus. Empty results, loading, access loss, invalid input and failed reads have distinct states. Transient errors offer an explicit retry; access/session changes clear discovery and require workspace reload.

The 30-second browser deadline includes response parsing, with wall-clock checks after async completion for suspended browsers. A 25-second server deadline bounds auth, permission and content waiting. Route-owned database requests receive cancellation; queued reads cannot start after cancellation or a category failure. Existing shared auth/access helpers retain their own request lifecycle: an already-running preflight can finish after cancellation, but no later route content read or response publication follows it. This change does not alter those shared owners or protected Communications behavior.

Every admitted database category must succeed. An unavailable relationship schema, failed category, malformed result or authorization error cannot masquerade as successful empty discovery. Server failures return generic 503, deadlines 504, and denied access 401, with no partial results. All responses retain `private, no-store` and `Vary: Cookie`. Short/overlong queries skip capability/content work after session and membership verification. The stage-I authorization matrix and contact RPC are unchanged.

## Speed and stage III contract

Search replaces its use of the broad relationship loader with the existing readable reference projection. It retains current legacy-client fallback identities and order, shares that same client read with the private client category, and removes unused columns from other category projections. It does not add database joins, indexes, migrations, per-record permission requests or any writes. Independent content reads use a request-local queue capped at seven active reads, the former largest batch's concurrency; the queue removes category-wide barriers without admitting all categories at once.

Current sample limits, matching rules, result assembly order and the 20-result response cap remain. The broad relationship/client population and delivery-scope RPC remain growth costs; stage III must replace those retrieval paths with measured, authorized, bounded database matching. Increasing every existing sample limit or downloading more full records is not an acceptable way to broaden coverage. Preserve this request identity, cancellation, explicit failure model, projection discipline and concurrency bound as retrieval expands. Validate exact/prefix/substring ranking and future pagination independently.

An attempted module JSON field extraction was removed: isolated SQL found lower transferred bytes but higher database CPU. The released approach retains the full module definition for existing matching and only drops unused ordinary columns. No speed standard is relaxed.

## Replacement inventory

- Removed the old shell query/loading/results effect, duplicate desktop/mobile rendering, local result type and static Enter fallback. The server-authorized result is now the only selection source. Secondary duplicated hub links are retired; each result has its canonical destination.
- Removed search's broad relationship-loader call, duplicate private client read, serial category batches, ignored category errors and obsolete error-guard branches. The general relationship loader remains because other app routes still use it; its shared haystack has only a narrower input type, with unchanged matching behavior.
- No dependency, data, attachment, migration, read receipt, notification or accepted work is removed.

## Validation and limits

The stage-II comparison is preserved at commit `bf74a26d4f514cb17737aeb56b4581e758943a88` and runs from that revision with `node scripts/measure-workspace-search.ts c06fe1a7`. The subsequent retrieval pass replaces this route-specific benchmark with `scripts/validate-workspace-search-retrieval.mjs`. The stage-II benchmark used the actual baseline/candidate route and access helpers with synthetic data and prohibited network access. All 117 detailed result comparisons and eight role/query/growth comparisons passed. Matching, ordering and canonical destinations agree; only the deliberately retired optional `hubHref` is excluded from equality.

At 500 synthetic records per growing category (including large unused relationship metadata and module definitions):

| Resource | Stage I | Stage II |
| --- | ---: | ---: |
| Staff table payload | 1,862,119 bytes | 238,509 bytes |
| Admin table payload | 3,555,644 bytes | 1,903,180 bytes |
| Admin ordinary-search database calls | 20 | 19 |
| Staff ordinary-search database calls | 11 | 11 |
| Maximum active reads, staff/admin | 5 / 7 | 5 / 7 |
| Equal-duration request waves, staff/admin | 4 / 7 | 4 / 7 |

Create-action searches retain their one additional seller check. The fixture excludes Auth/MFA network work and RPC JSON from table-byte counts; it measures transferred projection data and execution topology, not production latency. The staff response adds the small actor/workspace identity envelope. A forced slow delivery-scope test also proves that scope completion does not delay independent content reads.

Isolated SQL plan checks preserve workspace predicates, ordering and scanned-row counts. At 10,000 relationship rows, projected sort memory fell from 3,167 to 1,194 KB, with observed execution 12.314 to 12.022 ms. At 1,000 module revisions with 200 selected, retaining definitions and dropping ordinary unused columns lowered sort memory from 218 to 120 KB; seven JSON-serialized-response samples had medians 3.525 and 3.297 ms. These small database-only samples are regression observations, not a general latency claim.

Local release checks passed:

- Full repository suite: **1,389 tests**, including 30 search route/security cases, 11 client lifecycle cases and five deadline/concurrency cases.
- Required foundation check: historical migrations unchanged, no new migrations, whitespace and changed-file ESLint passed.
- Production Next.js webpack build with isolated service placeholders passed.
- Full browser foundations: **273/273 cases per engine** in Chromium and WebKit. New search coverage contributes 24 desktop and 24 mobile cases per engine (96 total); tests use production React/component bundles and extracted actual shell handlers with synthetic responses.
- No authenticated production test workspace or physical iPhone/Android was exercised. Existing client records were not used to generate test activity. Hosted CI and terminal deployment evidence are retained in the release artifacts and reported separately. Synthetic browser and database measurements establish fixture behavior and resource costs, not authenticated production latency, physical-device behavior or working-day stability. The baseline reproduction demonstrates stale Enter selection, late-result overwrite, stale-finally loading changes, and failed requests appearing as empty success.

## Rollout and rollback

Application-only release; no migration is required. Validate the exact candidate branch through Foundations before fast-forwarding main, then verify the terminal Vercel production deployment and a read-only HTTP smoke. Preserve both clean checkouts. Rollback to stage-I commit `c06fe1a7` is schema-compatible and retains the security repair; never roll back to the earlier contact-disclosure implementation.
