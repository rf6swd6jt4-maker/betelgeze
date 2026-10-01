# Panel loading consistency — 2026-10-01

## Scope and owners

- `PanelLoadingTabs` preserves `PanelTabStrip` dimensions with neutral inert pending faces. Pending destinations have neither the finished white selected face nor hover affordances.
- `NativeWorkspaceTab` reserves pull-to-refresh feedback and gestures for an authorized visible snapshot. A cold read or empty retry uses the existing route-specific skeleton; a refresh retains the existing content, local interactions and banner.
- `WorkspacePanelChrome` accepts an optional pending destination pathname. The shell can reuse its existing banner while a framed destination opens, before that frame's navigation hook is ready. Banner eligibility remains owned by `workspaceRouteUsesSharedBanner`.
- `WorkspaceBannerPending` obeys reduced motion.
- Native context messages include their source URL for the coordinator's route-identity fencing. This adds no read or context capability.

The integrated `WorkspaceTopBarClient` wraps the framed opening state in `WorkspacePanelChrome`, passing the destination pathname and existing `nativeBanner` (or `WorkspaceBannerPending`). This adds no banner read to the legacy-only path.

## Validation

- 29 focused Node tests pass: panel loading coverage, progressive loading, native readiness handshake, native error recovery, and pull-to-refresh.
- Changed-file ESLint and `git diff --check` pass.
- `node scripts/browser/run-native-loading.mjs` passes Chromium and WebKit at 390×844 and 1280×900. It uses the actual native tab, snapshot cache, refresh owner, navigation provider and chrome, replacing heavy content and fetch responses with synthetic fixtures.
- Each browser/viewport run verifies cold opening, deferred section replacement, refresh deduplication, retained local edits across refresh failure/retry, inactive-tab feedback cleanup, empty failure/retry, access-loss content removal, and stable banner DOM identity. Exactly six read requests cover these explicit operations; requesting the same refresh twice adds one read.
- A negative-control run temporarily restored the previous `refreshing={snapshot.loading}` behavior. The Chromium regression failed on the initial duplicate refresh indicator, and the candidate source was restored immediately.
- The integrated panel rendering matrix passes **264 states**, including shared opening components composed in a synthetic shell and a computed-color assertion forbidding finished white pending tab faces. The final **1,407-test suite** and production build pass; see [integrated validation](consolidation-validation-2026-10-01.md).

## Performance and evidence limits

The runtime change adds no request, timer, polling, prefetch, rendering loop, cache owner, navigation gate or minimum loading duration. Existing lazy code, snapshot reuse, request deadline, in-flight deduplication, access-loss handling and two-paint readiness are unchanged. The synthetic transitions demonstrate lifecycle behavior and bounded reads; they do not measure authenticated production latency or establish physical iPhone/Android acceptance.

No schema, migration, stored data, file, membership, authorization policy or message-reading semantics changed. Local integrated tests/build passed. Release still requires authenticated cold/warm shell transitions, hosted release evidence and physical-device checks. Revert these presentation changes to roll back; no data conversion or migration rollback is needed.
