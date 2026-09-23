# Runtime consolidation release

Base: `336439e4027c785c252edcc298d5e066acf81e75`. The user authorized implementation and deployment while explicitly prohibiting client/user data changes. Work is isolated from the dirty original checkout. No database migration, production SQL, data rewrite, storage mutation, provider message, credential change or external scheduler change is part of this release.

## Changes

- Remove the operational Lead Gen source, settings, actions, import commands, NER deployment source/workflow (retaining its existing automatic-deployment denial), old poll-start notifications and four exclusive dependencies. Remove DuckDB's forced all-route output tracing. Retain bounded authorized company/poll archives, exact historical relationship links, and denial endpoints for stale processing/import URLs. See [retirement](./leadgen-retirement.md).
- Correct a measured upward displacement of fixed mobile workspace chrome without changing document scroll or editor selection. The existing composer controller keeps its bottom-edge ownership. Physical compositor behavior remains unverified; see [geometry evidence](./mobile-consolidation.md).
- Settle cancelled panel reads immediately and release their deadlines even when the upstream reader ignores abort. A 250-cycle controlled baseline retains 250 deadlines; the candidate retains zero. See [resource evidence](./resident-stability.md).
- Add development-only Chromium/WebKit fixture gates, with exact case counts and non-loopback requests blocked, to Foundations CI. Browser tooling has a separate lockfile and is not an application dependency. Candidate branches now run the same workflow before main promotion, checking their entire diff against main on every push.
- Add the ownership map, focused regression selection, scoped agent instructions, additive-development/deprecation rules and release gate. These document current boundaries and gaps; they do not declare the whole platform frozen or universally verified.

## Local validation

- Complete Node suite: 1,289 passed; zero failed/skipped/cancelled. Lead Gen implementation tests were retired with their deleted implementation; replacement tests enforce denied mutation and authorized, paginated archives.
- Strict scoped lint, immutable migration/whitespace gate: passed. All 266 historical migrations unchanged; no new migrations. `app_speed.md` and `app-alerts.md` unchanged.
- Production webpack build with loopback placeholder Supabase configuration: passed. Removed DuckDB/vector-tile/PMTiles packages are absent from produced server file traces. This does not measure transferred client bytes or production latency.
- Chromium 153 and Playwright WebKit 26.6: 93 checks per engine (viewport geometry 6, departure 32, production draft recovery 25, StrictMode draft recovery 25, motion 5). Real application components/helpers with synthetic DOM/saves; no live account or provider requests. Hosted workflow rechecks the committed candidate.

## Rollout and limitations

Push the reviewed candidate branch, wait for all four Foundations jobs, verify main has not moved, then advance main without force. Confirm the exact production deployment and public read-only HTTP health separately. Record final commit/CI/deployment URLs in the task handoff; this pre-release document is not evidence that those later steps succeeded.

Remaining evidence includes physical Android/Chrome and iPhone/Safari/PWA keyboard behavior, authenticated acceptance using an isolated test workspace, ordinary working-day production observations, restore rehearsal, installed-schema history reconciliation and external Lead Gen process/scheduler inventory. This release does not silently reopen protected unread/Realtime/push/outbox work. Do not use real client data/messages/uploads as test fixtures.

Rollback is a reviewed application revert; all historical data/schema/storage remain compatible. Restoring the base returns Lead Gen's previously closed admission gate, not enabled processing. No data restoration is required by these source changes.
