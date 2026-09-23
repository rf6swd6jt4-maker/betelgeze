# Lead Gen source retirement

This change removes Lead Gen's operational application, import commands, and separate NER service source. It does not issue database queries or modify any client, user, poll, company, evidence, source, relationship, storage, migration, or schema records. The earlier [operations inventory](./leadgen-operations-inventory.md) and [external execution inventory](./leadgen-external-source-inventory.md) describe the pre-retirement paths and unresolved external state. Their paused-source descriptions are historical; this document describes the new repository state.

## Retained boundary

- `lib/leadgen/availability.ts` supplies only the retired response. Both old POST URLs return a no-store 503 before reading request bodies, credentials, database rows, or providers.
- `/[workspaceSlug]/leadgen` displays a read-only, paginated archive of saved companies and links to `/leadgen/polls`. Historical relationship provenance opens the exact saved company at `/leadgen/company/[companyId]` when an ID exists. Company and poll list pages each make one workspace-scoped, 41-row maximum read with a validated keyset cursor. Their detail pages each make one workspace-scoped, single-record read. The old `/leadgen/new` URL explains retirement after administrator authorization. None of these pages mounts refresh/polling, imports the runner, or exposes mutations.
- Historical records, IDs, relationship `leadgen_company_id` references, migrations, SQL inventory files, and source/storage data remain unchanged. The archive is deliberately smaller than the prior diagnostic UI; the underlying evidence collections remain in the database for authorized recovery or audit.

## Removed source

- Poll creation/retry/cancel/removal actions; task, evidence, qualification and provider workers; source catalogue/settings UI; browser auto-refresh; legacy operational loading presentation (archive routes retain shared loading boundaries).
- Five Sunbiz/Arizona import/build/upload commands and their package scripts; generated name-frequency data and generator.
- NER implementation and `.github/workflows/deploy-ner.yml`. Retain only `services/ner/vercel.json` with `git.deploymentEnabled=false`: deleting this control re-enables automatic builds for the still-linked Vercel project. This removes repository deployment automation only. An already deployed NER project, old deployment URL, external caller, old process, or scheduler must be inventoried separately; source deletion does not disable it.
- Implementation-specific Lead Gen tests, replaced with retirement admission, archive pagination/auth, and cursor checks.

## Dependency evidence

The removed `lib/leadgen/overture-duckdb.ts` was the sole app importer of `@duckdb/node-api`; removed `place-seed-sources.ts` was the sole app importer of `@mapbox/vector-tile`, `pbf`, and `pmtiles`. `npm uninstall --package-lock-only --offline --ignore-scripts --no-audit --no-fund` removed those four direct dependencies and their exclusive transitive lock entries. The lockfile changed from 305,314 to 297,202 bytes (8,112 fewer bytes) and from 577 to 559 package entries (18 fewer entries). These are lockfile measurements, not installed, server bundle, download, or runtime memory measurements. `@aws-sdk/client-s3`, `@aws-sdk/s3-request-presigner`, `@zip.js/zip.js`, and `fast-xml-parser` remain because other product paths use them.

## Verification and release limit

Focused tests cover stale POST denial before request parsing, bounded workspace-scoped company/poll archive reads, validated cursor input, and absent operational entrypoints. Shared list/detail/access tests cover read-only archive anatomy and admin route authorization. `git diff --check` and app/lib TypeScript diagnostics passed. The repository's broad `tsc --noEmit` still reports pre-existing test import-extension errors; the coordinator owns build and wider test gates. No live deployment, provider state, external scheduler, or physical/browser session is proven by these source checks. Previous accepted requests or old deployments require a separate live inventory before describing Lead Gen as externally stopped.


## Deployment configuration follow-up

The first production promotion exposed a live linked `betelgeze-ner` Vercel project: deleting its existing `git.deploymentEnabled=false` configuration caused obsolete automatic build attempts. Restore that exact configuration as a retirement marker while keeping all service implementation and the manual deploy workflow removed. [Vercel documents this Git control](https://vercel.com/docs/project-configuration/git-configuration). This prevents future automatic builds; it does not delete the project, old deployment URLs or any stored data, and does not certify that an older endpoint is disabled. The main Betelgeze deployment is a separate project.
