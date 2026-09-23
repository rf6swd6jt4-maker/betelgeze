# Foundations checks

The local candidate adds [Foundations](../../../.github/workflows/foundations.yml) for pull requests, pushes to `main`, and manual runs. It has read-only repository permission, pinned official checkout/setup-node actions, Node 24.16.0 and no deployment, webhook, provider or production credential step. Its concurrency group cancels only older Foundations runs for the same pull request/ref; it does not cancel deployment or other workflows.

The application job runs `npm ci`, the change gate with strict scoped ESLint, the full `npm test` suite, and `npx next build --webpack`. Supabase build variables use `http://127.0.0.1:9` and non-secret placeholders. Package downloads and build-time public fonts still need network access. The installed Next CI guide was reviewed: npm downloads are cached through setup-node, while `.next` is deliberately rebuilt without sharing a build cache. This workflow adds no runtime dependency or application request.

## Comparison and enforcement

[check-foundation-changes.mjs](../../../scripts/check-foundation-changes.mjs) requires an explicit base ref. It resolves that ref to an immutable tree and uses Git argument arrays and NUL-delimited paths; spaces, tabs, newlines and shell-looking filenames are not split or executed. Local checks include committed, staged, unstaged and non-ignored untracked files. CI has a clean checkout, so those same checks inspect committed changes.

Local lint/build inspect the working-tree candidate. A path with both a staged change and different working bytes is refused, including a staged historical edit hidden by restoring baseline working bytes or a staged deletion restored as an untracked file. Stage the complete reviewed file or unstage it before running the gate; the gate never changes staging itself. Entirely unstaged edits and fully staged edits remain reviewable. This is not a separate lint/build of staged blobs, and later edits require rerunning the gate.

| Input | Comparison base |
| --- | --- |
| Pull request | Exact `pull_request.base.sha` from the event JSON, against the checked-out merge result |
| Push to main | Exact `before` SHA; an initial all-zero `before` uses the empty tree |
| Manual, explicit `base_ref` | The supplied resolvable ref; invalid input fails the run |
| Manual, no explicit base | Merge base with `origin/main`; if this equals HEAD, the previous commit; for the first commit, the empty tree |

There is no fallback from a missing/invalid ref to an empty successful comparison. A force-push whose previous commit cannot be resolved fails visibly. A manual explicit base can intentionally narrow coverage, so it does not replace the required pull-request check. The empty-tree initial-push case validates the entire repository as new source and may correctly expose existing debt.

The gate enforces:

- Every migration already present at the comparison base is immutable: modification, deletion, rename and type changes fail. Introduce a new migration to change released behavior.
- New migrations must be regular files named `YYYYMMDDHHMMSS_lowercase_description.sql`, with a real UTC timestamp and a unique version across current migrations. Untouched historical duplicate timestamps/legacy names are grandfathered; a new collision fails. This repository already has historical duplicate groups, so this is not proof that replaying all historical migrations is safe.
- A migration added after the base remains editable while that candidate is unreleased. Choosing a newer base that already contains it makes it historical. The base is a Git boundary, not evidence that a database installed the migration.
- Tracked and untracked changes pass whitespace checks. Changed existing JS/TS files pass installed ESLint with `--max-warnings 0`; deleted/unchanged files are excluded. Changed JS/TS symlinks fail instead of bypassing lint. Repository-wide historical lint debt is not silently waived for a changed file.

For the entire current consolidation candidate, the pre-consolidation baseline is `31388081`:

```sh
node scripts/check-foundation-changes.mjs --base 31388081 --lint
npm test
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:9 NEXT_PUBLIC_SUPABASE_ANON_KEY=local-build-placeholder SUPABASE_SERVICE_ROLE_KEY=local-build-placeholder NEXT_TELEMETRY_DISABLED=1 npx next build --webpack
```

Use the appropriate reviewed base for subsequent work. `--json` provides the exact resolved tree, changes and violations. Do not change the base merely to hide a historical migration edit. The gate does not apply SQL, compare installed definitions, establish migration-history parity, or authorize a production write.

## Isolated SQL regression

The second job invokes [validate-records-postgres-concurrency.mjs](../../../scripts/validate-records-postgres-concurrency.mjs) with `BE_RECORDS_PG_BIN=/usr/lib/postgresql/16/bin` on `ubuntu-24.04`. The reviewed runner image lists preinstalled PostgreSQL 16.15; no package install or system database service is started. The validator uses Node built-ins and starts its own temporary cluster with TCP disabled, separate connections and synthetic data, then stops/removes it. Missing binaries fail the job. JSON evidence is written to the runner's temporary directory; an always-run step prints its outcome, count, cleanup result, actual PostgreSQL version and source hashes to the CI log. No upload action or external artifact service is added. Failure before an evidence file exists remains a visible failed step.

PostgreSQL 16 CI is additional regression coverage. It is not PostgreSQL 17 production parity: the separate local rehearsal used 17.11, while the live inventory reported 17.6. Neither fixture proves production RLS/data/provider behavior. No database URL, live credentials or client records are supplied to either CI job.

## Evidence and release boundary

Local temporary-Git tests (19/19) exercise historical edit/deletion/rename, hidden staged edits/deletions/JS/whitespace, ordinary unstaged and fully staged candidates, new migration editing, filename/calendar validation, old/new duplicate versions, symlink refusal, invalid refs, unusual paths, whitespace, strict ESLint exit propagation, and PR/push/manual/first-commit base resolution. They execute the gate against real temporary repositories; they do not assert only source text. The workflow YAML was parsed locally and the gate's own JS/tests passed scoped lint. Final full-suite/build results belong in the pass report.

No hosted Foundations run has been triggered or observed, and required branch-protection checks have not been configured or verified. Adding this workflow does not make the independent Vercel deployment pipeline wait for it. Before claiming an enforced release gate, observe a hosted run at the exact reviewed commit and separately configure/verify required checks and deployment sequencing. Preserve the schema-first and rollback rules in [the operations runbook](./operations-runbook.md).
