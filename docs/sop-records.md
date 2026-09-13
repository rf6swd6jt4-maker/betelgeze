# SOP records and source interpretation

Automatic test-service Setup work and per-call usage are now a separate layer; see [SOP work rollout](sop-work-pilot.md). Ready source interpretations are usable without an admin approval gate.
Implemented locally; deployment, real R2/OpenAI calls, authenticated shell QA and physical-device checks are separate release gates.

SOPs are durable records with a name, description, archive state, optimistic version, and independently stored assets. Owners/admins create/edit/archive/restore and add assets. Every current workspace member can browse and view. The existing sidebar entry is retained. Catalogue cards remain square procedure covers; detail pages use shared header/fields/danger-zone primitives and the Assets section uses the shared embedded List.

The migration preserves existing `sop_document` asset IDs as SOP IDs and links those originals as main procedures. A compatibility trigger covers uploads completed from older open catalogue tabs. No file bytes are copied during migration; the previous document route remains valid. New assets use the same private R2/asset infrastructure, linked through `sop_assets`.

Uploads: docs/images/text up to 50 MiB, video/audio up to 250 MiB; up to ten selected files processed sequentially. A receipt is scoped to actor, workspace, SOP, file metadata, role and notes; it is saved before upload and recoverable after reload. File-size/type/header checks precede a server-side copy. The final object path includes the verified staging ETag's hash so competing finalizers cannot overwrite another finalized version. Atomic SQL inserts both asset and SOP link and increments the parent version. Failed finalization preserves recovery; previously saved batch members remain intact. Abandoned staging and unreferenced final objects need a later storage lifecycle cleanup policy; no unsafe broad deletion job is added here.

Roles distinguish main procedure, supporting guidance, example, revision and reference. A revision label is descriptive; this release does not automatically supersede another asset or publish a combined SOP knowledge release. Assets are immutable files. Upload a revised source separately.

The explicit Interpret asset action queues one source interpretation. No model calls happen during upload, page opening, preview, or queue navigation. New jobs are durable before `after` wakes a worker. A protected recovery route and explicit Resume action claim the same queued job. Production must configure and verify the recovery scheduler before enabling the feature; see [setup](sop-openai-setup.md).

Interpretations contain summary, applicability, conditional guidance, example/requirement distinctions, source quotes/locations, missing information and warnings. The response uses a strict JSON schema plus local bounds and text-quote checks. PDF/image/office quotes and locations remain model-generated draft claims to check against originals. Review is recorded by an admin. This foundation neither builds client plans nor writes work items, promotes source precedence, learns lessons, or fine-tunes a model.

Security: application routes recheck membership/MFA and admin role for mutations; SQL commands recheck current admin membership and workspace activation. New tables and RPCs are revoked from browser roles, with RLS enabled. Worker dispatch rechecks current requester access and archive state before reading the exact linked source. Assets never grant broader Library access. Signed document/image reads are private and short-lived. Video/audio previews stream authenticated byte ranges without buffering the original or relying on an expiring playback URL; hidden tabs pause active playback. No unrestricted tools, web browsing, or cross-workspace retrieval exist in the interpreter.

Performance: 24 records/assets per page, stable timestamp/ID cursors, indexed active/archive catalogue paths and asset listing. Parent and asset reads begin independently. Asset and interpretation status are retrieved through one bounded relational read, without result bodies, signed URLs, file bytes or per-asset signing on navigation. Preview, playback and interpretation details load only on explicit request. No new workspace-wide subscriptions, scanners or polling loops.

Validation commands:

```sh
node --test --disable-warning=MODULE_TYPELESS_PACKAGE_JSON tests/sops.test.ts tests/sop-records.test.ts
BE_PGLITE_ROOT=/tmp/be-performance-pg-fixture node scripts/validate-sop-records-sql.mjs
npm test
npx eslint lib/sops components/sops 'app/[workspaceSlug]/sops' 'app/api/workspaces/[workspaceSlug]/sops' app/api/cron/sop-interpretations tests/sop-records.test.ts
git diff --check
npx next build --webpack
```

The optional PGlite fixture is described in `scripts/pglite-fixture.mjs`; it runs the actual migration in isolated PostgreSQL/WASM with no external credentials. It exercises legacy migration, permissions, request replay, optimistic concurrency, lease ownership, daily reservations, interrupted runs, archive/restore and query plans with 30,000 SOPs and 30,000 assets. Database timing observations are not production latency measurements.

## Local verification for this change

- 959 repository tests pass, including 13 new record/asset/interpreter tests and the 10 original catalogue tests.
- Changed-file ESLint and tracked/new-file whitespace checks pass.
- The actual migration passes eight grouped PostgreSQL/WASM checks, including joined asset/status reads at representative growth.
- A production Webpack build passes in a clean temporary source copy. This avoids pre-existing generated fixture and duplicate Next type conflicts in the working checkout; no TypeScript errors are suppressed. The build uses the app's existing Google Fonts network fetch.
- Chromium and WebKit fixtures at widths 320, 390, 768 and 1280 verify square catalogue cards, detail layout, shared asset-role selection, no horizontal overflow, staff controls, and zero eager preview requests. Both engines pass persisted creation draft/request-ID recovery, upload finalization retry after reload, unsupported-file rejection, and interpretation draft display. Mobile and desktop screenshots were visually inspected.
- Provider requests are mocked. No paid OpenAI request, production migration, deployment, live R2 write, authenticated workspace-shell test, or physical Android/iPhone test was performed. Scheduled worker recovery must be configured and verified before production enablement.
