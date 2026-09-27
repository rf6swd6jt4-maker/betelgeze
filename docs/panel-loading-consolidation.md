# Panel loading consolidation — 27 September 2026

Base: `f96784943150af1868aad33488ed799b6e944019`.

## Scope and ownership

The affected actions are initial panel opening and the transition from route fallbacks to streamed sections. Existing resident tabs, data caches, reads, permission checks, mutation/departure protection and Communications behavior retain their owners. No database, stored-file, migration, provider or client/user data changes are part of this release.

The presentation uses shared panel/list geometry and a compact neutral skeleton vocabulary. Communications and Settings keep their fitting layouts. Live navigation controls are not mounted inside placeholders: the pure tab presentation shares geometry without router hooks or prefetch. Optional Library destinations remain neutral until authorization is known.

Relationships uses the same loading composition inside its server Suspense boundary as in its route. Onboarding route and deferred body/rows reuse one fallback. Activity uses the same chart placeholder at both stages. Notes has a detail-specific route fallback; the legacy Appointment Setting shell destination uses its Client Connections redirect target's loading state.

## Performance assessment

No request, serial dependency, polling, cache, subscription, minimum splash duration or navigation gate is added. Placeholder work is bounded and CSS-only. Five fixed skeleton rows explicitly paint immediately; their inherited `content-visibility:auto` had caused WebKit to show row outlines for an initial frame before painting their contents. Populated record lists retain their existing rendering optimization. Existing resolved content and section streaming remain in place. This is a presentation consistency change, not a claim that server reads or real-user latency improved. Foreground-action overlay policy and the navigation lifecycle are not rewritten in this change.

## Validation

- Full repository suite: 1,343/1,343 passing. Production Webpack build passes with local placeholder Supabase configuration.
- Foundation browser fixtures: 225 checks across 14 fixtures in each of Chromium and WebKit, including departure, drafts and retained Communications geometry.
- Panel presentation fixture: 232 loading/reference observations across both engines, 320/390/1280px widths and normal/reduced motion. It checks inert placeholders, route/shell consistency, overflow, reduced motion, immediate skeleton-row visibility and representative header/filter/list alignment. Screenshots were reviewed, including the corrected WebKit initial row paint.
- Changed-file lint, whitespace and immutable migration checks pass. No migration was added or changed.
- The Foundations workflow runs the panel fixture for both engines on future candidates. Local JSON/screenshots are under ignored `browser-results/`; `scripts/browser/run-panel-loading.mjs` reproduces them without production access.

These are synthetic component and source checks. They do not establish authenticated production behavior, real-user latency or physical iPhone/Android acceptance. Hosted CI and deployment status are recorded in the release response.

## Rollback

Revert the presentation and fallback integration as an application-code change. No schema or data rollback is required.
